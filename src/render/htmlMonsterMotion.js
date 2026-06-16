// TQ-386: ENGINE-DRIVEN default move/attack motion for live-DOM (HTML/CSS) monsters — the follow-up
// that TQ-303/TQ-310 explicitly deferred. The builder authors ONLY the looping IDLE creature (the
// `base` state's @keyframes); when a monster moves/attacks the engine toggles .tq-moving / .tq-attacking
// on its node (htmlMonsterLayer / the admin preview). TQ-310 wired those classes + the sanitizer keeps a
// builder's OPTIONAL .tq-*-scoped reactions, but no DEFAULT motion was ever supplied — so for ~every
// monster (which authors no reaction) move/attack produced NO visible change. This module is that
// default: a walk bob + an attack lunge applied to an ENGINE-OWNED wrapper around the authored creature,
// so EVERY html monster visibly walks/lunges regardless of builder authorship. A builder's own scoped
// .tq-* rules still compose on top (they target inner parts; this targets the wrapper).
//
// Import-free leaf (no DOM access at module load) so the Node server can serve it under /admin/ for the
// gen-hub preview, exactly like render/tiles.js + render/itemIcon.js.

// The engine-owned wrapper element the authored creature is nested inside; the default motion animates
// THIS (never the pooled node, which carries position/scale, nor the creature, which carries its idle).
export const MOTION_WRAP_CLASS = "tq-mon-anim";
const STYLE_ID = "tq-mon-motion";

// Default action keyframes. Forward = +X: the node's left/right FACING mirror lives on the parent
// (htmlMonsterLayer nodeStyle / the preview), so +X is always "toward facing". transform-origin near the
// feet so the walk bob reads as grounded. Kept SUBTLE on purpose so it composes with — never fights —
// the creature's own idle @keyframes underneath. WALK loops; ATTACK is a one-shot lunge (windup → strike
// → recover) that settles back to rest. Reduced-motion users get no action motion (idle is unaffected).
export const MOTION_CSS = `
.${MOTION_WRAP_CLASS}{position:absolute;left:0;top:0;width:100%;height:100%;transform-origin:50% 88%}
.tq-moving>.${MOTION_WRAP_CLASS}{animation:tqMonWalk .52s ease-in-out infinite}
.tq-attacking>.${MOTION_WRAP_CLASS}{animation:tqMonLunge .45s ease-out}
@keyframes tqMonWalk{0%,100%{transform:translateY(0) scaleY(1)}25%{transform:translateY(-7%) scaleY(1.03)}50%{transform:translateY(0) scaleY(1)}75%{transform:translateY(-5%) scaleY(1.03)}}
@keyframes tqMonLunge{0%{transform:translateX(0) scale(1)}22%{transform:translateX(-9%) scale(.96)}50%{transform:translateX(20%) scale(1.12)}72%{transform:translateX(7%) scale(1.04)}100%{transform:translateX(0) scale(1)}}
@media (prefers-reduced-motion:reduce){.tq-moving>.${MOTION_WRAP_CLASS},.tq-attacking>.${MOTION_WRAP_CLASS}{animation:none}}
`;

// Wrap an authored (already-sanitized) creature fragment in the engine motion wrapper. PURE — the only
// place markup is composed; callers assign the result to innerHTML. `html` is trusted-sanitized already.
export function wrapCreatureHtml(html) {
  return `<div class="${MOTION_WRAP_CLASS}">${html == null ? "" : html}</div>`;
}

// Inject MOTION_CSS into `doc` ONCE (idempotent — keyed on STYLE_ID). No-op without a usable document
// (tests/SSR). The stylesheet is engine-authored (no untrusted input). Returns the <style> el or null.
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
