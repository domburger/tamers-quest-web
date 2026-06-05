# Tamers Quest — Network Protocol (DRAFT / PLANNED)

> Wire protocol for the planned real-time multiplayer extraction layer.
> **Nothing here is implemented yet** — this is the contract P1/P2/P3 build against.
> Data shapes referenced below (`Snapshot`, `InputMsg`, `RoundState`, …) are
> defined in `src/engine/schemas.js`. Tunables come from `GAME` there.

Last updated: 2026-06-06

---

## Transport

- **WebSocket** (`wss://`), one persistent connection per client.
- Messages are **JSON** for now (readable, simple). If snapshot bandwidth becomes
  a problem at 16 players we revisit a binary encoding — see Open Questions.
- Every message is an envelope: `{ "t": <type>, ... }` where `t` is the type tag.
  Server→client and client→server share the envelope; types are disjoint.

```jsonc
// client → server
{ "t": "input", "seq": 1423, "type": "move", "payload": { "dx": 1, "dy": 0 } }
// server → client
{ "t": "snapshot", "tick": 5821, "timeRemainingS": 412, "you": { ... }, ... }
```

## Authority model

The server is **authoritative** for all state (positions, monsters, combat, loot,
zone, extraction). Clients send **intents**, never results. The server validates
every input, simulates, and broadcasts snapshots. This is non-negotiable: it's
PvPvE with loot, so a trusted client would be exploitable.

## Lifecycle

```
connect → hello → (auth) → welcome → queue → matched → roundStart
       → [ input ⇄ snapshot ]* → (combat*) → extracted | died → roundEnd → back to queue
```

## Client → server messages

| `t` | Payload | Meaning |
|---|---|---|
| `hello` | `{ clientVersion }` | First message after connect. |
| `auth` | `{ token }` | Authenticate the session (see PlayerProfile). Auth model = OPEN Q6. |
| `queue` | `{}` | Enter matchmaking with current base team. |
| `unqueue` | `{}` | Leave the queue. |
| `input` | `InputMsg` (`{ seq, type, payload }`) | Movement / interaction intent. `seq` is a monotonic client counter for reconciliation. |
| `combatAction` | `{ combatId, action }` | A turn choice during an instanced fight (`action` = `{kind:"attack",attackName}` \| `{kind:"catch"}` \| `{kind:"swap",index}` \| `{kind:"skip"}` \| `{kind:"flee"}`). |
| `leave` | `{}` | Abandon the current round (counts as death). |
| `ping` | `{ t0 }` | Latency probe; server echoes in `pong`. |

`input.type` ∈ `move` (`payload {dx,dy}`, normalized server-side) · `interact`
(`payload {}` — context action: step on portal, engage adjacent monster/player).

## Server → client messages

| `t` | Payload | Meaning |
|---|---|---|
| `welcome` | `{ playerId, profile }` | Session established; sends the player's `PlayerProfile`. |
| `queued` | `{ position }` | Acknowled­ged into matchmaking. |
| `roundStart` | `{ roundId, seed, mapSize, spawn:{x,y}, durationS, you }` | Generate the map from `seed`, spawn at `spawn`. |
| `snapshot` | `Snapshot` | Periodic AoI-filtered world state (see below). |
| `combatStart` | `{ combatId, opponent, yourTeam, layout }` | An instanced fight began (PvE or PvP). |
| `combatUpdate` | `{ combatId, result }` | Result of a resolved turn (mirrors engine `resolveTurn` output + narrative). |
| `combatEnd` | `{ combatId, outcome, rewards? }` | `outcome` ∈ `won`\|`lost`\|`fled`\|`caught`. |
| `extracted` | `{ rewards }` | You reached a portal and left with your gains. |
| `died` | `{ by }` | Your team was wiped / caught in the zone. |
| `roundEnd` | `{ summary }` | Round over; profile persisted. |
| `pong` | `{ t0, t1 }` | Latency reply. |
| `error` | `{ code, message }` | Protocol or validation error. |

## Snapshots & area-of-interest

- Server ticks at **10–20 Hz** (start at 15). Snapshots are sent per tick (or
  every Nth tick) and are **filtered per viewer**: only players/monsters within
  the viewer's interest radius are included, and **hidden monsters are omitted**
  until revealed (supports "some monsters visible, some not").
- `Snapshot` carries `you` (authoritative self), nearby `players`, visible
  `monsters`, `portals`, `circle`, and `timeRemainingS`.
- **Client prediction + reconciliation**: client applies its own `move` inputs
  locally immediately, tags each with `seq`; each `snapshot` echoes the last
  processed `seq` in `you` so the client can replay unacknowledged inputs.
  Remote entities are interpolated between snapshots.

## Combat over the wire (depends on OPEN Q1/Q3)

Combat is turn-based and **instanced**: when two combatants engage, the server
opens a `combatId` session and drives it via `combatStart` → (`combatAction` ⇄
`combatUpdate`)\* → `combatEnd`. Per current design leaning: the rest of the
16-player world keeps moving (instanced duel), and turns are resolved by the
**deterministic engine** (`src/engine/combat.js`); the LLM is used only for PvE
flavor/narration. Confirm Q1 (world freeze vs instanced) and Q3 (AI usage).

## Open questions (block implementation)

- **Q1** Instanced duel vs world-freeze vs real-time combat.
- **Q3** AI in live PvP (cost/latency) — deterministic-only for PvP?
- **Q6** Auth/account model for `auth`.
- **Binary encoding** if JSON snapshots get too large at 16 players.
- **Reconnection**: resume token + state resync on reconnect (P6).

These mirror `docs/REQUIREMENTS.md §4`; answers there drive the final shape.
