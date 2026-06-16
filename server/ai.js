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
import { recordJudgeTrace, clip } from "./genTrace.js"; // TQ-491: record each fight-judge call for the admin trace panel

// CB-3: hard ceiling on a single judge call before we abort and fall back to the engine.
const AI_TIMEOUT_MS = 10000;

// TQ-491: fill an admin-editable user-prompt template by substituting {placeholders}. split/join (not
// String.replace) so EVERY occurrence is replaced and `$`/special chars in the dynamic values (monster
// names, descriptions) are inserted literally. A placeholder the operator removed is simply not filled —
// that data is omitted (prompts are LITERAL, matching the gen pipeline convention, TQ-431).
function fillPrompt(tpl, vars) {
  let out = String(tpl);
  for (const k of Object.keys(vars)) out = out.split(`{${k}}`).join(vars[k] == null ? "" : String(vars[k]));
  return out;
}

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
// TQ-491: `stage` labels the call in the admin Fight-judge trace ("combat:v1" / "combat:v2" /
// "capture"). The exact system+user prompt sent and the raw output (or error) are recorded so an
// operator can review what the judge actually saw/returned — parity with the gen "Generation trace".
async function chatJson(system, user, stage = "combat") {
  const model = getAiConfig("model"), startedAt = Date.now();
  try {
    const out = await openaiChatJson({
      model,
      system, user,
      temperature: getAiConfig("combatTemperature"),
      topP: getAiConfig("topP"),
      maxTokens: getAiConfig("maxTokens"),
      timeoutMs: AI_TIMEOUT_MS,
    });
    recordJudgeTrace({ stage, model, ok: true, ms: Date.now() - startedAt, system: clip(system), user: clip(user), output: clip(out, 8000) });
    return out;
  } catch (e) {
    recordJudgeTrace({ stage, model, ok: false, ms: Date.now() - startedAt, system: clip(system), user: clip(user), error: clip(String((e && e.message) || e), 1000) });
    throw e;
  }
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
  // TQ-491: the user prompt is the admin-editable catchUser template (dynamic fight state filled in).
  const user = fillPrompt(getPrompt("catchUser"), { chain: chainName, power, target: describeCatchTarget(enemy) });
  const raw = await chatJson(getPrompt("catchJudgeSystem"), user, "capture");
  // caught is untrusted: accept 1 / "1" / true → caught, anything else → broke free.
  const caught = raw && (raw.caught === 1 || raw.caught === "1" || raw.caught === true) ? 1 : 0;
  const text = trimNarrative(
    typeof raw?.text === "string" && raw.text.trim() ? raw.text : (caught ? `${enemy.name} was caught!` : `${enemy.name} broke free!`),
    120,
  );
  return { caught, text };
}

// TQ-457: make WHO ATTACKS WHOM explicit in the judge prompt. With hard-sequential PvE each turn carries
// exactly ONE attack (player-only or enemy-only), so the judge resolves only that side's action and the
// other monster merely defends. Both-attacks / no-attack forms kept for the legacy/simultaneous path.
function attackDirective({ player, playerAttack, enemy, enemyAttack, initiator = null, itemAction = null }) {
  const S = sanitizePromptText;
  const pn = player && player.name ? S(player.name, 40) : "the player's monster";
  const en = enemy && enemy.name ? S(enemy.name, 40) : "the wild monster";
  const playerActing = !!(playerAttack || itemAction);
  const enemyActing = !!enemyAttack;
  if (playerActing && !enemyActing) return `\nWHO ATTACKS WHOM: the PLAYER's monster (${pn}) acts against the ENEMY's monster (${en}). Resolve ONLY the player's action this turn; the enemy's monster only DEFENDS (it does NOT counter-attack).`;
  if (enemyActing && !playerActing) return `\nWHO ATTACKS WHOM: the ENEMY's monster (${en}) attacks the PLAYER's monster (${pn}). Resolve ONLY the enemy's attack this turn; the player's monster only DEFENDS (it does NOT counter-attack).`;
  if (playerActing && enemyActing) return initiator === "enemy" ? `\nBoth monsters act; the ENEMY's monster (${en}) acts first (initiative).` : initiator === "player" ? `\nBoth monsters act; the PLAYER's monster (${pn}) acts first (initiative).` : `\nBoth monsters act this turn.`;
  return `\nNeither monster acts this turn (both wait).`;
}
// Append-if-missing so an admin template that dropped {initiative} can't lose the directive.
function fillCombatPrompt(tpl, vars, directive) {
  const filled = fillPrompt(tpl, { ...vars, initiative: directive });
  return String(tpl).includes("{initiative}") ? filled : `${directive.trim()}\n\n${filled}`;
}

export async function aiResolveTurn(args) {
  // Opt-in structured judge (admin combatJudgeV2). Default OFF → unchanged v1 path below.
  // An ITEM action ALWAYS uses the v2 descriptive judge (items carry no numeric fields, so the
  // v1 absolute judge can't resolve them) regardless of the flag.
  if (getAiConfig("combatJudgeV2") || args.itemAction) return resolveTurnV2(args);
  const { player, playerAttack, enemy, enemyAttack } = args;
  // TQ-457: who-attacks-whom directive (also conveys initiative for the legacy both-attacks form).
  // TQ-491: the user prompt is the admin-editable combatUser template (dynamic fight state filled in).
  const userPrompt = fillCombatPrompt(getPrompt("combatUser"), {
    player: describe("Player", player, playerAttack),
    enemy: describe("Enemy", enemy, enemyAttack),
  }, attackDirective(args));
  const raw = await chatJson(getPrompt("combatSystem"), userPrompt, "combat:v1");
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
  const tlines = Array.isArray(transcript) && transcript.length
    ? `\n\nTranscript so far:\n${transcript.slice(-8).map((t, i) => `${i + 1}. ${sanitizePromptText(String(t), 160)}`).join("\n")}` : "";
  // An ITEM use replaces the player's monster attack this round (the spec: an item is judged
  // like an attack). Describe the player's monster WITHOUT an attack, then state the item used.
  const S = sanitizePromptText;
  const playerLine = itemAction
    ? `${describeFull("PLAYER", player, null)}\nThe PLAYER USES AN ITEM this round (instead of attacking): "${S(itemAction.name, 40)}" — ${S(itemAction.description, 200)}. Resolve the item's effect on whichever monster it targets.`
    : describeFull("PLAYER", player, playerAttack);
  // TQ-491: the user prompt is the admin-editable combatJudgeV2User template (dynamic fight state filled in).
  // TQ-457: {initiative} carries the who-attacks-whom directive (append-if-missing so it can't be dropped).
  const user = fillCombatPrompt(getPrompt("combatJudgeV2User"), {
    player: playerLine,
    enemy: describeFull("ENEMY", enemy, enemyAttack),
    transcript: tlines,
  }, attackDirective({ player, playerAttack, enemy, enemyAttack, initiator, itemAction }));
  const raw = await chatJson(getPrompt("combatJudgeV2System"), user, "combat:v2");
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
