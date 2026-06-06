# Bugfix Log

Running log for the systematic bugfixing pass. Each loop iteration appends here.
Newest first. Status: ✅ fixed · 🔍 identified (not yet fixed) · ⏭️ deferred (WIP/feature, out of scope)

- ✅ **(2026-06-07) RESOLVED — was:** 🔍 flagged by visual/deploy: `server/world.test.js` "spirit
  chain: run-found chains are kept on extract and lost on death" FAILING (chain NOT lost on death).
  **@watchdog verified (iter-82/83): now PASSES (158/158), fixed properly — not test-weakened.** The
  test still asserts the run-found chain is gone after a forced-timeout death; `finalizeRunChains(false)`
  filters out run-found + re-points equipped + grantStarterChains. Was transient/already-fixed. CLOSED.

> 🤝 **Coordination:** this loop is registered as **`@watchdog`** in the agent roster —
> see "Agents & ownership" in `docs/IMPLEMENTATION_PLAN.md`. If that's you, you're confirmed;
> keep this log as your heartbeat. To take on non-bug work, claim a task there. (Added by `@coordinator`.)

---

## 2026-06-07 — Iteration 94 — `@watchdog` heartbeat (idle)

No in-lane changes. 167/167 pass. No bug.

---

## 2026-06-07 — Iteration 93 — `@watchdog` heartbeat (idle)

No in-lane changes. 167/167 pass. No bug.

---

## 2026-06-07 — Iteration 92 — `@watchdog` heartbeat (idle)

No new code/files. 167/167 pass. No bug.

---

## 2026-06-07 — Iteration 91 — `@watchdog` heartbeat (idle)

No new code (only my world.js BUG-010 edit). Fix markers intact. 167/167 pass. No bug.

---

## 2026-06-07 — Iteration 90 — `@watchdog` heartbeat; BUG-010 fix verified holding

No new code from others (only my world.js BUG-010 edit). Re-verified the invisible-wall fix:
render-vs-collision mismatch = 0 on a fresh seed; all 3 fix markers intact. 167/167 pass. No bug.

---

## 2026-06-07 — ✅ BUG-010 (USER-REPORTED): "invisible walls" — collidable water rendered as floor

- **Symptom (user):** "walking around the map… sometimes like an invisible wall."
- **Root cause:** the 12 `collidable:true` groundtiles are all WATER (emerald_waters, ocean_floor,
  riverbed_stones…), placed on void-walkable cells (~1431/map). The new renderer's `isFloor` =
  `tileMap[x][y] != null` ignored `collidable`, so water drew as plain walkable floor — but SP
  collision (`!tile.collidable`) blocked it ⇒ invisible walls. Diagnostic: 1431 cells render-floor
  but collision-blocked, ALL collidable. Second bug: server `isWalkable` ignored `collidable` ⇒
  online players could walk ON water (+ SP/online inconsistency).
- **Fix (renderer↔collision now agree, mismatches 1431→0):**
  - `src/render/tiles.js`: `isFloor` now also requires `!collidable`; `drawTiles` routes `t.collidable`
    cells through `drawVoidCell` (boundary) instead of floor. ⚠️ touched @phaser's render lane for a
    user-reported gameplay bug — minimal/surgical; **@phaser: refine water aesthetic** (currently
    renders as abyss/boundary; could be water+shoreline).
  - `server/world.js` `isWalkable`: now blocks `collidable` (no walking on water online; mirrors SP).
- Verified: build green, 167/167 tests, render-vs-collision mismatch = 0 across a generated map.

---

## 2026-06-07 — Iteration 89 — `@watchdog` heartbeat (idle)

No in-lane changes. 163/163 pass. No bug.

---

## 2026-06-07 — Iteration 88 — `@watchdog` heartbeat (idle)

No in-lane changes. 163/163 pass. No bug.

---

## 2026-06-07 — Iteration 87 — `@watchdog` heartbeat (idle)

Already-reviewed upgrades/world/net batch; new file = QA tool (non-shipping). 163/163 pass. No bug.

---

## 2026-06-07 — Iteration 86 — `@watchdog` heartbeat (idle)

Core touches = already-reviewed upgrades/world/net (iter-85). New files = fonts (render, @phaser) +
QA tools (non-shipping). No new agnostic-core code. 163/163 pass. No bug.

---

## 2026-06-07 — Iteration 85 — ✅ meta-upgrade feature fully wired — all iter-84 flags resolved

@feature addressed every iter-84 flag within one cycle (158→163):
- ✅ `purchaseUpgrade` wired: `buyUpgrade` handler (world.js:180) — idle-gated, `getUpgradeDef`+
  String() validated (anti-cheat).
- ✅ **SP/online divergence CLOSED**: `goldMult` now applied online (641 extract, 756 defeat) +
  `essenceMult` (757 defeat, 842 chest); `vaultCapacity` already shared (schemas). Perks now affect
  both modes.
- ✅ net.js syncs `upgrades` (welcome/snapshot/upgrades-msg).
- ✅ `upgrades.test.js` (+4 tests): cost-scaling/cap, purchase affordability+maxed, effect getters,
  def well-formedness.
Module correct (verified iter-84). Scene UI `baseUpgrades.js` + inter fonts = @phaser lane. 163/163. No bug.

---

## 2026-06-07 — Iteration 84 — reviewed new meta-upgrade module + flagged a latent SP/online gap

New `src/engine/upgrades.js` (account perks: Prospector/Attunement/DeepVault). Module is correct +
pure: `purchaseUpgrade` affordability-checked before deduct, level-capped, no neg gold, no partial
mutation; getters null-safe. Minor smell: per-level effect hardcoded in getters AND in DEFS.per
(2 sources of truth; values match now).
⏭️ **Incomplete WIP (NOT a bug — perks currently inert, no crash):**
  - `purchaseUpgrade` has NO consumer anywhere ⇒ can't buy perks ⇒ `upgrades={}` ⇒ all effects ×1/+0.
  - Effect wiring is HALF-DONE: `vaultCapacity` shared via schemas.js (SP+online ✓); but
    `goldMult`/`essenceMult` applied in **SP only** (fight.js:509-510, game.js:344) — **NOT in
    world.js** online gold/essence grants. 🔍 **@feature: when purchase ships, online players won't
    get Prospector/Attunement bonuses** (SP/online divergence). Apply the mults at world.js grant
    sites too. No tests for upgrades.js yet.
158/158 pass. No bug.

---

## 2026-06-07 — Iteration 83 — `@watchdog` heartbeat (idle); marked the run-found flag CLOSED

No new in-lane code (schemas/store/world.test = reviewed iter-82). Re-confirmed the run-found-on-death
test passes; updated the stale top-of-log "FAILING" flag → ✅ RESOLVED (it was misleading the
source-of-truth). 158/158 pass. No bug.

---

## 2026-06-07 — Iteration 82 — ✅ run-found-on-death flag RESOLVED + starter-inventory review — clean

- ✅ **Re: the top-of-log flag** ("run-found chains … lost on death" failing): now **PASSES** (158/158).
  Verified it was fixed PROPERLY, not by weakening the test — the test still asserts the `guaranteed`
  run-found chain is absent after a forced-timeout death (and flag-cleared/kept on extract), and
  `finalizeRunChains(false)` correctly `filter`s out run-found + re-points equipped + grantStarterChains
  (chainless-safety). Was transient/already-fixed; current logic+test correct.
- Reviewed new **starter-inventory** (`store.js` createProfile → `grantStarterInventory`, schemas.js:382):
  array-guarded, dedup, load-order-safe fallback def, equips; `STARTER_CHAIN_IDS=["tier1".."tier5"]`
  (all valid in 8-chain data) via `?.length` w/ fallback ⇒ new players get 5, old profiles backfilled
  to ≥1. Exported + getSpiritChain imported. GAME.* sweep clean.
158/158 pass. No bug.

---

## 2026-06-06 — 🔴 BUG-CRITICAL (`@visual`): MP combat crashed on entry (`thumb = JOY` undefined)

- **Where:** `src/scenes/onlineGame.js` movement `onUpdate`: `if (net.state.combat) { …; thumb = JOY; }`
- **Root cause:** my floating-joystick refactor (mobile-controls overhaul) replaced the old fixed
  `JOY` centre constant with `joyRest()`/`joyBase` but missed this one line. `JOY` is undefined, so the
  instant `net.state.combat` becomes true the per-frame `onUpdate` throws `ReferenceError: JOY is not
  defined` every frame → the round freezes, combat is unusable. **Affected every player (desktop + mobile).**
- **Why it survived QA:** combat is position-gated (walk within 44px of a monster), which the headless
  shoot-round roam almost never hit — so the crash never showed. **Surfaced by adding an env hook for
  `encounterRadius`** (`server/index.js`, default 44) and running QA at `ENCOUNTER_RADIUS=600` so the bot
  reliably enters combat.
- **Fix:** `thumb = joyRest();`. Verified via shoot-round at radius 600: combat overlay now renders
  (two combatants + element-tinted attack buttons + Catch/Flee), **no PAGEERR**. Build + 152 tests green.
- **Follow-up for QA:** the new `ENCOUNTER_RADIUS` env makes the combat overlay reliably reachable —
  worth a permanent combat-smoke check.
- ✅ **End-to-end verified** (`tools/shoot-combat.mjs` at radius 600): clicking an attack resolves a full
  AI-narrated turn ("Sapphire Serpent's Tidal Wave for 11! Celestial Kirin's Starlight Breath for 238!"),
  enemy HP drops 254→18, no error — combat is fully *playable*, not just rendering. Core AI-combat loop works.
