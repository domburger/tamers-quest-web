// TQ-388 (epic TQ-99 lobby station-popup work): VAULT content for the in-lobby station popup.
// Re-implements roster.js's team / spirit-chain / items management in the shell's immediate-mode
// draw(k,rect,state)+tap+scroll contract, so the Vault opens as a popup OVER the dimmed village
// instead of switching to the full `roster` scene (the player never leaves the lobby). roster.js
// itself stays the standalone out-of-lobby fallback route (k.go("roster") — the SAME server-
// authoritative net handlers back both, so they're interchangeable).
//
// Parity note: roster.js's hold-to-drag-and-drop (INV-T8) needs press/hold/move pointer granularity
// the popup shell doesn't expose (it routes tap-on-release + scroll-on-move only). The CANONICAL
// management path — tap a card to inspect, then Field / Store / Release — is fully ported here, so
// functional parity holds (you can do everything you can in the scene); drag is a scene-only
// convenience. All draws are fixed:true (screen-space) because the hub's camera tracks the player;
// a world-space draw would render off-popup. The shared monster-detail (with the action footer) is a
// MODAL drawn outside the shell's content clip — state.modalCapturesInput tells the host to route all
// taps here while it's open (mirrors profilePanel's rename modal).
import { net } from "../netClient.js";
import { getMonsterType, getSpiritChain } from "../engine/gamedata.js";
import { getMonsterStats, getMonsterMaxHp } from "../engine/stats.js";
import { THEME, PAL, FONT, accentColor, hpColor, drawButton, drawPanel, drawScrollbar, inRect } from "./theme.js";
import { sortMonsters, nextSortMode, SORT_LABELS, sortChainsByTier, searchMonsters } from "../engine/rosterSort.js";
import { vaultCapacity } from "../engine/upgrades.js";
import { GAME } from "../engine/schemas.js";
import { itemRarity } from "../engine/items.js";
import { drawChainGlyph } from "../render/chainCosmetics.js";
import { xpForLevel } from "../engine/progression.js";
import { drawMonsterDetail, monsterDetailRect } from "./monsterDetail.js";
import { drawMonsterIcon, slugOf } from "../render/monster.js";
import { rasterizeHtmlModel, hasHtmlVisual } from "../render/htmlRaster.js"; // TQ-393: free HTML/CSS item icon (the only item-icon path now)
import { sfx } from "../systems/audio.js";

const TEAM_MAX = 4;
const TABH = 30, GAP = 12;
const CARD_W = 132, CARD_H = 110;
const CHAIN_W = 244, CHAIN_H = 88, CHAIN_GAP = 12;
const ITEM_W = 248, ITEM_H = 56, ITEM_GAP = 10;
const SPECIAL_LABEL = { endless: "never depletes", guaranteed: "guaranteed catch ≤25% HP", multi: "captures nearby monsters" };
const RARITY_COL = { common: THEME.textMut, uncommon: THEME.success, rare: THEME.teal, epic: THEME.violet, legendary: THEME.amber };
const INSP_FOOT = 80;

export function rosterPanelState() {
  const state = {
    tab: "monsters",
    active: [...(net.state.team || [])],
    vault: [...(net.state.vault || [])],
    scrollY: 0, _maxScroll: 0,
    sortMode: "recent", searchQ: "", searchInput: null,
    inspect: null, releaseArm: false,
    modalCapturesInput: false, // host routes all taps to tap() while an inspect modal is open
    _hit: null,
    _itemIcon: { loaded: new Set(), pending: new Set() },
    _vv: { view: null, vault: null, sort: null, search: null },
    reconcile() {
      state.active = [...(net.state.team || [])];
      state.vault = [...(net.state.vault || [])];
      state.inspect = null; state.releaseArm = false; state.modalCapturesInput = false;
      state._vv.view = null;
      state.scrollY = Math.min(state.scrollY, state._maxScroll);
    },
    // Esc handler the host calls: close the inspect / search first, only then the popup.
    onEsc() {
      if (state.inspect) { state.inspect = null; state.releaseArm = false; state.modalCapturesInput = false; return true; }
      if (state.searchInput) { closeSearchInput(state); state.searchQ = ""; state._vv.view = null; return true; }
      return false;
    },
    dispose() { closeSearchInput(state); },
  };
  return state;
}

// Memoized filter→sort→search view of the vault (identity-stable; same pattern as roster.js).
function viewVault(state) {
  const v = state._vv;
  if (v.view && v.vault === state.vault && v.sort === state.sortMode && v.search === state.searchQ) return v.view;
  v.view = searchMonsters(sortMonsters(state.vault, state.sortMode, getMonsterType), state.searchQ, getMonsterType);
  v.vault = state.vault; v.sort = state.sortMode; v.search = state.searchQ;
  return v.view;
}
const ownedChains = () => (net.state.chains || []).map((cs) => ({ cs, def: getSpiritChain(cs.chainId) })).filter((c) => c.def);
const viewChains = () => sortChainsByTier(ownedChains());
const loadout = () => (net.state.equippedChainIds || []);

