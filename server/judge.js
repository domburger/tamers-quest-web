import { normalizeStatus } from "../src/engine/combat.js";

// Judge sends DELTAS for these; value = max field to clamp to (null = >= 0).
const INT_FIELDS = { currentHealth: "maxHealth", currentEnergy: "maxEnergy", strength: null, defense: null, speed: null, power: null, luck: null };
// Allowlist: judge output is untrusted; never let it rewrite identity fields.
const STR_FIELDS = new Set(["status"]);

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
  }
  const frac = Number.isFinite(opts.maxTurnDamageFrac) ? Math.max(0.1, Math.min(1, opts.maxTurnDamageFrac)) : 1;
  if (frac < 1 && Number.isFinite(mon.currentHealth) && Number.isFinite(mon.maxHealth) && out.currentHealth < mon.currentHealth) {
    out.currentHealth = Math.max(out.currentHealth, Math.max(0, mon.currentHealth - Math.ceil(mon.maxHealth * frac)));
  }
  return out;
}

function cleanReason(s) {
  let out = "";
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    out += (c >= 0x20 && c !== 0x7f) ? ch : " ";
  }
  return out.slice(0, 80);
}

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

