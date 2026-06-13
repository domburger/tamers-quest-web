import { test } from "node:test";
import assert from "node:assert/strict";
import { elementColor, hpColor, addHeader, inRect, lighten, drawButton, drawPillFill, drawPanel, drawHeader, drawScrollbar, drawToast } from "./theme.js";

// elementColor is the shared monster/attack accent. Elements are FREE-FORM flavour with
// no fixed taxonomy and NO per-element colour coding (user 2026-06-10) — it returns ONE
// neutral accent for ANY input, and must still never crash / never return undefined.
const isRgb = (c) => Array.isArray(c) && c.length === 3 && c.every((n) => Number.isFinite(n) && n >= 0 && n <= 255);

test("elementColor: one neutral accent for EVERY input (no per-element colour)", () => {
  const neutral = elementColor();
  assert.ok(isRgb(neutral));
  // Known names, synonyms, dual-types, freeform AI strings, nullish — all identical now.
  for (const n of ["fire", "Fire", "  WATER ", "grass", "fire/water", "Plasmaweave", "", null, undefined, "   "]) {
    assert.deepEqual(elementColor(n), neutral, `elementColor(${JSON.stringify(n)}) must equal the neutral accent`);
  }
});

test("elementColor: ALWAYS returns a valid RGB triple (never grey-crashes)", () => {
  for (const n of ["fire", "FIRE", "grass", "fire/ice", "", null, undefined, "  ", "Zzxq", "123", "🔥"]) {
    assert.ok(isRgb(elementColor(n)), `elementColor(${JSON.stringify(n)}) must be a valid RGB triple`);
  }
});

// addHeader's portrait-aware auto-shrink (WIN-T5) is real logic, not just a k-builder:
// it shrinks the centred title to fit narrow widths (reserving top-corner button room)
// and floors at 12px so a long title on a tiny screen stays legible. A stub k records
// the size passed to k.text (the first text is the title).
function mockHeaderK(width) {
  const texts = [];
  const k = {
    width: () => width,
    text: (t, opts) => { texts.push({ text: t, size: opts?.size }); return "txt"; },
    pos: () => "p", anchor: () => "a", color: () => "c", opacity: () => "o", fixed: () => "f", rect: () => "r",
    add: (comps) => ({ comps }),
  };
  return { k, texts };
}
const headerSize = (width, text, size = 34) => {
  const { k, texts } = mockHeaderK(width);
  addHeader(k, { x: 0, text, size });
  return texts[0].size;
};

test("addHeader: title auto-shrinks to fit narrow/portrait widths, floors at 12, no-op when wide", () => {
  assert.equal(headerSize(1280, "SELECT CHARACTER", 34), 34, "wide screen → requested size kept");
  const narrow = headerSize(400, "SELECT CHARACTER", 34);
  assert.ok(narrow < 34 && narrow >= 12, `narrow (portrait) → shrinks, got ${narrow}`);
  assert.equal(headerSize(300, "A VERY LONG TITLE HERE", 34), 12, "tiny + long → floors at 12 (stays legible)");
  assert.equal(headerSize(300, "", 34), 34, "empty text → shrink guard skipped, size unchanged");
});

// ── Immediate-mode primitives (the onDraw twins used by shops/roster/bestiary/HUD) ──

test("inRect: hit-test on an [x,y,w,h] rect (inclusive edges)", () => {
  const r = [10, 20, 100, 40];
  assert.ok(inRect({ x: 10, y: 20 }, r), "top-left corner is inside");
  assert.ok(inRect({ x: 110, y: 60 }, r), "bottom-right corner is inside");
  assert.ok(inRect({ x: 60, y: 40 }, r), "center is inside");
  assert.ok(!inRect({ x: 9, y: 40 }, r), "left of the rect is outside");
  assert.ok(!inRect({ x: 60, y: 61 }, r), "below the rect is outside");
});

test("hpColor: success > 0.5, warn > 0.25, danger below; one source for every HP bar", () => {
  assert.deepEqual(hpColor(1), hpColor(0.51), "full + just-above-half both healthy");
  assert.notDeepEqual(hpColor(0.6), hpColor(0.4), "crosses the 0.5 threshold");
  assert.notDeepEqual(hpColor(0.4), hpColor(0.2), "crosses the 0.25 threshold");
  for (const f of [1, 0.5, 0.25, 0]) assert.ok(Array.isArray(hpColor(f)) && hpColor(f).length === 3, "always an rgb triple");
});

