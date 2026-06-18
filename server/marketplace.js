// TQ-531 / TQ-113 marketplace FOUNDATION: server-authoritative monster ownership transfer with ESCROW +
// anti-dupe. Per the scope Dominik decided on TQ-127: trade MONSTERS only, currency gold + essence,
// server-authoritative. Monster trading is the highest pay-to-win / dupe-risk asset, so the whole design
// rests on ONE invariant:
//
//   A monster exists in EXACTLY ONE place at all times — a profile's active/vault team, OR a listing's
//   escrow — NEVER two, NEVER zero (unless genuinely consumed). That invariant IS the anti-dupe guarantee.
//
// This is the PURE core: it operates on plain profile objects ({ token, gold, essence, vaultMonsters, ... })
// and a `listings` array. Persistence (store.js), WS handlers, and the in-lobby marketplace building are
// follow-on tasks — they call these primitives and then saveProfile()/persist the listings.
//
// A monster is listable only from the VAULT, never from the active team (you can't sell one you're battling
// with, and it keeps the "in exactly one place" reasoning simple: active-team monsters are off-limits).

const r = (ok, extra) => ({ ok, ...extra });
const intAmt = (n) => Math.max(0, Math.floor(Number(n) || 0));

/** Locate a monster the seller owns IN THEIR VAULT. Active-team monsters are intentionally not findable here. */
function findInVault(profile, monsterId) {
  const v = (profile && profile.vaultMonsters) || [];
  const idx = v.findIndex((m) => m && m.id === monsterId);
  return idx >= 0 ? { idx, mon: v[idx] } : null;
}

/**
 * Escrow a vault monster into a new listing — it leaves the seller's possession atomically (removed from the
 * vault), so it now exists ONLY in the listing. `newId` makes the listing id (inject in tests).
 * @returns {{ok:true, listing}} | {{ok:false, error}}
 */
export function listMonster(listings, profile, { monsterId, gold = 0, essence = 0, newId } = {}) {
  if (typeof newId !== "function") return r(false, { error: "no_id_gen" });
  const g = intAmt(gold), e = intAmt(essence);
  if (g <= 0 && e <= 0) return r(false, { error: "price_required" });
  const found = findInVault(profile, monsterId);
  if (!found) return r(false, { error: "not_owned" }); // not in your vault (or it's on your active team → not listable)
  const [mon] = profile.vaultMonsters.splice(found.idx, 1); // ESCROW — leaves the seller now
  const listing = { id: newId("mkt"), mon, sellerToken: profile.token, gold: g, essence: e };
  listings.push(listing);
  return r(true, { listing });
}

/** Cancel YOUR listing → return the escrowed monster to your vault. Only the seller can cancel. */
export function cancelListing(listings, profile, listingId) {
  const idx = listings.findIndex((l) => l.id === listingId);
  if (idx < 0) return r(false, { error: "no_listing" });
  const l = listings[idx];
  if (l.sellerToken !== (profile && profile.token)) return r(false, { error: "not_seller" });
  (profile.vaultMonsters || (profile.vaultMonsters = [])).push(l.mon); // return from escrow
  listings.splice(idx, 1);
  return r(true, { mon: l.mon });
}

/**
 * Buy a listing. ATOMIC: validate everything FIRST, then settle in one shot so there's never a partial
 * debit/transfer. The caller loads the seller's profile (by l.sellerToken) so the seller is paid even while
 * offline. Anti-dupe preserved: the monster moves escrow → buyer's vault (still exactly one place).
 * @returns {{ok:true, mon, gold, essence}} | {{ok:false, error}}
 */
export function buyListing(listings, buyerProfile, sellerProfile, listingId) {
  const idx = listings.findIndex((l) => l.id === listingId);
  if (idx < 0) return r(false, { error: "no_listing" });
  const l = listings[idx];
  if (!buyerProfile || !buyerProfile.token) return r(false, { error: "no_buyer" });
  if (l.sellerToken === buyerProfile.token) return r(false, { error: "own_listing" });
  if (!sellerProfile || sellerProfile.token !== l.sellerToken) return r(false, { error: "seller_mismatch" });
  if ((buyerProfile.gold || 0) < l.gold) return r(false, { error: "need_gold" });
  if ((buyerProfile.essence || 0) < l.essence) return r(false, { error: "need_essence" });
  // Settle (all validated above → no partial state possible).
  buyerProfile.gold = (buyerProfile.gold || 0) - l.gold;
  buyerProfile.essence = (buyerProfile.essence || 0) - l.essence;
  sellerProfile.gold = (sellerProfile.gold || 0) + l.gold;
  sellerProfile.essence = (sellerProfile.essence || 0) + l.essence;
  (buyerProfile.vaultMonsters || (buyerProfile.vaultMonsters = [])).push(l.mon); // escrow → buyer
  listings.splice(idx, 1);
  return r(true, { mon: l.mon, gold: l.gold, essence: l.essence });
}

