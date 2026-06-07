# Tamers Quest — What I need from you

> A short list of the only things **you** need to do or decide so nothing stays blocked.
> Everything else (building, testing, fixing, deploying) is handled by the agents.
> Full task list: `IMPLEMENTATION_PLAN.md` · game is live at **tamersquest.com**.

Last updated: 2026-06-07.

---

## ✅ Status — nothing hard-blocks the project right now

Combat works (deterministic engine + optional AI judge, with safe fallback); the **Playtest-1**
findings (38 tasks) are being worked across agents and production is **live + continuously deployed**.
The combat-crash the playtest hit no longer reproduces on the current build. Everything below is a
**decision** or a **manual step** — none of it is blocking active development.

## 🟡 Your call (I won't change these without you)

1. **Combat resolution model.** Combat currently runs on the **deterministic engine** with the AI
   judge as an **optional layer** that auto-falls-back if the key/call fails (effectively option *a*).
   You'd originally asked for the judge LLM to *own* elements/catch/status. Keep the current safe
   hybrid (**a**), or make combat **AI-required, no fallback** (**b**)? *Default if you don't pick: keep (a).*
2. **Font** — **Electrolize + Fredoka** shipped; you'd asked for a *"clean modern sans."*
   Keep, or switch to Inter / system-ui?
3. **PvP trigger** — duels start on **any collision**. Keep, or only on an intentional chain-throw?
4. **Audio** — procedural SFX are **on by default** (not yet ear-tested). Keep / restyle?
5. **Cosmetics — free or earned?** The Cosmetics Store ships **chain + character skins free to equip**.
   Charge gold/essence, gate behind unlocks, or stay free? *(Related: `CN-16` gambling/gacha — deferred "way later" per you.)*
6. **Big refactor greenlight — PT2-T11.** Merge SP & MP onto **one shared engine** (the playtest
   surfaced a whole class of parity bugs — separate rosters, SP map lagging MP, etc. — that all
   collapse into this). Worth doing now, or keep shipping standalone fixes? **I'll drive it on your go.**
   - *(Sprint: an unrequested hold-Shift sprint exists; it was retuned to feel good (GP-4) and is kept
     by default — say if you'd rather drop it.)*

## 🟢 Manual steps / info only you can provide

7. **Turn on AI monster generation** (gen pipeline is **OFF**): set **`MONSTER_GEN_RATE`** (e.g. `0.1`)
   on Railway **or** in **`/admin`** (each gen costs OpenAI). Model/temp/prompts editable in `/admin`
   (gpt-5.4 selectable). ✅ `OPENAI_API_KEY`, `ADMIN_TOKEN`, `DATABASE_URL` already set.
8. **Compliance pages need your details** — the **Imprint/Impressum contact** (operator name +
   email/address, since you're Swiss) and a quick OK on the data-practices wording. `/legal` is
   **live with placeholders** until you provide these.
9. **OAuth sign-in credentials** *(only if you want Google/Discord login)* — client id + secret per
   provider on Railway; full step-by-step below. The native **"Tamer's Account"** (email/password)
   option needs nothing from you and I can build it independently.

## 🔐 Quick security/ops actions (you control Railway, so these are yours)

10. **Rotate the live secrets** (`OPENAI_API_KEY` + `RAILWAY_TOKEN`) on Railway — cheap insurance
    (~5 min). They're **not** in the repo (`.env` is git-ignored).
11. **Set two env vars** (I can't set these for you):
    - `ALLOWED_ORIGINS=https://tamersquest.com` — **the code now honors it**; setting it locks the
      WebSocket to your domain (currently unset → open to cross-site connection hijacking).
    - `PVP_ENABLED=false` — *optional/cautious:* PvP's combat path is still maturing; off until it's
      finished avoids live players hitting rough duels. (Leave on if you want PvP available.)

---

## 🔑 Guide: Adding Google & Discord sign-in

**Where we are today:** every player is **anonymous**. On first join the server mints an opaque
session token (`server/store.js`), the browser stores it (`tq_session_token`), and presents it to
resume the same profile (team, vault, gold). It works, but a player can't log in from a second
device. **OAuth fixes that** — it lets a player attach a Google/Discord identity to their profile,
so the same login always returns the same account anywhere.

**Who does what:** steps marked **YOU** need your provider accounts — they're the only thing I
can't do. Everything marked *(agents)* I build once you hand over the credentials. End-to-end this
is ~15 min of clicking per provider on your side.

### The callback URLs (you'll register these; they're fixed)
Both providers ask where to send the user back after login. Use these **exactly**:
| Provider | Production callback | Local-testing callback (optional) |
|---|---|---|
| Google | `https://tamersquest.com/auth/google/callback` | `http://localhost:8080/auth/google/callback` |
| Discord | `https://tamersquest.com/auth/discord/callback` | `http://localhost:8080/auth/discord/callback` |

### Google — step by step  **(YOU)**
1. Open the **Google Cloud Console** → create or select a project.
2. **APIs & Services → OAuth consent screen** → choose **External**. Set the app name
   ("Tamer's Quest") and your support email. Add scopes **`openid`, `email`, `profile`**. While
   testing, add your own Google account under **Test users**; hit **Publish** when you want it open
   to everyone.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → type
   **Web application**.
4. Under **Authorized redirect URIs**, add the Google callback URL(s) from the table above.
5. Copy the generated **Client ID** and **Client secret**.
6. On **Railway** (your service → **Variables**) set:
   - `GOOGLE_CLIENT_ID=…`
   - `GOOGLE_CLIENT_SECRET=…`

### Discord — step by step  **(YOU)**
1. Open the **Discord Developer Portal** → **New Application** (name it "Tamer's Quest").
2. **OAuth2 → Redirects** → add the Discord callback URL(s) from the table above → **Save Changes**.
3. Scopes the code will request are **`identify`** and **`email`** — nothing to toggle here, just
   noting it so the consent screen looks right.
4. On the **OAuth2** page, copy the **Client ID**; click **Reset Secret** to reveal the
   **Client Secret**.
5. On **Railway** set:
   - `DISCORD_CLIENT_ID=…`
   - `DISCORD_CLIENT_SECRET=…`

### One shared secret  **(YOU)**
Also set a random **`SESSION_SECRET`** on Railway (any long random string) — it signs the login
hand-off so a session can't be forged. Generate one with `openssl rand -hex 32`, or any password
generator (32+ chars).

### Then ping me — here's what I build *(agents)*
Once those env vars are live, tell me and I'll wire:
- HTTP routes `GET /auth/{google,discord}` (redirect to the provider) and
  `/auth/{google,discord}/callback` (exchange the code → fetch the provider profile →
  find-or-create a Tamers profile linked by `googleId` / `discordId` → hand the session token back
  to the browser). These slot into the raw-`node:http` router in `server/index.js`.
- A `googleId` / `discordId` / `email` field on the stored profile (`server/store.js` + Postgres),
  so the same login always resolves to the same team & vault.
- The title-screen **"Continue with Google / Discord"** buttons (`src/scenes/start.js`) pointed at
  those routes; on return the client stores the session token exactly like today.
- A CSRF `state` check on the callback, reusing the existing rate-limiting.

**No new dependencies needed** — the flow is a couple of `fetch` calls to each provider's token
endpoint, which fits the dependency-light server. (If you'd rather, the native **"Tamer's Account"**
email+password option needs nothing from you and I can build it independently — OAuth is just the
faster path for players.)

---

That's it. Try the game and tell me what to change — the agents take it from there.
