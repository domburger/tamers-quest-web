import { test } from "node:test";
import assert from "node:assert/strict";
import { getSchemaDesc, allSchemaDesc, setSchemaDesc, initSchemaDesc } from "./schemaDesc.js";
import { buildAttributesSchema, buildIdeaSchema, SCHEMA_DESC_DEFAULTS } from "./genPipeline.js";
import { buildSvgModelSchema } from "../src/systems/svgModel.js";

test("TQ-253: the SVG builder (model.*) field descriptions are admin-editable + apply live to the builder schema", async () => {
  await initSchemaDesc(); // no DB → overrides start empty

  // The four model.* keys are registered for the admin editor (exposed via allSchemaDesc).
  const all = allSchemaDesc();
  for (const k of ["model.base", "model.idle", "model.attack", "model.move"]) {
    assert.ok(all[k] && all[k].default === SCHEMA_DESC_DEFAULTS[k] && all[k].overridden === false, `key ${k} exposed`);
  }
  // Before any override the live (override-aware) builder schema matches the defaults.
  assert.equal(buildSvgModelSchema(getSchemaDesc).properties.base.description, SCHEMA_DESC_DEFAULTS["model.base"]);

  // An override flows live into the schema the builder LLM receives.
  await setSchemaDesc({ "model.base": "Draw a HULKING armored predator at rest." });
  assert.equal(getSchemaDesc("model.base"), "Draw a HULKING armored predator at rest.");
  assert.equal(buildSvgModelSchema(getSchemaDesc).properties.base.description, "Draw a HULKING armored predator at rest.");
  assert.equal(allSchemaDesc()["model.base"].overridden, true);

  // Empty resets to the default.
  await setSchemaDesc({ "model.base": "" });
  assert.equal(getSchemaDesc("model.base"), SCHEMA_DESC_DEFAULTS["model.base"]);
});

test("schemaDesc: defaults, a live override flows into the built schema, empty resets", async () => {
  await initSchemaDesc(); // no DB → overrides start empty

  // Every default key is exposed for the admin editor with default/overridden flags.
  const all = allSchemaDesc();
  for (const k of Object.keys(SCHEMA_DESC_DEFAULTS)) {
    assert.ok(all[k] && all[k].default === SCHEMA_DESC_DEFAULTS[k] && all[k].overridden === false, `key ${k} exposed`);
  }

  // The default builder + the override-aware getter agree before any override.
  assert.equal(getSchemaDesc("attributes.attacks"), SCHEMA_DESC_DEFAULTS["attributes.attacks"]);
  assert.equal(buildAttributesSchema(getSchemaDesc).properties.attacks.description, SCHEMA_DESC_DEFAULTS["attributes.attacks"]);
  assert.equal(buildIdeaSchema(getSchemaDesc).properties.inspiration.description, SCHEMA_DESC_DEFAULTS["idea.inspiration"]);

  // An override applies live to the generated schema the LLM receives.
  await setSchemaDesc({ "attributes.attacks": "Make exactly 4 WILDLY creative attacks." });
  assert.equal(getSchemaDesc("attributes.attacks"), "Make exactly 4 WILDLY creative attacks.");
  assert.equal(buildAttributesSchema(getSchemaDesc).properties.attacks.description, "Make exactly 4 WILDLY creative attacks.");
  assert.equal(allSchemaDesc()["attributes.attacks"].overridden, true);

  // The {stat} template still substitutes per stat under the override-aware getter.
  assert.match(buildAttributesSchema(getSchemaDesc).properties.baseHealth.description, /health/);

  // Empty resets to the default.
  await setSchemaDesc({ "attributes.attacks": "" });
  assert.equal(getSchemaDesc("attributes.attacks"), SCHEMA_DESC_DEFAULTS["attributes.attacks"]);
});
