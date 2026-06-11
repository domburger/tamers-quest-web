// Deterministic, seeded combat resolver — the authoritative turn engine.
// Pure & framework-agnostic (no Kaboom/DOM/network): the same inputs + same RNG
// always produce the same result, so the server can resolve fights reproducibly
// and the client fallback shares identical rules.
//
// Combatant shape (normalized — see buildState in server/combat.js):
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

// Exported so the AI-judge output path (server/ai.js) maps statuses by the SAME
// rule (FGT-T2): canonical synonyms (stunned→Stun, frozen→Freeze, …) unify so they
// get mechanics; unknown free-text labels are kept verbatim (Q7: AI interprets
// statuses freely).
export function normalizeStatus(s) {
  if (!s) return null;
  return STATUS_ALIASES[String(s).trim().toLowerCase()] || s; // keep label if unknown
}

function isCanonical(s) {
  return s === "Burn" || s === "Poison" || s === "Freeze" || s === "Stun";
}

// CB-1: chip statuses must wear off instead of lasting until death. After each
// tick they have a flat chance to clear (~1/FADE turns on average), so Burn/
// Poison are no longer permanent. Tunable balance knob. (Stun already self-clears
// after one turn; Freeze's expiry is a separate follow-up — see plan CB-1.)
const STATUS_FADE_CHANCE = 0.25;
// CB-2: a `damage<=0` HEAL move restores the user instead of (wrongly) hitting the
// enemy for 1. Crude deterministic-fallback amount (tunable); per-move amounts /
// lifesteal wait on FGT-T1. Heal-type moves are detected by their status/name so
// `damage:0` buffs (Reflect/Shielded/…) and debuffs (Blinded) are NOT mis-healed.
const HEAL_FRACTION = 0.25;
const HEAL_RE = /heal|regen|recover|restore/i;
// CB-5: out of energy → a weak free "Struggle" so two exhausted monsters don't skip
// forever (deadlock). Flat ~5% of the attacker's STR, ignores defense, no recoil.
const STRUGGLE_STR_FRACTION = 0.05;

// Start-of-action status tick. Returns { skip } — whether the actor loses its
// action this turn. Mutates `actor`.
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
      // CB-1: Freeze must WEAR OFF like Burn/Poison/Stun — the finalized status spec
      // requires every status to "tick until it wears off", not last until death. An
      // independent thaw roll (shared STATUS_FADE_CHANCE) means a monster can't be locked
      // for the rest of a fight. (Inflicted-this-turn parity with Burn/Poison, which can
      // also fade on the same turn they're applied.)
      if (rng.next() < STATUS_FADE_CHANCE) {
        actor.status = null;
        log.push(`${actor.name} thaws out.`);
      }
      return { skip: frozen };
    }
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
    // CB-5: can't afford the move → Struggle (weak, free) instead of skipping, so a
    // mutually-exhausted fight can't deadlock. Flat, ignores defense, always lands.
    const dmg = Math.max(1, Math.floor(actor.strength * STRUGGLE_STR_FRACTION));
    target.currentHealth = Math.max(0, target.currentHealth - dmg);
    log.push(`${actor.name} is out of energy and struggles for ${dmg}.`);
    return;
  }
  actor.currentEnergy -= attack.energyCost;

  // CB-2: a heal move (damage<=0 + a heal-type status/name) restores the user rather
  // than incorrectly hitting the enemy for 1. Detected narrowly so damage:0 buffs
  // (Reflect/Defense Boost/Shielded) and debuffs (Blinded) fall through unchanged.
  if (attack.damage <= 0 && HEAL_RE.test(`${attack.inflictedStatus || ""} ${attack.name || ""}`)) {
    const heal = Math.max(1, Math.floor(actor.maxHealth * HEAL_FRACTION));
    actor.currentHealth = Math.min(actor.maxHealth, actor.currentHealth + heal);
    log.push(`${actor.name}'s ${attack.name} restores ${heal} HP.`);
    return;
  }

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

  // Elemental matchups removed (2026-06-10, user) — elements are flavour only, no
  // type-effectiveness multiplier; damage comes from stats + the move + crit.
  dmg = Math.max(1, Math.floor(dmg));
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
export function resolveTurn({ rng, player, playerAttack, enemy, enemyAttack, initiator }) {
  const p = { ...player, status: normalizeStatus(player.status) };
  const e = { ...enemy, status: normalizeStatus(enemy.status) };
  const log = [];

  // Initiative (e.g. landing a spirit chain) forces who acts first; otherwise
  // turn order is by speed, ties favoring the player.
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

// NOTE: catching is no longer resolved here. It was a deterministic RNG mechanic
// (resolveCatch) gated by chain rarity + an HP-fraction/captureMultiplier formula.
// Catching is now AI-evaluated like a combat turn (server/ai.js → aiResolveCatch,
// driven by each chain's authored `catchPrompt`), with no rarity gate or formula.
