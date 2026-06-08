// Procedural sound effects (P8-T6, @visual). Pure Web Audio API — no asset files,
// no Kaboom/Phaser/shim dependency (engine-agnostic, safe lane). Short synthesized
// blips for the key in-round events, wired off the net event stream. Muteable
// (persisted), default on. The AudioContext is created lazily and resumed on the
// first event so it works under browser autoplay policies (a real player has
// already clicked to enter a round by then).
//
// Scope is intentionally minimal — see P8-T6. Tune the recipes/events freely.

let ctx = null;
let muted = false;
try { muted = localStorage.getItem("tq_muted") === "1"; } catch {}

function audioCtx() {
  if (ctx) return ctx;
  try {
    const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
    if (AC) ctx = new AC();
  } catch { ctx = null; }
  return ctx;
}

// A single enveloped oscillator tone (optionally pitch-sliding).
function tone(c, { freq, dur = 0.12, type = "sine", vol = 0.12, slideTo = null }) {
  const t = c.currentTime;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// A short decaying noise burst (impacts).
function noise(c, { dur = 0.09, vol = 0.18 }) {
  const n = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = c.createBufferSource(); s.buffer = buf;
  const g = c.createGain(); g.gain.value = vol;
  s.connect(g).connect(c.destination);
  s.start();
}

const seq = (c, notes, type, vol) =>
  notes.forEach((f, i) => setTimeout(() => { if (ctx && !muted) tone(ctx, { freq: f, dur: 0.16, type, vol }); }, i * 95));

// name -> recipe. Kept small + tasteful; adjust per P8-T6 scope.
const RECIPES = {
  ui: (c) => tone(c, { freq: 600, dur: 0.05, type: "square", vol: 0.07 }),
  // Menu / interaction SFX (user-requested, extends P8-T6). Kept quiet + short so
  // they read as feedback, not noise — hover especially (fires on every pointer
  // enter). All respect the shared mute; tune the recipes freely.
  hover: (c) => tone(c, { freq: 880, dur: 0.03, type: "sine", vol: 0.035 }),
  click: (c) => tone(c, { freq: 660, dur: 0.06, type: "square", vol: 0.08, slideTo: 880 }),
  back: (c) => tone(c, { freq: 520, dur: 0.07, type: "square", vol: 0.07, slideTo: 360 }),
  step: (c) => noise(c, { dur: 0.035, vol: 0.045 }),
  chest: (c) => seq(c, [440, 660, 880], "sine", 0.09),
  pickup: (c) => seq(c, [659, 988], "sine", 0.1),
  throw: (c) => tone(c, { freq: 520, dur: 0.12, type: "triangle", vol: 0.06, slideTo: 920 }), // chain-launch whoosh (the core action was silent)
  miss: (c) => tone(c, { freq: 180, dur: 0.1, type: "sine", vol: 0.05, slideTo: 110 }), // soft thud when a thrown chain lands without a catch
  levelup: (c) => seq(c, [659, 880, 1175], "square", 0.1),
  encounter: (c) => tone(c, { freq: 330, dur: 0.14, type: "triangle", vol: 0.11 }),
  hit: (c) => noise(c, { dur: 0.09, vol: 0.16 }),
  catch: (c) => seq(c, [523, 784], "sine", 0.13),
  win: (c) => seq(c, [523, 659, 784], "square", 0.1),
  extract: (c) => seq(c, [523, 659, 784, 1047], "sine", 0.12),
  lose: (c) => tone(c, { freq: 300, dur: 0.45, type: "sawtooth", vol: 0.11, slideTo: 90 }),
  defeat: (c) => noise(c, { dur: 0.06, vol: 0.09 }),
};

// Play a named SFX (no-op when muted or audio unavailable).
export function sfx(name) {
  if (muted) return;
  const c = audioCtx();
  if (!c) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  const r = RECIPES[name];
  if (r) try { r(c); } catch {}
}

// MB-12: short haptic pulse on touch devices (Vibration API). No-op when
// unsupported (desktop/iOS Safari) or muted, so it's safe to call anywhere.
export function haptic(pattern = 10) {
  if (muted) return;
  try { if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(pattern); } catch {}
}

export function isMuted() { return muted; }
export function setMuted(b) {
  muted = !!b;
  try { localStorage.setItem("tq_muted", muted ? "1" : "0"); } catch {}
  return muted;
}
export function toggleMuted() { return setMuted(!muted); }

// Subscribe in-round SFX to the net event stream. Idempotent — safe to call on
// every scene entry. `net` is the shared client (src/netClient.js).
let inited = false;
export function initAudio(net) {
  if (inited || !net || typeof net.on !== "function") return;
  inited = true;
  net.on("combatStart", () => sfx("encounter"));
  net.on("combatUpdate", (m) => { if (m && m.narrative) sfx("hit"); });
  net.on("combatEnd", (m) => sfx(m && m.outcome === "caught" ? "catch" : m && m.outcome === "won" ? "win" : "lose"));
  net.on("killfeed", () => sfx("defeat"));
  // MOB-T4: haptics on the big round-end beats (extract/death). Hit + catch already
  // buzz from the combat overlay; this closes the "extract" trigger (+ a death thud).
  net.on("extracted", () => { sfx("extract"); haptic([0, 25, 45, 70]); }); // celebratory rising buzz — you made it out
  net.on("died", () => { sfx("lose"); haptic(120); }); // a single long thud on defeat
}
