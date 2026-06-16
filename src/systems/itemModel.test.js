import test from "node:test";
import assert from "node:assert/strict";
import { itemHtmlBrief } from "./itemModel.js";
import { HTML_ALLOWED_TAGS, HTML_FORBIDDEN, HTML_CANVAS } from "./htmlModel.js";

// TQ-393: the item builder authors a free-form HTML/CSS icon (parity with monsters). The legacy
// shape-layer `visual` builder (coerceItemVisual + the disc/ring/… schema) was removed with the
// back-compat path, so the contract is now just the render-target brief the model targets.

test("itemHtmlBrief: targets a transparent, centered HTML/CSS icon on the canonical canvas", () => {
  const b = itemHtmlBrief();
  assert.ok(b.includes(String(HTML_CANVAS)), "brief states the canonical render-box size");
  assert.ok(/ICON/i.test(b), "brief frames the output as an icon");
  assert.ok(/TRANSPARENT/i.test(b), "icon root must be transparent (drops onto any slot)");
  assert.ok(/HTML\+CSS|HTML\/CSS/i.test(b), "brief asks for an HTML+CSS fragment");
});

test("itemHtmlBrief: re-asserts the shared allow-list + forbidden set (sanitizer parity)", () => {
  const b = itemHtmlBrief();
  for (const t of HTML_ALLOWED_TAGS) assert.ok(b.includes(t), `brief lists allowed tag ${t}`);
  for (const t of HTML_FORBIDDEN) assert.ok(b.includes(t), `brief warns against forbidden ${t}`);
});
