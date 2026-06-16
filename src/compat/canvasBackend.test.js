import test from "node:test";
import assert from "node:assert/strict";
import { fitScale, designWidthFor, viewport, pointerToDesign, cDrawRect, cDrawCircle, cDrawEllipse, cDrawText, cDrawLine, cDrawPoly, wrapText } from "./canvasBackend.js";

// A tiny fake 2D context that records canvas ops — lets us exercise the pure draw code in Node.
// measureText returns a deterministic 6px/char stub so word-wrap (cDrawText width) is testable.
function fakeCtx(ops = []) {
  return new Proxy({}, {
    get: (_t, p) => {
      if (p === "measureText") return (s) => ({ width: String(s).length * 6 });
      return (typeof p === "string" && /^(fill|stroke|begin|move|line|arc|ellipse|close|rect|fillText|setTransform|clear|save|restore)/.test(p))
        ? (...a) => ops.push([p, ...a]) : undefined;
    },
    set: () => true,
  });
}

test("fitScale: exact-ratio window fills with no letterbox", () => {
  const f = fitScale(1280, 720);
  assert.equal(f.scale, 1);
  assert.equal(f.offX, 0);
  assert.equal(f.offY, 0);
});

test("fitScale: a 2x window scales 2x, still centred", () => {
  const f = fitScale(2560, 1440);
  assert.equal(f.scale, 2);
  assert.equal(f.offX, 0);
  assert.equal(f.offY, 0);
});

test("fitScale: a too-WIDE window letterboxes on the X axis (pillarbox)", () => {
  const f = fitScale(2000, 720); // height-bound → scale 1
  assert.equal(f.scale, 1);
  assert.equal(f.w, 1280);
  assert.equal(f.offX, (2000 - 1280) / 2);
  assert.equal(f.offY, 0);
});

test("fitScale: a too-TALL window letterboxes on the Y axis", () => {
  const f = fitScale(1280, 1000); // width-bound → scale 1
  assert.equal(f.scale, 1);
  assert.equal(f.offY, (1000 - 720) / 2);
  assert.equal(f.offX, 0);
});

test("TQ-294 designWidthFor/viewport: aspect-matched design width (H fixed), clamped; fill viewport", () => {
  assert.equal(designWidthFor(1280, 720), 1280, "16:9 → 1280");
  assert.equal(designWidthFor(2560, 1440), 1280, "2x 16:9 → still 1280 (aspect, not size)");
  assert.equal(designWidthFor(960, 720), 960, "4:3 → 960");
  assert.equal(designWidthFor(2000, 720), 2000, "ultrawide → wider design");
  assert.equal(designWidthFor(720, 1280), Math.round(720 * 720 / 1280), "portrait → narrow design");
  assert.equal(designWidthFor(99999, 1), 5120, "clamped high");
  assert.equal(designWidthFor(1, 99999), 240, "clamped low");
  const vp = viewport(960, 720);
  assert.deepEqual(vp, { W: 960, H: 720, scale: 1 }, "fill: W=960, scale=winH/720=1");
  assert.equal(viewport(2560, 1440).scale, 2, "scale = winH/720");
});

test("TQ-279/294 pointerToDesign: inverts the aspect-match transform (no letterbox; scale=rect.h/720)", () => {
  // exact-ratio 1280×720: 1:1
  assert.deepEqual(pointerToDesign(640, 360, { left: 0, top: 0, width: 1280, height: 720 }), { x: 640, y: 360 });
  assert.deepEqual(pointerToDesign(0, 0, { left: 0, top: 0, width: 1280, height: 720 }), { x: 0, y: 0 });
  // 2× (2560×1440): scale 2 → halve
  assert.deepEqual(pointerToDesign(1280, 720, { left: 0, top: 0, width: 2560, height: 1440 }), { x: 640, y: 360 });
  // ultrawide 2000×720: scale 1, NO letterbox offset → pointer maps straight through (design width is 2000)
  assert.deepEqual(pointerToDesign(360, 0, { left: 0, top: 0, width: 2000, height: 720 }), { x: 360, y: 0 });
  assert.deepEqual(pointerToDesign(1000, 360, { left: 0, top: 0, width: 2000, height: 720 }), { x: 1000, y: 360 });
  // offset rect: subtract rect.left/top first
  assert.deepEqual(pointerToDesign(140, 60, { left: 100, top: 40, width: 1280, height: 720 }), { x: 40, y: 20 });
});

