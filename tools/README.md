# Visual-QA harness suite (`tools/`)

Headless Playwright harnesses that drive the game in Chromium (swiftshader GL) and
screenshot scenes/flows into **`.screenshots/`** (gitignored). They exist because
the game renders on a canvas — unit tests can't catch layout/colour/overlap/UX
regressions, but a screenshot can. Built/maintained by `@visual`.

**Naming convention** (`.gitignore`): `tools/shoot-*.mjs` are the **canonical,
tracked** suite; `tools/shot-*.mjs` are **gitignored scratch** one-offs. To promote
a scratch script, rename `shot-` → `shoot-`.

## Running

All take `GAME_URL` (default `http://localhost:8080`), `DSF` (deviceScaleFactor,
default 2). Pick a backend:

- **`npm run server`** — combined Node server on `:8080`, serves the built `dist/`
  + the WS game. Run `npm run build` first. Good for menus / SP flows.
- **`npm run dev`** — Vite dev server (serves source, no `dist` rebuild). Needed
  for harnesses that rely on a **DEV-only** hook (`import.meta.env.DEV`). Note the
  port it prints (often `:5174` if `:5173` is taken).
- **`?ws=` override** (`src/net.js`): point a dev-served client at any WS server
  without rebuilding `dist`, e.g.
  `GAME_URL="http://localhost:5174/?ws=ws://localhost:8097"`. The cleanest way to
  QA MP in-round views (see `shoot-round.mjs`).
- For MP rounds, run a server with `MATCH_MIN_PLAYERS=1 MATCH_COUNTDOWN_S=0` (solo
  instant rounds); `ENCOUNTER_RADIUS=50000` forces a wild encounter fast.

## The harnesses

| Harness | Captures | Backend / notes |
|---|---|---|
| `shoot.mjs` | title, bestiary, character-select, online lobby + Esc-to-title check | server or dev |
| `shoot-sp.mjs` | SP lobby + overworld (`05-lobby`, `06/07-game-world`). `REDUCE_MOTION=1` emulates the a11y reduce-motion setting (atmosphere motes drop) | server or dev |
| `shoot-spcombat.mjs` | SP combat menus (player/attack/swap) via the **DEV force-encounter hook** (press `0`, see `game.js`) | **dev** (hook is DEV-only) |
| `shoot-fight.mjs` | SP combat via RNG roaming into a monster (unreliable; prefer `shoot-spcombat`) | server or dev |
| `shoot-round.mjs` | MP in-round overworld (idle/moving/pause). Header documents the `?ws=` dev path (no `dist` rewrite) | dev + a solo-round WS server via `?ws=` |
| `shoot-combat.mjs` | MP combat overlay playability end-to-end | dedicated MP server |
| `shoot-mpmenus.mjs` | MP between-rounds menus: online roster + online Spirit Shop (joins, no queue) | running server |
| `shoot-roster.mjs` | online roster (Team & Vault + Spirit Chains tab) | running server |
| `shoot-faces.mjs` | bestiary monster faces (close-up); `CLIP="0,0,1280,720"` for the full grid | server or dev (routes via SP lobby → Bestiary) |
| `shoot-csp.mjs` | LS-10 CSP verification — counts CSP violations | server started with `CSP_ENFORCE=true` |

## DEV-only QA hooks (stripped from prod builds)

- `game.js` — press **`0`** to force the nearest wild encounter (lets `shoot-spcombat`
  reach combat deterministically instead of RNG-roaming). Gated behind
  `import.meta.env.DEV`, so it only exists under `npm run dev`.

## Verifying production

To smoke-check the **live** site (fonts/canvas/menus render after a deploy), point
the menu harness at it — this is read-only (loads the public page + walks the
title/menus, no character or WS join):

```
GAME_URL=https://tamersquest.com node tools/shoot.mjs
# non-16:9 aspect check (verifies the "fill any screen, no letterbox" scaling):
GAME_URL=https://tamersquest.com VW=1024 VH=768 node tools/shoot.mjs
```

⚠️ **Do NOT run the MP harnesses** (`shoot-round`/`shoot-combat`/`shoot-mpmenus`,
or anything that fills a nickname + Connects) **against prod** — they join/queue
and would inject test traffic into the live game. SP-only / menu captures are safe.
(On a no-traffic prod env the title leaderboard is correctly empty/hidden.)

## Other

- `shot-scenes.mjs` (scratch) walks the SP menu scenes (inventory/shop/upgrades/
  cosmetics/settings); `gen-icons.mjs` renders the PWA PNG icons from `public/icon.svg`.
