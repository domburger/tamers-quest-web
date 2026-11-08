// TQ-184: Battle Pass CONTENT for the in-lobby station popup (epic TQ-172). A scrollable TRACK of
// tiers — each row shows the FREE + PREMIUM reward + a claim affordance — under a pinned header with
// the current tier + XP-to-next progress bar. Reads server-authoritative net.state (bpXp / bpClaimed /
// subscribed); tapping a claimable reward fires net.claimBpTier (TQ-183). The premium track locks
// without the subscription entitlement (TQ-173). All draws are fixed (the shell's pushClip masks them),
// matching the shopPanel/cosmeticsPanel content contract: render(k, rect, state) + tap + scroll.
import { net } from "../netClient.js";
import { SEASON, tierForXp, xpForTier, xpToNextTier } from "../engine/battlePass.js";
import { THEME, FONT, FONT_BOLD, WHITE, drawGlass, drawButton, drawMeter, drawEyebrow, inRect } from "./theme.js";
import { sfx, haptic } from "../systems/audio.js";
import { drawSheetMask, sheetEntrance } from "./stationPopup.js"; // UI v3: pinned bands re-cover the frosted sheet instead of painting a grey slab
import { drawIcon } from "./icons.js";

const HEAD_H = 64, ROW_H = 64, GAP = 10;
const RAIL_W = 52; // left column: the progress rail + tier medallions

const claimedHas = (track, tier) => (net.state.bpClaimed || []).includes(`${track}:${tier}`);
// TQ-267/270: premium entitlement = the legacy/perpetual flag OR an ACTIVE recurring subscription
// (now < subscribedUntil). Mirrors the server's subscriptionActive() so the client gate can't drift
// from what the server will actually allow (world.js isPremiumEntitled).
const entitled = () => net.state.subscribed === true || (Number(net.state.subscribedUntil) || 0) > Date.now();
// TQ-270: "active until <date>" status string for an active recurring sub, or "" (none / perpetual).
const subUntilLabel = () => {
  const until = Number(net.state.subscribedUntil) || 0;
  return until > Date.now() ? new Date(until).toLocaleDateString() : "";
};
const rewardLabel = (r) => !r ? "Nothing"
  : r.kind === "gold" ? `${r.amount} gold`
  : r.kind === "essence" ? `${r.amount} essence`
  : r.kind === "chain" ? "Spirit chain" : "Cosmetic";
const rewardIcon = (r) => !r ? null : r.kind === "gold" ? ["coin", THEME.amber] : r.kind === "essence" ? ["gem", THEME.violet] : r.kind === "chain" ? ["chain", THEME.teal] : ["tailor", THEME.psychic];

export function battlePassPanelState() {
  // Open scrolled near the player's current frontier so they see what's claimable.
  const tier = tierForXp(net.state.bpXp || 0);
  return { scrollY: Math.max(0, (tier - 1) * (ROW_H + GAP) - 40), _maxScroll: 0 };
}

const rowsTop = (rect) => rect[1] + HEAD_H + 6;
const rowRect = (rect, i, state) => { const top = rowsTop(rect) - state.scrollY; return [rect[0], top + i * (ROW_H + GAP), rect[2], ROW_H]; };
// UI v4 layout: [rail | FREE card | PREMIUM card]. Each card carries its own claim control at the right edge:
// a "Claim" pill on wide sheets, an icon-only disc on narrow (phone) sheets where a pill would crowd the label.
const cells = (r) => {
  const x0 = r[0] + RAIL_W, w = (r[2] - RAIL_W - 10) / 2;
  return { free: [x0, r[1], w, r[3]], prem: [x0 + w + 10, r[1], w, r[3]] };
};
const compact = (cell) => cell[2] < 200;
const claimRect = (cell) => compact(cell)
  ? [cell[0] + cell[2] - 40, cell[1] + (cell[3] - 30) / 2, 30, 30]
  : [cell[0] + cell[2] - 84, cell[1] + (cell[3] - 30) / 2, 72, 30];

