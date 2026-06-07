import { THEME, FONT, addMenuBackground } from "../ui/theme.js";
import { CHAIN_SKINS, RARITY_COLOR, drawChainSkin, getEquippedSkinId, setEquippedSkinId } from "../render/chainCosmetics.js";
import { CHARACTER_SKINS, getEquippedCharacterSkinId, setEquippedCharacterSkinId } from "../render/characterCosmetics.js";
import { drawCharacter } from "../render/character.js";

// Cosmetics store — two tabs: Spirit Chains (chain-ring skins) and Player
// Character (accent + cloak skins). Visual only; equip is per-client. Drawn in
// onDraw so the animated chains / character layer cleanly over the cards.
export default function cosmeticsScene(k) {
  k.scene("cosmetics", (args = {}) => {
    const backScene = args.backScene || "start";
    const backArgs = args.backArgs || {};
    const T = (n) => k.rgb(...THEME[n]);
    const HEADER = 64, CARD_W = 230, CARD_H = 210, GAP = 18;
    const TAB_Y = HEADER + 8, TAB_H = 34;

    let tab = "chains"; // "chains" | "character"
    const list = () => (tab === "chains" ? CHAIN_SKINS : CHARACTER_SKINS);

    const cols = () => Math.max(1, Math.min(list().length, Math.floor((k.width() - GAP) / (CARD_W + GAP))));
    const gridX0 = () => (k.width() - (cols() * CARD_W + (cols() - 1) * GAP)) / 2;
    const gridY0 = () => HEADER + TAB_H + 24;
    const cardPos = (i) => { const c = cols(); return [gridX0() + (i % c) * (CARD_W + GAP), gridY0() + Math.floor(i / c) * (CARD_H + GAP)]; };
    const backRect = () => [k.width() - 96, 16, 78, 36];
    const inRect = (p, [x, y, w, h]) => p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;

    // Tab buttons (left-aligned under the header).
    const TABS = [["chains", "Spirit Chains"], ["character", "Player Character"]];
    const tabRect = (i) => [20 + i * 196, TAB_Y, 186, TAB_H];

    addMenuBackground(k, { fixed: true, z: -10 });

    function drawChainCard(s, x, y, now, i, isEq) {
      const rc = RARITY_COLOR[s.rarity] || THEME.neutral;
      k.drawRect({ pos: k.vec2(x, y), width: CARD_W, height: CARD_H, radius: 14,
        color: isEq ? T("surface2") : T("surface"), outline: { width: isEq ? 2 : 1, color: isEq ? T("teal") : k.rgb(rc[0], rc[1], rc[2]) } });
      drawChainSkin(k, { x: x + CARD_W / 2, y: y + 84, r: 44, t: now + i, skin: s });
      k.drawText({ text: s.name, pos: k.vec2(x + CARD_W / 2, y + CARD_H - 54), size: 16, font: FONT, anchor: "center", color: T("text") });
      k.drawText({ text: s.rarity, pos: k.vec2(x + CARD_W / 2, y + CARD_H - 32), size: 12, font: FONT, anchor: "center", color: k.rgb(rc[0], rc[1], rc[2]) });
      if (isEq) k.drawText({ text: "EQUIPPED", pos: k.vec2(x + CARD_W / 2, y + 16), size: 11, font: FONT, anchor: "center", color: T("teal") });
    }

    function drawCharacterCard(s, x, y, now, i, isEq) {
      const rc = RARITY_COLOR[s.rarity] || THEME.neutral;
      k.drawRect({ pos: k.vec2(x, y), width: CARD_W, height: CARD_H, radius: 14,
        color: isEq ? T("surface2") : T("surface"), outline: { width: isEq ? 2 : 1, color: isEq ? T("teal") : k.rgb(rc[0], rc[1], rc[2]) } });
      // Live character preview (facing the camera so the accent eyes/rim read).
      drawCharacter(k, { x: x + CARD_W / 2, y: y + 118, t: now + i, moving: false, color: s.accent, cloak: s.cloak, dir: { x: 0, y: 1 } });
      k.drawText({ text: s.name, pos: k.vec2(x + CARD_W / 2, y + CARD_H - 54), size: 16, font: FONT, anchor: "center", color: T("text") });
      k.drawText({ text: s.rarity, pos: k.vec2(x + CARD_W / 2, y + CARD_H - 32), size: 12, font: FONT, anchor: "center", color: k.rgb(rc[0], rc[1], rc[2]) });
      if (isEq) k.drawText({ text: "EQUIPPED", pos: k.vec2(x + CARD_W / 2, y + 16), size: 11, font: FONT, anchor: "center", color: T("teal") });
    }

    k.onDraw(() => {
      const now = k.time();
      const items = list();
      const equipped = tab === "chains" ? getEquippedSkinId() : getEquippedCharacterSkinId();
      for (let i = 0; i < items.length; i++) {
        const s = items[i];
        const [x, y] = cardPos(i);
        const isEq = s.id === equipped;
        if (tab === "chains") drawChainCard(s, x, y, now, i, isEq);
        else drawCharacterCard(s, x, y, now, i, isEq);
      }

      // Header + tab bar + back.
      k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: HEADER + TAB_H + 16, color: T("bg"), fixed: true });
      k.drawText({ text: "COSMETICS", pos: k.vec2(20, 22), size: 22, font: FONT, color: T("text"), fixed: true });
      for (let i = 0; i < TABS.length; i++) {
        const [id, label] = TABS[i];
        const [tx, ty, tw, th] = tabRect(i);
        const on = tab === id;
        k.drawRect({ pos: k.vec2(tx, ty), width: tw, height: th, radius: 9, color: on ? T("surface2") : T("surface"), outline: { width: 2, color: on ? T("teal") : T("line") }, fixed: true });
        k.drawText({ text: label, pos: k.vec2(tx + tw / 2, ty + th / 2), size: 14, font: FONT, anchor: "center", color: on ? T("teal") : T("textMut"), fixed: true });
      }
      k.drawRect({ pos: k.vec2(0, HEADER + TAB_H + 15), width: k.width(), height: 1, color: T("line"), fixed: true });
      const [bx, by, bw, bh] = backRect();
      k.drawRect({ pos: k.vec2(bx, by), width: bw, height: bh, radius: 10, color: T("surface"), outline: { width: 1, color: T("line") }, fixed: true });
      k.drawText({ text: "Back", pos: k.vec2(bx + bw / 2, by + bh / 2), size: 16, font: FONT, anchor: "center", color: T("text"), fixed: true });
    });

    const cardAt = (p) => {
      const items = list();
      for (let i = 0; i < items.length; i++) {
        const [x, y] = cardPos(i);
        if (p.x >= x && p.x <= x + CARD_W && p.y >= y && p.y <= y + CARD_H) return i;
      }
      return -1;
    };
    const onTap = (p) => {
      if (inRect(p, backRect())) { k.go(backScene, backArgs); return; }
      for (let i = 0; i < TABS.length; i++) {
        if (inRect(p, tabRect(i))) { tab = TABS[i][0]; return; }
      }
      const i = cardAt(p);
      if (i < 0) return;
      const s = list()[i];
      if (tab === "chains") setEquippedSkinId(s.id);
      else setEquippedCharacterSkinId(s.id);
    };
    k.onMousePress(() => onTap(k.mousePos()));
    k.onTouchStart((p) => onTap(p));
    k.onKeyPress("escape", () => k.go(backScene, backArgs));
  });
}
