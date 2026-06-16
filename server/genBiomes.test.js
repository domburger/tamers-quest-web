import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { normalizeGeneratedBiome, aiGenerateBiome, buildBiomeDesignerPrompt } from "./genBiomes.js";
import { DEFAULT_PROMPTS, setPrompts, resetPrompts } from "./prompts.js";

// TQ-432: prompt overrides are a process-wide singleton shared with the other gen test files; reset
// to defaults before every test so another file's leftover setPrompts() can't leak in (run-order flake).
beforeEach(resetPrompts);

test("normalizeGeneratedBiome: a defaulted + clamped { name, tint, rarity, size }", () => {
  const b = normalizeGeneratedBiome({ name: "Emberflats", description: "Cooling lava and ash.", rarity: 75, size: 90, tint: { r: 190, g: 80, b: 50 } });
  assert.equal(b.name, "Emberflats");
  assert.deepEqual(b.tint, [190, 80, 50], "tint expanded to an [r,g,b] triple");
  assert.equal(b.rarity, 75);
  assert.equal(b.size, 90);
  assert.equal(b.generated, true);
  // clamps + defaults
  const c = normalizeGeneratedBiome({ tint: [999, -10, "x"], rarity: 9999, size: 1 });
  assert.deepEqual(c.tint, [255, 0, 128], "RGB clamped (b falls back to the default 128)");
  assert.equal(c.rarity, 100, "rarity clamped");
  assert.equal(c.size, 30, "size clamped to its floor");
  assert.equal(c.name, "Wilds", "missing name → default");
  // accepts `color`/`colour` as tint aliases
  assert.deepEqual(normalizeGeneratedBiome({ color: { r: 1, g: 2, b: 3 } }).tint, [1, 2, 3]);
});

test("normalizeGeneratedBiome: name is made unique vs existingNames (incl. built-ins)", () => {
  const existing = new Set(["Forest", "Volcano"]);
  assert.equal(normalizeGeneratedBiome({ name: "Forest" }, { existingNames: existing }).name, "Forest 2");
});

test("aiGenerateBiome: inspiration -> designer -> normalized biome (mocked chat)", async () => {
  const origKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  const calls = [];
  const chat = async (system, user) => {
    calls.push({ system, user });
    return calls.length === 1
      ? { inspiration: "drowned fungal trench" }                                          // stage 1
      : { name: "Mire Trench", description: "Black water and pale fungus.", rarity: 60, size: 70, tint: { r: 60, g: 90, b: 80 } }; // stage 2
  };
  try {
    const b = await aiGenerateBiome({}, { chat });
    assert.equal(calls.length, 2, "two stages: inspiration then designer");
    assert.ok(calls[1].user.includes("drowned fungal trench"), "designer received the inspiration");
    assert.equal(b.name, "Mire Trench");
    assert.deepEqual(b.tint, [60, 90, 80]);
  } finally {
    if (origKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = origKey;
  }
});

test("aiGenerateBiome: returns null when AI is disabled (no key)", async () => {
  const origKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try { assert.equal(await aiGenerateBiome(), null); }
  finally { if (origKey !== undefined) process.env.OPENAI_API_KEY = origKey; }
});

test("biome prompts: designer asks for a tint; {inspiration} fills when present, omitted when dropped", async () => {
  const des = (DEFAULT_PROMPTS.biomeDesignerSystem).toLowerCase();
  assert.ok(des.includes("tint") || des.includes("colour") || des.includes("color"), "designer asks for a minimap tint");
  // Default keeps {inspiration} → it is filled.
  assert.ok(buildBiomeDesignerPrompt("drowned fungal trench").user.includes("drowned fungal trench"), "inspiration fills the default slot");
  // An override that DROPS {inspiration} respects that — no append-if-missing (the slot is gone for a reason).
  await setPrompts({ biomeDesignerUser: "Design a biome as JSON." });
  try {
    const out = buildBiomeDesignerPrompt("drowned fungal trench").user;
    assert.ok(out.includes("Design a biome"), "override text used verbatim");
    assert.ok(!out.includes("drowned fungal trench"), "dropped {inspiration} is NOT re-appended");
  } finally {
    await setPrompts({ biomeDesignerUser: "" }); // reset to default
  }
});
