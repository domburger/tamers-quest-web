# Tamers Quest — agent guide

Real-time online multiplayer monster-taming extraction game. Node WS server + Vite client,
live at tamersquest.com. Combat is turn-based and AI-resolved.

## 📌 Read this first — sources of truth

Multiple agents work this repo concurrently as `/loop` sessions. Before doing anything,
read these (in order) — they are the shared sources of truth:

1. **`docs/IMPLEMENTATION_PLAN.md`** — THE plan. Contains, at the top:
   - **Agents & ownership** — the agent roster + per-task ownership table.
   - **Locked decisions** — incl. the active **Kaboom.js → Phaser 3** migration.
   - Phased task list (P0–P9) with status.
2. **`public/wiki.html`** — the game-design / mechanics spec. Keep it in sync when you
   change a mechanic.
3. **`docs/BUGFIX_LOG.md`** — bug history + the `@watchdog` agent's heartbeat.

## 🤝 Multi-agent coordination protocol

- **Register before you work.** Add yourself to the **Agent roster** in
  `IMPLEMENTATION_PLAN.md` with a real heartbeat artifact (a file/log/branch you own), set
  Status to **confirmed**, then claim tasks in the ownership table.
- **One owner per task. No phantom owners** — a task may only name a *confirmed* roster
  agent. `@unassigned` = free to claim (not an agent).
- **Stay in your lane.** `@phaser` migrates via a **compat shim**
  (`src/compat/kaboomShim.js`) that re-exposes the `k.*` API on Phaser — scenes keep working
  unchanged. `@phaser` owns `src/compat/*`, the `src/main.js` bootstrap, and `index.html`
  (don't edit these). Everyone else: prefer the engine-agnostic core (`src/engine/*`,
  `server/*`, `src/net.js`, data JSON); you MAY edit `src/scenes/*` / `src/render/*` but only
  using the `k.*` surface the shim supports — need a new `k.*` feature, ping `@phaser`.
- **Re-verify before acting.** The working tree changes under you as other loops run —
  confirm current state (re-grep, re-run tests) before acting on a stale observation.
- **Keep the sources of truth current.** New mechanic → update the wiki + plan. New
  feature → add/track a task. The `@coordinator` loop validates roster/ownership each pass.

## Commands

```bash
npm install
npm run dev      # Vite dev client (single-player + online)
npm run server   # Node WS game server
npm test         # Node built-in test runner (engine + server + net suites)
npm run build    # Vite production build
```

Tests must stay green. Run `npm test` + `npm run build` before considering work done.

## ⚠️ Background processes — never leave them running across a turn

QA harnesses (`tools/*.mjs`) need a server, but a backgrounded `npm run server` /
`npm run dev` (`run_in_background`) **must be stopped in the same turn you start it.**
A leftover background task:
- **stalls a session-only `/loop` cron** — the harness won't fire the next iteration
  while a background task is still live, so the loop silently stops firing;
- leaks the port + an orphaned `npm → node` process.

Rules:
- Prefer a **foreground** server with a timeout, or: start it → run the harness →
  **stop it before the turn ends.**
- Stop it with **`TaskStop <task_id>`** (kills the whole task), **not** `Stop-Process`
  on one PID — `npm run` spawns a child `node`, so killing a single PID orphans the
  other and the background task never completes.
- Use an **uncommon port** (e.g. `PORT=8123`) to avoid colliding with another loop,
  and verify a process is yours (check its command line) before killing it — multiple
  agents share this machine.

## 🚀 Deploy every change to production ASAP (user directive)

Production (`tamersquest.com`, Railway, auto-deploys from `master`) is the test env —
**commit and `git push` to `master` after every landed change, immediately** (build
must pass first — a broken bundle takes the site down). Don't let work sit
uncommitted/unpushed. See the full policy at the top of `docs/IMPLEMENTATION_PLAN.md`.
