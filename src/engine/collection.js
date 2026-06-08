// Collection / bestiary progress helpers (PV-T16). Shared so the bestiary header and
// the lobby's Bestiary button show the SAME "caught" and "NEW" counts. Engine-agnostic
// + unit-testable; the persistence lives in discovered.js.

import { getDiscovered, getSeenSpecies } from "./discovered.js";

const norm = (s) => String(s || "").trim().toLowerCase();

// The set of species in the player's collection for bestiary purposes: every species
// ever discovered (persisted across runs) ∪ any currently held in the given lists
// (team/vault). The latter covers granted starters that were never caught through the
// catch flow (so they still count as owned). Returns a Set of lowercased typeNames.
export function caughtSpeciesSet(...heldLists) {
  const s = getDiscovered();
  for (const list of heldLists) {
    for (const m of (list || [])) { const t = norm(m && m.typeName); if (t) s.add(t); }
  }
  return s;
}

// Count of caught species the player hasn't yet inspected in the bestiary — the "NEW!"
// badge total. `allTypes` = every monster type; `caught`/`seen` are Sets of lowercased
// names (seen defaults to the persisted bestiary-seen set).
export function newSpeciesCount(allTypes, caught, seen = getSeenSpecies()) {
  let n = 0;
  for (const mt of (allTypes || [])) {
    const t = norm(mt && mt.typeName);
    if (t && caught.has(t) && !seen.has(t)) n++;
  }
  return n;
}
