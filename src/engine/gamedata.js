import { getMonsterStats } from "./stats.js";

let monsterTypes = [];
let attacks = [];
let groundTiles = [];
let items = [];
let spiritChains = [];
let biomes = [];

// Reindex on every monsterTypes mutation; first name occurrence wins.
let monsterIndex = new Map();
function reindexMonsters() {
  monsterIndex = new Map();
  for (const m of monsterTypes) if (m && m.typeName != null && !monsterIndex.has(m.typeName)) monsterIndex.set(m.typeName, m);
}

let attackIndex = new Map();
function reindexAttacks() {
  attackIndex = new Map();
  for (const a of attacks) if (a && a.name != null && !attackIndex.has(a.name)) attackIndex.set(a.name, a);
}

export function setGameData(data) {
  if (data.monsterTypes) { monsterTypes = data.monsterTypes; reindexMonsters(); }
  if (data.attacks) { attacks = data.attacks; reindexAttacks(); }
  if (data.groundTiles) groundTiles = data.groundTiles;
  if (data.items) items = data.items;
  if (data.spiritChains) spiritChains = data.spiritChains;
  if (data.biomes) biomes = data.biomes;
}

export function getMonsterTypes() {
  return monsterTypes;
}

export function addMonsterType(mt) {
  if (!mt || !mt.typeName || monsterIndex.has(mt.typeName)) return false;
  monsterTypes.push(mt);
  monsterIndex.set(mt.typeName, mt);
  return true;
}

export function removeMonsterType(name) {
  const i = monsterTypes.findIndex((m) => m.typeName === name);
  if (i < 0) return false;
  monsterTypes.splice(i, 1);
  reindexMonsters();
  return true;
}

// Keep evolved types out of monsterTypes: they must never spawn or reach the bestiary.
let evolvedTypes = new Map();
export function addEvolvedType(mt) {
  if (!mt || !mt.typeName) return false;
  evolvedTypes.set(mt.typeName, mt);
  return true;
}
export function getEvolvedTypes() {
  return Array.from(evolvedTypes.values());
}
export function setEvolvedTypes(list) {
  evolvedTypes = new Map();
  for (const mt of (Array.isArray(list) ? list : [])) if (mt && mt.typeName) evolvedTypes.set(mt.typeName, mt);
}

export function getMonsterType(name) {
  return monsterIndex.get(name) || evolvedTypes.get(name);
}

export function clearMonsterTypes() {
  monsterTypes = [];
  monsterIndex = new Map();
}

export function getAttack(name) {
  return attackIndex.get(name);
}

export function getAttacks() {
  return attacks;
}

const GEN_COST_SHARE = [0.25, 0.4, 0.55, 0.75];
export function genAttackCost(mt, i = 0) {
  const fixed = 14 + i * 6;
  const e1 = Math.max(1, getMonsterStats(mt, 1).energy || 0);
  return Math.max(1, Math.min(fixed, Math.round(e1 * GEN_COST_SHARE[Math.max(0, Math.min(3, i))])));
}

function genAttackMove(ga, mt, i = 0) {
  return {
    name: ga.title,
    description: ga.description || "",
    damage: 34 + i * 6,
    accuracy: 0.9,
    energyCost: genAttackCost(mt, i),
    critChance: 0.1,
    critMultiplier: 1.5,
    elementalDiffusion: 0.5,
    penetration: 0.25,
    elementalPenetration: 0.3,
    inflictedStatus: null,
    statusChance: 0,
  };
}

export function getAttacksForMonster(monsterType) {
  if (!monsterType) return [];
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

// Display-only: keep the full name as the lookup key (base names collide).
export function cleanAttackName(name) {
  return String(name || "").split(" - ")[0].trim();
}

export function getGroundTiles() {
  return groundTiles;
}

// Append only, seed tiles first: server and client pool order must match.
export function addGroundTile(tile) {
  if (!tile || !tile.name || groundTiles.some((t) => t.name === tile.name)) return false;
  groundTiles.push(tile);
  return true;
}

export function removeGroundTile(name) {
  const i = groundTiles.findIndex((t) => t.name === name);
  if (i < 0) return false;
  groundTiles.splice(i, 1);
  return true;
}

export function clearGeneratedTiles() {
  groundTiles = groundTiles.filter((t) => !t.generated);
}

export function getItems() {
  return items;
}

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

export function clearItems() {
  items = [];
}

export function getBiomes() {
  return biomes;
}

export function addBiome(biome) {
  if (!biome || !biome.name || biomes.some((b) => b.name === biome.name)) return false;
  biomes.push(biome);
  return true;
}

export function removeBiome(name) {
  const i = biomes.findIndex((b) => b.name === name);
  if (i < 0) return false;
  biomes.splice(i, 1);
  return true;
}

export function clearBiomes() {
  biomes = [];
}

export function getSpiritChains() {
  return spiritChains;
}

export function getSpiritChain(id) {
  return spiritChains.find((c) => c.id === id);
}
