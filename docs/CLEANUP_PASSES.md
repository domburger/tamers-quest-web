# Codebase Cleanup — 5-Pass Tracking

Goal (Dominik directive, `/loop`): clean up the codebase **file by file, line by line**,
**5 passes**, each pass in a **different order**. This file is the persistent checklist so the
loop can resume across iterations.

## Rules

- **Conservative / behavior-preserving** cleanups only. No feature changes.
- Each landed batch must pass `npm run lint && npm test && npm run build` before commit.
- **Commit by explicit pathspec** (never `git add -A`) — shared tree, concurrent agents.
- Contested/co-developed files (`hub.js`, `tiles.js`, `onlineGame.js`, `world.js`): extra care,
  commit alone by pathspec.
- Scope = 141 production files (`src/` + `server/`, excluding `*.test.js`).

## What "cleanup" means here

- Remove dead code, unused vars/imports, unreachable branches, commented-out code.
- Remove stray debug `console.log` / leftover scaffolding.
- Fix typos in comments/strings; tighten misleading comments.
- Collapse obvious duplication into existing helpers (only when local & safe).
- Normalize trivial inconsistencies (spacing already handled by lint).
- **Do not** rename shared exports, restructure modules, or touch behavior.

## Passes & ordering

- **Pass 1** — Alphabetical by path (A→Z)
- **Pass 2** — Reverse alphabetical (Z→A)
- **Pass 3** — Largest file first (LOC desc)
- **Pass 4** — Smallest file first (LOC asc)
- **Pass 5** — Grouped by subsystem (compat → engine → render → systems → ui → scenes → server → root)

## Progress log

| Pass | Order | Status | Files done | Notes |
|------|-------|--------|-----------|-------|
| 1 | A→Z | in progress | 96 / 141 | started 2026-06-29 |
| 2 | Z→A | not started | 0 / 141 | |
| 3 | LOC desc | not started | 0 / 141 | |
| 4 | LOC asc | not started | 0 / 141 | |
| 5 | subsystem | not started | 0 / 141 | |

### Pass 1 (A→Z) — checklist

Cursor = next file index to review. **Cursor: 97** (src/scenes/friends.js).

Files 1–96 reviewed (server/account.js … src/scenes/featureScenes.js).

#### Pass 1 findings
- Batch 1 (files 1–24, commit 9426809): 5 stale SVG→HTML/CSS comment fixes —
  aiconfig.js (svgModel path), genBiomes.js (nonexistent `element` field),
  genPipeline.js ×2 (`monster.model`→`monster.html`), genStages.js ×2 (base SVG→markup).
  All other 19 files already clean. Comment-only; no behavior change.
- Batch 2 (files 25–48): index.js 2 stale 15Hz→30Hz comments; world.js removed dead
  `filterMap()` (unused) + folded its orphaned comment. All 23 other files (server/* +
  all 11 src/compat/*) already clean. Verified: lint + world.test.js (70 tests) pass.
  NOTE: corrected stale memory — sim default is 30Hz (TQ-515), not 60Hz.
- Batch 3 (files 49–72): all 24 files clean (src/data.js, all src/engine/*, main.js, net.js,
  netClient.js, render/atmosphere|battleStage|chainCosmetics). No changes. Noted but left:
  unused `mt` param in engine/gamedata.js genAttackMove (signature change is out of scope).
- Batch 4 (files 73–96): bestiary.js dropped 3 dead imports (getAttacksForMonster,
  cleanAttackName, getMonsterStats — detail moved to drawMonsterDetail, TQ-128); lint+build pass.
  All 23 other files clean incl. contested tiles.js (fade logic untouched) + render layer.
