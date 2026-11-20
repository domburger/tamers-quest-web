// Pure: shared by client and server. No DOM.

export function calcStat(base, scaling1, scaling2, level) {
  return Math.floor(base + scaling1 * Math.pow(level, scaling2));
}

// Fallbacks mirror gen.js: a missing type must yield finite stats, not throw/NaN.
const STAT_FIELDS = ["Health", "Strength", "Defense", "Speed", "Power", "Energy", "Luck"];
const FALLBACK = { base: 60, scaling1: 1, scaling2: 1 };
const STAT_KEYS = STAT_FIELDS.map((key) => {
  const lk = key.toLowerCase();
  return { out: lk, base: `base${key}`, s1: `${lk}Scaling1`, s2: `${lk}Scaling2` };
});

function fin(v, d) { return Number.isFinite(v) ? v : d; }

// Must equal getMonsterStats().health.
export function getMonsterMaxHp(monsterType, level) {
  const mt = monsterType || {};
  const lvl = fin(Number(level), 1);
  return calcStat(fin(mt.baseHealth, FALLBACK.base), fin(mt.healthScaling1, FALLBACK.scaling1), fin(mt.healthScaling2, FALLBACK.scaling2), lvl);
}

export function getMonsterStats(monsterType, level) {
  const mt = monsterType || {};
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
