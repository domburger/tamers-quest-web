// TQ-121 (Settings half): Settings CONTENT for the in-lobby station popup. Re-implements the four
// settings.js controls — Sound on/off, master Volume +/-, Reduce Motion (Auto/On/Off), Screen Shake
// on/off — in the shell's immediate-mode draw(k,rect)+tap contract (settings.js itself is retained-mode
// addButton/destroyAll, which can't mount in the clipped popup). Pure client prefs: each control reads +
// writes the localStorage-backed stores (audio.js / a11y.js / shake.js) with no server round-trip. All draws
// are fixed (screen-space) so the shell's k.pushClip masks them. The old full-screen settings scene was
// removed on 2026-11-08; this popup is the only Settings UI.
import { isMuted, toggleMuted, getVolume, setVolume, sfx, haptic } from "../systems/audio.js";
import { reduceMotionSetting, setReduceMotion } from "../systems/a11y.js";
import { shakeEnabled, toggleShake } from "../render/shake.js";
import { THEME, FONT, FONT_BOLD, drawButton, drawEyebrow, drawHairline, drawSwitch, drawSegments, drawMeter, inRect } from "./theme.js";
// TQ-458: remappable controls — the Controls section lists each action's key(s) and rebinds via a
// transient DOM keydown capture (mapped with the shim's domKeyToken). Cleanup rides the popup's
// state.dispose()/onEsc() hooks (hub.js calls them on close / Esc), so no host change is needed.
import { ACTION_META, getBindings, setBinding, resetAllBindings, actionsForKey } from "../systems/keybinds.js";
import { domKeyToken } from "../compat/canvasKeyboard.js";
import { touchPrimary } from "../systems/inputMode.js"; // hide keyboard Controls on touch-primary devices
import { drawIcon } from "./icons.js";
import { sheetEntrance } from "./stationPopup.js";

const PAD = 16, ROW_H = 62, HDR_H = 36, GAP = 8, BTN_W = 120, BTN_H = 40, STEP_W = 40;
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
function layout(rect, scrollY = 0, touch = false) {
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
  // Hidden on touch-primary devices (phones / tablets without a keyboard): the bindings are keyboard
  // keys the player can't press, so the section was six rows of noise there.
  if (!touch) {
    items.push(hdr("Controls"));
    for (const meta of ACTION_META) {
      const it = ctl("rebind"); it.action = meta.action; it.label = meta.label;
      it.btn = [right - BTN_W, it.top + (ROW_H - BTN_H) / 2, BTN_W, BTN_H];
      items.push(it);
    }
    const resetKeys = ctl("resetkeys"); resetKeys.btn = [right - BTN_W, resetKeys.top + (ROW_H - BTN_H) / 2, BTN_W, BTN_H]; items.push(resetKeys);
  }
  // Legal & compliance links (TQ-225) — /legal (privacy/terms/refund) + /pricing, opened in a new tab.
  items.push(hdr("Legal"));
  for (const lk of [{ label: "Legal & Privacy", url: "/legal" }, { label: "Pricing", url: "/pricing" }]) {
    const it = ctl("link"); it.label = lk.label; it.url = lk.url;
    it.btn = [right - BTN_W, it.top + (ROW_H - BTN_H) / 2, BTN_W, BTN_H]; items.push(it);
  }
  return { items, contentH: y - y0 };
}

