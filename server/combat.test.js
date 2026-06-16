import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData, getMonsterTypes, addMonsterType } from "../src/engine/gamedata.js";
import { getMonsterStats } from "../src/engine/stats.js";
import { getAttacksForMonster } from "../src/engine/gamedata.js";
import { makeRng } from "../src/engine/rng.js";
import { restoreEnergyPartial, makeEnemy, ownedAttack, resolveCombatAction, buildState, chooseEnemyAttack } from "./combat.js";

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

// Monsters as per spec: a v2-generated monster's AI-authored attacks (genAttacks: title +
// description) ARE its combat moves, judged by their descriptions (the now-default v2 judge).
test("genAttacks: a v2 monster's AI attacks are its moves (name+description+crash-net numerics) and reach the judge", async () => {
  loadData();
  const mt = {
    typeName: "Zzz Ember Drake", element: "Fire", rarity: 3,
    baseHealth: 90, baseStrength: 60, baseDefense: 50, baseSpeed: 70, basePower: 65, baseEnergy: 80, baseLuck: 40,
    healthScaling1: 1.1, healthScaling2: 0.9,
    genAttacks: [
      { title: "Ember Lash", description: "Whips the foe with a fiery tail, searing their hide." },
      { title: "Cinder Veil", description: "Cloaks itself in embers, hardening its scales." },
    ],
    attack_1: "Thorn Swipe", // a legacy pool ref that MUST be ignored in favor of genAttacks
  };
  addMonsterType(mt);
  const moves = getAttacksForMonster(mt);
  assert.equal(moves.length, 2, "the genAttacks are the moves (pool refs ignored)");
  assert.equal(moves[0].name, "Ember Lash", "genAttack title → move name");
  assert.ok(/searing/.test(moves[0].description), "carries the AI description (judge + UI)");
  assert.ok(moves[0].energyCost > 0 && moves[0].damage > 0,
    "synthesized numeric profile (crash-net) for the AI move");
  assert.ok(ownedAttack({ typeName: mt.typeName, level: 3 }, "Ember Lash"), "genAttack is an owned move");
  assert.equal(ownedAttack({ typeName: mt.typeName, level: 3 }, "Thorn Swipe"), null, "the ignored pool ref is NOT owned");

  // The default v2 judge reads the chosen genAttack's description — it must reach the prompt.
  const origKey = process.env.OPENAI_API_KEY, origFetch = global.fetch;
  process.env.OPENAI_API_KEY = "test-key";
  const bodies = [];
  global.fetch = async (_u, opts) => { bodies.push(String(opts && opts.body)); return { ok: true, status: 200, text: async () => "", json: async () => ({ choices: [{ message: { content: JSON.stringify({ enemyEdits: { currentHealth: -10 }, display: "Sear!" }) } }] }) }; };
  try {
    const s = { combatId: "cg", team: [{ id: "p", typeName: mt.typeName, name: "Drake", level: 5, currentHealth: 200, currentEnergy: 80, status: null }], activeIdx: 0, enemy: makeEnemy({ typeName: mt.typeName, level: 5 }) };
    await resolveCombatAction(s, { kind: "attack", attackName: "Ember Lash" }, makeRng(1));
    assert.ok(bodies.some((b) => /searing/.test(b)), "the genAttack description reached the v2 judge prompt (player pass)");
  } finally {
    if (origKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = origKey;
    global.fetch = origFetch;
  }
});

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
// throw, and a full combat turn must resolve (degrades to fallback stats + no usable
// moves) rather than crashing the round server-side.
test("buildState + resolveCombatAction tolerate an orphaned/deleted monster type", async () => {
  loadData();
  const orphan = { id: "o1", typeName: "__deleted_type__", name: "Ghost", level: 3, currentHealth: 30, currentEnergy: 10, status: null };
  const s = buildState(orphan);
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

test("resolveCombatAction: catch with no AI available fails safely (no rarity gate, no crash)", async () => {
  loadData();
  // Capture is AI-evaluated now (no rarity gate / formula). With no key the throw fails
  // SAFELY — never a free catch — and player-initiative still spares the retaliation.
  const origKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const s = freshSession();
    s.enemy.currentHealth = 1;
    s.chainId = "tier1";
    s.initiator = "player"; // chain-initiated → no enemy swing-back
    const hpBefore = s.team[0].currentHealth;
    const r = await resolveCombatAction(s, { kind: "catch" }, makeRng(3));
    assert.notEqual(r.outcome, "caught");                 // no AI → throw fails, not a free catch
    assert.equal(typeof r.narrative, "string");
    assert.equal(s.team[0].currentHealth, hpBefore);      // player-initiative skipped retaliation
  } finally {
    if (origKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = origKey;
  }
});

test("resolveCombatAction: the AI capture judge catches when it returns caught:1", async () => {
  loadData();
  // Mock the capture judge (catchJudgeSystem) returning a successful capture (1 + text).
  const origKey = process.env.OPENAI_API_KEY, origFetch = global.fetch;
  process.env.OPENAI_API_KEY = "test-key";
  global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ caught: 1, text: "The chain binds it!" }) } }] }) });
  try {
    const s = freshSession();
    s.enemy.currentHealth = 1;
    s.chainId = "tier1";
    s.initiator = "player";
    const r = await resolveCombatAction(s, { kind: "catch" }, makeRng(3));
    assert.equal(r.outcome, "caught");
    assert.ok(r.caught && r.caught.typeName, "returns the caught monster snapshot");
    assert.match(r.narrative, /chain binds it/);
  } finally {
    if (origKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = origKey;
    global.fetch = origFetch;
  }
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

// TQ-457 (PvE fight logic) — the core turn loop:
//   player chooses attack → judged & executed → simple AI picks the enemy's move →
//   judged & executed → control returns to the player (next turn).
// These lock the loop's contract so it can't silently regress.

test("TQ-457: the enemy 'simple AI' only ever picks an affordable OWNED attack", () => {
  loadData();
  const mt = getMonsterTypes()[0];
  const enemy = makeEnemy({ typeName: mt.typeName, level: 3 });
  const own = new Set(getAttacksForMonster(mt).map((a) => a.name));
  const rng = makeRng(42);
  // Many draws: every pick is one of the monster's own moves AND affordable right now.
  for (let i = 0; i < 50; i++) {
    const pick = chooseEnemyAttack(enemy, rng);
    assert.ok(pick && own.has(pick.name), "picks one of the enemy's own moves");
    assert.ok(pick.energyCost <= enemy.currentEnergy, "never picks an unaffordable move");
  }
});

test("TQ-457: the enemy skips its turn (null) when it cannot afford any move", () => {
  loadData();
  const mt = getMonsterTypes()[0];
  const enemy = makeEnemy({ typeName: mt.typeName, level: 3 });
  enemy.currentEnergy = 0; // can't afford anything → skip, not a crash
  assert.equal(chooseEnemyAttack(enemy, makeRng(1)), null);
});

test("TQ-457: a non-terminal attack turn resolves BOTH combatants and returns control to the player", async () => {
  loadData();
  const s = freshSession(5); // both at full HP → the turn shouldn't end the fight
  const r = await resolveCombatAction(s, { kind: "attack", attackName: firstAttack() }, makeRng(7));
  assert.ok(!r.outcome, "a single mid-fight turn is not terminal — the player acts again");
  assert.ok(r.active && typeof r.active.currentHealth === "number", "the player's monster state is returned");
  assert.ok(r.enemy && typeof r.enemy.currentHealth === "number", "the enemy's state is returned (it acted too)");
  assert.equal(typeof r.narrative, "string");
});

test("TQ-457 hard-sequential: a lethal player attack WINS with NO enemy retaliation (kill checked between passes)", async () => {
  loadData();
  const origKey = process.env.OPENAI_API_KEY, origFetch = global.fetch;
  process.env.OPENAI_API_KEY = "test-key";
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: true, status: 200, text: async () => "", json: async () => ({ choices: [{ message: { content: JSON.stringify({ playerMonster: { currentHealth: 9999 }, enemyMonster: { currentHealth: 0 }, playerEdits: {}, enemyEdits: { currentHealth: -9999 }, display: "A clean KO!", narrative: "A clean KO!" }) } }] }) }; };
  try {
    const s = freshSession(5);
    s.enemy.currentHealth = 1;
    const hpBefore = s.team[0].currentHealth;
    const r = await resolveCombatAction(s, { kind: "attack", attackName: firstAttack() }, makeRng(7));
    assert.equal(r.outcome, "won", "defeating the wild monster wins the fight");
    assert.equal(calls, 1, "ONLY the player's attack is judged — the defeated enemy never gets a retaliation pass");
    assert.equal(s.team[0].currentHealth, hpBefore, "the player's monster takes no damage from a monster it just killed");
  } finally {
    if (origKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = origKey;
    global.fetch = origFetch;
  }
});

