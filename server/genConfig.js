import { loadGenConfig, saveGenConfig } from "./db.js";

export const DEFAULT_GEN_CONFIG = {
  biomesPerRound: 12,
  newBiomesPerRound: 1,
  monstersPerBiome: 16,
  tilesCollidablePerBiome: 4,
  tilesNonCollidablePerBiome: 8,
  maxNewMonstersPerRound: 30,
  roundGenBackfill: true,
  biomeRarity: true,
  biomeSize: true,
};

const int = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : undefined; };
const bool = (v) => (v === true || v === "true" || v === "1" || v === 1) ? true : (v === false || v === "false" || v === "0" || v === 0) ? false : undefined;
const SPEC = {
  biomesPerRound: (v) => int(v, 1, 32),
  newBiomesPerRound: (v) => int(v, 0, 32),
  monstersPerBiome: (v) => int(v, 1, 64),
  tilesCollidablePerBiome: (v) => int(v, 0, 32),
  tilesNonCollidablePerBiome: (v) => int(v, 0, 32),
  maxNewMonstersPerRound: (v) => int(v, 0, 500),
  roundGenBackfill: bool,
  biomeRarity: bool,
  biomeSize: bool,
};

let overrides = {};

export async function initGenConfig() {
  try { overrides = (await loadGenConfig()) || {}; }
  catch { overrides = {}; }
}

export function getGenConfig(key) {
  if (key in overrides && SPEC[key]) {
    const clean = SPEC[key](overrides[key]);
    if (clean !== undefined) return clean;
  }
  return DEFAULT_GEN_CONFIG[key];
}

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

export function allGenConfig() {
  const fields = {};
  for (const k of Object.keys(DEFAULT_GEN_CONFIG)) {
    fields[k] = { current: getGenConfig(k), default: DEFAULT_GEN_CONFIG[k], overridden: k in overrides };
  }
  return { fields, composition: roundComposition() };
}

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
