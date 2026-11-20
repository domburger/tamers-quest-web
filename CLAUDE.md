# Tamers Quest — Agent Guide

Real-time online multiplayer monster-taming extraction game. Node WS server + Vite client,
live at tamersquest.com. Combat is turn-based and AI-resolved.

## Commands

```bash
npm install
npm run dev      # Vite dev client
npm run server   # Node WS game server (:8080)
npm test         # Node built-in test runner
npm run build    # Vite production build
```

## IMPORTANT

- Production (`tamersquest.com`, Railway, auto-deploys from `master`) is the test env: commit and
  `git push` to `master` after every landed change. Gate every commit on the real exit codes of
  `npm run lint`, `npm test`, `npm run build` — a broken bundle takes the site down.
- Server-authoritative: clients send input and render snapshots; state, movement, combat, loot and
  persistence live on the server or in shared `src/engine/` code (pure, used by client and server).
- Combat is AI-judged (`server/ai.js`, `server/judge.js`); the deterministic engine is only a crash-net.
- New live tuning knobs, prompts or model settings belong in the admin panel (`server/admin.js`).

## Where things are

- `src/scenes/` (hub = village, onlineGame = runs + combat), `src/ui/` (theme.js tokens + primitives,
  `*Panel.js` village popups), `src/render/`, `src/compat/` (canvas2D backend), `src/engine/` (shared rules),
  `server/` (world.js rounds, llm.js AI router, gen*.js content pipelines). Env vars: `docs/DEPLOYMENT.md`.
- Local QA: `tools/qa-*.mjs` Playwright harnesses against `npx vite` + `node server/index.js`, with the
  mock AI `tools/mock-llm.mjs`. DEV-only page hooks (`window.__net`, `__openStation`, `tqGo`) drive them.
