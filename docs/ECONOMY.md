# Gold Economy (TQ-42)

The designed, balanced gold curve. Gold is the **only earned currency** — Essence is premium
(real-money, Paddle) and never earned in runs, never buys power (non-pay-to-win is a hard
constraint). Decision: TQ-92 (Dominik) — accept the current pace as the design and document it.

All values live in code (`src/engine/schemas.js` `GAME.GOLD` + `GAME.CRAFT`, and
`src/engine/upgrades.js`); this doc is the design rationale + balance check. Source/sink math is
shared by SP and MP via `src/engine/progression.js` so the two can't drift.

## Sources (earning)

| Source | Amount | Scales by | Code |
|---|---|---|---|
| Defeat a wild monster | `4 + 2 × monsterLevel` | Prospector (×1.0–×2.0) | `GAME.GOLD.PER_DEFEAT_BASE/PER_LEVEL`, `defeatGold()` |
| Extract (complete a run) | `+30` bonus | Prospector (×1.0–×2.0) | `GAME.GOLD.PER_EXTRACT`, `extractGold()` |

- **Prospector** meta-upgrade gives `+20%` gold per level (L0→L5 = ×1.0, 1.2, 1.4, 1.6, 1.8, 2.0),
  applied to *both* defeats and the extract bonus (`goldMult()`).
- **Per-defeat gold is credited live** to the persistent profile as monsters fall
  (`world.js` → `profile.gold += defeatGold(...)`).
- **Typical successful run** (~8 defeats of avg level 5, then extract) ≈ `8×14 + 30 = 142` gold
  before Prospector; up to ~284 with Prospector maxed.

### Death / loss
Defeat loses the active **run team** (Q10), but gold already earned from defeats **is kept** (it was
credited live). Only the **extract bonus (+30) is forfeited** on a failed run — extraction is the
reward for surviving. So failed runs yield partial gold, never zero.

## Sinks (spending)

| Sink | Cost curve | Total | Code |
|---|---|---|---|
| **Prospector** (×gold, +20%/lvl, max L5) | `120 → 216 → 389 → 700 → 1260` (×1.8/lvl) | **2685** | `upgrades.js` baseCost 120, costMult 1.8 |
| **Deep Vault** (+25 vault cap/lvl, max L5) | `100 → 160 → 256 → 410 → 655` (×1.6/lvl) | **1581** | `upgrades.js` baseCost 100, costMult 1.6 |
| **Spirit-chain upgrades** (tier N→N+1) | `N × 40` (40, 80, 120, 160) | 400 / chain to T5 | `GAME.CRAFT.UPGRADE_COST_PER_TIER` |
| **Cosmetics** | catalog prices | — | shop/cosmetics data (secondary) |

> Note: the old **Attunement** upgrade line was removed (TQ-132 — essence is no longer earned), so
> the two permanent upgrade lines are **Prospector + Deep Vault = 4266 gold** to max both.

## Pace & balance

- **Early:** Prospector L1 (120 g) ≈ **<1 run** — immediate positive feedback, no starvation.
- **Mid → late:** maxing both upgrade lines (4266 g) ≈ **~30 runs** at 142 g/run, and effectively
  **~20–25** once an early Prospector compounds earnings. This sits inside the **20–50 run** target
  the decision (TQ-92) accepted as the right grind length.
- **No runaway inflation:** sink costs grow geometrically (×1.8 / ×1.6 per level) while the earn-rate
  multiplier is hard-capped at ×2.0 (Prospector L5), so each successive upgrade level stays
  meaningfully expensive instead of becoming trivially affordable.
- **No starvation:** every run yields gold; even a failed run keeps its per-defeat gold.
- **Non-pay-to-win:** all power sinks (upgrades, chains) are **gold-only**; Essence buys cosmetics
  only and is never earned, keeping the earn economy fully separate from the paid one.

## Tuning

To retune, change the constants in `src/engine/schemas.js` (`GAME.GOLD`, `GAME.CRAFT`) and
`src/engine/upgrades.js` (`baseCost`/`costMult`/`maxLevel`) — the curve above recomputes from them.
Keep the two invariants: power is gold-only, and "runs to max upgrades" stays ~20–50.
