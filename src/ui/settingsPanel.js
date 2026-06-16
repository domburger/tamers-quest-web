// TQ-121 (Settings half): Settings CONTENT for the in-lobby station popup. Re-implements the four
// settings.js controls — Sound on/off, master Volume +/-, Reduce Motion (Auto/On/Off), Screen Shake
// on/off — in the shell's immediate-mode draw(k,rect)+tap contract (settings.js itself is retained-mode
// addButton/destroyAll, which can't mount in the clipped popup). Pure client prefs: each control reads +
// writes the SAME localStorage-backed stores as the scene (audio.js / a11y.js / shake.js), so the popup
// and the standalone k.go("settings") route stay in sync with no server round-trip. All draws are fixed
// (screen-space) so the shell's k.pushClip masks them. The full settings.js scene stays the out-of-lobby
// fallback route. (Profile is carved into a sibling sub-task under TQ-99 — 00002's profile.js lane.)
import { isMuted, toggleMuted, getVolume, setVolume, sfx, haptic } from "../systems/audio.js";
import { reduceMotionSetting, setReduceMotion } from "../systems/a11y.js";
import { shakeEnabled, toggleShake } from "../render/shake.js";
import { THEME, FONT, drawPanel, drawButton, inRect } from "./theme.js";
// TQ-458: remappable controls — the Controls section lists each action's key(s) and rebinds via a
// transient DOM keydown capture (mapped with the shim's domKeyToken). Cleanup rides the popup's
// state.dispose()/onEsc() hooks (hub.js calls them on close / Esc), so no host change is needed.
import { ACTION_META, getBindings, setBinding, resetAllBindings, actionsForKey } from "../systems/keybinds.js";
import { domKeyToken } from "../compat/canvasKeyboard.js";

const PAD = 16, ROW_H = 52, HDR_H = 26, GAP = 10, BTN_W = 120, BTN_H = 40, STEP_W = 40;
const RM_LABEL = { auto: "Auto", on: "On", off: "Off" };
const RM_NEXT = { auto: "on", on: "off", off: "auto" };

// Stop an in-progress key capture: detach the listener + clear the capturing flag. Idempotent.
function cancelCapture(state) {
  if (state._cleanup) { try { state._cleanup(); } catch { /* ignore */ } state._cleanup = null; }
  state.capturing = null;
}
// Arm a one-shot DOM keydown capture for `action`. The next key (in the capture phase, so it pre-empts
// the game's own key handlers) rebinds the action; Escape cancels. Self-detaches after one key.
function beginCapture(state, action, showToast) {
  cancelCapture(state);
  state.capturing = action;
  const onKey = (e) => {
    try { e.preventDefault(); e.stopImmediatePropagation(); } catch { /* ignore */ }
    const token = domKeyToken(e);
    if (token && token !== "escape") {
      setBinding(action, [token]);
      state.bindings = getBindings();
      const others = actionsForKey(token).filter((a) => a !== action);
      if (others.length && showToast) showToast(`"${token}" is also bound elsewhere`);
    }
    cancelCapture(state); // Escape (or any key) ends capture
  };
  if (typeof window !== "undefined") {
    window.addEventListener("keydown", onKey, true);
    state._cleanup = () => window.removeEventListener("keydown", onKey, true);
  }
}

export function settingsPanelState() {
  const state = { scrollY: 0, _maxScroll: 0, capturing: null, _cleanup: null, bindings: getBindings() };
  state.dispose = () => cancelCapture(state);                                  // popup closed → drop any pending capture (hub closeStationPopup)
  state.onEsc = () => { if (state.capturing) { cancelCapture(state); return true; } return false; }; // Esc cancels a rebind before closing the popup
  return state;
}

