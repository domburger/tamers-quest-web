> 🚨 **SUPERSEDED (2026-06-06).** The user has decided to migrate to **Phaser 3**, and a
> dedicated agent is performing the migration. The KAPLAY recommendation below is **no longer
> the chosen path** — this document is retained for its analysis only. Source of truth for the
> decision: the "Rendering" row + migration note in `docs/IMPLEMENTATION_PLAN.md`.

# Game Engine Evaluation — Should Tamers Quest Switch Away from Kaboom?

**Date:** 2026-06-06
**Author:** Engine review
**Scope:** Whether replacing Kaboom.js with a different game engine/library would benefit the project.

---

## TL;DR — Recommendation

**Yes, switch — but to KAPLAY, not to a different engine family.**

The single most important fact is that the `kaboom` npm package this project depends on
(`kaboom@^3000.1.17`) **was abandoned by Replit in June 2024** and receives no further
maintenance. That is the real risk, and it has a near-zero-cost fix: **KAPLAY**, the
community fork by the original maintainers, is a drop-in API-compatible successor.

- **Do now (hours, not days):** Migrate `kaboom` → `kaplay`. Same API surface, actively
  maintained, eliminates the dead-dependency risk.
- **Do *not* do now:** A full rewrite onto Phaser, Pixi.js, Excalibur, or a custom WebGL
  renderer. The cost is real and the payoff is small *given how this project actually uses
  the engine*. The clean architecture means this option stays cheap and open if we ever
  outgrow KAPLAY.

---

## How this project actually uses the engine

This matters more than any benchmark, because migration cost is driven by *which* engine
features you depend on, not by how big the engine is.

### The codebase is exceptionally decoupled

| Layer | Files | Engine coupling | Migration cost |
|---|---|---|---|
| Game logic (`src/engine/`: combat, mapgen, rng, stats, schemas, gamedata, spiritchains) | 7 | **None** — pure, deterministic, Node-importable | Zero |
| Server (`server/`: world, combat, pvp, ai, store, index) | 22 | **None** — no rendering at all | Zero |
| Networking (`src/net.js` — pure `applyMessage` reducer) | 1 | **None** — framework-agnostic, unit-tested in Node | Zero |
| Game data (`public/assets/data/*.json`) | — | **None** | Zero |
| Procedural sprites (`src/systems/spritegen.js`) | 1 | Canvas2D output (`HTMLCanvasElement`) | ~None — portable to any canvas/WebGL engine |
| Rendering primitives (`src/render/`: character, tiles, spiritchain) | 3 | Kaboom draw calls only | Low |
| Scenes (`src/scenes/`) | 13 | Kaboom scene/add/input API | **Medium** — the only real work |

Roughly **40% of the code (engine + server + net + data) is completely engine-agnostic**
and would survive *any* migration untouched. Only `src/scenes/` and `src/render/` are
Kaboom-bound.

### The engine surface we depend on is narrow

We use a small slice of Kaboom:

- **Rendering:** mostly *raw draw primitives* inside `onDraw()` — `drawRect`, `drawCircle`,
  `drawEllipse`, `drawLine`, `drawText`, `drawSprite`. The component system (`add([...])`)
  is used only for UI/HUD (buttons, panels, labels via `src/ui/theme.js`).
- **Loop & timing:** `onUpdate`, `onDraw`, `time`, `dt`, `wait`.
- **Input:** `isKeyDown`, `onKeyPress`, `onMousePress/Move/Release`, `mousePos`.
- **Scenes:** `scene`, `go`.
- **Camera:** `camPos` + `fixed()` for HUD.
- **Helpers:** `rgb`, `vec2`, `width`, `height`, `area()`+`onClick` for buttons.

We do **NOT** use:
- The physics engine (collision is hand-rolled AABB / distance checks)
- Particles
- Tweens (all animation is hand-rolled `Math.sin(time())`)
- The audio API
- Sprite atlases (sprites are procedurally generated to canvas)

**Implication:** We treat Kaboom largely as a thin "immediate-mode canvas + scene + input"
layer. That is exactly the part KAPLAY keeps identical, and exactly the part that is cheap
to reimplement on anything else if needed. We get little value from Kaboom's "batteries"
(physics/particles/tweens/audio), so switching to a heavier batteries-included engine buys
us features we don't use.

---

## The options

### Option A — Migrate to KAPLAY ✅ Recommended

KAPLAY is the official community continuation of Kaboom, created May 2024 by the people who
worked on Kaboom after Replit dropped it. v3001 is explicitly designed for **no breaking
changes** vs Kaboom — it's a drop-in.

**Pros**
- Fixes the actual problem: dead dependency → actively maintained.
- API-compatible. Migration is essentially `npm uninstall kaboom && npm install kaplay`,
  change one import in `src/main.js` (`import kaplay from "kaplay"`), and run the suite.
- Better TypeScript types, ongoing bugfixes, larger living community.
- Zero risk to the 40% engine-agnostic core, zero scene rewrites.

