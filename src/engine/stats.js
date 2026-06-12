// Pure monster stat math — shared by client and server.
// stat(level) = floor(base + scaling1 * level ^ scaling2)

export function calcStat(base, scaling1, scaling2, level) {
  return Math.floor(base + scaling1 * Math.pow(level, scaling2));
}

// Neutral fallbacks (mirror gen.js normalization) so a monster instance whose
// type is missing/partial — e.g. an owned monster whose generated type an admin
// later removed from the pool — yields finite stats instead of NaN. Without this,
// getMonsterStats(undefined) throws and crashes server combat/tick paths.
const STAT_FIELDS = ["Health", "Strength", "Defense", "Speed", "Power", "Energy", "Luck"];
const FALLBACK = { base: 60, scaling1: 1, scaling2: 1 };
// The per-field property names are constant, but getMonsterStats was rebuilding 7
// toLowerCase() + 21 template-literal key strings on EVERY call (it runs per combat
// turn and per monster card per frame in roster/lobby/hub). Precompute the descriptors
// once so each call is just object lookups — identical output, no per-call string churn.
const STAT_KEYS = STAT_FIELDS.map((key) => {
  const lk = key.toLowerCase();
  return { out: lk, base: `base${key}`, s1: `${lk}Scaling1`, s2: `${lk}Scaling2` };
});

function fin(v, d) { return Number.isFinite(v) ? v : d; }

// Just the max-HP stat. Several hot callers (roster/lobby HP bars — per card per
// frame; the server snapshot's teamHp — per player per snapshot) need ONLY max HP but
// were calling getMonsterStats and reading .health, computing all 7 stats (7 Math.pow
// + a throwaway 7-field object) to use one. This computes the single Health stat.
// Uses the same calcStat + fallbacks as the Health field in getMonsterStats, so the
// value is identical.
export function getMonsterMaxHp(monsterType, level) {
  const mt = monsterType || {};
  const lvl = fin(Number(level), 1);
  return calcStat(fin(mt.baseHealth, FALLBACK.base), fin(mt.healthScaling1, FALLBACK.scaling1), fin(mt.healthScaling2, FALLBACK.scaling2), lvl);
}

export function getMonsterStats(monsterType, level) {
  const mt = monsterType || {};
  // Guard the LEVEL too, not just the type/scaling: a missing/NaN level (a malformed or migrated
  // instance) would make Math.pow(level, s2) NaN → every stat NaN → NaN health in combat. Default
  // to Lv.1, mirroring the type fallback above so this always yields finite stats, never NaN.
  const lvl = fin(Number(level), 1);
  const out = {};
  for (const k of STAT_KEYS) {
    out[k.out] = calcStat(
      fin(mt[k.base], FALLBACK.base),
      fin(mt[k.s1], FALLBACK.scaling1),
      fin(mt[k.s2], FALLBACK.scaling2),
      lvl,
    );
  }
  return out;
}
