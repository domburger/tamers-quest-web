import { test } from "node:test";
import assert from "node:assert/strict";
import { drawCharacter } from "./character.js";
import { getSkin } from "./chainCosmetics.js";

// drawCharacter is THE most-rendered thing in the game (the player + every rival,
// every frame, SP & MP) yet was untested. A Proxy stub records every k.draw* call's
// options so we can assert it renders without throwing and never emits NaN/Infinity
// coordinates (which would silently break character rendering) across all its
// branches: idle/walking, the four facings (flip + facing-camera), rival accent,
// and cosmetics. (It also exercises drawChainSkin + getEquippedSkin via the import.)
function mockK() {
  const calls = [];
  return new Proxy({ calls }, {
    get(_t, prop) {
      if (prop === "calls") return calls;
      if (prop === "vec2") return (x, y) => ({ x, y });
      if (prop === "rgb") return (...c) => c;
      if (prop === "time") return () => 0;
      return (o) => { calls.push(o); }; // any draw* / other → record the options
    },
  });
}

// Recursively assert no number in a draw's options is NaN/Infinity (incl. nested pos/p1/p2).
function allFinite(o, seen = new Set()) {
  if (o == null || typeof o !== "object" || seen.has(o)) return true;
  seen.add(o);
  for (const v of Object.values(o)) {
    if (typeof v === "number" && !Number.isFinite(v)) return false;
    if (typeof v === "object" && !allFinite(v, seen)) return false;
  }
  return true;
}

test("drawCharacter: renders (no throw, no NaN coords) across pose / facing / cosmetic variants", () => {
  const variants = [
    { label: "idle defaults" },
    { label: "walking", moving: true, t: 1.3 },
    { label: "facing right", dir: { x: 1, y: 0 } },
    { label: "facing left (flip)", dir: { x: -1, y: 0 }, moving: true, t: 2.0 },
    { label: "facing camera (down)", dir: { x: 0, y: 1 } },
    { label: "facing away (up)", dir: { x: 0, y: -1 }, moving: true },
    { label: "rival accent", color: [255, 60, 60] },
    { label: "cosmetics (cloak + rival skin object)", cloak: [50, 40, 60], skin: getSkin("void") },
    { label: "zero dir vector", dir: { x: 0, y: 0 } },
  ];
  for (const { label, ...opts } of variants) {
    const k = mockK();
    assert.doesNotThrow(() => drawCharacter(k, { x: 100, y: 200, ...opts }), `throws for "${label}"`);
    assert.ok(k.calls.length > 0, `"${label}" draws something`);
    assert.ok(k.calls.every((o) => allFinite(o)), `"${label}" emitted a NaN/Infinity coordinate`);
  }
});

test("drawCharacter: facing the camera adds the glowing-eyes detail (more draws than back-facing)", () => {
  const back = mockK(); drawCharacter(back, { x: 0, y: 0, dir: { x: 0, y: -1 } });
  const front = mockK(); drawCharacter(front, { x: 0, y: 0, dir: { x: 0, y: 1 } });
  assert.ok(front.calls.length > back.calls.length, "the shadowed face + eyes only draw when facing the camera");
});
