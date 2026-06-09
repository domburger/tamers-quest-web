// In-memory game-data store + accessors — pure, no fetch/DOM.
// A loader populates it once at startup via setGameData(): the client loader
// (src/data.js) fetches JSON; a server would read files/DB and call the same fn.

let monsterTypes = [];
let attacks = [];
let groundTiles = [];
let items = [];
let spiritChains = [];

/** @param {{monsterTypes?:Array, attacks?:Array, groundTiles?:Array, items?:Array, spiritChains?:Array}} data */
export function setGameData(data) {
  if (data.monsterTypes) monsterTypes = data.monsterTypes;
  if (data.attacks) attacks = data.attacks;
  if (data.groundTiles) groundTiles = data.groundTiles;
  if (data.items) items = data.items;
  if (data.spiritChains) spiritChains = data.spiritChains;
}

export function getMonsterTypes() {
  return monsterTypes;
}

// Append a (e.g. AI-generated) monster type to the live pool. Returns false if a
// type with the same name already exists. Used by the P5 generation pipeline.
export function addMonsterType(mt) {
  if (!mt || !mt.typeName || monsterTypes.some((m) => m.typeName === mt.typeName)) return false;
  monsterTypes.push(mt);
  return true;
}

// Remove a monster type from the live pool by name (admin curation, P7-T3).
export function removeMonsterType(name) {
  const i = monsterTypes.findIndex((m) => m.typeName === name);
  if (i < 0) return false;
  monsterTypes.splice(i, 1);
  return true;
}

export function getMonsterType(name) {
  return monsterTypes.find((m) => m.typeName === name);
}

// Empty the live monster pool (admin "clean wipe" — pairs with the DB wipe so the reset is
// live without a restart). Followed by AI generation to repopulate.
export function clearMonsterTypes() {
  monsterTypes = [];
}

export function getAttack(name) {
  return attacks.find((a) => a.name === name);
}

export function getAttacks() {
  return attacks;
}

// AI-authored attacks (genAttacks: {title, description}, from the v2 monster generator)
// are a monster's REAL moves under the descriptive (v2) combat judge, which resolves a
// turn from the chosen move's `description`. Map each to the engine's attack shape,
// synthesizing a NEUTRAL numeric profile (keyed off the monster's element) so the
// deterministic crash-net — used only if the AI judge is briefly unavailable — can still
// resolve the move. The live judge path reads only `name`/`description`, never the numbers.
function genAttackMove(ga, mt, i = 0) {
  // The 4 AI attacks carry no numeric data, so give them a light cost/power CURVE by slot
  // (cheaper+weaker → costlier+stronger). This makes the energy economy meaningful and the
  // four moves feel distinct in the UI (the cost shown per button) + the deterministic
  // crash-net, while the live descriptive judge resolves from `description`, not these numbers.
  return {
    name: ga.title,
    description: ga.description || "",
    damage: 34 + i * 6,        // 34, 40, 46, 52
    accuracy: 0.9,
    energyCost: 14 + i * 6,    // 14, 20, 26, 32
    critChance: 0.1,
    critMultiplier: 1.5,
    elementalType: mt.element || "Neutral",
    elementalDiffusion: 0.5,
    penetration: 0.25,
    elementalPenetration: 0.3,
    inflictedStatus: null,
    statusChance: 0,
  };
}

export function getAttacksForMonster(monsterType) {
  if (!monsterType) return []; // unknown/deleted type (e.g. an owned monster whose
  // generated type an admin removed) → no attacks instead of throwing on .attack_1,
  // which would crash combat resolution. Callers treat [] as "no usable move".
  // Prefer the monster's own AI-authored attacks when present (v2-generated monsters);
  // fall back to the legacy shared-pool refs (attack_1..4) for seed / v1-generated ones.
  const gen = monsterType.genAttacks;
  if (Array.isArray(gen) && gen.length) {
    const moves = gen.filter((a) => a && a.title).map((a, i) => genAttackMove(a, monsterType, i));
    if (moves.length) return moves;
  }
  return [
    monsterType.attack_1,
    monsterType.attack_2,
    monsterType.attack_3,
    monsterType.attack_4,
  ]
    .filter(Boolean)
    .map(getAttack)
    .filter(Boolean);
}

// CN-7: some attack names embed their own description ("Burrow Strike - Digs…",
// "Healing Light - Restores health…") — the AI generator appended it. Strip the
// " - <description>" suffix for DISPLAY + AI prompts (the text already lives in the
// `description` field). This is display-ONLY: the full name stays the lookup key,
// because monsters/`getAttack` reference it and two distinct attacks can share a
// base name (e.g. two different "Healing Light"), so stripping the key would
// collide. No `" - "` in a name → returned unchanged.
export function cleanAttackName(name) {
  return String(name || "").split(" - ")[0].trim();
}

export function getGroundTiles() {
  return groundTiles;
}

export function getItems() {
  return items;
}

// Add a generated item to the live pool (dedupe by name); returns false if a dupe. Mirrors
// addMonsterType so AI item generation + admin curation share the monster pattern.
export function addItem(item) {
  if (!item || !item.name || items.some((it) => it.name === item.name)) return false;
  items.push(item);
  return true;
}

export function removeItem(name) {
  const i = items.findIndex((it) => it.name === name);
  if (i < 0) return false;
  items.splice(i, 1);
  return true;
}

export function getItem(name) {
  return items.find((it) => it.name === name);
}

// Empty the live item pool (admin "clean wipe").
export function clearItems() {
  items = [];
}

export function getSpiritChains() {
  return spiritChains;
}

export function getSpiritChain(id) {
  return spiritChains.find((c) => c.id === id);
}
