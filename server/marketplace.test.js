import { test } from "node:test";
import assert from "node:assert/strict";
import { listMonster, cancelListing, buyListing, listingView, handleMarketMessage, marketFee, MARKET_FEE_PCT } from "./marketplace.js";

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

test("TQ-535 buy: atomic transfer — buyer pays FULL price, seller credited price − house cut, monster moves", () => {
  const seller = mk("s", { gold: 10, essence: 1, vault: [mon("m1")] });
  const buyer = mk("b", { gold: 500, essence: 5 });
  const listings = [];
  const id = listMonster(listings, seller, { monsterId: "m1", gold: 120, essence: 2, newId }).listing.id;
  const fee = marketFee(120, 2); // 10% → { gold: 12, essence: 0 }
  const res = buyListing(listings, buyer, seller, id);
  assert.equal(res.ok, true);
  assert.deepEqual(res.fee, fee, "house cut returned");
  assert.equal(buyer.gold, 500 - 120, "buyer debited the FULL listed gold"); assert.equal(buyer.essence, 5 - 2, "buyer debited the FULL listed essence");
  assert.equal(seller.gold, 10 + (120 - fee.gold), "seller credited gold net of the cut"); assert.equal(seller.essence, 1 + (2 - fee.essence), "seller credited essence net of the cut");
  assert.equal(res.sellerGold, 120 - fee.gold); assert.equal(res.sellerEssence, 2 - fee.essence);
  assert.equal(buyer.vaultMonsters.length, 1, "monster delivered to the buyer");
  assert.equal(buyer.vaultMonsters[0].id, "m1");
  assert.equal(listings.length, 0, "listing consumed");
  assert.equal(places("m1", [seller, buyer], listings), 1, "still exactly one copy after the sale");
});

