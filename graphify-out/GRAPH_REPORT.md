# Graph Report - tamers_quest_web  (2026-11-08)

## Corpus Check
- 393 files · ~527,830 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 6 file(s) not represented in the graph (top: .woff2 3, (none) 1, .webmanifest 1)

## Summary
- 2898 nodes · 8644 edges · 164 communities (99 shown, 65 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 273 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b3ab2461`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Cosmetic Skins Economy
- Title Screen & Login
- Roster Sorting & Search
- theme.js
- Round World Server Logic
- Cleanup Tracking & AI Admin Panels
- hub.js
- Auth & Login Flows
- Content Generation Core
- keybinds.js
- monster.js
- lobby.js
- HTML Monster Layer
- Admin Panels & Handlers
- Battle Stage Rendering
- htmlSanitize.js
- Procedural Monster Sprites
- Hub Buildings & Props
- Combat Parity & Resolver
- playwright
- Monster Generation Pipeline
- Package Config & Dependencies
- Biomes & Map Generation
- Net Client API
- ref_node_fs
- AI Combat Resolution
- Biome & Item AI Generation
- Account Store & Cloud Saves
- Database Persistence Layer
- Inventory & Roster Engine
- llm.js
- HTTP Server & Config
- AI Config Settings
- Account HTTP & Friends
- PvP Combat
- Canvas Runtime & Refit
- Settings & Sound
- Prompt Overrides & Tests
- character.js
- Deploy Policy & QA Docs
- Server Perf & Hub Tests
- onlineGame.js
- Economy & Progression Design
- Monster Evolution
- Battle Pass
- Dev Tools & Jira Dashboard
- Profile & Chain Schemas
- AI Cost Tracking
- Collection & Discovery
- marketplacePanel.js
- Snapshot Encoder
- Codebase Cleanup 5-Pass Tracking
- htmlModel.js
- Account Passwords & Email
- Canvas Draw Backend
- Generation Scheduling
- Net Messages & Tests
- Marketplace
- Canvas Renderer
- Canvas Object API
- gamedata.js
- CI Workflow
- Spirit Chain Rendering
- Generation Config
- gen.js
- Snapshot Decoder
- Combat & Gen Design Notes
- Network Protocol Design
- FakeClassList
- Generation Job Queue
- Combat Engine
- Items System
- Combat tab
- Batch Generation Script
- Account Model Tests
- HTML Monster Overlay
- canvasKeyboard.js
- monsterDetailHtml.js
- fightBackgrounds.js
- qa-combat.mjs
- Deployment & Security Config
- Plan & Requirements Docs
- Brand Icons & Palette
- connect
- Canvas Text Cache
- qa-cpuprof.mjs
- Railway Config
- Rate Limiting
- Auto Reload
- AI Metrics
- qa-round.mjs
- canvasRefit.test.js
- qa-touch.mjs
- qa-tour.mjs
- Monster Top-up Script
- Monster Detail Popup Spec
- Currency Icons
- Essence Checkout
- Prod Reseed Script
- Narrow Header Screenshots
- Hub Stations Screenshots
- Prod Wipe and Reseed
- qa-tutorial.mjs
- SP/MP parity — shared-engine contract (PT2-T11)
- Hub Routes Screenshot
- PvP Multiplayer Test
- Roaming Screenshot Test
- World Exploration Screenshot
- Character Select Screenshot
- Full Character Select
- Fight Screenshot Test
- Hub Station Tour
- Hub Touch Screenshot
- qa-hub.mjs
- shoot-csp.mjs
- qa-roundend.mjs
- Icon Generation
- Pool Count Script
- Combat Screenshot Test

## God Nodes (most connected - your core abstractions)
1. `hubScene()` - 140 edges
2. `onlineGameScene()` - 113 edges
3. `playwright` - 108 edges
4. `getMonsterType()` - 58 edges
5. `sfx()` - 54 edges
6. `lobbyScene()` - 52 edges
7. `handleAuthHttp()` - 52 edges
8. `rosterScene()` - 51 edges
9. `handleAdmin()` - 51 edges
10. `drawPanel()` - 50 edges

## Surprising Connections (you probably didn't know these)
- `Turn-based AI-resolved combat` --semantically_similar_to--> `AI-judged combat with deterministic crash-net`  [INFERRED] [semantically similar]
  CLAUDE.md → docs/IMPLEMENTATION_PLAN.md
- `Caller-computed live vitals contract` --references--> `xpForLevel()`  [EXTRACTED]
  docs/monster-detail-popup-spec.md → src/engine/progression.js
- `_design-tour.mjs screenshot harness` --semantically_similar_to--> `Visual-QA harness suite (tools/)`  [INFERRED] [semantically similar]
  docs/DESIGN_PASSES.md → tools/README.md
- `PARITY-1 combat resolver unification (aiTurn)` --references--> `aiTurn()`  [EXTRACTED]
  docs/SP_MP_PARITY.md → server/combat.js
- `Player-account prestige level (TQ-186)` --references--> `xpForLevel()`  [EXTRACTED]
  docs/ECONOMY.md → src/engine/progression.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Admin asset-generation pipeline: per-phase fields + prompts + schema descriptions → test gen → save/queue** — public_admin_pipeline_spec, public_admin_monster_fields, public_admin_prompt_keys, public_admin_schema_desc_keys, public_admin_generation_hub, public_admin_bulk_generation_queue, public_admin_generation_trace, server_admin [EXTRACTED 1.00]
- **Gold-only power economy (non-pay-to-win)** — docs_economy_gold, docs_economy_essence, docs_economy_non_pay_to_win, docs_economy_prospector, docs_economy_deep_vault, docs_economy_spirit_chain_upgrades [EXTRACTED 1.00]
- **Title-screen sign-in flows converge on characterSelect** — index_guest_login, index_oauth_login, index_tamers_account_login, index_returning_player_resume, index_launch_handoff, src_main [EXTRACTED 1.00]
- **Essence monetization: admin kill-switch → Paddle config → pricing checkout → legal purchase/refund policy** — public_admin_sales_kill_switch, server_paddle, public_pricing_paddle_checkout, public_pricing_essence_packs, public_legal_purchases_refund_policy, public_legal_virtual_items_no_power_sales [INFERRED 0.85]
- **AI combat judge + AI content generation pipeline** — docs_implementation_plan_ai_judged_combat_with_crash_net, docs_implementation_plan_archive_fight_judgement_v2, docs_implementation_plan_archive_monster_gen_v2_pipeline, docs_implementation_plan_archive_genattacks_as_combat_moves, docs_implementation_plan_archive_ai_generated_combat_items, docs_sp_mp_parity_parity_1_combat_resolver_unification, server_combat_aiturn [INFERRED 0.90]
- **Server-authoritative SP/MP unification flow** — docs_implementation_plan_server_authoritative, docs_implementation_plan_no_duplicate_sp_mp_rules, docs_sp_mp_parity_shared_engine_contract, docs_implementation_plan_archive_sp_mp_unify, docs_requirements_sp_server_authoritative, docs_protocol_authority_model [INFERRED 0.90]

## Communities (164 total, 65 thin omitted)

### Community 0 - "Cosmetic Skins Economy"
Cohesion: 0.10
Nodes (48): acquireLabel(), buySkin(), canBuySkin(), isSkinFree(), isSkinOwned(), skinAcquire(), ESS, FREE (+40 more)

### Community 1 - "Title Screen & Login"
Cohesion: 0.06
Nodes (63): Animated title background (rays, fog, portal, embers, wisps, fractal trees), Google AdSense script, Guest login (nickname modal), launch() → window.tqGo handoff, Top Extractors leaderboard widget, PWA / OpenGraph metadata, Returning player resume (Enter as / Log out), Scale-to-fit stage wrapper (+55 more)

### Community 2 - "Roster Sorting & Search"
Cohesion: 0.07
Nodes (59): resolveRosterDrag(), itemRarity(), nextSortMode(), searchMonsters(), SORT_LABELS, SORT_MODES, sortChainsByTier(), sortMonsters() (+51 more)

### Community 3 - "theme.js"
Cohesion: 0.07
Nodes (64): getMonsterMaxHp(), net, _colCache, drawHubPanel(), maxHpOf(), trunc(), drawMonsterIcon(), bestiaryScene() (+56 more)

### Community 4 - "Round World Server Logic"
Cohesion: 0.07
Nodes (61): saveEvolvedTypes(), saveRoundBiomes(), endPvpFor(), maybeStartPvp(), startPvp(), COMP, bumpStat(), newMonsterId() (+53 more)

### Community 5 - "Cleanup Tracking & AI Admin Panels"
Cohesion: 0.12
Nodes (29): clamp255(), computeFogMote(), computeScatter(), computeVoidMotes(), drawCollidableShade(), drawFloorEdgeShadow(), drawScatter(), drawTiles() (+21 more)

### Community 6 - "hub.js"
Cohesion: 0.07
Nodes (58): getSpiritChains(), BARK, buildCampMap(), HEAL, caughtSet(), openStationPopup(), LEAF, LEAF_DK (+50 more)

### Community 7 - "Auth & Login Flows"
Cohesion: 0.06
Nodes (50): First-login username prompt (OAuth ?new=1), Forgot password (TQ-59), OAuth login (Google / Discord), Password reset landing (/?reset=token), Provider availability probe (/auth/providers), Stay signed in (remember-me) toggle, Tamer's Account email/password sign-in/sign-up, attachStore (+42 more)

### Community 8 - "Content Generation Core"
Cohesion: 0.09
Nodes (46): allBiomeNames(), BIOME_KINDS, biomeDiversitySeed(), diversitySeed(), generateBiome(), generateItem(), generateMonster(), generateTile() (+38 more)

### Community 9 - "keybinds.js"
Cohesion: 0.19
Nodes (18): ACTION_META, ACTIONS, actionsForKey(), DEFAULT_BINDINGS, getBindings(), isAction(), isActionDown(), keysFor() (+10 more)

### Community 10 - "monster.js"
Cohesion: 0.18
Nodes (12): _artTop, artTopFrac(), drawIconEmblem(), drawMonster(), ICON_FALLBACK_PALETTE, iconTint(), _slugCache, ATTACK_DURATION (+4 more)

### Community 11 - "lobby.js"
Cohesion: 0.06
Nodes (100): loadGameData(), init(), k, accountScene(), openChangePassword(), render(), characterSelectScene(), cl() (+92 more)

### Community 12 - "HTML Monster Layer"
Cohesion: 0.18
Nodes (19): createHtmlMonsterLayer(), acquire(), clear(), destroy(), release(), sync(), HTML_LAYER_BOX, isInPlayWindow() (+11 more)

### Community 13 - "Admin Panels & Handlers"
Cohesion: 0.08
Nodes (47): AI biomes — generate & browse panel, AI items — generate & browse panel, AI monsters — browse panel, AI floor tiles — generate & browse panel, Asset Generation tab (Monsters / Items / Biomes / Tiles sub-tabs), Biome AI config fields (ai_biomeInspiration*/biomeDesigner*), Biome pipeline — config by phase (Inspiration → Designer), Bulk generation queue (TQ-492) (+39 more)

### Community 14 - "Battle Stage Rendering"
Cohesion: 0.15
Nodes (25): bandColors(), BATTLE_INTRO_DURATION, clamp01(), drawBattleStage(), drawCatchThrow(), drawChainRing(), drawCreature(), drawMotes() (+17 more)

### Community 15 - "htmlSanitize.js"
Cohesion: 0.13
Nodes (22): cache, enqueueRaster(), htmlIconImage(), rasterQueue, HTML_ALLOWED_ATTRS, ALLOWED_ATTRS, ALLOWED_CSS, ALLOWED_TAGS (+14 more)

### Community 16 - "Procedural Monster Sprites"
Cohesion: 0.14
Nodes (38): BODY_SHAPES, archetypeFor(), canvasTree(), clamp(), drawArthropod(), drawBattleMarks(), drawBeast(), drawBrute() (+30 more)

### Community 17 - "Hub Buildings & Props"
Cohesion: 0.04
Nodes (61): buildTrees(), ellip(), hubScene(), clericThanks(), closeStationPopup(), drawBarrelProp(), drawBench(), drawBuilding() (+53 more)

### Community 18 - "Combat Parity & Resolver"
Cohesion: 0.11
Nodes (38): Per-monster XP & level curve (TQ-43), advanceOrLose(), aiTurn(), applyTurnStates(), buildState(), chooseEnemyAttack(), combatTurnLimiter, CORS_ALLOW (+30 more)

### Community 19 - "playwright"
Cohesion: 0.04
Nodes (7): playwright, vp, rows, vp, vp, errs, errs

### Community 20 - "Monster Generation Pipeline"
Cohesion: 0.12
Nodes (22): ATTRIBUTES_SCHEMA, buildAttributesSchema(), buildIdeaSchema(), coerceIdea(), IDEA_SCHEMA, runGenPipeline(), STAT_KEYS, ATTACK_POOL (+14 more)

### Community 21 - "Package Config & Dependencies"
Cohesion: 0.07
Nodes (32): dependencies, compression@^1.8.1, serve-handler@^6.1.6, ws@^8.18.0, description, devDependencies, eslint@^10.4.1, globals@^17.6.0 (+24 more)

### Community 22 - "Biomes & Map Generation"
Cohesion: 0.10
Nodes (35): loadGameData(), allBiomes(), BIOME_DEFS, biomeList(), buildBiomeMonsterPools(), buildBiomePools(), builtinBiomes(), compareFullFast() (+27 more)

### Community 23 - "Net Client API"
Cohesion: 0.11
Nodes (30): createNetClient(), buyChain(), buyCosmetic(), buyUpgrade(), claimBpTier(), combatAction(), craftChain(), getRoster() (+22 more)

### Community 25 - "AI Combat Resolution"
Cohesion: 0.17
Nodes (24): aiResolveCatch(), aiResolveTurn(), attackDirective(), chatJson(), describe(), describeCatchTarget(), describeFull(), fillCombatPrompt() (+16 more)

### Community 26 - "Biome & Item AI Generation"
Cohesion: 0.13
Nodes (39): aiEnabled(), sanitizePromptText(), loadSchemaDesc(), saveSchemaDesc(), aiGenerateBiome(), buildBiomeDesignerPrompt(), buildBiomeInspirationPrompt(), clampInt() (+31 more)

### Community 27 - "Account Store & Cloud Saves"
Cohesion: 0.10
Nodes (32): Account hardening (mirror-overwrite guard, credential dedup, header-only session), Cloud saves per account, pg@^8.13.1, pg, closeDb(), deleteAccountRow(), deleteProfileRow(), initDb() (+24 more)

### Community 28 - "Database Persistence Layer"
Cohesion: 0.08
Nodes (23): initContent(), dbEnabled(), loadBiomes(), loadGroundTiles(), loadItems(), loadMarketListings(), loadMonsterTypes(), loadPrompts() (+15 more)

### Community 29 - "Inventory & Roster Engine"
Cohesion: 0.17
Nodes (26): rewardAt(), addCaughtMonster(), applyRoster(), equipChain(), nextChainId(), releaseMonster(), setChainSlots(), fullTeam() (+18 more)

### Community 30 - "llm.js"
Cohesion: 0.12
Nodes (34): aiEnabled(), anthropicChat(), chatJson(), enabledProviders(), fetchJson(), getAnthropic(), inferProvider(), isSamplingError() (+26 more)

### Community 31 - "HTTP Server & Config"
Cohesion: 0.08
Nodes (24): loadEvolvedTypes(), ALLOWED_ORIGINS, compress, CONN_MAX_PER_IP, CONN_MAX_TOTAL, connLimit, COUNTDOWN_S, CSP_POLICY (+16 more)

### Community 32 - "AI Config Settings"
Cohesion: 0.08
Nodes (18): DEFAULT_AI_CONFIG, initAiConfig(), MODEL_OPTIONS, num(), overrides, SPEC, tempOf(), loadAiConfig() (+10 more)

### Community 33 - "Account HTTP & Friends"
Cohesion: 0.21
Nodes (26): handleAccountHttp(), presenceOf(), readJsonBody(), sendJson(), serializeAccount(), serializeCharacter(), sessionOf(), writeLimiter (+18 more)

### Community 34 - "PvP Combat"
Cohesion: 0.20
Nodes (19): attacksFor(), advance(), applySwap(), clamp0(), endPvp(), handlePvpAction(), other(), resolveTurn() (+11 more)

### Community 35 - "Canvas Runtime & Refit"
Cohesion: 0.18
Nodes (11): makeCanvasRuntime(), pointerToDesign(), isTouchscreen(), makeMouse(), makeRetainedLayer(), comp(), compsToRecord(), makeCanvasShim() (+3 more)

### Community 36 - "Settings & Sound"
Cohesion: 0.14
Nodes (33): addShake(), clearShake(), setShakeEnabled(), SHAKE_MAX, shakeEnabled(), shakeOffset(), shakeTrauma(), toggleShake() (+25 more)

### Community 37 - "Prompt Overrides & Tests"
Cohesion: 0.15
Nodes (10): savePrompts(), allPrompts(), DEFAULT_PROMPTS, overrides, resetPrompts(), setPrompts(), setNavigator(), withEnv() (+2 more)

### Community 38 - "character.js"
Cohesion: 0.12
Nodes (36): anglerModel(), anubisModel(), automatonModel(), centaurModel(), CHARACTER_MODELS, _cloakDkCache, cloakModel(), corvidModel() (+28 more)

### Community 39 - "Deploy Policy & QA Docs"
Cohesion: 0.09
Nodes (11): Turn-based AI-resolved combat, npm commands (dev/server/test/build), Tamers Quest Agent Guide, _design-tour.mjs screenshot harness, DEV-only QA hooks (press 0 force-encounter), Prod ops runbooks (reseed-*, wipe-reseed-prod, topup-monsters-prod, verify-prod*, gen-batch-prod), Visual-QA harness suite (tools/), ?ws= WS override + solo-round server env (+3 more)

### Community 40 - "Server Perf & Hub Tests"
Cohesion: 0.10
Nodes (29): loadData(), loadData(), loadData(), loadData(), saveMarketListings(), join(), tick3(), activeRound() (+21 more)

### Community 41 - "onlineGame.js"
Cohesion: 0.05
Nodes (73): HUD outside the square play window (HUD-OUT), biomeNameAt(), biomeTintAt(), sprintingNow(), sprintMult(), tickStamina(), clearFx(), drawFx() (+65 more)

### Community 42 - "Economy & Progression Design"
Cohesion: 0.16
Nodes (17): Deep Vault upgrade (+25 vault cap/level), Economy (Gold TQ-42, XP TQ-43), Essence (premium, Paddle, never earned), Gold (only earned currency), Player-account prestige level (TQ-186), Prospector upgrade (+20% gold/level, max L5), Spirit-chain tier upgrades (N x 40 gold), PARITY-3 inventory engine (addCaughtMonster, applyRoster, equipChain, nextChainId) (+9 more)

### Community 43 - "Monster Evolution"
Cohesion: 0.18
Nodes (16): applyAttrEdits(), applyEvolution(), applyReplaceEdits(), buildEvolutionSchema(), buildEvolvedType(), EVOLUTION_LEVELS, EVOLUTION_MAX_GROWTH, EVOLVE_STAT_KEYS (+8 more)

### Community 44 - "Battle Pass"
Cohesion: 0.23
Nodes (20): BP_REWARD_KINDS, BP_TIERS, freeRewardFor(), isTierReached(), premiumRewardFor(), SEASON, tierForXp(), xpForTier() (+12 more)

### Community 45 - "Dev Tools & Jira Dashboard"
Cohesion: 0.09
Nodes (14): body(), DIRS, FORBIDDEN, fetchIssues(), server, DELAY, [cx, cy], deepScroll() (+6 more)

### Community 46 - "Profile & Chain Schemas"
Cohesion: 0.25
Nodes (16): getByToken(), buyChain(), craftUpgrade(), createChainInstance(), createMonsterInstance(), createPlayerProfile(), ensureChainSlots(), finalizeRunChains() (+8 more)

### Community 47 - "AI Cost Tracking"
Cohesion: 0.14
Nodes (16): @langchain/openai@^1.4.7, @langchain/openai, aiCostSnapshot(), byModel, PRICE_PER_MTOK, recordUsage(), resetAiCost(), usd() (+8 more)

### Community 48 - "Collection & Discovery"
Cohesion: 0.27
Nodes (16): caughtSpeciesSet(), newSpeciesCount(), norm(), addDiscovered(), getDiscovered(), getEncountered(), getSeenSpecies(), isDiscovered() (+8 more)

### Community 49 - "marketplacePanel.js"
Cohesion: 0.18
Nodes (22): btnR(), CUR, curPrice(), drawBrowse(), drawMarketplacePanel(), drawRowBase(), drawSell(), essence() (+14 more)

### Community 50 - "Snapshot Encoder"
Cohesion: 0.30
Nodes (9): _dec, _enc, encodeSnapshot(), wChests(), wGone(), wMonsters(), wPlayers(), wProj() (+1 more)

### Community 51 - "Codebase Cleanup 5-Pass Tracking"
Cohesion: 0.18
Nodes (5): Codebase Cleanup 5-Pass Tracking, Residual items flagged for Dominik (not changed), Five pass orderings (A-Z, Z-A, LOC desc, LOC asc, subsystem), Game Design Polish 5-Pass Tracking, Profile portrait crowding fixes

### Community 52 - "htmlModel.js"
Cohesion: 0.26
Nodes (11): buildHtmlModelSchema(), HTML_ALLOWED_CSS_PROPS, HTML_ALLOWED_TAGS, HTML_CANVAS, HTML_FORBIDDEN, HTML_MODEL_SCHEMA, HTML_SCHEMA_DESC_DEFAULTS, HTML_STATES (+3 more)

### Community 53 - "Account Passwords & Email"
Cohesion: 0.21
Nodes (10): loadData(), mockBodyReq(), mockGet(), mockIp(), hashPassword(), normalizeEmail(), validateEmail(), validatePassword() (+2 more)

### Community 54 - "Canvas Draw Backend"
Cohesion: 0.28
Nodes (18): beginShadow(), cDrawCircle(), cDrawEllipse(), cDrawLine(), cDrawPoly(), cDrawRect(), cDrawText(), designWidthFor() (+10 more)

### Community 55 - "Generation Scheduling"
Cohesion: 0.19
Nodes (14): loadGenSchedule(), saveGenSchedule(), activeConfig(), allGenSchedule(), computeDue(), DEFAULT_GEN_SCHEDULE, GEN_ASSETS, getGenSchedule() (+6 more)

### Community 56 - "Net Messages & Tests"
Cohesion: 0.16
Nodes (8): PvP hardening (no capture, CSPRNG combat ids, fresh team snapshots), applyDelta(), applyMessage(), browserStorage(), DEFAULT_URL, memStorage(), FakeWS, TOKEN_KEY

### Community 57 - "Marketplace"
Cohesion: 0.26
Nodes (12): buyListing(), cancelListing(), findInVault(), handleMarketMessage(), intAmt(), listingView(), listMonster(), MARKET_FEE_PCT (+4 more)

### Community 58 - "Canvas Renderer"
Cohesion: 0.21
Nodes (5): anchorOrigin(), ANCHORS, cDrawSprite(), _rgbCache, toRGB()

### Community 60 - "gamedata.js"
Cohesion: 0.08
Nodes (30): adminStats(), generationStats(), TUNABLES, firstAttack(), handleHttp(), topProfiles(), attacks, chains (+22 more)

### Community 61 - "CI Workflow"
Cohesion: 0.13
Nodes (14): runs-on, steps, jobs, build-test, name, on, pull_request, push (+6 more)

### Community 62 - "Spirit Chain Rendering"
Cohesion: 0.28
Nodes (7): drawCaptureAnimation(), drawCaptureFail(), drawChainBreak(), drawChainImpact(), drawLinkRing(), drawSpiritChainModel(), drawSpiritChainProjectile()

### Community 63 - "Generation Config"
Cohesion: 0.26
Nodes (11): loadGenConfig(), saveGenConfig(), allGenConfig(), DEFAULT_GEN_CONFIG, getGenConfig(), initGenConfig(), overrides, roundComposition() (+3 more)

### Community 64 - "gen.js"
Cohesion: 0.25
Nodes (10): assignAttacks(), normalizeGenAttacks(), normalizeGeneratedMonster(), num(), pickReuseOrGenerate(), shuffle(), STAT_KEYS, STAT_KEYS (+2 more)

### Community 65 - "Snapshot Decoder"
Cohesion: 0.41
Nodes (7): decodeSnapshot(), rChests(), Reader, rGone(), rMonsters(), rPlayers(), rProj()

### Community 66 - "Combat & Gen Design Notes"
Cohesion: 0.25
Nodes (7): AI-generated combat items (use instead of attack/flee), Biome/tile movement speed modifiers removed, combatMaxTurnDamageFrac variance clamp, Structured Fight-Judgement judge v2 (combatJudgeV2), Implementation Plan Archive (completed work), Monster generation v2 multi-agent pipeline (genPipeline), Field inventory (7 stats in order, abilities ≤4, passive/active, lore)

### Community 67 - "Network Protocol Design"
Cohesion: 0.18
Nodes (8): Client-side movement prediction + reconciliation, Client→server messages (join, queue, unqueue, input, combatAction, ping), Instanced turn-based combat over the wire (Q1/Q3), Network Protocol (implemented), Server→client messages (welcome, queued, matchFound, roundStart, snapshot, combat*, extracted, died, pong, error), Session lifecycle (join→welcome→queue→matchFound→roundStart→snapshot/combat→extracted|died), Snapshot message + area-of-interest filtering, WebSocket JSON envelope {t, ...}

### Community 68 - "FakeClassList"
Cohesion: 0.17
Nodes (3): FakeClassList, FakeEl, withFakeDom()

### Community 69 - "Generation Job Queue"
Cohesion: 0.26
Nodes (9): clampConc(), genName(), makeGenQueue(), nextJob(), pump(), record(), drain(), tick() (+1 more)

### Community 70 - "Combat Engine"
Cohesion: 0.25
Nodes (5): applyStatusTick(), isCanonical(), performAttack(), resolveTurn(), STATUS_ALIASES

### Community 71 - "Items System"
Cohesion: 0.42
Nodes (7): itemCategory(), itemCombatDescription(), itemEffectText(), MAG, RARITIES, RARITY_DROP_WEIGHT, rollItemFromPool()

### Community 72 - "Combat tab"
Cohesion: 0.24
Nodes (11): Capture (spirit-chain) judge prompt panel, Combat judge prompts panel (v1 absolute / v2 structured), Combat tab, Game tab, Generation schedule panel (TQ-369), Live ops panel (stats, generation indicator, API cost, fight-agent metrics), Prompt override keys (genIdea*/genAttributes*/genModel*/item*/biome*/tile*/combat*/catch*), Round composition & generation panel (TQ-363/364) (+3 more)

### Community 73 - "Batch Generation Script"
Cohesion: 0.18
Nodes (9): ARCHETYPES, BASE, BIOMES, count(), ELEMENTS, hdr, N, req() (+1 more)

### Community 74 - "Account Model Tests"
Cohesion: 0.23
Nodes (14): acct(), accountAttachExistingCharacter(), accountCount(), createAccount(), createAccountRecord(), createProfile(), ensureAccountForProfile(), findAccountByEmail() (+6 more)

### Community 75 - "HTML Monster Overlay"
Cohesion: 0.25
Nodes (11): warmMonsterSprites(), clipInset(), createHtmlMonsterOverlay(), sanitizedModel(), sync(), syncInner(), usesDom(), motionState() (+3 more)

### Community 76 - "canvasKeyboard.js"
Cohesion: 0.25
Nodes (5): DOM_KEY_TO_TOKEN, domKeyToken(), makeKeyboard(), NAME_TO_TOKEN, normalizeKeyName()

### Community 77 - "monsterDetailHtml.js"
Cohesion: 0.31
Nodes (9): armTtl(), ensureMount(), nowMs(), _resetDetailHtml(), sanCache, sanitizedModel(), syncDetailHtml(), fakeK (+1 more)

### Community 78 - "fightBackgrounds.js"
Cohesion: 0.29
Nodes (8): accentKey(), cache, djb2(), FIGHT_BG_COUNT, fightBackground(), fightThemeIndex(), ORBS, themeHtml()

### Community 79 - "qa-combat.mjs"
Cohesion: 0.57
Nodes (6): fight(), shot(), sleep(), st(), vp, walkUntilCombat()

### Community 80 - "Deployment & Security Config"
Cohesion: 0.29
Nodes (7): ALLOWED_ORIGINS allow-list, Deployment, VITE_SERVER_URL client override, Account security audit fixes, Per-IP connection cap (CONN_MAX_PER_IP), Login system review + 3 shipped gaps (username prompt, login indicator, profile page), Optional ops (rotate secrets, ALLOWED_ORIGINS, imprint contact)

### Community 81 - "Plan & Requirements Docs"
Cohesion: 0.29
Nodes (5): Implementation Plan (active), Password reset / native-account email (DEFERRED by user), Open questions Q10-Q13 + binary encoding, Email/SMTP provider needed for password reset, Requirements — what Dominik must do/decide

### Community 82 - "Brand Icons & Palette"
Cohesion: 0.61
Nodes (7): Apple Touch Icon (180px hooded spirit-tamer), PWA Icon 192 (hooded spirit-tamer, ember on charcoal), PWA Icon 512 (hooded spirit-tamer, ember on charcoal), App Icon SVG (vector master, 512 viewBox), Ember-on-Charcoal Brand Palette (#F0533D / #FFB199 rim on #14110F-#050505 base), Hooded Spirit-Tamer Mascot (shadowed face, glowing ember eyes), Spirit-Chain Ring Brand Mark (8-bead ember ring)

### Community 83 - "connect"
Cohesion: 0.60
Nodes (5): close(), connect(), emit(), scheduleReconnect(), stopReconnect()

### Community 84 - "Canvas Text Cache"
Cohesion: 0.36
Nodes (4): textAlignFor(), textBaselineFor(), bake(), makeLabelCache()

### Community 85 - "qa-cpuprof.mjs"
Cohesion: 0.40
Nodes (3): byId, rows, self

### Community 86 - "Railway Config"
Cohesion: 0.17
Nodes (9): Required Railway env vars, PARITY-1 combat resolver unification (aiTurn), build, builder, deploy, restartPolicyMaxRetries, restartPolicyType, startCommand (+1 more)

### Community 87 - "Rate Limiting"
Cohesion: 0.43
Nodes (6): clientIp(), createBucket(), createConnLimiter(), createIpRateLimiter(), createViolationTracker(), TRUSTED_PROXY_HOPS

### Community 88 - "Auto Reload"
Cohesion: 0.61
Nodes (6): currentBundleHash(), extractBundleHash(), fetchLatestHash(), initAutoReload(), isNewVersion(), showReloadPill()

### Community 89 - "AI Metrics"
Cohesion: 0.48
Nodes (5): aiMetricsSnapshot(), m, recordTurn(), resetAiMetrics(), round3()

### Community 91 - "canvasRefit.test.js"
Cohesion: 0.15
Nodes (8): DEFAULT_GAMEPLAY_SCENES, isTextInputFocused(), makeRefitter(), relayoutScenes(), makeSceneManager(), leave(), recordSceneError(), k

### Community 94 - "Monster Top-up Script"
Cohesion: 0.33
Nodes (6): BASE, count(), hdr, req(), TARGET, THEMES

### Community 95 - "Monster Detail Popup Spec"
Cohesion: 0.50
Nodes (3): measureMonsterDetail / drawMonsterDetail API, Standardized Monster-Detail Popup spec (TQ-122), Responsive sizing (w=min(560, vw-24); narrow <470)

### Community 96 - "Currency Icons"
Cohesion: 0.53
Nodes (3): darken(), drawCurrencyIcon(), lighten()

### Community 97 - "Essence Checkout"
Cohesion: 0.67
Nodes (5): loadEssenceConfig(), loadScript(), openEssenceCheckout(), preloadEssenceCheckout(), sessionToken()

### Community 98 - "Prod Reseed Script"
Cohesion: 0.33
Nodes (4): BASE, COUNT, hdr, THEMES

### Community 99 - "Narrow Header Screenshots"
Cohesion: 0.33
Nodes (3): N, targets, W

### Community 101 - "Prod Wipe and Reseed"
Cohesion: 0.33
Nodes (4): BASE, COUNT, hdr, THEMES

### Community 103 - "SP/MP parity — shared-engine contract (PT2-T11)"
Cohesion: 0.24
Nodes (6): queueSolo (SP = instant private 1-player server round), SP/MP unify (Phases A-D), PARITY-6 parity snapshot tests (identical inputs → identical outputs), SP/MP parity — shared-engine contract (PT2-T11), SP in-process server stub mirroring handleMessage, public/wiki.html

### Community 125 - "Character Select Screenshot"
Cohesion: 0.83
Nodes (3): run(), shot(), sleep()

### Community 131 - "Hub Touch Screenshot"
Cohesion: 0.83
Nodes (3): shot(), sleep(), touchHold()

## Ambiguous Edges - Review These
- `Title Screen (index.html)` → `AI monsters — browse panel`  [AMBIGUOUS]
  public/admin.html · relation: references
- `Returning player resume (Enter as / Log out)` → `Cookie & Storage Notice (localStorage keys)`  [AMBIGUOUS]
  public/legal.html · relation: conceptually_related_to
- `DEV-only QA hooks (press 0 force-encounter)` → `Live combat capture deferred (paid AI cost)`  [AMBIGUOUS]
  tools/README.md · relation: conceptually_related_to

## Knowledge Gaps
- **14 isolated node(s):** `Animated title background (rays, fog, portal, embers, wisps, fractal trees)`, `PWA / OpenGraph metadata`, `Scale-to-fit stage wrapper`, `Collapsible admin sections (TQ-222) + Collapse all`, `Monochrome admin theme (TQ-212)` (+9 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 785 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **65 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `hubScene()` connect `Hub Buildings & Props` to `Cosmetic Skins Economy`, `theme.js`, `Settings & Sound`, `Cleanup Tracking & AI Admin Panels`, `hub.js`, `onlineGame.js`, `keybinds.js`, `lobby.js`, `Battle Pass`, `marketplacePanel.js`, `Combat Parity & Resolver`, `Biomes & Map Generation`, `Inventory & Roster Engine`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **What connects `Animated title background (rays, fog, portal, embers, wisps, fractal trees)`, `PWA / OpenGraph metadata`, `Scale-to-fit stage wrapper` to the rest of the system?**
  _14 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Cosmetic Skins Economy` be split into smaller, more focused modules?**
  _Cohesion score 0.102843315184513 - nodes in this community are weakly interconnected._
- **Why does `playwright` connect `playwright` to `Equipment Screenshot Test`, `Fight Screenshot Test`, `Hub Station Tour`, `Hub Touch Screenshot`, `qa-hub.mjs`, `Results Screen Screenshot`, `Single-Player Screenshot`, `shoot-csp.mjs`, `qa-roundend.mjs`, `Title Screen Screenshot`, `shoot-bestiary-scroll.mjs`, `Icon Generation`, `Account Screenshot`, `Account Form Screenshot`, `Bestiary Detail Screenshot`, `Narrow Bestiary Screenshot`, `Big Values Screenshot`, `Combat Screenshot Test`, `Connection Overlay Screenshot`, `Entry Flow Screenshot`, `Package Config & Dependencies`, `shoot-charcreate.mjs`, `Hub Screenshot Test`, `ref_node_fs`, `shoot-cosmetics-char.mjs`, `Inventory Tabs Screenshot`, `Pause Screenshot Test`, `Authed Profile Screenshot`, `shoot-roster-inspect.mjs`, `shoot-roster-tabs.mjs`, `shoot-shop-narrow.mjs`, `shoot-spritescan.mjs`, `Square Aspect Screenshot`, `shoot-teamhp.mjs`, `shoot-timewarn.mjs`, `Walk Screenshot Test`, `Deploy Policy & QA Docs`, `Dev Tools & Jira Dashboard`, `qa-combat.mjs`, `qa-cpuprof.mjs`, `qa-round.mjs`, `qa-touch.mjs`, `qa-tour.mjs`, `Narrow Header Screenshots`, `Hub Stations Screenshots`, `qa-tutorial.mjs`, `Chest Screenshot Test`, `Chest Open Screenshot`, `Compass Screenshot Test`, `Danger Arrow Screenshot`, `Enter Cave Test`, `Hub Routes Screenshot`, `Items Screenshot Test`, `Kill Feed Screenshot`, `Onboarding Screenshot`, `PvP Multiplayer Test`, `Resize Screenshot Test`, `Rival Screenshot Test`, `Rival Models Screenshot`, `Roaming Screenshot Test`, `Square Window Screenshot`, `Storm Portal Screenshot`, `Vault Screenshot Test`, `World Exploration Screenshot`, `World Portrait Screenshot`, `Battle Screenshot Test`, `Character Cosmetics Screenshot`, `Character Select Screenshot`, `Full Character Select`, `Connection State Screenshot`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Should `Title Screen & Login` be split into smaller, more focused modules?**
  _Cohesion score 0.058823529411764705 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Title Screen (index.html)` and `AI monsters — browse panel`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `Returning player resume (Enter as / Log out)` and `Cookie & Storage Notice (localStorage keys)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._