// One reward card: eyebrow (FREE / PREMIUM), reward icon + label, and the claim state at the right.
function drawRewardCell(k, cell, { track, def, reached, mp, premium }) {
  const [x, y, w, h] = cell;
  const T = (n) => k.rgb(...THEME[n]);
  const reward = premium ? def.premium : def.free;
  const claimed = claimedHas(track, def.tier);
  const locked = premium && !entitled();
  drawGlass(k, { rect: cell, radius: 14, tint: 0.35, hover: reached && !claimed && !locked && inRect(mp, cell), fixed: true });
  if (premium) k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius: 14, color: T("violet"), opacity: 0.08, fixed: true }); // premium wash
  if (!reached) k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius: 14, color: T("bg"), opacity: 0.3, fixed: true });
  const ic = rewardIcon(reward);
  // Icon disc
  k.drawCircle({ pos: k.vec2(x + 26, y + h / 2), radius: 16, color: k.rgb(...(ic ? ic[1] : THEME.textMut)), opacity: 0.14, fixed: true });
  if (ic) drawIcon(k, ic[0], { x: x + 26, y: y + h / 2, size: 18, color: ic[1], opacity: reached ? 1 : 0.6, fixed: true });
  drawEyebrow(k, { x: x + 50, y: y + 14, text: premium ? "Premium" : "Free", size: 8, color: premium ? THEME.violet : THEME.textMut, spacing: 1.4, fixed: true });
  const cr = claimRect(cell);
  const maxLabelW = cr[0] - (x + 50) - 6;
  let label = rewardLabel(reward);
  if (typeof k.measureText === "function") { while (label.length > 4 && k.measureText(label, 13, FONT_BOLD) > maxLabelW) label = label.slice(0, -2) + "…"; }
  k.drawText({ text: label, pos: k.vec2(x + 50, y + 28), size: 13, font: FONT_BOLD, color: reached ? T("text") : T("textMut"), fixed: true });
  // Claim state
  const cpx = compact(cell) ? cr[0] + cr[2] / 2 : cr[0] + cr[2] - 15, ccy = cr[1] + cr[3] / 2;
  if (claimed) {
    k.drawCircle({ pos: k.vec2(cpx, ccy), radius: 11, color: T("success"), fixed: true });
    drawIcon(k, "check", { x: cpx, y: ccy, size: 12, color: THEME.textInv, weight: 2.2, fixed: true });
    if (!compact(cell)) k.drawText({ text: "Claimed", pos: k.vec2(cr[0] + cr[2] - 32, ccy - 5.5), size: 11, font: FONT_BOLD, anchor: "right", color: T("success"), fixed: true });
  } else if (locked || !reached) {
    drawIcon(k, "lock", { x: cpx, y: ccy, size: 15, color: THEME.textMut, opacity: 0.8, fixed: true });
  } else if (compact(cell)) {
    const hov = inRect(mp, cr);
    k.drawCircle({ pos: k.vec2(cpx, ccy), radius: 15, color: k.rgb(...(premium ? THEME.violet : THEME.primary)), opacity: hov ? 1 : 0.92, fixed: true });
    drawIcon(k, "plus", { x: cpx, y: ccy, size: 14, color: THEME.textInv, weight: 2.4, fixed: true });
  } else {
    drawButton(k, { rect: cr, text: "Claim", size: 13, radius: 15, fill: premium ? THEME.violet : THEME.primary, hover: inRect(mp, cr), fixed: true });
  }
}

