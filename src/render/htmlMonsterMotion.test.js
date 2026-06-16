import { test } from "node:test";
import assert from "node:assert/strict";
import { MOTION_CSS, MOTION_WRAP_CLASS, wrapCreatureHtml, ensureMonsterMotionStyle } from "./htmlMonsterMotion.js";

test("TQ-386: wrapCreatureHtml nests the creature in the engine motion wrapper", () => {
  assert.equal(wrapCreatureHtml("<div>x</div>"), `<div class="${MOTION_WRAP_CLASS}"><div>x</div></div>`);
  assert.equal(wrapCreatureHtml(null), `<div class="${MOTION_WRAP_CLASS}"></div>`); // null → empty wrapper, never "null"
  assert.equal(wrapCreatureHtml(undefined), `<div class="${MOTION_WRAP_CLASS}"></div>`);
});

test("TQ-386: MOTION_CSS drives the wrapper from the action classes (walk loops, attack one-shot)", () => {
  // Default motion is keyed on the engine's .tq-moving / .tq-attacking classes (TQ-310) → wrapper.
  assert.match(MOTION_CSS, new RegExp(`\\.tq-moving>\\.${MOTION_WRAP_CLASS}\\{animation:tqMonWalk`));
  assert.match(MOTION_CSS, new RegExp(`\\.tq-attacking>\\.${MOTION_WRAP_CLASS}\\{animation:tqMonLunge`));
  assert.match(MOTION_CSS, /@keyframes tqMonWalk\{/);
  assert.match(MOTION_CSS, /@keyframes tqMonLunge\{/);
  assert.match(MOTION_CSS, /infinite/);                 // walk loops
  assert.ok(!/tqMonLunge[^}]*infinite/.test(MOTION_CSS), "attack lunge is a one-shot, not looping");
  assert.match(MOTION_CSS, /prefers-reduced-motion:reduce/); // a11y: action motion off under reduced-motion
});

test("TQ-386: ensureMonsterMotionStyle injects once (idempotent) and no-ops without a document", () => {
  // Minimal fake document: getElementById/createElement/head.appendChild.
  const created = [];
  const head = { children: [], appendChild(el) { this.children.push(el); } };
  const doc = {
    head,
    getElementById: (id) => head.children.find((c) => c.id === id) || null,
    createElement: (tag) => { const el = { tag, id: "", textContent: "" }; created.push(el); return el; },
  };
  const a = ensureMonsterMotionStyle(doc);
  assert.ok(a && a.id === "tq-mon-motion", "injects a <style> with the marker id");
  assert.ok(a.textContent.includes("tqMonWalk"), "carries the motion CSS");
  assert.equal(head.children.length, 1);
  const b = ensureMonsterMotionStyle(doc);
  assert.equal(b, a, "second call returns the SAME node — no duplicate injection");
  assert.equal(head.children.length, 1, "still exactly one style element");
  assert.equal(ensureMonsterMotionStyle(null), null, "no document → null, never throws");
  assert.equal(ensureMonsterMotionStyle({}), null, "doc without DOM methods → null");
});
