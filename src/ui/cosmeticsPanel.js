// TQ-120: Cosmetics CONTENT for the in-lobby station popup. A browse + equip + buy view on the SHARED
// cosmetics helpers — deliberately a SEPARATE module (does NOT touch the cosmetics.js scene, which is
// 00005's actively-evolving lane): two tabs (Spirit Chains / Player Character), a scrollable grid of
// skin cards with LIVE animated previews (drawChainSkin / drawCharacter), tap to equip an owned skin or
// buy an unowned one (server-authoritative net.buyCosmetic; the host toasts the "cosmetic" reply), and
// a wallet pill. All draws are fixed so the shell's k.pushClip masks them. The full cosmetics.js scene
// (big TQ-100 preview + TQ-169 essence store) stays the out-of-lobby route + the deep-feature home.
import { net } from "../netClient.js";
import { CHAIN_SKINS, RARITY_COLOR, drawChainSkin, getEquippedSkinId, setEquippedSkinId } from "../render/chainCosmetics.js";
import { CHARACTER_SKINS, getEquippedCharacterSkinId, setEquippedCharacterSkinId } from "../render/characterCosmetics.js";
import { drawCharacter } from "../render/character.js";
import { isSkinOwned, acquireLabel, skinAcquire } from "../engine/cosmetics.js";
import { THEME, FONT, drawPanel, drawButton, drawWalletPill, inRect } from "./theme.js";
import { sfx, haptic } from "../systems/audio.js";

// TQ-335: STRIP is two rows — tabs (full width) on row 1, wallet pill on row 2. One row crammed the
// 142px "Player Character" tab under the right-anchored wallet pill (and overflowed the narrow popup).
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
const tabW = (rect) => (rect[2] - 12 - TAB_GAP) / 2; // two tabs share row 1, sized to the popup width
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
    if (cy + CH < ry + STRIP_H || cy > ry + rh) continue; // cull (and never under the pinned strip)
    const isEq = s.id === eq, own = isSkinOwned(s, owned);
    const rc = RARITY_COLOR[s.rarity] || THEME.neutral;
    drawPanel(k, { rect: [cx, cy, CW, CH], radius: 12, fill: isEq ? THEME.surface2 : THEME.surface, border: isEq ? THEME.teal : rc, borderW: isEq ? 2 : 1, fixed: true });
    if (state.tab === "chain") drawChainSkin(k, { x: cx + CW / 2, y: cy + 58, r: 40, t, skin: s, fixed: true });
    // Character previews face the camera so the accent eyes/rim read. drawCharacter takes the
    // skin's palette/silhouette as color/cloak/model (NOT a `skin` object — that param is the
    // equipped CHAIN cosmetic glow, a different thing). Parity with cosmetics.js drawCharacterCard.
    else drawCharacter(k, { x: cx + CW / 2, y: cy + 78, t, moving: false, color: s.accent, cloak: s.cloak, model: s.model, dir: { x: 0, y: 1 }, fixed: true });
    k.drawText({ text: s.name, pos: k.vec2(cx + CW / 2, cy + CH - 50), size: 13, font: FONT, anchor: "center", width: CW - 12, color: T("text"), fixed: true });
    const lab = isEq ? "Equipped" : own ? "Equip" : acquireLabel(s);
    const labC = isEq ? THEME.teal : own ? THEME.textMut : (skinAcquire(s).kind === "free" ? THEME.success : THEME.amber);
    k.drawText({ text: lab, pos: k.vec2(cx + CW / 2, cy + CH - 26), size: 12, font: FONT, anchor: "center", color: k.rgb(...labC), fixed: true });
    if (!own && !isEq) { /* locked tint */ k.drawRect({ pos: k.vec2(cx, cy), width: CW, height: CH, radius: 12, color: T("bg"), opacity: 0.28, fixed: true }); }
  }
  state._maxScroll = Math.max(0, Math.ceil(list.length / cols) * (CH + G) + STRIP_H + 12 - rh);
  // Pinned top strip (over the scrolled grid): tabs (left) + wallet pill (right).
  k.drawRect({ pos: k.vec2(rx, ry), width: rw, height: STRIP_H, color: T("surface"), fixed: true });
  for (let i = 0; i < 2; i++) {
    const id = i === 0 ? "chain" : "char", label = i === 0 ? "Spirit Chains" : "Player Character", on = state.tab === id, tr = tabRect(rect, i);
    drawButton(k, { rect: tr, text: label, size: 13, fill: on ? THEME.primary : THEME.surfaceAlt, textColor: on ? THEME.textInv : THEME.text, outline: THEME.line, hover: inRect(mp, tr), fixed: true }); // TQ-202: no ember outline on the selected tab (read as a halo)
  }
  drawWalletPill(k, { x: rx + rw - 6, y: ry + 56, anchor: "right", size: 14, // row 2 (below the tabs)
    items: [{ kind: "gold", value: net.state.gold }, { kind: "essence", value: net.state.essence }] });
}

// Tap → switch tab, or equip (owned) / buy (unowned). Returns true if consumed.
export function cosmeticsPanelTap(k, rect, state, p, showToast) {
  for (let i = 0; i < 2; i++) if (inRect(p, tabRect(rect, i))) { const id = i === 0 ? "chain" : "char"; if (state.tab !== id) { sfx("click"); state.tab = id; state.scrollY = 0; } return true; }
  if (p.y < rect[1] + STRIP_H) return true; // the pinned strip swallows taps
  const list = tabs(state), owned = ownedIds(state), { cols, x0, top } = layout(rect, state);
  for (let i = 0; i < list.length; i++) {
    const s = list[i], cx = x0 + (i % cols) * (CW + G), cy = top + Math.floor(i / cols) * (CH + G);
    if (p.x >= cx && p.x <= cx + CW && p.y >= cy && p.y <= cy + CH) {
      if (isSkinOwned(s, owned)) { // equip (per-client + server sync)
        haptic(6); sfx("click");
        if (state.tab === "chain") { setEquippedSkinId(s.id); try { net.setSkin && net.setSkin(s.id); } catch {} }
        else { setEquippedCharacterSkinId(s.id); try { net.setCharSkin && net.setCharSkin(s.id); } catch {} }
      } else { // buy (server-authoritative; reply toasted by the host)
        haptic(8); sfx("click"); try { net.buyCosmetic(state.tab, s.id); showToast && showToast("Purchasing…"); } catch {}
      }
      return true;
    }
  }
  return false;
}

export function cosmeticsPanelScroll(state, dy) { state.scrollY = Math.max(0, Math.min(state._maxScroll, state.scrollY + dy)); }

// TQ-527: focus targets for controller nav — the two tabs, then every skin card of the active tab (A on a
// tab switches it; A on a card equips/buys it, exactly like a tap). Reuses tabRect + the grid layout so the
// focus rects match the hitboxes; the hub handles d-pad movement, scroll-to-focus, the ring, and activation.
export function cosmeticsPanelFocusables(rect, state) {
  const out = [{ rect: tabRect(rect, 0) }, { rect: tabRect(rect, 1) }];
  const list = tabs(state), { cols, x0, top } = layout(rect, state);
  for (let i = 0; i < list.length; i++) {
    const cx = x0 + (i % cols) * (CW + G), cy = top + Math.floor(i / cols) * (CH + G);
    out.push({ rect: [cx, cy, CW, CH] });
  }
  return out;
}
