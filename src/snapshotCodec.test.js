import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeSnapshot, decodeSnapshot } from "./snapshotCodec.js";

// A full keyframe with every category populated + youMeta + circle/portals → round-trips exactly.
test("TQ-477 codec: full snapshot round-trips (entities, youMeta, gone, circle, portals)", () => {
  const msg = {
    t: "snapshot", tick: 12345, roundId: "round_abc", full: true,
    you: { id: "p1", x: 16000, y: -32000, ack: 99, stamina: 73, danger: 0.512 },
    time: 218, circle: { x: 100, y: 200, r: 1500 }, portals: [{ x: 5, y: 6 }, { x: 7, y: 8 }],
    youMeta: { team: [{ hp: 30, max: 50 }, { hp: 12, max: 40 }], chains: [{ chainId: "tier2", throwCount: 4, durability: 2 }], equippedChainId: "tier2", equippedChainIds: ["tier2", null, null], gold: 1234, essence: 7, upgrades: { speed: 2, bag: 1 } },
    players: [{ id: "rivalX", name: "Zağ", x: 9000, y: 9001, skinId: "neon", charId: "ember", chainTier: 3 }],
    monsters: [{ id: "mob_77", typeName: "Glimmerfox", level: 9, x: 100, y: 200 }, { id: "mob_8", typeName: "Voidcrab", level: 1, x: 0, y: 0 }],
    projectiles: [{ id: "pr5", owner: "p1", x: 11, y: 12, vx: 400, vy: -250, chainId: "tier2" }],
    chests: [{ id: "ch1", x: 320, y: 480 }],
    pGone: ["rivalGone"], mGone: ["mob_old1", "mob_old2"], prGone: ["pr1"], chGone: ["ch9"],
  };
  const dec = decodeSnapshot(encodeSnapshot(msg));
  assert.equal(dec.t, "snapshot"); assert.equal(dec.tick, 12345); assert.equal(dec.full, true);
  assert.equal(dec.roundId, "round_abc"); assert.equal(dec.time, 218);
  assert.deepEqual(dec.circle, msg.circle); assert.deepEqual(dec.portals, msg.portals);
  assert.equal(dec.you.id, "p1"); assert.equal(dec.you.x, 16000); assert.equal(dec.you.y, -32000);
  assert.equal(dec.you.ack, 99); assert.equal(dec.you.stamina, 73);
  assert.ok(Math.abs(dec.you.danger - 0.512) < 0.001, "danger survives 0..1 quantization");
  assert.deepEqual(dec.youMeta, msg.youMeta, "youMeta JSON tail round-trips (nested team/chains/upgrades)");
  assert.deepEqual(dec.players, msg.players, "players incl. unicode name + chainTier");
  assert.deepEqual(dec.monsters, msg.monsters);
  assert.deepEqual(dec.projectiles, msg.projectiles);
  assert.deepEqual(dec.chests, msg.chests);
  assert.deepEqual(dec.pGone, msg.pGone); assert.deepEqual(dec.mGone, msg.mGone);
  assert.deepEqual(dec.prGone, msg.prGone); assert.deepEqual(dec.chGone, msg.chGone);
});

// A lean delta (no entities, no youMeta) — the common steady-state frame — omits empty categories,
// matching the server's omit-empty JSON shape so the client delta-merge is identical either way.
test("TQ-477 codec: lean delta omits empty categories + null fields", () => {
  const msg = { t: "snapshot", tick: 7, roundId: "r", full: false, you: { id: "p1", x: 1, y: 2, ack: 3, stamina: 100, danger: 0 }, time: 60, circle: null, portals: [] };
  const dec = decodeSnapshot(encodeSnapshot(msg));
  assert.equal(dec.full, false);
  assert.equal(dec.circle, null);
  assert.deepEqual(dec.portals, []);
  assert.equal("players" in dec, false, "no players field when none changed");
  assert.equal("monsters" in dec, false);
  assert.equal("youMeta" in dec, false, "no youMeta when unchanged");
  assert.equal("pGone" in dec, false);
  assert.equal(dec.you.danger, 0);
});

test("TQ-477 codec: chainTier/level null sentinel + empty optional strings round-trip", () => {
  const msg = { t: "snapshot", tick: 1, roundId: "r", full: true, you: { id: "p", x: 0, y: 0, ack: 0, stamina: 0, danger: 1 }, time: 0, circle: null, portals: [],
    players: [{ id: "r1", name: "n", x: 1, y: 2, skinId: null, charId: null, chainTier: null }],
    monsters: [{ id: "m1", typeName: "T", level: null, x: 3, y: 4 }] };
  const dec = decodeSnapshot(encodeSnapshot(msg));
  assert.equal(dec.players[0].chainTier, null, "null chainTier survives");
  assert.equal(dec.players[0].skinId, null); assert.equal(dec.players[0].charId, null);
  assert.equal(dec.monsters[0].level, null, "null level survives");
  assert.equal(dec.you.danger, 1, "danger=1 (max) survives");
});

test("TQ-477 codec: rejects an unknown version byte", () => {
  const bad = encodeSnapshot({ t: "snapshot", tick: 0, roundId: "r", full: true, you: { id: "p", x: 0, y: 0, ack: 0, stamina: 0, danger: 0 }, time: 0, circle: null, portals: [] });
  bad[0] = 9; // corrupt the version
  assert.throws(() => decodeSnapshot(bad), /codec version/);
});
