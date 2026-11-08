# Tamers Quest — Agent Guide

Real-time online multiplayer monster-taming extraction game. Node WS server + Vite client,
live at tamersquest.com. Combat is turn-based and AI-resolved.

## Commands

```bash
npm install
npm run dev      # Vite dev client (single-player + online)
npm run server   # Node WS game server
npm test         # Node built-in test runner (engine + server + net suites)
npm run build    # Vite production build
```

## IMPORTANT

- Deploy every change to production ASAP (user directive)

Production (`tamersquest.com`, Railway, auto-deploys from `master`) is the test env —
**commit and `git push` to `master` after every landed change, immediately** (build
must pass first — a broken bundle takes the site down). Don't let work sit
uncommitted/unpushed. See the full policy at the top of `docs/IMPLEMENTATION_PLAN.md`.

## Where things are

- Code map: `src/scenes/` (hub = village lobby, onlineGame = runs + combat), `src/ui/` (theme.js design
  tokens + primitives, icons.js, stationPopup.js + `*Panel.js` station modules), `src/engine/` (shared pure
  rules, unit-tested), `server/` (world.js rounds, llm.js AI router, gen*.js content pipelines).
- Docs: `docs/IMPLEMENTATION_PLAN.md` (policy + recent work), `docs/DESIGN_PASSES.md` (UI history),
  `docs/PROTOCOL.md` (WS messages). Mechanics wiki: the GitHub Wiki.
- Local QA: `tools/qa-*.mjs` Playwright harnesses against `npx vite` + `node server/index.js` with the mock
  judge `tools/mock-llm.mjs` (see the header comment of each harness).
- Gate every commit on the real exit codes of `npm run lint`, `npm test`, `npm run build`.
