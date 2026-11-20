import { aiEnabled } from "./ai.js";
import { aiTurn, buildState, attacksFor, monSnap, ownedAttack } from "./combat.js";
import { saveProfile, rollStarters, bumpStat, secureId } from "./store.js";
import { makeRng, randomSeed, hashString } from "../src/engine/rng.js";
import { GAME } from "../src/engine/schemas.js";
import { vaultCapacity } from "../src/engine/upgrades.js";
import { loseRunTeam } from "../src/engine/inventory.js";

const other = (k) => (k === "a" ? "b" : "a");
const clamp0 = (n) => Math.max(0, Math.round(n));

export function maybeStartPvp(world, round, send) {
  const r2 = (world.cfg.pvpRadius || 40) ** 2;
  const free = [...round.players.entries()].filter(([, rp]) => !rp.inCombat && !rp.inPvp);
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) {
      const [idA, rpA] = free[i], [idB, rpB] = free[j];
      if (rpA.inPvp || rpB.inPvp) continue;
      const dx = rpA.x - rpB.x, dy = rpA.y - rpB.y;
      if (dx * dx + dy * dy <= r2) {
        const first = makeRng(hashString(`${round.roundId}:${idA}:${idB}:${world.nextPvp}`)).next() < 0.5 ? idA : idB;
        startPvp(world, round, idA, idB, send, first);
      }
    }
  }
}

export function startPvp(world, round, idA, idB, send, initiatorId = null) {
  const sA = world.sessions.get(idA), sB = world.sessions.get(idB);
  if (!sA || !sB) return;
  if (!aiEnabled()) return;
  const teamA = sA.profile.activeMonsters || [], teamB = sB.profile.activeMonsters || [];
  const ai = teamA.findIndex((m) => m.currentHealth > 0);
  const bi = teamB.findIndex((m) => m.currentHealth > 0);
  if (ai < 0 || bi < 0) return;
  const pvpId = secureId("v");
  world.nextPvp++;
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
    team: self.team.map((m) => monSnap(m)),
    activeIdx: self.activeIdx,
    ...extra,
  });
}

export async function handlePvpAction(world, pvp, playerId, action, send) {
  if (pvp.resolving) return;
  const key = pvp.a.id === playerId ? "a" : pvp.b.id === playerId ? "b" : null;
  if (!key) return;
  const side = pvp[key];
  if (side.action) return;
  if (action.kind === "catch" || action.kind === "item") return;
  if (action.kind === "flee") { endPvp(world, pvp, null, "fled", send); return; }
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
  const swapA = applySwap(a), swapB = applySwap(b);
  const pmA = a.team[a.activeIdx], pmB = b.team[b.activeIdx];
  const atkA = a.action?.kind === "attack" ? ownedAttack(pmA, a.action.attackName) : null;
  const atkB = b.action?.kind === "attack" ? ownedAttack(pmB, b.action.attackName) : null;
  a.action = null; b.action = null;

  const initiator = pvp.initiatorId === a.id ? "player" : pvp.initiatorId === b.id ? "enemy" : null;
  pvp.initiatorId = null;

  const r = await aiTurn({ player: buildState(pmA), playerAttack: atkA, enemy: buildState(pmB), enemyAttack: atkB, initiator, rng: makeRng(randomSeed()), transcript: pvp.transcript });
  if (swapA || swapB) {
    const nameOf = (id) => world.sessions.get(id)?.profile?.name || "A rival";
    const notes = [];
    if (swapA) notes.push(`${nameOf(a.id)} switched to ${swapA.name || swapA.typeName}.`);
    if (swapB) notes.push(`${nameOf(b.id)} switched to ${swapB.name || swapB.typeName}.`);
    r.narrative = `${notes.join(" ")} ${r.narrative || ""}`.trim();
  }
  if (r && typeof r.narrative === "string") { (pvp.transcript ||= []).push(r.narrative); if (pvp.transcript.length > 12) pvp.transcript.shift(); }
  pvp.resolving = false;
  if (!world.pvps.has(pvp.pvpId)) return;

  pmA.currentHealth = clamp0(r.player.currentHealth); pmA.currentEnergy = Math.max(0, r.player.currentEnergy); pmA.status = r.player.status;
  pmB.currentHealth = clamp0(r.enemy.currentHealth); pmB.currentEnergy = Math.max(0, r.enemy.currentEnergy); pmB.status = r.enemy.status;

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
    const winner = aDown && bDown ? null : aDown ? "b" : "a";
    endPvp(world, pvp, winner, winner ? "defeated" : "draw", send);
    return;
  }
  sendToSide(world, pvp, "a", "combatUpdate", { narrative: r.narrative }, send);
  sendToSide(world, pvp, "b", "combatUpdate", { narrative: r.narrative }, send);
}

function applySwap(side) {
  if (side.action?.kind !== "swap") return null;
  const idx = side.team.findIndex((m) => m.id === side.action.monsterId && m.currentHealth > 0);
  if (idx < 0 || idx === side.activeIdx) return null;
  side.activeIdx = idx;
  return side.team[idx];
}

function advance(side) {
  const next = side.team.findIndex((m) => m.currentHealth > 0);
  if (next < 0) return false;
  side.activeIdx = next;
  return true;
}

export function endPvp(world, pvp, winnerKey, reason, send) {
  if (!world.pvps.delete(pvp.pvpId)) return;
  const round = world.rounds.get(pvp.roundId);
  for (const k of ["a", "b"]) { const rp = round?.players.get(pvp[k].id); if (rp) rp.inPvp = null; }
  for (const k of ["a", "b"]) { for (const m of pvp[k].team || []) m.status = null; }

  if (winnerKey) {
    const win = world.sessions.get(pvp[winnerKey].id);
    const lose = world.sessions.get(pvp[other(winnerKey)].id);
    if (win && lose) {
      const looted = lose.profile.activeMonsters || [];
      win.profile.vaultMonsters = (win.profile.vaultMonsters || [])
        .concat(looted)
        .slice(0, vaultCapacity(win.profile, GAME.VAULT_SIZE));
      lose.profile.vaultMonsters = lose.profile.vaultMonsters || [];
      lose.profile.activeMonsters = lose.profile.vaultMonsters.splice(0, GAME.TEAM_SIZE);
      if (lose.profile.activeMonsters.length === 0) lose.profile.activeMonsters = rollStarters();
      bumpStat(win.profile, "pvpWins");
      saveProfile(win.profile); saveProfile(lose.profile);
    }
    const feed = { t: "killfeed", killer: win?.profile?.name || "?", victim: lose?.profile?.name || "?", cause: "pvp", at: Date.now() };
    for (const pid of round ? round.players.keys() : []) { const sess = world.sessions.get(pid); if (sess && sess.ws) send(sess.ws, feed); }
    sendEnd(world, pvp, winnerKey, "won", send);
    sendEnd(world, pvp, other(winnerKey), "lost", send);
  } else {
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

export function endPvpFor(world, playerId, send) {
  for (const pvp of world.pvps.values()) {
    if (pvp.a.id === playerId || pvp.b.id === playerId) { endPvp(world, pvp, null, "fled", send); return; }
  }
}
