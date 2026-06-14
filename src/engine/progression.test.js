// P10-T4 — shared grantXp (SP + server use one implementation).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData, getMonsterTypes, getMonsterType } from "./gamedata.js";
import { getMonsterStats } from "./stats.js";
import { GAME } from "./schemas.js";
import { goldForDefeat } from "./schemas.js";
import { grantXp, xpForLevel, healToFull, healTeam, extractGold, grantExtractRewards, defeatGold, stormDamageTeam, bumpStat, grantPlayerXp, playerDefeatXp, grantBattlePassXp, ensureBattlePassSeason, battlePassDefeatXp, claimBattlePassTier, isPremiumEntitled } from "./progression.js";
import { SEASON, tierForXp, rewardAt } from "./battlePass.js";

function load() {
  const read = (f) => JSON.parse(readFileSync(`./public/assets/data/${f}`, "utf8"));
  setGameData({
    monsterTypes: read("monstertype.json"), attacks: read("attacks.json"),
    groundTiles: read("groundtiles.json"), items: read("item.json"),
    spiritChains: read("spiritchains.json"),
  });
}
const someName = () => getMonsterTypes()[0].name;

test("grantXp: accumulates without leveling below the threshold", () => {
  load();
  const inst = { typeName: someName(), level: 1, xp: 0, currentHealth: 1, currentEnergy: 1 };
  assert.equal(grantXp(inst, GAME.XP_PER_LEVEL - 1), false);
  assert.equal(inst.level, 1);
  assert.equal(inst.xp, GAME.XP_PER_LEVEL - 1);
});

test("grantXp: levels up and heals to the new max at the threshold", () => {
  load();
  const inst = { typeName: someName(), level: 1, xp: 0, currentHealth: 1, currentEnergy: 0 };
  assert.equal(grantXp(inst, GAME.XP_PER_LEVEL), true);
  assert.equal(inst.level, 2);
  assert.equal(inst.xp, 0);
  assert.ok(inst.currentHealth > 1, "restored to new max HP on level-up");
  assert.ok(inst.currentEnergy > 0, "restored energy on level-up");
});

test("grantXp: applies multiple level-ups from one large grant, keeping remainder (exponential curve)", () => {
  load();
  const inst = { typeName: someName(), level: 1, xp: 0, currentHealth: 1, currentEnergy: 1 };
  // 230 XP on the exponential curve: L1→2 costs xpForLevel(1)=100 (130 left), L2→3 costs
  // xpForLevel(2)=115 (15 left), L3 needs 132 > 15 → stop. (Old FLAT curve gave xp 30.)
  grantXp(inst, 230);
  assert.equal(inst.level, 3);
  assert.equal(inst.xp, 15);
});

// TQ-186 — player-ACCOUNT XP/level (prestige track), same xpForLevel curve, no stats to recompute.
test("grantPlayerXp: advances account level/xp via the shared curve", () => {
  const prof = { level: 1, xp: 0 };
  assert.equal(grantPlayerXp(prof, xpForLevel(1) - 1), false, "below threshold → no level-up");
  assert.equal(prof.level, 1);
  assert.equal(grantPlayerXp(prof, 1), true, "crossing the threshold levels up");
  assert.equal(prof.level, 2);
  assert.equal(prof.xp, 0);
});

test("grantPlayerXp: multi-level from one grant + remainder; non-positive / null are no-ops", () => {
  const prof = { level: 1, xp: 0 };
  grantPlayerXp(prof, 230); // L1→2 (100), L2→3 (115) → 15 carry
  assert.equal(prof.level, 3);
  assert.equal(prof.xp, 15);
  assert.equal(grantPlayerXp(prof, 0), false);
  assert.equal(grantPlayerXp(null, 50), false);
  assert.equal(prof.level, 3, "no-op grants don't change the account");
});

test("playerDefeatXp scales with the defeated monster's level; grantExtractRewards adds the run bonus", () => {
  load();
  assert.equal(playerDefeatXp(1), GAME.PLAYER_XP.PER_DEFEAT_BASE + GAME.PLAYER_XP.PER_DEFEAT_PER_LEVEL);
  assert.ok(playerDefeatXp(5) > playerDefeatXp(1), "more XP for tougher wilds");
  const prof = { activeMonsters: [], gold: 0, level: 1, xp: 0 };
  grantExtractRewards(prof);
  assert.equal(prof.xp, GAME.PLAYER_XP.PER_EXTRACT, "extracting grants the account-XP bonus");
});

