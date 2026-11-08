// Back-compat shim: `openaiChatJson` was the shared Chat Completions helper every AI path used.
// TQ-405 moved the implementation into the multi-provider router (server/llm.js) — the same call
// now serves OpenAI, Anthropic, Gemini, DeepSeek and Groq models by model id. Existing callers
// (ai.js judges, genBiomes / genItems / genTiles phases) keep this import; new code should import
// `chatJson` from ./llm.js directly.
export { chatJson as openaiChatJson } from "./llm.js";
