// CN-9 cosmetics economy — pure ownership / acquisition logic (engine, no deps).
// Cosmetics are VISUAL-ONLY (no pay-to-win) and the intended monetization surface
// (real-money flows deferred — see CN-16/MON). The user's decision (2026-06-07):
// a MIX of earned + free skins, so the store is a real gold/essence sink + reward.
//
// Each skin carries an optional `acquire` descriptor:
//   { kind: "free" }                                   — always owned (default)
//   { kind: "cost", cur: "gold"|"essence", amount: N } — bought with run currency
//   { kind: "unlock", note: "how to unlock" }          — milestone/achievement unlock
//
// Ownership is the union of the free skins + the player's owned-id list (persisted
// per-profile: SP on the character, MP server-authoritative). Equip is gated on
// ownership. Buying is a pure transaction over a {gold, essence} wallet + owned
// list, so the SAME logic serves the SP client and a future MP server handler.

export function skinAcquire(skin) {
  return (skin && skin.acquire) || { kind: "free" };
}

export function isSkinFree(skin) {
  return skinAcquire(skin).kind === "free";
}

// Owned = free, or its id is in the profile's owned list.
export function isSkinOwned(skin, ownedIds = []) {
  return isSkinFree(skin) || (!!skin && ownedIds.includes(skin.id));
}

// Short store label: "Free" / "250 g" / "150 ess" / "Locked".
export function acquireLabel(skin) {
  const a = skinAcquire(skin);
  if (a.kind === "free") return "Free";
  if (a.kind === "cost") return `${a.amount} ${a.cur === "essence" ? "ess" : "g"}`;
  if (a.kind === "unlock") return "Locked";
  return "";
}

// Can this wallet afford to buy this (must be an un-owned cost skin)?
export function canBuySkin(skin, wallet = {}, ownedIds = []) {
  const a = skinAcquire(skin);
  if (a.kind !== "cost" || isSkinOwned(skin, ownedIds)) return false;
  return (wallet[a.cur] || 0) >= a.amount;
}

// Pure buy transaction. Returns { ok, reason?, gold, essence, owned } — never
// mutates its inputs. reason on failure: "owned" | "locked" | "gold" | "essence".
export function buySkin(skin, wallet = {}, ownedIds = []) {
  const a = skinAcquire(skin);
  const gold = wallet.gold || 0, essence = wallet.essence || 0;
  const owned = ownedIds.slice();
  if (isSkinOwned(skin, ownedIds)) return { ok: false, reason: "owned", gold, essence, owned };
  if (a.kind !== "cost") return { ok: false, reason: "locked", gold, essence, owned };
  if ((wallet[a.cur] || 0) < a.amount) return { ok: false, reason: a.cur, gold, essence, owned };
  const next = { gold, essence };
  next[a.cur] -= a.amount;
  owned.push(skin.id);
  return { ok: true, gold: next.gold, essence: next.essence, owned };
}
