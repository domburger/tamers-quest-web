import test from "node:test";
import assert from "node:assert/strict";
import { bakeCoreTextures, bakeMonster, bakeTile } from "./canvasAssets.js";
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

test("TQ-285 bakeTile: bakes a tile texture under tileSpriteName(id); guards bad input", () => {
  const reg = makeTextureRegistry();
  const gen = { generateTileTexture: (t) => fakeCanvas(64, 64 + (t.id || 0)), tileSpriteName: (id) => `tile_${id}` };
  assert.equal(bakeTile(reg, { id: 7 }, gen), "tile_7");
  assert.ok(reg.has("tile_7"));
  assert.equal(reg.get("tile_7").height, 71, "generator received the tile");
  assert.equal(bakeTile(reg, { id: null }, gen), null, "no id → null");
  assert.equal(bakeTile(reg, null, gen), null, "no tile → null");
  // throwing generator → null, nothing stored
  assert.equal(bakeTile(reg, { id: 9 }, { generateTileTexture: () => { throw new Error("x"); }, tileSpriteName: (id) => `tile_${id}` }), null);
  assert.equal(reg.has("tile_9"), false);
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