// ── server-authoritative mutations (mirror roster.js; the "roster" echo reconciles) ──
const sync = (state) => net.setRoster(state.active.map((m) => m.id));
function fieldFromVault(state, mon, showToast) {
  if (state.active.length >= TEAM_MAX) { showToast && showToast("Team is full (4). Store one first."); return; }
  if (!state.vault.includes(mon)) return;
  state.vault = state.vault.filter((x) => x !== mon); state._vv.view = null;
  state.active.push(mon); sync(state); sfx("click");
}
function storeFromActive(state, slot, showToast) {
  if (slot >= state.active.length) return;
  if (state.active.length <= 1) { showToast && showToast("You need at least one monster on your team."); return; }
  if (state.vault.length >= vaultCapacity(net.state, GAME.VAULT_SIZE)) { showToast && showToast("Vault is full. Release or upgrade Deep Vault first."); return; }
  const [m] = state.active.splice(slot, 1);
  state.vault = [m, ...state.vault]; state._vv.view = null;
  sync(state); sfx("click");
}
function applyLoadout(ids) {
  net.setChainSlots(ids);
  net.state.equippedChainIds = ids;
  if (!ids.includes(net.state.equippedChainId)) net.state.equippedChainId = ids[0] || null;
  sfx("click");
}
function toggleLoadout(state, idx, showToast) {
  const c = viewChains()[idx]; if (!c) return;
  const id = c.cs.chainId, ids = [...loadout()], at = ids.indexOf(id), max = GAME.SPIRIT_CHAIN.CHAIN_SLOTS;
  if (at >= 0) { ids.splice(at, 1); showToast && showToast(`Removed ${c.def.name}`); }
  else if (ids.length >= max) { showToast && showToast(`Loadout full (${max}) — clear a slot first`); return; }
  else { ids.push(id); showToast && showToast(`Added ${c.def.name} to slot ${ids.length}`); }
  applyLoadout(ids);
}
function clearSlot(state, i, showToast) {
  const ids = [...loadout()]; if (i < 0 || i >= ids.length) return;
  const def = getSpiritChain(ids[i]); ids.splice(i, 1); applyLoadout(ids);
  showToast && showToast(def ? `Cleared ${def.name}` : "Slot cleared");
}

// ── item icon lazy-bake (mirrors roster.drawItems) — TQ-393: free HTML/CSS icon only (legacy shape path removed) ──
const itemIconKey = (it) => (it && it.id != null && hasHtmlVisual(it.html)) ? "itemicon_" + it.id : null;
function ensureItemIcon(k, cache, key, it) {
  if (!key || cache.loaded.has(key) || cache.pending.has(key)) return;
  cache.pending.add(key);
  rasterizeHtmlModel(it.html, { size: 64, transparent: true }).then((cv) => {
    if (!cv) { cache.pending.delete(key); return; }
    try { Promise.resolve(k.loadSprite(key, cv)).then(() => { cache.loaded.add(key); cache.pending.delete(key); }).catch(() => cache.pending.delete(key)); }
    catch { cache.pending.delete(key); }
  }).catch(() => cache.pending.delete(key));
}

function drawCard(k, x, y, m, { slotLabel = null, hover = false, cardW = CARD_W } = {}) {
  const col = (t) => k.rgb(...t);
  const mt = getMonsterType(m.typeName);
  const ec = accentColor();
  if (hover) k.drawRect({ pos: k.vec2(x - 4, y - 4), width: cardW + 8, height: CARD_H + 8, radius: 14, color: col(ec), opacity: 0.22, fixed: true });
  drawPanel(k, { rect: [x, y, cardW, CARD_H], radius: 12, fill: hover ? THEME.surface2 : THEME.surface, border: ec, borderW: hover ? 3 : 2, fixed: true });
  drawMonsterIcon(k, { sprite: slugOf(m.typeName), typeName: m.typeName, cx: x + cardW / 2, cy: y + 40, scale: 0.56, topY: y + 2, fixed: true });
  k.drawRect({ pos: k.vec2(x + 6, y + 64), width: cardW - 12, height: 32, radius: 8, color: col(THEME.bg), opacity: 0.55, fixed: true });
  const nm0 = m.name || m.typeName || "", avail = cardW - 14;
  const nmSize = Math.max(8.5, Math.min(13, avail / Math.max(1, nm0.length * 0.56)));
  const fitN = Math.max(4, Math.floor(avail / (nmSize * 0.56)));
  const nm = nm0.length > fitN ? nm0.slice(0, fitN - 1).trimEnd() + "…" : nm0;
  k.drawText({ text: nm, pos: k.vec2(x + cardW / 2, y + 72), size: nmSize, font: FONT, anchor: "center", color: col(THEME.text), fixed: true });
  k.drawText({ text: `Lv.${m.level}`, pos: k.vec2(x + cardW / 2, y + 88), size: 11, font: FONT, anchor: "center", width: cardW - 8, color: col(THEME.textMut), fixed: true });
  let maxHp = m.currentHealth;
  try { maxHp = getMonsterMaxHp(mt, m.level); } catch {}
  const frac = maxHp > 0 ? Math.max(0, Math.min(1, (m.currentHealth ?? maxHp) / maxHp)) : 1;
  k.drawRect({ pos: k.vec2(x + 12, y + CARD_H - 12), width: cardW - 24, height: 5, radius: 2, color: col(THEME.line), fixed: true });
  k.drawRect({ pos: k.vec2(x + 12, y + CARD_H - 12), width: (cardW - 24) * frac, height: 5, radius: 2, color: col(hpColor(frac)), fixed: true });
  if (slotLabel) k.drawText({ text: slotLabel, pos: k.vec2(x + 8, y + 6), size: 11, font: FONT, color: col(THEME.textMut), fixed: true });
}

