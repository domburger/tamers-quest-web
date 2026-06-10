# Tamers Quest — What I need from you

> A short list of the only things **you** need to do or decide so nothing stays blocked.
> Everything else (building, testing, fixing, deploying) is handled by the agents.
> Full task list: `IMPLEMENTATION_PLAN.md` · detailed decision log: `../requirements.md` ·
> game is live at **tamersquest.com**.

Last updated: 2026-06-10.

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

- **Login system reviewed + the 3 gaps you flagged are shipped (2026-06-10).** I went over the
  whole sign-in flow (OAuth + native + cloud-save sessions) — it's sound (CSRF-protected,
  rate-limited, email-verified-only, no token-in-URL leaks). The three missing pieces are now live:
  **(1)** the first time you sign in with **Google/Discord you're prompted to choose a username**
  (it used to silently name you from your email handle); **(2)** a **login indicator** — character
  select shows a clickable identity chip ("*your name* — View profile"); **(3)** a **profile page**
  with your **avatar**, lifetime **player data** (runs / escaped / deaths / caught / PvP wins), and a
  per-run **match history** (a new server-side run log). You can rename yourself anytime from the
  profile. _Review notes:_ the indicator currently lives on the character-select screen (not yet a
  global overlay on every screen), and **native email signups** still default the name to the email
  handle (no prompt) — say the word if you want either changed.
- **Single-player is now SERVER-AUTHORITATIVE (cheat-proof), per your call.** SP runs as a private,
  instant 1-player server round; the lobby + management now read the one authoritative server
  profile. Existing progress is migrated once via a **loss-safe MERGE** (local SP + any server MP
  progress are unioned — nothing removed; forged localStorage is clamped). **Side effect:** SP is
  now **online-first** (needs the server; it shows a "connecting / couldn't reach server" state if
  Railway is cold). **Known UX nit:** after a run you land on the title screen (MP behaviour), not
  straight back in the lobby — progress still saves; a fix is queued in the render lane. Say if
  you'd rather SP stayed offline-capable or returned straight to the lobby.
- **Combat is now fully AI-driven by default (2026-06-09).** The structured **v2 fight-judge**
  (`combatJudgeV2`) and the **multi-agent v2 monster generator** (`genPipeline`) are now the live
  defaults, and a generated monster's **own AI-authored attacks** (`genAttacks` — title + a
  description the judge reads) are its actual combat moves. Flip `combatJudgeV2`/`genPipeline` back
  in `/admin` if you want the old behaviour. Say if combat feels too swingy and I'll tune it.
- **CLEAN WIPE + pure-AI roster done (2026-06-09), per your request.** I wiped the prod DB
  (**16 player profiles + the old generated monsters deleted — irreversible**) and the AI generated
  **5 fresh monsters + 5 items**, live now. **Decision you should sanity-check:** the 115
  hand-authored "base" monsters live in a code file, *not* the DB, so a literal DB wipe wouldn't
  touch them — but "clean slate / 5 initial" reads as pure-AI, so I made the **prod** server load
  **zero** seed monsters (only the AI pool). It's a code default for the Railway production env
  (local dev + tests keep the seed). **To bring the 115 hand-authored monsters back on prod, set
  `AI_MONSTERS_ONLY=0`** (or tell me). The AI also generates more monsters during play.
  _(Heads-up: the 5 came out very dark-themed — Darkness/Shadow heavy — fitting the cave setting
  but low elemental variety; say the word and I'll regenerate for a broader spread.)_

## ✅ Recently resolved (no action needed)

- **OAuth in production** — you confirmed Google + Discord login both work end-to-end. Done.
  (First-login now also prompts for a username — see "Please review" above.)
- **Model options** — you added an OpenAI key; all 8 admin model picks verified live. Done.

---
