import { getMonsterTypes, getAttacksForMonster, cleanAttackName, getSpiritChains } from "../engine/gamedata.js";
import { getMonsterStats } from "../engine/stats.js";
import { THEME, elementColor, addMenuBackground } from "../ui/theme.js";
import { net } from "../netClient.js";
import { getCharacter } from "../storage.js";
import { getDiscovered, getSeenSpecies, markSpeciesSeen } from "../engine/discovered.js"; // PV-T15: species ever caught (survives collection churn); PV-T16: "NEW" badge state
import { newSpeciesCount } from "../engine/collection.js"; // PV-T16: shared NEW-count formula (matches the lobby badge)
import { elementMultiplier } from "../engine/combat.js"; // element matchups (same source as combat — can't drift)

// Bestiary / curation gallery: a scrollable grid of every monster rendered with
// its procedural sprite. Serves art review and P5 generated-content curation —
// non-invasive (doesn't touch gameplay), no API/DB cost.
export default function bestiaryScene(k) {
  // `args.backScene` lets a caller (e.g. the online lobby, LS-14) return here on
  // close instead of the default title — mirrors cosmetics.js's back contract.
  k.scene("bestiary", (args = {}) => {
    const backScene = args.backScene || "start";
    const backArgs = args.backArgs || {};
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
    // PV-T16: a caught species the player hasn't inspected yet wears a "NEW!" badge —
    // a reason to revisit the bestiary after a run. `seen` is read once on entry; opening
    // a detail marks it seen (and updates the live set) so the badge clears on close.
    const seen = getSeenSpecies();
    const isNew = (mt) => isCaught(mt) && !seen.has(String(mt.typeName || "").toLowerCase());
    const newCount = () => newSpeciesCount(monsters, caught, seen); // shared formula (lobby parity)

    // Element filter — a 115-monster gallery is hard to scan, so a cycle button
    // narrows it to one element. `shown()` is the filtered view used everywhere
    // `monsters` was iterated/counted (draw, hit-test, scroll bounds).
    let filterEl = "all";
    const elements = ["all", ...[...new Set(monsters.map((m) => (m.element || "").toLowerCase()).filter(Boolean))].sort()];
    // Collection filter (All / Caught / Uncaught) — with 115 species + a NEW badge,
    // collectors want to see "what's left". Needs player context + horizontal room for
    // a 3rd header button (the narrow stack would collide with the title), so it's gated.
    let filterCol = "all"; // all | caught | uncaught
    const collEnabled = () => hasContext && k.width() >= 760; // 3rd header button needs room past the title
    const shown = () => monsters.filter((m) =>
      (filterEl === "all" || (m.element || "").toLowerCase() === filterEl) &&
      (filterCol === "all" || (filterCol === "caught" ? isCaught(m) : !isCaught(m))));
    const filterRect = () => [k.width() - 92 - 152, 14, 144, 36];
    const inFilter = (p) => { const [x, y, w, h] = filterRect(); return p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h; };
    const cycleFilter = () => { filterEl = elements[(elements.indexOf(filterEl) + 1) % elements.length]; scrollY = 0; };
    const COLL = ["all", "caught", "uncaught"];
    const collRect = () => [k.width() - 92 - 152 - 152, 14, 144, 36]; // left of the element filter
    const inColl = (p) => { if (!collEnabled()) return false; const [x, y, w, h] = collRect(); return p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h; };
    const cycleColl = () => { filterCol = COLL[(COLL.indexOf(filterCol) + 1) % COLL.length]; scrollY = 0; };

    const cols = () => Math.max(1, Math.floor((k.width() - GAP) / (CARD_W + GAP)));
    const contentH = () => Math.ceil(shown().length / cols()) * (CARD_H + GAP) + GAP;
    const maxScroll = () => Math.max(0, contentH() - (k.height() - HEADER));
    const clamp = () => { scrollY = Math.min(maxScroll(), Math.max(0, scrollY)); };
    const backRect = () => [k.width() - 92, 14, 78, 36];
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
        k.drawRect({ pos: k.vec2(x, y), width: CARD_W, height: CARD_H, radius: 14, color: i === hovIdx ? T("surface2") : T("surface"), outline: { width: i === hovIdx ? 3 : 2, color: k.rgb(col[0], col[1], col[2]) } });
        // Top sheen — addPanel parity (completes the immediate-mode MP sweep).
        k.drawRect({ pos: k.vec2(x + 6, y + 4), width: CARD_W - 12, height: 16, radius: 8, color: T("surface2"), opacity: 0.45 });
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
            k.drawRect({ pos: k.vec2(x, y), width: CARD_W, height: CARD_H, radius: 14, color: T("bg"), opacity: 0.5 });
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
      const total = (filterEl === "all" && filterCol === "all") ? `${monsters.length}` : `${shown().length} / ${monsters.length}`;
      // On very narrow viewports drop the count from the title so it doesn't crash
      // into the filter/back buttons on the right.
      const narrowTitle = k.width() < 560;
      const titleText = narrowTitle ? "BESTIARY" : `BESTIARY     ${total} MONSTERS`;
      k.drawText({ text: titleText, pos: k.vec2(20, 20), size: 22, font: "gameFont", color: T("text"), fixed: true });
      // Teal accent rule under the title — mirrors addHeader's signature in retained-mode
      // scenes so this draw-mode page reads as part of the same polished family.
      k.drawRect({ pos: k.vec2(20, 46), width: 150, height: 6, radius: 3, color: T("teal"), opacity: 0.16, fixed: true });
      k.drawRect({ pos: k.vec2(25, 48), width: 140, height: 2, radius: 1, color: T("teal"), opacity: 0.9, fixed: true });
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
      // Element filter cycle button (teal when active).
      const [fx, fy, fw, fh] = filterRect();
      const active = filterEl !== "all";
      const flabel = active ? filterEl[0].toUpperCase() + filterEl.slice(1) : "All elements";
      k.drawRect({ pos: k.vec2(fx, fy), width: fw, height: fh, radius: 10, color: T("surface"), outline: { width: 2, color: active ? T("teal") : T("line") }, fixed: true });
      k.drawText({ text: flabel, pos: k.vec2(fx + fw / 2, fy + fh / 2), size: 13, font: "gameFont", anchor: "center", color: active ? T("teal") : T("textMut"), fixed: true });
      // Collection filter cycle button (only when there's player context + room).
      if (collEnabled()) {
        const [qx, qy, qw, qh] = collRect();
        const cActive = filterCol !== "all";
        const clabel = filterCol === "caught" ? "Caught" : filterCol === "uncaught" ? "Uncaught" : "All species";
        k.drawRect({ pos: k.vec2(qx, qy), width: qw, height: qh, radius: 10, color: T("surface"), outline: { width: 2, color: cActive ? T("teal") : T("line") }, fixed: true });
        k.drawText({ text: clabel, pos: k.vec2(qx + qw / 2, qy + qh / 2), size: 13, font: "gameFont", anchor: "center", color: cActive ? T("teal") : T("textMut"), fixed: true });
      }
      const [bx, by, bw, bh] = backRect();
      k.drawRect({ pos: k.vec2(bx, by), width: bw, height: bh, radius: 10, color: T("surface"), outline: { width: 2, color: T("line") }, fixed: true });
      k.drawText({ text: "Back", pos: k.vec2(bx + bw / 2, by + bh / 2), size: 16, font: "gameFont", anchor: "center", color: T("text"), fixed: true });

      const ms = maxScroll();
      if (ms > 0) {
        const trackH = k.height() - HEADER;
        const thumbH = Math.max(30, (trackH * trackH) / contentH());
        const thumbY = HEADER + (scrollY / ms) * (trackH - thumbH);
        k.drawRect({ pos: k.vec2(k.width() - 7, thumbY), width: 5, height: thumbH, radius: 3, color: T("textMut"), fixed: true });
      }

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
      const PW = Math.min(620, k.width() - 32), PH = Math.min(460, k.height() - 32);
      const px = (k.width() - PW) / 2, py = (k.height() - PH) / 2;
      const col = elc(mt.element);
      k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: T("bgAlt"), opacity: 0.45, fixed: true });
      k.drawRect({ pos: k.vec2(px, py), width: PW, height: PH, radius: 16, color: T("surface"), outline: { width: 3, color: k.rgb(col[0], col[1], col[2]) }, fixed: true });
      // Top sheen on the detail modal — biggest framed surface in the scene.
      k.drawRect({ pos: k.vec2(px + 8, py + 6), width: PW - 16, height: 22, radius: 11, color: T("surface2"), opacity: 0.5, fixed: true });

      // Left column: sprite + identity + description.
      const lx = px + 28;
      // Element-tinted glow behind the portrait — matches the grid's hover halo and
      // the lobby/cosmetics treatment, so the monster reads against the dark panel.
      [[60, 0.10], [42, 0.15], [26, 0.20]].forEach(([r, o]) =>
        k.drawCircle({ pos: k.vec2(lx + 90, py + 90), radius: r, color: k.rgb(col[0], col[1], col[2]), opacity: o, fixed: true }));
      try { k.drawSprite({ sprite: slug(mt.typeName), pos: k.vec2(lx + 90, py + 90), anchor: "center", scale: 1.1 }); } catch {}
      k.drawText({ text: mt.typeName, pos: k.vec2(lx, py + 156), size: 20, font: "gameFont", width: 230, color: T("text"), fixed: true });
      const idc = ink(col);
      k.drawText({ text: `${mt.element}     rarity ${mt.rarity ?? "?"}     size ${mt.size ?? "?"}`, pos: k.vec2(lx, py + 188), size: 13, font: "gameFont", color: k.rgb(idc[0], idc[1], idc[2]), fixed: true });
      k.drawText({ text: mt.description || "", pos: k.vec2(lx, py + 214), size: 12, font: "gameFont", width: 240, color: T("textMut"), fixed: true });
      // Capture planning: the lowest-tier standard chain that can catch this rarity
      // (chains auto-fail above their maxRarity — engine/spiritchains.js). Specials are
      // excluded (situational, not the baseline answer). When there's player context the
      // line is PERSONALIZED — whether YOUR equipped chain works — else it's the generic
      // requirement. Tells the player exactly what to bring (pairs with the lobby line).
      const stdChains = getSpiritChains().filter((c) => !c.special).sort((a, b) => a.tier - b.tier);
      const needChain = stdChains.find((c) => (c.maxRarity ?? Infinity) >= (mt.rarity || 1));
      if (stdChains.length) {
        const myChainId = (ch && ch.equippedChainId) || (net.state && net.state.equippedChainId);
        const myChain = myChainId ? getSpiritChains().find((c) => c.id === myChainId) : null;
        let catchTxt, catchCol;
        if (myChain) {
          const ok = myChain.special === "guaranteed" || (mt.rarity || 1) <= (myChain.maxRarity ?? Infinity);
          catchTxt = ok ? `Your ${myChain.name} can catch it`
            : `Your ${myChain.name} is too weak${needChain ? ` — need ${needChain.name}+` : ""}`;
          catchCol = ok ? T("teal") : T("amber");
        } else {
          catchTxt = !needChain ? "Catch: needs a special chain"
            : needChain.tier <= stdChains[0].tier ? "Catch with any spirit chain"
            : `Catch with ${needChain.name} or better`;
          catchCol = T("amber");
        }
        k.drawText({ text: catchTxt, pos: k.vec2(lx, py + PH - 76), size: 12, font: "gameFont", width: 240, color: catchCol, fixed: true });
      }
      // Collection status — a detail panel for a *collection* screen should say whether
      // you own the species (it was only shown on the grid card before). Caught → teal
      // check; uncaught → muted hint that nudges toward the capture loop.
      if (hasContext) {
        const owned = isCaught(mt), sy = py + PH - 52, sc = owned ? T("teal") : T("textMut");
        if (owned) k.drawCircle({ pos: k.vec2(lx + 6, sy + 6), radius: 6, color: sc, fixed: true });
        else k.drawCircle({ pos: k.vec2(lx + 6, sy + 6), radius: 6, fill: false, outline: { width: 1.5, color: sc }, fixed: true });
        k.drawText({ text: owned ? "In your collection" : "Not yet caught — tame one in the wild", pos: k.vec2(lx + 20, sy), size: 12, font: "gameFont", width: 220, color: sc, fixed: true });
      }

      // Right column: stats Lv.1 → Lv.50, then attacks.
      const rx = px + 300;
      const s1 = getMonsterStats(mt, 1), s50 = getMonsterStats(mt, 50);
      k.drawText({ text: "STATS    Lv.1  →  Lv.50", pos: k.vec2(rx, py + 24), size: 13, font: "gameFont", color: T("primary"), fixed: true });
      const STATS = ["health", "strength", "defense", "speed", "power", "energy", "luck"];
      STATS.forEach((st, i) => {
        const y = py + 48 + i * 19;
        k.drawText({ text: st, pos: k.vec2(rx, y), size: 12, font: "gameFont", color: T("textMut"), fixed: true });
        k.drawText({ text: `${s1[st]}  →  ${s50[st]}`, pos: k.vec2(rx + PW - 300 - 28, y), size: 12, font: "gameFont", anchor: "right", color: T("text"), fixed: true });
      });
      const attacks = getAttacksForMonster(mt);
      k.drawText({ text: "ATTACKS", pos: k.vec2(rx, py + 190), size: 13, font: "gameFont", color: T("primary"), fixed: true });
      attacks.slice(0, 4).forEach((a, i) => {
        const y = py + 212 + i * 30;
        const ac = ink(elc(a.elementalType));
        k.drawText({ text: cleanAttackName(a.name), pos: k.vec2(rx, y), size: 12, font: "gameFont", color: k.rgb(ac[0], ac[1], ac[2]), fixed: true }); // CN-7
        const meta = `${a.elementalType}     DMG ${a.damage}     EN ${a.energyCost}` + (a.inflictedStatus ? `     ${a.inflictedStatus}` : "");
        k.drawText({ text: meta, pos: k.vec2(rx, y + 14), size: 10, font: "gameFont", color: T("textMut"), fixed: true });
      });

      // Element matchups — derived from the SAME elementMultiplier the combat engine
      // uses (so the bestiary can't drift from real fights). Only the Fire/Nature/Water
      // triangle + Dark↔Light have non-neutral matchups; for any other element both
      // lists are empty and the section is omitted (never shows misleading info).
      const CORE = ["Fire", "Water", "Nature", "Dark", "Light"];
      const cap = (s) => { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); };
      const myEl = cap(mt.element);
      const strongVs = CORE.filter((e) => e !== myEl && elementMultiplier(myEl, e) > 1); // your hits land harder
      const weakVs = CORE.filter((e) => e !== myEl && elementMultiplier(e, myEl) > 1);    // you take extra damage
      const mY = py + 344;
      if ((strongVs.length || weakVs.length) && mY < py + PH - 26) {
        k.drawText({ text: "MATCHUPS", pos: k.vec2(rx, mY), size: 13, font: "gameFont", color: T("primary"), fixed: true });
        if (strongVs.length) k.drawText({ text: `Strong vs  ${strongVs.join(", ")}`, pos: k.vec2(rx, mY + 20), size: 11, font: "gameFont", color: T("success"), fixed: true });
        if (weakVs.length) k.drawText({ text: `Weak vs  ${weakVs.join(", ")}`, pos: k.vec2(rx, mY + (strongVs.length ? 36 : 20)), size: 11, font: "gameFont", color: T("danger"), fixed: true });
      }

      k.drawText({ text: "tap / ESC to close", pos: k.vec2(px + PW / 2, py + PH - 16), size: 12, font: "gameFont", anchor: "center", color: T("textMut"), fixed: true });
    }

    if (typeof k.onScroll === "function") k.onScroll((d) => { if (!selected) { scrollY += d.y; clamp(); } });
    k.onKeyPress("escape", () => { if (selected) selected = null; else k.go(backScene, backArgs); });
    k.onKeyDown("down", () => { if (!selected) { scrollY += 700 * k.dt(); clamp(); } });
    k.onKeyDown("up", () => { if (!selected) { scrollY -= 700 * k.dt(); clamp(); } });

    const press = (p) => {
      if (selected) return; // release closes the detail panel
      if (inBack(p)) { k.go(backScene, backArgs); return; }
      if (inFilter(p)) { cycleFilter(); return; } // cycle the element filter
      if (inColl(p)) { cycleColl(); return; } // cycle the collection filter (All/Caught/Uncaught)
      dragging = true; lastY = p.y; moved = 0;
    };
    const drag = (p) => { if (!dragging) return; const dy = p.y - lastY; scrollY -= dy; moved += Math.abs(dy); lastY = p.y; clamp(); };
    const release = (p) => {
      if (selected) { selected = null; return; } // tap anywhere closes detail
      if (dragging && moved < 6) { const i = cardAt(p); if (i >= 0) { selected = shown()[i]; if (selected && isCaught(selected)) { markSpeciesSeen(selected.typeName); seen.add(String(selected.typeName || "").toLowerCase()); } } } // a click, not a drag; viewing a caught species clears its NEW badge (PV-T16)
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
