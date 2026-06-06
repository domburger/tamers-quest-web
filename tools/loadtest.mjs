// P6-T4 — server load/perf harness (CPU & tick-time under sustained 16-player load).
//
// Complements the bandwidth guard (server/perf.test.js, which pins snapshot *size*).
// This drives the REAL authoritative world API directly (no sockets) with N
// simulated players all moving every tick, and measures wall-clock per tickWorld()
// — movement integration + per-axis tile collision + AoI snapshot building for the
// whole round. Reports avg/p50/p95/max tick time vs the 15 Hz real-time budget
// (66.7 ms), plus outbound snapshot volume.
//
// Monsters are cleared for the measured run so all N players stay mobile (worst
// case for movement+snapshot CPU); per-snapshot byte cost incl. monsters is
// covered by server/perf.test.js.
//
//   node tools/loadtest.mjs [players=16] [ticks=300]
//
// Exit non-zero if avg tick time blows past half the real-time budget (a real
// perf regression), so this can also gate CI if wired up.

import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { setGameData } from "../src/engine/gamedata.js";
import { createWorld, handleMessage, tickWorld } from "../server/world.js";

const PLAYERS = Number(process.argv[2]) || 16;
const TICKS = Number(process.argv[3]) || 300; // 300 ticks ≈ 20 s of 15 Hz play
const HZ = 15, DT = 1 / HZ, BUDGET_MS = 1000 / HZ;

function loadData() {
  const read = (f) => JSON.parse(readFileSync(`./public/assets/data/${f}`, "utf8"));
  setGameData({
    monsterTypes: read("monstertype.json"), attacks: read("attacks.json"),
    groundTiles: read("groundtiles.json"), items: read("item.json"),
    spiritChains: read("spiritchains.json"),
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

async function main() {
  loadData();
  let sentCount = 0, sentBytes = 0;
  const send = (_ws, obj) => { sentCount++; sentBytes += Buffer.byteLength(JSON.stringify(obj), "utf8"); };
  const world = createWorld({ minPlayers: PLAYERS, countdownTicks: 1, circleStartS: 9999, pvpEnabled: false });

  // Join + queue N players (each its own connection), then tick to form the round.
  const conns = [];
  for (let i = 0; i < PLAYERS; i++) {
    const conn = { ws: { readyState: 1 }, playerId: null };
    handleMessage(world, conn, { t: "join", nickname: "Load" + i }, send);
    handleMessage(world, conn, { t: "queue" }, send);
    conns.push(conn);
  }
  tickWorld(world, DT, send); // forms the round → async map generation begins

  const deadline = Date.now() + 12000;
  while (![...world.rounds.values()].some((r) => r.phase === "active")) {
    if (Date.now() > deadline) throw new Error("round never became active");
    await sleep(20);
  }
  const round = [...world.rounds.values()].find((r) => r.phase === "active");
  const inRound = [...round.players.keys()].length;
  round.monsters = []; // isolate movement+snapshot cost; keep all players mobile

  // Warm up (JIT) for a few ticks, then measure.
  for (let i = 0; i < 10; i++) { driveInputs(world, conns, i); tickWorld(world, DT, send); }
  sentCount = 0; sentBytes = 0;

  const times = [];
  for (let t = 0; t < TICKS; t++) {
    driveInputs(world, conns, t);
    const t0 = performance.now();
    tickWorld(world, DT, send);
    times.push(performance.now() - t0);
  }

  const sorted = [...times].sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const snapTicks = TICKS / 2; // snapshots emit every other tick
  const bcastBytes = sentBytes / snapTicks; // bytes per full broadcast

  console.log(`\n  Server load test — ${inRound} players, ${TICKS} ticks @ ${HZ} Hz (budget ${BUDGET_MS.toFixed(1)} ms/tick)`);
  console.log(`  ──────────────────────────────────────────────────────────────`);
  console.log(`  tick time   avg ${avg.toFixed(3)} ms   p50 ${pct(sorted, 50).toFixed(3)}   p95 ${pct(sorted, 95).toFixed(3)}   max ${sorted[sorted.length - 1].toFixed(3)}`);
  console.log(`  real-time   ${(avg / BUDGET_MS * 100).toFixed(2)}% of the per-tick budget used (avg)`);
  console.log(`  snapshots   ${sentCount} msgs over ${TICKS} ticks → ~${(bcastBytes / 1024).toFixed(1)} KB/broadcast, ~${(bcastBytes * (HZ / 2) / 1024).toFixed(1)} KB/s out`);
  console.log("");

  if (avg > BUDGET_MS / 2) {
    console.error(`  ✗ FAIL: avg tick ${avg.toFixed(2)} ms exceeds half the ${BUDGET_MS.toFixed(1)} ms budget — perf regression.`);
    process.exit(1);
  }
  console.log(`  ✓ OK: comfortable real-time headroom for ${inRound} players.\n`);
}

// Every player sends a move input; directions oscillate so they keep roaming and
// hit walls (exercising the per-axis collision path), not just drift into a corner.
function driveInputs(world, conns, t) {
  for (let i = 0; i < conns.length; i++) {
    const a = (t * 0.3) + (i * (Math.PI * 2 / conns.length));
    handleMessage(world, conns[i], { t: "input", seq: t, type: "move", payload: { dx: Math.cos(a), dy: Math.sin(a) } }, () => {});
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
