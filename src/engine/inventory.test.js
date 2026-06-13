import { test } from "node:test";
import assert from "node:assert/strict";
import { GAME } from "./schemas.js";
import { addCaughtMonster, applyRoster, equipChain, nextChainId, releaseMonster, loseRunTeam, resolveRosterDrag, setChainSlots } from "./inventory.js";
import { ensureChainSlots } from "./schemas.js";
import { goldForDefeat } from "./schemas.js";
import { defeatGold } from "./progression.js";

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

test("equipChain keeps the active chain inside the 3-slot loadout", () => {
  const p = { chains: [{ chainId: "tier1" }, { chainId: "tier2" }], equippedChainId: "tier1", equippedChainIds: ["tier1"] };
  equipChain(p, "tier2");
  assert.deepEqual(p.equippedChainIds, ["tier1", "tier2"], "a newly-equipped chain joins a free slot");
  assert.equal(p.equippedChainId, "tier2");
});

test("setChainSlots: validates ownership, dedupes, caps at CHAIN_SLOTS, pins the active id", () => {
  const p = { chains: [{ chainId: "tier1" }, { chainId: "tier2" }, { chainId: "tier3" }, { chainId: "tier4" }], equippedChainId: "tier1" };
  // unowned + duplicate ids are dropped; capped at 3; order preserved.
  setChainSlots(p, ["tier3", "tier3", "guaranteed", "tier2", "tier1"]);
  assert.deepEqual(p.equippedChainIds, ["tier3", "tier2", "tier1"]);
  // active wasn't in the new loadout (it was tier1 → still present here) — choose tier3 case:
  setChainSlots(p, ["tier4", "tier2"]);
  assert.deepEqual(p.equippedChainIds, ["tier4", "tier2"]);
  assert.equal(p.equippedChainId, "tier4", "active re-points to slot 0 when it falls out of the loadout");
});

test("setChainSlots: clearing every slot backfills from owned (never un-throwable)", () => {
  const p = { chains: [{ chainId: "tier1" }, { chainId: "tier2" }], equippedChainId: "tier1" };
  setChainSlots(p, []);
  assert.ok(p.equippedChainIds.length > 0, "empty loadout is refilled from inventory");
  assert.ok(p.equippedChainIds.includes(p.equippedChainId));
});

