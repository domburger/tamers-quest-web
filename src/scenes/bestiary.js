import { getMonsterTypes, getAttacksForMonster } from "../engine/gamedata.js";
import { getMonsterStats } from "../engine/stats.js";

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

    k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(14, 14, 22), k.fixed(), k.z(-10)]);

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
        k.drawRect({ pos: k.vec2(x, y), width: CARD_W, height: CARD_H, radius: 10, color: k.rgb(26, 26, 40), outline: { width: 2, color: k.rgb(col[0], col[1], col[2]) } });
        try { k.drawSprite({ sprite: slug(mt.typeName), pos: k.vec2(x + CARD_W / 2, y + 60), anchor: "center", scale: 0.72 }); } catch {}
        k.drawText({ text: mt.typeName, pos: k.vec2(x + CARD_W / 2, y + CARD_H - 46), size: 14, font: "gameFont", anchor: "center", width: CARD_W - 14, color: k.rgb(255, 255, 255) });
        k.drawText({ text: `${mt.element}  ·  R${mt.rarity ?? "?"}`, pos: k.vec2(x + CARD_W / 2, y + CARD_H - 20), size: 12, font: "gameFont", anchor: "center", color: k.rgb(col[0], col[1], col[2]) });
      }

      // Header (drawn over the grid) + back button + scrollbar.
      k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: HEADER, color: k.rgb(14, 14, 22), fixed: true });
      k.drawRect({ pos: k.vec2(0, HEADER - 1), width: k.width(), height: 1, color: k.rgb(46, 46, 70), fixed: true });
      k.drawText({ text: `BESTIARY — ${monsters.length} monsters`, pos: k.vec2(20, 20), size: 22, font: "gameFont", color: k.rgb(245, 215, 120), fixed: true });
      const [bx, by, bw, bh] = backRect();
      k.drawRect({ pos: k.vec2(bx, by), width: bw, height: bh, radius: 7, color: k.rgb(50, 55, 80), outline: { width: 2, color: k.rgb(120, 150, 200) }, fixed: true });
      k.drawText({ text: "Back", pos: k.vec2(bx + bw / 2, by + bh / 2), size: 16, font: "gameFont", anchor: "center", color: k.rgb(235, 240, 255), fixed: true });

      const ms = maxScroll();
      if (ms > 0) {
        const trackH = k.height() - HEADER;
        const thumbH = Math.max(30, (trackH * trackH) / contentH());
        const thumbY = HEADER + (scrollY / ms) * (trackH - thumbH);
        k.drawRect({ pos: k.vec2(k.width() - 7, thumbY), width: 5, height: thumbH, radius: 3, color: k.rgb(110, 120, 150), fixed: true });
      }

      if (selected) drawDetail(selected);
    });

    // Full data panel for one monster — stats at Lv.1→50, its attacks, effects.
    function drawDetail(mt) {
      const PW = Math.min(620, k.width() - 32), PH = Math.min(460, k.height() - 32);
      const px = (k.width() - PW) / 2, py = (k.height() - PH) / 2;
      const col = elc(mt.element);
      k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: k.rgb(0, 0, 0), opacity: 0.82, fixed: true });
      k.drawRect({ pos: k.vec2(px, py), width: PW, height: PH, radius: 12, color: k.rgb(22, 22, 34), outline: { width: 2, color: k.rgb(col[0], col[1], col[2]) }, fixed: true });

      // Left column: sprite + identity + description.
      const lx = px + 28;
      try { k.drawSprite({ sprite: slug(mt.typeName), pos: k.vec2(lx + 90, py + 90), anchor: "center", scale: 1.1 }); } catch {}
      k.drawText({ text: mt.typeName, pos: k.vec2(lx, py + 156), size: 20, font: "gameFont", width: 230, color: k.rgb(255, 255, 255), fixed: true });
      k.drawText({ text: `${mt.element}  ·  rarity ${mt.rarity ?? "?"}  ·  size ${mt.size ?? "?"}`, pos: k.vec2(lx, py + 188), size: 13, font: "gameFont", color: k.rgb(col[0], col[1], col[2]), fixed: true });
      k.drawText({ text: mt.description || "", pos: k.vec2(lx, py + 214), size: 12, font: "gameFont", width: 240, color: k.rgb(190, 195, 215), fixed: true });

      // Right column: stats Lv.1 → Lv.50, then attacks.
      const rx = px + 300;
      const s1 = getMonsterStats(mt, 1), s50 = getMonsterStats(mt, 50);
      k.drawText({ text: "STATS    Lv.1  →  Lv.50", pos: k.vec2(rx, py + 24), size: 13, font: "gameFont", color: k.rgb(245, 215, 120), fixed: true });
      const STATS = ["health", "strength", "defense", "speed", "power", "energy", "luck"];
      STATS.forEach((st, i) => {
        const y = py + 48 + i * 19;
        k.drawText({ text: st, pos: k.vec2(rx, y), size: 12, font: "gameFont", color: k.rgb(200, 205, 225), fixed: true });
        k.drawText({ text: `${s1[st]}  →  ${s50[st]}`, pos: k.vec2(rx + PW - 300 - 28, y), size: 12, font: "gameFont", anchor: "right", color: k.rgb(255, 255, 255), fixed: true });
      });
      const attacks = getAttacksForMonster(mt);
      k.drawText({ text: "ATTACKS", pos: k.vec2(rx, py + 190), size: 13, font: "gameFont", color: k.rgb(245, 215, 120), fixed: true });
      attacks.slice(0, 4).forEach((a, i) => {
        const y = py + 212 + i * 30;
        const ac = elc(a.elementalType);
        k.drawText({ text: a.name, pos: k.vec2(rx, y), size: 12, font: "gameFont", color: k.rgb(ac[0], ac[1], ac[2]), fixed: true });
        const meta = `${a.elementalType} · DMG ${a.damage} · EN ${a.energyCost}` + (a.inflictedStatus ? ` · ${a.inflictedStatus}` : "");
        k.drawText({ text: meta, pos: k.vec2(rx, y + 14), size: 10, font: "gameFont", color: k.rgb(170, 175, 195), fixed: true });
      });

      k.drawText({ text: "tap / ESC to close", pos: k.vec2(px + PW / 2, py + PH - 16), size: 12, font: "gameFont", anchor: "center", color: k.rgb(160, 165, 185), fixed: true });
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