// TQ-527: focus targets for controller nav, read from the hitboxes the draw records in state._hit (so the
// rects always match what's tapped). Tabs, then the active tab's actionable cells: monsters = sort + filled
// team slots + vault cards; chains = chain slots + owned chains. A activates via rosterPanelTap at the cell
// centre (switch tab / open a monster's inspect modal / etc.). Empty when an inspect modal is open or before
// the first draw. (Hold-to-drag reorder + the in-modal Store/Field/Release stay mouse-only for now.)
export function rosterPanelFocusables(_rect, state) {
  const hit = state._hit;
  if (!hit || state.modalCapturesInput) return [];
  const out = [];
  for (const t of hit.tabs) out.push({ rect: t.r });
  if (state.tab === "monsters") {
    if (hit.sort) out.push({ rect: hit.sort });
    for (const s of hit.activeSlots) if (s.i < (state.active ? state.active.length : 0)) out.push({ rect: s.r });
    for (const c of hit.vaultCards) out.push({ rect: c.r });
  } else if (state.tab === "chains") {
    for (const s of hit.slots) out.push({ rect: s.r });
    for (const c of hit.chains) out.push({ rect: c.r });
  }
  return out;
}

export function drawRosterPanel(k, rect, state) {
  const [rx, ry, rw, rh] = rect;
  const col = (t) => k.rgb(...t);
  const T = (n) => k.rgb(...(THEME[n] || [255, 255, 255]));
  const mp = k.mousePos();
  const hit = { tabs: [], activeSlots: [], vaultCards: [], chains: [], slots: [], sort: null, search: null };
  const contentTop = ry + TABH + 10;

  // Tab CONTENT first — each tab draws its own band mask (so cards scroll under the top band), so the
  // tab row must be drawn AFTER it, or the mask paints over the buttons (they were invisible at portrait).
  if (state.tab === "monsters") {
    drawMonstersTab(k, rect, state, hit, contentTop);
  } else if (state.tab === "chains") {
    drawChainsTab(k, rect, state, hit, contentTop);
  } else {
    drawItemsTab(k, rect, state, contentTop);
  }

  // ── Tab row (Team / Chains / Items) — drawn LAST so it composites above any band mask ──
  const tabs = [["monsters", "Team"], ["chains", "Chains"], ["items", "Items"]];
  const tabW = (rw - GAP * (tabs.length - 1)) / tabs.length;
  tabs.forEach(([id, label], i) => {
    const r = [rx + i * (tabW + GAP), ry, tabW, TABH], on = state.tab === id;
    drawButton(k, { rect: r, text: label, size: 14, fill: on ? THEME.primary : THEME.surfaceAlt, textColor: on ? THEME.textInv : THEME.text, outline: on ? THEME.primary : THEME.line, hover: inRect(mp, r), fixed: true });
    hit.tabs.push({ id, r });
  });
  state._hit = hit;
}

