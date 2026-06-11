import { getMonsterTypes, getAttacksForMonster, cleanAttackName, getSpiritChains } from "../engine/gamedata.js";
import { getMonsterStats } from "../engine/stats.js";
import { THEME, elementColor, addMenuBackground, drawButton, drawPanel, drawHeader, drawScrollbar, inRect } from "../ui/theme.js";
import { safeInsetsDesign } from "../systems/safearea.js"; // MOB: header cluster off the notch
import { sfx } from "../systems/audio.js"; // click feedback on Back / collection-filter taps (immediate-mode, not addButton)
import { net } from "../netClient.js";
import { getCharacter } from "../storage.js";
import { getDiscovered, getSeenSpecies, markSpeciesSeen, getEncountered } from "../engine/discovered.js"; // PV-T15: species ever caught (survives collection churn); PV-T16: "NEW" badge state; encountered = "seen in the wild"
import { newSpeciesCount } from "../engine/collection.js"; // PV-T16: shared NEW-count formula (matches the lobby badge)

// Bestiary / curation gallery: a scrollable grid of every monster rendered with
// its procedural sprite. Serves art review and P5 generated-content curation —
// non-invasive (doesn't touch gameplay), no API/DB cost.
export default function bestiaryScene(k) {
  // `args.backScene` lets a caller (e.g. the online lobby, LS-14) return here on
  // close instead of the default title — mirrors cosmetics.js's back contract.
  k.scene("bestiary", (args = {}) => {
    const backScene = args.backScene || "start";
    const backArgs = args.backArgs || {};
    // Admin view (reached from /admin → the "/bestiary" link, main.js sets admin:true):
    // shows the FULL pool of every species. The normal player view only lists species
    // the player has actually encountered (seen in the wild or caught) — the bestiary is
    // a record of what you've met, not a spoiler-y catalogue of everything in the game.
    const adminMode = !!args.admin;
    // In admin mode "Back" returns to the admin page (a full nav), not the game title.
    const goBack = () => {
      if (adminMode) { try { window.location.href = "/admin.html"; return; } catch { /* no DOM */ } }
      k.go(backScene, backArgs);
    };
    const monsters = getMonsterTypes()
      .slice()
      .sort((a, b) => (a.element || "").localeCompare(b.element || "") || a.typeName.localeCompare(b.typeName));
    const slug = (n) => n.toLowerCase().replace(/\s+/g, "_");

    // VS-4: element color comes from the one source of truth (theme.elementColor —
    // colorblind-tuned + comprehensive + hashed fallback), not a local duplicate map.
    const elc = elementColor;
    // Brighten dark element colors so they stay legible as text on dark surfaces.
    const ink = (c) => {
      const lum = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
      if (lum >= 0.5) return c;
      const f = 0.5 / Math.max(0.12, lum); // lift dark colors toward mid-luminance
      return [Math.min(255, Math.round(c[0] * f)), Math.min(255, Math.round(c[1] * f)), Math.min(255, Math.round(c[2] * f))];
    };

    const HEADER = 64;
    const CARD_W = 210, CARD_H = 168, GAP = 16;
    let scrollY = 0;
    let dragging = false, lastY = 0, moved = 0;
    let selected = null; // the monster whose detail panel is open, or null

    // Collection tracking (Pokédex-style): mark which species the player owns.
    // SP launch passes characterId → read its team+vault; MP → the connected
    // session's team+vault. With no player context (pure curation/art review),
    // hasContext is false and nothing is dimmed.
    const caught = new Set();
    let hasContext = false;
    const ch = args.characterId ? getCharacter(args.characterId) : null;
    const collect = (list) => { for (const m of list || []) caught.add(String(m.typeName || "").toLowerCase()); };
    if (ch) { hasContext = true; collect(ch.activeMonsters); collect(ch.vaultMonsters); }
    else if (net.state && net.state.connected) { hasContext = true; collect(net.state.team); collect(net.state.vault); }
    // PV-T15: also count species ever discovered (persisted) so the Pokédex remembers
    // a catch even after the monster leaves the live collection (released/lost/MP run).
    const everCaught = getDiscovered();
    if (everCaught.size) { hasContext = true; for (const t of everCaught) caught.add(t); }
    const isCaught = (mt) => caught.has(String(mt.typeName || "").toLowerCase());
    const caughtCount = () => monsters.filter(isCaught).length;
    // "Seen in the wild" — encountered in combat but not (yet) caught. The Pokédex
    // middle state (never-seen → seen → caught). Read once on entry; context-gated.
    const encountered = getEncountered();
    if (encountered.size) hasContext = true;
    // Admin view is a clean full catalogue — don't dim/badge by the admin's own
    // collection (and the encounter gate is bypassed in `universe()` anyway).
    if (adminMode) hasContext = false;
    const isSeen = (mt) => !isCaught(mt) && encountered.has(String(mt.typeName || "").toLowerCase());
    // PV-T16: a caught species the player hasn't inspected yet wears a "NEW!" badge —
    // a reason to revisit the bestiary after a run. `seen` is read once on entry; opening
    // a detail marks it seen (and updates the live set) so the badge clears on close.
    const seen = getSeenSpecies();
    const isNew = (mt) => isCaught(mt) && !seen.has(String(mt.typeName || "").toLowerCase());
    const newCount = () => newSpeciesCount(monsters, caught, seen); // shared formula (lobby parity)

    // Visibility — the player only sees species they've ENCOUNTERED (caught, or met in
    // the wild). `universe()` is that personal record; admin mode shows the full pool.
    // (The element filter was removed 2026-06-10 — there's no fixed element set to filter
    // by; elements are free-form flavour.)
    const norm = (s) => String(s || "").toLowerCase();
    const everSeen = (m) => isCaught(m) || encountered.has(norm(m.typeName)); // caught ⇒ also "seen"
    const universe = () => (adminMode ? monsters : monsters.filter(everSeen));
    // Collection filter (All / Caught / Seen) — collectors want to see "what's left" within
    // the species they've met. Needs player context + room for a 2nd header button (it can't
    // co-exist with the narrow title), so it's gated; hidden in admin (no player context) and
    // when there's nothing yet to filter. (The "Uncaught" state was removed 2026-06-10: within
    // the encountered-only view every uncaught species IS a seen-in-wild one, so it duplicated
    // "Seen" exactly.)
    let filterCol = "all"; // all | caught | seen
    const collEnabled = () => hasContext && !adminMode && k.width() >= 560 && universe().length > 0;
    // When the collection control isn't available (no context / too narrow), the
    // filter is uncontrollable — treat it as "all" so a filter set on a wide screen
    // then narrowed (resize / tablet rotate) can't strand the grid on a hidden subset.
    const colMatch = (m) => !collEnabled() || filterCol === "all" || (filterCol === "caught" ? isCaught(m) : isSeen(m)); // "seen" = met in the wild, not yet caught
    const shown = () => universe().filter(colMatch);
    // MOB: inset the top-right header cluster (collection filter + Back) off the
    // notch/rounded corner so they stay tappable on phones (safe-area in design units).
    const ins = safeInsetsDesign(k);
    const COLL = ["all", "caught", "seen"];
    const collRect = () => [k.width() - 92 - 152 - ins.right, 14 + ins.top, 144, 36]; // left of the Back button
    const inColl = (p) => { if (!collEnabled()) return false; const [x, y, w, h] = collRect(); return p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h; };
    const cycleColl = () => { filterCol = COLL[(COLL.indexOf(filterCol) + 1) % COLL.length]; scrollY = 0; };

    const cols = () => Math.max(1, Math.floor((k.width() - GAP) / (CARD_W + GAP)));
    const contentH = () => Math.ceil(shown().length / cols()) * (CARD_H + GAP) + GAP;
    const maxScroll = () => Math.max(0, contentH() - (k.height() - HEADER));
    const clamp = () => { scrollY = Math.min(maxScroll(), Math.max(0, scrollY)); };
    const backRect = () => [k.width() - 92 - ins.right, 14 + ins.top, 78, 36];
    const inBack = (p) => { const [x, y, w, h] = backRect(); return p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h; };

    // Which card (monster index) is under a point, or -1.
    const cardAt = (p) => {
      if (p.y < HEADER) return -1;
      const c = cols();
      const gridW = c * CARD_W + (c - 1) * GAP;
      const x0 = (k.width() - gridW) / 2;
      const relX = p.x - x0, relY = p.y - (HEADER + GAP - scrollY);
      if (relX < 0 || relY < 0) return -1;
      const col = Math.floor(relX / (CARD_W + GAP)), row = Math.floor(relY / (CARD_H + GAP));
      if (col < 0 || col >= c) return -1;
      if (relX - col * (CARD_W + GAP) > CARD_W || relY - row * (CARD_H + GAP) > CARD_H) return -1; // in the gap
      const idx = row * c + col;
      return idx >= 0 && idx < shown().length ? idx : -1; // index into the filtered view
    };

    const T = (n) => k.rgb(...THEME[n]);
    addMenuBackground(k, { fixed: true, z: -10 });

    k.onDraw(() => {
      const c = cols();
      const gridW = c * CARD_W + (c - 1) * GAP;
      const x0 = (k.width() - gridW) / 2;
      const top = HEADER + GAP - scrollY;
      // Card under the cursor (desktop hover affordance) — none while the detail
      // panel is open. On touch, mousePos rests in the header so this stays -1.
      const hovIdx = selected ? -1 : cardAt(k.mousePos());
      const view = shown();
      for (let i = 0; i < view.length; i++) {
        const y = top + Math.floor(i / c) * (CARD_H + GAP);
        if (y + CARD_H < HEADER || y > k.height()) continue; // cull off-screen rows
        const mt = view[i];
        const x = x0 + (i % c) * (CARD_W + GAP);
        const col = elc(mt.element);
        // Hover glow: a soft element-tinted halo behind the focused card.
        if (i === hovIdx) {
          k.drawRect({ pos: k.vec2(x - 4, y - 4), width: CARD_W + 8, height: CARD_H + 8, radius: 18, color: k.rgb(col[0], col[1], col[2]), opacity: 0.22 });
        }
        // Card background via the SHARED drawPanel (shadow + sheen + specular rim) — raised-surface
        // parity with panels/buttons + the cosmetics cards (was a flat rect + manual sheen, no
        // shadow/rim). Element hairline preserved via borderW (3px on the hovered card, else 2).
        drawPanel(k, { rect: [x, y, CARD_W, CARD_H], radius: 14,
          fill: i === hovIdx ? THEME.surface2 : THEME.surface, border: col, borderW: i === hovIdx ? 3 : 2 });
        try { k.drawSprite({ sprite: slug(mt.typeName), pos: k.vec2(x + CARD_W / 2, y + 60), anchor: "center", scale: 0.72 }); } catch {}
        k.drawText({ text: mt.typeName, pos: k.vec2(x + CARD_W / 2, y + CARD_H - 46), size: 14, font: "gameFont", anchor: "center", width: CARD_W - 14, color: T("text") });
        const lab = ink(col);
        // Element name (left) + rarity as pips (right) — filled pips scan faster across
        // the gallery than reading "R3" text. Falls back to text for rarity > 5 pips.
        k.drawText({ text: mt.element, pos: k.vec2(x + 12, y + CARD_H - 20), size: 12, font: "gameFont", anchor: "left", color: k.rgb(lab[0], lab[1], lab[2]) });
        drawRarityPips(x + CARD_W - 12, y + CARD_H - 14, mt.rarity, col);
        // Collection state: caught species get a teal corner badge; un-caught ones
        // are muted so the ones you own stand out (kept legible — it's also an art
        // gallery). No styling when there's no player context.
        if (hasContext) {
          if (isCaught(mt)) {
            k.drawCircle({ pos: k.vec2(x + 15, y + 15), radius: 6, color: k.rgb(col[0], col[1], col[2]) });
            k.drawCircle({ pos: k.vec2(x + 15, y + 15), radius: 6, fill: false, outline: { width: 1.5, color: T("bg") } });
          } else {
            // Uncaught: dim the card. A species *seen in the wild* dims less + gets a
            // hollow grey dot (top-left), so it reads as "met, not yet caught" vs a
            // never-seen species (fully dimmed, no dot).
            const seen = isSeen(mt);
            k.drawRect({ pos: k.vec2(x, y), width: CARD_W, height: CARD_H, radius: 14, color: T("bg"), opacity: seen ? 0.34 : 0.5 });
            if (seen) k.drawCircle({ pos: k.vec2(x + 15, y + 15), radius: 6, fill: false, outline: { width: 1.5, color: T("textMut") } });
          }
          // PV-T16: "NEW!" badge (top-right) on a freshly-discovered, not-yet-inspected
          // species — clears once you open its detail. Amber to read as a reward marker.
          if (isNew(mt)) {
            const bw = 42, bh = 18, bxr = x + CARD_W - bw - 8, byr = y + 8;
            k.drawRect({ pos: k.vec2(bxr, byr), width: bw, height: bh, radius: 9, color: T("amber"), outline: { width: 1.5, color: T("bg") } });
            k.drawText({ text: "NEW!", pos: k.vec2(bxr + bw / 2, byr + bh / 2), size: 11, font: "gameFont", anchor: "center", color: T("bg") });
          }
        }
      }

      // Header (drawn over the grid) + back button + scrollbar.
      k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: HEADER, color: T("bg"), fixed: true });
      k.drawRect({ pos: k.vec2(0, HEADER - 1), width: k.width(), height: 1, color: T("line"), fixed: true });
      // Count is over the player's encountered set (the full pool in admin mode).
      const baseN = universe().length;
      const total = filterCol === "all" ? `${baseN}` : `${shown().length} / ${baseN}`;
      // On very narrow viewports drop the count from the title so it doesn't crash
      // into the filter/back buttons on the right.
      const narrowTitle = k.width() < 560;
      const titleText = narrowTitle ? "BESTIARY" : `BESTIARY     ${total} MONSTERS`;
      const hmp = k.mousePos(); // pointer for header button hover glow
      drawHeader(k, { title: titleText, ruleW: 150, size: narrowTitle ? 20 : 25 }); // smaller on narrow so "BESTIARY" clears the buttons
      // The centered hint collides with the title on narrow viewports — only show
      // it when there's clear room (title right ~x=300, filter button at width-244,
      // hint half-width ~140 → need >840 to avoid overlap with both ends).
      if (k.width() >= 840) {
        const nc = hasContext ? newCount() : 0;
        // Collection completion % — a collectathon goal metric ("20% complete") that the
        // raw count alone doesn't emphasize. Floors at the total so it can't read 0/0.
        const pct = monsters.length ? Math.round((caughtCount() / monsters.length) * 100) : 0;
        const hint = hasContext ? `Caught ${caughtCount()} / ${monsters.length}  (${pct}%)${nc ? `   ${nc} NEW` : ""}       tap a monster for full stats` : "tap a monster for full stats";
        k.drawText({ text: hint, pos: k.vec2(k.width() / 2, 26), size: 12, font: "gameFont", anchor: "center", color: T("textMut"), fixed: true });
      }
      // Collection filter cycle button (only when there's player context + room).
      if (collEnabled()) {
        const cr = collRect();
        const cActive = filterCol !== "all";
        const clabel = filterCol === "caught" ? "Caught" : filterCol === "seen" ? "Seen (uncaught)" : "All species";
        drawButton(k, { rect: cr, text: clabel, size: 13, fill: THEME.surface, textColor: cActive ? THEME.teal : THEME.textMut, outline: cActive ? THEME.teal : THEME.line, hover: inRect(hmp, cr), fixed: true });
      }
      const br = backRect();
      drawButton(k, { rect: br, text: "Back", size: 16, fill: THEME.surfaceAlt, textColor: THEME.text, outline: THEME.line, hover: inRect(hmp, br), fixed: true });

      // Empty state: a player who hasn't met anything yet (the grid is blank) gets a
      // nudge toward the loop, instead of a confusing void. (Admin always has content.)
      if (view.length === 0) {
        const cy = HEADER + (k.height() - HEADER) / 2;
        const msg = filterCol !== "all"
          ? "No species match this filter yet."
          : "You haven't encountered any monsters yet.\nExplore the world to fill your bestiary.";
        k.drawText({ text: msg, pos: k.vec2(k.width() / 2, cy), size: 16, font: "gameFont", anchor: "center", width: Math.min(440, k.width() - 48), align: "center", color: T("textMut"), fixed: true });
      }

      const ms = maxScroll();
      if (ms > 0) drawScrollbar(k, { top: HEADER, trackH: k.height() - HEADER, contentH: contentH(), scrollY, maxScroll: ms });

      if (selected) drawDetail(selected);
    });

    // Rarity as right-aligned pips (filled = the monster's rarity up to 5; hollow for
    // the rest), element-tinted. Falls back to "Rn" text for rarity > 5 so it stays
    // accurate. (rx, cy) = right edge / vertical center of the pip row.
    function drawRarityPips(rx, cy, rarity, col) {
      const r = Math.round(rarity || 0);
      const c = k.rgb(col[0], col[1], col[2]);
      if (r > 5 || r < 0) { k.drawText({ text: `R${rarity ?? "?"}`, pos: k.vec2(rx, cy - 6), size: 12, font: "gameFont", anchor: "right", color: c }); return; }
      const n = 5, gap = 11, rad = 3;
      for (let i = 0; i < n; i++) {
        const px2 = rx - (n - 1 - i) * gap;
        if (i < r) k.drawCircle({ pos: k.vec2(px2, cy), radius: rad, color: c });
        else k.drawCircle({ pos: k.vec2(px2, cy), radius: rad, fill: false, outline: { width: 1, color: c }, opacity: 0.5 });
      }
    }

    // Full data panel for one monster — stats at Lv.1→50, its attacks, effects.
    function drawDetail(mt) {
      const PW = Math.min(620, k.width() - 32);
      // The two-column layout (sprite/identity | stats/attacks) needs ~470px. Below that, the
      // right column ran off the panel edge — so on narrow screens stack everything in a SINGLE
      // column on a taller panel.
      const narrow = PW < 470;
      const PH = Math.min(narrow ? 700 : 460, k.height() - 24);
      const px = (k.width() - PW) / 2, py = (k.height() - PH) / 2;
      const col = elc(mt.element);
      // Modal scrim: pure-black 0.72 — the canonical full-modal dim (was bgAlt 0.45, an outlier
      // like roster's inspect modal was before 4c494f6; see the modal-scrim convention).
      k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: k.rgb(0, 0, 0), opacity: 0.72, fixed: true });
      // Modal panel via the SHARED drawPanel (shadow + sheen + specular rim) — raised-surface
      // parity with the grid cards + panels (was a hand-rolled rect + flat sheen). 3px element border.
      drawPanel(k, { rect: [px, py, PW, PH], radius: 16, fill: THEME.surface, border: col, borderW: 3, fixed: true });

      // Left column: sprite + identity + description.
      const lx = px + 28;
      // Element-tinted glow behind the portrait — matches the grid's hover halo and
      // the lobby/cosmetics treatment, so the monster reads against the dark panel.
      [[60, 0.10], [42, 0.15], [26, 0.20]].forEach(([r, o]) =>
        k.drawCircle({ pos: k.vec2(lx + 90, py + 90), radius: r, color: k.rgb(col[0], col[1], col[2]), opacity: o, fixed: true }));
      try { k.drawSprite({ sprite: slug(mt.typeName), pos: k.vec2(lx + 90, py + 90), anchor: "center", scale: 1.1 }); } catch {}
      const nmSz = Math.max(13, Math.min(20, Math.floor(230 / Math.max(1, mt.typeName.length * 0.56)))); // shrink a long AI name to one line so it can't wrap onto the element row below
      k.drawText({ text: mt.typeName, pos: k.vec2(lx, py + 156), size: nmSz, font: "gameFont", width: 230, color: T("text"), fixed: true });
      const idc = ink(col);
      k.drawText({ text: `${mt.element}     rarity ${mt.rarity ?? "?"}     size ${mt.size ?? "?"}`, pos: k.vec2(lx, py + 188), size: 13, font: "gameFont", color: k.rgb(idc[0], idc[1], idc[2]), fixed: true });
      // Narrow stacks STATS below the description, so a long real description (max ~282 chars)
      // overlapped them. On narrow: cap the description length, and measure its wrapped height so
      // the stats sit just BELOW it (short descriptions stay compact, long ones don't overlap).
      const descW = narrow ? PW - 56 : 240;
      const rawDesc = mt.description || "";
      const descTxt = narrow && rawDesc.length > 210 ? rawDesc.slice(0, 207).replace(/\s+\S*$/, "") + "…" : rawDesc;
      k.drawText({ text: descTxt, pos: k.vec2(lx, py + 214), size: 12, font: "gameFont", width: descW, color: T("textMut"), fixed: true });
      const descLines = descTxt ? Math.ceil(descTxt.length / Math.max(1, descW / 7.0)) : 0; // conservative ~chars/line at size 12
      // Layout anchors (computed once up front). Narrow/portrait stacks desc → stats → attacks →
      // footer in ONE column, each derived from the actual description height; wide uses a fixed
      // top/right column. nFooterTop flows the catch + collection lines BELOW the (≤3) attack rows
      // — bottom-anchoring them to the panel edge collided with a tall stack on long-desc species.
      const STATS = ["health", "strength", "defense", "speed", "power", "energy", "luck"];
      const statsTop = narrow ? py + 214 + Math.max(3, descLines) * 15 + 14 : py + 24;
      const attacksTop = narrow ? statsTop + 24 + STATS.length * 19 + 14 : py + 190;
      const nFooterTop = attacksTop + 22 + 3 * 30 + 14; // below the narrow attack rows (header + ≤3 × 30 + clearance)
      // Capture planning: there is NO rarity gate anymore — capture is AI-judged from the
      // chain's binding power vs how weakened the target is (server/ai.js → aiResolveCatch).
      // So the advice is universal: weaken it first, then throw. Personalize with the player's
      // equipped chain (its catchPower) when there's context, else the generic hint.
      const chains = getSpiritChains();
      if (chains.length) {
        const myChainId = (ch && ch.equippedChainId) || (net.state && net.state.equippedChainId);
        const myChain = myChainId ? chains.find((c) => c.id === myChainId) : null;
        const catchTxt = myChain
          ? `Weaken it, then catch with your ${myChain.name} (${(myChain.catchPower || "spirit chain").toLowerCase()})`
          : "Weaken it first, then catch with any spirit chain";
        k.drawText({ text: catchTxt, pos: k.vec2(lx, narrow ? nFooterTop : py + PH - 94), size: 12, font: "gameFont", width: narrow ? PW - 56 : 240, color: myChain ? T("teal") : T("amber"), fixed: true });
      }
      // Collection status — a detail panel for a *collection* screen should say whether
      // you own the species (it was only shown on the grid card before). Caught → teal
      // check; uncaught → muted hint that nudges toward the capture loop.
      if (hasContext) {
        const owned = isCaught(mt), sy = narrow ? nFooterTop + 26 : py + PH - 52, sc = owned ? T("teal") : T("textMut");
        if (owned) k.drawCircle({ pos: k.vec2(lx + 6, sy + 6), radius: 6, color: sc, fixed: true });
        else k.drawCircle({ pos: k.vec2(lx + 6, sy + 6), radius: 6, fill: false, outline: { width: 1.5, color: sc }, fixed: true });
        const statusTxt = owned ? "In your collection" : isSeen(mt) ? "Seen in the wild — not yet caught" : "Not yet caught — tame one in the wild";
        k.drawText({ text: statusTxt, pos: k.vec2(lx + 20, sy), size: 12, font: "gameFont", width: 220, color: sc, fixed: true });
      }

      // Stats Lv.1 → Lv.50, then attacks. Wide: a right column beside the sprite. Narrow:
      // stacked BELOW the identity/description, full width (the right column won't fit beside).
      const rx = narrow ? lx : px + 300; // narrow stacks in the left column; wide uses a right column
      const valX = px + PW - 28; // stat-value right-anchor (panel right edge); == old wide pos
      const s1 = getMonsterStats(mt, 1), s50 = getMonsterStats(mt, 50);
      k.drawText({ text: "STATS    Lv.1  →  Lv.50", pos: k.vec2(rx, statsTop), size: 13, font: "gameFont", color: T("primary"), fixed: true });
      STATS.forEach((st, i) => {
        const y = statsTop + 24 + i * 19;
        k.drawText({ text: st, pos: k.vec2(rx, y), size: 12, font: "gameFont", color: T("textMut"), fixed: true });
        k.drawText({ text: `${s1[st]}  →  ${s50[st]}`, pos: k.vec2(valX, y), size: 12, font: "gameFont", anchor: "right", color: T("text"), fixed: true });
      });
      const attacks = getAttacksForMonster(mt);
      k.drawText({ text: "ATTACKS", pos: k.vec2(rx, attacksTop), size: 13, font: "gameFont", color: T("primary"), fixed: true });
      attacks.slice(0, narrow ? 3 : 4).forEach((a, i) => {
        const y = attacksTop + 22 + i * 30;
        const ac = ink(elc(a.elementalType));
        k.drawText({ text: cleanAttackName(a.name), pos: k.vec2(rx, y), size: 12, font: "gameFont", color: k.rgb(ac[0], ac[1], ac[2]), fixed: true }); // CN-7
        // Prefer the AI-authored DESCRIPTION — it's what the move actually does (the v2 judge
        // resolves the turn from it, and the generator writes it to "read to the player"), so it's
        // far more informative than the synthetic numeric profile genAttacks carry. Legacy pool
        // attacks with no text fall back to the numbers. Truncated to ONE line that fits the right
        // column at the current panel width (responsive — narrow/portrait screens shrink PW).
        const desc = (a.description || "").trim();
        const colChars = Math.max(10, Math.floor(((narrow ? PW - 64 : PW - 312)) / 5.6)); // ~chars that fit one line (full width when stacked / right column when wide)
        const sub = desc
          ? (desc.length > colChars ? desc.slice(0, colChars - 3).replace(/[\s,;:.]+$/, "") + "..." : desc)
          : `${a.elementalType}     DMG ${a.damage}     EN ${a.energyCost}` + (a.inflictedStatus ? `     ${a.inflictedStatus}` : "");
        k.drawText({ text: sub, pos: k.vec2(rx, y + 14), size: 10, font: "gameFont", color: T("textMut"), fixed: true });
      });

      // (Element matchups removed 2026-06-10 — elements are flavour only, no type-effectiveness.)

      k.drawText({ text: "tap / ESC to close", pos: k.vec2(px + PW / 2, py + PH - 16), size: 12, font: "gameFont", anchor: "center", color: T("textMut"), fixed: true });
    }

    if (typeof k.onScroll === "function") k.onScroll((d) => { if (!selected) { scrollY += d.y; clamp(); } });
    k.onKeyPress("escape", () => { if (selected) selected = null; else goBack(); });
    k.onKeyDown("down", () => { if (!selected) { scrollY += 700 * k.dt(); clamp(); } });
    k.onKeyDown("up", () => { if (!selected) { scrollY -= 700 * k.dt(); clamp(); } });

    const press = (p) => {
      if (selected) return; // release closes the detail panel
      if (inBack(p)) { sfx("click"); goBack(); return; }
      if (inColl(p)) { sfx("click"); cycleColl(); return; } // cycle the collection filter (All/Caught/Seen)
      dragging = true; lastY = p.y; moved = 0;
    };
    const drag = (p) => { if (!dragging) return; const dy = p.y - lastY; scrollY -= dy; moved += Math.abs(dy); lastY = p.y; clamp(); };
    const release = (p) => {
      if (selected) { sfx("click"); selected = null; return; } // tap anywhere closes detail
      if (dragging && moved < 6) { const i = cardAt(p); if (i >= 0) { sfx("click"); selected = shown()[i]; if (selected && isCaught(selected)) { markSpeciesSeen(selected.typeName); seen.add(String(selected.typeName || "").toLowerCase()); } } } // a click, not a drag; viewing a caught species clears its NEW badge (PV-T16) + activation chime (parity with the buttons)
      dragging = false;
    };
    k.onMousePress(() => press(k.mousePos()));
    k.onMouseMove(() => drag(k.mousePos()));
    k.onMouseRelease(() => release(k.mousePos()));
    k.onTouchStart((p) => press(p));
    k.onTouchMove((p) => drag(p));
    k.onTouchEnd((p) => release(p));
  });
}
