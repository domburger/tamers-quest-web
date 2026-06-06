import { getMonsterType, getAttack, getAttacksForMonster, getMonsterStats } from "../data.js";
import { makeRng, randomSeed } from "../engine/rng.js";
import { resolveTurn, resolveCatch } from "../engine/combat.js";

export function chooseEnemyAttack(monster) {
  const monsterType = getMonsterType(monster.typeName);
  if (!monsterType) return null;
  const allAttacks = getAttacksForMonster(monsterType);
  const affordable = allAttacks.filter((a) => a.energyCost <= monster.currentEnergy);
  if (affordable.length === 0) return null;
  return affordable[Math.floor(Math.random() * affordable.length)];
}

function buildMonsterState(monster) {
  const mt = getMonsterType(monster.typeName);
  const stats = getMonsterStats(mt, monster.level);
  return {
    name: monster.name,
    typeName: monster.typeName,
    level: monster.level,
    element: mt?.element || "Normal", // type may be missing if data changed since save (getMonsterStats is already safe)
    currentHealth: monster.currentHealth,
    maxHealth: stats.health,
    currentEnergy: monster.currentEnergy,
    maxEnergy: stats.energy,
    strength: stats.strength,
    defense: stats.defense,
    speed: stats.speed,
    power: stats.power,
    luck: stats.luck,
    status: monster.status || null,
  };
}

// Single-player combat is resolved entirely by the deterministic engine. The
// browser never makes LLM calls and never sees an API key; multiplayer AI
// combat runs server-side with a Railway-held OPENAI_API_KEY.
export function evaluateTurn(playerMonster, playerAttack, enemyMonster, enemyAttack, opts = {}) {
  const { initiator = null } = opts;
  return fallbackCombat(playerMonster, playerAttack, enemyMonster, enemyAttack, initiator);
}

export function evaluateCatch(playerMonster, enemyMonster, enemyAttack, opts = {}) {
  return fallbackCatch(playerMonster, enemyMonster, enemyAttack, opts);
}

// Deterministic resolver (and the basis for the future server-authoritative
// resolver). Delegates to the shared engine, which fixes the old bugs: the enemy
// now rolls crits too, status effects (Burn/Poison/Freeze/Stun) tick and are
// applied, and turn order respects speed. A fresh random seed keeps the client
// fallback feeling random; the server passes a deterministic per-turn seed.
function fallbackCombat(playerMonster, playerAttack, enemyMonster, enemyAttack, initiator = null) {
  const player = buildMonsterState(playerMonster);
  const enemy = buildMonsterState(enemyMonster);
  const rng = makeRng(randomSeed());
  const r = resolveTurn({ rng, player, playerAttack, enemy, enemyAttack, initiator });
  return {
    playerHealth: r.player.currentHealth,
    playerEnergy: r.player.currentEnergy,
    playerStatus: r.player.status,
    enemyHealth: r.enemy.currentHealth,
    enemyEnergy: r.enemy.currentEnergy,
    enemyStatus: r.enemy.status,
    narrative: r.narrative,
  };
}

function fallbackCatch(playerMonster, enemyMonster, enemyAttack, opts = {}) {
  const player = buildMonsterState(playerMonster);
  const enemy = buildMonsterState(enemyMonster);
  const rng = makeRng(randomSeed());
  const r = resolveCatch({ rng, player, enemy, enemyAttack, ...opts });
  return {
    caught: r.caught,
    narrative: r.narrative,
    playerHealth: r.player.currentHealth,
    playerEnergy: r.player.currentEnergy,
    playerStatus: r.player.status,
  };
}