function drawMonstersTab(k, rect, state, hit, contentTop) {
  const [rx, ry, rw, rh] = rect;
  const col = (t) => k.rgb(...t);
  const mp = k.mousePos();
  const teamLabelY = contentTop;
  const activeTop = contentTop + 22;
  const activeCardW = Math.min(CARD_W, (rw - (TEAM_MAX - 1) * GAP) / TEAM_MAX);
  const activeGridW = TEAM_MAX * activeCardW + (TEAM_MAX - 1) * GAP;
  const activeX0 = rx + (rw - activeGridW) / 2;
  const activeBottom = activeTop + CARD_H;
  const vaultLabelY = activeBottom + 14;
  const vaultTop = vaultLabelY + 24;
  const cols = Math.max(1, Math.floor((rw + GAP) / (CARD_W + GAP)));
  const vaultGridW = cols * CARD_W + (cols - 1) * GAP;
  const vaultX0 = rx + (rw - vaultGridW) / 2;
  const view = viewVault(state);
  const rows = Math.ceil(view.length / cols);
  const contentH = rows * (CARD_H + GAP) + GAP;
  const regionH = (ry + rh) - vaultTop;
  state._maxScroll = Math.max(0, contentH - regionH);
  if (state.scrollY > state._maxScroll) state.scrollY = state._maxScroll;

  // Vault grid (scrolls up under the top band drawn afterwards).
  const top = vaultTop - state.scrollY;
  for (let i = 0; i < view.length; i++) {
    const y = top + Math.floor(i / cols) * (CARD_H + GAP);
    const x = vaultX0 + (i % cols) * (CARD_W + GAP);
    if (y + CARD_H < vaultTop || y > ry + rh) continue; // cull
    const hover = inRect(mp, [x, y, CARD_W, CARD_H]) && mp.y >= vaultTop;
    drawCard(k, x, y, view[i], { hover });
    hit.vaultCards.push({ mon: view[i], r: [x, y, CARD_W, CARD_H], clipTop: vaultTop });
  }
  // Mask the top band so vault cards scroll UNDER it (matches the popup surface fill).
  k.drawRect({ pos: k.vec2(rx, ry), width: rw, height: vaultTop - ry, color: T_(k, "surface"), fixed: true });

  // Active team row.
  for (let i = 0; i < TEAM_MAX; i++) {
    const x = activeX0 + i * (activeCardW + GAP);
    if (i < state.active.length) {
      const hover = inRect(mp, [x, activeTop, activeCardW, CARD_H]);
      drawCard(k, x, activeTop, state.active[i], { slotLabel: `${i + 1}`, hover, cardW: activeCardW });
    } else {
      k.drawRect({ pos: k.vec2(x, activeTop), width: activeCardW, height: CARD_H, radius: 12, color: col(THEME.surfaceAlt), outline: { width: 2, color: col(THEME.line) }, fixed: true });
      k.drawText({ text: "empty", pos: k.vec2(x + activeCardW / 2, activeTop + CARD_H / 2), size: 12, font: FONT, anchor: "center", color: col(THEME.textMut), fixed: true });
    }
    hit.activeSlots.push({ i, r: [x, activeTop, activeCardW, CARD_H] });
  }
  // Labels + vault controls.
  k.drawText({ text: `Active team   ${state.active.length}/${TEAM_MAX}`, pos: k.vec2(rx + 4, teamLabelY), size: 14, font: FONT, color: col(THEME.text), fixed: true });
  const vcap = vaultCapacity(net.state, GAME.VAULT_SIZE);
  const vfull = state.vault.length >= vcap, vnear = state.vault.length >= vcap * 0.9;
  k.drawText({ text: `Vault   ${state.vault.length} / ${vcap}${vfull ? "   Full" : ""}`, pos: k.vec2(rx + 4, vaultLabelY), size: 14, font: FONT, color: col(vfull ? THEME.danger : vnear ? THEME.warn : THEME.text), fixed: true });
  if (state.vault.length > 1) {
    const ctlW = Math.min(150, Math.max(80, (rw - 170) / 2));
    const sx = rx + rw - ctlW * 2 - 8, sy = vaultLabelY - 3;
    const sr = [sx, sy, ctlW, 24], qr = [sx + ctlW + 8, sy, ctlW, 24];
    drawButton(k, { rect: sr, text: `Sort: ${SORT_LABELS[state.sortMode]}`, size: 12, radius: 8, fill: THEME.surfaceAlt, textColor: THEME.text, outline: THEME.line, hover: inRect(mp, sr), fixed: true });
    const qOn = !!state.searchQ;
    drawButton(k, { rect: qr, text: "", radius: 8, fill: qOn ? THEME.surface2 : THEME.surfaceAlt, outline: qOn ? THEME.primary : THEME.line, hover: inRect(mp, qr), fixed: true });
    k.drawText({ text: qOn ? `Search: ${state.searchQ}` : "Search…", pos: k.vec2(qr[0] + 10, qr[1] + 12), size: 12, font: FONT, anchor: "left", color: col(qOn ? THEME.text : THEME.textBody), fixed: true });
    if (qOn) k.drawText({ text: "x", pos: k.vec2(qr[0] + qr[2] - 10, qr[1] + 12), size: 14, font: FONT, anchor: "right", color: col(THEME.textMut), fixed: true });
    hit.sort = sr; hit.search = { r: qr, clearX: qOn ? qr[0] + qr[2] - 28 : null };
  } else if (state.vault.length === 0) {
    k.drawText({ text: "Catch or loot monsters in a run to fill your vault.", pos: k.vec2(rx + rw / 2, vaultTop + 40), size: 13, font: FONT, anchor: "center", width: rw - 40, align: "center", color: col(THEME.textMut), fixed: true });
  }
  // Scrollbar.
  if (state._maxScroll > 0) drawScrollbar(k, { top: vaultTop, trackH: (ry + rh) - vaultTop, contentH, scrollY: state.scrollY, maxScroll: state._maxScroll });
}