// UI v3: a settings LIST, not a stack of boxed cards — eyebrow section labels, hairline-separated rows with
// the label on the left and a real control on the right: switches for on/off prefs, a segmented control for
// Reduce Motion, a meter + glass steppers for Volume, glass buttons for rebinds and links. The hit rects are
// unchanged (layout() above), so taps / controller focus keep working on the same geometry.
const SUB = { sound: "Music and effects", volume: "Master level", reduce: "Fewer animations and flashes", shake: "Camera kick on hits" };
const ROW_ICON = { sound: "sound", volume: "sound", reduce: "motion", shake: "shake", rebind: "keyboard", resetkeys: "cog", link: "external" };
export function drawSettingsPanel(k, rect, state) {
  const [rx, ry, rw, rh] = rect;
  const T = (n) => k.rgb(...THEME[n]);
  const mp = k.mousePos();
  const { items, contentH } = layout(rect, state.scrollY, touchPrimary(k));
  state._maxScroll = Math.max(0, contentH - rh + 12); // scrolls when the Legal section overflows a short viewport (TQ-225)
  let prevRow = null, rowIdx = 0;
  for (const it of items) {
    if (it.kind === "hdr") {
      drawEyebrow(k, { x: rx + PAD, y: it.y + 6, text: it.text, size: 10, color: THEME.primary, spacing: 2.2, fixed: true });
      prevRow = null;
      continue;
    }
    if (prevRow) drawHairline(k, { x: rx + PAD, y: it.row[1] - GAP / 2, w: rw - PAD * 2, opacity: 0.08, fixed: true });
    prevRow = it;
    const rowHover = inRect(mp, it.row);
    if (rowHover) k.drawRect({ pos: k.vec2(it.row[0], it.row[1]), width: it.row[2], height: it.row[3], radius: 12, color: T("text"), opacity: 0.03, fixed: true });
    const ly = it.top + ROW_H / 2;
    const edy = sheetEntrance(k, rowIdx++, { step: 0.025 });
    // Row icon in a small glass square (UI v4) — the label column starts after it.
    const ic = ROW_ICON[it.kind] || "dot";
    const iq = [it.row[0] + PAD - 4, ly - 19 + edy, 38, 38];
    k.drawRect({ pos: k.vec2(iq[0], iq[1]), width: iq[2], height: iq[3], radius: 12, color: T("primary"), opacity: 0.12, fixed: true });
    drawIcon(k, it.kind === "sound" && isMuted() ? "mute" : ic, { x: iq[0] + 19, y: iq[1] + 19, size: 20, color: THEME.primary, fixed: true });
    const lx = it.row[0] + PAD + 48;
    const sub = SUB[it.kind];
    // The label column ends where the row's control begins (segmented control is the widest: btn[0] - 40).
    const ctrlLeft = it.kind === "reduce" ? it.btn[0] - 40 : it.kind === "volume" ? it.minus[0] : it.btn ? it.btn[0] : it.row[0] + it.row[2];
    const labW = Math.max(60, ctrlLeft - lx - 10);
    const fitW = (t, sz, font) => { const mw = typeof k.measureText === "function" ? (q) => k.measureText(q, sz, font) : (q) => q.length * sz * 0.56; if (mw(t) <= labW) return t; let lo = 0, hi = t.length; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (mw(t.slice(0, mid) + "…") <= labW) lo = mid; else hi = mid - 1; } return t.slice(0, lo).trimEnd() + "…"; };
    const label = (text) => {
      k.drawText({ text: fitW(text, 16, FONT_BOLD), pos: k.vec2(lx, (sub ? ly - 16 : ly - 9) + edy), size: 16, font: FONT_BOLD, color: T("text"), fixed: true });
      if (sub) k.drawText({ text: fitW(sub, 12, FONT), pos: k.vec2(lx, ly + 4 + edy), size: 12, font: FONT, color: T("textMut"), fixed: true });
    };
    if (it.kind === "sound") {
      label("Sound");
      drawSwitch(k, { rect: it.btn, on: !isMuted(), hover: inRect(mp, it.btn), fixed: true });
    } else if (it.kind === "volume") {
      const pct = Math.round(getVolume() * 100);
      label("Volume");
      const S = 32, my = ly - S / 2;
      const minus = [it.minus[0] + (it.minus[2] - S) / 2, my, S, S], plus = [it.plus[0] + (it.plus[2] - S) / 2, my, S, S];
      drawButton(k, { rect: minus, text: "", radius: S / 2, fill: THEME.surfaceAlt, hover: inRect(mp, it.minus), fixed: true });
      drawButton(k, { rect: plus, text: "", radius: S / 2, fill: THEME.surfaceAlt, hover: inRect(mp, it.plus), fixed: true });
      const ic = (on) => T(on ? "text" : "textMut");
      k.drawRect({ pos: k.vec2(minus[0] + 10, ly - 1), width: S - 20, height: 2, radius: 1, color: ic(pct > 0), fixed: true });
      k.drawRect({ pos: k.vec2(plus[0] + 10, ly - 1), width: S - 20, height: 2, radius: 1, color: ic(pct < 100), fixed: true });
      k.drawRect({ pos: k.vec2(plus[0] + S / 2 - 1, ly - S / 2 + 10), width: 2, height: S - 20, radius: 1, color: ic(pct < 100), fixed: true });
      const mx0 = minus[0] + S + 10, mx1 = plus[0] - 10;
      drawMeter(k, { rect: [mx0, ly - 2, Math.max(20, mx1 - mx0), 4], frac: pct / 100, color: THEME.primary, fixed: true });
      k.drawText({ text: `${pct}%`, pos: k.vec2((mx0 + mx1) / 2, ly - 16), size: 11, font: FONT_BOLD, anchor: "center", color: pct === 0 ? T("textMut") : T("textBody"), fixed: true });
    } else if (it.kind === "reduce") {
      const s = reduceMotionSetting();
      label("Reduce Motion");
      const seg = [it.btn[0] - 40, it.btn[1] + 5, it.btn[2] + 40, it.btn[3] - 10];
      drawSegments(k, { rect: seg, options: [["auto", "Auto"], ["on", "On"], ["off", "Off"]], active: s, pointer: mp, size: 11, fixed: true });
    } else if (it.kind === "shake") {
      label("Screen Shake");
      drawSwitch(k, { rect: it.btn, on: shakeEnabled(), hover: inRect(mp, it.btn), fixed: true });
    } else if (it.kind === "rebind") {
      const capturing = state.capturing === it.action;
      label(it.label);
      const keys = ((state.bindings && state.bindings[it.action]) || []).join(" / ") || "—";
      drawButton(k, { rect: it.btn, text: capturing ? "Press a key…" : keys, size: 13, radius: 12, fill: capturing ? THEME.primary : THEME.surfaceAlt, textColor: capturing ? THEME.textInv : THEME.text, hover: inRect(mp, it.btn), fixed: true });
    } else if (it.kind === "resetkeys") {
      label("Reset controls");
      drawButton(k, { rect: it.btn, text: "Reset", size: 13, radius: 12, fill: THEME.surfaceAlt, textColor: THEME.text, hover: inRect(mp, it.btn), fixed: true });
    } else if (it.kind === "link") {
      label(it.label);
      drawButton(k, { rect: it.btn, text: "Open", size: 13, radius: 12, fill: THEME.surfaceAlt, textColor: THEME.text, hover: inRect(mp, it.btn), fixed: true });
    }
  }
}

