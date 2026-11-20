import { structuredInvoke, defaultCreateChat } from "./genStages.js";
import { aiEnabled, sanitizePromptText } from "./ai.js";
import { getAiConfig } from "./aiconfig.js";
import { getPrompt } from "./prompts.js";
import { fillSlot } from "./text.js";
import { HTML_STATES } from "../src/systems/htmlModel.js";
import { getMonsterType, addEvolvedType } from "../src/engine/gamedata.js";
import { buildEvolutionSchema, normalizeEvolutionResult, applyEvolution, pendingEvolution, EVOLVE_STAT_KEYS } from "./evolution.js";

function currentModel(monster) {
  const out = {};
  for (const s of HTML_STATES) if (monster.html && typeof monster.html[s] === "string") out[s] = monster.html[s];
  return out;
}

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

export async function processEvolutions(team, deps = {}) {
  const evolve = deps.evolve || evolveMonster;
  const getType = deps.getType || getMonsterType;
  const register = deps.register || addEvolvedType;
  const newId = deps.newId || (() => "evo");
  const out = [];
  for (const inst of (Array.isArray(team) ? team : [])) {
    try {
      if (!inst || typeof inst.level !== "number" || !inst.typeName) continue;
      const level = pendingEvolution(inst, inst.level, 0);
      if (level == null) continue;
      const base = getType(inst.typeName);
      if (!base || !base.html || typeof base.html.base !== "string") continue;
      if (base.evolved) continue;
      const evoType = JSON.parse(JSON.stringify(base));
      const res = await evolve(evoType, level, deps);
      if (!res || !res.ok) continue;
      const fromName = base.name || inst.typeName;
      evoType.typeName = `${inst.typeName}#evo${level}#${newId()}`;
      evoType.baseTypeName = inst.typeName;
      evoType.evolved = true;
      delete evoType.evolvedLevels;
      register(evoType);
      inst.typeName = evoType.typeName;
      inst.name = evoType.name;
      inst.evolvedLevels = [...(inst.evolvedLevels || []), level];
      out.push({ id: inst.id, level, fromName, toName: evoType.name, typeName: evoType.typeName });
    } catch (e) { void e; }
  }
  return out;
}
