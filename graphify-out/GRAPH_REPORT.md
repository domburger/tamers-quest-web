# Graph Report - tamers_quest_web  (2026-11-08)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 2772 nodes · 8387 edges · 164 communities (103 shown, 61 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 271 edges (avg confidence: 0.85)
- Token cost: 86,947 input · 2,217 output

## Graph Freshness
- Built from commit: `1793107b`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Cosmetic Skins Economy
- Title Screen & Login
- Roster Sorting & Search
- Character Skins & Bestiary
- Round World Server Logic
- Cleanup Tracking & AI Admin Panels
- Hub Decor & Profile
- Auth & Login Flows
- Content Generation Core
- Keyboard Input Handling
- Monster Stats Data
- Account & Character Select
- HTML Monster Layer
- Admin Panels & Handlers
- Battle Stage Rendering
- HTML Model Schema
- Procedural Monster Sprites
- Hub Buildings & Props
- Combat Parity & Resolver
- Playwright Screenshot Harnesses
- Monster Generation Pipeline
- Package Config & Dependencies
- Biomes & Map Generation
- Net Client API
- AI Combat Resolution
- Biome & Item AI Generation
- Account Store & Cloud Saves
- Database Persistence Layer
- Inventory & Roster Engine
- Lobby Scene & Menus
- HTTP Server & Config
- AI Config Settings
- Account HTTP & Friends
- PvP Combat
- Canvas Runtime & Refit
- Settings & Sound
- Prompt Overrides & Tests
- Game Boot & Storage
- Deploy Policy & QA Docs
- Server Perf & Hub Tests
- Online Game HUD
- Economy & Progression Design
- Monster Evolution
- Battle Pass
- Dev Tools & Jira Dashboard
- Profile & Chain Schemas
- AI Cost Tracking
- Collection & Discovery
- Bestiary Panel
- Snapshot Encoder
- HUD Layout & Design Rules
- Game Data Loading
- Account Passwords & Email
- Canvas Draw Backend
- Generation Scheduling
- Net Messages & Tests
- Marketplace
- Canvas Renderer
- Canvas Object API
- Game Data Registry
- CI Workflow
- Spirit Chain Rendering
- Generation Config
- Shop Panel
- Snapshot Decoder
- Combat & Gen Design Notes
- Network Protocol Design
- Visual Effects System
- Generation Job Queue
- Combat Engine
- Items System
- Portal & Healer Panels
- Batch Generation Script
- Account Model Tests
- HTML Monster Overlay
- Portal Rendering
- Lobby Input Handling
- Station Popup Shell
- Theme Tests
- Deployment & Security Config
- Plan & Requirements Docs
- Brand Icons & Palette
- Account Endpoint Tests
- Canvas Text Cache
- Forest Floor Rendering
- Railway Config
- Rate Limiting
- Auto Reload
- AI Metrics
- Canvas Mouse Input
- Canvas Scene Manager
- Minimap
- Title Gamepad
- Monster Top-up Script
- Monster Detail Popup Spec
- Currency Icons
- Essence Checkout
- Prod Reseed Script
- Narrow Header Screenshots
- Hub Stations Screenshots
- Prod Wipe and Reseed
- Turn-Based Combat Docs
- Solo/Multiplayer Unification
- Hub Routes Screenshot
- PvP Multiplayer Test
- Roaming Screenshot Test
- World Exploration Screenshot
- Character Select Screenshot
- Full Character Select
- Fight Screenshot Test
- Hub Station Tour
- Hub Touch Screenshot
- Menu Screenshot Test
- Ultrawide Screenshot Test
- Icon Generation
- Pool Count Script
- Combat Screenshot Test

## God Nodes (most connected - your core abstractions)
1. `hubScene()` - 140 edges
2. `onlineGameScene()` - 107 edges
3. `playwright` - 93 edges
4. `getMonsterType()` - 58 edges
5. `sfx()` - 54 edges
6. `lobbyScene()` - 53 edges
7. `handleAuthHttp()` - 52 edges
8. `handleAdmin()` - 51 edges
9. `rosterScene()` - 50 edges
10. `openStationPopup()` - 49 edges