export function drawBattlePassPanel(k, rect, state) {
  const [rx, ry, rw, rh] = rect;
  const T = (n) => k.rgb(...THEME[n]);
  const bpXp = net.state.bpXp || 0;
  const curTier = tierForXp(bpXp);
  const toNext = xpToNextTier(bpXp);
  const mp = k.mousePos();
  const tiers = SEASON.tiers;
  const railX = rx + RAIL_W / 2 - 4;
  // The progress RAIL behind the medallions: a dim track for the whole season, lit up to the current tier
  // plus the partial progress toward the next one.
  const midOf = (i) => rowRect(rect, i, state)[1] + ROW_H / 2;
  const top0 = midOf(0), topN = midOf(tiers.length - 1);
  const base = xpForTier(curTier), span = Math.max(1, xpForTier(curTier + 1) - base);
  const frac = toNext == null ? 1 : Math.max(0, Math.min(1, (bpXp - base) / span));
  const litTo = curTier <= 0 ? top0 - (ROW_H + GAP) * (1 - frac)
    : midOf(Math.min(tiers.length - 1, curTier - 1)) + (curTier < tiers.length ? (ROW_H + GAP) * frac : 0);
  const clipTop = ry + HEAD_H;
  const railTop = Math.max(top0, clipTop);
  if (topN > railTop) k.drawRect({ pos: k.vec2(railX - 2, railTop), width: 4, height: topN - railTop, radius: 2, color: k.rgb(...WHITE), opacity: 0.1, fixed: true });
  if (litTo > railTop) k.drawRect({ pos: k.vec2(railX - 2, railTop), width: 4, height: Math.min(litTo, topN) - railTop, radius: 2, color: T("primary"), opacity: 0.9, fixed: true });
  for (let i = 0; i < tiers.length; i++) {
    const def = tiers[i], r0 = rowRect(rect, i, state);
    if (r0[1] + r0[3] < ry + HEAD_H || r0[1] > ry + rh) continue; // cull (+ never under the pinned header)
    const r = [r0[0], r0[1] + (i < 12 ? sheetEntrance(k, i, { step: 0.02 }) : 0), r0[2], r0[3]];
    const reached = curTier >= def.tier, next = def.tier === curTier + 1;
    // Medallion
    const my = r[1] + ROW_H / 2;
    if (reached) {
      k.drawCircle({ pos: k.vec2(railX, my), radius: 16, color: T("primary"), fixed: true });
      k.drawText({ text: String(def.tier), pos: k.vec2(railX, my), size: 13, font: FONT_BOLD, anchor: "center", color: T("textInv"), fixed: true });
    } else {
      k.drawCircle({ pos: k.vec2(railX, my), radius: 16, color: T("surface"), fixed: true });
      k.drawCircle({ pos: k.vec2(railX, my), radius: 16, fill: false, outline: { width: next ? 2 : 1, color: next ? T("primary") : k.rgb(...WHITE) }, opacity: next ? 1 : 0.2, fixed: true });
      k.drawText({ text: String(def.tier), pos: k.vec2(railX, my), size: 13, font: FONT_BOLD, anchor: "center", color: next ? T("text") : T("textMut"), fixed: true });
    }
    const c = cells(r);
    drawRewardCell(k, c.free, { track: "free", def, reached, mp, premium: false });
    drawRewardCell(k, c.prem, { track: "premium", def, reached, mp, premium: true });
  }
  state._maxScroll = Math.max(0, tiers.length * (ROW_H + GAP) + HEAD_H + 8 - rh);
  // Pinned header LAST so the rows scroll under it: season + current tier + progress to next.
  drawSheetMask(k, [rx, ry - 2, rw, HEAD_H + 2]);
  drawEyebrow(k, { x: rx + 4, y: ry + 4, text: SEASON.name, size: 10, color: THEME.primary, fixed: true });
  k.drawText({ text: `Tier ${curTier} of ${tiers.length}`, pos: k.vec2(rx + 4, ry + 18), size: 17, font: FONT_BOLD, color: T("text"), fixed: true });
  drawMeter(k, { rect: [rx + 4, ry + 46, rw - 8, 8], frac, color: THEME.primary, fixed: true });
  k.drawText({ text: toNext == null ? "Max tier reached" : `${toNext} XP to next tier`, pos: k.vec2(rx + rw - 4, ry + 8), size: 11, font: FONT_BOLD, anchor: "topright", color: T("textBody"), fixed: true });
  // TQ-270: premium-track status where the benefit is shown: a lock + subscribe note when locked, or the
  // active-until date for a recurring subscriber (perpetual subs show a plain "Subscribed").
  if (!entitled()) {
    const note = "Premium needs a subscription";
    const nw = typeof k.measureText === "function" ? k.measureText(note, 10, FONT) : note.length * 5.6;
    drawIcon(k, "lock", { x: rx + rw - 4 - nw - 9, y: ry + 31, size: 11, color: THEME.violet, fixed: true });
    k.drawText({ text: note, pos: k.vec2(rx + rw - 4, ry + 26), size: 10, font: FONT, anchor: "topright", color: T("violet"), fixed: true });
  } else { const u = subUntilLabel(); k.drawText({ text: u ? `Subscribed until ${u}` : "Subscribed", pos: k.vec2(rx + rw - 4, ry + 26), size: 10, font: FONT, anchor: "topright", color: T("violet"), fixed: true }); }
}

// Tap: claim a reached, unclaimed reward (server-authoritative); the whole reward card is the target.
// `showToast` surfaces gating messages.
export function battlePassPanelTap(k, rect, state, p, showToast) {
  if (p.y < rowsTop(rect)) return false; // the pinned header isn't interactive
  const curTier = tierForXp(net.state.bpXp || 0);
  const tiers = SEASON.tiers;
  for (let i = 0; i < tiers.length; i++) {
    const def = tiers[i], r = rowRect(rect, i, state);
    if (curTier < def.tier) continue; // not reached: not claimable
    const c = cells(r);
    if (!claimedHas("free", def.tier) && inRect(p, c.free)) { haptic(8); sfx("click"); net.claimBpTier(def.tier, "free"); return true; }
    if (!claimedHas("premium", def.tier) && inRect(p, c.prem)) {
      if (!entitled()) { showToast && showToast("Premium track needs a subscription."); return true; }
      haptic(8); sfx("click"); net.claimBpTier(def.tier, "premium"); return true;
    }
  }
  return false;
}

export function battlePassPanelScroll(state, dy) { state.scrollY = Math.max(0, Math.min(state._maxScroll, state.scrollY + dy)); }
