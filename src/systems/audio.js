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

// Master volume (0..1), persisted. Scales every recipe's gain at the tone/noise
// chokepoint, so it's a single knob over all SFX. Mute (above) is the hard on/off;
// volume is the fine control. Default full.
let volume = 1;
try { const v = parseFloat(localStorage.getItem("tq_volume")); if (Number.isFinite(v)) volume = Math.min(1, Math.max(0, v)); } catch {}
export function getVolume() { return volume; }
export function setVolume(v) {
  volume = Math.min(1, Math.max(0, Number.isFinite(+v) ? +v : 1));
  try { localStorage.setItem("tq_volume", String(volume)); } catch {}
  return volume;
}

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
  g.gain.exponentialRampToValueAtTime(Math.max(0.00012, vol * volume), t + 0.008); // scale by master volume
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
  const g = c.createGain(); g.gain.value = vol * volume; // scale by master volume
  s.connect(g).connect(c.destination);
  s.start();
}

const seq = (c, notes, type, vol) =>
  notes.forEach((f, i) => setTimeout(() => { if (ctx && !muted && volume > 0) tone(ctx, { freq: f, dur: 0.16, type, vol }); }, i * 95));

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
  cluck: (c) => tone(c, { freq: 820, dur: 0.06, type: "triangle", vol: 0.05, slideTo: 1140 }), // soft chirp when a startled hen scatters (hub ambience)
  // Faint distant forest birdsong (sparse hub ambience). Picks one of a few warble patterns at random
  // each call so it doesn't repeat identically over a long lobby session — reads as different birds.
  birdcall: (c) => { const P = [[2200, 2700, 2400], [2600, 2300], [2400, 2800, 2500, 2900], [2700, 2500, 2650], [2150, 2500, 2300]]; seq(c, P[Math.floor(Math.random() * P.length)], "sine", 0.04); },
  portal: (c) => tone(c, { freq: 160, dur: 0.4, type: "sine", vol: 0.06, slideTo: 260 }), // low rising rift hum when you approach the cave (weightier than the house blip)
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
  if (muted || volume <= 0) return;
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
