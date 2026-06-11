import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRng } from "./rng.js";
import { resolveTurn } from "./combat.js";

// Helpers to build normalized combatants / attacks.
const mob = (o) => ({
  name: o.n ?? "M", element: o.el ?? "Neutral",
  currentHealth: o.hp, maxHealth: o.max ?? o.hp,
  currentEnergy: o.en ?? 100, maxEnergy: 100,
  strength: o.str ?? 80, defense: o.def ?? 0, speed: o.spd ?? 50,
  power: o.pow ?? 0, luck: o.luck ?? 0, status: o.status ?? null,
});
const atk = (o = {}) => ({
  name: o.name ?? "Strike", damage: o.damage ?? 100, accuracy: o.acc ?? 1,
  energyCost: o.e ?? 0, critChance: o.cc ?? 0, critMultiplier: o.cm ?? 2,
  elementalType: o.et ?? "Neutral", elementalDiffusion: o.ed ?? 0,
  penetration: o.pen ?? 1, elementalPenetration: 0,
  inflictedStatus: o.is ?? null, statusChance: o.sc ?? 0,
});

// Element matchups were REMOVED 2026-06-10 (elements are flavour only, no type-effectiveness);
// the old elementMultiplier table + its tests are gone. Damage = stats + move + crit only.

test("same seed yields identical results (determinism)", () => {
  const args = () => ({
    rng: makeRng(12345),
    player: mob({ n: "P", el: "Fire", hp: 300, str: 90, pow: 40 }),
    playerAttack: atk({ et: "Fire", ed: 0.5, pen: 0.2, cc: 0.2 }),
    enemy: mob({ n: "E", el: "Nature", hp: 300, def: 40 }),
    enemyAttack: atk({ et: "Nature", ed: 0.5, pen: 0.2, cc: 0.2 }),
  });
  assert.deepEqual(resolveTurn(args()), resolveTurn(args()));
});

test("enemy rolls crits too (was the bug): crit doubles damage", () => {
  // Enemy hits player for a clean 100 base; player skips. defense 0 + pen 1.
  const base = {
    player: mob({ n: "P", hp: 500, spd: 1, def: 0 }),
    playerAttack: null,
    enemy: mob({ n: "E", hp: 300, spd: 99, str: 100 }),
  };
  const crit = resolveTurn({ rng: makeRng(1), ...base,
    enemyAttack: atk({ damage: 100, cc: 1, cm: 2 }) });   // always crit
  const noCrit = resolveTurn({ rng: makeRng(1), ...base,
    enemyAttack: atk({ damage: 100, cc: 0, cm: 2 }) });   // never crit
  assert.equal(noCrit.player.currentHealth, 400); // 500 - 100
  assert.equal(crit.player.currentHealth, 300);   // 500 - 200
});

test("Burn ticks 5% max HP at start of turn", () => {
  const r = resolveTurn({
    rng: makeRng(1),
    player: mob({ n: "P", hp: 200, max: 200, spd: 99, status: "Burn" }),
    playerAttack: null,
    enemy: mob({ n: "E", hp: 200, spd: 1 }),
    enemyAttack: null,
  });
  assert.equal(r.player.currentHealth, 190); // 200 - floor(0.05*200)=10
});

test("Poison ticks 3% max HP", () => {
  const r = resolveTurn({
    rng: makeRng(1),
    player: mob({ n: "P", hp: 200, max: 200, spd: 99, status: "Poison" }),
    playerAttack: null,
    enemy: mob({ n: "E", hp: 200, spd: 1 }), enemyAttack: null,
  });
  assert.equal(r.player.currentHealth, 194); // 200 - floor(0.03*200)=6
});

test("Stun skips the action and clears", () => {
  const r = resolveTurn({
    rng: makeRng(1),
    player: mob({ n: "P", hp: 200, spd: 99, status: "Stun" }),
    playerAttack: atk({ damage: 100 }), // would hit, but stunned
    enemy: mob({ n: "E", hp: 200, spd: 1 }), enemyAttack: null,
  });
  assert.equal(r.enemy.currentHealth, 200); // enemy untouched
  assert.equal(r.player.status, null);      // stun cleared
});

test("CB-1: Burn wears off within a bounded number of turns (no longer permanent)", () => {
  // Regression for CB-1: Burn/Poison used to last until death. Thread the status
  // through successive turns (huge HP so the chip damage can't end it) and assert
  // it clears. Deterministic via the seeded rng.
  let status = "Burn";
  const rng = makeRng(3);
  let cleared = false;
  for (let i = 0; i < 50 && !cleared; i++) {
    const r = resolveTurn({
      rng,
      player: mob({ n: "P", hp: 999999, max: 200, spd: 99, status }),
      playerAttack: null,
      enemy: mob({ n: "E", hp: 999999, spd: 1 }), enemyAttack: null,
    });
    status = r.player.status;
    cleared = status === null;
  }
  assert.equal(cleared, true);
});

