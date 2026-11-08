// TQ-119: Spirit Shop CONTENT for the in-lobby station popup. Ports onlineShop.js's chain list + buy/
// upgrade into the shell's render(k,rect)+tap contract: a pinned wallet band + scrollable chain rows (icon
// well, name + tier chip, price, Buy/Refill + Upgrade) drawn INTO the rect (the shell clips it), tapping a
// button fires the same server-authoritative net.buyChain / net.craftChain as the scene; the "shop" reply is
// toasted by the host. All draws are fixed (screen-space) so the shell's k.pushClip masks them.
// UI v3: glass rows on the frosted sheet, one ember primary per row (Buy), glass secondaries (Refill / Upgrade).
import { net } from "../netClient.js";
import { getSpiritChains } from "../engine/gamedata.js";
import { upgradeTargetFor, upgradeCost } from "../engine/schemas.js";
import { drawChainShopIcon } from "../render/chainCosmetics.js"; // TQ-439: shop chains use the equipped cosmetic skin + tier core (was the flat drawChainGlyph)
import { THEME, FONT, FONT_BOLD, drawRow, drawGlass, drawButton, drawChip, drawCurrency, drawEyebrow, inRect } from "./theme.js";
import { drawSheetMask } from "./stationPopup.js";
import { sfx, haptic } from "../systems/audio.js";

const SPECIAL_TAG = { endless: "Endless throws", guaranteed: "Sure catch", multi: "Multi-catch" };
const ROW_H = 66, GAP = 10, CUR_H = 40;
const owned = (id) => (net.state.chains || []).some((c) => c.chainId === id);
const upgradeFor = (def, chains) => (owned(def.id) ? upgradeTargetFor(def, chains) : null);

export function shopPanelState() { return { scrollY: 0, _maxScroll: 0 }; }

const rowsTop = (rect) => rect[1] + CUR_H + 6;
const rowRect = (rect, i, state) => { const top = rowsTop(rect) - state.scrollY; return [rect[0], top + i * (ROW_H + GAP), rect[2], ROW_H]; };
// TQ-333: the popup is far narrower than the full-screen shop, so name + Buy + Upgrade can't share
// one row — the two actions stack vertically on the right (when an upgrade exists) so the name/description
// column keeps enough width to render on a single (truncated) line.
const BW = 96, BH = 26;
const btnX = (r) => r[0] + r[2] - BW - 10;
const buyR = (r, hasUp) => hasUp ? [btnX(r), r[1] + 6, BW, BH] : [btnX(r), r[1] + r[3] / 2 - 16, BW, 32];
const upR = (r) => [btnX(r), r[1] + r[3] - BH - 6, BW, BH];
const fitText = (k, s, w, sz, font = FONT) => {
  const mw = typeof k.measureText === "function" ? (t) => k.measureText(t, sz, font) : (t) => t.length * sz * 0.56;
  if (mw(s) <= w) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (mw(s.slice(0, mid) + "…") <= w) lo = mid; else hi = mid - 1; }
  return lo <= 0 ? "" : s.slice(0, lo).trimEnd() + "…";
};

