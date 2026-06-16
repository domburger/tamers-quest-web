import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { recordUsage, aiCostSnapshot, resetAiCost } from "./aiCost.js";

beforeEach(resetAiCost); // module-level singleton shared across tests in the one process — start clean

test("recordUsage accumulates grand totals + per-model breakdown", () => {
  recordUsage({ model: "gpt-5.4-mini", promptTokens: 1000, completionTokens: 200 });
  recordUsage({ model: "gpt-5.4-mini", promptTokens: 500, completionTokens: 100 });
  recordUsage({ model: "gpt-5.4", promptTokens: 2000, completionTokens: 800 });
  const s = aiCostSnapshot();
  assert.equal(s.calls, 3);
  assert.equal(s.promptTokens, 3500);
  assert.equal(s.completionTokens, 1100);
  assert.equal(s.totalTokens, 4600);
  const mini = s.byModel.find((x) => x.model === "gpt-5.4-mini");
  assert.equal(mini.calls, 2);
  assert.equal(mini.promptTokens, 1500);
  assert.equal(mini.completionTokens, 300);
});

test("estUsd uses the per-model rate table (priced models) and totals across models", () => {
  recordUsage({ model: "gpt-5.4-mini", promptTokens: 1_000_000, completionTokens: 1_000_000 }); // 0.15 + 0.60 = 0.75
  recordUsage({ model: "gpt-5.4", promptTokens: 1_000_000, completionTokens: 0 });               // 2.50
  const s = aiCostSnapshot();
  const mini = s.byModel.find((x) => x.model === "gpt-5.4-mini");
  assert.equal(mini.estUsd, 0.75);
  assert.equal(mini.priced, true);
  const big = s.byModel.find((x) => x.model === "gpt-5.4");
  assert.equal(big.estUsd, 2.5);
  assert.equal(s.estUsd, 3.25, "grand estimate is the sum across models");
  // Priciest first.
  assert.equal(s.byModel[0].model, "gpt-5.4");
});

test("an unknown model still counts tokens but contributes $0 (priced:false)", () => {
  recordUsage({ model: "mystery-model", promptTokens: 5000, completionTokens: 5000 });
  const s = aiCostSnapshot();
  const mm = s.byModel.find((x) => x.model === "mystery-model");
  assert.equal(mm.promptTokens, 5000);
  assert.equal(mm.estUsd, 0);
  assert.equal(mm.priced, false);
  assert.equal(s.totalTokens, 10000, "tokens are tracked even without a price");
});

test("recordUsage is defensive — missing / garbage fields count as 0, never throws", () => {
  recordUsage();
  recordUsage({ model: "gpt-5.4", promptTokens: undefined, completionTokens: null });
  recordUsage({ model: "gpt-5.4", promptTokens: -50, completionTokens: "abc" });
  const s = aiCostSnapshot();
  assert.equal(s.calls, 3);
  assert.equal(s.promptTokens, 0);
  assert.equal(s.completionTokens, 0);
});

test("resetAiCost clears everything", () => {
  recordUsage({ model: "gpt-5.4", promptTokens: 100, completionTokens: 100 });
  resetAiCost();
  const s = aiCostSnapshot();
  assert.equal(s.calls, 0);
  assert.equal(s.totalTokens, 0);
  assert.deepEqual(s.byModel, []);
});
