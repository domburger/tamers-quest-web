import { test } from "node:test";
import assert from "node:assert";
import { drawMonster, drawMonsterIcon, iconTint } from "./monster.js";

// drawMonster is node-testable: it only touches the engine via k.* (vec2/drawSprite),
// and monsterAnimTransform is pure. We mock k to capture the sprite key it draws — the
// key is the slug derived (and now memoized) from typeName.

function mockK() {
  const calls = { sprite: [] };
  const k = {
    vec2: (x, y) => ({ x, y }),
    rgb: (r, g, b) => ({ r, g, b }),
    drawSprite: (o) => calls.sprite.push(o),
    drawCircle: () => {},
  };
  return { k, calls };
}

test("drawMonster derives the sprite key as a slug of typeName (lowercase, whitespace→_)", () => {
  const { k, calls } = mockK();
  const ok = drawMonster(k, { typeName: "Frost Wyrm", x: 0, y: 0, size: 64 });
  assert.equal(ok, true, "sprite drew (mock never throws)");
  assert.equal(calls.sprite.length, 1);
  assert.equal(calls.sprite[0].sprite, "frost_wyrm");
});

test("memoized slug is stable across calls and collapses whitespace runs", () => {
  const { k, calls } = mockK();
  drawMonster(k, { typeName: "Ember  Drake", x: 0, y: 0, size: 64 }); // two spaces
  drawMonster(k, { typeName: "Ember  Drake", x: 0, y: 0, size: 64 });
  assert.equal(calls.sprite[0].sprite, "ember_drake");
  assert.equal(calls.sprite[1].sprite, calls.sprite[0].sprite, "same slug each call");
});

test("an explicit sprite key bypasses the typeName slug", () => {
  const { k, calls } = mockK();
  drawMonster(k, { sprite: "custom_key", typeName: "Whatever", x: 0, y: 0, size: 64 });
  assert.equal(calls.sprite[0].sprite, "custom_key");
});

// TQ-373: the ICON path must never leave a blank card for an html-model (sprite-less) monster.
function mockIconK(withTexture) {
  const calls = { sprite: 0, circle: 0 };
  const fakeImg = { width: 128, height: 128, getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(128 * 128 * 4) }) }) };
  return {
    _calls: calls,
    textures: { get: () => (withTexture ? fakeImg : null) },
    drawSprite: () => { calls.sprite++; },
    drawCircle: () => { calls.circle++; },
    vec2: (x, y) => ({ x, y }),
    rgb: (r, g, b) => ({ r, g, b }),
  };
}

test("TQ-373: a baked-sprite monster draws the real sprite (no emblem fallback)", () => {
  const k = mockIconK(true);
  const ok = drawMonsterIcon(k, { sprite: "ember_fox", cx: 50, cy: 50, scale: 1, topY: 0 });
  assert.equal(ok, true);
  assert.equal(k._calls.sprite, 1);
  assert.equal(k._calls.circle, 0);
});

test("TQ-373: an html-model (sprite-less) monster draws the emblem instead of nothing", () => {
  const k = mockIconK(false);
  const ok = drawMonsterIcon(k, { sprite: "ai_wyrm", cx: 50, cy: 50, scale: 1, topY: 0 });
  assert.equal(ok, false, "signals it wasn't the real sprite");
  assert.equal(k._calls.sprite, 0, "never tries the missing sprite");
  assert.equal(k._calls.circle, 3, "emblem = body + two eyes (never blank)");
});

test("TQ-373: iconTint is deterministic and returns a valid RGB triple", () => {
  const a = iconTint("Cinder Maw");
  assert.deepEqual(a, iconTint("Cinder Maw"), "same name → same colour");
  assert.equal(a.length, 3);
  for (const ch of a) assert.ok(ch >= 0 && ch <= 255);
});
