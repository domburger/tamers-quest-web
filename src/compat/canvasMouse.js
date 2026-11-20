import { pointerToDesign } from "./canvasBackend.js";

export function isTouchscreen() {
  try {
    if (typeof window !== "undefined" && "ontouchstart" in window) return true;
    if (typeof navigator !== "undefined" && (navigator.maxTouchPoints || 0) > 0) return true;
  } catch {}
  return false;
}

export function makeMouse(canvas, { rectOf } = {}) {
  const getRect = rectOf || (() => (canvas && canvas.getBoundingClientRect
    ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: 1280, height: 720 }));
  const map = (e) => pointerToDesign(e.clientX || 0, e.clientY || 0, getRect());
  const isTouch = (e) => e.pointerType === "touch";
  const touchInfo = (e) => ({ identifier: e.pointerId ?? e.identifier ?? 0 });
  let last = { x: 0, y: 0 };
  const subs = [];

  const listen = (type, handler) => {
    if (canvas && canvas.addEventListener) canvas.addEventListener(type, handler);
    const rec = [type, handler];
    subs.push(rec);
    return { cancel() { if (canvas && canvas.removeEventListener) canvas.removeEventListener(type, handler); const i = subs.indexOf(rec); if (i >= 0) subs.splice(i, 1); } };
  };
  listen("pointerdown", (e) => { last = map(e); });
  listen("pointermove", (e) => { last = map(e); });

  const mouseOn = (type, cb) => listen(type, (e) => { if (!isTouch(e)) cb(map(e)); });
  const touchOn = (type, cb) => listen(type, (e) => { if (isTouch(e)) cb(map(e), touchInfo(e)); });

  return {
    mousePos() { return { x: last.x, y: last.y }; },
    onMousePress(cb) { return mouseOn("pointerdown", cb); },
    onMouseMove(cb) { return mouseOn("pointermove", cb); },
    onMouseRelease(cb) { return mouseOn("pointerup", cb); },
    onScroll(cb) { return listen("wheel", (e) => cb({ x: e.deltaX || 0, y: e.deltaY || 0 })); },
    onTouchStart(cb) { return touchOn("pointerdown", cb); },
    onTouchMove(cb) { return touchOn("pointermove", cb); },
    onTouchEnd(cb) { return touchOn("pointerup", cb); },
    isTouchscreen,
    setCursor(style) { try { if (canvas && canvas.style) canvas.style.cursor = style || "default"; } catch {} },
    dispose() { for (const [type, h] of subs.slice()) { try { canvas && canvas.removeEventListener && canvas.removeEventListener(type, h); } catch {} } subs.length = 0; },
  };
}
