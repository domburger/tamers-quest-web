// Paddle payment webhook (TQ-68): credits premium currency (Essence) to a player's profile
// after a SIGNATURE-VERIFIED purchase. Security rules, in order:
//   1. Verify the Paddle-Signature HMAC before trusting ANY of the body (reject otherwise).
//   2. NEVER trust the amount from the payload — resolve it by price ID in paddleProducts.js.
//   3. Idempotent on the Paddle transaction id (webhooks retry; never double-credit).
// The notification destination's signing secret lives in env as PADDLE_WEBHOOK_SECRET (provisioned
// in TQ-95). Without it we cannot verify, so we refuse (503) rather than credit blindly.
import crypto from "node:crypto";
import { getByToken, saveProfile } from "./store.js";
import { grantEssence, grantAdFree, grantSubscription, clearSubscription, subscriptionActive } from "../src/engine/schemas.js";
import { PADDLE_PACKS, premiumForPrice, isAdFreePrice, adFreePriceId, PADDLE_ADFREE, isSubPrice } from "./paddleProducts.js";

const MAX_BODY = 256 * 1024;     // a webhook body is small; cap to guard memory
const SIG_TOLERANCE_S = 5 * 60;  // accept signatures within 5 min (clock skew + Paddle retries)
const TXN_HISTORY = 50;          // remember the last N credited txns per profile (idempotency)

