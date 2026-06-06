// FFA PvP (P3-T5). Decisions (Q11): interactive turns (both pick a move, resolve
// when both submitted), AI-resolved per turn with NO deterministic fallback,
// instant on collision, and the winner loots the loser's active team. Gated by
// PVP_ENABLED (default off) — wired from world.js. Reuses the PvE message shapes
// (combatStart/Update/End) with a `pvp:true` flag so the client can adapt.

import { aiResolveTurn } from "./ai.js";
import { buildState, attacksFor, monSnap, ownedAttack } from "./combat.js";
import { saveProfile, rollStarters } from "./store.js";
import { GAME } from "../src/engine/schemas.js";

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
      if (dx * dx + dy * dy <= r2) startPvp(world, round, idA, idB, send);
    }
  }
}

function startPvp(world, round, idA, idB, send) {
  const sA = world.sessions.get(idA), sB = world.sessions.get(idB);
  if (!sA || !sB) return;
  const teamA = sA.profile.activeMonsters || [], teamB = sB.profile.activeMonsters || [];
  const ai = teamA.findIndex((m) => m.currentHealth > 0);
  const bi = teamB.findIndex((m) => m.currentHealth > 0);
  if (ai < 0 || bi < 0) return; // someone has no usable monster — skip
  const pvpId = "v" + world.nextPvp++;
  const pvp = {
    pvpId, roundId: round.roundId,
    a: { id: idA, team: teamA, activeIdx: ai, action: null },
    b: { id: idB, team: teamB, activeIdx: bi, action: null },
    resolving: false,
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
  const pmA = a.team[a.activeIdx], pmB = b.team[b.activeIdx];
  const atkA = a.action?.kind === "attack" ? ownedAttack(pmA, a.action.attackName) : null;
  const atkB = b.action?.kind === "attack" ? ownedAttack(pmB, b.action.attackName) : null;
  a.action = null; b.action = null;

  // AI per turn, NO deterministic fallback (Q11b): retry once, else cancel the duel.
  let r = null;
  for (let attempt = 0; attempt < 2 && !r; attempt++) {
    try { r = await aiResolveTurn({ player: buildState(pmA), playerAttack: atkA, enemy: buildState(pmB), enemyAttack: atkB }); }
    catch (e) { console.error("[pvp] AI turn failed:", e.message); }
  }
  pvp.resolving = false;
  if (!world.pvps.has(pvp.pvpId)) return; // torn down meanwhile (disconnect)
  if (!r) { endPvp(world, pvp, null, "ai_error", send); return; }

  pmA.currentHealth = clamp0(r.player.currentHealth); pmA.currentEnergy = Math.max(0, r.player.currentEnergy); pmA.status = r.player.status;
  pmB.currentHealth = clamp0(r.enemy.currentHealth); pmB.currentEnergy = Math.max(0, r.enemy.currentEnergy); pmB.status = r.enemy.status;

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

  if (winnerKey) {
    const win = world.sessions.get(pvp[winnerKey].id);
    const lose = world.sessions.get(pvp[other(winnerKey)].id);
    if (win && lose) {
      // Q11d: winner takes the loser's active team into their vault; loser refills
      // from their vault (or fresh starters) and stays in the round.
      const looted = lose.profile.activeMonsters || [];
      win.profile.vaultMonsters = (win.profile.vaultMonsters || []).concat(looted);
      lose.profile.vaultMonsters = lose.profile.vaultMonsters || [];
      lose.profile.activeMonsters = lose.profile.vaultMonsters.splice(0, GAME.TEAM_SIZE);
      if (lose.profile.activeMonsters.length === 0) lose.profile.activeMonsters = rollStarters();
      saveProfile(win.profile); saveProfile(lose.profile);
    }
    sendEnd(world, pvp, winnerKey, "won", send);
    sendEnd(world, pvp, other(winnerKey), "lost", send);
  } else {
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