// Deterministic vertical layout shared by draw + tap so hitboxes always match what's drawn.
function layout(rect, scrollY = 0) {
  const [rx, ry, rw] = rect;
  const right = rx + rw - PAD;
  const y0 = ry + 6 - scrollY;
  let y = y0;
  const hdr = (text) => { const o = { kind: "hdr", text, y }; y += HDR_H; return o; };
  const ctl = (kind) => { const top = y; y += ROW_H + GAP; return { kind, row: [rx + 2, top, rw - 4, ROW_H], top }; };
  const items = [];
  items.push(hdr("Audio"));
  const sound = ctl("sound"); sound.btn = [right - BTN_W, sound.top + (ROW_H - BTN_H) / 2, BTN_W, BTN_H]; items.push(sound);
  const vol = ctl("volume");
  vol.plus = [right - STEP_W, vol.top + (ROW_H - BTN_H) / 2, STEP_W, BTN_H];
  vol.minus = [right - STEP_W - 92, vol.top + (ROW_H - BTN_H) / 2, STEP_W, BTN_H];
  vol.pctX = (vol.minus[0] + vol.minus[2] + vol.plus[0]) / 2; // TQ-338: centre the % in the gap between −/+ (was right-STEP_W-46, which overlapped the − button)
  items.push(vol);
  items.push(hdr("Accessibility"));
  const rm = ctl("reduce"); rm.btn = [right - BTN_W, rm.top + (ROW_H - BTN_H) / 2, BTN_W, BTN_H]; items.push(rm);
  const shake = ctl("shake"); shake.btn = [right - BTN_W, shake.top + (ROW_H - BTN_H) / 2, BTN_W, BTN_H]; items.push(shake);
  // TQ-458: Controls — one row per remappable action (label + current key button), then Reset.
  items.push(hdr("Controls"));
  for (const meta of ACTION_META) {
    const it = ctl("rebind"); it.action = meta.action; it.label = meta.label;
    it.btn = [right - BTN_W, it.top + (ROW_H - BTN_H) / 2, BTN_W, BTN_H];
    items.push(it);
  }
  const resetKeys = ctl("resetkeys"); resetKeys.btn = [right - BTN_W, resetKeys.top + (ROW_H - BTN_H) / 2, BTN_W, BTN_H]; items.push(resetKeys);
  // Legal & compliance links (TQ-225) — /legal (privacy/terms/refund) + /pricing, opened in a new tab.
  items.push(hdr("Legal"));
  for (const lk of [{ label: "Legal & Privacy", url: "/legal" }, { label: "Pricing", url: "/pricing" }]) {
    const it = ctl("link"); it.label = lk.label; it.url = lk.url;
    it.btn = [right - BTN_W, it.top + (ROW_H - BTN_H) / 2, BTN_W, BTN_H]; items.push(it);
  }
  return { items, contentH: y - y0 };
}

export function drawSettingsPanel(k, rect, state) {
  const [rx, ry, rw, rh] = rect;
  const T = (n) => k.rgb(...THEME[n]);
  const mp = k.mousePos();
  const { items, contentH } = layout(rect, state.scrollY);
  state._maxScroll = Math.max(0, contentH - rh + 12); // scrolls when the Legal section overflows a short viewport (TQ-225)
  for (const it of items) {
    if (it.kind === "hdr") {
      k.drawText({ text: it.text, pos: k.vec2(rx + PAD, it.y), size: 13, font: FONT, color: T("teal"), fixed: true });
      continue;
    }
    drawPanel(k, { rect: it.row, fixed: true });
    const ly = it.top + ROW_H / 2;
    const lx = it.row[0] + PAD;
    if (it.kind === "sound") {
      const on = !isMuted();
      k.drawText({ text: "Sound", pos: k.vec2(lx, ly - 8), size: 16, font: FONT, color: T("text"), fixed: true });
      drawButton(k, { rect: it.btn, text: on ? "On" : "Off", size: 14, fill: on ? THEME.success : THEME.surfaceAlt, textColor: on ? THEME.textInv : THEME.textMut, hover: inRect(mp, it.btn), fixed: true });
    } else if (it.kind === "volume") {
      const pct = Math.round(getVolume() * 100);
      k.drawText({ text: "Volume", pos: k.vec2(lx, ly - 8), size: 16, font: FONT, color: T("text"), fixed: true });
      drawButton(k, { rect: it.minus, text: "-", size: 24, fill: THEME.surfaceAlt, textColor: pct <= 0 ? THEME.textMut : THEME.text, hover: inRect(mp, it.minus), fixed: true });
      k.drawText({ text: `${pct}%`, pos: k.vec2(it.pctX, ly - 9), size: 17, font: FONT, anchor: "center", color: pct === 0 ? T("textMut") : T("text"), fixed: true });
      drawButton(k, { rect: it.plus, text: "+", size: 22, fill: THEME.surfaceAlt, textColor: pct >= 100 ? THEME.textMut : THEME.text, hover: inRect(mp, it.plus), fixed: true });
    } else if (it.kind === "reduce") {
      const s = reduceMotionSetting();
      k.drawText({ text: "Reduce Motion", pos: k.vec2(lx, ly - 8), size: 16, font: FONT, color: T("text"), fixed: true });
      drawButton(k, { rect: it.btn, text: RM_LABEL[s] || "Auto", size: 14, fill: s === "on" ? THEME.success : s === "off" ? THEME.surfaceAlt : THEME.primary, textColor: s === "off" ? THEME.textMut : THEME.textInv, hover: inRect(mp, it.btn), fixed: true });
    } else if (it.kind === "shake") {
      const on = shakeEnabled();
      k.drawText({ text: "Screen Shake", pos: k.vec2(lx, ly - 8), size: 16, font: FONT, color: T("text"), fixed: true });
      drawButton(k, { rect: it.btn, text: on ? "On" : "Off", size: 14, fill: on ? THEME.success : THEME.surfaceAlt, textColor: on ? THEME.textInv : THEME.textMut, hover: inRect(mp, it.btn), fixed: true });
    } else if (it.kind === "rebind") {
      const capturing = state.capturing === it.action;
      k.drawText({ text: it.label, pos: k.vec2(lx, ly - 8), size: 15, font: FONT, color: T("text"), fixed: true });
      const keys = ((state.bindings && state.bindings[it.action]) || []).join(" / ") || "—";
      drawButton(k, { rect: it.btn, text: capturing ? "Press a key…" : keys, size: 13, fill: capturing ? THEME.primary : THEME.surfaceAlt, textColor: capturing ? THEME.textInv : THEME.text, hover: inRect(mp, it.btn), fixed: true });
    } else if (it.kind === "resetkeys") {
      k.drawText({ text: "Reset controls", pos: k.vec2(lx, ly - 8), size: 16, font: FONT, color: T("text"), fixed: true });
      drawButton(k, { rect: it.btn, text: "Reset", size: 14, fill: THEME.surfaceAlt, textColor: THEME.text, hover: inRect(mp, it.btn), fixed: true });
    } else if (it.kind === "link") {
      k.drawText({ text: it.label, pos: k.vec2(lx, ly - 8), size: 16, font: FONT, color: T("text"), fixed: true });
      drawButton(k, { rect: it.btn, text: "View", size: 14, fill: THEME.surfaceAlt, textColor: THEME.text, hover: inRect(mp, it.btn), fixed: true });
    }
  }
}