// Parse a "ts=123;h1=abc" Paddle-Signature header into { ts, h1 }.
export function parsePaddleSignature(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// Verify Paddle's HMAC-SHA256 over `${ts}:${rawBody}` (timing-safe). Rejects a missing secret,
// a malformed header, or a stale/replayed timestamp outside the tolerance window.
export function verifyPaddleSignature(rawBody, header, secret, nowSec = Math.floor(Date.now() / 1000)) {
  if (!secret) return false;
  const { ts, h1 } = parsePaddleSignature(header);
  if (!ts || !h1 || !/^[0-9a-f]+$/i.test(h1)) return false;
  if (!Number.isFinite(Number(ts)) || Math.abs(nowSec - Number(ts)) > SIG_TOLERANCE_S) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${ts}:${rawBody}`).digest("hex");
  const a = Buffer.from(expected, "hex"), b = Buffer.from(String(h1), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Pure: from a parsed webhook event, resolve who to credit (the profile token we set as the
// checkout's custom_data) and how much (summed by price ID — never the payload amount). Returns
// null for any event that isn't a completed transaction we should act on.
export function essenceFromEvent(event) {
  if (!event || event.event_type !== "transaction.completed") return null;
  const d = event.data || {};
  const token = d.custom_data && d.custom_data.token ? String(d.custom_data.token) : null;
  let amount = 0;
  for (const it of d.items || []) {
    const priceId = it && it.price && it.price.id;
    const qty = Math.max(1, Number(it && it.quantity) || 1);
    amount += premiumForPrice(priceId) * qty;
  }
  return { txId: d.id || null, token, amount };
}

// TQ-174: from a completed-transaction event, detect the standalone remove-ads purchase and resolve
// the profile token to grant the PERMANENT ad-free entitlement. Returns null for any event that
// isn't a completed transaction containing the (env-configured) ad-free price — so it's inert until
// PADDLE_ADFREE_PRICE_ID is provisioned. Pure (no I/O), like essenceFromEvent.
export function adFreeFromEvent(event) {
  if (!event || event.event_type !== "transaction.completed") return null;
  const d = event.data || {};
  const token = d.custom_data && d.custom_data.token ? String(d.custom_data.token) : null;
  const hasAdFree = (d.items || []).some((it) => it && it.price && isAdFreePrice(it.price.id));
  return hasAdFree ? { txId: d.id || null, token } : null;
}

// TQ-269: from a Paddle subscription-lifecycle event, resolve the profile token + the entitlement
// change to apply. Mirrors adFreeFromEvent: it matches the (env-configured) sub price id, so it stays
// INERT until PADDLE_SUB_PRICE_ID is provisioned. Returns null for any non-subscription event, or one
// that doesn't carry the configured sub price (not our product / can't be spoofed). Pure (no I/O).
//   action 'set'   → grant/extend to `until` (epoch ms = current_billing_period.ends_at)
//   action 'clear' → cancel / paused / past_due / expired → drop the ongoing entitlement (TQ-76 lapse)
// `occurredAt` (epoch ms of the event) lets applySubscription order-guard out-of-order webhook retries.
export function subscriptionFromEvent(event) {
  if (!event || typeof event.event_type !== "string" || !event.event_type.startsWith("subscription.")) return null;
  const d = event.data || {};
  const matchesSub = (d.items || []).some((it) => it && it.price && isSubPrice(it.price.id));
  if (!matchesSub) return null;                                  // inert until the sub price id is configured
  const token = d.custom_data && d.custom_data.token ? String(d.custom_data.token) : null;
  const subId = d.id || null;
  const occurredAt = Date.parse(event.occurred_at) || 0;
  // Prefer the subscription's CURRENT status (so a `subscription.updated` carrying a cancellation
  // clears correctly); fall back to the event_type verb when status is absent.
  const status = String(d.status || "").toLowerCase();
  const verb = event.event_type.slice("subscription.".length).toLowerCase();
  const CLEAR = ["canceled", "cancelled", "paused", "past_due", "expired"];
  if (CLEAR.includes(status) || (!status && CLEAR.includes(verb))) {
    return { subId, token, action: "clear", until: 0, occurredAt };
  }
  const until = Date.parse(d.current_billing_period && d.current_billing_period.ends_at) || 0;
  return { subId, token, action: "set", until, occurredAt };
}

// TQ-269: apply a subscription entitlement change to a profile, idempotently + out-of-order safe.
// Mutates the profile (stamps subscribedUntil via grant/clear + records the last-applied event time)
// and returns true ONLY if it changed state this call (false on a retry / stale / reordered webhook).
// `subEventAt` is lazily added (like paddleTxns), so no profile-schema change is needed.
export function applySubscription(profile, change) {
  if (!profile || !change) return false;
  const last = Number(profile.subEventAt) || 0;
  const at = Number(change.occurredAt) || 0;
  if (at && at < last) return false;                             // older than the last applied event — ignore
  if (change.action === "set") {
    if (!(change.until > 0)) return false;                       // active but no period end → nothing to grant
    const before = Number(profile.subscribedUntil) || 0;
    grantSubscription(profile, change.until);                   // keeps the LATEST period end (out-of-order safe)
    profile.subEventAt = Math.max(last, at);
    return (Number(profile.subscribedUntil) || 0) !== before;
  }
  if (change.action === "clear") {
    const wasActive = subscriptionActive(profile, at || undefined);
    clearSubscription(profile);
    profile.subEventAt = Math.max(last, at);
    return wasActive;
  }
  return false;
}

// Idempotent credit: grant essence once per Paddle transaction id. Mutates the profile (records
// the txn + grants), returns true only if it actually credited this call (false on a retry / no-op).
export function creditTransaction(profile, txId, amount) {
  if (!profile || !txId || !(amount > 0)) return false;
  const seen = profile.paddleTxns || (profile.paddleTxns = []);
  if (seen.includes(txId)) return false;                       // already credited (a webhook retry)
  grantEssence(profile, amount);
  seen.push(txId);
  if (seen.length > TXN_HISTORY) seen.splice(0, seen.length - TXN_HISTORY); // bound the history
  return true;
}

function readRawBody(req, cap = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let data = "", over = false;
    req.on("data", (c) => { if (over) return; data += c; if (data.length > cap) { over = true; reject(new Error("body too large")); } });
    req.on("end", () => { if (!over) resolve(data); });
    req.on("error", reject);
  });
}

// TQ-194: defense-in-depth for the PUBLIC /api/paddle/config. A real misconfig (TQ-189) set
// PADDLE_CLIENT_TOKEN to the SECRET API key and the endpoint leaked it. Expose the configured value
// ONLY if it's a genuine browser client token — Paddle.js client tokens are `live_…`/`test_…`; API
// keys are `pdl_…` / contain "apikey". Refuse anything secret-shaped or that equals a known secret;
// pure (env read by the caller) so it's unit-testable. Returns the token, or null if it must be withheld.
export function publicClientTokenOrNull(token, { apiKey, webhookSecret } = {}) {
  if (!token || typeof token !== "string") return null;
  const lower = token.toLowerCase();
  const looksSecret = lower.startsWith("pdl_") || lower.includes("apikey")
    || (apiKey && token === apiKey) || (webhookSecret && token === webhookSecret);
  const looksClient = lower.startsWith("live_") || lower.startsWith("test_");
  return (looksSecret || !looksClient) ? null : token;
}

// HTTP entry — owns POST /api/paddle/webhook. Returns true if it handled the request (so the
// index.js dispatch chain stops), false to let other handlers run.
export async function handlePaddleHttp(req, res, world) {
  const path = (req.url || "").split("?")[0];
  // Public checkout config — ONLY non-secret values (never PADDLE_KEY, the server API key). The
  // browser uses clientToken to open a Paddle.js checkout; packs give it the price IDs. Inert
  // (clientToken: null) until PADDLE_CLIENT_TOKEN is provisioned, so the buy buttons stay disabled.
  if (req.method === "GET" && path === "/api/paddle/config") {
    // TQ-198: master kill-switch — real-money sales are OFF unless the admin toggle (world.cfg.salesEnabled) is on.
    const salesEnabled = !!(world && world.cfg && world.cfg.salesEnabled);
    // TQ-194: never serve a secret-shaped PADDLE_CLIENT_TOKEN publicly; expose the token ONLY when sales are ON.
    const clientToken = salesEnabled
      ? publicClientTokenOrNull(process.env.PADDLE_CLIENT_TOKEN, { apiKey: process.env.PADDLE_KEY, webhookSecret: process.env.PADDLE_WEBHOOK_SECRET })
      : null;
    if (salesEnabled && process.env.PADDLE_CLIENT_TOKEN && !clientToken) console.warn("[paddle] TQ-194: PADDLE_CLIENT_TOKEN is not a public client token (expected a live_/test_ prefix) — refusing to expose it on /api/paddle/config.");
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({
      clientToken,
      salesEnabled, // TQ-198: the client disables the buy buttons when this is false
      environment: process.env.PADDLE_ENV || "production",
      packs: PADDLE_PACKS.map((p) => ({ pack: p.pack, premium: p.premium, usd: p.usd, priceId: p.priceId })),
      // TQ-174: standalone remove-ads one-time purchase — present ONLY when sales are on AND the price
      // ID is provisioned (PADDLE_ADFREE_PRICE_ID), so the pricing page's card stays inert until live.
      adFree: (salesEnabled && adFreePriceId()) ? { priceId: adFreePriceId(), usd: PADDLE_ADFREE.usd } : null,
    }));
    return true;
  }
  if (req.method !== "POST" || path !== "/api/paddle/webhook") return false;
  let raw;
  try { raw = await readRawBody(req); }
  catch { res.writeHead(413, { "Content-Type": "text/plain" }); res.end("payload too large"); return true; }

  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) { res.writeHead(503, { "Content-Type": "text/plain" }); res.end("webhook not configured"); return true; }
  if (!verifyPaddleSignature(raw, req.headers["paddle-signature"], secret)) {
    res.writeHead(401, { "Content-Type": "text/plain" }); res.end("invalid signature"); return true;
  }
  let event;
  try { event = JSON.parse(raw); }
  catch { res.writeHead(400, { "Content-Type": "text/plain" }); res.end("bad json"); return true; }

  try {
    if (!(world && world.cfg && world.cfg.salesEnabled)) {
      // TQ-198: sales kill-switch is OFF — ack the (signature-verified) webhook but DON'T credit.
      console.warn("[paddle] TQ-198: real-money sales are OFF (admin kill-switch) — verified webhook received but NOT crediting.");
    } else {
      const credit = essenceFromEvent(event);
      if (credit && credit.token && credit.amount > 0) {
        const profile = getByToken(credit.token);
        if (profile && creditTransaction(profile, credit.txId, credit.amount)) {
          saveProfile(profile);
          console.log(`[paddle] credited ${credit.amount} essence to ${credit.token.slice(0, 8)}… (txn ${credit.txId})`);
        }
      }
      // TQ-174: standalone remove-ads purchase → grant the permanent ad-free entitlement (idempotent:
      // it's a flag, so a webhook retry is a no-op). A txn may contain both essence and ad-free items.
      const adfree = adFreeFromEvent(event);
      if (adfree && adfree.token) {
        const profile = getByToken(adfree.token);
        if (profile && !profile.adFree) {
          grantAdFree(profile);
          saveProfile(profile);
          console.log(`[paddle] granted ad-free to ${adfree.token.slice(0, 8)}… (txn ${adfree.txId})`);
        }
      }
      // TQ-269: recurring-subscription lifecycle → set/clear the server-authoritative entitlement
      // (profile.subscribedUntil, TQ-267). Idempotent + out-of-order safe (see applySubscription).
      // Inert until PADDLE_SUB_PRICE_ID is provisioned (subscriptionFromEvent returns null otherwise).
      const sub = subscriptionFromEvent(event);
      if (sub && sub.token) {
        const profile = getByToken(sub.token);
        if (profile && applySubscription(profile, sub)) {
          saveProfile(profile);
          console.log(`[paddle] subscription ${sub.action} for ${sub.token.slice(0, 8)}… (sub ${sub.subId}${sub.action === "set" ? `, until ${new Date(sub.until).toISOString()}` : ""})`);
        }
      }
    }
  } catch (e) { console.error("[paddle] webhook processing error", e); }
  // Always 200 once the signature is verified — Paddle only needs acknowledgement, and a
  // processing miss (e.g. an unresolvable token) won't fix itself on a retry, so don't ask for one.
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ received: true }));
  return true;
}
