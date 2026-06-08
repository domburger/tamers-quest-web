// Admin-steerable AI model + params (no DB needed — saveAiConfig no-ops without a pool).
import { test } from "node:test";
import assert from "node:assert/strict";
import { initAiConfig, getAiConfig, setAiConfig, allAiConfig, DEFAULT_AI_CONFIG } from "./aiconfig.js";

test("defaults apply before any override", async () => {
  await initAiConfig();
  assert.equal(getAiConfig("model"), "gpt-4o");
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
  assert.equal(getAiConfig("model"), "gpt-4o", "blank model resets to default");
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

test("P5-T4 gen-pipeline config: genPipeline validates v1/v2; genModel/genReview coerce to bool", async () => {
  await initAiConfig();
  // defaults
  assert.equal(getAiConfig("genPipeline"), "v1");
  assert.equal(getAiConfig("genModel"), false);
  assert.equal(getAiConfig("genReview"), false);
  // valid sets
  await setAiConfig({ genPipeline: "v2", genModel: "true", genReview: true });
  assert.equal(getAiConfig("genPipeline"), "v2");
  assert.equal(getAiConfig("genModel"), true, "string 'true' coerces to boolean true");
  assert.equal(getAiConfig("genReview"), true);
  // invalid genPipeline is rejected → the prior valid override is left untouched
  await setAiConfig({ genPipeline: "v9" });
  assert.equal(getAiConfig("genPipeline"), "v2", "bad value rejected → keeps last valid");
  // empty resets to default
  await setAiConfig({ genPipeline: "" });
  assert.equal(getAiConfig("genPipeline"), "v1", "empty resets to default");
});
