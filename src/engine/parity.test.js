import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData, getMonsterTypes } from "./gamedata.js";
import { GAME, goldForDefeat } from "./schemas.js";
import { defeatGold, grantExtractRewards } from "./progression.js";
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
    activeMonsters: [mon("a", 40), mon("b", 40), mon("c", 40), mon("d", 40)],
    vaultMonsters: [],
    chains: [{ chainId: "t1" }, { chainId: "t2" }],
    equippedChainId: "t1",
    upgrades: {},
  };

  profile.gold += defeatGold(profile, 5);
  assert.equal(profile.gold, 100 + goldForDefeat(5), "defeat gold (no Prospector) = the base formula");

  assert.equal(addCaughtMonster(profile, mon("caught", 1)), "vault", "full team → vault");
  assert.equal(profile.vaultMonsters.length, 1);

  const nxt = nextChainId(profile.chains, profile.equippedChainId, 1);
  assert.equal(nxt, "t2");
  assert.equal(equipChain(profile, nxt), true);
  assert.equal(profile.equippedChainId, "t2");
  assert.equal(equipChain(profile, "not-owned"), false, "can't equip an unowned chain");

  profile.activeMonsters[0].currentHealth = 0;

  const goldBefore = profile.gold;
  grantExtractRewards(profile);
  assert.equal(profile.gold, goldBefore + GAME.GOLD.PER_EXTRACT, "extract bonus");
  assert.equal(profile.activeMonsters[0].currentHealth, 0, "the fainted lead is NOT auto-healed on extract");

  assert.equal(applyRoster(profile, ["b"]), true);
  assert.equal(profile.activeMonsters.length, 1);
  assert.equal(profile.activeMonsters[0].id, "b");
  assert.ok(profile.vaultMonsters.some((m) => m.id === "caught"), "the caught monster stayed in the vault");
});