test("lighten: adds toward white per channel, clamped at 255", () => {
  assert.deepEqual(lighten([10, 20, 30], 16), [26, 36, 46]);
  assert.deepEqual(lighten([250, 100, 0], 16), [255, 116, 16], "channel clamps at 255");
});

// A mock k that records every immediate-mode draw call, so we can assert the helpers
// paint the standardized layers (shadow + fill + sheen + label) without a real canvas.
function mockDrawK() {
  const calls = { rect: [], text: [], circle: [] };
  const k = {
    width: () => 800, height: () => 600,
    rgb: (...c) => c,
    vec2: (x, y) => ({ x, y }),
    drawRect: (o) => calls.rect.push(o),
    drawText: (o) => calls.text.push(o),
    drawCircle: (o) => calls.circle.push(o),
  };
  return { k, calls };
}

test("drawButton: shadow + solid fill + smooth gloss bands + label; glow is opt-in (TQ-139); disabled drops gloss", () => {
  const base = mockDrawK();
  drawButton(base.k, { rect: [0, 0, 120, 40], text: "Buy" });
  // TQ-139: the outer glow is OFF by default. A filled accent at rest is now just the drop shadow +
  // solid body + the 5 GLOSS_BANDS gradient = 7 rects (no glow layers).
  assert.equal(base.calls.rect.length, 7, "no glow by default; shadow + fill + 5 gloss bands");
  assert.equal(base.calls.text.length, 1, "one label");
  assert.equal(base.calls.text[0].text, "Buy");

  // Opt-in glow (glowOn:true) restores the 2-layer soft glow (outer bloom + inner edge-hug) → 9 rects,
  // and hover intensifies the outer bloom (rect[0]).
  const glow = mockDrawK();
  drawButton(glow.k, { rect: [0, 0, 120, 40], text: "Buy", glowOn: true });
  assert.equal(glow.calls.rect.length, 9, "glowOn adds the 2 glow layers back");
  const glowHov = mockDrawK();
  drawButton(glowHov.k, { rect: [0, 0, 120, 40], text: "Buy", glowOn: true, hover: true });
  assert.ok(glowHov.calls.rect[0].opacity > glow.calls.rect[0].opacity, "hover intensifies the opt-in outer glow");

  const dis = mockDrawK();
  drawButton(dis.k, { rect: [0, 0, 120, 40], text: "Buy", hover: true, disabled: true });
  // Disabled is not live: no glow, no gloss bands — just the drop shadow + the dimmed solid body.
  assert.equal(dis.calls.rect.length, 2, "disabled drops glow + gloss; shadow + dimmed fill only");
});

test("drawButton: TQ-133 — gloss bands tuck inside the body (no corner squares) for pill + rounded-rect radii", () => {
  // Body spans [0,120] horizontally; rects = [0]=shadow, [1]=body, [2..6]=5 gloss bands. A band that
  // pokes past the body's rounded top read as the reported light squares — assert every band is
  // strictly inset within the body for BOTH a gentle radius and a full pill (radius = h/2 = 27).
  const glossBands = (radius) => {
    const { k, calls } = mockDrawK();
    drawButton(k, { rect: [0, 0, 120, 54], text: "Buy", radius });
    return calls.rect.slice(2);
  };
  for (const radius of [14, 27]) {
    const gl = glossBands(radius);
    assert.equal(gl.length, 5, `5 gloss bands at radius ${radius}`);
    for (const b of gl) {
      assert.ok(b.pos.x > 0, `gloss left edge inset inside the body (radius ${radius})`);
      assert.ok(b.pos.x + b.width < 120, `gloss right edge inset inside the body (radius ${radius})`);
      assert.ok(b.pos.y >= 3, `gloss top sits below the body top (radius ${radius})`);
    }
  }
  // A pill's top curves in further, so it must inset the gloss MORE than a 14px radius does.
  assert.ok(glossBands(27)[0].pos.x > glossBands(14)[0].pos.x, "pill radius insets the gloss further than a 14px radius");
});

