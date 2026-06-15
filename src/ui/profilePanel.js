// TQ-199 (epic TQ-99 / sub-task of the lobby station-popup work): Profile CONTENT for the in-lobby
// station popup. Re-implements profile.js's read view — avatar, identity (name + account level/XP),
// lifetime stats (with the multi-tamer selector), the active team, and recent match history — in the
// shell's immediate-mode draw(k,rect,state)+tap contract (profile.js itself is a retained-mode scene
// that can't mount in the clipped popup). Coordinated with 00002 (profile.js / TQ-13 lane): this is a
// SEPARATE content module reading the SAME storage helpers, mirroring the settingsPanel.js /
// cosmeticsPanel.js precedent — profile.js stays the standalone out-of-lobby fallback route.
//
// Username editing reuses profile.js's approach: a fixed-position DOM <input> (so the mobile keyboard
// opens) over an immediate-mode backdrop drawn inside this panel. The DOM node is torn down via the
// state.dispose() hook the host calls on close. All canvas draws are fixed (screen-space) so the
// shell's k.pushClip masks them.
import { getProfile, getCharacters, getAccountSession, getAccountNickname, setProfileNickname } from "../storage.js";
import { THEME, PAL, FONT, FONT_BODY, drawPanel, drawButton, inRect } from "./theme.js";
import { drawCharacter } from "../render/character.js";
import { getEquippedCharacterSkin } from "../render/characterCosmetics.js";
import { slugOf, drawMonsterIcon } from "../render/monster.js"; // TQ-351: drawMonsterIcon shrinks tall sprites to the team icon box
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

