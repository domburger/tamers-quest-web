// TQ-536 / TQ-113 monster MARKETPLACE content for the in-lobby station popup. Two tabs in the shared
// stationPopup shell's draw(k,rect,state)+tap+scroll contract:
//   • Browse — every live listing (other players' + your own); Buy another's for gold, Cancel your own.
//   • Sell   — your vault monsters; pick a gold price, then List one (it escrows server-side).
// All trading is server-authoritative (server/marketplace.js escrow core) and surfaced over the net
// market protocol (net.marketBrowse/marketList/marketCancel/marketBuy → { t:"market" } replies handled
// in net.js into state.market / state.marketResult / state.vault / state.gold). Priced in GOLD ONLY:
// essence as a sale currency is gated on Decision TQ-535 (RMT/refund risk) and the server rejects it.
// Draws are fixed:true (screen-space) so the shell's pushClip masks them (the hub camera tracks the player).
import { net } from "../netClient.js";
import { getMonsterType } from "../engine/gamedata.js";
import { THEME, FONT, drawPanel, drawButton, drawCurrency, drawScrollbar, inRect } from "./theme.js";
import { drawMonsterIcon, slugOf } from "../render/monster.js";
import { sfx, haptic } from "../systems/audio.js";

const TABH = 30, GAP = 12, CUR_H = 30;
const ROW_H = 64, ROW_GAP = 8;
const PRICE_MAX = 999999;
// TQ-535: a listing is priced in ONE currency (gold OR essence) chosen via the Sell-tab toggle. Per-currency
// floor + default + step sizes (essence is precious → small steps). The house takes a fee on each sale.
const CUR = {
  gold:    { min: 10, def: 100, steps: [["-50", -50], ["-10", -10], ["+10", 10], ["+50", 50]], suffix: "g", color: "amber" },
  essence: { min: 1,  def: 5,   steps: [["-5", -5], ["-1", -1], ["+1", 1], ["+5", 5]],          suffix: "e", color: "violet" },
};
const DEFAULT_FEE = 0.10;

const REASON_TEXT = {
  busy: "Finish your run before trading.",
  essence_disabled: "Essence trading isn't available.",
  need_gold: "Not enough gold.",
  need_essence: "Not enough essence.",
  no_listing: "That listing is gone.",
  own_listing: "That's your own listing.",
  not_owned: "You don't own that monster.",
  price_required: "Set a price first.",
  seller_mismatch: "Couldn't reach the seller.",
};

const listings = () => (net.state.market && net.state.market.listings) || [];
const vault = () => net.state.vault || [];
const gold = () => net.state.gold || 0;
const essence = () => net.state.essence || 0;
const feePct = () => (net.state.market && typeof net.state.market.feePct === "number" ? net.state.market.feePct : DEFAULT_FEE);
// Price string for a listing: only the priced currencies, joined (essence-only never shows a bogus "0g").
const priceLabel = (l) => { const p = []; if (l.gold > 0) p.push(`${l.gold}g`); if (l.essence > 0) p.push(`${l.essence}e`); return p.join("  +  ") || "0g"; };
const curPrice = (state) => (state.cur === "essence" ? state.priceEssence : state.priceGold);

export function marketplacePanelState() {
  net.marketBrowse(); // pull live listings (+ any pending sale receipts) on open
  return { tab: "browse", cur: "gold", priceGold: CUR.gold.def, priceEssence: CUR.essence.def, scrollY: 0, _maxScroll: 0, seenResultAt: 0, seenSalesAt: 0, saleQueue: [], statusMsg: "", statusT: -10, lastBrowseT: 0, _hit: null };
}

// ── layout helpers (rows fill the content width, like shopPanel) ──
const rowsTop = (rect) => rect[1] + TABH + 10 + CUR_H + 4;
const rowRect = (rect, i, state) => { const top = rowsTop(rect) - state.scrollY; return [rect[0], top + i * (ROW_H + ROW_GAP), rect[2], ROW_H]; };
const BW = 92, BH = 28;
const btnR = (r) => [r[0] + r[2] - BW - 10, r[1] + r[3] / 2 - BH / 2, BW, BH];
const fitText = (s, w, sz) => { const m = Math.max(3, Math.floor(w / (sz * 0.56))); return (s || "").length > m ? s.slice(0, m - 1) + "…" : s; };

