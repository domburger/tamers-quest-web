# Tamers Quest Web

A **real-time online multiplayer monster-taming extraction game** (Dark-and-Darker-style),
built with [Kaboom.js](https://kaboomjs.com/), a Node WebSocket server, and Vite.

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
- **Tested** — 60 tests (`npm test`): engine determinism/formulas, the net reducer, and
  server round lifecycle / combat / store / monster generation.

## Gameplay

- **Elements** — the data has 26 (AI-authored) element names; the deterministic matchup
  engine scores six canonical relationships (Fire→Nature→Water→Fire at ×1.3/×0.7, Dark↔Light
  ×1.2), and the AI resolver interprets the rest freely.
- **Procedural dungeons** — 400×400 maps: DLA cave carving → Voronoi biomes →
  colour-profile tile placement (ported from the original Java version), seed-deterministic.
- **Combat** — turn order by speed, damage = physical + elemental, accuracy/crit rolls,
  elemental matchups, and statuses; energy partially restores between encounters.
- **Taming** — catch weakened monsters to grow your roster (team of 4 + a vault).
- **Extraction pressure** — 10-minute runs, a safe zone that shrinks after 5 minutes with
  storm damage outside it, and portals that spawn as escape routes.

## Project layout

```
src/
  engine/        shared, framework-agnostic game logic (client + server)
    rng / stats / gamedata / mapgen / combat / schemas (+ *.test.js)
  systems/       client-only: spritegen.js (procedural art), combat.js (LLM + fallback)
  render/        character.js (animated player drawn from Kaboom primitives)
  scenes/        Kaboom scenes — single-player (start, characterSelect, lobby, game,
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

- **Kaboom.js** v3000 (WebGL canvas) — client rendering.
- **Node** + **ws** — authoritative server; **serve-handler** serves the built client on
  the same port. **Vite** for the client build; **node --test** for tests.
- **Deploy** — one **Railway** service runs the combined server; `master` auto-deploys.
- **Persistence** — anonymous profiles with token resume; in-memory today, with a
  Postgres write-through layer **coded and ready** (activates when `DATABASE_URL` is set).
- **AI** — OpenAI (`OPENAI_API_KEY`, server-side) resolves combat; an AI monster-generator
  core is built (pending the DB to persist generated content).

## Status

The multiplayer extraction loop (P0–P4) is **live**. Persistence and AI content generation
are **coded and waiting on a database**; PvP, reconnection, and a few stakes/visibility
rules are **pending design decisions** — all tracked in
[`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) (Q10–Q13) and the implementation plan.
