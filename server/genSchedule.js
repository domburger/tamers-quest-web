import { loadGenSchedule, saveGenSchedule } from "./db.js";

const HOUR = 3600000;
export const GEN_ASSETS = ["biomes", "tiles", "monsters"];
export const DEFAULT_GEN_SCHEDULE = {
  biomesEnabled: false, biomesEveryMs: 24 * HOUR,
  tilesEnabled: false, tilesEveryMs: 24 * HOUR,
  monstersEnabled: false, monstersEveryMs: 24 * HOUR,
};

const MIN_MS = 60000, MAX_MS = 30 * 24 * HOUR;
const int = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : undefined; };
const bool = (v) => (v === true || v === "true" || v === "1" || v === 1) ? true : (v === false || v === "false" || v === "0" || v === 0) ? false : undefined;
const everyOf = (v) => int(v, MIN_MS, MAX_MS);
const SPEC = {
  biomesEnabled: bool, biomesEveryMs: everyOf,
  tilesEnabled: bool, tilesEveryMs: everyOf,
  monstersEnabled: bool, monstersEveryMs: everyOf,
};

let overrides = {};
let lastRun = {};

export async function initGenSchedule() {
  try {
    const blob = (await loadGenSchedule()) || {};
    const { _lastRun, ...cfg } = blob;
    overrides = cfg || {};
    lastRun = _lastRun || {};
  } catch { overrides = {}; lastRun = {}; }
}

export function getGenSchedule(key) {
  if (key in overrides && SPEC[key]) {
    const clean = SPEC[key](overrides[key]);
    if (clean !== undefined) return clean;
  }
  return DEFAULT_GEN_SCHEDULE[key];
}

function activeConfig() {
  const cfg = {};
  for (const k of Object.keys(DEFAULT_GEN_SCHEDULE)) cfg[k] = getGenSchedule(k);
  return cfg;
}

export function allGenSchedule() {
  const fields = {};
  for (const k of Object.keys(DEFAULT_GEN_SCHEDULE)) {
    fields[k] = { current: getGenSchedule(k), default: DEFAULT_GEN_SCHEDULE[k], overridden: k in overrides };
  }
  return { fields, lastRun: { ...lastRun } };
}

export async function setGenSchedule(patch) {
  if (patch && typeof patch === "object") {
    for (const k of Object.keys(DEFAULT_GEN_SCHEDULE)) {
      if (!(k in patch)) continue;
      const v = patch[k];
      if (v == null || v === "") { delete overrides[k]; continue; }
      const clean = SPEC[k](v);
      if (clean !== undefined) overrides[k] = clean;
    }
  }
  await saveGenSchedule({ ...overrides, _lastRun: lastRun }).catch((e) => console.error("[genschedule] save:", e.message));
  return allGenSchedule();
}

export function computeDue(cfg, last, now) {
  const due = [];
  for (const asset of GEN_ASSETS) {
    if (!cfg[asset + "Enabled"]) continue;
    if (now - (last[asset] || 0) >= cfg[asset + "EveryMs"]) due.push(asset);
  }
  return due;
}

// Stamp last-run before awaiting gen so a slow run can't double-fire.
export async function tickGenSchedule(now, gen) {
  const due = computeDue(activeConfig(), lastRun, now);
  if (!due.length) return [];
  const ran = [];
  for (const asset of due) {
    lastRun[asset] = now;
    try { if (await gen[asset]()) ran.push(asset); } catch (e) { console.error(`[genschedule] ${asset}:`, e.message); }
  }
  await saveGenSchedule({ ...overrides, _lastRun: lastRun }).catch(() => {});
  if (ran.length) console.log(`[genschedule] generated: ${ran.join(", ")}`);
  return ran;
}
