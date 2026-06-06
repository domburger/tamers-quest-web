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

Tests must stay green (currently 122/122). Run `npm test` + `npm run build` before
considering work done.
