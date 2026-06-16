import test from "node:test";
import assert from "node:assert/strict";
import { CHAIN_SKINS, DEFAULT_SKIN, getSkin, RARITY_COLOR, getEquippedSkinId, setEquippedSkinId, getEquippedSkin, tierColor, drawChainGlyph, drawChainSkin, drawChainShopIcon } from "./chainCosmetics.js";
import { CHARACTER_SKINS, DEFAULT_CHARACTER_SKIN } from "./characterCosmetics.js";

// A minimal k that records circle colours, to assert the tier centre-dot (TQ-143) without a canvas.
function mockK() {
  const calls = { circle: [] };
  return {
    calls,
    k: {
      rgb: (...c) => c,
      vec2: (x, y) => ({ x, y }),
      drawCircle: (o) => calls.circle.push(o),
      drawRect: () => {}, drawLine: () => {},
    },
  };
}

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

// ── TQ-143 (decision TQ-151 "143 only"): tier shown by the centre-dot COLOUR, badge removed ──
const sameRgb = (a, b) => Array.isArray(a) && Array.isArray(b) && a.join() === b.join();

test("tierColor: a distinct, valid RGB per tier 1..6; clamps out of range (TQ-143)", () => {
  const seen = new Set();
  for (let t = 1; t <= 6; t++) {
    const c = tierColor(t);
    assert.ok(Array.isArray(c) && c.length === 3 && c.every((v) => Number.isInteger(v) && v >= 0 && v <= 255), `tier ${t} → valid rgb`);
    seen.add(c.join(","));
  }
  assert.equal(seen.size, 6, "all six tiers are visually distinct");
  assert.ok(sameRgb(tierColor(0), tierColor(1)), "tier 0 clamps to 1");
  assert.ok(sameRgb(tierColor(99), tierColor(6)), "tier >6 clamps to 6");
  assert.ok(sameRgb(tierColor(null), tierColor(1)), "nullish tier → 1");
});

test("drawChainGlyph: paints a TIER-coloured centre dot; tier drives the colour; null-safe (TQ-143)", () => {
  const g4 = mockK(); drawChainGlyph(g4.k, { color: [200, 100, 100], tier: 4 }, { x: 0, y: 0, size: 28 });
  assert.ok(g4.calls.circle.some((c) => sameRgb(c.color, tierColor(4))), "a circle is drawn in the tier-4 colour (the centre dot)");
  const g1 = mockK(); drawChainGlyph(g1.k, { color: [200, 100, 100], tier: 1 }, { x: 0, y: 0 });
  assert.ok(g1.calls.circle.some((c) => sameRgb(c.color, tierColor(1))) && !g1.calls.circle.some((c) => sameRgb(c.color, tierColor(4))),
    "tier-1 glyph uses the tier-1 colour, not tier-4");
  const z = mockK(); assert.doesNotThrow(() => drawChainGlyph(z.k, null, { x: 0, y: 0 }));
  assert.equal(z.calls.circle.length, 0, "null chain → draws nothing");
});

test("drawChainSkin: centre dot is tier-coloured when a tier is supplied, else the skin core (TQ-143)", () => {
  const skin = getSkin("ember");
  const withTier = mockK(); drawChainSkin(withTier.k, { x: 0, y: 0, r: 24, t: 0, skin, tier: 3 });
  assert.ok(withTier.calls.circle.some((c) => sameRgb(c.color, tierColor(3))), "tier supplied → centre uses the tier colour");
  const noTier = mockK(); drawChainSkin(noTier.k, { x: 0, y: 0, r: 24, t: 0, skin });
  assert.ok(!noTier.calls.circle.some((c) => sameRgb(c.color, tierColor(3))), "no tier → no tier colour (uses skin.core)");
});

test("drawChainShopIcon: renders the equipped skin overlaid with the chain's TIER core; null-safe (TQ-439)", () => {
  setEquippedSkinId("void"); // a distinctive equipped cosmetic
  const g = mockK(); drawChainShopIcon(g.k, { id: "tier5", tier: 5 }, { x: 0, y: 0, r: 13, t: 0 });
  assert.ok(g.calls.circle.some((c) => sameRgb(c.color, tierColor(5))), "shop icon paints the chain's tier core (the overlay)");
  assert.ok(g.calls.circle.some((c) => sameRgb(c.color, getSkin("void").ring)), "shop icon uses the EQUIPPED cosmetic skin's ring, not a flat glyph");
  const z = mockK(); assert.doesNotThrow(() => drawChainShopIcon(z.k, null, { x: 0, y: 0 }));
  assert.equal(z.calls.circle.length, 0, "null chain → draws nothing");
  setEquippedSkinId(DEFAULT_SKIN.id); // restore default for other tests
});