test("fitScale: degenerate sizes never divide-by-zero or go negative-scale", () => {
  const f = fitScale(0, 0);
  assert.ok(f.scale > 0 && Number.isFinite(f.scale));
});

test("core primitives draw onto a minimal 2D-context stub without throwing", () => {
  // A tiny fake ctx records the calls — proves the primitives issue the expected canvas ops.
  const ops = [];
  const ctx = new Proxy({}, {
    get: (_t, p) => (typeof p === "string" && /^(fill|stroke|begin|move|line|arc|close|rect|fillText|setTransform|clear|save|restore)/.test(p)
      ? (...a) => ops.push([p, ...a]) : undefined),
    set: () => true,
  });
  assert.doesNotThrow(() => {
    cDrawRect(ctx, { x: 1, y: 2, w: 10, h: 10, color: [10, 20, 30], opacity: 0.5, radius: 4 });
    cDrawRect(ctx, { x: 0, y: 0, w: 5, h: 5, color: [1, 2, 3] }); // square path
    cDrawCircle(ctx, { x: 5, y: 5, radius: 3, color: [9, 9, 9] });
    cDrawLine(ctx, { p1: { x: 0, y: 0 }, p2: { x: 4, y: 4 }, width: 2 });
    cDrawText(ctx, { text: "hi", x: 2, y: 2, size: 12, anchor: "center" });
  });
  assert.ok(ops.some(([op]) => op === "fillRect"), "square rect uses fillRect");
  assert.ok(ops.some(([op]) => op === "arc"), "circle uses arc");
  assert.ok(ops.some(([op]) => op === "fillText"), "text uses fillText");
});

test("rgba: a KColor {r,g,b} yields the SAME fillStyle as the [r,g,b] array (adapter pass-through, byte-identical)", () => {
  // Captures the fillStyle string a primitive sets, so we can assert rgba's output for each colour shape.
  const fillOf = (color, opacity = 1) => {
    let fill = null;
    const ctx = new Proxy({}, {
      get: (_t, p) => (typeof p === "string" && /^(fill|stroke|begin|move|line|arc|close|rect)/.test(p) ? () => {} : undefined),
      set: (_t, p, v) => { if (p === "fillStyle") fill = v; return true; },
    });
    cDrawRect(ctx, { x: 0, y: 0, w: 2, h: 2, color, opacity }); // square fill path → one fillStyle set, no outline
    return fill;
  };
  assert.equal(fillOf({ r: 10, g: 20, b: 30 }, 0.5), fillOf([10, 20, 30], 0.5), "KColor === array");
  assert.equal(fillOf([10, 20, 30], 0.5), "rgba(10,20,30,0.5)", "array shape unchanged from before");
  assert.equal(fillOf({ r: 10, g: 20, b: 30 }, 1), "rgba(10,20,30,1)", "KColor shape now supported");
  assert.equal(fillOf(null, 1), "rgba(255,255,255,1)", "null/undefined → white (matches the old toRGB default)");
  assert.equal(fillOf([1.9, 2.1, 3.9], 1), "rgba(1,2,3,1)", "array channels floored via |0");
  assert.equal(fillOf({ r: 1.9, g: 2.1, b: 3.9 }, 1), "rgba(1,2,3,1)", "KColor channels floored via |0");
});

test("TQ-272 wrapText: greedy word-wrap honoring an injected measure + explicit newlines", () => {
  const measure = (s) => s.length * 6; // 6px per char (matches the fake ctx)
  // maxWidth 60px = 10 chars: "the quick" (9) fits; adding " brown" (15) wraps.
  assert.deepEqual(wrapText(measure, "the quick brown fox", 60), ["the quick", "brown fox"]);
  // explicit newlines split regardless of width
  assert.deepEqual(wrapText(measure, "a\nb", 1000), ["a", "b"]);
  // a single over-long word stands alone (no mid-word break)
  assert.deepEqual(wrapText(measure, "supercalifragilistic", 30), ["supercalifragilistic"]);
  // falsy width → unchanged (newline-split only)
  assert.deepEqual(wrapText(measure, "no wrap here", 0), ["no wrap here"]);
  assert.deepEqual(wrapText(measure, "", 50), [""]);
});

