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
import { getMonsterType, addEvolvedType } from "../src/engine/gamedata.js";
import { buildEvolutionSchema, normalizeEvolutionResult, applyEvolution, pendingEvolution, EVOLVE_STAT_KEYS } from "./evolution.js";

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
  const stats = {};
  for (const k of EVOLVE_STAT_KEYS) if (monster[k] != null) stats[k] = monster[k];
  const summary = { name: monster.name, stats };
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

/**
 * Orchestrate evolution for ONE monster that just changed level prevLevel → newLevel: if that crossed a
 * fixed evolution level it hasn't evolved at, run the agent (evolveMonster, or deps.evolve in tests) and
 * apply it. A failed/rejected evolution NEVER throws and NEVER blocks the level-up — it just doesn't evolve
 * (the level still stands; pendingEvolution will offer it again on the next level-up since the level wasn't
 * recorded). Returns { evolved:boolean, level?, error? }. This is the integration capstone the server
 * level-up path will call (post-combat, off the hot path) once the per-instance evolved-form model lands.
 */
export async function evolveOnLevelUp(monster, prevLevel, newLevel, deps = {}) {
  const level = pendingEvolution(monster, newLevel, prevLevel);
  if (level == null) return { evolved: false };
  const evolve = deps.evolve || evolveMonster;
  try {
    const res = await evolve(monster, level, deps);
    if (res && res.ok) return { evolved: true, level };
    return { evolved: false, level, error: (res && res.error) || "failed" };
  } catch (e) {
    return { evolved: false, level, error: String((e && e.message) || e) };
  }
}

/**
 * Scan a team of monster INSTANCES ({id, typeName, level, ...}) at run-end and evolve any that are due
 * (level ≥ a fixed evolution level and not yet evolved there). For each: run the agent against a deep COPY of
 * the base type → mint a derived evolved type (unique typeName, evolved flag) → register it → repoint the
 * instance to it + record the level (idempotent). Side effects go through injected deps so it's testable and
 * DB-free (the caller persists + messages the client). Never throws per monster (a failure just skips it).
 * Returns the applied evolutions: [{ id, level, fromName, toName, typeName }].
 * @param {Array} team monster instances (the active run team)
 * @param {{evolve?, getType?, register?, newId?, createChat?, model?}} deps
 */
export async function processEvolutions(team, deps = {}) {
  const evolve = deps.evolve || evolveMonster;
  const getType = deps.getType || getMonsterType;
  const register = deps.register || addEvolvedType;
  const newId = deps.newId || (() => "evo");
  const out = [];
  for (const inst of (Array.isArray(team) ? team : [])) {
    try {
      if (!inst || typeof inst.level !== "number" || !inst.typeName) continue;
      const level = pendingEvolution(inst, inst.level, 0); // DUE: at/above a fixed level, not yet evolved there
      if (level == null) continue;
      const base = getType(inst.typeName);
      if (!base || !base.html || typeof base.html.base !== "string") continue; // model-less monster can't be evolved
      const evoType = JSON.parse(JSON.stringify(base)); // evolve a COPY so the shared base type is untouched
      const res = await evolve(evoType, level, deps); // AI call + applyEvolution mutates evoType (html/stats/name)
      if (!res || !res.ok) continue;
      const fromName = base.name || inst.typeName;
      evoType.typeName = `${inst.typeName}#evo${level}#${newId()}`;
      evoType.baseTypeName = inst.typeName;
      evoType.evolved = true;
      delete evoType.evolvedLevels; // instance concern, not the type
      register(evoType);
      inst.typeName = evoType.typeName;
      inst.name = evoType.name; // the instance now shows the evolved name
      inst.evolvedLevels = [...(inst.evolvedLevels || []), level];
      out.push({ id: inst.id, level, fromName, toName: evoType.name, typeName: evoType.typeName });
    } catch (e) { void e; /* one monster failing must not abort the rest */ }
  }
  return out;
}
