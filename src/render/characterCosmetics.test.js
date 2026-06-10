import test from "node:test";
import assert from "node:assert/strict";
import { CHARACTER_SKINS, DEFAULT_CHARACTER_SKIN, getCharacterSkin, getEquippedCharacterSkinId, setEquippedCharacterSkinId, getEquippedCharacterSkin } from "./characterCosmetics.js";
import { CHARACTER_MODELS } from "./character.js";

test("equipped character skin: set→get round-trips; getEquippedCharacterSkin always resolves a real skin", () => {
  setEquippedCharacterSkinId("ember");
  assert.equal(getEquippedCharacterSkinId(), "ember", "set value reads back (cache-backed; localStorage-safe in node)");
  assert.equal(getEquippedCharacterSkin().id, "ember", "resolves to the equipped skin object");
  // a stale/unknown equipped id resolves to the default skin — never undefined.
  setEquippedCharacterSkinId("does-not-exist");
  assert.equal(getEquippedCharacterSkin().id, DEFAULT_CHARACTER_SKIN.id, "stale equipped id → default skin");
});

test("getCharacterSkin: returns the matching skin by id", () => {
  const ember = getCharacterSkin("ember");
  assert.equal(ember.id, "ember");
  assert.equal(ember, CHARACTER_SKINS.find((s) => s.id === "ember"));
});

test("getCharacterSkin: falls back to DEFAULT for unknown/stale/empty ids (no undefined → no render crash)", () => {
  // A stale localStorage id (skin renamed/removed) must not yield undefined —
  // render/character.js spreads accent/cloak and would crash on undefined.
  assert.equal(getCharacterSkin("nonexistent_old_skin"), DEFAULT_CHARACTER_SKIN);
  assert.equal(getCharacterSkin(undefined), DEFAULT_CHARACTER_SKIN);
  assert.equal(getCharacterSkin(null), DEFAULT_CHARACTER_SKIN);
  assert.equal(getCharacterSkin(""), DEFAULT_CHARACTER_SKIN);
});

test("CHARACTER_SKINS: every skin is well-formed (drawCharacter needs id + accent/cloak [r,g,b])", () => {
  const ids = new Set();
  for (const s of CHARACTER_SKINS) {
    assert.equal(typeof s.id, "string"); assert.ok(s.id, "skin id non-empty");
    assert.ok(!ids.has(s.id), `duplicate skin id: ${s.id}`); ids.add(s.id);
    assert.equal(typeof s.name, "string");
    for (const ch of ["accent", "cloak"]) {
      assert.ok(Array.isArray(s[ch]) && s[ch].length === 3, `${s.id}.${ch} must be [r,g,b]`);
      assert.ok(s[ch].every((v) => Number.isInteger(v) && v >= 0 && v <= 255), `${s.id}.${ch} channels 0-255`);
    }
    // Each skin names a body model render/character.js knows how to draw.
    assert.ok(CHARACTER_MODELS.includes(s.model), `${s.id}.model "${s.model}" must be a known body model`);
  }
  assert.ok(CHARACTER_SKINS.includes(DEFAULT_CHARACTER_SKIN), "DEFAULT is one of the skins");
  // The point of this batch: skins are NOT all the same silhouette anymore.
  assert.ok(new Set(CHARACTER_SKINS.map((s) => s.model)).size >= 5, "expected several distinct body models");
});