test("CB-1: Freeze wears off within a bounded number of turns (no longer permanent)", () => {
  // Freeze used to lock a monster for the rest of a fight (it had a skip roll but never
  // cleared) — out of line with the spec ("a status ticks until it wears off") and with
  // its siblings Burn/Poison/Stun, which all clear. Thread Freeze through turns and assert
  // it thaws. Deterministic via the seeded rng.
  let status = "Freeze";
  const rng = makeRng(3);
  let cleared = false;
  for (let i = 0; i < 50 && !cleared; i++) {
    const r = resolveTurn({
      rng,
      player: mob({ n: "P", hp: 999999, max: 200, spd: 99, status }),
      playerAttack: null,
      enemy: mob({ n: "E", hp: 999999, spd: 1 }), enemyAttack: null,
    });
    status = r.player.status;
    cleared = status === null;
  }
  assert.equal(cleared, true);
});

test("status infliction normalizes synonyms (Frozen -> Freeze)", () => {
  const r = resolveTurn({
    rng: makeRng(7),
    player: mob({ n: "P", hp: 200, spd: 99 }),
    playerAttack: atk({ damage: 10, is: "Frozen", sc: 1 }), // 100% inflict
    enemy: mob({ n: "E", hp: 500, spd: 1 }), enemyAttack: null,
  });
  assert.equal(r.enemy.status, "Freeze");
});

test("zero accuracy misses (no damage)", () => {
  const r = resolveTurn({
    rng: makeRng(5),
    player: mob({ n: "P", hp: 200, spd: 99, str: 100 }),
    playerAttack: atk({ damage: 100, acc: 0 }),
    enemy: mob({ n: "E", hp: 300, spd: 1 }), enemyAttack: null,
  });
  assert.equal(r.enemy.currentHealth, 300);
});

test("CB-5: out of energy -> a weak free Struggle (no deadlock), energy unspent", () => {
  const r = resolveTurn({
    rng: makeRng(1),
    player: mob({ n: "P", hp: 200, en: 5, spd: 99, str: 100 }),
    playerAttack: atk({ damage: 100, e: 20 }), // costs 20, only 5 available -> Struggle
    enemy: mob({ n: "E", hp: 300, spd: 1 }), enemyAttack: null,
  });
  assert.equal(r.enemy.currentHealth, 295); // struggled for floor(100*0.05)=5 (was: skipped, 300)
  assert.equal(r.player.currentEnergy, 5);  // Struggle is free
});

test("CB-2: a heal move restores the user instead of hitting the enemy for 1", () => {
  const r = resolveTurn({
    rng: makeRng(1),
    player: mob({ n: "P", hp: 100, max: 400, spd: 99, str: 100 }),
    playerAttack: atk({ name: "Healing Glow", damage: 0, is: "Regeneration", e: 0 }),
    enemy: mob({ n: "E", hp: 300, spd: 1 }), enemyAttack: null,
  });
  assert.equal(r.enemy.currentHealth, 300);  // enemy untouched (was hit for 1)
  assert.equal(r.player.currentHealth, 200); // healed floor(400*0.25)=100 -> 100+100
});

test("CB-2: a damage:0 buff/debuff is NOT mis-treated as a heal", () => {
  const r = resolveTurn({
    rng: makeRng(1),
    player: mob({ n: "P", hp: 100, max: 400, spd: 99, str: 100 }),
    playerAttack: atk({ name: "Iron Defense", damage: 0, is: "Defense Boost", e: 0 }),
    enemy: mob({ n: "E", hp: 300, def: 0, spd: 1 }), enemyAttack: null,
  });
  assert.equal(r.player.currentHealth, 100); // not a heal -> user unchanged
  assert.equal(r.enemy.currentHealth, 299);  // falls through to the normal (min-1) path
});

test("initiator forces turn order regardless of speed", () => {
  // Player is much slower but, with initiative, acts first and KOs the enemy
  // before it can retaliate.
  const base = {
    player: mob({ n: "P", hp: 50, spd: 1, str: 100, def: 0 }),
    playerAttack: atk({ damage: 100 }),
    enemy: mob({ n: "E", hp: 80, spd: 99, str: 100, def: 0 }),
    enemyAttack: atk({ damage: 100 }),
  };
  const playerFirst = resolveTurn({ rng: makeRng(1), ...base, initiator: "player" });
  assert.equal(playerFirst.enemy.currentHealth, 0);   // player KO'd it...
  assert.equal(playerFirst.player.currentHealth, 50); // ...so it never struck back
  const enemyFirst = resolveTurn({ rng: makeRng(1), ...base, initiator: "enemy" });
  assert.equal(enemyFirst.player.currentHealth, 0);   // enemy struck first instead
});

// Catching is no longer resolved by the engine (it moved to the AI capture judge,
// server/ai.js → aiResolveCatch, with no rarity gate or formula), so the former
// resolveCatch / captureMultiplier / rarity-gate tests were removed.
