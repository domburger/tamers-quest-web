// TQ-518: the first-run tutorial's step logic (pure; mirrors the TUT_STEPS table in onlineGame.js so a
// change to the cumulative-completion rule is caught here).
import { test } from "node:test";
import assert from "node:assert/strict";

const STEPS = [
  (f) => f.moved || f.fought || f.finished || f.extracted,
  (f) => f.fought || f.finished || f.extracted,
  (f) => f.finished || f.extracted,
  (f) => f.extracted,
];
const advance = (step, flags) => { while (step < STEPS.length && STEPS[step](flags)) step++; return step; };

test("tutorial steps advance one milestone at a time", () => {
  let s = 0;
  s = advance(s, { moved: true }); assert.equal(s, 1);
  s = advance(s, { moved: true, fought: true }); assert.equal(s, 2);
  s = advance(s, { moved: true, fought: true, finished: true }); assert.equal(s, 3);
  s = advance(s, { moved: true, fought: true, finished: true, extracted: true }); assert.equal(s, 4, "complete");
});

test("a later milestone completes the earlier steps (fight on spawn skips the move step)", () => {
  assert.equal(advance(0, { fought: true }), 2, "spawn-into-combat → straight to the fight step");
  assert.equal(advance(0, { finished: true }), 3);
  assert.equal(advance(1, { extracted: true }), 4);
});

test("no milestone → no progress", () => {
  assert.equal(advance(0, {}), 0);
  assert.equal(advance(2, { moved: true, fought: true }), 2);
});