/** Public-safe view of a listing (no internal owner token). The mon is the full object the client renders. */
export function listingView(l) {
  return { id: l.id, mon: l.mon, gold: l.gold, essence: l.essence };
}

/**
 * Pure WS-handler dispatch for the marketplace, kept out of world.js so it's unit-testable. The caller
 * (world.js handleMessage) builds `ctx` from the live world/store and forwards the relevant message kinds.
 * `ctx`: { listings, profile, getProfileByToken, saveProfile, persist, newId, isIdle }. Replies via `send(ws, msg)`.
 * Trading is gated on isIdle (between runs only, like the shop) for marketList/marketBuy.
 * @returns {boolean} true if it handled the kind.
 */
export function handleMarketMessage(ctx, msg, send, ws) {
  const reply = (extra) => send(ws, { t: "market", ...extra });
  const myToken = ctx.profile && ctx.profile.token;
  switch (msg && msg.t) { // the wire field is `t` (handleMessage switches on msg.t) — NOT `kind`
    case "marketBrowse": {
      // `mine` lets the client offer Cancel on its own listings WITHOUT leaking other sellers' tokens.
      // Deliver-once: hand the caller any pending sale receipts (TQ-537), then clear + persist them so they
      // surface exactly once (the seller may have been offline when the sale settled).
      const sales = (ctx.profile && ctx.profile.pendingMarketSales) || [];
      const out = { browse: true, listings: ctx.listings.map((l) => ({ ...listingView(l), mine: l.sellerToken === myToken })) };
      if (sales.length) {
        out.sales = sales.slice();
        ctx.profile.pendingMarketSales = [];
        ctx.saveProfile(ctx.profile);
      }
      reply(out);
      return true;
    }
    case "marketList": {
      if (!ctx.isIdle) { reply({ ok: false, reason: "busy" }); return true; }
      // ESSENCE pricing is gated on Decision TQ-535 (RMT/refund risk) — reject essence-priced listings
      // defensively so a crafted client can't open an essence trade before the policy call. Gold-only for now.
      if (intAmt(msg.essence) > 0) { reply({ ok: false, reason: "essence_disabled" }); return true; }
      const res = listMonster(ctx.listings, ctx.profile, { monsterId: String(msg.monsterId || ""), gold: msg.gold, essence: 0, newId: ctx.newId });
      if (res.ok) { ctx.saveProfile(ctx.profile); ctx.persist(); }
      reply({ ok: res.ok, reason: res.error, listed: res.ok ? listingView(res.listing) : null, vault: ctx.profile.vaultMonsters || [] });
      return true;
    }
    case "marketCancel": {
      const res = cancelListing(ctx.listings, ctx.profile, String(msg.listingId || ""));
      if (res.ok) { ctx.saveProfile(ctx.profile); ctx.persist(); }
      reply({ ok: res.ok, reason: res.error, vault: ctx.profile.vaultMonsters || [] });
      return true;
    }
    case "marketBuy": {
      if (!ctx.isIdle) { reply({ ok: false, reason: "busy" }); return true; }
      const id = String(msg.listingId || "");
      const l = ctx.listings.find((x) => x.id === id);
      if (!l) { reply({ ok: false, reason: "no_listing" }); return true; }
      const seller = ctx.getProfileByToken(l.sellerToken);
      const res = buyListing(ctx.listings, ctx.profile, seller, id);
      if (res.ok) {
        // TQ-537: leave the seller a pending-sale receipt so they learn about it (offline-safe — picked up
        // on their next marketBrowse). Capped so a flood of sales can't grow the profile unbounded.
        if (seller) {
          const sales = seller.pendingMarketSales || (seller.pendingMarketSales = []);
          sales.push({ name: (res.mon && (res.mon.name || res.mon.typeName)) || "a monster", gold: res.gold || 0, essence: res.essence || 0 });
          if (sales.length > 50) seller.pendingMarketSales = sales.slice(-50);
        }
        ctx.saveProfile(ctx.profile); if (seller) ctx.saveProfile(seller); ctx.persist();
      }
      reply({ ok: res.ok, reason: res.error, gold: ctx.profile.gold || 0, essence: ctx.profile.essence || 0, vault: ctx.profile.vaultMonsters || [] });
      return true;
    }
    default:
      return false;
  }
}
