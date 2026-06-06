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
- [x] **Energy partial reset (Q8)** — DONE (PR #28): every living team monster
      regains 50% of max energy at each encounter start (`restoreEnergyPartial`),
      so a depleted team isn't stuck skipping. _2026-06-06._
- [x] **Engine test suite** via Node's built-in runner (`npm test`, zero deps):
      `rng`, `stats`, `combat` covered — determinism, formulas, and the combat
      bug-fixes (enemy crit, status ticks). 19 tests green. _2026-06-06._
- [x] **Scene quality/bug pass** — fixed: text-input modals in `characterSelect`
      & `settings` stacked Kaboom input handlers on reopen, multiplying typed
      characters; now cancel the prior handler set. Flagged as decisions (no
      unilateral change): energy never regenerates between fights (Q8), vault kept
      on defeat (Q9). Minor (now **fixed**): monster/character ids used
      `Date.now()` (collision-prone in the same ms) → a `uid()` helper (`src/uid.js`).
- [x] Map-gen determinism test (`mapgen.test.js`): same seed → identical
      voidMap/monsters/tile placement; different seeds differ. Runs by default
      (~1.6s/gen). 21 tests total green. _2026-06-06._
- [x] Robustness: `loadGameData` now checks each response `.ok` and `init()`
      catches failures, showing an on-screen error instead of hanging on
      "Loading…" forever. README rewritten to match current architecture.
- [x] Wire `npm test` into CI — `.github/workflows/ci.yml` runs `npm ci`,
      `npm run build`, and `npm test` on every push/PR (currently **58 tests**).
- [x] **Animated player character** (`src/render/character.js`) drawn with Kaboom
      primitives (idle bob + walk cycle: bobbing, alternating legs/arms) — used for
      self + other players online and the single-player avatar, replacing the
      static sprite. _2026-06-06 (user request)._
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
- [x] **P1-T2** Persistence layer — **LIVE** (`server/db.js` + `store.js`, PR #25).
      Postgres-backed profile store: in-memory Map as the sync read cache;
      load-all-on-boot + coalescing write-through flush + flush-on-shutdown make
      profiles (identity/token, active team, vault) durable across redeploys. Railway
      Postgres connected + `DATABASE_URL` wired; **verified** (a token survived a
      redeploy; logs show `[store] persistence ON`). _2026-06-06._ Round-result
      history is a later add.
- [x] **P1-T3** Sessions: **anonymous + nickname** with a base inventory. New join
      → server issues a player id, an opaque session token, and 4 random Lv.1
      starters (via the shared engine factories); reconnecting with the token
      resumes the same profile. Behind a swappable `server/store.js` interface
      (in-memory now → DB in P1-T2). Smoke-tested. _Done 2026-06-06._ Google/Discord
      + native are later — see Auth roadmap.
- [x] **P1-T4** Matchmaking/lobby: `join` (session) → `queue` → matchmaker forms a
      round when full (16) or after a countdown with ≥ minPlayers, assigns a fresh
      seed, and transitions players to in-round. Multiple concurrent rounds ticked
      independently; players in a round see each other's positions. Countdown/min
      configurable (`MATCH_COUNTDOWN_S`, `MATCH_MIN_PLAYERS`). 2-player smoke-tested
      (matched to same round, movement visible). _Done 2026-06-06._
- [x] **P1-T5** Server-side map generation from the round seed (reuse P0 engine),
      done async off the tick loop: round stays "loading" until the map is ready,
      then each player gets a real walkable spawn via `findSpawnPoint` and a
      `roundStart` (world-px spawn). Decision: **send seed only** — clients
      regenerate the identical map. Tile/speed constants moved to shared `GAME`.
      Smoke-tested (valid spawn from seed). _Done 2026-06-06._
- [x] **P1-T6** Deployed on Railway. **One service runs the combined server**
      (`server/index.js`): `serve-handler` serves the built `dist/` over HTTP and
      `ws` runs the game on the **same port** — so the client connects to its own
      origin (`wss://tamersquest.com`), no separate service / `VITE_SERVER_URL`
      needed. `npm start` = `node server/index.js`; master auto-deploys.
      Smoke-tested (http + wiki + ws). _2026-06-06._ (DB persistence = P1-T2.)

### P2 — Networked map exploration
Depends on P1.

- [x] **P2-T1** Client online flow: `src/net.js` (framework-agnostic netclient,
      unit-tested + smoke), shared `src/netClient.js` singleton, and Kaboom scenes
      `onlineLobby` (nickname → connect → queue → matchmaking status) +
      `onlineGame` (live players as labelled dots, camera follow, WASD → server at
      ~20Hz, ESC to leave). "Play Online" entry on the start screen; single-player
      untouched. Builds; 26 tests green. _2026-06-06._ Map tile rendering for the
      online view comes with **P2-T4** (tile rework); other-player sprites in P2-T3.
- [x] **P2-T2** Server world tick (**15 Hz**): authoritative player positions
      (tickRound integrates movement + collision), broadcasts per-player snapshots
      (~7.5 Hz). Monsters **and players** are AoI-filtered (≤900px) — Q13 resolved
      (PR #42): rivals only appear within view range. _2026-06-06._
- [~] **P2-T3** Online view now **interpolates** render positions (self + remote
      players) toward authoritative snapshots and draws everyone as **sprites**
      (player sprite + monster sprites) instead of dots. Full client-side
      *prediction* (input responsiveness + reconciliation) is deferred — it needs
      live tuning; interpolation-only is smooth and drift-free. _2026-06-06._
- [x] **P2-T4** **Tile rendering rework** (online view): the lobby regenerates the
      map from the server seed (with a progress %), then `onlineGame` draws it as
      **culled, biome-colored rects** (from each tile's colour profile) — no
      per-frame sprite churn, void stays dark. _2026-06-06._ (Single-player
      `game.js` still uses the sprite-tile path; can adopt this later if desired.)
- [~] **P2-T5** **Map view rework**: **minimap/radar HUD** added (PR #27) —
      top-right radar showing the shrinking safe zone, extraction portals, nearby
      monsters/players, and your position over faint downsampled terrain, so you
      can navigate to extract. Remaining: main-view camera zoom-out / larger
      viewport tuning. _2026-06-06._
- [x] **P2-T6** Monsters server-authoritative + AoI: each round's monsters
      (from the seed) get a deterministic **visible/hidden split** (~35% hidden);
      snapshots include only nearby monsters — visible within AOI_RADIUS, hidden
      only within REVEAL_RADIUS (ambush). Client renders them as creature sprites.
      Smoke-tested (monsters arrive in snapshots). _2026-06-06._

### P3 — Combat & taming (networked)
Depends on P2. **Decisions resolved (Q1 instanced duel, Q2 FFA + PvE, Q3 AI-resolved).**

- [x] **P3-T1** Encounter trigger → instanced combat session on server (walk
      within `ENCOUNTER_RADIUS`; movement locked while fighting, others keep
      moving — instanced duel). Hidden monsters ambush. _2026-06-06._
- [x] **P3-T2** Turn resolution: **AI-resolved via OpenAI** (`server/ai.js`,
      gpt-4o) — the core feature — with the deterministic `engine/combat.js` as
      **automatic fallback** (no key / API error). Verified with a live call.
      _2026-06-06._ Later: capture transcripts → finetune a small/cheap model;
      tighten elemental-matchup correctness. (Catch stays deterministic for now.)
- [x] **P3-T3** Combat driven by server messages (`combatStart`/`combatUpdate`/
      `combatEnd`); **polished combat overlay** (PR #26): per-combatant element
      dot, color-coded HP bar + numbers, energy bar, and status chip; attack
      buttons are element-tinted, show EN cost, and dim when unaffordable. Inputs:
      tap buttons (mobile) or 1–4 / C / F (desktop). `monSnap` now carries
      `element` + `maxEnergy`. _2026-06-06._
- [x] **P3-T4** PvE wild-monster combat — smoke-tested (roam → fight → win/XP). _2026-06-06._
- [x] **P3-T5** FFA PvP (Q11) — **server + client done; gated by `PVP_ENABLED`
      (default off).** Server (`server/pvp.js`, PR #47): instant-on-collision duel,
      interactive dual-submit turns resolved by **AI with no deterministic fallback**
      (retry → no-contest), faint→advance, team-wipe → **winner loots the loser's
      active team** (loser refills, stays in the round); cleaned up on
      disconnect/extract/timeout. Client (PR #48): combat overlay handles PvP — "vs
      &lt;opponent&gt;" label, **"Waiting for your opponent…"** state, no Catch,
      generic win/lose/draw result; reducer carries `pvp`/`opponent`/`waiting`.
      **To enable:** set `PVP_ENABLED=true` on the Railway `web` service. _2026-06-06._
- [x] **P3-T6** Taming/catch, server-authoritative (`resolveCatch`; caught monster
      added to team or vault). _2026-06-06._

### P4 — Extraction round loop
Depends on P2 (P3 for full PvE/PvP).

- [x] **P4-T1** Server-authoritative round timer, shrinking safe zone, and portal
      spawns (within the closing circle), all configurable via env. Sent in
      snapshots (`time`/`circle`/`portals`). _2026-06-06._
- [x] **P4-T2** Extraction: stepping within `EXTRACT_RADIUS` of a portal extracts
      the player → survives, active team healed, gains kept, exits round. Client
      renders the zone, portals, and a countdown timer. _2026-06-06._
- [x] **P4-T3** Death (zone storm team-wipe or timeout) → `died`, and **loses the
      active run team** (decision Q10). Vault is kept (Q9); the team refills from
      the vault, or rolls fresh starters if empty (never leaves a player with
      nothing). _2026-06-06._
- [x] **P4-T4** Round-end result (`extracted`/`died`) sent to client (overlay →
      return to menu) and profile saved to the store. _2026-06-06._ (Durable DB
      persistence is P1-T2, pending Railway.)

### P5 — AI content generation pipeline
Independent. **Q4 resolved:** persist all generated content to the DB;
generate-on-empty, then ~90% reuse. Covers monsters, biomes, floor tiles.

- [~] **P5-T1** Generator core shipped & unit-tested (`server/gen.js`, PR #34):
      `normalizeGeneratedMonster` turns arbitrary LLM JSON into a clamped,
      schema-valid `MonsterType` (consumable by `getMonsterStats`/combat);
      `assignAttacks` gives it 4 attacks from the existing pool (v1 reuses
      attacks — bespoke attack generation is later); `aiGenerateMonster` does the
      live OpenAI call, **gated by `aiEnabled()`**. **Wired live (PR #46):**
      `server/content.js` generates → adds to the pool → persists to Postgres
      (`monster_types` table); a `/api/monstertypes` endpoint + client fetch
      (`data.js`) make generated monsters render their procedural sprites.
      **Generation is gated by `MONSTER_GEN_RATE` (default 0 = off)** — set it on
      Railway (e.g. `0.1`) to enable (costs OpenAI per generation).
- [x] **P5-T2** Reuse policy (`pickReuseOrGenerate`, PR #34): empty pool → generate;
      populated → ~**90% reuse / 10% new** (Q4). Live trigger: per round, with
      probability `MONSTER_GEN_RATE`, generate+persist one new monster (PR #46).
      Per-category quotas later.
- [~] **P5-T3** Generated data → procedural visual (already deterministic from
      name/element in `spritegen.js`). **Bestiary gallery** added (PR #35): a
      scrollable grid of every monster's procedural sprite (name/element/rarity),
      reachable from the start menu — art review + generated-content curation.
      Remaining: an approve/reject workflow once live generation persists to the DB.

### P6 — Polish, scale, anti-cheat
Ongoing / late.

- [x] **P6-T1** Reconnection + graceful disconnects (Q12). **Server** (PR #43): a
      dropped in-round player keeps their slot for a **120s** grace window; reconnect
      with the token resumes the round at the current position; no return in 120s →
      **death** (lose active team, per Q10). **Client** (PR #45): auto-reconnects in
      place (retries every 2s up to 120s, auto-re-joins with the token) showing
      "Reconnecting…", and only falls back to "Connection lost → menu" after giving
      up — no menu bounce. _2026-06-06._
- [~] **P6-T2** Anti-cheat audit (PR #30). Verified server authority: movement is
      direction-only at server `BASE_SPEED` (`clampAxis` guards NaN/±Inf), nick/
      inputs sanitized, combat actions ownership-checked. Fixed: combat now honors
      **only the monster's own attacks** (`ownedAttack`; was any global attack) and
      player positions are **clamped to the map**, and **tile collision** added
      (PR #31, slide-along-walls — walls were cosmetic before). Remaining:
      per-connection rate limiting. _2026-06-06._
- [~] **P6-T3** HUD/UX for multiplayer. Done (PR #29): **team-HP bars** (live,
      from `you.team` in snapshots), **outside-safe-zone danger warning** (pulsing
      red border + text), zone timer + players-in-view (info line), and the
      minimap (P2-T5). Remaining: a proper player list and a **kill feed** (the
      kill feed needs PvP / P3-T5). _2026-06-06._
- [ ] **P6-T4** Load/perf test 16 players; optimize snapshot bandwidth.
- [ ] **P6-T5** Audio, settings, final art pass.
- [~] **P6-T6** **Mobile + PWA** (lower priority). Done: onscreen joystick +
      tappable combat buttons; mobile HTML nickname input; **PWA — manifest +
      service worker + SVG & PNG (192/512) icons + iOS apple-touch-icon +
      standalone meta** (installable; no-zoom). Remaining: responsive-layout
      polish, single-player touch. (`scripts/gen-icon.mjs` regenerates the PNGs
      from the SVG via `npm i sharp --no-save`.)
- [x] **P6-T7** **UI pass** (user feedback): **white text** across all scenes —
      online lobby + game HUD/combat, and start / characterSelect / lobby /
      inventory / settings / runResult. Functional colors kept (HP bars, win/lose,
      delete-warning, element/status). _2026-06-06._

- [~] **P6-T8** **Separate game server (readiness).** Server runs WS-only via
      `SERVE_STATIC=false` (else combined, default); client already uses
      `VITE_SERVER_URL` (else same-origin); optional `ALLOWED_ORIGINS` guard. Live
      deploy stays combined for now — splitting is a config flip when scale needs it
      (the real work then is stateful round-routing). Steps in `REQUIREMENTS.md §7`.
      _2026-06-06._

### P7 — Admin panel (requested 2026-06-06)
An admin-only page (auth-gated — see Q14) with two areas. **Keep it continuously
updated**: whenever a new game parameter or generated asset type is added, surface
it here. Build incrementally.

- [x] **P7-T1** **Auth gate** (PR #49): `server/admin.js` gates `/api/admin/*` on an
      `ADMIN_TOKEN` env var (page prompts → `x-admin-token` header → server verifies;
      503 if unset, 401 if wrong). Q14 resolved (token, no user roles yet).
- [~] **P7-T2** **Settings editor** (PR #49): `public/admin.html` reads/writes the
      live-tunable `world.cfg` — players/round, round duration, circle-start, portal
      interval, `MONSTER_GEN_RATE`, `PVP_ENABLED` — validated/clamped server-side,
      applied to new rounds at runtime, and **persisted to Postgres** (`settings`
      table, reloaded on boot, override env). **Expanded (PR #50):** gameplay knobs
      now tunable too — player speed, storm DPS, encounter radius, hidden-monster %,
      energy-restore %, PvP radius (moved into `world.cfg`). Remaining: a few niche
      radii (AoI/reveal/extract) + structural consts (map/tile size) are kept fixed
      (seeded-gen/client-sync critical).
- [x] **P7-T3** **Generated-asset overview + curation** (PR #49, #52): the admin
      page lists AI-generated monsters and supports **generate-on-demand** and
      **remove** (drops from the pool + DB; guarded to generated types only).
      Procedural art for every monster is viewable in the **Bestiary** (linked).
      _2026-06-06._
- [x] **P7-T4** **Live ops view** (PR #51): admin panel polls `/api/admin/stats` —
      players online, queue, active rounds (per-round players/monsters/time), active
      combats + duels, monster-pool size, and recent run results (`world.recentResults`
      ring buffer). Read-only, ~3s refresh. _2026-06-06._

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
