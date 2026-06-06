# Tamers Quest — Network Protocol (IMPLEMENTED)

> The wire protocol for the live multiplayer layer. This describes what the code
> actually does today (`server/world.js` ⇄ `src/net.js`). Data shapes come from
> `src/engine/schemas.js`; tunables from `GAME` there.

Last updated: 2026-06-06

---

## Transport

- **WebSocket** (`wss://`), one persistent connection per client, same origin as
  the static client (one combined Node service).
- Messages are **JSON**. (Binary encoding is a future option if snapshot
  bandwidth becomes a problem at 16 players — see Open Questions.)
- Every message is an envelope `{ "t": <type>, ... }`; client→server and
  server→client types are disjoint.

```jsonc
// client → server
{ "t": "input", "seq": 1423, "type": "move", "payload": { "dx": 1, "dy": 0 } }
// server → client
{ "t": "snapshot", "tick": 5821, "time": 412, "you": { ... }, ... }
```

## Authority model

The server is **authoritative** for all state (positions, monsters, combat, zone,
extraction). Clients send **intents**, never results; the server validates every
input, simulates, and broadcasts snapshots. Enforced anti-cheat: movement is
**direction-only** (server integrates at `GAME.BASE_SPEED`, clamps the axis to
[-1,1] NaN/∞-safe, normalizes diagonals, applies tile collision + map-bounds
clamp); `combatAction` honors **only the active monster's own attacks**; a client
can only act on its own combat session.

## Lifecycle

```
connect → join → welcome → queue → queued → matchFound → roundStart
       → [ input ⇄ snapshot ]*  +  (combatStart → combatAction ⇄ combatUpdate → combatEnd)*
       → extracted | died → idle (back to queue)
```

## Client → server messages

| `t` | Payload | Meaning |
|---|---|---|
| `join` | `{ token?, nickname? }` | Establish a session: resume by `token`, else create anonymous from `nickname`. → `welcome`. |
| `queue` | `{}` | Enter matchmaking with the current team. → `queued`, then `matchFound` when a round forms. |
| `unqueue` | `{}` | Leave the queue. → `unqueued`. |
| `input` | `{ seq, type:"move", payload:{dx,dy} }` | Movement intent (`dx,dy` a direction; `seq` is a monotonic client counter, echoed back as `you.ack`). |
| `combatAction` | `{ combatId, action }` | A turn choice in an instanced fight. `action.kind` ∈ `attack` (`{attackName}`) · `catch` · `flee` · any other ⇒ a skipped turn. |
| `ping` | `{ t0 }` | Latency probe; echoed in `pong`. |

`hello` → `server_info` is also supported server-side, but the current client
doesn't send it. There is **no** `leave`/`interact`/`swap` message: leaving is a
socket close, extraction/encounters are proximity-triggered server-side, and team
swaps aren't implemented yet.

## Server → client messages

| `t` | Payload | Meaning |
|---|---|---|
| `server_info` | `{ maxPlayers, serverTime }` | Reply to `hello`. |
| `welcome` | `{ you:{ id, nickname, token, team } }` | Session established; `team` is the active roster. Store `token` to resume. |
| `queued` | `{ position }` | Acknowledged into matchmaking. |
| `unqueued` | `{}` | Left the queue. |
| `matchFound` | `{ roundId, players }` | A round is forming (map generating). |
| `roundStart` | `{ roundId, seed, mapSize, spawn:{x,y}, you:{id,nickname}, players:[{id,name}], durationS }` | Regenerate the map from `seed`; spawn at `spawn` (world px). |
| `snapshot` | see below | Periodic per-viewer world state. |
| `combatStart` | `{ combatId, enemy, active, attacks }` | An instanced fight began. `enemy`/`active` are monster snapshots (name, typeName, element, level, current/max health & energy, status); `attacks` = `[{name, energyCost, element}]`. |
| `combatUpdate` | `{ combatId, narrative, active?, enemy?, outcome?, caught? }` | A resolved turn (AI or deterministic fallback). |
| `combatEnd` | `{ combatId, outcome, team }` | `outcome` ∈ `won`\|`lost`\|`fled`\|`caught`; `team` is the updated roster. |
| `extracted` | `{ reason, team }` | Reached a portal; team healed, gains kept. |
| `died` | `{ reason, team }` | Team wiped by the zone, or timed out (`reason` ∈ `zone`\|`timeout`). Active team lost per Q10; `team` is the refill. |
| `pong` | `{ t0, t1 }` | Latency reply (client computes RTT = now − t0). |
| `error` | `{ code, message }` | Protocol/validation error (e.g. `already_connected`). |

## Snapshots & area-of-interest

- Server ticks at **15 Hz**; snapshots are sent **every other tick (~7.5 Hz)**,
  filtered per viewer.
- `snapshot` carries: `tick`, `roundId`, `you` (`{ id, x, y, ack, team:[{hp,max}] }`),
  nearby `players` (`[{id,name,x,y}]`), visible `monsters`
  (`[{id,typeName,level,x,y}]`), `time` (seconds left), `circle` (`{x,y,r}`|null),
  and `portals` (`[{x,y}]`).
- **Monsters are AoI-filtered**: visible within `AOI_RADIUS` (900px); hidden
  monsters reveal only within `REVEAL_RADIUS` (220px) — "some visible, some not".
  **Players are currently sent to everyone** — whether to AoI-filter them is OPEN
  **Q13**.
- The client **interpolates** render positions toward snapshots. The `seq`/`ack`
  plumbing exists, but full client-side **prediction/reconciliation** (replaying
  unacked inputs) is deferred — interpolation-only is smooth and drift-free.

## Combat over the wire

Combat is turn-based and **instanced** (decision Q1): the rest of the world keeps
moving while two combatants resolve a duel. The server opens a `combatId` and
drives `combatStart` → (`combatAction` ⇄ `combatUpdate`)\* → `combatEnd`. Turns
are **AI-resolved** (decision Q3: OpenAI) with the deterministic engine
(`src/engine/combat.js`) as the automatic fallback; catch is deterministic.
Movement is locked client- and server-side during a fight.

## Open questions

These mirror `docs/REQUIREMENTS.md §4`:
- **Q10** Run-loss penalty on death (current: lose the active team, vault safe).
- **Q11** PvP design (turn model, resolver, trigger, loot) — blocks player-vs-player.
- **Q12** Reconnection (grace period + abandon-as-death) — blocks resume-on-reconnect.
- **Q13** Player visibility (AoI-filter rivals like monsters?).
- **Binary encoding** if JSON snapshots get too large at 16 players.
