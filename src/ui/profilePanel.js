import { getProfile, getCharacters, getAccountSession, getAccountNickname, setProfileNickname } from "../storage.js";
import { THEME, PAL, FONT, FONT_BOLD, FONT_BODY, drawGlass, drawButton, drawEyebrow, drawChip, inRect } from "./theme.js";
import { drawGlassSheet } from "./stationPopup.js";
import { drawCharacter } from "../render/character.js";
import { getEquippedCharacterSkin } from "../render/characterCosmetics.js";
import { slugOf, drawMonsterIcon } from "../render/monster.js";
import { xpForLevel } from "../engine/progression.js";
import { prefersReducedMotion } from "../systems/a11y.js";

const PAD = 16;
const STAT_CELLS = [
  { key: "runs", label: "Runs", color: THEME.text },
  { key: "extractions", label: "Escaped", color: THEME.success },
  { key: "escapeRate", label: "Escape %", color: THEME.success, derived: true },
  { key: "deaths", label: "Deaths", color: THEME.danger },
  { key: "caught", label: "Caught", color: THEME.teal },
  { key: "pvpWins", label: "PvP wins", color: THEME.violet },
  { key: "xp", label: "Total XP", color: THEME.amber, derived: true },
];

const sumStats = (chars) => {
  const t = {};
  for (const c of chars || []) for (const k2 of Object.keys(c.stats || {})) t[k2] = (t[k2] || 0) + (c.stats[k2] || 0);
  return t;
};
const mergeHistory = (chars) =>
  (chars || []).flatMap((c) => (c.matchHistory || []).map((h) => ({ ...h, who: c.name })))
    .sort((a, b) => (b.at || 0) - (a.at || 0));