## Surprising Connections (you probably didn't know these)
- `Caller-computed live vitals contract` --references--> `xpForLevel()`  [EXTRACTED]
  docs/monster-detail-popup-spec.md → src/engine/progression.js
- `Turn-based AI-resolved combat` --semantically_similar_to--> `AI-judged combat with deterministic crash-net`  [INFERRED] [semantically similar]
  CLAUDE.md → docs/IMPLEMENTATION_PLAN.md
- `_design-tour.mjs screenshot harness` --semantically_similar_to--> `Visual-QA harness suite (tools/)`  [INFERRED] [semantically similar]
  docs/DESIGN_PASSES.md → tools/README.md
- `Per-monster XP & level curve (TQ-43)` --references--> `xpForLevel()`  [EXTRACTED]
  docs/ECONOMY.md → src/engine/progression.js
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

## Communities (164 total, 61 thin omitted)

### Community 0 - "Cosmetic Skins Economy"
Cohesion: 0.06
Nodes (72): acquireLabel(), buySkin(), canBuySkin(), isSkinFree(), isSkinOwned(), skinAcquire(), ESS, FREE (+64 more)

### Community 1 - "Title Screen & Login"
Cohesion: 0.05
Nodes (72): Animated title background (rays, fog, portal, embers, wisps, fractal trees), Google AdSense script, Guest login (nickname modal), launch() → window.tqGo handoff, Top Extractors leaderboard widget, PWA / OpenGraph metadata, Returning player resume (Enter as / Log out), Scale-to-fit stage wrapper (+64 more)

### Community 2 - "Roster Sorting & Search"
Cohesion: 0.07
Nodes (55): getSpiritChain(), nextSortMode(), searchMonsters(), SORT_LABELS, SORT_MODES, sortChainsByTier(), sortMonsters(), list (+47 more)

### Community 3 - "Character Skins & Bestiary"
Cohesion: 0.10
Nodes (50): biomeNameAt(), net, drawCharacter(), getCharacterSkin(), getEquippedCharacterSkinId(), bestiaryScene(), cosmeticsScene(), drawBigPreview() (+42 more)

### Community 4 - "Round World Server Logic"
Cohesion: 0.07
Nodes (55): saveEvolvedTypes(), saveRoundBiomes(), processEvolutions(), endPvpFor(), COMP, newMonsterId(), broadcastToRound(), buildRoundBiomeSet() (+47 more)

### Community 5 - "Cleanup Tracking & AI Admin Panels"
Cohesion: 0.06
Nodes (52): Codebase Cleanup 5-Pass Tracking, Residual items flagged for Dominik (not changed), Five pass orderings (A-Z, Z-A, LOC desc, LOC asc, subsystem), AI biomes — generate & browse panel, AI items — generate & browse panel, AI monsters — browse panel, AI floor tiles — generate & browse panel, Asset Generation tab (Monsters / Items / Biomes / Tiles sub-tabs) (+44 more)

### Community 6 - "Hub Decor & Profile"
Cohesion: 0.07
Nodes (53): Profile portrait crowding fixes, xpForLevel(), BARK, HEAL, LEAF, LEAF_DK, LEAF_LT, LOBES (+45 more)

### Community 7 - "Auth & Login Flows"
Cohesion: 0.07
Nodes (47): First-login username prompt (OAuth ?new=1), Forgot password (TQ-59), OAuth login (Google / Discord), Password reset landing (/?reset=token), Provider availability probe (/auth/providers), Tamer's Account email/password sign-in/sign-up, attachStore, authWriteLimiter (+39 more)

### Community 8 - "Content Generation Core"
Cohesion: 0.08
Nodes (50): allBiomeNames(), BIOME_KINDS, biomeDiversitySeed(), diversitySeed(), generateBiome(), generateItem(), generateMonster(), generateTile() (+42 more)

### Community 9 - "Keyboard Input Handling"
Cohesion: 0.08
Nodes (38): DOM_KEY_TO_TOKEN, domKeyToken(), makeKeyboard(), NAME_TO_TOKEN, normalizeKeyName(), addShake(), clearShake(), setShakeEnabled() (+30 more)

