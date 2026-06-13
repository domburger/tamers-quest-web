# Economy (Gold — TQ-42 · XP — TQ-43)

Two progression economies: **gold** (account currency, below) and **XP/leveling** (per-monster,
[see further down](#xp--leveling-economy-tq-43)). Decisions: TQ-92 (gold) + TQ-93 (XP), both
Dominik — accept the current curves as the design and document them.

## Gold

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

---

# XP & Leveling Economy (TQ-43)

XP is **per-monster** (each captured monster levels independently). There is currently **no
player-account level** (see the note at the end). Source/threshold math is shared SP+MP via
`src/engine/progression.js` (`grantXp`, `xpForLevel`).

## Source (earning XP)

| Source | Amount | Code |
|---|---|---|
| Defeat a wild monster | `20 + 10 × enemyLevel` XP, to the monster(s) that fought | `server/combat.js` `grantXp(pm, 20 + enemy.level*10)` |
| Catch a monster | **0 XP** — the reward is the captured monster itself | — |

- Only **defeating** grants XP; catching does not (the catch *is* the reward).
- XP goes to the participating team monster(s), not the player.

## Level curve (spending XP)

Advancing **from level L → L+1** costs `XP_BASE × XP_GROWTH^(L−1)` = **`100 × 1.15^(L−1)`** XP
(`GAME.XP_BASE`/`XP_GROWTH`, `xpForLevel()`), rounded. Every monster uses the same fixed curve:

| L→L+1 | 1→2 | 2→3 | 5→6 | 10→11 | 20→21 |
|---|---|---|---|---|---|
| XP | 100 | 115 | 175 | ~405 | ~1637 |

- **On level-up:** the monster's level +1, the XP carry-over resets, and **HP + energy refill to the
  new level's max** (`grantXp` → `getMonsterStats`). A single large grant applies multiple level-ups,
  keeping the remainder.

## Pace & balance

- **Early game is fast:** at `20 + 10×lvl` XP per defeat, a low-level monster (100–175 XP/level)
  levels up every ~2–3 defeats of similar-level wilds — quick, visible progress.
- **Self-balancing against run length:** a run yields ~8–10 defeats. The exponential threshold
  (×1.15/level) means high-level monsters need many more defeats per level, so leveling naturally
  decelerates without a level cap — no runaway power spikes, no hard wall.
- **Level-scaled source:** defeat XP scales with the *enemy's* level (`+10/level`), so fighting
  tougher wilds is proportionally more rewarding, keeping high-level grinding viable.

## Player-account level — OPEN

`PlayerProfile.level` / `.xp` exist (schemas.js) and are serialized (`server/account.js` →
`level: p.level || 1`) but are **never granted** — player level does nothing today. Whether to (a)
build a real player-XP/account-level system or (b) remove the dead fields is a **contested design
call** (the TQ-93 decision text and its closing summary disagree; flagged by a review). Split into
its own Decision rather than guessed — do **not** add/remove these fields until that's settled.