// FGT-T4 (SP/MP parity): the MP "swap" action — switch the active monster to another
// living team member. A two-monster session for these.
function twoMonsterSession(level = 3) {
  const t = getMonsterTypes()[0];
  const st = getMonsterStats(t, level);
  const mk = (id, name, hp = st.health) => ({ id, typeName: t.typeName, name, level, xp: 0, currentHealth: hp, currentEnergy: st.energy, status: null });
  return { combatId: "c1", team: [mk("m0", "A"), mk("m1", "B")], activeIdx: 0, enemy: makeEnemy({ typeName: t.typeName, level }) };
}

test("resolveCombatAction: swap switches the active monster as a free action (no enemy attack)", async () => {
  loadData();
  const s = twoMonsterSession();
  const enemyHpBefore = s.enemy.currentHealth;
  const r = await resolveCombatAction(s, { kind: "swap", monsterId: "m1" }, makeRng(1));
  assert.equal(s.activeIdx, 1, "active switched to m1");
  assert.equal(r.switched, true);
  assert.equal(r.active.id, "m1");
  assert.ok(!r.outcome, "swap is not terminal");
  assert.equal(s.enemy.currentHealth, enemyHpBefore, "free swap — the enemy did not attack");
});

test("resolveCombatAction: swap to a dead/unknown/same monster is a no-op turn", async () => {
  loadData();
  const s = twoMonsterSession();
  s.team[1].currentHealth = 0; // m1 fainted
  for (const target of ["m1" /* dead */, "nope" /* unknown */, "m0" /* same */]) {
    const r = await resolveCombatAction(s, { kind: "swap", monsterId: target }, makeRng(1));
    assert.equal(s.activeIdx, 0, `no switch for "${target}"`);
    assert.ok(r.active && !r.switched, "no-op turn returns current state");
  }
});

test("resolveCombatAction: swap preserves first-turn initiative (SP parity)", async () => {
  loadData();
  const s = twoMonsterSession();
  s.initiator = "player";
  await resolveCombatAction(s, { kind: "swap", monsterId: "m1" }, makeRng(1));
  assert.equal(s.initiator, "player", "initiative is preserved across a swap");
});