function monLabel(m) { const t = getMonsterType(m.typeName); return (m.name || (t && t.name) || m.typeName || "Monster"); }

export function drawMarketplacePanel(k, rect, state) {
  const [rx, ry, rw, rh] = rect;
  const T = (n) => k.rgb(...(THEME[n] || [255, 255, 255]));
  const mp = k.mousePos();
  const hit = { tabs: [], rows: [], price: null, status: null };

  // TQ-539: keep the Browse board live — re-pull listings on a light cadence while it's open so other
  // players' new/sold/cancelled listings appear without reopening. Browse tab only (Sell lists your own
  // vault); marketBrowse is a cheap read and a no-op when disconnected. Updating state.market doesn't move
  // the scroll, so no jump. The "browse" reply also re-flows _maxScroll, clamped below.
  if (state.tab === "browse") {
    if (state.lastBrowseT === 0) state.lastBrowseT = k.time(); // the ctor already browsed on open — start the clock, don't double-pull
    else if (k.time() - state.lastBrowseT > 5) { state.lastBrowseT = k.time(); net.marketBrowse(); }
  }

  // Surface async results: when a fresh market reply lands, toast its outcome and refresh the browse list.
  const res = net.state.marketResult;
  if (res && res.at && res.at !== state.seenResultAt) {
    state.seenResultAt = res.at;
    state.statusMsg = res.ok ? "Done." : (REASON_TEXT[res.reason] || "Couldn't complete that.");
    state.statusT = k.time();
    if (res.ok) net.marketBrowse(); // a list/cancel/buy changed the board → re-pull
  }
  // TQ-537: pending sale receipts — queue them, then show one at a time as the status toast frees up.
  const sales = net.state.marketSales;
  if (sales && sales.at && sales.at !== state.seenSalesAt) {
    state.seenSalesAt = sales.at;
    for (const s of (sales.items || [])) state.saleQueue.push(s);
  }
  if (state.saleQueue.length && k.time() - state.statusT >= 2.6) {
    const s = state.saleQueue.shift();
    const price = `${s.gold || 0}g${s.essence ? "  +" + s.essence + "e" : ""}`;
    state.statusMsg = `Sold ${s.name} — ${price}`;
    state.statusT = k.time();
  }

  // Content first (its band masks scroll under the pinned header), header LAST.
  if (state.tab === "browse") drawBrowse(k, rect, state, hit, mp);
  else drawSell(k, rect, state, hit, mp);

  // Pinned header band (mask), then currency + tabs over it.
  k.drawRect({ pos: k.vec2(rx, ry), width: rw, height: TABH + 10 + CUR_H + 4, color: T("surface"), fixed: true });
  // currency row
  k.drawRect({ pos: k.vec2(rx, ry + TABH + 10), width: rw, height: CUR_H, color: T("surface"), fixed: true });
  drawCurrency(k, { x: rx + rw / 2, y: ry + TABH + 10 + 15, anchor: "center", size: 15, fixed: true,
    items: [{ kind: "gold", value: net.state.gold }, { kind: "essence", value: net.state.essence }] });
  // tab row
  const tabs = [["browse", "Browse"], ["sell", "Sell"]];
  const tabW = (rw - GAP * (tabs.length - 1)) / tabs.length;
  tabs.forEach(([id, label], i) => {
    const r = [rx + i * (tabW + GAP), ry, tabW, TABH], on = state.tab === id;
    drawButton(k, { rect: r, text: label, size: 14, fill: on ? THEME.primary : THEME.surfaceAlt, textColor: on ? THEME.textInv : THEME.text, outline: on ? THEME.primary : THEME.line, hover: inRect(mp, r), fixed: true });
    hit.tabs.push({ id, r });
  });
  // transient status line under the tabs
  if (k.time() - state.statusT < 2.6 && state.statusMsg) {
    const good = state.statusMsg === "Done." || state.statusMsg.startsWith("Sold ");
    k.drawText({ text: state.statusMsg, pos: k.vec2(rx + rw / 2, ry + TABH + 10 + CUR_H + 2), size: 12, font: FONT, anchor: "center", color: T(good ? "success" : "warn"), fixed: true });
  }
  state._hit = hit;
}

