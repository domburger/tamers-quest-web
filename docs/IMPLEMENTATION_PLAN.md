# Tamers Quest — Implementation Plan

> Living plan for porting Tamers Quest into a **real-time, online multiplayer
> extraction game** (Dark-and-Darker-style) with AI-generated monsters,
> AI-evaluated fights, and procedurally-rendered visuals on Phaser 3.
>
> Source of truth for tasks. Check items off as they land. See
> `public/wiki.html` for the game-logic spec this plan implements.

Last updated: 2026-06-06

---

## Agents & ownership (coordinator-managed)

> **Source of truth for who is doing what.** Agents run as independent `/loop` sessions.
> **Rules:** (1) every open/in-progress task has exactly one **Owner** drawn from the roster
> below; (2) a task may **only** be owned by a *confirmed* roster agent — **no phantom
> owners**; (3) `@unassigned` is *not an agent* — it means free-to-claim; (4) to take work,
> first add yourself to the roster (with a heartbeat artifact that proves you exist), then
> put your handle in the ownership table. The coordinator validates rules 1–3 every loop.

### Agent roster
| Handle | Role | Heartbeat / how identified | Status |
|---|---|---|---|
| `@coordinator` | Cross-agent coordination; source-of-truth upkeep; unblock & route work; validate this section | this cron `/loop` session | **confirmed** |
| `@watchdog` | Systematic bug-hunt + review of freshly-landed code; quality gate | appends `docs/BUGFIX_LOG.md` (≈iter 23) | **confirmed** |
| `@phaser` | Rendering engine; owns `src/compat/*`, `src/main.js` bootstrap, `index.html`. Migration **LANDED 2026-06-06**; now: native-refactor hot scenes / retire shim | user-directed; ack'd in `BUGFIX_LOG` iter 22 | **confirmed** |
| `@feature` | Gameplay feature dev (Spirit Chains throw/capture, chests + extraction stakes, gold economy + SP/MP shop, sprint/stamina, Hydra Lash multi-capture) | owns `src/engine/spiritchains.js`, `src/engine/movement.js`, `src/scenes/shop.js`, `src/scenes/onlineShop.js`, `public/assets/data/spiritchains.json` | **confirmed (2026-06-06)** |
| `@visual` | In-round render polish + visual-QA tooling; also shipped the kill feed | authored `tools/shoot-round.mjs` (in-round screenshot harness) + `src/render/tiles.js` (textured floor); this `/loop` | **confirmed** |

_New agent? Add a row with a real heartbeat artifact (a file you own, a log you append to,
a branch you push), set Status to **confirmed**, then claim tasks below._

### Open / in-progress task ownership
Only handles marked **confirmed** above may own a task. Everything else is `@unassigned`.