function ago(at) {
  if (!at) return "";
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function localData(authed) {
  const profile = getProfile();
  const chars = getCharacters();
  return { name: getAccountNickname() || (profile && profile.nickname) || "Tamer", isGuest: !authed, characters: chars, totals: sumStats(chars), history: [] };
}
function serverData(account) {
  const chars = account.characters || [];
  return { name: account.nickname || "Tamer", isGuest: false, providers: account.providers || null, characters: chars, totals: sumStats(chars), history: mergeHistory(chars) };
}

export function profilePanelState(activeCharId) {
  const profile = getProfile();
  const authed = !!(profile && !profile.isGuest);
  const session = getAccountSession();
  const state = {
    scrollY: 0, _maxScroll: 0, statsView: "all", activeCharId: activeCharId || null,
    authed, session, data: localData(authed), skin: getEquippedCharacterSkin(),
    renaming: false, renameEl: null, renameErr: "", _rects: null,
    dispose() { if (state.renameEl) { try { state.renameEl.remove(); } catch {} state.renameEl = null; } state.renaming = false; },
  };
  if (authed && session) {
    fetch("/account/me", { headers: { "x-account-session": session } })
      .then((r) => (r.status === 401 ? null : r.ok ? r.json() : null))
      .then((d) => { if (d && d.account) state.data = serverData(d.account); })
      .catch(() => {});
  }
  return state;
}

export function drawProfilePanel(k, rect, state) {
  const [rx, ry, rw, rh] = rect;
  const T = (n) => k.rgb(...(THEME[n] || [255, 255, 255]));
  const cx = rx + rw / 2;
  const data = state.data || { name: "Tamer", characters: [], totals: {}, history: [] };
  const chars = data.characters || [];
  let y = ry + 8 - state.scrollY;
  const rects = { chips: [], edit: null };

  const sk = state.skin || {};
  drawCharacter(k, { x: cx, y: y + 78, t: prefersReducedMotion() ? 0 : k.time(), dir: { x: 0, y: 1 }, scale: 1.5, color: sk.accent || [90, 170, 255], cloak: sk.cloak, model: sk.model || "cloak", fixed: true });
  y += 104;
  k.drawText({ text: data.name || "Tamer", pos: k.vec2(cx, y), size: 26, font: FONT_BOLD, anchor: "center", color: T("text"), fixed: true });
  y += 30;
  if (data.isGuest) {
    drawChip(k, { x: cx, y: y - 2, text: "Guest, progress not saved", color: THEME.amber, size: 10, h: 20, padX: 10, anchor: "center", fixed: true });
    y += 28;
  } else if (state.session) {
    const er = [cx - 75, y - 2, 150, 30];
    drawButton(k, { rect: er, text: "Edit username", size: 13, radius: 12, fill: THEME.surfaceAlt, textColor: THEME.text, hover: inRect(k.mousePos(), er), fixed: true });
    rects.edit = er; y += 34;
  }

  let viewChar = null;
  if (state.statsView !== "all") { viewChar = chars.find((c) => c.id === state.statsView) || null; if (!viewChar) state.statsView = "all"; }
  if (chars.length > 1) {
    const chips = [{ id: "all", label: "All" }, ...chars.map((c) => ({ id: c.id, label: c.name || "Tamer" }))];
    const gap = 6, chipW = (rw - 4 - gap * (chips.length - 1)) / chips.length, maxC = Math.max(3, Math.floor(chipW / 7));
    chips.forEach((ch, i) => {
      const r = [rx + 2 + (chipW + gap) * i, y, chipW, 24];
      const sel = state.statsView === ch.id, lbl = ch.label.length > maxC ? ch.label.slice(0, maxC - 1) + "…" : ch.label;
      drawButton(k, { rect: r, text: lbl, size: 12, radius: 12, fill: sel ? THEME.primary : THEME.surfaceAlt, textColor: sel ? THEME.textInv : THEME.textBody, hover: inRect(k.mousePos(), r), fixed: true });
      rects.chips.push({ id: ch.id, r });
    });
    y += 32;
  }
  const totals = viewChar ? sumStats([viewChar]) : (data.totals || {});
  const histForXp = viewChar ? (viewChar.matchHistory || []) : (data.history || []);
  const runs = totals.runs || 0, escaped = totals.extractions || 0;
  const totalXp = histForXp.reduce((s, h) => s + (h.xp || 0), 0);
  const derived = {
    escapeRate: runs > 0 ? `${Math.round((escaped / runs) * 100)}%` : "—",
    xp: totalXp >= 1000 ? `${(totalXp / 1000).toFixed(totalXp >= 10000 ? 0 : 1)}k` : String(totalXp),
  };
  const lvlChar = viewChar || chars.find((c) => c.id === state.activeCharId) || chars[0] || null;
  drawGlass(k, { rect: [rx + 2, y, rw - 4, 96], radius: 16, fixed: true });
  drawEyebrow(k, { x: rx + PAD, y: y + 13, text: "Lifetime", size: 10, color: THEME.primary, fixed: true });
  if (lvlChar) {
    const lv = Math.max(1, lvlChar.level || 1), need = xpForLevel(lv), have = Math.max(0, Math.min(need, lvlChar.xp || 0));
    k.drawText({ text: `Lv ${lv}   ${have}/${need} XP`, pos: k.vec2(rx + rw - PAD, y + 12), size: 12, font: FONT_BOLD, anchor: "right", color: T("amber"), fixed: true });
  }
  const cellW = (rw - 36) / STAT_CELLS.length;
  const vSize = Math.min(24, Math.round(cellW * 0.44)), lSize = Math.min(11, Math.round(cellW * 0.19));
  STAT_CELLS.forEach((cell, i) => {
    const x = rx + 18 + cellW * (i + 0.5);
    const val = cell.derived ? derived[cell.key] : String(totals[cell.key] || 0);
    k.drawText({ text: val, pos: k.vec2(x, y + 44), size: vSize, font: FONT_BOLD, anchor: "center", color: k.rgb(...cell.color), fixed: true });
    k.drawText({ text: cell.label, pos: k.vec2(x, y + 70), size: lSize, font: FONT_BODY, anchor: "center", color: T("textMut"), fixed: true });
  });
  y += 108;

  const activeChar = chars.find((c) => c.id === state.activeCharId) || chars[0] || null;
  const team = (activeChar && activeChar.activeMonsters) || [];
  drawGlass(k, { rect: [rx + 2, y, rw - 4, 104], radius: 16, fixed: true });
  drawEyebrow(k, { x: rx + PAD, y: y + 13, text: "Team", size: 10, color: THEME.primary, fixed: true });
  if (!team.length) {
    k.drawText({ text: activeChar ? "No monsters yet." : "No tamer selected.", pos: k.vec2(cx, y + 52), size: 13, font: FONT_BODY, anchor: "center", color: T("textMut"), fixed: true });
  } else {
    const shown = team.slice(0, 6), slotW = (rw - 36) / shown.length;
    const well = Math.max(36, Math.min(54, slotW - 18));
    const ps = Math.max(0.12, Math.min(0.22, well / 240));
    shown.forEach((m, i) => {
      const x = rx + 18 + slotW * (i + 0.5), wy = y + 24;
      k.drawRect({ pos: k.vec2(x - well / 2, wy), width: well, height: well, radius: 12, color: T("bg"), opacity: 0.55, fixed: true });
      k.drawRect({ pos: k.vec2(x - well / 2, wy), width: well, height: well, radius: 12, fill: false, outline: { width: 1, color: k.rgb(255, 255, 255) }, opacity: 0.1, fixed: true });
      drawMonsterIcon(k, { sprite: slugOf(m.typeName), typeName: m.typeName, cx: x, cy: wy + well / 2 + 2, scale: ps, topY: wy + 3, fixed: true });
      drawChip(k, { x: x + well / 2 + 4, y: wy - 4, text: `Lv ${m.level || 1}`, color: THEME.textBody, size: 8, h: 14, padX: 5, anchor: "right", fixed: true });
      let nm = m.name || m.typeName || "?";
      const maxW = slotW - 8;
      if (typeof k.measureText === "function") { while (nm.length > 4 && k.measureText(nm, 11, FONT_BOLD) > maxW) nm = nm.slice(0, -2) + "…"; }
      k.drawText({ text: nm, pos: k.vec2(x, wy + well + 12), size: 11, font: FONT_BOLD, anchor: "center", color: T("text"), fixed: true });
    });
    if (team.length > 6) k.drawText({ text: `+${team.length - 6}`, pos: k.vec2(rx + rw - PAD, y + 14), size: 11, font: FONT_BODY, anchor: "right", color: T("textMut"), fixed: true });
  }
  y += 116;

  const rows = (data.history || []).slice(0, 8);
  const histH = Math.max(56, 36 + rows.length * 28);
  drawGlass(k, { rect: [rx + 2, y, rw - 4, histH], radius: 16, fixed: true });
  drawEyebrow(k, { x: rx + PAD, y: y + 13, text: "Match history", size: 10, color: THEME.primary, fixed: true });
  if (!rows.length) {
    k.drawText({ text: data.isGuest ? "Log in to track your runs." : "No runs yet — enter the caves.", pos: k.vec2(cx, y + 40), size: 13, font: FONT_BODY, anchor: "center", color: T("textMut"), fixed: true });
  } else {
    rows.forEach((h, i) => {
      const ry2 = y + 40 + i * 28, win = h.result === "extracted";
      k.drawCircle({ pos: k.vec2(rx + 22, ry2), radius: 4, color: k.rgb(...(win ? THEME.success : THEME.danger)), fixed: true });
      k.drawText({ text: win ? "Extracted" : "Defeated", pos: k.vec2(rx + 34, ry2 - 7), size: 13, font: FONT, color: k.rgb(...(win ? THEME.success : THEME.danger)), fixed: true });
      const bits = []; if (h.caught) bits.push(`Caught ${h.caught}`); if (h.xp) bits.push(`+${h.xp} XP`); if (h.survivedS) bits.push(`${h.survivedS}s`);
      k.drawText({ text: bits.join("  ") || "—", pos: k.vec2(rx + rw - 90, ry2 - 7), size: 12, font: FONT_BODY, anchor: "right", color: T("textBody"), fixed: true });
      k.drawText({ text: ago(h.at), pos: k.vec2(rx + rw - PAD, ry2 - 7), size: 12, font: FONT_BODY, anchor: "right", color: T("textMut"), fixed: true });
    });
  }
  y += histH + 8;

  state._maxScroll = Math.max(0, (y + state.scrollY) - (ry + rh));
  state._rects = rects;
}

export function drawProfileModal(k, state) {
  if (!state.renaming) return;
  const T = (n) => k.rgb(...(THEME[n] || [255, 255, 255]));
  const W = k.width(), H = k.height();
  k.drawRect({ pos: k.vec2(0, 0), width: W, height: H, color: k.rgb(0, 0, 0), opacity: 0.5, fixed: true });
  const mw = Math.min(380, W - 24), mx = (W - mw) / 2, my = H / 2 - 107;
  drawGlassSheet(k, { rect: [mx, my, mw, 214], radius: 22, accent: THEME.primary });
  k.drawText({ text: "Edit username", pos: k.vec2(W / 2, my + 24), size: 22, font: FONT_BOLD, anchor: "center", color: T("text"), fixed: true });
  k.drawText({ text: state.renameErr || "This is how other tamers see you.", pos: k.vec2(W / 2, my + 54), size: 13, font: FONT_BODY, anchor: "center", color: T(state.renameErr ? "danger" : "textMut"), fixed: true });
  const by = my + 160, sr = [W / 2 - 148, by, 140, 44], cr = [W / 2 + 8, by, 140, 44];
  drawButton(k, { rect: sr, text: "Save", size: 17, radius: 14, fill: THEME.primary, textColor: THEME.textInv, hover: inRect(k.mousePos(), sr), fixed: true });
  drawButton(k, { rect: cr, text: "Cancel", size: 17, radius: 14, fill: THEME.surfaceAlt, textColor: THEME.text, hover: inRect(k.mousePos(), cr), fixed: true });
  state._modalRects = { save: sr, cancel: cr };
}

export function profilePanelTap(k, rect, state, p, showToast) {
  if (state.renaming) {
    const m = state._modalRects;
    if (m && inRect(p, m.save)) { submitRename(state, showToast); return true; }
    if (m && inRect(p, m.cancel)) { state.dispose(); return true; }
    return true;
  }
  const r = state._rects; if (!r) return false;
  for (const c of r.chips) if (inRect(p, c.r)) { state.statsView = c.id; state.scrollY = 0; return true; }
  if (r.edit && inRect(p, r.edit)) { openRename(state); return true; }
  return false;
}

export function profilePanelScroll(state, dy) {
  if (state.renaming) return;
  state.scrollY = Math.max(0, Math.min(state._maxScroll, state.scrollY + dy));
}

export function profilePanelFocusables(_rect, state) {
  const r = state._rects;
  if (!r || state.renaming) return [];
  const out = [];
  for (const c of r.chips || []) out.push({ rect: c.r });
  if (r.edit) out.push({ rect: r.edit });
  return out;
}

function openRename(state) {
  if (state.renaming) return;
  state.renaming = true; state.renameErr = "";
  const input = document.createElement("input");
  input.type = "text"; input.maxLength = 24; input.value = state.data?.name || ""; input.placeholder = "Username";
  Object.assign(input.style, {
    position: "fixed", left: "50%", top: "calc(50% - 8px)", transform: "translate(-50%, -50%)",
    zIndex: "1000", width: "min(70vw, 320px)", padding: "12px 14px", fontSize: "20px",
    textAlign: "center", color: PAL.text, background: PAL.surface,
    border: `2px solid ${PAL.line}`, borderRadius: "8px", outline: "none", fontFamily: "inherit",
  });
  document.body.appendChild(input);
  state.renameEl = input;
  setTimeout(() => { try { input.focus(); input.select(); } catch {} }, 50);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submitRename(state); }
    else if (e.key === "Escape") { e.preventDefault(); state.dispose(); }
  });
}
async function submitRename(state, showToast) {
  const input = state.renameEl; if (!input) return;
  const name = (input.value || "").trim();
  if (!name) { try { input.focus(); } catch {} return; }
  state.renameErr = "Saving…";
  try {
    const res = await fetch("/account/username", { method: "POST",
      headers: { "Content-Type": "application/json", "x-account-session": state.session },
      body: JSON.stringify({ name }) });
    if (res.ok) {
      const nn = (await res.json().catch(() => ({}))).nickname || name;
      setProfileNickname(nn);
      if (state.data) state.data.name = nn;
      state.dispose();
      showToast && showToast("Username updated");
    } else { state.renameErr = "Couldn't save that name — try again."; }
  } catch { state.renameErr = "Network error — try again."; }
}
