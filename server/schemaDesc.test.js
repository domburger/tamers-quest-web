import { test } from "node:test";
import assert from "node:assert/strict";
import { getSchemaDesc, allSchemaDesc, setSchemaDesc, initSchemaDesc, describeFields } from "./schemaDesc.js";
import { buildAttributesSchema, buildIdeaSchema, SCHEMA_DESC_DEFAULTS } from "./genPipeline.js";
import { buildHtmlModelSchema } from "../src/systems/htmlModel.js";
import { buildItemDesignerPrompt } from "./genItems.js";
import { buildBiomeDesignerPrompt } from "./genBiomes.js";
import { buildTileDesignerPrompt } from "./genTiles.js";

test("TQ-253: the HTML builder (model.*) field descriptions are admin-editable + apply live to the builder schema", async () => {
  await initSchemaDesc();

  const all = allSchemaDesc();
  assert.ok(all["model.base"] && all["model.base"].default === SCHEMA_DESC_DEFAULTS["model.base"] && all["model.base"].overridden === false, "model.base exposed");
  for (const k of ["model.idle", "model.attack", "model.move"]) {
    assert.ok(!all[k], `${k} no longer registered (builder is base-only)`);
  }
  assert.equal(buildHtmlModelSchema(getSchemaDesc).properties.base.description, SCHEMA_DESC_DEFAULTS["model.base"]);

  await setSchemaDesc({ "model.base": "Draw a HULKING armored predator at rest." });
  assert.equal(getSchemaDesc("model.base"), "Draw a HULKING armored predator at rest.");
  assert.equal(buildHtmlModelSchema(getSchemaDesc).properties.base.description, "Draw a HULKING armored predator at rest.");
  assert.equal(allSchemaDesc()["model.base"].overridden, true);

  await setSchemaDesc({ "model.base": "" });
  assert.equal(getSchemaDesc("model.base"), SCHEMA_DESC_DEFAULTS["model.base"]);
});

test("schemaDesc: defaults, a live override flows into the built schema, empty resets", async () => {
  await initSchemaDesc();

  const all = allSchemaDesc();
  for (const k of Object.keys(SCHEMA_DESC_DEFAULTS)) {
    assert.ok(all[k] && all[k].default === SCHEMA_DESC_DEFAULTS[k] && all[k].overridden === false, `key ${k} exposed`);
  }

  assert.equal(getSchemaDesc("attributes.attacks"), SCHEMA_DESC_DEFAULTS["attributes.attacks"]);
  assert.equal(buildAttributesSchema(getSchemaDesc).properties.attacks.description, SCHEMA_DESC_DEFAULTS["attributes.attacks"]);
  assert.equal(buildIdeaSchema(getSchemaDesc).properties.inspiration.description, SCHEMA_DESC_DEFAULTS["idea.inspiration"]);

  await setSchemaDesc({ "attributes.attacks": "Make exactly 4 WILDLY creative attacks." });
  assert.equal(getSchemaDesc("attributes.attacks"), "Make exactly 4 WILDLY creative attacks.");
  assert.equal(buildAttributesSchema(getSchemaDesc).properties.attacks.description, "Make exactly 4 WILDLY creative attacks.");
  assert.equal(allSchemaDesc()["attributes.attacks"].overridden, true);

  assert.match(buildAttributesSchema(getSchemaDesc).properties.baseHealth.description, /health/);

  await setSchemaDesc({ "attributes.attacks": "" });
  assert.equal(getSchemaDesc("attributes.attacks"), SCHEMA_DESC_DEFAULTS["attributes.attacks"]);
});

test("TQ-377: item / biome / tile field descriptions are registered + admin-editable", async () => {
  await initSchemaDesc();
  const all = allSchemaDesc();
  for (const k of ["item.name", "item.description", "biome.name", "biome.rarity", "biome.tint",
                   "tile.name", "tile.color", "tile.slipperiness", "tile.emissiveness"]) {
    assert.ok(all[k] && typeof all[k].default === "string" && all[k].default.length > 0, `${k} exposed with a default`);
  }
});

test("TQ-377: describeFields renders a labelled guidance block from the live descriptions; empty when none apply", () => {
  const g = describeFields([["name", "tile.name"], ["color", "tile.color"]]);
  assert.match(g, /Field guidance/);
  assert.match(g, /- name: /);
  assert.match(g, /- color: /);
  assert.equal(describeFields([["x", "nonexistent.key.zzz"]]), "", "unknown keys → empty (nothing appended)");
  assert.equal(describeFields([]), "", "no fields → empty");
});

test("TQ-377: the field guidance is injected into each (item/biome/tile) designer prompt", () => {
  assert.match(buildItemDesignerPrompt("a glass vial").user, /Field guidance/, "item designer prompt carries the guidance");
  assert.match(buildBiomeDesignerPrompt("molten obsidian flats").user, /Field guidance/, "biome designer prompt carries the guidance");
  assert.match(buildTileDesignerPrompt("cracked slab", "Volcano").user, /Field guidance/, "tile designer prompt carries the guidance");
});

test("TQ-377: an admin override of a field description flows live into the designer prompt", async () => {
  await initSchemaDesc();
  try {
    await setSchemaDesc({ "tile.color": "ZZTOP custom colour guidance." });
    assert.match(buildTileDesignerPrompt("slab", "Volcano").user, /ZZTOP custom colour guidance/, "override steers the gen prompt");
  } finally {
    await setSchemaDesc({ "tile.color": "" });
  }
});
