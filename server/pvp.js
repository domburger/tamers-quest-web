// FFA PvP (P3-T5). Decisions (Q11): interactive turns (both pick a move, resolve
// when both submitted), AI-resolved per turn, instant on collision, and the
// winner loots the loser's active team. Reuses the PvE message shapes
// (combatStart/Update/End) with a `pvp:true` flag so the client can adapt.
//
// Resolution (FGT-T1): AI-only — the turn goes through the shared `aiTurn` resolver
// (server/combat.js), the same path PvE and single-player use. The deterministic
// engine inside aiTurn is only a transient crash-net for a single failed/hung call,
// never a gameplay path; duels are gated on aiEnabled() at startPvp. The thrower of
// an engaging spirit chain gets first-turn initiative (consumed after turn 1).

import { aiEnabled } from "./ai.js";
import { aiTurn, buildState, attacksFor, monSnap, ownedAttack } from "./combat.js";
import { saveProfile, rollStarters, bumpStat, secureId } from "./store.js";
import { makeRng, randomSeed, hashString } from "../src/engine/rng.js";
import { GAME } from "../src/engine/schemas.js";
import { vaultCapacity } from "../src/engine/upgrades.js";
import { loseRunTeam } from "../src/engine/inventory.js";

const other = (k) => (k === "a" ? "b" : "a");
const clamp0 = (n) => Math.max(0, Math.round(n));

// Collision check between roaming players (called each tick when PvP is enabled).
export function maybeStartPvp(world, round, send) {
  const r2 = (world.cfg.pvpRadius || 40) ** 2;
  const free = [...round.players.entries()].filter(([, rp]) => !rp.inCombat && !rp.inPvp);
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) {
      const [idA, rpA] = free[i], [idB, rpB] = free[j];
      if (rpA.inPvp || rpB.inPvp) continue; // one may have started a duel earlier in this pass
      const dx = rpA.x - rpB.x, dy = rpA.y - rpB.y;
      if (dx * dx + dy * dy <= r2) {
        // FGT-T9 rule 2: a collision duel has no thrower, so who acts first is a
        // server-authoritative coin-flip. Seed it deterministically from the round +
        // the two players + the duel counter so it's reproducible and can't be nudged
        // by either client. (A chain-throw duel keeps the thrower's initiative — that
        // path passes its own initiatorId and never reaches here.)
        const first = makeRng(hashString(`${round.roundId}:${idA}:${idB}:${world.nextPvp}`)).next() < 0.5 ? idA : idB;
        startPvp(world, round, idA, idB, send, first);
      }
    }
  }
}

// Start a duel between two specific players. `initiatorId` is the player who acts
// first on turn 1 (FGT-T9): the spirit-chain thrower for a thrown engagement, or the
// seeded coin-flip winner for a collision. null → fall back to speed order.
export function startPvp(world, round, idA, idB, send, initiatorId = null) {
  const sA = world.sessions.get(idA), sB = world.sessions.get(idB);
  if (!sA || !sB) return;
  // FGT-T1: combat is AI-only — don't open a duel that can't be judged. Prod always
  // has the key; this just no-ops PvP collisions in a keyless local-dev server.
  if (!aiEnabled()) return;
  const teamA = sA.profile.activeMonsters || [], teamB = sB.profile.activeMonsters || [];
  const ai = teamA.findIndex((m) => m.currentHealth > 0);
  const bi = teamB.findIndex((m) => m.currentHealth > 0);
  if (ai < 0 || bi < 0) return; // someone has no usable monster — skip
  // Unguessable duel id (task 49) so a client can't target another pair's duel by id.
  const pvpId = secureId("v");
  world.nextPvp++; // still advance the collision coin-flip seed source (maybeStartPvp)
  const pvp = {
    pvpId, roundId: round.roundId,
    a: { id: idA, team: teamA, activeIdx: ai, action: null },
    b: { id: idB, team: teamB, activeIdx: bi, action: null },
    initiatorId, resolving: false,
  };
  world.pvps.set(pvpId, pvp);
  round.players.get(idA).inPvp = pvpId;
  round.players.get(idB).inPvp = pvpId;
  sendToSide(world, pvp, "a", "combatStart", {}, send);
  sendToSide(world, pvp, "b", "combatStart", {}, send);
}

// Send a combat message to one side, framed from that player's POV (enemy = the
// opponent's active monster). Reuses the PvE shape + a `pvp` flag.
function sendToSide(world, pvp, key, t, extra, send) {
  const self = pvp[key], opp = pvp[other(key)];
  const s = world.sessions.get(self.id);
  if (!s) return;
  send(s.ws, {
    t, combatId: pvp.pvpId, pvp: true,
    opponent: world.sessions.get(opp.id)?.profile?.name || "Rival",
    active: monSnap(self.team[self.activeIdx]),
    enemy: monSnap(opp.team[opp.activeIdx]),
    attacks: attacksFor(self.team[self.activeIdx]),
    // PvP snapshot fix: carry the FULL fresh team + which slot is active, on every
    // combatStart/combatUpdate. Without this, when a monster faints and the next is
    // promoted (advance), the client kept the fainted monster's team entry + moves.
    team: self.team.map((m) => monSnap(m)),
    activeIdx: self.activeIdx,
    ...extra,
  });
}

