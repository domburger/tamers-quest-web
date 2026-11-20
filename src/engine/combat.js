// Pure + deterministic (seeded rng only): server and client share it.

const STATUS_ALIASES = {
  burn: "Burn", burning: "Burn", burned: "Burn",
  poison: "Poison", poisoned: "Poison",
  freeze: "Freeze", frozen: "Freeze",
  stun: "Stun", stunned: "Stun",
};

export function normalizeStatus(s) {
  if (!s) return null;
  return STATUS_ALIASES[String(s).trim().toLowerCase()] || s;
}

function isCanonical(s) {
  return s === "Burn" || s === "Poison" || s === "Freeze" || s === "Stun";
}

const STATUS_FADE_CHANCE = 0.25;
const HEAL_FRACTION = 0.25;
const HEAL_RE = /heal|regen|recover|restore/i;
const STRUGGLE_STR_FRACTION = 0.05;

function applyStatusTick(actor, rng, log) {
  switch (actor.status) {
    case "Burn": {
      const dmg = Math.max(1, Math.floor(actor.maxHealth * 0.05));
      actor.currentHealth = Math.max(0, actor.currentHealth - dmg);
      log.push(`${actor.name} takes ${dmg} burn damage.`);
      if (actor.currentHealth > 0 && rng.next() < STATUS_FADE_CHANCE) {
        actor.status = null;
        log.push(`${actor.name}'s burn fades.`);
      }
      return { skip: false };
    }
    case "Poison": {
      const dmg = Math.max(1, Math.floor(actor.maxHealth * 0.03));
      actor.currentHealth = Math.max(0, actor.currentHealth - dmg);
      log.push(`${actor.name} takes ${dmg} poison damage.`);
      if (actor.currentHealth > 0 && rng.next() < STATUS_FADE_CHANCE) {
        actor.status = null;
        log.push(`${actor.name} recovers from the poison.`);
      }
      return { skip: false };
    }
    case "Freeze": {
      const frozen = rng.next() < 0.3;
      if (frozen) log.push(`${actor.name} is frozen solid and can't move!`);
      if (rng.next() < STATUS_FADE_CHANCE) {
        actor.status = null;
        log.push(`${actor.name} thaws out.`);
      }
      return { skip: frozen };
    }
    case "Stun":
      actor.status = null;
      log.push(`${actor.name} is stunned and skips a turn!`);
      return { skip: true };
    default:
      return { skip: false };
  }
}

function performAttack(actor, attack, target, rng, log) {
  if (!attack) {
    log.push(`${actor.name} waits.`);
    return;
  }
  if (actor.currentEnergy < attack.energyCost) {
    const dmg = Math.max(1, Math.floor(actor.strength * STRUGGLE_STR_FRACTION));
    target.currentHealth = Math.max(0, target.currentHealth - dmg);
    log.push(`${actor.name} is out of energy and struggles for ${dmg}.`);
    return;
  }
  actor.currentEnergy -= attack.energyCost;

  if (attack.damage <= 0 && HEAL_RE.test(`${attack.inflictedStatus || ""} ${attack.name || ""}`)) {
    const heal = Math.max(1, Math.floor(actor.maxHealth * HEAL_FRACTION));
    actor.currentHealth = Math.min(actor.maxHealth, actor.currentHealth + heal);
    log.push(`${actor.name}'s ${attack.name} restores ${heal} HP.`);
    return;
  }

  if (rng.next() * 100 > attack.accuracy * 100 + actor.luck / 2) {
    log.push(`${actor.name}'s ${attack.name} misses!`);
    return;
  }

  let dmg = actor.strength * (attack.damage / 100) - target.defense * (1 - attack.penetration);
  dmg += actor.power * attack.elementalDiffusion;
  dmg = Math.max(1, Math.floor(dmg));

  let crit = false;
  if (rng.next() * 100 <= attack.critChance * 100 + actor.luck / 4) {
    dmg = Math.floor(dmg * attack.critMultiplier);
    crit = true;
  }

  dmg = Math.max(1, Math.floor(dmg));
  target.currentHealth = Math.max(0, target.currentHealth - dmg);
  log.push(`${actor.name}'s ${attack.name}${crit ? " CRITS" : ""} for ${dmg}!`);

  if (attack.inflictedStatus && attack.statusChance > 0 && target.currentHealth > 0) {
    if (rng.next() < attack.statusChance) {
      const ns = normalizeStatus(attack.inflictedStatus);
      target.status = ns;
      log.push(`${target.name} is afflicted with ${ns}${isCanonical(ns) ? "!" : "."}`);
    }
  }
}

export function resolveTurn({ rng, player, playerAttack, enemy, enemyAttack, initiator }) {
  const p = { ...player, status: normalizeStatus(player.status) };
  const e = { ...enemy, status: normalizeStatus(enemy.status) };
  const log = [];

  const order =
    initiator === "player"
      ? [[p, playerAttack, e], [e, enemyAttack, p]]
      : initiator === "enemy"
        ? [[e, enemyAttack, p], [p, playerAttack, e]]
        : e.speed > p.speed
          ? [[e, enemyAttack, p], [p, playerAttack, e]]
          : [[p, playerAttack, e], [e, enemyAttack, p]];

  for (const [actor, attack, target] of order) {
    if (actor.currentHealth <= 0 || target.currentHealth <= 0) continue;
    const { skip } = applyStatusTick(actor, rng, log);
    if (skip || actor.currentHealth <= 0) continue;
    performAttack(actor, attack, target, rng, log);
  }

  return {
    player: { currentHealth: p.currentHealth, currentEnergy: p.currentEnergy, status: p.status },
    enemy: { currentHealth: e.currentHealth, currentEnergy: e.currentEnergy, status: e.status },
    narrative: log.join(" ") || "The monsters size each other up.",
  };
}

