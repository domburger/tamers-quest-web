import { test } from "node:test";
import assert from "node:assert/strict";
import { listMonster, cancelListing, buyListing, listingView, handleMarketMessage } from "./marketplace.js";

let _n = 0;
const newId = (p) => `${p}_${++_n}`;
const mk = (token, { gold = 0, essence = 0, vault = [], active = [] } = {}) => ({ token, gold, essence, vaultMonsters: vault.slice(), activeMonsters: active.slice() });
const mon = (id) => ({ id, typeName: "Test", level: 5, currentHealth: 20 });

// The whole feature rests on this: count every place a monster id can be, across all profiles + all listings.
const places = (id, profiles, listings) => {
  let c = 0;
  for (const p of profiles) { for (const m of (p.vaultMonsters || [])) if (m.id === id) c++; for (const m of (p.activeMonsters || [])) if (m.id === id) c++; }
  for (const l of listings) if (l.mon && l.mon.id === id) c++;
  return c;
};

test("TQ-531 list: escrows a vault monster into a listing (anti-dupe: leaves the seller)", () => {
  const seller = mk("s", { vault: [mon("m1")] }), listings = [];
  const res = listMonster(listings, seller, { monsterId: "m1", gold: 100, newId });
  assert.equal(res.ok, true);
  assert.equal(seller.vaultMonsters.length, 0, "removed from the seller's vault");
  assert.equal(listings.length, 1);
  assert.equal(listings[0].mon.id, "m1");
  assert.equal(places("m1", [seller], listings), 1, "exists in exactly one place (the listing)");
});

test("TQ-531 list: rejects a monster you don't own, an active-team monster, and a missing price", () => {
  const seller = mk("s", { vault: [mon("m1")], active: [mon("act")] }), listings = [];
  assert.equal(listMonster(listings, seller, { monsterId: "nope", gold: 1, newId }).error, "not_owned");
  assert.equal(listMonster(listings, seller, { monsterId: "act", gold: 1, newId }).error, "not_owned", "active-team monster isn't listable");
  assert.equal(listMonster(listings, seller, { monsterId: "m1", gold: 0, essence: 0, newId }).error, "price_required");
  assert.equal(seller.vaultMonsters.length, 1, "nothing escrowed on a rejected list");
  assert.equal(listings.length, 0);
});

test("TQ-531 cancel: returns the escrowed monster to the seller; only the seller may cancel", () => {
  const seller = mk("s", { vault: [mon("m1")] }), other = mk("o"), listings = [];
  const id = listMonster(listings, seller, { monsterId: "m1", gold: 50, newId }).listing.id;
  assert.equal(cancelListing(listings, other, id).error, "not_seller", "a non-seller can't cancel");
  assert.equal(listings.length, 1, "still listed after a rejected cancel");
  const res = cancelListing(listings, seller, id);
  assert.equal(res.ok, true);
  assert.equal(seller.vaultMonsters.length, 1, "monster returned to the seller's vault");
  assert.equal(listings.length, 0);
  assert.equal(places("m1", [seller, other], listings), 1);
});

test("TQ-531 buy: atomic transfer — debits buyer, credits seller, moves the monster, drops the listing", () => {
  const seller = mk("s", { gold: 10, essence: 1, vault: [mon("m1")] });
  const buyer = mk("b", { gold: 500, essence: 5 });
  const listings = [];
  const id = listMonster(listings, seller, { monsterId: "m1", gold: 120, essence: 2, newId }).listing.id;
  const res = buyListing(listings, buyer, seller, id);
  assert.equal(res.ok, true);
  assert.equal(buyer.gold, 380, "buyer debited gold"); assert.equal(buyer.essence, 3, "buyer debited essence");
  assert.equal(seller.gold, 130, "seller credited gold"); assert.equal(seller.essence, 3, "seller credited essence");
  assert.equal(buyer.vaultMonsters.length, 1, "monster delivered to the buyer");
  assert.equal(buyer.vaultMonsters[0].id, "m1");
  assert.equal(listings.length, 0, "listing consumed");
  assert.equal(places("m1", [seller, buyer], listings), 1, "still exactly one copy after the sale");
});