// A player submitted their move for the turn (interactive). Resolve when both have.
export async function handlePvpAction(world, pvp, playerId, action, send) {
  if (pvp.resolving) return;
  const key = pvp.a.id === playerId ? "a" : pvp.b.id === playerId ? "b" : null;
  if (!key) return;
  const side = pvp[key];
  if (side.action) return; // already chose this turn
  // Capture is disabled in PvP: you can't catch another player's monster. Reject a
  // forged catch action outright (the client never offers it) so it can't be stored
  // as a silent no-op "pass" turn — only attack / swap / flee are valid in a duel.
  if (action.kind === "catch") return;
  if (action.kind === "flee") { endPvp(world, pvp, null, "fled", send); return; } // no-contest, no loot
  side.action = action;
  if (!pvp[other(key)].action) {
    sendToSide(world, pvp, key, "combatUpdate", { waiting: true, narrative: "Waiting for your opponent…" }, send);
    return;
  }
  await resolveTurn(world, pvp, send);
}

async function resolveTurn(world, pvp, send) {
  pvp.resolving = true;
  const { a, b } = pvp;
  // Apply swap actions first (PvE parity): a swap is a free switch of the active
  // monster — the turn then resolves with the NEW monster taking the opponent's
  // committed hit (the swapping side deals no damage this turn, like a Pokémon switch).
  // Without this a Swap in PvP was a silent wasted turn: the client offers Swap in
  // duels, but resolveTurn formerly honored only `attack` actions, so the active
  // monster never changed and the player simply lost the turn.
  const swapA = applySwap(a), swapB = applySwap(b);
  const pmA = a.team[a.activeIdx], pmB = b.team[b.activeIdx];
  const atkA = a.action?.kind === "attack" ? ownedAttack(pmA, a.action.attackName) : null;
  const atkB = b.action?.kind === "attack" ? ownedAttack(pmB, b.action.attackName) : null;
  a.action = null; b.action = null;

  // First-turn initiative from a thrown spirit chain (from side A's POV: the
  // engine treats A as "player", B as "enemy"). Consumed after this turn.
  const initiator = pvp.initiatorId === a.id ? "player" : pvp.initiatorId === b.id ? "enemy" : null;
  pvp.initiatorId = null;

  // FGT-T1: the shared AI-judge resolver owns the turn (same path as PvE/SP). The
  // deterministic engine inside aiTurn is only a transient crash-net for a single
  // failed/hung call, so the duel always resolves instead of cancelling.
  const r = await aiTurn({ player: buildState(pmA), playerAttack: atkA, enemy: buildState(pmB), enemyAttack: atkB, initiator, rng: makeRng(randomSeed()), transcript: pvp.transcript });
  // Prepend swap announcements so the switch reads in the shared combat log (the same
  // narrative string is sent to both duelists, so reference players by name not "you").
  if (swapA || swapB) {
    const nameOf = (id) => world.sessions.get(id)?.profile?.name || "A rival";
    const notes = [];
    if (swapA) notes.push(`${nameOf(a.id)} switched to ${swapA.name || swapA.typeName}.`);
    if (swapB) notes.push(`${nameOf(b.id)} switched to ${swapB.name || swapB.typeName}.`);
    r.narrative = `${notes.join(" ")} ${r.narrative || ""}`.trim();
  }
  if (r && typeof r.narrative === "string") { (pvp.transcript ||= []).push(r.narrative); if (pvp.transcript.length > 12) pvp.transcript.shift(); }
  pvp.resolving = false;
  if (!world.pvps.has(pvp.pvpId)) return; // torn down meanwhile (disconnect)

  pmA.currentHealth = clamp0(r.player.currentHealth); pmA.currentEnergy = Math.max(0, r.player.currentEnergy); pmA.status = r.player.status;
  pmB.currentHealth = clamp0(r.enemy.currentHealth); pmB.currentEnergy = Math.max(0, r.enemy.currentEnergy); pmB.status = r.enemy.status;

  // v2 structured judge may END the duel directly (special action). Flag-safe: v1/engine
  // never set `special`. From A's POV "player"=A, "enemy"=B.
  const sp = r.special;
  if (sp && sp.end) {
    if (sp.flee) { endPvp(world, pvp, null, "fled", send); return; }
    const winner = sp.winner === "enemy" ? "b" : sp.winner === "player" ? "a" : null;
    endPvp(world, pvp, winner, winner ? "defeated" : "draw", send);
    return;
  }

  const aDown = pmA.currentHealth <= 0 && !advance(a);
  const bDown = pmB.currentHealth <= 0 && !advance(b);
  if (aDown || bDown) {
    const winner = aDown && bDown ? null : aDown ? "b" : "a"; // both down → draw
    endPvp(world, pvp, winner, winner ? "defeated" : "draw", send);
    return;
  }
  sendToSide(world, pvp, "a", "combatUpdate", { narrative: r.narrative }, send);
  sendToSide(world, pvp, "b", "combatUpdate", { narrative: r.narrative }, send);
}

