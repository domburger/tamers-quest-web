import { test } from "node:test";
import assert from "node:assert/strict";
import { RARITIES, itemRarity, itemCategory, itemEffectText, itemCombatDescription } from "./items.js";

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
