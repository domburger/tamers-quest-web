// TQ-551 increment 2: the LIVE GPT-5.5 evolution stage. Given an EXISTING monster reaching a fixed
// evolution level, it calls the evolution agent (admin-tunable model/temp/prompt) to PRODUCE replace-tool
// edits, then applies them via the pure core (server/evolution.js). Mirrors the genStages.js live-stage
// pattern: structured output against buildEvolutionSchema, telemetry + cost tracking via structuredInvoke,
// an injectable chat factory for tests. The actual monster mutation + all validation live in evolution.js.

import { structuredInvoke, defaultCreateChat } from "./genStages.js";
import { aiEnabled, sanitizePromptText } from "./ai.js";
import { getAiConfig } from "./aiconfig.js";
import { getPrompt } from "./prompts.js";
import { fillSlot } from "./text.js";
import { HTML_STATES } from "../src/systems/htmlModel.js";
import { buildEvolutionSchema, normalizeEvolutionResult, applyEvolution } from "./evolution.js";

// The per-state markup the agent must copy oldStrings from (only present states, capped for token budget).
function currentModel(monster) {
  const out = {};
  for (const s of HTML_STATES) if (monster.html && typeof monster.html[s] === "string") out[s] = monster.html[s];
  return out;
}

/**
 * Produce + apply an evolution for `monster` reaching `level`. Returns the applyEvolution result
 * ({ok:true,monster} | {ok:false,error}); {ok:false,error:"ai_disabled"|"no_model"} when it can't run.
 * `deps.createChat` injects a mock chat in tests; `deps.model` overrides the configured model.
 * @param {{name?:string, attributes?:object, html:object, evolvedLevels?:number[]}} monster
 * @param {number} level
 */
export async function evolveMonster(monster, level, deps = {}) {
  if (!aiEnabled()) return { ok: false, error: "ai_disabled" };
  if (!monster || !monster.html || typeof monster.html.base !== "string") return { ok: false, error: "no_model" };
  const createChat = deps.createChat || defaultCreateChat;
  const model = deps.model || getAiConfig("evolveModel");
  const temp = getAiConfig("evolveTemperature");
  const summary = { name: monster.name, attributes: monster.attributes || {} };
  const user = fillSlot(
    fillSlot(
      fillSlot(getPrompt("evolveUser"), "{level}", String(level), "Level"),
      "{monster}", sanitizePromptText(JSON.stringify(summary), 600), "Monster",
    ),
    "{model}", sanitizePromptText(JSON.stringify(currentModel(monster)), 4000), "Model",
  );
  const raw = await structuredInvoke(createChat, model, temp, buildEvolutionSchema(), "MonsterEvolution", getPrompt("evolveSystem"), user);
  const result = normalizeEvolutionResult(raw);
  if (!result) return { ok: false, error: "no_result" };
  return applyEvolution(monster, level, result);
}
