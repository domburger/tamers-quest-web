import { test } from "node:test";
import assert from "node:assert/strict";
import { RARITIES, itemRarity, itemCategory, itemEffectText, itemCombatDescription, RARITY_DROP_WEIGHT, rollItemFromPool } from "./items.js";

test("itemRarity: defaults to common, validates the tier, lowercases", () => {
  assert.equal(itemRarity({}), "common", "un-tagged item → common");
  assert.equal(itemRarity({ rarity: "Rare" }), "rare", "case-insensitive");
  assert.equal(itemRarity({ rarity: "mythic" }), "common", "unknown tier falls back to common");
  assert.deepEqual(RARITIES, ["common", "uncommon", "rare", "epic", "legendary"]);
});

test("itemCategory: defaults to consumable", () => {
  assert.equal(itemCategory({}), "consumable");
  assert.equal(itemCategory({ category: "material" }), "material");
});

test("itemEffectText: structured effect → an explicit combat directive (self/enemy + magnitude)", () => {
  assert.equal(itemEffectText({ effect: { kind: "heal", target: "self", magnitude: "big" } }), "restore a large amount of the USER's own active monster's HP");
  assert.equal(itemEffectText({ effect: { kind: "damage", target: "enemy" } }), "deal direct damage to the ENEMY monster");
  assert.equal(itemEffectText({ effect: { kind: "cleanse", target: "self" } }), "cure the USER's own active monster's status ailment (burn/poison/freeze/etc.)");
  assert.equal(itemEffectText({ effect: { kind: "buff", target: "self", stat: "speed" } }), "raise the USER's own active monster's speed for a few turns");
  assert.equal(itemEffectText({}), "", "no effect → empty (judge falls back to free text)");
  assert.equal(itemEffectText({ effect: { kind: "bogus" } }), "", "unknown kind → empty");
});

test("itemCombatDescription: appends the effect directive, leaves plain items untouched", () => {
  const tagged = { description: "A glowing red vial.", effect: { kind: "heal", target: "self", magnitude: "small" } };
  assert.equal(itemCombatDescription(tagged), "A glowing red vial. (Effect: restore a small amount of the USER's own active monster's HP.)");
  assert.equal(itemCombatDescription({ description: "Just flavour." }), "Just flavour.", "no effect → description unchanged");
  assert.equal(itemCombatDescription({}), "", "empty item → empty string (no crash)");
});

test("rollItemFromPool: rarity-weighted pick (reproducible from a 0..1 rnd), null on empty (TQ-65)", () => {
  assert.equal(rollItemFromPool([], 0.5), null, "empty pool → null");
  assert.equal(rollItemFromPool(null, 0.5), null, "no pool → null");
  // weights: common 50, legendary 2 → total 52; common owns [0, 50/52), legendary [50/52, 1].
  const pool = [{ name: "C", rarity: "common" }, { name: "L", rarity: "legendary" }];
  assert.equal(rollItemFromPool(pool, 0).name, "C", "rnd=0 → first (common) bucket");
  assert.equal(rollItemFromPool(pool, 0.95).name, "C", "0.95 < 50/52 → still common");
  assert.equal(rollItemFromPool(pool, 0.99).name, "L", "past common's share → legendary");
  // Un-tagged items count as common (base rate), so they still drop.
  assert.equal(rollItemFromPool([{ name: "X" }], 0.5).name, "X", "un-tagged item is droppable");
  // Statistical: commons vastly outnumber legendaries over a uniform sweep.
  let commons = 0; const N = 2000;
  for (let i = 0; i < N; i++) if (rollItemFromPool(pool, i / N).name === "C") commons++;
  assert.ok(commons / N > 0.9, `commons dominate (${(commons / N * 100).toFixed(0)}% > 90%)`);
  assert.equal(RARITY_DROP_WEIGHT.common > RARITY_DROP_WEIGHT.legendary, true, "common weight > legendary weight");
});
