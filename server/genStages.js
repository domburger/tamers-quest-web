// P5-T4 — LIVE stages for the monster-generation pipeline. The pure orchestrator
// (genPipeline.js `runGenPipeline`) takes the stage functions as injected deps; this
// module provides the real, LangChain-backed implementations that plug into it.
//
// Each stage uses LangChain's STRUCTURED-OUTPUT feature (`withStructuredOutput`) against
// the stage schema from genPipeline.js — no ad-hoc JSON parsing. Model + sampling come
// from aiconfig.js (admin-tunable); prompts from prompts.js (admin-editable, P7-T5).
//
// The ChatOpenAI client is created through an injectable factory (`deps.createChat`) and
// `@langchain/openai` is loaded via a DYNAMIC import inside that factory — so this module
// (and its tests) load without the dependency or an API key, and unit tests inject a mock
// chat. The live path runs only when aiEnabled() and a key are present.

import { aiEnabled, sanitizePromptText } from "./ai.js";
import { getAiConfig } from "./aiconfig.js";
import { getPrompt } from "./prompts.js";
import { runGenPipeline, IDEA_SCHEMA, ATTRIBUTES_SCHEMA } from "./genPipeline.js";

// Lazily construct a real LangChain ChatOpenAI (dynamic import → optional dependency).
async function defaultCreateChat() {
  const { ChatOpenAI } = await import("@langchain/openai");
  return new ChatOpenAI({
    model: getAiConfig("model"),
    temperature: getAiConfig("genTemperature"),
    apiKey: process.env.OPENAI_API_KEY,
  });
}

// One structured-output call: bind the schema, invoke with a system+user message pair.
async function structuredInvoke(chat, schema, name, system, user) {
  const runnable = chat.withStructuredOutput(schema, { name });
  return await runnable.invoke([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
}

// Substitute a single {placeholder} in a prompt template with literal text. Uses a
// FUNCTION replacement so a "$" in the value (e.g. an LLM idea containing "$&" / "$`"
// / "$$") is inserted VERBATIM — a plain string replacement would interpret those as
// String.replace special patterns and corrupt the assembled prompt. (sanitizePromptText
// folds control chars but intentionally keeps "$", so the slot value can carry one.)
const fill = (tpl, key, val) => tpl.replace(key, () => val);

// Compact, sanitized targeting hints (element/biome/rarity) — mirrors gen.js's defense so
// a crafted hint can't break out of its prompt line (SEC-A3).
export function hintLine({ element, biome, rarity } = {}) {
  const S = sanitizePromptText;
  const rnum = Number(rarity);
  return [
    element ? `Element: ${S(element, 24)}.` : "",
    biome ? `Biome: ${S(biome, 40)}.` : "",
    Number.isFinite(rnum) ? `Target rarity (1-5): ${Math.max(1, Math.min(5, Math.round(rnum)))}.` : "",
  ].filter(Boolean).join(" ");
}

/**
 * Build the live {idea, attributes} stage functions for runGenPipeline. The chat client
 * is created once per pipeline run and shared across stages. `deps.createChat` overrides
 * the factory (tests pass a mock; prod uses the LangChain default).
 */
export function makeLiveStages(deps = {}) {
  const createChat = deps.createChat || defaultCreateChat;
  let chatPromise = null;
  const chat = () => (chatPromise ||= Promise.resolve(createChat()));
  return {
    idea: async (opts = {}) =>
      structuredInvoke(
        await chat(), IDEA_SCHEMA, "MonsterIdea",
        getPrompt("genIdeaSystem"),
        fill(getPrompt("genIdeaUser"), "{hints}", hintLine(opts) || "Choose fitting traits."),
      ),
    attributes: async (idea = {}, opts = {}) =>
      structuredInvoke(
        await chat(), ATTRIBUTES_SCHEMA, "MonsterAttributes",
        getPrompt("genAttributesSystem"),
        fill(
          fill(getPrompt("genAttributesUser"), "{idea}", sanitizePromptText(JSON.stringify(idea || {}), 600)),
          "{hints}", hintLine(opts),
        ),
      ),
  };
}

/**
 * Generate one monster through the live multi-agent pipeline. Returns a schema-valid
 * MonsterType (attacks assigned) or null when AI is disabled / any stage fails.
 * @param {object} opts  gen opts ({ element?, biome?, rarity?, existingNames?, id? })
 * @param {object} [deps] { createChat } for tests
 */
export async function aiGenerateMonsterV2(opts = {}, deps = {}) {
  if (!aiEnabled()) return null;
  const res = await runGenPipeline(makeLiveStages(deps), opts);
  return res ? res.monster : null;
}
