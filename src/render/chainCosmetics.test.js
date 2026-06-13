import test from "node:test";
import assert from "node:assert/strict";
import { CHAIN_SKINS, DEFAULT_SKIN, getSkin, RARITY_COLOR, getEquippedSkinId, setEquippedSkinId, getEquippedSkin } from "./chainCosmetics.js";
import { CHARACTER_SKINS, DEFAULT_CHARACTER_SKIN } from "./characterCosmetics.js";

test("equipped chain skin: set→get round-trips; getEquippedSkin always resolves a real skin", () => {
  setEquippedSkinId("void");
  assert.equal(getEquippedSkinId(), "void", "set value reads back (cache-backed; localStorage-safe in node)");
  assert.equal(getEquippedSkin().id, "void", "resolves to the equipped skin object");
  // a stale/unknown equipped id still resolves to a valid skin (getSkin → DEFAULT_SKIN) — never
  // undefined, so drawChainSkin can't crash on an equipped id for a removed cosmetic.
  setEquippedSkinId("does-not-exist");
  assert.equal(getEquippedSkin().id, DEFAULT_SKIN.id, "stale equipped id → default skin");
});

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

// TQ-134: exactly ONE free default skin per type (the starting look, owned by every account); every
// OTHER skin must cost currency to unlock.
test("TQ-134: one free default per type; all other skins have a real cost", () => {
  const free = (arr) => arr.filter((s) => !s.acquire || s.acquire.kind === "free");
  const cf = free(CHAIN_SKINS), pf = free(CHARACTER_SKINS);
  assert.equal(cf.length, 1, `exactly one free chain skin (got ${cf.map((s) => s.id).join(",")})`);
  assert.equal(cf[0].id, DEFAULT_SKIN.id, "the free chain skin IS the default");
  assert.equal(pf.length, 1, `exactly one free character skin (got ${pf.map((s) => s.id).join(",")})`);
  assert.equal(pf[0].id, DEFAULT_CHARACTER_SKIN.id, "the free character skin IS the default");
  for (const s of [...CHAIN_SKINS, ...CHARACTER_SKINS]) {
    if (s.acquire && s.acquire.kind === "free") continue;
    assert.equal(s.acquire.kind, "cost", `${s.id} must be a cost skin (no free/unlock besides the default)`);
    assert.ok(["gold", "essence"].includes(s.acquire.cur), `${s.id} has a valid currency`);
    assert.ok(s.acquire.amount > 0, `${s.id} has a positive price`);
  }
});
