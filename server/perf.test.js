// P6-T4 — snapshot-bandwidth regression guard.
//
// Snapshots are the dominant outbound traffic: emitted every other tick to every
// player, each AoI-filtered (self + nearby players/monsters/projectiles/chests +
// zone/portals). Bandwidth = per-player snapshot bytes × players × snapshot-rate.
// This test pins the per-player payload size and the 16-player aggregate so a
// future change that bloats the snapshot (e.g. dropping AoI filtering, or adding a
// fat field) fails CI instead of silently degrading the 16-player target.
//
// Budgets are generous (catch order-of-magnitude regressions, not micro-noise);
// the actual measured baseline is logged so it can be tightened deliberately.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData } from "../src/engine/gamedata.js";
import { createWorld, handleMessage, tickWorld } from "./world.js";

function loadData() {
  const read = (f) => JSON.parse(readFileSync(`./public/assets/data/${f}`, "utf8"));
  setGameData({
    monsterTypes: read("monstertype.json"), attacks: read("attacks.json"),
    groundTiles: read("groundtiles.json"), items: read("item.json"),
    spiritChains: read("spiritchains.json"),
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bytes = (obj) => Buffer.byteLength(JSON.stringify(obj), "utf8");

// Form one active round with a single matchmade player, then return the live
// round + the first player's id/rp so a test can inject extra players into it.
async function activeRound() {
  loadData();
  const sent = [];
  const send = (ws, obj) => sent.push({ ws, obj });
  const world = createWorld({ minPlayers: 1, countdownTicks: 1, circleStartS: 9999 });
  const conn = { ws: { readyState: 1 }, playerId: null };
  handleMessage(world, conn, { t: "join", nickname: "P0" }, send);
  handleMessage(world, conn, { t: "queue" }, send);
  tickWorld(world, 0.066, send); // forms round → async map gen
  const deadline = Date.now() + 9000;
  while (![...world.rounds.values()].some((r) => r.phase === "active")) {
    if (Date.now() > deadline) throw new Error("round never became active");
    await sleep(20);
  }
  const round = [...world.rounds.values()].find((r) => r.phase === "active");
  return { world, send, sent, round, id0: conn.playerId };
}

// Tick until an even (snapshot-emitting) tick fires, return that tick's snapshots.
function captureSnapshots(world, send, sent) {
  for (let i = 0; i < 3; i++) {
    sent.length = 0;
    tickWorld(world, 0.066, send);
    const snaps = sent.filter((m) => m.obj.t === "snapshot").map((m) => m.obj);
    if (snaps.length) return snaps;
  }
  throw new Error("no snapshot emitted within 3 ticks");
}

test("P6-T4: a realistic single-player snapshot stays within budget", async () => {
  const { world, send, sent, id0 } = await activeRound();
  const snaps = captureSnapshots(world, send, sent);
  const mine = snaps.find((s) => s.you.id === id0);
  assert.ok(mine, "self snapshot present");
  const size = bytes(mine);
  // `monsters` is OPTIONAL on the wire — world.js omits the field entirely when the diff is empty (no
  // monsters in AoI), a bandwidth optimization. The lone player's random map-gen spawn sometimes lands with
  // zero monsters nearby, so guard the access (was an unguarded mine.monsters.length → ~12% flake, TQ-540).
  console.log(`[perf] single-player snapshot = ${size} B (monsters in AoI: ${(mine.monsters || []).length})`);
  // A lone player sees self (team + chains) + nearby monsters + zone/portals.
  assert.ok(size < 16 * 1024, `single-player snapshot ${size}B exceeds 16KB budget`);
});

test("P6-T4: a clustered 16-player snapshot + aggregate stay within budget", async () => {
  const { world, send, sent, round, id0 } = await activeRound();
  const rp0 = round.players.get(id0);
  const base = world.sessions.get(id0).profile;

  // Isolate player-list growth: clear monsters so encounter logic can't lock
  // synthetic players mid-tick (their payload is measured by the test above).
  round.monsters = [];

  // Inject 15 rivals clustered tightly around P0 so they all fall inside AoI —
  // the worst case for the per-player `players[]` array. Clone P0's rp/profile
  // shape so tick logic finds every field it expects (no partial-object crashes).
  for (let i = 1; i < 16; i++) {
    const pid = "rival" + i;
    const profile = structuredClone(base);
    profile.id = pid;
    profile.name = "Rival" + i; // realistic name length
    world.sessions.set(pid, { ws: { readyState: 1 }, profile });
    round.players.set(pid, { ...rp0, x: rp0.x + ((i % 6) - 3) * 12, y: rp0.y + Math.floor(i / 6) * 12, lastSeq: i });
  }
  assert.equal(round.players.size, 16);

  const snaps = captureSnapshots(world, send, sent);
  assert.equal(snaps.length, 16, "one snapshot per player");
  const mine = snaps.find((s) => s.you.id === id0);
  assert.ok((mine.players || []).length >= 14, `expected clustered rivals in AoI, saw ${(mine.players || []).length}`); // same optional-field guard (TQ-540): a clean assert message, not a TypeError

  const per = snaps.map(bytes);
  const max = Math.max(...per);
  const total = per.reduce((a, b) => a + b, 0);
  console.log(`[perf] 16-player snapshots: max=${max} B, aggregate/broadcast=${total} B (~${(total / 1024).toFixed(1)} KB)`);

  // Each player sees up to 15 rivals (~60B each) + self; comfortably under 16KB.
  assert.ok(max < 16 * 1024, `largest 16-player snapshot ${max}B exceeds 16KB budget`);
  // One full broadcast to all 16 should stay well under 256KB.
  assert.ok(total < 256 * 1024, `16-player broadcast ${total}B exceeds 256KB budget`);
});
