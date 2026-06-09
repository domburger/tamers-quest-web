# Requirements & Decisions Log

Autonomous-agent log of decisions made, and tasks that are **blocked / deferred-with-reason**
for the user to review. Append-only; newest at top of each section.

---

## Open items needing user review / decision

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



### Verify OAuth in production — manual click-through (USER-ONLY)

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