// state carries the loaded data (refreshed from the server for logged-in accounts), the per-tamer
// stats view, scroll, and the rename modal's DOM node + status. `activeCharId` selects which tamer's
// team/level to show (the one you entered the lobby as).
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
      .catch(() => { /* offline — keep the local render */ });
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

  // ── Identity: avatar (immediate-mode vector tamer) + name + account level/XP ──
  const sk = state.skin || {};
  // fixed:true → screen-space (the popup composites over the hub, whose camera tracks the player; a
  // world-space figure would draw off-popup). drawCharacter wraps k into a fixed overlay internally.
  drawCharacter(k, { x: cx, y: y + 78, t: prefersReducedMotion() ? 0 : k.time(), dir: { x: 0, y: 1 }, scale: 1.15, color: sk.accent || [90, 170, 255], cloak: sk.cloak, model: sk.model || "cloak", fixed: true });
  y += 96;
  k.drawText({ text: data.name || "Tamer", pos: k.vec2(cx, y), size: 24, font: FONT, anchor: "center", color: T("text"), fixed: true });
  y += 30;
  if (data.isGuest) {
    k.drawText({ text: "Playing as guest — progress isn't saved", pos: k.vec2(cx, y), size: 13, font: FONT_BODY, anchor: "center", color: T("warn"), fixed: true });
    y += 26;
  } else if (state.session) {
    const er = [cx - 75, y - 2, 150, 30];
    drawButton(k, { rect: er, text: "Edit username", size: 13, fill: THEME.surfaceAlt, textColor: THEME.teal, hover: inRect(k.mousePos(), er), fixed: true });
    rects.edit = er; y += 34;
  }

  // ── Stats selector (multi-tamer accounts) + lifetime stat cells ──
  let viewChar = null;
  if (state.statsView !== "all") { viewChar = chars.find((c) => c.id === state.statsView) || null; if (!viewChar) state.statsView = "all"; }
  if (chars.length > 1) {
    const chips = [{ id: "all", label: "All" }, ...chars.map((c) => ({ id: c.id, label: c.name || "Tamer" }))];
    const gap = 6, chipW = (rw - 4 - gap * (chips.length - 1)) / chips.length, maxC = Math.max(3, Math.floor(chipW / 7));
    chips.forEach((ch, i) => {
      const r = [rx + 2 + (chipW + gap) * i, y, chipW, 24];
      const sel = state.statsView === ch.id, lbl = ch.label.length > maxC ? ch.label.slice(0, maxC - 1) + "…" : ch.label;
      drawButton(k, { rect: r, text: lbl, size: 12, fill: sel ? THEME.teal : THEME.surfaceAlt, textColor: sel ? THEME.textInv : THEME.textMut, hover: inRect(k.mousePos(), r), fixed: true });
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
  drawPanel(k, { rect: [rx + 2, y, rw - 4, 96], fixed: true });
  k.drawText({ text: "Player Data", pos: k.vec2(rx + PAD, y + 12), size: 13, font: FONT, color: T("teal"), fixed: true });
  if (lvlChar) {
    const lv = Math.max(1, lvlChar.level || 1), need = xpForLevel(lv), have = Math.max(0, Math.min(need, lvlChar.xp || 0));
    k.drawText({ text: `Lv ${lv}   ${have}/${need} XP`, pos: k.vec2(rx + rw - PAD, y + 12), size: 13, font: FONT, anchor: "right", color: T("amber"), fixed: true });
  }
  const cellW = (rw - 36) / STAT_CELLS.length;
  const vSize = Math.min(24, Math.round(cellW * 0.44)), lSize = Math.min(12, Math.round(cellW * 0.24));
  STAT_CELLS.forEach((cell, i) => {
    const x = rx + 18 + cellW * (i + 0.5);
    const val = cell.derived ? derived[cell.key] : String(totals[cell.key] || 0);
    k.drawText({ text: val, pos: k.vec2(x, y + 44), size: vSize, font: FONT, anchor: "center", color: k.rgb(...cell.color), fixed: true });
    k.drawText({ text: cell.label, pos: k.vec2(x, y + 70), size: lSize, font: FONT_BODY, anchor: "center", color: T("textMut"), fixed: true });
  });
  y += 108;

  // ── Active team portraits ──
  const activeChar = chars.find((c) => c.id === state.activeCharId) || chars[0] || null;
  const team = (activeChar && activeChar.activeMonsters) || [];
  drawPanel(k, { rect: [rx + 2, y, rw - 4, 92], fixed: true });
  k.drawText({ text: "Team", pos: k.vec2(rx + PAD, y + 14), size: 13, font: FONT, color: T("teal"), fixed: true });
  if (!team.length) {
    k.drawText({ text: activeChar ? "No monsters yet." : "No tamer selected.", pos: k.vec2(cx, y + 52), size: 13, font: FONT_BODY, anchor: "center", color: T("textMut"), fixed: true });
  } else {
    const shown = team.slice(0, 6), slotW = (rw - 36) / shown.length, ps = Math.max(0.12, Math.min(0.2, slotW / 240)), maxC = Math.max(4, Math.floor(slotW / 6.2));
    shown.forEach((m, i) => {
      const x = rx + 18 + slotW * (i + 0.5);
      drawMonsterIcon(k, { sprite: slugOf(m.typeName), cx: x, cy: y + 44, scale: ps, topY: y + 4, fixed: true }); // TQ-351: keep tall sprites inside the team-icon box
      const nm = m.name || m.typeName || "?";
      k.drawText({ text: `${nm.length > maxC ? nm.slice(0, maxC - 1) + "…" : nm} L${m.level || 1}`, pos: k.vec2(x, y + 80), size: 10, font: FONT_BODY, anchor: "center", color: T("textBody"), fixed: true });
    });
    if (team.length > 6) k.drawText({ text: `+${team.length - 6}`, pos: k.vec2(rx + rw - PAD, y + 14), size: 11, font: FONT_BODY, anchor: "right", color: T("textMut"), fixed: true });
  }
  y += 104;

  // ── Recent match history ──
  const rows = (data.history || []).slice(0, 8);
  const histH = Math.max(56, 36 + rows.length * 28);
  drawPanel(k, { rect: [rx + 2, y, rw - 4, histH], fixed: true });
  k.drawText({ text: "Match History", pos: k.vec2(rx + PAD, y + 16), size: 13, font: FONT, color: T("teal"), fixed: true });
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

  // content height for scroll (y is in shifted space → add scrollY back to get absolute extent)
  state._maxScroll = Math.max(0, (y + state.scrollY) - (ry + rh));
  state._rects = rects;
}

// Rename modal — drawn by the host OUTSIDE the shell's content clip (full screen, above the popup),
// the same way the shared monster-detail popup composites over a station panel. The DOM <input> the
// player types into layers above the canvas on its own (position:fixed).
export function drawProfileModal(k, state) {
  if (!state.renaming) return;
  const T = (n) => k.rgb(...(THEME[n] || [255, 255, 255]));
  const W = k.width(), H = k.height();
  k.drawRect({ pos: k.vec2(0, 0), width: W, height: H, color: k.rgb(0, 0, 0), opacity: 0.72, fixed: true });
  const mw = Math.min(380, W - 24), mx = (W - mw) / 2, my = H / 2 - 107;
  drawPanel(k, { rect: [mx, my, mw, 214], radius: 16, fill: THEME.surface, border: THEME.primary, borderW: 2, fixed: true });
  k.drawText({ text: "Edit username", pos: k.vec2(W / 2, my + 24), size: 22, font: FONT, anchor: "center", color: T("text"), fixed: true });
  k.drawText({ text: state.renameErr || "This is how other tamers see you.", pos: k.vec2(W / 2, my + 54), size: 13, font: FONT_BODY, anchor: "center", color: T(state.renameErr ? "danger" : "textMut"), fixed: true });
  const by = my + 160, sr = [W / 2 - 148, by, 140, 44], cr = [W / 2 + 8, by, 140, 44];
  drawButton(k, { rect: sr, text: "Save", size: 17, fill: THEME.primary, textColor: THEME.textInv, hover: inRect(k.mousePos(), sr), fixed: true });
  drawButton(k, { rect: cr, text: "Cancel", size: 17, fill: THEME.surfaceAlt, textColor: THEME.text, hover: inRect(k.mousePos(), cr), fixed: true });
  state._modalRects = { save: sr, cancel: cr };
}

export function profilePanelTap(k, rect, state, p, showToast) {
  if (state.renaming) {
    const m = state._modalRects;
    if (m && inRect(p, m.save)) { submitRename(state, showToast); return true; }
    if (m && inRect(p, m.cancel)) { state.dispose(); return true; }
    return true; // swallow taps under the modal
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

// ── Rename: a fixed-position DOM input (mobile keyboard) + the immediate-mode modal above ──
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
