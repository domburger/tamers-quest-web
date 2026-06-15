// Structured Fight-Judgement judge (plan: "Implement combat as per description below").
//
// A richer combat-judge contract than the v1 absolute-value resolver (ai.js mapAiResult):
//   INPUT  - the action being executed + FULL descriptions of both monsters (incl. passive/
//            active effects) + a running fight TRANSCRIPT, so passives and history are considered.
//   OUTPUT - per-field EDITS to each monster: integer fields as DELTAS (added then clamped),
//            string fields as full REWRITES; a short DISPLAY string (was the action a hit?);
//            and a SPECIAL-ACTIONS section (end the battle / insta-win / flee / arbitrary trigger).
//
// This module is the pure, framework-agnostic core (schema + appliers), unit-tested without a
// live API. It is opt-in behind the admin flag `combatJudgeV2` (default off) so the live default
// judge is unchanged until this is validated. ai.js wires it in when the flag is set.

import { normalizeStatus } from "../src/engine/combat.js"; // same status canonicalization as v1

// Integer combat fields the judge may nudge by a DELTA. Value = the matching max-field to clamp
// against (null = clamp to >= 0 only). currentHealth/energy are the common ones; the stats allow
// transient buffs/debuffs ("any field", per the spec) but stay clamped so they cannot go negative.
const INT_FIELDS = { currentHealth: "maxHealth", currentEnergy: "maxEnergy", strength: null, defense: null, speed: null, power: null, luck: null };
// String fields the judge may REWRITE. status is the live one; kept to a whitelist so a rewrite
// cannot clobber identity fields (e.g. name) mid-fight.
const STR_FIELDS = new Set(["status"]);

/**
 * Apply the judge's per-field edits to a combat monster snapshot. Integer fields are DELTAS
 * (added to the current value, then clamped to [0, max]); whitelisted string fields are full
 * rewrites (status is canonicalized + length-capped). Unknown fields are ignored (defensive -
 * the edits are untrusted model output). Pure: returns a new object, never mutates `mon`.
 * @param {object} mon  combat monster ({currentHealth,maxHealth,currentEnergy,maxEnergy,...,status})
 * @param {object} edits  { field: delta-or-rewrite }
 * @param {object} [opts]  { maxTurnDamageFrac } — per-turn HP-loss cap (Task 78); 1 / unset = off.
 */
export function applyJudgeEdits(mon, edits = {}, opts = {}) {
  const out = { ...mon };
  if (!edits || typeof edits !== "object") return out;
  for (const [k, v] of Object.entries(edits)) {
    if (k in INT_FIELDS && Number.isFinite(v)) {
      const maxKey = INT_FIELDS[k];
      const max = maxKey && Number.isFinite(mon[maxKey]) ? mon[maxKey] : Number.MAX_SAFE_INTEGER;
      out[k] = Math.max(0, Math.min(max, Math.round((Number(mon[k]) || 0) + v)));
    } else if (STR_FIELDS.has(k)) {
      out[k] = (v == null || v === "") ? null : (normalizeStatus(String(v)).slice(0, 24) || null);
    }
    // any other field: ignored
  }
  // Task 78 — per-turn damage cap (parity with the v1 ai.js mapAiResult path, which the DEFAULT
  // v2 judge had silently dropped): a single turn can't drain more than `maxTurnDamageFrac` of MAX
  // HP, so the judge can't swing a near-full monster to 0 in one shot. Applies ONLY to a net HP
  // LOSS this turn; heals and a monster already below the cap are untouched. 1 / unset = off.
  const frac = Number.isFinite(opts.maxTurnDamageFrac) ? Math.max(0.1, Math.min(1, opts.maxTurnDamageFrac)) : 1;
  if (frac < 1 && Number.isFinite(mon.currentHealth) && Number.isFinite(mon.maxHealth) && out.currentHealth < mon.currentHealth) {
    out.currentHealth = Math.max(out.currentHealth, Math.max(0, mon.currentHealth - Math.ceil(mon.maxHealth * frac)));
  }
  return out;
}

// Strip control chars (newlines included) and cap length, so an untrusted reason string cannot
// inject into logs/UI. ASCII-printable kept as-is.
function cleanReason(s) {
  let out = "";
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    out += (c >= 0x20 && c !== 0x7f) ? ch : " ";
  }
  return out.slice(0, 80);
}

/**
 * Normalize the judge's optional "special actions" into a safe, bounded result the combat loop
 * can act on: whether the battle ends, who won, whether it was a flee, and a short reason. Pure.
 * @param {object} special  the model's special-actions object (untrusted)
 * @returns {{end:boolean, winner:("player"|"enemy"|null), flee:boolean, reason:string}}
 */
export function resolveSpecial(special = {}) {
  const out = { end: false, winner: null, flee: false, reason: "" };
  if (!special || typeof special !== "object") return out;
  const w = typeof special.winner === "string" ? special.winner.trim().toLowerCase() : "";
  if (special.endBattle === true || special.end === true) out.end = true;
  if (w === "player" || w === "enemy") { out.end = true; out.winner = w; }
  if (special.instaWin === true) { out.end = true; out.winner = out.winner || "player"; }
  if (special.flee === true) { out.end = true; out.flee = true; }
  if (typeof special.reason === "string") out.reason = cleanReason(special.reason);
  return out;
}

// Structured-output contract for the judge (documents the shape; usable with LangChain
// withStructuredOutput or as a JSON-schema hint in the prompt). Edits are sparse - the model
// only includes the fields it changes (token budget + the "only say what changes" spec rule).
export const JUDGE_V2_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    playerEdits: { type: "object", additionalProperties: true, description: "ONLY the player monster fields that change. Integers = DELTA (e.g. currentHealth: -40); status = full string (or null to clear)." },
    enemyEdits: { type: "object", additionalProperties: true, description: "ONLY the enemy monster fields that change (same delta/rewrite rules)." },
    display: { type: "string", description: "A very short line shown in-game - mainly whether the action hit/missed and the gist of what happened." },
    special: { type: "object", additionalProperties: true, description: "Optional special actions: endBattle(bool), winner('player'|'enemy'), instaWin(bool), flee(bool), reason(string). Omit on a normal turn." },
  },
  required: ["display"],
};
