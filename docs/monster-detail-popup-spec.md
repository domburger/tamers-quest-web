# Standardized Monster-Detail Popup — Design Spec (TQ-122)

The single, shared popup that shows a monster's full details, adopted by every surface
(bestiary, roster, hub, combat) so they render **identically**. This pins the contract the
build story (TQ-123) implements against; the wiring stories (TQ-124 scenes, TQ-125 combat)
adopt it. **No code in TQ-122** — this is the authoritative reference.

Grounded in the current code: monster type `public/assets/data/monstertype.json` +
`src/engine/gamedata.js` (`getMonsterType`, `getAttacksForMonster`, `cleanAttackName`);
instance `src/engine/schemas.js` (`createMonsterInstance`); stats `src/engine/stats.js`
(`getMonsterStats`, `getMonsterMaxHp`); xp `src/engine/progression.js` (`xpForLevel`);
existing detail views `src/scenes/{roster,hub,bestiary,onlineGame}.js`.

---

## 1. Goal & non-goals

- **Goal:** ONE component renders a monster's identity + vitals + stats + abilities +
  description, consistently, from every call site, responsive desktop ↔ mobile-portrait.
- **Non-goals:** redesigning each scene; new data; combat *actions* (the popup is read-only —
  the combat action menu stays separate). Catching/field/release **actions** stay owned by the
  *caller* (passed in as optional buttons), not baked into the popup.

## 2. Component API (the contract TQ-123 builds)

A new module `src/render/monsterDetail.js`, immediate-mode (drawn in the host scene's `onDraw`,
matching every existing detail view). Two surfaces:

```
// Pure layout/measure — returns the panel height needed for a given width (no draw).
measureMonsterDetail(k, { mon, type, width, narrow }) -> { height, abilitiesShown }

// Draw the popup INTO a host-provided rect (the host owns the scrim + open/close + bleed-gating).
drawMonsterDetail(k, {
  rect,                       // [x,y,w,h] panel rect the host centred (see §6 sizing)
  mon,                        // INSTANCE: { typeName, name?, level, currentHealth, currentEnergy, xp?, status? }
  type,                       // getMonsterType(mon.typeName) — species/base data; REQUIRED
  vitals,                     // { hp, maxHp, energy, maxEnergy, xp, xpToNext } — LIVE values (see §4)
  abilities,                  // getAttacksForMonster(type) — array (already resolved by the caller)
  hoverIdx,                   // for desktop ability hover-tooltip; -1 = none (host passes inRect result)
  actions,                   // optional [{label, kind, onTap}] the host renders as buttons (Field/Store/Release/Close)
  t,                          // animation clock (k.time()), for the sprite/pulse; frozen under reduce-motion
}) -> { abilityRects, actionRects }   // hit rects the host uses for hover/tap
```

**Why immediate-mode + host-owned scrim:** every current detail view is immediate-mode and
hand-gates the overlay (roster `inspect`, hub `openMonsterDetail`/`overlayOpen`). The popup must
slot into that pattern, not introduce a new retained-overlay system. The host supplies the dim
scrim, the open/close state, the Esc/outside-click/X close, and gates underlying clicks (the
"overlay-bleed" pattern — `src/scenes/hub.js` `menuKeepsWorld` / TQ-88).

**No internal scrolling.** The kaboom shim has **no clip/scissor** (see TQ-126), so the popup
MUST fit its rect by truncation/compaction, never an internal scroll region. `measureMonsterDetail`
returns the exact height for the chosen width; the host centres a panel of that height. On a
viewport too short for the full height, drop trailing content in this priority order (least → most
important): (1) lore/description first, (2) then ability *descriptions* (keep ability rows), (3)
then trailing abilities — mirroring the hub modal's existing measure-then-drop overflow guard.

## 3. Field inventory (every field + its source)

