import { test } from "node:test";
import assert from "node:assert/strict";
import { handleAuthHttp } from "./auth.js";
import { createAccountRecord, issueEmailVerification, consumeEmailVerification, getAccountById } from "./store.js";
import { hashPassword } from "./accounts.js";

function mockRes() {
  const out = { status: 0, headers: {}, body: "" };
  return { out, setHeader(k, v) { out.headers[k] = v; }, writeHead(s, h) { out.status = s; Object.assign(out.headers, h || {}); }, end(b) { out.body = b || ""; } };
}
const mockGet = (url) => ({ url, method: "GET", headers: { host: "x" }, socket: {}, on() { return this; } });
function mockPost(url, bodyObj, ip = "8.8.8.8") {
  const handlers = {};
  const req = { url, method: "POST", headers: { host: "x", "x-forwarded-for": ip }, socket: {}, on(ev, cb) { handlers[ev] = cb; return req; } };
  queueMicrotask(() => { handlers.data && handlers.data(JSON.stringify(bodyObj)); handlers.end && handlers.end(); });
  return req;
}
const STRONG = "Str0ng-Passw0rd!";

test("TQ-60 model: native signup is unverified; an OAuth account is provider-verified", () => {
  const native = createAccountRecord({ email: "ev-native@x.io", passwordHash: hashPassword(STRONG), nickname: "N" });
  assert.equal(native.emailVerified, false, "native account starts unverified");
  const oauth = createAccountRecord({ googleId: "g-ev-1", email: "ev-oauth@x.io", nickname: "O" });
  assert.equal(oauth.emailVerified, true, "an OAuth email is provider-verified");
});

test("TQ-60 token: issue → consume returns the account (single-use); unknown/expired → null", () => {
  const acc = createAccountRecord({ email: "ev-tok@x.io", passwordHash: hashPassword(STRONG), nickname: "T" });
  const token = issueEmailVerification(acc);
  assert.ok(token && token.startsWith("ev_"), "issues an ev_ token");
  assert.equal(consumeEmailVerification(token)?.id, acc.id, "consume returns the right account");
  assert.equal(consumeEmailVerification(token), null, "single-use");
  assert.equal(consumeEmailVerification("ev_nope"), null, "unknown → null");
  const acc2 = createAccountRecord({ email: "ev-tok2@x.io", passwordHash: hashPassword(STRONG), nickname: "T2" });
  const t0 = 5_000_000, tk = issueEmailVerification(acc2, t0);
  assert.equal(consumeEmailVerification(tk, t0 + 25 * 60 * 60 * 1000), null, "expired (24h TTL) → null");
});

test("TQ-60 GET /auth/verify-email: a valid token marks the account verified + redirects ?verified=1", async () => {
  const acc = createAccountRecord({ email: "ev-verify@x.io", passwordHash: hashPassword(STRONG), nickname: "V" });
  assert.equal(acc.emailVerified, false);
  const token = issueEmailVerification(acc);
  const r = mockRes(); await handleAuthHttp(mockGet(`/auth/verify-email?token=${token}`), r);
  assert.equal(r.out.status, 302); assert.equal(r.out.headers.Location, "/?verified=1");
  assert.equal(getAccountById(acc.id).emailVerified, true, "the account is now verified");
  const r2 = mockRes(); await handleAuthHttp(mockGet(`/auth/verify-email?token=${token}`), r2);
  assert.equal(r2.out.headers.Location, "/?verified=0", "a reused/invalid token → verified=0 (no crash)");
});

test("TQ-60 POST /auth/resend-verification: known + unknown email reply IDENTICALLY (no enumeration)", async () => {
  createAccountRecord({ email: "ev-resend@x.io", passwordHash: hashPassword(STRONG), nickname: "R" });
  const r1 = mockRes(); await handleAuthHttp(mockPost("/auth/resend-verification", { email: "ev-resend@x.io" }, "7.7.7.1"), r1);
  const r2 = mockRes(); await handleAuthHttp(mockPost("/auth/resend-verification", { email: "ev-none@x.io" }, "7.7.7.2"), r2);
  assert.equal(r1.out.status, 200); assert.equal(r2.out.status, 200);
  assert.deepEqual(JSON.parse(r1.out.body), { ok: true });
  assert.deepEqual(JSON.parse(r2.out.body), JSON.parse(r1.out.body), "identical → can't enumerate accounts");
});
