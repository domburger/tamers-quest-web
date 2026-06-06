# Bugfix Log

Running log for the systematic bugfixing pass. Each loop iteration appends here.
Newest first. Status: ✅ fixed · 🔍 identified (not yet fixed) · ⏭️ deferred (WIP/feature, out of scope)

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
