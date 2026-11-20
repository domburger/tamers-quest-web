// Invariant: a monster is in exactly one place (team/vault OR escrow): anti-dupe.

const r = (ok, extra) => ({ ok, ...extra });
const intAmt = (n) => Math.max(0, Math.floor(Number(n) || 0));

export const MARKET_FEE_PCT = 0.10;
export function marketFee(gold = 0, essence = 0) {
  return { gold: Math.floor(intAmt(gold) * MARKET_FEE_PCT), essence: Math.floor(intAmt(essence) * MARKET_FEE_PCT) };
}

function findInVault(profile, monsterId) {
  const v = (profile && profile.vaultMonsters) || [];
  const idx = v.findIndex((m) => m && m.id === monsterId);
  return idx >= 0 ? { idx, mon: v[idx] } : null;
}

export function listMonster(listings, profile, { monsterId, gold = 0, essence = 0, newId } = {}) {
  if (typeof newId !== "function") return r(false, { error: "no_id_gen" });
  const g = intAmt(gold), e = intAmt(essence);
  if (g <= 0 && e <= 0) return r(false, { error: "price_required" });
  const found = findInVault(profile, monsterId);
  if (!found) return r(false, { error: "not_owned" });
  const [mon] = profile.vaultMonsters.splice(found.idx, 1);
  const listing = { id: newId("mkt"), mon, sellerToken: profile.token, gold: g, essence: e };
  listings.push(listing);
  return r(true, { listing });
}

export function cancelListing(listings, profile, listingId) {
  const idx = listings.findIndex((l) => l.id === listingId);
  if (idx < 0) return r(false, { error: "no_listing" });
  const l = listings[idx];
  if (l.sellerToken !== (profile && profile.token)) return r(false, { error: "not_seller" });
  (profile.vaultMonsters || (profile.vaultMonsters = [])).push(l.mon);
  listings.splice(idx, 1);
  return r(true, { mon: l.mon });
}

// Validate everything before mutating anything: no partial debit/transfer.
export function buyListing(listings, buyerProfile, sellerProfile, listingId) {
  const idx = listings.findIndex((l) => l.id === listingId);
  if (idx < 0) return r(false, { error: "no_listing" });
  const l = listings[idx];
  if (!buyerProfile || !buyerProfile.token) return r(false, { error: "no_buyer" });
  if (l.sellerToken === buyerProfile.token) return r(false, { error: "own_listing" });
  if (!sellerProfile || sellerProfile.token !== l.sellerToken) return r(false, { error: "seller_mismatch" });
  if ((buyerProfile.gold || 0) < l.gold) return r(false, { error: "need_gold" });
  if ((buyerProfile.essence || 0) < l.essence) return r(false, { error: "need_essence" });
  const fee = marketFee(l.gold, l.essence);
  const sellerGold = l.gold - fee.gold, sellerEssence = l.essence - fee.essence;
  buyerProfile.gold = (buyerProfile.gold || 0) - l.gold;
  buyerProfile.essence = (buyerProfile.essence || 0) - l.essence;
  sellerProfile.gold = (sellerProfile.gold || 0) + sellerGold;
  sellerProfile.essence = (sellerProfile.essence || 0) + sellerEssence;
  (buyerProfile.vaultMonsters || (buyerProfile.vaultMonsters = [])).push(l.mon);
  listings.splice(idx, 1);
  return r(true, { mon: l.mon, gold: l.gold, essence: l.essence, sellerGold, sellerEssence, fee });
}

// Never expose sellerToken: it is the seller's session credential.
export function listingView(l) {
  return { id: l.id, mon: l.mon, gold: l.gold, essence: l.essence };
}

export function handleMarketMessage(ctx, msg, send, ws) {
  const reply = (extra) => send(ws, { t: "market", ...extra });
  const myToken = ctx.profile && ctx.profile.token;
  switch (msg && msg.t) {
    case "marketBrowse": {
      const sales = (ctx.profile && ctx.profile.pendingMarketSales) || [];
      const out = { browse: true, feePct: MARKET_FEE_PCT, listings: ctx.listings.map((l) => ({ ...listingView(l), mine: l.sellerToken === myToken })) };
      if (ctx.collectEvolvedDefs) { const evo = ctx.collectEvolvedDefs(ctx.listings); if (evo && evo.length) out.evolvedTypes = evo; }
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
      const res = listMonster(ctx.listings, ctx.profile, { monsterId: String(msg.monsterId || ""), gold: msg.gold, essence: msg.essence, newId: ctx.newId });
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
        if (seller) {
          const sales = seller.pendingMarketSales || (seller.pendingMarketSales = []);
          sales.push({ name: (res.mon && (res.mon.name || res.mon.typeName)) || "a monster", gold: res.sellerGold || 0, essence: res.sellerEssence || 0 });
          if (sales.length > 50) seller.pendingMarketSales = sales.slice(-50);
        }
        if (ctx.recordFee && res.fee) { try { ctx.recordFee(res.fee.gold || 0, res.fee.essence || 0); } catch (e) { void e; } }
        ctx.saveProfile(ctx.profile); if (seller) ctx.saveProfile(seller); ctx.persist();
      }
      reply({ ok: res.ok, reason: res.error, gold: ctx.profile.gold || 0, essence: ctx.profile.essence || 0, vault: ctx.profile.vaultMonsters || [] });
      return true;
    }
    default:
      return false;
  }
}