### Community 10 - "Monster Stats Data"
Cohesion: 0.09
Nodes (41): getMonsterType(), calcStat(), FALLBACK, fin(), getMonsterMaxHp(), getMonsterStats(), STAT_FIELDS, STAT_KEYS (+33 more)

### Community 11 - "Account & Character Select"
Cohesion: 0.16
Nodes (44): getEquippedCharacterSkin(), accountScene(), openChangePassword(), render(), characterSelectScene(), cl(), confirmCharacter(), drawBottomActions() (+36 more)

### Community 12 - "HTML Monster Layer"
Cohesion: 0.08
Nodes (31): createHtmlMonsterLayer(), acquire(), clear(), destroy(), release(), sync(), HTML_LAYER_BOX, isInPlayWindow() (+23 more)

### Community 13 - "Admin Panels & Handlers"
Cohesion: 0.09
Nodes (38): Fight-judge trace panel (TQ-491), Game tab, Generation schedule panel (TQ-369), Generation trace panel (TQ-331), Round composition & generation panel (TQ-363/364), adminConfig(), adminStats(), applyConfig() (+30 more)

### Community 14 - "Battle Stage Rendering"
Cohesion: 0.09
Nodes (38): bandColors(), BATTLE_INTRO_DURATION, clamp01(), drawBattleStage(), drawCatchThrow(), drawChainRing(), drawCreature(), drawMotes() (+30 more)

### Community 15 - "HTML Model Schema"
Cohesion: 0.11
Nodes (33): rasterizeHtmlModel(), coerceHtmlModel(), HTML_ALLOWED_ATTRS, HTML_ALLOWED_CSS_PROPS, HTML_ALLOWED_TAGS, HTML_CANVAS, HTML_FORBIDDEN, HTML_MODEL_SCHEMA (+25 more)

### Community 16 - "Procedural Monster Sprites"
Cohesion: 0.14
Nodes (38): BODY_SHAPES, archetypeFor(), canvasTree(), clamp(), drawArthropod(), drawBattleMarks(), drawBeast(), drawBrute() (+30 more)

### Community 17 - "Hub Buildings & Props"
Cohesion: 0.07
Nodes (25): buildCampMap(), hubScene(), drawBarrelProp(), drawBench(), drawBuilding(), drawBuildingSign(), drawCavePortal(), drawCrateProp() (+17 more)

### Community 18 - "Combat Parity & Resolver"
Cohesion: 0.10
Nodes (35): Per-monster XP & level curve (TQ-43), PARITY-1 combat resolver unification (aiTurn), PARITY-6 parity snapshot tests (identical inputs → identical outputs), SP/MP parity — shared-engine contract (PT2-T11), advanceOrLose(), aiTurn(), applyTurnStates(), buildState() (+27 more)

### Community 19 - "Playwright Screenshot Harnesses"
Cohesion: 0.05
Nodes (4): playwright, violations, errs, errs

### Community 20 - "Monster Generation Pipeline"
Cohesion: 0.10
Nodes (28): assignAttacks(), normalizeGenAttacks(), normalizeGeneratedMonster(), num(), pickReuseOrGenerate(), shuffle(), STAT_KEYS, STAT_KEYS (+20 more)

### Community 21 - "Package Config & Dependencies"
Cohesion: 0.06
Nodes (35): dependencies, compression@^1.8.1, pg@^8.13.1, serve-handler@^6.1.6, ws@^8.18.0, description, devDependencies, eslint@^10.4.1 (+27 more)

### Community 22 - "Biomes & Map Generation"
Cohesion: 0.11
Nodes (35): getBiomes(), getMonsterTypes(), allBiomes(), BIOME_DEFS, biomeList(), buildBiomeMonsterPools(), buildBiomePools(), builtinBiomes() (+27 more)

### Community 23 - "Net Client API"
Cohesion: 0.10
Nodes (35): createNetClient(), buyChain(), buyCosmetic(), buyUpgrade(), claimBpTier(), close(), combatAction(), connect() (+27 more)

### Community 25 - "AI Combat Resolution"
Cohesion: 0.12
Nodes (30): aiResolveCatch(), aiResolveTurn(), attackDirective(), chatJson(), describe(), describeCatchTarget(), describeFull(), fillCombatPrompt() (+22 more)

