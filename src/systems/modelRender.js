// AI-AUTHORED creature renderer. The "visual builder" agent composes a monster's appearance
// FROM SCRATCH as a list of 2D drawing primitives (no archetype template, no fixed feature set);
// this module just executes those primitives onto a 128x128 canvas, clamping/sanitizing every
// value because the shapes are untrusted model output. The result is one canvas (HTMLCanvasElement
// or any 2D context target) reused as the monster's single sprite everywhere — the same
// "skeleton" used as HUD icon, combat portrait and bestiary art.
//
// A monster carries this as `monster.model.shapes`. Monsters without an authored model fall back
// to the procedural archetype renderer in spritegen.js.

const FRAME = 128;
const SHAPE_KINDS = ["ellipse", "circle", "polygon", "limb"];
const MAX_SHAPES = 60;

// Structured-output contract for the visual BUILDER agent: the creature as a list of authored
// primitives. Geometry fields are all optional (only the ones relevant to each `kind` are used;
// coerceAuthoredModel picks them) — the same permissive style the rest of the gen schemas use.
export const AUTHORED_MODEL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    shapes: {
      type: "array",
      minItems: 8,
      maxItems: 48,
      description: "The whole creature, composed back-to-front (far/background parts first, eyes/teeth last).",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: SHAPE_KINDS },
          cx: { type: "number" }, cy: { type: "number" }, rx: { type: "number" }, ry: { type: "number" }, rot: { type: "number" }, r: { type: "number" },
          x1: { type: "number" }, y1: { type: "number" }, x2: { type: "number" }, y2: { type: "number" }, w: { type: "number" },
          points: { type: "array", items: { type: "array", items: { type: "number" } } },
          fill: { type: "string" }, stroke: { type: "string" }, sw: { type: "number" },
        },
        required: ["kind"],
      },
    },
  },
  required: ["shapes"],
};

// The technical render-target spec injected into the builder agent's prompt (so it always knows
// the exact coordinate frame + primitives the renderer draws, even if the editable system prompt
// is overridden). Built here, beside the renderer, so prompt and renderer can never drift.
export function authoredModelBrief() {
  return `RENDER TARGET — you draw the creature FROM SCRATCH as 2D shapes on a ${FRAME}x${FRAME} canvas. There is NO template; you place every shape yourself.
Coordinates: origin top-left, x increases RIGHT (0..${FRAME}), y increases DOWN (0..${FRAME}). Ground line y≈116; the creature stands/sits on it and fills most of the frame (about x 22..106, y 18..116), facing RIGHT.
Primitives (each one JSON object in "shapes"):
- {"kind":"ellipse","cx","cy","rx","ry","rot":deg,"fill":"#hex","stroke":"#hex","sw":2} — rounded MASSES: body, head, haunch, shoulder, muzzle.
- {"kind":"circle","cx","cy","r","fill":"#hex"} — eyes, nostrils, joints, spots.
- {"kind":"polygon","points":[[x,y],[x,y],[x,y]...],"fill":"#hex","stroke":"#hex","sw":2} — ANGULAR/POINTED parts: horns, spikes, jaws, fangs, claws, fins, wings, crest, tail blade (3-12 points).
- {"kind":"limb","x1","y1","x2","y2","w":width,"fill":"#hex"} — a thick rounded bar: leg, arm, neck, tail.
Rules: build BACK-TO-FRONT (later shapes cover earlier ones) — far limbs + background masses first, then torso, then near limbs, head, and eyes/teeth ON TOP. FILLED shapes with a slightly darker outline. Colours are #hex; a cohesive GRIM palette (dark desaturated body, a BRIGHT accent only for eyes/glowing parts), never pastel or cute. Make a BOLD, readable predator silhouette. Use 16-32 shapes.`;
}

const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

// Parse a #rgb / #rrggbb colour → a normalized "#rrggbb" string, else null. Authored fills are
// hex (the builder is told to use hex); anything else is dropped to a safe default by the caller.
function hex(c) {
  if (typeof c !== "string") return null;
  const t = c.trim().toLowerCase();
  let m = /^#?([0-9a-f]{3})$/.exec(t);
  if (m) return "#" + m[1].split("").map((h) => h + h).join("");
  m = /^#?([0-9a-f]{6})$/.exec(t);
  if (m) return "#" + m[1];
  return null;
}

