# Game Design Polish — 5-Pass Tracking

Directive (Dominik, `/loop`): improve the game's design — screen by screen, element by element,
file by file, line by line. Take screenshots, standardize design elements, keep code clean.
**5 passes** through the whole game, tracked here so the loop resumes across iterations.

## Guardrails (Dominik's settled design decisions — DO NOT "fix" these)

- **Flat themed UI** via `src/ui/theme.js` — pull tokens, never hardcode RGB. Palette is dark "cave flat".
- **Tile floor cross-fade is WANTED** (soft seams, TQ-449/483). Do NOT make tiles crisp.
- **Back-button position differs by scene family BY DESIGN** — identity pages top-left + Sign-out
  top-right; hub stations left-title→top-right Back. Not a bug; don't "standardize" it.
- **Monster icon-fit**: use `drawMonsterIcon` (fit-to-box, shrink tall only) in icon/inventory; do
  NOT shrink in overworld/combat.
- **No desktop mouse-walk**; virtual joystick is touch-only.
- **Square play-window + portrait HUD gutters** layout is intentional.
- **Buttons** go through `addButton`/`drawButton` in theme.js; combat buttons are intentionally
  hand-rolled; HTML title buttons are a separate index.html CSS system.
- Contested/co-developed files (hub.js, tiles.js, onlineGame.js): stay additive, commit by pathspec.

## Verify-before-acting

Screenshots can mislead (low-opacity text, mid-animation frames). ALWAYS confirm a suspected defect
against the source before editing. (Already caught one false positive: the title `.version` "v1.0.0"
looked garbled at screenshot scale but the code is a single clean element — no bug.)

## Workflow per change

1. Identify a concrete improvement on a screen (verified against code).
2. Edit (theme-driven, behavior-preserving where possible).
3. Verify: `npm run lint` + `npm run build`; re-screenshot locally (build + `vite preview`) before/after.
4. Commit by pathspec, push (auto-deploys), then a prod screenshot confirms.

## Screenshot harness

`tools/_design-tour.mjs` (local, gitignored) — Playwright tour via `window.tqGo`; captures title,
charselect, hub, all 7 stations, friends, lobby at desktop (1280×800) + portrait (430×880).
Key fix: inject a global `animation:none` + hide `[data-tq="html-monsters"]` overlay stylesheet,
else the live monster DOM churn hangs Playwright's screenshot. Output: `.screenshots/design/`.
Run vs local: `GAME_URL=http://localhost:4173 OUT=.screenshots/design-local node tools/_design-tour.mjs`.

## Passes (distinct lens each — not identical re-reads)

- **Pass 1** — Screen-by-screen visual audit (every scene + popup, desktop + portrait). Fix clear
  defects: overflow, misalignment, inconsistent spacing, off-theme color, non-standard widgets.
- **Pass 2** — Design-system standardization: every button via addButton/drawButton, every color from
  THEME, consistent panel/header styling + typography scale (respect the back-button two-family rule).
- **Pass 3** — Responsive/mobile polish: portrait + narrow widths, safe-area, touch-target sizes, the
  recurring overflow + overlay-bleed-through patterns.
- **Pass 4** — Micro-interactions & states: hover/press feedback, transitions, FX consistency,
  loading/empty states.
- **Pass 5** — Holistic: re-screenshot all, cross-screen consistency, code cleanliness, full suite + build.

## Progress log

| Pass | Lens | Status | Notes |
|------|------|--------|-------|
| 1 | visual audit | static screens DONE | 2 real fixes (profile portrait); live overworld/combat deferred (cost/risk) |
| 2 | standardization | DONE (clean) | 0 hardcoded colors bypass THEME; buttons standardized; nothing to fix |
| 3 | responsive | substantially done | shop/cosmetics/profile portrait reflow clean; profile fixes were the wins |
| 4 | interactions | not started | |
| 5 | holistic | not started | |

## Screen inventory (capture targets)

title · charselect · hub (village) · roster (team/vault/chains/items tabs) · onlineShop (Spirit Shop) ·
onlineBaseUpgrades · bestiary (+ detail) · cosmetics · settings · profile · friends · lobby ·
onlineGame (overworld + combat — needs __net handshake) · station popups (in-hub) · results/death ·
onboarding · Esc-pause menu.

### Pass 1 findings
Baseline captured (desk + port). Reviewed so far:
- **title** — polished; no defect (verified `.version` is clean, not the garble it looked like).
- **hub (village)** — solid; square-window portrait HUD, welcome banner, keepers/world read well.
- **onlineShop (Spirit Shop)** — clean, consistent cards/buttons. Minor: item sub-line runs price +
  desc + "owned" together ("25g Weak bind owned") — a `·` separator could improve scannability (candidate).
- **onlineBaseUpgrades** — clean/consistent with shop. Copy candidate: "Level 0 / 5 now none → +20%"
  reads awkwardly; "Lv 0/5 · none → +20%" clearer.
- **friends** — clean "No account" empty-state. Uses centered title + top-left "< Back" (chevron).
  VERIFIED this matches the profile/account identity family (same pattern) → consistent, NOT a bug.
- **profile** — ✅ FIXED: 7-column Player Data stat row collided at portrait ("EscapedEscape %",
  "PvP winsTotal XP") — label scale factor cellW*0.24/cap12 left no gap. Tightened to cellW*0.19/cap11
  in profile.js + profilePanel.js (commit pushed; PROD-VERIFY pending next wake). Follow-up noted:
  the Team row member names crowd the "L1" level suffix at portrait (separate fix).
