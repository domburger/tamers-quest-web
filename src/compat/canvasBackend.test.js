import test from "node:test";
import assert from "node:assert/strict";
import { backendFlag, fitScale, cDrawRect, cDrawCircle, cDrawText, cDrawLine, cDrawPoly, drawLobby } from "./canvasBackend.js";

// A tiny fake 2D context that records canvas ops — lets us exercise the pure draw code in Node.
function fakeCtx(ops = []) {
  return new Proxy({}, {
    get: (_t, p) => (typeof p === "string" && /^(fill|stroke|begin|move|line|arc|close|rect|fillText|setTransform|clear|save|restore)/.test(p)
      ? (...a) => ops.push([p, ...a]) : undefined),
    set: () => true,
  });
}

test("backendFlag: URL ?backend=canvas/phaser selects the backend (case-insensitive)", () => {
  assert.equal(backendFlag("?backend=canvas"), "canvas");
  assert.equal(backendFlag("?backend=Phaser"), "phaser");
  assert.equal(backendFlag("?foo=bar&backend=CANVAS"), "canvas");
  assert.equal(backendFlag("?backend=webgl"), null, "unknown value → null (Phaser default)");
  assert.equal(backendFlag(""), null);
});

test("backendFlag: localStorage fallback, but the URL wins when both are set", () => {
  const store = (k) => (k === "tq_backend" ? "canvas" : null);
  assert.equal(backendFlag("", store), "canvas", "storage used when URL is silent");
  assert.equal(backendFlag("?backend=phaser", store), "phaser", "URL overrides storage");
  assert.equal(backendFlag("", () => "nonsense"), null);
});

test("backendFlag: never throws on a bad query string or throwing storage getter", () => {
  assert.doesNotThrow(() => backendFlag("%%%not a query%%%"));
  assert.equal(backendFlag("", () => { throw new Error("storage blocked"); }), null);
});

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

test("cDrawPoly: fills a closed path for >=3 points, no-ops below 3", () => {
  const ops = [];
  cDrawPoly(fakeCtx(ops), { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }], color: [1, 2, 3] });
  assert.ok(ops.some(([op]) => op === "closePath") && ops.some(([op]) => op === "fill"), "triangle fills a closed path");
  const ops2 = [];
  cDrawPoly(fakeCtx(ops2), { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }); // 2 points
  assert.equal(ops2.length, 0, "fewer than 3 points draws nothing");
});

test("drawLobby: renders the representative scene against a stub ctx without throwing (no DOM)", () => {
  const ops = [];
  assert.doesNotThrow(() => drawLobby(fakeCtx(ops), 1.5));
  assert.ok(ops.filter(([op]) => op === "fill" || op === "fillRect" || op === "fillText").length > 50,
    "the lobby issues a realistic immediate-mode load (buildings + fireflies + labels)");
});
