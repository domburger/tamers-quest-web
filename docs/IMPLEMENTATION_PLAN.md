# Tamers Quest — Implementation Plan

Last updated: 2026-06-09

> **The plan is complete.** Every implemented item has been moved to
> [`IMPLEMENTATION_PLAN_ARCHIVE.md`](./IMPLEMENTATION_PLAN_ARCHIVE.md) (the SP/MP unify,
> AI-judged combat + AI monster/item generation, mobile/visual polish, auth, ops/admin,
> etc.). Exactly **one open item** remains below — and it is parked at the user's request.

## Important bullets

- **Production is the current test environment.** Run `npm run build` before pushing. Commit and push small changes directly to `master`. Log failing tests in `docs/BUGFIX_LOG.md` instead of blocking production test deploys.
- **The game is server-authoritative.** Clients should send input and render snapshots; trusted state, movement, combat, loot, and persistence belong on the server or in shared engine code.
- **Avoid duplicate single-player and multiplayer rules.** Any gameplay rule that exists in both modes should live in shared engine code and be covered by tests.
- **Combat is AI-judged with a deterministic safety net.** The default judge is the structured v2 Fight-Judgement (`combatJudgeV2`); the deterministic engine is only a transient crash-net so a single failed AI call can't freeze a fight.
- **Admin settings should stay current.** Any new live gameplay knob, AI prompt, model setting, or generated asset type should be surfaced in admin if it is useful for live tuning.
- **The wiki must match mechanics.** Update `public/wiki.html` when combat, elements, catching, chains, status effects, controls, mobile behavior, or progression rules change.

## Open items

Legend: `[ ]` todo · `[~]` parked / in progress · `[x]` done

- [~] **Add password reset / native-account email.** **OFFICIALLY DEFERRED BY THE USER (2026-06-09):** _"defer the setup of the native account system and email, I will get back to this later."_ Do **not** start this until the user revisits it. It needs an SMTP / transactional-email provider plus its env key, which the user will supply. The native-account login/sign-up itself is already shipped and live; only the **email-dependent** flows (the password-reset token round-trip, and any future email verification) are parked. Prerequisites are logged in `docs/REQUIREMENTS.md`.

---

_Completed work lives in [`IMPLEMENTATION_PLAN_ARCHIVE.md`](./IMPLEMENTATION_PLAN_ARCHIVE.md)._
