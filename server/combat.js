// Server-side PvE combat resolution. Wraps the pure, tested engine resolver
// (engine/combat.js) with combatant-state building, enemy AI choice, XP, and
// faint/advance handling. Deterministic (offline/fallback path per decision Q3);
// the AI resolver layers on later behind the same interface when a key is set.

import { getMonsterType, getAttack, getAttacksForMonster } from "../src/engine/gamedata.js";
import { getMonsterStats } from "../src/engine/stats.js";
import { resolveTurn, resolveCatch } from "../src/engine/combat.js";
import { GAME } from "../src/engine/schemas.js";
import { aiEnabled, aiResolveTurn } from "./ai.js";

// Normalize a monster instance into the engine's combatant shape.
export function buildState(inst) {
  const mt = getMonsterType(inst.typeName);
  const st = getMonsterStats(mt, inst.level);
  return {
    name: inst.name || inst.typeName,
    element: mt.element,
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

function chooseEnemyAttack(inst, rng) {
  const all = getAttacksForMonster(getMonsterType(inst.typeName));
  const affordable = all.filter((a) => a.energyCost <= inst.currentEnergy);
  if (!affordable.length) return null;
  return affordable[Math.floor(rng.next() * affordable.length)];
}

function monSnap(inst) {
  const st = getMonsterStats(getMonsterType(inst.typeName), inst.level);
  return {
    name: inst.name || inst.typeName,
    typeName: inst.typeName,
    level: inst.level,
    currentHealth: inst.currentHealth,
    maxHealth: st.health,
    currentEnergy: inst.currentEnergy,
    status: inst.status || null,
  };
}

function grantXp(inst, amount) {
  inst.xp = (inst.xp || 0) + amount;
  let leveled = false;
  while (inst.xp >= GAME.XP_PER_LEVEL) {
    inst.xp -= GAME.XP_PER_LEVEL;
    inst.level += 1;
    leveled = true;
    const st = getMonsterStats(getMonsterType(inst.typeName), inst.level);
    inst.currentHealth = st.health;
    inst.currentEnergy = st.energy;
  }
  return leveled;
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

  if (action.kind === "flee") {
    return { narrative: "You fled the battle.", outcome: "fled" };
  }

  if (action.kind === "catch") {
    const r = resolveCatch({ rng, player: buildState(pm), enemy: buildState(enemy), enemyAttack: chooseEnemyAttack(enemy, rng) });
    pm.currentHealth = r.player.currentHealth;
    pm.currentEnergy = r.player.currentEnergy;
    pm.status = r.player.status;
    if (r.caught) return { narrative: r.narrative, outcome: "caught", caught: monSnap(enemy) };
    if (pm.currentHealth <= 0) return advanceOrLose(session, r.narrative);
    return { narrative: r.narrative, active: monSnap(pm), enemy: monSnap(enemy) };
  }

  // attack or skip — AI-resolved (core feature) with the deterministic engine as
  // automatic fallback (no key / API error).
  const atk = action.kind === "attack" ? getAttack(action.attackName) : null;
  const enemyAtk = chooseEnemyAttack(enemy, rng);
  const pState = buildState(pm), eState = buildState(enemy);
  let r;
  if (aiEnabled()) {
    try {
      r = await aiResolveTurn({ player: pState, playerAttack: atk, enemy: eState, enemyAttack: enemyAtk });
    } catch (e) {
      console.error("[combat] AI turn failed, using engine:", e.message);
      r = resolveTurn({ rng, player: pState, playerAttack: atk, enemy: eState, enemyAttack: enemyAtk });
    }
  } else {
    r = resolveTurn({ rng, player: pState, playerAttack: atk, enemy: eState, enemyAttack: enemyAtk });
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