test("TQ-531 buy: rejects own listing, insufficient funds, and a missing listing — with NO partial state", () => {
  const seller = mk("s", { vault: [mon("m1")] });
  const poor = mk("p", { gold: 10, essence: 0 });
  const listings = [];
  const id = listMonster(listings, seller, { monsterId: "m1", gold: 100, essence: 1, newId }).listing.id;
  assert.equal(buyListing(listings, seller, seller, id).error, "own_listing", "can't buy your own listing");
  assert.equal(buyListing(listings, poor, seller, id).error, "need_gold");
  poor.gold = 1000; assert.equal(buyListing(listings, poor, seller, id).error, "need_essence");
  assert.equal(buyListing(listings, poor, seller, "ghost").error, "no_listing");
  // No failed attempt above moved money or the monster.
  assert.equal(poor.gold, 1000); assert.equal(poor.essence, 0);
  assert.equal((poor.vaultMonsters || []).length, 0, "no monster delivered on a failed buy");
  assert.equal(listings.length, 1, "listing intact after failed buys");
  assert.equal(places("m1", [seller, poor], listings), 1);
});

test("TQ-531 listingView hides the seller token but carries the monster + price", () => {
  const seller = mk("s", { vault: [mon("m1")] }), listings = [];
  const v = listingView(listMonster(listings, seller, { monsterId: "m1", gold: 7, essence: 0, newId }).listing);
  assert.deepEqual(Object.keys(v).sort(), ["essence", "gold", "id", "mon"]);
  assert.equal(v.sellerToken, undefined, "owner token not leaked to clients");
  assert.equal(v.mon.id, "m1");
});

// ── handleMarketMessage: the WS dispatch (pure, injected store accessors) ──
function harness({ profiles = {}, listings = [], isIdle = true } = {}) {
  let persisted = 0; const sent = [];
  const ctx = {
    listings, profile: profiles.self,
    getProfileByToken: (t) => Object.values(profiles).find((p) => p && p.token === t) || null,
    saveProfile: (p) => { p._saved = (p._saved || 0) + 1; },
    persist: () => { persisted++; }, newId, isIdle,
  };
  const send = (ws, m) => sent.push(m);
  return { ctx, send, sent, persistedCount: () => persisted };
}

test("TQ-531 handler: marketBrowse returns token-free listing views; marketList escrows + persists", () => {
  const self = mk("s", { vault: [mon("m1")] }); self.token = "s";
  const h = harness({ profiles: { self }, listings: [] });
  assert.equal(handleMarketMessage(h.ctx, { t: "marketBrowse" }, h.send, null), true);
  assert.equal(h.sent[0].listings.length, 0);
  handleMarketMessage(h.ctx, { t: "marketList", monsterId: "m1", gold: 100 }, h.send, null);
  assert.equal(h.sent[1].ok, true);
  assert.equal(h.sent[1].listed.sellerToken, undefined, "no token leaked");
  assert.equal(self.vaultMonsters.length, 0, "escrowed");
  assert.equal(self._saved, 1); assert.equal(h.persistedCount(), 1, "listings persisted on change");
  // browse now shows it
  handleMarketMessage(h.ctx, { t: "marketBrowse" }, h.send, null);
  assert.equal(h.sent[2].listings.length, 1);
});

test("TQ-531 handler: marketList/marketBuy are idle-gated; marketBuy settles + persists", () => {
  const self = mk("self", { gold: 500 }); self.token = "self";
  const seller = mk("seller", { vault: [mon("mx")] }); seller.token = "seller";
  const listings = [];
  listMonster(listings, seller, { monsterId: "mx", gold: 120, newId }); // pre-list from the seller
  // busy buyer can't buy
  const busy = harness({ profiles: { self, seller }, listings, isIdle: false });
  handleMarketMessage(busy.ctx, { t: "marketBuy", listingId: listings[0].id }, busy.send, null);
  assert.equal(busy.sent[0].ok, false); assert.equal(busy.sent[0].reason, "busy");
  // idle buyer buys → buyer debited, seller paid + saved, listing consumed + persisted
  const h = harness({ profiles: { self, seller }, listings, isIdle: true });
  handleMarketMessage(h.ctx, { t: "marketBuy", listingId: listings[0].id }, h.send, null);
  assert.equal(h.sent[0].ok, true);
  assert.equal(self.gold, 380); assert.equal(self.vaultMonsters[0].id, "mx");
  assert.equal(seller.gold, 120); assert.ok(seller._saved >= 1, "seller profile saved (paid even if offline)");
  assert.equal(listings.length, 0); assert.equal(h.persistedCount(), 1);
});
