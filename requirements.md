# Requirements & Decisions Log

Autonomous-agent log of decisions made, and tasks that are **blocked / deferred-with-reason**
for the user to review. Append-only; newest at top of each section.

---

## ⚠ POLICY — NO LANES (Dominik, 2026-06-14)

**Lane assignments are ABOLISHED. Every agent may take every task and edit any file** — including
the former @phaser lane (`src/compat/`, `index.html`, `main.js`). There are no per-agent file/area
restrictions. Coordinate via Jira (set Assigned Agent while In Progress + leave signed comments) to
avoid collisions, but nothing is off-limits to any agent.

---

## Shipped recently (no decision needed — review when convenient)

### Login-system review + first-login username, login indicator, profile page — ✅ DONE 2026-06-10

User asked (during the `/loop` login review) for three additions; all shipped + tested + deployed:

- **Username on first OAuth login.** The callback (`server/auth.js`) now flags a freshly-minted,
  unnamed account with `&new=1`; the client (`index.html`) opens a username modal that POSTs to a
  new gated **`POST /account/username`** before character-select. New store field
  `usernameChosen` (legacy/migrated accounts = already chosen, so they're never re-prompted).
  Native email signups still default to the email handle (no prompt) — noted for the user.
- **Login indicator.** Character-select's "Signed in as X" line is now a clickable identity chip
  ("*name* — View profile") that opens the profile scene. (Lives on character-select, not yet a
  global overlay — noted for the user.)
- **Profile page** (`src/scenes/profile.js`, new scene): vector-tamer **avatar**, lifetime
  **player data** (runs/escaped/deaths/caught/PvP from the per-character `stats`), and **match
  history** — a new server-side per-run log (`world.js logRun`, appended at extract/death, capped
  20, newest-first), read via new **`GET /account/me`** for logged-in accounts (guests fall back to
  the local session character). Rename from here too.
- Review verdict: the sign-in flow itself is **sound** — CSRF state (single-use, TTL), per-IP +
  per-email throttles, email-verified-only trust, header-only session tokens (no URL leak),
  enumeration-safe native login. No security changes needed.

---

## Open items needing user review / decision

### SP/MP server-authoritative unify — the final flip (needs a loss-safe merge decision)

**User greenlit the migration (2026-06-09, "1").** Server-side foundations are SHIPPED + tested:
- **Increment 1** — `importProfile`: one-time, double-gated (`s.fresh` + `!profile.migrated`),
  VALIDATED/clamped adoption of a local loadout into a freshly-minted server profile. Can't
  overwrite established progress; clamps stop forged localStorage importing absurd values.
- **Increment 2** — `queueSolo`: forms an INSTANT, PRIVATE 1-player server round via the shared
  `formRound()` (no matchmaking, no other players). SP-as-a-solo-server-round = server-resolved =
  cheat-proof, reusing all MP world logic. `net.queueSolo()` added.
- The lobby refactor (`startServerRun`) is ready to route SP through the solo round.

**Why the final flip isn't shipped yet (the one real risk):** turning SP server-authoritative
means the lobby + management read `net.state` (server) and SP play goes through the solo round.
For a player who has BOTH **local SP progress** AND **server MP progress** (both exist today,
since MP was reachable), a one-time *overwrite* import would lose one side — violating "nothing
gets lost". The correct migration is an additive **MERGE**, which needs your nod on the policy:

- **Proposed merge (loss-safe):** active team = the player's LOCAL team (what they expect to see);
  vault = union(local vault, server's active+vault) capped; chains = union; currencies/upgrades =
  `max(local, server)` per field. Never removes anything. The only downside is a one-time
  `max`-currency exploit window (a player could inflate gold pre-migration) — acceptable per
  "take risks, fix later", and closeable later by validating against earned-stats.
- Then: `adoptLocalLoadout` becomes a merge (gate `!profile.migrated`, not `s.fresh`); the lobby
  reads `net.state`; SP `startSingle` → `startServerRun(true)`; management stations → the
  server-backed `roster`/`onlineShop`/`onlineBaseUpgrades`; the local SP scenes
  (`game`/`fight`/`loading`/`inventory`/`shop`/`baseUpgrades`) become unreachable (delete after
  agent B's in-combat-UI work frees `fight.js`).

**Decision needed:** OK the `max`-currency merge policy (or specify a stricter one), and I'll land
the full flip as one coherent change. Everything else is built.



### Generation systems — remaining large work (Monster / Item / Fight judge)

These three plan sections are big multi-file features; agent A shipped the contained, testable
pieces and is flagging the rest here so you can prioritise (they each warrant their own focused
pass, and two touch the live combat/render paths).

**Monster generation — remaining:**
- *Designer generates the 4 attacks + a Visual Description.* ✅ DONE 2026-06-09 (agent A): the
  designer now emits `genAttacks[4]` (title + judge/player-readable description) + `visualDescription`
  (`ATTRIBUTES_SCHEMA`, prompts, `normalizeGeneratedMonster`); additive (pool `attack_1..4` stay).
  REMAINING follow-on: OFFER `genAttacks` in combat (the v2 judge already reads `attack.description`)
  — gated on the v2 judge since genAttacks carry no numeric fields, so the v1 judge + deterministic
  engine still need the pool attacks. Touches the fight scenes (agent B's render lane).
- *Builder/Model agent must drive the renderer.* The Model stage already outputs bodyShape +
  palette + features + idle/attack animation specs, but the renderer only reads `bodyShape`
  (`spritegen.js`). Wiring palette/features + a real per-monster **idle and attack animation**
  into the fight screen is render-engine work (touches `render/character.js`, `fight.js`,
  `onlineGame.js` — overlaps agent B's render lane).
- *Make v2 the default?* Spec implies Langchain/multi-agent is THE path, but v2 is opt-in
  (default v1 single-call). Defaulting v2 adds ~3-4 LLM calls per generated monster (cost).
  Decide whether to flip the default or keep it admin-gated.

**Item generation — not started.** `item.json` is empty; no generator/schema/prompts/use-hook.
Spec: same inspiration→designer shape as monsters, simpler fields (name + short action
description, AI-generated), behaviour judged like an attack in a fight. Plan tasks "Decide
general items" + "Add in-combat inventory access" depend on this. Clean to build server-side
(schema + pipeline + admin + chest drops + a combat "use item" action) but the in-combat UI
spans the fight scenes (agent B's lane). ~A focused session.

**Fight-judge structured I/O rewrite.** Today the judge takes two one-line `describe()` strings
and returns absolute HP/energy/status. Spec wants: structured input incl. full monster
descriptions + passives + a running fight transcript; structured output of per-field EDITS
(integers as deltas, strings as full rewrites) for any field; a short display string; and a
"special actions" channel (end battle / insta-win / flee / arbitrary triggers). This is a
schema + prompt rewrite on the LIVE combat path — higher risk; worth doing behind a flag with
heavy tests before it becomes the default judge.



### Verify OpenAI model option ids (task 77) — needs an API key

The admin model dropdown (`server/aiconfig.js MODEL_OPTIONS`) lists `gpt-5.5`, `gpt-5.4`,
`gpt-5.4-mini/nano`, `gpt-5.3-chat-latest`, `gpt-4.1`, `gpt-4o`, `gpt-4o-mini`. I cannot
verify which are live without an `OPENAI_API_KEY` (and the field is free-text, so a wrong
entry isn't fatal — the default `gpt-4o` is known-good). I made dead-model failures
**diagnosable** (gen.js now logs the OpenAI error body, like the combat path), so a bad id
shows `model_not_found` in logs instead of silently always-using the crash-net. **Action for
user:** if you want the list pruned, confirm which ids are live (or point me at a key) and
I'll trim `MODEL_OPTIONS`.



### Account security — remaining hardening (#5/#6, MED) — deferred

The audit (task 34) fixed 4 findings in code. Two MED findings are deferred because the fix is
a larger structural change worth your sign-off:

- **OAuth `state` is not bound to the initiating browser** (`server/auth.js` state store is
  global). This allows a forced-login CSRF: an attacker pre-starts a flow and tricks a victim
  into completing it, logging the victim into the attacker's identity (and the `?claim=` coupling
  makes it bind the victim's OAuth identity onto the attacker's anon save). **Fix options:** set
  the `state` in an `HttpOnly; SameSite=Lax` cookie at `/auth/:provider` and require a match at
  the callback (double-submit), or adopt PKCE. Low real-world payoff for this game, but it's the
  one structural auth gap left. Not done autonomously because it adds a cookie to the flow
  (interacts with the static-serving / CORS setup) — quick to add on request.



### Verify OAuth in production — manual click-through (USER-ONLY) — ✅ DONE 2026-06-09

**RESOLVED — user confirmed 2026-06-09 that both Google AND Discord login work end-to-end in
production:** clicking each login button on tamersquest.com completes the provider consent flow and
lands back signed-in (callback → profile create/link confirmed). No `redirect_uri_mismatch`. This
closes the only remaining user-only OAuth verification gap. Original notes below for the record.

Verified by agent A 2026-06-09 (static + live config): `GET https://tamersquest.com/auth/providers`
returns `{"providers":["google","discord"]}`, so both providers' client id/secret are set on
Railway and the `/auth/*` router is live; the code builds `redirect_uri = <origin>/auth/<p>/callback`
correctly. **What I cannot do:** the end-to-end browser consent flow (sign in with a real Google
and a real Discord account, confirm the callback creates/links the profile and returns a token).
That needs a human in a browser + real provider accounts (and the no-localhost-browser directive
forbids me opening one). **Action for user:** click each login button on tamersquest.com once and
confirm you land back signed-in. If a provider shows "redirect_uri_mismatch", add
`https://tamersquest.com/auth/<provider>/callback` to that provider's console.



### SP/MP unify — Phases B–D (full server-authoritative single-player)

**Decision already made (user, 2026-06-09):** the SERVER profile is the single source of
truth for team / chains / upgrades / currency / owned-monsters in BOTH single-player and
multiplayer — "only like this singleplayer will also be cheat proof."

**Shipped (Phase A, safe + additive):** each character slot now binds to one token-keyed
server profile; the lobby establishes the server session on entry and persists the minted
token back onto the slot (`storage.js setCharacterServerToken`, `lobby.js establishSession`).
No live data is mutated; the lobby still displays the local character. This pre-warms MP and
gives every slot a stable authoritative profile for the next phases to build on.

**Deferred (Phases B–D) — why:** completing them requires migrating EXISTING localStorage
characters into server profiles and resolving SP runs server-side. Both touch **live player
data on production** (real guest profiles persisted in `server/store.js`), and a wrong
migration silently corrupts or wipes progress. The user's standing instruction is "make sure
nothing gets lost." So these are specced here for review rather than rushed live:

- **Phase B — route management to the server.** Point the lobby's Inventory/Shop/Upgrades
  stations at the existing server-backed scenes (`roster`, `onlineShop`, `onlineBaseUpgrades`),
  repoint their Back buttons to `lobby`, and delete the unreachable `onlineLobby` plus the
  local-only `inventory`/`shop`/`baseUpgrades` once parity is confirmed. **Coupling risk:**
  must land together with Phase C — otherwise you'd manage your team on the server but PLAY
  single-player with the stale local team.

- **Phase C — server-resolved SP runs.** SP catches / gold / xp / run-results must be applied
  by the server (it already AI-judges SP combat turns over HTTP), not the client, so the
  resulting profile can't be locally forged for MP. Needs new server handling for a solo run
  (spawn/loot/catch/extract resolution) keyed to the player's session, mirroring the MP round
  handlers in `server/world.js`.

- **One-time migration (the live-data risk).** On a slot's FIRST server bind, the server
  should adopt that slot's existing local team/vault/chains/gold/upgrades INTO its freshly
  minted profile — but ONLY when the server profile is brand-new (no prior saves), never
  overwriting an MP player's existing server progress. This import is the only point a client
  is trusted; it must be gated to never run twice and never clobber a non-empty server profile.

**Recommendation:** review the migration gating before this ships to `master` (production
auto-deploys). Everything else (Phases B–C mechanics) is mechanical once the migration policy
is approved.
