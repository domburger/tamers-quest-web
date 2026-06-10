# Tamers Quest Web

A **real-time online multiplayer monster-taming extraction game** (Dark-and-Darker-style),
built with [Phaser 3](https://phaser.io/) (migrated off Kaboom.js via a compat shim), a Node WebSocket server, and Vite.

> **Live:** [tamersquest.com](https://tamersquest.com) — bring a team of monsters into a
> procedurally-generated map shared by up to 16 players, fight wild monsters, and escape
> through a portal before the closing safe zone ends your run. Combat is turn-based and
> AI-resolved. A single-player mode is also playable from the menu.

## Quick start

```bash
npm install
npm run dev      # Vite dev client (single-player + points at a server for online)
npm run build    # production client build -> dist/
npm start        # combined server: serves dist/ over HTTP + the game over WebSocket
npm test         # unit/integration tests (node --test, zero deps)
```

In production a **single Node service** runs `server/index.js`, which serves the built
client over HTTP **and** the authoritative WebSocket game on the **same port/origin**, so
the client connects to `wss://<its-own-origin>` with no separate config.

## Current state

- **Live multiplayer extraction loop** — anonymous + nickname sessions, matchmaking into
  ≤16-player rounds, a seeded shared map, server-authoritative movement with tile
  collision, instanced PvE combat + taming, a shrinking safe zone with storm damage, and
  portal extraction (keep your gains) vs. losing your run team on defeat.
- **AI-resolved combat** (the core feature) — the server resolves each turn via OpenAI,
  with the deterministic engine as an automatic fallback (no key / API error).
- **Authoritative server** (`server/`) — 15 Hz tick, area-of-interest snapshots (~7.5 Hz),
  hidden/ambush monsters, anti-cheat (direction-only movement, map-clamped, attack-roster
  validation), and resilience (won't crash the whole server on a stray rejection).
- **Fully procedural rendering** — no PNG assets. Monsters, tiles, the animated player,
  and UI are generated as canvas art, seeded so a given monster always looks the same.
- **In-game HUD** — minimap/radar, live team-HP bars, an outside-safe-zone danger warning,
  a polished combat overlay (element/HP/energy/cost), and a latency readout.
- **Mobile + PWA** — virtual joystick, tappable combat, a real HTML nickname input, and
  install-to-home-screen (manifest + service worker + icons).
- **Shared deterministic engine** (`src/engine/`) — seeded RNG, stat math, map generation,
  and the combat resolver, importable by both client and server. A given seed reproduces
  an identical map (verified in tests).
- **Review tools** — an in-app **Bestiary** (every monster's procedural art + full data) and
  a [`public/wiki.html`](public/wiki.html) game-logic reference.
- **Tested** — 550+ tests (`npm test`): engine determinism/formulas, the net reducer, server
  round lifecycle / combat / PvP / store, accounts &amp; cloud saves, and AI monster/item generation.

## Gameplay

- **Elements** — the data has 26 (AI-authored) element names; they are **flavour only**
  (theme the monster's art, palette, and attacks). There is no type-effectiveness — no
  matchup multiplier in damage (removed 2026-06-10).
- **Procedural dungeons** — 400×400 maps: DLA cave carving → Voronoi biomes →
  colour-profile tile placement (ported from the original Java version), seed-deterministic.
- **Combat** — turn order by speed, damage = physical + elemental, accuracy/crit rolls,
  and statuses (no elemental matchups); energy partially restores between encounters.
- **Taming** — catch weakened monsters to grow your roster (team of 4 + a vault).
- **Extraction pressure** — 10-minute runs, a safe zone that shrinks after 5 minutes with
  storm damage outside it, and portals that spawn as escape routes.

## Project layout

```
src/
  engine/        shared, framework-agnostic game logic (client + server)
    rng / stats / gamedata / mapgen / combat / schemas (+ *.test.js)
  systems/       client-only: spritegen.js (procedural art), combat.js (LLM + fallback)
  render/        character.js (animated player drawn via the k.* shim primitives)
  scenes/        game scenes (run on Phaser via src/compat/kaboomShim.js) — single-player (start, characterSelect, lobby, game,
                 fight, inventory, settings, runResult), online (onlineLobby, onlineGame),
                 and the bestiary gallery
  net.js         framework-agnostic net client + pure message reducer (+ net.test.js)
  netClient.js   shared net singleton    data.js  client loader    uid.js  unique ids
  main.js        bootstrap
server/          authoritative game server (Node, ws)
  index.js       combined HTTP (serves dist/) + WebSocket on one port
  world.js       sessions, matchmaking, rounds, tick, AoI snapshots, extraction
  combat.js      AI-resolved turns + deterministic fallback    ai.js  OpenAI client
  store.js       profiles (in-memory cache + Postgres write-through)    db.js  pg layer
  gen.js         AI monster-generation core (validator, reuse policy)   (+ *.test.js)
public/
  assets/data/   game data (monstertype, attacks, groundtiles, item) as JSON
  wiki.html      game-logic reference    manifest.webmanifest / sw.js / icons (PWA)
```

## Documentation

- [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) — phased plan & task list (source of truth).
- [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) — what's needed from the maintainer: open decisions (Q10–Q13), the DB step, tokens.
- [`docs/PROTOCOL.md`](docs/PROTOCOL.md) — the network protocol.
- [`public/wiki.html`](public/wiki.html) — human-readable spec of the game rules & formulas (also live at `/wiki`).

## Tech stack

- **Phaser 3** (WebGL canvas) — client rendering; migrated off Kaboom.js (2026-06-06), legacy `k.*` API preserved via `src/compat/kaboomShim.js`.
- **Node** + **ws** — authoritative server; **serve-handler** serves the built client on
  the same port. **Vite** for the client build; **node --test** for tests.
- **Deploy** — one **Railway** service runs the combined server; `master` auto-deploys.
- **Persistence** — server-authoritative profiles. **Logged-in accounts own their characters as
  cloud saves** (server-side, following the account across devices); **guests are session-only**.
  A Postgres write-through layer makes profiles + generated content durable when `DATABASE_URL`
  is set (pure in-memory otherwise).
- **AI** — OpenAI (`OPENAI_API_KEY`, server-side) resolves **every combat turn** (structured v2
  judge) and **generates monsters + items** through a multi-agent pipeline (admin-tunable per
  phase); generated content is served to clients and persisted when a DB is configured.

## Status

The full extraction loop is **live** at `tamersquest.com`: matchmaking, the shared seeded map,
**AI-judged combat**, taming, **PvP** (collision/chain duels + team looting), **reconnection**
(grace-window resume), the **Q10 run-loss stakes**, and **AI monster/item generation**. Accounts
get **cloud saves**; guests play **session-only**. The earlier open questions (Q10–Q13: stakes,
PvP, reconnection) are **resolved**. The one remaining deferred item is the **email-dependent
account flow** (password reset) — see [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md).
