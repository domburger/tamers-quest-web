// Per-time AI generation scheduler (TQ-369, Epic TQ-363). Independently of round-start backfill
// (TQ-368), an operator can have the server generate ONE new biome / tile / monster on a fixed
// cadence — e.g. "a new biome every day, a new monster every hour" — to grow content variety over
// time. Admin-editable, DB-persisted (settings id=7), applied live; mirrors the aiconfig/genConfig
// override-registry pattern. The interval tick lives in index.js (alongside the game tick); this
// module owns the config, the last-run bookkeeping, and the pure "what's due" decision.
//
// Defaults: all OFF (generation costs OpenAI — the operator opts in per asset). Last-run timestamps
// are persisted so the cadence survives a restart.

import { loadGenSchedule, saveGenSchedule } from "./db.js";

const HOUR = 3600000;
export const GEN_ASSETS = ["biomes", "tiles", "monsters"];
export const DEFAULT_GEN_SCHEDULE = {
  biomesEnabled: false, biomesEveryMs: 24 * HOUR,
  tilesEnabled: false, tilesEveryMs: 24 * HOUR,
  monstersEnabled: false, monstersEveryMs: 24 * HOUR,
};

const MIN_MS = 60000, MAX_MS = 30 * 24 * HOUR; // 1 minute … 30 days
const int = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : undefined; };
const bool = (v) => (v === true || v === "true" || v === "1" || v === 1) ? true : (v === false || v === "false" || v === "0" || v === 0) ? false : undefined;
const everyOf = (v) => int(v, MIN_MS, MAX_MS);
const SPEC = {
  biomesEnabled: bool, biomesEveryMs: everyOf,
  tilesEnabled: bool, tilesEveryMs: everyOf,
  monstersEnabled: bool, monstersEveryMs: everyOf,
};

let overrides = {};      // config overrides (validated subset of DEFAULT_GEN_SCHEDULE)
let lastRun = {};        // { biomes, tiles, monsters } → epoch ms of the last generation

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

// The active config object (all keys resolved).
function activeConfig() {
  const cfg = {};
  for (const k of Object.keys(DEFAULT_GEN_SCHEDULE)) cfg[k] = getGenSchedule(k);
  return cfg;
}

// For the admin editor: per-field current/default/overridden + the last-run timestamps.
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

// PURE: which assets are due to generate at `now`, given a resolved config + last-run map. An asset
// is due when enabled AND at least its interval has elapsed since its last run (a never-run asset is
// immediately due). Unit-tested without timers.
export function computeDue(cfg, last, now) {
  const due = [];
  for (const asset of GEN_ASSETS) {
    if (!cfg[asset + "Enabled"]) continue;
    if (now - (last[asset] || 0) >= cfg[asset + "EveryMs"]) due.push(asset);
  }
  return due;
}

// One scheduler tick: generate ONE of each due asset (sequentially), stamp + persist its last-run.
// `now` + `gen` (the per-asset generator fns) are injected so this is testable + decoupled from
// content.js. Marks last-run BEFORE awaiting, so a slow/failed generation can't double-fire next tick.
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
