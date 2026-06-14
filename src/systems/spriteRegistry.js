// Runtime registration of AI monster sprites from their SVG model (TQ-246, cutover B).
//
// The boot seed pool is registered SYNCHRONOUSLY in main.js via generateMonsterSprite() (archetype
// art). AI-generated monsters instead carry an authored SVG model (mt.svg, attached by the gen
// pipeline in TQ-245) which must be rasterized ASYNC — rasterizeSvg() loads the markup through an
// <img>, so it can't run on the synchronous generateMonsterSprite path.
//
// So we lazily register: the first time drawMonster() is asked to draw a monster whose sprite key
// isn't registered yet, it calls ensureMonsterSvgSprite(). If that monster has an SVG model we
// rasterize its base state once and loadSprite() the finished canvas a SINGLE time. Until the raster
// resolves, drawMonster's existing tinted-blob fallback is the placeholder. Registering only ONCE,
// after the raster is ready, sidesteps Phaser's WebGL "canvas texture uploaded once" problem (a
// placeholder texture mutated in place would need an explicit texture.refresh() we can't reach from
// here) — and the immediate-mode render loop repaints every frame, so the real sprite simply appears
// on the next frame after it registers. idle/attack/move states are a follow-up; base first.

import { rasterizeSvg, hasSvgModel, SVG_CANVAS } from "./svgModel.js";

// key -> "pending" | "done" | "failed" | "nomodel". A present entry means "don't start again":
// pending/done/failed are terminal for the rasterize attempt; nomodel marks a known type that has
// no SVG model so we stop re-checking it every frame. Unknown types (mt undefined) are left absent
// so a later draw — once the type has synced into gamedata — can still kick the rasterize off.
const _state = new Map();

/**
 * Kick off a one-time async rasterize+register of a monster's SVG model, if needed. Safe to call
 * every frame: it no-ops once a state is recorded for the key. Never throws.
 * @param {object} k        the kaboom/Phaser-shim context (provides loadSprite)
 * @param {string} key      the sprite key (typeName slug) drawMonster draws under
 * @param {object} mt       the monster type (carrying mt.svg) — or undefined if not loaded yet
 */
export function ensureMonsterSvgSprite(k, key, mt) {
  if (!k || typeof k.loadSprite !== "function" || !key || _state.has(key)) return;
  if (!hasSvgModel(mt)) { if (mt) _state.set(key, "nomodel"); return; } // known type w/o SVG → stop checking
  _state.set(key, "pending");
  Promise.resolve()
    .then(() => rasterizeSvg(mt.svg.base, SVG_CANVAS))
    .then((canvas) => {
      if (!canvas) { _state.set(key, "failed"); return; }
      try { k.loadSprite(key, canvas); _state.set(key, "done"); }
      catch { _state.set(key, "failed"); } // never leave a broken sprite registered
    })
    .catch(() => _state.set(key, "failed"));
}

/** Drop a key's cached state so a regenerated/replaced monster re-rasterizes on its next draw. */
export function resetMonsterSvgSprite(key) { _state.delete(key); }

/** Test/diagnostic hook: the recorded rasterize state for a sprite key (undefined if untouched). */
export function _spriteSvgState(key) { return _state.get(key); }
