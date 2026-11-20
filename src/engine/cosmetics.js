export function skinAcquire(skin) {
  return (skin && skin.acquire) || { kind: "free" };
}

export function isSkinFree(skin) {
  return skinAcquire(skin).kind === "free";
}

export function isSkinOwned(skin, ownedIds = []) {
  return isSkinFree(skin) || (!!skin && ownedIds.includes(skin.id));
}

export function acquireLabel(skin) {
  const a = skinAcquire(skin);
  if (a.kind === "free") return "Free";
  if (a.kind === "cost") return `${a.amount} ${a.cur === "essence" ? "ess" : "g"}`;
  if (a.kind === "unlock") return "Locked";
  return "";
}

export function canBuySkin(skin, wallet = {}, ownedIds = []) {
  const a = skinAcquire(skin);
  if (a.kind !== "cost" || isSkinOwned(skin, ownedIds)) return false;
  return (wallet[a.cur] || 0) >= a.amount;
}

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
