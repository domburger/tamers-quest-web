// FGT-T1 / PARITY-1 — the proof obligation: single-player and multiplayer resolve
// identical combat inputs IDENTICALLY through the same AI-judge path.
//
// SP reaches combat over HTTP (resolveTurnRequest / handleCombatHttp); MP over WS
// (resolveCombatAction). Both build combatant state the same way (buildState) and
// route the turn through the same shared resolver (aiTurn). This test mocks the AI
// judge deterministically and asserts the SP turn output equals the MP turn output
// for the same combatants + attacks — so the two modes can't drift.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData, getMonsterTypes, getAttacksForMonster } from "../src/engine/gamedata.js";
import { getMonsterStats } from "../src/engine/stats.js";
import { makeRng } from "../src/engine/rng.js";
import { resolveTurnRequest, resolveCombatAction, makeEnemy, aiTurn, buildState, handleCombatHttp } from "./combat.js";
import { setAiConfig } from "./aiconfig.js"; // these tests mock the v1 absolute-value judge; pin it (v2 is now the default)

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

// A mocked OpenAI judge that returns FIXED, in-range values regardless of the prompt,
// so identical combatants → identical output through either entry point.
const FIXED = { ph: 30, pe: 4, ps: "Burn", eh: 25, ee: 2, es: null, narrative: "Parity clash!" };
function mockJudgeFetch() {
  return async () => ({
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({
        playerMonster: { currentHealth: FIXED.ph, currentEnergy: FIXED.pe, status: FIXED.ps },
        enemyMonster: { currentHealth: FIXED.eh, currentEnergy: FIXED.ee, status: FIXED.es },
        narrative: FIXED.narrative,
      }) } }],
    }),
  });
}

