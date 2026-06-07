// AUTH-T3: unit coverage for the password/validation core (server/accounts.js).

import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, normalizeEmail, validateEmail, validatePassword } from "./accounts.js";

test("hashPassword + verifyPassword round-trip; wrong password rejected", () => {
  const stored = hashPassword("correct horse battery staple");
  assert.match(stored, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.equal(verifyPassword("correct horse battery staple", stored), true);
  assert.equal(verifyPassword("wrong password", stored), false);
});

test("hashPassword is salted (same password → different hashes)", () => {
  assert.notEqual(hashPassword("samePw12345"), hashPassword("samePw12345"));
});

test("verifyPassword never throws on a malformed/empty stored hash", () => {
  for (const bad of [null, undefined, 42, "", "plain", "scrypt$only", "scrypt$zz$zz", "md5$a$b"]) {
    assert.equal(verifyPassword("x", bad), false, `${JSON.stringify(bad)} → false`);
  }
});

test("normalizeEmail trims + lowercases", () => {
  assert.equal(normalizeEmail("  Ada@Example.COM "), "ada@example.com");
  assert.equal(normalizeEmail(null), "");
});

test("validateEmail accepts plausible addresses, rejects junk", () => {
  for (const ok of ["a@b.com", "x.y+z@sub.domain.io", "  Cap@D.com "]) assert.equal(validateEmail(ok), true, ok);
  for (const bad of ["", "no-at", "a@b", "a b@c.com", "a@@b.com", "a@b.", "@b.com"]) assert.equal(validateEmail(bad), false, bad);
});

test("validatePassword enforces 8–200 chars", () => {
  assert.equal(validatePassword("abcdefgh").ok, true);
  assert.equal(validatePassword("short").ok, false);
  assert.equal(validatePassword("x".repeat(201)).ok, false);
  assert.equal(validatePassword(undefined).ok, false);
  assert.ok(validatePassword("short").reason.length > 0);
});
