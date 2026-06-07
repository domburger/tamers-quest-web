// Server-side PvE combat resolution. Wraps the pure, tested engine resolver
// (engine/combat.js) with combatant-state building, enemy AI choice, XP, and
// faint/advance handling. Deterministic (offline/fallback path per decision Q3);
// the AI resolver layers on later behind the same interface when a key is set.

import { getMonsterType, getAttacksForMonster, getSpiritChain } from "../src/engine/gamedata.js";
import { getMonsterStats } from "../src/engine/stats.js";
import { resolveTurn, resolveCatch } from "../src/engine/combat.js";
import { GAME } from "../src/engine/schemas.js";
import { grantXp } from "../src/engine/progression.js";
import { aiEnabled, aiResolveTurn } from "./ai.js";

// Normalize a monster instance into the engine's combatant shape.
export function buildState(inst) {
  const mt = getMonsterType(inst.typeName);
  const st = getMonsterStats(mt, inst.level);
  return {
    name: inst.name || inst.typeName,
    element: mt?.element || null, // guard a missing/deleted type (matches monSnap + getMonsterStats); null → neutral matchups, not a crash
    currentHealth: inst.currentHealth,
    maxHealth: st.health,
    currentEnergy: inst.currentEnergy,
    maxEnergy: st.energy,
    strength: st.strength,
    defense: st.defense,
    speed: st.speed,
    power: st.power,
    luck: st.luck,
    status: inst.status || null,
  };
}

// Q8: a "breather" between encounters — restore a fraction of max energy to a
// monster so a depleted team isn't permanently stuck skipping turns (the engine
// makes a monster skip when it can't afford any attack). Never reduces; capped at
// max. Returns the new energy.
export function restoreEnergyPartial(inst, pct = 50) {
  const st = getMonsterStats(getMonsterType(inst.typeName), inst.level);
  const add = Math.ceil((st.energy * pct) / 100);
  inst.currentEnergy = Math.min(st.energy, (inst.currentEnergy || 0) + add);
  return inst.currentEnergy;
}

// A full-HP wild enemy instance from a map monster entry.
export function makeEnemy(entry) {
  const mt = getMonsterType(entry.typeName);
  const st = getMonsterStats(mt, entry.level);
  return {
    typeName: entry.typeName,
    name: entry.typeName,
    level: entry.level,
    xp: 0,
    currentHealth: st.health,
    currentEnergy: st.energy,
    status: null,
  };
}

export function attacksFor(inst) {
  return getAttacksForMonster(getMonsterType(inst.typeName)).map((a) => ({
    name: a.name,
    energyCost: a.energyCost,
    element: a.elementalType,
  }));
}

// Anti-cheat: resolve a requested attack ONLY if it belongs to the acting monster.
// Clients can name any attack in the game data; never honor an off-roster one.
// Unknown/unowned → null, which the resolver treats as a skipped turn.
export function ownedAttack(inst, name) {
  if (!name) return null;
  return getAttacksForMonster(getMonsterType(inst.typeName)).find((a) => a.name === name) || null;
}

function chooseEnemyAttack(inst, rng) {
  const all = getAttacksForMonster(getMonsterType(inst.typeName));
  const affordable = all.filter((a) => a.energyCost <= inst.currentEnergy);
  if (!affordable.length) return null;
  return affordable[Math.floor(rng.next() * affordable.length)];
}

function monSnap(inst) {
  const mt = getMonsterType(inst.typeName);
  const st = getMonsterStats(mt, inst.level);
  return {
    name: inst.name || inst.typeName,
    typeName: inst.typeName,
    element: mt?.element || null,
    level: inst.level,
    currentHealth: inst.currentHealth,
    maxHealth: st.health,
    currentEnergy: inst.currentEnergy,
    maxEnergy: st.energy,
    status: inst.status || null,
  };
}


