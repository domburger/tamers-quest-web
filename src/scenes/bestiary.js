import { getMonsterTypes } from "../engine/gamedata.js";

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

    const cols = () => Math.max(1, Math.floor((k.width() - GAP) / (CARD_W + GAP)));
    const contentH = () => Math.ceil(monsters.length / cols()) * (CARD_H + GAP) + GAP;
    const maxScroll = () => Math.max(0, contentH() - (k.height() - HEADER));
    const clamp = () => { scrollY = Math.min(maxScroll(), Math.max(0, scrollY)); };
    const backRect = () => [k.width() - 92, 14, 78, 36];
    const inBack = (p) => { const [x, y, w, h] = backRect(); return p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h; };

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
    });

    if (typeof k.onScroll === "function") k.onScroll((d) => { scrollY += d.y; clamp(); });
    k.onKeyPress("escape", () => k.go("start"));
    k.onKeyDown("down", () => { scrollY += 700 * k.dt(); clamp(); });
    k.onKeyDown("up", () => { scrollY -= 700 * k.dt(); clamp(); });

    const press = (p) => { if (inBack(p)) { k.go("start"); return; } dragging = true; lastY = p.y; moved = 0; };
    const drag = (p) => { if (!dragging) return; const dy = p.y - lastY; scrollY -= dy; moved += Math.abs(dy); lastY = p.y; clamp(); };
    k.onMousePress(() => press(k.mousePos()));
    k.onMouseMove(() => drag(k.mousePos()));
    k.onMouseRelease(() => { dragging = false; });
    k.onTouchStart((p) => press(p));
    k.onTouchMove((p) => drag(p));
    k.onTouchEnd(() => { dragging = false; });
  });
}
