// Native "Tamer's Account" — email + password auth (AUTH-T3). First-party accounts
// so players don't need a third party; no external credentials, fully testable. This
// module is the pure security core: password hashing (scrypt, salted, timing-safe
// verify) + email/password validation. The signup/login HTTP routes live in auth.js
// (`/auth/signup`, `/auth/login`) and use these + the store. No new dependencies.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// scrypt with node's defaults (N=16384, r=8, p=1) — a deliberately slow KDF. Format
// is self-describing so params can evolve: "scrypt$<saltHex>$<hashHex>".
const KEYLEN = 64;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

// Constant-time verify. Returns false (never throws) on a malformed/empty stored hash
// so a corrupt record can't crash login or be bypassed.
export function verifyPassword(password, stored) {
  if (typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  try {
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    if (!salt.length || !expected.length) return false;
    const actual = scryptSync(String(password), salt, expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Email is the account key — normalize to a single canonical form (trim + lowercase).
export function normalizeEmail(email) {
  return String(email == null ? "" : email).trim().toLowerCase();
}

// Deliberately simple, permissive email shape check (one @, a dot in the domain, no
// spaces). Real deliverability is proven by the reset/verify flow, not a regex.
export function validateEmail(email) {
  const e = normalizeEmail(email);
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

// Password policy: 8–200 chars (upper bound bounds the scrypt work + storage). Returns
// { ok, reason } so the signup route can give a useful message.
export function validatePassword(password) {
  if (typeof password !== "string") return { ok: false, reason: "Password is required." };
  if (password.length < 8) return { ok: false, reason: "Password must be at least 8 characters." };
  if (password.length > 200) return { ok: false, reason: "Password is too long." };
  return { ok: true };
}
