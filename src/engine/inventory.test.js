import { test } from "node:test";
import assert from "node:assert/strict";
import { GAME } from "./schemas.js";
import { addCaughtMonster, applyRoster, equipChain, nextChainId, releaseMonster } from "./inventory.js";
import { goldForDefeat } from "./schemas.js";
import { defeatGold, defeatEssence } from "./progression.js";

const mon = (n) => ({ id: `m${n}`, typeName: "X", level: 1, currentHealth: 1, currentEnergy: 1 });
const fullTeam = () => Array.from({ length: GAME.TEAM_SIZE }, (_, i) => mon(i));

test("addCaughtMonster fills the active team first (up to TEAM_SIZE)", () => {
  const p = { activeMonsters: [], vaultMonsters: [] };
  for (let i = 0; i < GAME.TEAM_SIZE; i++) assert.equal(addCaughtMonster(p, mon(i)), "team");
  assert.equal(p.activeMonsters.length, GAME.TEAM_SIZE);
  assert.equal(p.vaultMonsters.length, 0);
});

test("addCaughtMonster overflows a full team into the vault", () => {
  const p = { activeMonsters: fullTeam(), vaultMonsters: [] };
  assert.equal(addCaughtMonster(p, mon(99)), "vault");
  assert.equal(p.vaultMonsters.length, 1);
});

test("addCaughtMonster releases when the vault is at capacity (no unbounded growth)", () => {
  const vault = Array.from({ length: GAME.VAULT_SIZE }, (_, i) => mon(1000 + i));
  const p = { activeMonsters: fullTeam(), vaultMonsters: vault, upgrades: {} };
  assert.equal(addCaughtMonster(p, mon(99)), "released");
  assert.equal(p.vaultMonsters.length, GAME.VAULT_SIZE, "vault didn't grow past base capacity");
});

test("addCaughtMonster: a Deep Vault upgrade raises the cap (vault, not released)", () => {
  const vault = Array.from({ length: GAME.VAULT_SIZE }, (_, i) => mon(1000 + i));
  const p = { activeMonsters: fullTeam(), vaultMonsters: vault, upgrades: { deepVault: 1 } };
  assert.equal(addCaughtMonster(p, mon(99)), "vault");
});

test("addCaughtMonster creates missing arrays defensively", () => {
  const p = {};
  assert.equal(addCaughtMonster(p, mon(1)), "team");
  assert.ok(Array.isArray(p.activeMonsters) && p.activeMonsters.length === 1);
});

test("nextChainId cycles owned chains forward/back with wrap; null when ≤1", () => {
  const chains = [{ chainId: "a" }, { chainId: "b" }, { chainId: "c" }];
  assert.equal(nextChainId(chains, "a", 1), "b");
  assert.equal(nextChainId(chains, "c", 1), "a", "wraps forward");
  assert.equal(nextChainId(chains, "a", -1), "c", "wraps backward");
  assert.equal(nextChainId(chains, "unknown", 1), "b", "missing current → start from index 0, step forward");
  // Nothing to cycle to.
  assert.equal(nextChainId([{ chainId: "only" }], "only", 1), null);
  assert.equal(nextChainId([], "x", 1), null);
  assert.equal(nextChainId(null, "x", 1), null);
});

test("equipChain only equips a chain the player owns (untrusted-id gate)", () => {
  const p = { chains: [{ chainId: "tier1" }, { chainId: "tier2" }], equippedChainId: "tier1" };
  assert.equal(equipChain(p, "tier2"), true);
  assert.equal(p.equippedChainId, "tier2");
  // A chain the player doesn't own is rejected; the equip is unchanged.
  assert.equal(equipChain(p, "guaranteed"), false);
  assert.equal(p.equippedChainId, "tier2");
  // Junk / empty id → no-op.
  assert.equal(equipChain(p, ""), false);
  assert.equal(equipChain({ chains: [] }, "tier1"), false);
});

