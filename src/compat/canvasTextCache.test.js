import test from "node:test";
import assert from "node:assert/strict";
import { makeLabelCache } from "./canvasTextCache.js";
import { cDrawText, textAlignFor, textBaselineFor } from "./canvasBackend.js";
import { makeCanvasRenderer } from "./canvasRenderer.js";

// A fake `document` whose canvas 2D contexts report deterministic actualBoundingBox metrics (so the bake
// geometry is exactly predictable). Records every offscreen fillText + counts createElement calls.
function fakeDoc({ bbox = true } = {}) {
  const calls = { create: 0, fills: [] };
  const doc = {
    createElement() {
      calls.create++;
      return {
        width: 0, height: 0,
        getContext() {
          return {
            measureText(s) {
              const w = String(s).length * 6;
              return bbox
                ? { width: w, actualBoundingBoxLeft: 0, actualBoundingBoxRight: w, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }
                : { width: w }; // no bbox metrics → unbakeable
            },
            fillText(...a) { calls.fills.push(a); },
          };
        },
      };
    },
  };
  return { doc, calls };
}

test("TQ-443 label cache: a label is baked only after it recurs `promoteAfter` times (no thrash on one-shot text)", () => {
  const { doc } = fakeDoc();
  const c = makeLabelCache({ doc, promoteAfter: 3 });
  const spec = { key: "k", text: "hi", size: 12, font: "sans-serif", anchor: "topleft", rgbStr: "rgb(1,2,3)", scale: 1 };
  assert.equal(c.acquire(spec), null, "1st sighting → not baked");
  assert.equal(c.acquire(spec), null, "2nd sighting → not baked");
  const e = c.acquire(spec);
  assert.ok(e && e.bmp, "3rd sighting → baked");
  assert.ok(c.acquire(spec).bmp, "stays baked afterwards");
});

test("TQ-443 label cache: bake geometry places the bitmap origin exactly on the draw point, at device scale", () => {
  const { doc } = fakeDoc();
  const c = makeLabelCache({ doc, promoteAfter: 1 });
  // "hi" → width 12; bbox L0 R12 A8 D2; PAD 2; scale 2.
  const e = c.acquire({ key: "k", text: "hi", size: 12, font: "sans-serif", anchor: "topleft", rgbStr: "rgb(0,0,0)", scale: 2 });
  // device bitmap: wPx = ceil(0+12)+4 = 16, hPx = ceil(8+2)+4 = 14
  assert.equal(e.bmp.width, 16, "bitmap device width");
  assert.equal(e.bmp.height, 14, "bitmap device height");
  // origin inside bmp = (aL+PAD, aA+PAD) = (2,10) device px → offsets are -origin/scale, dims are px/scale
  assert.equal(e.offX, -1, "offX = -2/2");
  assert.equal(e.offY, -5, "offY = -10/2");
  assert.equal(e.wDesign, 8, "wDesign = 16/2");
  assert.equal(e.hDesign, 7, "hDesign = 14/2");
});

test("TQ-443 label cache: missing actualBoundingBox metrics → unbakeable, no per-frame re-bake attempts", () => {
  const { doc, calls } = fakeDoc({ bbox: false });
  const c = makeLabelCache({ doc, promoteAfter: 1 });
  const spec = { key: "k", text: "x", size: 12, font: "sans-serif", anchor: "topleft", rgbStr: "rgb(0,0,0)", scale: 1 };
  assert.equal(c.acquire(spec), null, "can't bake without bbox metrics");
  const createsAfterFirst = calls.create;
  for (let i = 0; i < 20; i++) assert.equal(c.acquire(spec), null, "stays on the direct path");
  assert.equal(calls.create, createsAfterFirst, "no further canvas allocations once marked unbakeable");
});

test("TQ-443 label cache: LRU-capped; a key touched every frame stays hot while cold keys evict", () => {
  const { doc } = fakeDoc();
  const c = makeLabelCache({ doc, promoteAfter: 1, cap: 2 });
  const mk = (k) => ({ key: k, text: k, size: 12, font: "sans-serif", anchor: "topleft", rgbStr: "rgb(0,0,0)", scale: 1 });
  c.acquire(mk("A"));            // {A}
  c.acquire(mk("B"));            // {A,B}
  c.acquire(mk("A"));            // touch A → {B,A}
  c.acquire(mk("C"));            // over cap → evict oldest (B) → {A,C}
  assert.ok(c.size() <= 2, "cap respected");
  // A was touched so it survived; re-acquiring it is still a hot hit (baked), C is present too.
  assert.ok(c.acquire(mk("A")).bmp, "hot key A survived eviction");
  assert.ok(c.acquire(mk("C")).bmp, "C present");
});

