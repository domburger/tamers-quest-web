// TQ-369: per-time generation scheduler. Exercises the pure "what's due" decision + the registry
// (no DB in tests → load/save are no-ops, so we drive defaults/overrides directly) + tickGenSchedule
// with injected generators (no content.js / no timers).
import { test } from "node:test";
import assert from "node:assert/strict";
import { initGenSchedule, getGenSchedule, allGenSchedule, setGenSchedule, computeDue, tickGenSchedule, DEFAULT_GEN_SCHEDULE } from "./genSchedule.js";

const HOUR = 3600000;

test("TQ-369: defaults are all OFF (operator opts in; generation costs OpenAI)", async () => {
  await initGenSchedule();
  assert.equal(getGenSchedule("biomesEnabled"), false);
  assert.equal(getGenSchedule("tilesEnabled"), false);
  assert.equal(getGenSchedule("monstersEnabled"), false);
  assert.equal(getGenSchedule("monstersEveryMs"), 24 * HOUR);
});

test("TQ-369: computeDue — enabled + interval elapsed (never-run is immediately due)", () => {
  const cfg = { biomesEnabled: true, biomesEveryMs: HOUR, tilesEnabled: false, tilesEveryMs: HOUR, monstersEnabled: true, monstersEveryMs: 2 * HOUR };
  const now = 10 * HOUR;
  // biomes never ran → due; monsters ran 1h ago but interval is 2h → not due
  assert.deepEqual(computeDue(cfg, { monsters: 9 * HOUR }, now), ["biomes"]);
  // monsters now 2h elapsed → due; biomes ran just now → not due
  assert.deepEqual(computeDue(cfg, { biomes: now, monsters: 8 * HOUR }, now), ["monsters"]);
  // disabled tiles never appear even if "elapsed"
  assert.ok(!computeDue(cfg, {}, now).includes("tiles"));
});

test("TQ-369: setGenSchedule validates + clamps the interval", async () => {
  await initGenSchedule();
  await setGenSchedule({ biomesEnabled: true, biomesEveryMs: 5 }); // below the 60s floor
  assert.equal(getGenSchedule("biomesEnabled"), true);
  assert.equal(getGenSchedule("biomesEveryMs"), 60000, "clamped to the 1-minute floor");
  const all = allGenSchedule();
  assert.equal(all.fields.biomesEnabled.current, true);
  assert.equal(all.fields.biomesEnabled.overridden, true);
});

test("TQ-369: tickGenSchedule runs only due assets + stamps last-run", async () => {
  await initGenSchedule();
  await setGenSchedule({ biomesEnabled: true, biomesEveryMs: HOUR, monstersEnabled: false, tilesEnabled: false });
  const calls = [];
  const gen = { biomes: async () => { calls.push("biomes"); return { name: "B" }; }, tiles: async () => { calls.push("tiles"); return null; }, monsters: async () => { calls.push("monsters"); return null; } };
  const ran = await tickGenSchedule(100 * HOUR, gen);
  assert.deepEqual(ran, ["biomes"]);
  assert.deepEqual(calls, ["biomes"], "only the enabled+due asset generates");
  // Immediately ticking again → not due (just stamped)
  const ran2 = await tickGenSchedule(100 * HOUR, gen);
  assert.deepEqual(ran2, []);
});

test("TQ-369: a generator returning null (AI off) is not counted as ran", async () => {
  await initGenSchedule();
  await setGenSchedule({ monstersEnabled: true, monstersEveryMs: HOUR, biomesEnabled: false, tilesEnabled: false });
  const ran = await tickGenSchedule(200 * HOUR, { biomes: async () => null, tiles: async () => null, monsters: async () => null });
  assert.deepEqual(ran, [], "null result (e.g. AI disabled) → nothing reported as generated");
});