function drawChainsTab(k, rect, state, hit, contentTop) {
  const [rx, ry, rw, rh] = rect;
  const col = (t) => k.rgb(...t);
  const mp = k.mousePos();
  const max = GAME.SPIRIT_CHAIN.CHAIN_SLOTS;
  const ids = loadout();
  // Loadout slot row.
  const slotGap = 10, slotH = 60, slotTotalW = Math.min(rw, 520);
  const slotW = (slotTotalW - slotGap * (max - 1)) / max;
  const slotX0 = rx + (rw - slotTotalW) / 2;
  const slotTop = contentTop + 18;
  k.drawText({ text: `LOADOUT   ${ids.length}/${max}`, pos: k.vec2(rx + 4, contentTop), size: 13, font: FONT, color: col(THEME.text), fixed: true });
  for (let i = 0; i < max; i++) {
    const x = slotX0 + i * (slotW + slotGap), y = slotTop;
    const id = ids[i], def = id ? getSpiritChain(id) : null;
    const cs = id ? (net.state.chains || []).find((c) => c.chainId === id) : null;
    const isActive = id && id === net.state.equippedChainId, cc = def?.color || THEME.line;
    k.drawRect({ pos: k.vec2(x, y), width: slotW, height: slotH, radius: 10, color: col(def ? THEME.surface2 : THEME.surfaceAlt), outline: { width: isActive ? 3 : 2, color: col(isActive ? THEME.primary : def ? cc : THEME.line) }, fixed: true });
    k.drawText({ text: `Slot ${i + 1}`, pos: k.vec2(x + 8, y + 6), size: 10, font: FONT, color: col(THEME.textMut), fixed: true });
    if (def) {
      drawChainGlyph(k, def, { x: x + 17, y: y + 38, size: 20, fixed: true });
      const dn = def.name || "", davail = slotW - 36;
      const dnSize = Math.max(8.5, Math.min(12, davail / Math.max(1, dn.length * 0.55)));
      const dnFit = Math.max(4, Math.floor(davail / (dnSize * 0.52)));
      k.drawText({ text: dn.length > dnFit ? dn.slice(0, dnFit - 1).trimEnd() + "…" : dn, pos: k.vec2(x + 30, y + 26), size: dnSize, font: FONT, color: col(THEME.text), fixed: true });
      k.drawText({ text: `${cs ? cs.durability : "?"} charges`, pos: k.vec2(x + 30, y + 42), size: 10, font: FONT, color: col(THEME.textBody), fixed: true });
      k.drawText({ text: "clear", pos: k.vec2(x + slotW - 8, y + 6), size: 10, font: FONT, anchor: "topright", color: col(THEME.textMut), fixed: true });
    } else {
      k.drawText({ text: "empty", pos: k.vec2(x + slotW / 2, y + slotH / 2 + 4), size: 12, font: FONT, anchor: "center", color: col(THEME.textMut), fixed: true });
    }
    hit.slots.push({ i, r: [x, y, slotW, slotH], filled: !!def });
  }
  // Owned chains grid (scrolls under the loadout band).
  const list = viewChains();
  const chainTop = slotTop + slotH + 28;
  const cc = Math.max(1, Math.floor((rw + CHAIN_GAP) / (CHAIN_W + CHAIN_GAP)));
  const gridW = cc * CHAIN_W + (cc - 1) * CHAIN_GAP, cx0 = rx + (rw - gridW) / 2;
  const rows = Math.ceil(list.length / cc);
  const contentH = rows * (CHAIN_H + CHAIN_GAP) + CHAIN_GAP;
  const regionH = (ry + rh) - chainTop;
  state._maxScroll = Math.max(0, contentH - regionH);
  if (state.scrollY > state._maxScroll) state.scrollY = state._maxScroll;
  const top = chainTop - state.scrollY;
  for (let i = 0; i < list.length; i++) {
    const x = cx0 + (i % cc) * (CHAIN_W + CHAIN_GAP);
    const y = top + Math.floor(i / cc) * (CHAIN_H + CHAIN_GAP);
    if (y + CHAIN_H < chainTop || y > ry + rh) continue;
    drawChainCard(k, x, y, list[i].cs, list[i].def, ids.indexOf(list[i].cs.chainId));
    hit.chains.push({ idx: i, r: [x, y, CHAIN_W, CHAIN_H], clipTop: chainTop });
  }
  // Mask the loadout band.
  k.drawRect({ pos: k.vec2(rx, ry), width: rw, height: chainTop - ry, color: T_(k, "surface"), fixed: true });
  // Re-draw loadout label + slots over the mask (so chains scroll under).
  k.drawText({ text: `LOADOUT   ${ids.length}/${max}`, pos: k.vec2(rx + 4, contentTop), size: 13, font: FONT, color: col(THEME.text), fixed: true });
  for (const s of hit.slots) {
    const [x, y, w, h] = s.r, id = ids[s.i], def = id ? getSpiritChain(id) : null;
    const cs = id ? (net.state.chains || []).find((c) => c.chainId === id) : null;
    const isActive = id && id === net.state.equippedChainId, ccol = def?.color || THEME.line;
    k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius: 10, color: col(def ? THEME.surface2 : THEME.surfaceAlt), outline: { width: isActive ? 3 : 2, color: col(isActive ? THEME.primary : def ? ccol : THEME.line) }, fixed: true });
    k.drawText({ text: `Slot ${s.i + 1}`, pos: k.vec2(x + 8, y + 6), size: 10, font: FONT, color: col(THEME.textMut), fixed: true });
    if (def) {
      drawChainGlyph(k, def, { x: x + 17, y: y + 38, size: 20, fixed: true });
      const dn = def.name || "", davail = w - 36;
      const dnSize = Math.max(8.5, Math.min(12, davail / Math.max(1, dn.length * 0.55)));
      const dnFit = Math.max(4, Math.floor(davail / (dnSize * 0.52)));
      k.drawText({ text: dn.length > dnFit ? dn.slice(0, dnFit - 1).trimEnd() + "…" : dn, pos: k.vec2(x + 30, y + 26), size: dnSize, font: FONT, color: col(THEME.text), fixed: true });
      k.drawText({ text: `${cs ? cs.durability : "?"} charges`, pos: k.vec2(x + 30, y + 42), size: 10, font: FONT, color: col(THEME.textBody), fixed: true });
      k.drawText({ text: "clear", pos: k.vec2(x + w - 8, y + 6), size: 10, font: FONT, anchor: "topright", color: col(THEME.textMut), fixed: true });
    } else {
      k.drawText({ text: "empty", pos: k.vec2(x + w / 2, y + h / 2 + 4), size: 12, font: FONT, anchor: "center", color: col(THEME.textMut), fixed: true });
    }
  }
  k.drawText({ text: list.length ? `OWNED CHAINS   ${list.length}     tap to add or remove` : "No chains yet — find them in chests or buy them in the Spirit Shop.", pos: k.vec2(rx + 4, chainTop - 22), size: 12, font: FONT, color: col(THEME.textMut), fixed: true });
  if (state._maxScroll > 0) drawScrollbar(k, { top: chainTop, trackH: (ry + rh) - chainTop, contentH, scrollY: state.scrollY, maxScroll: state._maxScroll });
}

