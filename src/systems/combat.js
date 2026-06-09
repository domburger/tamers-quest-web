import { getMonsterType, getAttacksForMonster, getMonsterStats } from "../data.js";
import { makeRng, randomSeed } from "../engine/rng.js";
import { resolveCatch } from "../engine/combat.js";
import { resolveServerHttpUrl } from "../net.js";

// Single-player combat client (FGT-T1 / PARITY-1). Combat is AI-ONLY: every turn is
// resolved by the server's judge LLM — the SAME shared path multiplayer uses
// (server/combat.js `aiTurn`). The browser holds no API key, so SP routes one turn
// through the server over HTTP (POST /api/combat/turn). There is NO client-side
// deterministic combat path anymore: if the judge is unreachable the scene shows a
// "combat needs connection" message (CombatUnavailableError) instead of silently
// resolving offline.
//
// The catch attempt is the one exception: it's a deterministic spirit-chain mechanic
// (engine/spiritchains.js capture math, identical SP↔MP), not an LLM call, so it's
// resolved locally here — the same as the server resolves it for MP.

export class CombatUnavailableError extends Error {
  constructor(reason) { super(reason || "combat_unavailable"); this.name = "CombatUnavailableError"; }
}

// The enemy's move each turn (client picks from its OWN attacks; the server re-validates
// the name via ownedAttack, so this can't smuggle an off-roster move).
export function chooseEnemyAttack(monster) {
  const monsterType = getMonsterType(monster.typeName);
  if (!monsterType) return null;
  const allAttacks = getAttacksForMonster(monsterType);
  const affordable = allAttacks.filter((a) => a.energyCost <= monster.currentEnergy);
  if (affordable.length === 0) return null;
  return affordable[Math.floor(Math.random() * affordable.length)];
}

// Monster instance → the minimal shape the combat endpoint needs. The server derives
// stats (buildState) + max HP/energy itself, so SP and MP build state identically.
function instOf(m) {
  return {
    typeName: m.typeName,
    name: m.name || m.typeName,
    level: m.level,
    currentHealth: m.currentHealth,
    currentEnergy: m.currentEnergy,
    status: m.status || null,
  };
}

// Is the AI combat judge reachable? SP fights gate on this so an offline player gets
// a clear "needs connection" message rather than a stuck/blank fight.
export async function combatAvailable() {
  try {
    const res = await fetch(resolveServerHttpUrl() + "/api/combat/status", { cache: "no-store" });
    if (!res.ok) return false;
    const d = await res.json();
    return !!d.available;
  } catch {
    return false;
  }
}

// Resolve one turn through the server's AI judge. Throws CombatUnavailableError when
// the judge is unreachable/offline (no silent deterministic fallback on the client).
export async function evaluateTurn(playerMonster, playerAttack, enemyMonster, enemyAttack, opts = {}) {
  let res;
  try {
    res = await fetch(resolveServerHttpUrl() + "/api/combat/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        player: instOf(playerMonster),
        enemy: instOf(enemyMonster),
        playerAttackName: playerAttack?.name || null,
        enemyAttackName: enemyAttack?.name || null,
        initiator: opts.initiator || null,
        // #61: the player used an ITEM this turn instead of attacking — carry its
        // {name, description}; the server (combat.js) feeds the description to the judge,
        // resolved like an attack. Null on a normal turn.
        itemAction: opts.itemAction || null,
      }),
    });
  } catch {
    throw new CombatUnavailableError("offline");
  }
  if (res.status === 503) throw new CombatUnavailableError("ai_unavailable");
  if (!res.ok) throw new CombatUnavailableError("server_error");
  let d;
  try { d = await res.json(); } catch { throw new CombatUnavailableError("bad_response"); }
  return {
    playerHealth: d.player.currentHealth,
    playerEnergy: d.player.currentEnergy,
    playerStatus: d.player.status,
    enemyHealth: d.enemy.currentHealth,
    enemyEnergy: d.enemy.currentEnergy,
    enemyStatus: d.enemy.status,
    narrative: d.narrative,
  };
}

// Catch attempt — the shared deterministic chain mechanic (engine resolveCatch),
// resolved locally exactly as the server resolves it for MP. Not an AI call.
export function evaluateCatch(playerMonster, enemyMonster, enemyAttack, opts = {}) {
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
