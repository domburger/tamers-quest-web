import { THEME, FONT } from "../ui/theme.js";
import { CHAIN_SKINS, RARITY_COLOR, drawChainSkin, getEquippedSkinId, setEquippedSkinId } from "../render/chainCosmetics.js";

// Cosmetics store — browse + equip spirit-chain skins (visual only). Drawn in
// onDraw (like the bestiary) so the animated chains layer cleanly over the cards.
export default function cosmeticsScene(k) {
  k.scene("cosmetics", () => {
    const T = (n) => k.rgb(...THEME[n]);
    const HEADER = 64, CARD_W = 230, CARD_H = 210, GAP = 18;
    const cols = () => Math.max(1, Math.min(CHAIN_SKINS.length, Math.floor((k.width() - GAP) / (CARD_W + GAP))));
    const gridX0 = () => (k.width() - (cols() * CARD_W + (cols() - 1) * GAP)) / 2;
    const gridY0 = () => HEADER + 30;
    const cardPos = (i) => { const c = cols(); return [gridX0() + (i % c) * (CARD_W + GAP), gridY0() + Math.floor(i / c) * (CARD_H + GAP)]; };
    const backRect = () => [k.width() - 96, 16, 78, 36];
    const inRect = (p, [x, y, w, h]) => p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;

    k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(...THEME.bg), k.fixed(), k.z(-10)]);

    k.onDraw(() => {
      const equipped = getEquippedSkinId();
      const now = k.time();
      for (let i = 0; i < CHAIN_SKINS.length; i++) {
        const s = CHAIN_SKINS[i];
        const [x, y] = cardPos(i);
        const isEq = s.id === equipped;
        const rc = RARITY_COLOR[s.rarity] || THEME.neutral;
        k.drawRect({ pos: k.vec2(x, y), width: CARD_W, height: CARD_H, radius: 14,
          color: isEq ? T("surface2") : T("surface"), outline: { width: isEq ? 2 : 1, color: isEq ? T("teal") : k.rgb(rc[0], rc[1], rc[2]) } });
        drawChainSkin(k, { x: x + CARD_W / 2, y: y + 84, r: 44, t: now + i, skin: s });
        k.drawText({ text: s.name, pos: k.vec2(x + CARD_W / 2, y + CARD_H - 54), size: 16, font: FONT, anchor: "center", color: T("text") });
        k.drawText({ text: s.rarity, pos: k.vec2(x + CARD_W / 2, y + CARD_H - 32), size: 12, font: FONT, anchor: "center", color: k.rgb(rc[0], rc[1], rc[2]) });
        if (isEq) k.drawText({ text: "EQUIPPED", pos: k.vec2(x + CARD_W / 2, y + 16), size: 11, font: FONT, anchor: "center", color: T("teal") });
      }

      // Header + back.
      k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: HEADER, color: T("bg"), fixed: true });
      k.drawRect({ pos: k.vec2(0, HEADER - 1), width: k.width(), height: 1, color: T("line"), fixed: true });
      k.drawText({ text: "COSMETICS  —  SPIRIT CHAINS", pos: k.vec2(20, 22), size: 22, font: FONT, color: T("text"), fixed: true });
      const [bx, by, bw, bh] = backRect();
      k.drawRect({ pos: k.vec2(bx, by), width: bw, height: bh, radius: 10, color: T("surface"), outline: { width: 1, color: T("line") }, fixed: true });
      k.drawText({ text: "Back", pos: k.vec2(bx + bw / 2, by + bh / 2), size: 16, font: FONT, anchor: "center", color: T("text"), fixed: true });
    });

    const cardAt = (p) => {
      for (let i = 0; i < CHAIN_SKINS.length; i++) {
        const [x, y] = cardPos(i);
        if (p.x >= x && p.x <= x + CARD_W && p.y >= y && p.y <= y + CARD_H) return i;
      }
      return -1;
    };
    const onTap = (p) => {
      if (inRect(p, backRect())) { k.go("start"); return; }
      const i = cardAt(p);
      if (i >= 0) setEquippedSkinId(CHAIN_SKINS[i].id);
    };
    k.onMousePress(() => onTap(k.mousePos()));
    k.onTouchStart((p) => onTap(p));
    k.onKeyPress("escape", () => k.go("start"));
  });
}
