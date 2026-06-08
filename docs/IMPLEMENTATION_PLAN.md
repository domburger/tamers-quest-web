# Tamers Quest - Implementation Plan

Last updated: 2026-06-08

## Important bullets

- **Production is the current test environment.** Run `npm run build` before pushing. Commit and push small changes directly to `master`. Log failing tests in `docs/BUGFIX_LOG.md` instead of blocking production test deploys.
- **The game is server-authoritative.** Clients should send input and render snapshots; trusted state, movement, combat, loot, and persistence belong on the server or in shared engine code.
- **Avoid duplicate single-player and multiplayer rules.** Any gameplay rule that exists in both modes should live in shared engine code and be covered by tests.
- **Combat is AI-judged with a deterministic safety net.** No fallback exists to prevent crashes.
- **Admin settings should stay current.** Any new live gameplay knob, AI prompt, model setting, or generated asset type should be surfaced in admin if it is useful for live tuning.
- **The wiki must match mechanics.** Update `public/wiki.html` when combat, elements, catching, chains, status effects, controls, mobile behavior, or progression rules change.

## Task list

Legend: `[ ]` todo · `[~]` in progress · `[x]` done

Mark the item as in progress immediately before you start a task.

### Highest priority

- [ ] **Recover lost work** Check the current status of the project, check all branches and check if changes or work is missing that was commited locally or elsewhere. Check make sure that the master is up to date
- [ ] **Unify single-player and multiplayer flow.** Make the shared lobby, inventory, shop, upgrades, roster, movement, map, and combat logic work from one shared path. Remove unreachable duplicate multiplayer management scenes after the shared path is complete.
- [ ] **Finish sign-in UI.** Wire Google, Discord, and Tamer's Account buttons to the existing backend routes. Store returned session tokens and show clear login failure/unavailable states.
- [ ] **Verify OAuth in production.** Test Google and Discord callbacks on Railway with the live credentials and confirm account/profile linking works.
- [ ] **Finish native account UI.** Add sign-up and sign-in forms for email/password accounts. Keep anonymous play available.
- [ ] **Add password reset.** Implement the reset-token flow once an email/SMTP path is available.
- [ ] **Run account security audit.** Check token generation, login throttling, account claiming, OAuth state handling, profile linking, and user-enumeration behavior before sign-in is treated as complete.
- [ ] **Complete legal placeholders.** Fill in operator name, address, contact email, retention period, children age policy, and governing law in the legal page.
- [ ] **Fix mobile render scaling.** Confirm and fix the high-DPR canvas/zoom issue on retina phones and tablets.
- [ ] **Finish safe-area mobile layout.** Make every scene respect notches, home bars, small portrait screens, and touch reach.
- [ ] **Add client-side prediction.** Smooth player movement locally and reconcile with server snapshots.

### Core gameplay and systems

- [ ] **Finalize status effects.** Either implement real mechanics for all AI-visible statuses or limit combat/UI prompts to the statuses that actually do something.
- [ ] **Disable PvP capture.** The Catch action must not appear in PvP.
- [ ] **Fix PvP snapshot gaps.** Make PvP draw/advance messages send fresh team and active-monster state to both players.
- [ ] **Harden PvP identifiers.** Use non-predictable PvP/combat IDs and validate incoming IDs.
- [ ] **Decide team-heal behavior.** Teams do not never autoheal, implement a merchant that heals for free in the lobby menu.
- [ ] **Decide general items.** If non-chain items are approved, add item definitions, profile storage, chest drops, inventory UI, and use hooks. Items will only be accessible during combat. They will be available instead of fleeing or using a monster attack, items are built very simple. They have a name and a short action description. items are also AI generated. Their behavior is assessed the same way as an attack during the fight.
- [ ] **Add in-combat inventory access.** Add combat Items/Swap access after the item model is defined.

### Inventory, progression, and meta

- [ ] **Extract shared inventory logic.** Move swap, store, field, equip, vault-cap, and validation rules into one shared engine module.
- [ ] **Finish reachable inventory drag-and-drop.** Keep tap fallback, finish chain equip drag, and verify mouse/touch behavior by hand.
- [ ] **Finish inventory sort/filter/search everywhere.** MP roster sorting/search exists; apply the same behavior to the reachable inventory flow.
- [ ] **Clarify active team versus vault.** Label active slots, vault capacity, and movement between them clearly.

### UX, visual, audio, and accessibility

- [ ] **Finish UI standardization.** Route remaining UI chrome through shared theme components and remove leftover hardcoded UI styling.
- [ ] **Finish portrait combat polish.** Revisit the single-player fight scene in portrait and square-window layouts.
- [ ] **Improve void and unexplored-tile visuals.** Make map edges, void, and fogged areas read as intentional spaces instead of flat black gaps.
- [ ] **Add minimap zoom.** zoom in closer on the minimap.
- [ ] **Remove movement effects from tiles or biomes** Remove movement speed modifiers from tiles and biomes.
- [ ] **Finish chest pickup feedback.** Add single-player chest/level floating text and, if server data supports it, show what was gained.

### Server, ops, and admin

- [ ] **Prepare separate game-server deployment.** Keep combined deploy for now, but document and test the config split path.
- [ ] **Confirm allowed origins.** Set the production origin allow-list when cross-origin deployment is used.
- [ ] **Add per-IP connection caps if proxy IP behavior is confirmed.** Keep the global connection cap as the safe fallback.
- [ ] **Improve rival smoothing.** Send snapshots more often or include velocity for extrapolation.
- [ ] **Finish admin settings coverage.** Expose remaining useful gameplay knobs while keeping map-size and seed-critical constants fixed.
- [ ] **Verify model options.** Keep explicitly chosen models, but remove truly dead options that would silently fail.
- [ ] **Tighten AI combat variance if needed.** Lower combat temperature or add sanity clamps if AI-resolved turns swing too wildly.
