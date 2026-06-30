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
| 1 | visual audit | in progress | baseline captured 2026-06-30 |
| 2 | standardization | not started | |
| 3 | responsive | not started | |
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
- TODO remaining Pass 1: settings, bestiary(+detail), cosmetics, roster(4 tabs), lobby,
  onlineGame (overworld+combat — needs __net handshake), station popups, results, onboarding, pause;
  + profile Team-row crowding; + apply shop/baseupg copy-separator candidates if confirmed wanted.

NOTE: UI is already heavily polished (theme system + button standardization + responsive reflow all
shipped previously). Expect incremental refinements, not large rewrites.
