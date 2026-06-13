import { test } from "node:test";
import assert from "node:assert/strict";
import { stationPopupRect, stationContentRect, stationCloseRect, stationPopupInside } from "./stationPopup.js";
import { bestiaryPanelState, bestiaryPanelScroll } from "./bestiaryPanel.js";

// TQ-118: the shell geometry is pure (only reads k.width()/height()), so it's unit-testable.
const mk = (w, h) => ({ width: () => w, height: () => h });

test("stationPopupRect: centred + responsive; content + close-button inside the panel; hit-test", () => {
  const k = mk(1280, 720);
  const r = stationPopupRect(k);
  assert.ok(r.PW > 0 && r.PH > 0);
  assert.equal(Math.round(r.px + r.PW / 2), 640, "horizontally centred");
  assert.equal(Math.round(r.py + r.PH / 2), 360, "vertically centred");
  const [cx, cy, cw, ch] = stationContentRect(k);
  assert.ok(cx >= r.px && cy >= r.py && cx + cw <= r.px + r.PW && cy + ch <= r.py + r.PH, "content rect sits inside the panel");
  const [bx, by] = stationCloseRect(k);
  assert.ok(stationPopupInside(k, { x: bx + 1, y: by + 1 }), "close button is inside the panel");
  assert.equal(stationPopupInside(k, { x: 2, y: 2 }), false, "a screen corner is outside the panel");
  const n = stationPopupRect(mk(390, 780));
  assert.ok(n.narrow && n.PW >= 390 - 24, "narrow/portrait → near-full width");
});

test("bestiaryPanelScroll clamps to [0, maxScroll]", () => {
  const s = bestiaryPanelState(); s._maxScroll = 200;
  bestiaryPanelScroll(s, -50); assert.equal(s.scrollY, 0, "can't scroll above the top");
  bestiaryPanelScroll(s, 300); assert.equal(s.scrollY, 200, "clamps to maxScroll");
  bestiaryPanelScroll(s, -80); assert.equal(s.scrollY, 120, "scrolls back within range");
});
