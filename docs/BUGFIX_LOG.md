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

## 2026-06-07 — Iteration 220 — start.js audited (clean) — full codebase scene coverage reached

No new commits since cf8beeb; character-cosmetics feature still uncommitted (stable+green, another
agent's WIP — left). Audited `src/scenes/start.js` (12 lines): title is a pure-HTML overlay; scene
just draws THEME.bg backdrop + dispatches "tq:title" (try/catch for no-DOM tests). No logic, no bug.
COVERAGE MILESTONE: have now audited the whole codebase — engine (combat/gamedata/stats/schemas/rng/
mapgen/progression/movement/upgrades/rosterSort/spiritchains), ALL server modules, client core (net/
data/systems combat+spritegen+a11y), all scenes (loading/start/roster/onlineShop/onlineBaseUpgrades/
cosmetics/bestiary/onlineLobby/fight/game/onlineGame), render (character/tiles/spritegen) + shim.
Only deferred: index.html pure-HTML title overlay (@phaser lane, can't edit, live/working).
217/217 pass, lint+build clean.

---

## 2026-06-07 — Iteration 219 — reviewed SP fight.js floating-number system (VS-22 complete, clean)

cf8beeb (VS-22 SP heal +N) committed → reviewed the SP fight.js floater system (d21115d damage +
cf8beeb heal), no bug: spawnDmgFloater guards `if(!(dmg>0)) return` (no zero/neg/NaN, covers catch
path); per-floater k.onDraw cancelled at age≥0.8 via handle.cancel() — verified shim k.onDraw returns
a working cancel (splices _draws) → NO leak; +N green heal / -N damage; 4 guarded spawns per turn
(enemy/player × damage/heal). MP (array-filter) + SP (onDraw+cancel) lifecycles differ but both
correct. VS-22 now complete + correct across BOTH modes. 217/217 pass, lint+build clean.
(Character-cosmetics feature still uncommitted across several cycles — review on commit.)

---

## 2026-06-07 — Iteration 218 — reviewed canvas-fill shim + VS-22 heal floater (both clean)

Two commits reviewed, no bug:
• 896bdb3 (canvas fill/no-letterbox — @phaser shim lane, reviewed not edited): replaces fixed 1280
  design width with aspect-derived designW() (clamp 960-2560), reusing the EXISTING proven
  FIT+RENDER_SCALE+pointer mechanism → input-coord mapping preserved by construction (only W's value
  changes; scenes lay out vs k.width/height). Debounced resize re-fits + restarts MENU scenes only
  (gameplay game/onlineGame/fight skipped → no run reset). Minor edges (resize while typing nickname
  / mid-roster-edit) = owner's call. Passed gate + author's multi-aspect manual verify.
• 1b7938a (VS-22 heal +N): symmetric to the damage floater — HP-increase pushes green +N
  (round(cur-prev)>0), rendered `${heal?"+":"-"}${dmg}`; same lifecycle; HP delta is net up XOR down
  per turn so exactly one branch fires (no double floater). Correct.
217/217 pass, lint+build clean. (Character-cosmetics feature still uncommitted — review on commit.)

---

## 2026-06-07 — Iteration 217 — proactive audit: loading.js boot scene (clean)

Audited `src/scenes/loading.js` (SP boot/map-gen → game), no bug: BUG-006 fix intact (generateMap
.catch → "MAP GENERATION FAILED" → wait 2s → lobby; no stuck screen / unhandled rejection); VS-14
no-leak (DEV shows error capped 90 chars, prod generic); a11y glow respects prefersReducedMotion;
progress callback gets valid 0-1 from mapgen (no NaN). Robust boot path. 217/217 pass, lint+build
clean. NOTE: large in-progress character-cosmetics feature uncommitted (new src/render/
characterCosmetics.js + character.js/cosmetics.js/theme.js/game.js + compat/kaboomShim.js [@phaser
lane]) — left alone (mid-write); will review on commit, won't touch the shim.

---

## 2026-06-07 — Iteration 216 — proactive audit: roster.js management scene (clean)

Audited `src/scenes/roster.js` (roster/vault + chain tab), no bug: swap bounds match server —
fieldFromVault rejects at active>=TEAM_MAX(4), storeFromActive rejects at active<=1 (mirror
applyRoster's ≥1/≤TEAM_SIZE; server authoritative). sync()=setRoster after each swap. Identity-stable
mapping (viewVault[idx]→vault.indexOf(m); chain cards) via audited rosterSort reference-stability.
No vault-cap issue (swaps rearrange existing → total constant ≤ TEAM_SIZE+vaultCapacity, applyRoster
never drops on rearrange). Optimistic chain equip safe (only owned chains tappable). Listener cleanup
(offRoster in onSceneLeave); filter-cycle defensive (stale→all). Integrates correctly with rosterSort
+ my vault-cap/applyRoster fixes. 217/217 pass, lint+build clean. (fight.js being edited uncommitted
— VS-22 SP follow-up — left alone.)

---

## 2026-06-07 — Iteration 215 — reviewed VS-22 floating damage numbers (clean)

VS-22 (commit 7fb636a): MP combat floating "-N" damage numbers on HP drops. Reviewed, no bug:
lifecycle sound — dmgFloaters filtered per-frame (>0.8s dropped) + reset to [] on new combat (no leak/
stale carry-over); damage pushed only inside the HP-drop guard so Math.round(prev-cur) is positive+
finite (+ defensive dmg<=0 skip); one floater per hit (prev updated after check); rendering rises+
fades (op∈(0,1]), amber enemy/red self, fixed screen-space, no NaN. Reuses existing hit-flash HP-delta
bookkeeping (no new state plumbing). Pure VFX, no state/determinism impact. 217/217 pass, lint+build
clean.

---

## 2026-06-07 — Iteration 214 — proactive audit: cosmetics.js skin-select (clean, CN-12-consistent)

Audited `src/scenes/cosmetics.js` (chain-skin browse/equip), no bug: equip → setEquippedSkinId
(localStorage); cross-input safe (onMousePress+onTouchStart → shim wasTouch routing, one per tap);
backScene/backArgs (LS-14) honored; RARITY_COLOR fallback to neutral. CN-12 consistency verified —
cosmetics doesn't call net.setSkin but doesn't need to: skin changes happen only at idle/lobby/title
(no mid-round route to cosmetics), and onlineGame.setSkin(getEquippedSkinId()) on round entry syncs
the current skin to the server → rivals. Correct separation (no net coupling in the SP-capable
cosmetics scene). 217/217 pass, lint+build clean. (onlineGame.js being edited uncommitted — left.)

---

## 2026-06-07 — Iteration 213 — reviewed LS-16 CI gate (lint+test+build) (clean)

LS-16 (commit 792512e): .github/workflows/ci.yml now runs npm ci → lint → test → build (separate
steps, fails on first failure; lint fails fastest). Enforces the LS-6 no-undef gate (JOY-crash class)
on PRs, not just locally. Workflow valid (node 20, npm cache, npm ci first). Minor (NOT a bug):
commit msg says "was build-only" but the diff shows npm test was already present — the real change is
ADDING the lint step + moving build last; message overstatement, no functional impact. Good CI
hardening. 217/217 pass, lint+build clean.

---

## 2026-06-07 — Iteration 212 — reviewed CN-12 MP chain-skin cosmetic sync (clean)

CN-12 (commit 74a79b1, +2 tests → 217): syncs chain-skin cosmetics across MP (was localStorage-only
→ rivals all showed YOUR skin). Reviewed end-to-end, no bug:
• Server: setSkin validates `/^[a-z0-9_-]{1,24}$/i` (anti-injection + length cap), stores on profile,
  broadcasts rivals' skinId in snapshot player list. net.setSkin wired; reducer preserves the player
  object incl. skinId.
• Render: drawCharacter takes per-character `skin`; rivals drawn with getSkin(p.skinId), self with
  getEquippedSkin(). CRITICAL check — drawCharacter does `skin || getEquippedSkin()`, so if getSkin
  returned falsy for a no-skin/unknown rival it'd bleed YOUR skin onto them (the very bug fixed). But
  getSkin = find(...) || DEFAULT_SKIN → ALWAYS truthy (verified null/undef/""/unknown→aether). So no
  bleed: rival-with-skin→theirs, rival-without→default(not yours), self→own, SP→own. Correct.
217/217 pass, lint+build clean.

---

## 2026-06-07 — Iteration 211 — proactive audit: onlineShop.js money-path UI (clean)

Audited `src/scenes/onlineShop.js` (spirit shop buy/craft), no bug — same correct pattern as
onlineBaseUpgrades: server-authoritative (net.buyChain/craftChain → server re-validates idle+gold/
essence; client checks UX-only); cross-input safe (onMouseRelease+onTouchEnd → shim wasTouch routing,
one per tap, no double-buy, iter-181); listener cleanup (offShop in onSceneLeave); craft/refill
correct (upgradeFor gates Up to owned+next-tier; upgradeCost(def.tier)+craftChain(def.id); "Refill"
buys at def.price, banked via my iter-171 grantChain fix). Money path correctly wired.
215/215 pass, lint+build clean. (Large in-progress change world.js/net.js/character.js/onlineGame.js
uncommitted — will review on commit.)

---

## 2026-06-07 — Iteration 210 — reviewed NC-7 concurrent-connection cap (clean)

NC-7 (commit 4070da6, +1 test → 215): createConnLimiter({maxTotal=600}) caps concurrent WS conns
(OOM/DoS guard). Reviewed the critical leak surface, no bug: counting is balanced — every accepted
socket (add()→true, total++) registers ws.on("close", ()=>remove()); rejected (add()→false) doesn't
increment → each ++ has a matching --. No race (close listener registered synchronously before any
async close fires). Error→close so the no-op error handler doesn't leak. remove() clamps ≥0;
over-cap → close(1013)+return. Default 600 sensible + env-tunable. Per-IP cap deferred w/ sound
proxy-trust reasoning. Rounds out server defense-in-depth (NC-1/7/8, payload cap, origin, LS-2/9/10).
215/215 pass, lint+build clean.

---

## 2026-06-07 — Iteration 209 — proactive audit: spritegen.js procedural sprites (robust, clean)

Audited `src/systems/spritegen.js` (899 lines, procedural monster sprites), no bug — robust against
all monster data: paletteFor handles null/compound elements + falls back to NEUTRAL palette for any
unknown element (so all 19 incl. rare freeform render, no crash); generateMonsterSprite defensive on
every field (mt.element neutral-fallback, mt.size||2, mt.rarity||1, deterministic rngFor(name|elem)).
No unguarded access → no NaN/crash on the CN-2 new monsters or CN-6 elements.
🔍 Minor visual note (NOT a bug, @visual/art lane): 6 rare elements (Cosmic/Ethereal/Ghost/Lunar/
Mercury/Void) lack a dedicated sprite palette → grey neutral SPRITE while their UI element dot uses
elementColor's distinct hash-color (sprite↔UI inconsistency). Polish gap (add palettes), not a
crash/correctness issue. 214/214 pass, lint+build clean.

---

## 2026-06-07 — Iteration 208 — reviewed NC-10 reconnect-state + SP portal compass (both clean)

Two commits reviewed, no bug:
• NC-10 (d473897, 213→214): fixes the reconnect wrong-zone/no-portals/wrong-timer flash. End-to-end
  correct: server resumeRound now sends time/circle/portals/chests (AoI-filtered, matches snapshots)
  + resumed:true; client roundStart reducer renders them on resume (m.resumed?…:cleared), clears on
  fresh — extends my iter-176 fix, degrades gracefully if fields absent. Fresh-round time not reset
  but negligible (snapshot sets it ~133ms; VS-21 timer only shows last 60s). Targets the resume case
  (frequent on redeploys).
• SP portal compass (0050891): VS-20 parity in single-player (game.js). Same guarded math as the
  reviewed-clean VS-20 — atan2 + edge-clamp with `(Math.abs(c)||1e-6)` div-by-zero guard. Faithful
  port.
214/214 pass, lint+build clean.

---

## 2026-06-07 — Iteration 207 — proactive audit: server/prompts.js (clean) — server-side coverage complete

Audited `server/prompts.js` (admin-editable AI prompt store), no bug: getPrompt returns override
(non-empty string) else default; setPrompts iterates only DEFAULT_PROMPTS keys (no arbitrary-key
injection), string-only values, reset-on-empty; defensive init (load fail → {}); admin-auth-gated
so editing the system prompt is no priv-esc. combatSystem default consistent w/ engine (6 canonical
+ matchup table) + carries the LS-9 untrusted-data note; post-CN-6 freeform elements interpreted
freely per two-tier design. Completes clean coverage of ALL server modules (index/world/combat/ai/
gen/content/aiconfig/prompts/admin/db/store/ratelimit/pvp). 213/213 pass, lint+build clean.
(game.js still in-progress uncommitted — left alone.)

---

## 2026-06-07 — Iteration 206 — verified elementColor render-safe for all elements (CN-6 follow-up, clean)

Tied to CN-6: verified `elementColor` (theme.js) returns valid RGB [0-255]×3 for ALL 19 current
elements AND garbage/unmapped/null/undefined (hash-fallback h=(h*31+charCodeAt)>>>0 handles any
string; nullish guarded) — 0 bad across 23 cases. So no element (incl. rare freeform Mercury/
Ethereal/Cosmic or future AI-gen strings) can crash element-dependent rendering (k.rgb(...
elementColor(e))). Completes the element-system end-to-end check post-CN-6: data normalized+valid,
combat two-tier+fuzzed clean (iter-200), rendering robust. 213/213 pass, lint+build clean. No bug.
(Another agent editing game.js uncommitted — left alone.)

---

## 2026-06-07 — Iteration 205 — reviewed CN-6 element taxonomy normalization (clean)

CN-6 (commit 5428ae4, 26→19 elements): the in-progress element work landed. Reviewed, no bug:
regression test guards no deprecated synonym (Shadow/Darkness/Wind/Holy) + no compound (incl "/"),
covering exactly what was removed. 19 remaining elements all valid (5 matchup-canonical + 14 freeform;
elementColor hash-colors arbitrary strings → none colorless). Zero gameplay risk — element is
type-derived at runtime (getMonsterType().element) so a type's rename updates all instances
consistently, no stale state. Canonical merges (Shadow/Darkness→Dark, Holy→Light) now give those
monsters deterministic matchups (partially actions my iter-193 element-coverage note), rare freeform
elements intentionally kept (design call, consistent w/ two-tier wiki design). 213/213 pass,
lint+build clean.

---

## 2026-06-07 — Iteration 204 — observed in-progress element normalization (sound, another agent's content lane)

No new committed code since GP-14. Tree has another agent's in-progress monstertype.json edit (+
content.test.js +1 → 213): element synonym/compound consolidation — Darkness/Shadow→Dark, Holy→
Light, Fire/Ice→Fire, Nature/Water→Nature, Water/Ice→Ice, Wind→Air (13 swaps). Verified structurally
sound: all targets are valid/known elements (theme.js colors exist; wind already aliased to air's
color); canonical mappings (Dark/Light/Fire/Nature) now enable deterministic matchups for those
monsters; partial cleanup (rich vocab Ice/Air still allowed) consistent with the two-tier element
design + green gate (a canonical-only test would fail the ~50 still-non-canonical). Content/balance
= design lane, not mine; valid data, gate green → left alone, will review on commit. 213/213 pass,
lint+build clean. No bug.

---

## 2026-06-07 — Iteration 203 — verified GP-14 wiki sync matches code (no spec/impl drift)

GP-14 (commit 61d0a49) refreshed public/wiki.html (design source of truth) to current mechanics.
Cross-checked the recently-changed mechanics wiki↔code (I reviewed all these): sprint 26 drain/28
regen + no-flicker resume (GP-4 ✓); catch-heal references GAME.CATCH_HEAL_FRACTION + "CB-9 not dead
weight" (CB-9 ✓, references the constant not a hardcoded number — stays accurate if tuned); scaling
`base+s1*level^s2` with 1.3 cap (CN-4 ✓); element matchup table ×1.3/×0.7 + Dark/Light ×1.2 +
canonical-deterministic/AI-freeform two-tier (✓ per iter-193). No spec/impl discrepancy — design
spec correctly mirrors the implementation, future agents won't be misled. 212/212 pass, lint+build
clean. No bug.

---

## 2026-06-07 — Iteration 202 — proactive audit: src/data.js client data loader (clean)

Audited `src/data.js` (client data gateway), no bug: loadGameData fetches 4 bundles in parallel
with per-file r.ok checks (throws w/ filename); monster pool prefers /api/monstertypes (validates
non-empty array) with graceful fallback to static monstertype.json on any error (HTTP/malformed/
empty) — documented degraded mode. Re-exports keep the ../data.js import surface stable. The
fallback-pool edge (lacks server AI-gen types) only affects bestiary/SP/sprite display, NOT MP
correctness (MP renders server-snapshot monsters; terrain pool-independent per iter-183; data side
orphaned-type-hardened per iter-175). Clean loader. 212/212 pass, lint+build clean.

---

## 2026-06-07 — Iteration 201 — reviewed GP-10 spawn-level config honoring (clean)

GP-10 (commit 047d4dd): spawnMonsters `rng.int(1,5)` → `rng.int(GAME.SPAWN_LEVEL_MIN, _MAX)`.
Reviewed, no bug: constants are 1/5 → identical values + behavior; GAME already imported (used by
biomeSpeedMultAt); determinism preserved (rng.int consumes one next() regardless of bounds → same
seeded sequence). No desync (MP renders server-snapshot monsters; terrain independent of spawn
level). Note: SPAWN_LEVEL_MIN/MAX is a frozen GAME const, NOT yet in admin TUNABLES/world.cfg, so
not actually runtime-tunable yet — GP-10 just removes the dead-config smell (read vs hardcode),
which is correct. Pure refactor, no behavior change. 212/212 pass, lint+build clean.

---

## 2026-06-07 — Iteration 200 — adversarial combat fuzz over FULL expanded dataset (clean)

No new code since GP-4. Re-fuzzed both combat paths against the full current content (115 monsters
incl. GP-1/CN-2's +12, CN-4-capped scaling, all attacks, all 8 chains):
• resolveTurn: 20,000 turns (random monster/attack pairs, levels 1-20, both initiators) → 0 bad
  (no NaN, HP always in [0,max], narrative always string, no throws).
• resolveCatch: 15,000 attempts (varied HP/rarity/chain, ±skipEnemyAttack) → 0 bad, 4583 caught
  (~31%), caught always boolean, player HP finite/≥0.
Confirms the engine is robust against the data expansion (GP-1/CN-2/CN-4) + catch changes (CB-9) —
~35k resolutions clean. 212/212 pass, lint+build clean. No bug.

---

## 2026-06-07 — Iteration 199 — reviewed GP-4 sprint retune (clean)

GP-4 (commit e28d3cf): GAME.SPRINT retune — DRAIN 32→26, REGEN 18→28, MIN_TO_START 8→16. Reviewed,
no bug: all values sane (drain/regen >0; MIN_TO_START 16 < STAMINA_MAX 100 so restart floor always
reachable). Cross-checked vs movement.js (iter-185 audit): sprintingNow floor (MIN_TO_START to start
/ 0 to continue) valid; tickStamina only multiplies/clamps these, no division → no edge break.
Burst ~3.85s, restart ~0.57s, ~52% uptime. Movement tests assert against the constants → stay green.
Pure tuning, no logic touched. 212/212 pass, lint+build clean.

---

## 2026-06-07 — Iteration 198 — reviewed GP-5 player spawn-spread (clean)

GP-5 (commit 36189a9, +1 test → 212): findSpreadSpawns(voidMap, rng, count, minSep=24) replaces
per-player findSpawnPoint so 16 players don't start on one cluster. Reviewed, no bug: deterministic
(seeded spawnRng; rejection re-rolls vary consumption but reproducible; spawn→player by ids.entries()
index, Map preserves join order; spawn rng separate from map-gen so map unaffected); spread correct +
bounded (farEnough ≥24 tiles from all placed; ≤8 re-rolls then accept fallback — never infinite on
sparse caves); edges fine (count 0→[], 1→always far). Loop accepts first far-enough roll (or last);
"best" var is a misnomer for "last" but logic correct. Test: 16 spawns ≥24 apart. 212/212 pass,
lint+build clean.

---

## 2026-06-07 — Iteration 197 — reviewed GP-7 portal quadrant-spread (clean)

GP-7 (commit 52cca86): spawnPortal now assigns each portal to the next quadrant in rotation so
far-edge players always have a reachable exit. Reviewed, no bug: determinism preserved (GP-8 seeded
portalRng; quad = portals.length%4 is count-derived; ang/dist seeded); quadrant math correct
(ang = quad*π/2 + rng*π/2 partitions [0,2π]; first 4 portals cover all 4 quadrants — tested);
graceful (150 in-quad tries → 50 full-circle fallback → false if none, caller retries next tick);
bounded (dist ≤ 0.85*circleRadius keeps portals in the safe zone; tx/ty bounds-checked). Same
pre-existing circleRadius-timing caveat as GP-8, nothing new. Good reachable-extraction fix,
complements VS-20 compass. 211/211 pass, lint+build clean.

---

## 2026-06-07 — Iteration 196 — reviewed CB-9 caught-monster HP stabilization (clean)

iter-194 gen.js scaling2 cap committed (67c543c, +1 test → 211). CB-9 committed (0ef1689) — reviewed:
caught monster now joins at GAME.CATCH_HEAL_FRACTION (0.5) of MAX HP/energy instead of near-death
combat HP. Both paths correct + consistent: MP world.js endCombat uses
getMonsterStats(getMonsterType(e.typeName), e.level); SP fight.js uses enemyStats (level-based max);
both `Math.max(1, round(maxHealth*0.5))` + `round(maxEnergy*0.5)` from the single-source constant.
Math.max(1) prevents a fainted catch; orphaned-type-safe (getMonsterStats fallback, iter-175);
coexists cleanly with my iter-178 vault cap in the same endCombat (heal sets HP, cap decides keep/
drop). Fixes the core taming payoff (was ~3/300 useless). No bug. 211/211 pass, lint+build clean.
(Another agent's new world.js edit uncommitted — will review on commit.)

---

## 2026-06-07 — Iteration 195 — verified concurrent CB-9 edits safe + non-circular import (no bug)

Tree has concurrent in-progress CB-9 catch-heal (schemas.js CATCH_HEAL_FRACTION + world.js/fight.js)
alongside my uncommitted iter-194 gen.js fix. Verified the combined state:
• schemas.js now `import { vaultCapacity } from "./upgrades.js"` — checked for circular dep: NONE,
  upgrades.js is a pure leaf (zero imports). Safe; clampRoster (L432) uses it correctly.
• My iter-178 vault-cap fix SURVIVED CB-9's concurrent world.js edit — import (L16), applyRoster cap
  (L262), endCombat catch-path `< vaultCapacity` (L768) all intact (not clobbered).
• CB-9 catch-heal (endCombat L758-9: caught mon → cs.health*CATCH_HEAL_FRACTION vs near-death combat
  HP) coexists cleanly with my cap (heal sets HP; cap decides keep/drop). In-progress → will review on
  commit, not mid-write.
210/210 pass, lint+build clean. No bug.

---

## 2026-06-07 — Iteration 194 — ✅ FIX (consistency): gen.js scaling2 clamp stale vs CN-4 (runaway-stat gap via gen path)

Reviewed CN-4 (commit 3be09ac): caps hand-authored monster scaling2 at 1.3 (the runaway-stat
ceiling) via surgical regex — verified ONLY *Scaling2 fields changed (0 non-Scaling2 lines; bases +
scaling1 untouched → L1 stats preserved since level^s2 at L1 = 1), all olds >1.3 → 1.3, 0 new >1.3,
+ regression test. CN-4 itself correct. But found a cross-source gap: `gen.js`
normalizeGeneratedMonster clamped AI-generated scaling2 to [0,2] (comment: "mirrors the existing
hand-authored data") — now STALE after CN-4 tightened data to 1.3. An AI-generated monster could
have scaling2 up to 2.0 → reintroduce runaway high-level stats (the exact thing CN-4 fixed) via the
generation path, violating CN-4's tested invariant. **Fix:** gen.js scaling2 clamp 2 → 1.3 (matches
CN-4 ceiling). No gen test pinned 2.0; added a test (2.7/2.0 → 1.3). 210/210 pass, lint+build clean.

⚠️ **Uncommitted** — server/gen.js, server/gen.test.js. Not self-committing per commit-only-when-asked.

---

## 2026-06-07 — Iteration 193 — GP-1/CN-2 monster data integrity verified (clean; element gap is BY DESIGN)

GP-1/CN-2 (commit cbf8789, +12 R1/R2 monsters, fixes rarity wall) committed. Ran a full monster-
data-integrity probe (115 monsters vs attacks.json): ALL have valid attack refs (no NO-VALID-ATTACKS),
sane stats (baseHealth>0), valid rarities (1-5). Probe flagged 57 "odd elements" (Ice/Earth/Electric/
Shadow/… outside GAME.ELEMENTS' 6 canonical) — INVESTIGATED, resolved as INTENDED per wiki: "the
deterministic matchup engine scores only [Fire/Water/Nature/Dark/Light]; the AI resolver interprets
the rest freely." Two-tier element system by design: deterministic engine neutral for non-canonical,
AI prompt carries the element name for free interpretation. theme.js has display colors for the rich
vocab. So the new 12 (Earth/Electric/Ice/Air) are consistent + correct, not a regression. No bug.
208/208 pass, lint+build clean.

---

## 2026-06-07 — Iteration 192 — transient test failure diagnosed (mid-write race), not a bug

First check showed tests 208 / pass 207 / FAIL 1 (AssertionError) with uncommitted
monstertype.json + content.test.js in the tree. Investigated before acting (per "re-verify"):
content.test.js passed in isolation; a full re-run was 208/208 green. → Transient: caught another
agent mid-write (monster DATA + its TEST momentarily inconsistent). NOT a real bug — correctly did
not false-alarm/patch in-flight work. Verified the monstertype.json change is PURELY ADDITIVE (444
insertions, 0 deletions — new types Cinder Mite/Pebble Pup/… ; no existing entry touched) so saves/
existing monsters unaffected; expanded pool handled by spawn (iterates any length) + client
/api/monstertypes sync. Full gate stable green. 208/208 pass, lint+build clean. No bug.

---

## 2026-06-07 — Iteration 191 — reviewed VS-21 final-minute urgency timer (clean)

VS-21 (commit 3aedcc6): drawTimeWarning() — big centered timer in the last 60s (amber → red+pulse
"STORM CLOSING" in last 30s). Reviewed, no bug: threshold `t<=0||t>60 return` shows only final
minute, hidden at timeout; t = net.state.time (server Math.ceil(remaining), integer); mm:ss math
correct (floor(t/60) + (t%60).padStart(2,'0') → 1:00/0:32/0:05); crit=t<=30 drives red/pulse. Pure
rendering, no state/determinism impact, gated like the compass (!combat&&!result&&!menu&&!onboard).
207/207 pass, lint+build clean.

---

## 2026-06-07 — Iteration 190 — reviewed VS-20 off-screen portal compass (clean)

VS-20 (commit f2d87f3): drawPortalCompass() — screen-edge arrow toward the nearest off-screen
portal during extraction. Reviewed the compass math, no bug: guards (no portals/self/on-screen →
return; portals always an array); atan2(sy-H/2, sx-W/2) correct order; edge-clamp scale =
min(hw/|c|, hh/|s|) with `(Math.abs(c)||1e-6)` div-by-zero guard for straight up/down; distance =
round(sqrt(best)/EFFECTIVE_TILE) tiles. Uses selfRender (camera center) for projection, self for
distance — negligible smoothing diff. Pure rendering (drawCircle/Line/Text), no state/determinism
impact, gated off in combat/result/menu/onboarding, only shows during extraction (portals exist
only post-circleStartS). 207/207 pass, lint+build clean.

---

## 2026-06-07 — Iteration 189 — security audit: admin.js API (clean)

Audited `server/admin.js` (auth-gated config/prompt/monster admin API), no bug — well-secured:
• Fail-closed: no ADMIN_TOKEN → 503; token check runs BEFORE every route (incl. 404 fallback), so
  no /api/admin/* endpoint is reachable unauthenticated.
• tokenMatches: SHA-256 both sides → timingSafeEqual = constant-time + no length-leak (fixed 32B
  digests). Brute-force throttle: 10 fails/60s → 60s lock, checked before the compare (429 first).
  Global not per-IP — acceptable for a single-operator fail-closed panel.
• Input hardening: readBody caps 1MB + null→400 on bad JSON; coerce/applyConfig only accept known
  TUNABLES keys (clamped); monsters/remove only deletes generated types (+ orphaned-type crash now
  guarded by iter-175). No auth bypass / validation hole.
207/207 pass, lint+build clean. (Another agent editing onlineGame.js uncommitted — left alone.)

---

## 2026-06-07 — Iteration 188 — reviewed GP-8 seeded portal spawns (clean)

GP-8 (commit 61d7fd7, 206→207): spawnPortal switched Math.random()→ seeded round.portalRng
(lazy-init makeRng(seed ^ 0x50525400), distinct constant from chests 0x517cc1b7 + map-gen).
Reviewed: lazy-init idiom correct (create-once/reuse persistent stream); per-call rng consumption
varies with rejection-sampling but deterministic given seed→voidMap; determinism test validates it.
Residual (NOT a bug, pre-existing + out of scope): portal dist scales by wall-clock-derived
circleRadius so cross-timing replays aren't bit-identical — but GP-8's scope was removing
Math.random, and portals are server-authoritative (clients render snapshots), so no gameplay/sync
impact. Also independently confirmed the commit's CB-14 NOT-A-BUG claim against combat.js:
resolveTurn pre-checks target HP (≤0→continue) + re-checks actor after its status tick +
applyStatusTick only damages the actor → a status-killed target is never attacked. Correct.
207/207 pass, lint+build clean.

---

## 2026-06-07 — Iteration 187 — audit: aiconfig.js validation + fight.js orphaned-type safety (clean)

Two audits, no bug:
• `server/aiconfig.js` — robust: num/int clamp finite + reject non-finite; SPEC validates every
  field (model ≤60 chars, temps 0-2, maxTokens 1-4000, topP 0-1); getAiConfig falls through to
  defaults on invalid override; setAiConfig only accepts known keys, resets on null/empty. Bad model
  id degrades gracefully (ai.js/gen.js catch → fallback/null). Admin-auth-gated.
• `src/scenes/fight.js` (SP combat) — confirmed orphaned-type-safe: ZERO direct `.element` accesses;
  every getMonsterType result flows only into getMonsterStats (hardened) or getAttacksForMonster
  (hardened iter-175), both undefined-tolerant. So SP combat can't crash on a deleted/missing type —
  closes the orphaned-type class across ALL THREE combat paths (server buildState [iter-175 fix],
  client buildMonsterState [already safe], SP fight.js [helper-only]).
206/206 pass, lint+build clean.

---

## 2026-06-07 — Iteration 186 — reviewed combat-button-lock UX (commit 2a48e92) (clean)

Reviewed the freshly-committed MP combat button dimming + spinner badge (onlineGame.js): dims
buttons to 0.4 and shows a "Resolving…/Waiting for opponent…" badge while input is locked.
Verified correctness: `inputLocked = !c.outcome && (awaiting || c.waiting)` is the exact inverse of
the `act()` input guard (`c && !c.outcome && !c.waiting && !awaiting`) through which ALL combat
inputs route (keys 1-4/c/f + taps) — so dimmed ⟺ taps are genuinely no-ops. combatButtons() also
returns [] during PvP c.waiting. Purely visual (opacity * lockDim + cosmetic k.time() spinner), no
determinism/logic impact. Accurate UX fix for the ~1-2s AI/PvP wait. No bug. 206/206 pass,
lint+build clean. (Another agent editing shoot-*.mjs QA harnesses uncommitted — left alone.)

---

## 2026-06-07 — Iteration 185 — proactive audit: movement.js (sprint) + pvp.js core resolution (clean)

Two audits, no bug:
• `src/engine/movement.js` (sprint/stamina, live every tick) — re-traced with fresh eyes:
  sprintingNow hysteresis correct (floor 0 while sprinting = continue-till-empty; MIN_TO_START to
  restart; stops at stamina>0→false at 0); caller orders compute→tick→record wasSprinting right;
  stamina regens every frame incl. idle/combat; sprint only drains while moving. Correct.
• `server/pvp.js` (gated off, but live 2-player combat when enabled) — resolveTurn clamps damage,
  advance() promotes first living / detects wipe, draw on mutual wipe; anti-cheat intact (ownedAttack
  + only-duelists-act); resolving guard + teardown check handle async-AI race + mid-resolve
  disconnect; endPvp NC-5 vault cap correct, endPvpFor no-contest teardown. buildState import now
  carries the iter-175 orphaned-type guard. Design-level (NOT a bug): a draw releases both with
  fainted teams — consistent with PvE wiped-team behavior; PvP gated off anyway.
206/206 pass, lint+build clean. (Another agent editing onlineGame.js uncommitted — left alone.)

---

## 2026-06-07 — Iteration 184 — reviewed freshly-landed LS-14 (lobby → Bestiary/Cosmetics nav) (clean)

LS-14 (commit 47af6a2) reviewed — online lobby now reaches Bestiary + Cosmetics:
• bestiary.js gained the backScene/backArgs contract (default "start" → backward-compatible);
  cosmetics.js already had it. Both registered in main.js (80,82) → routes resolve.
• button() signature change (added x param) fully applied — verified all 3 calls use new
  (label,x,y,…) form, no stale old-style caller that'd misread y as x. Grid is a correct 2×3
  (5 mgmt buttons + Back).
• openBestiary/openCosmetics cleanup() before k.go (no listener/HTML-input leak) and DON'T close
  the socket → connection preserved; both are client-only (global pool + localStorage skins) so no
  server join needed. Return via backScene:"onlineLobby". No bug. 206/206 pass, lint+build clean.

---

## 2026-06-07 — Iteration 183 — audit: mapgen determinism helpers + verified /legal serving (clean)

• Verified the committed CMP claim "served at /legal" (commit 18b134e): serve-handler's cleanUrls
  default maps /legal → legal.html (Vite copies public/→dist/). Holds. (No in-game link yet =
  intentional draft state.)
• mapgen.js determinism helpers clean: biomeSpeedMultAt pure defensive read; pickMonsterByLocation/
  spawnMonsters deterministic given seeded rng (ids `m_x_y`, no Date.now, level=rng.int(1,5),
  attempt-guarded); only Math.random is findSpawnPoint's explicit no-rng SP fallback.
• Reasoned through client/server desync risk from differing monster pools: NON-ISSUE — MP clients
  render SERVER-snapshot monsters (net.js state.monsters = m.monsters), not locally-generated ones;
  terrain (voidMap/biome/tiles) is seed+groundtiles deterministic, independent of monster pool.
(Other agents' bestiary.js uncommitted + legal.html/wiki.html committed content — left alone.)
206/206 pass, lint+build clean. No bug.

---

## 2026-06-07 — Iteration 182 — proactive audit: store.js persistence + starters (clean)

Audited `server/store.js`, no bug:
• `flushStore` durability is correct — dirty.clear()-before-await is safe (batch holds profile
  REFERENCES → upsert serializes latest state = last-write-wins; a re-mod during await re-marks
  dirty for next flush, no lost update; error → all batch tokens re-queued). Hard-crash-mid-flush
  loses ≤FLUSH_MS (3s), the documented coalescing tradeoff; graceful shutdown final-flushes.
• `rollStarters` — guard<200 prevents infinite loop, dedups by typeName, handles types<TEAM_SIZE.
• `getByToken` backfill correctly re-points a null equippedChainId to an existing chain.
• LS-2 secureToken intact; bumpStat/topProfiles defensive.
Non-bug note: `profiles` Map is never pruned + initStore loads all at boot → memory grows with
total players ever (documented design choice, harmless at this scale, not a correctness issue).
(Another agent's public/legal.html + wiki.html content uncommitted — static HTML, left alone.)
206/206 pass, lint+build clean.

---

## 2026-06-07 — Iteration 181 — reviewed freshly-landed CN-1 (online meta-upgrade UI) (clean)

CN-1 (commit c672dd4) landed + committed — reviewed `src/scenes/onlineBaseUpgrades.js` + wiring:
• Money path correct: client costOf/canAfford guards are UX-only; net.buyUpgrade → server
  purchaseUpgrade is authoritative (+ idle-gated). "upgrades" echo → net.js syncs gold/upgrades →
  next onDraw reflects it; scene only toasts the outcome.
• Investigated a double-buy risk (both onMouseRelease + onTouchEnd call onTap): NOT a bug — the
  shim routes pointerup by `p.wasTouch` (mouse → onMouseRelease only; touch → onTouchEnd only), and
  Phaser fires ONE pointerup per interaction, so onTap runs once per tap. Same safe idiom as
  onlineShop.js/roster.js.
• net.on("upgrades") listener cleaned up in onSceneLeave (offUp); k.* handlers are scene-scoped.
• Wiring verified: featureScenes.js registers onlineBaseUpgradesScene(k); onlineLobby.js
  k.go("onlineBaseUpgrades") (×2); scene name matches; goBack → onlineLobby. 206/206 pass,
  lint+build clean. No bug.

---

## 2026-06-07 — Iteration 180 — proactive audit: AI content pipeline (content.js + gen.js) (clean)

Proactive audit of the AI monster-generation pipeline (untrusted LLM output → live pool), no bug:
• `normalizeGeneratedMonster` — fully defensive: num() clamps non-finite→default within ranges,
  str() guards non-strings + length caps, all 7 stat keys defaulted, typeName uniqued vs existing.
  Garbage/partial LLM JSON → guaranteed schema-valid, getMonsterStats/combat-consumable type.
• `assignAttacks` — degrades to null attacks for an empty pool (combat handles via struggle + the
  iter-175 getAttacksForMonster guard).
• `aiGenerateMonster` — fetch try/caught, !res.ok throws→caught, JSON.parse(...||"{}") with optional
  chaining (malformed LLM JSON → null, not crash); any failure → null. Covered by the "degrades to
  null" test.
• `content.js` removeMonster → removeMonsterType is exactly the admin-deletion path the iter-175
  orphaned-type guards protect — confirms that fix's value.
NOTE: another agent's in-progress feature is uncommitted in the tree (src/scenes/onlineBaseUpgrades.js
new + featureScenes.js/onlineLobby.js/shoot-mpmenus.mjs) — left untouched (active work, lane). 206/206
pass, lint+build clean.

---

## 2026-06-07 — Iteration 179 — proactive audit: server untrusted-input + tick paths (clean)

iter-178 vault fixes committed (b40eb05). Deep audit of the server's untrusted-input + tick
surface, no bug:
• world.js `handleMessage` — solid anti-cheat: clampAxis on movement, combat `playerId` ownership
  check + `resolving` double-action guard, idle-gating on shop/craft/upgrade, join token-validated +
  reconnect-grace re-attach.
• `processThrows`/`stepProjectiles` — throws validate chain ownership + canThrow; throwCount
  decrements without going negative; mid-loop monster removal can't double-engage or invalidate the
  projectile iterator; projectiles stop at wall/range/ttl.
• index.js — verifyClient origin guard, maxPayload DoS guard, NC-8 rate-limit, NC-1 MAX_DT clamp
  (no stall-teleport), tick loop try/caught (one bad tick won't kill the server), send guards
  readyState, unhandledRejection keeps serving.
Mature, defensive server. 206/206 pass, lint+build clean.

---

## 2026-06-07 — Iteration 178 — ✅ FIX (x2): vault-capacity not enforced on catch + roster ignored Deep Vault

iter-176 net.js fix committed (5693053). Proactive audit of `server/world.js` (authoritative
heart). tickRound/updateExtraction correct (squared-dist consistent, extract-before-timeout,
iterate-over-copy); disconnect→death only AFTER grace (removePlayer keeps slot, sweepDisconnected
expires) — reconnect-grace intact. Found TWO vault-capacity bugs (both diverged from the canonical
vaultCapacity / NC-5 precedent):
1. ✅ **endCombat catch path (752)** pushed a caught monster to vaultMonsters with NO cap →
   unbounded vault/profile/DB growth on repeated catches with a full team (the catch-path twin of
   the NC-5 PvP-loot bug). Fix: only push if `vaultMonsters.length < vaultCapacity(prof,
   VAULT_SIZE)`; full → dropped (consistent w/ NC-5 + clampRoster).
2. ✅ **applyRoster (260)** capped the vault at base `GAME.VAULT_SIZE` (100), IGNORING the Deep
   Vault upgrade — a player who PAID for Deep Vault (cap up to 225) and reorders their roster would
   have monsters 101+ silently trimmed/lost. Fix: cap at `vaultCapacity(profile, GAME.VAULT_SIZE)`.
Imported vaultCapacity into world.js. +1 test (applyRoster Deep-Vault cap, both with/without
upgrade); catch-path fix mirrors NC-5 + reuses the now-tested vaultCapacity call. 206/206 pass,
lint+build clean.

⚠️ **Uncommitted** — working tree: server/world.js, server/world.test.js. Not self-committing per
commit-only-when-asked. Ready to commit/relay.

---

## 2026-06-07 — Iteration 177 — proactive audit: progression.js + client combat orchestration (clean)

Two proactive audits, no bug:
• `src/engine/progression.js` — grantXp while-loop is safe: GAME.XP_PER_LEVEL=100 (>0, and GAME is
  Object.freeze'd so it can't be mutated to 0 → no infinite-loop/server-hang). grantXp/healToFull
  call getMonsterStats(getMonsterType(...)) which is orphaned-type-safe (BUG-002 + iter-175). No
  MAX_LEVEL cap = design choice, not a bug. Callers pass finite positive XP.
• `src/systems/combat.js` (client combat orchestration) — already defensive: buildMonsterState uses
  `mt?.element || "Normal"`, chooseEnemyAttack guards `!monsterType`, getAttacksForMonster hardened.
  Confirms the server's buildState (fixed iter-175) was the lone drift; the client was always safe.
  Cosmetic-only diff: client falls back to "Normal", server to null — both → neutral 1.0 in the
  engine, no behavioural difference, not worth changing.
205/205 pass, lint+build clean. (iter-176 net.js roundStart fix still pending relay.)

---

## 2026-06-07 — Iteration 176 — ✅ FIX (minor): roundStart leaked previous-round spatial view state

iter-174/175 fixes committed (b74ac93, 3d4f91e). Proactive audit of `src/net.js` applyMessage
reducer (handles every server msg → client state). Solid overall (good fallbacks, correct
reconnect-window logic, captures last-known team before replacing state.self). One real
inconsistency in the `roundStart` case: it cleared players/portals/killfeed/combat/roundResult but
NOT monsters/chests/projectiles/circle — so until the first snapshot (~1-2 ticks) the client
rendered the PREVIOUS round's monsters / loot chests / in-flight chains / storm circle at the new
spawn. The asymmetry (portals cleared, circle not) shows the per-round reset was incomplete.
**Fix:** also reset monsters/chests/projectiles/circle on roundStart (parity with portals).
Low severity (self-corrects on first snapshot; client render is non-authoritative), but removes a
spawn-flash glitch. +1 test. 205/205 pass, lint+build clean.

⚠️ **Uncommitted** — working tree: src/net.js, src/net.test.js. Not self-committing per
commit-only-when-asked. Ready to commit/relay.

---

## 2026-06-07 — Iteration 175 — ✅ FIX (crash): orphaned/deleted monster type crashed combat resolution

Proactive audit of `server/combat.js`. Found a real server-side crash vector in live combat for a
monster whose type resolves to undefined (e.g. an owned monster whose AI-generated type an admin
later DELETED via P7 deleteMonsterType, or an orphaned typeName from an old save). TWO unguarded
spots — both crash `resolveCombatAction` mid-round (same class as the JOY outage):
1. `buildState` line 19 `element: mt.element` — threw on undefined mt (siblings `monSnap` +
   `getMonsterStats` were already guarded; this one was missed). → `mt?.element || null`.
2. `gamedata.getAttacksForMonster(undefined)` threw on `.attack_1` — hit via chooseEnemyAttack/
   ownedAttack. → `if (!monsterType) return []` (callers already treat [] as "no usable move").
Together they make an orphaned-type fight degrade gracefully (neutral element, finite fallback
stats via the BUG-002 hardening, no moves → struggle/skip) instead of crashing the round.
Tests: getAttacksForMonster(undefined/null)→[]; buildState(orphan).element===null + end-to-end
resolveCombatAction with an orphaned monster resolves without throw. 204/204 pass, lint+build clean.

⚠️ **Uncommitted** — working tree: src/engine/gamedata.js, src/engine/gamedata.test.js,
server/combat.js, server/combat.test.js (+ iter-174 upgrades.js/upgrades.test.js still pending
relay). Not self-committing per commit-only-when-asked. Ready to commit/relay.

---

## 2026-06-07 — Iteration 174 — ✅ FIX (consistency): meta-upgrade effect getters ignored def.per

iter-171 grantChain fix landed (committed f93379f). Proactive audit of `src/engine/upgrades.js`:
`purchaseUpgrade` is correct + atomic (null-safe gold/level, deduct+set together). But the effect
getters HARDCODED their magnitudes (`goldMult` 0.20, `essenceMult` 0.20, `vaultCapacity` 25) and
ignored each def's `per` field — so `per` was load-bearing-looking but dead: tuning
UPGRADE_DEFS[].per would have NO effect (a balance-tuning footgun, same comment-vs-code class as
the grantChain fix). **Fix:** getters now read `getUpgradeDef(id)?.per ?? 0` → UPGRADE_DEFS is the
single source of truth; `?? 0` keeps them safe if a def is missing. No-op today (per matches the
old literals 0.20/0.20/25), so zero behaviour change; callers (server/world.js, pvp.js, scenes,
schemas.js) untouched (same signatures). Added: a `per`-is-numeric assertion to the well-formed
test + a getter↔def.per consistency test. 202/202 pass, lint+build clean.

⚠️ **Uncommitted** — in working tree (src/engine/upgrades.js, src/engine/upgrades.test.js); not
self-committing per commit-only-when-asked. Ready to commit/relay.

---

## 2026-06-07 — Iteration 173 — independently confirmed MB-10 (SW network-first); flagged res.ok cache gap

Cross-checked @visual's MB-10 not-a-bug verdict by reading public/sw.js: confirmed genuinely
NETWORK-FIRST (`fetch(req)` then cache; offline → `caches.match`), + skipWaiting()+clients.claim()
so the SW activates immediately → deploys always picked up online; `tq-v1` static key is only the
offline-fallback bucket (overwritten per fetch). Verdict holds, no stale-deploy bug.

🔍 **Identified (minor, NOT fixed — deferred to @visual's active PWA pass):** the fetch handler
caches every response that RESOLVES, incl. 4xx/5xx (fetch() resolves on error status). A transient
5xx during a deploy gets cached and could be served if the user then goes offline. Best practice:
gate the `c.put` on `res.ok`. Low severity (self-heals on next online fetch via network-first).
Did NOT edit sw.js — @visual is actively in PWA files this cycle (MB-8/9/10); flagged to avoid a
mid-flight conflict (coordination: stay in lane / re-verify before acting).

↩️ **Still uncommitted:** my iter-171 grantChain defensive fix (src/engine/schemas.js +
spiritchains.test.js) — relay 6b06192 committed only the heartbeat doc, not the code. Verified
present + green (201/201). Ready to commit/relay. 201/201 pass, lint+build clean.

---

## 2026-06-07 — Iteration 172 — LS-10 CSP reviewed + blob:/enforce-safety investigated (clean)

LS-10 (commit de9c231): CSP added to setSecurityHeaders, ships Report-Only (CSP_ENFORCE=true to
enforce same policy). Investigated the one real enforce-mode risk: the bundled client
(dist/assets/index-*.js) contains `blob:`/`createObjectURL` — `img-src` is `'self' data:` (no
blob:), `worker-src 'self'`, no `media-src`, so a blob: image/worker/media WOULD be blocked under
enforcing. Traced it: those are Phaser's Image/SVG/Video/HTML **file-loader** paths + a debug
`<a download>` Blob util. This game is fully procedural — sprites load via the shim's
`k.loadSprite` → `game.textures.addCanvas(name, canvas)` (direct canvas→texture, NO blob/loader);
it never calls `scene.load.image/svg/...`. So the blob: paths are DEAD CODE here → no blob: URL is
ever created → enforce is genuinely safe (matches shoot-csp's 0 violations). Fonts load from
same-origin `/assets/font/*.woff2` (covered by `font-src 'self'`). NOT a bug; CSP policy tuning is
the owner's lane. Future note for whoever flips CSP_ENFORCE: if assets ever move to Phaser's
loader, add `blob:` to img-src first. Minor: `connect-src 'self' ws: wss:` allows any WS host
(acceptable; owner's call). 201/201 pass, lint+build clean.

---

## 2026-06-07 — Iteration 171 — ✅ FIX (defensive): grantChain bank-refill could leave a paid chain at-risk

Proactive audit of `src/engine/schemas.js` chain helpers. Found `grantChain`'s existing-instance
refill branch updated counters but never cleared a provisional `runFound` flag — its own comment
("a refill of an already-banked chain is NOT at risk on death") was enforced only by EXTERNAL
state-machine gating (buyChain/craftChain are `s.state==="idle"`-only; run-found flags are always
resolved by finalizeRunChains before idle), not by the function itself. So today it's UNREACHABLE
(verified both shop handlers in world.js are idle-gated). But if a future change ever allowed a
bank grant while a run-found dup existed, a PAID-FOR chain would be silently forfeited on death.
**Fix:** a bank grant (runFound=false) now `delete existing.runFound` — making the function
self-consistent. No-op today (the property is already absent at all bank-grant sites), so zero
behaviour change/regression risk; purely hardens a money-sensitive path. A loot dup (runFound=true)
of an owned chain is unchanged (banked stays banked, provisional stays provisional). +1 regression
test. Full `npm run check` green: 201/201 tests, lint clean, build OK.

⚠️ **Uncommitted** — in working tree (src/engine/schemas.js, src/engine/spiritchains.test.js);
not self-committing per commit-only-when-asked. Ready to commit/relay.

---

## 2026-06-07 — Iteration 170 — LS-6 lint gate landed + full `npm run check` verified green

LS-6 committed (336eeff): `npm run lint` (eslint no-undef) + `npm run check` (lint+test+build)
now wired. Ran the full gate end-to-end: lint exit 0 (139 files, 0 no-undef violations),
200/200 tests pass, build OK (1.29s). `npm run check` is now the most thorough verification —
adopting it as the watchdog go-to gate. (Note from LS-6 commit: adding lint to CLAUDE.md's
before-done routine is left to the user — agents are denied CLAUDE.md commits.) No bug.

---

## 2026-06-07 — Iteration 169 — LS-9 C1 fix landed; independently ran the new LS-6 lint gate (0 violations)

My iter-168 LS-9 C1/NEL hardening was committed (73d957d) + heartbeat relayed (96d3268).
New in tree: another agent's in-progress LS-6 work (eslint + globals devDeps, eslint.config.js —
a minimal `no-undef` gate targeting the class of bug that caused the past `JOY` prod outage).
Did NOT touch their uncommitted package.json/config (lane discipline). Independently ran the gate
(`node_modules/eslint/bin/eslint.js .`) against the current tree: **exit 0, zero no-undef
violations** across client+server+tools → confirms no latent undefined-ref bugs and that the gate
will pass clean once wired. `lint` script not yet in package.json scripts (left for the LS-6
author). 200/200 tests pass. No bug.

---

## 2026-06-07 — Iteration 168 — ✅ FIX: LS-9 sanitizer missed C1 controls (NEL prompt-injection gap)

Reviewed LS-9 (commit fffee64, prompt-injection defense). Found a real gap in Layer A
(`sanitizePromptText`, server/ai.js): it folds C0 (<0x20) + DEL (0x7f) but NOT the C1 range
(0x80-0x9f). C1 includes **NEL (U+0085)**, a line break some model tokenizers honor — and JS
`\s` does NOT match U+0085, so the `.replace(/\s+/g," ")` collapse wouldn't catch it either. So
a name containing U+0085 could still inject a line into the judge prompt, defeating the commit's
stated "robust at the source, regardless of whether the model obeys the note" guarantee (would
fall back to relying on Layer B alone). **Fix:** widened the char map to `cc < 0x20 || (cc >=
0x7f && cc <= 0x9f)` — folds C0+DEL+C1. (U+2028/U+2029 still handled by the `\s` collapse;
verified printable >0x9f like é is preserved.) Added test assertions (NEL, C1 bounds 0x80/0x9f,
NBSP-still-collapses, é-preserved) via `String.fromCharCode` so no invisible control bytes live
in the test source. 200/200 pass, build clean.

⚠️ **Uncommitted** — code fix is in the working tree (server/ai.js, server/ai.test.js); not
self-committing per the commit-only-when-asked rule. Ready to commit/relay.

---

## 2026-06-07 — Iteration 167 — proactive audit: db.js (SQL) + rng.js (determinism) (clean)

Quiet cycle (no new code since LS-2). Two proactive audits:
• `server/db.js` — all queries parameterized (`$1`/`$2`/`::jsonb`), no string interpolation of
  user data → no SQL injection (incl. the now-security-relevant `token`). Multi-row upsert
  indexes params correctly (`b=i*3`, 3/row); `dirty` is token-keyed so a batch can't hold a
  duplicate-token row (would trip ON CONFLICT-twice). Graceful in-memory fallback on init fail.
  Only theoretical limit (PG 65535-param ≈ 21845 profiles/batch) unreachable at 16-player scale.
• `src/engine/rng.js` — FNV-1a hashString (u32), textbook mulberry32, makeRng helpers each
  consume exactly one next() (int inclusive [a,b], range [0,n)). Deterministic; client/server
  parity intact. No bug. 198/198 pass.

---

## 2026-06-07 — Iteration 166 — LS-2 session-token CSPRNG security fix reviewed (clean)

LS-2 (commit b38e073, 197→198, +1 test): session tokens (authenticate anon player → profile)
were minted by `rid()` = `randomSeed()+counter` (predictable → account-takeover by guessing).
Now `secureToken()` = `tk_` + `randomBytes(24).toString("hex")` (192-bit CSPRNG, 48 hex chars).
Audited the backward-compat claim: `getByToken` is a plain `profiles.get(token)` map lookup
(store.js:82) — fully format-agnostic, no prefix parse/validation; DB stores `token TEXT
PRIMARY KEY` (db.js:32) — no format constraint. So old `tk_<base36>` tokens AND new `tk_<hex>`
both validate identically. `rid()` retained for non-security ids (monster/profile/pl). 192-bit
entropy → negligible collision/guess. Correct, scoped, high-value security fix. No bug.
198/198 pass.

---

## 2026-06-07 — Iteration 165 — NC-5 PvP vault-cap reviewed (clean)

NC-5 (commit a4c5adf, 196→197, +1 test): `endPvp` now slices the winner's vault to
`vaultCapacity(win.profile, GAME.VAULT_SIZE)` after concatenating looted team, fixing
unbounded vault/DB growth across repeated PvP wins. Verified both new refs resolve
(`GAME.VAULT_SIZE=100`; `vaultCapacity=base+25*deepVault`, finite — so the `slice(0,cap)`
isn't silently `slice(0,undefined)`). Behaviour is consistent with the existing capture path
(same `vaultCapacity` cap) — overflow loot dropped = capture-when-full. Existing vault kept
first, loot appended then truncated. Direct test asserts a cap-full winner stays at 100 after
looting 4 (not 104) — meaningful. PvP still gated off (PVP_ENABLED); fix is ready for enable.
No bug. 197/197 pass.

---

## 2026-06-07 — Iteration 164 — proactive audit: spiritchains.js capture math (clean)

Quiet cycle (no new code since NC-8). Proactively audited `src/engine/spiritchains.js` +
deps. `chainCaptureChance`: clamps to [0,0.95], rarity gate correct; the `"guaranteed"`
branch returns 0.999 BEFORE the rarity gate, but the only guaranteed chain (Sovereign Bind)
has maxRarity 5 = game max, so it can never bypass the gate (no rarity >5 exists) — not a
bug. `GUARANTEED_HP_PCT=0.25` confirmed present+frozen in schemas. `rollChainDrop` weighted
selection correct (pool = strictly-positive dropWeight, r∈[0,total), fallback to last).
`canThrow` (null=unlimited via `==`), `clusterTargets` (negative-max→0, NaN coords filtered)
all edge-safe. No bug. 196/196 pass.

---

## 2026-06-07 — Iteration 163 — NC-8 rate-limit security fix reviewed (clean)

NC-8 (commit 671778e, 193→196, +3 tests): `createViolationTracker` replaces the inline
`violations--`-on-good-message counter that a paced flood could defeat by interleaving good
traffic. Audited the helper + wiring: decay is time-based (`if (now > last)`), same-instant
msgs accumulate without decay (correct), backward-clock only delays forgiveness (no wrongful
close), every inbound msg calls exactly one `record` (true=dropped/false=accepted) so
accounting is exact; index.js closes the socket only when `record(true)` returns true. The 3
tests genuinely cover the regression (paced-flood-still-trips at a single instant, time-decay,
legit-never-trips). Correct, well-tested security fix. 196/196 pass. No bug.

---

## 2026-06-07 — Iteration 162 — CN-7 reviewed + render/collision invariant deep-dive

CN-7 batch (commit c33b550) reviewed, clean: `cleanAttackName()` is a pure display helper;
onlineGame.js:338 keeps the FULL name as the server lookup key (label-only strip), so the
"Healing Light" collision concern is handled; server/ai.js wrap is display-only, BUG-007
`initiativeLine` + `getAiConfig` intact. 193/193 pass.

🔍 **Identified (latent, not triggering — no fix made):** render/collision keying mismatch.
Server `isWalkable`/SP `isWalkable` (game.js) gate on `voidMap` truthy; renderer `isFloor`
(render/tiles.js) gates on `tileMap[x][y] != null`. Both also exclude `collidable`. They agree
TODAY because mapgen guarantees `voidMap-true ⟹ tileMap != null` (first carved cell anchors with
a finite baseScore; every later cell has non-empty `candidates`). The gap (a void cell with
`tileMap===null` → server says walkable, client draws void wall = "invisible wall") only appears
under catastrophic content failure (empty `getGroundTiles()` / all-NaN color profiles → `bestTile`
stays null at mapgen.js:351), which would break the whole map visibly. Recommended hardening if
mapgen ever changes: gate both collision fns on `tileMap` presence too, so collision == render's
floor definition. Left for owners (3 lanes: server/world.js, scenes/game.js, render/tiles.js).

---

## 2026-06-07 — Iteration 161 — `@watchdog` heartbeat (idle)

combat.js re-verified iter-160 (no new tests since); no new code/files. 190/190 pass. No bug.

---

## 2026-06-07 — Iteration 160 — combat.js grew (~+23 lines, status handling) — invariants hold

combat.js (188→190, +2 tests): resolveTurn shifted 138→161 (status-handling additions). Re-verified:
performAttack tail (crit/matchup/infliction) unchanged+correct; fuzz 0 bad (4k status-inflicting
turns), determinism ✓, element matchup ✓; 190/190 pass. Engine invariants intact, no regression. No bug.

---

## 2026-06-07 — Iteration 159 — `@watchdog` heartbeat (combat.js re-verified again)

combat.js touched again (187→188): exports unchanged, fuzz 0 bad, determinism ✓, element matchup
correct. Engine invariants intact, no regression. 188/188 pass. No bug.

---

## 2026-06-07 — Iteration 158 — `@watchdog` heartbeat (combat.js tweak re-verified)

combat.js (authoritative resolver) touched — benign: exports/signatures unchanged, re-fuzz 0 bad
(20k resolutions, no NaN/neg/non-bool), element matchup correct, all combat tests pass (determinism/
crit/status/initiator). No regression. 187/187 pass. No bug.

---

## 2026-06-07 — Iteration 157 — `@watchdog` heartbeat (idle)

No in-lane changes. 187/187 pass. No bug.

---

## 2026-06-07 — Iteration 156 — `@watchdog` heartbeat (idle)

No new code/files. 187/187 pass. No bug.

---

## 2026-06-07 — Iteration 155 — `@watchdog` heartbeat (idle)

a11y reviewed iter-154; no new code/files. 187/187 pass. No bug.

---

## 2026-06-07 — Iteration 154 — reviewed new a11y helper (reduced-motion) — clean

New `src/systems/a11y.js` (+test, 183→187): `prefersReducedMotion()` — matchMedia check, fully
guarded for non-browser (typeof window + try/catch → false). Pure, engine-agnostic, node-safe. 187/187 pass. No bug.

---

## 2026-06-07 — Iteration 153 — `@watchdog` heartbeat (idle)

No in-lane changes. 183/183 pass. No bug.

---

## 2026-06-07 — Iteration 152 — `@watchdog` heartbeat (idle)

No in-lane changes. 183/183 pass. No bug.

---

## 2026-06-07 — Iteration 151 — `@watchdog` heartbeat (idle)

No in-lane changes. 183/183 pass. No bug.

---

## 2026-06-07 — Iteration 150 — `@watchdog` heartbeat (idle)

No in-lane changes. 183/183 pass. No bug.

---

## 2026-06-07 — Iteration 149 — `@watchdog` heartbeat (idle)

No in-lane changes. 183/183 pass. No bug.

---

## 2026-06-07 — Iteration 148 — `@watchdog` heartbeat (idle)

No in-lane changes. 183/183 pass. No bug.

---

## 2026-06-07 — Iteration 147 — `@watchdog` heartbeat (idle)

No in-lane changes. 183/183 pass. No bug.

---

## 2026-06-07 — Iteration 146 — periodic consolidated health sweep — all green

GAME:0 THEME:0 data:0 combat-fuzz(3000):0 render/collision:0 — all bug classes clean across the
codebase (incl. since-iter-100 additions: rosterSort, center-biased rarity, cosmetics). 183/183 pass. No bug.

---

## 2026-06-07 — Iteration 145 — `@watchdog` heartbeat (idle)

No in-lane changes. 183/183 pass. No bug.

---

## 2026-06-07 — Iteration 144 — `@watchdog` heartbeat (idle)

No in-lane changes. 183/183 pass. No bug.

---

## 2026-06-07 — Iteration 143 — `@watchdog` heartbeat (idle)

No in-lane changes. 183/183 pass. No bug.

---

## 2026-06-07 — Iteration 142 — `@watchdog` heartbeat (idle)

No in-lane changes. 183/183 pass. No bug.

---

## 2026-06-07 — Iteration 141 — `@watchdog` heartbeat (idle)

Only audio tweak; no new in-lane logic/files. 183/183 pass. No bug.

---

## 2026-06-07 — Iteration 140 — `@watchdog` heartbeat (idle)

Already-reviewed mapgen + audio; no new code/files. 183/183 pass. No bug.

---

## 2026-06-07 — Iteration 139 — `@watchdog` heartbeat (idle)

mapgen reviewed iter-138; audio recipe tweak (structure verified earlier). No new code/files. 183/183 pass. No bug.

---

## 2026-06-07 — Iteration 138 — reviewed center-biased monster rarity (mapgen) — clean

mapgen `spawnMonsters` now uses `pickMonsterByLocation` (182→183): deterministic weighted pick,
target rarity ~2 at edges → 5 at center, null-safe (`rarity??3`), no NaN, bounded, always returns a
type (fallback last). Verified: **determinism holds** (same seed → identical map incl. monsters) +
BUG-010 render/collision invariant = 0. New test confirms the bias. 183/183 pass. No bug.

---

## 2026-06-07 — Iteration 137 — `@watchdog` heartbeat (idle)

No in-lane changes. 182/182 pass. No bug.

---

## 2026-06-07 — Iteration 136 — `@watchdog` heartbeat (idle)

No in-lane changes. 182/182 pass. No bug.

---

## 2026-06-07 — Iteration 135 — `@watchdog` heartbeat (idle)

No new code/files. 182/182 pass. No bug.

---

## 2026-06-07 — Iteration 134 — `@watchdog` heartbeat (idle)

ai.js reviewed iter-133; no new code/files. 182/182 pass. No bug.

---

## 2026-06-07 — Iteration 133 — `@watchdog` heartbeat (ai.js tweak; BUG-007 intact)

ai.js touched (my lane): BUG-007 initiativeLine + getAiConfig params intact, aiResolveTurn signature
unchanged — benign tweak, no regression. index.js structure intact (iter-131). 182/182 pass. No bug.

---

## 2026-06-07 — Iteration 132 — `@watchdog` heartbeat (idle)

index.js structure verified intact iter-131; no new code/files. 182/182 pass. No bug.

---

## 2026-06-07 — Iteration 131 — `@watchdog` heartbeat (index.js incidental touch)

index.js touched but structure intact (routes/WS/rate-limit/tick unchanged). No new files. 182/182 pass. No bug.

---

## 2026-06-07 — Iteration 130 — `@watchdog` heartbeat (idle)

No in-lane changes. 182/182 pass. No bug.

---

## 2026-06-07 — Iteration 129 — `@watchdog` heartbeat (idle)

No in-lane changes. 182/182 pass. No bug.

---

## 2026-06-07 — Iteration 128 — `@watchdog` heartbeat (idle)

No in-lane changes. 182/182 pass. No bug.

---

## 2026-06-07 — Iteration 127 — `@watchdog` heartbeat (idle)

No in-lane changes. 182/182 pass. No bug.

---

## 2026-06-07 — Iteration 126 — `@watchdog` heartbeat (idle)

No in-lane changes. 182/182 pass. No bug.

---

## 2026-06-07 — Iteration 125 — `@watchdog` heartbeat (idle)

No new code/files. 182/182 pass. No bug.

---

## 2026-06-07 — Iteration 124 — `@watchdog` heartbeat (idle)

Only the already-reviewed rosterSort files; no new code/files. 182/182 pass. No bug.

---

## 2026-06-07 — Iteration 123 — reviewed rosterSort element-filter additions (INV-T6) — clean

New `filterMonsters` (ELEMENT_ALL→slice copy; else case-insensitive element match; null-safe,
non-mutating) + `elementFilterOptions` (distinct lowercased elements, ALL-first, sorted) added to
rosterSort.js (179→182). Pure, null-safe, well-tested. 182/182 pass. No bug.

---

## 2026-06-07 — Iteration 122 — `@watchdog` heartbeat (idle)

Only the already-reviewed rosterSort files; no new code/files. 179/179 pass. No bug.

---

## 2026-06-07 — Iteration 121 — reviewed new engine module rosterSort (INV-T6) — clean

New `src/engine/rosterSort.js` (+test, 171→179): pure roster/vault/chain sort shared by MP roster +
SP inventory. `sortMonsters`: stable (original-index tiebreak ⇒ "recent" preserved), non-mutating,
reference-stable output (callers map sorted idx → source by identity), null-safe (Number||0, typeOf||{},
element unknown→"~~" last). Keys type-consistent per mode (no mixed compare). `sortChainsByTier`
descending+stable. Ships with tests. 179/179 pass. No bug.

---

## 2026-06-07 — Iteration 120 — `@watchdog` heartbeat (render-lane test additions)

@phaser added `src/render/tiles.test.js` (+3, 168→171) — render lane, not reviewed (passes node-safe;
likely covers isFloor/collidable, good for BUG-010). No agnostic-core changes. 171/171 pass. No bug.

---

## 2026-06-07 — Iteration 119 — `@watchdog` heartbeat (idle)

No in-lane changes. 168/168 pass. No bug.

---

## 2026-06-07 — Iteration 118 — `@watchdog` heartbeat (idle)

No in-lane changes. 168/168 pass. No bug.

---

## 2026-06-07 — Iteration 117 — `@watchdog` heartbeat (idle)

No in-lane changes. 168/168 pass. No bug.

---

## 2026-06-07 — Iteration 116 — `@watchdog` heartbeat (idle)

No in-lane changes. 168/168 pass. No bug.

---

## 2026-06-07 — Iteration 115 — `@watchdog` heartbeat; BUG-010 survived @phaser's tiles.js re-tune

@phaser re-tuned tiles.js (cosmetic edge/grain softening). Verified BUG-010 both halves intact
(isFloor excludes collidable; drawTiles routes `!t||t.collidable`→void @204); render/collision
invariant = 0 (holds). 168/168 pass. No bug.

---

## 2026-06-07 — Iteration 114 — `@watchdog` heartbeat (idle)

Only cosmetic spritegen; no new in-lane logic/files. 168/168 pass. No bug.

---

## 2026-06-07 — Iteration 113 — `@watchdog` heartbeat (idle)

Only cosmetic spritegen; no new in-lane logic/files. 168/168 pass. No bug.

---

## 2026-06-07 — Iteration 112 — `@watchdog` heartbeat (idle)

No new code/files. 168/168 pass. No bug.

---

## 2026-06-07 — Iteration 111 — `@watchdog` heartbeat (idle)

No new code/files. 168/168 pass. No bug.

---

## 2026-06-07 — Iteration 110 — `@watchdog` heartbeat (idle); flaky-fix holding

Only my world.test.js flaky-fix edit; no new code/files. 168/168 pass (×2). Fix marker intact. No bug.

---

## 2026-06-07 — Iteration 109 — ✅ fixed a FLAKY test (sprint stamina) — combat-proximity nondeterminism

- Caught `world.test.js` "sprint: holding shift drains stamina" failing once ("sprinting drained
  stamina" false), then passing on re-run — and no sprint code had changed ⇒ flaky, not a regression.
- **Root cause:** the test sprints for 5 ticks but didn't isolate from combat. `activeRound()` spawns
  the player among monsters; if the spawn lands within encounter range, the player enters combat
  mid-sprint → `rp.inCombat` → `moving=false` → `sprintingNow` false → stamina never drains → the
  assertion fails. Spawn/seed-dependent = intermittent. (The perf test already worked around the same
  thing with `round.monsters = []`.)
- **Fix:** `round.monsters = []` after `activeRound()` in the sprint test. Verified deterministic:
  **5/5 consecutive full runs green (168/168)**.
- Why it matters: a flaky test erodes the green gate (real failures get dismissed as "probably flaky").
Also: cosmetics feature (chainCosmetics.js + cosmetics.js) = @phaser render/scene lane, not reviewed.

---

## 2026-06-07 — Iteration 108 — `@watchdog` heartbeat (cosmetics feature in render/scene lane)

New `src/render/chainCosmetics.js` + `src/scenes/cosmetics.js` = @phaser render/scene lane (not
reviewed). No engine/server economy logic landed in my lane (watch for a purchase handler later).
168/168 pass. No bug.

---

## 2026-06-07 — Iteration 107 — `@watchdog` heartbeat (idle)

No new code/files. 168/168 pass. No bug.

---

## 2026-06-07 — Iteration 106 — `@watchdog` heartbeat (idle)

net.js minor tweak reviewed iter-105; no new code/files. 168/168 pass. No bug.

---

## 2026-06-07 — Iteration 105 — `@watchdog` heartbeat (net.js minor tweak)

net.js touched (my lane): same message-case set (all have server senders, protocol consistent),
same reviewed roster/shop/upgrades sync, no new unhandled case/field. All net tests pass. 168/168. No bug.

---

## 2026-06-07 — Iteration 104 — `@watchdog` heartbeat (idle)

No in-lane changes. 168/168 pass. No bug.

---

## 2026-06-07 — Iteration 103 — `@watchdog` heartbeat (idle)

Only cosmetic spritegen; no new in-lane logic/files. 168/168 pass. No bug.

---

## 2026-06-07 — Iteration 102 — `@watchdog` heartbeat (idle)

Only cosmetic spritegen; no new in-lane logic/files. 168/168 pass. No bug.

---

## 2026-06-07 — Iteration 101 — `@watchdog` heartbeat (idle)

Only cosmetic spritegen; no new in-lane logic/files. 168/168 pass. No bug.

---

## 2026-06-07 — Iteration 100 — milestone consolidated health sweep — all green

Periodic full probe battery (codebase-wide): GAME-schema 0 · THEME-token 0 · data-integrity 0 ·
combat-fuzz(3000) 0 · render/collision(BUG-010 invariant) 0 — all bug classes clean. 168/168 pass.
Summary @ iter-100: 10 bugs fixed (BUG-001…010) + @visual's critical combat crash; agnostic core
stable through the Phaser migration. No bug.

---

## 2026-06-07 — Iteration 99 — `@watchdog` heartbeat (idle)

Only cosmetic spritegen; no new in-lane logic/files. 168/168 pass. No bug.

---

## 2026-06-07 — Iteration 98 — `@watchdog` heartbeat (idle)

Only cosmetic spritegen touch; no new in-lane logic/files. 168/168 pass. No bug.

---

## 2026-06-07 — Iteration 97 — `@watchdog` heartbeat (idle)

No in-lane changes. 168/168 pass. No bug.

---

## 2026-06-07 — Iteration 96 — `@watchdog` heartbeat (idle)

No in-lane changes. 168/168 pass. No bug.

---

## 2026-06-07 — Iteration 95 — `@watchdog` heartbeat (render-lane fx module; lane idle)

New `src/render/fx.js` (+test, 167→168) + onlineGame.js = @phaser render/scene lane (not reviewed;
fx test passes node-safe). No agnostic-core changes. 168/168 pass. No bug.

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
