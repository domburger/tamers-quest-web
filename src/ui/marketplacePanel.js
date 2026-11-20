import { net } from "../netClient.js";
import { getMonsterType } from "../engine/gamedata.js";
import { THEME, FONT, FONT_BOLD, drawRow, drawGlass, drawButton, drawCurrency, drawScrollbar, drawTabs, drawEmptyState, inRect } from "./theme.js";
import { drawMonsterIcon, slugOf } from "../render/monster.js";
import { drawSheetMask, sheetAccent } from "./stationPopup.js";
import { sfx, haptic } from "../systems/audio.js";

const TABH = 30, CUR_H = 30;
const ROW_H = 64, ROW_GAP = 8;
const PRICE_MAX = 999999;
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
const priceLabel = (l) => { const p = []; if (l.gold > 0) p.push(`${l.gold}g`); if (l.essence > 0) p.push(`${l.essence}e`); return p.join("  +  ") || "0g"; };
const curPrice = (state) => (state.cur === "essence" ? state.priceEssence : state.priceGold);

export function marketplacePanelState() {
  net.marketBrowse();
  return { tab: "browse", cur: "gold", priceGold: CUR.gold.def, priceEssence: CUR.essence.def, scrollY: 0, _maxScroll: 0, seenResultAt: 0, seenSalesAt: 0, saleQueue: [], statusMsg: "", statusT: -10, lastBrowseT: 0, _hit: null };
}

const rowsTop = (rect) => rect[1] + TABH + 10 + CUR_H + 4;
const rowRect = (rect, i, state) => { const top = rowsTop(rect) - state.scrollY; return [rect[0], top + i * (ROW_H + ROW_GAP), rect[2], ROW_H]; };
const BW = 92, BH = 28;
const btnR = (r) => [r[0] + r[2] - BW - 10, r[1] + r[3] / 2 - BH / 2, BW, BH];
const fitText = (s, w, sz) => { const m = Math.max(3, Math.floor(w / (sz * 0.56))); return (s || "").length > m ? s.slice(0, m - 1) + "…" : s; };

function monLabel(m) { const t = getMonsterType(m.typeName); return (m.name || (t && t.name) || m.typeName || "Monster"); }

export function drawMarketplacePanel(k, rect, state) {
  const [rx, ry, rw] = rect;
  const T = (n) => k.rgb(...(THEME[n] || [255, 255, 255]));
  const mp = k.mousePos();
  const hit = { tabs: [], rows: [], price: null, status: null };

  if (state.tab === "browse") {
    if (state.lastBrowseT === 0) state.lastBrowseT = k.time();
    else if (k.time() - state.lastBrowseT > 5) { state.lastBrowseT = k.time(); net.marketBrowse(); }
  }

  const res = net.state.marketResult;
  if (res && res.at && res.at !== state.seenResultAt) {
    state.seenResultAt = res.at;
    state.statusMsg = res.ok ? "Done." : (REASON_TEXT[res.reason] || "Couldn't complete that.");
    state.statusT = k.time();
    if (res.ok) net.marketBrowse();
  }
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

  if (state.tab === "browse") drawBrowse(k, rect, state, hit, mp);
  else drawSell(k, rect, state, hit, mp);

  drawSheetMask(k, [rx, ry - 2, rw, TABH + 10 + CUR_H + 6]);
  drawCurrency(k, { x: rx + rw / 2, y: ry + TABH + 10 + 15, anchor: "center", size: 15, fixed: true,
    items: [{ kind: "gold", value: net.state.gold }, { kind: "essence", value: net.state.essence }] });
  const tabs = [["browse", "Browse", "market"], ["sell", "Sell", "coin"]];
  for (const t of drawTabs(k, { rect: [rx, ry, rw, TABH + 6], tabs, active: state.tab, pointer: mp, size: 15, accent: sheetAccent(), animKey: "market-tabs", fixed: true })) hit.tabs.push(t);
  if (k.time() - state.statusT < 2.6 && state.statusMsg) {
    const good = state.statusMsg === "Done." || state.statusMsg.startsWith("Sold ");
    k.drawText({ text: state.statusMsg, pos: k.vec2(rx + rw / 2, ry + TABH + 10 + CUR_H + 2), size: 12, font: FONT, anchor: "center", color: T(good ? "success" : "warn"), fixed: true });
  }
  state._hit = hit;
}

function drawRowBase(k, r, mon) {
  const T = (n) => k.rgb(...(THEME[n] || [255, 255, 255]));
  drawRow(k, { rect: r, radius: 16, fixed: true });
  drawGlass(k, { rect: [r[0] + 10, r[1] + 8, 48, 48], radius: 14, fill: 0.05, line: 0.1, fixed: true });
  drawMonsterIcon(k, { sprite: slugOf(mon.typeName), typeName: mon.typeName, cx: r[0] + 34, cy: r[1] + r[3] / 2, scale: 0.5, topY: r[1] + 6, fixed: true });
  const textMaxW = Math.max(70, r[2] - 68 - BW - 16);
  k.drawText({ text: fitText(monLabel(mon), textMaxW, 14), pos: k.vec2(r[0] + 68, r[1] + 12), size: 15, font: FONT_BOLD, color: T("text"), fixed: true });
  k.drawText({ text: fitText(`Lv.${mon.level || 1}   ${getMonsterType(mon.typeName)?.name ? mon.typeName : "spirit"}`, textMaxW, 11), pos: k.vec2(r[0] + 68, r[1] + 34), size: 11, font: FONT, color: T("textMut"), fixed: true });
  return textMaxW;
}