test("ensureChainSlots: drops unowned ids, backfills empties, pins active to a slot", () => {
  const p = { chains: [{ chainId: "tier1" }, { chainId: "tier2" }, { chainId: "tier3" }], equippedChainId: "stale", equippedChainIds: ["gone", "tier2"] };
  ensureChainSlots(p);
  assert.equal(p.equippedChainIds.length, 3);
  assert.ok(p.equippedChainIds.includes("tier2"));
  assert.ok(p.equippedChainIds.includes(p.equippedChainId), "active points at an owned, slotted chain");
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

// releaseMonster — INV-T7: free a monster for a level-scaled GOLD refund (TQ-132: no essence).
test("releaseMonster: removes a vault monster and banks the scaled refund", () => {
  const p = { activeMonsters: [mon(0)], vaultMonsters: [mon(1)], gold: 100, essence: 5 };
  const r = releaseMonster(p, "m1");
  assert.equal(r.ok, true);
  assert.equal(r.from, "vault");
  assert.deepEqual(p.vaultMonsters, [], "released monster removed from the vault");
  assert.equal(r.reward.gold, defeatGold(p, 1));
  assert.equal(r.reward.essence, undefined, "no essence refund — essence is premium/paid");
  assert.equal(p.gold, 100 + goldForDefeat(1), "gold banked on the profile");
  assert.equal(p.essence, 5, "essence untouched by release");
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

// loseRunTeam — Q10 death stake: lose the run team, refill from vault / starters.
test("loseRunTeam: death refills the active team from the vault (old team lost)", () => {
  const p = { activeMonsters: [mon(0), mon(1)], vaultMonsters: [mon(2), mon(3), mon(4)] };
  const team = loseRunTeam(p, () => [mon(99)]);
  assert.deepEqual(p.activeMonsters.map((m) => m.id), ["m2", "m3", "m4"], "vault monsters become active");
  assert.deepEqual(p.vaultMonsters.map((m) => m.id), [], "they left the vault");
  assert.equal(team, p.activeMonsters);
  // The old active team (m0/m1) is gone entirely — that's the stake.
  assert.ok(!p.activeMonsters.concat(p.vaultMonsters).some((m) => m.id === "m0"));
});

test("loseRunTeam: empty vault falls back to fresh starters", () => {
  const p = { activeMonsters: [mon(0)], vaultMonsters: [] };
  loseRunTeam(p, () => [mon(99), mon(98)]);
  assert.deepEqual(p.activeMonsters.map((m) => m.id), ["m99", "m98"], "rolled fresh starters");
});

test("loseRunTeam: caps the refill at TEAM_SIZE", () => {
  const vault = Array.from({ length: GAME.TEAM_SIZE + 2 }, (_, i) => mon(100 + i));
  const p = { activeMonsters: [mon(0)], vaultMonsters: vault };
  loseRunTeam(p, () => []);
  assert.equal(p.activeMonsters.length, GAME.TEAM_SIZE, "only TEAM_SIZE fielded");
  assert.equal(p.vaultMonsters.length, 2, "the rest stay in the vault");
});

test("releaseMonster: unknown id is a no-op refusal", () => {
  const p = { activeMonsters: [mon(0), mon(1)], vaultMonsters: [], gold: 0, essence: 0 };
  const r = releaseMonster(p, "ghost");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not-found");
  assert.equal(p.activeMonsters.length, 2, "nothing removed");
  assert.equal(p.gold, 0);
});

// ─── INV-T8 drag-drop resolution (pure) ───
test("resolveRosterDrag: drag an active monster to the vault stores it", () => {
  assert.deepEqual(resolveRosterDrag(["a", "b", "c"], "b", { kind: "vault" }), ["a", "c"]);
});

test("resolveRosterDrag: dragging a vault monster to the vault is a no-op (null)", () => {
  assert.equal(resolveRosterDrag(["a", "b"], "z", { kind: "vault" }), null);
});

test("resolveRosterDrag: vault monster onto an occupied slot swaps it in", () => {
  // z replaces slot 1 (b); b is now absent from active → applyRoster sends it to the vault.
  assert.deepEqual(resolveRosterDrag(["a", "b", "c"], "z", { kind: "active", index: 1 }), ["a", "z", "c"]);
});

test("resolveRosterDrag: vault monster onto a slot beyond the team fields it (append)", () => {
  assert.deepEqual(resolveRosterDrag(["a", "b"], "z", { kind: "active", index: 5 }), ["a", "b", "z"]);
});

test("resolveRosterDrag: dragging an active monster reorders within the team", () => {
  assert.deepEqual(resolveRosterDrag(["a", "b", "c"], "a", { kind: "active", index: 2 }), ["b", "c", "a"]);
});

test("resolveRosterDrag: dropping a monster on its own slot is a no-op (null)", () => {
  assert.equal(resolveRosterDrag(["a", "b", "c"], "b", { kind: "active", index: 1 }), null);
});

test("resolveRosterDrag: invalid inputs return null (no throw)", () => {
  assert.equal(resolveRosterDrag(null, "a", { kind: "vault" }), null);
  assert.equal(resolveRosterDrag(["a"], null, { kind: "vault" }), null);
  assert.equal(resolveRosterDrag(["a"], "a", null), null);
  assert.equal(resolveRosterDrag(["a"], "a", { kind: "active", index: -1 }), null);
});

test("resolveRosterDrag: result feeds applyRoster to perform the store", () => {
  const p = { activeMonsters: [mon(1), mon(2), mon(3)], vaultMonsters: [mon(4)] };
  const newIds = resolveRosterDrag(["m1", "m2", "m3"], "m2", { kind: "vault" });
  assert.ok(applyRoster(p, newIds));
  assert.deepEqual(p.activeMonsters.map((m) => m.id), ["m1", "m3"]);
  assert.ok(p.vaultMonsters.some((m) => m.id === "m2"), "stored monster is in the vault");
});
