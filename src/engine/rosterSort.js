// Roster/vault sorting (INV-T6). Pure + engine-agnostic so both the MP roster
// (scenes/roster.js) and the SP inventory can share one implementation (and it's
// unit-testable without a renderer). Sorting never mutates the input and is
// stable, so equal-key monsters keep their incoming ("recent") order.

export const SORT_MODES = ["recent", "level", "rarity", "element"];
export const SORT_LABELS = { recent: "Recent", level: "Level", rarity: "Rarity", element: "Element" };

export function nextSortMode(mode) {
  const i = SORT_MODES.indexOf(mode);
  return SORT_MODES[(i + 1) % SORT_MODES.length];
}

// Sort a monster list by `mode`. `typeOf(typeName)` supplies the per-type fields
// the instance doesn't carry ({ element, rarity }); missing data sorts last.
// Returns a NEW array of the SAME monster objects (reference-stable, so callers
// can map a sorted-view index back to the source list by identity).
export function sortMonsters(list, mode, typeOf = () => ({})) {
  const tagged = list.map((m, i) => [m, i]); // carry original index → stable + "recent"
  const keyOf = (m) => {
    const t = typeOf(m.typeName) || {};
    if (mode === "level") return -(Number(m.level) || 0);     // highest level first
    if (mode === "rarity") return -(Number(t.rarity) || 0);   // highest rarity first
    if (mode === "element") return String(t.element || "~~").toLowerCase(); // A→Z, unknown last
    return 0; // "recent": preserve input order via the stable tiebreak
  };
  tagged.sort((a, b) => {
    const ka = keyOf(a[0]), kb = keyOf(b[0]);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return a[1] - b[1]; // stable: original order breaks ties
  });
  return tagged.map(([m]) => m);
}

// Filter a monster list to one element (INV-T6); ELEMENT_ALL ("all") = no filter.
// typeOf supplies each monster's element. Pure; returns a subset of the input
// (same objects), so identity-based index mapping still works.
export const ELEMENT_ALL = "all";
export function filterMonsters(list, element, typeOf = () => ({})) {
  if (!element || element === ELEMENT_ALL) return list.slice();
  const el = String(element).toLowerCase();
  return list.filter((m) => String((typeOf(m.typeName) || {}).element || "").toLowerCase() === el);
}

// The filter options for a vault: ELEMENT_ALL followed by the distinct elements
// actually present (A→Z), so the cycle only offers elements you own.
export function elementFilterOptions(list, typeOf = () => ({})) {
  const set = new Set();
  for (const m of list) {
    const el = String((typeOf(m.typeName) || {}).element || "").toLowerCase();
    if (el) set.add(el);
  }
  return [ELEMENT_ALL, ...[...set].sort()];
}

// Free-text search over a monster list (INV-T6): case-insensitive substring
// match against the monster's display name, type name, and element. A blank
// query = no filter. Pure; returns a subset of the SAME objects so identity-based
// index mapping still works (composes after sort/filter).
export function searchMonsters(list, query, typeOf = () => ({})) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return list.slice();
  return list.filter((m) => {
    const t = typeOf(m.typeName) || {};
    const hay = `${m.name || ""} ${m.typeName || ""} ${t.element || ""}`.toLowerCase();
    return hay.includes(q);
  });
}

// Spirit chains sort by tier (INV-T6), highest first; stable for equal tiers.
export function sortChainsByTier(list, tierOf = (c) => c?.def?.tier) {
  return list.map((c, i) => [c, i]).sort((a, b) => {
    const d = (Number(tierOf(b[0])) || 0) - (Number(tierOf(a[0])) || 0);
    return d !== 0 ? d : a[1] - b[1];
  }).map(([c]) => c);
}
