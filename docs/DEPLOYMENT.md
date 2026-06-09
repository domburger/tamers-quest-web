# Deployment

Tamer's Quest ships as **one Node process that serves both the built client (static
`dist/`) and the authoritative WebSocket game server**. This is the current production
setup on Railway (`tamersquest.com`, auto-deploys from `master`).

## Combined deploy (current)

- **Railway**: NIXPACKS build, `startCommand: npm run start` (see `railway.json`).
- `npm run start` runs `vite build` then `node server/index.js`.
- The server serves `dist/` AND accepts WS upgrades on the same port (`PORT`, default 8080).
- The client's net layer (`src/netClient.js`) uses a same-origin WS by default, so no
  client config is needed.

### Required env (Railway service variables)

| Var | Purpose |
|-----|---------|
| `OPENAI_API_KEY` | AI combat judge + monster/item generation. Without it, combat falls to the deterministic crash-net and generation no-ops. |
| `DATABASE_URL` | Postgres for durable profiles. Without it the store is in-memory (non-durable). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth (optional). |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | Discord OAuth (optional). |
| `ADMIN_TOKEN` | Enables the `/admin` panel + `/api/admin/*` (disabled/503 when unset). |
| `PUBLIC_ORIGIN` | Canonical origin for OAuth `redirect_uri` (default `https://tamersquest.com`). |

## Split deploy (client CDN + dedicated game server) — config path

The code already supports splitting into a static client (any host/CDN) and a separate
**WS-only game service**. Keep the combined deploy for now; this is the tested config path
for when you scale the game server independently.

**1. Game service (WS-only):** a Railway service running the same repo with:

| Var | Value |
|-----|-------|
| `SERVE_STATIC` | `false` — skip static serving; expose only `/health`, `/api/*`, `/auth/*`, and the WS upgrade (`server/index.js:34`). |
| `ALLOWED_ORIGINS` | `https://tamersquest.com` — the client origin(s), comma-separated. Governs the WS `verifyClient` AND the AI-cost `/api/combat/*` CORS (`server/combat.js`). Empty = allow-all (combined only). |
| `PUBLIC_ORIGIN` | the client origin, so OAuth redirects land back on the client. |
| plus `OPENAI_API_KEY`, `DATABASE_URL`, OAuth, `ADMIN_TOKEN` as above. |

**2. Client build (static host):** build with the game server's public URL baked in:

```bash
VITE_SERVER_URL=wss://game.tamersquest.com npm run build
# deploy dist/ to the static host (Railway static, Netlify, Cloudflare Pages, …)
```

`src/netClient.js` reads `VITE_SERVER_URL` (else same-origin). The client also hits the
game server's HTTP endpoints (`/api/combat/*`, `/auth/*`, `/api/monstertypes`,
`/api/leaderboard`) cross-origin — those send permissive CORS for the public read-only
ones and allow-list-gated CORS for the combat endpoint.

### Testing the split locally

```bash
# Terminal 1 — game server, WS-only, allowing the Vite dev origin:
SERVE_STATIC=false ALLOWED_ORIGINS=http://localhost:5173 npm run server

# Terminal 2 — client pointed at it:
VITE_SERVER_URL=ws://localhost:8080 npm run dev
```

Then exercise an online round: the client connects to `:8080` for WS + `/api/*`, and the
WS `verifyClient` + combat CORS accept the `:5173` origin. A non-listed origin is rejected
(WS) / gets a CORS-mismatch (combat HTTP) — the global connection cap (`createConnLimiter`)
remains the safe fallback regardless of origin.
