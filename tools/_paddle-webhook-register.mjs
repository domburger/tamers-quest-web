// TQ-95: register the Paddle notification destination for transaction.completed pointing at the
// prod webhook, capture its signing secret, and write it to .env as PADDLE_WEBHOOK_SECRET.
// The secret is written straight to .env and never printed (masked confirmation only).
import { readFileSync, writeFileSync } from 'node:fs';
import { pad } from './_paddle.mjs';

const DEST = 'https://tamersquest.com/api/paddle/webhook';
const ENVPATH = new URL('../.env', import.meta.url);

// Idempotency: don't create a second destination for the same URL.
const existing = await pad('GET', '/notification-settings?per_page=200');
const dupe = (existing.json?.data || []).find((n) => n.destination === DEST && n.type === 'url');
if (dupe) { console.error('ABORT: a destination for this URL already exists:', dupe.id); process.exit(2); }

const r = await pad('POST', '/notification-settings', {
  description: "Tamer's Quest — Essence credit (transaction.completed)",
  destination: DEST,
  type: 'url',
  active: true,
  api_version: 1,
  subscribed_events: ['transaction.completed'],
});
if (r.status >= 300) { console.error('CREATE FAIL', r.status, JSON.stringify(r.json)); process.exit(1); }

const d = r.json.data;
const secret = d.endpoint_secret_key;
if (!secret) { console.error('NO SECRET in response', JSON.stringify(d)); process.exit(1); }

// Append/replace PADDLE_WEBHOOK_SECRET in .env without touching other keys.
let env = readFileSync(ENVPATH, 'utf8');
const line = `PADDLE_WEBHOOK_SECRET=${secret}`;
if (/^PADDLE_WEBHOOK_SECRET=.*$/m.test(env)) env = env.replace(/^PADDLE_WEBHOOK_SECRET=.*$/m, line);
else env = env.replace(/\n*$/, '\n') + line + '\n';
writeFileSync(ENVPATH, env);

console.log('OK destination created:', d.id);
console.log('events:', (d.subscribed_events || []).map((e) => e.name || e).join(','));
console.log('active:', d.active, '| api_version:', d.api_version);
console.log(`PADDLE_WEBHOOK_SECRET written to .env (len ${secret.length}, prefix ${secret.slice(0, 7)}…)`);
