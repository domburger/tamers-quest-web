import { test } from "node:test";
import assert from "node:assert/strict";
import { THEME, accentColor, hpColor, addHeader, inRect, lighten, drawButton, drawPillFill, drawPanel, drawHeader, drawScrollbar, drawToast, drawGlass, drawTabs, drawCard, drawSwitch, drawChip, drawEyebrow } from "./theme.js";

// accentColor is the shared monster/attack/card accent — ONE neutral accent (TQ-349 removed
// the "element" concept, so there was never a taxonomy to colour-code). It takes no args and
// must always return a valid, stable RGB triple (never crash / never return undefined).
const isRgb = (c) => Array.isArray(c) && c.length === 3 && c.every((n) => Number.isFinite(n) && n >= 0 && n <= 255);

test("accentColor: returns ONE stable neutral RGB accent", () => {
  const a = accentColor();
  assert.ok(isRgb(a));
  assert.deepEqual(accentColor(), a, "stable across calls (shared instance)");
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

test("drawButton: FILLED = one flat shadow + gradient body + catch-light + label; glow is opt-in (TQ-139); GLASS for ghost/disabled", () => {
  const base = mockDrawK();
  drawButton(base.k, { rect: [0, 0, 120, 40], text: "Buy" });
  // UI v3: a filled accent at rest = 1 cheap offset shadow (no ctx blur — list screens draw dozens) +
  // gradient body + inner top catch-light = 3 rects (TQ-139: no glow).
  assert.equal(base.calls.rect.length, 3, "no glow by default; shadow + gradient body + catch-light");
  assert.ok(!base.calls.rect[0].shadow, "button shadow is a flat offset (blur reserved for big panels)");
  assert.ok(base.calls.rect[1].gradient && base.calls.rect[1].gradient.stops.length === 3, "body is a 3-stop vertical gradient");
  assert.equal(base.calls.text.length, 1, "one label");
  assert.equal(base.calls.text[0].text, "Buy");

  // Opt-in glow (glowOn:true) adds the 2-layer soft glow (outer bloom + inner edge-hug) → 5 rects,
  // and hover intensifies the outer bloom (rect[0]).
  const glow = mockDrawK();
  drawButton(glow.k, { rect: [0, 0, 120, 40], text: "Buy", glowOn: true });
  assert.equal(glow.calls.rect.length, 5, "glowOn adds the 2 glow layers");
  const glowHov = mockDrawK();
  drawButton(glowHov.k, { rect: [0, 0, 120, 40], text: "Buy", glowOn: true, hover: true });
  assert.ok(glowHov.calls.rect[0].opacity > glow.calls.rect[0].opacity, "hover intensifies the opt-in outer glow");

  // GLASS family: a ghost (surface-token fill) or disabled button is a white wash + a white hairline — no
  // shadow, no bevel — so it reads as part of the frosted sheet.
  const ghost = mockDrawK();
  drawButton(ghost.k, { rect: [0, 0, 120, 40], text: "Cancel", fill: THEME.surfaceAlt });
  assert.equal(ghost.calls.rect.length, 2, "ghost = wash + hairline");
  assert.deepEqual(ghost.calls.rect[0].color, [255, 255, 255], "the wash is white at low opacity");
  assert.ok(ghost.calls.rect[0].opacity < 0.2 && ghost.calls.rect[1].fill === false, "low-opacity wash; outline-only hairline");
  const dis = mockDrawK();
  drawButton(dis.k, { rect: [0, 0, 120, 40], text: "Buy", hover: true, disabled: true });
  assert.equal(dis.calls.rect.length, 2, "disabled is glass too (wash + hairline), hover ignored");
  assert.ok(dis.calls.rect[0].opacity < ghost.calls.rect[0].opacity, "disabled wash is fainter than a live ghost");
});

test("drawButton: the catch-light tucks inside the body (no corner squares) for pill + rounded-rect radii; pressed sinks the body", () => {
  // Body spans [0,120] horizontally; rects = [0]=shadow, [1]=body, [2]=top catch-light.
  const bevel = (radius) => {
    const { k, calls } = mockDrawK();
    drawButton(k, { rect: [0, 0, 120, 54], text: "Buy", radius });
    return calls.rect.slice(2);
  };
  for (const radius of [14, 27]) {
    const ln = bevel(radius);
    assert.equal(ln.length, 1, `catch-light at radius ${radius}`);
    for (const b of ln) {
      assert.ok(b.pos.x > 0, `line left edge inset inside the body (radius ${radius})`);
      assert.ok(b.pos.x + b.width < 120, `line right edge inset inside the body (radius ${radius})`);
      assert.ok(b.pos.y >= 1 && b.pos.y + b.height <= 54, `line stays within the body (radius ${radius})`);
    }
  }
  // A pill's corners curve in further, so it must inset the line MORE than a 14px radius does.
  assert.ok(bevel(27)[0].pos.x > bevel(14)[0].pos.x, "pill radius insets the catch-light further than a 14px radius");
  // Pressed: the body sits 1px lower on its shadow (tactile sink).
  const rest = mockDrawK(), pressed = mockDrawK();
  drawButton(rest.k, { rect: [0, 0, 120, 40], text: "Buy" });
  drawButton(pressed.k, { rect: [0, 0, 120, 40], text: "Buy", pressed: true });
  assert.equal(pressed.calls.rect[1].pos.y, rest.calls.rect[1].pos.y + 1, "pressed body sinks by 1px");
});

test("UI v3 glass primitives: drawGlass / drawTabs / drawCard / drawSwitch / drawChip / drawEyebrow paint the documented layers", () => {
  const g = mockDrawK();
  drawGlass(g.k, { rect: [0, 0, 200, 60] });
  assert.equal(g.calls.rect.length, 2, "wash + hairline (no tint by default)");
  const gt = mockDrawK();
  drawGlass(gt.k, { rect: [0, 0, 200, 60], tint: 0.3, hover: true });
  assert.equal(gt.calls.rect.length, 3, "tint adds a dark base under the wash");
  assert.ok(gt.calls.rect[1].opacity > g.calls.rect[0].opacity, "hover lifts the wash");

  const t = mockDrawK();
  const tabs = drawTabs(t.k, { rect: [0, 0, 300, 36], tabs: [["a", "Team"], ["b", "Chains"], ["c", "Items"]], active: "b" });
  assert.equal(tabs.length, 3, "returns one hit rect per tab");
  assert.equal(t.calls.text.length, 3, "one label per tab");
  const under = t.calls.rect.filter((r) => r.height === 3);
  assert.equal(under.length, 1, "exactly one ember underline (the active tab)");
  assert.ok(under[0].pos.x >= 100 && under[0].pos.x + under[0].width <= 200, "underline sits under the active (middle) tab");

  const c = mockDrawK();
  drawCard(c.k, { rect: [0, 0, 150, 120], accent: [100, 150, 200] });
  assert.equal(c.calls.rect.length, 4, "well + wash + accent glow + hairline");
  const cs = mockDrawK();
  drawCard(cs.k, { rect: [0, 0, 150, 120], accent: [100, 150, 200], selected: true });
  assert.deepEqual(cs.calls.rect[3].outline.color, THEME.primary, "selected card gets the ember frame");

  const sw = mockDrawK();
  const trackOn = drawSwitch(sw.k, { rect: [0, 0, 120, 40], on: true });
  const swOff = mockDrawK();
  const trackOff = drawSwitch(swOff.k, { rect: [0, 0, 120, 40], on: false });
  assert.deepEqual(trackOn, trackOff, "the track rect doesn't depend on state");
  assert.ok(sw.calls.circle.at(-1).pos.x > swOff.calls.circle.at(-1).pos.x, "the knob slides right when on");

  const ch = mockDrawK();
  const r = drawChip(ch.k, { x: 10, y: 10, text: "T3" });
  assert.ok(r[2] > 14 && ch.calls.text.length === 1, "chip sizes to its label");

  const e = mockDrawK();
  const w = drawEyebrow(e.k, { x: 0, y: 0, text: "Team", size: 11 });
  assert.equal(e.calls.text.length, 4, "one glyph draw per character (letter-spaced)");
  assert.equal(e.calls.text[0].text, "T", "upper-cased");
  assert.ok(w > 0 && e.calls.text[3].pos.x > e.calls.text[0].pos.x, "advances left to right");
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

test("drawPanel: glass = shadow + tint + wash + hairline + catch-light by default; flags drop layers; accent border replaces the hairline", () => {
  const a = mockDrawK();
  drawPanel(a.k, { rect: [0, 0, 200, 60] });
  assert.equal(a.calls.rect.length, 5, "1 flat shadow (small panel) + dark tint + white wash + outline-only hairline + catch-light");
  assert.ok(a.calls.rect[3].fill === false && a.calls.rect[3].opacity < 0.2, "hairline is an outline-only low-opacity white rect");
  const b = mockDrawK();
  drawPanel(b.k, { rect: [0, 0, 200, 60], shadow: false, sheen: false });
  assert.equal(b.calls.rect.length, 3, "tint + wash + hairline when shadow+sheen off");
  const c = mockDrawK();
  drawPanel(c.k, { rect: [0, 0, 200, 60], border: THEME.primary, shadow: false, sheen: false });
  assert.deepEqual(c.calls.rect[2].outline.color, THEME.primary, "a non-neutral border becomes the accent frame");
  assert.equal(c.calls.rect[2].opacity, 1, "accent frame is fully opaque");
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
  assert.equal(on.calls.rect.length, 5, "drawPanel pill = shadow + tint + wash + hairline + catch-light");
  assert.equal(on.calls.text.length, 1, "one label");
  assert.equal(on.calls.text[0].text, "Purchased!");
  const off = mockDrawK();
  drawToast(off.k, { text: "Purchased!", t: 0 });
  assert.equal(off.calls.rect.length + off.calls.text.length, 0, "no-op once the toast elapses");
  const blank = mockDrawK();
  drawToast(blank.k, { text: "", t: 1.5 });
  assert.equal(blank.calls.rect.length + blank.calls.text.length, 0, "no-op with empty text");
});

test("drawHeader: title label + single crisp teal rule; returns the y below the rule", () => {
  const { k, calls } = mockDrawK();
  const yBelow = drawHeader(k, { title: "SPIRIT SHOP", y: 18, size: 22 });
  assert.equal(calls.text.length, 1);
  assert.equal(calls.text[0].text, "SPIRIT SHOP");
  assert.equal(calls.rect.length, 1, "single crisp rule (TQ-202: dropped the faint glow backing rect)");
  assert.equal(yBelow, 18 + 22 + 4 + 6, "returns y just below the accent rule");
});