function drawRowBase(k, r, mon) {
  const T = (n) => k.rgb(...(THEME[n] || [255, 255, 255]));
  drawPanel(k, { rect: r, fixed: true });
  drawMonsterIcon(k, { sprite: slugOf(mon.typeName), typeName: mon.typeName, cx: r[0] + 34, cy: r[1] + r[3] / 2, scale: 0.5, topY: r[1] + 4, fixed: true });
  const textMaxW = Math.max(70, r[2] - 68 - BW - 16);
  k.drawText({ text: fitText(monLabel(mon), textMaxW, 14), pos: k.vec2(r[0] + 64, r[1] + 12), size: 14, font: FONT, color: T("text"), fixed: true });
  k.drawText({ text: fitText(`Lv.${mon.level || 1}   ${getMonsterType(mon.typeName)?.name ? mon.typeName : "spirit"}`, textMaxW, 11), pos: k.vec2(r[0] + 64, r[1] + 34), size: 11, font: FONT, color: T("textMut"), fixed: true });
  return textMaxW;
}

function drawBrowse(k, rect, state, hit, mp) {
  const [rx, ry, rw, rh] = rect;
  const T = (n) => k.rgb(...(THEME[n] || [255, 255, 255]));
  const list = listings();
  const top0 = rowsTop(rect);
  if (list.length === 0) {
    k.drawText({ text: "No listings yet — be the first to sell one on the Sell tab.", pos: k.vec2(rx + rw / 2, top0 + 30), size: 13, font: FONT, anchor: "center", width: rw - 40, align: "center", color: T("textMut"), fixed: true });
  }
  for (let i = 0; i < list.length; i++) {
    const l = list[i], r = rowRect(rect, i, state);
    if (r[1] + r[3] < top0 || r[1] > ry + rh) continue;
    drawRowBase(k, r, l.mon);
    k.drawText({ text: priceLabel(l), pos: k.vec2(r[0] + 64, r[1] + 50), size: 12, font: FONT, color: T(l.essence > 0 && l.gold === 0 ? "violet" : "amber"), fixed: true });
    const br = btnR(r);
    if (l.mine) {
      drawButton(k, { rect: br, text: "Cancel", size: 13, fill: THEME.surfaceAlt, textColor: THEME.danger, outline: THEME.danger, hover: inRect(mp, br), fixed: true });
    } else {
      const aff = gold() >= (l.gold || 0) && essence() >= (l.essence || 0); // TQ-535: can afford BOTH priced currencies
      drawButton(k, { rect: br, text: "Buy", size: 13, fill: THEME.primary, disabled: !aff, hover: inRect(mp, br), fixed: true });
    }
    hit.rows.push({ i, r, br, listingId: l.id, mine: !!l.mine });
  }
  state._maxScroll = Math.max(0, list.length * (ROW_H + ROW_GAP) + 8 - ((ry + rh) - top0));
  if (state.scrollY > state._maxScroll) state.scrollY = state._maxScroll;
  if (state._maxScroll > 0) drawScrollbar(k, { top: top0, trackH: (ry + rh) - top0, contentH: list.length * (ROW_H + ROW_GAP) + 8, scrollY: state.scrollY, maxScroll: state._maxScroll });
}

