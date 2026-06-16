import { test } from "node:test";
import assert from "node:assert/strict";
import { clampText, fillSlot } from "./text.js";

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

// fillSlot injects a slot value into an admin-overridable prompt template, robust to overrides
// that drop OR repeat the {placeholder}. Pure; the monster + item gen pipelines lean on it so a
// bad override never silently strips the model's required context.
test("fillSlot: replaces the placeholder when present", () => {
  assert.equal(fillSlot("Design a {kind} item.", "{kind}", "healing"), "Design a healing item.");
});

test("fillSlot: replaces EVERY occurrence, not just the first (no leaked literal token)", () => {
  // The bug: String.replace(stringKey, ...) replaces only the first match, so a template that
  // repeats {idea} would send a literal "{idea}" to the model on the 2nd+ occurrence.
  const out = fillSlot("A {idea} monster; lean into the {idea} theme.", "{idea}", "magma");
  assert.equal(out, "A magma monster; lean into the magma theme.");
  assert.ok(!out.includes("{idea}"), "no literal placeholder token leaks through");
});

test("fillSlot: a '$' in the value is inserted VERBATIM (not a replace special pattern)", () => {
  // $&, $`, $' , $$ are String.replace specials — the function replacement must keep them literal.
  assert.equal(fillSlot("cost: {p}", "{p}", "$5 ($$ each)"), "cost: $5 ($$ each)");
  assert.equal(fillSlot("{a} and {a}", "{a}", "$&"), "$& and $&");
});

test("fillSlot: a MISSING placeholder is left out — NO append-if-missing (a dropped slot is respected)", () => {
  // The prompt is literal: if an override drops the {placeholder}, the value is intentionally omitted
  // (it's "missing for a reason") — the prompt the operator sees is exactly what the model receives.
  assert.equal(fillSlot("Design a cave monster.", "{hints}", "Element: Fire"), "Design a cave monster.");
  assert.equal(fillSlot("Base prompt.", "{x}", "extra"), "Base prompt.");
});

test("fillSlot: missing placeholder (any value) → template unchanged", () => {
  assert.equal(fillSlot("Just the template.", "{x}", ""), "Just the template.");
  assert.equal(fillSlot("Just the template.", "{x}", null), "Just the template.");
  assert.equal(fillSlot("Just the template.", "{x}", "ignored"), "Just the template.");
});