function drawChainCard(k, x, y, cs, def, slotIdx) {
  const col = (t) => k.rgb(...t);
  const cc = def.color || THEME.neutral, inLoadout = slotIdx >= 0;
  const isActive = inLoadout && cs.chainId === net.state.equippedChainId;
  drawPanel(k, { rect: [x, y, CHAIN_W, CHAIN_H], radius: 12, fill: inLoadout ? THEME.surface2 : THEME.surface, border: isActive ? THEME.primary : inLoadout ? THEME.success : cc, borderW: inLoadout ? 3 : 2, fixed: true });
  drawChainGlyph(k, def, { x: x + 24, y: y + 26, size: 28, fixed: true });
  k.drawText({ text: def.name, pos: k.vec2(x + 44, y + 14), size: 15, font: FONT, color: col(THEME.text), fixed: true });
  k.drawText({ text: `Tier ${def.tier}     ${def.catchPower || "spirit chain"}`, pos: k.vec2(x + 44, y + 34), size: 11, font: FONT, color: col(THEME.textMut), fixed: true });
  k.drawText({ text: `${cs.durability} capture charge${cs.durability === 1 ? "" : "s"}     free throws`, pos: k.vec2(x + 14, y + 56), size: 12, font: FONT, color: col(THEME.textBody), fixed: true });
  if (def.special && SPECIAL_LABEL[def.special]) k.drawText({ text: SPECIAL_LABEL[def.special], pos: k.vec2(x + 14, y + 74), size: 10, font: FONT, color: col(THEME.violet), fixed: true });
  if (inLoadout) k.drawText({ text: isActive ? `SLOT ${slotIdx + 1} - ACTIVE` : `SLOT ${slotIdx + 1}`, pos: k.vec2(x + CHAIN_W - 12, y + 14), size: 11, font: FONT, anchor: "topright", color: col(isActive ? THEME.primary : THEME.success), fixed: true });
}

