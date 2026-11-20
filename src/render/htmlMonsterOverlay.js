import { createHtmlMonsterLayer } from "./htmlMonsterLayer.js";
import { hasHtmlModel } from "../systems/htmlModel.js";
import { sanitizeHtmlModel } from "../systems/htmlSanitize.js";

export function clipInset(rect, vw, vh) {
  if (!rect) return "none";
  const top = Math.max(0, rect.y);
  const left = Math.max(0, rect.x);
  const right = Math.max(0, vw - rect.right);
  const bottom = Math.max(0, vh - rect.bottom);
  return `inset(${top}px ${right}px ${bottom}px ${left}px)`;
}

export function motionState({ attacking = false, moving = false } = {}) {
  if (attacking) return "attack";
  if (moving) return "move";
  return "idle";
}

export function createHtmlMonsterOverlay(k, { zIndex = 5 } = {}) {
  const hasDom = typeof document !== "undefined";
  let mount = null, layer = null;
  const sanCache = new Map();

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

  function sanitizedModel(typeName, type) {
    const c = sanCache.get(typeName);
    if (c && c.src === type.html) return c.model;
    const model = sanitizeHtmlModel(type.html);
    sanCache.set(typeName, { src: type.html, model });
    return model;
  }

  function sync(entries, { clipDesign = null, fixed = false } = {}) {
    if (!hasDom || !layer || !k || !k.worldToScreen) return;
    try { syncInner(entries, clipDesign, fixed); }
    catch {}
  }

  function syncInner(entries, clipDesign, fixed) {
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
    } else {
      mount.style.clipPath = "none";
    }
    const mapped = [];
    for (const e of entries || []) {
      if (!e || !e.type || !hasHtmlModel(e.type)) continue;
      const model = sanitizedModel(e.typeName, e.type);
      if (!model) continue;
      const p = k.worldToScreen(e.x, e.y, { fixed });
      if (!p) continue;
      mapped.push({
        id: e.id,
        model,
        state: motionState(e),
        sx: p.x, sy: p.y,
        size: (e.designSize || 64) * p.scale,
        facing: e.facing || 1,
        opacity: e.opacity ?? 1,
        z: Math.round(100000 - e.y),
      });
    }
    layer.sync(mapped, { rect: rectPx });
  }

  function usesDom(typeName, type) {
    return hasHtmlModel(type) && !!sanitizedModel(typeName, type);
  }

  function clear() { if (layer) layer.clear(); }
  function destroy() {
    if (layer) layer.destroy();
    if (mount && mount.remove) { try { mount.remove(); } catch {} }
    mount = null; layer = null; sanCache.clear();
  }

  return { sync, clear, destroy, usesDom };
}
