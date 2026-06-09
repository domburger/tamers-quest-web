// Live end-to-end check: every model in the admin quick-pick list (MODEL_OPTIONS) must resolve a
// turn through the game's actual compatible helper (server/openai.js — max_completion_tokens +
// sampling retry). Catches the "available but 400s at call time" problem the old list had.
//   node tools/probe-models.mjs           (uses OPENAI_API_KEY from env)
import { openaiChatJson } from "../server/openai.js";
import { MODEL_OPTIONS } from "../server/aiconfig.js";
if (!process.env.OPENAI_API_KEY) { console.error("no OPENAI_API_KEY"); process.exit(1); }

let allOk = true;
for (const model of MODEL_OPTIONS) {
  try {
    const r = await openaiChatJson({ model, system: "Reply with a JSON object.", user: 'Reply with JSON {"ok":true}', temperature: 0.7, maxTokens: 50, topP: 1, timeoutMs: 30000 });
    console.log(model.padEnd(20), r && r.ok === true ? "OK" : "OK " + JSON.stringify(r).slice(0, 40));
  } catch (e) { allOk = false; console.log(model.padEnd(20), "FAIL", String(e.message).slice(0, 100)); }
}
console.log(allOk ? "PASS: every quick-pick model resolves via the game's helper" : "FAIL: some quick-pick models error");
process.exit(allOk ? 0 : 1);