- **profile (cont.)** — ✅ FIXED #2: Team-row member labels overran the next member because the
  " L{level}" suffix was appended AFTER name truncation (maxChars budgeted only the name). Reserved
  ~4 chars for the suffix in profile.js + profilePanel.js (pushed). PROD-VERIFIED the stat-label fix.
- **settings** — clean. Identity family (centered title + top-left "< Back"), consistent w/ profile/
  friends. (Differs from shop's station family — that's the documented two-family design; left as-is.)
- **bestiary** — clean. Station family (left title + top-right Back). Monster cards read well.
- **roster (Monsters tab)** — clean. Standardized tabs (active=primary), numbered team cards w/ HP bar.
  (tqGo `tab:items` didn't switch tab in the tour — minor harness gap; Items/Chains tabs still TODO.)
- TODO remaining Pass 1: cosmetics, lobby, roster Chains/Items tabs, **onlineGame (overworld+combat)**
  — highest-value remaining; needs the DEV `__net` handshake (not on prod) so likely a LOCAL dev-server
  capture; station popups, results/death, onboarding, Esc-pause menu.
- **cosmetics** — clean & rich. Rarity color-coding (Common/Uncommon/Rare/Epic borders), preview
  panel, equipped state, consistent price badges (g/ess). No defect.
- **lobby** (menu-style overview, distinct from hub village) — clean. Consistent button column
  (Play=primary), Your Tamer + Your Team cards. No defect.
- Copy candidates (low priority, confirm wanted before applying): shop item sub-line separators,
  baseupg "now none → +20%" phrasing.

**Pass 1 (static screens) — verdict:** title/hub/shop/baseupg/friends/profile/settings/bestiary/roster/
cosmetics/lobby all reviewed. The UI is already heavily polished (prior @visual + button-standardization
+ responsive-reflow work). Only real defects were the two profile portrait crowding issues — BOTH FIXED
& deployed. **Live overworld + combat DEFERRED**: needs full local stack (WS server :8080 + vite dev)
and a solo run can auto-enter AI combat that costs real $ — won't trigger paid combat autonomously
without Dominik's OK. Overworld play-window + HUD geometry is already verified via the hub capture
(hub draws identical geometry). Remaining static surfaces (station popups, results/death, onboarding,
pause) to spot-check opportunistically.

### Pass 2 (standardization) — plan
Code-inspectable (no screenshots needed for most): (a) grep UI chrome for hardcoded `k.rgb(<lit>)` /
hex that bypass THEME tokens; (b) confirm all canvas buttons route through addButton/drawButton
(combat buttons exempt by design); (c) panel/header/typography consistency. Respect the back-button
two-family rule + tile-fade + monster-icon-fit guardrails.

#### Pass 2 findings (DONE — clean)
- Hardcoded `k.rgb(<numeric>)` in ui/scenes: only hub.js (103) + onlineGame.js (18) = procedural WORLD
  ART (grass/dirt/buildings), legitimately literal; NOT themeable chrome. UI files: only `k.rgb(0,0,0)`
  modal scrims + drop-shadow ellipses (standard, fine). **Zero off-theme UI chrome.**
- Hex literals: all 36 are in theme.js (the palette definition — correct). Zero rogue hex in ui/scenes.
- Buttons already routed through addButton/drawButton (per prior standardization work). **Nothing to fix.**

#### Pass 3 findings (responsive)
- Stations narrow-reflow was previously completed; re-confirmed: **Spirit Shop** (buttons drop below
  text), **Cosmetics** (single-column card grid), **Profile** (after my 2 fixes) all reflow cleanly at
  430px portrait. The 2 profile crowding bugs (stat-label + team-row) were the real Pass-3 wins — fixed.
- TODO opportunistic: roster Items/Chains tabs at portrait; results/death screen; onboarding; Esc-pause.
- Station POPUPS (in-hub): content reuses the already-reviewed panel modules (shop/cosmetics/bestiary/
  profile/roster/settings) wrapped in stationPopup.js shell → substantially covered. Live capture via
  `window.__openStation(id)` is reachable but the hook registers a few frames post-hub-init (my QA shot
  fired too early). Low value (redundant content) → deferred; tool: tools/_popup-shots.mjs (local).

### Pass 4 (interactions) — plan (next)
Distinct lens, partly code-inspectable: button hover/press feedback (drawButton sheen/press states),
scene transitions, FX consistency (src/render/fx.js budget/usage), loading + empty states (several seen:
friends "No account", roster "Catch or loot…", profile "Log in to track…" — confirm they're consistent +
on-theme). Look for any interactive element lacking press/hover affordance or an empty state that's bare.

### Pass 5 (holistic) — plan
Re-screenshot all, cross-screen consistency sweep, code cleanliness (the design edits stayed theme-driven),
full suite + build checkpoint.

## Overall verdict (so far)
The game's UI/design is **mature and well-polished** (theme system, button standardization, responsive
reflow all previously shipped). Genuine improvements found = the 2 Profile portrait crowding fixes
(landed + deployed). Remaining passes are confirmation + opportunistic spot-checks, not large rewrites.
Loop continues at reduced intensity: fix what's genuinely improvable, don't manufacture churn.

NOTE: UI is already heavily polished (theme system + button standardization + responsive reflow all
shipped previously). Expect incremental refinements, not large rewrites.