### Community 26 - "Biome & Item AI Generation"
Cohesion: 0.17
Nodes (28): sanitizePromptText(), aiGenerateBiome(), buildBiomeDesignerPrompt(), buildBiomeInspirationPrompt(), clampInt(), clampNum(), normalizeGeneratedBiome(), rgb() (+20 more)

### Community 27 - "Account Store & Cloud Saves"
Cohesion: 0.11
Nodes (32): Account hardening (mirror-overwrite guard, credential dedup, header-only session), Cloud saves per account, closeDb(), deleteAccountRow(), deleteProfileRow(), loadAllAccounts(), loadAllProfiles(), upsertAccounts() (+24 more)

### Community 28 - "Database Persistence Layer"
Cohesion: 0.07
Nodes (25): deleteMonsterType(), loadEvolvedTypes(), loadMarketListings(), loadPrompts(), loadRoundBiomes(), loadSchemaDesc(), loadSettings(), saveAiConfig() (+17 more)

### Community 29 - "Inventory & Roster Engine"
Cohesion: 0.16
Nodes (29): endCombat(), rewardAt(), addCaughtMonster(), applyRoster(), equipChain(), loseRunTeam(), nextChainId(), releaseMonster() (+21 more)

### Community 30 - "Lobby Scene & Menus"
Cohesion: 0.17
Nodes (25): lobbyScene(), clearNet(), closeOverlay(), dim(), establishSession(), healNow(), nick(), oLabel() (+17 more)

### Community 31 - "HTTP Server & Config"
Cohesion: 0.08
Nodes (27): ALLOWED_ORIGINS, compress, CONN_MAX_PER_IP, CONN_MAX_TOTAL, connLimit, COUNTDOWN_S, CSP_POLICY, DIST (+19 more)

### Community 32 - "AI Config Settings"
Cohesion: 0.08
Nodes (18): DEFAULT_AI_CONFIG, initAiConfig(), MODEL_OPTIONS, num(), overrides, SPEC, tempOf(), loadAiConfig() (+10 more)

### Community 33 - "Account HTTP & Friends"
Cohesion: 0.22
Nodes (26): handleAccountHttp(), presenceOf(), readJsonBody(), sendJson(), serializeAccount(), serializeCharacter(), sessionOf(), writeLimiter (+18 more)

### Community 34 - "PvP Combat"
Cohesion: 0.19
Nodes (22): attacksFor(), advance(), applySwap(), clamp0(), endPvp(), handlePvpAction(), maybeStartPvp(), other() (+14 more)

### Community 35 - "Canvas Runtime & Refit"
Cohesion: 0.13
Nodes (13): makeCanvasRuntime(), DEFAULT_GAMEPLAY_SCENES, isTextInputFocused(), makeRefitter(), relayoutScenes(), makeRetainedLayer(), comp(), compsToRecord() (+5 more)

### Community 36 - "Settings & Sound"
Cohesion: 0.19
Nodes (21): interact(), navActivate(), openAcctMenu(), settingsScene(), drawRmBtn(), drawSoundBtn(), drawVolCtl(), step() (+13 more)

### Community 37 - "Prompt Overrides & Tests"
Cohesion: 0.15
Nodes (9): savePrompts(), allPrompts(), DEFAULT_PROMPTS, overrides, resetPrompts(), setPrompts(), setNavigator(), withEnv() (+1 more)

### Community 38 - "Game Boot & Storage"
Cohesion: 0.22
Nodes (22): loadGameData(), init(), k, warmMonsterSprites(), startScene(), clearGuestCharacters(), createCharacter(), deleteCharacter() (+14 more)

### Community 39 - "Deploy Policy & QA Docs"
Cohesion: 0.10
Nodes (9): _design-tour.mjs screenshot harness, Game Design Polish 5-Pass Tracking, DEV-only QA hooks (press 0 force-encounter), Prod ops runbooks (reseed-*, wipe-reseed-prod, topup-monsters-prod, verify-prod*, gen-batch-prod), Visual-QA harness suite (tools/), ?ws= WS override + solo-round server env, load(), stations (+1 more)