test("xpForLevel: a fixed EXPONENTIAL per-level curve (monster-gen spec)", () => {
  assert.equal(xpForLevel(1), 100, "level 1→2 costs XP_BASE");
  assert.equal(xpForLevel(2), 115, "grows by XP_GROWTH each level");
  assert.equal(xpForLevel(3), 132);
  assert.ok(xpForLevel(20) > xpForLevel(10) && xpForLevel(10) > xpForLevel(5), "strictly increasing");
  assert.equal(xpForLevel(0), xpForLevel(1), "floors at level 1");
});

test("healToFull restores HP/energy to the level max and clears status", () => {
  load();
  const name = someName();
  const inst = { typeName: name, level: 2, xp: 0, currentHealth: 1, currentEnergy: 0, status: "burn" };
  healToFull(inst);
  const st = getMonsterStats(getMonsterType(name), 2);
  assert.equal(inst.currentHealth, st.health);
  assert.equal(inst.currentEnergy, st.energy);
  assert.equal(inst.status, null);
});

test("healTeam heals every member (P10-T3 extract parity)", () => {
  load();
  const name = someName();
  const team = [
    { typeName: name, level: 1, currentHealth: 1, currentEnergy: 1, status: "poison" },
    { typeName: name, level: 1, currentHealth: 0, currentEnergy: 0 },
  ];
  healTeam(team);
  for (const m of team) assert.ok(m.currentHealth > 1 && m.status == null);
});

test("extractGold = base PER_EXTRACT with no upgrades, scaled by Prospector", () => {
  assert.equal(extractGold({}), GAME.GOLD.PER_EXTRACT);
  // prospector +20%/level → level 2 = 1.4× (matches goldMult in upgrades.js)
  assert.equal(extractGold({ upgrades: { prospector: 2 } }), Math.round(GAME.GOLD.PER_EXTRACT * 1.4));
});

test("defeatGold = goldForDefeat(level) with no upgrades, scaled by Prospector", () => {
  assert.equal(defeatGold({}, 3), goldForDefeat(3));
  assert.equal(defeatGold({ upgrades: { prospector: 2 } }, 3), Math.round(goldForDefeat(3) * 1.4));
});

// TQ-132: defeatEssence/chestEssence were removed — essence is the premium/paid currency,
// no longer earned in runs. Chain upgrades now cost gold (see schemas.test.js craftUpgrade).

test("stormDamageTeam chips the lead monster, then the next, and reports a wipe (SP/MP single source)", () => {
  const team = [
    { currentHealth: 30 },
    { currentHealth: 20 },
  ];
  // Chips the FIRST alive monster only.
  assert.equal(stormDamageTeam(team, 10), false);
  assert.equal(team[0].currentHealth, 20);
  assert.equal(team[1].currentHealth, 20);
  // Overkill clamps to 0 and moves to the next; not a wipe while #2 survives.
  assert.equal(stormDamageTeam(team, 999), false);
  assert.equal(team[0].currentHealth, 0);
  // Now it chips #2; the final blow reports a full-team wipe.
  assert.equal(stormDamageTeam(team, 999), true);
  assert.equal(team[1].currentHealth, 0);
  // An already-dead team is reported wiped (no active monster).
  assert.equal(stormDamageTeam([{ currentHealth: 0 }], 5), true);
  assert.equal(stormDamageTeam([], 5), true);
});

test("grantExtractRewards banks extract gold but does NOT auto-heal survivors (TQ-203/TQ-207)", () => {
  load();
  const name = someName();
  const profile = {
    gold: 5,
    activeMonsters: [{ typeName: name, level: 1, currentHealth: 1, currentEnergy: 0, status: "burn" }],
  };
  const granted = grantExtractRewards(profile);
  assert.equal(granted, GAME.GOLD.PER_EXTRACT, "returns the gold granted");
  assert.equal(profile.gold, 5 + GAME.GOLD.PER_EXTRACT, "adds to existing gold");
  const m = profile.activeMonsters[0];
  assert.equal(m.currentHealth, 1, "survivor keeps its injured HP — no auto-heal (the lobby Healer restores)");
  assert.equal(m.status, "burn", "status effects persist through extraction");
});

test("bumpStat initializes + increments lifetime counters; matches the server contract", () => {
  const p = {};
  bumpStat(p, "runs");
  assert.deepEqual(p.stats, { runs: 1 }, "creates stats + sets to 1");
  bumpStat(p, "runs");
  bumpStat(p, "caught", 3);
  assert.equal(p.stats.runs, 2, "increments existing");
  assert.equal(p.stats.caught, 3, "honors n");
  assert.doesNotThrow(() => bumpStat(null, "runs")); // no profile → no-op
  assert.doesNotThrow(() => bumpStat(p)); // no key → no-op
  assert.equal(Object.keys(p.stats).length, 2, "no-op calls add nothing");
});

