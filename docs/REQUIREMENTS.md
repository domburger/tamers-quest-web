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

## 🟢 Manual step only you can do

7. **Turn on AI monster generation** (you requested the gen pipeline — it's currently **OFF**):
   set **`MONSTER_GEN_RATE`** to e.g. `0.1` on Railway **or** in **`/admin`** (each generation
   costs OpenAI). Model + temperature + prompts are all editable in `/admin` (gpt-5.4 selectable).
   - ✅ Already set for you: `OPENAI_API_KEY`, `ADMIN_TOKEN`, `DATABASE_URL` (persistence is live).

---

That's it. Try the game and tell me what to change — the agents take it from there.
