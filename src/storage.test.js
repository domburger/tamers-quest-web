// rollStarters is the single source for a new character's team AND the Q10 death
// refill (createCharacter + loseRunTeam both use it). It's pure (game data only, no
// localStorage), so it's testable directly once the shared gamedata cache is loaded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData, getMonsterType } from "./engine/gamedata.js";
import { getMonsterStats } from "./engine/stats.js";
import { GAME } from "./engine/schemas.js";
import { rollStarters } from "./storage.js";

function load() {
  const read = (f) => JSON.parse(readFileSync(`./public/assets/data/${f}`, "utf8"));
  setGameData({
    monsterTypes: read("monstertype.json"), attacks: read("attacks.json"),
    groundTiles: read("groundtiles.json"), items: read("item.json"),
    spiritChains: read("spiritchains.json"),
  });
}

test("rollStarters returns a full TEAM_SIZE team of valid Lv.1 instances", () => {
  load();
  const team = rollStarters();
  assert.equal(team.length, GAME.TEAM_SIZE, "team is TEAM_SIZE (not a hardcoded count)");
  for (const m of team) {
    assert.ok(m.id, "each starter has a unique id");
    assert.ok(getMonsterType(m.typeName), "typeName resolves to a real monster type");
    assert.equal(m.level, 1, "starters are Lv.1");
    const st = getMonsterStats(getMonsterType(m.typeName), 1);
    assert.equal(m.currentHealth, st.health, "spawns at full HP");
    assert.equal(m.currentEnergy, st.energy, "spawns at full energy");
    assert.equal(m.status, null);
  }
  // Fresh ids each roll (no shared references between a new char and a refill).
  const ids = new Set(team.map((m) => m.id));
  assert.equal(ids.size, team.length, "ids are unique within a roll");
  assert.notEqual(rollStarters()[0].id, team[0].id, "a second roll yields fresh ids");
});
