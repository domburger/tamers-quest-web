// TQ-119: Spirit Shop CONTENT for the in-lobby station popup. Ports onlineShop.js's chain list + buy/
// upgrade into the shell's render(k,rect)+tap contract: a pinned wallet band + scrollable chain rows (icon
// well, name + tier chip, price, Buy/Refill + Upgrade) drawn INTO the rect (the shell clips it), tapping a
// button fires the same server-authoritative net.buyChain / net.craftChain as the scene; the "shop" reply is
// toasted by the host. All draws are fixed (screen-space) so the shell's k.pushClip masks them.
// UI v3: glass rows on the frosted sheet, one ember primary per row (Buy), glass secondaries (Refill / Upgrade).
import { net } from "../netClient.js";
import { getSpiritChains } from "../engine/gamedata.js";
import { upgradeTargetFor, upgradeCost } from "../engine/schemas.js";
import { UPGRADE_DEFS, upgradeLevel, nextUpgradeCost } from "../engine/upgrades.js"; // Base Upgrades (permanent, gold)
import { drawChainShopIcon } from "../render/chainCosmetics.js"; // TQ-439: shop chains use the equipped cosmetic skin + tier core (was the flat drawChainGlyph)
import { THEME, FONT, FONT_BOLD, drawRow, drawGlass, drawButton, drawChip, drawCurrency, drawEyebrow, inRect } from "./theme.js";
import { drawSheetMask, sheetEntrance, sheetAccent } from "./stationPopup.js";
import { drawIcon } from "./icons.js";
import { sfx, haptic } from "../systems/audio.js";

const SPECIAL_TAG = { endless: "Endless throws", guaranteed: "Sure catch", multi: "Multi-catch" };
const ROW_H = 76, GAP = 10, CUR_H = 44;
const owned = (id) => (net.state.chains || []).some((c) => c.chainId === id);
const upgradeFor = (def, chains) => (owned(def.id) ? upgradeTargetFor(def, chains) : null);

export function shopPanelState() { return { scrollY: 0, _maxScroll: 0 }; }

