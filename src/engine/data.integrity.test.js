import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GAME } from "./schemas.js";

// Data-integrity guard for the shipped content (public/assets/data/*.json). Lots of
// tests USE this data, but none validated the FILES — a content authoring error (a
// typo'd attack name, a duplicate id, a missing starter chain) would pass every other
// test yet break the game at runtime. With AI generation + admin edits actively
// touching content, this locks the invariants. (All pass on the current data.)
const read = (f) => JSON.parse(readFileSync(`./public/assets/data/${f}`, "utf8"));
const monsters = read("monstertype.json");
const attacks = read("attacks.json");
const chains = read("spiritchains.json");

const dupes = (arr) => {
  const seen = new Set(), dup = new Set();
  for (const x of arr) { if (seen.has(x)) dup.add(x); seen.add(x); }
  return [...dup];
};

test("data: monster typeNames and ids are unique", () => {
  assert.deepEqual(dupes(monsters.map((m) => m.typeName)), [], "duplicate monster typeNames");
  assert.deepEqual(dupes(monsters.map((m) => m.id)), [], "duplicate monster ids");
});

test("data: every monster's attacks reference an attack that exists (no typo / removed move)", () => {
  const names = new Set(attacks.map((a) => a.name));
  const missing = [];
  for (const m of monsters) for (const k of ["attack_1", "attack_2", "attack_3", "attack_4"]) {
    const an = m[k];
    if (an && !names.has(an)) missing.push(`${m.typeName}.${k}="${an}"`);
  }
  assert.deepEqual(missing, [], "monsters reference attacks that don't exist");
});

test("data: every monster has a non-empty element string and a 1-5 rarity", () => {
  const bad = monsters.filter((m) => !m.element || typeof m.element !== "string" || !(Number(m.rarity) >= 1 && Number(m.rarity) <= 5));
  assert.deepEqual(bad.map((m) => m.typeName), [], "monsters with a missing element or out-of-range rarity");
});

test("data: attack names are unique and each has a name + elementalType", () => {
  assert.deepEqual(dupes(attacks.map((a) => a.name)), [], "duplicate attack names");
  const bad = attacks.filter((a) => !a.name || !a.elementalType);
  assert.deepEqual(bad.map((a) => a.name || "(unnamed)"), [], "attacks missing a name or elementalType");
});

test("data: chain ids are unique and every starter-chain id exists in spiritchains.json", () => {
  assert.deepEqual(dupes(chains.map((c) => c.id)), [], "duplicate chain ids");
  const ids = new Set(chains.map((c) => c.id));
  const starters = GAME.SPIRIT_CHAIN.STARTER_CHAIN_IDS?.length
    ? GAME.SPIRIT_CHAIN.STARTER_CHAIN_IDS
    : [GAME.SPIRIT_CHAIN.STARTER_CHAIN_ID];
  for (const id of new Set([GAME.SPIRIT_CHAIN.STARTER_CHAIN_ID, ...starters])) {
    assert.ok(ids.has(id), `starter chain "${id}" is missing from spiritchains.json (new players would be chainless)`);
  }
});
