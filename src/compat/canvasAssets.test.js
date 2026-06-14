import test from "node:test";
import assert from "node:assert/strict";
import { bakeCoreTextures, bakeMonster } from "./canvasAssets.js";
import { makeTextureRegistry } from "./canvasTextures.js";

// Mock spritegen — returns canvas-like drawables (has width/height) without needing a DOM.
const fakeCanvas = (w, h) => ({ width: w, height: h });
const mockGen = {
  generatePlayerSprite: () => fakeCanvas(48, 48),
  generateCombatBackground: () => fakeCanvas(1280, 720),
  generateMenuBackground: () => fakeCanvas(1280, 720),
  generateMonsterSprite: (mt) => fakeCanvas(64, 64 + (mt?.size || 0)),
};

test("TQ-285 bakeCoreTextures: loads player + both backgrounds into the registry", () => {
  const reg = makeTextureRegistry();
  const baked = bakeCoreTextures(reg, mockGen);
  assert.deepEqual(baked.sort(), ["combat_background", "menu_background", "player"]);
  assert.ok(reg.has("player") && reg.has("combat_background") && reg.has("menu_background"));
  assert.equal(reg.get("player").width, 48);
  assert.equal(reg.count(), 3);
});

test("TQ-285 bakeCoreTextures: a throwing generator is skipped, the rest still bake", () => {
  const reg = makeTextureRegistry();
  const partial = { ...mockGen, generatePlayerSprite: () => { throw new Error("no DOM"); } };
  const baked = bakeCoreTextures(reg, partial);
  assert.deepEqual(baked.sort(), ["combat_background", "menu_background"], "player skipped, others baked");
  assert.equal(reg.has("player"), false);
});

test("TQ-285 bakeMonster: bakes one monster type's sprite under the given name", () => {
  const reg = makeTextureRegistry();
  assert.equal(bakeMonster(reg, "monster_slime", { size: 6 }, mockGen), true);
  assert.ok(reg.has("monster_slime"));
  assert.equal(reg.get("monster_slime").height, 70, "generator received the monster type");
  // a throwing generator → false, nothing stored
  assert.equal(bakeMonster(reg, "bad", {}, { generateMonsterSprite: () => { throw new Error("x"); } }), false);
  assert.equal(reg.has("bad"), false);
});