function drawItemsTab(k, rect, state, contentTop) {
  const [rx, ry, rw, rh] = rect;
  const col = (t) => k.rgb(...t);
  const items = net.state.items || [];
  k.drawText({ text: `ITEMS   ${items.length}/${GAME.ITEM_BAG_SIZE}     used in battle (loot them from chests)`, pos: k.vec2(rx + 4, contentTop), size: 13, font: FONT, color: col(THEME.text), fixed: true });
  const itemTop = contentTop + 22;
  const c = Math.max(1, Math.floor((rw + ITEM_GAP) / (ITEM_W + ITEM_GAP)));
  const gridW = c * ITEM_W + (c - 1) * ITEM_GAP, x0 = rx + (rw - gridW) / 2;
  const rows = Math.ceil(GAME.ITEM_BAG_SIZE / c);
  const contentH = rows * (ITEM_H + ITEM_GAP) + ITEM_GAP;
  const regionH = (ry + rh) - itemTop;
  state._maxScroll = Math.max(0, contentH - regionH);
  if (state.scrollY > state._maxScroll) state.scrollY = state._maxScroll;
  const top = itemTop - state.scrollY;
  for (let i = 0; i < GAME.ITEM_BAG_SIZE; i++) {
    const x = x0 + (i % c) * (ITEM_W + ITEM_GAP);
    const y = top + Math.floor(i / c) * (ITEM_H + ITEM_GAP);
    if (y + ITEM_H < itemTop || y > ry + rh) continue;
    const it = items[i], rar = it ? itemRarity(it) : null;
    const rc = rar ? (RARITY_COL[rar] || THEME.primary) : THEME.line;
    k.drawRect({ pos: k.vec2(x, y), width: ITEM_W, height: ITEM_H, radius: 10, color: col(it ? THEME.surface : THEME.surfaceAlt), outline: { width: 2, color: col(rc) }, fixed: true });
    if (it) {
      const iconKey = itemIconKey(it);
      if (iconKey) ensureItemIcon(k, state._itemIcon, iconKey, it);
      const hasIcon = !!iconKey;
      if (hasIcon && state._itemIcon.loaded.has(iconKey)) {
        try { k.drawSprite({ sprite: iconKey, pos: k.vec2(x + 26, y + ITEM_H / 2), anchor: "center", width: 40, height: 40, fixed: true }); } catch {}
      }
      const tx = hasIcon ? x + 52 : x + 12;
      const nameW = hasIcon ? ITEM_W - 108 : ITEM_W - 64, descW = hasIcon ? ITEM_W - 60 : ITEM_W - 18;
      const inm = it.name || "", idesc = it.description || "";
      k.drawText({ text: inm.length > 28 ? inm.slice(0, 27).replace(/\s+\S*$/, "") + "…" : inm, pos: k.vec2(tx, y + 9), size: 13, font: FONT, width: nameW, color: col(THEME.text), fixed: true });
      k.drawText({ text: idesc.length > 92 ? idesc.slice(0, 89).replace(/\s+\S*$/, "") + "…" : idesc, pos: k.vec2(tx, y + 29), size: 10, font: FONT, width: descW, lineSpacing: 1, color: col(THEME.textMut), fixed: true });
      k.drawText({ text: rar.charAt(0).toUpperCase() + rar.slice(1), pos: k.vec2(x + ITEM_W - 10, y + 9), size: 9, font: FONT, anchor: "topright", color: col(rc), fixed: true });
    } else {
      k.drawText({ text: "empty", pos: k.vec2(x + ITEM_W / 2, y + ITEM_H / 2), size: 12, font: FONT, anchor: "center", color: col(THEME.textMut), fixed: true });
    }
  }
  if (state._maxScroll > 0) drawScrollbar(k, { top: itemTop, trackH: (ry + rh) - itemTop, contentH, scrollY: state.scrollY, maxScroll: state._maxScroll });
}

// helper to read a THEME color as a k color (used by the band masks)
function T_(k, n) { return k.rgb(...(THEME[n] || [255, 255, 255])); }

// ── inspect action-row geometry (shared with the scene; screen-centred) ──
const inspBtnRow = (k) => { const { px, py, PW, PH } = monsterDetailRect(k); const bw = Math.floor((PW - 60) / 3); return { x: px + 15, y: py + PH - 52, bw }; };
const inspActionRect = (k) => { const { x, y, bw } = inspBtnRow(k); return [x, y, bw, 44]; };
const inspReleaseRect = (k) => { const { x, y, bw } = inspBtnRow(k); return [x + bw + 15, y, bw, 44]; };
const inspCloseRect = (k) => { const { x, y, bw } = inspBtnRow(k); return [x + (bw + 15) * 2, y, bw, 44]; };

// The inspect MODAL — the shared monster-detail with the Field/Store · Release · Close footer,
// drawn by the host OUTSIDE the content clip (its own scrim, full screen). Mirrors roster.drawInspect.
export function drawRosterModal(k, state) {
  if (!state.inspect) return;
  const col = (t) => k.rgb(...t);
  const m = state.inspect.mon, mt = getMonsterType(m.typeName);
  if (!mt) { state.inspect = null; state.modalCapturesInput = false; return; }
  let stats = {}; try { stats = getMonsterStats(mt, m.level); } catch {}
  const maxHp = stats.health || Math.round(m.currentHealth) || 1;
  const xpNeed = xpForLevel(m.level), xpCur = Math.max(0, Math.min(xpNeed, m.xp || 0));
  const imp = k.mousePos();
  const total = state.active.length + state.vault.length;
  drawMonsterDetail(k, mt, {
    scrim: true, level: m.level,
    vitals: { currentHealth: Math.round(m.currentHealth ?? maxHp), maxHealth: maxHp, currentEnergy: Math.round(m.currentEnergy ?? stats.energy ?? 0), maxEnergy: stats.energy ?? 0, xp: xpCur, xpToNext: xpNeed },
    footerHeight: INSP_FOOT,
    footer: (_k, { px, py, PW, PH }) => {
      const eqChain = net.state.equippedChainId ? getSpiritChain(net.state.equippedChainId) : null;
      const lineY = py + PH - INSP_FOOT + 6;
      if (state.releaseArm) {
        k.drawText({ text: "frees this monster for gold", pos: k.vec2(px + PW / 2, lineY), size: 12, font: FONT, anchor: "center", color: col(THEME.warn), fixed: true });
      } else {
        const csText = eqChain ? `${eqChain.name}: ${eqChain.catchPower || "spirit chain"} — weaken, then catch` : "No chain equipped";
        k.drawText({ text: csText, pos: k.vec2(px + PW / 2, lineY), size: 12, font: FONT, anchor: "center", width: PW - 32, color: col(eqChain ? THEME.success : THEME.warn), fixed: true });
      }
      const fieldR = inspActionRect(k);
      drawButton(k, { rect: fieldR, text: state.inspect.source === "active" ? "Store" : "Field", size: 16, fill: THEME.primary, hover: inRect(imp, fieldR), fixed: true });
      if (total > 1) {
        const relR = inspReleaseRect(k);
        drawButton(k, { rect: relR, text: state.releaseArm ? "Confirm release" : "Release", size: state.releaseArm ? 14 : 16, fill: state.releaseArm ? THEME.danger : THEME.surfaceAlt, textColor: state.releaseArm ? THEME.textInv : THEME.danger, outline: THEME.danger, glow: THEME.danger, hover: inRect(imp, relR), fixed: true });
      }
      const closeR = inspCloseRect(k);
      drawButton(k, { rect: closeR, text: "Close", size: 16, fill: THEME.surfaceAlt, textColor: THEME.text, outline: THEME.line, hover: inRect(imp, closeR), fixed: true });
    },
  });
}