| Task | Owner | Notes |
|---|---|---|
| Kaboom → Phaser 3 migration | `@phaser` | ✅ **DONE** 2026-06-06 (shim landed + verified) |
| Phaser follow-up: native-refactor hot scenes, retire shim | `@phaser` | low-pri; see migration note |
| Bug hunt / review (ongoing) | `@watchdog` | `docs/BUGFIX_LOG.md` |
| Plan / wiki / source-of-truth upkeep | `@coordinator` | this section + drift checks |
| P2-T3 client-side prediction/reconciliation | `@unassigned` | deferred |
| P2-T5 main-view camera zoom-out | `@unassigned` | **blocked**: needs `k.camScale`/zoom in the shim (`@phaser`) — shim is pan-only (`camPos`) today |
| P5-T1 live monster-gen tuning | `@unassigned` | gated by `MONSTER_GEN_RATE` |
| P5-T3 bestiary approve/reject workflow | `@unassigned` | |
| P6-T3 player list + kill feed | `@visual` | ✅ both done: kill feed (P8-T5) + rivals-in-view list (HUD info line); in working tree |
| P6-T4 16-player load/perf test | `@coordinator` | ✅ **DONE**: bandwidth guard (`server/perf.test.js`) + load harness (`tools/loadtest.mjs`); 16p = avg 0.10 ms/tick, ~141 KB/s — big headroom |
| P6-T6 single-player touch controls | `@unassigned` | |
| P6-T8 server split (config flip) | `@unassigned` | |
| P7-T2 remaining radii tunables | `@unassigned` | |
| P8-T3 round-end gains summary | `@visual` | ✅ built (server run-deltas + result-screen "THIS RUN" line + tests); in working tree |
| P8-T5 kill feed | `@visual` | built: server broadcast (`world`/`pvp`) + HUD (`onlineGame`), tested; in working tree |
| P8-T6 audio / procedural SFX | `@visual` | ✅ broad coverage now (`src/systems/audio.js`, Web Audio, no assets), `M` mute (persisted), default ON. **MP in-round** via net events (encounter/hit/catch/win/lose/extract/defeat). **Menu** SFX (hover/click) wired centrally in `theme.js addButton` → all themed scenes. **MP interaction** SFX (footsteps, level-up, chest-open) via state-diffs in `onlineGame`. ✅ **SP-combat SFX now wired** (`fight.js`, 2026-06-06): button hover/click + hit (on attack) + catch + win + level-up + lose — SP combat was silent (its `makeBtn` isn't `theme.addButton`); build+148 tests, no breakage. **Un-ear-tested** (headless) — recipes in `audio.js` easily tuned. Remaining (low-pri): MP combat-overlay buttons are immediate-mode (no click sound); scene-transition SFX needs a `main.js` hook (@phaser). |
| P8-T8 how-to-play / onboarding | `@visual` | ✅ first-run in-round overlay (onlineGame); dismiss on move/tap; localStorage once; verified via shoot-round (shows idle, gone after move). In working tree |
| Spirit Chains (throw→engage→capture, 5 tiers + 3 specials) | `@feature` | ✅ shipped+tested SP+MP; wiki `#chains`. Scene registration via `featureScenes.js` registry (see seam note below) |
| Chest loot + extraction stakes | `@feature` | ✅ chests vs walls, run-found chains banked on extract / lost on death; wiki `#chains` |
| Gold economy + spirit shop | `@feature` | ✅ earn (defeat/extract) + SP shop scene + online shop scene + server `buyChain`; needs `main.js` registration (see note) |
| Sprint / stamina traversal | `@feature` | ✅ hold-Shift sprint, `engine/movement.js` + `GAME.SPRINT`, SP+MP + HUD bars; wiki `#movement` |
| P9-T6 Hydra Lash multi-capture | `@feature` | ✅ **DONE** (`clusterTargets` + sequential multi-capture SP+MP, tested); wiki Hydra Lash row |
| P9-T8 chain crafting | `@feature` | ✅ **DONE 2026-06-06** — **Spirit Essence** material (`+2`/defeat, `+3`/chest; persists) spent to **upgrade** an owned base chain to the next tier (consumes the lower; cost 40×tier). Pure `craftUpgrade`/`upgradeTargetFor`/`upgradeCost` (`schemas.js`, tested). SP: Inventory → Spirit Chains tab Upgrade buttons. MP: server `craftChain` handler + essence sync + Upgrade buttons in `onlineShop`. Build+152 tests; wiki acquisition + progression. |
| Controller / gamepad support | `@visual` | ✅ **increment 1** (online game): `src/systems/gamepad.js` (isolated, tested) → `onlineGame` movement (stick/d-pad) + combat (A/B/X/Y=atk1-4, LB=catch, RB=flee) + throw (A/RT roaming) + onboarding-dismiss, via the same handlers as keyboard. Build+133 tests+no client errors; un-gamepad-tested (user verifies feel). **Follow-up:** menu navigation + SP `fight` scene |
| P10 SP/MP parity & code-reuse audit | `@coordinator` | T1 audit ✅ + T4 ✅ (`grantXp`→`engine/progression.js`, tested); T2/T3/T5/T6 open w/ findings — see P10 |
| Mobile onscreen controls overhaul | `@visual` | **user-requested 2026-06-06** — "need to be much better." ✅ Done so far (objective UX wins, verified via touch `shoot-round` TOUCH=1): **THROW button** (was keyboard-only → mobile can capture); **floating/dynamic joystick** (spawns under the thumb vs fixed corner) + **press feedback** (thumb grows/tints, ring brightens) + faint idle hint. 🔴 **REGRESSION FIXED 2026-06-06:** the joystick refactor left `thumb = JOY` (undefined) in the combat-reset branch → **MP combat crashed for everyone** the moment a fight started (`ReferenceError` every frame, round froze). Combat is position-gated so QA never hit it; surfaced by a new `ENCOUNTER_RADIUS` env hook (`server/index.js`) + QA at radius 600. Fixed → `thumb = joyRest()`; combat overlay now renders, build+152 tests, no PAGEERR (see BUGFIX_LOG). **Still open (design-led — needs user's "much better" direction):** exact aesthetic/colors, larger/cleaner combat buttons + their press states, safe-area (notch) + responsive sizing |
| Tile-overlap fix (SP overworld) | `@coordinator` | ✅ **DONE 2026-06-06**: SP `game.js` drew tiles at `TILE_SIZE`(128) stepped by `EFFECTIVE_TILE`(80) → 48px overlap on every neighbour; now drawn at cell size (matches MP `render/tiles.js`). Deploying. Full SP→`tiles.js` unify tracked as P10-T2 |
| Inventory view | `@feature` (SP) + `@visual` (MP) | ✅ **SP done** (`@feature`): `inventory.js` gained a **Monsters \| Spirit Chains** tab toggle; chains tab lists each owned chain (tier, throws ∞/n, charges, equipped) and equips on tap. ✅ **MP done** (`@visual` 2026-06-06 — the follow-up @feature noted): added the same **Monsters \| Spirit Chains** tab to the online `roster.js` (no new scene → no `main.js`/@phaser dep). Chains tab = a card per owned chain (colour swatch, name, tier, "catches up to rarity N", throws ∞/n, charges, special-ability blurb) with **tap-to-equip** → `net.setEquippedChain` + optimistic `equippedChainId` (server validates owned, no lobby echo). Build+147 tests; **verified via new `tools/shoot-roster.mjs`** (title→Play Online→Manage Team→roster) on a fresh `:8080`: tab switching + equipped-highlight render correctly, no client errors. ✅ **BUGFIX (`@visual`, surfaced by this work):** the roster's **active-team cards were drawn *before* the vault scroll-mask** (`drawRect 0,0 → VAULT_TOP=256`), and the team row sits at y≈90–210 *inside* that band — so the mask painted over the whole team and it rendered **empty for everyone** (pre-existing, not the tab change). Reordered to vault→mask→team so the team draws on top; shoot-roster now shows all 4 starters (Phantom Mantis/Thornvine Treant/Thunder Ram/Cinder Wolf) with sprites, element outlines, HP bars. |
| Settings/pause on Escape | `@visual` | ✅ **DONE (onlineGame)**: ESC opens a **PAUSED** overlay (Resume · Sound On/Off · Leave round) instead of instantly quitting — fixes accidental round-loss + gives a touch/mouse mute toggle. Movement + gamepad gated while open; world keeps running server-side (overlay says so). Verified via `shoot-round` (ESC capture). **Follow-up:** SP `game` scene |
| Red dots → character/monster models | `@visual` | ✅ **DONE (MP)**. MP main view already used sprites (monsters) + `drawCharacter` (rivals) — only the minimap had dots → small **character glyph** (head+body); self/portal kept. ✅ **SP DONE 2026-06-06** (found via shoot-fight QA): the **SP overworld (`game.js`) was still drawing monsters as a flat red dot** (`rgb(255,60,60)`) — now draws the monster's **procedural sprite** (the global sprites `main.js` preloads by typeName slug) + a ground shadow, matching MP, with an amber marker fallback. Build+147 tests+shoot-fight verified (teal creature sprite renders where the red dot was; no client errors). |
| **Live asset-generation pipeline + admin controls** | `@coordinator` | **user-requested 2026-06-06** (extends P5 + P7-T5). ✅ **Admin model+params steering DONE** (`@coordinator`): `server/aiconfig.js` (DB-persisted, settings id=3, validated/clamped, tested 5✓) → `ai.js` (combat) + `gen.js` (gen) read model/temperature/maxTokens/topP live; `/admin` has a **Model & parameters** editor (model dropdown+free-text from `MODEL_OPTIONS`, temp/maxTokens/topP). Prompts already editable (P7-T5). **Remaining:** turn generation ON in prod (`MONSTER_GEN_RATE`>0 / on-demand) + per-category quotas + bespoke attack gen — see P5-T1/T2 |
| Per-biome movement speed | `@feature` | ✅ **DONE 2026-06-06** — biome `speedMult` (0.70×–1.15×) in `mapgen.js` BIOME_DEFS + pure `biomeSpeedMultAt(map,x,y)`; applied server `tickRound` + SP `game.js` (replaces per-tile `speedModifier`), deterministic. Build+148 tests; wiki Biomes table + Movement section. |
| Menu + interaction sounds | `@visual` | **user-requested 2026-06-06** (extends P8-T6). ✅ **menu SFX (all scenes) + footsteps DONE** (`@visual`): added `hover/click/back/step/chest/pickup/levelup` recipes to `src/systems/audio.js`, then wired **hover + click centrally in `src/ui/theme.js` `addButton`** → *every* themed button across *all* scenes gets sound from one place (respects the shared `M` mute; AudioContext unlocks on first click). Throttled, sprint-aware **footsteps** in `onlineGame` (gated off menu/combat). Build+147 tests+shoot-round verified — bot still clicks through title→lobby→round (proves click-wrap didn't break `onClick`), no client errors. ✅ **level-up + chest-open SFX DONE** via **client-side state-diffs** in `onlineGame` (no server change): level-up = a team monster's `level` rose vs last seen; chest-open = a chest within 56px of self vanished from the snapshot (proximity gate excludes chests that merely left view range). Build+147 tests+shoot-round verified (per-frame diff runs clean, no errors). Chain-pickup folded into chest-open (chains drop *from* chests). **Un-ear-tested** (headless) — recipes easily tuned. **Remaining (low-pri):** scene open/close transition SFX would need a `main.js` hook (@phaser lane); a distinct *back-button* sound exists (`back` recipe) but back buttons currently use the generic click. **Task effectively complete.** |
| Natural top-down look | `@visual` (+atmosphere agent on PV-T4) | **user-requested 2026-06-06** — top-down view feels flat/gamey; make it look more natural. ✅ **ground shadows under monsters** (`@visual`; players already shadowed via `drawCharacter`); ✅ procedural **ground scatter** (`@visual`, `tiles.js` `drawScatter` — sparse per-cell pebbles/flecks, deterministic, breaks per-type tile repetition; build+143 tests+shoot-round verified, natural not noisy); ✅ ambient **vignette + player spirit-glow + drifting motes** (`src/render/atmosphere.js` "PV-T4", called in `onlineGame` — **owned by the atmosphere agent; don't duplicate**). ✅ **tile-grid softening** (`@visual`, `tiles.js`): cut the per-tile edge-framing α (0.38→0.14 — it was drawing false seams even between *identical* neighbours) **+** added a per-cell **patchwork softener** (`neighborAvg` — nudge each tile toward its local 4-neighbour colour average @0.22 α; a visual no-op in uniform regions, only pulls in tiles that stand out) → floor now reads as continuous ground rather than a hard grid; build+147 tests+shoot-round verified (softer, still varied, not washed out). **TODO (`@visual`):** **y-sorted depth** so overlaps read right (low-pri, minor payoff). **Taste/tunable (ask user):** patchwork-blend α (0.22) + vignette strength — dial up for more blended/atmospheric, down for more vivid/varied. ⚠️ **Two concerns for the atmosphere agent/user:** (1) the vignette corners are very dark (0.92 α) — may hide rivals approaching from screen corners in PvP; (2) shadows+scatter+texture+vignette+glow+motes now stack — verify the *combined* frame for busyness, don't over-process |
| Void texture + map border wall | `@visual` | ✅ **DONE (MP, `render/tiles.js`)** 2026-06-06 (`@visual`): off-map cells were skipped (flat bg → tiles "floating in nothing"). Now `drawTiles` renders the void as an **enclosed cave** — the view range is no longer grid-clamped (void fills the screen past the map edge, never flat bg); void cells bordering the floor draw a **rock wall rim** (lighter, with a lit top edge + grain), deeper cells a dark **abyss**; floor cells facing void get an **inner edge shadow** so the floor reads as recessed below the walls. Build+147 tests+shoot-round verified (clear floor↔wall↔abyss read; no client errors). **Follow-up:** SP `game.js` (its own tile path — lands with P10-T2 unify). **Taste/tunable (ask user):** wall colour/strength (rim `rgb(44,39,52)`, abyss `rgb(11,10,16)`, edge-shadow 0.32 α) — can make walls more pronounced/rockier if wanted. _user-requested 2026-06-06; coordinated with "natural top-down look"._ |
| **4K / HiDPI sharpness** | `@coordinator` (was `@phaser`) | **user-requested 2026-06-06.** ✅ **FIXED `@coordinator` 2026-06-06** (drove it after 3 passes unaddressed in `@phaser`'s queue; low-risk one-property change): added `scale.zoom = DPR` to the Phaser game config (`kaboomShim.js`:274) → the canvas **backing buffer now renders at devicePixelRatio (HiDPI/4K crisp)** while the world coordinate space stays 1280×720, so **no scene/camera/pooling coords changed**. Verified: build + 148 tests + headless shoot-menu **and** shoot-round (idle/moving/pause) all render clean, no console errors, layout/input intact. **`@phaser`:** FYI I touched your shim lane for this user-priority fix — please sanity-check on a real 4K display + refine (e.g. cap zoom for perf) if needed. |

> ✅ **@feature ↔ @phaser scene-registration seam (2026-06-06, resolved):** to stop feature
> scenes from editing your `src/main.js` bootstrap per-scene, feature scenes now register via
> **`src/scenes/featureScenes.js`** (`installFeatureScenes(k)`, @feature-owned). `main.js` keeps
> a **single stable hook** — `import { installFeatureScenes }` + one `installFeatureScenes(k)`
> call — that never needs touching again as features add scenes (shop + onlineShop today;
> future scenes append to the registry). `npm run build` + 147 tests green. @phaser: please keep
> that one hook through any bootstrap refactor; ping me if you'd prefer a different seam.

> 🎯 **Quality & polish — standing priority (user, 2026-06-06).** Beyond new features,
> **many existing functions need substantial polishing.** Every agent should budget each
> pass for hardening/refining what's already shipped, not only net-new work. Candidate
> areas: mobile controls (task above), combat UX/feel + AI-latency feedback, spirit-chain
> throw feedback, the shop scene, monster/tile visuals, scene transitions, audio (minimal
> pass so far), onboarding, and error/edge-case UX. `@coordinator`: fold per-feature polish
> sub-tasks into the phases as they're identified.

> ✅ **Migration LANDED via compat shim** (`@phaser`, 2026-06-06):
> `src/compat/kaboomShim.js` re-exposes the `k.*` API on Phaser 3, so all 14 scenes + 3 render
> modules work **unchanged — no scene rewrite**. `kaboom` removed from `package.json`;
> `src/main.js` imports the shim. Verified: `npm run build` + 122 tests green, and a headless
> Playwright smoke confirmed title / characterSelect / bestiary (immediate-mode grid) /
> onlineLobby (DOM input) / **onlineGame** (camera, textured tiles, character draw, HUD,
> minimap, movement) all render correctly. Collision zone stays narrow: `@phaser` owns
> `src/compat/*`, the `src/main.js` import, and `index.html`. **`@feature`/others MAY keep
> editing `src/scenes/*` / `src/render/*`** — but only using the `k.*` surface the shim
> supports (need a new `k.*` call? ping `@phaser` to add it to the shim, don't edit the shim
> yourself). Pure-logic `src/engine/*` + `server/*` remain the safest lane.
> _Follow-up (out of scope): idiomatically refactor the hot scenes (`game`, `onlineGame`,
> `fight`) to native Phaser Sprites/tweens for batched-renderer perf; eventually retire the shim._

---

## Locked decisions

| Decision | Choice |
|---|---|
| Rendering | **Phaser 3** — migrated off Kaboom.js (landed 2026-06-06 via the `k`-compatible shim `src/compat/kaboomShim.js`; `kaboom` dep removed). Procedural shapes, no PNGs. |
| Multiplayer | **Real online multiplayer**, authoritative server, ≤16 players/round, **free-for-all (no allied teams)**. |
| Combat model | **Instanced duel** (others keep moving); **PvE vs wild monsters + FFA PvP**; some monsters hidden. |
| Combat resolution | **AI-resolved (core selling point)**; deterministic `engine/combat.js` = offline fallback + training-data baseline. Research: finetune a small model on live big-model transcripts. |
| Monster visuals | Procedural (done — `src/systems/spritegen.js`). |
| Content data | AI-generated, **persisted to DB**; generate-on-empty, then **~90% reuse** (monsters, biomes, tiles…). |
| Hosting | **Railway** — server + DB + client. |
| Auth | **Anonymous + nickname** first → Google/Discord → (later) native. |
| Map | Keep DLA + Voronoi biome gen; rework tile rendering + map view. |
| Status effects | **No taxonomy** — AI interprets/executes statuses during fights (`STATUS_TAXONOMY.md` shelved). |

> ✅ **DONE (2026-06-06): migrated Kaboom.js → Phaser 3.** The user chose Phaser; the
> migration is **complete and verified** (build + 122 tests + headless render smoke). This
> **supersedes** `docs/ENGINE_EVALUATION.md` (which had recommended KAPLAY — now moot).
> **All agents, read before touching rendering:**
> 1. Migration uses a **compat shim** (`src/compat/kaboomShim.js`) that re-exposes the `k.*`
>    API on Phaser, so scenes work unchanged (**no rewrite**). `@phaser` owns `src/compat/*`,
>    the `src/main.js` import, and `index.html`. Others may keep editing scenes but must use
>    only the `k.*` surface the shim supports.
> 2. The shared `src/engine/*` (pure logic, **no engine dependency**) and all of `server/*`
>    are **unaffected** — safe to keep building features there.
> 3. **Do not start a parallel/duplicate engine swap.** One agent owns it.
> 4. `kaboom` has been **removed** from `package.json`; `phaser` is the rendering dependency.

## Critical architectural shift

The current game is **client-only single-player**: all state in `localStorage`,
all logic in the browser, `Math.random()` everywhere. Real multiplayer requires
an **authoritative server** that owns state and validates everything (it's PvP
with loot — clients cannot be trusted). This is the backbone of the whole plan.

```
┌─────────────┐   WebSocket    ┌──────────────────────┐
│  Browser    │ ◄────────────► │  Authoritative server │
│  (Phaser    │   snapshots /  │  (Node.js)            │
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
- [x] **P6-T4** Load/perf test 16 players; optimize snapshot bandwidth (`@coordinator`).
      **(1) Bandwidth guard** (`server/perf.test.js`): pins per-player payload + 16-player
      aggregate so AoI/field bloat fails CI. Baseline: lone player ≈488 B/snapshot; worst-case
      clustered 16-player round = max ≈1.2 KB/snapshot, ≈18.4 KB/broadcast (~141 KB/s out).
      **(2) Load harness** (`tools/loadtest.mjs`): drives the real world API with 16 simulated
      players moving every tick; measures `tickWorld` wall-clock vs the 15 Hz budget. **Result:
      avg 0.10 ms/tick (~0.15% of the 66.7 ms budget), p95 0.23 ms** — huge CPU headroom; no
      optimization needed. Both bandwidth and CPU comfortably clear the 16-player target.
      _2026-06-06._
- [ ] **P6-T5** Audio, settings, final art pass.
- [~] **P6-T6** **Mobile + PWA** (lower priority). Done: onscreen joystick +
      tappable combat buttons; mobile HTML nickname input; **PWA — manifest +
      service worker + SVG & PNG (192/512) icons + iOS apple-touch-icon +
      standalone meta** (installable; no-zoom). **Responsive layout (2026-06-06):**
      game canvas stays letterboxed 1280×720 (crisp) — clean fit for 16:9/16:10
      desktop (1920×1080, 1366×768, 1536×864, 2560×1440…) and mobile-landscape;
      CSS-only "rotate your device" overlay for touch users in portrait (game is
      landscape-only); manifest `orientation: landscape`; `touch-action: none` +
      safe-area insets on the game page; `@media` polish so `/admin` (stacked
      settings) and `/wiki` (collapsing sidebar, scrollable tables) fit phones.
      Remaining: single-player touch. (`scripts/gen-icon.mjs` regenerates the PNGs
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
- [x] **P7-T5** **AI prompt editor** (PR #55): every AI prompt (combat system,
      monster system + user) is editable in the admin panel and DB-persisted
      (`server/prompts.js` single source + override layer; `ai.js`/`gen.js` read
      via `getPrompt`; `{hints}` slot for targeted gen). _2026-06-06._
- [x] **P7-T6** **Generation test + asset browser** (PR #55): "Generate one now"
      shows the full generated record (saved to DB); the generated-asset list is
      click-to-inspect (full JSON) — browse everything the pipeline made. _2026-06-06._
- [x] **P7-T7** **Admin security** (PR #55): constant-time token compare
      (`timingSafeEqual` over SHA-256) + brute-force throttle (lock after repeated
      failures). Admin API is header-token gated (no CORS → no cross-origin/CSRF).
      Set a strong `ADMIN_TOKEN`. _2026-06-06._
- [x] **P7-T4** **Live ops view** (PR #51): admin panel polls `/api/admin/stats` —
      players online, queue, active rounds (per-round players/monsters/time), active
      combats + duels, monster-pool size, and recent run results (`world.recentResults`
      ring buffer). Read-only, ~3s refresh. _2026-06-06._

### P8 — Post-completion depth & polish (proposed 2026-06-06)
The P0–P7 plan is built & live. With the core complete, these deepen the meta-loop
and polish the experience. (decision-free = I can build now; ⓭ = wants your input.)

- [x] **P8-T1** **Player progression stats** (PR #53) — per-profile `stats`
      (runs/extractions/deaths/caught/pvpWins) bumped at the round/combat/PvP events,
      persisted with the profile, sent in `welcome` + the extracted/died messages,
      and shown on the round-result screen. Foundation for a leaderboard (P8-T4).
      _2026-06-06._
- [x] **P8-T2** **Online roster / vault management** (PR #57) — between rounds, view
      your collection (grown by taming + PvP loot) and pick your active 4. Server:
      `vault` in `welcome`; `getRoster`/`setRoster` + `applyRoster()` (idle-only,
      dedupe, ≥1 active, capped, persisted). Client: new `roster` scene (active 4 +
      scrollable vault, tap to field/store, HP bars), reached via the online lobby's
      "Manage Team" button. Themed with the new `src/ui/theme.js` design system.
      _2026-06-06._
- [x] **P8-T3** **Round-end gains summary** (`@visual`, 2026-06-06) — server snapshots a
      run-start baseline (caught / team XP / levels / time) at `generateRound` and diffs it
      in `endRunForPlayer` (before the death team-swap), sending a `gains` object in
      extracted/died. Client shows a **"THIS RUN · Caught N · +X XP · Y level-ups · survived
      M:SS"** line on the result overlay (lifetime stats relabeled "LIFETIME"). Tested
      (`server/gains.test.js`); in the working tree. _decision-free._
- [x] **P8-T4** **Leaderboard** (PR #54) — `store.topProfiles` ranks the in-memory
      profiles by a stat; public `GET /api/leaderboard` (top extractors + PvP wins);
      "TOP EXTRACTORS" shown on the start menu. _2026-06-06._
- [ ] **P8-T5** **Kill feed** — PvP defeats in the round HUD (PvP now exists).
- [ ] **P8-T6** **Audio** — procedural SFX (hit, catch, extract, portal) + a mute
      toggle. _somewhat subjective — confirm you want sound._
- [x] **P8-T7** **Per-connection rate limiting** (PR pending) — token bucket per WS
      connection (`server/ratelimit.js`, default 50 cap / 30 tokens·s⁻¹, well above
      legit ~20 msg/s play); over-budget messages dropped, socket closed after 100
      sustained drops. Also a 64 KB `maxPayload` DoS guard. Env-tunable
      (`RL_CAPACITY`/`RL_REFILL`/`RL_MAX_VIOLATIONS`/`WS_MAX_PAYLOAD`). _2026-06-06._
- [ ] **P8-T8** **How-to-play / onboarding** overlay for first-time players.
- [x] **P8-T9** **Floor-tile detail** (user request 2026-06-06; in working tree) — the
      online map view drew each tile as one flat `colorProfile_full` rect, discarding
      the per-side edge colors AND the `rotation` the tile data carries, so floors
      looked featureless. New `src/render/tiles.js` generates a textured sprite per
      tile *type* (grain + directional light + top/bottom/left/right edge shades),
      cached by id and drawn at the tile's rotation, with a flat-color fallback while
      a type's sprite loads — still 1 draw/tile (same cost as the flat rect). Wired
      into `onlineGame.js`. _Follow-up: SP `game.js` uses a separate `imagePath`
      sprite system with a flat-green fallback; unify it onto this generator._

### P9 — Spirit Chains & loot (shipped; tracking added by coordinator 2026-06-06)
Core throw/capture verb + chest loot economy. Built, tested (117 green), and fully
specced in `public/wiki.html#chains` — this section back-fills the plan so the
task source-of-truth matches what's live. Engine math is the pure shared module
`src/engine/spiritchains.js` (9 tests); defs in `public/assets/data/spiritchains.json`;
tunables in `GAME.SPIRIT_CHAIN`; client render `src/render/spiritchain.js`.

- [x] **P9-T1** Throw-to-engage with **initiative**: aiming + throwing a chain on
      the overworld (`Q` throws along facing, `[` / `]` cycle) starts combat with
      the **thrower acting first**; walking into a monster still starts combat but
      the monster acts first. _2026-06-06._
- [x] **P9-T2** Two per-chain resources: `throwCount` (overworld throws, spent on
      every throw) + `durability` (capture charges, spent only on success; chain
      consumed at 0). `canThrow`/capture math in `spiritchains.js`. _2026-06-06._
- [x] **P9-T3** Tiered capture: 5 base tiers + 3 top specials (Eternal Coil =
      endless throws, Sovereign Bind = guaranteed ≤25% HP). Capture chance scaled
      by tier multiplier + a **rarity gate** (chain `maxRarity` auto-fails too-rare
      targets). In-combat catch via `chainCaptureChance`. _2026-06-06._
- [x] **P9-T4** **Loot chests** (`server/world.js`): 10/round, server-authoritative
      + seeded, wall-adjacent, 1–2 chains weighted by `dropWeight` (`rollChainDrop`),
      opened within 40px, minimap blip ≤420px. Starter Frayed Chain granted +
      back-filled on old saves. _2026-06-06._
- [x] **P9-T5** **Extraction stakes**: chest-found chains are provisional
      (`runFound`) — banked on extract, lost on death/timeout; starter + previously
      banked chains always safe; refills of banked chains not at risk. _2026-06-06._
- [ ] **P9-T6** **Hydra Lash multi/area capture** — chain nearby monsters
      (multi-capture queue). _Deferred (per project notes)._
- [x] **P9-T7** **Gold shop** — SHIPPED: spend run-earned gold on chains between runs.
      SP scene `src/scenes/shop.js` (wired in `main.js` + lobby "Spirit Shop" button);
      server-authoritative `buyChain` in `world.js` (idle-only, deducts gold, banks the
      chain permanently — not `runFound`); engine `buyChain` in `schemas.js`; covered by
      `world.test.js`. _2026-06-06._
- [ ] **P9-T8** **Crafting** — craft chains from in-run materials. _Planned._

### P10 — Single-player ↔ multiplayer parity & code standardization (user-requested 2026-06-06)
SP (`src/scenes/game.js`, `fight.js`, client `systems/combat.js`, `localStorage`) and MP
(`src/scenes/onlineGame.js`, `onlineLobby.js`, server-authoritative) grew in parallel and
have **drifted**. Goal: one behavior, one implementation — audit every difference, close the
gaps, and push duplicated logic into shared modules so a fix lands once. **Deliverable:** a
gap matrix + the refactors below; each gap is either reused, intentionally documented as
SP-only/MP-only, or fixed.

- [x] **P10-T1** **Audit** — SP-vs-MP gap matrix done (`@coordinator` 2026-06-06):
      - **Shared & healthy (no drift):** combat turn + catch resolution (`engine/combat.js`
        `resolveTurn`/`resolveCatch`), chain capture math (`spiritchains.js`), `grantChain` /
        `finalizeRunChains` / `goldForDefeat` / `buyChain` (`schemas.js`), `rollChainDrop`.
      - **Duplicated logic (drift risk):** `grantXp` (SP hardcoded `100` vs server
        `GAME.XP_PER_LEVEL`) — **FIXED, see T4**; `isWalkable` collision; encounter trigger;
        `spawnPortal`. Extraction candidates.
      - **SP missing vs MP (gaps):** textured tiles (SP flat-color — T2); **team heal on
        extract** (MP heals, SP only grants gold — confirmed bug, T3); structured run gains
        (SP narrative only — T5); in-run audio / onboarding / kill-feed (MP-only); seeded RNG
        in overworld (SP uses `Math.random`).
      - **UI:** `fight.js` uses `theme.js`; `game.js` + `onlineGame.js` hardcode colors (T6).
- [x] **P10-T2** **Tile render unify** — ✅ **DONE** (`@coordinator` 2026-06-06): SP `game.js`
      `drawTiles` now delegates the floor to the shared `render/tiles.js` `drawTiles`
      (`makeTileCache` at scene setup) — SP gets the **textured floor + cave void/wall-border**
      identical to MP, and the per-tile flat-rect + `generateTileSprite` preload path is gone
      (dedup). Monster-on-tile overlay kept. Build + 152 tests + `shoot-sp` (lobby/world/move,
      no console errors) verified. Closes the "Void texture" SP follow-up.
- [ ] **P10-T3** **Run-end stakes parity** — `finalizeRunChains` is already shared, BUT
      **confirmed gap: SP does not heal the team on extract** (`game.js` extract branch only adds
      gold; server `world.js:600` heals all active monsters). Add the heal in SP + extract a
      shared run-end helper so the two paths can't diverge (BUG-009 was this class).
- [x] **P10-T4** **Combat path parity** — verified SP `systems/combat.js` + server `combat.js`
      both delegate to the shared `engine/combat.js` resolver (AI is an optional layer; the
      fallback == the server path). **`grantXp` extracted to `src/engine/progression.js`**
      (`@coordinator`, unit-tested) — both call sites import it; kills the duplicate + the SP
      hardcoded-`100` drift. _2026-06-06._
- [ ] **P10-T5** **Feature parity** — decide + close gaps where one mode has a feature the
      other lacks (e.g. P8-T8 onboarding is MP-only; SP chests/shop parity), or document the
      asymmetry as intentional.
- [ ] **P10-T6** **UI standardization** — route all SP + MP scenes through `src/ui/theme.js`
      helpers (`addButton`/`addLabel`/`THEME`); no hardcoded colors/layout (runResult/roster
      already converted — finish the rest).

---

## PV — Visual Overhaul ("bioluminescent dark-fantasy" look)

> Driven by the user's concept art (haunted spirit-forest, glowing portal, hooded
> chain-wielder, teal-green + violet glow on near-black). Goal: make the whole game
> *look good* and cohesive. All rendering goes through the `k.*` shim → Phaser, and
> all color/type through `src/ui/theme.js`. Verify every change with the screenshot
> harness (`tools/shoot*.mjs` → `.screenshots/`). Coordinates with `@visual`
> (owns `src/render/tiles.js` + in-round QA) and P10-T6 (UI standardization).

- [x] **PV-T1** Design-system foundation — `src/ui/theme.js` "bioluminescent dark
      fantasy" palette (slate-violet base, teal + violet accents), depth components
      (`addButton`/`addPanel` with shadow + sheen + hover glow), Chakra Petch type
      scale, HiDPI sharpness (shim DPR). _Done 2026-06-06._
- [x] **PV-T2** Player character + title atmosphere — `drawCharacter` +
      `generatePlayerSprite` = hooded cloaked spirit-tamer with a glowing spirit-chain
      ring; `generateTitleBackground` = portal-forest scene. _Done._
- [x] **PV-T3** Monster shape variety + full element palettes — `spritegen.js` body
      silhouettes + per-element features for every element. _Done._
- [x] **PV-T4** **World atmosphere & lighting** — `src/render/atmosphere.js`
      (vignette sinking the edges to black + a teal spirit-light glow around the
      player + drifting spirit motes, danger-tint aware) wired into `game.js` +
      `onlineGame.js` onDraw (over world, under HUD; skipped during combat/results).
      _Done 2026-06-06. Remaining nice-to-haves: moodier per-biome tile tint +
      portal rings matching the title — fold into P10-T2 tile unify._
- [ ] **PV-T5** **UI screen consistency** (= P10-T6) — route remaining manual-rect
      scenes through theme depth components: `characterSelect`, `onlineLobby`,
      `bestiary`, `inventory`, `shop`, `roster`, `onlineShop`, `fight`, `runResult`.
- [ ] **PV-T6** **Combat scene upgrade** — atmospheric arena backdrop, element auras
      on combatants, refined layout/spacing, simple hit/cast/catch FX.
- [x] **PV-T7** **Monster sprite quality pass** — `generateMonsterSprite` now draws
      a per-element radial **aura glow** behind the body, a glowing **accent rim**
      (re-stroked silhouette), and a top-left **sheen**, on top of the PV-T3 shape
      variety. Monsters read as bioluminescent everywhere they appear. _Done 2026-06-06.
      Follow-up if wanted: livelier/animated eyes._
- [ ] **PV-T8** **HUD polish** — themed minimap frame, timer/portal-hint styling, team
      HP as compact cards, danger state as a teal→red vignette.
- [ ] **PV-T9** **Micropolish & motion** — title portal pulse, button press feedback,
      scene fade transitions, themed loading screen, spirit-dust particles.
- [ ] **PV-T10** *(large, optional — needs user go-ahead)* **True pixel-art rendering**
      — rewrite `spritegen.js` tiles + monsters at low resolution with a tight pixel
      palette + dithering to fully match the painterly-pixel reference. Biggest lever
      but a major art rewrite; the smooth-Canvas2D look ships in the meantime.

---

## Asset-generation pipelines (architecture — source of truth)

> Tamers Quest ships **zero static art** — no PNGs. Every visual is generated at
> runtime by one of two pipelines: (A) **procedural rendering** (Canvas2D / live
> shim draws) and (B) **AI content generation** (server → data, which pipeline A
> then renders). Keep this section current when adding/altering a generator.

### A. Procedural visual pipeline (client, deterministic)
All generators are pure + seeded (so a given monster/tile always looks the same)
and output a `<canvas>` that the shim's `k.loadSprite(name, canvas)` accepts, OR
draw live each frame via `k.draw*`. Seeded PRNGs: `engine/rng.js` (`makeRng`) for
sprites, `mulberry32` (local) for tiles.

- **`src/systems/spritegen.js`** — one-shot canvas generators:
  - `generateMonsterSprite(mt)` → element palette (`paletteFor`, folds dual-types/
    synonyms via `ELEMENT_ALIASES`) + body silhouette (`shapeFor`/`traceBlob`) +
    per-element features (`drawElementFeatures`) + eyes. Seed = `typeName|element`.
  - `generatePlayerSprite()` → hooded spirit-tamer icon (matches `drawCharacter`).
  - `generateTitleBackground()` / `generateTitleBorder()` → portal-forest title art.
  - `generateTileSprite(tile)` → legacy SP tile (superseded by `render/tiles.js`).
- **`src/render/tiles.js`** (`@visual`) — textured floor **per tile *type***:
  `generateTileTexture` (edge shading + grain) cached via `makeTileCache`; `drawTiles`
  culls to camera, draws the cached sprite at the tile's rotation (flat-rect fallback
  until loaded) + deterministic per-cell `drawScatter`. Used by `onlineGame`; SP
  `game.js` unify tracked as **P10-T2**.
- **`src/render/character.js`** — `drawCharacter` draws the player live (no sprite):
  hooded cloak + animated spirit-chain ring, directional facing.
- **`src/render/spiritchain.js`** — live draws for chain models, the thrown
  projectile, ground chests, and the capture FX.
- **`src/render/atmosphere.js`** (PV-T4) — screen-space mood: generated vignette +
  glow sprites + live drifting motes; `drawAtmosphere(k,{t,danger})`.
- **Registration** — `src/main.js` `init()`: loads fonts, then `k.loadSprite` for
  every monster type (slug name), the player, and title art. Tile textures load
  lazily in-scene (per visible type). New sprite generators must be registered here
  (or lazily in their scene) under the exact name scenes reference.

### B. AI content-generation pipeline (server → data, not pixels)
Produces **monster type DATA** (name/element/rarity/stats/description) + resolves
combat narrative; pipeline A renders that data into sprites. Admin-steerable live.
- **`server/gen.js`** — monster generation (calls OpenAI, validates/persists new
  types). Gated by `MONSTER_GEN_RATE` (admin). New types flow into the bestiary +
  get a procedural sprite on next load.
- **`server/ai.js`** — AI combat resolution (optional layer over the deterministic
  `engine/combat.js`; falls back to it).
- **`server/aiconfig.js`** — DB-persisted model + sampling params (validated/clamped);
  read live by `gen.js`/`ai.js`.
- **`server/prompts.js`** — system/user prompt templates (admin-editable; `{hints}`
  injection for element/rarity targeting).
- **`server/content.js`** — content store/bootstrap for generated types.
- **Admin** — `public/admin.html` edits model/params/prompts + gen rate; applied
  live, no redeploy. (See P5-T1/T2, P7-T5, and the live-asset-gen ownership row.)

> **PV-T10 note:** a future true-pixel-art look would replace the *renderers* in
> pipeline A (spritegen + tiles) with low-res/dithered output; pipeline B (the data
> contract) is unaffected.

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