test("TQ-535 marketFee: per-currency house cut floors fractional units; rate matches the export", () => {
  assert.equal(MARKET_FEE_PCT > 0 && MARKET_FEE_PCT < 1, true, "a sane fractional rate");
  const f = marketFee(100, 10);
  assert.equal(f.gold, Math.floor(100 * MARKET_FEE_PCT)); assert.equal(f.essence, Math.floor(10 * MARKET_FEE_PCT));
  assert.deepEqual(marketFee(0, 0), { gold: 0, essence: 0 }, "no price → no fee");
  assert.deepEqual(marketFee(5, 1), { gold: Math.floor(5 * MARKET_FEE_PCT), essence: Math.floor(1 * MARKET_FEE_PCT) }, "small amounts floor (often to 0) — never overcharge");
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

test("TQ-536 handler: marketBrowse flags the caller's OWN listings (mine) without leaking tokens", () => {
  const me = mk("me", { vault: [mon("mine1")] }); me.token = "me";
  const other = mk("other", { vault: [mon("theirs1")] }); other.token = "other";
  const listings = [];
  listMonster(listings, me, { monsterId: "mine1", gold: 50, newId });
  listMonster(listings, other, { monsterId: "theirs1", gold: 60, newId });
  const h = harness({ profiles: { self: me }, listings });
  handleMarketMessage(h.ctx, { t: "marketBrowse" }, h.send, null);
  const views = h.sent[0].listings;
  assert.equal(views.length, 2);
  const mineView = views.find((v) => v.mon.id === "mine1"), theirView = views.find((v) => v.mon.id === "theirs1");
  assert.equal(mineView.mine, true, "own listing flagged");
  assert.equal(theirView.mine, false, "other's listing not flagged");
  assert.equal(mineView.sellerToken, undefined); assert.equal(theirView.sellerToken, undefined, "no tokens leaked either way");
});

test("TQ-535 handler: marketList ACCEPTS essence pricing (Decision resolved) — escrows + persists", () => {
  const self = mk("s", { vault: [mon("m1"), mon("m2")] }); self.token = "s";
  const h = harness({ profiles: { self }, listings: [] });
  // essence-only price
  handleMarketMessage(h.ctx, { t: "marketList", monsterId: "m1", gold: 0, essence: 5 }, h.send, null);
  assert.equal(h.sent[0].ok, true, "essence-priced listing accepted");
  assert.equal(h.ctx.listings.find((l) => l.mon.id === "m1").essence, 5, "essence price escrowed on the listing");
  // gold+essence mix
  handleMarketMessage(h.ctx, { t: "marketList", monsterId: "m2", gold: 100, essence: 1 }, h.send, null);
  assert.equal(h.sent[1].ok, true, "gold+essence listing accepted");
  const l2 = h.ctx.listings.find((l) => l.mon.id === "m2");
  assert.equal(l2.gold, 100); assert.equal(l2.essence, 1);
  assert.equal(self.vaultMonsters.length, 0, "both monsters escrowed");
  // a zero/zero price is still rejected (nothing to charge)
  self.vaultMonsters.push(mon("m3"));
  handleMarketMessage(h.ctx, { t: "marketList", monsterId: "m3", gold: 0, essence: 0 }, h.send, null);
  assert.equal(h.sent[2].ok, false); assert.equal(h.sent[2].reason, "price_required");
});

test("TQ-535 handler: marketBrowse advertises the current house fee rate to clients", () => {
  const self = mk("s"); self.token = "s";
  const h = harness({ profiles: { self }, listings: [] });
  handleMarketMessage(h.ctx, { t: "marketBrowse" }, h.send, null);
  assert.equal(h.sent[0].feePct, MARKET_FEE_PCT, "browse carries feePct so the Sell tab can show 'after N% fee'");
});

test("TQ-556 handler: marketBrowse ships evolved type defs referenced by listings (so a buyer can render them)", () => {
  const self = mk("s"); self.token = "s";
  const listings = [{ id: "l1", sellerToken: "o", mon: { id: "m1", typeName: "Wolf#evo30#x" }, gold: 50, essence: 0 }];
  const h = harness({ profiles: { self }, listings });
  h.ctx.collectEvolvedDefs = (ls) => ls.map((l) => ({ typeName: l.mon.typeName, evolved: true, name: "Dire Wolf" }));
  handleMarketMessage(h.ctx, { t: "marketBrowse" }, h.send, null);
  assert.equal(h.sent[0].evolvedTypes.length, 1);
  assert.equal(h.sent[0].evolvedTypes[0].typeName, "Wolf#evo30#x");
  // no evolved listings → no evolvedTypes field (kept lean)
  const h2 = harness({ profiles: { self }, listings: [] });
  h2.ctx.collectEvolvedDefs = () => [];
  handleMarketMessage(h2.ctx, { t: "marketBrowse" }, h2.send, null);
  assert.equal("evolvedTypes" in h2.sent[0], false);
});

test("TQ-537 handler: a buy leaves the seller a pending-sale receipt; marketBrowse delivers it ONCE then clears", () => {
  const buyer = mk("buyer", { gold: 500 }); buyer.token = "buyer";
  const seller = mk("seller", { vault: [{ id: "mx", typeName: "Test", name: "Floofy", level: 5 }] }); seller.token = "seller";
  const listings = [];
  listMonster(listings, seller, { monsterId: "mx", gold: 120, newId });
  // buyer buys
  const hb = harness({ profiles: { self: buyer, seller }, listings, isIdle: true });
  handleMarketMessage(hb.ctx, { t: "marketBuy", listingId: listings[0].id }, hb.send, null);
  assert.equal(hb.sent[0].ok, true);
  const net120 = 120 - marketFee(120, 0).gold; // seller nets price − house cut
  assert.equal((seller.pendingMarketSales || []).length, 1, "receipt recorded on the seller");
  assert.deepEqual(seller.pendingMarketSales[0], { name: "Floofy", gold: net120, essence: 0 }, "receipt shows NET proceeds");
  // seller browses → gets the receipt, and it's cleared + the profile saved
  const hs = harness({ profiles: { self: seller }, listings });
  handleMarketMessage(hs.ctx, { t: "marketBrowse" }, hs.send, null);
  assert.deepEqual(hs.sent[0].sales, [{ name: "Floofy", gold: net120, essence: 0 }], "delivered on browse");
  assert.ok(seller._saved >= 1, "profile saved after clearing");
  assert.equal(seller.pendingMarketSales.length, 0, "cleared after delivery");
  // a second browse carries NO sales (deliver-once)
  const hs2 = harness({ profiles: { self: seller }, listings });
  handleMarketMessage(hs2.ctx, { t: "marketBrowse" }, hs2.send, null);
  assert.equal(hs2.sent[0].sales, undefined, "no sales on the next browse");
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
  assert.equal(seller.gold, 120 - marketFee(120, 0).gold, "seller paid net of the house cut"); assert.ok(seller._saved >= 1, "seller profile saved (paid even if offline)");
  assert.equal(listings.length, 0); assert.equal(h.persistedCount(), 1);
});

test("TQ-545 handler: marketBuy with an unresolvable seller profile rejects cleanly — buyer untouched, monster stays escrowed", () => {
  // The seller's profile is NOT in the store (token can't be resolved → getProfileByToken returns null).
  // buyListing must reject BEFORE settling: no buyer debit, no monster delivered, listing + escrow intact.
  // This guards the anti-dupe/lost-payment invariant against a future "handle offline sellers" refactor that
  // might drop the null-seller guard and settle anyway (buyer charged + monster delivered, seller pay vanishes).
  const seller = mk("ghost", { vault: [mon("mz")] }); seller.token = "ghost";
  const buyer = mk("buyer", { gold: 500, essence: 3 }); buyer.token = "buyer";
  const listings = [];
  listMonster(listings, seller, { monsterId: "mz", gold: 120, newId }); // escrow the monster
  // Harness store knows the BUYER only — the seller token won't resolve.
  const h = harness({ profiles: { self: buyer }, listings, isIdle: true });
  handleMarketMessage(h.ctx, { t: "marketBuy", listingId: listings[0].id }, h.send, null);
  assert.equal(h.sent[0].ok, false); assert.equal(h.sent[0].reason, "seller_mismatch");
  assert.equal(buyer.gold, 500, "buyer NOT debited"); assert.equal(buyer.essence, 3, "buyer essence untouched");
  assert.equal((buyer.vaultMonsters || []).length, 0, "no monster delivered to the buyer");
  assert.equal(listings.length, 1, "listing intact after the rejected buy");
  assert.equal(h.persistedCount(), 0, "nothing persisted on a rejected buy");
  assert.equal(places("mz", [seller, buyer], listings), 1, "monster still in exactly one place (the escrow)");
});
