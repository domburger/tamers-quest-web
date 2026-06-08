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
const SEEN_KEY = "tq_bestiary_seen"; // PV-T16: species whose bestiary detail has been opened
const ENCOUNTERED_KEY = "tq_encountered"; // species met in the wild (the bestiary "seen, not yet caught" state)
const norm = (s) => String(s || "").trim().toLowerCase();

function loadKey(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(raw) ? raw.map(norm).filter(Boolean) : [];
  } catch { return []; /* non-browser / malformed */ }
}
function persistKey(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* non-browser */ }
}
const load = () => loadKey(KEY);
const persist = (list) => persistKey(KEY, list);

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

// PV-T16 — "NEW" badge state. A discovered species the player hasn't yet inspected in
// the bestiary is NEW; opening its detail clears the badge. Stored separately so the
// catch milestone (above) and the viewed-state don't entangle.

// Record that a species' bestiary detail was viewed. Returns true if newly marked.
export function markSpeciesSeen(typeName) {
  const { list, isNew } = addDiscovered(loadKey(SEEN_KEY), typeName);
  if (isNew) persistKey(SEEN_KEY, list);
  return isNew;
}

// Snapshot of every species the player has inspected in the bestiary (lowercased).
export function getSeenSpecies() {
  return new Set(loadKey(SEEN_KEY));
}

// Record meeting a species in the wild (combat encounter). Drives the bestiary's
// "seen, not yet caught" middle state — Pokédex-style: never-seen → encountered →
// caught. Returns true if newly recorded. Distinct from `discovered` (= caught) so a
// monster you fought-but-fled still reads as "seen".
export function markEncountered(typeName) {
  const { list, isNew } = addDiscovered(loadKey(ENCOUNTERED_KEY), typeName);
  if (isNew) persistKey(ENCOUNTERED_KEY, list);
  return isNew;
}

// Snapshot of every species the player has encountered in the wild (lowercased).
export function getEncountered() {
  return new Set(loadKey(ENCOUNTERED_KEY));
}
