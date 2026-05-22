# Tamers Quest Web

A 2D top-down dungeon crawler + monster taming RPG, built with [Kaboom.js](https://kaboomjs.com/).

Ported from the original Java/LibGDX version.

## Quick Start

```bash
npm install
npm run dev
```

## What Is Tamers Quest?

A procedurally generated dungeon crawler with monster taming and AI-mediated turn-based combat.

- **103 unique monsters** across 6 elements (Fire, Water, Nature, Dark, Light, Neutral)
- **Procedural dungeons** — 400x400 tile maps with DLA cave carving, Voronoi biomes, color-profile tile matching
- **AI-mediated turn-based combat** — turns evaluated by GPT-4o with deterministic fallback for offline play
- **Taming mechanic** — catch weakened monsters to grow your roster (team of 4)
- **Time pressure** — 10-minute runs, shrinking safe zone, portals spawn after 5 minutes
- **438 ground tiles**, hand-crafted monster sprites, atmospheric backgrounds

## Features

### Screens
- **Start Screen** — animated logo with ornate border overlay, pulsing prompt
- **Character Selection** — create/select/delete characters with confirmation dialog
- **Lobby** — hub showing team preview, buttons for Start Run, Inventory, Settings
- **Loading** — progress bar during DLA dungeon generation
- **Game** — top-down exploration with WASD movement, tile collision, monster encounters
- **Fight** — face-to-face battle layout with player & enemy sprites, HP/energy bars, 5 actions
- **Inventory** — click-to-swap between active team (4 slots) and scrollable vault (100 slots)
- **Settings** — OpenAI API key management for AI-mediated combat
- **Run Result** — victory (heal team) or defeat (lose team, receive 4 random starters)

### Combat
- **AI mode**: GPT-4o evaluates turns with full damage formulas, accuracy, crits, elemental matchups, and status effects
- **Offline mode**: deterministic fallback engine with identical combat rules (no API key needed)
- **Actions**: Fight (pick from 4 attacks), Catch, Swap, Skip, Flee
- **Elemental matchups**: Fire > Nature > Water > Fire (1.3x/0.7x), Dark <> Light (1.2x)
- **Status effects**: Burn, Poison, Freeze, Stun
- **XP & leveling**: 100 XP per level, stat scaling per monster type

### Dungeon Generation
- DLA (Diffusion-Limited Aggregation) cave carving matching the original Java implementation
- 3-stage pipeline: void map (DLA) -> biome assignment (Voronoi) -> floor tile placement
- Color-profile tile scoring with rotation matching (ROT_MAP)
- Monster spawning with level-appropriate stats (Lv.1-5)

### Game HUD
- Timer (color-coded: white > yellow > red)
- Team HP bars (top-left)
- Minimap with player position, portals, shrinking circle
- Pause menu (ESC) with Resume/Quit Run

### Persistence
- All data saved to localStorage (characters, monsters, inventories)
- Defeat penalty: lose entire team, receive 4 random Lv.1 starters
- Victory: full team heal

## Tech Stack
- **Kaboom.js** v3000 (game engine, non-global mode)
- **Vite** (dev server + bundler)
- **OpenAI API** (optional, for AI-mediated combat)