- ⏳ **Was still uncommitted in the working tree** at fix time (`onlineGame.js` modified; last snapshot
  predated it) → combat stays broken in PROD until the next snapshot/deploy. **Expedite recommended.**

## 2026-06-07 — Iteration 81 — `@watchdog` heartbeat (schemas tweak; GAME sweep clean)

schemas.js + systems/combat.js (reviewed) touched, no new tests/files. Ran GAME.* sweep after the
schema change: all BLOCK.KEY resolve ✓ (blocks: SPIRIT_CHAIN/SPRINT/GOLD/CRAFT) — no dangling ref.
158/158 pass. No bug.

---

## 2026-06-06 — Iteration 80 — `@watchdog` heartbeat (render-lane additions; lane idle)

New `src/render/portal.js` (+test, 156→158) = @phaser render lane (not reviewed/touched; its 2 tests
pass node-safe in the suite). tools/repro-spcombat + shot1080 = non-shipping QA. No new agnostic-core
code in my lane. 158/158 pass. No bug.

---

## 2026-06-06 — Iteration 79 — `@watchdog` heartbeat (idle)

Only systems/combat.js (simplification reviewed iter-78); no new code/tests/files. 156/156 pass. No bug.

---

## 2026-06-06 — Iteration 78 — reviewed SP-combat simplification (client LLM path removed) — clean

`src/systems/combat.js` dropped the client BYO-OpenAI-key path (callLLM/prompts/getApiKey/setApiKey);
`evaluateTurn`/`evaluateCatch` now go straight to the deterministic engine (SP = engine; online =
server-authoritative AI). Verified the cross-file-dep class: **no file still imports getApiKey/
setApiKey** (settings.js etc. updated in lockstep), exports removed, **build green** (would've failed
on a dangling named import). BUG-003 (`mt?.element||"Normal"`) + `...opts` chain-capture forwarding
intact; now sync but callers `await` harmlessly. 156/156 pass. No bug.

---

## 2026-06-06 — Iteration 77 — consolidated regression sweep across recent batch — all clean

Ran my probe battery in one pass over the recent server batch (heal-consolidation + PvP initiative/
engine-fallback + progression): **GAME.* completeness 0 missing · THEME.* 0 missing · data-integrity
0 bad · combat fuzz (6000 resolve+catch) 0 bad**. No whole-class regression (no dangling config/token
refs, no data corruption, no combat NaN). Reusable one-pass "all systems green" after multi-file
batches. 156/156 pass. No bug.

---

## 2026-06-06 — Iteration 76 — `@watchdog` heartbeat (idle)

pvp/index touched but test count unchanged (156) — minor tweaks to just-reviewed PvP code, no new
behavior/tests/files. 156/156 pass. No bug.

---

## 2026-06-06 — Iteration 75 — `@watchdog` heartbeat (idle)

Touched files = already-reviewed heal/PvP changes (iter-73/74); no new code/tests. 156/156 pass. No bug.

---

## 2026-06-06 — Iteration 74 — ✅ PvP initiative wired (iter-13 item closed) + engine fallback — clean

`server/pvp.js` (155→156): two correct changes by @feature.
- ✅ **iter-13 deferred item RESOLVED**: PvP `initiatorId` now consumed — `initiator` derived
  (a.id→"player"/b.id→"enemy"/null), first-turn-only (`pvp.initiatorId=null` after), passed to BOTH
  AI (`aiResolveTurn`) and the engine fallback. Exactly the wiring I'd suggested in iter-13.
- **NEW engine fallback** (`resolveTurn as engineResolveTurn`, line 14): no-AI-key / AI-error now
  falls back to the deterministic engine (line 112) instead of cancelling the duel (supersedes the
  old Q11b "no fallback"). PvP now always resolves + works offline. New test covers it.
  Downstream clamp0/advance/draw unchanged + correct. Minor: line 115 `if(!r) endPvp(ai_error)` now
  unreachable (engine always returns) — harmless dead remnant, not churning it.
156/156 pass. No bug.

---

## 2026-06-06 — Iteration 73 — reviewed heal consolidation (P10-T3, 152→155) — clean

`progression.js` gained shared `healToFull`/`healTeam`, centralizing the server's local copy (like
grantXp iter-40). `healToFull`: sets HP/energy to level-max + clears status, via BUG-002-safe
`getMonsterStats`. `healTeam`: null-safe (`team||[]`). Server (world.js:625) now calls
`healTeam(activeMonsters)` on extract — same behavior, no regression. Verified `function healToFull`
exists ONLY in progression.js (no leftover duplicates → no drift). +2 tests. 155/155 pass. No bug.

---

## 2026-06-06 — Iteration 72 — THEME-token completeness sweep (post theme-overhaul) — clean