// Apply a queued swap action: switch to the chosen LIVING bench monster (by id, robust
// to client/server team-order skew). Returns the new active monster (for the log), or
// null if it wasn't a valid swap (not a swap action / dead / unknown id / already active).
function applySwap(side) {
  if (side.action?.kind !== "swap") return null;
  const idx = side.team.findIndex((m) => m.id === side.action.monsterId && m.currentHealth > 0);
  if (idx < 0 || idx === side.activeIdx) return null;
  side.activeIdx = idx;
  return side.team[idx];
}

// Promote the next living monster after a faint; false if the side is wiped.
function advance(side) {
  const next = side.team.findIndex((m) => m.currentHealth > 0);
  if (next < 0) return false;
  side.activeIdx = next;
  return true;
}

// End the duel: transfer loot on a decisive result, release both players.
export function endPvp(world, pvp, winnerKey, reason, send) {
  if (!world.pvps.delete(pvp.pvpId)) return;
  const round = world.rounds.get(pvp.roundId);
  for (const k of ["a", "b"]) { const rp = round?.players.get(pvp[k].id); if (rp) rp.inPvp = null; }
  // Task 46: status effects are per-fight — clear both duelists' active-team status now
  // the duel is over (the AI judge only sets status DURING a fight).
  for (const k of ["a", "b"]) { for (const m of pvp[k].team || []) m.status = null; }

  if (winnerKey) {
    const win = world.sessions.get(pvp[winnerKey].id);
    const lose = world.sessions.get(pvp[other(winnerKey)].id);
    if (win && lose) {
      // Q11d: winner takes the loser's active team into their vault; loser refills
      // from their vault (or fresh starters) and stays in the round.
      const looted = lose.profile.activeMonsters || [];
      // NC-5: cap the winner's vault so repeated wins can't grow it unbounded
      // (DB/memory bloat). Excess loot overflows the (upgrade-aware) capacity and
      // is dropped — consistent with a normal capture failing when the vault is full.
      win.profile.vaultMonsters = (win.profile.vaultMonsters || [])
        .concat(looted)
        .slice(0, vaultCapacity(win.profile, GAME.VAULT_SIZE));
      lose.profile.vaultMonsters = lose.profile.vaultMonsters || [];
      lose.profile.activeMonsters = lose.profile.vaultMonsters.splice(0, GAME.TEAM_SIZE);
      if (lose.profile.activeMonsters.length === 0) lose.profile.activeMonsters = rollStarters();
      bumpStat(win.profile, "pvpWins"); // P8-T1
      saveProfile(win.profile); saveProfile(lose.profile);
    }
    // Kill feed (P8-T5): announce the defeat to everyone still in the round.
    const feed = { t: "killfeed", killer: win?.profile?.name || "?", victim: lose?.profile?.name || "?", cause: "pvp", at: Date.now() };
    for (const pid of round ? round.players.keys() : []) { const sess = world.sessions.get(pid); if (sess && sess.ws) send(sess.ws, feed); }
    sendEnd(world, pvp, winnerKey, "won", send);
    sendEnd(world, pvp, other(winnerKey), "lost", send);
  } else {
    // A no-winner end: a flee (no team loss) or a DRAW. A draw is a simultaneous double-KO
    // — both active teams are wiped — so mirror the decisive loser path / the Q10 death
    // stake: each side whose active team is fully fainted loses it and refills from its own
    // vault (or fresh starters). Without this both players are stranded with an all-fainted
    // team that can't start any fight yet still extracts for a free heal, dodging the death
    // penalty a normal KO applies. No loot moves — neither player won.
    if (reason === "draw") {
      for (const k of ["a", "b"]) {
        const s = world.sessions.get(pvp[k].id);
        if (!s) continue;
        const alive = (s.profile.activeMonsters || []).some((m) => m.currentHealth > 0);
        if (!alive) { loseRunTeam(s.profile, rollStarters); saveProfile(s.profile); }
      }
    }
    sendEnd(world, pvp, "a", reason === "draw" ? "draw" : "fled", send);
    sendEnd(world, pvp, "b", reason === "draw" ? "draw" : "fled", send);
  }
}

function sendEnd(world, pvp, key, outcome, send) {
  const s = world.sessions.get(pvp[key].id);
  if (s) send(s.ws, { t: "combatEnd", combatId: pvp.pvpId, pvp: true, outcome, team: s.profile.activeMonsters });
}

// Tear down a duel a player is in (disconnect / round end) — no-contest.
export function endPvpFor(world, playerId, send) {
  for (const pvp of world.pvps.values()) {
    if (pvp.a.id === playerId || pvp.b.id === playerId) { endPvp(world, pvp, null, "fled", send); return; }
  }
}
