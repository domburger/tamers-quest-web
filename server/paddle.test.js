import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { parsePaddleSignature, verifyPaddleSignature, essenceFromEvent, creditTransaction, publicClientTokenOrNull, adFreeFromEvent, subscriptionFromEvent, applySubscription } from './paddle.js';
import { PADDLE_PACKS } from './paddleProducts.js';

const SECRET = 'pdl_ntfset_test_secret';
const sign = (body, ts, secret = SECRET) =>
  `ts=${ts};h1=${crypto.createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex')}`;

test('TQ-68: parsePaddleSignature splits ts/h1', () => {
  assert.deepEqual(parsePaddleSignature('ts=123;h1=abc'), { ts: '123', h1: 'abc' });
  assert.deepEqual(parsePaddleSignature(''), {});
  assert.deepEqual(parsePaddleSignature(undefined), {});
});

test('TQ-68: verifyPaddleSignature accepts a correct HMAC and rejects tampering', () => {
  const body = '{"event_type":"transaction.completed"}';
  const now = 1_700_000_000;
  assert.equal(verifyPaddleSignature(body, sign(body, now), SECRET, now), true);
  // tampered body
  assert.equal(verifyPaddleSignature(body + 'x', sign(body, now), SECRET, now), false);
  // wrong secret
  assert.equal(verifyPaddleSignature(body, sign(body, now), 'other', now), false);
  // stale timestamp (outside the tolerance window)
  assert.equal(verifyPaddleSignature(body, sign(body, now), SECRET, now + 10_000), false);
  // missing secret / malformed header
  assert.equal(verifyPaddleSignature(body, sign(body, now), '', now), false);
  assert.equal(verifyPaddleSignature(body, 'garbage', SECRET, now), false);
  assert.equal(verifyPaddleSignature(body, 'ts=1;h1=nothex', SECRET, now), false);
});

test('TQ-68: essenceFromEvent maps price IDs to the credited amount (never the payload)', () => {
  const pouch = PADDLE_PACKS.find((p) => p.pack === 'pouch');
  const event = {
    event_type: 'transaction.completed',
    data: {
      id: 'txn_1',
      custom_data: { token: 'tok_abc' },
      items: [{ price: { id: pouch.priceId }, quantity: 1 }],
    },
  };
  const r = essenceFromEvent(event);
  assert.deepEqual(r, { txId: 'txn_1', token: 'tok_abc', amount: pouch.premium });

  // quantity multiplies; multiple items sum
  const hoard = PADDLE_PACKS.find((p) => p.pack === 'hoard');
  const multi = essenceFromEvent({ event_type: 'transaction.completed', data: { id: 't2', custom_data: { token: 't' }, items: [
    { price: { id: pouch.priceId }, quantity: 2 },
    { price: { id: hoard.priceId }, quantity: 1 },
  ] } });
  assert.equal(multi.amount, pouch.premium * 2 + hoard.premium);

  // unknown price credits nothing; non-completed events are ignored
  assert.equal(essenceFromEvent({ event_type: 'transaction.completed', data: { id: 't', custom_data: { token: 't' }, items: [{ price: { id: 'pri_spoofed' }, quantity: 1 }] } }).amount, 0);
  assert.equal(essenceFromEvent({ event_type: 'transaction.created', data: {} }), null);
  assert.equal(essenceFromEvent(null), null);
});

test('TQ-68: creditTransaction is idempotent on the transaction id', () => {
  const profile = { essence: 0 };
  assert.equal(creditTransaction(profile, 'txn_9', 500), true);
  assert.equal(profile.essence, 500);
  assert.deepEqual(profile.paddleTxns, ['txn_9']);
  // a webhook retry of the SAME txn must not double-credit
  assert.equal(creditTransaction(profile, 'txn_9', 500), false);
  assert.equal(profile.essence, 500);
  // a different txn credits on top
  assert.equal(creditTransaction(profile, 'txn_10', 100), true);
  assert.equal(profile.essence, 600);
  // guards: no txn id / non-positive amount
  assert.equal(creditTransaction(profile, '', 500), false);
  assert.equal(creditTransaction(profile, 'txn_11', 0), false);
});

