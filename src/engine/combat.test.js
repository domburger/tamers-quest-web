import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRng } from "./rng.js";
import { resolveTurn, resolveCatch, elementMultiplier } from "./combat.js";

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

test("elementMultiplier matchup table", () => {
  assert.equal(elementMultiplier("Fire", "Nature"), 1.3);
  assert.equal(elementMultiplier("Nature", "Water"), 1.3);
  assert.equal(elementMultiplier("Water", "Fire"), 1.3);
  assert.equal(elementMultiplier("Nature", "Fire"), 0.7);
  assert.equal(elementMultiplier("Dark", "Light"), 1.2);
  assert.equal(elementMultiplier("Light", "Dark"), 1.2);
  assert.equal(elementMultiplier("Neutral", "Fire"), 1.0);
});

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

test("insufficient energy skips the attack", () => {
  const r = resolveTurn({
    rng: makeRng(1),
    player: mob({ n: "P", hp: 200, en: 5, spd: 99, str: 100 }),
    playerAttack: atk({ damage: 100, e: 20 }), // costs 20, only 5 available
    enemy: mob({ n: "E", hp: 300, spd: 1 }), enemyAttack: null,
  });
  assert.equal(r.enemy.currentHealth, 300);
  assert.equal(r.player.currentEnergy, 5); // unchanged
});

test("catch returns a boolean and is deterministic per seed", () => {
  const args = () => ({
    rng: makeRng(3),
    player: mob({ n: "P", hp: 200 }),
    enemy: mob({ n: "E", hp: 20, max: 100 }), // 20% hp -> high catch chance
    enemyAttack: atk(),
  });
  const a = resolveCatch(args());
  const b = resolveCatch(args());
  assert.equal(typeof a.caught, "boolean");
  assert.equal(a.caught, b.caught);
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

test("captureMultiplier scales the catch chance across a seeded boundary", () => {
  // hp 60% -> base .2. rng.next() first draw with seed 9: pick a multiplier that
  // straddles it so the boolean flips.
  const args = (captureMultiplier) => ({
    rng: makeRng(9),
    player: mob({ n: "P", hp: 200 }),
    enemy: mob({ n: "E", hp: 60, max: 100 }),
    enemyAttack: atk(),
    captureMultiplier,
    enemyRarity: 3,
    maxRarity: 5,
  });
  const low = resolveCatch(args(0.1));  // chance .02 → very unlikely
  const high = resolveCatch(args(4));   // chance clamps to .95 → very likely
  assert.equal(low.caught, false);
  assert.equal(high.caught, true);
});

test("rarity gate auto-fails and skipEnemyAttack spares the player", () => {
  const r = resolveCatch({
    rng: makeRng(1),
    player: mob({ n: "P", hp: 200, max: 200 }),
    enemy: mob({ n: "E", hp: 10, max: 100, str: 100 }),
    enemyAttack: atk({ damage: 100 }),
    maxRarity: 3, enemyRarity: 5,   // too rare for this chain
    skipEnemyAttack: true,
  });
  assert.equal(r.caught, false);              // gated → cannot catch
  assert.equal(r.player.currentHealth, 200);  // enemy did not retaliate
});
