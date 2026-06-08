// Persistent "species ever discovered" set (PV-T15). A first-ever catch is a real
// progression milestone, but the bestiary previously derived "caught" purely from the
// LIVE team + vault — so releasing/losing a monster made the species look un-caught
// again, and the in-round MP client (which doesn't carry the vault) couldn't tell a
// first catch at all. This module records every species the player has ever tamed in
// localStorage, surviving collection churn and serving BOTH modes.
//
// Pure core (`addDiscovered`) is engine-agnostic + unit-testable, like fx.js/shake.js;
// the localStorage wrappers degrade to no-ops off-browser. Keyed by lowercased typeName.

const KEY = "tq_discovered";
const norm = (s) => String(s || "").trim().toLowerCase();

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(raw) ? raw.map(norm).filter(Boolean) : [];
  } catch { return []; /* non-browser / malformed */ }
}
function persist(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* non-browser */ }
}

// Pure core: given the current discovered list and a typeName, return the (deduped)
// updated list plus whether this species was NEW to it. Side-effect-free → testable.
export function addDiscovered(list, typeName) {
  const t = norm(typeName);
  const arr = Array.isArray(list) ? [...new Set(list.map(norm).filter(Boolean))] : [];
  if (!t) return { list: arr, isNew: false };
  if (arr.includes(t)) return { list: arr, isNew: false };
  arr.push(t);
  return { list: arr, isNew: true };
}

// Record a catch. Returns true iff it's the player's first-ever of this species
// (i.e. the "NEW SPECIES!" milestone). Persists the updated set.
export function markDiscovered(typeName) {
  const { list, isNew } = addDiscovered(load(), typeName);
  if (isNew) persist(list);
  return isNew;
}

export function isDiscovered(typeName) {
  return load().includes(norm(typeName));
}

// Snapshot of every discovered species (lowercased), for the bestiary's caught state.
export function getDiscovered() {
  return new Set(load());
}
