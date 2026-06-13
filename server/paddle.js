// Paddle payment webhook (TQ-68): credits premium currency (Essence) to a player's profile
// after a SIGNATURE-VERIFIED purchase. Security rules, in order:
//   1. Verify the Paddle-Signature HMAC before trusting ANY of the body (reject otherwise).
//   2. NEVER trust the amount from the payload — resolve it by price ID in paddleProducts.js.
//   3. Idempotent on the Paddle transaction id (webhooks retry; never double-credit).
// The notification destination's signing secret lives in env as PADDLE_WEBHOOK_SECRET (provisioned
// in TQ-95). Without it we cannot verify, so we refuse (503) rather than credit blindly.
import crypto from "node:crypto";
import { getByToken, saveProfile } from "./store.js";
import { grantEssence } from "../src/engine/schemas.js";
import { premiumForPrice } from "./paddleProducts.js";

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

// HTTP entry — owns POST /api/paddle/webhook. Returns true if it handled the request (so the
// index.js dispatch chain stops), false to let other handlers run.
export async function handlePaddleHttp(req, res) {
  const path = (req.url || "").split("?")[0];
  // Public checkout config — ONLY non-secret values (never PADDLE_KEY, the server API key). The
  // browser uses clientToken to open a Paddle.js checkout; packs give it the price IDs. Inert
  // (clientToken: null) until PADDLE_CLIENT_TOKEN is provisioned, so the buy buttons stay disabled.
  if (req.method === "GET" && path === "/api/paddle/config") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({
      clientToken: process.env.PADDLE_CLIENT_TOKEN || null,
      environment: process.env.PADDLE_ENV || "production",
      packs: PADDLE_PACKS.map((p) => ({ pack: p.pack, premium: p.premium, usd: p.usd, priceId: p.priceId })),
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
    const credit = essenceFromEvent(event);
    if (credit && credit.token && credit.amount > 0) {
      const profile = getByToken(credit.token);
      if (profile && creditTransaction(profile, credit.txId, credit.amount)) {
        saveProfile(profile);
        console.log(`[paddle] credited ${credit.amount} essence to ${credit.token.slice(0, 8)}… (txn ${credit.txId})`);
      }
    }
  } catch (e) { console.error("[paddle] webhook processing error", e); }
  // Always 200 once the signature is verified — Paddle only needs acknowledgement, and a
  // processing miss (e.g. an unresolvable token) won't fix itself on a retry, so don't ask for one.
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ received: true }));
  return true;
}
