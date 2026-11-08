# Tamers Quest — Implementation Plan

Last updated: 2026-11-08

> **The original plan is complete** (and the 2026-11-08 sweep is logged below). Every implemented item has been moved to
> [`IMPLEMENTATION_PLAN_ARCHIVE.md`](./IMPLEMENTATION_PLAN_ARCHIVE.md) (the SP/MP unify,
> AI-judged combat + AI monster/item generation, mobile/visual polish, auth, ops/admin,
> etc.). The **cloud-save / account-character overhaul** also shipped (2026-06-10) — see
> _Recently shipped_ below. Exactly **one open item** remains below — parked at the user's request.

## Important bullets

- **Production is the current test environment.** Run `npm run build` before pushing. Commit and push small changes directly to `master`. Log failing tests in `docs/BUGFIX_LOG.md` instead of blocking production test deploys.
- **The game is server-authoritative.** Clients should send input and render snapshots; trusted state, movement, combat, loot, and persistence belong on the server or in shared engine code.
- **Avoid duplicate single-player and multiplayer rules.** Any gameplay rule that exists in both modes should live in shared engine code and be covered by tests.
- **Combat is AI-judged with a deterministic safety net.** The default judge is the structured v2 Fight-Judgement (`combatJudgeV2`); the deterministic engine is only a transient crash-net so a single failed AI call can't freeze a fight.
- **Admin settings should stay current.** Any new live gameplay knob, AI prompt, model setting, or generated asset type should be surfaced in admin if it is useful for live tuning.
- **The wiki must match mechanics.** Update the GitHub Wiki (`tamers-quest-web.wiki.git`; `public/wiki.html` is an archived redirect) when combat, elements, catching, chains, status effects, controls, mobile behavior, or progression rules change.
- **Gate commits on real exit codes** of `npm run lint`, `npm test` and `npm run build` (never through a pipe), then confirm the prod bundle hash after the push.

## Recently shipped (2026-11-08 evening — Dominik's bug reports + UI v4 polish)

- [x] **Bugs from Dominik:** leaving a round returns to the village (`leaveRun`); spawn protection (4 tiles +
  3 s grace); the village shows the post-run profile; movement rubberband on turns under lag fixed by ACK-based
  reconciliation (`src/engine/reconcile.js`) + corner slip in the shared `stepBody`; death also loses this run's
  catches and chest items (HUD "At risk" pill, result-card "Lost N" chips). Jira TQ-567…571.
- [x] **UI v4:** Battle Pass progression track, icon audit + icon buttons, shared Profile page, guest gate,
  attack pills sized together, phone result card, soft battle-stage glows, frost snapshot per sheet, no pixel
  read-back during fights. `docs/DESIGN_PASSES.md` Pass 8, session 3.
- [x] **QA tooling:** server `SIM_LAG_MS` / `SIM_JITTER_MS`, `tools/qa-movetrace.mjs`, staging hooks on the
  qa harnesses (PRE / PRE_COMBAT), frame-gap and CPU-profile probes in `qa-combat`.

## Recently shipped (2026-11-08 — autonomous sweep after a 4-month gap)

- [x] **Multi-provider AI (TQ-405).** `server/llm.js` routes every judge / generation call by model id to
  OpenAI, Anthropic (official SDK), Gemini, DeepSeek or Groq; keys via `*_API_KEY`, endpoint override via
  `*_BASE_URL` (local mock judge: `tools/mock-llm.mjs`). Admin pickers are grouped per provider with live
  model lists. **Human Task TQ-564:** add the provider keys on Railway.
- [x] **UI material upgrade (TQ-563)** — see `docs/DESIGN_PASSES.md` Pass 6; **screen transitions (TQ-555)**;
  **end-of-fight overview (TQ-554)**; the six 29-June bug reports (TQ-557…562) fixed/verified; perf: no
  per-frame canvas blur, html-icon rasters budgeted per frame.
- [x] **Knowledge graph:** `graphify-out/` (query with `graphify query "<q>"`; refresh `graphify update .`).
- [x] **UI v3 "Glass & Ember" (TQ-565)** — complete UI rework: frosted-glass lobby sheets (`k.requestFrost` /
  `k.drawFrost`), glass primitives + eyebrow type system in `src/ui/theme.js`, one ember primary per screen,
  run picker as mode cards, glass in-round HUD / combat pills / pause / result / onboarding / monster detail,
  close-out motion, pointer cursor over sheet controls; icon read-back stall fixed. `docs/DESIGN_PASSES.md` Pass 7.
- [x] **First-run tutorial (TQ-518)** — four contextual steps in the objective pill; **Adventure mode (TQ-529)** —
  endless solo journey: no clock/storm, a travel rift per region (`travelRegion` → `travelled` roundStart),
  `returnHome` keeps team + finds, a wipe carries you home with the team kept. Server tests in `world.test.js`.

## Recently shipped (2026-06-10)

- [x] **Cloud saves per account.** A logged-in account OWNS its characters on the server
  (`server/store.js` account model + `server/account.js` `/account/characters` CRUD, gated by an
  account session token), so they follow the account across devices/browsers. An existing player's
  first login migrates their current save in as the account's first cloud character (no progress
  lost). A returning account **stays logged in** on reload (skips the title straight to its
  characters; a stale session signs out cleanly). Verified end-to-end on a live server.
- [x] **Guests are session-only.** Guests can play but keep **no saved characters** — a guest
  starts fresh each page session (`clearGuestCharacters` on boot). So only logged-in players have
  save files. Account control (sign-out + signed-in indicator) lives on character select.
- [x] **Hardening.** Mirror-overwrite guard (a stale/empty server read can't wipe a good local
  list), credential-dedup so a flush race can't mint a duplicate account, and the account session
  is header-only (never via URL). Covered by `server/account.test.js` + `server/accounts.model.test.js`.

## Open items

Legend: `[ ]` todo · `[~]` parked / in progress · `[x]` done

- [~] **Add password reset / native-account email.** **OFFICIALLY DEFERRED BY THE USER (2026-06-09):** _"defer the setup of the native account system and email, I will get back to this later."_ Do **not** start this until the user revisits it. It needs an SMTP / transactional-email provider plus its env key, which the user will supply. The native-account login/sign-up itself is already shipped and live; only the **email-dependent** flows (the password-reset token round-trip, and any future email verification) are parked. Prerequisites are logged in `docs/REQUIREMENTS.md`.

---

_Completed work lives in [`IMPLEMENTATION_PLAN_ARCHIVE.md`](./IMPLEMENTATION_PLAN_ARCHIVE.md)._
