import { test } from "node:test";
import assert from "node:assert/strict";
import { MONSTER_ANIMS, ATTACK_DURATION, monsterAnimTransform, isMonsterAnim } from "./monsterAnim.js";

test("the standard set is exactly idle, walk, attack (only those 3 for now)", () => {
  assert.deepEqual(MONSTER_ANIMS, ["idle", "walk", "attack"]);
  assert.ok(isMonsterAnim("idle") && isMonsterAnim("walk") && isMonsterAnim("attack"));
  assert.ok(!isMonsterAnim("run") && !isMonsterAnim(""));
});

test("every clip returns a well-formed transform { dx, dy, sx, sy, rot } with finite values", () => {
  for (const anim of [...MONSTER_ANIMS, "unknown"]) {
    for (const t of [0, 0.37, 1.2, 5.9]) {
      const tr = monsterAnimTransform(anim, t, { phase: 0.4, facing: 1 });
      for (const k of ["dx", "dy", "sx", "sy", "rot"]) {
        assert.ok(Number.isFinite(tr[k]), `${anim}@${t}: ${k} finite`);
      }
      assert.ok(tr.sx > 0 && tr.sy > 0, `${anim}: scales stay positive`);
    }
  }
});

test("unknown anim falls back to idle (same transform)", () => {
  const a = monsterAnimTransform("nope", 1.3);
  const b = monsterAnimTransform("idle", 1.3);
  assert.deepEqual(a, b);
});

test("idle is a subtle, time-varying loop (breathes, no drift)", () => {
  const a = monsterAnimTransform("idle", 0.0);
  const b = monsterAnimTransform("idle", 0.65);
  assert.notDeepEqual(a, b, "the clip animates over time");
  // subtle: within a few % of the resting pose, never a translate beyond the body
  for (const t of [0, 0.3, 0.8, 1.5]) {
    const tr = monsterAnimTransform("idle", t);
    assert.ok(Math.abs(tr.dx) < 0.02 && Math.abs(tr.dy) < 0.05, "idle barely moves");
    assert.ok(Math.abs(tr.sx - 1) < 0.05 && Math.abs(tr.sy - 1) < 0.05, "idle barely scales");
    assert.equal(tr.rot, 0, "idle does not rotate");
  }
});

test("walk bobs UP off the ground during its cycle (a stepping gait, not a static pose)", () => {
  let minDy = Infinity, maxDy = -Infinity;
  for (let i = 0; i < 40; i++) { const dy = monsterAnimTransform("walk", i * 0.05).dy; minDy = Math.min(minDy, dy); maxDy = Math.max(maxDy, dy); }
  assert.ok(minDy < -0.01, "the body lifts (negative dy = up) at the stride apex");
  assert.ok(maxDy <= 0.0001, "and returns to/under the ground line on contact");
  // facing flips the body rock direction
  const r = monsterAnimTransform("walk", 0.21, { facing: 1 }).rot;
  const l = monsterAnimTransform("walk", 0.21, { facing: -1 }).rot;
  assert.ok((r === 0 && l === 0) || Math.sign(r) === -Math.sign(l), "rock mirrors with facing");
});

test("attack is a one-shot lunge toward `facing`: rest at the ends, forward surge mid-clip", () => {
  const rest0 = monsterAnimTransform("attack", 0, { phase: 0, facing: 1 });
  assert.ok(Math.abs(rest0.dx) < 1e-9, "phase 0 starts at rest (no lunge yet)");
  // mid-strike (phase ~0.4) surges FORWARD — dx sign follows facing
  const fwdR = monsterAnimTransform("attack", 0, { phase: 0.4, facing: 1 }).dx;
  const fwdL = monsterAnimTransform("attack", 0, { phase: 0.4, facing: -1 }).dx;
  assert.ok(fwdR > 0.1, "faces right → lunges right (+dx)");
  assert.ok(fwdL < -0.1, "faces left → lunges left (-dx)");
  assert.equal(fwdR, -fwdL, "facing only mirrors the lunge");
  // settles back by the end of the clip
  const end = monsterAnimTransform("attack", 0, { phase: 1, facing: 1 });
  assert.ok(Math.abs(end.dx) < 1e-9, "phase 1 has recovered to rest");
  assert.ok(ATTACK_DURATION > 0, "the clip has a positive duration");
});
