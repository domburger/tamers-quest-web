import { loadAiConfig, saveAiConfig } from "./db.js";
import { modelOptions, providerStatus } from "./llm.js";

export const DEFAULT_AI_CONFIG = {
  model: "gpt-5.4-mini",
  combatTemperature: 0.7,
  combatMaxTurnDamageFrac: 1,
  maxTokens: 400,
  topP: 1,
  combatJudgeV2: true,

  genIdeaModel: "gpt-5.4-mini",        genIdeaTemperature: 0.9,
  genAttributesModel: "gpt-5.4-mini",  genAttributesTemperature: 0.9,
  genBuilderModel: "gpt-5.4",          genBuilderTemperature: 0.9,
  genModel: true,

  evolveModel: "gpt-5.5",              evolveTemperature: 0.9,

  itemInspirationModel: "gpt-5.4-mini", itemInspirationTemperature: 0.9,
  itemDesignerModel: "gpt-5.4-mini",    itemDesignerTemperature: 0.9,
  itemBuilderModel: "gpt-5.4-mini",     itemBuilderTemperature: 0.9,
  itemBuilderEnabled: true,

  biomeInspirationModel: "gpt-5.4-mini", biomeInspirationTemperature: 0.9,
  biomeDesignerModel: "gpt-5.4-mini",    biomeDesignerTemperature: 0.9,

  tileInspirationModel: "gpt-5.4-mini",  tileInspirationTemperature: 0.9,
  tileDesignerModel: "gpt-5.4-mini",     tileDesignerTemperature: 0.9,
  tileBuilderModel: "gpt-5.4-mini",      tileBuilderTemperature: 0.9,
  tileBuilderEnabled: true,

  tileSlipperinessEnabled: false,
  tileSpeedModifierEnabled: false,
  tileEmissivenessEnabled: true,
};

const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : undefined; };
const int = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : undefined; };
const bool = (v) => (v === true || v === "true" || v === "1" || v === 1) ? true : (v === false || v === "false" || v === "0" || v === 0) ? false : undefined;
const modelOf = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 60) : undefined);
const tempOf = (v) => num(v, 0, 2);
const SPEC = {
  model: modelOf,
  combatTemperature: tempOf,
  combatMaxTurnDamageFrac: (v) => num(v, 0.1, 1),
  maxTokens: (v) => int(v, 1, 4000),
  topP: (v) => num(v, 0, 1),
  combatJudgeV2: bool,
  genIdeaModel: modelOf, genIdeaTemperature: tempOf,
  genAttributesModel: modelOf, genAttributesTemperature: tempOf,
  genBuilderModel: modelOf, genBuilderTemperature: tempOf,
  genModel: bool,
  evolveModel: modelOf, evolveTemperature: tempOf,
  itemInspirationModel: modelOf, itemInspirationTemperature: tempOf,
  itemDesignerModel: modelOf, itemDesignerTemperature: tempOf,
  itemBuilderModel: modelOf, itemBuilderTemperature: tempOf, itemBuilderEnabled: bool,
  biomeInspirationModel: modelOf, biomeInspirationTemperature: tempOf,
  biomeDesignerModel: modelOf, biomeDesignerTemperature: tempOf,
  tileInspirationModel: modelOf, tileInspirationTemperature: tempOf,
  tileDesignerModel: modelOf, tileDesignerTemperature: tempOf,
  tileBuilderModel: modelOf, tileBuilderTemperature: tempOf, tileBuilderEnabled: bool,
  tileSlipperinessEnabled: bool,
  tileSpeedModifierEnabled: bool,
  tileEmissivenessEnabled: bool,
};

let overrides = {};

export async function initAiConfig() {
  try { overrides = (await loadAiConfig()) || {}; }
  catch { overrides = {}; }
}

export function getAiConfig(key) {
  if (key in overrides && SPEC[key]) {
    const clean = SPEC[key](overrides[key]);
    if (clean !== undefined) return clean;
  }
  return DEFAULT_AI_CONFIG[key];
}

export function allAiConfig() {
  const fields = {};
  for (const k of Object.keys(DEFAULT_AI_CONFIG)) {
    fields[k] = { current: getAiConfig(k), default: DEFAULT_AI_CONFIG[k], overridden: k in overrides };
  }
  return { fields, modelOptions: modelOptions(), providers: providerStatus() };
}

export async function setAiConfig(patch) {
  if (patch && typeof patch === "object") {
    for (const k of Object.keys(DEFAULT_AI_CONFIG)) {
      if (!(k in patch)) continue;
      const v = patch[k];
      if (v == null || v === "") { delete overrides[k]; continue; }
      const clean = SPEC[k](v);
      if (clean !== undefined) overrides[k] = clean;
    }
  }
  await saveAiConfig(overrides).catch((e) => console.error("[aiconfig] save:", e.message));
  return allAiConfig();
}
