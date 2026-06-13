// PARITY-6 (PT2-T11 proof obligation): script a full run through the SHARED engine
// helpers that BOTH single-player (`fight.js`/`game.js`) and the authoritative
// server (`world.js`) route through. The whole parity contract is "SP and MP can't
// diverge because they call THESE" — so this integration test locks the composed
// behaviour in. Asserts each step against GAME constants (not brittle magic numbers),
// so it catches a formula/rule drift in any helper without breaking on a balance tune.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData, getMonsterTypes, getMonsterType } from "./gamedata.js";
import { getMonsterStats } from "./stats.js";
import { GAME, goldForDefeat } from "./schemas.js";
import { defeatGold, grantExtractRewards, stormDamageTeam } from "./progression.js";
import { addCaughtMonster, applyRoster, equipChain, nextChainId } from "./inventory.js";

function load() {
  const read = (f) => JSON.parse(readFileSync(`./public/assets/data/${f}`, "utf8"));
  setGameData({
    monsterTypes: read("monstertype.json"), attacks: read("attacks.json"),
    groundTiles: read("groundtiles.json"), items: read("item.json"),
    spiritChains: read("spiritchains.json"),
  });
}

test("PARITY-6: a scripted run resolves identically through the shared engine (SP == MP source)", () => {
  load();
  const name = getMonsterTypes()[0].name;
  const mon = (id, hp) => ({ id, typeName: name, level: 3, xp: 0, currentHealth: hp, currentEnergy: 0, status: null });
  const profile = {
    gold: 100, essence: 5,
    activeMonsters: [mon("a", 40), mon("b", 40), mon("c", 40), mon("d", 40)], // full team
    vaultMonsters: [],
    chains: [{ chainId: "t1" }, { chainId: "t2" }],
    equippedChainId: "t1",
    upgrades: {}, // no Prospector/Attunement/Deep-Vault → base multipliers
  };

  // 1) Defeat a Lv-5 wild monster → GOLD by the shared reward formula (TQ-132: essence is not earned).
  profile.gold += defeatGold(profile, 5);
  assert.equal(profile.gold, 100 + goldForDefeat(5), "defeat gold (no Prospector) = the base formula");

  // 2) A catch with a full team overflows to the vault.
  assert.equal(addCaughtMonster(profile, mon("caught", 1)), "vault", "full team → vault");
  assert.equal(profile.vaultMonsters.length, 1);

  // 3) Cycle the equipped chain ([ / ]) and equip it via the shared rules.
  const nxt = nextChainId(profile.chains, profile.equippedChainId, 1);
  assert.equal(nxt, "t2");
  assert.equal(equipChain(profile, nxt), true);
  assert.equal(profile.equippedChainId, "t2");
  assert.equal(equipChain(profile, "not-owned"), false, "can't equip an unowned chain");

  // 4) Storm chips the lead monster; team survives (others alive) → run continues.
  assert.equal(stormDamageTeam(profile.activeMonsters, 40), false, "lead faints, team not wiped");
  assert.equal(profile.activeMonsters[0].currentHealth, 0);

  // 5) Extract → survivors heal to full + the extract bonus banks.
  const goldBefore = profile.gold;
  grantExtractRewards(profile);
  assert.equal(profile.gold, goldBefore + GAME.GOLD.PER_EXTRACT, "extract bonus");
  for (const m of profile.activeMonsters) {
    const max = getMonsterStats(getMonsterType(m.typeName), m.level).health;
    assert.equal(m.currentHealth, max, "every active monster healed to full on extract");
  }

  // 6) Re-roster: keep only "b" active; the rest fall to the (capped) vault.
  assert.equal(applyRoster(profile, ["b"]), true);
  assert.equal(profile.activeMonsters.length, 1);
  assert.equal(profile.activeMonsters[0].id, "b");
  assert.ok(profile.vaultMonsters.some((m) => m.id === "caught"), "the caught monster stayed in the vault");
});
