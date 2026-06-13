import { test } from "node:test";
import assert from "node:assert/strict";
import { handleAuthHttp } from "./auth.js";
import { createAccountRecord, issuePasswordReset, consumePasswordReset } from "./store.js";
import { hashPassword, verifyPassword } from "./accounts.js";

// Minimal HTTP mocks (mirror auth.test.js): a JSON POST + a capturing response.
function mockRes() {
  const out = { status: 0, headers: {}, body: "" };
  return { out, setHeader(k, v) { out.headers[k] = v; }, writeHead(s, h) { out.status = s; Object.assign(out.headers, h || {}); }, end(b) { out.body = b || ""; } };
}
function mockPost(url, bodyObj, ip = "9.9.9.9") {
  const handlers = {};
  const headers = { host: "x", "x-forwarded-for": ip };
  const req = { url, method: "POST", headers, socket: {}, on(ev, cb) { handlers[ev] = cb; return req; } };
  queueMicrotask(() => { handlers.data && handlers.data(JSON.stringify(bodyObj)); handlers.end && handlers.end(); });
  return req;
}
const STRONG = "Str0ng-Passw0rd!"; // assumed to satisfy validatePassword
const NEWPW = "N3w-Passw0rd!Ok";

// ── Token store (TQ-59): issue / verify / single-use / expiry ──
test("TQ-59 token: issue → consume returns the account, single-use", () => {
  const acc = createAccountRecord({ email: "pr-store-1@x.io", passwordHash: hashPassword(STRONG), nickname: "S1" });
  const token = issuePasswordReset(acc);
  assert.ok(token && token.startsWith("pr_"), "issues a raw pr_ token");
  assert.equal(consumePasswordReset(token)?.id, acc.id, "consume returns the right account");
  assert.equal(consumePasswordReset(token), null, "single-use — can't be reused");
});

test("TQ-59 token: unknown + expired tokens return null (and an expired token is burned)", () => {
  assert.equal(consumePasswordReset("pr_nope"), null, "unknown → null");
  assert.equal(consumePasswordReset(null), null, "missing → null");
  const acc = createAccountRecord({ email: "pr-store-2@x.io", passwordHash: hashPassword(STRONG), nickname: "S2" });
  const t0 = 1_000_000;
  const token = issuePasswordReset(acc, t0);
  assert.equal(consumePasswordReset(token, t0 + 31 * 60 * 1000), null, "expired (TTL 30m) → null");
  assert.equal(consumePasswordReset(token, t0), null, "the expired token was also consumed/burned");
});

// ── Endpoints (TQ-59) ──
test("TQ-59 /auth/forgot-password: known + unknown email reply IDENTICALLY (no enumeration)", async () => {
  createAccountRecord({ email: "pr-known@x.io", passwordHash: hashPassword(STRONG), nickname: "K" });
  const r1 = mockRes(); await handleAuthHttp(mockPost("/auth/forgot-password", { email: "pr-known@x.io" }, "1.1.1.1"), r1);
  const r2 = mockRes(); await handleAuthHttp(mockPost("/auth/forgot-password", { email: "pr-nobody@x.io" }, "1.1.1.2"), r2);
  assert.equal(r1.out.status, 200); assert.equal(r2.out.status, 200);
  assert.deepEqual(JSON.parse(r1.out.body), { ok: true });
  assert.deepEqual(JSON.parse(r2.out.body), JSON.parse(r1.out.body), "identical response → can't enumerate accounts");
});

test("TQ-59 /auth/reset-password: a valid token sets the new password and is single-use", async () => {
  const acc = createAccountRecord({ email: "pr-reset@x.io", passwordHash: hashPassword(STRONG), nickname: "R" });
  const token = issuePasswordReset(acc);
  const r = mockRes(); await handleAuthHttp(mockPost("/auth/reset-password", { token, password: NEWPW }, "2.2.2.1"), r);
  assert.equal(r.out.status, 200); assert.deepEqual(JSON.parse(r.out.body), { ok: true });
  assert.ok(verifyPassword(NEWPW, acc.passwordHash), "new password is set");
  assert.ok(!verifyPassword(STRONG, acc.passwordHash), "old password no longer works");
  const r2 = mockRes(); await handleAuthHttp(mockPost("/auth/reset-password", { token, password: "Another-0ne!" }, "2.2.2.2"), r2);
  assert.equal(r2.out.status, 400, "the consumed token is rejected on reuse");
});

test("TQ-59 /auth/reset-password: a weak new password is rejected WITHOUT burning the token", async () => {
  const acc = createAccountRecord({ email: "pr-weak@x.io", passwordHash: hashPassword(STRONG), nickname: "W" });
  const token = issuePasswordReset(acc);
  const r = mockRes(); await handleAuthHttp(mockPost("/auth/reset-password", { token, password: "weak" }, "3.3.3.1"), r);
  assert.equal(r.out.status, 400, "weak password rejected");
  const r2 = mockRes(); await handleAuthHttp(mockPost("/auth/reset-password", { token, password: NEWPW }, "3.3.3.2"), r2);
  assert.equal(r2.out.status, 200, "token still valid after the rejected weak attempt (validated before consume)");
});