### Community 40 - "Server Perf & Hub Tests"
Cohesion: 0.15
Nodes (19): saveMarketListings(), join(), tick3(), activeRound(), captureSnapshots(), loadData(), sleep(), broadcastHub() (+11 more)

### Community 41 - "Online Game HUD"
Cohesion: 0.14
Nodes (21): biomeTintAt(), onlineGameScene(), benchList(), buildMinimap(), chainHudRect(), combatButtons(), cycleChain(), drawChainHud() (+13 more)

### Community 42 - "Economy & Progression Design"
Cohesion: 0.16
Nodes (18): Deep Vault upgrade (+25 vault cap/level), Economy (Gold TQ-42, XP TQ-43), Essence (premium, Paddle, never earned), Gold (only earned currency), Player-account prestige level (TQ-186), Prospector upgrade (+20% gold/level, max L5), Spirit-chain tier upgrades (N x 40 gold), PARITY-3 inventory engine (addCaughtMonster, applyRoster, equipChain, nextChainId) (+10 more)

### Community 43 - "Monster Evolution"
Cohesion: 0.19
Nodes (15): aiEnabled(), applyAttrEdits(), applyEvolution(), applyReplaceEdits(), buildEvolutionSchema(), buildEvolvedType(), EVOLUTION_LEVELS, EVOLUTION_MAX_GROWTH (+7 more)

### Community 44 - "Battle Pass"
Cohesion: 0.23
Nodes (20): BP_REWARD_KINDS, BP_TIERS, freeRewardFor(), isTierReached(), premiumRewardFor(), SEASON, tierForXp(), xpForTier() (+12 more)

### Community 45 - "Dev Tools & Jira Dashboard"
Cohesion: 0.11
Nodes (12): DIRS, FORBIDDEN, fetchIssues(), server, [cx, cy], deepScroll(), designW, ROOT (+4 more)

### Community 46 - "Profile & Chain Schemas"
Cohesion: 0.24
Nodes (16): consumeChainCharge(), buyChain(), craftUpgrade(), createChainInstance(), createMonsterInstance(), createPlayerProfile(), ensureChainSlots(), finalizeRunChains() (+8 more)

### Community 47 - "AI Cost Tracking"
Cohesion: 0.14
Nodes (16): @langchain/openai@^1.4.7, @langchain/openai, aiCostSnapshot(), byModel, PRICE_PER_MTOK, recordUsage(), resetAiCost(), usd() (+8 more)

### Community 48 - "Collection & Discovery"
Cohesion: 0.27
Nodes (16): caughtSpeciesSet(), newSpeciesCount(), norm(), addDiscovered(), getDiscovered(), getEncountered(), getSeenSpecies(), isDiscovered() (+8 more)

### Community 49 - "Bestiary Panel"
Cohesion: 0.14
Nodes (18): caughtSet(), openStationPopup(), battlePassPanelScroll(), bestiaryPanelFocusables(), bestiaryPanelScroll(), bestiaryPanelState(), bestiaryPanelTap(), drawBestiaryPanel() (+10 more)

### Community 50 - "Snapshot Encoder"
Cohesion: 0.30
Nodes (9): _dec, _enc, encodeSnapshot(), wChests(), wGone(), wMonsters(), wPlayers(), wProj() (+1 more)

### Community 51 - "HUD Layout & Design Rules"
Cohesion: 0.20
Nodes (11): HUD outside the square play window (HUD-OUT), computeHudLayout(), freezeLayout(), hudLayout(), drawPlayWindow(), playWindowLayout(), playWindowRect(), drawDanger() (+3 more)

### Community 52 - "Game Data Loading"
Cohesion: 0.11
Nodes (15): loadData(), loadData(), loadData(), loadData(), loadData(), loadData(), loadData(), attacks (+7 more)

### Community 53 - "Account Passwords & Email"
Cohesion: 0.18
Nodes (9): hashPassword(), normalizeEmail(), validateEmail(), validatePassword(), verifyPassword(), consumeEmailVerification(), consumePasswordReset(), issuePasswordReset() (+1 more)

### Community 54 - "Canvas Draw Backend"
Cohesion: 0.32
Nodes (15): cDrawCircle(), cDrawEllipse(), cDrawLine(), cDrawPoly(), cDrawRect(), cDrawText(), designWidthFor(), fitScale() (+7 more)