function drawBrowse(k, rect, state, hit, mp) {
  const [rx, ry, rw, rh] = rect;
  const T = (n) => k.rgb(...(THEME[n] || [255, 255, 255]));
  const list = listings();
  const top0 = rowsTop(rect);
  if (list.length === 0) {
    drawEmptyState(k, { rect: [rx, top0, rw, (ry + rh) - top0], icon: "market", title: "No listings yet", text: "Be the first to sell a monster on the Sell tab. Other tamers see it instantly.", accent: sheetAccent(), fixed: true });
  }
  for (let i = 0; i < list.length; i++) {
    const l = list[i], r = rowRect(rect, i, state);
    if (r[1] + r[3] < top0 || r[1] > ry + rh) continue;
    const textMaxW = drawRowBase(k, r, l.mon);
    k.drawText({ text: fitText(priceLabel(l), textMaxW, 12), pos: k.vec2(r[0] + 68, r[1] + 50), size: 12, font: FONT_BOLD, color: T(l.essence > 0 && l.gold === 0 ? "violet" : "amber"), fixed: true });
    const br = btnR(r);
    if (l.mine) {
      drawButton(k, { rect: br, text: "Cancel", size: 13, fill: THEME.surfaceAlt, textColor: THEME.danger, outline: THEME.danger, hover: inRect(mp, br), fixed: true });
    } else {
      const aff = gold() >= (l.gold || 0) && essence() >= (l.essence || 0);
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
  const net = Math.max(0, price - Math.floor(price * feePct()));
  const tgY = top0 - 4, tgH = 26;
  const tgW = Math.min(96, (rw - 8) / 2 - 4);
  const psY = tgY + tgH + 8, psH = 30;
  const feeY = psY + psH + 4;
  const steps = cc.steps;
  const sgap = 6, gapAfterVal = 8, valX = rx + 46;
  const valW = Math.min(86, Math.max(58, rw * 0.22));
  const region = (rx + rw) - (valX + valW + gapAfterVal);
  const sbw = Math.max(30, Math.min(56, Math.floor((region - sgap * 3) / 4)));
  const stepX = (i) => valX + valW + gapAfterVal + i * (sbw + sgap);
  const drawHead = (record) => {
    if (record) { hit.price = { buttons: [] }; hit.curTabs = []; }
    [["gold", "Gold"], ["essence", "Essence"]].forEach(([id, label], i) => {
      const r = [rx + i * (tgW + 8), tgY, tgW, tgH], on = state.cur === id;
      drawButton(k, { rect: r, text: label, size: 12, fill: on ? THEME[CUR[id].color] : THEME.surfaceAlt, textColor: on ? THEME.textInv : THEME.text, outline: on ? THEME[CUR[id].color] : THEME.line, hover: inRect(mp, r), fixed: true });
      if (record) hit.curTabs.push({ id, r });
    });
    k.drawText({ text: "Price", pos: k.vec2(rx + 4, psY + 8), size: 12, font: FONT, color: T("textMut"), fixed: true });
    drawGlass(k, { rect: [valX, psY, valW, psH], radius: 10, fill: 0.04, line: 0.14, fixed: true });
    k.drawText({ text: `${price}${cc.suffix}`, pos: k.vec2(valX + valW / 2, psY + 15), size: 14, font: FONT, anchor: "center", color: T(cc.color), fixed: true });
    for (let i = 0; i < steps.length; i++) {
      const r = [stepX(i), psY, sbw, psH];
      drawButton(k, { rect: r, text: steps[i][0], size: 12, fill: THEME.surfaceAlt, textColor: THEME.text, outline: THEME.line, hover: inRect(mp, r), fixed: true });
      if (record) hit.price.buttons.push({ r, delta: steps[i][1] });
    }
    k.drawText({ text: `${Math.round(feePct() * 100)}% market fee — you receive ${net}${cc.suffix}`, pos: k.vec2(rx + rw / 2, feeY + 6), size: 11, font: FONT, anchor: "center", color: T("textMut"), fixed: true });
  };
  drawHead(true);
  const rowsTopSell = feeY + 18;
  const rowR = (i) => { const top = rowsTopSell - state.scrollY; return [rx, top + i * (ROW_H + ROW_GAP), rw, ROW_H]; };
  if (v.length === 0) {
    drawEmptyState(k, { rect: [rx, rowsTopSell, rw, (ry + rh) - rowsTopSell], icon: "vault", title: "Nothing to sell yet", text: "Catch monsters in a run, then list the spares here for gold.", accent: sheetAccent(), fixed: true });
  }
  for (let i = 0; i < v.length; i++) {
    const m = v[i], r = rowR(i);
    if (r[1] + r[3] < rowsTopSell || r[1] > ry + rh) continue;
    drawRowBase(k, r, m);
    const br = btnR(r);
    drawButton(k, { rect: br, text: `List ${price}${cc.suffix}`, size: 11, fill: THEME.violet, hover: inRect(mp, br), fixed: true });
    hit.rows.push({ i, r, br, monId: m.id, clipTop: rowsTopSell });
  }
  drawSheetMask(k, [rx, ry - 2, rw, rowsTopSell - ry + 2]);
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
    if (row.clipTop != null && p.y < row.clipTop) continue;
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
  return true;
}

export function marketplacePanelScroll(state, dy) { state.scrollY = Math.max(0, Math.min(state._maxScroll, state.scrollY + dy)); }

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
