# Tamers Quest Web

A 2D top-down dungeon-crawler + monster-taming RPG, built with [Kaboom.js](https://kaboomjs.com/) and Vite.

> **Direction:** a single-player core (playable today) being evolved into a
> **real-time online multiplayer extraction game** (Dark-and-Darker-style): bring a
> team of monsters into a procedurally-generated map shared by up to 16 players,
> fight wild monsters and rivals, and escape through a portal before the closing
> zone — or lose your run team. See [`docs/`](#documentation) for the full plan.

## Quick start

```bash
npm install
npm run dev      # Vite dev server
npm run build    # production build -> dist/
npm test         # engine unit tests (node --test, zero deps)
```

## Current state

- **Playable single-player core** — character select, lobby, procedural dungeon,
  top-down exploration, turn-based combat, taming, inventory, extraction/defeat.
- **Fully procedural rendering** — no PNG assets. Monsters, ground tiles, the
  player, and title UI are generated as canvas art from game data (seeded, so a
  given monster always looks the same). See `src/systems/spritegen.js`.
- **Shared deterministic engine** (`src/engine/`) — game logic is framework-
  agnostic and importable by both the browser client and a future server:
  seeded RNG, stat math, data store, map generation, and the combat resolver.
  A given seed reproduces an identical map (verified in tests) — the basis for
  server-authoritative multiplayer.
- **Tested** — 21 unit tests (`npm test`) covering RNG determinism, stat
  formulas, the combat rules, and map-gen reproducibility.

## Gameplay

- **6 elements** — Fire, Water, Nature, Dark, Light, Neutral.
- **Procedural dungeons** — 400×400 maps: DLA cave carving → Voronoi biomes →
  colour-profile tile placement (ported from the original Java version).
- **Turn-based combat** — deterministic resolver (turn order by speed, damage =
  physical + elemental, accuracy/crit rolls, elemental matchups, Burn/Poison/
  Freeze/Stun). An optional LLM layer can narrate/evaluate turns.
- **Taming** — catch weakened monsters to grow your roster (team of 4 + a vault).
- **Extraction pressure** — 10-minute runs, a safe zone that shrinks after 5
  minutes, and portals that spawn as escape routes.

## Project layout

```
src/
  engine/        shared, framework-agnostic game logic (client + server)
    rng.js          seeded PRNG
    stats.js        monster stat math
    gamedata.js     in-memory data store + accessors
    mapgen.js       DLA + Voronoi + tile placement (seed-deterministic)
    combat.js       deterministic turn/catch resolver
    schemas.js      canonical typedefs + GAME constants
    *.test.js       node:test suites
  systems/       client-only systems
    spritegen.js    procedural canvas art (replaces PNGs)
    combat.js       LLM wrapper + deterministic fallback (delegates to engine)
  scenes/        Kaboom scenes (start, characterSelect, lobby, loading, game,
                 fight, inventory, settings, runResult)
  data.js        client loader: fetch JSON -> engine store; re-exports accessors
  main.js        bootstrap
public/
  assets/data/   game data (monstertype, attacks, groundtiles, item) as JSON
  wiki.html      game-logic reference (open directly or visit /wiki.html)
```

## Documentation

- [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) — phased plan & task list (source of truth).
- [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) — what's needed from the maintainer: decisions, tokens, hosting/domain steps.
- [`docs/PROTOCOL.md`](docs/PROTOCOL.md) — draft network protocol for the multiplayer layer.
- [`docs/STATUS_TAXONOMY.md`](docs/STATUS_TAXONOMY.md) — proposal to map the 63 attack statuses onto a canonical set.
- [`public/wiki.html`](public/wiki.html) — human-readable spec of the game rules & formulas.

## Tech stack

- **Kaboom.js** v3000 (WebGL canvas, non-global mode) — chosen over DOM/SVG for
  performance at 400×400 + many entities.
- **Vite** (dev server + bundler), **Node** `node --test` (tests).
- **Persistence** — `localStorage` today; a server DB when multiplayer lands.
- **AI (optional)** — an LLM evaluates/narrates combat (OpenAI today; provider
  under review). Used as an optional layer over the deterministic resolver.

## Status

P0 (deterministic, schema-defined, client/server-shared foundation) is complete.
The multiplayer server (P1+) is planned and pending a few design decisions —
tracked in `docs/REQUIREMENTS.md`.