### Community 55 - "Generation Scheduling"
Cohesion: 0.19
Nodes (12): loadGenSchedule(), saveGenSchedule(), activeConfig(), computeDue(), DEFAULT_GEN_SCHEDULE, GEN_ASSETS, getGenSchedule(), initGenSchedule() (+4 more)

### Community 56 - "Net Messages & Tests"
Cohesion: 0.16
Nodes (8): addEvolvedType(), applyDelta(), applyMessage(), browserStorage(), DEFAULT_URL, memStorage(), FakeWS, TOKEN_KEY

### Community 57 - "Marketplace"
Cohesion: 0.26
Nodes (12): buyListing(), cancelListing(), findInVault(), handleMarketMessage(), intAmt(), listingView(), listMonster(), MARKET_FEE_PCT (+4 more)

### Community 58 - "Canvas Renderer"
Cohesion: 0.16
Nodes (5): anchorOrigin(), ANCHORS, cDrawSprite(), _rgbCache, toRGB()

### Community 60 - "Game Data Registry"
Cohesion: 0.13
Nodes (13): attackIndex, attacks, biomes, evolvedTypes, groundTiles, items, monsterIndex, monsterTypes (+5 more)

### Community 61 - "CI Workflow"
Cohesion: 0.13
Nodes (14): runs-on, steps, jobs, build-test, name, on, pull_request, push (+6 more)

### Community 62 - "Spirit Chain Rendering"
Cohesion: 0.25
Nodes (9): chainColor(), drawCaptureAnimation(), drawCaptureFail(), drawChainBreak(), drawChainImpact(), drawChest(), drawLinkRing(), drawSpiritChainModel() (+1 more)

### Community 63 - "Generation Config"
Cohesion: 0.27
Nodes (10): loadGenConfig(), saveGenConfig(), allGenConfig(), DEFAULT_GEN_CONFIG, getGenConfig(), initGenConfig(), overrides, roundComposition() (+2 more)

### Community 64 - "Shop Panel"
Cohesion: 0.38
Nodes (13): getSpiritChains(), btnX(), buyR(), drawShopPanel(), fitText(), owned(), rowRect(), rowsTop() (+5 more)

### Community 65 - "Snapshot Decoder"
Cohesion: 0.41
Nodes (7): decodeSnapshot(), rChests(), Reader, rGone(), rMonsters(), rPlayers(), rProj()

### Community 66 - "Combat & Gen Design Notes"
Cohesion: 0.21
Nodes (8): AI-generated combat items (use instead of attack/flee), Biome/tile movement speed modifiers removed, combatMaxTurnDamageFrac variance clamp, Structured Fight-Judgement judge v2 (combatJudgeV2), Implementation Plan Archive (completed work), Monster generation v2 multi-agent pipeline (genPipeline), PvP hardening (no capture, CSPRNG combat ids, fresh team snapshots), Field inventory (7 stats in order, abilities ≤4, passive/active, lore)

### Community 67 - "Network Protocol Design"
Cohesion: 0.18
Nodes (8): Client-side movement prediction + reconciliation, Client→server messages (join, queue, unqueue, input, combatAction, ping), Network Protocol (implemented), Open questions Q10-Q13 + binary encoding, Server→client messages (welcome, queued, matchFound, roundStart, snapshot, combat*, extracted, died, pong, error), Session lifecycle (join→welcome→queue→matchFound→roundStart→snapshot/combat→extracted|died), Snapshot message + area-of-interest filtering, WebSocket JSON envelope {t, ...}

### Community 68 - "Visual Effects System"
Cohesion: 0.29
Nodes (11): clearFx(), drawFx(), drawFxScreen(), drawOne(), emit(), emitText(), fxBudget(), fxCount() (+3 more)

### Community 69 - "Generation Job Queue"
Cohesion: 0.26
Nodes (9): clampConc(), genName(), makeGenQueue(), nextJob(), pump(), record(), drain(), tick() (+1 more)

