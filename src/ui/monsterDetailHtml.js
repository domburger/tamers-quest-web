// TQ-309 (TQ-297 R1): render an html-model monster's live-DOM visual in the shared monster-DETAIL card
// slot. The detail card (src/ui/monsterDetail.js) draws a canvas sprite in its sprite slot; an html-only
// monster has no sprite, so the slot shows just the glow rings. This bridges the gap: drawMonsterDetail
// calls syncDetailHtml(k, mt, cx, cy, size) each frame it would draw the sprite; when the monster carries
// a renderable html model, a single pooled, sanitized DOM node is positioned over the slot (screen-space,
// fixed) and the caller skips the canvas sprite. ONE shared change covers every caller (roster, bestiary,
// hub party popups, in-game detail).
//
// Lifecycle without per-caller cleanup: drawMonsterDetail is immediate-mode (no "closed" event). Each
// sync bumps a timestamp; a short requestAnimationFrame TTL hides the node when syncs STOP (popup closed,
// scene changed, or a non-html monster) and parks itself until the next sync. The mount is a single
// body-level overlay div, reused across scenes.
//
// SECURITY: the markup is run through the TQ-261 sanitizer (sanitizeHtmlModel) before innerHTML, exactly
// like the overworld/combat overlay (TQ-262) and the admin preview (TQ-265).

import { hasHtmlModel, pickStateHtml } from "../systems/htmlModel.js";
import { sanitizeHtmlModel } from "../systems/htmlSanitize.js";

let mount = null, node = null, lastSyncMs = 0, curKey = null, rafId = 0;
const sanCache = new Map(); // typeName -> { src: mt.html, model: sanitized|null }

const nowMs = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

function ensureMount() {
  if (mount || typeof document === "undefined") return;
  mount = document.createElement("div");
  Object.assign(mount.style, {
    position: "fixed", left: "0", top: "0", width: "100%", height: "100%",
    pointerEvents: "none", overflow: "hidden", zIndex: "30", // above the canvas; the detail scrim/panel is canvas, so this sits over the slot
  });
  mount.setAttribute("data-tq", "detail-html");
  document.body.appendChild(mount);
  node = document.createElement("div");
  node.style.position = "absolute";
  node.style.pointerEvents = "none";
  node.style.willChange = "transform";
  node.style.display = "none";
  mount.appendChild(node);
}

function sanitizedModel(typeName, html) {
  const c = sanCache.get(typeName);
  if (c && c.src === html) return c.model;
  const model = sanitizeHtmlModel(html);
  sanCache.set(typeName, { src: html, model });
  return model;
}

// The TTL loop: hide the node ~100ms after the last sync, then park (stop rescheduling) until syncDetailHtml
// restarts it. So when no detail is shown there's no running loop and no visible node.
function armTtl() {
  if (rafId || typeof requestAnimationFrame === "undefined") return;
  const tick = () => {
    if (nowMs() - lastSyncMs > 100) {
      if (node) { node.style.display = "none"; node.innerHTML = ""; }
      curKey = null; rafId = 0; return; // park
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

// Render the monster's html model over the detail slot. (cx,cy) = slot centre in DESIGN screen coords;
// `size` = drawn slot size in design px. Returns true if the DOM node rendered (caller then skips the
// canvas sprite); false for non-html monsters / no DOM / before worldToScreen is available.
export function syncDetailHtml(k, mt, cx, cy, size) {
  if (typeof document === "undefined" || !mt || !k || !k.worldToScreen || !hasHtmlModel(mt)) return false;
  const model = sanitizedModel(mt.typeName, mt.html);
  if (!model) return false; // sanitised to nothing → caller keeps the sprite path
  const p = k.worldToScreen(cx, cy, { fixed: true });
  if (!p) return false;
  ensureMount();
  if (!node) return false;
  const box = model.canvas || 256;
  if (curKey !== mt.typeName) { node.innerHTML = pickStateHtml(model, "base"); curKey = mt.typeName; }
  node.style.display = "";
  node.style.left = `${p.x}px`;
  node.style.top = `${p.y}px`;
  node.style.width = `${box}px`;
  node.style.height = `${box}px`;
  node.style.transform = `translate(-50%, -50%) scale(${(size * p.scale) / box})`;
  node.style.transformOrigin = "center center";
  lastSyncMs = nowMs();
  armTtl();
  return true;
}

// Test/teardown aid: drop the mount + caches (used by unit tests; not needed in the running game).
export function _resetDetailHtml() {
  if (rafId && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(rafId);
  rafId = 0;
  if (mount && mount.remove) { try { mount.remove(); } catch { /* detached */ } }
  mount = null; node = null; curKey = null; lastSyncMs = 0; sanCache.clear();
}
