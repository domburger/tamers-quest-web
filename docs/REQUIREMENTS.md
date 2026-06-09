# Tamers Quest — What I need from you

> A short list of the only things **you** need to do or decide so nothing stays blocked.
> Everything else (building, testing, fixing, deploying) is handled by the agents.
> Full task list: `IMPLEMENTATION_PLAN.md` · detailed decision log: `../requirements.md` ·
> game is live at **tamersquest.com**.

Last updated: 2026-06-09.

## 🟢 Still on you (optional / when you want them)

- **Email / SMTP path (needed for "Add password reset")** — the reset flow can't be finished
  until there's a way to *send* the reset link (SMTP creds, or a transactional-email provider
  like Resend/Postmark/SES). Decide the provider + add its API key/SMTP env on Railway, then the
  reset-token flow (generate → email link → consume → set new password) gets wired. **Blocked on
  you** until then; skipped in the plan.
- **Optional ops:** rotate the live secrets on Railway (cheap hygiene); set
  `ALLOWED_ORIGINS=https://tamersquest.com` (code honors it — locks the WS + the AI-cost combat
  endpoint to your domain). Only needed if you split the client + game server onto separate
  domains (see `docs/DEPLOYMENT.md`).
- **Real imprint contact (later, before any formal launch)** — a real **address + contact email**
  to replace the "on request" / placeholder in `/legal`. Not urgent.

## 🟡 Please review (shipped — tell me if you want it changed)

- **Single-player is now SERVER-AUTHORITATIVE (cheat-proof), per your call.** SP runs as a private,
  instant 1-player server round; the lobby + management now read the one authoritative server
  profile. Existing progress is migrated once via a **loss-safe MERGE** (local SP + any server MP
  progress are unioned — nothing removed; forged localStorage is clamped). **Side effect:** SP is
  now **online-first** (needs the server; it shows a "connecting / couldn't reach server" state if
  Railway is cold). **Known UX nit:** after a run you land on the title screen (MP behaviour), not
  straight back in the lobby — progress still saves; a fix is queued in the render lane. Say if
  you'd rather SP stayed offline-capable or returned straight to the lobby.
- **Combat judge v2 (opt-in)** — a richer structured fight-judge (per-field deltas, passives,
  transcript, special actions like insta-win/flee) is built behind the admin flag `combatJudgeV2`
  (default off). Flip it on in `/admin` to try it, then we make it default.
- **AI combat items** — items are now AI-generated (name + action description) and judged like an
  attack; generate/curate them in `/admin → items`. They drop from chests; the in-combat "Use
  item" UI is the last piece (in progress).

## ✅ Recently resolved (no action needed)

- **OAuth in production** — you confirmed Google + Discord login both work end-to-end. Done.
- **Model options** — you added an OpenAI key; all 8 admin model picks verified live. Done.

---
