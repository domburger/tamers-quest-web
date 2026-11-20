# Deployment

One Node process (`npm run start` → `node server/index.js`) serves the built `dist/` and the WebSocket game
on `PORT` (default 8080). Railway auto-deploys `master` to tamersquest.com (`railway.json`).

## Environment

| Var | Purpose |
|-----|---------|
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` / `GOOGLE_API_KEY`, `DEEPSEEK_API_KEY`, `GROQ_API_KEY` | AI providers (`server/llm.js` routes by model id). AI is on when any key is set; set more than one for failover. |
| `*_BASE_URL` | Endpoint override for an OpenAI-compatible provider (local mock: `tools/mock-llm.mjs`). |
| `DATABASE_URL` | Postgres. Without it the store is in-memory. |
| `GOOGLE_CLIENT_ID` / `_SECRET`, `DISCORD_CLIENT_ID` / `_SECRET` | OAuth (optional). |
| `ADMIN_TOKEN` | Enables `/admin` and `/api/admin/*`. |
| `PUBLIC_ORIGIN` | Canonical origin for OAuth redirects (default `https://tamersquest.com`). |
| `PADDLE_*`, `SALES_ENABLED` | Paddle checkout + webhook. |
| `EMAIL_API_KEY`, `EMAIL_FROM` | Transactional email (password reset / verification). |
| `SERVE_STATIC=false`, `ALLOWED_ORIGINS`, `VITE_SERVER_URL` (build time) | Split client/server deploy. |

QA-only server knobs: `MATCH_MIN_PLAYERS=1 MATCH_COUNTDOWN_S=0` (solo instant rounds), `ENCOUNTER_RADIUS`,
`ROUND_DURATION_S`, `CIRCLE_START_S`, `SIM_LAG_MS` / `SIM_JITTER_MS`.
