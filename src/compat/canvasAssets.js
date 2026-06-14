// TQ-285 (Phase 5, engine-removal TQ-227/232): bake the spritegen procedural canvases into the canvas
// texture registry (TQ-284) — the canvas-backend equivalent of main.js's k.loadSprite("player"/
// "combat_background"/"menu_background") + per-monster k.loadSprite(spriteName, generateMonsterSprite(mt)).
// The generators (src/systems/spritegen.js) return HTMLCanvasElements that the registry stores directly.
// `gen` is injectable so the baking is unit-testable headless (the real generators need a DOM canvas).
import * as spritegen from "../systems/spritegen.js";
import { generateTileTexture, tileSpriteName } from "../render/tiles.js";

/**
 * Load the always-on static textures (player + the two full-screen backgrounds) into the registry.
 * Mirrors main.js:68-70. Each generator is guarded so one failure can't abort the rest. Returns the
 * names actually baked.
 * @param {{set:Function}} registry @param {typeof spritegen} [gen]
 * @returns {string[]}
 */
export function bakeCoreTextures(registry, gen = spritegen) {
  const names = [];
  const put = (name, make) => {
    try { const c = make(); if (c) { registry.set(name, c); names.push(name); } } catch (e) { void e; }
  };
  put("player", () => gen.generatePlayerSprite());
  put("combat_background", () => gen.generateCombatBackground());
  put("menu_background", () => gen.generateMenuBackground());
  return names;
}

/**
 * Bake a single monster type's sprite under `name` (mirrors the per-type k.loadSprite in main.js).
 * @param {{set:Function}} registry @param {string} name @param {object} mt monster type
 * @param {typeof spritegen} [gen] @returns {boolean} true if baked
 */
export function bakeMonster(registry, name, mt, gen = spritegen) {
  try { const c = gen.generateMonsterSprite(mt); if (c) { registry.set(name, c); return true; } } catch (e) { void e; }
  return false;
}

/**
 * Bake one tile type's texture into the registry under tileSpriteName(tile.id) (mirrors tiles.js
 * ensureTile → k.loadSprite). `tile` carries the colorProfile_* fields generateTileTexture reads.
 * @param {{set:Function}} registry @param {object} tile @param {{generateTileTexture:Function,tileSpriteName:Function}} [gen]
 * @returns {string|null} the sprite name baked, or null
 */
export function bakeTile(registry, tile, gen = { generateTileTexture, tileSpriteName }) {
  try {
    if (!tile || tile.id == null) return null;
    const c = gen.generateTileTexture(tile);
    if (c) { const name = gen.tileSpriteName(tile.id); registry.set(name, c); return name; }
  } catch (e) { void e; }
  return null;
}
