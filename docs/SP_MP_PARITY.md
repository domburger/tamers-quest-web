# SP / MP parity — the shared-engine contract (PT2-T11)

> **Status: ACTIVE — user-greenlit TOP PRIORITY 2026-06-07. Driver: `@coordinator`.**
> Goal: single-player and multiplayer run the **same game logic**. SP becomes *"MP against a
> local-only server stub"* — scenes render; the engine + a server (real WS for MP, in-process
> stub for SP) own all rules. This kills the class of playtest bugs caused by two drifting
> codepaths (separate rosters, SP map lagging MP, divergent combat/collision, init-state leaks).

## The contract
- **All game rules live in `src/engine/*` and `server/*`.** Scenes (`game.js`, `onlineGame.js`,
  `fight.js`) only **render** state + **send intents**. No combat math, mapgen, inventory, movement
  physics, reward/economy, or collision logic in a scene.
- **One resolver per concern**, consumed by both SP and MP:
  | Concern | Shared module (target) | Notes |
  |---|---|---|
  | Combat | `engine/combat.js` + `server/ai.js` (AI-only per FGT-T1) | same turn resolution SP↔MP |
  | Map gen | `engine/mapgen.js` | seeded; SP + MP identical for a seed (already true) |
  | Rewards/economy | `engine/progression.js` | ✅ done (P10-T4/T5: grantXp, defeat/chest gold+essence) |
  | Storm/zone dmg | `engine/progression.js stormDamageTeam` | ✅ done (P10-T5) |
  | Energy restore | shared helper | ✅ done (P10-T5, Q8) |
  | Movement/collision | `engine/movement.js` | body-edge collide done (PT2-T06); finish water/edge |
  | Character/roster | `server/store.js` (single source) | **OPEN** — SP+MP share one roster (PT2-T01) |
  | Inventory | `engine/inventory.js` (new, INV-T1) | **OPEN** — extract slot/swap/equip from scenes |
- **SP server stub:** a thin in-process module exposing the same message surface as the WS
  `handleMessage`, so `game.js` talks to it exactly like `onlineGame.js` talks to the WS — no
  separate SP rule code. (Stretch goal; incremental.)
- **Proof obligation:** a snapshot test feeding identical inputs to the SP path and the MP path
  must produce **identical** resolved state (combat outcome, rewards, collision).

## Already shared (the seed — don't redo)
`engine/progression.js` reward/storm/energy helpers (P10-T3/T4/T5); `engine/mapgen.js` (seeded,
identical maps); `render/tiles.js`/`character.js` (shared draw); body-edge collision (PT2-T06).

## Sub-task sequence (land incrementally behind the green gate)
1. **PARITY-1 — Combat resolver unification** (ties FGT-T1 AI-only): one `resolveTurn` path for
   SP+MP; remove the per-turn AI↔deterministic flip; SP routes through the same AI judge. *(highest
   value — fixes the playtest's combat divergence + the AI-only directive in one move.)*
2. **PARITY-2 — Single roster/character source** (PT2-T01/T04): `server/store.js` is the one roster;
   SP mirrors it locally for offline; fresh chars init at full HP (fixes PT2-T04). One char usable in both modes.
3. **PARITY-3 — Inventory engine** (INV-T1): extract swap/equip/vault-cap into `engine/inventory.js`;
   both scenes + server consume it (also fixes PT1-T15/T16).
   ◑ **In progress (flexible worker, 2026-06-07):** `engine/inventory.js` now holds four shared rules:
   • **`addCaughtMonster`** (team-or-vault placement, capped at base + Deep Vault, else released) — the
     catch rule inlined identically in MP `world.js` and SP `fight.js`. **Both modes now consume it**
     (MP wired by me; SP `fight.js` wired by another loop) → one cap rule, no drift. 5 unit tests.
   • **`applyRoster`** (rebuild active team from an id list, rest → vault, capped) — **moved out of
     `world.js`** into the engine and re-exported from `world.js`, so the `setRoster` handler + tests are
     unchanged but the roster rule is now SP-consumable. (Distinct from the dead `schemas.js clampRoster`,
     which clamps an existing roster — left as-is.) 258 tests + build green.
   • **`equipChain`** (owned-gate + set `equippedChainId`) — **both modes wired**: MP `setEquippedChain`
     handler + the SP `inventory.js` scene tap. Untrusted-id reject tested.
   • **`nextChainId`** (pure cycle of owned chains by `[`/`]`, wraps, null when ≤1) — **both scenes wired**:
     SP `game.js` + MP `onlineGame.js` `cycleChain` were byte-identical; now one helper. 7 unit tests; 260 green.
   **Next:** the SP roster **swap/field/store** logic (SP `inventory.js`/MP `roster.js` tap-to-field) →
   reuse `applyRoster`, then point the SP roster/inventory scenes fully at the engine helpers.
4. **PARITY-4 — Shared map render/collision** (PT2-T05/T06): SP uses the MP renderer + the same
   collision grid; finish water (PT1-T19) + map-edge (PT1-T23).
5. **PARITY-5 — SP server stub**: route `game.js` through an in-process stub mirroring `handleMessage`.
6. **PARITY-6 — Parity snapshot test**: identical-inputs → identical-outputs assertion in CI.

## Rules of engagement
- **Incremental + always-green:** each PARITY-N lands behind `npm run check` (lint+test+build), no
  big-bang merge. Coordinate file ownership (scenes are `@visual`/`@feature`; `src/compat/*`,
  `main.js`, `index.html` stay `@phaser`).
- Update `public/wiki.html` when a mechanic moves/changes. Log surprises in `docs/BUGFIX_LOG.md`.
