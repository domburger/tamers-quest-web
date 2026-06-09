// Admin-steerable AI model + params (no DB needed — saveAiConfig no-ops without a pool).
import { test } from "node:test";
import assert from "node:assert/strict";
import { initAiConfig, getAiConfig, setAiConfig, allAiConfig, DEFAULT_AI_CONFIG } from "./aiconfig.js";

test("defaults apply before any override", async () => {
  await initAiConfig();
  assert.equal(getAiConfig("model"), DEFAULT_AI_CONFIG.model);
  assert.equal(getAiConfig("combatTemperature"), DEFAULT_AI_CONFIG.combatTemperature);
  assert.equal(getAiConfig("maxTokens"), 400);
});

test("setAiConfig overrides + clamps out-of-range values", async () => {
  await initAiConfig();
  await setAiConfig({ model: "gpt-5.4", combatTemperature: 5, maxTokens: 999999, topP: -1 });
  assert.equal(getAiConfig("model"), "gpt-5.4");
  assert.equal(getAiConfig("combatTemperature"), 2, "temp clamped to 2");
  assert.equal(getAiConfig("maxTokens"), 4000, "maxTokens clamped to 4000");
  assert.equal(getAiConfig("topP"), 0, "topP clamped to 0");
});

test("empty/null resets a field to its default", async () => {
  await initAiConfig();
  await setAiConfig({ model: "gpt-4.1" });
  assert.equal(getAiConfig("model"), "gpt-4.1");
  await setAiConfig({ model: "" });
  assert.equal(getAiConfig("model"), DEFAULT_AI_CONFIG.model, "blank model resets to default");
});

test("invalid values are rejected (keep prior/default), not stored", async () => {
  await initAiConfig();
  await setAiConfig({ combatTemperature: "not-a-number" });
  assert.equal(getAiConfig("combatTemperature"), DEFAULT_AI_CONFIG.combatTemperature);
});

test("allAiConfig exposes current/default/overridden + model options", async () => {
  await initAiConfig();
  await setAiConfig({ genTemperature: 1.2 });
  const a = allAiConfig();
  assert.equal(a.fields.genTemperature.current, 1.2);
  assert.equal(a.fields.genTemperature.overridden, true);
  assert.equal(a.fields.model.overridden, false);
  assert.ok(Array.isArray(a.modelOptions) && a.modelOptions.includes("gpt-4o"));
});

test("gen-pipeline config: genModel defaults ON and coerces to bool", async () => {
  await initAiConfig();
  // Monster generation is ALWAYS the multi-agent pipeline (the v1 single-call genPipeline
  // toggle was removed 2026-06-09). The Stage-3 Model/visual-builder agent is now ON by
  // default; the Stage-4 Review agent was removed 2026-06-09 ("remove review for now").
  assert.equal(getAiConfig("genModel"), true);
  assert.equal(getAiConfig("genPipeline"), undefined, "genPipeline toggle no longer exists");
  assert.equal(getAiConfig("genReview"), undefined, "review toggle removed");
  // string/number falsy values coerce to a real boolean
  await setAiConfig({ genModel: "false" });
  assert.equal(getAiConfig("genModel"), false, "string 'false' coerces to boolean false");
  // empty resets to the default (on)
  await setAiConfig({ genModel: "" });
  assert.equal(getAiConfig("genModel"), true, "empty resets to default");
});
