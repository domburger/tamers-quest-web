// OpenAI-backed combat turn resolution (P3-T2) — the game's "AI-resolved combat"
// selling point. The deterministic engine (engine/combat.js) is the automatic
// fallback, so combat always works even with no key / API errors. Provider:
// OpenAI gpt-4o ("use openai for now"); the key comes from OPENAI_API_KEY.

import { getPrompt } from "./prompts.js";
import { getAiConfig } from "./aiconfig.js";
import { clampText } from "./text.js";
import { cleanAttackName } from "../src/engine/gamedata.js";
import { normalizeStatus } from "../src/engine/combat.js"; // FGT-T2: map AI statuses by the same rule as the engine
import { applyJudgeEdits, resolveSpecial } from "./judge.js"; // structured v2 judge (opt-in)
import { openaiChatJson } from "./openai.js"; // model-compatible chat call (max_completion_tokens + sampling retry)

// CB-3: hard ceiling on a single judge call before we abort and fall back to the engine.
const AI_TIMEOUT_MS = 10000;

export function aiEnabled() {
  return !!process.env.OPENAI_API_KEY;
}

// LS-9: AI/player-controlled free text (monster names, elements, statuses, attack
// names) flows into the judge prompt. Sanitize before interpolation — replace any
// control char (incl. newlines, which would let a crafted name break out of its
// line) with a space, collapse runs, and cap length. Defense at the source: it
// holds regardless of whether the model honors a "treat names as data" note.
// (Uses charCode mapping so there are no literal control chars in this source.)
// Folds C0 (<0x20, incl. \n\r\t), DEL (0x7f) AND the C1 range (0x80-0x9f) — the
// latter includes NEL (U+0085), which some model tokenizers treat as a line break
// and which JS \s does NOT match (so the collapse below wouldn't catch it). The
// \s collapse still handles the Unicode line/para separators U+2028/U+2029.
export function sanitizePromptText(s, max = 48) {
  const out = String(s ?? "")
    .split("")
    .map((c) => {
      const cc = c.charCodeAt(0);
      return cc < 0x20 || (cc >= 0x7f && cc <= 0x9f) ? " " : c;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return out.slice(0, max);
}

export function describe(label, m, attack) {
  const S = sanitizePromptText;
  const a = attack
    ? `uses "${S(cleanAttackName(attack.name))}" (dmg ${attack.damage}, acc ${attack.accuracy}, energy ${attack.energyCost}, crit ${attack.critChance}/${attack.critMultiplier}${attack.inflictedStatus ? `, may inflict ${S(attack.inflictedStatus, 24)} @${attack.statusChance}` : ""})`
    : `has no usable move and skips`;
  return `${label}: ${S(m.name)} HP ${m.currentHealth}/${m.maxHealth}, energy ${m.currentEnergy}/${m.maxEnergy}, STR ${m.strength} DEF ${m.defense} SPD ${m.speed} POW ${m.power} LUCK ${m.luck}${m.status ? `, status ${S(m.status, 24)}` : ""} — ${a}`;
}

// FGT-T7: end an over-long narrative on a clean boundary instead of chopping a word
// in half. Delegates to the shared clampText helper (also used by the monster-gen
// lore/effects path). Kept as a named export for the combat call site + tests.
export function trimNarrative(s, max = 240) {
  // Untrusted model output (the v1 `narrative` / v2 `display` line) flows to the combat-log UI
  // and the fight transcript. Fold control chars (newlines/tabs/DEL/C1/line-separators) to spaces
  // and collapse runs via sanitizePromptText — the SAME defense used for prompt text + the judge's
  // `reason` — BEFORE the clean length-clamp, so a stray newline cannot break the combat-log line
  // or split a log entry. (sanitizePromptText also caps, but the 4000 here is a no-op; clampText
  // then does the clean word/sentence-boundary cut + ellipsis.)
  return clampText(sanitizePromptText(s, 4000), max);
}

// FGT-T2: clamp + shape the model's output into the engine's result format. Every
// field is untrusted model output, so HP/energy are clamped to [0,max] and statuses
// are validated below. (The turn judge only resolves turns and never returns `caught` —
// capture is a separate judge, aiResolveCatch, so a turn can't fabricate a catch.)
export function mapAiResult(raw, player, enemy, opts = {}) {
  const clamp = (v, max, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(max, Math.round(n)));
  };
  // Task 78 — per-turn damage cap: a single turn can't drain more than `maxTurnDamageFrac`
  // of a monster's MAX HP, so the AI can't swing a full-HP monster to 0 in one shot. Heals
  // and small hits pass through; a monster already below the cap can still be KO'd. 1 = off.
  const frac = Number.isFinite(opts.maxTurnDamageFrac) ? Math.max(0.1, Math.min(1, opts.maxTurnDamageFrac)) : 1;
  const capDamage = (newHp, prevHp, maxHp) => {
    if (!(newHp < prevHp) || frac >= 1) return newHp; // heal / no-loss / cap off
    return Math.max(newHp, Math.max(0, prevHp - Math.ceil(maxHp * frac)));
  };
  // Status is untrusted: accept only a non-empty STRING (an object/array/number → no
  // status, not "[object Object]"), normalize canonical synonyms by the SAME engine
  // rule so AI-applied "stunned"/"frozen"/… actually get mechanics, and cap length so
  // a runaway label can't bloat state/render. Unknown free-text is kept (Q7).
  const cleanStatus = (s) => {
    if (typeof s !== "string") return null;
    const t = s.trim();
    if (!t) return null;
    return normalizeStatus(t).slice(0, 24);
  };
  return {
    player: {
      currentHealth: capDamage(clamp(raw?.playerMonster?.currentHealth, player.maxHealth, player.currentHealth), player.currentHealth, player.maxHealth),
      currentEnergy: clamp(raw?.playerMonster?.currentEnergy, player.maxEnergy, player.currentEnergy),
      status: cleanStatus(raw?.playerMonster?.status),
    },
    enemy: {
      currentHealth: capDamage(clamp(raw?.enemyMonster?.currentHealth, enemy.maxHealth, enemy.currentHealth), enemy.currentHealth, enemy.maxHealth),
      currentEnergy: clamp(raw?.enemyMonster?.currentEnergy, enemy.maxEnergy, enemy.currentEnergy),
      status: cleanStatus(raw?.enemyMonster?.status),
    },
    // Narrative is untrusted model output: only accept a non-empty STRING, else use
    // the fallback. (Was `(raw.narrative || fallback).toString()` — a model that
    // returned narrative:[] kept the truthy [] and `[].toString()` is "" → an EMPTY
    // combat line; an object became "[object Object]". Type-checking avoids both.)
    narrative: trimNarrative(typeof raw?.narrative === "string" && raw.narrative.trim()
      ? raw.narrative : "The monsters clash!"),
  };
}

// Resolve one turn via OpenAI. Throws on any failure (caller falls back to the
// deterministic engine).
// One OpenAI chat call returning the parsed JSON content. CB-3: bound by a timeout so a hung
// request can't freeze the caller's `resolving` flag; on abort/!ok it throws and both callers
// (combat.js / pvp.js) fall back to the deterministic engine. Shared by the v1 + v2 judges.
function chatJson(system, user) {
  return openaiChatJson({
    model: getAiConfig("model"),
    system, user,
    temperature: getAiConfig("combatTemperature"),
    topP: getAiConfig("topP"),
    maxTokens: getAiConfig("maxTokens"),
    timeoutMs: AI_TIMEOUT_MS,
  });
}

// ─── Spirit-chain CAPTURE judge (catchJudgeSystem) ───
// Catching is AI-evaluated exactly like a combat turn: each spirit chain carries a `catchPrompt`
// describing its binding power, and the judge weighs that against the wild monster's weakened
// state to decide. There are NO rarity gates and NO capture formula — the judge owns the verdict.
// Output is intentionally tiny: caught (1/0) + a short line for the fight screen. Throws on any
// failure (the caller fails the throw safely rather than reintroducing a deterministic formula).
function describeCatchTarget(m) {
  const S = sanitizePromptText;
  const pct = m.maxHealth > 0 ? Math.round((m.currentHealth / m.maxHealth) * 100) : 0;
  return `${S(m.name)} — HP ${m.currentHealth}/${m.maxHealth} (${pct}%), energy ${m.currentEnergy}/${m.maxEnergy}${m.status ? `, status ${S(m.status, 24)}` : ", no status"}`;
}

export async function aiResolveCatch({ chain, enemy }) {
  const S = sanitizePromptText;
  const chainName = S(chain?.name || "spirit chain", 40);
  // The chain's authored catchPrompt is the per-chain "binding power" input; longer than the usual
  // sanitize cap (it's a full sentence), so allow more, but still strip control chars / collapse runs.
  const power = S(chain?.catchPrompt || "An ordinary spirit chain of average binding strength.", 400);
  const user =
    `SPIRIT CHAIN: ${chainName}\n` +
    `BINDING POWER: ${power}\n\n` +
    `WILD MONSTER: ${describeCatchTarget(enemy)}\n\n` +
    `Decide whether this throw captures the monster.`;
  const raw = await chatJson(getPrompt("catchJudgeSystem"), user);
  // caught is untrusted: accept 1 / "1" / true → caught, anything else → broke free.
  const caught = raw && (raw.caught === 1 || raw.caught === "1" || raw.caught === true) ? 1 : 0;
  const text = trimNarrative(
    typeof raw?.text === "string" && raw.text.trim() ? raw.text : (caught ? `${enemy.name} was caught!` : `${enemy.name} broke free!`),
    120,
  );
  return { caught, text };
}

export async function aiResolveTurn(args) {
  // Opt-in structured judge (admin combatJudgeV2). Default OFF → unchanged v1 path below.
  // An ITEM action ALWAYS uses the v2 descriptive judge (items carry no numeric fields, so the
  // v1 absolute judge can't resolve them) regardless of the flag.
  if (getAiConfig("combatJudgeV2") || args.itemAction) return resolveTurnV2(args);
  const { player, playerAttack, enemy, enemyAttack, initiator = null } = args;
  // Initiative (e.g. an ambush, or landing a spirit chain) forces who acts first.
  // The deterministic engine already honors `initiator`; convey it to the model too
  // so AI-resolved turns match — otherwise the mechanic silently no-ops in prod.
  const initiativeLine =
    initiator === "player" ? "\nPLAYER's monster acts first this turn (initiative)." :
    initiator === "enemy" ? "\nENEMY's monster acts first this turn (initiative)." : "";
  const userPrompt =
    `${describe("Player", player, playerAttack)}\n` +
    `${describe("Enemy", enemy, enemyAttack)}${initiativeLine}\n\nResolve this turn.`;
  const raw = await chatJson(getPrompt("combatSystem"), userPrompt);
  return mapAiResult(raw, player, enemy, { maxTurnDamageFrac: getAiConfig("combatMaxTurnDamageFrac") });
}

// A FULL combatant description for the v2 judge — includes passive effect + the move's text
// description so passives & move semantics are considered (the v1 `describe` is stat-only).
function describeFull(label, m, attack) {
  const S = sanitizePromptText;
  const a = attack
    ? `action "${S(cleanAttackName(attack.name))}"${attack.description ? ` — ${S(attack.description, 200)}` : ""} (dmg ${attack.damage}, acc ${attack.accuracy}, energy ${attack.energyCost})`
    : "no action (waits)";
  return `${label}: ${S(m.name)} HP ${m.currentHealth}/${m.maxHealth}, energy ${m.currentEnergy}/${m.maxEnergy}, STR ${m.strength} DEF ${m.defense} SPD ${m.speed} POW ${m.power} LUCK ${m.luck}${m.status ? `, status ${S(m.status, 24)}` : ""}${m.passiveEffect ? `, passive: ${S(m.passiveEffect, 200)}` : ""} — ${a}`;
}

// v2 structured judge: full descriptions + transcript in, per-field DELTAS/rewrites + a display
// line + special-actions out (server/judge.js applies them). Returns the SAME shape as the v1
// resolver (+ a `special` field) so combat.js / pvp.js callers are unchanged.
export async function resolveTurnV2({ player, playerAttack, enemy, enemyAttack, initiator = null, transcript = null, itemAction = null }) {
  const init = initiator === "player" ? "\nPLAYER's monster acts first (initiative)." : initiator === "enemy" ? "\nENEMY's monster acts first (initiative)." : "";
  const tlines = Array.isArray(transcript) && transcript.length
    ? `\n\nTranscript so far:\n${transcript.slice(-8).map((t, i) => `${i + 1}. ${sanitizePromptText(String(t), 160)}`).join("\n")}` : "";
  // An ITEM use replaces the player's monster attack this round (the spec: an item is judged
  // like an attack). Describe the player's monster WITHOUT an attack, then state the item used.
  const S = sanitizePromptText;
  const playerLine = itemAction
    ? `${describeFull("PLAYER", player, null)}\nThe PLAYER USES AN ITEM this round (instead of attacking): "${S(itemAction.name, 40)}" — ${S(itemAction.description, 200)}. Resolve the item's effect on whichever monster it targets.`
    : describeFull("PLAYER", player, playerAttack);
  const user = `${playerLine}\n${describeFull("ENEMY", enemy, enemyAttack)}${init}${tlines}\n\nResolve this round.`;
  const raw = await chatJson(getPrompt("combatJudgeV2System"), user);
  // Task 78 — the per-turn damage cap must apply on THIS (default) path too, not just v1's
  // mapAiResult. Read the admin knob once and pass it to both edit-appliers.
  const cap = { maxTurnDamageFrac: getAiConfig("combatMaxTurnDamageFrac") };
  const np = applyJudgeEdits(player, raw && raw.playerEdits, cap);
  const ne = applyJudgeEdits(enemy, raw && raw.enemyEdits, cap);
  return {
    player: { currentHealth: np.currentHealth, currentEnergy: np.currentEnergy, status: np.status ?? null },
    enemy: { currentHealth: ne.currentHealth, currentEnergy: ne.currentEnergy, status: ne.status ?? null },
    narrative: trimNarrative(typeof raw?.display === "string" && raw.display.trim() ? raw.display : "The monsters clash!"),
    special: resolveSpecial(raw && raw.special),
  };
}
