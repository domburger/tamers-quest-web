import { getMonsterTypes, getAttacksForMonster } from "../engine/gamedata.js";
import { getMonsterStats } from "../engine/stats.js";
import { THEME } from "../ui/theme.js";

// Bestiary / curation gallery: a scrollable grid of every monster rendered with
// its procedural sprite. Serves art review and P5 generated-content curation —
// non-invasive (doesn't touch gameplay), no API/DB cost.
export default function bestiaryScene(k) {
  k.scene("bestiary", () => {
    const monsters = getMonsterTypes()
      .slice()
      .sort((a, b) => (a.element || "").localeCompare(b.element || "") || a.typeName.localeCompare(b.typeName));
    const slug = (n) => n.toLowerCase().replace(/\s+/g, "_");

    const EL = {
      fire: [240, 110, 70], water: [80, 150, 240], nature: [110, 200, 110], grass: [110, 200, 110],
      earth: [200, 160, 90], ice: [150, 220, 245], air: [150, 210, 230], wind: [150, 210, 230],
      dark: [165, 110, 215], darkness: [140, 110, 190], shadow: [140, 110, 190], light: [245, 225, 120],
      holy: [250, 240, 175], electric: [245, 215, 95], poison: [175, 110, 205], ghost: [185, 205, 225],
      void: [120, 110, 160], arcane: [205, 120, 235], cosmic: [150, 130, 235], celestial: [220, 220, 255],
      metal: [185, 190, 200], lunar: [200, 210, 245],
    };
    const elc = (e) => {
      const key = String(e || "").toLowerCase().split("/")[0].trim();
      return EL[key] || [170, 175, 190];
    };
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

    const cols = () => Math.max(1, Math.floor((k.width() - GAP) / (CARD_W + GAP)));
    const contentH = () => Math.ceil(monsters.length / cols()) * (CARD_H + GAP) + GAP;
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
      return idx >= 0 && idx < monsters.length ? idx : -1;
    };

    const T = (n) => k.rgb(...THEME[n]);
    k.add([k.sprite("menu_background"), k.pos(k.width() / 2, k.height() / 2), k.anchor("center"), k.fixed(), k.z(-10)]);

    k.onDraw(() => {
      const c = cols();
      const gridW = c * CARD_W + (c - 1) * GAP;
      const x0 = (k.width() - gridW) / 2;
      const top = HEADER + GAP - scrollY;
      for (let i = 0; i < monsters.length; i++) {
        const y = top + Math.floor(i / c) * (CARD_H + GAP);
        if (y + CARD_H < HEADER || y > k.height()) continue; // cull off-screen rows
        const mt = monsters[i];
        const x = x0 + (i % c) * (CARD_W + GAP);
        const col = elc(mt.element);
        k.drawRect({ pos: k.vec2(x, y), width: CARD_W, height: CARD_H, radius: 14, color: T("surface"), outline: { width: 2, color: k.rgb(col[0], col[1], col[2]) } });
        try { k.drawSprite({ sprite: slug(mt.typeName), pos: k.vec2(x + CARD_W / 2, y + 60), anchor: "center", scale: 0.72 }); } catch {}
        k.drawText({ text: mt.typeName, pos: k.vec2(x + CARD_W / 2, y + CARD_H - 46), size: 14, font: "gameFont", anchor: "center", width: CARD_W - 14, color: T("text") });
        const lab = ink(col);
        k.drawText({ text: `${mt.element}     R${mt.rarity ?? "?"}`, pos: k.vec2(x + CARD_W / 2, y + CARD_H - 20), size: 12, font: "gameFont", anchor: "center", color: k.rgb(lab[0], lab[1], lab[2]) });
      }

      // Header (drawn over the grid) + back button + scrollbar.
      k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: HEADER, color: T("bg"), fixed: true });
      k.drawRect({ pos: k.vec2(0, HEADER - 1), width: k.width(), height: 1, color: T("line"), fixed: true });
      k.drawText({ text: `BESTIARY     ${monsters.length} MONSTERS`, pos: k.vec2(20, 20), size: 22, font: "gameFont", color: T("text"), fixed: true });
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

    // Full data panel for one monster — stats at Lv.1→50, its attacks, effects.
    function drawDetail(mt) {
      const PW = Math.min(620, k.width() - 32), PH = Math.min(460, k.height() - 32);
      const px = (k.width() - PW) / 2, py = (k.height() - PH) / 2;
      const col = elc(mt.element);
      k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: k.rgb(22, 26, 34), opacity: 0.45, fixed: true });
      k.drawRect({ pos: k.vec2(px, py), width: PW, height: PH, radius: 16, color: T("surface"), outline: { width: 3, color: k.rgb(col[0], col[1], col[2]) }, fixed: true });

      // Left column: sprite + identity + description.
      const lx = px + 28;
      try { k.drawSprite({ sprite: slug(mt.typeName), pos: k.vec2(lx + 90, py + 90), anchor: "center", scale: 1.1 }); } catch {}
      k.drawText({ text: mt.typeName, pos: k.vec2(lx, py + 156), size: 20, font: "gameFont", width: 230, color: T("text"), fixed: true });
      const idc = ink(col);
      k.drawText({ text: `${mt.element}     rarity ${mt.rarity ?? "?"}     size ${mt.size ?? "?"}`, pos: k.vec2(lx, py + 188), size: 13, font: "gameFont", color: k.rgb(idc[0], idc[1], idc[2]), fixed: true });
      k.drawText({ text: mt.description || "", pos: k.vec2(lx, py + 214), size: 12, font: "gameFont", width: 240, color: T("textMut"), fixed: true });

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
        k.drawText({ text: a.name, pos: k.vec2(rx, y), size: 12, font: "gameFont", color: k.rgb(ac[0], ac[1], ac[2]), fixed: true });
        const meta = `${a.elementalType}     DMG ${a.damage}     EN ${a.energyCost}` + (a.inflictedStatus ? `     ${a.inflictedStatus}` : "");
        k.drawText({ text: meta, pos: k.vec2(rx, y + 14), size: 10, font: "gameFont", color: T("textMut"), fixed: true });
      });

      k.drawText({ text: "tap / ESC to close", pos: k.vec2(px + PW / 2, py + PH - 16), size: 12, font: "gameFont", anchor: "center", color: T("textMut"), fixed: true });
    }

    if (typeof k.onScroll === "function") k.onScroll((d) => { if (!selected) { scrollY += d.y; clamp(); } });
    k.onKeyPress("escape", () => { if (selected) selected = null; else k.go("start"); });
    k.onKeyDown("down", () => { if (!selected) { scrollY += 700 * k.dt(); clamp(); } });
    k.onKeyDown("up", () => { if (!selected) { scrollY -= 700 * k.dt(); clamp(); } });

    const press = (p) => {
      if (selected) return; // release closes the detail panel
      if (inBack(p)) { k.go("start"); return; }
      dragging = true; lastY = p.y; moved = 0;
    };
    const drag = (p) => { if (!dragging) return; const dy = p.y - lastY; scrollY -= dy; moved += Math.abs(dy); lastY = p.y; clamp(); };
    const release = (p) => {
      if (selected) { selected = null; return; } // tap anywhere closes detail
      if (dragging && moved < 6) { const i = cardAt(p); if (i >= 0) selected = monsters[i]; } // a click, not a drag
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
