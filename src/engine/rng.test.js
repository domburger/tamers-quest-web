import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRng, hashString, randomSeed } from "./rng.js";

test("same numeric seed produces identical sequences", () => {
  const a = makeRng(42);
  const b = makeRng(42);
  const seqA = [a.next(), a.next(), a.next(), a.next()];
  const seqB = [b.next(), b.next(), b.next(), b.next()];
  assert.deepEqual(seqA, seqB);
});

test("different seeds diverge", () => {
  const a = makeRng(1);
  const b = makeRng(2);
  assert.notEqual(a.next(), b.next());
});

test("string seed is deterministic and equals its hash", () => {
  const a = makeRng("Flamepaw Lynx");
  const b = makeRng(hashString("Flamepaw Lynx"));
  assert.equal(a.seed, b.seed);
  assert.equal(a.next(), b.next());
});

test("int() is inclusive and in range", () => {
  const r = makeRng(7);
  for (let i = 0; i < 1000; i++) {
    const v = r.int(3, 5);
    assert.ok(v >= 3 && v <= 5, `int out of range: ${v}`);
    assert.equal(v, Math.floor(v));
  }
});

test("range(n) is [0, n)", () => {
  const r = makeRng(9);
  for (let i = 0; i < 1000; i++) {
    const v = r.range(4);
    assert.ok(v >= 0 && v < 4, `range out of bounds: ${v}`);
  }
});

test("next() stays within [0, 1)", () => {
  const r = makeRng(123);
  for (let i = 0; i < 1000; i++) {
    const v = r.next();
    assert.ok(v >= 0 && v < 1);
  }
});

test("randomSeed returns a uint32", () => {
  const s = randomSeed();
  assert.ok(Number.isInteger(s) && s >= 0 && s <= 0xffffffff);
});
