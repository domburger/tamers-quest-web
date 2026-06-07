// OpenAI-backed combat turn resolution (P3-T2) — the game's "AI-resolved combat"
// selling point. The deterministic engine (engine/combat.js) is the automatic
// fallback, so combat always works even with no key / API errors. Provider:
// OpenAI gpt-4o ("use openai for now"); the key comes from OPENAI_API_KEY.

import { getPrompt } from "./prompts.js";
import { getAiConfig } from "./aiconfig.js";
import { cleanAttackName } from "../src/engine/gamedata.js";

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
export function sanitizePromptText(s, max = 48) {
  const out = String(s ?? "")
    .split("")
    .map((c) => (c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f ? " " : c))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return out.slice(0, max);
}

export function describe(label, m, attack) {
  const S = sanitizePromptText;
  const a = attack
    ? `uses "${S(cleanAttackName(attack.name))}" (dmg ${attack.damage}, acc ${attack.accuracy}, energy ${attack.energyCost}, element ${S(attack.elementalType, 24)}, crit ${attack.critChance}/${attack.critMultiplier}${attack.inflictedStatus ? `, may inflict ${S(attack.inflictedStatus, 24)} @${attack.statusChance}` : ""})`
    : `has no usable move and skips`;
  return `${label}: ${S(m.name)} [${S(m.element, 24)}] HP ${m.currentHealth}/${m.maxHealth}, energy ${m.currentEnergy}/${m.maxEnergy}, STR ${m.strength} DEF ${m.defense} SPD ${m.speed} POW ${m.power} LUCK ${m.luck}${m.status ? `, status ${S(m.status, 24)}` : ""} — ${a}`;
}

// Clamp + shape the model's output into the engine's result format.
export function mapAiResult(raw, player, enemy) {
  const clamp = (v, max, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(max, Math.round(n)));
  };
  return {
    player: {
      currentHealth: clamp(raw?.playerMonster?.currentHealth, player.maxHealth, player.currentHealth),
      currentEnergy: clamp(raw?.playerMonster?.currentEnergy, player.maxEnergy, player.currentEnergy),
      status: raw?.playerMonster?.status ?? null,
    },
    enemy: {
      currentHealth: clamp(raw?.enemyMonster?.currentHealth, enemy.maxHealth, enemy.currentHealth),
      currentEnergy: clamp(raw?.enemyMonster?.currentEnergy, enemy.maxEnergy, enemy.currentEnergy),
      status: raw?.enemyMonster?.status ?? null,
    },
    narrative: (raw?.narrative || "The monsters clash!").toString().slice(0, 240),
  };
}

// Resolve one turn via OpenAI. Throws on any failure (caller falls back to the
// deterministic engine).
export async function aiResolveTurn({ player, playerAttack, enemy, enemyAttack, initiator = null }) {
  // Initiative (e.g. an ambush, or landing a spirit chain) forces who acts first.
  // The deterministic engine already honors `initiator`; convey it to the model too
  // so AI-resolved turns match — otherwise the mechanic silently no-ops in prod.
  const initiativeLine =
    initiator === "player" ? "\nPLAYER's monster acts first this turn (initiative)." :
    initiator === "enemy" ? "\nENEMY's monster acts first this turn (initiative)." : "";
  const userPrompt =
    `${describe("Player", player, playerAttack)}\n` +
    `${describe("Enemy", enemy, enemyAttack)}${initiativeLine}\n\nResolve this turn.`;

  // CB-3: bound the OpenAI call. Without a timeout a hung request leaves the caller's
  // `resolving` flag set forever → the fight freezes for that player. On abort fetch
  // throws, and both callers (combat.js / pvp.js) already catch and fall back to the
  // deterministic engine, so a slow/hung judge degrades to offline resolution instead.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  let res;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: getAiConfig("model"),
        messages: [
          { role: "system", content: getPrompt("combatSystem") },
          { role: "user", content: userPrompt },
        ],
        temperature: getAiConfig("combatTemperature"),
        max_tokens: getAiConfig("maxTokens"),
        top_p: getAiConfig("topP"),
        response_format: { type: "json_object" },
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new Error(e.name === "AbortError" ? `OpenAI timed out after ${AI_TIMEOUT_MS}ms` : e.message);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI: empty response");
  return mapAiResult(JSON.parse(content), player, enemy);
}
