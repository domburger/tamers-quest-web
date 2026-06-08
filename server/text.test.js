import { test } from "node:test";
import assert from "node:assert/strict";
import { clampText } from "./text.js";

// clampText trims AI combat narrative + generated monster lore/effects to a length
// budget on a CLEAN boundary (sentence end, else last word + "...") — never a
// mid-word chop, ASCII-only. Pure + dependency-free, but was untested.

test("clampText: short input is returned trimmed, unchanged", () => {
  assert.equal(clampText("hello", 240), "hello");
  assert.equal(clampText("  hello  ", 240), "hello");
  assert.equal(clampText("", 240), "");
});

test("clampText: nullish / non-string → a safe string (never throws)", () => {
  assert.equal(clampText(null), "");
  assert.equal(clampText(undefined), "");
  assert.equal(clampText(123, 240), "123");
});

test("clampText: cuts at a sentence end when one lands in the back of the window (no ellipsis)", () => {
  // max=20: the "." after "friend" sits at index 15 (>= max*0.6=12) → cut there, complete thought
  assert.equal(clampText("Hi there friend. More text after the cut point here.", 20), "Hi there friend.");
});

test("clampText: else backs off to the last WORD boundary + ASCII '...' (no mid-word chop)", () => {
  const out = clampText("the quick brown fox jumps over the lazy dog", 20);
  assert.equal(out, "the quick brown fox...");
  assert.ok(out.endsWith("..."), "appends an ASCII ellipsis to signal truncation");
  assert.ok(!out.includes("…"), "never the unicode ellipsis (decorative-glyph UI rule)");
  // the body before '...' ends on a whole word
  assert.ok(/\bfox$/.test(out.slice(0, -3)));
});

test("clampText: trailing punctuation/space is stripped before the '...'", () => {
  // "ends here ," → the comma+space at the cut are stripped so it's not "word ,..."
  const out = clampText("a moderately long phrase, that keeps going well past", 22);
  assert.ok(out.endsWith("..."));
  assert.ok(!/[\s,;:]\.\.\.$/.test(out), "no stray separator immediately before the ellipsis");
});

test("clampText: respects the default 240 budget", () => {
  const long = "word ".repeat(80).trim(); // ~399 chars, all word boundaries
  const out = clampText(long);
  assert.ok(out.length <= 243, "<= 240 body + 3 for the ellipsis");
  assert.ok(out.endsWith("...") || /[.!?]$/.test(out));
});
