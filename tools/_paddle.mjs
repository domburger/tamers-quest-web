// Paddle API helper for TQ-94. Reads PADDLE_KEY from .env, never prints it.
import { readFileSync } from 'node:fs';

function loadKey() {
  const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  const m = env.match(/^PADDLE_KEY=(.+)$/m);
  if (!m) throw new Error('PADDLE_KEY not in .env');
  return m[1].trim();
}
const KEY = loadKey();
const BASE = KEY.startsWith('pdl_live_') ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com';

export async function pad(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}
export { BASE };
