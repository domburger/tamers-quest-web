// Keep import-free with no DOM access at load: the server serves it under /admin/.

export const MOTION_WRAP_CLASS = "tq-mon-anim";
const STYLE_ID = "tq-mon-motion";

export const MOTION_CSS = `
.${MOTION_WRAP_CLASS}{position:absolute;left:0;top:0;width:100%;height:100%;transform-origin:50% 88%}
.tq-moving>.${MOTION_WRAP_CLASS}{animation:tqMonWalk .52s ease-in-out infinite}
.tq-attacking>.${MOTION_WRAP_CLASS}{animation:tqMonLunge .45s ease-out}
@keyframes tqMonWalk{0%,100%{transform:translateY(0) scaleY(1)}25%{transform:translateY(-7%) scaleY(1.03)}50%{transform:translateY(0) scaleY(1)}75%{transform:translateY(-5%) scaleY(1.03)}}
@keyframes tqMonLunge{0%{transform:translateX(0) scale(1)}22%{transform:translateX(-9%) scale(.96)}50%{transform:translateX(20%) scale(1.12)}72%{transform:translateX(7%) scale(1.04)}100%{transform:translateX(0) scale(1)}}
@media (prefers-reduced-motion:reduce){.tq-moving>.${MOTION_WRAP_CLASS},.tq-attacking>.${MOTION_WRAP_CLASS}{animation:none}}
`;

export function wrapCreatureHtml(html) {
  return `<div class="${MOTION_WRAP_CLASS}">${html == null ? "" : html}</div>`;
}

export function ensureMonsterMotionStyle(doc) {
  const d = doc || (typeof document !== "undefined" ? document : null);
  if (!d || typeof d.getElementById !== "function" || typeof d.createElement !== "function") return null;
  const existing = d.getElementById(STYLE_ID);
  if (existing) return existing;
  const el = d.createElement("style");
  el.id = STYLE_ID;
  el.textContent = MOTION_CSS;
  (d.head || d.documentElement || d.body || d).appendChild(el);
  return el;
}