Theme was overhauled ("Bioluminescent dark fantasy" — new tokens bgAlt/lineSoft/textBody/amber/violet
/teal). Risk: a scene referencing a dropped/renamed token → `k.color(...undefined)` → runtime crash
(build/tests don't catch undefined-property spreads). Ran a codebase-wide probe: every `THEME.<token>`
ref in src/ vs the live THEME object → **all 33-token refs resolve ✓**, no dangling token anywhere.
Reusable, alongside the GAME.* sweep (iter-66). loading.js re-theme: BUG-006 `.catch()` intact, tokens OK.
152/152 pass. No bug.

---

## 2026-06-06 — Iteration 71 — `@watchdog` heartbeat (idle)

Only cosmetic spritegen; no new in-lane logic/files. 152/152 pass. No bug.

---

## 2026-06-06 — Iteration 70 — adversarial fuzz of the combat engine — robust, no bug

Lane quiescent (cosmetic spritegen; HEAD = @phaser rendering). Ran a novel proactive audit: fuzzed
`resolveTurn`/`resolveCatch` with degenerate combatant states (0/negative/huge stats, status-locked,
no-energy) × all attack/initiator/guaranteed/rarity combos = **51,200 resolutions → 0 NaN / 0 neg-HP /
0 throws**, `caught` always boolean. Engine produces valid finite non-negative state for any input
(matters: combatant states originate from AI resolution). elementMultiplier triangle verified
(Fire→Nature→Water→Fire =1.3x, unknown=1.0). 152/152 pass. No bug.

---

## 2026-06-06 — Iteration 69 — `@watchdog` heartbeat (idle)

Only spritegen cosmetic touch; no new in-lane logic/files. 152/152 pass. No bug.

---

## 2026-06-06 — Iteration 68 — ✅ critical combat fix now COMMITTED (PROD-blocker resolved)

The `joyRest()` combat fix is now committed at HEAD (`git show HEAD:src/scenes/onlineGame.js` → line
354 `thumb = joyRest()`; file clean). New commit `d950236` ("Fix build… restores master"). So master
has the fix → reaches PROD on next Railway deploy. Iter-65/67 escalation actioned. My lane: only
index/spritegen touched (reviewed/QA areas), no new features. 152/152 pass. No bug.

---

## 2026-06-06 — Iteration 67 — ⚠️ re-confirm: critical combat fix STILL uncommitted (PROD broken)

Re-verified the `@visual` situation: `joyRest()` fix present in tree (onlineGame.js:354) + correct,
but `onlineGame.js` is still ` M` (uncommitted); last commit `1bbd545` (P10-T2 tiles) does NOT include
it ⇒ **PROD combat at tamersquest.com remains broken until committed + deployed.** Not committing
myself (multi-agent uncommitted work in tree; deploy is the user's call) — **escalating to user:
commit + deploy onlineGame.js ASAP.** My lane: in-lane touches (index/world/net) = shoot-combat QA,
no new feature/tests; 152/152 pass, build green, schema sweep (iter-66) clean. No new bug.

---

## 2026-06-06 — Iteration 66 — automated schema-completeness sweep (codebase-wide) — clean

Touched files = already-reviewed feature areas (biome/crafting/sprint), no new tests/modules.
Ran an automated probe: scan all src/+server JS for every `GAME.BLOCK.KEY` read, verify each resolves
against the live GAME object. **All resolve ✓** across the 4 blocks (SPIRIT_CHAIN/SPRINT/GOLD/CRAFT) —
no dangling `GAME.*` ref anywhere ⇒ the "missing-key → NaN" bug class is clear codebase-wide. Reusable
probe for future cycles (catches what my old per-feature grep did, but exhaustively). 152/152. No bug.
(no-undef lint-gate recommendation from iter-65 still pending @coordinator.)

---

## 2026-06-06 — Iteration 65 — verified @visual's BUG-CRITICAL fix + 🔍 recommend a no-undef lint gate

- ✅ Verified `@visual`'s critical `JOY`→`joyRest()` fix (onlineGame.js:354) is in place; ruled out a
  SECOND instance — `joyRest`(282)/`joyBase`(285) are properly declared before use, no other dangling
  joystick refs. 152/152 pass, build green.
- ✅ The `ENCOUNTER_RADIUS` QA hook (`server/index.js:56`, MY lane) is sound: `envNum(...)` → unset =
  default 44, consistent with the other env knobs. Good permanent combat-smoke enabler.
- 🔍 **RECOMMENDATION for @coordinator/@phaser (systemic, not a bug):** the project has **no ESLint /
  `no-undef` gate**. The `JOY` crash was a reference to a deleted const — exactly what `no-undef`
  catches at build/CI, but the bundler doesn't. A minimal `eslint --rule no-undef` (or just that rule)
  added to the green-gate would prevent this entire class (refactor leaves a dangling runtime ref that
  survives QA). Not adding it unilaterally — touches shared package.json/CI + would surface noise
  across @phaser's mid-migration scenes; best scoped + timed by the owners. Flagging for decision.

---

## 2026-06-06 — Iteration 64 — reviewed chain-crafting + essence economy (P9-T8, 148→152) — clean

New: `essence` currency + chain tier-upgrade crafting.
- `schemas.js` `craftUpgrade(profile, fromId, defs)`: affordability checked BEFORE any mutation
  (no partial state on reject), consume-lower-then-grant-upper, equip re-points to the new chain,
  no negative essence; `upgradeTargetFor` excludes specials/top-tier. CRAFT schema complete (all
  CRAFT.* keys → upgradeCost can't NaN). 4 new tests (maxed/unowned/poor/happy).
- Earn: essence +2/defeat (world.js:744), +3/chest (829). Spend: craftUpgrade (40×tier).
- Handler `craftChain` (165): idle-gated (locked path 169), `getSpiritChains`+String() validated
  (anti-cheat), echoes shop state. Synced: welcome/snapshot(478, live mid-run)/shop/net.js(106).
Complete, correct, anti-cheat, well-tested. 152/152 pass. No bug.

---

## 2026-06-06 — Iteration 63 — reviewed new biome-speed movement (147→148) — clean

New `mapgen.biomeSpeedMultAt(map,x,y)`: pure, fully safe (optional chaining + `?? 1` → no crash/NaN
even out-of-bounds / no biomeMap / null map). `server/world.js:411` applies it server-authoritatively
into movement speed: `speed * sprintMult * biomeSpeedMultAt(round.map, rp.x, rp.y)` ⇒ position
server-driven, NO client desync. Determinism intact (biomeMap is seeded gen; determinism tests still
pass). New test covers the fn + safe defaults. (SP-scene wiring = @phaser lane, not reviewed.) 148/148. No bug.

---

## 2026-06-06 — Iteration 62 — `@watchdog` heartbeat (idle)

No in-lane changes. 147/147 pass. No bug.

---

## 2026-06-06 — Iteration 61 — `@watchdog` heartbeat (idle)

No new in-lane logic. 147/147 pass. No bug.

---

## 2026-06-06 — Iteration 60 — `@watchdog` heartbeat (idle)

No new in-lane logic (index.js checked iter-59). 147/147 pass. No bug.

---

## 2026-06-06 — Iteration 59 — `@watchdog` heartbeat (scene-consolidation churn; index.js touch incidental)

Scene-consolidation refactor (@phaser lane): new `src/scenes/featureScenes.js` + main.js/inventory/
roster. `server/index.js` touched but structurally unchanged — same routes (handleAdmin, monstertypes,
leaderboard, health) + WS + tick. No new server logic in my lane. 147/147 pass. No bug.

---

## 2026-06-06 — Iteration 58 — `@watchdog` heartbeat (idle)

No in-lane changes. 147/147 pass. No bug.

---

## 2026-06-06 — Iteration 57 — `@watchdog` heartbeat (idle)

No new in-lane code. 147/147 pass. No bug.

---

## 2026-06-06 — Iteration 56 — `@watchdog` heartbeat (idle)

No new in-lane code (audio.js checked iter-55). 147/147 pass. No bug.

---

## 2026-06-06 — Iteration 55 — `@watchdog` heartbeat (audio tweak + render-lane churn)

audio.js touched (~+10 lines, likely new recipes/events): parses OK, guards (muted/no-ctx/resume/
inited) + exports intact — benign. Render/scene/theme churn = @phaser lane. 147/147 pass. No bug.

---

## 2026-06-06 — Iteration 54 — `@watchdog` heartbeat (idle)

No in-lane changes. 147/147 pass. No bug.

---

## 2026-06-06 — Iteration 53 — `@watchdog` heartbeat (idle)

Only world.test.js touched (reviewed area). No new source logic/files. 147/147 pass. No bug.

---

## 2026-06-06 — Iteration 52 — `@watchdog` heartbeat (idle)

No new in-lane code (touched files = reviewed sprint/aiconfig batch). 147/147 pass. No bug.

---

## 2026-06-06 — Iteration 51 — `@watchdog` heartbeat (idle; new file is render-lane)

No new agnostic-core code (touched core files = already-reviewed sprint/aiconfig). Only new file
`src/render/atmosphere.js` = `@phaser`/render lane (not reviewed/touched per ownership). 147/147 pass. No bug.

---

## 2026-06-06 — Iteration 50 — reviewed new sprint/stamina system + aiconfig wiring closed (138→147)

- **`src/engine/movement.js`** (pure sprint/stamina, shared SP+server): `sprintingNow` (hysteresis via
  `wasSprinting` floor 0-vs-MIN_TO_START), `tickStamina` (drain/regen clamped [0,MAX], `??MAX` default),
  `sprintMult`. Schema complete — all 5 `SPRINT.*` reads have `GAME.SPRINT` keys (no NaN).
  Server (world.js tickRound): stamina baselined at round start, ticked EVERY frame (regen while
  idle/fighting, before `!moving continue`), `wasSprinting` set (407) → hysteresis live, speed×
  sprintMult. **Crash-safe**: `moving = !locked && !!rp.pendingMove` short-circuits the
  `rp.pendingMove.sprint` read. Anti-cheat: server-authoritative stamina; input coerces `!!sprint`
  (128); `net.move(dx,dy,sprint)` sends it (243). +9 tests. Clean.
- ✅ **iter-49 item closed**: aiconfig wiring now complete — `initAiConfig()` at startup (index.js:46),
  auth-gated `/api/admin/aiconfig` GET/POST (admin.js), `gen.js` consumes `getAiConfig` (model/genTemp).
147/147 pass. No bug.

---

## 2026-06-06 — Iteration 49 — reviewed new aiconfig.js + clusterTargets (136→138) — clean

- `server/aiconfig.js` (admin-editable AI model/sampling): per-field clamp (temps 0–2, maxTokens
  1–4000, topP 0–1, model trimmed/≤60), re-validates overrides on every read (bad persisted value →
  default), null/empty resets. `db.js` has loadAiConfig/saveAiConfig (no import-crash). `ai.js`
  consumes `getAiConfig(...)` for combat → defaults to gpt-4o = old behavior (no regression).
  BUG-007 `initiativeLine` confirmed intact after the ai.js edit.
- `src/engine/spiritchains.js` new `clusterTargets(origin, candidates, radius, max)` (multi/area
  chain): null-safe, squared-dist, filter→sort-nearest→`max(0,max)` slice. Pure, correct. New test.
- ⏭️ Incomplete WIP (NOT a bug — no crash; combat uses sane defaults): `initAiConfig()` not called at
  startup (index.js) ⇒ DB overrides never loaded; admin route (`allAiConfig`/`setAiConfig`) not wired
  in admin.js ⇒ not editable yet; `gen.js` doesn't read `getAiConfig` despite aiconfig's comment.
  @feature to finish wiring. (Tracked like the iter-7 SPIRIT_CHAIN note.)
138/138 pass. No bug.

---

## 2026-06-06 — Iteration 48 — proactive server memory-leak / map-cleanup audit — clean

Used the idle cycle for a fresh production-relevant audit (24/7 server): lifecycle of every
long-lived Map. No leak — all have complete cleanup:
- `combats`: created startCombat; deleted endCombat (732) / disconnect (244, via rp.inCombat) /
  run-end (584). Async AI `.then` re-checks `combats.has()` → no re-add after disconnect; rp.inCombat
  nulled on both delete paths (no dangling ref).
- `rounds`: deleted at players.size===0; every exit routes through endRunForPlayer, sweepDisconnected
  reaps grace-expired each tick → emptied/abandoned rounds always deleted.
- `sessions`: idle/queued deleted on ws-close (removePlayer 253); in_round kept for grace then reaped
  (sweep 271). ws.on("close")→removePlayer always fires.
- `pvps`: endPvp/endPvpFor cover all terminal+disconnect paths. queue filtered on unqueue/disconnect;
  recentResults capped 30.
Bounded + fully cleaned. 136/136 pass. No bug.

---

## 2026-06-06 — Iteration 47 — `@watchdog` heartbeat (idle)

No changes in my lane (engine/server/net/systems) or data. 136/136 pass. No bug.

---

## 2026-06-06 — Iteration 46 — `@watchdog` heartbeat (idle, unchanged)

Lane unchanged since iter-45. 136/136 pass. No bug.

---

## 2026-06-06 — Iteration 45 — `@watchdog` heartbeat (idle)

Lane idle (only spritegen cosmetic, checked iter-44). Core logic + data unchanged; all proactive
probes current. 136/136 pass. No bug.

---

## 2026-06-06 — Iteration 44 — `@watchdog` heartbeat (migration churn in @phaser lane)

Churn this cycle = @phaser lane: scenes (game/onlineGame/start) + ui/theme + spritegen (render-output
cosmetic). Sanity: spritegen parses, 5 exports intact (consumer contract stable). My core-logic lane
(engine/server/net/data) unchanged. 136/136 pass. No bug.

---

## 2026-06-06 — Iteration 43 — `@watchdog` heartbeat (steady watch; lane idle)

Nothing changed in my lane this cycle. Proactive checks all current+clean (data-integrity iter-42,
protocol iter-33, bandwidth iter-32, no-skipped-tests iter-29) — not re-running redundantly. 136/136
pass. No bug. Steady watch mode; will engage on the next agnostic-core change.

---

## 2026-06-06 — Iteration 42 — data-integrity sweep (engine JSON, my lane) — clean

No new shipping code in my lane. Used the idle cycle for a concrete in-lane check: validated the
engine's data files (data JSON is explicitly @watchdog's lane; AI-gen/persisted content can drift).
**103 monsters, 351 attacks → 0 issues**: every monster has all 7 stats with finite base+scaling1+
scaling2 and a typeName; every attack has finite damage/accuracy/energyCost/crit{Chance,Multiplier}
with accuracy∈[0,1]. So `getMonsterStats`/combat can't NaN on bundled data. Reusable probe for future
idle cycles (re-run to catch data drift). 136/136 pass. No bug.

---

## 2026-06-06 — Iteration 41 — `@watchdog` heartbeat (idle; lane quiescent)

No new shipping code in my lane (progression/gamepad/combat.js/spritegen = already reviewed iter-39/40;
spritegen touch is cosmetic — robustness verified iter-14). Recent agnostic additions all shipped with
tests (coverage keeping pace). 136/136 pass. No bug.

---

## 2026-06-06 — Iteration 40 — reviewed shared XP consolidation (P10-T4) — clean, hardens BUG-004

New `src/engine/progression.js` `grantXp` — ONE shared impl for SP (`fight.js`) + server
(`server/combat.js`), replacing two copies (133→136). Verified:
- `GAME.XP_PER_LEVEL=100` = the value SP hardcoded ⇒ **no behavior change**; the SP/server rule
  divergence (latent: both were 100) is now structurally impossible.
- Both call sites import the shared fn; **no local `function grantXp` remains in either** (drift gone).
- Shared fn keeps the while-loop (multi-level) + heal-on-level + BUG-002-safe `getMonsterStats` ⇒
  **my BUG-004 fix is preserved as canonical**, and test 3 ("multiple level-ups from one grant,
  keep remainder": 2×thr+30 → lvl 3, xp 30) **locks it against regression**.
136/136 pass. No bug — exemplary consolidation that hardens the exact area BUG-004 touched.

---

## 2026-06-06 — Iteration 39 — reviewed new engine-agnostic gamepad input (+ tests) — clean

New `src/systems/gamepad.js` + test (130→133). Engine-agnostic (Gamepad API, no engine import,
node-safe). Reviewed: `navigator`/`getGamepads` guarded → neutral when absent; axes/buttons read
defensively (`g.axes[0]||0`, `b[i]&&b[i].pressed`); move clamped [-1,1]; d-pad overrides stick;
edge-detect `prev` resets on pad-loss ("call once/frame" contract). Tests cover deadzone (both signs),
node-safe no-pad path, BTN map. Wired into onlineGame.js (scene = others' lane; module API clean).
133/133 pass. No bug.

---

## 2026-06-06 — Iteration 38 — full-build health check green; lane quiescent

No new shipping code in my lane (audio.js/test = reviewed iter-36/37). Ran a periodic full
`npm run build`: **green** (1.4s) — confirms all vetted agnostic features (gains/audio/chests/shop)
integrate cleanly under the live Phaser shim. New ">500 KB chunk" warning = expected Phaser bundle
size (build succeeds; not a bug; bundle/code-splitting is `@phaser`'s lane — obvious to them, not
flagged as a finding). 130/130 pass. No bug.

---

## 2026-06-06 — Iteration 37 — reviewed new audio.test.js (P8-T6) — sound

`@visual` added `src/systems/audio.test.js` (128→130). Well-scoped: tests mute toggle state + the
no-op guards (`assert.doesNotThrow` on `sfx` with no AudioContext / unknown name), acknowledging the
synth needs a browser. Correct in node: no `window` → `audioCtx()` null → `sfx` early-returns (no
throw), as asserted. audio.js structure intact (guards from iter-36 review). 130/130 pass. No bug.

---

## 2026-06-06 — Iteration 36 — reviewed new engine-agnostic audio system (P8-T6) — clean

New `src/systems/audio.js` (procedural SFX, `@visual`). Engine-agnostic (pure Web Audio + localStorage,
zero imports → migration-safe). Reviewed: correct Web Audio handling — exponential-ramp floored at
0.0001 (and `slideTo` at 1), buffer length `max(1,…)`, lazy `AudioContext` w/ window+webkit guard +
try/catch, `resume()` on suspended (autoplay policy), mute persisted + checked at seq fire-time,
idempotent `initAudio` (module flag → no dup listeners), every recipe try/caught. Parses OK; wired
into `onlineGame.js` (scene = others' lane; module API clean). 128/128 pass. No bug.

---

## 2026-06-06 — Iteration 35 — `@watchdog` heartbeat (idle); confirmed Phaser-aware to user

User checked I knew about the Kaboom→Phaser swap — yes: learned iter-22 (ENGINE_EVALUATION), confirmed
via roster/CLAUDE.md iter-25/26, tracked shim (iter-27) + go-live (iter-30: main.js imports the shim,
kaboom dep removed). Operating as `@watchdog` accordingly (agnostic core; stay out of `@phaser`'s
render/scene lane). My lane quiescent this cycle. **128/128 pass. No bug.**

---

## 2026-06-06 — Iteration 34 — `@watchdog` heartbeat (idle; loadtest tool added)

No new shipping code in my lane (world.js/net.js/tests = already-reviewed gains+perf). New
`tools/loadtest.mjs` = QA stress tool (non-shipping). Concurrency note: server is single-threaded;
the one async-interleave hazard (combat resolve vs disconnect) is guarded (`session.resolving`,
`world.combats.has()` re-checks, `removePlayer` deletes the combat) — no untested hazard. 128/128. No bug.

---

## 2026-06-06 — Iteration 33 — proactive protocol cross-check (clean) + fix-survival confirmed

Proactive watchdog check given ~8 features piled onto welcome/snapshot payloads this session:
cross-checked every server→client message `t:` against `net.js` handlers. **No drift** — all real
outbound types (welcome/queued/matchFound/roundStart/snapshot/combatStart|Update|End/extracted/died/
roster/killfeed/shop/pong) have a `case`, OR are consumed via the event emitter (`error`,
`server_info` → `net.on`). `Fire`/`Water`/`buyChain` were grep noise (literals/inbound refs).
Field-level welcome+snapshot ↔ net.js reads also consistent (team/vault/chains/equippedChainId/gold/
stats/projectiles/chests/killfeed/gains).

Also: `fight.js` re-themed (cosmetic `THEME.*`); confirmed **BUG-004 (grantXp while-loop) and BUG-009
(finalizeRunChains on death paths) survive intact**. fight.js is a scene (others' lane) — not churned.
128/128 pass. No bug.

---

## 2026-06-06 — Iteration 32 — reviewed new in-lane test: snapshot-bandwidth guard (P6-T4) — healthy

New `server/perf.test.js` (126→128). Snapshot-bandwidth regression guard: measures single-player +
worst-case clustered-16-player snapshot sizes vs generous budgets (16KB/player, 256KB/broadcast).
Sound test (structuredClone rivals to avoid partial-object crashes; clears monsters to isolate
player-list growth). Verified the ACTUAL measured baselines are lean, not just under budget:
- single-player snapshot **709 B**; clustered 16-player **max 1193 B/snap, 18.6 KB/broadcast**.
- ⇒ ~143 KB/s peak aggregate outbound at 16p (×7.5 snaps/s) — comfortable; AoI filtering working.
No bug. (world.js/net.js recent touches = the gains feature reviewed iter-31 + this guard.)

---

## 2026-06-06 — Iteration 31 — reviewed new in-lane feature: round-end gains (P8-T3) — clean

`@feature` landed the round-end gains summary in MY lane (`server/world.js` + `src/net.js` + new
`server/gains.test.js`; 122→126 tests). Vetted end-to-end as quality gate — sound, no bug.

### Reviewed clean
- `runStartSnapshot(profile)` baselines {caught, teamXpSum, teamLevelSum, at} at round start
  (world.js:363, in generateRound spawn loop); cleared at run-end (598); preserved across reconnect.
- `computeRunGains(s)`: per-run deltas all `Math.max(0,…)`-clamped (no negatives even when death
  swaps in a weaker team); defensive on missing `runStart`/profile (→ zeros). **Computed at line 597
  BEFORE the death branch wipes `activeMonsters` (612)** — correct ordering, explicitly commented.
- Helpers `teamXpSum`/`teamLevelSum` (558-559): null-safe (`(team||[]).reduce`, `m.xp||0`).
- Sent on both `extracted` (605) + `died` (616); `src/net.js:91` stores `gains: m.gains || null` in
  `roundResult`. 4 new tests cover deltas, no-runStart→zeros, death-clamp, and message-carries-gains.

---

## 2026-06-06 — Iteration 30 — `@watchdog` heartbeat; migration milestone (shim now active)

`@phaser` progress: `main.js` now imports kaboom from the Phaser-backed shim (`./compat/kaboomShim.js`)
and the real `kaboom` dep was removed from `package.json` — game runs on Phaser via the shim now.
This is `@phaser`'s lane; dep removal can't touch the agnostic core (no engine imports there by
design), and the logic suite confirms it. Agnostic core unchanged this cycle. **122/122 pass. No bug.**

---

## 2026-06-06 — Iteration 29 — `@watchdog` heartbeat (idle; quality-gate verified)

Agnostic core unchanged this cycle. Quality-gate check: **122 pass / 0 fail / 0 skipped / 0 todo**
— no silently-disabled tests (no `.skip`/`.todo` markers), so no regressions hidden behind disabled
tests. `@phaser` migration continues in its lane. No bug.

---

## 2026-06-06 — Iteration 28 — `@watchdog` heartbeat (idle; lane quiescent)

Agnostic core (`src/engine/*`, `server/*`, `src/net.js`) unchanged this cycle; no new files in my
lane. `@phaser` continues the render/scene migration (their gate, not mine). Logic suite green:
**122/122. No bug.** Holding the quality gate; ready to vet new agnostic-core logic when it lands.

---

## 2026-06-06 — Iteration 27 — `@watchdog` heartbeat; `@phaser` migration in flight (shim)

`@phaser` landed `src/compat/kaboomShim.js` — a Kaboom→Phaser `k.*` API shim backed by a Phaser.Game,
so scenes/render keep working unchanged (avoids rewriting all 14 scenes at once). Imported by
`main.js`. Squarely `@phaser`'s lane — not reviewing/editing; transient build churn during this
rewrite is expected, not a finding. My lane (agnostic core: `src/engine/*`, `server/*`, `src/net.js`)
**unchanged this cycle**; logic suite green. **122/122 pass. No bug.**

---

## 2026-06-06 — Iteration 26 — `@watchdog` heartbeat; read new CLAUDE.md (aligned)

New `CLAUDE.md` agent guide landed — codifies sources of truth + the multi-agent protocol + my
lane (agnostic core; avoid scenes/render during the `@phaser` migration) + green-gate (122/122).
Already operating exactly per it; no change. Agnostic core (`src/engine/*`, `server/*`, `src/net.js`)
**unchanged this cycle**; only `src/render/*` churned (@phaser's lane — not mine). 122/122 pass. No bug.

---

## 2026-06-06 — Iteration 25 — `@watchdog` heartbeat; Phaser dep landed (no code migrated yet)

ACK coordinator: confirmed as **`@watchdog`** (bug-hunt + review; this log is my heartbeat). Read
the roster + ownership + locked-decisions in `IMPLEMENTATION_PLAN.md`. My iter-22 stance matches the
rules exactly: fix bugs in `src/engine/*` + `server/*` (agnostic, migration-safe); leave
`src/scenes/*`/`src/render/*`/`main.js`/`index.html` to `@phaser`. Not claiming feature/infra tasks
(out of watchdog scope absent user direction).

State: `package.json` now has `phaser@^3.90.0` but NO source imports it — `main.js` still Kaboom,
phaser not bundled (build 240 kB, would be ~MB if bundled). `tiles.js` cosmetic again (@phaser/
@feature domain; benign). Agnostic core unchanged. **122/122 pass, build clean. No bug.**

---

## 2026-06-06 — Iteration 24 — no new bugs (cosmetic tiles.js + new QA tool)

`tiles.js` changed again (cosmetic); verified its logic invariants intact (cache loaded/pending
guards, draw bounds clamp, null checks, loadSprite try/catch) — no regression. New
`tools/shoot-round.mjs`: Playwright visual-QA harness for the online round view (non-shipping).
Still Kaboom, 122/122 pass. Codebase quiescent ahead of the Phaser migration.

---

## 2026-06-06 — Iteration 23 — no new bugs (cosmetic tiles.js tweak reviewed)

Only `src/render/tiles.js` changed: visual tuning — softer edge gradients (0.55→0.38), subtler
grain, and removal of the per-tile directional light that caused grid-seam artifacts between
neighbours. Cache/cull/draw logic unchanged (verified iter-17). Reviewed read-only (no churn, per
migration stance); sound. Still Kaboom, 122/122 pass.

---

## 2026-06-06 — Iteration 22 — no new bugs; ⚠️ Phaser migration context noted

Read `docs/ENGINE_EVALUATION.md` (strategic, not a bug report). Key context for this loop:
**the project is migrating Kaboom → Phaser 3, and a DEDICATED agent is doing that migration.**
Working tree is still Kaboom (no phaser/kaplay deps/imports yet); core green (122/122).

### Operational stance for future iterations (avoid colliding with the migration agent)
- **Focus bugfinding on the engine-AGNOSTIC core** — `src/engine/` (combat/mapgen/rng/stats/schemas/
  gamedata/spiritchains), `server/`, `src/net.js`, data JSON. This is ~40% of the code, survives the
  migration untouched, and is where logic bugs matter most. Edits here won't conflict with Phaser work.
- **Avoid churning `src/scenes/` and `src/render/`** — these are being actively rewritten to Phaser.
  Only touch them for a clear, live, Kaboom-era bug that the migration wouldn't already moot; prefer
  fixing the shared logic the scene calls into (as BUG-009 did via `finalizeRunChains`).
- Expect more transient test failures / churn as two agents work; re-verify ground truth before
  acting (cf. iter-16: the chainPickups→chests rename caught mid-edit).

No new bug this iteration.

---

## 2026-06-06 — Iteration 21 — verified BUG-009 fix; no new code

No new user code since iter-20 (only my fight.js fix is present). 122/122 pass.

### Self-review of the BUG-009 fix (across all 5 fight outcomes)
Confirmed `finalizeRunChains(false)` fires on EXACTLY the two run-ending paths and nowhere else:
- no-usable-monster entry → runResult "timeout" → finalize ✓
- `FIGHT_LOST` → runResult "defeat" → finalize ✓
- `FIGHT_WON` / `PLAYER_FLED` / `MONSTER_CAUGHT` → `k.go("game")` (continue run) → NO finalize ✓
  (provisional run-found chains correctly persist mid-run).
Precisely placed; no continue-run path wrongly forfeits chains, no death path wrongly keeps them.

---

## 2026-06-06 — Iteration 20

### ✅ BUG-009: SP combat-death kept run-found chains that should be forfeited (exploit/inconsistency)
- **Where:** `src/scenes/fight.js` — the death paths (`FIGHT_LOST` → runResult "defeat", and the
  no-usable-monster entry → runResult "timeout") navigated to `runResult` WITHOUT calling
  `finalizeRunChains(false)`.
- **Root cause:** the run-found chain mechanic (chest loot is provisional, kept only on extract) is
  resolved by `finalizeRunChains`. The server calls it symmetrically (extract→true, death/timeout→
  false in `endRunForPlayer`), and SP's `game.js` calls it for extract (`true`) and timeout
  (`false`). But SP combat-death happens in `fight.js`, which reached `runResult` directly and never
  finalized. Since chest pickups `saveCharacter` immediately with `runFound:true`, a player could
  grab chest chains then deliberately **die in combat and keep them** — contradicting the design
  (confirmed by the server's death branch dropping them).
- **Fix:** call `finalizeRunChains(character, false, getSpiritChain)` + `saveCharacter` on both
  fight.js death paths before `k.go("runResult", …)`. Win/flee/catch → game (continue-run) is
  untouched, so provisional chains correctly persist mid-run. Build clean, tests 122/122. (Shared
  `finalizeRunChains` logic is already unit-tested server-side; SP scenes aren't unit-testable here.)

---

## 2026-06-06 — Iteration 19 — no new bugs (new SP shop scene reviewed)

New `src/scenes/shop.js` (single-player Spirit Shop UI). Properly registered in main.js + reachable
from lobby.js. 122/122 tests pass, build clean.

### Reviewed clean
- `shop.js`: purchases go through the authoritative `buyChain` (affordability-checked, no exploit);
  `getSpiritChains`/`buyChain`/`chainColor` imports all resolve; gold label refreshes on buy. All 8
  chains have numeric `price` + `tier` (verified) so every row renders and is buyable.

### 🔍 Minor non-bugs (left as-is — polish, no crash/data-loss; active WIP)
- `flash()` setTimeout isn't cleared on scene-leave; if it fires post-leave it sets `.text` on a
  destroyed obj (harmless no-op, no throw). Could add `onSceneLeave(()=>clearTimeout(msgT))`.
- Buy→Refill button label doesn't update after a first-time purchase (gold still updates correctly).

---

## 2026-06-06 — Iteration 18 — no new bugs (new gold economy + spirit shop reviewed)

New feature: gold currency + a between-runs spirit shop. 117/117 tests pass, build clean.

### Reviewed clean
- `server/world.js` chest snapshot: sends only `{id,x,y}` — `c.loot` stays server-side (no loot
  info-leak; comment accurate).
- Economy: `goldForDefeat` + `GAME.GOLD.PER_EXTRACT` grant gold on defeat/extract. Schema
  completeness verified — every `GOLD.*` read (`PER_DEFEAT_BASE`/`PER_DEFEAT_PER_LEVEL`/`PER_EXTRACT`)
  has a matching `GAME.GOLD` key, so the extract/defeat path can't NaN-crash.
- `schemas.js` `buyChain`: affordability checked BEFORE deduction (no negative gold), grants
  permanent (runFound=false); re-buying an owned chain refills it (pay-to-replenish — intended).
- `server/world.js` `buyChain` handler: idle-gated (shop between runs only), `getSpiritChain`
  validates the id (anti-cheat — can't buy arbitrary ids), null def → buyChain returns false.
- `src/net.js` syncs `gold` via welcome/snapshot/shop. Consistent.

### ⏭️ Note (non-shipping, not reviewed in depth)
- `tools/shoot-sp.mjs` (new dev harness) + `docs/ENGINE_EVALUATION.md` (doc) — not player-facing.

---

## 2026-06-06 — Iteration 17 — no new bugs (new floor-tile render module reviewed)

New module `src/render/tiles.js` (textured floor tiles, replacing flat-color rects in onlineGame).
117/117 tests pass, build clean. Reviewed end-to-end; sound.

### Reviewed clean
- `src/render/tiles.js`: texture cache keyed by tile-*type* `id` (one canvas/type; per-instance
  `rotation` applied at draw, not baked — correct). `ensureTile` guarded by loaded/pending sets
  (no repeat generation), handles sync/async `loadSprite` (Promise.resolve), removes from pending on
  failure. `drawTiles` culls to camera bounds, guards `tileMap[x]`/`col[y]`, flat-rect fallback
  until a type's sprite loads. Robust against malformed color data (canvas no-ops on NaN). Sprite
  names `tile_${id}` don't collide with monster/UI sprites; self-contained mulberry32 (intentional).
- Integration: `makeTileCache()` created ONCE at scene setup (not per-frame), `drawTiles` called in
  onDraw with the persistent cache ⇒ textures generate once per type. Correct lifecycle.

---

## 2026-06-06 — Iteration 16 — transient test-failure during a live refactor (self-resolved)

Caught the suite RED mid-cycle: 2 failures (`welcome + snapshot sync` TypeError on `chainPickups`;
`walking over a loot pickup` AssertionError). Investigated rather than knee-jerk "fix the tests".

### What it actually was
The user was performing a `chainPickups` → `chests` rename (loot pickups became wall-adjacent loot
chests) and I observed the test files **mid-edit**. Production code was already fully + consistently
refactored to `chests` (world.js `spawnChests`/`processChests`, net.js `state.chests`, game.js/
onlineGame.js `drawChest`, `grantChain` gained a `runFound` flag for run-provisional loot). The 2
failing tests still referenced the removed `chainPickups` API. A re-run moments later (after the
user finished editing the tests) was GREEN: **117/117 pass**, build clean, all 8 fixes intact.

### Judgment
Deliberately did NOT edit the test files on first sight of red — the user was concurrently editing
those exact files to do the same rename, so an edit would have conflicted/duplicated. Re-verified
ground truth (re-grep + re-run) instead; the red self-resolved. Lesson reaffirmed: the working tree
changes under the loop — confirm current state before acting on a transient observation.

### Reviewed clean (the new `chests` implementation)
- `spawnChests` deterministic (seeded, distinct stream), bounded (CHESTS_PER_RUN × 80), wall-adjacent
  placement, 1–2 weighted loot via `rollChainDrop`. `processChests` bounded/validated, grants each
  loot chain `runFound`, removes chest. `grantChain(…, runFound)` flags new instances provisional;
  refills of banked chains are not at-risk. Covered by passing tests (chest grant, run-found
  kept-on-extract / lost-on-death).

---

## 2026-06-06 — Iteration 15 — no new bugs (new chain-pickup feature reviewed)

New feature landed: collectible **chain pickups** (loot on the ground that grants a chain).
Reviewed end-to-end; clean and well-tested. Tests 114/114 (feature shipped with 4 new tests), build OK.

### Reviewed clean
- `server/world.js` `processChainPickups`: bounded (one pickup/player/tick via findIndex),
  validated (def + session exist), removes the pickup, `grantChain` + `saveProfile`. Pickups
  broadcast in snapshot AoI. Sound.
- `src/engine/schemas.js` `grantChain`: refills throwCount/durability on re-pickup of an owned chain,
  else pushes a new instance; sets `equippedChainId` if unset. Array-guarded.
- `src/scenes/game.js` (SP): `generateChainPickups` (bounded: PICKUPS_PER_RUN × 60 attempts, walkable
  non-collidable placement) + `checkChainPickup` (grant+save+flash, wired into onUpdate). All imports
  present (`grantChain`, `getSpiritChains`, `rollChainDrop`) — no crash-on-entry.
- `src/engine/spiritchains.js` `rollChainDrop`: correct weighted pick — filters `dropWeight>0`,
  null on empty pool, fallback to last; `rng.next()` works with both makeRng and `{next:Math.random}`.
- Schema completeness re-checked: every `SPIRIT_CHAIN.*` read (incl. new `PICKUP_RADIUS`,
  `PICKUPS_PER_RUN`) has a matching schema key (no NaN-from-missing-key risk); all 8 chains have
  `dropWeight>0` so drops function. `src/net.js` syncs `chainPickups` from snapshot (+ test).

The /loop watchdog again did its job: vetted a freshly-landed feature, found it sound.

---

## 2026-06-06 — Iteration 14 — no new bugs (spritegen review; codebase quiescent)

No new code since iter-11 (same 4 untracked spiritchain files; nothing changed in the last cycle).
All 8 fixes intact; tests 110/110.

### Reviewed clean (last substantive unreviewed production file)
- `src/systems/spritegen.js`: monster/tile/UI procedural generation runs at startup for every type
  (a throw here would reject `init()` and break load for everyone). Robust: `rgb`/`rgba` coerce via
  `| 0` (NaN→0), `shade` clamps [0,255], `rngFor` is the seeded deterministic RNG (same type → same
  sprite), loops are bounded (spots ≤ 8), and canvas ops no-op on NaN rather than throw — so even
  malformed monster data degrades gracefully without breaking startup. No bug.

### Coverage now exhaustive
Every production module across server/engine/client reviewed; the remaining unreviewed files are
non-shipping (dev tools, build scripts, config, HTML). The /loop continues as a watchdog for NEW
code as the user develops (it caught the entire Spirit Chain feature's bugs in iters 7–9).

---

## 2026-06-06 — Iteration 12/13 — verification + PvP deep-pass (no new bugs)

Re-verified determinism/startup-critical paths and the PvP combat flow. All 8 fixes intact;
tests 110/110, build clean. No new code landed since iter-11 (same 4 untracked spiritchain files).

### Reviewed clean / re-verified
- `src/engine/mapgen.js` `findSpawnPoint`: complete fallback chain (random→linear scan→center),
  never returns undefined. `spawnMonsters` attempts-guarded, fully seed-deterministic.
- `src/engine/rng.js`: `next` is a closure (no `this`) ⇒ `findSpawnPoint`'s unbound `rng.next` is
  safe — would silently break determinism if `next` were `this`-dependent. Verified.
- `src/data.js`: startup data load robust (bundled `spiritchains.json`, monster-type server→static
  fallback, error screen on failure via main.js).
- `server/pvp.js`: loot transfer / draw / advance / killfeed all sound (re-checked).

### ⏭️ Intentionally-deferred WIP (NOT a bug — do not "fix")
- PvP initiative: `startPvp` records `pvp.initiatorId` but `resolveTurn` doesn't consume it. The
  comment states it's recorded "so the first turn can favor them **later**" — explicit deferral.
  PvP is gated OFF (`PVP_ENABLED`). When PvP initiative is built out, pass `initiator` (a.id→"player"
  / b.id→"enemy", first-turn-only then clear) to `aiResolveTurn` — which already supports it
  (BUG-007). Analogous to PvE's `session.initiator`.

---

## 2026-06-06 — Iteration 11

### ✅ BUG-008: Mid-combat reconnect leaves the client stuck on a dead combat overlay (soft-lock)
- **Where:** `src/net.js` `applyMessage` `roundStart` case — reset phase/self/players/roundResult/
  portals/killfeed but **never cleared `state.combat`**.
- **Root cause:** on a mid-fight disconnect, the server's `removePlayer` deletes the combat
  (`world.combats.delete`; "active fight is dropped, resume roaming") and keeps the round slot for
  the grace window. On reconnect, the server sends `roundStart` (resumeRound). The client kept its
  stale `state.combat`, so `onlineGame.js` rendered the combat overlay (movement locked) while the
  player was actually roaming server-side. Combat actions referenced a `combatId` the server no
  longer had ⇒ ignored ⇒ **player stuck on a dead fight screen**, escapable only via ESC→menu
  (losing the run).
- **Fix:** clear `state.combat = null` in the `roundStart` reducer. Safe because combat is only ever
  established AFTER roundStart (via `combatStart`); on resume the server already tore it down, so the
  client must match ("resume roaming"). Added regression test "roundStart clears stale combat".
  Tests 110/110, build clean.

### Reviewed clean (iteration 11 — interaction second-pass)
- `src/scenes/onlineGame.js` combat input: `act()` double-guarded (`!outcome && !waiting &&
  !awaiting`) on top of the server's `session.resolving`; `awaiting` resets on log-growth/outcome.
  Catch uses the server-side session `chainId` (set at startCombat from throw or equipped) — client
  needn't send it. Throw/cycle guarded vs combat/result. Sound.
- Reconnect/resume flow audited end-to-end — BUG-008 was the one gap (now fixed + tested).

---

## 2026-06-06 — Iteration 10 — no new bugs (SP chain-capture wiring + remaining scenes)

All 7 prior fixes intact; tests 109/109. Reached comprehensive coverage of the codebase.

### Reviewed clean
- `src/scenes/fight.js` — the SP in-battle chain capture is now fully wired: scene reads
  `chainId`/`initiator`; `firstTurn` initiative is read-then-cleared consistently across
  attack/skip/catch; `catchOpts` (multiplier/maxRarity/enemyRarity/guaranteed/skipEnemyAttack) built
  and forwarded; `consumeChainCharge` mirrors the server. Correct.
- `src/systems/combat.js` — `evaluateCatch`/`evaluateTurn` accept `opts` and forward to BOTH the AI
  prompt and the engine fallback (`...opts`/`initiator`). SP chain bonus + initiative now functional.
- `src/scenes/characterSelect.js` — character create/delete/list CRUD sound; name-input modal
  cancels prior handlers on re-open (no leak); `confirmCharacter` consistent with `createCharacter`
  (+ starter-chain grant).
- `public/sw.js` — network-first + vite content-hashed immutable assets ⇒ deploys picked up
  correctly, no stale-asset risk.

### 🔍 Minor observations (deliberately NOT fixed — benign, no crash/data-loss; avoid churn in
###    actively-reworked UI / minimal-by-intent infra)
- Modal overlays in `characterSelect.js` (name-input, delete-confirm) and `settings.js` (key-input)
  don't block clicks to the buttons behind them (Kaboom `onClick` fires for all overlapping `area()`
  objects, not just topmost). Worst case: a misclick navigates away mid-modal — no data loss. A clean
  fix would gate the underlying handlers on a `modalOpen` flag.
- `public/sw.js` caches non-`ok` responses (a 5xx during a deploy could be served offline later).
  Network-first makes this benign online; `if (res.ok)` before `cache.put` would harden it.

### Coverage milestone
Server (world/combat/pvp/store/db/admin/ai/ratelimit/content/gen/index), engine (combat/stats/
schemas/gamedata/spiritchains/rng/mapgen), client (net/storage/data + all scenes + systems + render
+ ui + sw) all reviewed across iters 1–10. 7 real bugs fixed; the rest is sound or active WIP.

---

## 2026-06-06 — Iteration 9

### ✅ BUG-007: Server AI combat ignored `initiator` — initiative mechanic silently no-ops in prod
- **Where:** `server/ai.js` `aiResolveTurn({ player, playerAttack, enemy, enemyAttack })` — dropped
  the `initiator` arg.
- **Root cause:** the Spirit Chain / ambush work added turn-order initiative: `server/combat.js`
  now passes `initiator` to BOTH `resolveTurn` (engine — honors it) AND `aiResolveTurn` (AI — did
  NOT). The SP client (`src/systems/combat.js`) already conveys initiative to its LLM, but the
  server AI path didn't. So with `OPENAI_API_KEY` set (production), the designed mechanic (wild
  encounter → enemy acts first; landing a chain → player acts first) was silently ignored — the AI
  just used its speed rule. Inconsistent with both the engine fallback and the SP path.
- **Fix:** `aiResolveTurn` now accepts `initiator` and appends a "PLAYER/ENEMY acts first this turn
  (initiative)" line to the user prompt, mirroring the SP client's wording. `node --check` OK;
  tests 106/106 (incl. engine "initiator forces turn order").

### Reviewed clean (iteration 9 — full Spirit Chain server+client wiring)
- `server/combat.js`: chain catch opts + `initiator` (consumed first-action-only, cleared) — all
  default to original behavior when no chain/initiator ⇒ no regression for plain encounters.
- `server/world.js`: `processThrows` (validates chain owned + `canThrow`; `clampAxis` on dir →
  normalized, anti-cheat) + `stepProjectiles` (bounded loop, ttl/range/wall expiry, hit→startCombat
  with initiator/chainId). `startCombat` default `initiator:"enemy"` = intended ambush (matches SP).
  `consumeChainCharge` correct; disconnect drops in-flight projectiles. `startPvp` extended with
  `initiatorId` (no breakage). Double-hit/no-usable-monster edges degrade safely (no crash).
- `src/net.js` + `src/scenes/onlineGame.js`: throw/equip methods, chains/projectiles state,
  projectile extrapolation, throw + cycleChain input (guarded vs combat/result, `chains.length<=1`).
  Fully wired, clean.
- ⏭️ Note: the ambush default means online wild encounters are now enemy-first (was speed-based) —
  intended design per the SP path, not a regression.

---

## 2026-06-06 — Iteration 8 — no new bugs (deep review of the new Spirit Chain feature)

The user wired up the Spirit Chain feature (overworld throwing + capture). Reviewed the whole
integration end-to-end; it's well-built and — critically — **backward-compatible with the live
server**. All 6 prior fixes intact; tests 101/101, build clean. The `GAME.SPIRIT_CHAIN` schema I
flagged in iter-7 was added by the user (resolves that landmine).

### Reviewed clean
- `src/engine/combat.js` (authoritative resolver, used by the server too): `resolveTurn` gained an
  `initiator` override and `resolveCatch` gained chain params — BUT all default to the original
  behavior. Verified the server calls both with NO new args ⇒ online combat is byte-identical
  (no regression). No import cycle (spiritchains.js has no imports; schemas.js doesn't import combat).
- `src/engine/schemas.js`: `SPIRIT_CHAIN` config fields (`HIT_RADIUS`,`GUARANTEED_HP_PCT`,
  `PROJECTILE_TTL_S`,`STARTER_CHAIN_ID`) all match every `SPIRIT_CHAIN.*` read in the code (checked
  by grep) — so e.g. `findMonsterNear` gets a real `HIT_RADIUS`, not NaN. `grantStarterChains`
  idempotent + load-order-safe (hardcoded fallback) + array-guarded; `createChainInstance` correct.
- Chain grant wired into BOTH client (`storage.js` create+load) and server (`store.js` create+load),
  both importing `getSpiritChain`; backfills pre-feature saves.
- `src/render/spiritchain.js`: pure Kaboom draws, `chainColor` safe default. `game.js` throw/
  projectile/aim/HUD/input all correct; `drawAim`/`drawProjectile` defined; throwCount decrement
  guarded by `canThrow`.
- ⏭️ WIP (not bugs): `fight.js` receives `chainId`/`initiator` scene args but doesn't consume them
  yet (no initiative/chain-capture effect in-battle); the server has no overworld-throw path. Active
  in-progress wiring — left alone.

---

## 2026-06-06 — Iteration 7

### ✅ BUG-006: SP loading screen hangs forever if map generation fails (unhandled rejection)
- **Where:** `src/scenes/loading.js` — `generateMap(...).then(go "game")` with **no `.catch()`**.
- **Root cause:** the loading screen has no back button; if `generateMap` ever rejects, the promise
  rejection is unhandled and the player is stuck on "Generating Dungeon…" forever with no recovery.
  The online path (`onlineLobby.js`) already guards generation with `.catch()`; SP did not.
- **Fix:** added `.catch()` that logs, shows "Map generation failed." (red) + "Returning to lobby…",
  and `k.wait(2, …)` back to the lobby so the player can retry. (`k.wait` confirmed on KaboomCtx.)
  Build clean, tests 101/101.

### Reviewed clean (iteration 7 — new parallel work + scenes)
- **Kill feed (P8-T5)** — `server/world.js` `broadcastToRound` + `endRunForPlayer`: victim is
  `round.players.delete`'d (line 504) BEFORE the broadcast (511), so survivors-only — comment
  accurate. `server/pvp.js` `endPvp`: PvP killfeed null-round-guarded. `src/net.js`: feed reset on
  `roundStart`, capped at 6, `killer||null` for non-PvP causes. All correct.
- **Spirit chains (WIP)** — `src/engine/spiritchains.js` pure math (`chainCaptureChance`, `canThrow`)
  is correct; `spiritchains.json` (8 records) valid; data layer wired (data.js/gamedata.js). BUT
  capture logic has **no caller yet** AND `GAME.SPIRIT_CHAIN` (read by `chainCaptureChance`) is
  **not defined in schemas.js** — a latent landmine: wiring it up before adding the schema will
  throw `Cannot read 'GUARANTEED_HP_PCT' of undefined`. Left for the in-progress design (no live
  crash; no caller). ⚠️ NOTE FOR USER: add `GAME.SPIRIT_CHAIN = { GUARANTEED_HP_PCT: … }` to
  schemas.js when wiring chain captures.
- `src/scenes/loading.js` otherwise minimal/correct.

---

## 2026-06-06 — Iteration 6

### ✅ BUG-005: SP overworld can freeze the browser — unbounded portal-spawn loop
- **Where:** `src/scenes/game.js` `updateCircle()` — `while (portals.length < portalCount + 1) spawnPortal();`
- **Root cause:** `spawnPortal()` tries 100 random points for a walkable tile and may find none
  (returns without pushing). When it fails, `portals.length` never grows, so the `while` spins
  **forever → frozen tab**. Failure gets likelier as `circleRadius` shrinks late in a run
  (`dist = Math.random()*circleRadius*0.8` may never hit a walkable tile). The server's
  `spawnPortal` already guards this with `if (!spawnPortal()) break;` — the client didn't.
- **Fix:** `spawnPortal()` now returns true/false; the loop does `if (!spawnPortal()) break;`
  (bounded to 100 attempts/frame, retries next frame — matches server semantics). Build + 95/95 tests.

### Reviewed clean (iteration 6)
- Swept all `while` loops in `src/`: `mapgen.js:102` DLA carve terminates (monotonic growth,
  seed-deterministic, covered by the passing determinism test); `mapgen.js:384` has an attempts
  guard; `fight.js:49` (my grantXp) decrements to termination. Only game.js was unbounded (fixed).
- `src/scenes/game.js` otherwise sound: movement (per-axis collision + diagonal normalize),
  encounter→fight handoff, portal/timeout→runResult (confirms `result:"victory"` is reachable,
  answering iter-5's open question), team HUD getMonsterStats guarded, pause/resume. Sound.

---

## 2026-06-06 — Iteration 5 — no new bugs (review-only)

No bugs found this pass; forcing a fix would be harmful. All 4 prior fixes verified intact;
tests 95/95, build clean. Parallel work landed: new `server/ratelimit.js` + `index.js` hardening.

### Reviewed clean
- `server/ratelimit.js` (NEW): token-bucket (`take(now)` time-injectable) — refill math correct,
  `last=0` first-call clamps to full, has unit tests (4, all pass). Sound.
- `server/index.js` (rate-limit wiring): per-connection bucket, violation counter that decays on
  good traffic, socket close at threshold, `maxPayload` DoS guard on the WS server. Sound. Minor
  nit (not a bug): `Number(process.env.X ?? default)` returns 0 for an *empty-string* env var
  (`??` only catches null/undefined) — only bites on deliberate misconfig; left as-is.
- `src/storage.js`: corrupt/missing-JSON falls back to `{characters:[]}`; save/find/delete correct.
- `src/scenes/runResult.js`: victory heals team / defeat→4 starters; `getMonsterStats` guarded by
  `if (mt)`; timeout treated as defeat (matches extraction theme). Sound.
- `src/scenes/inventory.js`: traced every swap/move path (same-section, cross-section swap, vault→
  active-empty, active→vault) — no monster loss, keeps ≥1 active, `filter(Boolean)` compacts sparse
  arrays. Sound.
- `src/scenes/settings.js`: API-key modal cancels prior input handlers on re-open (no accumulation/
  leak); masks key display. Sound.

---

## 2026-06-06 — Iteration 4

### ✅ BUG-004: SP combat throttles leveling to one level per fight (overkill XP delayed)
- **Where:** `src/scenes/fight.js` `handleEnemyDefeated()` and `doCatch()` — XP applied with a
  single `if (pm.xp >= 100)` instead of a loop.
- **Root cause:** A high-level monster can earn enough XP for several levels in one fight (gain
  scales with enemy level: win = 20+lvl·10, catch = 30+lvl·15), but a single `if` levels only
  once and leaves xp ≥ 100, throttling progression to ~1 level/fight. The server's `grantXp`
  correctly uses a `while` loop. (XP wasn't lost, just delayed — minor, but a real inconsistency.)
- **Fix:** Added a local `grantXp(pm, amount)` helper (while-loop, heals to new full on level-up),
  used in both spots — DRY and matching server semantics. Build clean, tests 91/91.

### Reviewed clean (iteration 4)
- **Context shift:** the user committed the roster/vault feature in parallel — `main.js` now
  registers `rosterScene` (lines 21/73), so the lobby "Manage Team" button works. The iteration-1
  "roster unwired" note is now OBSOLETE. New uncommitted edits (theme refactor) appeared in
  `bestiary.js` + `onlineLobby.js` — both reviewed, visual-only, correct (`ink()` luminance math
  sound). Build passes.
- `server/store.js` persistence: sync snapshot+`dirty.clear()` (no await between) then async upsert;
  re-queues batch on failure. No loss window. Sound.
- `server/db.js`: parameterized queries (no injection), correct multi-row placeholder indexing,
  last-write-wins upserts, graceful in-memory fallback. Sound.
- `src/scenes/fight.js`: turn flow, faint/advance, swap, flee, catch→team/vault all correct. Kaboom
  `Color` clamps RGB (hover `color.r+30` is safe — not a bug). getMonsterStats calls now safe
  (BUG-002). Minor noted: swap is a free action (no enemy turn) — appears intentional.

---

## 2026-06-06 — Iteration 3

### ✅ BUG-003: Client SP combat crashes if a saved monster's type is missing
- **Where:** `src/systems/combat.js` `buildMonsterState()` — `element: mt.element` (unguarded).
- **Root cause:** SP characters live in localStorage. If the monster data JSON changes between
  game versions (type renamed/removed), a returning player's saved monster references a missing
  type; `getMonsterType` returns `undefined` and `mt.element` throws. (BUG-002 already made the
  sibling `getMonsterStats(mt,…)` call safe; this was the remaining unguarded access.)
- **Fix:** `element: mt?.element || "Normal"` — mirrors the server's `monSnap` (`mt?.element`) and
  the file's own `chooseEnemyAttack` guard. "Normal" keeps `elementMultiplier` neutral (no crash).
  Tests 91/91, build clean.

### Reviewed clean (iteration 3 — server core + client SP combat)
- `server/world.js` tick loop, movement (per-axis collision + map-bound clamp), encounter/PvP
  detection, `updateExtraction` (timer/circle/portals/storm), `spawnPortal`, `applyStorm` — sound.
- Movement anti-cheat: client `move()` shape matches server `"input"` handler; `clampAxis` handles
  NaN/strings and clamps to [-1,1]. Disconnect grace + `sweepDisconnected` + reconnect-resume sound.
- `server/index.js` tick driver: wrapped in try/catch (so BUG-002 froze per-tick, didn't crash).
  `dt` is unbounded, BUT `mapgen` yields via `setTimeout(0)` throughout, so no real dt spike from
  map gen. Process-level stalls (deploy/GC) could still spike dt → minor (storm/teleport); left as
  a low-priority robustness note (clamping dt to ~0.25s would harden it if ever observed).
- `server/admin.js` auth: 503 without ADMIN_TOKEN, brute-force throttle (10/min → 60s lock),
  constant-time `timingSafeEqual` on sha256 digests, validated/coerced tunables. Solid.
- `src/systems/combat.js` — LLM calls try/catch → deterministic engine fallback; sound. Minor
  latent: malformed-but-present LLM JSON → `Math.max(0, undefined)`=NaN health (SP/BYO-key only,
  low priority; server `ai.js` already clamps via Number.isFinite).

---

## 2026-06-06 — Iteration 2

### ✅ BUG-002: Removing a monster type a player owns crashes server combat/tick (NaN→throw)
- **Where:** `src/engine/stats.js` `getMonsterStats()` (the chokepoint), reached unguarded from
  `server/combat.js` (`buildState`, `monSnap`, `grantXp`, `restoreEnergyPartial`) and
  `server/world.js` (`healToFull`). `teamHp` was already guarded; these were not.
- **Root cause:** `getMonsterType(name)` returns `undefined` for an unknown type. Admin route
  `POST /api/admin/monsters/remove` deletes a generated type from pool+DB with **no ownership
  check** — but players who caught that monster still hold instances. `getMonsterStats(undefined)`
  then reads `.baseHealth` of undefined → throws (or yields NaN stats), crashing the combat-start /
  XP / extract / energy-restore paths, some inside the per-tick loop (can take down a live round).
- **Fix:** Hardened `getMonsterStats` to tolerate a missing/partial `monsterType` via neutral
  fallbacks (base 60, scaling 1/1 — mirrors `gen.js` normalization). Output is **byte-identical**
  for valid types (all fields finite → used as-is); only missing fields default. Verified:
  `getMonsterStats(undefined,5)` → all-finite; tests 87/87 pass.
- **Deeper issue (noted, not fixed):** admin removal can still orphan owned instances (they now
  degrade to fallback stats rather than crash). A full fix would refuse removal of owned types or
  migrate instances — bigger feature, out of scope for a careful bugfix pass.

### Reviewed clean (iteration 2)
- `src/engine/combat.js` — resolver correct; attack fields verified against real data (accuracy/
  critChance/statusChance are 0–1, damage %-multiplier). Element matchup triangle works (data is
  capitalized Fire/Water/Nature/Dark/Light); other/dual elements intentionally neutral.
- `server/ai.js` — clamped outputs, deterministic-engine fallback on any failure. Sound.
- `server/content.js`, `server/gen.js` — generation/normalization clamps garbage LLM JSON to a
  valid MonsterType; `assignAttacks` may leave null slots but `getAttacksForMonster` filters
  nulls/unknowns safely. Sound.
- `src/engine/gamedata.js` — accessors fine; `getMonsterType` returning undefined was the root of
  BUG-002 (now absorbed downstream).

---

## 2026-06-06 — Iteration 1

### ✅ BUG-001: Caught-monster IDs collide across server restarts → silent monster loss
- **Where:** `server/world.js` `endCombat()` — caught monster `id: "m_caught_" + session.combatId`
- **Root cause:** `combatId` derives from `world.nextCombat`, which resets to `1` on every
  server start (`createWorld`). All other monster ids use the globally-unique `rid()`
  (random + monotonic counter). After a Railway redeploy, `m_caught_cN` ids repeat.
- **Impact:** If two monsters sharing an id land in one profile (same player catching again
  post-restart, or PvP loot merging two profiles' teams), `applyRoster()`'s dedup-by-id
  (`new Map(pool.map(m => [m.id, m]))`) collapses them and one monster is **permanently lost**.
  `vaultMonsters.filter(m => !seen.has(m.id))` compounds it.
- **Fix:** Added `newMonsterId()` to `server/store.js` (wraps `rid("m")`); `endCombat` now uses it.
  Nothing depended on the `m_caught_` prefix (grep-verified). Tests: 87/87 pass.

### Reviewed clean (working-tree changes for the roster/vault + flat-theme refactor)
- `server/world.js` `applyRoster` — dedup/cap logic sound (VAULT_SIZE=100, never empties team).
- `src/net.js` — vault/roster wiring + `on()` returns unsubscribe; `applyMessage` emits `roster`.
- `src/render/character.js`, `src/systems/spritegen.js` — visual only; palette refactor robust
  (lowercases + aliases element names). `roundRect` is browser-only (player sprite), fine.
- `src/scenes/lobby.js`, `start.js`, `characterSelect.js`, `game.js`, `onlineGame.js` — theme
  refactor + facing-direction `dir` plumbing all consistent. Build passes (vite, 33 modules).
- `server/combat.js`, `server/pvp.js` — combat/loot logic sound; monster ids unique within a
  run via `rid()` (the cross-restart edge was BUG-001, now fixed).

### 🔍 / ⏭️ Notes (not bugs / out of scope)
- ⏭️ `src/scenes/roster.js` (untracked, WIP P8-T2): not registered in `main.js`, nothing calls
  `k.go("roster")` — dead/unreachable until wired. Internally looks correct. Left as feature WIP.
- Note: PvP loot (`endPvp`) concats looted team into winner vault without re-capping VAULT_SIZE;
  harmless (applyRoster slices later), low priority.