### Community 70 - "Combat Engine"
Cohesion: 0.26
Nodes (6): applyStatusTick(), isCanonical(), normalizeStatus(), performAttack(), resolveTurn(), STATUS_ALIASES

### Community 71 - "Items System"
Cohesion: 0.30
Nodes (10): itemCategory(), itemCombatDescription(), itemEffectText(), itemRarity(), MAG, RARITIES, RARITY_DROP_WEIGHT, rollItemFromPool() (+2 more)

### Community 72 - "Portal & Healer Panels"
Cohesion: 0.20
Nodes (12): clericThanks(), closeStationPopup(), drawPortalPanel(), healNow(), portalActivate(), portalHasMonsters(), portalLayout(), portalPanelTap() (+4 more)

### Community 73 - "Batch Generation Script"
Cohesion: 0.18
Nodes (9): ARCHETYPES, BASE, BIOMES, count(), ELEMENTS, hdr, N, req() (+1 more)

### Community 74 - "Account Model Tests"
Cohesion: 0.31
Nodes (10): acct(), accountAttachExistingCharacter(), accountCount(), createAccountRecord(), ensureAccountForProfile(), findAccountByEmail(), findAccountByOAuth(), isBlocked() (+2 more)

### Community 75 - "HTML Monster Overlay"
Cohesion: 0.33
Nodes (7): clipInset(), createHtmlMonsterOverlay(), sanitizedModel(), sync(), syncInner(), usesDom(), motionState()

### Community 76 - "Portal Rendering"
Cohesion: 0.24
Nodes (6): _colCache, CORE, drawExtractFlash(), drawPortal(), lerp(), TEAL

### Community 77 - "Lobby Input Handling"
Cohesion: 0.20
Nodes (11): clearNet(), closeOverlay(), dim(), establishSession(), joyMove(), joyStart(), nick(), openMonsterDetail() (+3 more)

### Community 78 - "Station Popup Shell"
Cohesion: 0.42
Nodes (8): drawStationPopupHub(), popupTap(), popupUp(), drawStationPopup(), stationCloseRect(), stationContentRect(), stationPopupInside(), stationPopupRect()

### Community 79 - "Theme Tests"
Cohesion: 0.20
Nodes (5): headerSize(), a, b, c, mockHeaderK()

### Community 80 - "Deployment & Security Config"
Cohesion: 0.22
Nodes (8): ALLOWED_ORIGINS allow-list, Deployment, Required Railway env vars, VITE_SERVER_URL client override, Account security audit fixes, Per-IP connection cap (CONN_MAX_PER_IP), Login system review + 3 shipped gaps (username prompt, login indicator, profile page), Optional ops (rotate secrets, ALLOWED_ORIGINS, imprint contact)

### Community 81 - "Plan & Requirements Docs"
Cohesion: 0.25
Nodes (5): Implementation Plan (active), Password reset / native-account email (DEFERRED by user), Email/SMTP provider needed for password reset, Requirements — what Dominik must do/decide, public/wiki.html

