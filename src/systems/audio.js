let ctx = null;
let muted = false;
try { muted = localStorage.getItem("tq_muted") === "1"; } catch {}

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

function tone(c, { freq, dur = 0.12, type = "sine", vol = 0.12, slideTo = null }) {
  const t = c.currentTime;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.00012, vol * volume), t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(c, { dur = 0.09, vol = 0.18 }) {
  const n = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = c.createBufferSource(); s.buffer = buf;
  const g = c.createGain(); g.gain.value = vol * volume;
  s.connect(g).connect(c.destination);
  s.start();
}

const seq = (c, notes, type, vol) =>
  notes.forEach((f, i) => setTimeout(() => { if (ctx && !muted && volume > 0) tone(ctx, { freq: f, dur: 0.16, type, vol }); }, i * 95));

const RECIPES = {
  ui: (c) => tone(c, { freq: 600, dur: 0.05, type: "square", vol: 0.07 }),
  hover: (c) => tone(c, { freq: 880, dur: 0.03, type: "sine", vol: 0.035 }),
  click: (c) => tone(c, { freq: 660, dur: 0.06, type: "square", vol: 0.08, slideTo: 880 }),
  back: (c) => tone(c, { freq: 520, dur: 0.07, type: "square", vol: 0.07, slideTo: 360 }),
  step: (c) => noise(c, { dur: 0.035, vol: 0.045 }),
  cluck: (c) => tone(c, { freq: 820, dur: 0.06, type: "triangle", vol: 0.05, slideTo: 1140 }),
  portal: (c) => tone(c, { freq: 160, dur: 0.4, type: "sine", vol: 0.06, slideTo: 260 }),
  chest: (c) => seq(c, [440, 660, 880], "sine", 0.09),
  pickup: (c) => seq(c, [659, 988], "sine", 0.1),
  throw: (c) => tone(c, { freq: 520, dur: 0.12, type: "triangle", vol: 0.06, slideTo: 920 }),
  miss: (c) => tone(c, { freq: 180, dur: 0.1, type: "sine", vol: 0.05, slideTo: 110 }),
  levelup: (c) => seq(c, [659, 880, 1175], "square", 0.1),
  encounter: (c) => tone(c, { freq: 330, dur: 0.14, type: "triangle", vol: 0.11 }),
  hit: (c) => noise(c, { dur: 0.09, vol: 0.16 }),
  catch: (c) => seq(c, [523, 784], "sine", 0.13),
  win: (c) => seq(c, [523, 659, 784], "square", 0.1),
  extract: (c) => seq(c, [523, 659, 784, 1047], "sine", 0.12),
  lose: (c) => tone(c, { freq: 300, dur: 0.45, type: "sawtooth", vol: 0.11, slideTo: 90 }),
  defeat: (c) => noise(c, { dur: 0.06, vol: 0.09 }),
};

export function sfx(name) {
  if (muted || volume <= 0) return;
  const c = audioCtx();
  if (!c) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  const r = RECIPES[name];
  if (r) try { r(c); } catch {}
}

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

// Must stay idempotent: called on every scene entry.
let inited = false;
export function initAudio(net) {
  if (inited || !net || typeof net.on !== "function") return;
  inited = true;
  net.on("combatStart", () => sfx("encounter"));
  net.on("combatUpdate", (m) => { if (m && m.narrative) sfx("hit"); });
  net.on("combatEnd", (m) => sfx(m && m.outcome === "caught" ? "catch" : m && m.outcome === "won" ? "win" : "lose"));
  net.on("killfeed", () => sfx("defeat"));
  net.on("extracted", () => { sfx("extract"); haptic([0, 25, 45, 70]); });
  net.on("died", () => { sfx("lose"); haptic(120); });
}
