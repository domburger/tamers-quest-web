# Tamers Quest — What I need from you

> A short list of the only things **you** need to do or decide so nothing stays blocked.
> Everything else (building, testing, fixing, deploying) is handled by the agents.
> Full task list: `IMPLEMENTATION_PLAN.md` · game is live at **tamersquest.com**.

Last updated: 2026-06-07.

---

## 🔴 Blocking — one decision is holding up the biggest remaining feature

1. **How should combat resolve elements / catch / status?** You asked for the **judge LLM**
   to handle these (no predefined tables). That makes combat **AI-dependent** — the offline
   deterministic engine can't reproduce AI-judged results. Pick one and I'll build it:
   - **(a)** keep *crude* engine defaults only so no-key/offline doesn't crash, or
   - **(b)** combat **requires the AI** (like PvP already does) — no offline fallback.

## 🟡 Your call (not hard-blocking, but I won't change these without you)

2. **Font** — agents shipped **Electrolize + Fredoka**; you'd asked for a *"clean modern sans."*
   Keep it, or switch to Inter / system-ui?
3. **Sprint/stamina** — an agent added a hold-Shift sprint you didn't request. Keep or remove?
4. **PvP trigger** — duels currently start on **any collision**. Keep, or only on an intentional
   chain-throw?
5. **Audio** — procedural SFX are **on by default** (not yet ear-tested). Keep / change the style?
6. **Grant `@visual` direct `git push`?** Optional — today agents commit locally and the
   coordinator relays to prod (works fine); only needed if you want them pushing directly.
7. **Cosmetics — free or earned?** A **Cosmetics Store** (chain skins) shipped; skins are
   currently **free to equip**. Should they cost gold/essence or be unlocked, or stay free?

## 🟢 Manual steps / info only you can provide

8. **Turn on AI monster generation** (you requested the gen pipeline — it's currently **OFF**):
   set **`MONSTER_GEN_RATE`** to e.g. `0.1` on Railway **or** in **`/admin`** (each generation
   costs OpenAI). Model + temperature + prompts are all editable in `/admin` (gpt-5.4 selectable).
   - ✅ Already set for you: `OPENAI_API_KEY`, `ADMIN_TOKEN`, `DATABASE_URL` (persistence is live).
9. **Compliance pages need your details** (legal pages are being added — see `CMP` in the plan):
   the **Imprint/Impressum contact** (operator name + email/address, since you're Swiss) and a
   quick OK on the data-practices wording. The pages can be scaffolded with placeholders until then.
10. **OAuth sign-in credentials (only if you want Google/Discord login):** provide each provider's
    **client id + secret** to add to Railway env. Full step-by-step below: **see
    "🔑 Guide: Adding Google & Discord sign-in."** *Not needed* for the native "Tamer's Account"
    (email/password) option — that one I can build without anything from you.

## 🔐 Quick security/ops actions (from the full review — you control Railway, so these are yours)

11. **Rotate the live secrets.** The full review flagged `OPENAI_API_KEY` + `RAILWAY_TOKEN`
    sitting in a local `.env`. They're **not** in the repo (`.env` is git-ignored), but rotating
    them on Railway is cheap insurance. ~5 min.
12. **Set two env vars on Railway** (I can't set these for you):
    - `PVP_ENABLED=false` — PvP defaults **on** but its combat path is still incomplete; turn it
      off until the combat work (FGT) lands, so live players don't hit broken duels.
    - `ALLOWED_ORIGINS=https://tamersquest.com` — currently unset, which leaves the WebSocket open
      to cross-site connection hijacking. Setting it locks connections to your domain.
    - *(Everything else from the review the agents will fix in code — these three are env/secret
      actions only you can take.)*

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