test("TQ-273 cDrawRect/cDrawCircle: outline + fill-toggle match k.draw* (fill, outline, both)", () => {
  // rect: fill+outline → fillRect + strokeRect
  const both = [];
  cDrawRect(fakeCtx(both), { x: 0, y: 0, w: 10, h: 8, color: [1, 2, 3], outline: { width: 2, color: [9, 9, 9] } });
  assert.ok(both.some(([op]) => op === "fillRect") && both.some(([op]) => op === "strokeRect"), "fill+outline rect strokes and fills");
  // rect: outline-only (fill:false) → strokeRect, NO fillRect
  const ringOnly = [];
  cDrawRect(fakeCtx(ringOnly), { x: 0, y: 0, w: 10, h: 8, fill: false, outline: { width: 1, color: [9, 9, 9] } });
  assert.ok(ringOnly.some(([op]) => op === "strokeRect") && !ringOnly.some(([op]) => op === "fillRect"), "fill:false rect only strokes");
  // rounded rect outline-only → stroke (path), no fill
  const rounded = [];
  cDrawRect(fakeCtx(rounded), { x: 0, y: 0, w: 10, h: 8, radius: 3, fill: false, outline: { width: 1, color: [9, 9, 9] } });
  assert.ok(rounded.some(([op]) => op === "stroke") && !rounded.some(([op]) => op === "fill"), "rounded fill:false strokes the path only");
  // circle: outline-only ring (fill:false) → stroke, no fill
  const circ = [];
  cDrawCircle(fakeCtx(circ), { x: 5, y: 5, radius: 4, fill: false, outline: { width: 2, color: [9, 9, 9] } });
  assert.ok(circ.some(([op]) => op === "stroke") && !circ.some(([op]) => op === "fill"), "fill:false circle only strokes");
  // default (no fill/outline opts) stays a plain fill — back-compat
  const plain = [];
  cDrawCircle(fakeCtx(plain), { x: 1, y: 1, radius: 2, color: [1, 2, 3] });
  assert.ok(plain.some(([op]) => op === "fill") && !plain.some(([op]) => op === "stroke"), "default circle fills, no stroke");
});

test("TQ-272 cDrawEllipse: issues a filled ellipse path matching k.drawEllipse radii", () => {
  const ops = [];
  assert.doesNotThrow(() => cDrawEllipse(fakeCtx(ops), { x: 10, y: 20, radiusX: 30, radiusY: 12, color: [1, 2, 3] }));
  const e = ops.find(([op]) => op === "ellipse");
  assert.ok(e, "uses ctx.ellipse");
  assert.deepEqual(e.slice(1, 5), [10, 20, 30, 12], "passes x,y + radii (not diameters)");
  assert.ok(ops.some(([op]) => op === "fill"), "fills the ellipse");
});

test("TQ-272 cDrawText: width wraps into multiple fillText lines; no width stays single-line", () => {
  const wrapped = [];
  cDrawText(fakeCtx(wrapped), { text: "the quick brown fox", x: 0, y: 0, size: 12, width: 60 }); // 60px=10 chars
  assert.equal(wrapped.filter(([op]) => op === "fillText").length, 2, "wraps to 2 lines");
  const single = [];
  cDrawText(fakeCtx(single), { text: "the quick brown fox", x: 0, y: 0, size: 12 }); // no width
  assert.equal(single.filter(([op]) => op === "fillText").length, 1, "single line without width");
});

test("cDrawPoly: fills a closed path for >=3 points, no-ops below 3", () => {
  const ops = [];
  cDrawPoly(fakeCtx(ops), { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }], color: [1, 2, 3] });
  assert.ok(ops.some(([op]) => op === "closePath") && ops.some(([op]) => op === "fill"), "triangle fills a closed path");
  const ops2 = [];
  cDrawPoly(fakeCtx(ops2), { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }); // 2 points
  assert.equal(ops2.length, 0, "fewer than 3 points draws nothing");
});
