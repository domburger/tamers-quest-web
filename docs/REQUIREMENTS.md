# Tamers Quest — Requirements & Onboarding

> What I need **from you** to keep moving: manual steps only you can do,
> tokens/secrets to obtain, and strategic decisions I can't make for you.
> Companion docs: `IMPLEMENTATION_PLAN.md` (tasks), `../public/wiki.html` (game logic).

Last updated: 2026-06-06 (P1-T2 persistence code shipped; awaiting DB provisioning OK)

---

## 1. Status snapshot (2026-06-06)

| Thing | State |
|---|---|
| Game build | ✅ **P0–P4 done** — full multiplayer loop (sessions, matchmaking, seeded map, monsters, PvE combat + taming, extraction, Q10 death penalty) on `master`, CI-guarded |
| GitHub repo | ✅ `domburger/tamers-quest-web` (CI on every push/PR) |
| Deploy | ✅ **one Railway service runs the combined server** — serves the built client over HTTP **and** the WebSocket game on the same origin; `master` auto-deploys |
| Custom domain | ✅ `tamersquest.com` → Railway |
| LLM API key | ✅ **OpenAI** (`OPENAI_API_KEY`) set on Railway + local `.env` (gitignored) |
| Railway access (for me) | ✅ via `RAILWAY_TOKEN` (from `.env`) + Railway CLI |
| Online multiplayer in prod | ✅ **LIVE at https://tamersquest.com** — verified: client served + `wss://` join → welcome + team. (Apex only; `www` not configured.) |
| Persistence (P1-T2) | ⏳ **code shipped (PR #25), inert** — profiles reset on redeploy until a Railway Postgres is connected. **See §2 "Needs your OK".** |

---

## 2. Action items — ✅ all complete (2026-06-06)

- [x] **A. Merge PR #1** — done (plus PRs #2–#14 since; all CI-checked).
- [x] **B. Authorize Railway's GitHub app** — done; `master` auto-deploys the static client.
- [x] **C. LLM API key** — provided as a Railway server-side variable.
- [x] **D. Custom domain** — configured (Namecheap → Railway).

### Recently resolved
- [x] **Railway access** — I use `RAILWAY_TOKEN` (from `.env`) via the Railway CLI.
- [x] **LLM provider confirmed** — OpenAI (`OPENAI_API_KEY`), set on Railway + `.env`.
- [x] **Server deployed** — combined client+WS service (P1-T6).
- [x] **Q10 answered** — death loses the active run team (vault kept).
- [x] **`.env` gitignored** — secrets won't be committed (it wasn't tracked; now ignored).

