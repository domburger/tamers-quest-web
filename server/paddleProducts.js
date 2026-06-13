// Paddle gem-pack offering — created on the LIVE Paddle account via tools/_paddle-create.mjs
// for TQ-94. This is the single source of truth that maps a Paddle price ID to the amount
// of premium currency to credit, so the payment webhook (TQ-68) can grant the right amount
// after a verified purchase. NEVER trust the credited amount from the client / checkout
// payload — always look it up here by price ID.
//
// `premium` is the premium currency amount credited via grantGems() in src/engine/schemas.js.
// Keep `usd` and `premium` in sync with public/pricing.html.
//
// NOTE: the customer-facing display name of the premium currency is being renamed
// "Gems" -> "Essence" (Paddle product names already use "Essence"). See the rename Story
// for the in-game/pricing.html rollout; the internal profile field stays `gems` until then.

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