test("drawPillFill: the shared 4-layer gradient body (fill + sheen + shade + rim), no shadow/glow/label", () => {
  const a = mockDrawK();
  drawPillFill(a.k, { rect: [0, 0, 120, 40], base: [40, 40, 40] });
  assert.equal(a.calls.rect.length, 4, "fill + sheen + shade + rim");
  assert.equal(a.calls.text.length, 0, "label is the caller's responsibility, not the body's");
  // Caller-tunable opacities map straight through (combat folds its affordable/lock dim in here).
  const b = mockDrawK();
  drawPillFill(b.k, { rect: [0, 0, 120, 40], base: [40, 40, 40], fillOp: 0.5, rimOp: 0.2 });
  assert.equal(b.calls.rect[0].opacity, 0.5, "fillOp drives the fill layer");
  assert.equal(b.calls.rect[3].opacity, 0.2, "rimOp drives the rim layer");
});

test("drawPanel: shadow + fill + sheen + rim by default; flags drop layers", () => {
  const a = mockDrawK();
  drawPanel(a.k, { rect: [0, 0, 200, 60] });
  // De-glassed flat card: shadow + fill (rim folded into the fill's outline) + top sheen = 3 rects.
  assert.equal(a.calls.rect.length, 3, "shadow + fill + sheen (hairline rim is the fill outline)");
  const b = mockDrawK();
  drawPanel(b.k, { rect: [0, 0, 200, 60], shadow: false, sheen: false });
  assert.equal(b.calls.rect.length, 1, "just the fill when shadow+sheen off");
});

test("drawScrollbar: track + thumb when scrollable; no-op when nothing to scroll", () => {
  const k = { width: () => 800, height: () => 600, rgb: (...c) => c, vec2: (x, y) => ({ x, y }) };
  const a = { ...k }; const aRects = []; a.drawRect = (o) => aRects.push(o);
  drawScrollbar(a, { top: 100, trackH: 400, contentH: 1200, scrollY: 0, maxScroll: 800 });
  assert.equal(aRects.length, 2, "faint track + thumb");
  // thumb height = max(30, trackH^2/contentH) = max(30, 160000/1200=133.3) = 133.3
  assert.ok(Math.abs(aRects[1].height - (400 * 400) / 1200) < 0.001, "thumb height matches the prior per-scene math");
  const b = { ...k }; const bRects = []; b.drawRect = (o) => bRects.push(o);
  drawScrollbar(b, { top: 100, trackH: 400, contentH: 1200, scrollY: 0, maxScroll: 0 });
  assert.equal(bRects.length, 0, "no-op when maxScroll is 0");
  const c = { ...k }; const cRects = []; c.drawRect = (o) => cRects.push(o);
  drawScrollbar(c, { top: 100, trackH: 400, contentH: 1200, scrollY: 0, maxScroll: 800, track: false });
  assert.equal(cRects.length, 1, "thumb only when track is off");
});

test("drawToast: drawPanel pill + label while t>0; renders nothing once elapsed", () => {
  const on = mockDrawK();
  drawToast(on.k, { text: "Purchased!", t: 1.5 });
  assert.equal(on.calls.rect.length, 3, "drawPanel pill = shadow + fill + sheen");
  assert.equal(on.calls.text.length, 1, "one label");
  assert.equal(on.calls.text[0].text, "Purchased!");
  const off = mockDrawK();
  drawToast(off.k, { text: "Purchased!", t: 0 });
  assert.equal(off.calls.rect.length + off.calls.text.length, 0, "no-op once the toast elapses");
  const blank = mockDrawK();
  drawToast(blank.k, { text: "", t: 1.5 });
  assert.equal(blank.calls.rect.length + blank.calls.text.length, 0, "no-op with empty text");
});

test("drawHeader: title label + two-layer teal rule; returns the y below the rule", () => {
  const { k, calls } = mockDrawK();
  const yBelow = drawHeader(k, { title: "SPIRIT SHOP", y: 18, size: 22 });
  assert.equal(calls.text.length, 1);
  assert.equal(calls.text[0].text, "SPIRIT SHOP");
  assert.equal(calls.rect.length, 2, "glow rule + crisp rule");
  assert.equal(yBelow, 18 + 22 + 4 + 6, "returns y just below the accent rule");
});