| Field | Source | Notes |
|---|---|---|
| Name / nickname | `mon.name \|\| type.typeName` | nickname falls back to species name |
| Species (type) | `type.typeName` | shown as a sub-label under a nickname |
| Element | `type.element` | free-form text; **neutral** accent only (see §7) |
| Rarity | `type.rarity` | shown as a coloured chip + label (see §7) |
| Level | `mon.level` | |
| Size | `type.size` | optional small tag |
| HP / max | `vitals.hp` / `vitals.maxHp` | max via `getMonsterMaxHp(type, level)` |
| Energy / max | `vitals.energy` / `vitals.maxEnergy` | hide the energy row if `maxEnergy<=0` |
| XP / to-next | `vitals.xp` / `vitals.xpToNext` | `xpToNext = xpForLevel(level)`; hide in combat |
| Status | `mon.status` | e.g. burn/poison/freeze; hidden when null |
| 7 stats | `getMonsterStats(type, level)` | keys IN ORDER: **health, strength, defense, speed, power, energy, luck** |
| Passive | `type.passiveEffect` | hide if empty |
| Active | `type.activeEffect` | hide if empty (note: TQ-108 may remove activeEffect — guard for absence) |
| Description / lore | `type.description` | up to ~282 chars; truncated to fit (see §2) |
| Abilities (≤4) | `getAttacksForMonster(type)` | each attack object, see below |

**Ability (attack) fields** (`public/assets/data/attacks.json`, resolved by `getAttacksForMonster`):
`name` (display via `cleanAttackName(name)`), `description`, `damage`/`power`, `accuracy` (0–1 →
show as %), `energyCost`, `critChance` (0–1 → %), `critMultiplier`, `elementalType`,
`inflictedStatus` + `statusChance` (0–1 → %). Any field may be absent on AI-authored monsters —
render only the fields present; never show `undefined`/`NaN`.

## 4. Live vitals contract (`vitals`)

The CALLER computes `vitals` so the popup shows live HP/energy that match the surface it's opened
from (roster = full bars; combat = current in-fight HP). This avoids the popup re-deriving state.

- Roster/hub/bestiary: `hp=mon.currentHealth`, `maxHp=getMonsterMaxHp(type,level)`,
  `energy=mon.currentEnergy`, `maxEnergy=getMonsterStats(type,level).energy`, `xp=mon.xp`,
  `xpToNext=xpForLevel(level)`.
- Combat (TQ-125): pass the live combatant HP/energy from `net.state.combat` (current values),
  `xp`/`xpToNext` omitted (no XP context mid-fight).
- Bestiary "seen but uncaught": pass `mon` as a level-1 exemplar with full bars; the caller may set
  a `locked` opt to dim vitals it shouldn't reveal (out of scope to decide here — default: show
  base stats at Lv.1).

## 5. Layout

Two-zone, top-down. Widths/sizes are the contract; colours/spacing pull from `src/ui/theme.js`.