test("TQ-443 renderer.drawText: a promoted label blits via drawImage (no per-frame fillText/font parse)", () => {
  const { doc } = fakeDoc();
  const cache = makeLabelCache({ doc, promoteAfter: 1 });
  const ops = [];
  const ctx = new Proxy({ globalAlpha: 1 }, {
    get: (t, p) => {
      if (p === "getTransform") return () => ({ a: 2 });
      if (p === "globalAlpha") return t.globalAlpha;
      if (typeof p === "string") return (...a) => ops.push([p, ...a]);
      return t[p];
    },
    set: (t, p, v) => { t[p] = v; ops.push(["set:" + p, v]); return true; },
  });
  const r = makeCanvasRenderer(ctx, { labelCache: cache });
  r.drawText({ pos: { x: 100, y: 50 }, text: "hi", size: 12, color: [0, 0, 0], anchor: "topleft", opacity: 0.5 });
  const di = ops.find(([op]) => op === "drawImage");
  assert.ok(di, "blits the cached bitmap");
  assert.deepEqual(di.slice(2), [99, 45, 8, 7], "drawImage dest = (x+offX, y+offY, wDesign, hDesign)");
  assert.ok(!ops.some(([op]) => op === "fillText"), "no fillText — the per-frame font/fillStyle parse is gone");
  // opacity routed through globalAlpha and restored to its prior value
  assert.ok(ops.some(([op, v]) => op === "set:globalAlpha" && v === 0.5), "opacity applied via globalAlpha");
  assert.equal(ctx.globalAlpha, 1, "globalAlpha restored");
});

test("TQ-443 renderer.drawText: wrapped/multi-line text bypasses the cache (still fillText)", () => {
  const { doc } = fakeDoc();
  const cache = makeLabelCache({ doc, promoteAfter: 1 });
  const ops = [];
  const ctx = new Proxy({}, {
    get: (_t, p) => {
      if (p === "getTransform") return () => ({ a: 1 });
      if (p === "measureText") return (s) => ({ width: String(s).length * 6 });
      if (typeof p === "string") return (...a) => ops.push([p, ...a]);
      return undefined;
    },
    set: () => true,
  });
  const r = makeCanvasRenderer(ctx, { labelCache: cache });
  r.drawText({ pos: { x: 0, y: 0 }, text: "the quick brown fox", size: 12, color: [1, 2, 3], width: 60 });
  assert.ok(ops.some(([op]) => op === "fillText"), "wrapped text → direct fillText, not a blit");
  assert.ok(!ops.some(([op]) => op === "drawImage"), "no blit for wrapped text");
});

test("TQ-443 cDrawText style guard: same-style runs skip redundant font/baseline/align sets; a size change re-sets font", () => {
  const ops = [];
  const ctx = new Proxy({}, {
    get: (_t, p) => {
      if (p === "measureText") return (s) => ({ width: String(s).length * 6 });
      if (typeof p === "string") return (...a) => ops.push([p, ...a]);
      return undefined;
    },
    set: (_t, p, v) => { ops.push(["set:" + p, v]); return true; },
  });
  const state = { font: null, baseline: null, align: null };
  const base = { x: 0, y: 0, size: 14, color: [1, 2, 3], anchor: "left", font: "sans-serif" };
  cDrawText(ctx, { ...base, text: "a" }, state);
  cDrawText(ctx, { ...base, text: "b" }, state); // identical style
  assert.equal(ops.filter(([op]) => op === "set:font").length, 1, "font set once across identical-style draws");
  assert.equal(ops.filter(([op]) => op === "set:textBaseline").length, 1, "baseline set once");
  assert.equal(ops.filter(([op]) => op === "set:textAlign").length, 1, "align set once");
  // fillStyle is NOT guarded (every primitive writes it) → set on each text draw
  assert.equal(ops.filter(([op]) => op === "set:fillStyle").length, 2, "fillStyle set every draw");
  // a different size re-parses the font only
  cDrawText(ctx, { ...base, size: 18, text: "c" }, state);
  assert.equal(ops.filter(([op]) => op === "set:font").length, 2, "size change re-sets font");
  assert.equal(ops.filter(([op]) => op === "set:textAlign").length, 1, "align unchanged → still one set");
});

test("TQ-443 align/baseline helpers match the legacy expressions (cache must place exactly as the direct path)", () => {
  assert.equal(textBaselineFor("center"), "middle");
  assert.equal(textBaselineFor("topleft"), "top");
  assert.equal(textAlignFor("center"), "center");
  assert.equal(textAlignFor("top"), "center");
  assert.equal(textAlignFor("topright"), "right");
  assert.equal(textAlignFor("topleft"), "left");
});
