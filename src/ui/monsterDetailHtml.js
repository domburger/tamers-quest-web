// Call every frame (node TTL-hides when calls stop); always sanitize before innerHTML.

import { hasHtmlModel, pickStateHtml } from "../systems/htmlModel.js";
import { sanitizeHtmlModel } from "../systems/htmlSanitize.js";

let mount = null, node = null, lastSyncMs = 0, curKey = null, rafId = 0;
const sanCache = new Map();

const nowMs = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

function ensureMount() {
  if (mount || typeof document === "undefined") return;
  mount = document.createElement("div");
  Object.assign(mount.style, {
    position: "fixed", left: "0", top: "0", width: "100%", height: "100%",
    pointerEvents: "none", overflow: "hidden", zIndex: "30",
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

function armTtl() {
  if (rafId || typeof requestAnimationFrame === "undefined") return;
  const tick = () => {
    if (nowMs() - lastSyncMs > 100) {
      if (node) { node.style.display = "none"; node.innerHTML = ""; }
      curKey = null; rafId = 0; return;
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

export function syncDetailHtml(k, mt, cx, cy, size) {
  if (typeof document === "undefined" || !mt || !k || !k.worldToScreen || !hasHtmlModel(mt)) return false;
  const model = sanitizedModel(mt.typeName, mt.html);
  if (!model) return false;
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

export function _resetDetailHtml() {
  if (rafId && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(rafId);
  rafId = 0;
  if (mount && mount.remove) { try { mount.remove(); } catch {} }
  mount = null; node = null; curKey = null; lastSyncMs = 0; sanCache.clear();
}