```
┌───────────────────────────── panel (rect) ─────────────────────────────┐
│  [X]                                                          RARITY◗   │  header band
│  ┌────────┐   NAME (size 26, one line, auto-shrink → ellipsis)         │
│  │ sprite │   species · Element · Lv N · Size                          │  identity
│  └────────┘   STATUS chip (only if mon.status)                         │
│  HP   ▓▓▓▓▓▓▓▓░░  cur/max     ENERGY ▓▓▓▓░░ cur/max   (energy hidden    │  vitals bars
│  XP   ▓▓▓░░░░░░░  xp/toNext                            if maxEnergy<=0) │
│  ── STATS ───────────────────────────────────────────────────────────  │
│  HEALTH n   STRENGTH n   DEFENSE n   SPEED n                            │  stats grid
│  POWER  n   ENERGY   n   LUCK    n                                      │  (2–4 cols, see §6)
│  ── ABILITIES ───────────────────────────────────────────────────────  │
│  • Name      dmg N · acc P% · E cost N · crit P%×M · [Status P%]        │  ability rows (≤4)
│    description… (1 line; full text on hover-tooltip desktop / tap mobile)│
│  ── (passive/active, then description/lore — truncated to fit) ─────────  │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Sprite:** square cell top-left, `~64px` (desktop) / `~52px` (narrow); the sprite NEVER overlaps
  the title (the bug behind TQ-87 — keep the name's left edge ≥ sprite right + 12px).
- **Section order (fixed):** identity → vitals (HP, energy, XP) → STATS → ABILITIES → passive/active →
  description. Sections with no data are omitted (no empty headers).
- **Ability row format:** `cleanAttackName(name)` bold, then a compact stat line built from only the
  present fields, in this order: `dmg`, `acc%`, `E <energyCost>`, `crit <critChance%>×<critMultiplier>`,
  `[<inflictedStatus> <statusChance%>]`, `<elementalType>`. Second line: description, truncated to one
  line; full text via hover-tooltip (desktop) or tap-to-expand (mobile).
- **Bars:** reuse `hpColor(frac)` for HP; energy = a fixed teal; XP = a fixed amber/violet. Numeric
  `cur/max` right-aligned on the bar.

## 6. Responsive / sizing

- **Panel width:** `w = min(560, viewportW - 24)`. **Narrow** when `w < 470` (matches the roster
  inspect threshold) → single column; **wide** → stats in a 3–4 col grid, abilities full-width.
- **Stats grid columns:** wide = 4, narrow = 2.
- **Height:** from `measureMonsterDetail` (content-driven), capped at `viewportH - 24 - safeInsets`.
  If the natural height exceeds the cap, apply the §2 drop order until it fits — **no scroll**.
- **Safe area:** inset the panel + the X by `safeInsetsDesign(k)` so the close button clears
  notches/home-bar (parity with the existing scenes).
- **Reduce-motion:** freeze the sprite idle/pulse animation (`prefersReducedMotion()`), as the
  current avatars do.

## 7. Visual tokens (reuse — don't hardcode)

- **Element:** NO per-element colour. `elementColor()` (src/ui/theme.js) returns the neutral accent
  by design (elements are free-form/AI-invented). Element shows as plain text in the neutral accent.
- **Rarity:** colour chip + label from a shared rarity map. Reuse `RARITY_COLOR`
  (`src/render/chainCosmetics.js`: Common neutral, Uncommon green, Rare blue, Epic purple, Legendary
  gold) — the SAME tiers the item bag uses (TQ-64 rarity). If `type.rarity` is numeric/legacy, map it
  through a small `rarityName()` helper (build-story to add) so old + new data both colour correctly.
- **Panel/scrim/bars/buttons:** `drawPanel` (immediate-mode panel: shadow+sheen+rim), `drawButton`
  (action buttons), `inRect` (hover/tap hit-tests), `hpColor`, `drawScrollbar` is NOT used (no scroll).
  Scrim: host draws `k.drawRect({color:[0,0,0], opacity:0.72})` behind the panel (roster's value).

## 8. Per-call-site adoption (TQ-124 / TQ-125)

All call sites build the same inputs and host the same popup; they differ only in `actions` + `vitals`:

- **Bestiary (TQ-124):** tap a card → open popup; `actions = [Close]`; vitals = Lv.1 exemplar (or the
  caught instance if owned). Replaces the current "no detail modal" gallery behaviour.
- **Roster (TQ-124):** replaces `drawInspect` — `actions = [Field/Store, Release(2-step), Close]`;
  vitals from the owned instance. This is the most complete current view; it becomes the popup verbatim.
- **Hub (TQ-124):** replaces `openMonsterDetail` — `actions = [Close]`; same inputs. Removes the
  hub-vs-roster layout drift.
- **Combat (TQ-125):** tap the enemy / own-monster / a team slot → open popup; `actions = [Close]`;
  vitals from live `net.state.combat`; XP omitted; the popup is read-only and does not block the
  action menu (host gates appropriately).

## 9. Acceptance (for the build story TQ-123)

A reviewer/implementer can build `monsterDetail.js` from §2–§7 without further questions:
all fields + sources enumerated, layout + ability-row format pinned, responsive thresholds + the
no-scroll/measure-then-drop rule defined, the component API + per-site inputs specified, and the
reused theme tokens named. The unified popup shows: identity (name/species/element/rarity/level),
vitals (HP, energy, XP, status), all 7 stats, ≤4 abilities WITH details, passive/active, and
truncated lore — identically on desktop + mobile-portrait, overlay-bleed-safe, no clipping needed.
