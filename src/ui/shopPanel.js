// TQ-119: Spirit Shop CONTENT for the in-lobby station popup. Ports onlineShop.js's chain list + buy/
// upgrade into the shell's render(k,rect)+tap contract: a currency row + scrollable chain rows (glyph,
// name/tier, price, Buy/Refill + Up[grade]) drawn INTO the rect (the shell clips it), tapping a button
// fires the same server-authoritative net.buyChain / net.craftChain as the scene; the "shop" reply is
// toasted by the host. All draws are fixed (screen-space) so the shell's k.pushClip masks them. (Base
// Upgrades is N/A — that station was removed from the lobby 2026-06-11.)
import { net } from "../netClient.js";
import { getSpiritChains } from "../engine/gamedata.js";
import { upgradeTargetFor, upgradeCost } from "../engine/schemas.js";
import { drawChainShopIcon } from "../render/chainCosmetics.js"; // TQ-439: shop chains use the equipped cosmetic skin + tier core (was the flat drawChainGlyph)
import { THEME, FONT, drawPanel, drawButton, drawCurrency, inRect } from "./theme.js";
import { sfx, haptic } from "../systems/audio.js";

const SPECIAL_TAG = { endless: "∞ throws", guaranteed: "sure catch", multi: "multi-catch" };
const ROW_H = 56, GAP = 8, CUR_H = 30;
const owned = (id) => (net.state.chains || []).some((c) => c.chainId === id);
const upgradeFor = (def, chains) => (owned(def.id) ? upgradeTargetFor(def, chains) : null);

export function shopPanelState() { return { scrollY: 0, _maxScroll: 0 }; }

const rowsTop = (rect) => rect[1] + CUR_H + 4;
const rowRect = (rect, i, state) => { const top = rowsTop(rect) - state.scrollY; return [rect[0], top + i * (ROW_H + GAP), rect[2], ROW_H]; };
// TQ-333: the popup is far narrower than the full-screen shop, so name + Buy + Upgrade can't share
// one row — textMaxW collapsed to ~60px and the name word-wrapped UNDER (overlapping) the description.
// Stack the two action buttons vertically on the right (when an upgrade exists) so the name/description
// column keeps enough width to render on a single (truncated) line.
const BW = 84, BH = 22;
const btnX = (r) => r[0] + r[2] - BW - 8;
const buyR = (r, hasUp) => hasUp ? [btnX(r), r[1] + 4, BW, BH] : [btnX(r), r[1] + r[3] / 2 - 14, BW, 28];
const upR = (r) => [btnX(r), r[1] + r[3] - BH - 4, BW, BH];
const fitText = (s, w, sz) => { const m = Math.max(3, Math.floor(w / (sz * 0.56))); return s.length > m ? s.slice(0, m - 1) + "…" : s; };

export function drawShopPanel(k, rect, state) {
  const [rx, ry, rw, rh] = rect;
  const T = (n) => k.rgb(...THEME[n]);
  const chains = getSpiritChains();
  const mp = k.mousePos();
  for (let i = 0; i < chains.length; i++) {
    const def = chains[i], r = rowRect(rect, i, state);
    if (r[1] + r[3] < ry || r[1] > ry + rh) continue; // cull off-rect rows
    drawPanel(k, { rect: r, fixed: true });
    drawChainShopIcon(k, def, { x: r[0] + 24, y: r[1] + r[3] / 2, r: 13, t: k.time(), fixed: true }); // TQ-439: equipped cosmetic skin overlaid with the tier core
    const owns = owned(def.id), up = upgradeFor(def, chains);
    const textMaxW = Math.max(70, r[2] - 42 - BW - 14); // glyph+pad on the left, the button column on the right
    const nameStr = `${def.name}   T${def.tier}${def.special ? "  " + (SPECIAL_TAG[def.special] || "special") : ""}`;
    const descStr = `${def.price}g   ${def.catchPower || "spirit chain"}${owns ? "   owned" : ""}`;
    // No wrap width → single line; truncate so a long name can't spill onto (and overlap) the description.
    k.drawText({ text: fitText(nameStr, textMaxW, 14), pos: k.vec2(r[0] + 42, r[1] + 11), size: 14, font: FONT, color: T("text"), fixed: true });
    k.drawText({ text: fitText(descStr, textMaxW, 11), pos: k.vec2(r[0] + 42, r[1] + 32), size: 11, font: FONT, color: T("textMut"), fixed: true });
    const buy = buyR(r, !!up), aff = (net.state.gold || 0) >= (def.price || 0);
    drawButton(k, { rect: buy, text: owns ? "Refill" : "Buy", size: 13, fill: THEME.primary, disabled: !aff, hover: inRect(mp, buy), fixed: true });
    if (up) { const cost = upgradeCost(def.tier), cu = (net.state.gold || 0) >= cost, ur = upR(r);
      drawButton(k, { rect: ur, text: `Up ${cost}g`, size: 12, fill: THEME.violet, disabled: !cu, hover: inRect(mp, ur), fixed: true }); }
  }
  state._maxScroll = Math.max(0, chains.length * (ROW_H + GAP) + CUR_H + 8 - rh);
  // Currency row LAST so it sits above the scrolled rows (drawn within the clip; rows scroll under it).
  k.drawRect({ pos: k.vec2(rx, ry), width: rw, height: CUR_H, color: T("surface"), fixed: true });
  drawCurrency(k, { x: rx + rw / 2, y: ry + 15, anchor: "center", size: 15, fixed: true,
    items: [{ kind: "gold", value: net.state.gold }, { kind: "essence", value: net.state.essence }] });
}

// Tap → buy/upgrade (server-authoritative). `showToast` surfaces a client-side affordability message.
export function shopPanelTap(k, rect, state, p, showToast) {
  if (p.y < rowsTop(rect)) return false; // the pinned currency row isn't interactive
  const chains = getSpiritChains();
  for (let i = 0; i < chains.length; i++) {
    const def = chains[i], r = rowRect(rect, i, state);
    const hasUp = !!upgradeFor(def, chains);
    if (hasUp && inRect(p, upR(r))) {
      if ((net.state.gold || 0) < upgradeCost(def.tier)) { showToast && showToast("Not enough gold."); return true; }
      haptic(8); sfx("click"); net.craftChain(def.id); return true;
    }
    if (inRect(p, buyR(r, hasUp))) {
      if ((net.state.gold || 0) < (def.price || 0)) { showToast && showToast("Not enough gold."); return true; }
      haptic(8); sfx("click"); net.buyChain(def.id); return true;
    }
  }
  return false;
}

export function shopPanelScroll(state, dy) { state.scrollY = Math.max(0, Math.min(state._maxScroll, state.scrollY + dy)); }

// TQ-527: focusable action buttons for controller nav — each chain's Buy/Refill button, plus its Upgrade
// button when one exists (order: row0 buy, row0 up, row1 buy, … so the d-pad steps through them). Reuses
// the same rowRect/buyR/upR layout as draw/tap so the focus rects match the hitboxes; the hub's generic
// focus-nav handles movement, scroll-to-focus, the ring, and activation via shopPanelTap at each centre.
export function shopPanelFocusables(rect, scrollY = 0) {
  const chains = getSpiritChains(), state = { scrollY }, out = [];
  for (let i = 0; i < chains.length; i++) {
    const r = rowRect(rect, i, state), hasUp = !!upgradeFor(chains[i], chains);
    out.push({ rect: buyR(r, hasUp) });
    if (hasUp) out.push({ rect: upR(r) });
  }
  return out;
}