// Draw one authored primitive. Coordinates live in the 128-frame but may slightly overflow
// (creatures can bleed to the edge); clamp to a guard band so a wild value can't blow up the path.
function drawShape(ctx, sh) {
  if (!sh || typeof sh !== "object" || !SHAPE_KINDS.includes(sh.kind)) return;
  const fill = hex(sh.fill);
  const stroke = hex(sh.stroke);
  const sw = num(sh.sw, 0, 8, 0);

  if (sh.kind === "limb") {
    // A thick rounded line — legs / tails / necks. Filled colour drives it (stroke = the line).
    const x1 = num(sh.x1, -32, 160, 64), y1 = num(sh.y1, -32, 160, 64);
    const x2 = num(sh.x2, -32, 160, 64), y2 = num(sh.y2, -32, 160, 64);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.lineCap = "round"; ctx.lineWidth = num(sh.w, 1, 28, 6);
    ctx.strokeStyle = fill || stroke || "#3a3a44"; ctx.stroke();
    return;
  }

  ctx.beginPath();
  if (sh.kind === "ellipse") {
    ctx.ellipse(num(sh.cx, -32, 160, 64), num(sh.cy, -32, 160, 64), num(sh.rx, 0.5, 90, 10), num(sh.ry, 0.5, 90, 10), num(sh.rot, -360, 360, 0) * Math.PI / 180, 0, Math.PI * 2);
  } else if (sh.kind === "circle") {
    ctx.arc(num(sh.cx, -32, 160, 64), num(sh.cy, -32, 160, 64), num(sh.r, 0.5, 90, 6), 0, Math.PI * 2);
  } else { // polygon
    const pts = Array.isArray(sh.points) ? sh.points : [];
    if (pts.length < 3) return;
    pts.slice(0, 24).forEach((p, i) => {
      const x = num(p?.[0], -32, 160, 64), y = num(p?.[1], -32, 160, 64);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath();
  }
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  else if (!stroke) { ctx.fillStyle = "#3a3a44"; ctx.fill(); } // neither fill NOR stroke would be INVISIBLE — degrade to a neutral mass (mirrors the limb default), never a blank shape
  if (stroke && sw > 0) { ctx.strokeStyle = stroke; ctx.lineWidth = sw; ctx.lineJoin = "round"; ctx.stroke(); }
}

// True when a monster carries an authored shape model — ≥3 DRAWABLE shapes, using the SAME validity
// the renderer applies (a polygon needs ≥3 points or drawShape/coerce paint nothing). So a model
// that would render blank isn't mistaken for an authored creature; it correctly falls back to the
// archetype renderer. (In prod coerce strips bad shapes pre-persist, so this only matters for a raw
// or hand-built model reaching the detector — defensive consistency.)
export function hasAuthoredModel(mt) {
  const s = mt && mt.model && mt.model.shapes;
  if (!Array.isArray(s)) return false;
  const drawable = (x) => x && SHAPE_KINDS.includes(x.kind) && (x.kind !== "polygon" || (Array.isArray(x.points) && x.points.length >= 3));
  return s.filter(drawable).length >= 3;
}

// Render the authored model onto `ctx` (a 128x128 2D context). Draws a grounding shadow, then the
// builder's shapes in array order (painter's algorithm: back-to-front is the builder's job).
export function drawAuthoredModel(ctx, model) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath(); ctx.ellipse(FRAME / 2, FRAME * 0.93, 30, 7, 0, 0, Math.PI * 2); ctx.fill();
  const shapes = Array.isArray(model && model.shapes) ? model.shapes.slice(0, MAX_SHAPES) : [];
  for (const sh of shapes) drawShape(ctx, sh);
  ctx.restore();
}

// Coerce/clamp an arbitrary authored model into a render-ready one (drop invalid shapes, cap count,
// normalize colours). Pure; mirrors the defensive normalize the rest of the gen pipeline uses.
export function coerceAuthoredModel(raw) {
  const shapes = Array.isArray(raw && raw.shapes) ? raw.shapes : [];
  const out = [];
  for (const s of shapes) {
    if (!s || typeof s !== "object" || !SHAPE_KINDS.includes(s.kind)) continue;
    const sh = { kind: s.kind };
    if (s.kind === "limb") {
      sh.x1 = num(s.x1, -32, 160, 64); sh.y1 = num(s.y1, -32, 160, 64);
      sh.x2 = num(s.x2, -32, 160, 64); sh.y2 = num(s.y2, -32, 160, 64); sh.w = num(s.w, 1, 28, 6);
    } else if (s.kind === "ellipse") {
      sh.cx = num(s.cx, -32, 160, 64); sh.cy = num(s.cy, -32, 160, 64);
      sh.rx = num(s.rx, 0.5, 90, 10); sh.ry = num(s.ry, 0.5, 90, 10); sh.rot = num(s.rot, -360, 360, 0);
    } else if (s.kind === "circle") {
      sh.cx = num(s.cx, -32, 160, 64); sh.cy = num(s.cy, -32, 160, 64); sh.r = num(s.r, 0.5, 90, 6);
    } else { // polygon
      const pts = (Array.isArray(s.points) ? s.points : []).slice(0, 24)
        .map((p) => [num(p?.[0], -32, 160, 64), num(p?.[1], -32, 160, 64)]);
      if (pts.length < 3) continue;
      sh.points = pts;
    }
    const fill = hex(s.fill); if (fill) sh.fill = fill;
    const stroke = hex(s.stroke); if (stroke) { sh.stroke = stroke; sh.sw = num(s.sw, 0, 8, 1.5); }
    // A shape with neither a valid fill nor stroke renders INVISIBLE (drawShape paints nothing),
    // so a builder that omits/garbles colours would persist a monster that's just a drop-shadow.
    // Default to a neutral dark mass so every kept shape is always visible (drawShape mirrors this).
    if (!sh.fill && !sh.stroke) sh.fill = "#3a3a44";
    out.push(sh);
    if (out.length >= MAX_SHAPES) break;
  }
  return { shapes: out };
}
