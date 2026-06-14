// TQ-262: the scene-facing glue for the live-DOM monster render path. Owns a body-mounted, play-window
// -clipped overlay <div> and a pooled htmlMonsterLayer, and each frame maps a scene's visible monsters
// (world-space design coords) to page CSS px via k.worldToScreen, sanitizes their stored html model
// (TQ-261, cached per monster type), and drives layer.sync(). A scene wires this in three lines: create
// on enter, sync() each frame with the monsters it's drawing, destroy() on leave.
//
// SAFE BY CONSTRUCTION: only monsters whose TYPE carries a renderable html model (hasHtmlModel) ever
// take the DOM path — every other monster is ignored here and keeps its rasterized sprite (drawMonster).
// No monster ships an html model today, so this is dormant: sync() maps nothing and touches no DOM.

import { createHtmlMonsterLayer } from "./htmlMonsterLayer.js";
import { hasHtmlModel } from "../systems/htmlModel.js";
import { sanitizeHtmlModel } from "../systems/htmlSanitize.js";

// CSS clip-path inset() that clips the full-viewport overlay to a page-px rect (the play window), so DOM
// monsters never bleed into the opaque HUD gutters. rect in page CSS px; vw/vh the viewport CSS size.
// Pure. A null rect → "none" (no clip, e.g. the combat stage which fills the screen).
export function clipInset(rect, vw, vh) {
  if (!rect) return "none";
  const top = Math.max(0, rect.y);
  const left = Math.max(0, rect.x);
  const right = Math.max(0, vw - rect.right);
  const bottom = Math.max(0, vh - rect.bottom);
  return `inset(${top}px ${right}px ${bottom}px ${left}px)`;
}

// Pick the animation state for a monster from its motion flags. attack (one-shot) wins over move; a
// stationary monster idles. Each maps to an authored html state (idle/move/attack fall back to base).
export function motionState({ attacking = false, moving = false } = {}) {
  if (attacking) return "attack";
  if (moving) return "move";
  return "idle";
}

// Create the overlay for the active scene. `zIndex` places it above the canvas; the per-frame clip keeps
// it visually behind the (canvas-drawn) HUD gutters. No-ops without a DOM (tests/SSR).
export function createHtmlMonsterOverlay(k, { zIndex = 5 } = {}) {
  const hasDom = typeof document !== "undefined";
  let mount = null, layer = null;
  const sanCache = new Map(); // typeName -> { src: type.html, model: sanitized|null }

  if (hasDom) {
    mount = document.createElement("div");
    Object.assign(mount.style, {
      position: "fixed", left: "0", top: "0", width: "100%", height: "100%",
      pointerEvents: "none", overflow: "hidden", zIndex: String(zIndex),
    });
    mount.setAttribute("data-tq", "html-monsters");
    document.body.appendChild(mount);
    layer = createHtmlMonsterLayer(mount);
  }

  // The sanitized model for a monster type, cached until the type's html object changes. Returns null
  // when the type has no usable model after sanitising (→ caller keeps the sprite path).
  function sanitizedModel(typeName, type) {
    const c = sanCache.get(typeName);
    if (c && c.src === type.html) return c.model;
    const model = sanitizeHtmlModel(type.html);
    sanCache.set(typeName, { src: type.html, model });
    return model;
  }

  // entries: [{ id, typeName, type, x, y, designSize, facing, moving, attacking, opacity }]
  //   type: the monster TYPE (getMonsterType) carrying .html · x,y: world-space design centre
  // clipDesign: the play-window rect ({x,y,right,bottom} design px, screen-anchored) to clip + cull to.
  function sync(entries, { clipDesign = null } = {}) {
    if (!hasDom || !layer || !k || !k.worldToScreen) return;
    let rectPx = null;
    if (clipDesign) {
      const tl = k.worldToScreen(clipDesign.x, clipDesign.y, { fixed: true });
      const br = k.worldToScreen(clipDesign.right, clipDesign.bottom, { fixed: true });
      if (tl && br) {
        rectPx = { x: tl.x, y: tl.y, right: br.x, bottom: br.y };
        const vw = typeof window !== "undefined" ? window.innerWidth : br.x;
        const vh = typeof window !== "undefined" ? window.innerHeight : br.y;
        mount.style.clipPath = clipInset(rectPx, vw, vh);
      }
    }
    const mapped = [];
    for (const e of entries || []) {
      if (!e || !e.type || !hasHtmlModel(e.type)) continue;
      const model = sanitizedModel(e.typeName, e.type);
      if (!model) continue; // sanitised to nothing → sprite path
      const p = k.worldToScreen(e.x, e.y, { fixed: false });
      if (!p) continue;
      mapped.push({
        id: e.id,
        model,
        state: motionState(e),
        sx: p.x, sy: p.y,
        size: (e.designSize || 64) * p.scale,
        facing: e.facing || 1,
        opacity: e.opacity ?? 1,
        z: Math.round(100000 - e.y), // lower y (nearer) draws on top — mirrors the canvas y-sort
      });
    }
    layer.sync(mapped, { rect: rectPx });
  }

  // True if any monster type seen so far actually produced a renderable sanitized model — lets a scene
  // cheaply decide whether to skip the sprite draw for a given monster (see usesDom).
  function usesDom(typeName, type) {
    return hasHtmlModel(type) && !!sanitizedModel(typeName, type);
  }

  function clear() { if (layer) layer.clear(); }
  function destroy() {
    if (layer) layer.destroy();
    if (mount && mount.remove) { try { mount.remove(); } catch { /* detached */ } }
    mount = null; layer = null; sanCache.clear();
  }

  return { sync, clear, destroy, usesDom };
}
