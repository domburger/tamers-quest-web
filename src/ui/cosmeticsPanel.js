import { net } from "../netClient.js";
import { CHAIN_SKINS, RARITY_COLOR, drawChainSkin, getEquippedSkinId, setEquippedSkinId } from "../render/chainCosmetics.js";
import { CHARACTER_SKINS, getEquippedCharacterSkinId, setEquippedCharacterSkinId } from "../render/characterCosmetics.js";
import { drawCharacter } from "../render/character.js";
import { isSkinOwned, acquireLabel, skinAcquire } from "../engine/cosmetics.js";
import { THEME, FONT_BOLD, drawCard, drawChip, drawWalletPill, drawTabs, inRect } from "./theme.js";
import { sfx, haptic } from "../systems/audio.js";
import { drawSheetMask, sheetEntrance, sheetAccent } from "./stationPopup.js";

const CW = 150, CH = 170, G = 14, STRIP_H = 80;
const tabs = (state) => state.tab === "chain" ? CHAIN_SKINS : CHARACTER_SKINS;
const ownedIds = (state) => (net.state.ownedCosmetics && net.state.ownedCosmetics[state.tab]) || [];
const equippedId = (state) => state.tab === "chain" ? getEquippedSkinId() : getEquippedCharacterSkinId();

export function cosmeticsPanelState() { return { tab: "chain", scrollY: 0, _maxScroll: 0, _cols: 1 }; }

function layout(rect, state) {
  const [rx, , rw] = rect;
  const cols = Math.max(1, Math.floor((rw + G) / (CW + G)));
  const gridW = cols * CW + (cols - 1) * G;
  state._cols = cols;
  return { cols, x0: rx + (rw - gridW) / 2, top: rect[1] + STRIP_H + 8 - state.scrollY };
}
const TAB_GAP = 6;
const tabW = (rect) => (rect[2] - 12 - TAB_GAP) / 2;
const tabRect = (rect, i) => { const w = tabW(rect); return [rect[0] + 6 + i * (w + TAB_GAP), rect[1] + 6, w, 30]; };

export function drawCosmeticsPanel(k, rect, state) {
  const [rx, ry, rw, rh] = rect;
  const T = (n) => k.rgb(...THEME[n]);
  const t = k.time();
  const list = tabs(state), owned = ownedIds(state), eq = equippedId(state);
  const { cols, x0, top } = layout(rect, state);
  const mp = k.mousePos();
  for (let i = 0; i < list.length; i++) {
    const s = list[i], cx = x0 + (i % cols) * (CW + G), cy = top + Math.floor(i / cols) * (CH + G);
    if (cy + CH < ry + STRIP_H || cy > ry + rh) continue;
    const isEq = s.id === eq, own = isSkinOwned(s, owned);
    const rc = RARITY_COLOR[s.rarity] || THEME.neutral;
    const edy = sheetEntrance(k, i, { step: 0.02 });
    drawCard(k, { rect: [cx, cy + edy, CW, CH], accent: rc, hover: inRect(mp, [cx, cy, CW, CH]) && mp.y >= ry + STRIP_H, selected: isEq, radius: 16, glowY: 0.34, fixed: true });
    const cyE = cy + edy;
    k.pushClip(cx + 1, cyE + 1, CW - 2, CH - 2);
    try {
      if (state.tab === "chain") drawChainSkin(k, { x: cx + CW / 2, y: cyE + 58, r: 36, t, skin: s, fixed: true });
      else drawCharacter(k, { x: cx + CW / 2, y: cyE + 78, t, moving: false, color: s.accent, cloak: s.cloak, model: s.model, dir: { x: 0, y: 1 }, fixed: true });
    } finally { k.popClip(); }
    k.drawText({ text: s.name, pos: k.vec2(cx + CW / 2, cyE + CH - 52), size: 13, font: FONT_BOLD, anchor: "center", width: CW - 12, color: T("text"), fixed: true });
    const lab = isEq ? "Equipped" : own ? "Equip" : acquireLabel(s);
    const labC = isEq ? THEME.primary : own ? THEME.textBody : (skinAcquire(s).kind === "free" ? THEME.success : THEME.amber);
    drawChip(k, { x: cx + CW / 2, y: cyE + CH - 30, text: lab, color: labC, size: 10, h: 20, padX: 9, anchor: "center", solid: isEq, fixed: true });
    if (!own && !isEq) { k.drawRect({ pos: k.vec2(cx, cyE), width: CW, height: CH, radius: 16, color: T("bg"), opacity: 0.28, fixed: true }); }
  }
  state._maxScroll = Math.max(0, Math.ceil(list.length / cols) * (CH + G) + STRIP_H + 12 - rh);
  drawSheetMask(k, [rx, ry - 2, rw, STRIP_H + 2]);
  const t0 = tabRect(rect, 0), t1 = tabRect(rect, 1);
  drawTabs(k, { rect: [t0[0], t0[1] - 3, t1[0] + t1[2] - t0[0], t0[3] + 6], tabs: [["chain", "Spirit Chains", "chain"], ["char", "Player Character", "person"]], active: state.tab, pointer: mp, size: 14, accent: sheetAccent(), animKey: "cosmetics-tabs", fixed: true });
  drawWalletPill(k, { x: rx + rw - 6, y: ry + 56, anchor: "right", size: 14,
    items: [{ kind: "gold", value: net.state.gold }, { kind: "essence", value: net.state.essence }] });
}

export function cosmeticsPanelTap(k, rect, state, p, showToast) {
  for (let i = 0; i < 2; i++) if (inRect(p, tabRect(rect, i))) { const id = i === 0 ? "chain" : "char"; if (state.tab !== id) { sfx("click"); state.tab = id; state.scrollY = 0; } return true; }
  if (p.y < rect[1] + STRIP_H) return true;
  const list = tabs(state), owned = ownedIds(state), { cols, x0, top } = layout(rect, state);
  for (let i = 0; i < list.length; i++) {
    const s = list[i], cx = x0 + (i % cols) * (CW + G), cy = top + Math.floor(i / cols) * (CH + G);
    if (p.x >= cx && p.x <= cx + CW && p.y >= cy && p.y <= cy + CH) {
      if (isSkinOwned(s, owned)) {
        haptic(6); sfx("click");
        if (state.tab === "chain") { setEquippedSkinId(s.id); try { net.setSkin && net.setSkin(s.id); } catch {} }
        else { setEquippedCharacterSkinId(s.id); try { net.setCharSkin && net.setCharSkin(s.id); } catch {} }
      } else {
        haptic(8); sfx("click"); try { net.buyCosmetic(state.tab, s.id); showToast && showToast("Purchasing…"); } catch {}
      }
      return true;
    }
  }
  return false;
}

export function cosmeticsPanelScroll(state, dy) { state.scrollY = Math.max(0, Math.min(state._maxScroll, state.scrollY + dy)); }

export function cosmeticsPanelFocusables(rect, state) {
  const out = [{ rect: tabRect(rect, 0) }, { rect: tabRect(rect, 1) }];
  const list = tabs(state), { cols, x0, top } = layout(rect, state);
  for (let i = 0; i < list.length; i++) {
    const cx = x0 + (i % cols) * (CW + G), cy = top + Math.floor(i / cols) * (CH + G);
    out.push({ rect: [cx, cy, CW, CH] });
  }
  return out;
}
