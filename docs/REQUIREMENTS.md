# Tamers Quest — Requirements & Onboarding

> What I need **from you** to keep moving: manual steps only you can do,
> tokens/secrets to obtain, and strategic decisions I can't make for you.
> Companion docs: `IMPLEMENTATION_PLAN.md` (tasks), `../public/wiki.html` (game logic).

Last updated: 2026-06-06

---

## 1. Status snapshot

| Thing | State |
|---|---|
| Procedural sprites + seeded map gen | ✅ done, on branch `procedural-render-and-hosting` (PR #1) |
| GitHub repo | ✅ renamed to **`domburger/tamers-quest-web`** |
| Railway project | ✅ **tamers-quest-web** created |
| Railway service | ✅ **web**, connected to the GitHub repo |
| Railway public URL | ✅ `https://web-production-e9032c.up.railway.app` (serves once deployed) |
| First deploy | ⛔ blocked on **your** action items below |

---

## 2. Action items for YOU (in order)

- [ ] **A. Merge PR #1** → https://github.com/domburger/tamers-quest-web/pull/1
      I'm not allowed to self-merge into `master` (safety guardrail). master needs
      the hosting config (`railway.json`, `serve` start script) before Railway can
      build. Review the diff and click **Merge**.

- [ ] **B. Authorize Railway's GitHub app** (one-time, in the Railway dashboard)
      Open the project → service **web** → **Settings → Source**. If it asks to
      "Configure GitHub App" / grant access to `tamers-quest-web`, do it. This lets
      Railway pull the repo and auto-deploy on every push to `master`.
      Project: https://railway.com/project/9f19731b-6b8e-4c48-a21f-2751ca031e50
      → After A + B, the first deploy should start automatically. (If not, hit
      **Deploy** in the dashboard, or tell me and I'll trigger it.)

- [ ] **C. Give me an LLM API key** (for the AI pipelines — not needed for the
      static page, needed from phase P1/P3 onward). See §3. I'll store it as a
      **server-side Railway variable**, never in the repo.

- [ ] **D. Custom domain** (your Namecheap domain). Tell me the exact domain and
      I'll register it on the service and hand you the precise DNS records. See §5.

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

## 4. Strategic decisions I need (answer inline — edit this file or just tell me)

These are the OPEN questions from the plan. My recommendation is pre-filled; change it if you disagree.

1. **Turn-based combat inside a real-time 16-player world?**
   Options: instanced duel (others keep moving) · brief global freeze · real-time.
   _My pick:_ **instanced duel.**  → Your answer: __________

2. **PvP rules** — can players fight each other's teams? Loot stealing on a kill?
   _My pick:_ **yes to PvP; killer loots the run-bag (not the base inventory).**  → Your answer: __________

3. **AI in live PvP** (LLM turn-eval is slow + costs money per turn).
   _My pick:_ **deterministic server resolver for all fights; AI used only for PvE flavor/narration.**  → Your answer: __________

4. **AI monster generation timing** — offline pool (generate a batch into the DB) vs runtime.
   _My pick:_ **offline pool / admin tool, curated into the live set.**  → Your answer: __________

5. **Hosting** — Railway for both the (future) server + DB and the client?
   _My pick:_ **yes, all on Railway.**  → Your answer: __________

6. **Accounts/auth** — guest sessions or real accounts? What identifies a returning player + their base inventory?
   _My pick:_ **start with lightweight accounts (email magic-link or OAuth), guest play later.**  → Your answer: __________

7. **Status-effect taxonomy** — the attack data inflicts ~50 different status
   labels (Bleed, Blind, Confusion, Fear, Paralysis, Drowning, Entangled…) plus
   buffs (Heal, Regeneration, Shielded, Reflect). Right now only **Burn, Poison,
   Freeze, Stun** do anything; the rest are inert labels.
   _My pick:_ **let me draft a small canonical set (~8–10: damage-over-time,
   skip-turn, accuracy-down, defense-down, heal-over-time, shield, etc.) and map
   every label onto it — you review the mapping.**  → Your answer: __________

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
