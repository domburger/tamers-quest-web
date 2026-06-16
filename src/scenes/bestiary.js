import { getMonsterTypes, getAttacksForMonster, cleanAttackName, getSpiritChains } from "../engine/gamedata.js";
import { getMonsterStats } from "../engine/stats.js";
import { THEME, accentColor, addMenuBackground, drawButton, drawPanel, drawHeader, drawScrollbar, inRect } from "../ui/theme.js";
import { safeInsetsDesign } from "../systems/safearea.js"; // MOB: header cluster off the notch
import { sfx } from "../systems/audio.js"; // click feedback on Back / collection-filter taps (immediate-mode, not addButton)
import { net } from "../netClient.js";
import { getCharacter } from "../storage.js";
import { getDiscovered, getSeenSpecies, markSpeciesSeen, getEncountered } from "../engine/discovered.js"; // PV-T15: species ever caught (survives collection churn); PV-T16: "NEW" badge state; encountered = "seen in the wild"
import { newSpeciesCount } from "../engine/collection.js"; // PV-T16: shared NEW-count formula (matches the lobby badge)
import { drawMonsterDetail } from "../ui/monsterDetail.js"; // TQ-128: the SHARED monster-detail popup (replaces this scene's hand-rolled copy)
import { drawMonsterIcon } from "../render/monster.js"; // TQ-351: fit tall sprites to the gallery card

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
      .sort((a, b) => a.typeName.localeCompare(b.typeName));
    const slug = (n) => n.toLowerCase().replace(/\s+/g, "_");

    // Shared neutral card accent (theme.accentColor — one source of truth).
    const elc = accentColor;

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
    const caughtN = monsters.filter(isCaught).length; // `caught` is an entry snapshot → this is constant for the scene; was re-filtered ~2x/frame in the header hint
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
    // newCount (caught-but-not-yet-inspected) was a 115-type scan per frame in the header.
    // It changes only when `seen` grows (opening a detail marks a species seen) — so recompute
    // only when seen.size changes. (Same shared formula as the lobby badge.)
    let _ncSeen = -1, _ncVal = 0;
    const newCount = () => { if (seen.size !== _ncSeen) { _ncVal = newSpeciesCount(monsters, caught, seen); _ncSeen = seen.size; } return _ncVal; };

    // Visibility — the player only sees species they've ENCOUNTERED (caught, or met in
    // the wild). `universe()` is that personal record; admin mode shows the full pool.
    // (The element filter was removed 2026-06-10 — there's no fixed element set to filter
    // by; elements are free-form flavour.)
    const norm = (s) => String(s || "").toLowerCase();
    const everSeen = (m) => isCaught(m) || encountered.has(norm(m.typeName)); // caught ⇒ also "seen"
    // universe() is CONSTANT for the scene — adminMode and the caught/encountered sets are
    // entry snapshots ("read once on entry"), so the personal-pool filter never changes while
    // browsing. It was being recomputed (a 115-type filter) on every call, multiple times per
    // frame (here, in collEnabled(), and in shown()). Compute it once.
    const universeList = adminMode ? monsters : monsters.filter(everSeen);
    const universe = () => universeList;
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
    // shown() filters the (constant) universe by the collection control. It only changes when
    // the user toggles filterCol or collEnabled() flips (resize crossing the width gate / context),
    // not per frame — so memoize on those two. The cached array is read-only at every call site.
    let _shown = null, _shownFilter, _shownColl;
    const shown = () => {
      const ce = collEnabled();
      if (_shown && filterCol === _shownFilter && ce === _shownColl) return _shown;
      _shown = universe().filter(colMatch);
      _shownFilter = filterCol; _shownColl = ce;
      return _shown;
    };
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
        const col = elc();
        // Hover glow: a soft accent-tinted halo behind the focused card.
        if (i === hovIdx) {
          k.drawRect({ pos: k.vec2(x - 4, y - 4), width: CARD_W + 8, height: CARD_H + 8, radius: 18, color: k.rgb(col[0], col[1], col[2]), opacity: 0.22 });
        }
        // Card background via the SHARED drawPanel (shadow + sheen + specular rim) — raised-surface
        // parity with panels/buttons + the cosmetics cards (was a flat rect + manual sheen, no
        // shadow/rim). Element hairline preserved via borderW (3px on the hovered card, else 2).
        drawPanel(k, { rect: [x, y, CARD_W, CARD_H], radius: 14,
          fill: i === hovIdx ? THEME.surface2 : THEME.surface, border: col, borderW: i === hovIdx ? 3 : 2 });
        drawMonsterIcon(k, { sprite: slug(mt.typeName), typeName: mt.typeName, cx: x + CARD_W / 2, cy: y + 60, scale: 0.72, topY: y + 2 }); // TQ-351 fit tall sprites; TQ-373 typeName → authored html-model raster for generated monsters
        // TQ-352: legibility plate behind the name + element/rarity row (they sit over the monster's
        // lower body — a same-hued monster washed the text out). Mirrors the roster + bestiary-popup plate.
        k.drawRect({ pos: k.vec2(x + 8, y + CARD_H - 52), width: CARD_W - 16, height: 46, radius: 8, color: k.rgb(...THEME.bg), opacity: 0.55 });
        k.drawText({ text: mt.typeName, pos: k.vec2(x + CARD_W / 2, y + CARD_H - 40), size: 14, font: "gameFont", anchor: "center", width: CARD_W - 14, color: T("text") });
        // Rarity as pips (centred) — filled pips scan faster across the gallery than reading "R3" text.
        drawRarityPips(x + CARD_W / 2 + 22, y + CARD_H - 18, mt.rarity, col);
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
            k.drawText({ text: "New!", pos: k.vec2(bxr + bw / 2, byr + bh / 2), size: 11, font: "gameFont", anchor: "center", color: T("bg") });
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
      const titleText = narrowTitle ? "Bestiary" : `Bestiary     ${total} monsters`;
      const hmp = k.mousePos(); // pointer for header button hover glow
      drawHeader(k, { title: titleText, ruleW: 150, size: narrowTitle ? 20 : 25 }); // smaller on narrow so "Bestiary" clears the buttons
      // The centered hint collides with the title on narrow viewports — only show
      // it when there's clear room (title right ~x=300, filter button at width-244,
      // hint half-width ~140 → need >840 to avoid overlap with both ends).
      if (k.width() >= 840) {
        const nc = hasContext ? newCount() : 0;
        // Collection completion % — a collectathon goal metric ("20% complete") that the
        // raw count alone doesn't emphasize. Floors at the total so it can't read 0/0.
        const pct = monsters.length ? Math.round((caughtN / monsters.length) * 100) : 0;
        const hint = hasContext ? `Caught ${caughtN} / ${monsters.length}  (${pct}%)${nc ? `   ${nc} NEW` : ""}       tap a monster for full stats` : "tap a monster for full stats";
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
    // TQ-128: the monster detail is now the SHARED renderer (src/ui/monsterDetail.js) — one popup
    // everywhere. Bestiary's collection-context extras (catch advice + caught/seen status) ride in the
    // component's footer strip (TQ-130 hook); it also GAINS the passive line the renderer shows. The
    // old ~100-line hand-rolled copy (the renderer's own source) is gone.
    function drawDetail(mt) {
      drawMonsterDetail(k, mt, {
        scrim: true,
        footerHeight: 74,
        footer: (_k, { px, py, PW, PH, lx, footerTop }) => {
          // Capture advice — capture is AI-judged (no rarity gate); personalise with the equipped chain.
          const chains = getSpiritChains();
          if (chains.length) {
            const myChainId = (ch && ch.equippedChainId) || (net.state && net.state.equippedChainId);
            const myChain = myChainId ? chains.find((c) => c.id === myChainId) : null;
            const catchTxt = myChain
              ? `Weaken it, then catch with your ${myChain.name} (${(myChain.catchPower || "spirit chain").toLowerCase()})`
              : "Weaken it first, then catch with any spirit chain";
            k.drawText({ text: catchTxt, pos: k.vec2(lx, footerTop), size: 12, font: "gameFont", width: PW - 56, color: myChain ? T("teal") : T("amber"), fixed: true });
          }
          // Collection status — a collection screen should say whether you own the species.
          if (hasContext) {
            const owned = isCaught(mt), sy = footerTop + 22, sc = owned ? T("teal") : T("textMut");
            if (owned) k.drawCircle({ pos: k.vec2(lx + 6, sy + 6), radius: 6, color: sc, fixed: true });
            else k.drawCircle({ pos: k.vec2(lx + 6, sy + 6), radius: 6, fill: false, outline: { width: 1.5, color: sc }, fixed: true });
            const statusTxt = owned ? "In your collection" : isSeen(mt) ? "Seen in the wild — not yet caught" : "Not yet caught — tame one in the wild";
            k.drawText({ text: statusTxt, pos: k.vec2(lx + 20, sy), size: 12, font: "gameFont", width: 220, color: sc, fixed: true });
          }
          k.drawText({ text: "tap / ESC to close", pos: k.vec2(px + PW / 2, py + PH - 12), size: 12, font: "gameFont", anchor: "center", color: T("textMut"), fixed: true });
        },
      });
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
