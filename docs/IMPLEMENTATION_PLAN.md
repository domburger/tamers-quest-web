# Tamers Quest - Implementation Plan

Last updated: 2026-06-08

## Important bullets

- **Production is the current test environment.** Run `npm run build` before pushing. Commit and push small changes directly to `master`. Log failing tests in `docs/BUGFIX_LOG.md` instead of blocking production test deploys.
- **The game is server-authoritative.** Clients should send input and render snapshots; trusted state, movement, combat, loot, and persistence belong on the server or in shared engine code.
- **Avoid duplicate single-player and multiplayer rules.** Any gameplay rule that exists in both modes should live in shared engine code and be covered by tests.
- **Combat is AI-judged with a deterministic safety net.** The fallback exists to prevent crashes, not to fully reproduce AI catch/status/element judgment.
- **Element design needs one final source of truth.** The code, prompt, engine fallback, and bestiary currently support a small fixed matchup table. Either document that as the real design or remove the table everywhere.
- **Procedural visuals remain the art pipeline.** Do not add static PNG art unless the pipeline direction changes. Monsters, tiles, player visuals, VFX, and UI styling should stay generated or code-rendered.
- **Generated content is data, not pixels.** AI creates monster data; the client renderer turns that data into visuals. Generated data should persist to the DB and flow into the bestiary/admin tools.
- **Admin settings should stay current.** Any new live gameplay knob, AI prompt, model setting, or generated asset type should be surfaced in admin if it is useful for live tuning.
- **The wiki must match mechanics.** Update `public/wiki.html` when combat, elements, catching, chains, status effects, controls, mobile behavior, or progression rules change.
- **Portrait and square play-window support are part of the shipped design.** Keep HUD and controls anchored to the square play area while allowing peripheral map context outside it.

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
- [ ] **Hide or implement PvP capture.** The Catch action must not appear in PvP unless rival capture is intentionally supported.
- [ ] **Fix PvP snapshot gaps.** Make PvP draw/advance messages send fresh team and active-monster state to both players.
- [ ] **Harden PvP identifiers.** Use non-predictable PvP/combat IDs and validate incoming IDs.
- [ ] **Tune starter chains.** Increase early chain usefulness if the starter chain still feels like one failed catch ends the run.
- [ ] **Tune early economy.** Adjust early gold rewards or chain prices if progression still stalls before the first meaningful chain upgrade.
- [ ] **Tune storm DPS.** Use the admin setting to find the right damage pressure; the current value is a balance knob, not a structural bug.
- [ ] **Decide team-heal behavior.** Either clearly surface that teams auto-heal at run start, or make injuries persist and add an explicit heal mechanic.
- [ ] **Decide water behavior.** Keep water as slow terrain with clearer visuals, or make it an impassable hazard and update map connectivity rules.
- [ ] **Add Hydra Lash area capture.** Support multi-capture targeting and queue resolution.
- [ ] **Add chain crafting.** Let players craft chains from in-run or banked materials.
- [ ] **Decide general items.** If non-chain items are approved, add item definitions, profile storage, chest drops, inventory UI, and use hooks.
- [ ] **Add in-combat inventory access.** Add combat Items/Swap access after the item model is defined.

### Inventory, progression, and meta

- [ ] **Extract shared inventory logic.** Move swap, store, field, equip, vault-cap, and validation rules into one shared engine module.
- [ ] **Finish reachable inventory drag-and-drop.** Keep tap fallback, finish chain equip drag, and verify mouse/touch behavior by hand.
- [ ] **Finish inventory sort/filter/search everywhere.** MP roster sorting/search exists; apply the same behavior to the reachable inventory flow.
- [ ] **Clarify active team versus vault.** Label active slots, vault capacity, and movement between them clearly.
- [ ] **Add online meta-upgrade UI if still missing.** The server supports buying upgrades; make sure the live player flow exposes it.
- [ ] **Add optional bulk release.** Single release works; multi-select release remains a convenience improvement.

### UX, visual, audio, and accessibility