test('TQ-68: creditTransaction bounds its per-profile txn history', () => {
  const profile = { essence: 0 };
  for (let i = 0; i < 60; i++) creditTransaction(profile, `txn_${i}`, 1);
  assert.equal(profile.paddleTxns.length, 50);
  // the most recent id is still remembered (so its retry is still a no-op)
  assert.equal(creditTransaction(profile, 'txn_59', 1), false);
});

test('TQ-174: adFreeFromEvent detects the remove-ads price (inert until provisioned)', () => {
  const prev = process.env.PADDLE_ADFREE_PRICE_ID;
  const mkEvent = (priceId) => ({ event_type: 'transaction.completed', data: { id: 'txn_ad', custom_data: { token: 'tok_ad' }, items: [{ price: { id: priceId }, quantity: 1 }] } });
  try {
    // Unconfigured → no event is ever an ad-free grant (can't be tricked into granting).
    delete process.env.PADDLE_ADFREE_PRICE_ID;
    assert.equal(adFreeFromEvent(mkEvent('pri_anything')), null);
    // Provisioned → the matching price resolves the token to grant; non-matching/other events don't.
    process.env.PADDLE_ADFREE_PRICE_ID = 'pri_adfree_live';
    assert.deepEqual(adFreeFromEvent(mkEvent('pri_adfree_live')), { txId: 'txn_ad', token: 'tok_ad' });
    assert.equal(adFreeFromEvent(mkEvent('pri_other')), null);
    // A bundled txn (essence pack + ad-free) is still detected as ad-free.
    const pouch = PADDLE_PACKS.find((p) => p.pack === 'pouch');
    const bundled = { event_type: 'transaction.completed', data: { id: 't', custom_data: { token: 'tk' }, items: [
      { price: { id: pouch.priceId }, quantity: 1 }, { price: { id: 'pri_adfree_live' }, quantity: 1 },
    ] } };
    assert.deepEqual(adFreeFromEvent(bundled), { txId: 't', token: 'tk' });
    // non-completed / null events are ignored
    assert.equal(adFreeFromEvent({ event_type: 'transaction.created', data: {} }), null);
    assert.equal(adFreeFromEvent(null), null);
  } finally {
    if (prev === undefined) delete process.env.PADDLE_ADFREE_PRICE_ID; else process.env.PADDLE_ADFREE_PRICE_ID = prev;
  }
});

test('TQ-269: subscriptionFromEvent maps lifecycle events to entitlement changes (inert until provisioned)', () => {
  const prev = process.env.PADDLE_SUB_PRICE_ID;
  const mk = (eventType, { status, endsAt, priceId = 'pri_sub_live', token = 'tok_sub', occurredAt = '2026-01-01T00:00:00.000Z' } = {}) => ({
    event_type: eventType,
    occurred_at: occurredAt,
    data: { id: 'sub_1', status, custom_data: { token }, current_billing_period: endsAt ? { ends_at: endsAt } : undefined, items: [{ price: { id: priceId } }] },
  });
  try {
    // Unconfigured → never matches, so no event can be tricked into granting the sub.
    delete process.env.PADDLE_SUB_PRICE_ID;
    assert.equal(subscriptionFromEvent(mk('subscription.activated', { status: 'active', endsAt: '2026-02-01T00:00:00.000Z' })), null);

    process.env.PADDLE_SUB_PRICE_ID = 'pri_sub_live';
    // active → set, until = current_billing_period.ends_at (epoch ms)
    assert.deepEqual(
      subscriptionFromEvent(mk('subscription.activated', { status: 'active', endsAt: '2026-02-01T00:00:00.000Z' })),
      { subId: 'sub_1', token: 'tok_sub', action: 'set', until: Date.parse('2026-02-01T00:00:00.000Z'), occurredAt: Date.parse('2026-01-01T00:00:00.000Z') },
    );
    // canceled status clears — even carried on a generic subscription.updated event
    assert.equal(subscriptionFromEvent(mk('subscription.updated', { status: 'canceled' })).action, 'clear');
    assert.equal(subscriptionFromEvent(mk('subscription.past_due', { status: 'past_due' })).action, 'clear');
    // verb fallback when status absent
    assert.equal(subscriptionFromEvent(mk('subscription.canceled', {})).action, 'clear');
    // a non-matching price is ignored (not our product); non-subscription / null events are null
    assert.equal(subscriptionFromEvent(mk('subscription.activated', { status: 'active', priceId: 'pri_other' })), null);
    assert.equal(subscriptionFromEvent({ event_type: 'transaction.completed', data: {} }), null);
    assert.equal(subscriptionFromEvent(null), null);
  } finally {
    if (prev === undefined) delete process.env.PADDLE_SUB_PRICE_ID; else process.env.PADDLE_SUB_PRICE_ID = prev;
  }
});

