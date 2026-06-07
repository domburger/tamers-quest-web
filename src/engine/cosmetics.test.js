import { test } from "node:test";
import assert from "node:assert/strict";
import { skinAcquire, isSkinFree, isSkinOwned, acquireLabel, canBuySkin, buySkin } from "./cosmetics.js";

const FREE = { id: "aether" }; // no acquire → free
const GOLD = { id: "void", acquire: { kind: "cost", cur: "gold", amount: 250 } };
const ESS = { id: "prism", acquire: { kind: "cost", cur: "essence", amount: 150 } };
const LOCK = { id: "secret", acquire: { kind: "unlock", note: "Extract 10 times" } };

test("free skins are always owned; earned skins require ownership", () => {
  assert.equal(isSkinFree(FREE), true);
  assert.equal(isSkinOwned(FREE, []), true);
  assert.equal(isSkinOwned(GOLD, []), false);
  assert.equal(isSkinOwned(GOLD, ["void"]), true);
  assert.equal(skinAcquire(FREE).kind, "free");
});

test("acquireLabel formats per kind", () => {
  assert.equal(acquireLabel(FREE), "Free");
  assert.equal(acquireLabel(GOLD), "250 g");
  assert.equal(acquireLabel(ESS), "150 ess");
  assert.equal(acquireLabel(LOCK), "Locked");
});

test("canBuySkin respects currency, ownership, and kind", () => {
  assert.equal(canBuySkin(GOLD, { gold: 300 }, []), true);
  assert.equal(canBuySkin(GOLD, { gold: 100 }, []), false); // too poor
  assert.equal(canBuySkin(GOLD, { gold: 300 }, ["void"]), false); // already owned
  assert.equal(canBuySkin(FREE, { gold: 300 }, []), false); // free isn't bought
  assert.equal(canBuySkin(LOCK, { gold: 9999 }, []), false); // unlock, not purchasable
  assert.equal(canBuySkin(ESS, { essence: 150 }, []), true);
});

test("buySkin is a pure transaction: deducts the right currency + grants the id", () => {
  const r = buySkin(GOLD, { gold: 300, essence: 5 }, ["aether"]);
  assert.equal(r.ok, true);
  assert.equal(r.gold, 50);       // 300 - 250
  assert.equal(r.essence, 5);     // untouched
  assert.deepEqual(r.owned, ["aether", "void"]);
  // essence-priced skin spends essence, not gold
  const e = buySkin(ESS, { gold: 1000, essence: 150 }, []);
  assert.equal(e.ok, true);
  assert.equal(e.gold, 1000);
  assert.equal(e.essence, 0);
  assert.deepEqual(e.owned, ["prism"]);
});

test("buySkin fails cleanly (no mutation) on poor/owned/locked", () => {
  const owned = ["void"];
  const poor = buySkin(GOLD, { gold: 10 }, []);
  assert.equal(poor.ok, false); assert.equal(poor.reason, "gold"); assert.equal(poor.gold, 10);
  const dup = buySkin(GOLD, { gold: 999 }, owned);
  assert.equal(dup.ok, false); assert.equal(dup.reason, "owned");
  assert.deepEqual(owned, ["void"]); // input not mutated
  const lock = buySkin(LOCK, { gold: 999 }, []);
  assert.equal(lock.ok, false); assert.equal(lock.reason, "locked");
});