- [ ] **Finish UI standardization.** Route remaining UI chrome through shared theme components and remove leftover hardcoded UI styling.
- [ ] **Finish portrait combat polish.** Revisit the single-player fight scene in portrait and square-window layouts.
- [ ] **Improve void and unexplored-tile visuals.** Make map edges, void, and fogged areas read as intentional spaces instead of flat black gaps.
- [ ] **Improve wall corners and map boundaries.** Add clearer boundary visuals and closed corner treatment.
- [ ] **Fix chain throw presentation.** Anchor chain orbit/throw visuals to the character and remove misleading throw-line visuals.
- [ ] **Add minimap zoom.** Support at least two zoom levels and mobile-friendly controls.
- [ ] **Show biome movement effects.** Surface the active biome and speed modifier so terrain changes feel understandable.
- [ ] **Finish chest pickup feedback.** Add single-player chest/level floating text and, if server data supports it, show what was gained.
- [ ] **Finish storm feedback.** Add optional death/wipe ETA and continue tuning safe-zone visibility.
- [ ] **Finish audio.** Add the music bed and any missing procedural SFX.
- [ ] **Adjust accessibility colors.** Fix low-contrast muted text and confusable element colors, especially air/ice and metal/psychic.
- [ ] **Check dark-vignette readability.** Make sure rivals and hazards remain visible at screen corners.
- [ ] **Create visual regression baselines.** Save reference screenshots for title, character select, lobby, run, combat, inventory, shop, results, bestiary, admin, wiki, and legal pages.
- [ ] **Consider true pixel-art rendering.** Large optional rewrite; do only after explicit design approval.

### Mobile, PWA, and performance

- [ ] **Run a device matrix audit.** Test common phones, tablets, portrait, landscape, notches, high-DPR screens, and touch controls.
- [ ] **Finish touch-target audit.** Fix any controls below comfortable touch size, especially tight inventory controls.
- [ ] **Run mobile performance audit.** Measure FPS on mid/low-end phones and tune FX/render scale as needed.
- [ ] **Run mobile input audit.** Check joystick feel, accidental taps, gestures, hardware keyboard, and gamepad behavior.
- [ ] **Run mobile network audit.** Test reconnects, backgrounding, lock-screen behavior, and flaky cellular connections.
- [ ] **Finish PWA polish.** Review install prompt, offline asset caching, iOS standalone behavior, and orientation metadata.
- [ ] **Cache static floor rendering.** Render immutable floor layers to an offscreen cache or region cache to reduce per-frame draw cost.

### Server, ops, and admin

- [ ] **Prepare separate game-server deployment.** Keep combined deploy for now, but document and test the config split path.
- [ ] **Confirm allowed origins.** Set the production origin allow-list when cross-origin deployment is used.
- [ ] **Add per-IP connection caps if proxy IP behavior is confirmed.** Keep the global connection cap as the safe fallback.
- [ ] **Improve rival smoothing.** Send snapshots more often or include velocity for extrapolation.
- [ ] **Improve projectile lag handling.** Store short position history if throw hit registration feels unfair under latency.
- [ ] **Finish admin settings coverage.** Expose remaining useful gameplay knobs while keeping map-size and seed-critical constants fixed.
- [ ] **Verify model options.** Keep explicitly chosen models, but remove truly dead options that would silently fail.
- [ ] **Tighten AI combat variance if needed.** Lower combat temperature or add sanity clamps if AI-resolved turns swing too wildly.

### Content and AI generation

- [ ] **Keep generated monsters brutal, not cute.** Preserve menacing faces, silhouettes, fangs, scars, and darker creature direction.
- [ ] **Add model palette support only if it does not break element readability.** The current element palette system should remain legible.
- [ ] **Add model animation support when the renderer is ready.** Idle and attack animation specs are generated but only useful once consumed.
- [ ] **Keep generated content persisted and reusable.** Empty pool generates; populated pool mostly reuses existing DB content.
- [ ] **Keep admin prompt/model controls live.** Prompt and model changes should remain editable without redeploy.
