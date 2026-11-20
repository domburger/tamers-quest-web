export const SORT_MODES = ["recent", "level", "rarity"];
export const SORT_LABELS = { recent: "Recent", level: "Level", rarity: "Rarity" };

export function nextSortMode(mode) {
  const i = SORT_MODES.indexOf(mode);
  return SORT_MODES[(i + 1) % SORT_MODES.length];
}

export function sortMonsters(list, mode, typeOf = () => ({})) {
  const tagged = list.map((m, i) => [m, i]);
  const keyOf = (m) => {
    const t = typeOf(m.typeName) || {};
    if (mode === "level") return -(Number(m.level) || 0);
    if (mode === "rarity") return -(Number(t.rarity) || 0);
    return 0;
  };
  tagged.sort((a, b) => {
    const ka = keyOf(a[0]), kb = keyOf(b[0]);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return a[1] - b[1];
  });
  return tagged.map(([m]) => m);
}

export function searchMonsters(list, query, typeOf = () => ({})) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return list.slice();
  return list.filter((m) => {
    const hay = `${m.name || ""} ${m.typeName || ""}`.toLowerCase();
    return hay.includes(q);
  });
}

export function sortChainsByTier(list, tierOf = (c) => c?.def?.tier) {
  return list.map((c, i) => [c, i]).sort((a, b) => {
    const d = (Number(tierOf(b[0])) || 0) - (Number(tierOf(a[0])) || 0);
    return d !== 0 ? d : a[1] - b[1];
  }).map(([c]) => c);
}