// Tap → toggle/step the matching pref (persisted client-side; no server sync). Returns true if consumed.
export function settingsPanelTap(k, rect, state, p, showToast) {
  const { items } = layout(rect, state.scrollY);
  for (const it of items) {
    if (it.kind === "link" && inRect(p, it.btn)) { sfx("click"); try { window.open(it.url, "_blank", "noopener"); } catch { /* popup blocked — no-op */ } showToast && showToast("Opening in a new tab…"); return true; }
    if (it.kind === "sound" && inRect(p, it.btn)) { haptic(6); sfx("click"); toggleMuted(); return true; }
    if (it.kind === "volume") {
      if (inRect(p, it.minus)) { setVolume(Math.round(getVolume() * 100 - 10) / 100); sfx("ui"); return true; }
      if (inRect(p, it.plus)) { setVolume(Math.round(getVolume() * 100 + 10) / 100); sfx("ui"); return true; }
    }
    if (it.kind === "reduce" && inRect(p, it.btn)) { haptic(6); sfx("click"); setReduceMotion(RM_NEXT[reduceMotionSetting()] || "on"); return true; }
    if (it.kind === "shake" && inRect(p, it.btn)) { haptic(6); sfx("click"); toggleShake(); return true; }
    if (it.kind === "rebind" && inRect(p, it.btn)) { haptic(6); sfx("click"); beginCapture(state, it.action, showToast); showToast && showToast("Press a key to bind (Esc cancels)"); return true; }
    if (it.kind === "resetkeys" && inRect(p, it.btn)) { haptic(6); sfx("click"); cancelCapture(state); resetAllBindings(); state.bindings = getBindings(); showToast && showToast("Controls reset to defaults"); return true; }
  }
  return false;
}

export function settingsPanelScroll(state, dy) { state.scrollY = Math.max(0, Math.min(state._maxScroll, state.scrollY + dy)); }

// TQ-527: the rows a controller can focus + activate with A — every interactive row EXCEPT the volume
// stepper (which needs left/right, not a single activate, so it stays pointer-only for now). Each yields
// its action-button rect, used both for the focus ring AND as the point the hub hands to settingsPanelTap.
// Reuses the shared layout() so the rects always match what's drawn/tapped.
export function settingsPanelFocusables(rect, state = {}) {
  return layout(rect, state.scrollY || 0).items
    .filter((it) => it.btn && it.kind !== "volume" && it.kind !== "hdr")
    .map((it) => ({ rect: it.btn }));
}
