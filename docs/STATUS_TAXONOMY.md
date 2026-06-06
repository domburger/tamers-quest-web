# Status Effect Taxonomy — SHELVED (2026-06-06)

> 🛑 **Decision (Q7): not pursued.** Combat is **AI-resolved**, and status effects
> are interpreted/executed by the AI during fights rather than via a fixed table.
> This proposal is kept for reference only. The deterministic fallback
> (`src/engine/combat.js`) retains its 4 canonical statuses (Burn/Poison/Freeze/
> Stun) for offline play; no further taxonomy work is planned.

---

> _(Original proposal below, for reference.)_
> Addresses OPEN **Q7**. The attack data inflicts **63 distinct status labels**
> across 351 attacks, but the engine only implements **4** (Burn, Poison, Freeze,
> Stun); the other 59 are stored as inert labels. This proposes a small canonical
> set + a mapping of every label onto it. **Nothing is implemented yet** — review
> the table and the open sub-decisions, then I'll wire it into
> `src/engine/combat.js`.

Last updated: 2026-06-06

---

## Proposed canonical effects

Magnitudes/durations are **starting proposals — tune freely**. "Target" = who the
status lands on when an attack inflicts it.

| Effect | Kind | Mechanic (proposed) | Duration | Target |
|---|---|---|---|---|
| **Burn** | DoT | lose 5% max HP at start of turn | 3 turns | enemy |
| **Poison** | DoT | lose 3% max HP at start of turn | 3 turns | enemy |
| **Bleed** | DoT | lose 4% max HP at start of turn | 3 turns | enemy |
| **Stun** | skip | skip the next action, then clears | 1 turn | enemy |
| **Freeze** | skip | 30% chance to skip each turn | 2 turns | enemy |
| **Paralyze** | skip | 50% chance to skip each turn | 2 turns | enemy |
| **Blind** | debuff | accuracy −40% | 3 turns | enemy |
| **Slow** | debuff | speed −30% (acts later) | 3 turns | enemy |
| **Weaken** | debuff | defense −30% | 3 turns | enemy |
| **Regen** | buff | heal 5% max HP at start of turn | 3 turns | **self** |
| **Guard** | buff | incoming damage −30% | 3 turns | **self** |
| **Reflect** | buff | return 25% of damage taken to attacker | 3 turns | **self** |

12 effects (the existing 4 + 8 new). Burn/Poison/Freeze/Stun keep today's numbers.

## Full label → canonical mapping (all 63)

**DoT**
- Burn → **Burn**; Frostbite, Burn/Freeze → **Burn** (single-status rule picks one)
- Poison, Poisoned → **Poison**
- Bleed, Bleeding → **Bleed**; Cursed, Moonlit Curse → **Bleed** (curse = decay DoT)

**Skip / incapacitate**
- Stun, Stunned, Knockback, Dimensional Rift → **Stun**
- Frozen, Freeze → **Freeze**
- Paralysis, Paralyzed, Immobilized, Bound, Rooted, Entangled, Entangle, Buried, Petrification, Petrify → **Paralyze**

**Accuracy down**
- Blind, Blinded, Confusion, Confused, Disoriented, Disorientation, Dazed, Dazzled, Dazzle, Dizzy, Fear, Stagger → **Blind**

**Speed down**
- Soaked, Soak, Drenched, Wet, Chilled, Slowed, Drowning, Drowned → **Slow**

**Defense / stat down**
- Weakened, Defense Down, Vulnerability, Cripple, Crushed, Corrosion → **Weaken**

**Buffs (self-applied)**
- Regeneration, Rejuvenation, Heal, Healing → **Regen**
- Shielded, Defense Boost, Ethereal, Calm, Arrogance, Invisibility → **Guard**
- Reflect, Thorns → **Reflect**

That accounts for all 63.

## Open sub-decisions (your call)

1. **Buff targeting.** The data lists buffs (Heal, Shielded, Reflect…) as an
   attack's `inflictedStatus`, with no target field. Proposal: **buff-type
   effects apply to the attacker (self); everything else to the target.** OK? __
2. **Magnitudes & durations.** Accept the table above, or adjust any numbers? __
3. **Single vs multiple statuses.** Today only one status at a time (new replaces
   old). Keep that, or allow e.g. one DoT + one debuff at once? __
   _My pick: keep single-status for now (simpler); revisit later._
4. **Ambiguous labels** — confirm the stretch mappings: Cursed/Moonlit Curse →
   Bleed; Knockback/Dimensional Rift → Stun; Invisibility → Guard;
   Frostbite/"Burn/Freeze" → Burn. Override any? __
5. **Stacking/refresh.** Re-applying the same status — refresh duration (proposal)
   or ignore? __  _My pick: refresh duration._

## Implementation sketch (after approval — ~half a day)

1. **Schema:** statuses gain a duration, so `MonsterInstance.status` becomes
   `{ type, turnsLeft }` (or a parallel `statusTurns`). Update `schemas.js` +
   `buildMonsterState` + the fight UI's status label.
2. **Engine:** add a `STATUS_DEFS` table in `engine/combat.js` keyed by canonical
   type → `{ kind, magnitude, duration, target }`. Rewrite `applyStatusTick` to
   read it (DoT/skip/regen), and apply debuffs (Blind/Slow/Weaken) inside the
   accuracy/speed/defense math. Decrement `turnsLeft`; clear at 0.
3. **Mapping:** add `STATUS_ALIASES` entries for all 63 labels → canonical, so
   `inflictedStatus` normalizes on application (extends the small alias map that
   exists today).
4. **Tests:** extend `combat.test.js` — one case per canonical effect (tick
   amount, skip behaviour, debuff math, buff self-targeting, duration expiry).

No gameplay code changes until you've signed off on the table + sub-decisions.
