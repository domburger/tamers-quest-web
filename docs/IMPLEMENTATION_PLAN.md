# Tamers Quest — Implementation Plan

Last updated: 2026-06-10

> **The plan is complete.** Every implemented item has been moved to
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
- **The wiki must match mechanics.** Update `public/wiki.html` when combat, elements, catching, chains, status effects, controls, mobile behavior, or progression rules change.

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
