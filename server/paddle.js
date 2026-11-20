// Verify signature before reading body; amount by price ID only; idempotent per txn.
import crypto from "node:crypto";
import { getByToken, saveProfile } from "./store.js";
import { grantEssence, grantAdFree, grantSubscription, clearSubscription, subscriptionActive } from "../src/engine/schemas.js";
import { PADDLE_PACKS, premiumForPrice, isAdFreePrice, adFreePriceId, PADDLE_ADFREE, isSubPrice, subPriceId, PADDLE_SUB } from "./paddleProducts.js";

const MAX_BODY = 256 * 1024;
const SIG_TOLERANCE_S = 5 * 60;
const TXN_HISTORY = 50;

export function parsePaddleSignature(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function verifyPaddleSignature(rawBody, header, secret, nowSec = Math.floor(Date.now() / 1000)) {
  if (!secret) return false;
  const { ts, h1 } = parsePaddleSignature(header);
  if (!ts || !h1 || !/^[0-9a-f]+$/i.test(h1)) return false;
  if (!Number.isFinite(Number(ts)) || Math.abs(nowSec - Number(ts)) > SIG_TOLERANCE_S) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${ts}:${rawBody}`).digest("hex");
  const a = Buffer.from(expected, "hex"), b = Buffer.from(String(h1), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

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

export function adFreeFromEvent(event) {
  if (!event || event.event_type !== "transaction.completed") return null;
  const d = event.data || {};
  const token = d.custom_data && d.custom_data.token ? String(d.custom_data.token) : null;
  const hasAdFree = (d.items || []).some((it) => it && it.price && isAdFreePrice(it.price.id));
  return hasAdFree ? { txId: d.id || null, token } : null;
}

export function subscriptionFromEvent(event) {
  if (!event || typeof event.event_type !== "string" || !event.event_type.startsWith("subscription.")) return null;
  const d = event.data || {};
  const matchesSub = (d.items || []).some((it) => it && it.price && isSubPrice(it.price.id));
  if (!matchesSub) return null;
  const token = d.custom_data && d.custom_data.token ? String(d.custom_data.token) : null;
  const subId = d.id || null;
  const occurredAt = Date.parse(event.occurred_at) || 0;
  const status = String(d.status || "").toLowerCase();
  const verb = event.event_type.slice("subscription.".length).toLowerCase();
  const CLEAR = ["canceled", "cancelled", "paused", "past_due", "expired"];
  if (CLEAR.includes(status) || (!status && CLEAR.includes(verb))) {
    return { subId, token, action: "clear", until: 0, occurredAt };
  }
  const until = Date.parse(d.current_billing_period && d.current_billing_period.ends_at) || 0;
  return { subId, token, action: "set", until, occurredAt };
}

export function applySubscription(profile, change) {
  if (!profile || !change) return false;
  const last = Number(profile.subEventAt) || 0;
  const at = Number(change.occurredAt) || 0;
  if (at && at < last) return false;
  if (change.action === "set") {
    if (!(change.until > 0)) return false;
    const before = Number(profile.subscribedUntil) || 0;
    grantSubscription(profile, change.until);
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

export function creditTransaction(profile, txId, amount) {
  if (!profile || !txId || !(amount > 0)) return false;
  const seen = profile.paddleTxns || (profile.paddleTxns = []);
  if (seen.includes(txId)) return false;
  grantEssence(profile, amount);
  seen.push(txId);
  if (seen.length > TXN_HISTORY) seen.splice(0, seen.length - TXN_HISTORY);
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

export function publicClientTokenOrNull(token, { apiKey, webhookSecret } = {}) {
  if (!token || typeof token !== "string") return null;
  const lower = token.toLowerCase();
  const looksSecret = lower.startsWith("pdl_") || lower.includes("apikey")
    || (apiKey && token === apiKey) || (webhookSecret && token === webhookSecret);
  const looksClient = lower.startsWith("live_") || lower.startsWith("test_");
  return (looksSecret || !looksClient) ? null : token;
}

export async function handlePaddleHttp(req, res, world) {
  const path = (req.url || "").split("?")[0];
  // Unauthenticated endpoint: never return secrets (PADDLE_KEY, webhook secret).
  if (req.method === "GET" && path === "/api/paddle/config") {
    const salesEnabled = !!(world && world.cfg && world.cfg.salesEnabled);
    const clientToken = salesEnabled
      ? publicClientTokenOrNull(process.env.PADDLE_CLIENT_TOKEN, { apiKey: process.env.PADDLE_KEY, webhookSecret: process.env.PADDLE_WEBHOOK_SECRET })
      : null;
    if (salesEnabled && process.env.PADDLE_CLIENT_TOKEN && !clientToken) console.warn("[paddle] TQ-194: PADDLE_CLIENT_TOKEN is not a public client token (expected a live_/test_ prefix) — refusing to expose it on /api/paddle/config.");
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({
      clientToken,
      salesEnabled,
      environment: process.env.PADDLE_ENV || "production",
      packs: PADDLE_PACKS.map((p) => ({ pack: p.pack, premium: p.premium, usd: p.usd, priceId: p.priceId })),
      adFree: (salesEnabled && adFreePriceId()) ? { priceId: adFreePriceId(), usd: PADDLE_ADFREE.usd } : null,
      sub: (salesEnabled && subPriceId()) ? { priceId: subPriceId(), usd: PADDLE_SUB.usd, period: PADDLE_SUB.period } : null,
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
      const adfree = adFreeFromEvent(event);
      if (adfree && adfree.token) {
        const profile = getByToken(adfree.token);
        if (profile && !profile.adFree) {
          grantAdFree(profile);
          saveProfile(profile);
          console.log(`[paddle] granted ad-free to ${adfree.token.slice(0, 8)}… (txn ${adfree.txId})`);
        }
      }
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
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ received: true }));
  return true;
}
