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

export function getMonsterStats(monsterType, level) {
  const mt = monsterType || {};
  const fin = (v, d) => (Number.isFinite(v) ? v : d);
  const out = {};
  for (const key of STAT_FIELDS) {
    const lk = key.toLowerCase();
    out[lk] = calcStat(
      fin(mt[`base${key}`], FALLBACK.base),
      fin(mt[`${lk}Scaling1`], FALLBACK.scaling1),
      fin(mt[`${lk}Scaling2`], FALLBACK.scaling2),
      level,
    );
  }
  return out;
}
