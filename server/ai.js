import { getPrompt } from "./prompts.js";
import { getAiConfig } from "./aiconfig.js";
import { clampText } from "./text.js";
import { cleanAttackName } from "../src/engine/gamedata.js";
import { normalizeStatus } from "../src/engine/combat.js";
import { applyJudgeEdits, resolveSpecial } from "./judge.js";
import { aiEnabled as llmAiEnabled, chatJson as llmChatJson } from "./llm.js";
import { recordJudgeTrace, clip } from "./genTrace.js";

const AI_TIMEOUT_MS = 10000;

// split/join, not replace(): replaces all and keeps `$` in values literal.
function fillPrompt(tpl, vars) {
  let out = String(tpl);
  for (const k of Object.keys(vars)) out = out.split(`{${k}}`).join(vars[k] == null ? "" : String(vars[k]));
  return out;
}

export function aiEnabled() {
  return llmAiEnabled();
}

// Prompt-injection guard: also folds C1 (incl. NEL), which \s misses.
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

export function trimNarrative(s, max = 240) {
  return clampText(sanitizePromptText(s, 4000), max);
}

export function mapAiResult(raw, player, enemy, opts = {}) {
  const clamp = (v, max, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(max, Math.round(n)));
  };
  const frac = Number.isFinite(opts.maxTurnDamageFrac) ? Math.max(0.1, Math.min(1, opts.maxTurnDamageFrac)) : 1;
  const capDamage = (newHp, prevHp, maxHp) => {
    if (!(newHp < prevHp) || frac >= 1) return newHp;
    return Math.max(newHp, Math.max(0, prevHp - Math.ceil(maxHp * frac)));
  };
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
    narrative: trimNarrative(typeof raw?.narrative === "string" && raw.narrative.trim()
      ? raw.narrative : "The monsters clash!"),
  };
}

async function chatJson(system, user, stage = "combat") {
  const model = getAiConfig("model"), startedAt = Date.now();
  try {
    const out = await llmChatJson({
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

function describeCatchTarget(m) {
  const S = sanitizePromptText;
  const pct = m.maxHealth > 0 ? Math.round((m.currentHealth / m.maxHealth) * 100) : 0;
  return `${S(m.name)} — HP ${m.currentHealth}/${m.maxHealth} (${pct}%), energy ${m.currentEnergy}/${m.maxEnergy}${m.status ? `, status ${S(m.status, 24)}` : ", no status"}`;
}

export async function aiResolveCatch({ chain, enemy }) {
  const S = sanitizePromptText;
  const chainName = S(chain?.name || "spirit chain", 40);
  const power = S(chain?.catchPrompt || "An ordinary spirit chain of average binding strength.", 400);
  const user = fillPrompt(getPrompt("catchUser"), { chain: chainName, power, target: describeCatchTarget(enemy) });
  const raw = await chatJson(getPrompt("catchJudgeSystem"), user, "capture");
  const caught = raw && (raw.caught === 1 || raw.caught === "1" || raw.caught === true) ? 1 : 0;
  const text = trimNarrative(
    typeof raw?.text === "string" && raw.text.trim() ? raw.text : (caught ? `${enemy.name} was caught!` : `${enemy.name} broke free!`),
    120,
  );
  return { caught, text };
}

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
function fillCombatPrompt(tpl, vars, directive) {
  const filled = fillPrompt(tpl, { ...vars, initiative: directive });
  return String(tpl).includes("{initiative}") ? filled : `${directive.trim()}\n\n${filled}`;
}

export async function aiResolveTurn(args) {
  // Item actions always need the v2 judge; v1 can't resolve them.
  if (getAiConfig("combatJudgeV2") || args.itemAction) return resolveTurnV2(args);
  const { player, playerAttack, enemy, enemyAttack } = args;
  const userPrompt = fillCombatPrompt(getPrompt("combatUser"), {
    player: describe("Player", player, playerAttack),
    enemy: describe("Enemy", enemy, enemyAttack),
  }, attackDirective(args));
  const raw = await chatJson(getPrompt("combatSystem"), userPrompt, "combat:v1");
  return mapAiResult(raw, player, enemy, { maxTurnDamageFrac: getAiConfig("combatMaxTurnDamageFrac") });
}

function describeFull(label, m, attack) {
  const S = sanitizePromptText;
  const a = attack
    ? `action "${S(cleanAttackName(attack.name))}"${attack.description ? ` — ${S(attack.description, 200)}` : ""} (dmg ${attack.damage}, acc ${attack.accuracy}, energy ${attack.energyCost})`
    : "no action (waits)";
  return `${label}: ${S(m.name)} HP ${m.currentHealth}/${m.maxHealth}, energy ${m.currentEnergy}/${m.maxEnergy}, STR ${m.strength} DEF ${m.defense} SPD ${m.speed} POW ${m.power} LUCK ${m.luck}${m.status ? `, status ${S(m.status, 24)}` : ""}${m.passiveEffect ? `, passive: ${S(m.passiveEffect, 200)}` : ""} — ${a}`;
}

export async function resolveTurnV2({ player, playerAttack, enemy, enemyAttack, initiator = null, transcript = null, itemAction = null }) {
  const tlines = Array.isArray(transcript) && transcript.length
    ? `\n\nTranscript so far:\n${transcript.slice(-8).map((t, i) => `${i + 1}. ${sanitizePromptText(String(t), 160)}`).join("\n")}` : "";
  const S = sanitizePromptText;
  const playerLine = itemAction
    ? `${describeFull("PLAYER", player, null)}\nThe PLAYER USES AN ITEM this round (instead of attacking): "${S(itemAction.name, 40)}" — ${S(itemAction.description, 200)}. Resolve the item's effect on whichever monster it targets.`
    : describeFull("PLAYER", player, playerAttack);
  const user = fillCombatPrompt(getPrompt("combatJudgeV2User"), {
    player: playerLine,
    enemy: describeFull("ENEMY", enemy, enemyAttack),
    transcript: tlines,
  }, attackDirective({ player, playerAttack, enemy, enemyAttack, initiator, itemAction }));
  const raw = await chatJson(getPrompt("combatJudgeV2System"), user, "combat:v2");
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
