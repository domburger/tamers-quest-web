import { test } from "node:test";
import assert from "node:assert/strict";
import { makeMenuNav } from "./menuNav.js";

const UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15, A = 0, B = 1;
const pad = (...idx) => new Set(idx);

test("TQ-525 menuNav: empty list is inert (no focus, nothing to activate)", () => {
  const nav = makeMenuNav();
  assert.equal(nav.count(), 0);
  assert.equal(nav.index(), -1);
  assert.equal(nav.focusId(), null);
  assert.equal(nav.activate(), false, "activate on empty is a no-op");
  assert.equal(nav.handleGamepad(pad(DOWN)), null, "gamepad on empty does nothing");
});

test("TQ-525 menuNav: setItems focuses the first item; index/focusId track it", () => {
  const nav = makeMenuNav();
  nav.setItems([{ id: "a" }, { id: "b" }, { id: "c" }]);
  assert.equal(nav.count(), 3);
  assert.equal(nav.index(), 0);
  assert.equal(nav.focusId(), "a");
});

test("TQ-525 menuNav: d-pad down/right advance, up/left retreat", () => {
  const nav = makeMenuNav();
  nav.setItems([{ id: "a" }, { id: "b" }, { id: "c" }]);
  assert.equal(nav.handleGamepad(pad(DOWN)), "move"); assert.equal(nav.focusId(), "b");
  assert.equal(nav.handleGamepad(pad(RIGHT)), "move"); assert.equal(nav.focusId(), "c");
  assert.equal(nav.handleGamepad(pad(UP)), "move"); assert.equal(nav.focusId(), "b");
  assert.equal(nav.handleGamepad(pad(LEFT)), "move"); assert.equal(nav.focusId(), "a");
});

test("TQ-525 menuNav: focus WRAPS past the ends by default", () => {
  const nav = makeMenuNav();
  nav.setItems([{ id: "a" }, { id: "b" }]);
  nav.handleGamepad(pad(UP));
  assert.equal(nav.focusId(), "b");
  nav.handleGamepad(pad(DOWN));
  assert.equal(nav.focusId(), "a");
});

test("TQ-525 menuNav: wrap:false clamps at the ends", () => {
  const nav = makeMenuNav({ wrap: false });
  nav.setItems([{ id: "a" }, { id: "b" }]);
  nav.move(-1); assert.equal(nav.focusId(), "a", "clamped at the top");
  nav.move(5); assert.equal(nav.focusId(), "b", "clamped at the bottom");
});

test("TQ-525 menuNav: A activates the FOCUSED item's handler; B calls back", () => {
  const nav = makeMenuNav();
  const fired = [];
  nav.setItems([
    { id: "a", onActivate: () => fired.push("a") },
    { id: "b", onActivate: () => fired.push("b") },
  ]);
  nav.setOnBack(() => fired.push("back"));
  nav.handleGamepad(pad(DOWN));
  assert.equal(nav.handleGamepad(pad(A)), "activate");
  assert.deepEqual(fired, ["b"], "activated the focused item, not the first");
  assert.equal(nav.handleGamepad(pad(B)), "back");
  assert.deepEqual(fired, ["b", "back"]);
});

test("TQ-525 menuNav: re-supplying items keeps focus on the SAME id (no cursor jump on redraw)", () => {
  const nav = makeMenuNav();
  nav.setItems([{ id: "a" }, { id: "b" }, { id: "c" }]);
  nav.handleGamepad(pad(DOWN));
  nav.setItems([{ id: "a" }, { id: "b" }, { id: "c" }]);
  assert.equal(nav.focusId(), "b", "focus stuck to its id across the re-supply");
  nav.setItems([{ id: "a" }, { id: "c" }]);
  assert.ok(["a", "c"].includes(nav.focusId()), "focus clamped to a valid item after removal");
});

test("TQ-525 menuNav: A on an item with no handler reports null (not a phantom activate)", () => {
  const nav = makeMenuNav();
  nav.setItems([{ id: "a" }]);
  assert.equal(nav.handleGamepad(pad(A)), null);
});