const rowsTop = (rect) => rect[1] + CUR_H + 6;
const rowRect = (rect, i, state) => { const top = rowsTop(rect) - state.scrollY; return [rect[0], top + i * (ROW_H + GAP), rect[2], ROW_H]; };
// Base Upgrades section below the chain rows: a heading, then one row per upgrade (same row height).
const SECTION_H = 38;
const upgTop = (rect, state) => rowRect(rect, getSpiritChains().length, state)[1] + 6;
const upgRowRect = (rect, i, state) => { const t = upgTop(rect, state) + SECTION_H; return [rect[0], t + i * (ROW_H + GAP), rect[2], ROW_H]; };
const upgBtn = (r) => [btnX(r), r[1] + r[3] / 2 - 19, BW, 38];
const UPG_ICON = { prospector: "coin", deepVault: "vault" };
const upgProfile = () => ({ upgrades: net.state.upgrades || {} });
// TQ-333: the popup is far narrower than the full-screen shop, so name + Buy + Upgrade can't share
// one row — the two actions stack vertically on the right (when an upgrade exists) so the name/description
// column keeps enough width to render on a single (truncated) line.
const BW = 104, BH = 30;
const btnX = (r) => r[0] + r[2] - BW - 10;
const buyR = (r, hasUp) => hasUp ? [btnX(r), r[1] + 7, BW, BH] : [btnX(r), r[1] + r[3] / 2 - 19, BW, 38];
const upR = (r) => [btnX(r), r[1] + r[3] - BH - 7, BW, BH];
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
    const dy = sheetEntrance(k, i); // UI v4: rows slide in with a stagger
    const d = [r[0], r[1] + dy, r[2], r[3]];
    const acc = sheetAccent();
    drawRow(k, { rect: d, radius: 18, hover: rowHover, fixed: true });
    // Icon well: a round glass dish with an accent ring behind the chain glyph — every row has an art anchor.
    drawGlass(k, { rect: [d[0] + 14, d[1] + 12, 52, 52], radius: 26, fill: 0.06, line: 0, fixed: true });
    k.drawCircle({ pos: k.vec2(d[0] + 40, d[1] + 38), radius: 26, color: k.rgb(...acc), opacity: 0.55, fill: false, outline: { width: 1.5, color: k.rgb(...acc) }, fixed: true });
    drawChainShopIcon(k, def, { x: d[0] + 40, y: d[1] + 38, r: 15, t: k.time(), fixed: true }); // TQ-439: equipped cosmetic skin overlaid with the tier core
    const tx = d[0] + 82, textMaxW = Math.max(70, btnX(d) - 12 - tx);
    // Line 1: bold name + tier chip (+ special chip when it fits). Line 2: coin + price, bind strength, owned check.
    const nm = fitText(k, def.name, textMaxW - 44, 17, FONT_BOLD);
    k.drawText({ text: nm, pos: k.vec2(tx, d[1] + 15), size: 17, font: FONT_BOLD, color: T("text"), fixed: true });
    const nmW = typeof k.measureText === "function" ? k.measureText(nm, 17, FONT_BOLD) : nm.length * 9.4;
    let cx = tx + nmW + 10;
    const tierR = drawChip(k, { x: cx, y: d[1] + 15, text: `Tier ${def.tier}`, color: THEME.textBody, size: 9, h: 18, fixed: true });
    cx = tierR[0] + tierR[2] + 6;
    if (def.special && SPECIAL_TAG[def.special] && cx + 90 <= tx + textMaxW) drawChip(k, { x: cx, y: d[1] + 15, text: SPECIAL_TAG[def.special], color: THEME.violet, size: 9, h: 18, fixed: true });
    drawIcon(k, "coin", { x: tx + 7, y: d[1] + 49, size: 14, color: THEME.amber, fixed: true });
    const priceStr = `${def.price}`;
    k.drawText({ text: priceStr, pos: k.vec2(tx + 18, d[1] + 41), size: 14, font: FONT_BOLD, color: T("amber"), fixed: true });
    const pw = typeof k.measureText === "function" ? k.measureText(priceStr, 14, FONT_BOLD) : priceStr.length * 8;
    let dx = tx + 18 + pw + 12;
    const bind = def.catchPower || "spirit chain";
    const bindW = typeof k.measureText === "function" ? k.measureText(bind, 13, FONT) : bind.length * 7;
    const roomForBind = textMaxW - (dx - tx) - (owns ? 78 : 0);
    if (bindW <= roomForBind) { k.drawText({ text: bind, pos: k.vec2(dx, d[1] + 42), size: 13, font: FONT, color: T("textBody"), fixed: true }); dx += bindW + 12; } // narrow rows keep price + Owned, drop the bind text
    if (owns) { drawIcon(k, "check", { x: dx + 6, y: d[1] + 49, size: 12, color: THEME.success, weight: 2, fixed: true }); k.drawText({ text: "Owned", pos: k.vec2(dx + 16, d[1] + 42), size: 12, font: FONT_BOLD, color: T("success"), fixed: true }); }
    // Actions: Buy is the ember primary; Refill (owned) and Upgrade are glass. Drawn at the slid position.
    const buyD = [buy[0], buy[1] + dy, buy[2], buy[3]];
    drawButton(k, { rect: buyD, text: owns ? "Refill" : "Buy", size: 14, radius: 13, fill: owns ? THEME.surfaceAlt : THEME.primary, textColor: owns ? THEME.text : THEME.textInv, disabled: !aff, hover: inRect(mp, buy), fixed: true });
    if (up) { const cost = upgradeCost(def.tier), cu = (net.state.gold || 0) >= cost, ur = upR(r);
      drawButton(k, { rect: [ur[0], ur[1] + dy, ur[2], ur[3]], text: `Upgrade ${cost}g`, size: 12, radius: 13, fill: THEME.surfaceAlt, textColor: THEME.text, disabled: !cu, hover: inRect(mp, ur), fixed: true }); }
  }
  // ── Base Upgrades: permanent account boosts bought with gold (engine/upgrades.js; server "buyUpgrade"). They
  // existed server-side but no village screen offered them, so the long-term gold goals were invisible.
  const ut = upgTop(rect, state);
  if (ut + SECTION_H > ry && ut < ry + rh) {
    drawEyebrow(k, { x: rx + 2, y: ut + 14, text: "Base upgrades", size: 11, color: THEME.primary, fixed: true });
    k.drawText({ text: "Permanent, kept forever", pos: k.vec2(rx + rw - 2, ut + 8), size: 11, font: FONT, anchor: "topright", color: T("textMut"), fixed: true });
  }
  const up0 = upgProfile();
  UPGRADE_DEFS.forEach((def, j) => {
    const r = upgRowRect(rect, j, state);
    if (r[1] + r[3] < ry || r[1] > ry + rh) return;
    const lvl = upgradeLevel(up0, def.id), cost = nextUpgradeCost(up0, def), maxed = cost == null;
    const aff = !maxed && (net.state.gold || 0) >= cost, b = upgBtn(r);
    drawRow(k, { rect: r, radius: 18, hover: inRect(mp, r) && mp.y >= rowsTop(rect) && !inRect(mp, b), fixed: true });
    drawGlass(k, { rect: [r[0] + 14, r[1] + 12, 52, 52], radius: 26, fill: 0.06, line: 0, fixed: true });
    drawIcon(k, UPG_ICON[def.id] || "plus", { x: r[0] + 40, y: r[1] + 38, size: 24, color: THEME.amber, fixed: true });
    const tx = r[0] + 82, textMaxW = Math.max(70, btnX(r) - 12 - tx);
    k.drawText({ text: fitText(k, def.name, textMaxW - 60, 17, FONT_BOLD), pos: k.vec2(tx, r[1] + 13), size: 17, font: FONT_BOLD, color: T("text"), fixed: true });
    // Level pips after the name
    const nmW = typeof k.measureText === "function" ? k.measureText(def.name, 17, FONT_BOLD) : def.name.length * 9.4;
    for (let i = 0; i < def.maxLevel; i++) {
      const px = tx + Math.min(nmW, textMaxW - 60) + 14 + i * 11, py = r[1] + 22;
      k.drawCircle({ pos: k.vec2(px, py), radius: 3.6, color: k.rgb(...(i < lvl ? THEME.amber : THEME.line)), fixed: true });
    }
    k.drawText({ text: fitText(k, def.desc, textMaxW, 13), pos: k.vec2(tx, r[1] + 42), size: 13, font: FONT, color: T("textBody"), fixed: true });
    drawButton(k, { rect: b, text: maxed ? "Maxed" : `${cost}g`, size: 14, radius: 13, fill: maxed ? THEME.surfaceAlt : THEME.primary,
      textColor: maxed ? THEME.textMut : THEME.textInv, disabled: maxed || !aff, hover: inRect(mp, b), fixed: true });
  });
  state._maxScroll = Math.max(0, (chains.length + UPGRADE_DEFS.length) * (ROW_H + GAP) + SECTION_H + 6 + CUR_H + 10 - rh);
  // Wallet band LAST so it sits above the scrolled rows (drawn within the clip; rows scroll under it).
  drawSheetMask(k, [rx, ry - 2, rw, CUR_H + 2]);
  drawEyebrow(k, { x: rx + 2, y: ry + 14, text: "Your wallet", size: 11, color: THEME.textMut, fixed: true });
  drawCurrency(k, { x: rx + rw - 2, y: ry + 19, anchor: "right", size: 17, pip: 6, animKey: "shop-wallet", fixed: true,
    items: [{ kind: "gold", value: net.state.gold }, { kind: "essence", value: net.state.essence }] });
}

// Tap → buy/upgrade (server-authoritative). `showToast` surfaces a client-side affordability message.
export function shopPanelTap(k, rect, state, p, showToast) {
  if (p.y < rowsTop(rect)) return false; // the pinned wallet band isn't interactive
  const chains = getSpiritChains();
  for (let j = 0; j < UPGRADE_DEFS.length; j++) {
    const def = UPGRADE_DEFS[j];
    if (!inRect(p, upgBtn(upgRowRect(rect, j, state)))) continue;
    const cost = nextUpgradeCost(upgProfile(), def);
    if (cost == null) { showToast && showToast("Already maxed."); return true; }
    if ((net.state.gold || 0) < cost) { showToast && showToast("Not enough gold."); return true; }
    haptic(8); sfx("click"); net.buyUpgrade(def.id); return true;
  }
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
  for (let j = 0; j < UPGRADE_DEFS.length; j++) out.push({ rect: upgBtn(upgRowRect(rect, j, state)) });
  return out;
}