function advanceOrLose(session, narrative) {
  const next = session.team.findIndex((m, i) => i !== session.activeIdx && m.currentHealth > 0);
  if (next < 0) {
    return { narrative: narrative + " Your last monster fainted!", outcome: "lost", active: monSnap(session.team[session.activeIdx]), enemy: null };
  }
  session.activeIdx = next;
  return {
    narrative: narrative + ` ${session.team[next].name || session.team[next].typeName} steps in!`,
    switched: true,
    active: monSnap(session.team[next]),
  };
}

// Resolve one combat action. Mutates the session's team / enemy in place.
// Returns { narrative, active, enemy, switched?, outcome?, caught? }.
export async function resolveCombatAction(session, action, rng) {
  const pm = session.team[session.activeIdx];
  const enemy = session.enemy;

  // Initiative (from a thrown chain) applies to the first action only.
  const initiator = session.initiator || null;
  session.initiator = null;

  if (action.kind === "flee") {
    return { narrative: "You fled the battle.", outcome: "fled" };
  }

  if (action.kind === "catch") {
    const def = session.chainId ? getSpiritChain(session.chainId) : null;
    const skipEnemyAttack = initiator === "player";
    const catchOpts = def
      ? {
          captureMultiplier: def.captureMultiplier,
          maxRarity: def.maxRarity,
          enemyRarity: getMonsterType(enemy.typeName)?.rarity ?? 0,
          guaranteed: def.special === "guaranteed",
          skipEnemyAttack,
        }
      : { skipEnemyAttack };
    const r = resolveCatch({ rng, player: buildState(pm), enemy: buildState(enemy), enemyAttack: chooseEnemyAttack(enemy, rng), ...catchOpts });
    pm.currentHealth = r.player.currentHealth;
    pm.currentEnergy = r.player.currentEnergy;
    pm.status = r.player.status;
    if (r.caught) return { narrative: r.narrative, outcome: "caught", caught: monSnap(enemy) };
    if (pm.currentHealth <= 0) return advanceOrLose(session, r.narrative);
    return { narrative: r.narrative, active: monSnap(pm), enemy: monSnap(enemy) };
  }

  // attack or skip — AI-resolved (core feature) with the deterministic engine as
  // automatic fallback (no key / API error). Anti-cheat: only the active monster's
  // own attacks are honored (an unowned/unknown name → null → a skipped turn).
  const atk = action.kind === "attack" ? ownedAttack(pm, action.attackName) : null;
  const enemyAtk = chooseEnemyAttack(enemy, rng);
  const pState = buildState(pm), eState = buildState(enemy);
  let r;
  if (aiEnabled()) {
    try {
      r = await aiResolveTurn({ player: pState, playerAttack: atk, enemy: eState, enemyAttack: enemyAtk, initiator });
    } catch (e) {
      console.error("[combat] AI turn failed, using engine:", e.message);
      r = resolveTurn({ rng, player: pState, playerAttack: atk, enemy: eState, enemyAttack: enemyAtk, initiator });
    }
  } else {
    r = resolveTurn({ rng, player: pState, playerAttack: atk, enemy: eState, enemyAttack: enemyAtk, initiator });
  }
  pm.currentHealth = r.player.currentHealth;
  pm.currentEnergy = r.player.currentEnergy;
  pm.status = r.player.status;
  enemy.currentHealth = r.enemy.currentHealth;
  enemy.currentEnergy = r.enemy.currentEnergy;
  enemy.status = r.enemy.status;

  if (enemy.currentHealth <= 0) {
    const leveled = grantXp(pm, 20 + enemy.level * 10);
    return {
      narrative: r.narrative + " The wild monster was defeated!" + (leveled ? " Your monster leveled up!" : ""),
      outcome: "won",
      active: monSnap(pm),
      enemy: monSnap(enemy),
    };
  }
  if (pm.currentHealth <= 0) return advanceOrLose(session, r.narrative);
  return { narrative: r.narrative, active: monSnap(pm), enemy: monSnap(enemy) };
}

export { monSnap };
