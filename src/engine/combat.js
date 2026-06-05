// Deterministic, seeded combat resolver — the authoritative turn engine.
// Pure & framework-agnostic (no Kaboom/DOM/network): the same inputs + same RNG
// always produce the same result, so the server can resolve fights reproducibly
// and the client fallback shares identical rules.
//
// Combatant shape (normalized — see buildMonsterState in systems/combat.js):
//   { name, element, currentHealth, maxHealth, currentEnergy, maxEnergy,
//     strength, defense, speed, power, luck, status }
//
// NOTE: the attack data inflicts ~50 distinct status labels (Bleed, Blind,
// Confusion, Fear, …) plus some buffs (Heal, Shielded, …). The game-logic spec
// only defines mechanics for Burn/Poison/Freeze/Stun, so only those four have
// effects here; every other label is stored (and shown) but inert until a status
// taxonomy is designed. See docs/REQUIREMENTS.md §4.

// Map obvious synonyms onto the four canonical statuses.
const STATUS_ALIASES = {
  burn: "Burn", burning: "Burn", burned: "Burn",
  poison: "Poison", poisoned: "Poison",
  freeze: "Freeze", frozen: "Freeze",
  stun: "Stun", stunned: "Stun",
};

function normalizeStatus(s) {
  if (!s) return null;
  return STATUS_ALIASES[String(s).trim().toLowerCase()] || s; // keep label if unknown
}

function isCanonical(s) {
  return s === "Burn" || s === "Poison" || s === "Freeze" || s === "Stun";
}

export function elementMultiplier(attackElement, defenderElement) {
  const adv = { Fire: "Nature", Nature: "Water", Water: "Fire" };
  if (adv[attackElement] === defenderElement) return 1.3;
  if (adv[defenderElement] === attackElement) return 0.7;
  if (attackElement === "Dark" && defenderElement === "Light") return 1.2;
  if (attackElement === "Light" && defenderElement === "Dark") return 1.2;
  return 1.0;
}

// Start-of-action status tick. Returns { skip } — whether the actor loses its
// action this turn. Mutates `actor`.
function applyStatusTick(actor, rng, log) {
  switch (actor.status) {
    case "Burn": {
      const dmg = Math.max(1, Math.floor(actor.maxHealth * 0.05));
      actor.currentHealth = Math.max(0, actor.currentHealth - dmg);
      log.push(`${actor.name} takes ${dmg} burn damage.`);
      return { skip: false };
    }
    case "Poison": {
      const dmg = Math.max(1, Math.floor(actor.maxHealth * 0.03));
      actor.currentHealth = Math.max(0, actor.currentHealth - dmg);
      log.push(`${actor.name} takes ${dmg} poison damage.`);
      return { skip: false };
    }
    case "Freeze":
      if (rng.next() < 0.3) {
        log.push(`${actor.name} is frozen solid and can't move!`);
        return { skip: true };
      }
      return { skip: false };
    case "Stun":
      actor.status = null; // clears after costing one turn
      log.push(`${actor.name} is stunned and skips a turn!`);
      return { skip: true };
    default:
      return { skip: false }; // non-canonical statuses have no mechanic yet
  }
}

// Perform one attack from `actor` against `target`. Mutates both.
function performAttack(actor, attack, target, rng, log) {
  if (!attack) {
    log.push(`${actor.name} waits.`);
    return;
  }
  if (actor.currentEnergy < attack.energyCost) {
    log.push(`${actor.name} is out of energy and skips.`);
    return;
  }
  actor.currentEnergy -= attack.energyCost;

  // Accuracy: roll 0-100 must be <= accuracy*100 + luck/2
  if (rng.next() * 100 > attack.accuracy * 100 + actor.luck / 2) {
    log.push(`${actor.name}'s ${attack.name} misses!`);
    return;
  }

  // Damage: physical + elemental, min 1
  let dmg = actor.strength * (attack.damage / 100) - target.defense * (1 - attack.penetration);
  dmg += actor.power * attack.elementalDiffusion;
  dmg = Math.max(1, Math.floor(dmg));

  // Critical hit (rolled for BOTH attackers — previously only the player rolled)
  let crit = false;
  if (rng.next() * 100 <= attack.critChance * 100 + actor.luck / 4) {
    dmg = Math.floor(dmg * attack.critMultiplier);
    crit = true;
  }

  // Elemental matchup
  dmg = Math.max(1, Math.floor(dmg * elementMultiplier(attack.elementalType, target.element)));
  target.currentHealth = Math.max(0, target.currentHealth - dmg);
  log.push(`${actor.name}'s ${attack.name}${crit ? " CRITS" : ""} for ${dmg}!`);

  // Status infliction (one status at a time — new replaces old)
  if (attack.inflictedStatus && attack.statusChance > 0 && target.currentHealth > 0) {
    if (rng.next() < attack.statusChance) {
      const ns = normalizeStatus(attack.inflictedStatus);
      target.status = ns;
      log.push(`${target.name} is afflicted with ${ns}${isCanonical(ns) ? "!" : "."}`);
    }
  }
}

// Resolve one full turn. `rng` is a makeRng() instance (seed it deterministically
// on the server; randomly on the client fallback). Returns updated states +
// narrative. Does not mutate the inputs.
export function resolveTurn({ rng, player, playerAttack, enemy, enemyAttack }) {
  const p = { ...player, status: normalizeStatus(player.status) };
  const e = { ...enemy, status: normalizeStatus(enemy.status) };
  const log = [];

  // Turn order by speed; ties favor the player.
  const order =
    e.speed > p.speed
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

// Resolve a catch attempt. The enemy still attacks during the attempt.
export function resolveCatch({ rng, player, enemy, enemyAttack }) {
  const p = { ...player, status: normalizeStatus(player.status) };
  const e = { ...enemy, status: normalizeStatus(enemy.status) };
  const log = [];

  const hpPct = e.maxHealth > 0 ? e.currentHealth / e.maxHealth : 0;
  let chance = hpPct < 0.25 ? 0.7 : hpPct < 0.5 ? 0.4 : hpPct < 0.75 ? 0.2 : 0.05;
  if (e.status) chance += 0.15; // any status eases capture
  chance = Math.min(0.95, Math.max(0, chance));
  const caught = rng.next() < chance;

  // Enemy attacks during the attempt (resolve damage normally).
  if (e.currentHealth > 0) performAttack(e, enemyAttack, p, rng, log);

  const head = caught ? `${e.name} was caught!` : `${e.name} broke free!`;
  return {
    caught,
    player: { currentHealth: p.currentHealth, currentEnergy: p.currentEnergy, status: p.status },
    narrative: log.length ? `${head} ${log.join(" ")}` : head,
  };
}
