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