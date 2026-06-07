# INV-A1 — SP/MP inventory behaviour-parity audit

Compares the single-player inventory (`src/scenes/inventory.js`, persisting to a
local character via `storage.js`) against the multiplayer roster
(`src/scenes/roster.js`, syncing to the authoritative server via `net.setRoster` /
the `release` handler). Goal: the same swap rules, vault cap, equip semantics, and
acquisition results in both modes.

_Audited 2026-06-07 (flexible worker). Most parity is structurally guaranteed because
both modes now route through the shared `src/engine/inventory.js` rules (PT2-T11
PARITY-3); the one behavioural gap found is fixed below._

## Axes checked

| Axis | SP (`inventory.js`) | MP (`roster.js` + server) | Parity |
|---|---|---|---|
| **Acquisition** (where a caught monster lands) | shared `addCaughtMonster` | shared `addCaughtMonster` (server) | ✅ one rule |
| **Roster apply** (field/store → active set) | shared `applyRoster` | shared `applyRoster` (server `setRoster`) | ✅ one rule |
| **Equip chain** (ownership gate) | shared `equipChain` | `net.setEquippedChain`, server-validated; UI only lists owned chains | ✅ equivalent |
| **Release** (refund + keep-≥1) | shared `releaseMonster` (INV-T7) | shared `releaseMonster` via server `release` handler (INV-T7) | ✅ one rule |
| **Keep ≥1 active** | move active→vault refuses emptying the team | `storeFromActive` refuses when `active.length <= 1` | ✅ equivalent |
| **Vault cap = `vaultCapacity` (Deep-Vault-aware)** | display + **enforced** on move-to-vault (INV-T2): refuses when full, "VAULT FULL" | display enforced; **store-to-vault was NOT cap-checked** | ⚠️ **gap → fixed** |

## Gap found & fixed

**MP store-into-a-full-vault silently dropped a monster.** `roster.js storeFromActive`
pushed the stored monster to the vault with no capacity check, then `sync()` →
`net.setRoster`. The server's `applyRoster` clamps the vault to `vaultCapacity` by
**truncating the overflow**, so storing into an already-full vault silently dropped a
vault monster (data loss) — whereas SP refuses the move with a "VAULT FULL" warning
(INV-T2). **Fix:** `storeFromActive` now checks `vaultCapacity(net.state, GAME.VAULT_SIZE)`
and refuses with a toast when the vault is full, matching SP. (`roster.js`, this audit.)

## Notes / non-gaps

- MP has no direct active↔vault **swap** (only one-directional field / store), so the
  SP "swap into a full vault" path has no MP equivalent to diverge on.
- `fieldFromVault` (vault→active) is correctly gated on `TEAM_MAX` in MP; SP mirrors it.
- Wallet/essence and roster snapshots stay server-authoritative in MP; SP persists to
  `storage.js`. Values are computed by the same engine helpers, so amounts match.

## Follow-ups (not parity bugs)

- **INV-T1** (de-dupe the two scenes onto the shared engine for swap/move/validate) would
  make most of this structural rather than checked. Tracked separately.