### Community 82 - "Brand Icons & Palette"
Cohesion: 0.61
Nodes (7): Apple Touch Icon (180px hooded spirit-tamer), PWA Icon 192 (hooded spirit-tamer, ember on charcoal), PWA Icon 512 (hooded spirit-tamer, ember on charcoal), App Icon SVG (vector master, 512 viewBox), Ember-on-Charcoal Brand Palette (#F0533D / #FFB199 rim on #14110F-#050505 base), Hooded Spirit-Tamer Mascot (shadowed face, glowing ember eyes), Spirit-Chain Ring Brand Mark (8-bead ember ring)

### Community 83 - "Account Endpoint Tests"
Cohesion: 0.28
Nodes (6): mockBodyReq(), mockGet(), mockIp(), accountMethodCount(), getAccountBySession(), getByToken()

### Community 84 - "Canvas Text Cache"
Cohesion: 0.36
Nodes (4): textAlignFor(), textBaselineFor(), bake(), makeLabelCache()

### Community 85 - "Forest Floor Rendering"
Cohesion: 0.22
Nodes (9): buildTrees(), ellip(), drawForestFloor(), drawGroundScatter(), drawTree(), forestItems(), gust(), scatterItems() (+1 more)

### Community 86 - "Railway Config"
Cohesion: 0.25
Nodes (7): build, builder, deploy, restartPolicyMaxRetries, restartPolicyType, startCommand, $schema

### Community 87 - "Rate Limiting"
Cohesion: 0.43
Nodes (6): clientIp(), createBucket(), createConnLimiter(), createIpRateLimiter(), createViolationTracker(), TRUSTED_PROXY_HOPS

### Community 88 - "Auto Reload"
Cohesion: 0.61
Nodes (6): currentBundleHash(), extractBundleHash(), fetchLatestHash(), initAutoReload(), isNewVersion(), showReloadPill()

### Community 89 - "AI Metrics"
Cohesion: 0.48
Nodes (5): aiMetricsSnapshot(), m, recordTurn(), resetAiMetrics(), round3()

### Community 90 - "Canvas Mouse Input"
Cohesion: 0.48
Nodes (3): pointerToDesign(), isTouchscreen(), makeMouse()

### Community 91 - "Canvas Scene Manager"
Cohesion: 0.38
Nodes (3): makeSceneManager(), leave(), recordSceneError()

### Community 92 - "Minimap"
Cohesion: 0.52
Nodes (5): MINIMAP_ZOOM_LEVELS, minimapSize(), minimapWindow(), nextMinimapZoom(), view()

### Community 93 - "Title Gamepad"
Cohesion: 0.38
Nodes (4): initTitleGamepad(), mk(), mkDoc(), rootOf()

### Community 94 - "Monster Top-up Script"
Cohesion: 0.33
Nodes (6): BASE, count(), hdr, req(), TARGET, THEMES

### Community 95 - "Monster Detail Popup Spec"
Cohesion: 0.40
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

### Community 102 - "Turn-Based Combat Docs"
Cohesion: 0.40
Nodes (4): Turn-based AI-resolved combat, npm commands (dev/server/test/build), Tamers Quest Agent Guide, Instanced turn-based combat over the wire (Q1/Q3)

### Community 103 - "Solo/Multiplayer Unification"
Cohesion: 0.50
Nodes (3): queueSolo (SP = instant private 1-player server round), SP/MP unify (Phases A-D), SP in-process server stub mirroring handleMessage

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
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 727 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **61 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `hubScene()` connect `Hub Buildings & Props` to `Cosmetic Skins Economy`, `Character Skins & Bestiary`, `Round World Server Logic`, `Cleanup Tracking & AI Admin Panels`, `Hub Decor & Profile`, `Keyboard Input Handling`, `Monster Stats Data`, `Account & Character Select`, `Biomes & Map Generation`, `Inventory & Roster Engine`, `Lobby Scene & Menus`, `Settings & Sound`, `Game Boot & Storage`, `Battle Pass`, `Bestiary Panel`, `HUD Layout & Design Rules`, `Portal & Healer Panels`, `Lobby Input Handling`, `Station Popup Shell`, `Forest Floor Rendering`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **What connects `Animated title background (rays, fog, portal, embers, wisps, fractal trees)`, `PWA / OpenGraph metadata`, `Scale-to-fit stage wrapper` to the rest of the system?**
  _14 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Cosmetic Skins Economy` be split into smaller, more focused modules?**
  _Cohesion score 0.05994710549515134 - nodes in this community are weakly interconnected._
- **Why does `getMonsterTypes()` connect `Biomes & Map Generation` to `AI Config Settings`, `Character Skins & Bestiary`, `Round World Server Logic`, `Game Boot & Storage`, `Content Generation Core`, `Server Perf & Hub Tests`, `Monster Stats Data`, `Admin Panels & Handlers`, `Database Persistence Layer`, `Bestiary Panel`, `Combat Parity & Resolver`, `AI Combat Resolution`, `Account Store & Cloud Saves`, `Game Data Registry`, `Inventory & Roster Engine`, `Lobby Scene & Menus`, `HTTP Server & Config`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Should `Title Screen & Login` be split into smaller, more focused modules?**
  _Cohesion score 0.05094905094905095 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Title Screen (index.html)` and `AI monsters — browse panel`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `Returning player resume (Enter as / Log out)` and `Cookie & Storage Notice (localStorage keys)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._