### ⏳ Needs your OK — activate persistence (P1-T2)
The Postgres persistence **code is shipped and live** (PR #25) but **inert until a
database is connected** — so right now player profiles still reset on each
redeploy. To turn on durable profiles, one of:

- **(a) Authorize me** to provision it via the Railway CLI. The auto-approval
  classifier blocked me from creating a paid DB service without your explicit OK.
  Either reply "go ahead, provision Postgres", or add a Bash allow-rule for
  `railway add` in `.claude/settings.local.json`. I'll then create the DB, set
  `DATABASE_URL` on `web`, and verify a token survives a redeploy.
- **(b) Do it yourself** (2 min): Railway dashboard → project `tamers-quest-web`
  → **New → Database → Add PostgreSQL**. Then on the **`web`** service →
  **Variables** → add `DATABASE_URL` = reference `${{Postgres.DATABASE_URL}}`.
  The next deploy auto-activates persistence (you'll see `[store] loaded N
  profile(s)` in the logs). Tell me when done and I'll verify.

> Cost: Railway Postgres is a small always-on service (usage-billed). Reversible —
> deleting the DB service reverts to in-memory.

### Still useful from you (low urgency)
- [ ] **Try it online** at the domain and tell me how it plays (movement feel,
      combat, extraction).
- [ ] Optional later: an **Anthropic** key if you want to A/B the AI combat
      provider (currently OpenAI).

---

## 3. Tokens & secrets

I do **not** need your GitHub or Railway credentials — I'm already authenticated
to both. The only secret I need from you:

| Secret | Why | Where it lives | Needed by |
|---|---|---|---|
| **LLM API key** | AI-evaluated combat + AI monster generation | Railway env var (server-side), e.g. `ANTHROPIC_API_KEY` | Phase P1/P3 |

**Which provider?** My recommendation: **Anthropic (Claude)** — strongest models,
and it fits the "change how AI is used" goal. The current code uses **OpenAI
GPT-4o** (`OPENAI_API_KEY`). Whichever key you send determines the provider; I'll
wire the server to it. (Today the browser sends an OpenAI key directly — that's
insecure for multiplayer and will be replaced by the server-side key.)

> Send the key in a way you're comfortable with; I'll set it via Railway variables
> and confirm. Don't paste it into the repo or a committed file.

---

## 4. Strategic decisions — RESOLVED (2026-06-06)

All answered by the maintainer. Recorded with the resulting direction; the plan's
OPEN QUESTIONS section has been updated to match.

1. **Combat in a real-time 16-player world** → **Instanced duel** — others keep
   moving while two combatants resolve a fight. _("instanced duel for now is good.")_

2. **PvP / teams / loot** → **No allied teams; free-for-all**, plus **PvE against
   wild monsters; some monsters invisible, some not.** _("no teams, ffa and pve
   against wild monsters, some invisible some not.")_ Loot-on-kill specifics TBD
   when the extraction loop is built.

3. **AI in combat** → **AI-resolved fights are a core selling point** (this
   reverses the earlier "deterministic-only" recommendation). _("AI in live PvP is
   a key selling point… later find the smallest possible model to resolve fights
   correctly, maybe a finetuning from previous data that a larger model creates in
   live game for a while.")_ Direction: AI resolves combat; the deterministic
   engine (`engine/combat.js`) becomes the offline fallback **and** a
   baseline/critic for generating training data. Research track: big-model-in-the-
   loop during live play → collect transcripts → finetune a small, fast, cheap model.

4. **Content generation** → **Generate-on-empty, then ~90% reuse.** _("Every
   generated monster gets into the database… for now make it so that everything is
   generated if nothing is there yet, and if something is there we want about 90%
   reuse rate.")_ Applies to monsters, biomes, floor tiles, etc.; per-category
   generation quotas to be defined later. Everything generated is persisted to the DB.

5. **Hosting** → **All on Railway** _("Yes, sufficient for now")._

6. **Accounts/auth** → **Anonymous + nickname first**, then **Google + Discord**,
   then consider a native/other system. _("start by also allowing anonymous players
   that can select a nickname; in a second step add google and discord; then think
   about native or other auth systems.")_ Auth roadmap added to the plan (P1 + later).

7. **Status-effect taxonomy** → **Not pursued.** _("No taxonomy should be needed…
   status effects are made by ai and executed as interpreted by ai during fights.")_
   `docs/STATUS_TAXONOMY.md` is **shelved**; the deterministic fallback keeps its 4
   canonical statuses for offline play only. The AI resolver interprets statuses freely.

8. **Energy between fights** → **Partial reset for now** _("maybe we revise this
   later once we know more about how the game feels.")_ Implement a partial energy
   restore per encounter. **✅ Implemented** — at each encounter start, every living
   team monster regains 50% of max energy (capped), so a depleted team isn't stuck
   skipping turns (`restoreEnergyPartial`, `server/combat.js`).

9. **Vault on defeat** → **Acceptable** _("Yes")_ — fine as long as the vault isn't
   reachable mid-run.

## New open question (from P4)

10. **Run-loss penalty (OPEN).** When a player **dies in a round** (zone storm or
    timeout, not extracted), what happens to their team? Options: (a) lose the
    whole active team; (b) lose only monsters that fainted; (c) old single-player
    behavior — wiped → 4 random Lv.1 starters; (d) keep team, no loss (just no
    gains). Currently the server applies **no harsh loss** (team survives fainted)
    until you decide.
    _My pick:_ **(a) lose the active run team on death, vault safe** (classic
    extraction stakes).  → Your answer: __________

11. **PvP design (OPEN — blocks P3-T5).** Players can't fight each other yet.
    Four forks before I build it:
    a) **Turn model:** interactive (both players pick a move each turn, like PvE —
       richer but needs "waiting for opponent" UI) vs **auto-resolved skirmish on
       contact** (instant, simpler). _My pick: interactive._
    b) **Resolver:** AI per turn (your selling point, but ~1–2s × turns × 2 players
       waiting, and API cost) vs deterministic engine for PvP. _My pick: AI, with
       deterministic fallback (same as PvE)._
    c) **Trigger:** instant on collision vs a brief "challenge"/initiate. _My pick:
       instant on contact (FFA)._
    d) **Loot on kill:** winner takes the loser's active team into their vault.
       _My pick: yes (ties to Q10's "lose active team on death")._
    → Your answers: __________

12. **Mid-round disconnect (OPEN — blocks P6-T1 reconnection).** Today, if your
    connection drops mid-round, the server removes you from the round with **no
    penalty** and you **can't rejoin** (reconnecting starts you back in the menu
    with your team in whatever state it was). Two decisions:
    a) **Reconnect:** keep a disconnected player in their round for a grace period
       (e.g. 60s) so they can resume where they were? _My pick: yes — essential on
       mobile networks._
    b) **Penalty:** does disconnecting (and not returning before the grace period)
       count as a death (lose active team, per Q10) to stop "alt-F4 to dodge
       death", or is it a free exit? _My pick: treat an abandoned run as a death
       once Q10 is set (extraction-game fairness)._
    → Your answers: __________

13. **Player visibility (OPEN).** Right now the server sends **every** player's
    position to everyone, so the minimap/world shows all 16 rivals. Wild monsters
    already use area-of-interest (visible only when near; some hidden until close,
    Q2). Should **players** get the same treatment — only appear when within view
    range — so rivals are a threat you discover rather than always-on blips?
    _My pick: **yes, AoI-filter players** (matches the stealth/extraction feel and
    your "some visible, some not" direction; cheap server change once decided)._
    → Your answer: __________

---

## 5. Custom domain setup (Namecheap → Railway)

Once you tell me the domain, I'll run Railway's "add custom domain" which returns
the **exact** record to create. The general recipe for Namecheap:

**For a subdomain (recommended, e.g. `play.yourdomain.com` or `www`):**
1. Railway gives you a **CNAME target** like `xxxx.up.railway.app`.
2. Namecheap → Domain List → **Manage** → **Advanced DNS** → **Add New Record**:
   - Type: **CNAME Record**
   - Host: `play` (or `www`)
   - Value: `xxxx.up.railway.app` (the Railway target)
   - TTL: Automatic
3. Wait for DNS to propagate (minutes–hours). Railway issues TLS automatically.

**For the apex/root domain (`yourdomain.com`):**
Namecheap doesn't support CNAME at the apex. Easiest path: make `www` (or `play`)
the canonical domain via the CNAME above, then Namecheap → Advanced DNS →
**Redirect Domain**: apex `@` → `https://www.yourdomain.com` (301).

> Give me the domain and I'll add it on the Railway side and paste back the exact
> Host/Value to enter.

---

## 6. Railway resource reference

| Resource | ID |
|---|---|
| Project `tamers-quest-web` | `9f19731b-6b8e-4c48-a21f-2751ca031e50` |
| Environment `production` | `6379fd10-4ee4-44f6-8c66-f8bfc371f92c` |
| Service `web` | `a94b16ee-7cee-45a7-8c22-b4cd385e94f2` |
| Public URL | `https://web-production-e9032c.up.railway.app` |
| Workspace (personal) | `caeb167f-1d2b-438f-8f71-dee0cefbb839` |
