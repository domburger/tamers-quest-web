import { test } from "node:test";
import assert from "node:assert/strict";
import { calcStat, getMonsterStats } from "./stats.js";

test("calcStat matches floor(base + s1 * level^s2)", () => {
  // 100 + 1.5 * 3^1.2  ≈ 100 + 5.606 = 105.6 -> 105
  assert.equal(calcStat(100, 1.5, 1.2, 3), 105);
  // level 1: any scaling^1-ish, base + s1*1 = base + s1
  assert.equal(calcStat(50, 2, 1, 1), 52);
});

test("getMonsterStats returns all seven numeric stats", () => {
  const mt = {
    baseHealth: 120, healthScaling1: 1.1, healthScaling2: 0.9,
    baseStrength: 85, strengthScaling1: 1.3, strengthScaling2: 1.1,
    baseDefense: 60, defenseScaling1: 0.8, defenseScaling2: 0.7,
    baseSpeed: 95, speedScaling1: 1.5, speedScaling2: 1.2,
    basePower: 70, powerScaling1: 1.2, powerScaling2: 1.0,
    baseEnergy: 80, energyScaling1: 1.1, energyScaling2: 0.9,
    baseLuck: 50, luckScaling1: 0.9, luckScaling2: 0.8,
  };
  const s = getMonsterStats(mt, 5);
  for (const k of ["health", "strength", "defense", "speed", "power", "energy", "luck"]) {
    assert.equal(typeof s[k], "number", `${k} should be a number`);
    assert.ok(s[k] >= 0);
  }
  // health at level 5 = floor(120 + 1.1 * 5^0.9)
  assert.equal(s.health, Math.floor(120 + 1.1 * Math.pow(5, 0.9)));
});
