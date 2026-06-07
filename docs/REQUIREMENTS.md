# Tamers Quest — What I need from you

> A short list of the only things **you** need to do or decide so nothing stays blocked.
> Everything else (building, testing, fixing, deploying) is handled by the agents.
> Full task list: `IMPLEMENTATION_PLAN.md` · game is live at **tamersquest.com**.

Last updated: 2026-06-07.

---

## ✅ Decided 2026-06-07 — agents are building these (nothing for you here)

1. **Combat = AI-ONLY.** The judge LLM resolves combat (elements/catch/status); the deterministic
   engine is no longer a gameplay path (kept only as a transient crash-net so a hung call doesn't
   freeze a fight). The **combat prompt is editable in `/admin`** (it already is — `combatSystem`).
   → tracked as **FGT-T1 (option b)**; agents enforcing the AI-required path now.
2. **Font = Electrolize + Fredoka.** Locked. No further discussion. → removed from open questions.
3. **Duel initiative rules:**
   - collision with a **wild/NPC** monster → **the NPC acts first**;
   - collision with **another player** (PvP) → **random** who starts;
   - **intentional spirit-chain throw** → **the thrower (player) acts first**.
   → tracked as a combat-initiative task; agents building.
4. **Audio = keep + keep improving.** Fine as-is; iterate for quality. → ongoing polish.
5. **Cosmetics = mix of earned + free**, and **monetization is wanted (later).** → economy task +
   a deferred **monetization** track on the plan (with `CN-16` gacha).
6. **PT2-T11 (merge SP & MP onto one shared engine) = GREENLIT, TOP PRIORITY.** → `@coordinator`
   driving it as the lead workstream now.
7. **"Connection not secure" = resolved** (local to your PC; friends + incognito are fine).
8. **OAuth = credentials received** — Google + Discord client id/secret + `SESSION_SECRET` set on
   Railway (Discord uses the `identify` scope). → I'm **wiring the integration now** (routes +
   profile linking + the title-screen login buttons). Callback URLs you registered:
   `https://tamersquest.com/auth/{google,discord}/callback`.
9. **Imprint = Dominik Burger**, address "**available on request**", email **placeholder** for now.
   → `/legal` imprint updated with these.

## 🟢 The only things still on you (optional / when you want them)

- **AI monster generation** — you'll manage the gen rate in **`/admin`** (you asked it live there,
  not via env). It's **OFF** until you set it > 0. Each generation costs OpenAI.
- **Real imprint contact (later, before any formal launch)** — a real **address + contact email**
  to replace the "on request" / placeholder in `/legal`. Not urgent.
- **Optional ops:** rotate the live secrets on Railway (cheap hygiene); set
  `ALLOWED_ORIGINS=https://tamersquest.com` (code honors it — locks the WebSocket to your domain).

---

That's it — essentially everything is decided. Agents are building; **PT2-T11 (SP/MP unification)
is the current top priority**, with AI-only combat, the duel-initiative rules, the cosmetics
economy, and the OAuth wiring in flight alongside it.
