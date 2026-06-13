import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PADDLE_PACKS, PADDLE_PACK_BY_PRICE, premiumForPrice } from './paddleProducts.js';

test('TQ-94: 4 gem packs with confirmed amounts/prices (kept in sync with pricing.html)', () => {
  assert.equal(PADDLE_PACKS.length, 4);
  const byPack = Object.fromEntries(PADDLE_PACKS.map((p) => [p.pack, p]));
  assert.deepEqual(
    Object.fromEntries(PADDLE_PACKS.map((p) => [p.pack, [p.premium, p.usd]])),
    { pouch: [500, '4.99'], sack: [1100, '9.99'], chest: [2400, '19.99'], hoard: [6500, '49.99'] }
  );
  // Every pack has a live Paddle product + price ID.
  for (const p of PADDLE_PACKS) {
    assert.match(p.productId, /^pro_/, `${p.pack} productId`);
    assert.match(p.priceId, /^pri_/, `${p.pack} priceId`);
  }
  assert.equal(byPack.hoard.priceId, 'pri_01kv105w3s9chepvts8h5b5zy0');
});

test('TQ-94: price-ID lookup credits the mapped amount; unknown IDs credit nothing', () => {
  assert.equal(premiumForPrice('pri_01kv105v2q27fjfk9bbvgcjch0'), 500);
  assert.equal(premiumForPrice('pri_01kv105w3s9chepvts8h5b5zy0'), 6500);
  assert.equal(premiumForPrice('pri_does_not_exist'), 0);
  assert.equal(premiumForPrice(undefined), 0);
  // No duplicate price IDs.
  assert.equal(Object.keys(PADDLE_PACK_BY_PRICE).length, PADDLE_PACKS.length);
});
