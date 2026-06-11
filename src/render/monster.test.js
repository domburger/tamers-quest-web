import { test } from "node:test";
import assert from "node:assert";
import { drawMonster } from "./monster.js";

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