// Tap → toggle/step the matching pref (persisted client-side; no server sync). Returns true if consumed.
export function settingsPanelTap(k, rect, state, p, showToast) {
  const { items } = layout(rect, state.scrollY, touchPrimary(k));
  for (const it of items) {
    if (it.kind === "link" && inRect(p, it.btn)) { sfx("click"); try { window.open(it.url, "_blank", "noopener"); } catch { /* popup blocked — no-op */ } showToast && showToast("Opening in a new tab…"); return true; }
    if (it.kind === "sound" && inRect(p, it.btn)) { haptic(6); sfx("click"); toggleMuted(); return true; }
    if (it.kind === "volume") {
      if (inRect(p, it.minus)) { setVolume(Math.round(getVolume() * 100 - 10) / 100); sfx("ui"); return true; }
      if (inRect(p, it.plus)) { setVolume(Math.round(getVolume() * 100 + 10) / 100); sfx("ui"); return true; }
    }
    if (it.kind === "reduce" && inRect(p, [it.btn[0] - 40, it.btn[1], it.btn[2] + 40, it.btn[3]])) {
      // Segmented control: a tap on a segment selects it directly; a controller activate (centre) cycles.
      const seg = [it.btn[0] - 40, it.btn[1] + 5, it.btn[2] + 40, it.btn[3] - 10], sw = (seg[2] - 4) / 3;
      const idx = Math.max(0, Math.min(2, Math.floor((p.x - seg[0] - 2) / sw)));
      const picked = ["auto", "on", "off"][idx];
      const cur = reduceMotionSetting();
      haptic(6); sfx("click"); setReduceMotion(picked === cur ? (RM_NEXT[cur] || "on") : picked); return true;
    }
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