**Cons**
- Same performance profile as Kaboom (see below) — this is a maintenance move, not a
  performance upgrade.
- Still a relatively small ecosystem vs Phaser; AI assistants hallucinate its API more
  often than Phaser's.

**Effort:** Low — a few hours including verification.

### Option B — Rewrite onto Phaser 3 ❌ Not now

Phaser is the most mature, best-documented, highest-performance 2D web framework. In
rendering stress benchmarks it crushes Kaplay (e.g. ~43 FPS vs ~3 FPS in one community
benchmark of thousands of sprites). It also supports **headless mode** for running game
state on the server.

**Why it's not worth it here:**
- The headless-server selling point is **moot** — our server is *already* a clean,
  authoritative, render-free Node state machine (`server/world.js`) built on the shared
  `src/engine/`. We don't need Phaser to do server logic; we'd be adding a dependency to
  solve a problem we already solved better.
- The performance gap is real but largely irrelevant to *this* game: top-down tile floors
  (culled, cached), a handful of players (≤16), a few monsters, and immediate-mode draws.
  We are nowhere near the entity counts where Kaplay's renderer falls over. If profiling
  ever shows a real frame-budget problem, that's the trigger to reconsider — not now.
- Cost is high: all 13 scenes and 3 render modules rewritten against a different API and
  lifecycle (Phaser's Scene/GameObject/Container model vs our immediate-mode `onDraw`).
  Realistically 1–2 weeks of focused work plus regression risk, for features we mostly
  wouldn't use.

**Verdict:** Strong engine, wrong time. Revisit only if we hit a concrete performance wall
or want Phaser-specific features (rich physics, tilemap tooling, particle FX).

### Option C — Pixi.js (renderer only) ❌ Overkill

Pixi is a best-in-class WebGL 2D *renderer* but not a game framework — we'd build scenes,
input, and loop ourselves. Given we already hand-roll most of that, Pixi would mean
significant glue code for a performance win we don't currently need.

### Option D — Custom canvas/WebGL micro-engine ❌ Not justified

We already lean toward immediate-mode rendering, so a thin custom layer is *conceivable*.
But it trades a maintained dependency for code we'd have to maintain forever, with no
near-term benefit. Only sensible if we wanted to drop all third-party engine deps on
principle.

### Option E — Stay on dead Kaboom ❌ Reject

No upside over KAPLAY. Accumulating risk: unpatched bugs, no security fixes, friction with
future tooling/Node/Vite versions, and a dependency that will rot.

---

## Performance note

Community benchmarks show Kaboom/Kaplay's renderer is much slower than Phaser/Pixi under
heavy sprite loads. **This is not currently a constraint for Tamers Quest** because the game
renders few entities and already culls/caches tiles. Treat measured frame budget — not
benchmark headlines — as the trigger. If we ever see dropped frames on target devices with
real sessions, re-open Option B.

---

## Decision

1. **Migrate `kaboom` → `kaplay` now.** It's the maintained version of the same engine and
   removes the only genuine risk. ~Hours of work, drop-in, fully covered by the existing
   test suite for the logic layers and a manual smoke test of each scene.
2. **Keep the architecture as-is.** The engine-agnostic core (`src/engine/`, `server/`,
   `src/net.js`) is the project's biggest asset — it keeps every future option cheap.
3. **Defer any heavier engine (Phaser/Pixi) until a concrete need appears** — measured
   performance problems or a specific feature we can't reasonably hand-roll.

### Suggested migration steps (Option A)

```
npm uninstall kaboom
npm install kaplay
```
- In `src/main.js`: `import kaplay from "kaplay"` and `const k = kaplay({...})` (same opts).
- Update the `kaboom` reference in `package.json` "description" if desired.
- Run `npm test` (logic layers are engine-independent, should pass unchanged).
- Manually smoke-test each of the 13 scenes (title → character select → game → fight →
  online lobby → online game → bestiary → roster) for draw/input regressions.
- Watch for any v3001 API deltas flagged in the KAPLAY migration guide.

---

## Sources

- [The relation of KAPLAY with Kaboom (GitHub wiki)](https://github.com/kaplayjs/kaplay/wiki/The-relation-of-kaplay-with-Kaboom)
- [KAPLAY — Migrating to v3001](https://kaplayjs.com/docs/guides/migration-kaplay/)
- [KAPLAY.js repository](https://github.com/kaplayjs/kaplay)
- [Phaser vs Kaplay vs Excalibur: Which 2D Web Game Framework Wins?](https://phaser.io/news/2026/04/phaser-vs-kaplay-vs-excalibur-2d-web-game-framework)
- [JS game rendering benchmark (Three/Pixi/Phaser/Kaboom/Kaplay/…)](https://github.com/Shirajuki/js-game-rendering-benchmark)
- [I Tried 3 Web Game Frameworks (jslegenddev)](https://jslegenddev.substack.com/p/i-tried-3-web-game-frameworks-so)
