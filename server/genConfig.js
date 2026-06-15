// Round-composition + generation config (TQ-364, foundation for Epic TQ-363). Admin-editable,
// DB-persisted (settings id=5), applied live — mirrors aiconfig.js / prompts.js exactly. These knobs
// describe the STRUCTURE of a round (how many biomes, monsters-per-biome, tile split per biome, how
// many biomes are reused vs freshly generated each round) and the per-round generation budget. The
// round-formation + map-gen + generation tasks (TQ-365..369) READ these via getGenConfig() /
// roundComposition() so the operator can retune composition from /admin without a redeploy.
//
// Defaults encode Dominik's 2026-06-15 spec: 12 biomes/round, 16 monsters/biome, 4 collidable + 8
// non-collidable tiles/biome, 11 reused + 1 new biome per round, <=30 new monsters generated/round.

import { loadGenConfig, saveGenConfig } from "./db.js";

export const DEFAULT_GEN_CONFIG = {
  biomesPerRound: 12,             // total distinct biomes a round is composed of
  newBiomesPerRound: 1,           // of those, how many are freshly generated each round (rest reused)
  monstersPerBiome: 16,           // size of each biome's (diversity-maximized) monster pool
  tilesCollidablePerBiome: 4,     // impassable tile types per biome (water/lava/rock…)
  tilesNonCollidablePerBiome: 8,  // walkable tile types per biome
  maxNewMonstersPerRound: 30,     // hard cap on AI monsters generated to backfill one round
};

// Per-field validation/coercion. Returns a clean integer, or undefined to reject (keeps the default).
const int = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : undefined; };
const SPEC = {
  biomesPerRound: (v) => int(v, 1, 32),
  newBiomesPerRound: (v) => int(v, 0, 32),
  monstersPerBiome: (v) => int(v, 1, 64),
  tilesCollidablePerBiome: (v) => int(v, 0, 32),
  tilesNonCollidablePerBiome: (v) => int(v, 0, 32),
  maxNewMonstersPerRound: (v) => int(v, 0, 500),
};

let overrides = {};

export async function initGenConfig() {
  try { overrides = (await loadGenConfig()) || {}; }
  catch { overrides = {}; }
}

// Active value for one key: a valid override if present, else the default.
export function getGenConfig(key) {
  if (key in overrides && SPEC[key]) {
    const clean = SPEC[key](overrides[key]);
    if (clean !== undefined) return clean;
  }
  return DEFAULT_GEN_CONFIG[key];
}

// The coherent round-composition plan the consumers (TQ-365..369) act on. `reusedBiomesPerRound` is
// DERIVED (total - fresh, floored at 0, fresh clamped to total) rather than stored, so reused + new
// can never disagree with the total — the operator sets the total and the new-count, reused follows.
export function roundComposition() {
  const total = getGenConfig("biomesPerRound");
  const fresh = Math.min(getGenConfig("newBiomesPerRound"), total);
  const collide = getGenConfig("tilesCollidablePerBiome");
  const nonCollide = getGenConfig("tilesNonCollidablePerBiome");
  return {
    biomesPerRound: total,
    newBiomesPerRound: fresh,
    reusedBiomesPerRound: Math.max(0, total - fresh),
    monstersPerBiome: getGenConfig("monstersPerBiome"),
    tilesCollidablePerBiome: collide,
    tilesNonCollidablePerBiome: nonCollide,
    tilesPerBiome: collide + nonCollide,
    maxNewMonstersPerRound: getGenConfig("maxNewMonstersPerRound"),
  };
}

// For the admin editor: per-field current/default/overridden, plus the derived round plan for display.
export function allGenConfig() {
  const fields = {};
  for (const k of Object.keys(DEFAULT_GEN_CONFIG)) {
    fields[k] = { current: getGenConfig(k), default: DEFAULT_GEN_CONFIG[k], overridden: k in overrides };
  }
  return { fields, composition: roundComposition() };
}

// Apply a validated/clamped patch. A null/empty value resets that key to its default.
export async function setGenConfig(patch) {
  if (patch && typeof patch === "object") {
    for (const k of Object.keys(DEFAULT_GEN_CONFIG)) {
      if (!(k in patch)) continue;
      const v = patch[k];
      if (v == null || v === "") { delete overrides[k]; continue; }
      const clean = SPEC[k](v);
      if (clean !== undefined) overrides[k] = clean;
    }
  }
  await saveGenConfig(overrides).catch((e) => console.error("[genconfig] save:", e.message));
  return allGenConfig();
}
