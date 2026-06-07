import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData, getMonsterTypes } from "../src/engine/gamedata.js";
import { getMonsterStats } from "../src/engine/stats.js";
import { getAttacksForMonster } from "../src/engine/gamedata.js";
import { makeRng } from "../src/engine/rng.js";
import { restoreEnergyPartial, makeEnemy, ownedAttack, resolveCombatAction, buildState } from "./combat.js";

function loadData() {
  const read = (f) => JSON.parse(readFileSync(`./public/assets/data/${f}`, "utf8"));
  setGameData({
    monsterTypes: read("monstertype.json"),
    attacks: read("attacks.json"),
    groundTiles: read("groundtiles.json"),
    items: read("item.json"),
    spiritChains: read("spiritchains.json"),
  });
}

// Build a minimal combat session (one full-HP player monster vs a wild enemy).
function freshSession(level = 3) {
  const t = getMonsterTypes()[0];
  const st = getMonsterStats(t, level);
  const pm = { id: "pm1", typeName: t.typeName, name: t.typeName, level, xp: 0, currentHealth: st.health, currentEnergy: st.energy, status: null };
  return { combatId: "c1", team: [pm], activeIdx: 0, enemy: makeEnemy({ typeName: t.typeName, level }) };
}
const firstAttack = () => getAttacksForMonster(getMonsterTypes()[0])[0].name;

// Q8: between-encounter energy "breather" so a depleted team isn't stuck skipping.
test("restoreEnergyPartial tops up by the pct, never exceeding max", () => {
  loadData();
  const mt = getMonsterTypes()[0];
  const max = getMonsterStats(mt, 1).energy;

  // From empty: +50% of max.
  const drained = { typeName: mt.typeName, level: 1, currentEnergy: 0 };
  const after = restoreEnergyPartial(drained, 50);
  assert.equal(after, Math.min(max, Math.ceil(max * 0.5)));
  assert.equal(drained.currentEnergy, after);

  // Near full: capped at max, never over.
  const nearFull = { typeName: mt.typeName, level: 1, currentEnergy: max - 1 };
  assert.equal(restoreEnergyPartial(nearFull, 50), max);

  // Default pct is 50.
  const d2 = { typeName: mt.typeName, level: 1, currentEnergy: 0 };
  assert.equal(restoreEnergyPartial(d2), Math.min(max, Math.ceil(max * 0.5)));
});

test("a drained monster reaches a usable energy level after one restore", () => {
  loadData();
  const mt = getMonsterTypes()[0];
  const inst = { typeName: mt.typeName, level: 1, currentEnergy: 0 };
  restoreEnergyPartial(inst);
  // Enough to afford a typical low-cost attack (so it won't just skip its turn).
  assert.ok(inst.currentEnergy > 0);
});

// Anti-cheat (P6-T2): a client may name any attack; only the monster's own count.
test("ownedAttack honors only the monster's own attacks", () => {
  loadData();
  const mt = getMonsterTypes()[0];
  const inst = { typeName: mt.typeName, level: 1 };
  const own = getAttacksForMonster(mt);
  assert.ok(own.length > 0, "fixture monster should have attacks");

  // An owned attack resolves to the real server-side record.
  const got = ownedAttack(inst, own[0].name);
  assert.equal(got?.name, own[0].name);

  // Unknown name, and blank/missing → null (resolver treats as a skip).
  assert.equal(ownedAttack(inst, "Definitely Not A Real Attack"), null);
  assert.equal(ownedAttack(inst, ""), null);
  assert.equal(ownedAttack(inst, undefined), null);

  // A real attack that this monster does NOT have → null (the cheat we block).
  const ownNames = new Set(own.map((a) => a.name));
  const all = JSON.parse(readFileSync("./public/assets/data/attacks.json", "utf8"));
  const foreign = (Array.isArray(all) ? all : Object.values(all)).find((a) => a.name && !ownNames.has(a.name));
  if (foreign) assert.equal(ownedAttack(inst, foreign.name), null, "off-roster attack must be rejected");
});

// Robustness: an owned monster whose (AI-generated) type an admin later deleted
// has an orphaned typeName → getMonsterType returns undefined. buildState must not
// throw on `mt.element`, and a full combat turn must resolve (degrades to neutral
// element + no usable moves) rather than crashing the round server-side.
test("buildState + resolveCombatAction tolerate an orphaned/deleted monster type", async () => {
  loadData();
  const orphan = { id: "o1", typeName: "__deleted_type__", name: "Ghost", level: 3, currentHealth: 30, currentEnergy: 10, status: null };
  const s = buildState(orphan);
  assert.equal(s.element, null, "missing type → neutral (null) element, not a throw");
  assert.ok(Number.isFinite(s.maxHealth) && Number.isFinite(s.strength), "fallback stats are finite");

  // End-to-end: an orphaned player monster vs a valid enemy still resolves.
  const enemy = makeEnemy({ typeName: getMonsterTypes()[0].typeName, level: 3 });
  const session = { combatId: "c1", team: [orphan], activeIdx: 0, enemy };
  const r = await resolveCombatAction(session, { kind: "attack", attackName: "whatever" }, makeRng(11));
  assert.equal(typeof r.narrative, "string"); // no crash; turn resolved
});

