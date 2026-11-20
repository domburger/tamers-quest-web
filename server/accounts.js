import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEYLEN = 64;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

// Constant-time; must return false (never throw) on a malformed stored hash.
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

export function normalizeEmail(email) {
  return String(email == null ? "" : email).trim().toLowerCase();
}

export function validateEmail(email) {
  const e = normalizeEmail(email);
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

export function validatePassword(password) {
  if (typeof password !== "string") return { ok: false, reason: "Password is required." };
  if (password.length < 8) return { ok: false, reason: "Password must be at least 8 characters." };
  if (password.length > 200) return { ok: false, reason: "Password is too long." };
  return { ok: true };
}