function drawSell(k, rect, state, hit, mp) {
  const [rx, ry, rw, rh] = rect;
  const T = (n) => k.rgb(...(THEME[n] || [255, 255, 255]));
  const v = vault();
  const top0 = rowsTop(rect);
  const cc = CUR[state.cur] || CUR.gold;
  const price = curPrice(state);
  const net = Math.max(0, price - Math.floor(price * feePct())); // what the seller receives after the house cut
  // TQ-535: a compact CURRENCY TOGGLE (Gold | Essence) over the price stepper, then a net-after-fee hint.
  // Both the toggle and stepper are RESPONSIVE (fit rw at narrow portrait, TQ-538) and redrawn over the band
  // mask, so they pin while the vault list scrolls under them.
  const tgY = top0 - 4, tgH = 26;
  const tgW = Math.min(96, (rw - 8) / 2 - 4);
  const psY = tgY + tgH + 8, psH = 30;
  const feeY = psY + psH + 4;
  const steps = cc.steps;
  const sgap = 6, gapAfterVal = 8, valX = rx + 46;
  const valW = Math.min(86, Math.max(58, rw * 0.22));
  const region = (rx + rw) - (valX + valW + gapAfterVal); // width left for the 4 buttons
  const sbw = Math.max(30, Math.min(56, Math.floor((region - sgap * 3) / 4)));
  const stepX = (i) => valX + valW + gapAfterVal + i * (sbw + sgap);
  // draw the toggle + label + value box + the 4 buttons + fee hint; populate hit on the first pass only.
  const drawHead = (record) => {
    if (record) { hit.price = { buttons: [] }; hit.curTabs = []; }
    // currency toggle
    [["gold", "Gold"], ["essence", "Essence"]].forEach(([id, label], i) => {
      const r = [rx + i * (tgW + 8), tgY, tgW, tgH], on = state.cur === id;
      drawButton(k, { rect: r, text: label, size: 12, fill: on ? THEME[CUR[id].color] : THEME.surfaceAlt, textColor: on ? THEME.textInv : THEME.text, outline: on ? THEME[CUR[id].color] : THEME.line, hover: inRect(mp, r), fixed: true });
      if (record) hit.curTabs.push({ id, r });
    });
    // price stepper
    k.drawText({ text: "Price", pos: k.vec2(rx + 4, psY + 8), size: 12, font: FONT, color: T("textMut"), fixed: true });
    k.drawRect({ pos: k.vec2(valX, psY), width: valW, height: psH, radius: 8, color: T("surface2"), fixed: true });
    k.drawText({ text: `${price}${cc.suffix}`, pos: k.vec2(valX + valW / 2, psY + 15), size: 14, font: FONT, anchor: "center", color: T(cc.color), fixed: true });
    for (let i = 0; i < steps.length; i++) {
      const r = [stepX(i), psY, sbw, psH];
      drawButton(k, { rect: r, text: steps[i][0], size: 12, fill: THEME.surfaceAlt, textColor: THEME.text, outline: THEME.line, hover: inRect(mp, r), fixed: true });
      if (record) hit.price.buttons.push({ r, delta: steps[i][1] });
    }
    // net-after-fee hint
    k.drawText({ text: `${Math.round(feePct() * 100)}% market fee — you receive ${net}${cc.suffix}`, pos: k.vec2(rx + rw / 2, feeY + 6), size: 11, font: FONT, anchor: "center", color: T("textMut"), fixed: true });
  };
  drawHead(true);
  // Vault rows.
  const rowsTopSell = feeY + 18;
  const rowR = (i) => { const top = rowsTopSell - state.scrollY; return [rx, top + i * (ROW_H + ROW_GAP), rw, ROW_H]; };
  if (v.length === 0) {
    k.drawText({ text: "Your vault is empty — catch monsters in a run, then list the spares here.", pos: k.vec2(rx + rw / 2, rowsTopSell + 30), size: 13, font: FONT, anchor: "center", width: rw - 40, align: "center", color: T("textMut"), fixed: true });
  }
  for (let i = 0; i < v.length; i++) {
    const m = v[i], r = rowR(i);
    if (r[1] + r[3] < rowsTopSell || r[1] > ry + rh) continue;
    drawRowBase(k, r, m);
    const br = btnR(r);
    drawButton(k, { rect: br, text: `List ${price}${cc.suffix}`, size: 11, fill: THEME.violet, hover: inRect(mp, br), fixed: true });
    hit.rows.push({ i, r, br, monId: m.id, clipTop: rowsTopSell });
  }
  // Mask the band above the vault rows so they scroll under the pinned toggle/stepper.
  k.drawRect({ pos: k.vec2(rx, ry), width: rw, height: rowsTopSell - ry, color: T("surface"), fixed: true });
  // Re-draw the toggle/stepper/hint over the band mask (currency/tabs are re-drawn by the caller); same geometry.
  drawHead(false);
  state._maxScroll = Math.max(0, v.length * (ROW_H + ROW_GAP) + 8 - ((ry + rh) - rowsTopSell));
  if (state.scrollY > state._maxScroll) state.scrollY = state._maxScroll;
  if (state._maxScroll > 0) drawScrollbar(k, { top: rowsTopSell, trackH: (ry + rh) - rowsTopSell, contentH: v.length * (ROW_H + ROW_GAP) + 8, scrollY: state.scrollY, maxScroll: state._maxScroll });
}