export function rosterPanelTap(k, rect, state, p, showToast) {
  // Inspect modal is open → its buttons act; any other tap closes it (mirrors roster.release()).
  if (state.inspect) {
    const total = state.active.length + state.vault.length;
    if (total > 1 && inRect(p, inspReleaseRect(k))) {
      if (!state.releaseArm) { state.releaseArm = true; return true; }
      net.release(state.inspect.mon.id); state.inspect = null; state.releaseArm = false; state.modalCapturesInput = false; return true;
    }
    if (inRect(p, inspActionRect(k))) {
      if (state.inspect.source === "active") storeFromActive(state, state.inspect.slot, showToast);
      else fieldFromVault(state, state.inspect.mon, showToast);
    } else { sfx("click"); }
    state.inspect = null; state.releaseArm = false; state.modalCapturesInput = false; return true;
  }
  const hit = state._hit; if (!hit) return false;
  for (const t of hit.tabs) if (inRect(p, t.r)) { if (state.tab !== t.id) { sfx("click"); state.tab = t.id; state.scrollY = 0; } return true; }

  if (state.tab === "monsters") {
    // sort / search controls
    if (hit.sort && inRect(p, hit.sort)) { state.sortMode = nextSortMode(state.sortMode); state.scrollY = 0; state._vv.view = null; return true; }
    if (hit.search && inRect(p, hit.search.r)) {
      if (hit.search.clearX != null && p.x >= hit.search.clearX) { state.searchQ = ""; state.scrollY = 0; state._vv.view = null; closeSearchInput(state); }
      else openSearchInput(state);
      return true;
    }
    // active slot → inspect
    for (const s of hit.activeSlots) if (s.i < state.active.length && inRect(p, s.r)) { sfx("click"); state.inspect = { mon: state.active[s.i], source: "active", slot: s.i }; state.releaseArm = false; state.modalCapturesInput = true; return true; }
    // vault card → inspect (respect the scroll clip — ignore taps in the masked band)
    for (const c of hit.vaultCards) if (p.y >= c.clipTop && inRect(p, c.r)) { sfx("click"); state.inspect = { mon: c.mon, source: "vault" }; state.releaseArm = false; state.modalCapturesInput = true; return true; }
    return true;
  }
  if (state.tab === "chains") {
    for (const s of hit.slots) if (inRect(p, s.r)) { if (s.filled) clearSlot(state, s.i, showToast); return true; }
    for (const c of hit.chains) if (p.y >= c.clipTop && inRect(p, c.r)) { toggleLoadout(state, c.idx, showToast); return true; }
    return true;
  }
  return true; // items tab is read-only
}

export function rosterPanelScroll(state, dy) {
  if (state.inspect) return;
  state.scrollY = Math.max(0, Math.min(state._maxScroll, state.scrollY + dy));
}

// ── free-text vault search: a fixed-position DOM <input> (mobile keyboard) ──
function openSearchInput(state) {
  if (state.searchInput) { try { state.searchInput.focus(); } catch {} return; }
  const input = document.createElement("input");
  input.type = "text"; input.placeholder = "Search by name / type"; input.value = state.searchQ; input.maxLength = 24;
  Object.assign(input.style, {
    position: "fixed", left: "50%", top: "16%", transform: "translateX(-50%)", zIndex: "1000",
    width: "min(72vw, 340px)", padding: "10px 12px", fontSize: "16px", textAlign: "center",
    color: PAL.text, background: PAL.surface, border: `2px solid ${PAL.primary}`, borderRadius: "8px", outline: "none", fontFamily: "inherit",
  });
  document.body.appendChild(input); state.searchInput = input;
  setTimeout(() => { try { input.focus(); } catch {} }, 50);
  const apply = () => { state.searchQ = (input.value || "").trim(); state.scrollY = 0; state._vv.view = null; };
  input.addEventListener("input", apply);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); apply(); closeSearchInput(state); } });
  input.addEventListener("blur", () => { apply(); closeSearchInput(state); });
}
function closeSearchInput(state) {
  if (!state.searchInput) return;
  try { state.searchInput.remove(); } catch {}
  state.searchInput = null;
}
