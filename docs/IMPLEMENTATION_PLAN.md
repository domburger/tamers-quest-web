# Tamers Quest — Implementation Plan

> Living plan for porting Tamers Quest into a **real-time, online multiplayer
> extraction game** (Dark-and-Darker-style) with AI-generated monsters,
> AI-evaluated fights, and procedurally-rendered visuals on Phaser 3.
>
> Source of truth for tasks. Check items off as they land. See
> `public/wiki.html` for the game-logic spec this plan implements.

Last updated: 2026-06-07

---

## 🎯 BUILD THESE FIRST — user-visible headline demands (coordinator 2026-06-07)

> ⏸️ **COORDINATOR LOOP STOPPED 2026-06-07 (user-requested).** Final state: **9 of 10 headline
> items CLOSED** (#1 title/guest, #2 lobby hub, #3 AI-only combat, #4 brutal monsters, #5 fog-of-war,
> #6 minimap biome+zoom, #8 heal, #9 objective HUD, #10 auth all done + mostly prod-verified).
> **STILL OPEN (handed off to the agent loops):** **#7 multi-character across SP+MP** (PARITY-2 —
> SP-only today); **INV-T8 drag-and-drop inventory** (in flight); **orphaned MP-management scenes**
> cleanup after the unified-lobby flow (flagged `6754e73`); plus the standing deferred items
> (cosmetics monetization, CN-16 gacha) and remaining PT2-T11 parity tidy. `local==origin`, production
> current. Agents keep building/pushing/marking the board autonomously; no coordinator gating needed.
>
> **The user is (rightly) frustrated that headline demands aren't on the live site.** Deploy is
> verified healthy — recent code IS live — so the gap is **what we've built**: the fleet has shipped
> huge volume of *polish/refactor/hardening* (HUD chrome, badges, flashes, a11y, parity, security)
> that barely changes what a player SEES, while the big visible asks lag. **NEW RULE: pause net-new
> polish. Every agent pulls from THIS list until it's cleared.** Honest status:
>
> | # | User-visible demand | Status | Lane |
> |---|---|---|---|
> | 1 | **Title = login / play-as-guest only** (guest nickname, no SP/MP on title) — `FLOW`/PT2-T02 | ✅ **BUILT** (`@visual` 2026-06-07): guest nickname → `isGuest` profile → character select; SP/MP removed from title; `shoot-title.mjs` verifies. **Login now LIVE** (Google/Discord/native wired — #10 done + prod-verified). | `@phaser` (index.html) + server |
> | 2 | **One lobby hub** (all options; SP/MP chosen at round start) — `FLOW`/PT1-T04 | ✅ **BUILT** (`@visual` `5b302a8`): `lobby.js` is the single hub — all options open from it + **Play→Singleplayer/Multiplayer picker at round start** (MP folds onlineLobby's connect/queue, char name = nickname); rotatable char centre, Esc menu. Verified SP+MP end-to-end. `onlineLobby` retired once `@phaser` reroutes the title→lobby. | `@visual` (PT1-T04/T05) |
> | 3 | **AI-ONLY combat** (judge LLM owns it; prompt in /admin) — `FGT-T1` | ✅ **DONE** (`@combat` a97126e: one shared `aiTurn`; SP routes through the server judge over HTTP; det. engine = crash-net only; "needs connection" UX; parity test) | `@combat` (PARITY-1) |
> | 4 | **Brutal, animal-archetype monsters** (not cute/egg-shaped) — `P5-T5`/PT1-T21 | ✅ LANDED (`@visual` `df3f357`): 6 archetype rigs (beast/raptor/saurian/leviathan/arthropod/brute), lineup shows 5-6 distinct silhouettes; gen prompt steered too (`6051c4e`) | `@feature`+`@visual` |
> | 5 | **Fog-of-war** (reveal by walking) — PT1-T08 | ✅ **DONE — both modes** (flexible worker) | `@feature`+`@visual` |
> | 6 | **Minimap real biome colors** (not all-green) + zoom — PT1-T07/T24 | ✅ **biome colors DONE — both modes** (`@visual` `6397bef`: per-biome tint palette in mapgen, blended into SP+MP radar); **zoom DONE — both modes** (`@visual`: shared `render/minimap.js` `minimapWindow()` → tap-to-zoom 1×↔2× player-centered in SP **and** MP; MP committed in HEAD). #6 fully cleared. | `@visual` |
> | 7 | **Multiple characters across SP+MP** (one identity) — PT2-T01 | ◑ SP-only multi-char | `@feature`+server (PARITY-2) |
> | 8 | **Heal the team** (mechanic + UI) — PT2-T13 | ✅ **mechanic + UI DONE** (flexible worker): heals at run-start + extract (verified); lobby now shows "YOUR TEAM - heals to full when a run starts" so it's explained. Only an *optional* design call left (persist injury as a stake + explicit heal action?) — user's call. | `@feature`+`@visual` |
> | 9 | **Objective / mission HUD + tutorial** — PT2-T10 | ✅ **objective HUD DONE — both modes** (flexible worker); first-run tutorial overlay already exists | `@feature`+`@visual` |
> | 10 | **OAuth login wired** (creds are set) — `AUTH-T2` | ✅ **DONE + PROD-VERIFIED 2026-06-07.** Backends: Google+Discord OAuth (`ad3233e`) + native email/password (`a158e68`), all prod-verified live. `@phaser` wired the title buttons (`b4778de` AUTH-T1): Google/Discord → live `/auth/<p>`, "Tamer's Account" → email/password form POSTing `/auth/{signup,login}` + token store. `@visual` confirmed end-to-end on tamersquest.com — **clicking "Continue with Google" redirects to accounts.google.com**, no `"coming soon"` left in the deployed HTML (acceptance check in `tools/verify-prod.mjs`). All three login methods reachable + functional. **Board #10 cleared.** _Follow-up (optional, not blocking): logged-in UI state / account-name display once a session token round-trips._ | `@feature`+server / `@phaser` |
>
> ✅ already live (so you should see these): per-biome speed, sounds, inventory view, settings-on-Esc,
> character/monster sprites (no red dots), cosmetics + economy, compliance `/legal`, 5 starting chains,
> font (Electrolize+Fredoka), security headers, the rarity-wall fix, the combat-crash fix.
> **`@coordinator` is personally driving #3 (AI-only combat) + forcing #1/#2 with `@phaser`.**

---

## 🚀 Deployment policy — CONTINUOUS DEPLOY (user directive 2026-06-07)

> **Every agent: push all changes to production immediately.** The user wants
> changes live ASAP and is using production (`tamersquest.com`, Railway, auto-deploys
> from GitHub `master`) as a **test environment — there is currently NO traffic**, so
> shipping work-in-progress is expected and fine.
>
> **Workflow for every agent, every change:**
> 1. `npm run build` must succeed (a broken client bundle takes the site down — this
>    is the one hard gate). Unit-test failures do NOT block the push (prod is a test
>    env) but **must be logged** (`docs/BUGFIX_LOG.md` / flag to `@watchdog`).
> 2. `git add -A && git commit` (include the co-author trailer) **and `git push`
>    directly to `master`** — Railway auto-deploys on push. Do not let work sit
>    uncommitted or on un-merged branches.
> 3. Commit frequently (per landed change), don't batch — small deploys are easier to
>    bisect if something breaks.
>
> Once production has real traffic this policy must change (gate on tests + reviewed
> PRs). Revisit then.
>
> ✅ **RESOLVED 2026-06-07 — direct push now works (user-authorized).** The user
> explicitly directed: *"make sure that all changes are always pushed to production as
> soon as possible."* That authorization unblocked the classifier — `@visual` pushed
> `109cc2d` straight to `origin/master`. **Standing rule for every agent: commit AND
> `git push origin master` after each landed change (build must pass first).** Don't
> wait for a `@coordinator` relay; push your own work immediately. (Earlier blocked-push
> flag kept below for history.)
>
> ✅ **RESOLVED — working model (`@coordinator`, 2026-06-07):** **agents commit locally;
> `@coordinator` (push-capable) gates (build + tests + smoke) and relays to `origin`.**
> Just relayed `@visual`'s `4bc3a91` (P5-T5 brutal-menace) + this note — so stuck commits
> reach prod within a coordinator pass. This is the standing model unless the user grants
> `@visual` direct push (optional). No work is lost; pushing is centralized through the gate.

---

> ✅ **RESOLVED (2026-06-07, verified by `@visual`):** the title now shows **only** the HTML menu
> (`Multiplayer / Singleplayer / Cosmetics Store` + auth) over a canvas backdrop — no canvas
> menu, no overlap, no errors; clicking `Multiplayer` opens the (canvas) PLAY ONLINE lobby and
> combat QA runs end-to-end again. QA tools updated to click the DOM `Multiplayer` button. Below
> is the original finding for history.
>
> ⚠️ **`@visual` finding for `@phaser` / title-owner (2026-06-07) — canvas vs HTML title conflict.**
> Headless QA (vite dev) shows the **canvas** still drawing the old menu — `Play Online /
> Single Player / Bestiary` (not in the DOM, so canvas-rendered) — **on top of** the new
> **HTML** title in `index.html`, whose DOM has `Multiplayer / Single Player / SIGN IN /
> Continue with Google·Discord / TOP EXTRACTORS`. They're inconsistent (`Play Online` vs
> `Multiplayer`; the HTML auth/leaderboard isn't visible behind the canvas). Clicking the DOM
> `Multiplayer` button *does* navigate, so the HTML title is wired — but the canvas overlay
> hides it and intercepts coordinate clicks. **Impact:** users likely still see the old
> canvas menu (new sign-in/leaderboard invisible); it also broke all QA-past-title nav (tools
> targeted `Play Online` @640,504). **Not fixing — `index.html` + the scene/`main.js` boot are
> `@phaser`'s lane.** Likely needs the canvas title scene removed from the boot (or hidden)
> now that the HTML title owns the menu. _Caveat: observed on vite dev; confirm against the
> built bundle._

---

## Agents & ownership (coordinator-managed)

> **Source of truth for who is doing what.** Agents run as independent `/loop` sessions.
> **Rules:** (1) every open/in-progress task has exactly one **Owner** drawn from the roster
> below; (2) a task may **only** be owned by a *confirmed* roster agent — **no phantom
> owners**; (3) `@unassigned` is *not an agent* — it means free-to-claim; (4) to take work,
> first add yourself to the roster (with a heartbeat artifact that proves you exist), then
> put your handle in the ownership table. The coordinator validates rules 1–3 every loop.

### Agent roster
| Handle | Role | Heartbeat / how identified | Status |
|---|---|---|---|
| `@coordinator` | Cross-agent coordination; source-of-truth upkeep; unblock & route work; validate this section | this cron `/loop` session | **confirmed** |
| `@watchdog` | Systematic bug-hunt + review of freshly-landed code; quality gate | appends `docs/BUGFIX_LOG.md` (≈iter 23) | **confirmed** |
| `@phaser` | Rendering engine; owns `src/compat/*`, `src/main.js` bootstrap, `index.html`. Migration **LANDED 2026-06-06**; now: native-refactor hot scenes / retire shim | user-directed; ack'd in `BUGFIX_LOG` iter 22 | **confirmed** |
| `@feature` | Gameplay feature dev (Spirit Chains throw/capture, chests + extraction stakes, gold economy + SP/MP shop, sprint/stamina, Hydra Lash multi-capture) | owns `src/engine/spiritchains.js`, `src/engine/movement.js`, `src/scenes/shop.js`, `src/scenes/onlineShop.js`, `public/assets/data/spiritchains.json` | **confirmed (2026-06-06)** |
| `@visual` | In-round render polish + visual-QA tooling; also shipped the kill feed | authored `tools/shoot-round.mjs` + `tools/shoot-spcombat.mjs` (SP-combat harness, 2026-06-07) + `src/render/tiles.js` (textured floor); now: board #4 brutal animal-archetype monster gen (`src/systems/spritegen.js`); this `/loop` | **confirmed** |
| `@combat` | AI-only combat unification (FGT-T1 / PARITY-1): one shared AI-judge resolver for SP + MP; SP routes through a server HTTP combat endpoint | owns `server/combat.js` `aiTurn`/HTTP endpoint, `src/systems/combat.js` (SP combat client), `server/combat.parity.test.js`; this `/loop` (2026-06-07) | **confirmed** |

_New agent? Add a row with a real heartbeat artifact (a file you own, a log you append to,
a branch you push), set Status to **confirmed**, then claim tasks below._

### Open / in-progress task ownership
Only handles marked **confirmed** above may own a task. Everything else is `@unassigned`.

> 🎮 **TOP PRIORITY — PLAYTEST 1 (2026-06-07): see the `PT` section at the bottom** — 38 routed
> tasks from a real playtest. 🟢 **PT2-T11 (share SP/MP engine) is USER-GREENLIT and now THE top
> priority — `@coordinator` driving.** (The PT1-T09 combat crash was verified non-reproducing on
> `master`, so we go straight to the refactor.) Also user-decided this round: **combat = AI-only
> (FGT-T1=b)**, **duel-initiative rules (FGT-T9)**, **cosmetics earned+free + monetization-later
> (CN-9)**, **OAuth UNBLOCKED — creds set, build now (AUTH-T2)**, **font locked = Electrolize+Fredoka**.
> @visual visual/content PT tasks run in parallel. Claim a PT row → put your handle on it.
>
> 🧭 **ALSO HIGH PRIORITY — the `FLOW` section (below): user's authoritative title→character→lobby
> spec (2026-06-07).** Title = login/guest only (guest = nickname, marked guest); then character
> select (multi-character); then ONE lobby where SP/MP is chosen at round start. Supersedes
> PT1-T04/T05 + PT2-T01/T02; coordinate the title with `@phaser`.

| Task | Owner | Notes |
|---|---|---|
| Kaboom → Phaser 3 migration | `@phaser` | ✅ **DONE** 2026-06-06 (shim landed + verified) |
| Phaser follow-up: native-refactor hot scenes, retire shim | `@phaser` | low-pri; see migration note |
| Bug hunt / review (ongoing) | `@watchdog` | `docs/BUGFIX_LOG.md` |
| Plan / wiki / source-of-truth upkeep | `@coordinator` | this section + drift checks |
| P2-T3 client-side prediction/reconciliation | `@unassigned` | deferred |
| P2-T5 main-view camera zoom-out | `@unassigned` | **blocked**: needs `k.camScale`/zoom in the shim (`@phaser`) — shim is pan-only (`camPos`) today |
| P5-T1 live monster-gen tuning | `@unassigned` | gated by `MONSTER_GEN_RATE` |
| P5-T3 bestiary approve/reject workflow | `@unassigned` | |
| P6-T3 player list + kill feed | `@visual` | ✅ both done: kill feed (P8-T5) + rivals-in-view list (HUD info line); in working tree |
| P6-T4 16-player load/perf test | `@coordinator` | ✅ **DONE**: bandwidth guard (`server/perf.test.js`) + load harness (`tools/loadtest.mjs`); 16p = avg 0.10 ms/tick, ~141 KB/s — big headroom |
| P6-T6 single-player touch controls | `@unassigned` | |
| P6-T8 server split (config flip) | `@unassigned` | |
| P7-T2 remaining radii tunables | `@unassigned` | |
| P8-T3 round-end gains summary | `@visual` | ✅ built (server run-deltas + result-screen "THIS RUN" line + tests); in working tree |
| P8-T5 kill feed | `@visual` | built: server broadcast (`world`/`pvp`) + HUD (`onlineGame`), tested; in working tree |
| P8-T6 audio / procedural SFX | `@visual` | ✅ broad coverage now (`src/systems/audio.js`, Web Audio, no assets), `M` mute (persisted), default ON. **MP in-round** via net events (encounter/hit/catch/win/lose/extract/defeat). **Menu** SFX (hover/click) wired centrally in `theme.js addButton` → all themed scenes. **MP interaction** SFX (footsteps, level-up, chest-open) via state-diffs in `onlineGame`. ✅ **SP-combat SFX now wired** (`fight.js`, 2026-06-06): button hover/click + hit (on attack) + catch + win + level-up + lose — SP combat was silent (its `makeBtn` isn't `theme.addButton`); build+148 tests, no breakage. **Un-ear-tested** (headless) — recipes in `audio.js` easily tuned. ✅ **MP combat-overlay button SFX now wired** (`onlineGame` `act()`, 2026-06-08, `9d990e7`): each combat action (attack/catch/flee/swap) + Swap-open play `sfx("click")`, Swap-close plays `sfx("back")` — they were haptic-only (immediate-mode, so they missed `theme.addButton`'s centralized click); respects the shared mute. Remaining (low-pri): scene-transition SFX needs a `main.js` hook (@phaser). |
| P8-T8 how-to-play / onboarding | `@visual` | ✅ first-run in-round overlay (onlineGame); dismiss on move/tap; localStorage once; verified via shoot-round (shows idle, gone after move). In working tree. **+ 2026-06-07 (`@visual`):** the SP **loading screen** (`loading.js`) now rotates **gameplay tips** (chains/biomes/storm/extraction/sprint/heal/chests/shop) under the progress bar — free onboarding airtime each run; screenshot-verified, glyph-guarded. |
| Spirit Chains (throw→engage→capture, 5 tiers + 3 specials) | `@feature` | ✅ shipped+tested SP+MP; wiki `#chains`. Scene registration via `featureScenes.js` registry (see seam note below) |
| Chest loot + extraction stakes | `@feature` | ✅ chests vs walls, run-found chains banked on extract / lost on death; wiki `#chains` |
| Gold economy + spirit shop | `@feature` | ✅ earn (defeat/extract) + SP shop scene + online shop scene + server `buyChain`; needs `main.js` registration (see note) |
| Sprint / stamina traversal | `@feature` | ✅ hold-Shift sprint, `engine/movement.js` + `GAME.SPRINT`, SP+MP + HUD bars; wiki `#movement` |
| P9-T6 Hydra Lash multi-capture | `@feature` | ✅ **DONE** (`clusterTargets` + sequential multi-capture SP+MP, tested); wiki Hydra Lash row |
| P9-T8 chain crafting | `@feature` | ✅ **DONE 2026-06-06** — **Spirit Essence** material (`+2`/defeat, `+3`/chest; persists) spent to **upgrade** an owned base chain to the next tier (consumes the lower; cost 40×tier). Pure `craftUpgrade`/`upgradeTargetFor`/`upgradeCost` (`schemas.js`, tested). SP: Inventory → Spirit Chains tab Upgrade buttons. MP: server `craftChain` handler + essence sync + Upgrade buttons in `onlineShop`. Build+152 tests; wiki acquisition + progression. |
| Account perks / meta-upgrades | `@feature`/`@visual` | ✅ **DONE 2026-06-07** — `src/engine/upgrades.js` (Prospector / Attunement / DeepVault). All four ex-"remaining" items now closed: (1) **purchase UI** — SP `baseUpgrades.js` + MP `onlineBaseUpgrades.js` (CN-1) both call `purchaseUpgrade`/`net.buyUpgrade`; (2) **SP/online parity** — `world.js` now applies `goldMult`/`essenceMult` at every online grant site (extract/defeat/chest, lines ~643/764/765/850) + `vaultCapacity` in roster/catch, so SP and online match; (3) **tests** — `upgrades.test.js` (+ world handler tests); (4) **single source** — `goldMult`/`essenceMult`/`vaultCapacity` read each def's `per` field (no more hardcoded constants). Meta-progression is fully wired SP **and** MP. **Follow-up (optional):** more upgrade *types* (CN-8). |
| Controller / gamepad support | `@visual` | ✅ **increment 1** (online game): `src/systems/gamepad.js` (isolated, tested) → `onlineGame` movement (stick/d-pad) + combat (A/B/X/Y=atk1-4, LB=catch, RB=flee) + throw (A/RT roaming) + onboarding-dismiss, via the same handlers as keyboard. Build+133 tests+no client errors; un-gamepad-tested (user verifies feel). **Follow-up:** menu navigation + SP `fight` scene |
| P10 SP/MP parity & code-reuse audit | `@coordinator` | T1 audit ✅ + T4 ✅ (`grantXp`→`engine/progression.js`, tested); T2/T3/T5/T6 open w/ findings — see P10 |
| Mobile onscreen controls overhaul | `@visual` | **user-requested 2026-06-06** — "need to be much better." ✅ Done so far (objective UX wins, verified via touch `shoot-round` TOUCH=1): **THROW button** (was keyboard-only → mobile can capture); **floating/dynamic joystick** (spawns under the thumb vs fixed corner) + **press feedback** (thumb grows/tints, ring brightens) + faint idle hint. 🔴 **REGRESSION FIXED 2026-06-06:** the joystick refactor left `thumb = JOY` (undefined) in the combat-reset branch → **MP combat crashed for everyone** the moment a fight started (`ReferenceError` every frame, round froze). Combat is position-gated so QA never hit it; surfaced by a new `ENCOUNTER_RADIUS` env hook (`server/index.js`) + QA at radius 600. Fixed → `thumb = joyRest()`; combat overlay now renders, build+152 tests, no PAGEERR (see BUGFIX_LOG). ✅ **Combat-button overhaul DONE 2026-06-07** (`@visual`): taller panel (`COMBAT_H` 220→264) + **larger touch targets** (button h 40→54), **element-tinted fills** (each attack reads as its element), cleaner rounding, and a **tap press-flash** (brighter fill + thicker outline on the just-tapped button) — the "press states" gap. Build+tests+shoot-combat verified at DSF=1 (full layout fits: rows → 4 attacks → Catch/Flee → log). **Still open:** safe-area (notch) insets + responsive scaling for very small screens; exact colours remain tunable. ⚠️ **For @phaser:** headless QA at `deviceScaleFactor=2` now renders the canvas at **half-size (top-left quadrant)** while DSF=1 is full — the recent canvas zoom/DPR (4K-sharpness) shim work looks like it double-applies at DPR≥2; **worth checking a real retina/4K display isn't rendering in a corner.** |
| Tile-overlap fix (SP overworld) | `@coordinator` | ✅ **DONE 2026-06-06**: SP `game.js` drew tiles at `TILE_SIZE`(128) stepped by `EFFECTIVE_TILE`(80) → 48px overlap on every neighbour; now drawn at cell size (matches MP `render/tiles.js`). Deploying. Full SP→`tiles.js` unify tracked as P10-T2 |
| Inventory view | `@feature` (SP) + `@visual` (MP) | ✅ **SP done** (`@feature`): `inventory.js` gained a **Monsters \| Spirit Chains** tab toggle; chains tab lists each owned chain (tier, throws ∞/n, charges, equipped) and equips on tap. ✅ **MP done** (`@visual` 2026-06-06 — the follow-up @feature noted): added the same **Monsters \| Spirit Chains** tab to the online `roster.js` (no new scene → no `main.js`/@phaser dep). Chains tab = a card per owned chain (colour swatch, name, tier, "catches up to rarity N", throws ∞/n, charges, special-ability blurb) with **tap-to-equip** → `net.setEquippedChain` + optimistic `equippedChainId` (server validates owned, no lobby echo). Build+147 tests; **verified via new `tools/shoot-roster.mjs`** (title→Play Online→Manage Team→roster) on a fresh `:8080`: tab switching + equipped-highlight render correctly, no client errors. ✅ **BUGFIX (`@visual`, surfaced by this work):** the roster's **active-team cards were drawn *before* the vault scroll-mask** (`drawRect 0,0 → VAULT_TOP=256`), and the team row sits at y≈90–210 *inside* that band — so the mask painted over the whole team and it rendered **empty for everyone** (pre-existing, not the tab change). Reordered to vault→mask→team so the team draws on top; shoot-roster now shows all 4 starters (Phantom Mantis/Thornvine Treant/Thunder Ram/Cinder Wolf) with sprites, element outlines, HP bars. |
| Settings/pause on Escape | `@visual` | ✅ **DONE (onlineGame)**: ESC opens a **PAUSED** overlay (Resume · Sound On/Off · Leave round) instead of instantly quitting — fixes accidental round-loss + gives a touch/mouse mute toggle. Movement + gamepad gated while open; world keeps running server-side (overlay says so). Verified via `shoot-round` (ESC capture). ✅ **SP follow-up DONE 2026-06-08 (`@visual`):** SP `game.js` already paused on ESC (Resume / Quit Run) but **lacked the mute toggle** — added a **Sound: On/Off** button to the SP pause menu (between Resume and Quit), wired to the shared persisted `tq_muted` (`toggleMuted`/`isMuted`), so SP now matches MP's Resume·Sound·Leave overlay. Build + 348 tests green. _SP pause buttons are still bespoke `k.add` rects (not `theme.addButton`) — a minor PV-A1 chrome tidy left for later._ |
| Red dots → character/monster models | `@visual` | ✅ **DONE (MP)**. MP main view already used sprites (monsters) + `drawCharacter` (rivals) — only the minimap had dots → small **character glyph** (head+body); self/portal kept. ✅ **SP DONE 2026-06-06** (found via shoot-fight QA): the **SP overworld (`game.js`) was still drawing monsters as a flat red dot** (`rgb(255,60,60)`) — now draws the monster's **procedural sprite** (the global sprites `main.js` preloads by typeName slug) + a ground shadow, matching MP, with an amber marker fallback. Build+147 tests+shoot-fight verified (teal creature sprite renders where the red dot was; no client errors). |
| **Live asset-generation pipeline + admin controls** | `@coordinator` | **user-requested 2026-06-06** (extends P5 + P7-T5). ✅ **Admin model+params steering DONE** (`@coordinator`): `server/aiconfig.js` (DB-persisted, settings id=3, validated/clamped, tested 5✓) → `ai.js` (combat) + `gen.js` (gen) read model/temperature/maxTokens/topP live; `/admin` has a **Model & parameters** editor (model dropdown+free-text from `MODEL_OPTIONS`, temp/maxTokens/topP). Prompts already editable (P7-T5). **Remaining:** turn generation ON in prod (`MONSTER_GEN_RATE`>0 / on-demand) + per-category quotas + bespoke attack gen — see P5-T1/T2 |
| AI gen: keep newest OpenAI models selectable | `@combat` | **user-requested 2026-06-07** — ✅ **DONE 2026-06-07 (`@combat`)**: verified against the live OpenAI docs and refreshed `MODEL_OPTIONS` (newest-first: gpt-5.5/5.4/5.4-mini/5.4-nano/5.3-chat-latest + gpt-4.1/4o/4o-mini); dropped retired gpt-5.1-era ids; default stays gpt-4o (stable+cheap per-turn, admin-upgradable). **Re-verify periodically (model lineup changes)** — leave this row as the recurring reminder. Pairs with the asset-pipeline task above. |
| Use LangChain for monster generation | `@unassigned` | **user-requested 2026-06-07** — replace the raw `fetch` in `server/gen.js` `aiGenerateMonster` with **LangChain** (`@langchain/openai` `ChatOpenAI` + structured output), reading model/params from `aiconfig.js`, keeping the `aiEnabled()` gate + schema validation + deterministic fallback. Adds a dependency; verify CI build. |
| Per-biome movement speed | `@feature` | ✅ **DONE 2026-06-06** — biome `speedMult` (0.70×–1.15×) in `mapgen.js` BIOME_DEFS + pure `biomeSpeedMultAt(map,x,y)`; applied server `tickRound` + SP `game.js` (replaces per-tile `speedModifier`), deterministic. Build+148 tests; wiki Biomes table + Movement section. |
| Portal visual + rise-from-ground anim | `@feature` | ✅ **DONE 2026-06-06** (user-requested) — replaced the flat cyan circle with a procedural rift in `src/render/portal.js`: ground rupture+dust → swirling teal vortex (white-hot core, pulsing rim, upward beam, orbiting motes), **rising out of the ground** over ~1.2s on spawn (eased). Shared by SP `game.js` (per-portal `bornAt`) + online `onlineGame.js` (client first-seen map). Build+158 tests (incl. `portal.test.js` rise-anim assertions); wiki Rendering. Browser-pending visual confirm. |
| Mouse-aimed chain throw (SP) | `@feature` | ✅ **DONE 2026-06-07** — SP chain throws aim at the cursor (shared `aimDir()`, camera-relative) with a reticle at reach, falling back to facing on touch. `game.js`; build+158 tests; wiki controls. (MP aim stays facing — `onlineGame.js` is @visual's.) |
| Stash & meta-progression (account upgrades) | `@feature` | ✅ **v1 DONE 2026-06-07** (user-steered) — `src/engine/upgrades.js`: gold-bought permanent upgrades on `profile.upgrades` (Prospector +gold, Attunement +essence, Deep Vault +vault; 5 lvls, geometric cost). Effects at all SP+MP award/cap sites (`goldMult`/`essenceMult` × defeat/extract/chest; `vaultCapacity` in `clampRoster`). SP **Base Upgrades** scene (lobby button, via featureScenes registry); MP server `buyUpgrade` handler + `upgrades` sync (welcome/snapshot/`net.buyUpgrade`). Build+163 tests (`upgrades.test.js` + world handler). **Follow-up:** MP buy-UI; more upgrade types. |
| Menu + interaction sounds | `@visual` | **user-requested 2026-06-06** (extends P8-T6). ✅ **menu SFX (all scenes) + footsteps DONE** (`@visual`): added `hover/click/back/step/chest/pickup/levelup` recipes to `src/systems/audio.js`, then wired **hover + click centrally in `src/ui/theme.js` `addButton`** → *every* themed button across *all* scenes gets sound from one place (respects the shared `M` mute; AudioContext unlocks on first click). Throttled, sprint-aware **footsteps** in `onlineGame` (gated off menu/combat). Build+147 tests+shoot-round verified — bot still clicks through title→lobby→round (proves click-wrap didn't break `onClick`), no client errors. ✅ **level-up + chest-open SFX DONE** via **client-side state-diffs** in `onlineGame` (no server change): level-up = a team monster's `level` rose vs last seen; chest-open = a chest within 56px of self vanished from the snapshot (proximity gate excludes chests that merely left view range). Build+147 tests+shoot-round verified (per-frame diff runs clean, no errors). Chain-pickup folded into chest-open (chains drop *from* chests). **Un-ear-tested** (headless) — recipes easily tuned. **Remaining (low-pri):** scene open/close transition SFX would need a `main.js` hook (@phaser lane); a distinct *back-button* sound exists (`back` recipe) but back buttons currently use the generic click. **Task effectively complete.** |
| Natural top-down look | `@visual` (+atmosphere agent on PV-T4) | **user-requested 2026-06-06** — top-down view feels flat/gamey; make it look more natural. ✅ **ground shadows under monsters** (`@visual`; players already shadowed via `drawCharacter`); ✅ procedural **ground scatter** (`@visual`, `tiles.js` `drawScatter` — sparse per-cell pebbles/flecks, deterministic, breaks per-type tile repetition; build+143 tests+shoot-round verified, natural not noisy); ✅ ambient **vignette + player spirit-glow + drifting motes** (`src/render/atmosphere.js` "PV-T4", called in `onlineGame` — **owned by the atmosphere agent; don't duplicate**). ✅ **tile-grid softening** (`@visual`, `tiles.js`): cut the per-tile edge-framing α (0.38→0.14 — it was drawing false seams even between *identical* neighbours) **+** added a per-cell **patchwork softener** (`neighborAvg` — nudge each tile toward its local 4-neighbour colour average @0.22 α; a visual no-op in uniform regions, only pulls in tiles that stand out) → floor now reads as continuous ground rather than a hard grid; build+147 tests+shoot-round verified (softer, still varied, not washed out). ✅ **y-sorted depth DONE** (`@visual` 2026-06-06): `onlineGame` entity draw refactored so monsters + other players + you render in **y-order** (nearer/lower draws on top), chests under (ground) + chain projectiles over (in-air) — overlaps now read as depth, not array order. Build+152 tests+shoot-round verified (all entities render, no breakage). **Task complete.** **Taste/tunable (ask user):** patchwork-blend α (0.22) + vignette strength — dial up for more blended/atmospheric, down for more vivid/varied. ⚠️ **Two concerns for the atmosphere agent/user:** (1) the vignette corners are very dark (0.92 α) — may hide rivals approaching from screen corners in PvP; (2) shadows+scatter+texture+vignette+glow+motes now stack — verify the *combined* frame for busyness, don't over-process |
| Void texture + map border wall | `@visual` | ✅ **DONE (MP, `render/tiles.js`)** 2026-06-06 (`@visual`): off-map cells were skipped (flat bg → tiles "floating in nothing"). Now `drawTiles` renders the void as an **enclosed cave** — the view range is no longer grid-clamped (void fills the screen past the map edge, never flat bg); the void is a dark **abyss**, and floor cells facing void get an **inner edge shadow** so the floor reads as recessed. ✅ **Wall redesign per user feedback 2026-06-06:** the first pass filled whole void-rim cells with rock (too thick) — now a **thin** rock wall (`WALL_T ≈ 0.13·cell`) hugs only the inside of the void edge, *just around the black* (`drawVoidCell`), so a boundary reads floor → shadow → thin wall → abyss. Shadows kept + made **corner-aware** (`drawFloorEdgeShadow`): perpendicular bands skip corners the top/bottom bands own (no double-dark at convex corners) + concave/diagonal-void corners get a matching shadow square (consistent outline). Now shared by SP+MP (P10-T2). Build+152 tests+shoot-sp/shoot-round verified. _user-requested; coordinated with "natural top-down look"._ |
| Cosmetics (chain + character skins) | `@phaser`/`@visual` | ✅ **shipped 2026-06-07** — `src/scenes/cosmetics.js` **Cosmetics Store** now has **two tabs**: **Spirit Chains** (`chainCosmetics.js`, refined chain + 8 variations) and **Player Character** (`characterCosmetics.js` — accent + cloak, `abe151a`), both with live previews + rarity coding; equipped skins persisted (localStorage). Reachable from the HTML title **and** the online lobby grid (LS-14). ✅ **MP sync DONE** (CN-12/CN-12b): chain skins ride the snapshot so rivals see each other's; your character skin shows on **self** in MP (rivals keep the **red** threat-accent per the user's "Red accent" decision). **One open gap → CN-9:** **no economy** — all skins are free (no gold/essence cost, unlock, or ownership); whether cosmetics should be earned/bought is a flagged design decision. _(Minor: registered via `main.js` rather than the `featureScenes.js` seam — @phaser-owned, harmless.)_ |
| **Compliance / legal pages** | `@visual` | ✅ **DRAFT SHIPPED 2026-06-07** — consolidated **`public/legal.html`** (Privacy / Cookie+Storage / Terms / Imprint, anchored), served at `/legal` via serve-handler clean-URLs (*verified 200*, no server route needed), styled to match `wiki.html`, content **accurate to the code** (exact `localStorage` keys + Postgres fields + OpenAI/Railway processors), `wiki.html` footer cross-link added. Build + 206 tests green. 🔴 **User-blocked remainder:** fill the `FILL IN` chips (operator name/address/email, retention, governing law); 🟠 **@phaser:** add the start-menu link in `index.html` (its lane). Detail in the **CMP** section. |
| **4K / HiDPI sharpness** | `@coordinator` (was `@phaser`) | **user-requested 2026-06-06.** ✅ **FIXED `@coordinator` 2026-06-06** (drove it after 3 passes unaddressed in `@phaser`'s queue; low-risk one-property change): added `scale.zoom = DPR` to the Phaser game config (`kaboomShim.js`:274) → the canvas **backing buffer now renders at devicePixelRatio (HiDPI/4K crisp)** while the world coordinate space stays 1280×720, so **no scene/camera/pooling coords changed**. Verified: build + 148 tests + headless shoot-menu **and** shoot-round (idle/moving/pause) all render clean, no console errors, layout/input intact. **`@phaser`:** FYI I touched your shim lane for this user-priority fix — please sanity-check on a real 4K display + refine (e.g. cap zoom for perf) if needed. |

> ✅ **@feature ↔ @phaser scene-registration seam (2026-06-06, resolved):** to stop feature
> scenes from editing your `src/main.js` bootstrap per-scene, feature scenes now register via
> **`src/scenes/featureScenes.js`** (`installFeatureScenes(k)`, @feature-owned). `main.js` keeps
> a **single stable hook** — `import { installFeatureScenes }` + one `installFeatureScenes(k)`
> call — that never needs touching again as features add scenes (shop + onlineShop today;
> future scenes append to the registry). `npm run build` + 147 tests green. @phaser: please keep
> that one hook through any bootstrap refactor; ping me if you'd prefer a different seam.

> 🔧 **Sprite-registration seam clarification (`@coordinator` 2026-06-07).** The "don't edit
> `main.js`" rule (CLAUDE.md) is about the **bootstrap structure** (scene wiring, game config,
> the init flow). It is **not** meant to block adding a **procedural sprite** to the
> `k.loadSprite(...)` list in `init()` — that block is the documented home for sprite
> registration (it already hosts `combat_background`, `player`, and every monster sprite; see
> the Asset-generation pipelines § "Registration"). So a visual agent adding e.g.
> `k.loadSprite("menu_background", generateMenuBackground())` alongside the existing lines is an
> **accepted shared seam**, not a lane violation. Keep edits to that block additive (append a
> line), and ping `@phaser` for anything **structural**. _(Context: a `menu_background` sweep
> across menu scenes is in flight 2026-06-07 and touches this block.)_

> 🎯 **Quality & polish — standing priority (user, 2026-06-06).** Beyond new features,
> **many existing functions need substantial polishing.** Every agent should budget each
> pass for hardening/refining what's already shipped, not only net-new work. Candidate
> areas: mobile controls (task above), combat UX/feel + AI-latency feedback, spirit-chain
> throw feedback, the shop scene, monster/tile visuals, scene transitions, audio (minimal
> pass so far), onboarding, and error/edge-case UX. `@coordinator`: fold per-feature polish
> sub-tasks into the phases as they're identified.

> ✅ **Migration LANDED via compat shim** (`@phaser`, 2026-06-06):
> `src/compat/kaboomShim.js` re-exposes the `k.*` API on Phaser 3, so all 14 scenes + 3 render
> modules work **unchanged — no scene rewrite**. `kaboom` removed from `package.json`;
> `src/main.js` imports the shim. Verified: `npm run build` + 122 tests green, and a headless
> Playwright smoke confirmed title / characterSelect / bestiary (immediate-mode grid) /
> onlineLobby (DOM input) / **onlineGame** (camera, textured tiles, character draw, HUD,
> minimap, movement) all render correctly. Collision zone stays narrow: `@phaser` owns
> `src/compat/*`, the `src/main.js` import, and `index.html`. **`@feature`/others MAY keep
> editing `src/scenes/*` / `src/render/*`** — but only using the `k.*` surface the shim
> supports (need a new `k.*` call? ping `@phaser` to add it to the shim, don't edit the shim
> yourself). Pure-logic `src/engine/*` + `server/*` remain the safest lane.
> _Follow-up (out of scope): idiomatically refactor the hot scenes (`game`, `onlineGame`,
> `fight`) to native Phaser Sprites/tweens for batched-renderer perf; eventually retire the shim._

---

## Locked decisions

| Decision | Choice |
|---|---|
| Rendering | **Phaser 3** — migrated off Kaboom.js (landed 2026-06-06 via the `k`-compatible shim `src/compat/kaboomShim.js`; `kaboom` dep removed). Procedural shapes, no PNGs. |
| Multiplayer | **Real online multiplayer**, authoritative server, ≤16 players/round, **free-for-all (no allied teams)**. |
| Combat model | **Instanced duel** (others keep moving); **PvE vs wild monsters + FFA PvP**; some monsters hidden. |
| Combat resolution | **AI-judge-resolved (core)** — the judge LLM resolves turns **and catch success, status effects, and elemental interactions**; **no predefined catch rates / status taxonomy / element-matchup tables** (user 2026-06-06, see Direction-shift note). Deterministic `engine/combat.js` kept only as a minimal no-key/offline safety net (⚠️ cannot reproduce AI-judged catch/status/elements). Research: finetune a small model on live transcripts. |
| Monster visuals | Procedural (done — `src/systems/spritegen.js`). |
| Content data | AI-generated, **persisted to DB**; generate-on-empty, then **~90% reuse** (monsters, biomes, tiles…). |
| Hosting | **Railway** — server + DB + client. |
| Auth | **Anonymous + nickname** first → Google/Discord → (later) native. |
| Map | Keep DLA + Voronoi biome gen; rework tile rendering + map view. |
| Status effects | **No taxonomy** — the judge LLM interprets/applies statuses during fights (user 2026-06-06; `STATUS_TAXONOMY.md` shelved). Same principle now extends to **catch + elements** (see Combat resolution + Direction-shift note). |
| Viewport / orientation | **Square in-game window + portrait support** (user 2026-06-08). The round camera fills the canvas; a centered **square** (`min(W,H)`) is the canonical play area with the **map shown outside it** (peripheral context scaling with resolution). **Portrait is supported** (one square-anchored layout serves both orientations). Phased rollout = **WIN-T1…A1**; geometry in `src/render/playWindow.js`. |

> 🔀 **DIRECTION SHIFT (user, 2026-06-06): the judge LLM resolves it all — strip predefined taxonomies.**
> Three coupled changes (`@unassigned` — needs `@feature`/`@coordinator` split; confirm scope):
> 1. **Elements → freeform, AI-assigned.** Remove the fixed `GAME.ELEMENTS` taxonomy
>    (Fire/Water/Nature/Dark/Light/Neutral) + hardcoded matchup tables; monsters carry an
>    AI-assigned element string and the judge weighs interactions. UI (`ui/theme.js`
>    `elementColor`, element dots) must accept **arbitrary** element strings (hash→colour
>    fallback). Touches `engine/combat.js`, `schemas.js`, `server/ai.js`/`gen.js`/`prompts.js`, `ui/theme.js`, wiki `#elements`.
> 2. **Catch → judge-decided.** Remove predefined catch math (`chainCaptureChance` / `resolveCatch`
>    rates); the judge resolves capture during combat (chain tier may be a *hint* in the prompt, not a formula).
> 3. **Status → judge-decided** (already "no taxonomy"; drop the deterministic engine's canonical statuses too).
> ⚠️ **Implication — needs your ack:** this makes combat **AI-dependent**. The deterministic
> `engine/combat.js` (the locked "offline fallback + training baseline") can't reproduce judged
> catch/status/elements. Pick: **(a)** engine keeps crude defaults *only* so no-key/offline doesn't
> crash, or **(b)** combat requires the AI (like PvP already does). Several `engine/combat.test.js`
> assertions (catch/status/element math) will be removed/rewritten. **Also update `public/wiki.html`**
> (#elements/#combat/#taming/#status) when these land.
> 🔤 **Font (same burst):** switch in-game + page font from **Chakra Petch → a clean modern sans**
> (user pick). `main.js` `loadFont("gameFont"/"gameFontBody")` + `index.html` `@font-face` (`@phaser` lane) +
> CSS `body` in wiki/admin. Use a bundled clean sans (e.g. Inter) or system-ui stack.

> ✅ **DONE (2026-06-06): migrated Kaboom.js → Phaser 3.** The user chose Phaser; the
> migration is **complete and verified** (build + 122 tests + headless render smoke). This
> **supersedes** `docs/ENGINE_EVALUATION.md` (which had recommended KAPLAY — now moot).
> **All agents, read before touching rendering:**
> 1. Migration uses a **compat shim** (`src/compat/kaboomShim.js`) that re-exposes the `k.*`
>    API on Phaser, so scenes work unchanged (**no rewrite**). `@phaser` owns `src/compat/*`,
>    the `src/main.js` import, and `index.html`. Others may keep editing scenes but must use
>    only the `k.*` surface the shim supports.
> 2. The shared `src/engine/*` (pure logic, **no engine dependency**) and all of `server/*`
>    are **unaffected** — safe to keep building features there.
> 3. **Do not start a parallel/duplicate engine swap.** One agent owns it.
> 4. `kaboom` has been **removed** from `package.json`; `phaser` is the rendering dependency.

## Critical architectural shift

The current game is **client-only single-player**: all state in `localStorage`,
all logic in the browser, `Math.random()` everywhere. Real multiplayer requires
an **authoritative server** that owns state and validates everything (it's PvP
with loot — clients cannot be trusted). This is the backbone of the whole plan.

```
┌─────────────┐   WebSocket    ┌──────────────────────┐
│  Browser    │ ◄────────────► │  Authoritative server │
│  (Phaser    │   snapshots /  │  (Node.js)            │
│   renderer  │   inputs       │  - matchmaking/lobby  │
│   + input)  │                │  - map gen (seeded)   │
└─────────────┘                │  - world tick         │
                               │  - combat (AI eval)   │
                               │  - persistence (DB)   │
                               └──────────────────────┘
```

---

## RESOLVED DESIGN DECISIONS (2026-06-06)

All previously-open questions are answered (full text in `docs/REQUIREMENTS.md §4`):

1. **Combat world model** → instanced duel (others keep moving).
2. **PvP** → free-for-all, no allied teams; PvE vs wild monsters; some hidden.
3. **AI combat** → AI resolves fights (core feature); deterministic engine is the
   offline fallback + training-data baseline; research a small finetuned model
   trained on live big-model transcripts.
4. **Content generation** → persist all generated content to the DB; generate-on-
   empty, then ~90% reuse (monsters, biomes, tiles…). Per-category quotas TBD.
5. **Hosting** → all on Railway (server + DB + client).
6. **Auth** → anonymous + nickname first → Google/Discord → native later.
7. **Status effects** → no taxonomy; the AI interprets/executes statuses during
   fights. `docs/STATUS_TAXONOMY.md` is shelved (deterministic fallback keeps its
   4 canonical statuses for offline only).
8. **Energy between fights** → partial reset per encounter (revisit later).
9. **Vault on defeat** → acceptable (vault not reachable mid-run).

---

## Phases & tasks (in sequence)

Legend: `[ ]` todo · `[~]` in progress · `[x]` done

### P0–P4 — Foundations → server → networking → combat → extraction ✅ COMPLETE
The whole core loop shipped 2026-06-06 and is live: deterministic shared `engine/` +
schemas (P0), WS server + lobby/matchmaking + Postgres persistence + Railway deploy
(P1), networked map + AoI snapshots + server-authoritative monsters (P2), instanced
AI-resolved combat + taming + FFA PvP (P3), and the extraction round (timer, shrinking
zone, portals, death stakes) (P4). **Full task-by-task detail archived in
[`docs/IMPLEMENTATION_ARCHIVE.md`](IMPLEMENTATION_ARCHIVE.md)** to keep this plan lean.

### P5 — AI content generation pipeline
Independent. **Q4 resolved:** persist all generated content to the DB;
generate-on-empty, then ~90% reuse. Covers monsters, biomes, floor tiles.

- [~] **P5-T1** Generator core shipped & unit-tested (`server/gen.js`, PR #34):
      `normalizeGeneratedMonster` turns arbitrary LLM JSON into a clamped,
      schema-valid `MonsterType` (consumable by `getMonsterStats`/combat);
      `assignAttacks` gives it 4 attacks from the existing pool (v1 reuses
      attacks — bespoke attack generation is later); `aiGenerateMonster` does the
      live OpenAI call, **gated by `aiEnabled()`**. **Wired live (PR #46):**
      `server/content.js` generates → adds to the pool → persists to Postgres
      (`monster_types` table); a `/api/monstertypes` endpoint + client fetch
      (`data.js`) make generated monsters render their procedural sprites.
      **Generation is gated by `MONSTER_GEN_RATE` (default 0 = off)** — set it on
      Railway (e.g. `0.1`) to enable (costs OpenAI per generation).
- [x] **P5-T2** Reuse policy (`pickReuseOrGenerate`, PR #34): empty pool → generate;
      populated → ~**90% reuse / 10% new** (Q4). Live trigger: per round, with
      probability `MONSTER_GEN_RATE`, generate+persist one new monster (PR #46).
      Per-category quotas later.
- [~] **P5-T3** Generated data → procedural visual (already deterministic from
      name/element in `spritegen.js`). **Bestiary gallery** added (PR #35): a
      scrollable grid of every monster's procedural sprite (name/element/rarity),
      reachable from the start menu — art review + generated-content curation.
      Remaining: an approve/reject workflow once live generation persists to the DB.

- [~] **P5-T4** **Monster generation pipeline v2 — multi-agent (user spec 2026-06-07).**
      A staged, LangChain-driven pipeline. Replaces the single `aiGenerateMonster` call.
      > 🚧 **In progress (`@visual`, user-directed 2026-06-08).** ✅ **Increment 1 — pipeline
      > foundation (`94c9e22`):** `server/genPipeline.js` — a **pure orchestrator** `runGenPipeline()`
      > that runs Idea→Attributes stages as **injected** async fns (deterministic mocks in tests, live
      > LangChain stages in prod), threading each stage's structured output into the next and finishing
      > through the existing `normalizeGeneratedMonster`+`assignAttacks`. Ships the Stage-1 `IDEA_SCHEMA`
      > + Stage-2 `ATTRIBUTES_SCHEMA` (built from the engine stat set so it can't drift) structured-output
      > contracts + `coerceIdea`. New leaf module (imported by nothing yet → zero regression risk); +5
      > tests, 378 green. ✅ **Increment 2 — live LangChain stages (`@visual` 2026-06-08):**
      > `server/genStages.js` — `makeLiveStages()` provides the real Idea + Attributes stage fns that
      > plug into `runGenPipeline`, each using LangChain **`withStructuredOutput`** against the stage
      > schemas, with **model + genTemperature from `aiconfig.js`** and **all four prompts from
      > `prompts.js`** (new `genIdeaSystem/User` + `genAttributesSystem/User`, admin-editable). Added
      > `@langchain/openai` (server-only; client bundle unaffected) loaded via **dynamic import** in the
      > chat factory, which is **injectable** (`deps.createChat`) so tests mock it — no key/network/dep
      > needed in CI. `aiGenerateMonsterV2(opts)` = the gated entry. 4 tests (structured invoke, idea+hints
      > threaded into prompts, full pipeline → valid MonsterType); 382 green, build+lint clean.
      > ✅ **Increment 3 — wired into `content.js` (`@visual` 2026-06-08):** `generateMonster()` now routes
      > to `aiGenerateMonsterV2` when **`MONSTER_GEN_PIPELINE=v2`** (else the unchanged single-call v1) —
      > both `aiEnabled()`-gated, same MonsterType|null contract, so persistence/pool/bestiary flow is
      > identical. The pipeline is now **reachable in prod**: set `OPENAI_API_KEY` + `MONSTER_GEN_RATE`>0
      > + `MONSTER_GEN_PIPELINE=v2` on Railway. Default unchanged → zero regression.
      > ✅ **Stage-3 Model agent CONTRACT (`@visual` 2026-06-08, `897e86e`):** `genPipeline.js` adds
      > `MODEL_SCHEMA` (`bodyShape` constrained to the renderer's existing silhouette archetypes
      > beast/raptor/saurian/leviathan/arthropod/brute + palette/features + a small fixed **idle/attack**
      > animation spec), defensive `coerceModel()`, and an **OPTIONAL** injected `stages.model` run last in
      > `runGenPipeline` (ctx {idea, monster} → coerced spec attached as `monster.model`). Backward-compatible
      > (Idea+Attributes-only callers untouched). +3 tests, 385 green.
      > ✅ **Stage-4 Review (live) DONE (`@visual`/live-layer 2026-06-08):** `genStages.js` adds
      > `REVIEW_SCHEMA` (approve/patch verdict — `changes` carries ONLY the fields to edit, honoring the
      > spec's "edit-only, token-budget" rule), `reviewMonster()` (LangChain structured-output review using
      > the new admin-editable `genReviewSystem`/`genReviewUser` prompts), and pure `applyReview()` —
      > merges `changes` then **re-normalizes** (`normalizeGeneratedMonster` is the whitelist+clamp, so
      > unknown/out-of-range edits are dropped/clamped) while **preserving attacks + id**. Wired into
      > `aiGenerateMonsterV2` behind **`MONSTER_GEN_REVIEW=1`** (opt-in, extra LLM call; failures keep the
      > unreviewed monster — never blocks gen). +4 tests (approve no-op, clamp/preserve, drop-unknown,
      > structured invoke); 389 green, build+lint clean.
      > ✅ **Stage-3 Model (live) DONE (`@visual`/live-layer 2026-06-08):** `genStages.js makeLiveStages`
      > now optionally provides the live **model** stage — LangChain structured output against the sibling's
      > `MODEL_SCHEMA`, prompted by new admin-editable `genModelSystem`/`genModelUser`, fed `{idea}`+
      > `{monster}`. `runGenPipeline` runs it → `coerceModel` → `monster.model`. Opt-in via
      > **`MONSTER_GEN_MODEL=1`** (extra LLM call; off by default since the renderer doesn't consume
      > `monster.model` yet). +1 test. 390 green. **All four agent stages now have live impls.** **Next:**
      > (a) the **renderer** reading `monster.model` (bodyShape/palette/features/idle+attack — spritegen +
      > in-round bob/lunge), and (b) **persist `monster.model`** so it survives reload (P5-T1/2/3 DB schema).
      > _Lane split to avoid collision: `@visual`-this-loop owns the **pure** layer (`genPipeline.js`
      > schemas/coercion/orchestration + tests); the concurrent agent owns the **live-LLM** layer
      > (`genStages.js`) + `content.js`/DB wiring._
      - **Model:** **GPT-5.4** for now (default for the gen agents). All model params
        (model, temperature, etc.) live in the **admin zone settings** (`aiconfig.js` /
        `/admin`) — already the home for model+params; extend as needed.
      - **All prompts editable in the admin settings** (`prompts.js` / P7-T5) — one prompt
        per agent below.
      - **Structured outputs everywhere:** every agent uses LangChain's **structured-output**
        feature (`withStructuredOutput` + a Zod/JSON schema) — no ad-hoc JSON parsing.
      - **Stage 1 — Idea agent:** defines a rough concept (theme/vibe/role) → structured idea.
      - **Stage 2 — Attributes agent:** translates the idea into the monster **attributes**
        (reuse the existing `MonsterType` schema — element, rarity, base stats + scalings,
        passive/active effects; keep it **lean** for now; check the old game version only if a
        useful attribute is missing).
      - **Stage 3 — Model agent:** builds the **character model** (procedural visual).
        - Define a **small fixed set of animations per creature** (e.g. **idle**, **attack** —
          only a few) that the model agent also produces.
      - **Stage 4 — Review agent:** reviews the generated monster. **MUST NOT re-output the
        full code/attributes** — it issues changes only via an **edit/replace tool** (token
        budget). 
      - **Persist** the result (DB) + wire into the existing pool/bestiary (P5-T1/T2/T3).
      - Supersedes the standalone "LangChain for monster gen" + "newest models" ownership rows.
- [~] **P5-T5** **Visual direction: brutal, not cute (user 2026-06-07).** ⚠️ An agent's
      "expressive faces" pass (`3b360d6`) had skewed monsters *cuter* (eye styles
      `round/round/cute/fierce/sleepy` + a friendly smile) — **against this directive.**
      ✅ **`@coordinator` reweighted `spritegen.js drawEyes` toward menacing**: styles now
      `fierce×3 / sleepy / round` (no "cute") + default mouth is a **scowl, not a smile**
      (168 tests + build OK). ✅ **`@visual` deepened the menace 2026-06-07** (`spritegen.js`):
      **reptilian slit pupils + heavy angled brows + bared fangs** on fierce, small cold
      pupils + low brows + scowls on the rest, **subtle eye asymmetry**, and an occasional
      **battle scar** (clipped slash + stitch ticks); removed the dead `"cute"` branches so
      it can't re-creep. Verified at face-scale via new `tools/shoot-faces.mjs` (close-up
      DSF=2 bestiary capture); 168 tests + build OK. **Remaining:** harsher
      silhouettes/palettes (⚠️ palette shifts risk element readability — a taste call, wants
      user steer) + the Stage-3 model agent (P5-T4). **`@visual`/`@feature`: keep new monster
      art menacing — don't re-add cuteness.**

### P6 — Polish, scale, anti-cheat
Ongoing / late.

- [x] **P6-T1** Reconnection + graceful disconnects (Q12). **Server** (PR #43): a
      dropped in-round player keeps their slot for a **120s** grace window; reconnect
      with the token resumes the round at the current position; no return in 120s →
      **death** (lose active team, per Q10). **Client** (PR #45): auto-reconnects in
      place (retries every 2s up to 120s, auto-re-joins with the token) showing
      "Reconnecting…", and only falls back to "Connection lost → menu" after giving
      up — no menu bounce. _2026-06-06._
- [~] **P6-T2** Anti-cheat audit (PR #30). Verified server authority: movement is
      direction-only at server `BASE_SPEED` (`clampAxis` guards NaN/±Inf), nick/
      inputs sanitized, combat actions ownership-checked. Fixed: combat now honors
      **only the monster's own attacks** (`ownedAttack`; was any global attack) and
      player positions are **clamped to the map**, and **tile collision** added
      (PR #31, slide-along-walls — walls were cosmetic before). Remaining:
      per-connection rate limiting. _2026-06-06._
- [x] **P6-T3** HUD/UX for multiplayer. Done (PR #29): **team-HP bars** (live,
      from `you.team` in snapshots), **outside-safe-zone danger warning** (pulsing
      red border + text), zone timer + players-in-view (info line), and the
      minimap (P2-T5). ✅ **Closed 2026-06-08 (`@visual`):** the two "remaining" bits
      both shipped and are verified in code — the **kill feed** renders from
      `net.state.killfeed` (`onlineGame.js:~500`, server broadcast P8-T5) and the
      **player list** names AoI-filtered rivals-in-view (`onlineGame.js:~782`). Stale
      `[~]` → `[x]`. _2026-06-06 / 2026-06-08._
- [x] **P6-T4** Load/perf test 16 players; optimize snapshot bandwidth (`@coordinator`).
      **(1) Bandwidth guard** (`server/perf.test.js`): pins per-player payload + 16-player
      aggregate so AoI/field bloat fails CI. Baseline: lone player ≈488 B/snapshot; worst-case
      clustered 16-player round = max ≈1.2 KB/snapshot, ≈18.4 KB/broadcast (~141 KB/s out).
      **(2) Load harness** (`tools/loadtest.mjs`): drives the real world API with 16 simulated
      players moving every tick; measures `tickWorld` wall-clock vs the 15 Hz budget. **Result:
      avg 0.10 ms/tick (~0.15% of the 66.7 ms budget), p95 0.23 ms** — huge CPU headroom; no
      optimization needed. Both bandwidth and CPU comfortably clear the 16-player target.
      _2026-06-06._
- [ ] **P6-T5** Audio, settings, final art pass.
- [~] **P6-T6** **Mobile + PWA** (lower priority). Done: onscreen joystick +
      tappable combat buttons; mobile HTML nickname input; **PWA — manifest +
      service worker + SVG & PNG (192/512) icons + iOS apple-touch-icon +
      standalone meta** (installable; no-zoom). **Responsive layout (2026-06-06):**
      game canvas stays letterboxed 1280×720 (crisp) — clean fit for 16:9/16:10
      desktop (1920×1080, 1366×768, 1536×864, 2560×1440…) and mobile-landscape;
      CSS-only "rotate your device" overlay for touch users in portrait (game is
      landscape-only); manifest `orientation: landscape`; `touch-action: none` +
      safe-area insets on the game page; `@media` polish so `/admin` (stacked
      settings) and `/wiki` (collapsing sidebar, scrollable tables) fit phones.
      Remaining: single-player touch. (`scripts/gen-icon.mjs` regenerates the PNGs
      from the SVG via `npm i sharp --no-save`.)
- [x] **P6-T7** **UI pass** (user feedback): **white text** across all scenes —
      online lobby + game HUD/combat, and start / characterSelect / lobby /
      inventory / settings / runResult. Functional colors kept (HP bars, win/lose,
      delete-warning, element/status). _2026-06-06._

- [~] **P6-T8** **Separate game server (readiness).** Server runs WS-only via
      `SERVE_STATIC=false` (else combined, default); client already uses
      `VITE_SERVER_URL` (else same-origin); optional `ALLOWED_ORIGINS` guard. Live
      deploy stays combined for now — splitting is a config flip when scale needs it
      (the real work then is stateful round-routing). Steps in `REQUIREMENTS.md §7`.
      _2026-06-06._

### P7 — Admin panel (requested 2026-06-06)
An admin-only page (auth-gated — see Q14) with two areas. **Keep it continuously
updated**: whenever a new game parameter or generated asset type is added, surface
it here. Build incrementally.

- [x] **P7-T1** **Auth gate** (PR #49): `server/admin.js` gates `/api/admin/*` on an
      `ADMIN_TOKEN` env var (page prompts → `x-admin-token` header → server verifies;
      503 if unset, 401 if wrong). Q14 resolved (token, no user roles yet).
- [~] **P7-T2** **Settings editor** (PR #49): `public/admin.html` reads/writes the
      live-tunable `world.cfg` — players/round, round duration, circle-start, portal
      interval, `MONSTER_GEN_RATE`, `PVP_ENABLED` — validated/clamped server-side,
      applied to new rounds at runtime, and **persisted to Postgres** (`settings`
      table, reloaded on boot, override env). **Expanded (PR #50):** gameplay knobs
      now tunable too — player speed, storm DPS, encounter radius, hidden-monster %,
      energy-restore %, PvP radius (moved into `world.cfg`). Remaining: a few niche
      radii (AoI/reveal/extract) + structural consts (map/tile size) are kept fixed
      (seeded-gen/client-sync critical).
- [x] **P7-T3** **Generated-asset overview + curation** (PR #49, #52): the admin
      page lists AI-generated monsters and supports **generate-on-demand** and
      **remove** (drops from the pool + DB; guarded to generated types only).
      Procedural art for every monster is viewable in the **Bestiary** (linked).
      _2026-06-06._
- [x] **P7-T5** **AI prompt editor** (PR #55): every AI prompt (combat system,
      monster system + user) is editable in the admin panel and DB-persisted
      (`server/prompts.js` single source + override layer; `ai.js`/`gen.js` read
      via `getPrompt`; `{hints}` slot for targeted gen). _2026-06-06._
- [x] **P7-T6** **Generation test + asset browser** (PR #55): "Generate one now"
      shows the full generated record (saved to DB); the generated-asset list is
      click-to-inspect (full JSON) — browse everything the pipeline made. _2026-06-06._
- [x] **P7-T7** **Admin security** (PR #55): constant-time token compare
      (`timingSafeEqual` over SHA-256) + brute-force throttle (lock after repeated
      failures). Admin API is header-token gated (no CORS → no cross-origin/CSRF).
      Set a strong `ADMIN_TOKEN`. _2026-06-06._
- [x] **P7-T4** **Live ops view** (PR #51): admin panel polls `/api/admin/stats` —
      players online, queue, active rounds (per-round players/monsters/time), active
      combats + duels, monster-pool size, and recent run results (`world.recentResults`
      ring buffer). Read-only, ~3s refresh. _2026-06-06._

### P8 — Post-completion depth & polish (proposed 2026-06-06)
The P0–P7 plan is built & live. With the core complete, these deepen the meta-loop
and polish the experience. (decision-free = I can build now; ⓭ = wants your input.)

- [x] **P8-T1** **Player progression stats** (PR #53) — per-profile `stats`
      (runs/extractions/deaths/caught/pvpWins) bumped at the round/combat/PvP events,
      persisted with the profile, sent in `welcome` + the extracted/died messages,
      and shown on the round-result screen. Foundation for a leaderboard (P8-T4).
      _2026-06-06._
- [x] **P8-T2** **Online roster / vault management** (PR #57) — between rounds, view
      your collection (grown by taming + PvP loot) and pick your active 4. Server:
      `vault` in `welcome`; `getRoster`/`setRoster` + `applyRoster()` (idle-only,
      dedupe, ≥1 active, capped, persisted). Client: new `roster` scene (active 4 +
      scrollable vault, tap to field/store, HP bars), reached via the online lobby's
      "Manage Team" button. Themed with the new `src/ui/theme.js` design system.
      _2026-06-06._
- [x] **P8-T3** **Round-end gains summary** (`@visual`, 2026-06-06) — server snapshots a
      run-start baseline (caught / team XP / levels / time) at `generateRound` and diffs it
      in `endRunForPlayer` (before the death team-swap), sending a `gains` object in
      extracted/died. Client shows a **"THIS RUN · Caught N · +X XP · Y level-ups · survived
      M:SS"** line on the result overlay (lifetime stats relabeled "LIFETIME"). Tested
      (`server/gains.test.js`); in the working tree. _decision-free._
- [x] **P8-T4** **Leaderboard** (PR #54) — `store.topProfiles` ranks the in-memory
      profiles by a stat; public `GET /api/leaderboard` (top extractors + PvP wins);
      "TOP EXTRACTORS" shown on the start menu. _2026-06-06._
- [x] **P8-T5** **Kill feed** — round-event feed in the MP HUD (flexible worker verified
      2026-06-07: fully wired end-to-end). Server broadcasts a `killfeed` message on every
      run-end cause — `pvp` (`pvp.js`), and `extracted`/`timeout`/`zone`/`disconnect`
      (`world.js endRunForPlayer`) — to the survivors still in the round. `net.js` keeps the
      last 6 events; `onlineGame.js drawKillFeed()` (called in the draw loop, hidden during
      the result overlay) renders them right-aligned under the minimap with a per-cause color
      tick + backing strip, fading after ~4s. Delivery unit-tested (`world.test.js`).
- [ ] **P8-T6** **Audio** — procedural SFX (hit, catch, extract, portal) + a mute
      toggle. _somewhat subjective — confirm you want sound._
- [x] **P8-T7** **Per-connection rate limiting** (PR pending) — token bucket per WS
      connection (`server/ratelimit.js`, default 50 cap / 30 tokens·s⁻¹, well above
      legit ~20 msg/s play); over-budget messages dropped, socket closed after 100
      sustained drops. Also a 64 KB `maxPayload` DoS guard. Env-tunable
      (`RL_CAPACITY`/`RL_REFILL`/`RL_MAX_VIOLATIONS`/`WS_MAX_PAYLOAD`). _2026-06-06._
- [ ] **P8-T8** **How-to-play / onboarding** overlay for first-time players.
- [x] **P8-T9** **Floor-tile detail** (user request 2026-06-06; in working tree) — the
      online map view drew each tile as one flat `colorProfile_full` rect, discarding
      the per-side edge colors AND the `rotation` the tile data carries, so floors
      looked featureless. New `src/render/tiles.js` generates a textured sprite per
      tile *type* (grain + directional light + top/bottom/left/right edge shades),
      cached by id and drawn at the tile's rotation, with a flat-color fallback while
      a type's sprite loads — still 1 draw/tile (same cost as the flat rect). Wired
      into `onlineGame.js`. _Follow-up: SP `game.js` uses a separate `imagePath`
      sprite system with a flat-green fallback; unify it onto this generator._

### P9 — Spirit Chains & loot (shipped; tracking added by coordinator 2026-06-06)
Core throw/capture verb + chest loot economy. Built, tested (117 green), and fully
specced in `public/wiki.html#chains` — this section back-fills the plan so the
task source-of-truth matches what's live. Engine math is the pure shared module
`src/engine/spiritchains.js` (9 tests); defs in `public/assets/data/spiritchains.json`;
tunables in `GAME.SPIRIT_CHAIN`; client render `src/render/spiritchain.js`.

- [x] **P9-T1** Throw-to-engage with **initiative**: aiming + throwing a chain on
      the overworld (`Q` throws along facing, `[` / `]` cycle) starts combat with
      the **thrower acting first**; walking into a monster still starts combat but
      the monster acts first. _2026-06-06._
- [x] **P9-T2** Two per-chain resources: `throwCount` (overworld throws, spent on
      every throw) + `durability` (capture charges, spent only on success; chain
      consumed at 0). `canThrow`/capture math in `spiritchains.js`. _2026-06-06._
- [x] **P9-T3** Tiered capture: 5 base tiers + 3 top specials (Eternal Coil =
      endless throws, Sovereign Bind = guaranteed ≤25% HP). Capture chance scaled
      by tier multiplier + a **rarity gate** (chain `maxRarity` auto-fails too-rare
      targets). In-combat catch via `chainCaptureChance`. _2026-06-06._
- [x] **P9-T4** **Loot chests** (`server/world.js`): 10/round, server-authoritative
      + seeded, wall-adjacent, 1–2 chains weighted by `dropWeight` (`rollChainDrop`),
      opened within 40px, minimap blip ≤420px. Starter Frayed Chain granted +
      back-filled on old saves. _2026-06-06._
- [x] **P9-T5** **Extraction stakes**: chest-found chains are provisional
      (`runFound`) — banked on extract, lost on death/timeout; starter + previously
      banked chains always safe; refills of banked chains not at risk. _2026-06-06._
- [ ] **P9-T6** **Hydra Lash multi/area capture** — chain nearby monsters
      (multi-capture queue). _Deferred (per project notes)._
- [x] **P9-T7** **Gold shop** — SHIPPED: spend run-earned gold on chains between runs.
      SP scene `src/scenes/shop.js` (wired in `main.js` + lobby "Spirit Shop" button);
      server-authoritative `buyChain` in `world.js` (idle-only, deducts gold, banks the
      chain permanently — not `runFound`); engine `buyChain` in `schemas.js`; covered by
      `world.test.js`. _2026-06-06._
- [ ] **P9-T8** **Crafting** — craft chains from in-run materials. _Planned._

### P10 — Single-player ↔ multiplayer parity & code standardization (user-requested 2026-06-06)
SP (`src/scenes/game.js`, `fight.js`, client `systems/combat.js`, `localStorage`) and MP
(`src/scenes/onlineGame.js`, `onlineLobby.js`, server-authoritative) grew in parallel and
have **drifted**. Goal: one behavior, one implementation — audit every difference, close the
gaps, and push duplicated logic into shared modules so a fix lands once. **Deliverable:** a
gap matrix + the refactors below; each gap is either reused, intentionally documented as
SP-only/MP-only, or fixed.

- [x] **P10-T1** **Audit** — SP-vs-MP gap matrix done (`@coordinator` 2026-06-06):
      - **Shared & healthy (no drift):** combat turn + catch resolution (`engine/combat.js`
        `resolveTurn`/`resolveCatch`), chain capture math (`spiritchains.js`), `grantChain` /
        `finalizeRunChains` / `goldForDefeat` / `buyChain` (`schemas.js`), `rollChainDrop`.
      - **Duplicated logic (drift risk):** `grantXp` (SP hardcoded `100` vs server
        `GAME.XP_PER_LEVEL`) — **FIXED, see T4**; `isWalkable` collision; encounter trigger;
        `spawnPortal`. Extraction candidates.
      - **SP missing vs MP (gaps):** textured tiles (SP flat-color — T2); **team heal on
        extract** (MP heals, SP only grants gold — confirmed bug, T3); structured run gains
        (SP narrative only — T5); in-run audio / onboarding / kill-feed (MP-only); seeded RNG
        in overworld (SP uses `Math.random`).
      - **UI:** `fight.js` uses `theme.js`; `game.js` + `onlineGame.js` hardcode colors (T6).
- [x] **P10-T2** **Tile render unify** — ✅ **DONE** (`@coordinator` 2026-06-06): SP `game.js`
      `drawTiles` now delegates the floor to the shared `render/tiles.js` `drawTiles`
      (`makeTileCache` at scene setup) — SP gets the **textured floor + cave void/wall-border**
      identical to MP, and the per-tile flat-rect + `generateTileSprite` preload path is gone
      (dedup). Monster-on-tile overlay kept. Build + 152 tests + `shoot-sp` (lobby/world/move,
      no console errors) verified. Closes the "Void texture" SP follow-up.
- [x] **P10-T3** **Run-end stakes parity** — ✅ **DONE 2026-06-07.** (1) The heal gap is
      closed — both paths heal survivors on extract via the shared `healTeam`. (2) **Shared
      run-end helper extracted** (`engine/progression.js`): `grantExtractRewards(profile)` now
      heals the team **and** banks the extract gold bonus in one place, replacing the
      `Math.round(GAME.GOLD.PER_EXTRACT * goldMult(profile))` formula that was copy-pasted in
      SP `game.js` (`endRunStakes`) and server `world.js` (`endRunForPlayer`) — the two can no
      longer drift on the extract reward. `finalizeRunChains` stays caller-side (it injects each
      mode's chain lookup). Unit-tested (`progression.test.js`: `extractGold` + `grantExtractRewards`),
      build green. **Follow-up landed 2026-06-07:** the remaining per-event reward formulas were also
      duplicated SP↔MP — now consolidated into `progression.js` (`defeatGold` / `defeatEssence` /
      `chestEssence`), replacing the copy-pasted `Math.round(goldForDefeat(lvl)*goldMult)` /
      `Math.round(ESSENCE_PER_*·essenceMult)` math in `fight.js`, `game.js` and `world.js` (3 helpers,
      6 call sites). All reward multipliers now have one source. Tests added; 229 green.
- [x] **P10-T4** **Combat path parity** — ⬆️ **superseded by FGT-T1 (`@combat`, 2026-06-07):** combat is
      now AI-only and fully unified — SP `systems/combat.js` no longer resolves turns locally; it routes
      through the server's shared `aiTurn` judge (the same path as MP `combat.js`), with `engine/combat.js`
      kept only as a transient crash-net. SP↔MP combat parity is proven in `server/combat.parity.test.js`.
      _(The original note below — "both delegate to the engine resolver; the fallback == the server path" —
      described the pre-FGT-T1 architecture; kept for history.)_ **`grantXp` extracted to `src/engine/progression.js`**
      (`@coordinator`, unit-tested) — both call sites import it; kills the duplicate + the SP
      hardcoded-`100` drift. **Reward formulas consolidated too (2026-06-07):** `defeatGold`/
      `defeatEssence`/`chestEssence` now shared from `progression.js` (was copy-pasted in
      `fight.js`/`game.js`/`world.js`) — combat/loot reward math can't drift. _2026-06-06 / 2026-06-07._
- [x] **P10-T5** **Feature parity** — decide + close gaps where one mode has a feature the
      other lacks (e.g. P8-T8 onboarding is MP-only; SP chests/shop parity), or document the
      asymmetry as intentional. **Closed so far (flexible worker, 2026-06-07):** heal-on-extract
      (P10-T3), heal-on-run-start (PT2-T04), reward formulas (P10-T4/T5), body-radius collision
      (PT2-T06), and **storm/zone damage** — the SP shrinking safe-zone was purely *cosmetic*
      (no damage), while MP chips your team at `STORM_DPS`; SP now applies the same via the shared
      pure `stormDamageTeam` (engine/progression.js) the server also uses, ending the run on a wipe.
      Single source = can't drift. Plus **Q8 energy-restore** — MP restores a fraction of each team
      monster's energy at every encounter (`restoreEnergyPartial`) so a depleted team isn't stuck
      skipping turns; **SP only reset the *enemy's* energy**, leaving the player's team drained between
      back-to-back fights → could soft-lock. SP `fight.js` now applies the same breather; the % is the
      shared `GAME.ENERGY_RESTORE_PCT` (server default reads it too) so they can't drift on the value.
      Plus **hidden/ambush monsters (Q2)** — MP starts ~35% of wild monsters hidden, revealing them only
      within `REVEAL_RADIUS`; **SP drew every monster always** (no ambush). SP `game.js` now hides the
      same fraction using the *identical* formula — `hashString(monster.id) % 100 < HIDDEN_MONSTER_PCT`
      (the server's, and the ids are the same `m_x_y` from shared mapgen) — revealing within
      `GAME.REVEAL_RADIUS`; walking onto a hidden monster's tile still triggers the fight (the ambush).
      New shared `GAME.HIDDEN_MONSTER_PCT`/`REVEAL_RADIUS` (server defaults read them). SP-only render
      change (the SP minimap doesn't plot monsters, so nothing else to gate). ✅ **Onboarding parity
      CLOSED (`@visual` 2026-06-08, re-verified):** the "onboarding is MP-only" note was **stale** — SP
      `game.js` has a full first-run **HOW TO PLAY** overlay (`drawSpOnboarding`, control-aware, dismiss
      on move/tap, shared `tq_onboarded` key, gated like MP), landed under LS-7. **Kill-feed stays MP-only
      by design** (SP is solo vs wild monsters — no rivals to report). Both onboarding overlays also
      gained a **SPRINT — hold Shift** hint (sprint was otherwise undiscoverable). **P10-T5 effectively
      closed** — no remaining unintended SP/MP gaps.
- [ ] **P10-T6** **UI standardization** — route all SP + MP scenes through `src/ui/theme.js`
      helpers (`addButton`/`addLabel`/`THEME`); no hardcoded colors/layout (runResult/roster
      already converted — finish the rest).

---

## WIN — Square play-window + portrait support (USER DESIGN DECISION 2026-06-08)

> 🟢 **User directive (2026-06-08, verbatim):** *"enable portrait formats, and make the
> ingame window (with the map outside of it depending on resolution) a square."* Owner:
> `@visual` (render/HUD) **+ `@phaser`** (the `index.html` orientation gate + any shim/canvas
> change). This is a big cross-cutting layout change — phased so the build/prod never breaks.
>
> **The design (as built toward):**
> - The in-round **camera already fills the whole canvas** (centerOn; design height 720,
>   width = window aspect — portrait included). So the map is drawn across the entire
>   viewport already. We add a centered **SQUARE play window** (side = `min(W,H)`) as the
>   canonical play area; the map **stays visible outside** it as peripheral context that
>   grows/shrinks with the screen resolution (exactly the user's "map outside it depending
>   on resolution"). Geometry: `src/render/playWindow.js` (`playWindowRect`/`drawPlayWindow`,
>   tested) — the SAME square works in landscape (extra map L/R) and portrait (extra map T/B),
>   which is what lets portrait share one layout.
> - **Defaults chosen (tunable; flag if you want different):** peripheral map kept visible with
>   a gentle dim toward the edges + a thin frame on the square; HUD anchors to the **square's
>   edges** (consistent across all aspect ratios), not the raw canvas.
>
> **Phases:**
- [~] **WIN-T1 — Square-window geometry + frame (foundation).** ✅ `src/render/playWindow.js`
      (`playWindowRect` = centered square of `min(W,H)`; `drawPlayWindow` = peripheral dim + frame)
      + 5 unit tests, committed `76cee2c`. ✅ Wired a **frame-only** pass (dim 0 → peripheral map
      fully visible) into the in-round `onDraw` of **MP `onlineGame.js`** and **SP `game.js`**, over
      world/atmosphere + under HUD, skipped during combat/result/onboarding. Build + 357 tests green.
      **Next:** turn on a subtle peripheral dim once it won't clash with the still-canvas-anchored HUD.
- [x] **WIN-T2 — Re-anchor in-round HUD to the square.** Move the MP + SP HUD to anchor off
      `playWindowRect` instead of `k.width()/k.height()`. The crux that makes BOTH orientations lay
      out from one code path. ✅ **MP top HUD done 2026-06-08 (`@visual`, `onlineGame.js`):** the
      info line, controls hint, objective line, the **team/stamina/chain left cluster** (`TEAM_X`/
      `TEAM_Y0`), and the **minimap** now anchor to the square (`playWindowRect`) — in landscape they
      inset onto the square's corners (peripheral map fills the side margins, matching the frame +
      viewfinder corners); in portrait they'll tuck onto the square. Build + 358 tests. **Remaining:**
      danger border + final-minute timer + kill feed (still canvas-centered/edge), the **touch
      joystick/THROW/pause** widgets. Combat panel is WIN-T3. ✅ **SP HUD done 2026-06-08 (`@visual`,
      `game.js`):** matching treatment — timer + objective labels, **team HUD**, **chain/stamina HUD**,
      **minimap**, and **biome chip** now anchor to the square (world-space camera-relative for in-world
      HUD; screen-space for labels). Build + 358 tests. ✅ **Screenshot-verified (landscape) via the
      light `shoot-sp` harness (vite-only, no WS server → no orphan):** the teal frame + viewfinder
      corners render, the map fills the side margins outside the square, and the timer/objective/team/
      chain/minimap/biome HUD sit on the square with no overlap or client errors. ✅ **Touch widgets
      done 2026-06-08 (`@visual`, MP + SP):** joystick rest, THROW, and pause anchor to the square
      corners; **also fixed a latent bug** — the minimap *tap-to-zoom hit-test* (MP + SP) still pointed
      at the canvas edge after the minimap *draw* moved to the square, so taps missed; both now share the
      square geometry. The full-screen **danger border** is intentionally left at the screen edges (a
      max-visibility alert reads better full-bleed, not boxed to the square). **WIN-T2 done** (modulo the
      danger-border design call). Next: **WIN-T3** combat panel. _Portrait still gated until WIN-T3/T4._
- [~] **WIN-T3 — Combat overlay fits the square.** ✅ **MP combat panel done 2026-06-08 (`@visual`,
      `onlineGame.js`):** the combatant rows, **action-button grid** (`combatButtons()`), damage
      floaters, hit-sparks, catch sparkle, and the "Resolving…" badge now lay out within the square
      (`m = pw.x+12`, content width `pw.size-24`, centered) instead of full canvas width — so on ultrawide
      the buttons no longer stretch absurdly and in portrait they fit. The dark panel bar stays full-width
      as a clean backdrop. Draw + tap hit-test both flow through `combatButtons()`, so they can't desync.
      Build + 358 tests. ⚠️ Combat is RNG/encounter-gated so not screenshot-verified; the shared-source
      draw/hit-test makes a layout/desync regression structurally unlikely. **Remaining:** SP `fight.js`
      is a **full-screen** combat scene (not an overworld overlay), so the square-window concept is less
      applicable — left as its own screen for now (revisit if portrait makes it feel off).
- [x] **WIN-T5 — Menus/lobby in portrait — DONE 2026-06-08 (`@visual`).** Title/lobby/roster/shop/result/
      characterSelect are landscape layouts; make them reflow (or center within the square) so the whole
      app — not just the round — works portrait. Coordinate columns→stacks with `@phaser` where
      `index.html` chrome is involved. ⚠️ **Reordered ahead of T4 (`@visual` 2026-06-08):** portrait
      QA (`VW=720 VH=1280 HIDE_ROTATE=1 node tools/shoot-sp.mjs`) reached the title (guest works).
      ✅ **Better news 2026-06-08 (`@visual`, portrait screenshot of `characterSelect`):** the menus are
      **more portrait-ready than feared** — characterSelect renders correctly in 720×1280 (card, empty
      state, "+ New Character", Back all fit + center; `cardW = min(580, k.width()-80)` already adapts).
      The earlier "char-create times out" was a **harness artifact** (it clicks hardcoded *landscape*
      canvas coords, which don't map in portrait), NOT a layout break. ✅ **Shared fix:** `addHeader`
      (theme.js) now **auto-shrinks the title to the viewport width** (no-op on landscape) so scene
      titles don't overflow in portrait — fixes every themed header at once. **Remaining polish:** the
      centered title slightly overlaps the top-left "< Back" button at very narrow widths (cosmetic);
      and lobby/roster/shop/result still need a portrait eyeball (harness can't coordinate-nav them —
      needs DOM-based nav or manual check). Net: portrait menus likely "usable" already; verify the rest
      then gate (T4).
- [x] **WIN-T4 — Enable portrait — DONE 2026-06-08 (`@visual`).** Retired the `#rotate-notice`
      `@media (orientation:portrait)` "Use landscape" gate in `index.html` (now `display:none !important`;
      element kept in DOM, comment explains). **Portrait verified end-to-end in a 720×1280 capture
      (gate removed):** the HTML title scales-to-fit (logo wraps, vertical button column), characterSelect
      reflows, and the guest→charselect flow works without the notice. The canvas menus were already
      width-responsive (lobby stacks <920px; roster reflows grid cols; shop/onlineShop/runResult/charselect
      cap to `k.width()`), and the in-round view is square-anchored (T1–T3). Build + 358 tests. _@phaser:
      `index.html` is your lane — this was the user's explicit "enable portrait" directive; ping me to
      adjust. Follow-up: the MOB "portrait rotate overlay" notes are now obsolete; safe-area in portrait
      (MOB-T2) still worth an on-device pass._
- [x] **WIN-A1 — Orientation QA matrix — DONE 2026-06-08 (`@visual`).** `tools/shoot-sp.mjs` gained
      `VW`/`VH` (viewport) + `HIDE_ROTATE` envs. Captured + reviewed: **portrait 720×1280** (title scales,
      charselect/menus reflow, header clears the Back button), **landscape 1280×720** (baseline), and
      **ultrawide 2560×720** (menus stay centered at sensible widths — no stretching; the in-round square
      sits centered with wide peripheral-map margins by `playWindowRect` geometry). No clipped HUD, no
      client errors. **Per-aspect gaps:** (1) on-device **notch/safe-area** in portrait for the *menu*
      scenes is unverified (canvas menus don't apply `safeInset` like the in-round HUD does — MOB-T2);
      (2) the coordinate-based harness can't drive past charselect off-16:9, so in-round/lobby at non-16:9
      were confirmed by geometry/responsive-code review, not screenshot. **WIN feature complete (T1–T5 + A1).**

---

## PV — Visual Overhaul ("bioluminescent dark-fantasy" look)

> Driven by the user's concept art (haunted spirit-forest, glowing portal, hooded
> chain-wielder, teal-green + violet glow on near-black). Goal: make the whole game
> *look good* and cohesive. All rendering goes through the `k.*` shim → Phaser, and
> all color/type through `src/ui/theme.js`. Verify every change with the screenshot
> harness (`tools/shoot*.mjs` → `.screenshots/`). Coordinates with `@visual`
> (owns `src/render/tiles.js` + in-round QA) and P10-T6 (UI standardization).

- [x] **PV-T1** Design-system foundation — `src/ui/theme.js` "bioluminescent dark
      fantasy" palette (slate-violet base, teal + violet accents), depth components
      (`addButton`/`addPanel` with shadow + sheen + hover glow), Chakra Petch type
      scale, HiDPI sharpness (shim DPR). _Done 2026-06-06._
- [x] **PV-T2** Player character + title atmosphere — `drawCharacter` +
      `generatePlayerSprite` = hooded cloaked spirit-tamer with a glowing spirit-chain
      ring; `generateTitleBackground` = portal-forest scene. _Done._
- [x] **PV-T3** Monster shape variety + full element palettes — `spritegen.js` body
      silhouettes + per-element features for every element. _Done._
- [x] **PV-T4** **World atmosphere & lighting** — `src/render/atmosphere.js`
      (vignette sinking the edges to black + a teal spirit-light glow around the
      player + drifting spirit motes, danger-tint aware) wired into `game.js` +
      `onlineGame.js` onDraw (over world, under HUD; skipped during combat/results).
      _Done 2026-06-06. Remaining nice-to-haves: moodier per-biome tile tint +
      portal rings matching the title — fold into P10-T2 tile unify._
- [ ] **PV-T5** **UI screen consistency** (= P10-T6) — route remaining manual-rect
      scenes through theme depth components: `characterSelect`, `onlineLobby`,
      `bestiary`, `inventory`, `shop`, `roster`, `onlineShop`, `fight`, `runResult`.
- [x] **PV-T6** **Combat scene upgrade** — ✅ atmospheric arena backdrop
      (`generateCombatBackground`: central spirit glow, glowing platform pads under
      each combatant, side silhouettes, fog, motes, vignette; registered in `main.js`,
      drawn in `fight.js` with a caveDeep fallback). ✅ element auras on combatants
      (the PV-T7 monster glow carries into combat). ✅ **impact FX trio DONE 2026-06-08
      (`@visual`)** — hit + catch FX already existed (`flashHit` red tint, `playHitFx`
      expanding impact ring scaled by damage, `spawnDmgFloater` rising damage numbers,
      attack lunge, `drawCaptureAnimation`/`drawCaptureFail`/`drawChainBreak`); finished
      the missing **cast** beat: `playCastFx` fires an **element-tinted ring that collapses
      inward onto the attacker the instant a move launches** (before the lunge/impact land),
      so a turn now reads cast → lunge → impact. a11y: static glow ring under reduce-motion.
      _Build-verified + 348 tests; live combat is RNG-gated so not screenshot-framed, like
      prior fight changes._ Minor layout tuning is taste-level; closing the task.
      ✅ **Cast-tell symmetry 2026-06-08 (`@visual`, `55fcbcc`):** the cast ring originally fired
      only for the *player's* attack — the enemy's counterattack now telegraphs the same
      element-tinted cast on its side when it lands a hit, so enemy strikes no longer read as abrupt.
- [x] **PV-T7** **Monster sprite quality pass** — `generateMonsterSprite` now draws
      a per-element radial **aura glow** behind the body, a glowing **accent rim**
      (re-stroked silhouette), and a top-left **sheen**, on top of the PV-T3 shape
      variety. Monsters read as bioluminescent everywhere they appear. _Done 2026-06-06.
      Follow-up if wanted: livelier/animated eyes._
- [~] **PV-T8** **HUD polish** — ✅ **themed minimap frame** (`onlineGame` minimap outline → `THEME.line`),
      ✅ **timer styling** (final-minute big centered amber→red pulsing `drawTimeWarning` + off-screen
      portal-arrow hint already exist), ✅ **team HP as compact cards DONE 2026-06-07 (`@visual`):** each
      active monster is now a card — **element-tinted dot + name + live HP bar/number** (was anonymous
      bars) so you can tell *which* reserve is hurt. Names/elements come from the full active-team objects
      (`state.team`, welcome/roster), **index-aligned to the in-round hp/max snapshot** (`state.self.team`)
      → **zero extra snapshot payload** (doesn't touch the P6-T4 bandwidth guard). Shared `TEAM_*`/`teamHudBottom()`
      layout consts keep the team + stamina + chain HUD from desyncing; fainted monsters dim. Build + 229
      tests; `shoot-round` verified (4 named cards w/ element dots render, chain HUD repositions cleanly,
      no errors). ✅ **SP parity DONE 2026-06-07 (`@visual`, `game.js` `drawTeamHud`):** the SP team HUD
      already had names + HP bars; added the **element-identity dot** per row (dimmed when fainted) + "…"
      truncation so SP matches the MP cards (P10 parity). Build + 232 tests; `shoot-sp` verified (colored
      dots render beside each team name). ✅ **critical-HP pulse DONE 2026-06-08 (`@visual`, both modes):**
      an HP bar at ≤25% now throbs with a pulsing bright wash over the (red) fill so a near-dead monster
      is unmissable on a busy frame — color alone was easy to miss. Central + opt-in in MP `onlineGame`
      `drawBar` (HP bars only — energy/stamina excluded; covers team cards + combat rows), mirrored inline
      in SP `game.js` `drawTeamHud`, **and SP combat `fight.js`** (the retained player/enemy HP fills throb
      brighter while ≤25%, restored by the next `updateBars()` on recovery) — so the cue is consistent
      everywhere HP shows. a11y: frozen under reduce-motion; never pulses a fainted/empty bar. Build + 390
      tests. **Remaining:** danger state as a teal→red vignette (atmosphere agent's `atmosphere.js` lane).
- [~] **PV-T9** **Micropolish & motion** — ✅ **button press feedback DONE 2026-06-07 (`@visual`):**
      `theme.js addButton` now does a brief brighten + halo "pop" on tap (auto-restored via `k.wait`,
      the same safe flash pattern as `fight.js:125`; `onHoverUpdate` re-applies hover next frame; scene-
      change restores no-op on the destroyed button via try/catch). One central place → **every themed
      button across all scenes** gets click feedback (was hover + sound only); most visible on in-place
      buttons (toggles/+/−/shop). Build + 230 tests; `shoot-round` click-through verified (themed lobby
      CTA still navigates → onClick wrapper intact, no errors). **Remaining:** title portal pulse +
      `index.html` (@phaser lane), scene fade transitions (needs a `main.js` hook — @phaser), themed
      loading screen (recently improved — `loading.js` portal glow). ✅ **spirit-dust particles DONE
      2026-06-08 (`@visual`, `lobby.js`):** the static menu backdrop now has **faint teal motes drifting
      upward** behind the hub UI (18 retained dots added right after `addMenuBackground` so they sit
      behind every panel/button by insertion-order z; gentle sine sway + wrap-around). Pure cosmetic —
      gives the lobby a sense of living air. a11y: motes placed but not animated under reduce-motion.
      Build + 378 tests. _(Distinct surface from the atmosphere agent's in-round world motes.)_ **Remaining:**
      title portal pulse + `index.html` (@phaser lane), scene fade transitions (needs a `main.js` hook — @phaser).
- [ ] **PV-T10** *(large, optional — needs user go-ahead)* **True pixel-art rendering**
      — rewrite `spritegen.js` tiles + monsters at low resolution with a tight pixel
      palette + dithering to fully match the painterly-pixel reference. Biggest lever
      but a major art rewrite; the smooth-Canvas2D look ships in the meantime.

### PV — more major upgrades (added 2026-06-07)
- [x] **PV-T11** **Spirit-chain throw + capture VFX** (`@visual`) — much of this already existed in
      `render/spiritchain.js` (✅ projectile trail, ✅ `drawChainImpact` burst, ✅ `drawCaptureAnimation`
      coils→flash). ✅ **2026-06-07 juiced the throw projectile** (the most-seen part): longer **glowing
      comet tail** + a soft glow halo around the spinning head (was 3 flat dots). Build-verified;
      it's a mid-throw transient so hard to frame in QA. ✅ **success/fail distinction in the capture
      seq DONE 2026-06-08 (`@visual`, `a13f0ca`):** a **failed catch** previously had *no* FX (only a
      narrative line) → indistinguishable from nothing happening. Added `drawCaptureFail()` (the link
      ring snaps **outward** with a desaturated shockwave + no bright white catch-core — the inverse of
      the success contraction), wired in `fight.js` on the "monster breaks free" branch; unit-tested
      (`spiritchain.test.js`: success draws a white core / fail expands outward, neither throws).
      ✅ **chain-break FX on depletion DONE 2026-06-08 (`@visual`, `0373158`):** a chain used to vanish
      *silently* when its last capture charge was spent. `consumeChainCharge` now reports depletion →
      `fight.js` plays `drawChainBreak()` (broken links fall away under gravity, distinct from the radial
      break-free FX) **and** appends "Your <chain> shattered — out of charges." to the catch narrative so
      the player knows why it's gone. Unit-tested. ✅ **wind-up tell DONE 2026-06-08 (`@visual`,
      `onlineGame`):** loosing a chain now fires `playThrowWindup` — a chain-colored ring that snaps
      **inward** onto the tamer + a small spark puff (PV-T12 fx path) at the throw origin, a readable
      launch beat before the comet trail flies (a11y: static ring under reduce-motion). Folded the three
      duplicated throw call sites (keyboard/gamepad/touch) into the single `throwEquippedChain` helper so
      the tell + combat guards apply uniformly (small de-dup). Build + 348 tests. ✅ **SP wind-up tell
      DONE 2026-06-08 (`@visual`, `844b0c1`):** `game.js` was missing the launch beat MP had — mirrored
      `playThrowWindup` (inward chain-ring + spark puff, a11y-static) at SP throw launch, so both modes
      read the throw identically. **PV-T11 now fully done (both modes) → marked `[x]`.** _(Note: the SP overworld
      transitions to combat instantly on a hit, so a "successful engage" burst there wouldn't be seen —
      that sub-item is N/A on-map.)_
- [x] **PV-T12** **Unified particle/FX system** (`@visual`) — ✅ **`src/render/fx.js` DONE 2026-06-07**:
      one pooled, **budget-capped (220)** emitter — `emit({x,y,n,color,speed,life,size,spread,dir,gravity,drag})`
      + `updateFx(dt)` / `drawFx(k)` / `clearFx()`; swap-remove reaping (no O(n) splice), pure shim
      primitives, world-space. **Unit-tested** (`fx.test.js`, 4✓: emit/cap, age/reap, draw-per-particle,
      empty-safe). ✅ **Consumers wired (`onlineGame`):** **footstep dust** (kick-up puff per step) +
      **reward bursts** — gold sparkle on **chest-open** and a rising **level-up** burst (both reuse the
      existing chest/level-up state-diffs that already fire SFX, so they're free of new detection). New
      visual feedback on reward moments that previously had only sound. ✅ **Screen-space support added
      2026-06-07** (`emit{fixed:true}` + `drawFxScreen(k)`, drawn over the combat panel; 5✓ in fx.test)
      → unblocks combat-panel juice — first consumer: a **catch-success sparkle** (teal burst at the
      captured row, the taming payoff). Build green, no errors. ✅ **Combat hit-sparks DONE 2026-06-08
      (`@visual`, `d12a0bc`):** SP `fight.js` had only a manual shockwave ring and didn't touch the fx
      pool — now every landing hit `emit`s a burst of element-tinted sparks (screen-space, raining down
      under gravity, count scaling with hit power so crits throw more), advanced by `updateFx` + drawn via
      `drawFxScreen`, `clearFx` on entry. Reuses the tested fx path (auto reduce-motion suppression).
      Build + 352 tests. ✅ **Chain-impact sparks DONE 2026-06-08 (`@visual`, `5a8189a`):** SP chain
      miss/wall landing sparks moved off the manual draw loop in `drawChainImpact` onto the fx pool —
      `game.js` `emit`s a chain-colored burst (gravity/drag/variation) at impact, `drawChainImpact` keeps
      only the lingering shockwave ring; +1 ring-only test, 358 green. ✅ **MP combat-overlay hit-sparks
      DONE** (`onlineGame` HP-diff detection emits a `fixed` spark burst per hit, lines ~938/941).
      **PV-T12 closed 2026-06-08 → `[x]`:** the emitter + every gameplay/combat/reward/storm consumer
      across SP **and** MP now run on the one budget-capped fx pool. _Only follow-up: the ambient
      atmosphere motes (`atmosphere.js`) could move onto the pool too — left to the **atmosphere agent**
      whose lane that file is (PV-T4), not blocking PV-T12._
- [x] **PV-T13** **Extraction & storm VFX** (`@visual`) — ✅ **storm wall DONE 2026-06-07**: the
      safe-zone edge now renders as a **glowing, pulsing energy barrier** (outward glow rings fading
      into the storm + a bright pulsing inner edge) instead of one flat outline, in **both** `onlineGame`
      (blue) and SP `game.js` `drawCircleOverlay` (red, keeping its scheme). Build+tests, runs error-free
      (verified via `CIRCLE_START_S=0` QA so the circle draws from t=0). _Note: it's a **late-game** visual
      — only on-screen once the circle closes near you, so early-round QA can't frame it; code-verified._
      ✅ **Extraction portals** already upgraded via `src/render/portal.js` (`drawPortal`, rise-anim).
      ✅ **zone-damage hit feedback DONE 2026-06-08 (`@visual`):** a prior agent had *declared* the
      state (`prevTeamHp`/`stormHitT` in `onlineGame`) but left it **dead** — no detection, no draw.
      Finished it: a team-HP **state-diff** (sum of `self.team` hp) while **outside the circle** (gated
      `!combat`/`!roundResult` so duel damage isn't misattributed) fires a discrete **red border flash**
      (`drawStormHit`, fades ~0.45s, independent of the steady danger border so it finishes even after
      you re-enter), a **red particle burst + "STORM -N" floater** (PV-T12 fx), and **haptic** — the
      continuous border showed you were *in* danger, nothing marked the *moment* HP drained. a11y:
      flash peak capped under reduce-motion. Build + 348 tests green; mirrors the shoot-verified
      chest/level-up state-diff pattern. ✅ **storm particles DONE 2026-06-08 (`@visual`, `onlineGame`):**
      while you're outside the safe circle, drifting ash/ember motes spawn around the tamer (throttled
      ~10/s via the shared PV-T12 fx pool so the 220 cap isn't starved; reuses the same `outside` flag as
      the damage detection), reinforcing that the storm is battering you alongside the red border + STORM
      floater. a11y: slower + sparser under reduce-motion. Build + 352 tests. **SP got the same** (`@visual`,
      `8a6e9b1`: red debris on a diagonal wind, throttled + reduce-motion-gated) — **PV-T13 fully done, both
      modes → marked `[x]`.**
- [x] **PV-T14** **Monster + character animation pass** (`@visual`) — ✅ **overworld monster idle
      DONE 2026-06-07**: cheap procedural **idle bob + breathing** (`Math.sin` on pos.y + scale,
      per-monster phase from world coords so a group isn't synced) applied in **both** `onlineGame`
      (y-sorted ents) and SP `game.js` (tile loop) — monsters now read as alive over their static
      ground shadow. Build+158 tests, no errors. ✅ **richer player/rival motion DONE 2026-06-07**
      (`@visual`, `render/character.js`): while walking, the **upper body (hood/shoulders/arm) leans into
      the heading** (clamped ±dir × ~2.6px H / 1.2px V) while the lower cloak + feet stay planted — a
      momentum/weight cue on top of the existing walk-bob + hem sway. Pure position math (no atlases),
      applies to **self + rivals SP & MP** (shared `drawCharacter`); idle → lean 0. Build + 231 tests;
      `shoot-round` moving frame verified (figure leans, stays cohesive, no errors). ✅ **Combat attack
      lunge DONE** (`fight.js` `lungeOff`/`lunge`, lines ~135-157/641-642): the striker jabs toward its
      opponent then eases back on each landing hit (a11y: no lunge under reduce-motion). _(MP combat is a
      HP-row panel, not facing sprites, so a sprite-lunge doesn't apply there — its hit-flash + sparks +
      damage floaters carry the impact.)_ **PV-T14 fully done → `[x]`.** _Also rounded out SP↔MP combat-FX
      parity 2026-06-08 (`@visual`, `46cad87`): SP catch now pops the same celebratory teal sparkle as MP._

### PV — visual audits (added 2026-06-07; each = find issues → file follow-ups, not a rewrite)
- [~] **PV-A1** **Cross-scene consistency audit** — every scene uses `theme.js` tokens/
      components (no hardcoded RGB/layout); consistent spacing, type scale, button styles
      (extends P10-T6/PV-T5). Output: a per-scene gap list.
      ✅ **Audited 2026-06-07 (`@visual`** — static grep of color literals vs `THEME`/`addButton`
      refs per file). **Key rule: hardcoded colors in _procedural art_ (tiles/sprites/FX/fog/
      minimap glyphs) are LEGIT — only _UI chrome_ (panels/buttons/text/HUD) must be themed.**
      Gap list, worst-first:
      - **`inventory.js`** — 18 literals, **0 `THEME` refs**: a whole UI scene off the system
        (toggle/select/button fills + arbitrary hex outlines `#5aa0ff`/`#ffcc00`). _Owner **@feature** (SP inv)._ **High.**
      - ✅ **`onlineGame.js`** (**@visual**) — **DONE 2026-06-07:** ~28 neutral _chrome_ literals
        (HUD/overlay/combat-panel text + panel/scrim bgs + frame outlines + bar track + kill-feed
        accents) routed through a `THEME`-derived `UI` palette (`UI.text/body/mut/panel/track/line/
        amber/danger/primary`). **Left intentional** (per the chrome-vs-art rule): minimap/storm/
        reticle/shadow art, gold overlay titles, win/lose + danger-alert reds, damage numbers, the
        touch joystick/THROW/pause-button widgets, black scrims. Kill-feed `(224,86,110)`/`(47,211,181)`
        were **exact** `PAL.danger`/`PAL.primary` → pure de-dup. Build + 229 tests green; `shoot-round`
        (idle/move/pause) verified — HUD/combat/pause render clean, no regression, no client errors.
      - ✅ **`game.js`** (SP; **@visual**) — **DONE** (re-verified 2026-06-07): HUD text/panels already
        route through `THEME` (8 themed `drawText`); remaining `k.rgb()` are all procedural art/widgets
        (joystick, shadows, monster fallback marker, aim reticle, storm rings, tile/minimap colors) → leave.
      - **`fight.js`** — 20 literals but 40 `THEME` refs (mostly themed; fold the strays). **Low-med.**
      - ✅ **`bestiary.js`**, **`characterSelect.js`** (**@visual**) — **DONE 2026-06-07:** strays themed —
        bestiary detail-scrim → `T("bgAlt")`; charSelect name-input modal (fill/border/label/cursor/hint)
        → `THEME.surface`/`line`/`text`/`textMut`. **Left intentional:** the delete-confirm dialog's
        functional red/green (P6-T7) + black modal scrims. Build + 229 tests green.
      - Near-clean (1-2 strays): `roster`, `onlineShop`, `onlineLobby`, `loading`. **Trivial.**
      - ✅ **Clean exemplars (the standard):** `start`, `shop`, `settings`, `runResult`, `lobby`,
        `baseUpgrades` (0 literals, fully themed).
      - **Exempt — do NOT convert to tokens (procedural art):** `tiles`, `spiritchain`,
        `atmosphere`, `fx`, `portal`, `character`.
      **Next:** the **@visual** chrome lane is now closed — `onlineGame.js`, `game.js`, `bestiary.js`,
      `characterSelect.js` all ✅ done (see above). **Sole remaining gap: `inventory.js`** (18 literals,
      **@feature** lane — SP inventory). `fight.js` strays (Low-med) are also still open if anyone wants them.
- [~] **PV-A2** **Readability / contrast / colorblind audit** — HUD + combat legibility on
      busy frames; **the dark vignette hiding corner rivals in PvP** (flagged); element-colour
      distinguishability for colorblind players. Output: concrete fixes.
      ✅ **Colorblind + contrast audited 2026-06-07 (`@visual`** — static: Viénot dichromacy sim +
      CIE-Lab ΔE on the **`theme.js` UI element palette**; WCAG ratios on text). _NB: monster
      sprites use a **separate** palette in `spritegen.js ELEMENT_PALETTES` — audit that too once
      it's out of flux._ Findings (ΔE: ~<14 = confusable):
      - **metal `#A6B0C0` / psychic `#FF6FC2`** — distinct normally (ΔE 64) but **deuteranopia
        ΔE≈1** (≈identical for ~6% of ♂). _Fix: separate by **lightness** (hue won't help under CB)
        — e.g. darken psychic or lighten metal._ **High.**
      - **air `#6FD8E8` / ice `#9BE6FF`** — **ΔE≈11 in _normal_ vision** (a defect for everyone).
        _Fix: make ice paler/whiter (e.g. `#C8F0FF`) or push air teal-ward._ **High.**
      - **dark `#A67FE6` / poison `#C46FD6`** — ΔE≈16 normally, ≈5 protan. _Fix: shift poison more
        magenta-pink or dark more blue-violet._ **Med.**
      - **fire `#FF6A4D` / earth `#D6A05A`** — deutan ΔE≈6 (both common). _Fix: make earth yellower/
        lighter (less red)._ **Med.**
      - **textMut `#6C6A82`** on bg/surface = **3.1–3.8 (< WCAG-AA 4.5)** — fails for small dim
        labels. _Fix: lighten to ≈`#8A8AA0` if used on small text; fine if only large/disabled._ **Med.**
      - ✅ OK: text/textBody contrast (9–17), most element pairs distinct under all 3 CB types.
      ⓭ **Design sign-off needed (user):** element-identity colors are prominent + curated — I left
      them unchanged; apply the suggested hex nudges if you want the accessibility wins.
      **Still TODO:** the dark-vignette/corner-rival check (needs runtime; `atmosphere.js` lane).
- [~] **PV-A3** **Render performance audit** — the shim's immediate-mode pooling under load
      (16-player + many FX), particle budgets, and the **DPR/zoom double-apply on retina/4K**
      (`@visual` flagged the canvas rendering in a corner at DSF≥2 — `@phaser` lane). Measure
      frame cost; cap FX.
      ✅ **Client-render hot path audited 2026-06-07 (`@visual`** — static; the project only ever
      measured *server* tick perf via `loadtest.mjs`, never *client* per-frame cost). **`drawTiles`
      (`render/tiles.js`) is the dominant per-frame cost:** the **map is immutable for the whole
      round**, yet every frame it redraws the full visible floor — per floor cell = tile
      `drawSprite` **+** patchwork `drawRect` **+** scatter ellipses **+** edge-shadow rects, and
      recomputes `neighborAvg` (5-cell) + edge `isFloor` checks. ≈visible-cells × ~2+ draws; the
      **supersample (S≥2) ~quadruples the visible-cell count** → ≈1.5–2k tile draw-calls/frame.
      - ✅ **Fixed (safe, output-preserving):** skip the patchwork overlay where it's a no-op (cell
        ≈ neighbour avg, ≤2/channel → <0.5/255 shift) — removes most overlay draws on uniform floor.
        Can't introduce seams (seam cells differ from neighbours, so they still draw). Build+168 ✓.
      - ✅ **Fixed 2026-06-08 (`@visual`, safe, output-preserving): memoize `neighborAvg`.** It was
        recomputed every frame for every visible floor cell (~5 cell lookups + a `.filter()` + a new
        array each call → ~7 array allocations/cell/frame = heavy GC churn in the hot loop). The map is
        immutable for the round, so the local colour average is static → now cached per cell in
        `tileCache.avg` (`makeTileCache` adds the Map; `undefined`=uncomputed vs `null`=no neighbours).
        First visit computes, every later frame reuses. New `tiles.test.js` case asserts the cache
        populates and the patchwork output is frame-stable. Build + 352 tests ✓.
      - 🔧 **Big win (deferred — bigger change + needs runtime A/B):** the floor layer is static per
        round → render it **once to an offscreen cache** (region around the camera, or whole map) and
        blit, cutting per-frame tile cost from ~thousands of draws to ~1. Same applies to
        `drawScatter`/`drawFloorEdgeShadow`/`drawVoidCell` (all recompute static per-cell data every frame).
      - **FX budget:** `fx.js` is hard-capped at `MAX=220` (emit breaks at the cap, dead reaped) → no
        unbounded growth; safe. **DPR/zoom 4× cell multiplier** is the `@phaser` DSF≥2 issue (flagged).
- [ ] **PV-A4** **Visual regression baseline** — commit reference screenshots per scene
      (title/charSelect/lobby/game/combat/roster/shop/result/bestiary/admin/wiki) via the
      `shoot-*` harnesses, so future changes can be eyeballed against a baseline.
- [~] **PV-A5** **Game-feel / "juice"** — hit-pause, easing, screen shake, feedback on every action.
      ✅ **Shipping juice via PV-T12 fx + flashes (`@visual`):** footstep dust, chest-open sparkle,
      level-up burst (`emit`), throw-projectile comet trail, storm-wall pulse, **combat hit-flash**
      (row pulses white on HP drop) + **hit-sparks** (warm screen-space particles on each hit) +
      **catch-success sparkle** (teal burst at the captured row) — all via the now-world+screen fx path
      (PV-T12); per-side HP-diff, resets per combat. Build green, fx 5✓. (Combat effects are 0.3–0.4s
      transients on tiny-damage QA turns, so code/test-verified rather than screenshot-framed — but QA
      now confirms attacks *resolve* in-combat after the coord fix.)
      🔧 **Tool fix:** `shoot-combat`'s attack/Catch click coords were stale after the combat-button
      overhaul (hitting the wrong row → combat QA's attacks silently no-op'd); corrected to the new
      layout (attack ≈y583, Catch ≈y645).
      ✅ **Screen shake DONE 2026-06-08 (`@visual`):** new pure, unit-tested `src/render/shake.js`
      (trauma model — `addShake`/`updateShake`/`shakeOffset`, trauma²-scaled camera nudge, zero at rest,
      5✓) wired into the camera (`k.camPos`) of **both** MP `onlineGame.js` and SP `game.js`. Fires on
      **storm/zone damage ticks** (the camera kicks as the storm bites — reuses the PV-T13 detection,
      both modes) and on **taking a combat hit** (MP). a11y: gated off under `prefersReducedMotion()`.
      Build + 363 tests; in-round render smoke-verified (shake is 0 at rest, so no idle regression).
      ✅ **Combat shake now damage-scaled DONE 2026-06-08 (`@visual`, MP `onlineGame`):** the combat hit
      shake was a flat `addShake(0.3)` regardless of damage; now both the trauma **and** the hit-spark
      count scale with the hit's fraction of max HP — small chips barely nudge, big hits/crits really kick
      (matching shake.js's documented 0.2→0.9 intent) — **and** a lighter scaled kick now also fires when
      **your** hit lands on the enemy (was: shake only when *you* take damage). a11y still gated. Build + 382 tests.
      ✅ **Extract payoff feedback DONE 2026-06-08 (`@visual`, `runResult.js`):** the result screen was
      purely static — a successful escape now fires a celebratory spirit-fountain (staggered gold + teal
      mote bursts arcing up from behind the title, via the shared screen-space fx pool), the summary-screen
      counterpart to the in-round extract flash. a11y: skipped under reduce-motion. Build + 385 tests.
      (Throw feedback already shipped: the PV-T11 wind-up tell, both modes.)
      **TODO:** hit-pause (brief freeze) on big hits; SP `fight.js` combat shake (full-screen scene —
      needs its own offset, no camera follow) → a prioritized backlog.

## MOB — Mobile compatibility (enhancements & audits, added 2026-06-07)
> Builds on the shipped onscreen joystick + combat-button overhaul + responsive
> letterbox + PWA (see `P6-T6` and the "Mobile onscreen controls overhaul" row).

### Enhancements
- [ ] **MOB-T1** **Single-player touch controls** — SP `game.js`/`fight.js` are still
      keyboard-only; bring the MP joystick + throw/combat touch buttons to SP (= P6-T6).
- [ ] **MOB-T2** **Safe-area / notch + responsive scaling everywhere** — `env(safe-area-inset-*)`
      on all scenes (not just the game page), HUD/combat layouts that scale on very small
      screens, no controls under the notch/home-bar.
- [ ] **MOB-T3** **Mobile performance mode** — lower FX/particle budget + cap render scale on
      mobile/low-end GPUs (ties to PV-A3/the DPR-zoom work); keep a steady frame rate over fidelity.
- [x] **MOB-T4** **Haptics** — ✅ **DONE 2026-06-08 (`@visual`).** `haptic(pattern)` in
      `src/systems/audio.js` (Vibration API, no-op when unsupported/muted — **respects the
      shared `tq_muted` mute**, the "disable setting"). All four named triggers covered:
      **hit** (combat overlay `onlineGame`/`fight` `haptic(15)`), **catch** (`[0,30,40,60]`),
      **button press** (`theme.js addButton` `haptic(8)` → every themed button), and now
      **extract** — MP via `initAudio` `net.on("extracted")` (`[0,25,45,70]`) + a death thud
      on `died` (`haptic(120)`), and **SP** parity in `game.js` extract-portal collision
      (`sfx("extract")` + `haptic` — the SP overworld extract was previously **silent**, no
      SFX either, so this also closes an SP↔MP audio-parity gap). Build + 348 tests green.
      _Un-device-tested (headless); patterns easily tuned. Combat-action taps also buzz (MB-12)._
- [ ] **MOB-T5** **PWA / install polish** — install prompt, orientation lock (landscape),
      offline asset caching review, iOS standalone quirks.

### Audits
- [ ] **MOB-A1** **Device/viewport matrix audit** — verify across common phones + aspect
      ratios (notched, 16:9, 19.5:9, tablets), portrait "rotate" overlay, and the letterbox
      fit. Use the touch-emulated `shoot-*` harnesses (`TOUCH=1`). Output: a per-device gap list.
- [ ] **MOB-A2** **Touch-target audit** — every interactive element ≥ ~44px with thumb-reach
      spacing; no overlapping/tiny targets (combat buttons, menus, roster/shop cards).
- [ ] **MOB-A3** **Mobile render/perf audit** — FPS on mid/low-end; **the DPR/zoom canvas
      bug** (`@visual` saw the canvas render in a corner at deviceScaleFactor≥2 — critical on
      retina phones; `@phaser` lane) MUST be confirmed-fixed here.
- [ ] **MOB-A4** **Mobile input audit** — joystick feel, accidental-tap rejection, button vs
      gesture conflicts, on-screen vs hardware-keyboard/gamepad on mobile.
- [ ] **MOB-A5** **Mobile network resilience** — reconnect/grace on flaky cellular (extends
      P6-T1); test backgrounding/lock-screen mid-round.

---

## INV — Inventory system (complete it; user-requested 2026-06-07)
> **Goal:** make the inventory a *complete, coherent system* — not two half-overlapping
> screens. Today **monsters** (active team ⇄ vault swap) and **spirit chains** (equip +
> essence-craft upgrade) exist in **two parallel UIs**: SP `src/scenes/inventory.js` and
> MP `src/scenes/roster.js`. There is **no general item/consumable concept** — the profile
> model is `{ activeMonsters, vaultMonsters, chains[], equippedChainId, essence, gold }`
> (`schemas.js`). This section closes the gaps so inventory works end-to-end SP **and** MP.

### Current state (what already works — don't rebuild)
- **Monsters:** active team (4 slots) ⇄ vault swap/move, keep-≥1-active guard, persisted
  (`saveCharacter` SP / server roster handlers MP). SP shows a hardcoded `/100` cap.
- **Spirit chains:** owned-chain list with throws/charges, **tap-to-equip**, **essence
  upgrade** (`craftUpgrade`). MP equips via `net.setEquippedChain`.
- **Acquisition:** starter inventory (≥5 chains), chest loot (chains/gold/essence),
  extraction stakes (run-found chains kept on extract / lost on death).

### Gaps & tasks
- [ ] **INV-T1 — Unify SP & MP inventory (de-dupe).** `inventory.js` and `roster.js`
      duplicate tab logic, slot rendering, swap rules, and chain rows. Extract the **pure
      inventory logic** (swap/move/validate/equip, vault-cap clamp) into a shared
      `src/engine/inventory.js` (like `progression.js`) consumed by both scenes; keep only
      rendering per-scene. Add `inventory.test.js`. **Owner:** `@feature`.
- [x] **INV-T2 — Vault capacity = the real cap (parity bug).** ✅ DONE (flexible worker
      2026-06-07, `e789aa4`). Display was already fixed (SP shows `vault.length /
      vaultCapacity(character, GAME.VAULT_SIZE)` — Deep-Vault-aware). Remaining gap was
      *enforcement*: the active→vault move pushed unconditionally, overflowing past MP's
      `clampRoster` cap. SP now checks `vaultCapacity` on move-to-vault and, when full,
      refuses the move + flashes a warn-colored "VAULT FULL" (rather than silently dropping
      the just-moved monster as a blind truncate would). Build + 291 tests green.
- [x] **INV-T3 — Monster detail / inspect view. ✅ DONE (SP+MP) — flexible worker 2026-06-07.**
      Both modes have a full inspect panel (full stats, element, rarity, level/XP-to-next + bar,
      description) so players can read a monster before fielding/storing/releasing it.
      **Owner:** `@feature` (logic) + `@visual` (panel).
      • **MP** (`roster.js`, `e8d666c`): the existing detail panel rounded out with rarity, XP-to-next,
      flavor description (+ Field/Store/Release actions).
      • **SP** (`inventory.js`, `0740d78`): matching full-detail panel in the free centre column,
      screenshot-verified end-to-end.
      • **Catch-feasibility readout** (`39dde0e`): the "chain affinity" sub-item, reinterpreted —
      spirit chains are **element-agnostic** (gate by `maxRarity` + `captureMultiplier`; no element
      affinity), so the useful readout is whether the **equipped chain can catch** a monster like this
      one. Shared pure `chainCatchSummary(chain, rarity)` (engine, +1 test, ASCII-only per the glyph
      guardrail) wired into both panels; screenshot-verified (Frayed Chain vs a rarity-4 monster →
      "Rarity too high (chain catches up to 3)"). Build + 332 green.
- [ ] **INV-T4 — General items / consumables (NEW model).** Decide with the user whether the
      game gets non-chain items (e.g. healing salves, essence shards, capture boosters). If
      yes: add `items: [{id, qty}]` to the profile schema + `ITEM_DEFS`, grant from chests,
      an **Items tab**, and **use** hooks (overworld + combat). 🔴 **needs user sign-off on
      scope** before building. **Owner:** `@unassigned` (pending decision).
- [ ] **INV-T5 — In-combat inventory access.** Players can't open inventory / swap the active
      monster / use an item mid-fight. Add a combat "Items/Swap" action (SP `fight.js` + MP
      combat overlay) gated by turn rules. Depends on INV-T4 for items. **Owner:** `@feature`.
- [~] **INV-T6 — Sort / filter / search.** As rosters grow, the vault is an unscannable list.
      Add sort (level/element/rarity/recent) + a type filter; chains sort by tier. **Owner:** `@visual`.
      ✅ **Vault sort shipped 2026-06-07 (`@visual`):** pure, unit-tested `src/engine/rosterSort.js`
      (`sortMonsters` recent/level/rarity/element + `sortChainsByTier`, reference-stable so a
      sorted-view index maps back to the source by identity — reusable by SP `inventory.js` for
      INV-T1) + a "Sort:" cycle button on the MP roster vault (`roster.js`); render + hit-test +
      field-from-vault all use the sorted view consistently. 8 tests, 179/179, no regression.
      ✅ **Filter + chains-tier wiring shipped 2026-06-07 (`33d4bc1`):** `filterMonsters` +
      `elementFilterOptions` (null-safe, ALL-first, sorted) added to `rosterSort.js`; element
      filter + chains-sorted-by-tier now wired through the MP roster render/hit-test/equip.
      182/182, @watchdog-reviewed clean. **MP side complete.**
      ✅ **Free-text search shipped 2026-06-08 (`@visual`, `78bd035`):** pure `searchMonsters(list,
      query, typeOf)` in `rosterSort.js` (case-insensitive substring over name/typeName/element,
      reference-stable so it composes after sort+filter and preserves index→source identity for
      hit-testing) + a "Search…" control on the MP roster vault opening a themed DOM `<input>`
      (mobile keyboard), filtering live, tap-the-x to clear, cleaned up on scene-leave. `viewVault`
      composes filter→sort→search so render and hit-test stay consistent. +3 tests (16 in rosterSort),
      352 green. **Remaining:** the **SP side** (still gated on **INV-T1** SP/MP unify — `@feature`).
- [x] **INV-T7 — Release / bulk-manage. ✅ DONE (single release, SP+MP) — flexible worker 2026-06-07.**
      Players can now release unwanted monsters for an Essence + level-scaled-gold refund in
      both modes, via one shared rule. Add **release** (confirm dialog) → grants essence/gold;
      optional **multi-select** is the only deferred nice-to-have. Respect keep-≥1-active ✓.
      **Owner:** `@feature`.
      ◑ **Engine core DONE (flexible worker 2026-06-07, `5debb77`):** pure shared
      `releaseMonster(profile, monsterId)` in `src/engine/inventory.js` — removes from
      active/vault, grants Essence + level-scaled gold via the same upgrade-scaled
      `defeatGold`/`defeatEssence` helpers (a release is worth a consistent, non-free
      amount), enforces keep-≥1-active (promotes a vault monster if the team would empty;
      refuses releasing the *last* monster). 6 unit tests; 297 green.
      ◑ **SP UI DONE (flexible worker 2026-06-07, `b00f994`):** selecting a monster in SP
      `inventory.js` shows a **Release** action with a two-step **Release → Confirm/Cancel**
      (destructive); confirm calls `releaseMonster`, persists, and shows the outcome
      ("Released X  +Ng +M essence"); refusing the last monster shows a clear message; any
      slot interaction cancels a pending release. Build clean, app boots with 0 console
      errors (visual capture blocked by stale menu-harness coords mid-swarm).
      ◑ **MP server half DONE (flexible worker 2026-06-07, `e1ec024`):** `world.js` `release`
      handler (idle-gated like setRoster) calls the shared `releaseMonster`; the `roster`
      reply carries `{ released, reward, gold, essence }`, `net.js` syncs the wallet +
      exposes `net.release(monsterId)` + stashes `state.lastRelease`. 2 server tests (idle
      refund + synced wallet; locked-mid-run + last-monster refusal); 299 green.
      ✅ **MP UI DONE (flexible worker 2026-06-07, `cb8e383`):** the roster inspect panel gained
      a 3-button row (Field/Store · **Release** · Close) — two-step arm→confirm, hidden when
      it's the player's only monster; calls `net.release`, toasts `state.lastRelease`, re-syncs
      team+vault on success. Build + 301 green. **Only deferred:** optional multi-select / bulk
      release.
- [ ] **INV-T8 — DRAG-AND-DROP inventory (user-requested 2026-06-07; = PT1-T15 core).** Today both
      inventories are **tap-to-select-then-tap-to-swap** (`inventory.js`) — no drag. Add real
      **drag-and-drop**: press-and-hold a monster card to **grab** it (a ghost follows the
      cursor/finger), drop on an **active-team slot** or **vault** to field/store/swap; same for
      **chain equip** (drag a chain onto the equip slot). **Keep tap-to-equip / tap-swap as the
      accessible fallback** — don't remove it. **Feasibility ✅ confirmed — no `@phaser` needed:** the
      shim already exposes `k.mousePos()`, `k.onMouseRelease`, `k.onTouchStart/Move/End`
      (`kaboomShim.js`) — enough for grab→drag→drop on **desktop AND mobile**. ⚠️ In MP `roster.js` a
      vertical drag currently **scrolls the vault** — distinguish *scroll-drag* (empty list area) from
      *item-drag* (started on a card) so they don't conflict. **Files:** `src/scenes/inventory.js` (SP),
      `src/scenes/roster.js` (MP); reuse `engine/inventory.js` (PARITY-3) for the move/swap rules so
      SP+MP behave identically. **Owner:** `@visual`+`@feature`. **Done when:** drag-drop
      fields/stores/swaps monsters + equips chains on desktop + mobile (TOUCH=1), tap fallback intact,
      no scroll/drag conflict, `npm run check` green, verified via `shoot-roster`/`shoot-*` + a drag step.
      ◑ **Drag-resolution CORE done 2026-06-08 (`@visual`, `engine/inventory.js`):** pure
      `resolveRosterDrag(activeIds, draggedId, target)` → new active-id order for `applyRoster`
      (which already enforces cap/keep-≥1/vault overflow). Handles store (active→vault), swap
      (vault→occupied slot), field (vault→empty slot), reorder (active→active), and no-ops/invalid →
      null. **8 unit tests** (incl. a round-trip through `applyRoster`); 373 green. This is the
      shared, tested rule both scenes' drop handlers will call — the risky **pointer/grab-ghost UI
      wiring + scroll-vs-item-drag disambiguation** (per-scene, needs interactive verification) sits
      on top of it and is the remaining work.

### Audits
- [x] **INV-A1 — SP/MP behaviour-parity audit. ✅ DONE (flexible worker 2026-06-07, `5d77aea`).**
      Same swap rules, cap, equip semantics, and acquisition results across SP `inventory.js` and
      MP `roster.js`. Output: gap list → **`docs/INV_PARITY_AUDIT.md`**. Most parity is now
      structural (both route through shared `engine/inventory.js`). **One real gap found + fixed:**
      MP `storeFromActive` had no vault-cap check → storing into a full vault let the server's
      `applyRoster` silently truncate (drop) a vault monster; SP already refused this (INV-T2). Now
      MP refuses with a toast, matching SP.
- [x] **INV-A2 — Persistence & loss-state audit. ✅ DONE (flexible worker 2026-06-07, `dc534d0`).**
      Verified inventory persists (SP localStorage / MP server) and **extraction stakes** resolve
      correctly. Caught monsters + chest loot + essence/gold are saved **immediately mid-run** (both
      modes); run-found chains bank on extract / are forfeited on death via shared `finalizeRunChains`;
      gold only on extract; essence kept on death — **all aligned SP↔MP**.
      **One real loss-state divergence found + fixed (Q10):** on death, MP lost the active team
      (refill from vault) but **SP kept its team** (just healed next run) — a parity gap and a spec
      violation that made SP runs riskless. **User confirmed Q10 = "lose the team on death" (both
      modes)**; fixed via a shared `loseRunTeam` engine rule wired into MP `world.js` + every SP death
      path (`game.js`/`fight.js`); wiki Q10 marked CONFIRMED. 3 tests; 341 green.
- [ ] **INV-A3 — Touch/UX audit.** Slots, tabs, scroll, equip/upgrade/release buttons all
      ≥44px and thumb-reachable; no overlap (ties to MOB-A2). Verify via `TOUCH=1` harnesses.

---

## FGT — Complete the combat / fight system (user-requested 2026-06-07)
> **Goal:** finish combat into one coherent, tested system. An audit (`@coordinator`
> 2026-06-07) found the **judge-LLM direction shift left combat half-migrated** and
> **SP and MP combat have diverged**. Combat spans: SP `src/scenes/fight.js` + client
> `src/systems/combat.js`; MP `src/scenes/onlineGame.js` overlay + `server/combat.js` +
> `server/ai.js` + `server/pvp.js`; shared `src/engine/combat.js`. Tasks below cite the
> concrete gaps found. **Pre-req:** FGT-T1 needs the user's combat-resolution decision
> (the 🔴 a/b blocker in `REQUIREMENTS.md`) — it sets the contract everything else builds on.

- [x] **FGT-T1 — Make combat AI-ONLY (USER DECISION 2026-06-07 = option b). ✅ DONE (`@combat` a97126e).** 🟢 **DECIDED — the
      user chose (b): the judge LLM owns combat** (elements/catch/status). Build: **combat always
      routes through the AI judge** in SP **and** MP; the deterministic `engine/combat.js` is **no
      longer a gameplay path** — keep it ONLY as a transient crash-net (a hung/failed call must not
      freeze the fight; the CB-3 10s timeout already covers that) and for tests. Remove the
      per-turn AI↔deterministic flip so SP=MP. The **combat prompt must stay editable in `/admin`**
      (`combatSystem` already is — keep it). ⚠️ AI-only = needs `OPENAI_API_KEY` (set); decide the
      UX if the key/AI is ever unavailable (degrade message vs crude net). FGT-T2/T3 (validate AI
      outputs, status set) fold in here. **Owner:** `@combat` (in progress 2026-06-07; `@coordinator` driving via PT2-T11).
      ◑ **In progress (`@combat`, 2026-06-07):** added one shared AI-judge resolver `aiTurn` in `server/combat.js`
      (AI owns the turn; deterministic `engine/combat.js` is now ONLY a transient single-turn crash-net, not a
      gameplay path). Removed the per-turn AI↔deterministic flip in `server/combat.js` + `server/pvp.js`. SP combat
      now routes through a new server HTTP endpoint (`POST /api/combat/turn`, `GET /api/combat/status`) that reuses the
      SAME `buildState`+`aiTurn` path as MP — so SP=MP. SP fight gates on `/api/combat/status`: no key/connection →
      a "combat needs connection" panel instead of a silent deterministic fight. Parity proven in
      `server/combat.parity.test.js`.
- [x] **FGT-T9 — Duel initiative rules (USER 2026-06-07). ✅ DONE (`@combat`).** Rules 1 (wild→enemy
      first) + 3 (chain throw→thrower first) were already wired (`world.js`/`game.js` pass `initiator`);
      rule 2 (PvP collision → **server-authoritative seeded coin-flip**) was the gap — now in
      `pvp.js maybeStartPvp` (seed = round+ids+duel counter; reproducible, not client-influenced).
      Test in `pvp.test.js`; wiki "Turn order" updated. Set who acts first by how combat starts,
      via the existing `initiator` (`engine/combat.js` already honors `player`/`enemy`):
      **(1)** collision with a **wild/NPC** monster → **enemy acts first**; **(2)** collision with
      **another player** (PvP) → **random** (seeded coin-flip, server-authoritative); **(3)**
      intentional **spirit-chain throw** → **thrower (player) acts first**. Wire the trigger site
      (server `world.js` encounter/PvP start + SP `game.js`) to pass the right `initiator`; carry it
      into the AI prompt too (it already conveys initiative). **Owner:** `@feature` + server. wiki update.
- [x] **FGT-T2 — Validate/clamp AI combat results to the rules. ✅ DONE (`@combat`, folds into FGT-T1).**
      `server/ai.js mapAiResult` already clamped HP/energy to [0,max]; now also **validates status**:
      non-strings → null (no more `[object Object]`), canonical synonyms normalized via the shared
      engine `normalizeStatus` (so AI-applied stunned/frozen/… get real mechanics), unknown free-text
      kept (Q7), length capped at 24. The **rarity catch-gate concern is moot post-FGT-T1**: catch is
      the deterministic `resolveCatch` (server-side, gated); the AI judge only resolves turns and never
      returns `caught`, so it can't bypass the gate. Tests in `server/ai.test.js`. **Owner:** `@combat`.
- [ ] **FGT-T3 — Status effects: make stored statuses real (or scope them down).** Only
      Burn/Poison/Freeze/Stun have effects; every other label (Blind/Confusion/Fear/…) is
      **stored + shown but does nothing** (`engine/combat.js:10-34`), yet `ai.js describe()`
      offers all labels to the model. Either implement a defined status set or constrain the
      AI/UI to the four that work. (`docs/STATUS_TAXONOMY.md` is shelved — revive or retire it.)
      **Owner:** `@feature`.
- [x] **FGT-T4 — Add the missing MP "Swap" action (SP/MP parity). ✅ DONE.** SP can switch the active
      monster mid-fight (`fight.js`); MP now can too. **Server half (`@combat`):** `server/combat.js
      resolveCombatAction` has a `swap` branch — a **free** action (matches SP: no enemy attack,
      first-turn initiative preserved) that switches to a living team member **by id**
      (`{ kind: "swap", monsterId }`); invalid/dead/same target → no-op turn. `monSnap` carries
      `id` so the overlay can identify the active + bench. Tests in `server/combat.test.js`.
      **Button DONE (flexible worker 2026-06-07, `fa998f3`):** the MP combat action row is now
      Catch · Swap · Flee (PvE) / Swap · Flee (PvP) — Swap shown only when a living bench exists;
      it opens a picker of living non-active team members (name · Lv · live HP from the
      index-aligned `self.team` snapshot) → `net.combatAction({ kind: "swap", monsterId })`.
      Desktop: `x` toggles the picker, `1`–`3` pick a bench monster, Back/`x` closes. Build + 309 green.
- [x] **FGT-T5 — MP energy restoration between encounters (SP/MP parity). ✅ DONE (verified `@combat`).**
      Already implemented: `world.js startCombat` calls `restoreEnergyPartial(m, world.cfg.energyRestorePct)`
      for each living team monster at every encounter start, with `energyRestorePct` defaulting to
      `GAME.ENERGY_RESTORE_PCT` (50) — the SAME pct SP applies in `fight.js`. (Task text referenced
      stale line numbers; the MP restore is in place and matches SP.)
- [x] **FGT-T6 — PvP completeness. ✅ DONE (`@combat`).** Initiative + turn order confirmed/finished
      via FGT-T9 (chain-throw → thrower first; contact → seeded coin-flip; then speed order). The old
      "AI-twice→deterministic" retry was replaced in FGT-T1 by the single shared `aiTurn` (AI judge +
      one-turn crash-net) — cleaner, same outcome. The **catch-disabled** rule (no capturing a
      player's monster; KO → loot the loser's active team; flee = no-contest) is now **documented in
      the wiki** (`#combat` → "PvP duels", + Q11) as intended. **Owner:** `@combat`.
- [x] **FGT-T7 — Narrative boundary trim.** ✅ **DONE (`@visual` `91ab8fb`):** the 240-char
      cap no longer chops a word/char mid-token — `trimNarrative()` in `server/ai.js` ends on the
      last sentence break (.!?) in the window, else the last word boundary + ASCII "..." (no-glyph
      safe); 5 unit tests. (Budget itself kept at 240 — a deliberate cap; the bug was the *cut*,
      not the length.) **Owner:** `@visual`.
- [x] **FGT-T8 — Combat test coverage. ✅ MOSTLY DONE (`@combat`).** The listed gaps are now covered:
      **PvP** (`server/pvp.test.js`: loot cap, AI-only gating, collision→KO→loot, FGT-T9 coin-flip),
      **AI-result validation + status non-canonical** (`server/ai.test.js`: clamp, non-string status,
      synonym normalize, free-text passthrough, length cap), **swap action** (`server/combat.test.js`),
      **MP energy restore** (`server/combat.test.js restoreEnergyPartial`), plus the **SP==MP parity
      proof** (`server/combat.parity.test.js`). Any further breadth is `@watchdog`'s ongoing remit.

> **Keep in sync:** every FGT change must update the wiki (`public/wiki.html`
> #combat/#elements/#taming/#status) — the design source of truth.

---

## CMP — Compliance / legal pages (user-requested 2026-06-07)
> Static, public legal pages so the live game (`tamersquest.com`) meets baseline
> data-protection / consumer expectations. Served like `/wiki` & `/admin` (a route in
> `server/index.js` → an HTML file under `public/`), linked from the **start menu** and a
> small **footer**. 🔴 **Blocked on user input** for contact + exact data practices.
>
> ✅ **DRAFT SHIPPED 2026-06-07 (`@visual`).** **Design decision:** consolidated all four
> sections into **one `public/legal.html`** (anchored: Privacy / Storage / Terms / Imprint),
> mirroring how `wiki.html` consolidates rather than four tiny files — one page to keep in
> sync, one URL to link. **No server route needed:** `serve-handler` already does clean-URLs,
> so `/legal` (and `/legal.html`) resolve automatically — *verified 200* via a local
> serve-handler smoke test; build copies it to `dist/`. Content is written **accurate to the
> code** (exact `localStorage` keys, server-stored fields, OpenAI + Railway processors).
> Operator-fill blanks are rendered as obvious `.todo` "FILL IN" chips. Footer cross-link
> added in `wiki.html` (→ `/legal`). Build + 206 tests green.

- [x] **CMP-T1 — Privacy Policy** ✅ (in `legal.html#privacy`). Discloses **nicknames**,
      **anonymous session token** (`tq_session_token`), **gameplay profiles/stats** persisted to
      **Postgres**; **`localStorage`** keys; processors **OpenAI** (combat + gen) and **Railway**
      (hosting/DB); public leaderboard exposure; retention (period = `FILL IN`); deletion-request
      path; explicit "no ads/trackers".
- [x] **CMP-T2 — Terms of Service** ✅ (in `legal.html#terms`). As-is/beta, acceptable use,
      anonymous-profile responsibility, virtual-items-no-value, AI-content disclaimer, liability
      limits. Governing-law = `FILL IN` (Switzerland to confirm).
- [x] **CMP-T3 — Cookie / storage notice** ✅ (in `legal.html#storage`). Documents the
      decision: storage is **functional-only** (4 player keys + operator admin key), **no
      tracking/ad cookies**, so **no consent banner** is used — stated explicitly with a per-key
      purpose table.
- [~] **CMP-T4 — Imprint / Impressum** — structure done (`legal.html#imprint`), but
      🔴 **operator name / address / contact email are `FILL IN` placeholders — needs the user.**
- [~] **CMP-T5 — Routing + links** — `/legal` serves automatically (clean-URLs, verified);
      `wiki.html` footer links to it. 🟠 **Remaining:** the **start-menu link** lives in
      `index.html` (the HTML title), which is **@phaser's lane** — needs a `<a href="/legal">`
      added there (and ideally a tiny footer on the title). _@phaser/@user: one-line add._

> **Owner:** `@visual` (draft + content). **Remaining = user-blocked only:** (1) replace the
> `FILL IN` chips in `legal.html` (operator identity/address/email, retention period, children
> age, governing law), then (2) @phaser adds the start-menu link in `index.html`. Until then
> the page is a clearly-marked reviewable draft (warn banner up top). **Do not treat as
> legally final** until the user reviews + fills the blanks.

---

## Asset-generation pipelines (architecture — source of truth)

> Tamers Quest ships **zero static art** — no PNGs. Every visual is generated at
> runtime by one of two pipelines: (A) **procedural rendering** (Canvas2D / live
> shim draws) and (B) **AI content generation** (server → data, which pipeline A
> then renders). Keep this section current when adding/altering a generator.

### A. Procedural visual pipeline (client, deterministic)
All generators are pure + seeded (so a given monster/tile always looks the same)
and output a `<canvas>` that the shim's `k.loadSprite(name, canvas)` accepts, OR
draw live each frame via `k.draw*`. Seeded PRNGs: `engine/rng.js` (`makeRng`) for
sprites, `mulberry32` (local) for tiles.

- **`src/systems/spritegen.js`** — one-shot canvas generators:
  - `generateMonsterSprite(mt)` → element palette (`paletteFor`, folds dual-types/
    synonyms via `ELEMENT_ALIASES`) + body silhouette (`shapeFor`/`traceBlob`) +
    per-element features (`drawElementFeatures`) + eyes. Seed = `typeName|element`.
  - `generatePlayerSprite()` → hooded spirit-tamer icon (matches `drawCharacter`).
  - `generateTitleBackground()` / `generateTitleBorder()` → portal-forest title art.
  - `generateTileSprite(tile)` → legacy SP tile (superseded by `render/tiles.js`).
- **`src/render/tiles.js`** (`@visual`) — textured floor **per tile *type***:
  `generateTileTexture` (edge shading + grain) cached via `makeTileCache`; `drawTiles`
  culls to camera, draws the cached sprite at the tile's rotation (flat-rect fallback
  until loaded) + deterministic per-cell `drawScatter`. Used by `onlineGame`; SP
  `game.js` unify tracked as **P10-T2**.
- **`src/render/character.js`** — `drawCharacter` draws the player live (no sprite):
  hooded cloak + animated spirit-chain ring, directional facing.
- **`src/render/spiritchain.js`** — live draws for chain models, the thrown
  projectile, ground chests, and the capture FX.
- **`src/render/atmosphere.js`** (PV-T4) — screen-space mood: generated vignette +
  glow sprites + live drifting motes; `drawAtmosphere(k,{t,danger})`.
- **Registration** — `src/main.js` `init()`: loads fonts, then `k.loadSprite` for
  every monster type (slug name), the player, and title art. Tile textures load
  lazily in-scene (per visible type). New sprite generators must be registered here
  (or lazily in their scene) under the exact name scenes reference.

### B. AI content-generation pipeline (server → data, not pixels)
Produces **monster type DATA** (name/element/rarity/stats/description) + resolves
combat narrative; pipeline A renders that data into sprites. Admin-steerable live.
- **`server/gen.js`** — monster generation (calls OpenAI, validates/persists new
  types). Gated by `MONSTER_GEN_RATE` (admin). New types flow into the bestiary +
  get a procedural sprite on next load.
- **`server/ai.js`** — AI combat resolution (optional layer over the deterministic
  `engine/combat.js`; falls back to it).
- **`server/aiconfig.js`** — DB-persisted model + sampling params (validated/clamped);
  read live by `gen.js`/`ai.js`.
- **`server/prompts.js`** — system/user prompt templates (admin-editable; `{hints}`
  injection for element/rarity targeting).
- **`server/content.js`** — content store/bootstrap for generated types.
- **Admin** — `public/admin.html` edits model/params/prompts + gen rate; applied
  live, no redeploy. (See P5-T1/T2, P7-T5, and the live-asset-gen ownership row.)

> **PV-T10 note:** a future true-pixel-art look would replace the *renderers* in
> pipeline A (spritegen + tiles) with low-res/dithered output; pipeline B (the data
> contract) is unaffected.

---

## Recommended starting point

**P0 is done and all decisions are resolved → begin P1 (the authoritative
server).** Suggested order: P1-T1 (WS server + tick) → P1-T3 (anonymous+nickname
auth) → P1-T2 (persistence) → P1-T4 (lobby/matchmaking) → P1-T5 (seeded map) →
P1-T6 (Railway deploy). The deterministic engine + schemas are ready to import
server-side.

### Auth roadmap (Q6)
1. Anonymous + nickname (P1-T3).  2. Google + Discord OAuth.  3. (Later) native or
other providers.

---

## AUTH — Accounts & sign-in (promoted from roadmap by `@coordinator` 2026-06-07)
> **Why now:** `@phaser` is building **sign-in UI on the start menu** (working tree:
> `index.html` adds "Continue with Google / Discord / Tamer's Account" buttons — currently
> **placeholder toasts** "sign-in coming soon"). Promoting the roadmap to tracked tasks so
> the **UI and the backend land together** rather than UI shipping inert.
- [ ] **AUTH-T1 — Front-end sign-in UI** (`@phaser`, in flight) — the three login buttons +
      styling on the title screen. ✅ scaffolded as placeholders; needs the backend below to
      become real. Keep anonymous/nickname play as the no-login default.
- [ ] **AUTH-T2 — OAuth backend (Google + Discord)** `@unassigned` → **UNBLOCKED 2026-06-07 — build now.**
      The user **set `GOOGLE_CLIENT_ID/SECRET`, `DISCORD_CLIENT_ID/SECRET`, and `SESSION_SECRET` on
      Railway** (callbacks registered at `/auth/{google,discord}/callback`). **Discord uses the
      `identify` scope** (the user couldn't find a "profile" scope — `identify` is correct; email
      may be absent → don't require it for Discord). Build: `GET /auth/{google,discord}` redirect +
      `/auth/{g,d}/callback` (code→token→provider profile→find-or-create profile linked by
      `googleId`/`discordId`→hand back the session token), CSRF `state` check, `googleId`/`discordId`/
      `email?` on the stored profile (`server/store.js`), and point the title-screen buttons (AUTH-T1)
      at the routes. Raw-`node:http` router in `server/index.js`; no new deps. **Owner:** `@combat`.
      ◑ **BACKEND DONE (`@combat`, 2026-06-07) — pending only the title buttons (`@phaser`) + prod verify.**
      • `server/auth.js` — isolated OAuth core (no deps; `node:crypto`): per-provider config (Google OIDC
        `openid email profile` / Discord `identify`), env-gated `providerConfigured`/`configuredProviders`,
        single-use TTL'd CSRF `state` (`makeState`/`consumeState`), `buildAuthUrl`, `exchangeCode`,
        `fetchOAuthProfile` (→ `{provider, providerId, email|null, name|null}`).
      • `server/auth.js handleAuthHttp` (wired in `index.js`, owns `/auth/*`): `GET /auth/providers`
        (capabilities), `GET /auth/:provider` (mint state → 302 to consent), `GET /auth/:provider/callback`
        (`consumeState`→`exchangeCode`→`fetchOAuthProfile`→find-or-create+link→`302 /?token=<token>`; any
        failure → `/?login=failed`, unconfigured → `/?login=unavailable`). `redirect_uri` derived from
        `x-forwarded-proto/host` so it matches behind Railway's proxy.
      • `server/store.js` — `findByOAuth(provider, id)` + `linkOAuth(profile, …)` (sets `googleId`/`discordId`,
        backfills `email`, clears guest). 13 unit tests in `server/auth.test.js` (full flow w/ mocked fetch
        + in-memory store; first-login-creates / second-login-reuses).
      **Remaining:** (1) AUTH-T1 title buttons (`@phaser`) → link to `/auth/google` · `/auth/discord`, and
      read `?token=`/`?login=` on return; (2) end-to-end verify on prod (needs the real Railway creds).
- [ ] **AUTH-T3 — Native account system ("Tamer's Account", email/password)** `@combat`
      — **user-requested 2026-06-07** — a first-party account so players don't need a third
      party. ◑ **BACKEND DONE (`@combat`, 2026-06-07) — pending only the front-end form (`@phaser`) +
      password-reset (needs SMTP).** • `server/accounts.js` — scrypt password hashing (salted,
      self-describing `scrypt$salt$hash`), timing-safe `verifyPassword` (never throws on a bad record),
      email normalize + email/password validation. • `server/store.js` — `findByEmail` + `createAccount`
      (profile + `email`/`passwordHash`, non-guest). • `server/auth.js handleAuthHttp` — `POST /auth/signup`
      (validate → reject dup/invalid/weak → hash → create → `{token}`) and `POST /auth/login` (verify →
      issue the existing session token; **enumeration-safe** uniform `invalid_credentials` for unknown-email
      AND wrong-password; per-email brute-force throttle). 11 unit tests (`accounts.test.js` + native routes
      in `auth.test.js`): hash round-trip/salt/malformed, validation, signup dup/invalid/weak, login
      correct/wrong/unknown-uniform, throttle, method guard. **Remaining:** (1) AUTH-T1 "Tamer's Account"
      button (`@phaser`) → a real sign-up/sign-in form POSTing to `/auth/signup`·`/auth/login`, store the
      returned `token`; (2) **password reset** (token flow) — deferred, needs an SMTP path (flag); (3)
      AUTH-T4 migration. Original scope below for reference:
      - **Schema/storage** — add a `users` table (or extend `server/store.js`): `id`, `email`
        (unique, normalized), `passwordHash`, `createdAt`, `lastLogin`, link to the existing
        `profile`/token model so a signed-in user owns their save.
      - **Sign-up** — email + password; **hash with bcrypt/scrypt/argon2** (never plaintext);
        email-format + password-strength validation; reject duplicate email.
      - **Sign-in / sessions** — verify hash → issue the existing session token (reuse current
        token mechanism); rate-limit attempts (ties to the per-connection rate limiter).
      - **Password reset** — token-based reset flow (needs an email-send path — flag if no SMTP
        provider is configured; can stub to admin-issued reset until then).
      - **Front-end** — wire the "Tamer's Account" button (AUTH-T1 placeholder) to a real
        sign-up/sign-in form; keep anonymous/nickname play as the default.
      - **Security** — covered by the **SEC** audits below (hashing, timing-safe compare,
        no user-enumeration on login/reset, HTTPS-only cookies/token, CSRF where relevant).
      - **Migration** — works with **AUTH-T4** so an anonymous player can claim their progress.
      - **Tests** — hash round-trip, duplicate-email rejection, wrong-password rejection,
        token issuance, reset-token single-use.
- [x] **AUTH-T4 — Account ↔ profile migration** `@combat` — let an anonymous/nickname player
      **claim** their existing progress into a signed-in account (don't orphan saves). ◑ **BACKEND DONE
      (`@combat`, 2026-06-07):** • `server/store.js` — `claimAccount(token,email,hash)` + `claimOAuth(token,
      provider,id,email)`: upgrade the profile held by the anon session token IN PLACE (keeps the save),
      refusing only when it would clobber an existing credential (already a native account / already linked
      to that provider) → caller falls back to a new account. • `server/auth.js` — `POST /auth/signup` now
      takes an optional `token` and claims it (`{claimed:true}`); OAuth carries the anon token via
      `GET /auth/:provider?claim=<token>` through a state-keyed `claimStore` (`consumeClaim`), claiming on
      callback when no account exists for that provider id (an existing provider-linked account still wins).
      3 unit tests (claim keeps the same profile/save + token; already-an-account doesn't clobber; OAuth
      claim links in place). **Remaining:** the front-end (`@phaser`) must pass the current `tq_session_token`
      as `token`/`?claim=` when the player signs up / links from an anon session. npm check green; 335 tests.

> ✅ **RESOLVED (`@coordinator` 2026-06-07) — Bestiary reachability restored.** The
> `index.html` menu redesign (`af2acab`) shipped to prod having **removed the only Bestiary
> entry points** (start-menu button + `B` shortcut), orphaning the still-registered
> `bestiary` scene — a **live regression**. Fixed in-lane: added a **Bestiary button to the
> SP lobby** (`src/scenes/lobby.js` → `k.go("bestiary")`; back returns to `start`). Build+168
> tests green. **@phaser (optional):** consider also restoring a Bestiary link on the HTML
> title for discoverability, and an entry from the **online** lobby (`onlineLobby`) — the SP
> lobby fix covers single-player only.

---

## SEC — Security audits (user-requested 2026-06-07)
> Recurring, find-and-file audits (each = surface issues → open follow-ups, **not** a
> rewrite). Builds on what's shipped: security headers (HSTS/nosniff/X-Frame-Options/
> Referrer-Policy, `server/index.js`), **per-connection rate limiting + payload cap**
> (`server/ratelimit.js`, P8-T7), **input sanitization + ownership-checked actions**
> (P3-T4), and **admin token-gating with constant-time compare** (P7-T7). These audits keep
> the live site (`tamersquest.com`) hardened as features land — and **gate the new account
> system (AUTH-T2/T3)**, which expands the attack surface.

- [ ] **SEC-A1 — Auth/account hardening audit.** (Pairs with **AUTH-T2/T3** — do before they
      ship.) Password hashing (bcrypt/argon2, never plaintext/fast-hash), timing-safe compares,
      **no user-enumeration** on login/reset, session-token entropy + rotation + expiry,
      secure/HTTPS-only/SameSite cookies or equivalent token handling, OAuth state/PKCE +
      redirect-URI allowlist, brute-force/credential-stuffing rate limits, reset-token
      single-use + TTL.
- [x] **SEC-A2 — Server protocol / anti-cheat audit.** Re-verify the authoritative server: all
      WS messages validated/sanitized, every action **ownership-checked** (can't act for
      another player or an unowned monster), no client-trusted state (positions, damage, loot,
      catch results, gold/essence), movement-speed/teleport sanity, the rate-limiter + payload
      cap cover **every** message type. Ties to **FGT-T2** (AI results must obey server rules).
      ✅ **Audited 2026-06-07 (flexible worker) — clean across every critical path:**
      • **Ownership** — every handler keys off `conn.playerId` (server-assigned at auth); no handler
        accepts a client-supplied player id, so you can only ever act as yourself. Double-connect guarded.
      • **Combat (PvE)** — `combatAction` checks `session.playerId === conn.playerId` **and** the combat
        is in the player's *current* round (NC-11) **and** not mid-resolve (double-action guard). Attacks
        validated via `ownedAttack` (can't submit one the monster doesn't have).
      • **PvP** — non-participants rejected (`if (!key) return`), each player sets only their own side,
        no re-submit, owned-attack-only, server-resolved (winner-loots is server-side).
      • **Movement** — server-authoritative; `clampAxis` coerces to `[-1,1]` and folds NaN/±Inf (Inf→1,
        NaN→0) → no speed/teleport exploit; clamped to map; body-radius collision.
      • **Chain throw** — the forged `chainId` is looked up in the player's **own** inventory at tick;
        an unowned chain is dropped (+ `canThrow` charge check). **Locked in with a regression test**
        (forge "guaranteed"/Sovereign Bind → no projectile, no engage).
      • **Economy** — `buyChain`/`buyUpgrade`/`craftChain` are idle-only, ids `String()`-coerced, and
        pricing/affordability/deduction happen server-side in the engine helpers — no client-trusted gold.
      • **Input** — `msg.t` type-checked; ids coerced; nicknames sanitized (SEC-A4); per-connection token-
        bucket rate-limit + 64 KB payload cap (P8-T7) wrap all messages. **No vulnerabilities found.**
      247 tests (+anti-cheat regression) + build green. _Pairs with SEC-A5: `npm audit` = 0 vulnerabilities._
- [x] **SEC-A3 — Injection & data-handling audit.** SQL/Postgres parameterization (no string
      interpolation in queries), **prompt-injection** hardening for OpenAI calls (user
      nicknames/monster names flow into prompts → can't escape the system prompt or exfiltrate),
      output-size/JSON-shape validation on AI responses, no secrets in logs.
      ✅ **Audited 2026-06-07 (flexible worker):** **SQL — clean:** every `server/db.js` query is fully
      parameterized (`$1`/`$2::jsonb`); the bulk-upsert interpolates placeholder *indices* (`$${b+1}`),
      never data; table/column names are static → no injection. **Combat prompt (`ai.js`) — hardened:**
      all dynamic strings (monster name/element/status, attack name/element) run through
      `sanitizePromptText` (folds C0/C1 control chars incl. `\n`/NEL, collapses Unicode separators, caps
      length) — a crafted name can't break out of its line. No user-typed free text (nicknames) reaches
      any AI prompt. **AI output — validated:** gen clamps stats, caps `description` to 600, dedups names.
      🔧 **Fixed:** `gen.js buildMonsterPrompt` interpolated the `{hints}` `element`/`biome`/`rarity` **raw**
      (the one un-sanitized prompt spot) → now wrapped in the same `sanitizePromptText` + `rarity` coerced
      to a clamped 1-5 number (string payloads → default line). Admin-gated today, but defends the P5-T4
      pipeline if AI-generated concepts ever feed the hints. Test added; 239 green. **Secrets-in-logs —
      clean:** no `console.*` in `server/` logs an API key, token, secret, password, or Authorization
      header (OpenAI errors log only status + a 200-char response slice). **SEC-A3 complete.**
- [x] **SEC-A4 — Client / XSS / content audit.** Any place user-controlled text (nicknames,
      future chat) renders into the DOM (`index.html`, `/wiki`, `/admin`, leaderboard) must be
      escaped — no `innerHTML` with untrusted data; verify CSP feasibility; check the static
      pages can't be turned into an XSS vector.
      ✅ **Audited 2026-06-07 (flexible worker) — DOM render sites clean:** the **leaderboard**
      (`index.html`:418) strips `[<>&]` from each name before `innerHTML` (element-content context →
      safe); the **admin panel** routes every dynamic string (player names, AI monster names, reasons)
      through a proper `esc()` (`&<>"'` → entities) — all `innerHTML` sinks checked. The in-round game
      is **canvas-rendered** (`drawText`), not HTML → not an injection vector. No active stored-XSS path.
      🔧 **Hardened (defense at the source):** `sanitizeNick` (`world.js`) **stored raw `<>`**, relying
      on every render site to escape — fragile. It now strips C0/DEL control chars **and `<` `>`** at the
      source, so a future un-escaped HTML render of a nickname can't become stored XSS. Test added (join
      with `<img onerror=…>` → brackets stripped; all-bracket name → `Tamer`). 246 green. **`/wiki` +
      `/legal` confirmed fully static** (0 `innerHTML`/`fetch`/`script` — pure docs). **SEC-A4 complete;**
      the CSP report-only→enforce flip is tracked separately (SEC-A6/LS-10, needs a clean prod report run).
- [x] **SEC-A5 — Dependency & secrets audit.** `npm audit` on the dependency tree (LangChain
      addition included), confirm no secrets/keys committed (`.env` git-ignored; keys only in
      Railway env), review CORS posture, and check error responses don't leak stack traces/paths.
      ✅ **Audited 2026-06-07 (flexible worker) — clean:** **`npm audit` = 0 vulnerabilities.** **No
      committed secrets** — `.env`/`.env.*` are git-ignored and a repo grep for `sk-…`/`OPENAI_API_KEY=`/
      `ADMIN_TOKEN=` finds nothing (keys live only in Railway env). **CORS** — `Access-Control-Allow-Origin: *`
      appears on **only** the two *public read-only* JSON endpoints (`/api/monstertypes`, `/api/leaderboard`);
      the admin API sets **no** CORS headers (token-gated → browsers block cross-origin → no CSRF). **Error
      leakage** — OpenAI failures log status + a 200-char slice server-side, never a key or stack to the
      client (see SEC-A3). **SEC-A5 complete.**
- [~] **SEC-A6 — Infra/transport audit.** HTTPS/WSS enforced end-to-end (no mixed content),
      security headers present on **all** routes incl. the new compliance/static pages,
      admin surface reachable only via token, DB access scoped, backups/retention sane.
      ✅ **Code/transport verified 2026-06-07 (flexible worker) — RUNTIME-checked, clean:** started the
      combined server and curled every route — **HSTS + CSP + X-Frame-Options + X-Content-Type-Options +
      Referrer-Policy are present on ALL of them**: `/` (game), `/wiki`, `/legal` (compliance), the JSON
      APIs, **and even 404s**. `setSecurityHeaders(res)` runs first in the HTTP handler and `serve-handler`
      preserves the `setHeader`-set headers through its `writeHead`, so static pages aren't a gap. HSTS
      (`max-age=63072000; includeSubDomains`); client uses `wss://` on https (no mixed content);
      `http→https` 301 at Railway's edge (verified earlier). Admin = token-gated, no CORS (SEC-A7-style
      CSRF-safe); CORS `*` only on the two public read endpoints (SEC-A5). **Remaining (infra, user/Railway
      side, not code):** confirm DB access is scoped to the app + backups/retention are configured in
      Railway; flip CSP report-only→enforce (`CSP_ENFORCE=true`) once a prod report-only run shows clean.
      🟢 **CSP-enforce is low-risk:** a static scan of every served page (`index/wiki/legal/admin.html`)
      finds **no external resource loads** (no CDN scripts, fonts, or images — all same-origin or inline),
      and the policy already allows `'unsafe-inline'` for the inline boot script/style, so enforcing
      `default-src 'self'` shouldn't block anything. Recommend: let report-only run in prod briefly, then
      set `CSP_ENFORCE=true`. (Left as an env flip — an outward-facing prod change is the user's call.)

> **Cadence:** `@watchdog` (or a dedicated `@security` agent) runs these on a rotation and
> files concrete findings into `docs/BUGFIX_LOG.md` + new tasks here. **Owner:** `@unassigned`
> (claim per-audit). SEC-A1 is **highest priority** because the account system is being built now.

---

## 🔬 COMPREHENSIVE REVIEW — path to perfection (2026-06-07)

> Full-game review requested by the user ("make a huge review… complete and refine this game
> to perfection"). Run by `@visual` orchestrating **7 parallel review agents** (gameplay/balance,
> combat, netcode, visual/UX/a11y, mobile/PWA, content/economy, onboarding/launch/security/tech-debt)
> + `@visual`'s own PV-A1/A2/A3 audits & combat-QA observations. Severity: 🔴 CRITICAL · 🟠 HIGH ·
> 🟡 MEDIUM · ⚪ LOW. **Owners `@unassigned` — `@coordinator` to triage into the roster.** Findings
> deduped across agents; file refs included. This is the master to-do toward "perfection".

### 🧭 Coordinator triage (`@coordinator` 2026-06-07)
> Owners assigned for the 🔴 **Fix-first** blockers + cross-links so findings that **extend an
> already-tracked task don't fork into parallel tracking**. Lanes: `@feature`=gameplay/combat/
> server/content · `@visual`=render/UX/a11y/SP-touch · `@phaser`=shim/bootstrap/DPR. The 🟠/🟡/⚪
> long tail stays `@unassigned` (claim from the relevant section); many are independent/parallel.

**Fix-first owners:**
1. Rarity wall (GP-1/GP-2/CN-2) → **`@feature`** — balance+content, highest playability impact.
2. Storm instant-death (GP-3/GP-11) → **`@feature`**.
3. Combat correctness (CB-1 status-never-expire / CB-2 heal-attacks / CB-3 AI timeout) → **`@feature`** — *folds into **FGT-T2/T3**; do as part of FGT, don't double-track.*
4. Energy stalemate / Struggle (CB-5) → **`@feature`** — *relates to **FGT-T5**.*
5. `dt` cap (NC-1) → **`@feature`** (server `index.js`) — small, do first.
6. Client prediction (NC-2) → **`@unassigned`** — *this **is** P2-T3 (deferred, larger); leave deferred.*
7. Secrets/auth (LS-1/2/3) → **`@feature`** for crypto tokens (`crypto.randomBytes`) + **`@coordinator`** escalates **secret rotation to the user** (see REQUIREMENTS); auth = **AUTH-T3**.
8. Admin XSS (LS-5) → **`@feature`** — *folds into **SEC-A4**.*
9. Mobile DPR (MB-1) → **`@phaser`** (shim); SP touch (MB-2) → **`@visual`** — *= MOB-A3 / MOB-T1·P6-T6.*
10. Online upgrade UI (CN-1) → **`@feature`** (`onlineShop.js`) — server side already done+tested.

**Cross-links (finding → existing task, fix once):** CB-4 swap=**FGT-T4** · CB-8 PvP-catch=**FGT-T6** · CB-10/LS-11 element-direction=**FGT-T1** (🔴 user a/b) · LS-17 vault `/100`=**INV-T2** · CN-9 cosmetics-economy=REQUIREMENTS #7 · CN-12/LS-13 cosmetics-sync=cosmetics row gap · LS-8 legal=**CMP** · LS-9 prompt-injection=**SEC-A3** · LS-10 CSP=**SEC-A4/A6** · LS-1/2=**SEC-A1/A5** · GP-13/LS-12 SP heal-on-extract=**P10-T3** · LS-14 online-lobby missing buttons = ✅ DONE (Bestiary + Cosmetics now in the online lobby grid).

**Needs the user (escalated to REQUIREMENTS):** LS-1 rotate `.env` secrets on Railway · LS-4 set `PVP_ENABLED=false` until FGT lands · NC-15/LS-15 set `ALLOWED_ORIGINS=https://tamersquest.com` (+ scope CORS) · plus the standing combat a/b (FGT-T1).

**⚠️ Do NOT action CB-15 as written:** it calls `gpt-5.4` "non-existent," but the user **explicitly chose gpt-5.4** for generation — keep it in `MODEL_OPTIONS`. (Fine to drop any *truly* dead ids, but not the user's chosen model.)

### ⚡ Fix-first — the launch/perfection blockers (🔴)
1. **Rarity wall kills early game** — 94% of wild monsters are R4–5 (0×R1, 1×R2), but starter chain caps at R3 → a new player can catch *nothing* near spawn. Add R1/R2 monsters + a radial/biome rarity gradient (easy near spawn). `monstertype.json`, `mapgen.js:spawnMonsters`, `spiritchains.json` (GP-1, CN-2, GP-2). **◑ PARTIAL — GP-2 location gradient ✅ done (`@coordinator`); GP-1/CN-2 author R1/R2 monsters still open for `@feature`.**
2. **Storm DPS tuning** — `STORM_DPS=25` faints a ~61 HP monster in ~2.4s. ⚠️ **`@coordinator` re-verified: the "ends run on first faint / no rotation" half (GP-11) is NOT a bug** — `applyStorm` (`world.js:586`) damages the *first alive* monster each tick and only ends the run when **none** remain, so a full team already survives ~4× longer. Remaining = a **balance call only**: is 25 DPS too punishing? It's already **live-tunable** via `/admin` (`stormDps`), so this is a knob, not a code fix — `@feature`/user tune to taste (~8–12 if too harsh). (GP-3 tunable; GP-11 closed.)
3. **Combat correctness** — Burn/Poison **never expire** (permanent until death); `damage:0` "heal" attacks hit the *enemy* for 1 (no heal path); AI judge has **no fetch timeout** (a hung OpenAI call freezes the fight). `engine/combat.js`, `server/ai.js` (CB-1, CB-2, CB-3).
4. **Energy stalemate** — no in-battle energy regen / "struggle" move → two exhausted monsters skip forever (unending fight). Add a Struggle fallback. `engine/combat.js` (CB-5; `@visual` saw this live).
5. **Server time-step unsafe** — `tickWorld` passes raw `dt`; an event-loop spike teleports players through walls & storm one-shots the team. Clamp `dt≤0.15`. `index.js` (NC-1).
6. **No client-side prediction** — movement waits on the server snapshot (laggy at ~100ms). Add dead-reckoning. `net.js`, P2-T3 (NC-2).
7. **Secrets & auth** — rotate the live `OPENAI_API_KEY`+`RAILWAY_TOKEN` in `.env`; session tokens use `Math.random()` (guessable → account-takeover) → `crypto.randomBytes`; auth buttons are "coming soon" on a live game. `store.js`, `index.html` (LS-1, LS-2, LS-3).
8. **XSS in admin panel** — `admin.html` injects AI monster names + player nicknames via `innerHTML`. Escape/`textContent`. (LS-5).
9. **Mobile blockers** — DPR/canvas half-size-in-corner bug at DSF≥2 (no resize handler; unverified-fixed on real devices) + **no touch controls in single-player** (can't play SP on a phone). `compat/kaboomShim.js`, `game.js` (MB-1, MB-2).
10. **Online meta-upgrade UI absent** — server `buyUpgrade` works + is tested, but no online UI calls it → online players can never buy upgrades. Add to `onlineShop.js` (CN-1).

### A. Gameplay loop, pacing & balance
- ✅ **GP-1 Rarity wall — CONTENT HALF DONE 2026-06-07 (`@visual`):** authored **12 early-game monsters** (6×R1, 6×R2) in `monstertype.json` (ids 115-126) — pool R1/R2 went **0/1 → 6/7**. Weak bases (R1 < R2 < existing R3) with **shared sane scalings** (no Inferno-Hound-style anomalies), diverse elements (Fire/Water/Nature/Earth/Electric/Ice/Light/Dark/Air), and **only real, clean attack names** (verified all resolve via `getAttacks`; avoided the CN-7 embedded-desc names). Procedural sprites (no art needed) — verified rendering in the bestiary (e.g. Gale Finch · Air · R2). With the GP-2 gradient routing low rarity to the edges, early spawns now have a real difficulty ramp. Regression test added (low-rarity floor + usable attacks). 208 tests + build green. _(monstertype.json is shared data JSON, not @feature-exclusive per CLAUDE.md.)_ `monstertype.json`.
- ✅ **GP-2 rarity-by-location gradient DONE** (`@coordinator` 2026-06-07) — `spawnMonsters` now picks **weighted by distance from map center** (`pickMonsterByLocation`, pure + seeded): edges (where players spawn) → low rarity (catchable R2/R3), center (the shrinking-storm endgame) → rare R4/R5. Fixes the early-game catch wall with existing content + adds risk/reward depth; curve constants are tunable balance knobs. New `mapgen.test.js` asserts the edge<center rarity bias; determinism test still green. Build + 183 tests. *(Biome `rarity` weighting still unused — optional follow-up.)*
- 🟡 **GP-3 Storm DPS tuning** (was 🔴) — downgraded after re-verify: rotation works (see #2), so not instant death; `stormDps=25` is a **live-tunable balance knob** (`/admin`), not a code bug. `world.js:STORM_DPS`.
- ✅ **GP-4 Sprint stop-and-go — DONE 2026-06-07 (`@visual`):** the old 32 drain / 18 regen / 8 restart gave a punishing **3.1s burst → 5.6s recharge (~36% uptime)** plus a low-stamina stutter (you could resume with a sub-second flicker). Retuned `GAME.SPRINT`: drain 32→**26** (longer bursts), regen 18→**28** (faster recovery, the plan's upper bound), restart floor 8→**16** (cleaner resume). Now **~3.8s burst / ~3.6s recharge / ~52% uptime**. Pure constant change — movement tests reference the constants so they stay green (212). All tunable. `schemas.js:SPRINT`.
- ◑ **GP-5 No spawn separation — SEPARATION DONE 2026-06-07 (`@visual`):** player spawns were uniform-random, so 16 players could start on the same monster cluster. Added `findSpreadSpawns(voidMap, rng, count, minSepTiles=24)` (`mapgen.js`) — rejection-samples `findSpawnPoint`, re-rolling (bounded → always terminates) to keep each spawn ≥24 tiles from the others; accepts a closer spot on a sparse cave. `generateRound` now places all spawns via it (deterministic, seeded). Unit test (16 spawns all ≥24 apart); 212 tests + build green. **Remaining (optional):** PvP **spawn-immunity** (moot while `PVP_ENABLED=false`; revisit with PvP). `world.js`, `mapgen.js`.
- 🟠 **GP-6 Starter chain 1 charge/run** — `durability:1` → one (likely failed) catch then 9 dead minutes. Raise to ~3 charges / 5 throws. `spiritchains.json`.
- ✅ **GP-7 Portal reachability — DONE 2026-06-07 (`@visual`):** `spawnPortal` placed portals at a uniform-random angle, so far-edge players could have **0 reachable portals** (the win condition). Now each new portal is assigned to the **next quadrant in rotation** (the first 4 cover all 4 quadrants) and placed **out** in that quadrant (0.3–0.85·R from center, not clustered), with a **full-circle fallback** if the assigned quadrant has no walkable tile in range (graceful on sparse cave maps). Deterministic (uses the GP-8 seeded `portalRng`). Pairs with the VS-20 portal compass (direction) — now there's also always one within reach. Unit test added (first 4 portals cover 4 angle-sectors); 211 tests + build green. `world.js:spawnPortal`.
- ✅ **GP-8 `spawnPortal` non-deterministic** — **DONE 2026-06-07 (`@visual`):** portal placement used `Math.random()` while every other placement (map gen, player spawns) is seeded → portals broke the seeded/replayable-round design. Now uses a persistent per-round seeded stream (`round.portalRng`, lazy-init from `round.seed ^ 0x50525400`, distinct from the map-gen/spawn streams). `spawnPortal` exported + a determinism unit test (same seed → identical portals; different seed → different); 207 tests + build green. ⚠️ *Cross-lane (server `world.js`) — a clear correctness/determinism bug, `@feature` inactive; done via the existing `makeRng` seam, no behavior change beyond reproducibility.* `world.js`. _(Note: line ~420 `Math.random() < monsterGenRate` is an intentional non-seeded rate-gate, left as-is.)_
- ◑ **GP-9 Pre-round team HP** — **visibility DONE (`@visual` 2026-06-07):** the MP roster card already drew an HP bar; added the matching bar (success/warn/danger thresholds) to the **SP lobby** team strip (`lobby.js`) so an injured/fainted team is visible before committing to a run (SP HP persists between runs, healed only on extract). Verified via shoot-sp (full-health team → green bars). **Remaining (@feature):** the optional between-round "heal for gold" sink. `world.js:endRunForPlayer`, economy.
- ✅ **GP-10 Dead schema knobs — DONE 2026-06-07 (`@visual`):** `mapgen` hardcoded `rng.int(1,5)` for spawn level while `GAME.SPAWN_LEVEL_MIN/MAX` (1/5) sat unused. Now reads the config (`rng.int(GAME.SPAWN_LEVEL_MIN, GAME.SPAWN_LEVEL_MAX)`) — identical values so behaviour + determinism are unchanged (212 tests green), but the knobs are now honoured (env/admin-tunable). `mapgen.js`. *(Admin-panel exposure of these knobs is an optional follow-up.)*
- ✅ **GP-11 CLOSED — not a bug** (`@coordinator` re-verify 2026-06-07): `applyStorm` already rotates — it targets the first alive monster each tick and only returns run-lost when the whole team is down (`world.js:586-591`). The review's "ends on first faint" was stale/incorrect.
- 🟡 **GP-12 Gold too gated early** — first meaningful chain = 7 wins; pair with the rarity wall and progression stalls. Raise extract bonus or cut T2 price. `schemas.js:GOLD`, `spiritchains.json`.
- ✅ **GP-13 SP heal-on-extract (P10-T3) — ALREADY DONE (verified `@visual` 2026-06-07):** `game.js:endRunStakes(true)` already calls `healTeam(character.activeMonsters)` on extract (the shared `progression.js` helper MP uses — "P10-T3 parity" comment on both). Survivors heal on SP extract. Stale finding; closed. *(also LS-12)* `game.js`, `progression.js`.
- ✅ **GP-14 Wiki "Kaboom.js" stale — DONE 2026-06-07 (`@visual`):** fixed (engine → Phaser 3 + compat-shim note) as part of a broader **wiki mechanics sync** — the wiki is the design source-of-truth but had drifted from recent changes. Also updated: **sprint** values (GP-4: 26/28/16, ~52% uptime), **catch stabilization** (CB-9), **player-spawn spread** (GP-5) + **reachable-portal quadrant spread & compass** (GP-7/VS-20), and the footer refresh date. Verified built + tag-balanced. `wiki.html`.
- ✅ **GP-15 stale `pendingMove` — DONE 2026-06-07 (flexible worker).** Confirmed live: the movement
      loop skips while `locked` (in combat/PvP) but never cleared `rp.pendingMove`, so a move pending when
      the fight started survived and was applied on the FIRST tick after combat ended — a one-frame lurch
      in a stale direction. Fix: clear `pendingMove` whenever locked (`world.js` tickRound). `pendingThrow`
      was already nulled every tick in `processThrows`, so only `pendingMove` could go stale. Regression
      test added (queue a move while `inCombat`, end combat → position unchanged on the next tick). 248 green. `world.js`.

### B. Combat & catching (FGT)
- ◑ **CB-1 Burn/Poison expiry** — **IN-FIGHT FADE DONE 2026-06-07 (`@visual`).** ⚠️ *Cross-lane:* `@feature` has been inactive 18+ commits and the user authorized bugfixing, so `@visual` took this stalled 🔴 (`engine/*` is the shared core per CLAUDE.md). Burn/Poison were permanent until death (`applyStatusTick` never cleared them); added a tunable per-tick fade (`STATUS_FADE_CHANCE=0.25` ≈ 4-turn avg) so they wear off. **Self-contained in `engine/combat.js` — no combatant state-shape/serialization change (low-risk)** + a regression test (188 green). **Left for `@feature`:** Freeze also never expires (left untouched — a thaw roll is fragile to the inflict test; needs care); explicit status-clear on fight-end (`world.js`/systems — `healToFull` already clears on extract, and the fade now bounds cross-fight carry-over); optional refactor to fixed-duration (`statusTurns`) if preferred over probabilistic fade. `engine/combat.js`.
- ◑ **CB-2 heal attacks** — **CRUDE HEAL DONE 2026-06-07 (`@visual`, per `@coordinator` routing; `@feature` inactive).** `performAttack` now heals the user (~25% max HP, `HEAL_FRACTION`, tunable) on a heal move instead of hitting the enemy for 1. **Detected narrowly** — `damage<=0` AND a heal-type status/name (`/heal|regen|recover|restore/`) — because the `damage:0` pool is mixed: heals (Regeneration/Healing) vs **buffs** (Reflect/Defense Boost/Shielded) vs a **debuff** (Blinded); the latter two fall through unchanged so they are NOT mis-healed (a raw `damage<=0→heal` would have been wrong). Tests: heal-restores + buff-not-healed (190 green). **Remaining (FGT-T1 a/b):** nuanced per-move heal amounts + the *damage+heal* lifesteal moves (e.g. the "divine attack"). `engine/combat.js`.
- ✅ **CB-3 AI judge timeout DONE** (`@coordinator` 2026-06-07) — wrapped the OpenAI fetch in an
  `AbortController` with a 10s ceiling (`AI_TIMEOUT_MS`) in `server/ai.js`; on abort it throws, and
  the existing caller fallback (combat.js / pvp.js → deterministic engine; covered by the "AI failure
  falls back to the engine" test) kicks in, so a hung judge degrades to offline resolution instead of
  freezing the fight. Build + 182 tests + `node --check` green. *(CB-1/CB-2 still open under FGT-T2/T3.)*
- 🟠 **CB-4 No voluntary swap (MP)** — MP can only change monster on faint → a 4-monster team is strategically inert. 📌 **DESIGN DECISION NEEDED (`@visual` flagged 2026-06-07):** **SP already has voluntary swap** (`fight.js:doSwap`) but it's **free** (swap + your turn continues, no enemy retaliation), whereas this task says MP swap should **cost the turn** (enemy hits the incoming monster, Pokémon-style). So there's both an SP↔MP **parity gap** (MP lacks swap entirely) and an **inconsistency** (SP free vs proposed MP cost-the-turn). **@user: which swap model — (a) free swap both modes, or (b) cost-the-turn both modes (more strategic; matches this task)?** Then it's a clean port: server `resolveCombatAction` gets a `kind:"swap"` branch (change `session.active`; if (b), let the enemy attack) + an `onlineGame` Swap button/select (mirrors the SP UI + my combat-overlay work). Not implementing until the model is picked, to avoid shipping a balance fork. `server/combat.js`, `world.js`, `onlineGame.js`, `fight.js`.
- ✅ **CB-5 Energy stalemate** — **DONE 2026-06-07 (`@visual`, per `@coordinator` "ship a default"; `@feature` inactive).** Out of energy now triggers a free weak **Struggle** (flat ~5% of attacker STR, `STRUGGLE_STR_FRACTION`, ignores defense, no recoil) instead of skipping forever, so a mutually-exhausted fight can't deadlock. Updated the former "insufficient energy skips" test → Struggle (190 green). Tunable balance knob. `engine/combat.js`.
- 🟠 **CB-6 `elementalPenetration` ignored** — populated in every attack but unused in the damage formula. Wire it or remove the field. `engine/combat.js`, `attacks.json`.
- ❌ **CB-7 Deterministic element table covers only the canonical 5 — BY DESIGN (verified `@visual` 2026-06-07):** `elementMultiplier` scores Fire→Nature→Water (×1.3/0.7) + Dark↔Light (×1.2) and returns ×1.0 for everything else. This is **exactly** what `wiki.html#elements` documents as the intended design: "the *deterministic* matchup engine scores only these canonical relationships; the AI resolver interprets the rest freely." So the "neutralize all others" option the finding offered is **already the chosen, documented behaviour** — the deterministic engine is a deliberate minimal fallback/baseline, and the live AI judge handles the full 19-element space freely. Expanding the table would be an *unrequested balance/design change* (which elements beat which = game design, the user/wiki's call), not a bug fix. Closed as not-a-bug; the optional "+log when an AI element falls to neutral" is debug noise of negligible value. _(Also synced the wiki's stale element count 26→19 after CN-6.)_ `engine/combat.js:elementMultiplier`.
- 🟠 **CB-8 PvP has no catch path** — a Catch press in PvP is silently dropped though the button shows. Hide the button in PvP or implement rival-capture. `server/pvp.js`, `onlineGame.js`.
- ✅ **CB-9 Caught monsters keep near-death HP — DONE 2026-06-07 (`@visual`):** a catch copied the enemy's post-fight HP (e.g. 3/300) → the new teammate was useless for the rest of the run (no easy mid-run heal). Now stabilized to **`GAME.CATCH_HEAL_FRACTION` (0.5)** of max HP **and** energy, both **MP** (`world.js:endCombat`) and **SP** (`fight.js` catch), via the shared `getMonsterStats` (the plan suggested ~20%–full; 0.5 = usable but not a free full heal, tunable in one place). Verified manually (Inferno Hound L5: max 192 → caught at 96; was 1-3) + full gate green. 📌 *Balance knob — dial `CATCH_HEAL_FRACTION` if a harsher/softer catch is wanted.* `schemas.js`, `world.js`, `fight.js`.
- 🟡 **CB-10 AI prompt hardcodes old 6-element triangle** — contradicts the locked "AI decides elements" direction. Update `prompts.js` to open-ended elements.
- ✅ **CB-11 Rarity-gate message — DONE 2026-06-07 (`@visual`):** `resolveCatch`'s `gated = chance===0 && enemyRarity > maxRarity` inferred the "too powerful for this tier" message from `chance===0`, which conflates the rarity gate with a zero `captureMultiplier`, and read raw `maxRarity` (a null cap → `rarity > 0`). ⚠️ **The finding's literal suggestion (`rarity > (max ?? ∞)` alone) would REGRESS the guaranteed special** — a guaranteed chain auto-catches an over-tier monster at/below `GUARANTEED_HP_PCT` (chainCaptureChance returns 0.999 *before* its gate), so `gated` must exclude that case or it mislabels a win as a rejection. Fixed by mirroring chainCaptureChance's real gate: `gated = !(guaranteed && hpPct ≤ GUARANTEED_HP_PCT) && enemyRarity > (maxRarity ?? Infinity)` — decoupled from `chance`, null-cap-safe, behavior-identical for all realistic inputs but robust. **Display-only** (`gated` feeds only the log line, never `caught`). Regression-guard test added (over-tier → message shown; guaranteed low-HP over-tier → caught + NO rejection); 219 tests + lint + build green. **Left `spiritchains.js` untouched** (@feature-owned; the gate helper there is already correct). `engine/combat.js`.
- 🟡 **CB-12 PvP draw sends stale team payload**; **CB-13 PvP `advance` doesn't send new active/enemy snapshot** to either side (PvE does). `server/pvp.js`.
- ❌ **CB-14 Dead-by-status target still attacked — NOT-A-BUG (verified `@visual` 2026-06-07):** `resolveTurn`'s loop already guards both ends — line ~178 pre-checks `target.currentHealth <= 0` (a target killed by the first actor's attack → the second actor skips) and line ~180 re-checks the actor after its status tick (`skip || actor.currentHealth <= 0`). Crucially `applyStatusTick` only damages the **actor**, never the target, so a target cannot die from status mid-actor's-turn. No path attacks a dead target. Closed (stale finding). `engine/combat.js`.
- ⚪ **CB-15 `MODEL_OPTIONS` lists non-existent models** (`gpt-5.3/5.4`) → silent every-turn AI failure if selected. Audit list. `aiconfig.js`.
- ⚪ **CB-16 Combat temp 0.7 unbounded variance** — same turn can swing 45→120 dmg; tighten to ~0.3–0.5 + a damage-sanity clamp. `aiconfig.js`, `ai.js`.

### C. Netcode / multiplayer / scaling / anti-cheat
- ✅ **NC-1 `dt` cap DONE** (`@coordinator` 2026-06-07) — clamped the tick `dt` to `MAX_DT=0.15`
  (~2.25 normal ticks @15Hz) in `server/index.js` so an event-loop stall slows the sim briefly
  instead of teleporting players through walls / storm-one-shotting a team. Build + 182 tests green.
- 🔴 **NC-2 No client prediction** (laggy movement) (see Fix-first #6). `net.js`, P2-T3.
- 🟠 **NC-3 `pendingMove` cleared every tick** → a dropped packet stalls the player a full tick; hold until next input. `world.js`.
- 🟠 **NC-4 Predictable PvP ids** (`"v"+counter`) + `combatId` not type-checked → forgeable; add random suffix + `typeof==="string"`. `world.js`, `pvp.js`.
- ✅ **NC-5 PvP vault overflow** — **DONE 2026-06-07 (`@visual`):** the winner's vault `concat`'d looted teams with no cap → unbounded vault/DB growth over repeated wins. Now sliced to `vaultCapacity(win.profile, GAME.VAULT_SIZE)` (upgrade-aware) so overflow loot is dropped — consistent with a normal capture failing when the vault is full. Direct `endPvp` cap test added (197 green). ⚠️ *Cross-lane (PvP `server`, currently gated off via `PVP_ENABLED`) — clear safe bounds-fix, `@feature` inactive; ready for when PvP enables.* `server/pvp.js`.
- 🟠 **NC-6 Choppy rivals** — snapshots ~7.5Hz with no rival `vx/vy` to extrapolate. Emit every tick (budget allows) or add velocities. `world.js`.
- ◑ **NC-7 No session/IP cap — GLOBAL CAP DONE 2026-06-07 (`@visual`):** a flood of socket opens (each holds buffers + can mint a profile) could OOM the server with no concurrent-connection limit. Added `createConnLimiter({maxTotal})` (`ratelimit.js`, tested) — a hard global cap (`CONN_MAX_TOTAL`, default 600, env-tunable); `index.js` refuses sockets past it (close 1013) and frees the slot on disconnect. 215 tests + build green. 🟠 **Per-IP cap deferred (flagged):** behind Railway's proxy every socket shares the proxy `remoteAddress`, and the real client IP via `x-forwarded-for` has an uncertain trust model (capping the wrong value throttles everyone or is trivially spoofed) — needs the proxy's forwarded-IP behaviour confirmed before it's safe. The global cap is the reliable OOM guard meanwhile. `index.js`, `ratelimit.js`.
- ✅ **NC-8 Rate-limit evasion** — **DONE 2026-06-07 (`@visual`):** the close-the-flooder backstop decremented `violations` on every *good* message, so a paced flood could interleave good traffic to keep the counter pinned low and never trip the close. Replaced with a time-decayed `createViolationTracker` (`server/ratelimit.js`, pure + time-injectable, `RL_VIOLATION_DECAY=3`/sec, tunable) — violations now fall with elapsed time only, so a sustained flood accumulates → close while idle/legit clients are forgiven. 3 unit tests (paced-flood-still-trips / time-decay / legit-never-trips); the token bucket (primary protection) is unchanged. 196 green. ⚠️ *Cross-lane (server netcode, normally `@feature`/`@coordinator`) — a clear bug, `@feature` inactive, done carefully via the tested pure helper.* `server/ratelimit.js`, `server/index.js`.
- 🟡 **NC-9 No projectile lag-comp** (throw hits resolved on current positions, no rewind). Store 2-tick position history. `world.js:stepProjectiles`.
- ✅ **NC-10 Reconnect wrong-zone flash — DONE 2026-06-07 (`@visual`):** a resumed `roundStart` blanked the per-round spatial state (circle/portals/chests) + didn't carry the timer, so a reconnecting player flashed the fresh-round defaults (full zone / no portals / wrong clock) for ~133ms until the first snapshot — hit on **every redeploy reconnect** (frequent under continuous-deploy). Fix: `resumeRound` now folds the live `circle`/`time`/`portals`/AoI-`chests` into the resume payload, and `net.js` applies them on a **resumed** roundStart (a fresh round still clears, filled by the first snapshot). Net test added (resumed restores / fresh clears); 214 tests + build green. `world.js:resumeRound`, `net.js`.
- ✅ **NC-11 `combatAction` roundId assertion — DONE 2026-06-07 (`@visual`):** the handler validated playerId + `in_round` state + not-resolving, but not that the combat belongs to the player's **current** round — a stale combatId lingering across rounds could resolve against the new round's state. Added `session.roundId !== s.roundId` to the guard (combats already store `roundId`; zero false-positives since a live combat always matches the player's round). Defense-in-depth; test added (cross-round action rejected). 218 tests + build green. `world.js`. ◽ **NC-12 matchmaking countdown not persisted** (lost on restart) — minor; the whole in-memory queue resets on restart anyway. Deferred.
- ⚪ **NC-13 Non-crypto anon token** (dup of LS-2). ⚪ **NC-14 loadtest excludes monsters/combat** → optimistic CPU budget; add a realistic scenario. `tools/loadtest.mjs`. ⚪ **NC-15 `ALLOWED_ORIGINS` unset** → set `https://tamersquest.com` to stop cross-site WS hijack. `index.js`.

### D. Visual / UX / accessibility (extends PV-A1/A2/A3)
- ✅ **VS-1 SP overworld HUD fully hardcoded RGB** (team/chain/minimap/timer) — **DONE 2026-06-07 (`@visual` 28cfded):** routed through `THEME.*`; verified themed via shoot-sp. `game.js`.
- ✅ **VS-2 SP minimap red player-dot vs red storm** — **DONE (28cfded):** self-dot → `THEME.primary` (teal) + minimap zone-circle → blue. Full MP-minimap unify (biome sampling, rival glyphs) still deferred. `game.js`.
- ✅ **VS-3 `textMut` WCAG** — **DONE 2026-06-07 (`@visual` 70405e5):** `#6C6A82`→`#8A8AA8` (contrast 3.1–3.8 → 4.9–5.9, audit-verified). `theme.js`.
- ✅ **VS-4 element colors unified + colorblind** — **DONE 2026-06-07 (`@visual`):** palette done earlier (`70405e5`: ice→`#C8F0FF`, metal→`#7E8AA0`, deutan ΔE 6→14 / 1→14). Now CONSOLIDATED the **three** drifting element-color maps (theme `ELEMENT_HEX`, `onlineGame ELEM_COLORS`, `bestiary EL`) into the one source of truth `theme.elementColor`: made it comprehensive (+`mystic`/`spirit`/`sound`/`sonic`/`none`) and added a **hashed fallback** so open-ended AI elements get varied colors (not flat gray) — preserving onlineGame's richness while keeping the colorblind-tuned values. `bestiary.js` + `onlineGame.js` now delegate to it (format-identical alias), so MP combat badges/tints AND the bestiary both get the tuned palette (onlineGame's local map was the *unfixed* air≈ice one). Verified via the bestiary (103 monsters — correct per-element outline+label colors); MP verified by reuse (same fn, unchanged call sites). Also fixed `shoot-faces.mjs`'s stale "press b" nav (now via the SP lobby). `theme.js`, `onlineGame.js`, `bestiary.js`.
- ✅ **VS-5 Element badge (colorblind)** — **DONE 2026-06-07 (`@visual` 7cd3f2e):** combatant element dot now carries the element's first letter (luminance-picked contrast) → readable without hue. (Attack buttons already show attack names.) `onlineGame.js`.
- ✅ **VS-6 Combat enemy/self hierarchy** — **DONE (7cd3f2e):** red(enemy)/teal(self) left-edge accent strip per combatant row; verified in live combat. `onlineGame.js:drawCombatant`.
- ❌ **VS-7 SP fight HP bars init green** — **NOT A BUG (verified `@visual` 2026-06-07):** the reviewer missed the scene-level init `updateBars()` at `fight.js:574` (`// ─── Init ───`), which runs synchronously during setup *before* the first render, so the fills get correct width+color on frame 1 — no green flash, no ghost rect. Closed.
- ✅ **VS-8 Debug data in prod HUD** — **DONE 2026-06-07 (`@visual` 178ea95):** seed + live coords gated behind `import.meta.env.DEV`. `onlineGame.js`.
- ✅ **VS-9 SP combat buttons now use `addButton`** — **DONE 2026-06-07 (`@visual`):** `fight.js makeBtn` now delegates to the themed `addButton` (glow/SFX/sheen/shadow/outline + MB-12 haptic), matching the rest of the game (onlineLobby was already migrated, `68d00c3`). Extended `addButton` with two backward-compatible opts: `tag` (applied to every layer so `clearButtons()`/`destroyAll(btnTag)` wipes the whole button — shadow/sheen/glow/label — between menu states) and `disabled` (greys unaffordable attacks → `surfaceAlt` fill + `textMut` ink, drops interaction). Both default to the prior behaviour, so every existing caller is unaffected. Verified: build clean + the SP lobby (also `addButton`, default path) renders unchanged via shoot-sp → non-regressive; **and now verified LIVE in combat** via the new `tools/shoot-spcombat.mjs` harness (below) — the player menu (Fight/Catch/Swap/Skip/Flee), attack-select, and swap-select all render the themed buttons (shadow/sheen/rounded/outline). `fight.js`, `theme.js`.
- ✅ **VS-10 Storm color SP-red vs MP-blue** — **DONE (28cfded):** SP storm wall + minimap zone standardized to MP's blue. (Refinement: extract a `PAL.zone` token so both modes pull one source.) `game.js`.
- ✅ **VS-11 Vignette flattened** — **DONE 2026-06-07 (`@visual`):** softened `genVignette`'s radial stops — pushed the dark band outward (inner radius 0.16→0.18, outer 0.62→0.66) and lowered the edge max from a near-opaque **0.92 → 0.70**, with the inner ~80% now held ≤0.40. The corner HUD (top-left team HP bars), timer, chain info, and corner rivals all read clearly while the haunted edge-darkening survives. Verified via `shoot-sp` (idle + post-move overworld). `atmosphere.js`.
- 🟡 **VS-12 No scene transitions** — instant cuts; a 50ms fade needs a `main.js` hook (@phaser).
- ✅ **VS-13 SP run-result standardized** — **DONE 2026-06-07 (`@visual`):** `runResult.js` now handles every exit code (SP `victory`/`timeout`/`defeat` + MP-style `extracted`/`died`) with an accurate per-code title/colour + correct stakes messaging; fixed two mislabeled codes (game.js overworld time-up `defeat`→`timeout`; fight.js no-usable-monster `timeout`→`defeat`). **⚠️ @feature — also removed a stale gameplay bug:** runResult was re-healing on victory (redundant — `endRunStakes(true)` already heals upstream) and, on ANY non-victory code, **wiping the entire team + granting 4 random starters** — which contradicts the documented extraction-stakes design (lose run-found *chains*, KEEP the team; `finalizeRunChains(false)` already applies that upstream before runResult). A timeout was nuking a player's leveled team. Made runResult a **pure presentation scene** (no state mutation). All 4 exit paths verified to apply stakes upstream first. **Please confirm the keep-team intent — easy to revert if SP was meant to be harsher.** Build + 183 tests green. `runResult.js`, `game.js`, `fight.js`.
- ✅ **VS-14 loading error** — **DONE 2026-06-07 (`@visual`):** the map-gen failure handler now surfaces the actual `e.message` on-screen **in DEV** (truncated, saves opening the console); prod keeps the generic non-leaky "Returning to lobby…". `loading.js`.
- ✅ **VS-15 Escape-to-back inconsistent across menus** (`@visual` find+fix 2026-06-07) — `cosmetics`/`bestiary`/`roster`/`onlineShop` supported Esc-to-go-back but `shop`/`baseUpgrades`/`settings`/`inventory` only had a clickable "Back" → a desktop/keyboard player pressing Esc got nothing. Added a matching `k.onKeyPress("escape", …)` to the four missing scenes (mirrors their Back button → lobby). Verified end-to-end via `shot-scenes` (the harness's Esc-based nav now traverses inventory→shop→baseUpgrades, which was previously stuck on inventory). **Follow-up done same day:** `onlineLobby` (the MP entry) was the last menu without Esc — added it there too, handled on **both** the canvas and the auto-focused nickname `<input>` (idempotent `back()`), so Esc backs out whether or not the field has focus. Verified via `shoot.mjs` (Esc from the lobby → title). `shop.js`, `baseUpgrades.js`, `settings.js`, `inventory.js`, `onlineLobby.js`.
- ✅ **VS-16 Settings was an empty stub** (`@visual` find+fix 2026-06-07) — the Settings scene said "No settings to configure yet." while the game's **persisted mute** (`audio.js`) was reachable only via the undiscoverable in-round **M key**. Added a **Sound On/Off toggle** (green/On ↔ grey/Off, rebuilt on toggle via the VS-9 `tag` feature so its base colour tracks state) + a hint line. Verified via `shot-scenes`. `settings.js`. Also extended `shot-scenes.mjs` to cover cosmetics + settings.
- ✅ **VS-17 SP inventory cards: element accents + HP bars** (`@visual` find+fix 2026-06-07) — the SP inventory's `renderSlot` used hardcoded hex/RGB outlines (`#444444`/`#ffcc00`), no element identity, and HP as text only. Routed it through `THEME`: **element-colored outline** per card (`elementColor`, selected → teal `primary` + thicker) and an **HP bar** (success/warn/danger), matching the MP roster / bestiary / SP lobby strip. Verified via `shot-scenes` (Water=blue, Nature=green, Earth=amber, Holy=gold outlines + full-health bars). `inventory.js`.
- ✅ **VS-18 `prefers-reduced-motion` (a11y)** (`@visual` find+fix 2026-06-07) — the game had no respect for the OS "reduce motion" setting (vestibular a11y). Added `src/systems/a11y.js` `prefersReducedMotion()` (live `matchMedia`, safe in non-browser, unit-tested — 4 cases). The persistent decorative motion now honors it: `atmosphere.js` freezes the spirit-glow pulse + drops the 26 drifting motes; `loading.js` freezes its glow pulse. Static vignette + glow remain so ambiance survives. Verified end-to-end via `shoot-sp REDUCE_MOTION=1` (motes present normally → absent under emulation, scene intact). *(Follow-up for `@phaser`: a CSS `@media (prefers-reduced-motion)` for any `index.html` title animation.)* `systems/a11y.js`, `render/atmosphere.js`, `scenes/loading.js`.

- ✅ **VS-19 Combat AI-latency feedback** — **DONE 2026-06-07 (`@visual`):** AI-resolved combat takes ~1-2s/turn, but the only "working…" signal was a tiny 13px "Resolving…" line at the panel bottom while the **action buttons stayed fully lit and tappable-looking** (input is gated, so taps were silent no-ops → felt frozen/dead). Now while input is locked (AI `awaiting` **or** the PvP opponent-wait `c.waiting`): the action buttons **dim to 0.4** (read as inactive) and a **prominent animated badge** (8-dot rotating spinner + "Resolving turn…" / "Waiting for opponent…") draws centered over the button block — unmissable. `onlineGame.js` only. Verified via a forced-state local combat capture (badge + dimmed buttons render correctly, no client errors); lint + 206 tests + build green. Addresses the standing "combat UX/feel + AI-latency feedback" polish priority. **SP follow-up N/A (verified `@visual` 2026-06-07):** SP combat (`systems/combat.js`) is **fully deterministic** — no AI/network, resolves synchronously — so its "Resolving..." flash is ~1 frame and needs no spinner (`fight.js` already clears buttons during it anyway). _(Also fixed the MP QA harnesses' stale lobby coords after the LS-14 restructure — `shoot-combat/round/roster/mpmenus`.)_

- ✅ **VS-20 Off-screen portal compass (extraction guidance)** — **DONE 2026-06-07 (`@visual`):** in an extraction game the win condition is reaching a portal before the storm closes, but portals only showed on the minimap (small) + as the in-view rift — so a player not near one had **no in-world cue which way to run**. Added `drawPortalCompass()` in `onlineGame`: a screen-edge arrow toward the **nearest** portal (world→screen via the camera center, edge-clamped) with a **distance-in-tiles** label, portal-cyan to match the minimap dots; **auto-hides once the rift is on-screen** (you can see it) and during combat/result/pause/onboarding. Built from `drawLine`/`drawCircle` (shim has no triangle prim). Verified via a local round (`CIRCLE_START_S=1`) + a forced-direction capture — arrow points correctly (↘ to a down-right portal) with the right distance ("75"), no client errors; lint + 207 tests + build green. Delivers the **PV-T8** "portal-hint styling" line. `onlineGame.js`. ✅ **SP parity DONE 2026-06-07 (`@visual`):** ported the same compass to SP `game.js` (SP had only a text "Portals available" hint, no direction) — converts SP's **tile-space** portals → world, uses the player-centered camera, draws **on top of the HUD** (after team/chain HUD so it's never hidden), and **skips the bottom-right minimap zone** (SP's minimap is there; it shows portals anyway). Verified via `shoot-sp` forced-direction captures (renders correctly on a clear edge; on-top order confirmed). 213 tests + build green. `game.js`.

- ✅ **VS-21 Final-minute extraction-urgency timer** — **DONE 2026-06-07 (`@visual`):** the round clock IS the extraction deadline, but it was just small text buried in the top-left info line with no urgency cue. Added `drawTimeWarning()` in `onlineGame`: in the last 60s a large centered timer appears (**amber + "extract soon"**), going **red + pulsing + "STORM CLOSING — EXTRACT NOW"** in the last 30s. Placed below the touch pause button; auto-hidden during combat/result/pause/onboarding (the always-on info-line timer still covers those). Verified via short-round local captures (amber `0:32`/"extract soon" and red `0:24`/"STORM CLOSING"), no client errors; lint + 207 tests + build green. Delivers the **PV-T8** "timer styling" line. `onlineGame.js`.

- ✅ **VS-22 Floating combat damage numbers** — **DONE 2026-06-07 (`@visual`):** combat showed an HP-bar drop + hit-flash + sparks but never the **magnitude** of a hit (a standard RPG readability element). Added floating damage numbers in `onlineGame` combat: on each HP drop (reusing the existing hit-flash delta — no new state plumbing) a `-N` rises + fades over 0.8s, **amber on the enemy / red on you**, anchored to the right of each combatant row. Verified via a forced-state local combat capture (`-45` amber on the enemy, `-18` red on self, readable + correctly placed). lint + 217 tests + build green. ✅ **SP parity DONE 2026-06-07 (`@visual`):** ported to SP `fight.js` — `spawnDmgFloater()` (temp `k.onDraw`, mirrors `playCaptureFx`) spawned from `applyTurnResult` (attack/skip: enemy@0.75w amber, you@0.25w red) + `doCatch` (catch-attempt damage), at y235 (between sprite y170 and HP bar y270). Verified SP combat renders cleanly with the change via `shoot-spcombat` (no errors); render identical to the verified MP version. ✅ **Heal `+N` DONE 2026-06-07 (`@visual`, MP):** an HP *increase* (CB-2 heal moves) now shows a green `+N` (same floater path, sign+colour differ — correct by parity with the captured damage floater); lint + 217 tests + build green. ✅ **SP heal `+N` DONE 2026-06-07 (`@visual`):** `fight.js spawnDmgFloater` gained a `heal` flag; `applyTurnResult` spawns a green `+N` on an HP increase (same path as the SP damage floater). Damage **and** heal numbers now show in both modes. lint + 217 tests + build green. `onlineGame.js`, `fight.js`.

### E. Mobile / responsive / PWA / perf
- 🔴 **MB-1 DPR canvas-in-corner bug** — `RENDER_SCALE` measured once at boot from `innerWidth/Height` (pre-reflow); no resize handler → wrong buffer on orientation change / retina. Recompute on Phaser `resize`. `compat/kaboomShim.js`.
- ✅ **MB-2 SP touch controls** — **DONE 2026-06-07 (`@visual` a32f351):** ported the floating joystick + THROW button to the SP overworld (`game.js`) — analog movement (unit-normalized; keyboard unaffected + verified), tap-THROW, draws only after first touch (no desktop clutter). Touch verified via CDP touch-drag. SP combat (`fight.js`) buttons are already `onClick`/tappable on touch. Closes P6-T6/MOB-T1 overworld gap. **Residual:** sprint on touch (safe-area insets now DONE — see MB-4).
- ✅ **MB-3 Multi-touch joystick** — **DONE 2026-06-07 (`@visual`):** the pointer-ID separation the finding asked for is now complete. Movement already tracks a single `joyId`, `joyStart` is left-half-only, and the THROW/pause hit-tests early-return (right side) *before* `joyStart` — so a left-thumb stick + right-thumb THROW already route to different IDs, and combat taps are debounced via `awaiting`. (The finding's "2nd finger routes through `joyStart`" describes pre-`joyId` code.) Closed the last real gap: a 2nd **left-half** touch could hijack the active stick (`joyStart` overwrote `joyId`) → added `if (joyId !== null) return` so one finger owns movement. Move+throw / move+tap now coexist. Verified by inspection + build; full headless multi-touch proof needs the dedicated MP-round harness (skipped to avoid rebuilding the shared `dist`→localhost mid-loop). `onlineGame.js`.
- ✅ **MB-4 Touch controls respect safe-area (notch/home-bar) — DONE 2026-06-07 (`@visual`):** the THROW button, touch pause button, virtual-joystick hint, and the **combat panel** used hardcoded screen-edge offsets that sit under a phone's notch / rounded corners / home-bar. Added `src/systems/safearea.js` `readSafeAreaInsets()` (reads `env(safe-area-inset-*)` off a hidden probe element — non-zero only with `viewport-fit=cover`, which `index.html` sets; returns zeros in non-browser / no-notch; **unit-tested**, 4 cases incl. non-browser + negative-clamp). `onlineGame.js` converts those CSS-px insets into design units via the canvas FIT scale (`canvasCssHeight/k.height()`), cached + refreshed on a 1s throttle, and offsets each control inward: THROW (`-right/-bottom`), pause (`+top`), joystick hint (`+left/-bottom`), and the combat panel **grows upward by the bottom inset** (content clears the home-bar; the dark background still fills to the screen edge behind it). **Gated to touch devices, so desktop runs zero new code and the layout is provably unchanged** (every offset adds an all-zero inset). lint + 223 tests + build green; dev client boots clean. _(Live notch render can't be emulated headless, and a zero-inset capture is identical to before by construction; a `?ws=` harness hiccup blocked the in-round screenshot — orthogonal to this pure-client change.)_ ✅ **SP overworld DONE 2026-06-07 (`@visual`):** ported the same helper to `game.js` — THROW (`-right/-bottom`) + touch pause (`+top/-right`) now respect the insets (touch-gated, no-op on desktop). **Verified clean** — `tools/shoot-sp.mjs` gained `TOUCH=1` support (emulates a touch device + reveals the controls via a tap) and a touch run against a fresh build renders the controls with **no PAGEERR**. Closes the MB-2 "safe-area insets for SP buttons" residual. ✅ **SP combat (`fight.js`) ASSESSED — no inset needed (`@visual` 2026-06-07):** unlike the MP combat *panel* (bottom-anchored, its last button row sat ~48px off the screen edge), SP combat is a **centered arena** — sprites y≈170, HP bars y≈270, button rows `btnY=390`→~530 of the fixed 720 design height (~190px clear of the bottom). The design height is fixed (only width varies with aspect), so those buttons are always ~74% down, well above any home-bar; an inset would shift well-placed buttons up for no benefit, so fight.js is correctly left unchanged. **MB-4 COMPLETE.** `onlineGame.js`, `game.js`, `systems/safearea.js`, `tools/shoot-sp.mjs`.
- 🟠 **MB-5 Canvas missing `touch-action:none`** (only on body) — add `canvas{touch-action:none}`. `index.html`.
- 🟡 **MB-6 Rotate-overlay** fires on desktop touch + doesn't cover the canvas after launch; drive from JS `orientationchange`. **MB-7 `orientation.lock("landscape")` never called.** `index.html`, `main.js`.
- ◑ **MB-8/9/10 PWA hygiene** — **VERIFIED 2026-06-07 (`@visual`):** ❌ **MB-10 NOT-A-BUG** — `sw.js` is **network-first** (fetch → cache fallback), so deploys are picked up immediately; the static `tq-v1` key is just the offline-fallback bucket (overwritten on each fetch), no staleness. ✅ **MB-9 RESOLVED** — `public/apple-touch-icon.png` is present (180px, generated by `tools/gen-icons.mjs`); not missing. ❌ **MB-8 NOT-A-BUG** (re-verified `@visual` 2026-06-07) — `icon.svg` *is* maskable-designed: full-bleed bg + content centered in the safe zone (the figure + chain-ring all sit ≤~174px from center vs the 205px / 40%-radius maskable safe circle). So the icons are maskable-safe, and `"any maskable"` on one entry is the *correct* declaration for a dual-purpose (full-bleed-`any` + masked-`maskable`) icon — not a defect. (Earlier "asset task" note was wrong; no new icon needed.) `manifest.webmanifest`, `sw.js`.
- ✅ **MB-11 Onboarding shows keyboard hints on touch** — **DONE 2026-06-07 (`@visual` 5bb6f57):** onboarding lines switch to touch gestures on touch devices; **also added a touch pause button** (the pause/leave menu was ESC-only → touch players couldn't pause/leave). Verified via touch capture. `onlineGame.js`. **Follow-up:** SP (`game.js`) has the same no-touch-pause gap + no SP onboarding (LS-7).
- ✅ **MB-12 Haptics** (MOB-T4) — **DONE 2026-06-07 (`@visual`):** added a mute-gated `haptic(pattern)` helper to `audio.js` (no-op when `navigator.vibrate` unsupported — desktop/iOS Safari — so safe to call anywhere). Wired into every themed button tap (`theme.js` `addButton` → `haptic(8)`) and the high-feel combat moments in both SP (`fight.js`) and MP (`onlineGame.js`): `haptic(15)` on your-monster-hit, a `[0,30,40,60]` celebratory pattern on catch-success, `haptic(8)` on combat-action tap. Un-testable headless (no vibrate motor) but trivially safe by guard. `audio.js`, `theme.js`, `fight.js`, `onlineGame.js`.
- ⚪ **MB-13 No mobile FX/perf budget** (MOB-T3) — halve `MAX`/skip motes/cap RENDER_SCALE on low-end. `fx.js`, `atmosphere.js`.

### F. Content / progression / economy / meta
- ✅ **CN-1 Online meta-upgrade UI** — **DONE 2026-06-07 (`@visual`):** the server `buyUpgrade` handler + `net.buyUpgrade` were already done+tested; the missing piece was the **client UI**, so online players couldn't spend run-earned gold on permanent upgrades. Added `onlineBaseUpgrades.js` — the MP counterpart of SP `baseUpgrades.js`, in the `onlineShop.js` immediate-mode idiom: lists Prospector/Attunement/Deep Vault with Level X/max + Buy `[cost]g`, reads `net.state.gold`/`upgrades` via `UPGRADE_DEFS`/`upgradeLevel`/`nextUpgradeCost`, calls `net.buyUpgrade(id)`, and refreshes on the server's `"upgrades"` echo (net.js already folds gold/levels into state). Reachable via a new **"Base Upgrades"** button in `onlineLobby` (joins-then-opens like Manage Team / Spirit Shop). Registered in `featureScenes.js`. Verified via `shoot-mpmenus` (renders, reachable, costs + affordability correct). lint + 206 tests + build green. ⚠️ *Tagged `@feature` but it's pure client UI/render (= `@visual` lane); the gameplay logic (server + net) was already done.* `onlineBaseUpgrades.js`, `onlineLobby.js`, `featureScenes.js`.
- ✅ **CN-2 No R1, single R2 monster** — **DONE 2026-06-07 (`@visual`):** added 12 low-stat R1/R2 monsters (pool R1/R2 0/1 → 6/7), fixing the broken difficulty ramp. See **GP-1** for details (stats/attacks/verification). `monstertype.json`.
- ◑ **CN-3 R5 base stats wildly inconsistent** (150→5000 HP; some R5 < R4) → rarity meaningless. **Scaling-driven half DONE** (see CN-4 — the worst HP/STR runaways were the exponent error). **Remaining = base-stat balance curve** (e.g. baseHealth outliers: Glacial Leviathan 5000, Pyroclasm Drake 2000, Gale Griffin 1800; and R5<R4 inversions). 📌 **This is a balance *design* decision (what should each rarity's power band be?) — flagging for @user/@feature rather than unilaterally re-tuning ~20 monsters' bases.** `monstertype.json`.
- ✅ **CN-4 Inferno Hound (R3) scaling OP — DONE 2026-06-07 (`@visual`):** the real error was runaway scaling **exponents** (`scaling2`). Data showed 90% of `scaling2` ≤1.2, 95% ≤1.3, but a 1.4–2.7 tail (13 monsters, 36 values incl. Inferno Hound's 2.0–2.7) produced stats 10× their rarity band. Capped `scaling2` at **1.3** (the established 95th-pct ceiling) via a raw-text regex → clean 36-line diff, bases/`scaling1` untouched so low-level behaviour is preserved, only the explosive tail tamed. **Inferno Hound STR @L10 782 → 189.** Regression test added (no `scaling2` > 1.3); 209 tests + build green. _(Follow-up: `gen.js` could clamp the same way so AI-generated monsters can't re-introduce runaways.)_ `monstertype.json`.
- 🟠 **CN-5 All monsters `biome:null`** — biome distribution layer missing; assign + weight spawns. `monstertype.json`, spawn logic.
- ✅ **CN-6 Element taxonomy normalized — DONE 2026-06-07 (`@visual`):** merged the unambiguous synonyms (Shadow+Darkness→**Dark**, Wind→**Air**, Holy→**Light**) and resolved the 3 malformed dual-element compounds (Water/Ice→Ice, Fire/Ice→Fire, Nature/Water→Nature) in `monstertype.json` — **26 → 19** distinct elements, so the bestiary groups the 11 dark-concept monsters as one (was 3 fragments) and combat-element handling is consistent. **Left distinct rare elements** (Celestial/Chaos/Ghost/Void/Lunar/Cosmic/Arcane/Ethereal/Mercury) — merging those is a design call, and freeform AI elements stay supported (the UI `elementColor` already hash-colors arbitrary strings, VS-4). Zero gameplay risk (element derives from the type at runtime). Canonicalization guard test added; clean 13-line diff; 213 tests + build green. `monstertype.json`.
- ✅ **CN-7 attack names embed their description** — **DONE 2026-06-07 (`@visual`):** 8 names embed the full description (`"Burrow Strike - Digs underground…"`), overflowing combat-button labels + bloating the AI judge prompt. Added `cleanAttackName()` (`engine/gamedata.js`, re-exported via `data.js`) and applied it at every DISPLAY/prompt point: SP attack buttons (`fight.js`), MP combat buttons (`onlineGame.js` — label only; the `attackName` action key stays full), bestiary detail (`bestiary.js`), and the AI combat prompt (`server/ai.js` `describe()`). **Display-only by design** — the full name stays the lookup key because monsters reference attacks *by name* and two *distinct* attacks share the base name "Healing Light" (a pure-heal `damage:0` vs a `damage:10`), so stripping the key would collide/mis-route. Helper unit-tested (193 green). **Optional follow-up:** clean the 7 non-colliding names in `attacks.json` + their monster refs (the 8th, "Healing Light", needs that collision resolved first). `gamedata.js`, `fight.js`, `onlineGame.js`, `bestiary.js`, `server/ai.js`.
- 🟠 **CN-8 Meta-upgrades shallow** (3 pure multipliers, no qualitative change) — add Chain Mastery / Monster Bond / Striker etc. `engine/upgrades.js`.
- 🟠 **CN-9 Cosmetics economy (USER 2026-06-07 = mix earned + free).** Make **some** skins free and
      **some earned** (gold/essence cost or milestone/achievement unlock) — a real sink + reward, not all-free.
      Tag each skin in `chainCosmetics.js`/`characterCosmetics.js` with an acquisition (free | cost N | unlock-X);
      gate equip on ownership for earned ones. **+ Monetization wanted (deferred):** the user wants real-money
      monetization **later** — track under **CN-16** (gacha) + a new **MON** note: cosmetics are the
      intended monetization surface (visual-only, no pay-to-win). Don't build paid flows yet; design the
      earned/free split now so it's monetization-ready. `chainCosmetics.js`, `cosmetics.js`, `engine/*` (ownership).
      ✅ **MP buy — SERVER + NET wired (flexible worker, 2026-06-07):** the SP buy shipped (0cd3ac7/6c0f9ab)
      but online showed "coming soon" (no server handler). Added the **`buyCosmetic` server handler** (`world.js`,
      mirrors `buyChain`/`buyUpgrade`): looks the skin up in the **server-safe import-free catalogs**
      (`CHAIN_SKINS`/`CHARACTER_SKINS`), validates price/affordability via the pure `buySkin` engine, deducts
      gold/essence + grants the id **server-authoritatively** (a client can't forge a cheaper buy), replies
      `{t:"cosmetic"}`. `profile.ownedCosmetics:{chain:[],char:[]}` added (`createPlayerProfile`) + sent in
      `welcome`. **`net.js` wired:** welcome→`state.ownedCosmetics`, a `cosmetic` reply handler (sync wallet +
      owned + `lastCosmetic` outcome), `net.buyCosmetic(kind,skinId)` exported. Server test (deduct/own/reject-
      unaffordable/unknown-id), 265 green. ✅ **End-to-end DONE (flexible worker, 2026-06-07):** wired the
      **`cosmetics.js` scene** `tryBuy` online path → `net.buyCosmetic(kind, skinId)` + "Purchasing…", and a
      `net.state.lastCosmetic` watcher in the update loop turns the server reply into a **"Purchased!" / "Not
      enough …"** toast (one-shot per reply timestamp); the card re-renders owned from `net.state.ownedCosmetics`
      and a second tap equips. **MP earned skins now buy end-to-end** (server-authoritative price, no client
      forging). Build + 265 green. _(CN-9 economy: free/earned split, SP buy, MP buy, ownership all shipped;
      monetization/real-money still deferred per CN-16/MON.)_
- 🟡 **CN-10 Endgame gold dry** once chains/upgrades bought — add a chain "refill charges" sink + consumables. `item.json` (empty), `schemas.js`.
- 🟡 **CN-11 `item.json` empty** — no consumables (potions/bait/charms); define 5–10 + chest drops. `item.json`.
- ◑ **CN-12 Cosmetics MP sync — DONE 2026-06-07 (`@visual`):** chain-skins were localStorage-only, so `drawCharacter` painted **your** skin on **every** rival (and others never saw yours) — cosmetics didn't differentiate players in MP. Now synced: `drawCharacter` takes a per-character `skin` (default = local, so SP/self unchanged); `net.setSkin(id)` → server `setSkin` handler (validated `[a-z0-9_-]{1,24}`, persisted on the profile) → each rival's `skinId` rides the snapshot → client renders `getSkin(rival.skinId)`. `onlineGame` sends the local skin on entry. Tests: server stores-valid/rejects-abuse + net sends-id/snapshot-carries-skinId (217 green). Data-flow tested; 2-player visual deferred (needs 2 clients). **Device-change persistence is moot pre-auth** (anon token = per-device profile); revisit with AUTH. `character.js`, `net.js`, `world.js`, `onlineGame.js` *(closes LS-13)*.
- ✅ **CN-12b Character-skin cosmetics in MP** — the new **character skins** (accent + cloak, `characterCosmetics.js`, Cosmetics store "Player Character" tab, `abe151a`) applied in **SP** (`game.js`) but not MP. ✅ **Self DONE 2026-06-07 (`@visual`):** `onlineGame` now draws **your** character with its equipped accent + cloak (mirrors SP) — safe for self since the camera centers you, so there's no self/rival colour-coding to preserve; default "azure" accent == the old hard-coded blue, so default players are unchanged. lint + 218 tests + build green. ✅ **Rivals — RESOLVED by user 2026-06-07: "Red accent" → option (a).** Rivals keep the hard-coded **red** accent (threat-coding readable at a glance); the cosmetic accent stays **self-only**. This is already the case (`onlineGame` draws rivals `[210,90,90]`), so **CN-12b is complete** — no further code. _(Optional later: rivals' cosmetic **cloak** could still be synced + shown while keeping the red accent — a strict readability-safe add — but the user's terse "red accent" was taken as the minimal reading; not building it speculatively.)_ `onlineGame.js`.
- 🟡 **CN-13 No endgame/prestige loop** — once maxed, no goal; add prestige rank / R5-collection / seasonal challenges.
- ⚪ **CN-14 40+ near-dup status strings** (Stun/Stunned…) — normalize. `attacks.json`. ✅ **CN-15 Vault-fill meter** — **DONE (`@visual`):** MP roster vault label shows "N / cap" (Deep-Vault-aware) + warn ≥90% / danger+FULL at cap. `roster.js`. (SP `inventory.js` meter — @feature, ties to INV-T2.)
- 🔮 **CN-16 Gambling / gacha loop** `@unassigned` — **user-requested 2026-06-07, explicitly "way later" (post-launch backlog — do NOT start now).** Add a chance-based reward mechanic. **Preferred target: cosmetics** (a skin "lockbox" / spin spent on an in-game currency — natural sink for the still-open **CN-9** cosmetics-economy and the **CN-13** endgame loop, and *visual-only so odds are pure delight, not power*). **Alt target: monsters** (a gacha pull on the gen pipeline — riskier: it makes catching power pay-to-win-adjacent and competes with the core throw/capture loop; weigh carefully). **Design musts when it's picked up:** (1) **in-game currency only by default** — if real-money purchase is ever added it becomes a regulated **loot box** (🔴 legal: Swiss operator + the live game may have minors; jurisdictions differ — would need disclosed odds, age-gating, and a **CMP**/ToS update → escalate to the user first); (2) **published drop rates** (transparency, and several stores require it); (3) **deterministic-friendly** — the roll must be seedable/serverside-authoritative (no client-trusted odds), reuse `engine/rng.js`; (4) **pity/duplicate handling** so it doesn't feel exploitative. Ties: CN-9, CN-13, cosmetics rows, `engine/rng.js`, CMP. _No owner until the user green-lights starting it._

### G. Onboarding / launch / security / tech-debt
- 🔴 **LS-1 Rotate `.env` secrets** (live OPENAI + Railway token on disk) — **user action** (escalated to REQUIREMENTS). ✅ **LS-2 Crypto session tokens — DONE 2026-06-07 (`@visual`):** the anon session token (`token → profile`, i.e. it authenticates the player) was `randomSeed()+counter` (predictable → account-takeover); now minted from `crypto.randomBytes(24)` (`secureToken()` in `store.js`, 192-bit), with `rid()` kept for non-security uniqueness ids (monster/profile). Existing tokens still validate (lookup unchanged); format+uniqueness test added (198 green). ⚠️ *Cross-lane (server; the crypto-token code fix is `@feature`-assigned + NOT user-gated per the Fix-first owners; `@feature` inactive.)* 🔴 **LS-3 Auth is "coming soon"** on a live game — remove the buttons or expedite native accounts (AUTH-T3). `store.js`, `index.html`.
- ✅ **LS-5 Admin XSS DONE** (`@coordinator` 2026-06-07) — added an `esc()` HTML-escaper in
  `public/admin.html` and applied it to every attacker-influenced field rendered via `innerHTML`:
  player **nicknames** (`recentResults[].name`), **AI-generated monster names/elements**
  (`generated[].typeName/element`), round ids/phase, and model-option values. A malicious nickname
  can no longer execute script in the admin's session (→ `ADMIN_TOKEN` theft). Build + 182 tests green.
  *(Broader client/XSS sweep across other surfaces remains under SEC-A4.)*
- 🟠 **LS-4 PvP on by default in prod** (`PVP_ENABLED!=="false"`) while FGT/PvP path is incomplete → set `PVP_ENABLED=false` until FGT done. `index.js`.
- ✅ **LS-6 Lint gate** — **DONE 2026-06-07 (`@visual`):** added `eslint` + `globals` (devDeps) + a minimal flat `eslint.config.js` focused on **`no-undef`** (the rule that would've caught the `JOY` crash) — union browser/node/serviceworker globals so it only flags genuine undefined vars, not platform globals (style is intentionally out of scope). Scripts: `npm run lint` + `npm run check` (= lint + test + build, the pre-push gate). Existing codebase is **already clean** (139 files, 0 violations; verified eslint flags a deliberate undef). lint + 200 tests + build green. **📌 @user action:** add `npm run lint` / `npm run check` to CLAUDE.md's "before done" routine — I couldn't (committing CLAUDE.md edits is denied to agents as self-modification). ⚠️ *Cross-lane (tooling/process, normally `@coordinator`; user explicitly flagged it + the team is inactive).* `package.json`, `eslint.config.js`.
- ◐ **LS-7 Onboarding gaps** — **DONE (`@visual`):** SP overlay added (`game.js`) + SP touch pause; **both overlays now teach the extraction stakes** ("die and you lose the chains you found this run"). **Minor remaining:** teach throw-cycle (`[`/`]`) + PvP (nice-to-have). `game.js`, `onlineGame.js`.
- ✅ **LS-8 Legal pages** (Privacy/ToS/Storage/Imprint) — **draft shipped 2026-06-07** as one `public/legal.html` served at `/legal` (see **CMP** section). Remainder is user-blocked (fill operator/contact/retention/jurisdiction) + a start-menu link in `index.html` (@phaser).
- ✅ **LS-9 Prompt injection** — **DONE 2026-06-07 (`@visual`):** AI/player-controlled free text (monster names, elements, statuses, attack names) flowed unsanitized into the OpenAI judge **user** prompt (`ai.js describe()`) — a name with newlines could break its line and inject instructions. **Layer A (robust, at the source):** `sanitizePromptText()` folds control chars/newlines → space + caps length, applied to every interpolated free-text field — defangs injection regardless of model behavior. **Layer B (defense-in-depth):** a note in the `combatSystem` prompt that names are untrusted labels. 2 unit tests (sanitize folds/caps; `describe()` can't be newline-injected); 200 green. *(Re-verified: the judge prompt uses monster names, NOT player nicknames — the review's "nicknames" was imprecise; the gen prompt's `{hints}` is element/biome/rarity, server-controlled.)* ⚠️ *Cross-lane (server/AI, `@feature`); clear security item, `@feature` inactive.* `server/ai.js`, `server/prompts.js`.
- ◑ **LS-10 CSP** — **REPORT-ONLY SHIPPED + enforcing verified 2026-06-07 (`@visual`):** added a Content-Security-Policy (`default-src 'self'` + tight per-type allowances: `img-src 'self' data:`, `connect-src 'self' ws: wss:`, `object-src 'none'`, `frame-ancestors 'self'`, `base-uri/form-action 'self'`, font/worker/manifest `'self'`). Ships as **`Content-Security-Policy-Report-Only`** by default so it **cannot break the live site**; set **`CSP_ENFORCE=true`** to flip the *same* policy to enforcing. **Verified the enforcing policy is clean** — 0 CSP violations across title→charselect→lobby→Multiplayer via the new `tools/shoot-csp.mjs` run against a `CSP_ENFORCE=true` server (the app loads its bundle/styles/fonts once at boot; scenes add no new external resources, so this is representative). `script-src`/`style-src` keep `'unsafe-inline'` because index.html carries an inline boot `<script>` + a large inline `<style>` (@phaser's) — the policy still blocks external-script/frame/object injection + base-uri/form hijacking. **📌 @user/@phaser:** (1) flip `CSP_ENFORCE=true` when ready (verified-safe); (2) to also close inline-XSS, `@phaser` nonces/hashes the inline `<script>` so `'unsafe-inline'` can drop. `server/index.js`, `tools/shoot-csp.mjs`.
- 🟡 **LS-11 FGT half-migrated (direction-shift blocker)** — `engine/combat.js` still uses a fixed element triangle + hardcoded catch math vs the AI-judge prompt; SP=deterministic, MP=per-turn flip → same action, different outcomes. **The pending user "a vs b" decision blocks 6 FGT tasks — flag in REQUIREMENTS.**
- 🟡 **LS-12 SP no heal-on-extract** (dup GP-13). ✅ **LS-13 Cosmetics not synced** — DONE (dup CN-12: MP skin sync shipped). ✅ **LS-14 Online lobby missing buttons — DONE 2026-06-07 (`@visual`):** online players couldn't reach **Bestiary** or **Cosmetics** once in the PLAY ONLINE lobby (title-only). Restructured `onlineLobby.js` into a prominent **Connect & Queue** CTA + a **2-column grid** of the 5 management screens (Manage Team · Spirit Shop · Base Upgrades · Bestiary · Cosmetics) + Back — a single 7-button column overflowed the screen. Bestiary + Cosmetics open **directly** (client-only — monster pool + localStorage skins, no server join) with `backScene:"onlineLobby"`; gave `bestiary.js` the same `backScene` contract `cosmetics.js` already had. (Base Upgrades was already added in CN-1.) lint + 206 tests + build green; layout **verified** via a local lobby capture (all 7 fit, no overlap, no client errors). `onlineLobby.js`, `bestiary.js`.
- 🟡 **LS-15 Public APIs `ACAO:*`** — scope before auth ships (token leak risk). `index.js`. ✅ **LS-16 CI gate — DONE 2026-06-07 (`@visual`):** `node --test` auto-discovers `*.test.js` (no glob needed on Node 20), the pre-push gate `npm run check` exists (LS-6), and GitHub Actions (`.github/workflows/ci.yml`) runs on every push to `master` + PRs. **Gap closed:** CI ran build + test but **not lint** — added `npm run lint` so CI now runs the full gate (lint → test → build), catching no-undef refs (e.g. the `JOY` crash class) before/at deploy. `.github/workflows/ci.yml`.
- ⚪ **LS-17 `vaultCapacity` hardcoded `/100` in SP inventory** (ignores Deep Vault) — INV-T2 one-liner. `inventory.js`. ⚪ **LS-18 static `v1.0.0`** — wire from `package.json`. ⚪ **LS-19 Phaser shim retained** — prioritize the DPR fix before launch, defer the native refactor. ◑ **LS-20 HTTP rate-limit** (only WS had one) — ✅ `@combat` 2026-06-07: `createIpRateLimiter` + shared `clientIp` (`ratelimit.js`, bounded per-IP token bucket) applied to **`/api/combat/turn`** (AI-cost; 30 burst/1s) and **`/auth/signup` + `/auth/login`** (20 burst/~12-per-min — bulk-signup + credential-stuffing across emails, complementing the per-email login throttle). **Remaining:** `/api/admin/*` (separate owner) + the OAuth `/auth/:provider(/callback)` GET routes; and the robust fix for the cost endpoints — **auth-gate them** (per-session-token limiting) since `x-forwarded-for` is spoofable behind the proxy (the per-IP bucket is defense-in-depth vs naive floods only). `index.js`/`combat.js`/`auth.js`.

> **Suggested execution order:** (1) the 🔴 Fix-first list — most are small, high-impact correctness/safety fixes; (2) the balance pass (rarity gradient + storm + sprint + starter chain) which makes the core loop actually playable; (3) the 🟠 combat/netcode depth (swap, energy, prediction); (4) launch gates (auth, legal, CSP, lint); (5) the 🟡/⚪ polish & content depth. Many items are independent and parallelizable across the agent roster.

---

## 🧭 FLOW — title → character → lobby (USER SPEC 2026-06-07, HIGH PRIORITY)

> The authoritative game-flow spec — **supersedes/consolidates PT1-T04, PT1-T05, PT2-T01, PT2-T02.**
> Build exactly this 3-screen flow. Lanes noted per screen; coordinate the title with `@phaser`
> (its `index.html`/`main.js` lane). Ties into **PT2-T11** (one lobby for SP+MP) and **AUTH-T2** (login).
>
> ✅ **Screen 1 (Title) BUILT — `@visual` 2026-06-07.** Title now offers ONLY *Play as guest* + the
> three login buttons (Singleplayer/Multiplayer removed). Guest → nickname modal (real `<input>`,
> mobile keyboard) → `setGuestProfile()` marks the local profile `isGuest:true`+nickname → routes to
> character select, which shows a "Playing as guest — <nick>" tag. Server model carries `isGuest`
> too (`createPlayerProfile`/`createProfile`/`world.js` join + welcome). Verified by new
> `tools/shoot-title.mjs` (asserts no SP/MP buttons, modal+focus, `isGuest:true` persisted).
> ⚠️ **Hand-off:** the title no longer routes to MP — **MP is now reachable only via the lobby's
> round-start picker (Screen 3, `@feature`+`@visual`/PT2-T11), which is not built yet.** Until then
> the MP `shoot-*` harnesses (click "Multiplayer") can't reach the online lobby from the title.
> Login buttons stay "coming soon" until **AUTH-T2** (OAuth) lands.

**Screen 1 — Title.** ONLY two paths: **Log in** (Google / Discord / Tamer's Account — AUTH-T2/T3)
or **Play as guest**. Guest → enter a **nickname** → profile is created **marked as a guest**
(`isGuest:true`). **Remove the Singleplayer / Multiplayer buttons from the title** (that choice moves
to the lobby, Screen 3). Lane: **`@phaser`** (`index.html` title markup + `main.js` routing) + server
(guest profile) — coordinate; the title currently routes straight to SP/MP, which must change.
- *Today:* title has Multiplayer→onlineLobby + Singleplayer→characterSelect + "coming soon" login toasts.
- *Change:* title → **always** goes to **Screen 2 (character select)** after login/guest; no mode choice here.

**Screen 2 — Character select.** Pick from your **multiple characters** (create/delete; already
exists in `characterSelect.js`, `maxSlots`). Guest characters are tagged guest. Selecting a character
routes to **Screen 3 (lobby)** — NOT into a round. Lane: **`@visual`** (polish, PT1-T02) + `@feature`
(multi-character + guest tag; SP storage already multi-char — extend to server/MP per PT2-T01).

**Screen 3 — Lobby (the hub).** All options live here (Inventory/Team, Spirit Shop, Base Upgrades,
Bestiary, Cosmetics, Settings). **The SP-vs-MP choice happens HERE, at round start** — e.g. a "Play"
station/button that asks Singleplayer or Multiplayer. **Unify the two current lobbies** (`lobby.js`
SP + `onlineLobby.js` MP) into **one** lobby; the mode only changes which round you enter. Optional
hub feel (PT1-T04/T05: idle character centre, stations, Esc menu) is the visual target. Lane:
**`@feature` + `@visual`**, gated by **PT2-T11** (shared engine makes "one lobby, two round types" clean).

**Data model (server + storage):** add **`isGuest`** + **`nickname`** to the profile; characters are a
list under the account/guest identity (one identity → many characters), shared SP+MP (PT2-T01). Guests
persist locally (anon token) and can later **claim** into a logged-in account (AUTH-T4).

**Done when:** Title shows only Login + Play-as-guest (guest nickname works, marked guest); selecting a
character lands in the lobby; SP/MP is chosen in the lobby at round start; one unified lobby; works on
desktop + mobile; `tools/shoot-*` flow capture verified. Update `public/wiki.html` (flow/onboarding).

---

## 🎮 PT — PLAYTEST 1 findings (user-provided 2026-06-07) — ACTION NOW

> Real playtest (2 recordings) → **38 routed tasks**. **Current top priority** — the live game
> crashes on combat and the tester couldn't complete the core loop. Full task bodies (timestamps,
> quotes, files, done-when) are in the user's playtest doc; condensed + tracked here so agents action them.

### 🧭 Coordinator decision (the one the doc asks for)
> **Spike-fix the BLOCKER (PT1-T09) FIRST and ship it; THEN land the PT2-T11 SP/MP-parity refactor.**
> A crash on the core combat loop can't wait behind a large refactor (stop the bleeding). PT2-T11 is
> the *cure* — prevents recurrence + subsumes PT1-T10, PT2-T01/T04/T05/T06/T12 — so it's the strategic
> follow-up right after the blocker is verified green. The @visual-lane visual/content PT tasks are
> independent of both and run in **parallel now**.
>
> 🟢 **USER GREENLIT 2026-06-07 — PT2-T11 is now TOP PRIORITY.** The user approved the SP/MP shared-
> engine refactor as the lead workstream. **`@coordinator` is driving it.** PT1-T09 was already
> verified non-reproducing on `master` (combat boots clean), so the refactor proceeds as the priority.
> The P10 parity helpers already in `progression.js` (reward/storm/energy) are the seed; next:
> consolidate combat + mapgen + character + inventory + movement so `game.js` (SP) = `onlineGame.js`
> (MP) against a local server stub. Write `docs/SP_MP_PARITY.md`. Sequence the big sub-tasks; land
> incrementally behind the green gate.

### 🔴 PT1-T09 — BLOCKER: game crashes when a fight starts (SP **and** MP; PT2-T12 confirms MP)
> `@feature`+`@phaser`. Combat init crashes → F5 to recover; tester couldn't fight. **Repro** via
> `tools/shoot-spcombat.mjs` (DEV force-encounter hook) + an MP round; capture the stack. Missing `k.*`
> surface → @phaser (shim); else scenes/engine/server. Files: `fight.js`, `game.js` (encounter trigger),
> `compat/*`, `engine/combat`, `server/combat.js`. **Done when:** `shoot-spcombat.mjs` 10× clean + a
> manual MP encounter completes clean; `BUGFIX_LOG.md` entry.
> ✅ **`@coordinator` REPRO 2026-06-07 — SP combat does NOT crash on current `master`.** Ran
> `tools/shoot-spcombat.mjs`: full flow (overworld → forced encounter → combat menu → attack-select)
> completed **clean — no PAGEERR, no console errors.** The combat fixes that landed *after* the
> playtest build (CB-1/2/3/5/9/11 + the **deleted-monster-type crash guards** in `combat.js`/`gamedata.js`
> + the AI-judge timeout) very likely already fixed it. **Remaining to close:** (1) verify an **MP**
> encounter (PT2-T12 — `server` + `shoot-round.mjs` at a forced `ENCOUNTER_RADIUS`); (2) a **natural
> roam** encounter across a few monster types. If MP is also clean → **downgrade BLOCKER → verify-and-
> close** with a regression note. Likely an **old-build crash already resolved**, not a live blocker.
> ✅ **Flexible-worker follow-up 2026-06-07 — SP TURN-RESOLUTION now harness-covered + 3× clean.**
> The coordinator repro (and the old `shoot-spcombat.mjs`) only reached *attack-**select***, so
> `evaluateTurn`/`evaluateCatch` — the actual combat math, and the most likely crash site — were never
> exercised (the precise "harness-unhit path" this blocker hid in). **Hardened `tools/shoot-spcombat.mjs`**
> to drive *real actions*: Fight→first attack (resolves a turn via the deterministic engine), **Catch**
> (`evaluateCatch` + chain charge + capture FX), **Skip** — and to **exit non-zero on any client error**
> so "10× clean" is enforceable. Ran **3×: all clean** (exit 0, no PAGEERR/console errors; `spcombat-04-
> after-attack` shows a resolved turn — "Shadow Claw for 46 / Thunder Clap for 42", HP bars updated).
> **SP combat is solidly non-crashing on `master`.** ⚠️ **MP repro note for owners:** driving MP combat
> headlessly against the **Vite *dev* server is unreliable right now** — concurrent loops editing `src/`
> trigger HMR reloads that destroy the Playwright page mid-run (the page bounces to title). To verify MP
> (item 1), run against a **built bundle** (`VITE_SERVER_URL=ws://… npm run build` → serve `dist`) +
> solo WS server at a forced `ENCOUNTER_RADIUS`, not the shared dev server.

### ♻️ PT2-T11 — STRATEGIC: SP and MP are duplicated codepaths → share the engine (`@coordinator`)
> Pull combat/mapgen/character/inventory/movement into a shared engine module both `game.js` (SP) and
> `onlineGame.js` (MP) + `server/*` consume ("SP = MP against a local server stub"). Write
> `docs/SP_MP_PARITY.md`. **Subsumes** PT1-T10, PT2-T01/T04/T05/T06/T12; extends **P10 parity audit** +
> **INV-T1**. Multi-task umbrella, sequenced after PT1-T09. **Done when:** no combat/mapgen/inventory
> logic in scenes; snapshot test identical SP↔MP.
>
> 🚩 **REGRESSION SURFACED BY THE FLOW CHANGE (`@visual`, 2026-06-07) — needs a `@coordinator` decision.**
> Now that the title only launches `characterSelect` (board #1) and the unified lobby's option buttons
> route to the **SP** scenes (`inventory`/`shop`/`baseUpgrades`), **nothing routes to `onlineLobby`
> anymore** — so the **MP** management scenes (`roster`, `onlineShop`, `onlineBaseUpgrades`) are
> **orphaned/unreachable** (verified: their only entry was `onlineLobby`, which the title no longer
> opens). MP today = Play→Multiplayer→queue→round with the server-default team; a player can't manage
> their **server-side** team/shop/upgrades pre-round. This is the SP/MP-duality gap: the *intended*
> end-state (FLOW: one identity) is that the SP scenes operate on **server-backed** data for MP and the
> 3 MP scenes get deleted — but that's exactly PT2-T11 and isn't landed. **Decision needed:** (a) land
> PT2-T11 so SP scenes serve MP (then delete `onlineLobby`/`roster`/`onlineShop`/`onlineBaseUpgrades`),
> or (b) interim: re-expose MP management from the unified lobby's MP path (re-introduces the duality the
> user wants gone). Recommend **(a)**. Not hack-fixing in `@visual`'s lane — it's an architecture call.
> _(For a no-traffic test env this is tolerable short-term; flagging so it isn't shipped silently.)_

### All 38 PT tasks (one row per task; claim by putting your handle in Owner)
| ID | Title | Lane | Sev | Overlap / note |
|---|---|---|---|---|
| **PT1-T09** | **Combat crash on fight start (SP+MP)** | `@feature`+`@phaser` | 🔴 **BLOCKER** | repro first; BUGFIX_LOG |
| PT2-T11 | Share SP/MP engine (refactor) | `@coordinator` | ♻️ strategic | extends P10 + INV-T1 |
| PT1-T01 | Title: too much black at bottom | `@visual` | polish | viewport-aware band |
| PT1-T02 | Character-select visual upgrade | `@visual` | major | ✅ **DONE 2026-06-07 (`@visual`)** — `characterSelect.js` reskinned to match the unified lobby (PT1-T04): themed slot **cards** (hover-lift, click-to-enter) showing name + guest tag + Lv + a **team-preview thumbnail strip** (monster sprites + HP pips), themed `+ New Character` (disabled "All slots full" at 5) + `< Back`, panelled empty state. Preserves the guest-profile header + the DOM name input (PT1-T03) + routing. Fixed an addLabel/addPanel re-render leak (tagged all slot UI `charUI`). Build+tests+lint green; screenshot-verified (empty + 2-card states). |
| PT1-T03 | Mobile name input doesn't open keyboard | `@visual`+shim | major | real `<input>` focus in-gesture (iOS) |
| PT1-T04 | Dark-and-Darker-style **lobby** scene (hub, NPC stations, Esc menu) | `@visual` | major | ✅ **DONE 2026-06-07 (`@visual`)** — `lobby.js` is now THE single hub (board #2 / FLOW screen 3). Unifies SP `lobby` + MP `onlineLobby`: all options open from it (Inventory/Team · Spirit Shop · Base Upgrades · Bestiary · Cosmetics · Settings) + a **Play → Singleplayer/Multiplayer picker at round start** — SP→`loading`→`game`, MP folds onlineLobby's connect→join(char name)→queue→roundStart→`onlineGame`. Esc overlay menu (Resume/Settings/Switch Character/Quit). `onlineLobby.js` left registered (title still routes to it until `@phaser` reroutes). Build+266 tests+lint green; verified SP **and** MP end-to-end via `shoot-sp` (updated for the guest title + the Play picker) + a solo-server MP drive. Wiki Onboarding updated. |
| PT1-T05 | Lobby layout: menu-L / rotatable char-C / settings-R | `@visual` | major | ✅ **DONE 2026-06-07 (`@visual`)** — landed with PT1-T04: 3-col on wide screens (menu-L / **rotatable** player-C via `<`/`>` buttons + Left/Right keys / settings-R), single-centred-column fallback on narrow/mobile; team strip along the bottom. Screenshot-verified. |
| PT1-T06 | Rebind chain throw **Q → Space** (keep Q alias) | `@feature` | major | ✅ **DONE** — Space primary + Q alias, SP+MP; HUD/onboarding/wiki updated |
| PT1-T07 | Minimap uses **real biome colors** (all green now) | `@visual` | major | ✅ **DONE** `6397bef`: per-biome `tint` palette in `mapgen.js` (`biomeTintAt`), blended 65/35 into SP (`game.js`) + MP (`onlineGame.js`) radar cells — biomes now distinct |
| PT1-T08 | **Fog-of-war** (reveal by walking) | `@feature`+`@visual` | major | ◑ **SP DONE 2026-06-07 (flexible worker)** — `render/tiles.js drawTiles` gained an optional `isExplored(x,y)` gate (unexplored cell → flat dark veil, detail-render skipped = also a perf win); SP `game.js` tracks an `explored` set, reveals a 6-tile disc around the player each frame, passes the gate to the floor + gates the minimap. **Screenshot-verified** (revealed disc + fog at edges + minimap fills by exploring). **Default-off** (param omitted) so non-fog callers are byte-identical. ✅ **MP DONE too** — `onlineGame.js` got the same `explored`-set + `revealAround` + the `isExplored` gate on `drawTiles` and the (now `tx,ty`-tagged) minimap cells; client-side, **no server change** (each client tracks its own reveal). Both modes now reveal by walking. Build + 266 tests. |
| PT1-T10 | SP/MP combat parity (same resolver) | `@feature`+server | major | subsumed by PT2-T11 |
| PT1-T11 | Void/unexplored tiles need texture (not flat black) | `@visual` | polish | ties PT1-T08 |
| PT1-T12 | Wall corners not closed (autotiler) | `@visual` | polish | inside/outside corners |
| PT1-T13 | Chain orbit ball renders screen-center, not on char | `@visual`+`@feature` | major | anchor to player world transform |
| PT1-T14 | Remove throw-line; chain VFX from character | `@visual` | polish | ties PT1-T13 |
| PT1-T15 | Inventory: can't place items in slots; whole system pass | `@visual`+`@feature` | major | extends INV-T1/T3; mobile drag/drop |
| PT1-T16 | Active-team vs inventory distinction confusing | `@visual` | major | labeled panels, capacity x/6 |
| PT1-T17 | Mapgen leaves large empty unreachable areas | `@feature` | major | ⚠️ **connectivity DISPROVEN** as the cause — see note ↓ |
| PT1-T18 | Communicate biome movement-speed to player | `@visual` | minor | HUD biome indicator; pair PT1-T22 |
| PT1-T19 | Player can **walk on water** | `@feature`+server | major | ⚠️ **design call, not a clean bug** — Water is a *biome* (slow terrain), no impassable tile exists; see note ↓ |
| PT1-T20 | Active team as **icons top-left HUD** | `@visual` | minor | new `teamHud.js`?; mobile-safe |
| PT1-T21 | Monsters too cute/same/egg-shaped → rework gen pipeline | `@feature`+`@visual` | major | extends P5-T5 (brutal); silhouette archetypes |
| PT1-T22 | Tune biome speed deltas (too jarring) + lerp | `@feature` | minor | ✅ **lerp DONE** — `biomeSpeedMultAt` now bilinearly smooths; delta-compress = open taste call. Note ↓ |
| PT1-T23 | Map edge needs a clear visual + collision | `@visual`+`@feature` | minor | boundary visual + stop |
| PT1-T24 | Minimap **zoom** (in/out, wheel/pinch) | `@visual` | minor | ≥2 zoom levels |
| PT2-T01 | Unify SP/MP character roster | `@feature`+server | major | subsumed by PT2-T11 |
| PT2-T02 | Flow: Title(Play) → CharSelect → Lobby → SP/MP choice | `@visual`+`@feature` | major | SP/MP off the title; ties PT1-T04 |
| PT2-T03 | MP movement wonky (input lag, slides past stops) | server+`@feature` | major | client prediction (= NC-2/P2-T3) |
| PT2-T04 | Fresh MP char spawns with damaged teammate | `@feature`+server | major | ✅ **DONE** — heal team at run start (server + SP parity); see note ↓ |
| PT2-T05 | Bring SP map up to MP map's visual quality | `@visual`+`@feature` | major | share renderer (PT2-T11) |
| PT2-T06 | MP collision precision ≠ visual (invisible walls) | `@feature`+server | major | ✅ **DONE (server + SP)** — body-radius edge collision; only Alt+C debug overlay open. Note ↓ |
| PT2-T07 | Chest pickup needs visual feedback (toast+icon) | `@visual`+`@feature` | minor | ✅ **MP DONE 2026-06-07 (`@visual`)** — added a pooled **floating-text** capability to the shared FX system (`fx.js` `emitText`: rises + fades, budget-capped, reduce-motion-safe = informational so it shows but freezes the rise; unit-tested). Wired into the existing onlineGame chest-open + level-up state-diffs: **"Chest opened!"** on a nearby chest vanishing (already had sparkle+SFX) and a **"<name> Lv N"** label on level-up. Build+292 tests+lint green; MP round smoke-tested (0 PAGEERR). **Remaining:** SP `game.js` chest/level floats (same `emitText`) + a richer "what you got" caption needs the server to surface chest contents (`@feature`). |
| PT2-T08 | Out-of-zone punishment undefined/invisible | `@feature`+server+`@visual` | major | SP has zone DAMAGE + "OUTSIDE SAFE ZONE" warning (P10-T5). MP `@visual` feedback now: pulsing red border + red **danger vignette** (`drawAtmosphere danger=1`, parity w/ SP) + **NEW (2026-06-07 `@visual`)** an **actionable safety arrow** — `drawDanger` now projects a red screen-edge arrow toward the zone centre + **"N tiles to safety"**, so the warning says *which way to run*, not just "you're in danger". Build+lint+tests green; MP boot smoke 0 PAGEERR (arrow itself browser-pending — `CIRCLE_START_S`=300s makes out-of-zone non-trivial to trigger headlessly). **Remaining:** optional death/wipe ETA timer (needs storm DPS surfaced) — `@feature`/server. |
| PT2-T09 | Polish safe-zone visuals (smoke-wall) | `@visual` | minor | keep shrink-line anim |
| PT2-T10 | No mission/objective shown | `@feature`+`@visual` | major | ✅ **objective HUD DONE — both modes (flexible worker 2026-06-07)**: shared pure `ui/objective.js objectiveText({circleStarted,portalsOpen,outsideZone})` → one contextual goal line (catch & loot → storm closing → reach a portal to EXTRACT → get back in the zone), rendered persistently in MP `onlineGame.js` (top-center, from net.state) **and** SP `game.js` (replaced the portals-only hint). Tested (transitions + glyph guardrail). The **first-run tutorial overlay already exists** (P8-T8/LS-7), so PT2-T10 is complete. |
| PT2-T12 | Confirm MP combat broken (not SP-only) | → PT1-T09 | major | fold into blocker QA |
| PT2-T13 | No way to heal the team (missing/unexplained) | `@feature`+`@visual` | major | ◑ **VERIFIED (flexible worker 2026-06-07): the team ALREADY heals** — `healTeam` runs at **run start** (SP `game.js:49` + server `world.js generateRound`, PT2-T04) **and on extract** (`grantExtractRewards`), both modes; catch stabilizes to 50% (CB-9); level-up restores. So you ALWAYS begin a run at full HP. **Confirmed via screenshot** (SP world: team HP bars full). The lobby HP bar reads true HP correctly (lobby.js:138). **So this is "unexplained", not "missing" — and a DESIGN CALL for the user:** since runs already start healed (PT2-T04), the lobby's mid-run-injury display (GP-9) shows a state the next run erases. Pick: **(a)** keep auto-heal-each-run + make the lobby *show* it (heal/display full in the lobby; "Team rested" label) so the player sees it's handled — least friction; or **(b)** make injury PERSIST as a stake (drop the run-start heal) + add an EXPLICIT heal mechanic (lobby "Rest/Heal" button costing gold, or heal items via the empty `item.json`/CN-11). _Recommend (a) — it matches the live behaviour; just surface it. No code change until the user picks._ |
| PT2-T14 | Spirit Chains purpose unclear | `@visual`+`@feature` | minor | tooltip + toast caption + wiki |

> **Don't fork — fix once:** PT1-T10/PT2-T01/T05/T06 → **PT2-T11**; PT2-T03 → **NC-2/P2-T3**;
> PT1-T15/T16 → **INV-T1/T3**; PT1-T21 → **P5-T5**; PT1-T07 partially done (teal retheme `b780925`;
> biome-accurate colors still open); PT2-T08 ties the storm work. Every new mechanic updates `public/wiki.html`.

> ✅ **PT2-T06 server collision DONE (flexible worker, 2026-06-07) — collider now matches the body.**
> The server collided at the player's **center point**, so the rendered body (≈13px half-width — the
> `render/character.js` cloak/shadow `radiusX`) poked ~a radius into wall tiles → "invisible wall /
> collision ≠ visual." Fix: check the **leading body EDGE** (`center ± GAME.PLAYER_RADIUS` along the
> moving axis), a proper per-axis circle-collider, so a wall stops you where your sprite meets it. Still
> per-axis (slide along walls); only the moving axis is offset so the perpendicular footprint stays a
> point and **narrow corridors don't block** (wall-adjacent chests, opened within 40px > 13px, stay
> reachable). New `PLAYER_RADIUS` lives in `GAME` (shared). Test added (body edge never enters a wall
> across 70 steps each direction); the prior center-never-in-wall test still passes (stricter). 233 green.
> ✅ **SP parity DONE (follow-up, 2026-06-07):** `game.js` `handleMovement` now uses the identical
> `center ± PLAYER_RADIUS` per-axis edge check (was center-point) — SP and MP collide the same way. Build
> + 233 green. **Open:** the **Alt+C collider-debug overlay** (client `onlineGame`, @visual lane) to
> eyeball collider↔tile alignment.
> ⚠️ **PT1-T19 (walk on water) — NOT a clean bug; needs a user/design decision (flexible worker, 2026-06-07).**
> "Water" is a **biome** (a slow-traversal overlay, `speedMult 0.70`), not an impassable tile — and
> **no tile is ever `collidable`** (every `groundtiles.json` entry is `collidable: 0`; the `isWalkable`
> "e.g. water" comment is aspirational). Making the whole Water biome impassable would (a) **contradict
> the wiki-documented speed mechanic** (why give water a speedMult if you can't enter it?), and (b)
> **strand large areas** — Water is a big biome (size 80, rarity 90), and the PT1-T17 connectivity test
> only guards the `voidMap` graph, *not* `voidMap && !collidable`, so it wouldn't even catch the
> stranding. **Decision for the user/@feature:** is water (i) slow terrain (current — maybe just needs a
> clearer *visual* so it doesn't look solid), or (ii) an impassable hazard? If (ii), it needs a
> *sparse* water-tile pass (not whole-biome) **plus** a connectivity carve that routes around water, and
> the PT1-T17 test must be extended to the effective (`!collidable`) graph. Not implementing blind.
> ✅ **PT1-T22 lerp DONE (flexible worker, 2026-06-07) — biome speed now eases across boundaries.**
> The "jarring" came from `biomeSpeedMultAt` returning the *exact* per-tile `speedMult`, so crossing a
> biome edge **snapped** your speed in one frame. Replaced it with a **bilinear interpolation** of the
> speedMult field (sampled by tile centers): deep inside a uniform biome you still get that biome's
> exact value, but crossing into a slower/faster biome now **ramps over ~one tile**. It's a single pure,
> deterministic function shared by the server (`tickRound`) and SP (`game.js`), so **both modes get the
> smoothing with zero per-player state and stay perfectly in sync** (no SP/MP drift). Test rewritten to
> assert interior-exactness + a monotonic boundary ramp; 232 green. **Open (taste call, deferred to
> user/@feature):** the *magnitude* of the deltas (0.70 Water/Swamp … 1.15 Plains) — compressing the
> range toward 1.0 would further reduce the felt swing, but those are designed, **wiki-documented**
> balance values, so I didn't change them unilaterally. Pairs with **PT1-T18** (show the active biome +
> its speed in the HUD so the change is legible, not mysterious).
> ✅ **PT2-T04 DONE (flexible worker, 2026-06-07) — runs now start at full HP (server + SP).** Root
> cause: `generateRound` (server) set spawn/stamina but **never healed the active team**, so a player
> entering a run with stale damage — a vault monster caught at low HP, or a team refilled from the vault
> after a death — started the run wounded ("fresh char spawns with a damaged teammate"). Fix: call the
> shared `healTeam(profile.activeMonsters)` on **fresh** round entry in `generateRound` (NOT in
> `resumeRound` — a reconnect must not heal mid-run). Mirrors the existing heal-on-extract; the run loop
> now heals at both ends. **SP parity (P10):** `game.js` had the same gap — added the same heal on the
> *fresh-spawn* branch only (the fight→overworld resume must not re-heal). Tested (`world.test.js`: wound
> the team pre-round → assert healed at round start); 231 tests + build green. _Also softens PT2-T13
> (no heal mechanic) — you always start a run prepped._
> 🔬 **PT1-T17 investigation (flexible worker, 2026-06-07) — "unreachable areas" is NOT a connectivity
> bug; do NOT build the flood-fill pass (it would be a no-op).** Flood-filled the walkable graph of
> real generated maps across **7 seeds**: every map is a **single connected component, 0% stranded**
> (e.g. 75,269 walkable cells / 1 component). This is structural, not luck — the DLA carve only commits
> a walk once it touches the existing walkable blob (`dlaWalk` returns 0 otherwise), and `smoothMap`/
> `widenNarrowTunnels` only *add* cells, so a region can't be stranded. **Locked in** with a connectivity
> invariant test (`mapgen.test.js` — asserts 1 component **and** every monster spawns on a walkable tile;
> it'll catch a regression if **PT1-T19** later makes water impassable and strands part of the map).
> **So the tester's "large empty areas" is almost certainly *void perception/density*, not reachability:**
> ~47% of the 400² grid is walkable, the rest is void/abyss (walls) that reads as empty black. **Re-point
> PT1-T17 →** (a) **PT1-T11** (texture the void so it doesn't read as a flat empty gap) and/or (b) a
> *content-density* pass (more monsters/chests/landmarks in big rooms) and/or (c) tune the carve so
> walkable area is more contiguous (fewer honeycomb walls) — NOT a graph-connectivity fix.
