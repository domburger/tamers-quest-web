import { getMonsterTypes, getSpiritChains } from "../engine/gamedata.js";
import { THEME, accentColor, addMenuBackground, drawButton, drawPanel, drawHeader, drawScrollbar, inRect } from "../ui/theme.js";
import { safeInsetsDesign } from "../systems/safearea.js";
import { sfx } from "../systems/audio.js";
import { net } from "../netClient.js";
import { getCharacter } from "../storage.js";
import { getDiscovered, getSeenSpecies, markSpeciesSeen, getEncountered } from "../engine/discovered.js";
import { newSpeciesCount } from "../engine/collection.js";
import { drawMonsterDetail } from "../ui/monsterDetail.js";
import { drawMonsterIcon } from "../render/monster.js";

export default function bestiaryScene(k) {
  k.scene("bestiary", (args = {}) => {
    const backScene = args.backScene || "start";
    const backArgs = args.backArgs || {};
    const adminMode = !!args.admin;
    const goBack = () => {
      if (adminMode) { try { window.location.href = "/admin.html"; return; } catch {} }
      k.go(backScene, backArgs);
    };
    const monsters = getMonsterTypes()
      .slice()
      .sort((a, b) => a.typeName.localeCompare(b.typeName));
    const slug = (n) => n.toLowerCase().replace(/\s+/g, "_");

    const elc = accentColor;

    const HEADER = 64;
    const CARD_W = 210, CARD_H = 168, GAP = 16;
    let scrollY = 0;
    let dragging = false, lastY = 0, moved = 0;
    let selected = null;

    const caught = new Set();
    let hasContext = false;
    const ch = args.characterId ? getCharacter(args.characterId) : null;
    const collect = (list) => { for (const m of list || []) caught.add(String(m.typeName || "").toLowerCase()); };
    if (ch) { hasContext = true; collect(ch.activeMonsters); collect(ch.vaultMonsters); }
    else if (net.state && net.state.connected) { hasContext = true; collect(net.state.team); collect(net.state.vault); }
    const everCaught = getDiscovered();
    if (everCaught.size) { hasContext = true; for (const t of everCaught) caught.add(t); }
    const isCaught = (mt) => caught.has(String(mt.typeName || "").toLowerCase());
    const caughtN = monsters.filter(isCaught).length;
    const encountered = getEncountered();
    if (encountered.size) hasContext = true;
    if (adminMode) hasContext = false;
    const isSeen = (mt) => !isCaught(mt) && encountered.has(String(mt.typeName || "").toLowerCase());
    const seen = getSeenSpecies();
    const isNew = (mt) => isCaught(mt) && !seen.has(String(mt.typeName || "").toLowerCase());
    let _ncSeen = -1, _ncVal = 0;
    const newCount = () => { if (seen.size !== _ncSeen) { _ncVal = newSpeciesCount(monsters, caught, seen); _ncSeen = seen.size; } return _ncVal; };

    const norm = (s) => String(s || "").toLowerCase();
    const everSeen = (m) => isCaught(m) || encountered.has(norm(m.typeName));
    const universeList = adminMode ? monsters : monsters.filter(everSeen);
    const universe = () => universeList;
    let filterCol = "all";
    const collEnabled = () => hasContext && !adminMode && k.width() >= 560 && universe().length > 0;
    const colMatch = (m) => !collEnabled() || filterCol === "all" || (filterCol === "caught" ? isCaught(m) : isSeen(m));
    let _shown = null, _shownFilter, _shownColl;
    const shown = () => {
      const ce = collEnabled();
      if (_shown && filterCol === _shownFilter && ce === _shownColl) return _shown;
      _shown = universe().filter(colMatch);
      _shownFilter = filterCol; _shownColl = ce;
      return _shown;
    };
    const ins = safeInsetsDesign(k);
    const COLL = ["all", "caught", "seen"];
    const collRect = () => [k.width() - 92 - 152 - ins.right, 14 + ins.top, 144, 36];
    const inColl = (p) => { if (!collEnabled()) return false; const [x, y, w, h] = collRect(); return p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h; };
    const cycleColl = () => { filterCol = COLL[(COLL.indexOf(filterCol) + 1) % COLL.length]; scrollY = 0; };

    const cols = () => Math.max(1, Math.floor((k.width() - GAP) / (CARD_W + GAP)));
    const contentH = () => Math.ceil(shown().length / cols()) * (CARD_H + GAP) + GAP;
    const maxScroll = () => Math.max(0, contentH() - (k.height() - HEADER));
    const clamp = () => { scrollY = Math.min(maxScroll(), Math.max(0, scrollY)); };
    const backRect = () => [k.width() - 92 - ins.right, 14 + ins.top, 78, 36];
    const inBack = (p) => { const [x, y, w, h] = backRect(); return p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h; };

    const cardAt = (p) => {
      if (p.y < HEADER) return -1;
      const c = cols();
      const gridW = c * CARD_W + (c - 1) * GAP;
      const x0 = (k.width() - gridW) / 2;
      const relX = p.x - x0, relY = p.y - (HEADER + GAP - scrollY);
      if (relX < 0 || relY < 0) return -1;
      const col = Math.floor(relX / (CARD_W + GAP)), row = Math.floor(relY / (CARD_H + GAP));
      if (col < 0 || col >= c) return -1;
      if (relX - col * (CARD_W + GAP) > CARD_W || relY - row * (CARD_H + GAP) > CARD_H) return -1;
      const idx = row * c + col;
      return idx >= 0 && idx < shown().length ? idx : -1;
    };

    const T = (n) => k.rgb(...THEME[n]);
    addMenuBackground(k, { fixed: true, z: -10 });

    k.onDraw(() => {
      const c = cols();
      const gridW = c * CARD_W + (c - 1) * GAP;
      const x0 = (k.width() - gridW) / 2;
      const top = HEADER + GAP - scrollY;
      const hovIdx = selected ? -1 : cardAt(k.mousePos());
      const view = shown();
      const ROW = CARD_H + GAP;
      const startI = Math.max(0, Math.floor((HEADER - CARD_H - top) / ROW)) * c;
      const endI = Math.min(view.length, (Math.floor((k.height() - top) / ROW) + 1) * c);
      for (let i = startI; i < endI; i++) {
        const y = top + Math.floor(i / c) * (CARD_H + GAP);
        if (y + CARD_H < HEADER || y > k.height()) continue;
        const mt = view[i];
        const x = x0 + (i % c) * (CARD_W + GAP);
        const col = elc();
        if (i === hovIdx) {
          k.drawRect({ pos: k.vec2(x - 4, y - 4), width: CARD_W + 8, height: CARD_H + 8, radius: 18, color: k.rgb(col[0], col[1], col[2]), opacity: 0.22 });
        }
        drawPanel(k, { rect: [x, y, CARD_W, CARD_H], radius: 14,
          fill: i === hovIdx ? THEME.surface2 : THEME.surface, border: col, borderW: i === hovIdx ? 3 : 2 });
        drawMonsterIcon(k, { sprite: slug(mt.typeName), typeName: mt.typeName, cx: x + CARD_W / 2, cy: y + 60, scale: 0.72, topY: y + 2 });
        k.drawRect({ pos: k.vec2(x + 8, y + CARD_H - 52), width: CARD_W - 16, height: 46, radius: 8, color: k.rgb(...THEME.bg), opacity: 0.55 });
        k.drawText({ text: mt.typeName, pos: k.vec2(x + CARD_W / 2, y + CARD_H - 40), size: 14, font: "gameFont", anchor: "center", width: CARD_W - 14, color: T("text") });
        drawRarityPips(x + CARD_W / 2 + 22, y + CARD_H - 18, mt.rarity, col);
        if (hasContext) {
          if (isCaught(mt)) {
            k.drawCircle({ pos: k.vec2(x + 15, y + 15), radius: 6, color: k.rgb(col[0], col[1], col[2]) });
            k.drawCircle({ pos: k.vec2(x + 15, y + 15), radius: 6, fill: false, outline: { width: 1.5, color: T("bg") } });
          } else {
            const seen = isSeen(mt);
            k.drawRect({ pos: k.vec2(x, y), width: CARD_W, height: CARD_H, radius: 14, color: T("bg"), opacity: seen ? 0.34 : 0.5 });
            if (seen) k.drawCircle({ pos: k.vec2(x + 15, y + 15), radius: 6, fill: false, outline: { width: 1.5, color: T("textMut") } });
          }
          if (isNew(mt)) {
            const bw = 42, bh = 18, bxr = x + CARD_W - bw - 8, byr = y + 8;
            k.drawRect({ pos: k.vec2(bxr, byr), width: bw, height: bh, radius: 9, color: T("amber"), outline: { width: 1.5, color: T("bg") } });
            k.drawText({ text: "New!", pos: k.vec2(bxr + bw / 2, byr + bh / 2), size: 11, font: "gameFont", anchor: "center", color: T("bg") });
          }
        }
      }

      k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: HEADER, color: T("bg"), fixed: true });
      k.drawRect({ pos: k.vec2(0, HEADER - 1), width: k.width(), height: 1, color: T("line"), fixed: true });
      const baseN = universe().length;
      const total = filterCol === "all" ? `${baseN}` : `${shown().length} / ${baseN}`;
      const narrowTitle = k.width() < 560;
      const titleText = narrowTitle ? "Bestiary" : `Bestiary     ${total} monsters`;
      const hmp = k.mousePos();
      drawHeader(k, { title: titleText, ruleW: 150, size: narrowTitle ? 20 : 25 });
      if (k.width() >= 840) {
        const nc = hasContext ? newCount() : 0;
        const pct = monsters.length ? Math.round((caughtN / monsters.length) * 100) : 0;
        const hint = hasContext ? `Caught ${caughtN} / ${monsters.length}  (${pct}%)${nc ? `   ${nc} NEW` : ""}       tap a monster for full stats` : "tap a monster for full stats";
        k.drawText({ text: hint, pos: k.vec2(k.width() / 2, 26), size: 12, font: "gameFont", anchor: "center", color: T("textMut"), fixed: true });
      }
      if (collEnabled()) {
        const cr = collRect();
        const cActive = filterCol !== "all";
        const clabel = filterCol === "caught" ? "Caught" : filterCol === "seen" ? "Seen (uncaught)" : "All species";
        drawButton(k, { rect: cr, text: clabel, size: 13, fill: THEME.surface, textColor: cActive ? THEME.teal : THEME.textMut, outline: cActive ? THEME.teal : THEME.line, hover: inRect(hmp, cr), fixed: true });
      }
      const br = backRect();
      drawButton(k, { rect: br, text: "Back", size: 16, fill: THEME.surfaceAlt, textColor: THEME.text, outline: THEME.line, hover: inRect(hmp, br), fixed: true });

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

    function drawDetail(mt) {
      drawMonsterDetail(k, mt, {
        scrim: true,
        footerHeight: 74,
        footer: (_k, { px, py, PW, PH, lx, footerTop }) => {
          const chains = getSpiritChains();
          if (chains.length) {
            const myChainId = (ch && ch.equippedChainId) || (net.state && net.state.equippedChainId);
            const myChain = myChainId ? chains.find((c) => c.id === myChainId) : null;
            const catchTxt = myChain
              ? `Weaken it, then catch with your ${myChain.name} (${(myChain.catchPower || "spirit chain").toLowerCase()})`
              : "Weaken it first, then catch with any spirit chain";
            k.drawText({ text: catchTxt, pos: k.vec2(lx, footerTop), size: 12, font: "gameFont", width: PW - 56, color: myChain ? T("teal") : T("amber"), fixed: true });
          }
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
      if (selected) return;
      if (inBack(p)) { sfx("click"); goBack(); return; }
      if (inColl(p)) { sfx("click"); cycleColl(); return; }
      dragging = true; lastY = p.y; moved = 0;
    };
    const drag = (p) => { if (!dragging) return; const dy = p.y - lastY; scrollY -= dy; moved += Math.abs(dy); lastY = p.y; clamp(); };
    const release = (p) => {
      if (selected) { sfx("click"); selected = null; return; }
      if (dragging && moved < 6) { const i = cardAt(p); if (i >= 0) { sfx("click"); selected = shown()[i]; if (selected && isCaught(selected)) { markSpeciesSeen(selected.typeName); seen.add(String(selected.typeName || "").toLowerCase()); } } }
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
