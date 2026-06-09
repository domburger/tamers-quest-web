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

- [x] **Recover lost work** Check the current status of the project, check all branches and check if changes or work is missing that was commited locally or elsewhere. Check make sure that the master is up to date
  - Verified 2026-06-09: master == origin/master (0/0). No local branches ahead of master. All 57 origin/* feature branches are merged into master (verified via merge-base --is-ancestor). No stash, no dangling/uncommitted work. The `claude/zen-volhard` worktree is 923 commits *behind* master (stale ancestor, 0 ahead). Build passes, 468/468 tests green. Nothing lost; master is the consolidated source of truth.
- [~] **Unify single-player and multiplayer flow.** (claimed by agent A 2026-06-09) Make the shared lobby, inventory, shop, upgrades, roster, movement, map, and combat logic work from one shared path. Remove unreachable duplicate multiplayer management scenes after the shared path is complete. When you do this, make sure to first bring all the newest chagnes to singleplayer, and then update multiplayer.
  - **DECISION (user 2026-06-09):** the SERVER profile is the SINGLE source of truth for team/chains/upgrades/currency/owned-monsters in BOTH SP and MP — "only like this singleplayer will also be cheat proof." localStorage is demoted to session token + cosmetic prefs + onboarding flags. SP becomes online-first. So the unified path = the SERVER-backed scenes; the local-only SP management scenes become the duplicates to retire.
  - [~] **Phase A — server-first lobby foundation.** Lobby connects+joins the server on entry (both modes); reads identity/team/currency/chain from `net.state` (server profile) with a graceful "connecting/offline" state. Keeps local only as cosmetic/token cache.
  - [ ] **Phase B — route management to server-backed scenes.** Lobby Inventory/Shop/Upgrades stations open the server-backed `roster`/`onlineShop`/`onlineBaseUpgrades`; repoint their Back to the unified `lobby`; remove the unreachable `onlineLobby` and the local-only `inventory`/`shop`/`baseUpgrades` management scenes once parity is confirmed.
  - [ ] **Phase C — SP gameplay persists to server.** SP catches/gold/xp/run-results go through the server so SP progression is server-authoritative (cheat-proof). Reuse the existing server combat/round handlers where possible.
  - [ ] **Phase D — cleanup + tests + wiki.** Remove dead local-profile code paths, update tests, note SP-is-online in wiki/controls.
- [ ] **Finish sign-in UI.** Wire Google, Discord, and Tamer's Account buttons to the existing backend routes. Store returned session tokens and show clear login failure/unavailable states.
- [ ] **Verify OAuth in production.** Test Google and Discord callbacks on Railway with the live credentials and confirm account/profile linking works.
- [ ] **Finish native account UI.** Add sign-up and sign-in forms for email/password accounts. Keep anonymous play available.
- [ ] **Add password reset.** Implement the reset-token flow once an email/SMTP path is available.
- [ ] **Run account security audit.** Check token generation, login throttling, account claiming, OAuth state handling, profile linking, and user-enumeration behavior before sign-in is treated as complete.
- [ ] **Fix mobile render scaling.** Confirm and fix the high-DPR canvas/zoom issue on retina phones and tablets.
- [ ] **Finish safe-area mobile layout.** Make every scene respect notches, home bars, small portrait screens, and touch reach.
- [ ] **Add client-side prediction.** Smooth player movement locally and reconcile with server snapshots.
- [~] Add icons to the google and discord login buttons _(agent B: claimed 2026-06-09; index.html title only)_
- [ ] Make the preview of the player character in the lobby screen sharp _(deferred by agent B: lives in lobby.js, owned by agent A's SP/MP-unify work)_
- [x] Remove the weird square frame border from the ingame screen _(agent B 2026-06-09: removed the teal viewfinder frame line + L-corner reticle from `drawPlayWindow` (render/playWindow.js); only the gentle peripheral dim remains so the square reads from brightness falloff, no drawn border. Both callers use the no-arg default. Tests + build green.)_
- [ ] Implement combat as per description below
- [ ] Implement monsters as per description below

### Core gameplay and systems

- [ ] **Finalize status effects.** Either implement real mechanics for all AI-visible statuses or limit combat/UI prompts to the statuses that actually do something.
- [~] **Disable PvP capture.** _(agent B: claimed 2026-06-09)_ The Catch action must not appear in PvP.
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
- [x] **Add minimap zoom.** _(agent B 2026-06-09: the radar now cycles `MINIMAP_ZOOM_LEVELS = [1, 2, 4]` (shared in render/minimap.js via `nextMinimapZoom`) instead of a hard 1↔2 toggle — players can zoom in CLOSER (4× = quarter-map around the player). Wired in both SP `game.js` (tap/M) and MP `onlineGame.js` (tap) for parity; wiki + tests updated; build green.)_ zoom in closer on the minimap.
- [x] **Remove movement effects from tiles or biomes** _(agent B 2026-06-09: removed the per-biome `speedMult` field + the `biomeSpeedMultAt` resolver from engine/mapgen.js; both movement paths (SP game.js + server world.js tickRound) now integrate uniform `BASE_SPEED * sprint` with no terrain modifier. Biome HUD chip keeps the region name but drops the brisk/slow/steady speed cue. Wiki (Movement + Biomes) + tests updated; 467 tests + build green.)_ Remove movement speed modifiers from tiles and biomes.
- [ ] **Finish chest pickup feedback.** Add single-player chest/level floating text and, if server data supports it, show what was gained.

### Server, ops, and admin

- [ ] **Prepare separate game-server deployment.** Keep combined deploy for now, but document and test the config split path.
- [ ] **Confirm allowed origins.** Set the production origin allow-list when cross-origin deployment is used.
- [ ] **Add per-IP connection caps if proxy IP behavior is confirmed.** Keep the global connection cap as the safe fallback.
- [ ] **Improve rival smoothing.** Send snapshots more often or include velocity for extrapolation.
- [ ] **Finish admin settings coverage.** Expose remaining useful gameplay knobs while keeping map-size and seed-critical constants fixed.
- [ ] **Verify model options.** Keep explicitly chosen models, but remove truly dead options that would silently fail.
- [ ] **Tighten AI combat variance if needed.** Lower combat temperature or add sanity clamps if AI-resolved turns swing too wildly.

### Monster Generation

- Langchain is used
- All prompts and model settings can be changed in the admin panel (user and system)
- The monster generation starts with an agent that gives 2-4 words as inspiration for the monster, in the prompt it should say, "to characterize the monster"
- The monsters are then designed by a second agent that receives the inspiration in their user prompt
- This agent has a huge structured output with all the fields

Monsters should have the fields:
- Name (this is the name of this monster type in that sense, players should later also be able to name the instances of this type when they catch one)
- Attack
- Attack scaling per level
- Defense
- Defense scaling per level
- HP
- HP scaling per level
- Passive effect
- Attack 1 (all attacks in this game are a shrot title 2-3 words and a description, that description must be compatible with the ingame logic of an llm evaluating fight turns, basically, it needs to tell that agents how to act if this attack is chosen, but also this should be understandable for the player)
- Attack 2
- Attack 3
- Attack 4
- Visual Description


- Come up with a fixed exponential scale that each monster uses for XP per level
- The visual description and name are then forwarded to a builder agent
- The builder agent defines the character model of the monster
- It builds the charcter so that it can be placed anywhere in the game and most importantly in the fight screen
- Every monster has an idle animation and an attack animation
- After generation monsters should also have an empty placeholder string field for current status effects, fight jugdge llms and merchants can later influence this field, for now make it be cleared after every fight, and only be changed by in fight llm judges.

### Item Generation

The item generation works the same way as the monster generation, you can figure this out yourself.

### Fight judgement logic

An llm should have a nicely structured input that says
- What is the action that is being executed
- The llm received all relevant data (full monster descriptions and fight transcript, so that passive effects and everything can be considered)
- in a structured output the llm then has the chance to change any field from a monster, it is constrained in a way that it only says what changes, if it changes an integer field, it does it by outputting the difference, if it changes a string field, it outputs a full rewrite.
- along the edits to the monsters or player attributes, it outputs a very short string that is displayed in the game and that should give a rough idea of what happened (mostly if the attack was successful or not)
- in the output, there should also be a section with special actions, like a monster attack triggering the battle to end, insta win by some wicked condition, flee, think of anything that an attack might need to be able to trigger.