test('TQ-269: applySubscription is idempotent + out-of-order safe', () => {
  const until = Date.parse('2026-02-01T00:00:00.000Z');
  const t1 = Date.parse('2026-01-01T00:00:00.000Z');
  const t2 = Date.parse('2026-01-15T00:00:00.000Z');
  const profile = { subscribedUntil: 0 };
  // first set grants the entitlement
  assert.equal(applySubscription(profile, { subId: 's', token: 't', action: 'set', until, occurredAt: t1 }), true);
  assert.equal(profile.subscribedUntil, until);
  // replaying the SAME set is a no-op (idempotent)
  assert.equal(applySubscription(profile, { subId: 's', token: 't', action: 'set', until, occurredAt: t1 }), false);
  assert.equal(profile.subscribedUntil, until);
  // a STALE clear (older than the last applied event) is ignored — entitlement survives
  assert.equal(applySubscription(profile, { subId: 's', token: 't', action: 'clear', until: 0, occurredAt: t1 - 1 }), false);
  assert.equal(profile.subscribedUntil, until);
  // a NEWER clear drops it (TQ-76 lapse)
  assert.equal(applySubscription(profile, { subId: 's', token: 't', action: 'clear', until: 0, occurredAt: t2 }), true);
  assert.equal(profile.subscribedUntil, 0);
  // a set with no period end grants nothing
  assert.equal(applySubscription({ subscribedUntil: 0 }, { action: 'set', until: 0, occurredAt: t1 }), false);
});

test('TQ-194: publicClientTokenOrNull serves only genuine client tokens, withholds secrets', () => {
  // genuine browser client tokens pass through (Paddle.js live_/test_)
  assert.equal(publicClientTokenOrNull('live_abc123'), 'live_abc123');
  assert.equal(publicClientTokenOrNull('test_xyz'), 'test_xyz');
  // secret/API-key shapes are withheld (the TQ-189 misconfig)
  assert.equal(publicClientTokenOrNull('pdl_apikey_deadbeef'), null);
  assert.equal(publicClientTokenOrNull('SomeApiKeyValue'), null, 'contains "apikey" / no client prefix');
  assert.equal(publicClientTokenOrNull('randomstring'), null, 'no live_/test_ prefix → withheld');
  // equals a known secret → withheld even if client-prefixed
  assert.equal(publicClientTokenOrNull('live_oops', { apiKey: 'live_oops' }), null);
  assert.equal(publicClientTokenOrNull('test_oops', { webhookSecret: 'test_oops' }), null);
  // empty / non-string → null
  assert.equal(publicClientTokenOrNull(''), null);
  assert.equal(publicClientTokenOrNull(undefined), null);
  assert.equal(publicClientTokenOrNull(12345), null);
});
