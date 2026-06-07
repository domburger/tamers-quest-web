import { test } from "node:test";
import assert from "node:assert/strict";
import { GAME } from "./schemas.js";
import { addCaughtMonster } from "./inventory.js";

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
