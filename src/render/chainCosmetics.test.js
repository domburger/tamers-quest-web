import test from "node:test";
import assert from "node:assert/strict";
import { CHAIN_SKINS, DEFAULT_SKIN, getSkin, RARITY_COLOR } from "./chainCosmetics.js";

test("getSkin: returns the matching chain skin by id", () => {
  assert.equal(getSkin("void").id, "void");
  assert.equal(getSkin("prism").id, "prism");
});

test("getSkin: falls back to DEFAULT for unknown/stale ids — guards MP rival render (CN-12)", () => {
  // A rival's equipped skinId rides the snapshot (CN-12). An old/removed id must
  // NOT yield undefined — drawChainSkin(undefined) would crash the rival render.
  assert.equal(getSkin("removed_skin_v1"), DEFAULT_SKIN);
  assert.equal(getSkin(undefined), DEFAULT_SKIN);
  assert.equal(getSkin(null), DEFAULT_SKIN);
});

test("CHAIN_SKINS: every skin is well-formed (drawChainSkin needs ring/link/core + positive links)", () => {
  const ids = new Set();
  for (const s of CHAIN_SKINS) {
    assert.equal(typeof s.id, "string"); assert.ok(s.id, "skin id non-empty");
    assert.ok(!ids.has(s.id), `duplicate chain skin id: ${s.id}`); ids.add(s.id);
    for (const c of ["ring", "link", "core"]) {
      assert.ok(Array.isArray(s[c]) && s[c].length === 3, `${s.id}.${c} must be [r,g,b]`);
      assert.ok(s[c].every((v) => Number.isInteger(v) && v >= 0 && v <= 255), `${s.id}.${c} channels 0-255`);
    }
    assert.ok(Number.isInteger(s.links) && s.links > 0, `${s.id}.links must be a positive int`);
    assert.ok(RARITY_COLOR[s.rarity], `${s.id}.rarity "${s.rarity}" has no RARITY_COLOR (store coding breaks)`);
  }
  assert.ok(CHAIN_SKINS.includes(DEFAULT_SKIN), "DEFAULT is one of the skins");
});
