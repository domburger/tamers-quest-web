# Tamers Quest — Implementation Plan

> Living plan for porting Tamers Quest into a **real-time, online multiplayer
> extraction game** (Dark-and-Darker-style) with AI-generated monsters,
> AI-evaluated fights, and procedurally-rendered visuals on Kaboom.js.
>
> Source of truth for tasks. Check items off as they land. See
> `public/wiki.html` for the game-logic spec this plan implements.

Last updated: 2026-06-06

---

## Locked decisions

| Decision | Choice |
|---|---|
| Rendering | **Kaboom.js (WebGL canvas)** — procedural shapes, no PNGs. DOM/SVG rejected for perf at 400×400 + 16 players. |
| Multiplayer | **Real online multiplayer**, authoritative server, up to 16 players/round. |
| Monster visuals | Procedural (done — `src/systems/spritegen.js`). |
| Monster data | AI-generated content pipeline (offline), runtime uses the generated pool. |
| Combat | Turn-based, **AI-evaluated server-side** with deterministic fallback. |
| Map | Keep DLA + Voronoi biome gen; rework tile rendering + map view. |

## Critical architectural shift

The current game is **client-only single-player**: all state in `localStorage`,
all logic in the browser, `Math.random()` everywhere. Real multiplayer requires
an **authoritative server** that owns state and validates everything (it's PvP
with loot — clients cannot be trusted). This is the backbone of the whole plan.

```
┌─────────────┐   WebSocket    ┌──────────────────────┐
│  Browser    │ ◄────────────► │  Authoritative server │
│  (Kaboom    │   snapshots /  │  (Node.js)            │
│   renderer  │   inputs       │  - matchmaking/lobby  │
│   + input)  │                │  - map gen (seeded)   │
└─────────────┘                │  - world tick         │
                               │  - combat (AI eval)   │
                               │  - persistence (DB)   │
                               └──────────────────────┘
```

---

## OPEN DESIGN QUESTIONS (resolve before the dependent phase)

These genuinely change the build; flagged at the phase that needs them.

1. **Turn-based combat in a real-time world (P3).** When two players (or a
   player + monster) fight, does the rest of the 16-player world keep moving?
   Options: (a) instanced duel that pauses only the two combatants, others move
   on; (b) brief global freeze; (c) make combat real-time. Recommend (a).
2. **PvP combat rules (P3).** Can players fight each other's monster teams, or
   only wild monsters? Loot stealing on PvP kill?
3. **AI fight latency/cost (P3).** LLM turn eval takes seconds and costs money;
   unworkable for live PvP. Options: AI only for PvE/narrative, deterministic
   engine for PvP; or pre-warm/async. Recommend deterministic-authoritative
   resolution + optional AI narration.
4. **AI monster generation timing (P5).** Generate a fixed pool offline (admin
   tool / seasonal), not per-round at runtime (too slow/costly). Confirm.
5. **Hosting (P1/P6).** Railway is available via MCP. Confirm target: server +
   DB on Railway, static client on Railway/CDN.
6. **Account/auth model (P1).** Guest sessions vs real accounts; what identifies
   a returning player and their base monster inventory.
7. **Status taxonomy (P0-T3, now).** Attack data inflicts ~50 distinct status
   labels (Bleed, Blind, Confusion, Fear, Paralysis, Drowning…) plus several
   buffs (Heal, Regeneration, Shielded, Reflect). Only Burn/Poison/Freeze/Stun
   have mechanics; the rest are stored but inert. How should they behave?
   Recommend: I draft a small canonical taxonomy (~8–10 effects) and map every
   label onto it. See `docs/REQUIREMENTS.md §4`.

---

## Phases & tasks (in sequence)

Legend: `[ ]` todo · `[~]` in progress · `[x]` done

### P0 — Foundations & determinism (no server yet)
Prereq for everything; safe to start now.

- [x] **P0-T1** Shared `engine/` extracted & verified server-importable in Node:
      `rng`, `combat`, `schemas`, `stats`, `gamedata`, `mapgen`. `data.js` is now a
      thin client loader (fetch → `setGameData`) that re-exports engine accessors,
      so scene imports were untouched. Client-only bits stay in `systems/`
      (`combat` LLM wrapper, `spritegen` canvas). _Done 2026-06-06._

> **P0 COMPLETE (T1–T5).** Game logic is deterministic, schema-defined, and
> client/server-shared. Next: **P1 (server)** — but it needs answers to OPEN
> Q5/Q6 (and Q1/Q3 for P3). Until then, safe non-blocked work: status-taxonomy
> draft (Q7), tests, bug/quality passes.

### Quality / tests (non-blocked, ongoing)
- [x] **Status taxonomy proposal** (`docs/STATUS_TAXONOMY.md`) — 63 labels mapped
      onto 12 canonical effects; awaiting your sign-off (Q7) before implementing.
- [x] **Engine test suite** via Node's built-in runner (`npm test`, zero deps):
      `rng`, `stats`, `combat` covered — determinism, formulas, and the combat
      bug-fixes (enemy crit, status ticks). 19 tests green. _2026-06-06._
- [x] **Scene quality/bug pass** — fixed: text-input modals in `characterSelect`
      & `settings` stacked Kaboom input handlers on reopen, multiplying typed
      characters; now cancel the prior handler set. Flagged as decisions (no
      unilateral change): energy never regenerates between fights (Q8), vault kept
      on defeat (Q9). Minor noted: monster ids use `Date.now()` (collision-prone).
