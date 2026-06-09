# Tamers Quest — What I need from you

> A short list of the only things **you** need to do or decide so nothing stays blocked.
> Everything else (building, testing, fixing, deploying) is handled by the agents.
> Full task list: `IMPLEMENTATION_PLAN.md` · game is live at **tamersquest.com**.

Last updated: 2026-06-07.

## 🟢 The only things still on you (optional / when you want them)

- **Real imprint contact (later, before any formal launch)** — a real **address + contact email**
  to replace the "on request" / placeholder in `/legal`. Not urgent.
- **Optional ops:** rotate the live secrets on Railway (cheap hygiene); set
  `ALLOWED_ORIGINS=https://tamersquest.com` (code honors it — locks the WebSocket to your domain).
- **Email / SMTP path (needed for "Add password reset")** — the password-reset flow can't be
  finished until there's a way to *send* the reset link (SMTP creds, or a transactional-email
  provider like Resend/Postmark/SES). Decide the provider + add its API key/SMTP env on Railway,
  then the reset-token flow (generate → email link → consume → set new password) can be wired.
  Until then this task is **blocked on you** and is skipped in the plan.
- **OAuth consent click-through (finishes "Verify OAuth in production")** — both providers are
  configured on Railway (`/auth/providers` → google+discord) and the code path is verified; the
  only remaining step is a human signing in with a real Google **and** Discord account in a browser
  to confirm the callback links the profile. Agents can't do the browser consent step.

---