// ── TQ-182: battle-pass XP earning + per-player season progress ──────────────
test("TQ-182: ensureBattlePassSeason initializes + resets on season rollover", () => {
  const fresh = {};
  ensureBattlePassSeason(fresh);
  assert.equal(fresh.bpSeasonId, SEASON.id);
  assert.equal(fresh.bpXp, 0);
  assert.deepEqual(fresh.bpClaimed, []);
  // a profile from a PRIOR season is wiped (no carry-over of XP/claims)
  const stale = { bpSeasonId: "s0", bpXp: 5000, bpClaimed: [1, 2, 3] };
  ensureBattlePassSeason(stale);
  assert.equal(stale.bpSeasonId, SEASON.id);
  assert.equal(stale.bpXp, 0);
  assert.deepEqual(stale.bpClaimed, []);
  // current-season profile is untouched
  const cur = { bpSeasonId: SEASON.id, bpXp: 250, bpClaimed: [1] };
  ensureBattlePassSeason(cur);
  assert.equal(cur.bpXp, 250);
  assert.deepEqual(cur.bpClaimed, [1]);
});

test("TQ-182: grantBattlePassXp accumulates for the current season", () => {
  const p = {};
  assert.equal(grantBattlePassXp(p, 60), 60);
  assert.equal(grantBattlePassXp(p, 60), 120);
  assert.equal(p.bpSeasonId, SEASON.id);
  assert.equal(tierForXp(p.bpXp), 1); // 120 XP → tier 1 (≥100)
  // guards: non-positive / non-numeric add nothing
  assert.equal(grantBattlePassXp(p, 0), 120);
  assert.equal(grantBattlePassXp(p, -5), 120);
  assert.equal(grantBattlePassXp(p, "x"), 120);
  // a stale-season profile resets THEN adds (no carry-over)
  const stale = { bpSeasonId: "s0", bpXp: 9999 };
  assert.equal(grantBattlePassXp(stale, 40), 40);
});

test("TQ-182: battlePassDefeatXp scales with level", () => {
  assert.equal(battlePassDefeatXp(1), GAME.BATTLE_PASS.XP_PER_DEFEAT_BASE + GAME.BATTLE_PASS.XP_PER_DEFEAT_PER_LEVEL);
  assert.ok(battlePassDefeatXp(5) > battlePassDefeatXp(1));
});

test("TQ-182: grantExtractRewards also awards battle-pass XP", () => {
  const p = { activeMonsters: [], gold: 0 };
  grantExtractRewards(p);
  assert.equal(p.bpXp, GAME.BATTLE_PASS.XP_PER_EXTRACT);
  assert.equal(p.bpSeasonId, SEASON.id);
});

test("TQ-183: isPremiumEntitled reflects the subscription flag", () => {
  assert.equal(isPremiumEntitled({}), false);
  assert.equal(isPremiumEntitled({ subscribed: false }), false);
  assert.equal(isPremiumEntitled({ subscribed: true }), true);
  assert.equal(isPremiumEntitled(null), false);
});

test("TQ-183: claimBattlePassTier — free track, reached-tier gating, idempotent", () => {
  const p = { bpSeasonId: SEASON.id, bpXp: 250, bpClaimed: [] }; // tier 2 reached
  assert.deepEqual(claimBattlePassTier(p, 3, "free"), { ok: false, reason: "locked-tier" }); // tier above reached
  const r1 = claimBattlePassTier(p, 1, "free");
  assert.equal(r1.ok, true);
  assert.deepEqual(r1.reward, rewardAt(1, "free"));
  assert.ok(p.bpClaimed.includes("free:1"));
  assert.deepEqual(claimBattlePassTier(p, 1, "free"), { ok: false, reason: "claimed" }); // idempotent
});

test("TQ-183: claimBattlePassTier — premium track requires the entitlement", () => {
  const p = { bpSeasonId: SEASON.id, bpXp: 250, bpClaimed: [] };
  assert.deepEqual(claimBattlePassTier(p, 1, "premium"), { ok: false, reason: "no-entitlement" });
  const r = claimBattlePassTier(p, 1, "premium", { entitled: true });
  assert.equal(r.ok, true);
  assert.deepEqual(r.reward, rewardAt(1, "premium"));
  assert.ok(p.bpClaimed.includes("premium:1"));
  assert.equal(claimBattlePassTier(p, 1, "free").ok, true); // free + premium of a tier are independent
});
