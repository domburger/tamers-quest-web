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
| Rendering | **Kaboom.js (WebGL canvas)** — procedural shapes, no PNGs. |
| Multiplayer | **Real online multiplayer**, authoritative server, ≤16 players/round, **free-for-all (no allied teams)**. |
| Combat model | **Instanced duel** (others keep moving); **PvE vs wild monsters + FFA PvP**; some monsters hidden. |
| Combat resolution | **AI-resolved (core selling point)**; deterministic `engine/combat.js` = offline fallback + training-data baseline. Research: finetune a small model on live big-model transcripts. |
| Monster visuals | Procedural (done — `src/systems/spritegen.js`). |
| Content data | AI-generated, **persisted to DB**; generate-on-empty, then **~90% reuse** (monsters, biomes, tiles…). |
| Hosting | **Railway** — server + DB + client. |
| Auth | **Anonymous + nickname** first → Google/Discord → (later) native. |
| Map | Keep DLA + Voronoi biome gen; rework tile rendering + map view. |
| Status effects | **No taxonomy** — AI interprets/executes statuses during fights (`STATUS_TAXONOMY.md` shelved). |

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

## RESOLVED DESIGN DECISIONS (2026-06-06)

All previously-open questions are answered (full text in `docs/REQUIREMENTS.md §4`):

1. **Combat world model** → instanced duel (others keep moving).
2. **PvP** → free-for-all, no allied teams; PvE vs wild monsters; some hidden.
3. **AI combat** → AI resolves fights (core feature); deterministic engine is the
   offline fallback + training-data baseline; research a small finetuned model
   trained on live big-model transcripts.
4. **Content generation** → persist all generated content to the DB; generate-on-
   empty, then ~90% reuse (monsters, biomes, tiles…). Per-category quotas TBD.
5. **Hosting** → all on Railway (server + DB + client).
6. **Auth** → anonymous + nickname first → Google/Discord → native later.
7. **Status effects** → no taxonomy; the AI interprets/executes statuses during
   fights. `docs/STATUS_TAXONOMY.md` is shelved (deterministic fallback keeps its
   4 canonical statuses for offline only).
8. **Energy between fights** → partial reset per encounter (revisit later).
9. **Vault on defeat** → acceptable (vault not reachable mid-run).

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
- [x] **Status taxonomy** — proposal written, then **shelved by decision (Q7)**:
      the AI resolver interprets statuses, not a fixed table. Deterministic
      fallback keeps its 4 canonical statuses for offline only.
- [ ] **Energy partial reset (Q8)** — restore monster energy partially at the
      start of each encounter so teams don't get stuck skipping. Small, decided.
- [x] **Engine test suite** via Node's built-in runner (`npm test`, zero deps):
      `rng`, `stats`, `combat` covered — determinism, formulas, and the combat
      bug-fixes (enemy crit, status ticks). 19 tests green. _2026-06-06._
- [x] **Scene quality/bug pass** — fixed: text-input modals in `characterSelect`
      & `settings` stacked Kaboom input handlers on reopen, multiplying typed
      characters; now cancel the prior handler set. Flagged as decisions (no
      unilateral change): energy never regenerates between fights (Q8), vault kept
      on defeat (Q9). Minor noted: monster ids use `Date.now()` (collision-prone).
- [x] Map-gen determinism test (`mapgen.test.js`): same seed → identical
      voidMap/monsters/tile placement; different seeds differ. Runs by default
      (~1.6s/gen). 21 tests total green. _2026-06-06._
- [x] Robustness: `loadGameData` now checks each response `.ok` and `init()`
      catches failures, showing an on-screen error instead of hanging on
      "Loading…" forever. README rewritten to match current architecture.
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
Depends on P0. **Decisions resolved (Q5 Railway, Q6 auth) — ready to build.**

- [x] **P1-T1** Node.js WebSocket server (`server/index.js` + `server/world.js`,
      `ws`) with a 15Hz tick loop. Handles hello/join (anonymous+nickname),
      authoritative movement, ping/pong, and ~7.5Hz snapshots; assigns a round
      seed; imports the shared `engine/` and loads game data server-side. Smoke-
      tested (full handshake + movement). `npm run server`. _Done 2026-06-06._
- [ ] **P1-T2** Persistence layer (start SQLite, Postgres-ready): players,
      monster inventory, round results. Replace `localStorage` as source of truth.
- [x] **P1-T3** Sessions: **anonymous + nickname** with a base inventory. New join
      → server issues a player id, an opaque session token, and 4 random Lv.1
      starters (via the shared engine factories); reconnecting with the token
      resumes the same profile. Behind a swappable `server/store.js` interface
      (in-memory now → DB in P1-T2). Smoke-tested. _Done 2026-06-06._ Google/Discord
      + native are later — see Auth roadmap.
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
Depends on P2. **Decisions resolved (Q1 instanced duel, Q2 FFA + PvE, Q3 AI-resolved).**

- [ ] **P3-T1** Encounter trigger → instanced combat session on server (others
      keep moving — instanced duel).
- [ ] **P3-T2** Turn resolution: **AI resolves the fight** (core feature) with the
      deterministic `engine/combat.js` as offline fallback + critic. Capture
      transcripts for the small-model finetuning track.
- [ ] **P3-T3** Combat UI re-driven by server messages (client sends actions,
      renders results) — adapt existing `fight.js`.
- [ ] **P3-T4** PvE wild-monster combat.
- [ ] **P3-T5** FFA PvP (no allied teams) incl. loot/consequence rules on a kill.
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

### P5 — AI content generation pipeline
Independent. **Q4 resolved:** persist all generated content to the DB;
generate-on-empty, then ~90% reuse. Covers monsters, biomes, floor tiles.

- [ ] **P5-T1** Generator: LLM produces `MonsterType` (later biome/tile) records
      validated against schema; **every record is saved to the DB.**
- [ ] **P5-T2** Reuse policy: empty pool → generate the full set; once populated,
      target **~90% reuse / ~10% new** per session (per-category quotas TBD).
- [ ] **P5-T3** Generated data → procedural visual (already deterministic from
      name/element in `spritegen.js`); review/curation tooling.

### P6 — Polish, scale, anti-cheat
Ongoing / late.

- [ ] **P6-T1** Reconnection handling, graceful disconnects.
- [ ] **P6-T2** Anti-cheat audit (all authority server-side; validate inputs).
- [ ] **P6-T3** HUD/UX for multiplayer (player list, kill feed, zone timer).
- [ ] **P6-T4** Load/perf test 16 players; optimize snapshot bandwidth.
- [ ] **P6-T5** Audio, settings, final art pass.

---

## Recommended starting point

**P0 is done and all decisions are resolved → begin P1 (the authoritative
server).** Suggested order: P1-T1 (WS server + tick) → P1-T3 (anonymous+nickname
auth) → P1-T2 (persistence) → P1-T4 (lobby/matchmaking) → P1-T5 (seeded map) →
P1-T6 (Railway deploy). The deterministic engine + schemas are ready to import
server-side.

### Auth roadmap (Q6)
1. Anonymous + nickname (P1-T3).  2. Google + Discord OAuth.  3. (Later) native or
other providers.
