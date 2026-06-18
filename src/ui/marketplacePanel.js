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
const PRICE_MIN = 10, PRICE_MAX = 999999, PRICE_STEP_DEF = 100;

const REASON_TEXT = {
  busy: "Finish your run before trading.",
  essence_disabled: "Essence trading isn't available.",
  need_gold: "Not enough gold.",
  no_listing: "That listing is gone.",
  own_listing: "That's your own listing.",
  not_owned: "You don't own that monster.",
  price_required: "Set a price first.",
  seller_mismatch: "Couldn't reach the seller.",
};

const listings = () => (net.state.market && net.state.market.listings) || [];
const vault = () => net.state.vault || [];
const gold = () => net.state.gold || 0;

export function marketplacePanelState() {
  net.marketBrowse(); // pull live listings on open
  return { tab: "browse", scrollY: 0, _maxScroll: 0, price: PRICE_STEP_DEF, seenResultAt: 0, statusMsg: "", statusT: -10, _hit: null };
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

  // Surface async results: when a fresh market reply lands, toast its outcome and refresh the browse list.
  const res = net.state.marketResult;
  if (res && res.at && res.at !== state.seenResultAt) {
    state.seenResultAt = res.at;
    state.statusMsg = res.ok ? "Done." : (REASON_TEXT[res.reason] || "Couldn't complete that.");
    state.statusT = k.time();
    if (res.ok) net.marketBrowse(); // a list/cancel/buy changed the board → re-pull
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
    k.drawText({ text: state.statusMsg, pos: k.vec2(rx + rw / 2, ry + TABH + 10 + CUR_H + 2), size: 12, font: FONT, anchor: "center", color: T(state.statusMsg === "Done." ? "success" : "warn"), fixed: true });
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
    k.drawText({ text: `${l.gold}g${l.essence ? "  +" + l.essence + "e" : ""}`, pos: k.vec2(r[0] + 64, r[1] + 50), size: 12, font: FONT, color: T("amber"), fixed: true });
    const br = btnR(r);
    if (l.mine) {
      drawButton(k, { rect: br, text: "Cancel", size: 13, fill: THEME.surfaceAlt, textColor: THEME.danger, outline: THEME.danger, hover: inRect(mp, br), fixed: true });
    } else {
      const aff = gold() >= (l.gold || 0) && (l.essence || 0) === 0; // essence listings can't be bought client-side (gated)
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
  // Price stepper (pinned just under the header) — shared gold price for the next List.
  const psY = top0 - 2, psH = 30;
  k.drawText({ text: "Price", pos: k.vec2(rx + 4, psY + 8), size: 12, font: FONT, color: T("textMut"), fixed: true });
  const steps = [["-50", -50], ["-10", -10], ["+10", 10], ["+50", 50]];
  const sbw = 44, sgap = 6;
  const valW = 86, valX = rx + 46;
  k.drawRect({ pos: k.vec2(valX, psY), width: valW, height: psH, radius: 8, color: T("surface2"), fixed: true });
  k.drawText({ text: `${state.price}g`, pos: k.vec2(valX + valW / 2, psY + 15), size: 14, font: FONT, anchor: "center", color: T("amber"), fixed: true });
  let bx = valX + valW + 10;
  hit.price = { buttons: [] };
  for (const [label, delta] of steps) {
    const r = [bx, psY, sbw, psH];
    drawButton(k, { rect: r, text: label, size: 12, fill: THEME.surfaceAlt, textColor: THEME.text, outline: THEME.line, hover: inRect(mp, r), fixed: true });
    hit.price.buttons.push({ r, delta });
    bx += sbw + sgap;
  }
  // Vault rows.
  const rowsTopSell = psY + psH + 12;
  const rowR = (i) => { const top = rowsTopSell - state.scrollY; return [rx, top + i * (ROW_H + ROW_GAP), rw, ROW_H]; };
  if (v.length === 0) {
    k.drawText({ text: "Your vault is empty — catch monsters in a run, then list the spares here.", pos: k.vec2(rx + rw / 2, rowsTopSell + 30), size: 13, font: FONT, anchor: "center", width: rw - 40, align: "center", color: T("textMut"), fixed: true });
  }
  for (let i = 0; i < v.length; i++) {
    const m = v[i], r = rowR(i);
    if (r[1] + r[3] < rowsTopSell || r[1] > ry + rh) continue;
    drawRowBase(k, r, m);
    const br = btnR(r);
    drawButton(k, { rect: br, text: `List ${state.price}g`, size: 11, fill: THEME.violet, hover: inRect(mp, br), fixed: true });
    hit.rows.push({ i, r, br, monId: m.id, clipTop: rowsTopSell });
  }
  // Mask the band above the vault rows so they scroll under the price stepper.
  k.drawRect({ pos: k.vec2(rx, ry), width: rw, height: rowsTopSell - ry, color: T("surface"), fixed: true });
  // Re-draw header band content over the mask is handled by the caller (currency/tabs); the price row sits
  // between, so re-draw it here over the mask.
  k.drawText({ text: "Price", pos: k.vec2(rx + 4, psY + 8), size: 12, font: FONT, color: T("textMut"), fixed: true });
  k.drawRect({ pos: k.vec2(valX, psY), width: valW, height: psH, radius: 8, color: T("surface2"), fixed: true });
  k.drawText({ text: `${state.price}g`, pos: k.vec2(valX + valW / 2, psY + 15), size: 14, font: FONT, anchor: "center", color: T("amber"), fixed: true });
  bx = valX + valW + 10;
  for (const [label, delta] of steps) { const r = [bx, psY, sbw, psH]; drawButton(k, { rect: r, text: label, size: 12, fill: THEME.surfaceAlt, textColor: THEME.text, outline: THEME.line, hover: inRect(mp, r), fixed: true }); void delta; bx += sbw + sgap; }
  state._maxScroll = Math.max(0, v.length * (ROW_H + ROW_GAP) + 8 - ((ry + rh) - rowsTopSell));
  if (state.scrollY > state._maxScroll) state.scrollY = state._maxScroll;
  if (state._maxScroll > 0) drawScrollbar(k, { top: rowsTopSell, trackH: (ry + rh) - rowsTopSell, contentH: v.length * (ROW_H + ROW_GAP) + 8, scrollY: state.scrollY, maxScroll: state._maxScroll });
}

export function marketplacePanelTap(k, rect, state, p, showToast) {
  const hit = state._hit; if (!hit) return false;
  for (const t of hit.tabs) if (inRect(p, t.r)) { if (state.tab !== t.id) { sfx("click"); state.tab = t.id; state.scrollY = 0; } return true; }
  if (state.tab === "sell" && hit.price) {
    for (const b of hit.price.buttons) if (inRect(p, b.r)) {
      state.price = Math.max(PRICE_MIN, Math.min(PRICE_MAX, state.price + b.delta));
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
      haptic(8); sfx("click"); showToast && showToast("Buying…"); net.marketBuy(row.listingId); return true;
    } else {
      haptic(8); sfx("click"); showToast && showToast("Listing…"); net.marketList(row.monId, state.price, 0); return true;
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
  if (state.tab === "sell" && hit.price) for (const b of hit.price.buttons) out.push({ rect: b.r });
  for (const row of hit.rows) out.push({ rect: row.br });
  return out;
}
