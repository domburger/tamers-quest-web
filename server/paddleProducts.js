// Paddle Essence-pack offering — created on the LIVE Paddle account via tools/_paddle-create.mjs
// for TQ-94. This is the single source of truth that maps a Paddle price ID to the amount
// of premium currency (Essence) to credit, so the payment webhook (TQ-68) can grant the right
// amount after a verified purchase. NEVER trust the credited amount from the client / checkout
// payload — always look it up here by price ID.
//
// `premium` is the Essence amount credited via grantEssence() in src/engine/schemas.js (TQ-132:
// essence is the premium/paid currency; `gems` was removed). Keep `usd` and `premium` in sync
// with public/pricing.html.

/** @typedef {{ pack: string, premium: number, usd: string, productId: string, priceId: string }} PaddlePack */

/** @type {PaddlePack[]} */
export const PADDLE_PACKS = [
  { pack: 'pouch', premium: 500,  usd: '4.99',  productId: 'pro_01kv105twvx7etja92tv88vy36', priceId: 'pri_01kv105v2q27fjfk9bbvgcjch0' },
  { pack: 'sack',  premium: 1100, usd: '9.99',  productId: 'pro_01kv105v9dr6f89z53w672v5n0', priceId: 'pri_01kv105vdq9yd9xew0zj45aqpg' },
  { pack: 'chest', premium: 2400, usd: '19.99', productId: 'pro_01kv105vm165p0t8gy8sqny5th', priceId: 'pri_01kv105vrkecc7fmngbehrpxvp' },
  { pack: 'hoard', premium: 6500, usd: '49.99', productId: 'pro_01kv105vz17462yth9jxw85vf8', priceId: 'pri_01kv105w3s9chepvts8h5b5zy0' },
];

/** Price ID -> pack definition. Use this in the webhook to resolve the credited amount. */
export const PADDLE_PACK_BY_PRICE = Object.freeze(
  Object.fromEntries(PADDLE_PACKS.map((p) => [p.priceId, Object.freeze(p)]))
);

/**
 * Premium-currency amount to credit for a Paddle price ID, or 0 if the price ID is
 * unknown (defensive: never credit an unmapped/spoofed price).
 * @param {string} priceId
 * @returns {number}
 */
export function premiumForPrice(priceId) {
  return PADDLE_PACK_BY_PRICE[priceId]?.premium ?? 0;
}

// TQ-174: standalone "remove ads" one-time purchase (~EUR 2). The Paddle product is created on the
// LIVE account by Dominik (Human Task); its price ID is supplied via env (PADDLE_ADFREE_PRICE_ID),
// so this stays INERT until provisioned — no code change needed to go live. A verified purchase
// grants a PERMANENT ad-free entitlement (profile.adFree) via the webhook; subscribers also get
// ad-free (see isAdFree() in src/engine/schemas.js). Keep `usd` in sync with public/pricing.html.
export const PADDLE_ADFREE = Object.freeze({ product: "remove-ads", usd: "1.99" });

/** The configured remove-ads price ID (env-provisioned), or "" if not set yet. */
export function adFreePriceId() {
  return process.env.PADDLE_ADFREE_PRICE_ID || "";
}

/**
 * Whether a Paddle price ID is the standalone remove-ads product. Defensive: always false when the
 * price ID is unconfigured/empty or doesn't match, so an unmapped/spoofed price never grants ad-free.
 * @param {string} priceId
 * @returns {boolean}
 */
export function isAdFreePrice(priceId) {
  const id = adFreePriceId();
  return !!id && priceId === id;
}

// TQ-173/267/269: recurring SUBSCRIPTION product (bundle = premium battle pass + ad-free). The Paddle
// recurring product is created on the LIVE account by Dominik (Human Task TQ-271); its price ID is
// supplied via env (PADDLE_SUB_PRICE_ID), so subscription handling stays INERT until provisioned — no
// code change to go live. A verified subscription webhook stamps the entitlement expiry
// (profile.subscribedUntil, TQ-267) via grantSubscription(); cancel/expiry clears it. See server/paddle.js.
export const PADDLE_SUB = Object.freeze({ product: "subscription" });

/** The configured recurring-subscription price ID (env-provisioned), or "" if not set yet. */
export function subPriceId() {
  return process.env.PADDLE_SUB_PRICE_ID || "";
}

/**
 * Whether a Paddle price ID is the recurring-subscription product. Defensive: always false when the
 * price ID is unconfigured/empty or doesn't match, so an unmapped/spoofed price never grants the sub.
 * @param {string} priceId
 * @returns {boolean}
 */
export function isSubPrice(priceId) {
  const id = subPriceId();
  return !!id && priceId === id;
}