function withMockedJudge(fn) {
  return async () => {
    const origKey = process.env.OPENAI_API_KEY, origFetch = global.fetch;
    process.env.OPENAI_API_KEY = "test-key";
    global.fetch = mockJudgeFetch();
    // The FIXED mock above is the v1 absolute-value judge shape; combatJudgeV2 now defaults
    // ON (deltas), so pin v1 here. Parity (SP==MP via the shared aiTurn) is judge-agnostic;
    // the v2 judge itself is covered in ai.test.js.
    await setAiConfig({ combatJudgeV2: false });
    try { await fn(); }
    finally {
      if (origKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = origKey;
      global.fetch = origFetch;
      await setAiConfig({ combatJudgeV2: "" }); // back to the default (ON)
    }
  };
}

const inst = (typeName, level) => {
  const st = getMonsterStats(getMonsterTypes().find((m) => m.typeName === typeName), level);
  return { id: "m_" + typeName, typeName, name: typeName, level, xp: 0, currentHealth: st.health, currentEnergy: st.energy, status: null };
};

test("PARITY-1: SP (HTTP) and MP (WS) resolve an identical turn identically via the AI path", withMockedJudge(async () => {
  loadData();
  const type = getMonsterTypes()[0].typeName;
  const LEVEL = 20; // high enough that the fixed AI HP/energy are within range (not clamped)
  const atkName = getAttacksForMonster(getMonsterTypes()[0])[0].name;

  // Sanity: the fixed judge values fit inside this monster's stat ranges (so clamp is a no-op).
  const st = getMonsterStats(getMonsterTypes()[0], LEVEL);
  assert.ok(st.health > FIXED.ph && st.health > FIXED.eh && st.energy > FIXED.pe, "fixture must exceed the fixed values");

  // SP path: the HTTP request handler core.
  const sp = await resolveTurnRequest({
    player: inst(type, LEVEL),
    enemy: inst(type, LEVEL),
    playerAttackName: atkName,
    enemyAttackName: null,
    initiator: null,
  });

  // MP path: the WS combat resolver (mutates the session; returns snapshots).
  const session = { combatId: "c1", team: [inst(type, LEVEL)], activeIdx: 0, enemy: makeEnemy({ typeName: type, level: LEVEL }) };
  const mp = await resolveCombatAction(session, { kind: "attack", attackName: atkName }, makeRng(1));

  // Both monsters survive the fixed turn → MP returns a normal turn (active/enemy snapshots).
  assert.ok(mp.active && mp.enemy, "MP turn is non-terminal");
  assert.equal(sp.player.currentHealth, mp.active.currentHealth, "player HP matches");
  assert.equal(sp.player.currentEnergy, mp.active.currentEnergy, "player energy matches");
  assert.equal(sp.player.status, mp.active.status, "player status matches");
  assert.equal(sp.enemy.currentHealth, mp.enemy.currentHealth, "enemy HP matches");
  assert.equal(sp.enemy.currentEnergy, mp.enemy.currentEnergy, "enemy energy matches");
  assert.equal(sp.enemy.status, mp.enemy.status, "enemy status matches");
  assert.equal(sp.narrative, mp.narrative, "narrative matches");

  // And the values are the JUDGE's (AI owns the turn), not some deterministic engine output.
  assert.equal(sp.player.currentHealth, FIXED.ph);
  assert.equal(sp.enemy.currentHealth, FIXED.eh);
  // TQ-457: a round is now TWO single-attacker passes, so the (same) mocked narrative is joined to itself.
  assert.equal(sp.narrative, `${FIXED.narrative} ${FIXED.narrative}`);
}));

test("aiTurn: the AI judge owns the turn when a key is set (engine is not consulted)", withMockedJudge(async () => {
  loadData();
  const type = getMonsterTypes()[0].typeName;
  const player = buildState(inst(type, 20)), enemy = buildState(inst(type, 20));
  const r = await aiTurn({ player, playerAttack: null, enemy, enemyAttack: null, initiator: null, rng: makeRng(1) });
  assert.equal(r.player.currentHealth, FIXED.ph, "used the AI result, not the engine");
  assert.equal(r.narrative, FIXED.narrative);
}));

test("aiTurn: a failed AI call falls back to the deterministic crash-net (one turn, no freeze)", async () => {
  loadData();
  const origKey = process.env.OPENAI_API_KEY, origFetch = global.fetch;
  process.env.OPENAI_API_KEY = "test-key";
  global.fetch = async () => { throw new Error("boom"); };
  try {
    const type = getMonsterTypes()[0].typeName;
    const player = buildState(inst(type, 20)), enemy = buildState(inst(type, 20));
    const r = await aiTurn({ player, playerAttack: null, enemy, enemyAttack: null, initiator: null, rng: makeRng(7) });
    assert.equal(typeof r.narrative, "string", "crash-net resolved the turn, no throw");
    assert.ok(Number.isFinite(r.player.currentHealth) && Number.isFinite(r.enemy.currentHealth));
  } finally {
    if (origKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = origKey;
    global.fetch = origFetch;
  }
});

// ─── The /api/combat/* HTTP surface that SP talks to ───
function mockRes() {
  const out = { status: 0, headers: {}, body: "" };
  return {
    out,
    setHeader(k, v) { out.headers[k] = v; },
    writeHead(s, h) { out.status = s; Object.assign(out.headers, h || {}); },
    end(b) { out.body = b || ""; },
  };
}
function mockReq(method, url, bodyObj, headers) {
  const handlers = {};
  const req = { method, url, headers, socket: {}, on(ev, cb) { handlers[ev] = cb; return req; } };
  // Drive the data/end events on next tick so handleCombatHttp's listeners are attached first.
  if (bodyObj !== undefined) {
    queueMicrotask(() => { handlers.data && handlers.data(JSON.stringify(bodyObj)); handlers.end && handlers.end(); });
  }
  return req;
}

test("GET /api/combat/status reports judge availability (gates SP's 'needs connection' UX)", async () => {
  loadData();
  const origKey = process.env.OPENAI_API_KEY;
  try {
    delete process.env.OPENAI_API_KEY;
    let res = mockRes();
    assert.equal(await handleCombatHttp(mockReq("GET", "/api/combat/status"), res), true);
    assert.equal(JSON.parse(res.out.body).available, false, "no key → unavailable");

    process.env.OPENAI_API_KEY = "test-key";
    res = mockRes();
    await handleCombatHttp(mockReq("GET", "/api/combat/status"), res);
    assert.equal(JSON.parse(res.out.body).available, true, "key → available");
  } finally {
    if (origKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = origKey;
  }
});

test("POST /api/combat/turn returns 503 when the judge is offline (no silent det. fight)", async () => {
  loadData();
  const origKey = process.env.OPENAI_API_KEY;
  try {
    delete process.env.OPENAI_API_KEY;
    const res = mockRes();
    const type = getMonsterTypes()[0].typeName;
    const handled = await handleCombatHttp(mockReq("POST", "/api/combat/turn", { player: inst(type, 5), enemy: inst(type, 5) }), res);
    assert.equal(handled, true);
    assert.equal(res.out.status, 503);
    assert.equal(JSON.parse(res.out.body).error, "ai_unavailable");
  } finally {
    if (origKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = origKey;
  }
});

test("POST /api/combat/turn resolves through the AI path when the judge is up", withMockedJudge(async () => {
  loadData();
  const type = getMonsterTypes()[0].typeName;
  const res = mockRes();
  await handleCombatHttp(mockReq("POST", "/api/combat/turn", { player: inst(type, 20), enemy: inst(type, 20), playerAttackName: null, enemyAttackName: null }), res);
  assert.equal(res.out.status, 200);
  const d = JSON.parse(res.out.body);
  assert.equal(d.player.currentHealth, FIXED.ph);
  assert.equal(d.enemy.currentHealth, FIXED.eh);
  // TQ-457: two single-attacker passes → the same mocked line is joined to itself; absolute HP unchanged.
  assert.equal(d.narrative, `${FIXED.narrative} ${FIXED.narrative}`);
}));

test("handleCombatHttp ignores non-combat URLs (returns false so static serving runs)", async () => {
  const res = mockRes();
  assert.equal(await handleCombatHttp(mockReq("GET", "/index.html"), res), false);
});

test("POST /api/combat/turn is per-IP flood-limited (protects the AI bill)", withMockedJudge(async () => {
  loadData();
  const type = getMonsterTypes()[0].typeName;
  const ip = "203.0.113.7"; // distinct IP so it can't contaminate other tests' default key
  const body = { player: inst(type, 20), enemy: inst(type, 20), playerAttackName: null, enemyAttackName: null };
  let got429 = false, ok = 0;
  // Capacity is 30; the 31st request from one IP within the window must be rejected.
  for (let i = 0; i < 31; i++) {
    const res = mockRes();
    await handleCombatHttp(mockReq("POST", "/api/combat/turn", body, { "x-forwarded-for": ip }), res);
    if (res.out.status === 429) { got429 = true; break; }
    if (res.out.status === 200) ok++;
  }
  assert.ok(ok >= 1, "legit turns succeed before the limit");
  assert.ok(got429, "a sustained single-IP flood is rate-limited (429)");
}));
