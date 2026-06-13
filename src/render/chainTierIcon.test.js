import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { drawChainTierIcon } from "./chainTierIcon.js";

const CHAINS = JSON.parse(readFileSync("./public/assets/data/spiritchains.json", "utf8"));

// Immediate-mode render — smoke-test with a mock k that counts draw calls.
function mockK() {
  const calls = { circle: 0, ellipse: 0 };
  return {
    calls,
    k: {
      vec2: (x, y) => ({ x, y }),
      rgb: (r, g, b) => ({ r, g, b }),
      drawCircle: () => { calls.circle++; },
      drawEllipse: () => { calls.ellipse++; },
    },
  };
}

test("drawChainTierIcon renders every defined chain tier without throwing", () => {
  for (const c of CHAINS) {
    const { k, calls } = mockK();
    assert.doesNotThrow(() => drawChainTierIcon(k, c, { x: 20, y: 20, size: 28 }), `tier ${c.tier} (${c.id})`);
    assert.ok(calls.ellipse >= 2, `${c.id}: draws the two chain links`);
    assert.ok(calls.circle >= 1 + c.tier, `${c.id}: glow + ${c.tier} tier pips`); // glow circle + one pip per tier (+specials)
  }
});

test("higher tiers draw more pips than lower (power progression is legible)", () => {
  const pips = (chain) => { const { k, calls } = mockK(); drawChainTierIcon(k, chain, { x: 0, y: 0 }); return calls.circle; };
  const t1 = CHAINS.find((c) => c.tier === 1);
  const t5 = CHAINS.find((c) => c.tier === 5);
  assert.ok(pips(t5) > pips(t1), "tier 5 draws more pip/glow circles than tier 1");
});

test("special tier-6 chains add a distinct accent; null/missing is safe", () => {
  const base = (chain) => { const { k, calls } = mockK(); drawChainTierIcon(k, chain, {}); return calls; };
  const endless = CHAINS.find((c) => c.special === "endless");
  const multi = CHAINS.find((c) => c.special === "multi");
  if (endless) assert.ok(base(endless).ellipse + base(endless).circle > 0, "endless renders an accent");
  if (multi) assert.ok(base(multi).ellipse >= 3, "multi draws a third link");
  const { k, calls } = mockK();
  assert.doesNotThrow(() => drawChainTierIcon(k, null));
  assert.equal(calls.circle + calls.ellipse, 0, "null chain draws nothing");
});