// applyRoster — the shared field/store/swap rule (PT2-T11 PARITY-2/3), consumed by
// both SP and MP, was the one inventory-engine export without tests.
test("applyRoster: fields a vault monster and benches the displaced active one", () => {
  const p = { activeMonsters: [mon(0), mon(1)], vaultMonsters: [mon(2)] };
  assert.equal(applyRoster(p, ["m2", "m1"]), true);
  assert.deepEqual(p.activeMonsters.map((m) => m.id), ["m2", "m1"]); // m2 fielded
  assert.deepEqual(p.vaultMonsters.map((m) => m.id), ["m0"]);        // m0 benched
});

test("applyRoster: refuses to empty the team (no mutation on empty / all-invalid ids)", () => {
  const p = { activeMonsters: [mon(0), mon(1)], vaultMonsters: [] };
  assert.equal(applyRoster(p, []), false);
  assert.equal(applyRoster(p, ["nope"]), false);
  assert.deepEqual(p.activeMonsters.map((m) => m.id), ["m0", "m1"], "team untouched");
});

test("applyRoster: dedups repeated ids and ignores ids not in the pool", () => {
  const p = { activeMonsters: [mon(0)], vaultMonsters: [mon(1)] };
  assert.equal(applyRoster(p, ["m1", "m1", "bogus"]), true);
  assert.deepEqual(p.activeMonsters.map((m) => m.id), ["m1"]); // dup + bogus dropped
  assert.deepEqual(p.vaultMonsters.map((m) => m.id), ["m0"]);
});

test("applyRoster: caps the active team at TEAM_SIZE; the overflow goes to the vault", () => {
  const all = Array.from({ length: GAME.TEAM_SIZE + 1 }, (_, i) => mon(i));
  const p = { activeMonsters: all, vaultMonsters: [] };
  assert.equal(applyRoster(p, all.map((m) => m.id)), true);
  assert.equal(p.activeMonsters.length, GAME.TEAM_SIZE);
  assert.equal(p.vaultMonsters.length, 1); // the one that didn't fit
});

// releaseMonster — INV-T7: free a monster for an essence + level-scaled-gold refund.
test("releaseMonster: removes a vault monster and banks the scaled refund", () => {
  const p = { activeMonsters: [mon(0)], vaultMonsters: [mon(1)], gold: 100, essence: 5 };
  const r = releaseMonster(p, "m1");
  assert.equal(r.ok, true);
  assert.equal(r.from, "vault");
  assert.deepEqual(p.vaultMonsters, [], "released monster removed from the vault");
  assert.equal(r.reward.gold, defeatGold(p, 1));
  assert.equal(r.reward.essence, defeatEssence(p));
  assert.equal(p.gold, 100 + goldForDefeat(1), "gold banked on the profile");
  assert.equal(p.essence, 5 + defeatEssence(p), "essence banked on the profile");
});

test("releaseMonster: gold scales with the monster's level", () => {
  const p = { activeMonsters: [mon(0)], vaultMonsters: [{ id: "big", level: 7 }] };
  const r = releaseMonster(p, "big");
  assert.equal(r.ok, true);
  assert.equal(r.reward.gold, goldForDefeat(7), "higher-level release is worth more gold");
});

test("releaseMonster: releasing the only active monster promotes a vault one (keep ≥1 active)", () => {
  const p = { activeMonsters: [mon(0)], vaultMonsters: [mon(1)] };
  const r = releaseMonster(p, "m0");
  assert.equal(r.ok, true);
  assert.equal(r.from, "active");
  assert.deepEqual(p.activeMonsters.map((m) => m.id), ["m1"], "vault monster promoted to active");
  assert.deepEqual(p.vaultMonsters, []);
});

test("releaseMonster: refuses to release the player's last monster (no mutation)", () => {
  const p = { activeMonsters: [mon(0)], vaultMonsters: [], gold: 50, essence: 2 };
  const r = releaseMonster(p, "m0");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "last-monster");
  assert.deepEqual(p.activeMonsters.map((m) => m.id), ["m0"], "team untouched");
  assert.equal(p.gold, 50, "no refund on a refused release");
});

test("releaseMonster: unknown id is a no-op refusal", () => {
  const p = { activeMonsters: [mon(0), mon(1)], vaultMonsters: [], gold: 0, essence: 0 };
  const r = releaseMonster(p, "ghost");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not-found");
  assert.equal(p.activeMonsters.length, 2, "nothing removed");
  assert.equal(p.gold, 0);
});