test("makeEnemy starts at full energy (sanity)", () => {
  loadData();
  const mt = getMonsterTypes()[0];
  const e = makeEnemy({ typeName: mt.typeName, level: 3 });
  assert.equal(e.currentEnergy, getMonsterStats(mt, 3).energy);
});

// resolveCombatAction — the core networked-combat resolver (the marquee feature).
test("resolveCombatAction: flee ends the fight", async () => {
  loadData();
  const r = await resolveCombatAction(freshSession(), { kind: "flee" }, makeRng(1));
  assert.equal(r.outcome, "fled");
});

test("resolveCombatAction: an attack resolves deterministically (no API key)", async () => {
  loadData();
  const r = await resolveCombatAction(freshSession(), { kind: "attack", attackName: firstAttack() }, makeRng(7));
  assert.equal(typeof r.narrative, "string");
  assert.ok(r.outcome || (r.active && r.enemy), "returns an outcome or updated snapshots");
});

test("resolveCombatAction: catch on a weakened enemy resolves without throwing", async () => {
  loadData();
  const s = freshSession();
  s.enemy.currentHealth = 1;
  const r = await resolveCombatAction(s, { kind: "catch" }, makeRng(3));
  assert.equal(typeof r.narrative, "string");
  assert.ok(r.outcome === "caught" || r.outcome || r.active, "caught, terminal, or a normal turn");
});

test("resolveCombatAction: a low-tier chain is rarity-gated and player-initiative skips retaliation", async () => {
  loadData();
  // An enemy too rare for tier1 (maxRarity 3): the catch must auto-fail.
  const rare = getMonsterTypes().find((m) => (m.rarity ?? 0) > 3) || getMonsterTypes()[0];
  const st = getMonsterStats(rare, 3);
  const pm = { id: "pm1", typeName: rare.typeName, name: rare.typeName, level: 3, xp: 0, currentHealth: st.health, currentEnergy: st.energy, status: null };
  const s = { combatId: "c1", team: [pm], activeIdx: 0, enemy: makeEnemy({ typeName: rare.typeName, level: 3 }), initiator: "player", chainId: "tier1" };
  s.enemy.currentHealth = 1; // weak, but the rarity gate still blocks tier1
  const r = await resolveCombatAction(s, { kind: "catch" }, makeRng(3));
  assert.notEqual(r.outcome, "caught");      // gated → cannot catch
  assert.equal(pm.currentHealth, st.health); // player-initiative skipped the enemy attack
});

test("resolveCombatAction: a guaranteed chain catches a weakened enemy", async () => {
  loadData();
  const s = freshSession();
  s.enemy.currentHealth = 1; // <= 25% → guaranteed
  s.chainId = "guaranteed";
  s.initiator = "player";
  const r = await resolveCombatAction(s, { kind: "catch" }, makeRng(3));
  assert.equal(r.outcome, "caught");
});

test("resolveCombatAction: a fight always reaches a terminal outcome", async () => {
  loadData();
  const s = freshSession();
  s.enemy.currentHealth = 1; // nearly dead → should end quickly
  let outcome = null;
  for (let i = 0; i < 80 && !outcome; i++) {
    outcome = (await resolveCombatAction(s, { kind: "attack", attackName: firstAttack() }, makeRng(100 + i))).outcome || null;
  }
  assert.ok(outcome === "won" || outcome === "lost", `terminal outcome reached, got ${outcome}`);
});

test("resolveCombatAction: AI failure falls back to the engine (combat never breaks)", async () => {
  loadData();
  const origKey = process.env.OPENAI_API_KEY, origFetch = global.fetch;
  process.env.OPENAI_API_KEY = "test-key";
  global.fetch = async () => { throw new Error("boom"); };
  try {
    const r = await resolveCombatAction(freshSession(), { kind: "attack", attackName: firstAttack() }, makeRng(5));
    assert.equal(typeof r.narrative, "string"); // resolved via deterministic fallback, no throw
    assert.ok(r.outcome || (r.active && r.enemy));
  } finally {
    if (origKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = origKey;
    global.fetch = origFetch;
  }
});
