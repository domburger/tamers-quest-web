import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { parsePaddleSignature, verifyPaddleSignature, essenceFromEvent, creditTransaction } from './paddle.js';
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