export function drawShopPanel(k, rect, state) {
  const [rx, ry, rw, rh] = rect;
  const T = (n) => k.rgb(...THEME[n]);
  const chains = getSpiritChains();
  const mp = k.mousePos();
  for (let i = 0; i < chains.length; i++) {
    const def = chains[i], r = rowRect(rect, i, state);
    if (r[1] + r[3] < ry || r[1] > ry + rh) continue; // cull off-rect rows
    const owns = owned(def.id), up = upgradeFor(def, chains);
    const buy = buyR(r, !!up), aff = (net.state.gold || 0) >= (def.price || 0);
    const rowHover = inRect(mp, r) && mp.y >= rowsTop(rect) && !inRect(mp, buy);
    drawRow(k, { rect: r, radius: 16, hover: rowHover, fixed: true });
    // Icon well: a round glass dish behind the chain glyph so every row has a consistent art anchor.
    drawGlass(k, { rect: [r[0] + 12, r[1] + 11, 44, 44], radius: 22, fill: 0.05, line: 0.1, fixed: true });
    drawChainShopIcon(k, def, { x: r[0] + 34, y: r[1] + 33, r: 13, t: k.time(), fixed: true }); // TQ-439: equipped cosmetic skin overlaid with the tier core
    const tx = r[0] + 68, textMaxW = Math.max(70, btnX(r) - 12 - tx);
    // Line 1: bold name + tier chip (+ special chip when it fits). Line 2: price (amber) + bind strength + owned.
    const nm = fitText(k, def.name, textMaxW - 40, 15, FONT_BOLD);
    k.drawText({ text: nm, pos: k.vec2(tx, r[1] + 13), size: 15, font: FONT_BOLD, color: T("text"), fixed: true });
    const nmW = typeof k.measureText === "function" ? k.measureText(nm, 15, FONT_BOLD) : nm.length * 8.4;
    let cx = tx + nmW + 8;
    const tierR = drawChip(k, { x: cx, y: r[1] + 12, text: `T${def.tier}`, color: THEME.textBody, size: 9, h: 17, fixed: true });
    cx = tierR[0] + tierR[2] + 6;
    if (def.special && SPECIAL_TAG[def.special] && cx + 80 <= tx + textMaxW) drawChip(k, { x: cx, y: r[1] + 12, text: SPECIAL_TAG[def.special], color: THEME.violet, size: 9, h: 17, fixed: true });
    const priceStr = `${def.price}g`;
    k.drawText({ text: priceStr, pos: k.vec2(tx, r[1] + 38), size: 13, font: FONT_BOLD, color: T("amber"), fixed: true });
    const pw = typeof k.measureText === "function" ? k.measureText(priceStr, 13, FONT_BOLD) : priceStr.length * 7.5;
    const desc = `${def.catchPower || "spirit chain"}${owns ? "   owned" : ""}`;
    k.drawText({ text: fitText(k, desc, textMaxW - pw - 12, 12), pos: k.vec2(tx + pw + 10, r[1] + 39), size: 12, font: FONT, color: T("textMut"), fixed: true });
    // Actions: Buy is the ember primary; Refill (owned) and Upgrade are glass.
    drawButton(k, { rect: buy, text: owns ? "Refill" : "Buy", size: 13, radius: 12, fill: owns ? THEME.surfaceAlt : THEME.primary, textColor: owns ? THEME.text : THEME.textInv, disabled: !aff, hover: inRect(mp, buy), fixed: true });
    if (up) { const cost = upgradeCost(def.tier), cu = (net.state.gold || 0) >= cost, ur = upR(r);
      drawButton(k, { rect: ur, text: `Upgrade ${cost}g`, size: 11, radius: 12, fill: THEME.surfaceAlt, textColor: THEME.text, disabled: !cu, hover: inRect(mp, ur), fixed: true }); }
  }
  state._maxScroll = Math.max(0, chains.length * (ROW_H + GAP) + CUR_H + 10 - rh);
  // Wallet band LAST so it sits above the scrolled rows (drawn within the clip; rows scroll under it).
  drawSheetMask(k, [rx, ry - 2, rw, CUR_H + 2]);
  drawEyebrow(k, { x: rx + 2, y: ry + 12, text: "Your wallet", size: 10, color: THEME.textMut, fixed: true });
  drawCurrency(k, { x: rx + rw - 2, y: ry + 17, anchor: "right", size: 15, fixed: true,
    items: [{ kind: "gold", value: net.state.gold }, { kind: "essence", value: net.state.essence }] });
}

// Tap → buy/upgrade (server-authoritative). `showToast` surfaces a client-side affordability message.
export function shopPanelTap(k, rect, state, p, showToast) {
  if (p.y < rowsTop(rect)) return false; // the pinned wallet band isn't interactive
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
export function shopPanelFocusables(rect, state = {}) {
  const chains = getSpiritChains(), out = [];
  for (let i = 0; i < chains.length; i++) {
    const r = rowRect(rect, i, state), hasUp = !!upgradeFor(chains[i], chains);
    out.push({ rect: buyR(r, hasUp) });
    if (hasUp) out.push({ rect: upR(r) });
  }
  return out;
}
