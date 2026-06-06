# Tamers Quest — Implementation Archive

> **Purpose:** completed/old work moved out of `IMPLEMENTATION_PLAN.md` to keep the
> living plan lean **without losing the record**. Nothing here is active; it's the
> task-by-task history of shipped phases. The plan links here with a one-line summary.
> Convention: when a whole phase/section is fully `[x]` done and stable, move its
> detail here and leave a summary + this pointer in the plan.

---

## P0–P4 — Foundations → server → networking → combat → extraction (✅ shipped 2026-06-06)

### P0 — Foundations & determinism (no server yet)

- [x] **P0-T1** Shared `engine/` extracted & verified server-importable in Node:
      `rng`, `combat`, `schemas`, `stats`, `gamedata`, `mapgen`. `data.js` is a thin
      client loader (fetch → `setGameData`) re-exporting engine accessors, so scene
      imports were untouched. Client-only bits stay in `systems/` (`combat` LLM
      wrapper, `spritegen` canvas).
- [x] **P0-T2** Replaced all `Math.random()` in `mapgen.js` with a **seeded RNG**
      (`src/engine/rng.js`). `generateMap(onProgress, seed)` reproduces a map from a
      seed; monster ids deterministic.
- [x] **P0-T3** Deterministic combat resolver: `src/engine/combat.js` exports seeded
      pure `resolveTurn()` / `resolveCatch()` (speed order, both sides crit,
      Burn/Poison/Freeze/Stun tick & apply, synonym normalization). `systems/combat.js`
      delegates to it; AI is the optional narration/eval layer.
- [x] **P0-T4** Canonical schemas in `src/engine/schemas.js`: JSDoc typedefs
      (`MonsterType`, `Attack`, `MonsterInstance`, `PlayerProfile`, `RoundState`,
      `Snapshot`, `InputMsg`) + a frozen `GAME` constants object + factories/validators.
- [x] **P0-T5** Net protocol draft in `docs/PROTOCOL.md` (WS envelope, message tables,
      AoI snapshots, prediction/reconciliation, instanced combat flow).

### Quality / tests (early, ongoing)
- [x] Status taxonomy proposal — shelved by decision (Q7): the AI resolver interprets
      statuses; deterministic fallback keeps 4 canonical statuses for offline only.
- [x] Energy partial reset (Q8, PR #28): living team monsters regain 50% energy at each
      encounter (`restoreEnergyPartial`).
- [x] Engine test suite via Node's runner (`npm test`, zero deps): rng/stats/combat.
- [x] Scene quality/bug pass: fixed stacked text-input handlers in characterSelect &
      settings; `uid()` helper (`src/uid.js`) replacing `Date.now()` ids.
- [x] Map-gen determinism test (`mapgen.test.js`).
- [x] Robustness: `loadGameData` checks `.ok`; `init()` shows an on-screen error vs hanging.
- [x] CI: `.github/workflows/ci.yml` runs `npm ci` + build + test on push/PR.
- [x] Animated player character (`src/render/character.js`) — idle bob + walk cycle.

### P1 — Server skeleton, lobby, persistence
- [x] **P1-T1** Node WebSocket server (`server/index.js` + `world.js`, `ws`), 15 Hz tick,
      hello/join (anon+nickname), authoritative movement, ping/pong, ~7.5 Hz snapshots,
      round seed, shared `engine/` server-side.
- [x] **P1-T2** Persistence (`server/db.js` + `store.js`, PR #25): Postgres profile store
      (in-memory read cache + write-through + flush-on-shutdown); durable across redeploys.
- [x] **P1-T3** Sessions: anonymous + nickname + 4 random Lv.1 starters; token resume;
      swappable `store.js` interface.
- [x] **P1-T4** Matchmaking/lobby: join → queue → matchmaker forms a round (≤16 or
      countdown ≥ minPlayers), fresh seed; concurrent rounds ticked independently.
- [x] **P1-T5** Server-side seeded map gen async off the tick loop; walkable spawns via
      `findSpawnPoint`; **send seed only** (clients regenerate the identical map).
- [x] **P1-T6** Deployed on Railway — one combined service (`serve-handler` HTTP + `ws`
      on one port); `master` auto-deploys; live at `wss://tamersquest.com`.

### P2 — Networked map exploration
- [x] **P2-T1** Client online flow: `src/net.js` (unit-tested netclient), `netClient.js`
      singleton, `onlineLobby` + `onlineGame` scenes; "Play Online" entry.
- [x] **P2-T2** Server world tick (15 Hz): authoritative positions + collision; per-player
      snapshots (~7.5 Hz); monsters + players AoI-filtered (≤900px, Q13).
- [~] **P2-T3** Online view interpolates render positions toward snapshots + draws sprites.
      Full client-side prediction deferred (interpolation-only is smooth/drift-free).
- [x] **P2-T4** Tile rendering rework (online view): culled biome-colored rects from seed.
- [~] **P2-T5** Minimap/radar HUD (PR #27): safe zone, portals, nearby monsters/players,
      position over downsampled terrain. Remaining: main-view camera zoom-out tuning.
- [x] **P2-T6** Monsters server-authoritative + AoI; deterministic visible/hidden split
      (~35% hidden, ambush within REVEAL_RADIUS).

### P3 — Combat & taming (networked)
- [x] **P3-T1** Encounter → instanced combat session (walk within `ENCOUNTER_RADIUS`;
      movement locked while fighting, others keep moving). Hidden monsters ambush.
- [x] **P3-T2** Turn resolution: AI-resolved via OpenAI (`server/ai.js`) with the
      deterministic engine as automatic fallback.
- [x] **P3-T3** Combat driven by server messages (`combatStart`/`combatUpdate`/`combatEnd`);
      polished combat overlay (element dot, HP/energy bars, status chip, element-tinted
      attack buttons with EN cost; 1–4/C/F or tap).
- [x] **P3-T4** PvE wild-monster combat (roam → fight → win/XP).
- [x] **P3-T5** FFA PvP (Q11) — turned on by default (`PVP_ENABLED !== "false"`);
      `server/pvp.js`: deterministic engine fallback + thrower first-turn initiative;
      triggers on collision **and** landing a chain; winner loots the loser's active team
      (`pvp.test.js`). ⚠️ Contact-trigger tuning open (may want chain-only/intentional PvP).
- [x] **P3-T6** Taming/catch server-authoritative (`resolveCatch`; caught → team or vault).

### P4 — Extraction round loop
- [x] **P4-T1** Server-authoritative round timer, shrinking safe zone, portal spawns
      (env-configurable); sent in snapshots (`time`/`circle`/`portals`).
- [x] **P4-T2** Extraction: step within `EXTRACT_RADIUS` of a portal → survive, team
      healed, gains kept, exit round. Client renders zone/portals/timer.
- [x] **P4-T3** Death (zone storm team-wipe or timeout) → `died`, loses the active run
      team (Q10); vault kept (Q9); team refills from vault or fresh starters.
- [x] **P4-T4** Round-end result (`extracted`/`died`) → client overlay + profile saved.
