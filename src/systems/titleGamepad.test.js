import { test } from "node:test";
import assert from "node:assert/strict";
import { initTitleGamepad } from "./titleGamepad.js";

const UP = 12, DOWN = 13, A = 0, B = 1;
const pressed = (...i) => new Set(i);

// Minimal DOM doubles — enough surface for titleGamepad's glue (querySelectorAll("button"), offsetParent,
// disabled, click/focus, style, and the .guest-modal.show / [id$="-cancel"] queries).
function btn(id, { disabled = false, visible = true } = {}) {
  return { id, disabled, offsetParent: visible ? {} : null, clicks: 0, style: {}, click() { this.clicks++; }, focus() {} };
}
function rootOf(buttons) {
  return {
    querySelectorAll: () => buttons.slice(),
    querySelector: (sel) => (/cancel/.test(sel) ? buttons.find((b) => /-cancel$/.test(b.id)) || null : null),
  };
}
function mkDoc({ hidden = false, titleButtons = [], modalButtons = null } = {}) {
  const title = Object.assign(rootOf(titleButtons), { id: "title", classList: { contains: (c) => c === "hidden" && hidden } });
  const modal = modalButtons ? rootOf(modalButtons) : null;
  return {
    defaultView: null, // skip getComputedStyle in titleVisible()
    getElementById: (id) => (id === "title" ? title : null),
    querySelector: (sel) => (sel === ".guest-modal.show" ? modal : null),
  };
}
const mk = (doc, pad) => initTitleGamepad({ doc, isConnected: () => true, readPressed: () => pad.set, schedule: null, cancel: null });

test("TQ-525 titleGamepad: d-pad moves focus; A clicks the FOCUSED button", () => {
  const b0 = btn("guestBtn"), b1 = btn("enterBtn");
  const pad = { set: pressed() };
  const gp = mk(mkDoc({ titleButtons: [b0, b1] }), pad);
  gp.step();                              // focus defaults to the first button
  pad.set = pressed(DOWN); gp.step();     // → second
  pad.set = pressed(A); gp.step();        // activate
  assert.equal(b1.clicks, 1, "A clicked the focused (second) button");
  assert.equal(b0.clicks, 0);
});

test("TQ-525 titleGamepad: inert when no pad is connected OR the title is hidden", () => {
  const b = btn("guestBtn");
  initTitleGamepad({ doc: mkDoc({ titleButtons: [b] }), isConnected: () => false, readPressed: () => pressed(A), schedule: null, cancel: null }).step();
  assert.equal(b.clicks, 0, "no pad → nothing happens");
  const b2 = btn("guestBtn");
  mk(mkDoc({ titleButtons: [b2], hidden: true }), { set: pressed(A) }).step();
  assert.equal(b2.clicks, 0, "title hidden (launched) → nothing happens");
});

test("TQ-525 titleGamepad: an open modal captures focus; B clicks its cancel", () => {
  const behind = btn("guestBtn");                 // title button sitting behind the overlay
  const go = btn("guest-go"), cancel = btn("guest-cancel");
  const pad = { set: pressed(A) };
  const gp = mk(mkDoc({ titleButtons: [behind], modalButtons: [go, cancel] }), pad);
  gp.step();                                       // focus the modal's first button; A activates it
  assert.equal(go.clicks, 1, "A activated the modal button, not the title's");
  assert.equal(behind.clicks, 0, "the button behind the modal is unreachable");
  pad.set = pressed(B); gp.step();
  assert.equal(cancel.clicks, 1, "B clicked the modal's cancel");
});

test("TQ-525 titleGamepad: skips disabled and hidden buttons", () => {
  const dis = btn("a", { disabled: true }), hid = btn("b", { visible: false }), ok = btn("c");
  const gp = mk(mkDoc({ titleButtons: [dis, hid, ok] }), { set: pressed(A) });
  gp.step();
  assert.equal(ok.clicks, 1, "focus + A landed on the only enabled, visible button");
  assert.equal(dis.clicks, 0);
  assert.equal(hid.clicks, 0);
});
