// In-memory game-data store + accessors — pure, no fetch/DOM.
// A loader populates it once at startup via setGameData(): the client loader
// (src/data.js) fetches JSON; a server would read files/DB and call the same fn.

let monsterTypes = [];
let attacks = [];
let groundTiles = [];
let items = [];

/** @param {{monsterTypes?:Array, attacks?:Array, groundTiles?:Array, items?:Array}} data */
export function setGameData(data) {
  if (data.monsterTypes) monsterTypes = data.monsterTypes;
  if (data.attacks) attacks = data.attacks;
  if (data.groundTiles) groundTiles = data.groundTiles;
  if (data.items) items = data.items;
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

export function getMonsterType(name) {
  return monsterTypes.find((m) => m.typeName === name);
}

export function getAttack(name) {
  return attacks.find((a) => a.name === name);
}

export function getAttacks() {
  return attacks;
}

export function getAttacksForMonster(monsterType) {
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

export function getGroundTiles() {
  return groundTiles;
}

export function getItems() {
  return items;
}
