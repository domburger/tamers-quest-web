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
  await setAiConfig({ genBuilderTemperature: 1.2 });
  const a = allAiConfig();
  assert.equal(a.fields.genBuilderTemperature.current, 1.2);
  assert.equal(a.fields.genBuilderTemperature.overridden, true);
  assert.equal(a.fields.model.overridden, false);
  assert.ok(Array.isArray(a.modelOptions) && a.modelOptions.includes("gpt-4o"));
});

test("per-phase generation config: each phase has its own model + temperature dial", async () => {
  await initAiConfig();
  // Generation is structured BY PHASE (Idea / Attributes / Builder for monsters; Inspiration /
  // Designer for items). The Builder defaults to a capable model; the rest to the cheap one.
  assert.equal(getAiConfig("genBuilderModel"), "gpt-5.4", "Builder defaults to the reliable model");
  assert.equal(getAiConfig("genIdeaModel"), "gpt-5.4-mini");
  assert.equal(getAiConfig("itemDesignerModel"), "gpt-5.4-mini");
  assert.equal(getAiConfig("genIdeaTemperature"), 0.9);
  // the old global genModelName / genTemperature were replaced by the per-phase dials
  assert.equal(getAiConfig("genModelName"), undefined, "global gen model replaced by per-phase");
  assert.equal(getAiConfig("genTemperature"), undefined, "global gen temperature replaced by per-phase");
  // a phase model + temp set independently
  await setAiConfig({ genAttributesModel: "gpt-5.5", genAttributesTemperature: 0.4 });
  assert.equal(getAiConfig("genAttributesModel"), "gpt-5.5");
  assert.equal(getAiConfig("genAttributesTemperature"), 0.4);
  assert.equal(getAiConfig("genIdeaModel"), "gpt-5.4-mini", "other phases untouched");
});

test("gen config: genModel (Builder on/off) defaults ON and coerces to bool", async () => {
  await initAiConfig();
  assert.equal(getAiConfig("genModel"), true);
  assert.equal(getAiConfig("genPipeline"), undefined, "genPipeline toggle no longer exists");
  await setAiConfig({ genModel: "false" });
  assert.equal(getAiConfig("genModel"), false, "string 'false' coerces to boolean false");
  await setAiConfig({ genModel: "" });
  assert.equal(getAiConfig("genModel"), true, "empty resets to default");
});
