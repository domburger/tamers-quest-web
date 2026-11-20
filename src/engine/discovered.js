const KEY = "tq_discovered";
const SEEN_KEY = "tq_bestiary_seen";
const ENCOUNTERED_KEY = "tq_encountered";
const norm = (s) => String(s || "").trim().toLowerCase();

function loadKey(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(raw) ? raw.map(norm).filter(Boolean) : [];
  } catch { return []; }
}
function persistKey(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch {}
}
const load = () => loadKey(KEY);
const persist = (list) => persistKey(KEY, list);

export function addDiscovered(list, typeName) {
  const t = norm(typeName);
  const arr = Array.isArray(list) ? [...new Set(list.map(norm).filter(Boolean))] : [];
  if (!t) return { list: arr, isNew: false };
  if (arr.includes(t)) return { list: arr, isNew: false };
  arr.push(t);
  return { list: arr, isNew: true };
}

export function markDiscovered(typeName) {
  const { list, isNew } = addDiscovered(load(), typeName);
  if (isNew) persist(list);
  return isNew;
}

export function isDiscovered(typeName) {
  return load().includes(norm(typeName));
}

export function getDiscovered() {
  return new Set(load());
}

export function markSpeciesSeen(typeName) {
  const { list, isNew } = addDiscovered(loadKey(SEEN_KEY), typeName);
  if (isNew) persistKey(SEEN_KEY, list);
  return isNew;
}

export function getSeenSpecies() {
  return new Set(loadKey(SEEN_KEY));
}

export function markEncountered(typeName) {
  const { list, isNew } = addDiscovered(loadKey(ENCOUNTERED_KEY), typeName);
  if (isNew) persistKey(ENCOUNTERED_KEY, list);
  return isNew;
}

export function getEncountered() {
  return new Set(loadKey(ENCOUNTERED_KEY));
}