- [ ] Add map-gen determinism test (same seed → identical `voidMap`).
- [ ] Wire `npm test` into CI once the server/repo CI exists.
- [x] **P0-T2** Replace all `Math.random()` in `mapgen.js` with a **seeded RNG**
      (`src/engine/rng.js`). `generateMap(onProgress, seed)` now reproduces a map
      from a seed and returns it; monster ids deterministic. _Done 2026-06-06._
- [x] **P0-T3** Deterministic combat resolver: `src/engine/combat.js` exports
      seeded pure `resolveTurn()` / `resolveCatch()` (speed-based order, both
      sides crit, Burn/Poison/Freeze/Stun tick & apply, synonym normalization).
      `systems/combat.js` fallback now delegates to it; AI path is the optional
      narration/eval layer. Verified in Node (determinism + effects). _Done
      2026-06-06._ ⚠️ Non-canonical statuses inert — see OPEN Q7.
- [x] **P0-T4** Canonical schemas in `src/engine/schemas.js`: JSDoc typedefs for
      `MonsterType`, `Attack`, `MonsterInstance`, `PlayerProfile`, `RoundState`,
      `Snapshot`, `InputMsg` + a frozen `GAME` constants object (now the source of
      truth — `game.js` reads round timings from it) + pure factories/validators.
      _Done 2026-06-06._
- [x] **P0-T5** Net protocol draft in `docs/PROTOCOL.md`: WebSocket envelope,
      client/server message tables, AoI snapshots, prediction/reconciliation,
      instanced combat flow. _Done 2026-06-06 (blocked on Q1/Q3/Q6 for final shape)._

### P1 — Server skeleton, lobby, persistence
Depends on P0. **Resolve open Q5, Q6 first.**

- [ ] **P1-T1** Node.js server (WebSocket, e.g. `ws`) with a tick loop scaffold.
- [ ] **P1-T2** Persistence layer (start SQLite, Postgres-ready): players,
      monster inventory, round results. Replace `localStorage` as source of truth.
- [ ] **P1-T3** Auth/session (per Q6) — issue player identity + base inventory.
- [ ] **P1-T4** Matchmaking/lobby: queue players → form a round (≤16) → assign
      map seed → transition to in-round.
- [ ] **P1-T5** Server-side map generation from seed (reuse P0 engine). Decide:
      send seed only (clients regenerate) vs send tile payload. Default: seed +
      lazy client regen.
- [ ] **P1-T6** Deploy target stood up (Railway per Q5): server + DB.

### P2 — Networked map exploration
Depends on P1.

- [ ] **P2-T1** Client connects, joins a round, regenerates map from seed,
      spawns at server-assigned point.
- [ ] **P2-T2** Server world tick (10–20 Hz): authoritative player positions;
      broadcast area-of-interest snapshots.
- [ ] **P2-T3** Client-side prediction + interpolation for own + remote players;
      render up to 15 other tamers.
- [ ] **P2-T4** **Tile rendering rework** (per notes "display not optimal"):
      chunked tile drawing, culling, better biome-colored tiles, no per-frame
      sprite churn.
- [ ] **P2-T5** **Map view rework**: camera/zoom, readability, larger viewport.
- [ ] **P2-T6** Monster spawns server-authoritative; **visible vs hidden**
      monsters (fog/stealth) — server decides what each client sees.

### P3 — Combat & taming (networked)
Depends on P2. **Resolve open Q1, Q2, Q3 first.**

- [ ] **P3-T1** Encounter trigger → instanced combat session on server.
- [ ] **P3-T2** Authoritative turn resolution (P0-T3 engine); AI eval/narration
      layer optional per Q3.
- [ ] **P3-T3** Combat UI re-driven by server messages (client sends actions,
      renders results) — adapt existing `fight.js`.
- [ ] **P3-T4** PvE wild-monster combat.
- [ ] **P3-T5** PvP combat (per Q2) incl. loot/consequence rules.
- [ ] **P3-T6** Taming/catch, server-authoritative (port `fallbackCatch`).

### P4 — Extraction round loop
Depends on P2 (P3 for full PvE/PvP).

- [ ] **P4-T1** Server-authoritative round timer (600s), shrinking safe zone
      (starts 300s), portal spawns (every 30s after 300s).
- [ ] **P4-T2** Extraction: stepping on a portal extracts the player → keeps
      caught loot, exits round.
- [ ] **P4-T3** Death: team wiped or caught in zone → lose run team; consequence
      per current rules (4 random Lv.1 starters) or revised.
- [ ] **P4-T4** Round-end results persisted to account; return to menu.

### P5 — AI monster generation pipeline
Independent; **resolve Q4.** Visuals already procedural.

- [ ] **P5-T1** Offline generator: LLM produces `MonsterType` records (stats,
      scaling, attacks, element, lore) validated against schema.
- [ ] **P5-T2** Map generated data → procedural visual (already deterministic
      from name/element in `spritegen.js`).
- [ ] **P5-T3** Tooling to review/curate generated monsters into the live pool.

### P6 — Polish, scale, anti-cheat
Ongoing / late.

- [ ] **P6-T1** Reconnection handling, graceful disconnects.
- [ ] **P6-T2** Anti-cheat audit (all authority server-side; validate inputs).
- [ ] **P6-T3** HUD/UX for multiplayer (player list, kill feed, zone timer).
- [ ] **P6-T4** Load/perf test 16 players; optimize snapshot bandwidth.
- [ ] **P6-T5** Audio, settings, final art pass.

---

## Recommended starting point

Begin **P0** now — it's pure refactor (deterministic engine + schemas), unblocks
the server, and carries no open questions. In parallel, get answers to Q1–Q6 so
P1/P3 aren't blocked when we reach them.