export function marketplacePanelTap(k, rect, state, p, showToast) {
  const hit = state._hit; if (!hit) return false;
  for (const t of hit.tabs) if (inRect(p, t.r)) { if (state.tab !== t.id) { sfx("click"); state.tab = t.id; state.scrollY = 0; } return true; }
  if (state.tab === "sell") {
    for (const t of (hit.curTabs || [])) if (inRect(p, t.r)) { if (state.cur !== t.id) { sfx("click"); state.cur = t.id; } return true; }
    if (hit.price) for (const b of hit.price.buttons) if (inRect(p, b.r)) {
      const cc = CUR[state.cur] || CUR.gold, key = state.cur === "essence" ? "priceEssence" : "priceGold";
      state[key] = Math.max(cc.min, Math.min(PRICE_MAX, (state[key] || cc.def) + b.delta));
      sfx("click"); return true;
    }
  }
  for (const row of hit.rows) {
    if (row.clipTop != null && p.y < row.clipTop) continue; // ignore taps in the masked band
    if (!inRect(p, row.br)) continue;
    if (state.tab === "browse") {
      if (row.mine) { haptic(8); sfx("click"); showToast && showToast("Cancelling…"); net.marketCancel(row.listingId); return true; }
      const l = listings().find((x) => x.id === row.listingId);
      if (l && gold() < (l.gold || 0)) { showToast && showToast("Not enough gold."); return true; }
      if (l && essence() < (l.essence || 0)) { showToast && showToast("Not enough essence."); return true; }
      haptic(8); sfx("click"); showToast && showToast("Buying…"); net.marketBuy(row.listingId); return true;
    } else {
      const price = curPrice(state);
      haptic(8); sfx("click"); showToast && showToast("Listing…");
      net.marketList(row.monId, state.cur === "gold" ? price : 0, state.cur === "essence" ? price : 0);
      return true;
    }
  }
  return true; // taps inside the panel are consumed (don't close it)
}

export function marketplacePanelScroll(state, dy) { state.scrollY = Math.max(0, Math.min(state._maxScroll, state.scrollY + dy)); }

// TQ-527-style focus targets for controller nav: tabs, then (Sell) the price steppers, then each row's
// action button. The hub's generic focus-nav steps through these, scrolls to keep focus on-screen, and
// activates via marketplacePanelTap at each rect centre.
export function marketplacePanelFocusables(rect, state = {}) {
  const hit = state._hit; if (!hit) return [];
  const out = [];
  for (const t of hit.tabs) out.push({ rect: t.r });
  if (state.tab === "sell") {
    for (const t of (hit.curTabs || [])) out.push({ rect: t.r });
    if (hit.price) for (const b of hit.price.buttons) out.push({ rect: b.r });
  }
  for (const row of hit.rows) out.push({ rect: row.br });
  return out;
}
