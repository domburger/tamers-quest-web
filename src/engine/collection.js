import { getSeenSpecies } from "./discovered.js";

const norm = (s) => String(s || "").trim().toLowerCase();

export function newSpeciesCount(allTypes, caught, seen = getSeenSpecies()) {
  let n = 0;
  for (const mt of (allTypes || [])) {
    const t = norm(mt && mt.typeName);
    if (t && caught.has(t) && !seen.has(t)) n++;
  }
  return n;
}
