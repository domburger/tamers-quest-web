import { test } from "node:test";
import assert from "node:assert/strict";
import { tileHtmlBrief, TILE_CANVAS } from "./tileModel.js";
import { HTML_ALLOWED_TAGS, HTML_FORBIDDEN, HTML_CANVAS } from "./htmlModel.js";

// TQ-393: the tile builder authors a free-form HTML/CSS ground texture (parity with monsters + items).
// The legacy shape-layer `visual` builder (coerceTileVisual + the gradient/speckle/… schema) was removed
// with the back-compat path; generated tiles render only from `html`, seed tiles keep procedural grain.

test("tileHtmlBrief: targets a FULL-BLEED HTML/CSS ground texture on the canonical canvas", () => {
  const b = tileHtmlBrief();
  assert.ok(b.includes(String(HTML_CANVAS)), "brief states the canonical render-box size");
  assert.ok(/FILL|full-bleed|whole cell/i.test(b), "tile must fill the whole cell (not a transparent icon)");
  assert.ok(/HTML\+CSS|HTML\/CSS/i.test(b), "brief asks for an HTML+CSS fragment");
  assert.ok(/TILES?\b/i.test(b), "brief steers toward a repeatable ground texture");
});

test("tileHtmlBrief: re-asserts the shared allow-list + forbidden set (sanitizer parity)", () => {
  const b = tileHtmlBrief();
  for (const t of HTML_ALLOWED_TAGS) assert.ok(b.includes(t), `brief lists allowed tag ${t}`);
  for (const t of HTML_FORBIDDEN) assert.ok(b.includes(t), `brief warns against forbidden ${t}`);
});

test("TILE_CANVAS stays the baked texture size", () => {
  assert.equal(TILE_CANVAS, 64);
});
