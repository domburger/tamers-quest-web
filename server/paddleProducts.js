// Keep every usd/premium value in this file in sync with public/pricing.html.

export const PADDLE_PACKS = [
  { pack: 'pouch', premium: 500,  usd: '4.99',  productId: 'pro_01kv105twvx7etja92tv88vy36', priceId: 'pri_01kv105v2q27fjfk9bbvgcjch0' },
  { pack: 'sack',  premium: 1100, usd: '9.99',  productId: 'pro_01kv105v9dr6f89z53w672v5n0', priceId: 'pri_01kv105vdq9yd9xew0zj45aqpg' },
  { pack: 'chest', premium: 2400, usd: '19.99', productId: 'pro_01kv105vm165p0t8gy8sqny5th', priceId: 'pri_01kv105vrkecc7fmngbehrpxvp' },
  { pack: 'hoard', premium: 6500, usd: '49.99', productId: 'pro_01kv105vz17462yth9jxw85vf8', priceId: 'pri_01kv105w3s9chepvts8h5b5zy0' },
];

export const PADDLE_PACK_BY_PRICE = Object.freeze(
  Object.fromEntries(PADDLE_PACKS.map((p) => [p.priceId, Object.freeze(p)]))
);

export function premiumForPrice(priceId) {
  return PADDLE_PACK_BY_PRICE[priceId]?.premium ?? 0;
}

export const PADDLE_ADFREE = Object.freeze({ product: "remove-ads", usd: "1.99" });

export function adFreePriceId() {
  return process.env.PADDLE_ADFREE_PRICE_ID || "";
}

export function isAdFreePrice(priceId) {
  const id = adFreePriceId();
  return !!id && priceId === id;
}

export const PADDLE_SUB = Object.freeze({ product: "subscription", usd: "4.99", period: "month" });

export function subPriceId() {
  return process.env.PADDLE_SUB_PRICE_ID || "";
}

export function isSubPrice(priceId) {
  const id = subPriceId();
  return !!id && priceId === id;
}
