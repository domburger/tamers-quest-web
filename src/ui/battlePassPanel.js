// TQ-184: Battle Pass CONTENT for the in-lobby station popup (epic TQ-172). A scrollable TRACK of
// tiers — each row shows the FREE + PREMIUM reward + a claim affordance — under a pinned header with
// the current tier + XP-to-next progress bar. Reads server-authoritative net.state (bpXp / bpClaimed /
// subscribed); tapping a claimable reward fires net.claimBpTier (TQ-183). The premium track locks
// without the subscription entitlement (TQ-173). All draws are fixed (the shell's pushClip masks them),
// matching the shopPanel/cosmeticsPanel content contract: render(k, rect, state) + tap + scroll.
import { net } from "../netClient.js";
import { SEASON, tierForXp, xpForTier, xpToNextTier } from "../engine/battlePass.js";
import { THEME, FONT, drawPanel, drawButton, inRect } from "./theme.js";
import { sfx, haptic } from "../systems/audio.js";

const HEAD_H = 52, ROW_H = 46, GAP = 6;

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
const rewardLabel = (r) => !r ? "—"
  : r.kind === "gold" ? `${r.amount} gold`
  : r.kind === "essence" ? `${r.amount} essence`
  : r.kind === "chain" ? "spirit chain" : "cosmetic";

export function battlePassPanelState() {
  // Open scrolled near the player's current frontier so they see what's claimable.
  const tier = tierForXp(net.state.bpXp || 0);
  return { scrollY: Math.max(0, (tier - 1) * (ROW_H + GAP) - 40), _maxScroll: 0 };
}

const rowsTop = (rect) => rect[1] + HEAD_H + 4;
const rowRect = (rect, i, state) => { const top = rowsTop(rect) - state.scrollY; return [rect[0], top + i * (ROW_H + GAP), rect[2], ROW_H]; };
// TQ-337: the full-screen track layout (free reward, premium reward, two buttons spread across a wide
// row) collapsed in the narrow popup — the premium reward landed at a NEGATIVE x over "Tier N", and the
// Free button drew on top of the free-reward text. Stack the two claim buttons on the right; put the
// tier + free reward on line 1 and the premium reward on line 2, each aligned with its button.
const BW = 82, BH = 18;
const freeBtn = (r) => [r[0] + r[2] - BW - 8, r[1] + 4, BW, BH];
const premBtn = (r) => [r[0] + r[2] - BW - 8, r[1] + r[3] - BH - 4, BW, BH];

export function drawBattlePassPanel(k, rect, state) {
  const [rx, ry, rw, rh] = rect;
  const T = (n) => k.rgb(...THEME[n]);
  const bpXp = net.state.bpXp || 0;
  const curTier = tierForXp(bpXp);
  const toNext = xpToNextTier(bpXp);
  const mp = k.mousePos();
  const tiers = SEASON.tiers;
  for (let i = 0; i < tiers.length; i++) {
    const def = tiers[i], r = rowRect(rect, i, state);
    if (r[1] + r[3] < ry + HEAD_H || r[1] > ry + rh) continue; // cull (+ never under the pinned header)
    const reached = curTier >= def.tier;
    drawPanel(k, { rect: r, fixed: true, fill: reached ? THEME.surface2 : THEME.surfaceAlt });
    // Line 1: Tier + free reward (aligned with the top "Free" button). Line 2: premium reward
    // (violet, aligned with the bottom "Premium/Locked" button). Buttons live in the right column.
    k.drawText({ text: `Tier ${def.tier}`, pos: k.vec2(r[0] + 12, r[1] + 14), size: 13, font: FONT, anchor: "left", color: reached ? T("text") : T("textMut"), fixed: true });
    k.drawText({ text: rewardLabel(def.free), pos: k.vec2(r[0] + 72, r[1] + 14), size: 11, font: FONT, anchor: "left", color: T("textBody"), fixed: true });
    k.drawText({ text: rewardLabel(def.premium), pos: k.vec2(r[0] + 12, r[1] + 32), size: 11, font: FONT, anchor: "left", color: T("violet"), fixed: true });
    // Free claim.
    const fr = freeBtn(r);
    if (claimedHas("free", def.tier)) k.drawText({ text: "claimed", pos: k.vec2(fr[0] + fr[2] / 2, fr[1] + fr[3] / 2), size: 11, font: FONT, anchor: "center", color: T("success"), fixed: true });
    else drawButton(k, { rect: fr, text: "Free", size: 12, fill: THEME.primary, disabled: !reached, hover: inRect(mp, fr), fixed: true });
    // Premium claim (locked without the subscription entitlement).
    const pr = premBtn(r);
    if (claimedHas("premium", def.tier)) k.drawText({ text: "claimed", pos: k.vec2(pr[0] + pr[2] / 2, pr[1] + pr[3] / 2), size: 11, font: FONT, anchor: "center", color: T("success"), fixed: true });
    else drawButton(k, { rect: pr, text: entitled() ? "Premium" : "Locked", size: 12,
      fill: entitled() ? THEME.violet : THEME.surfaceAlt, textColor: entitled() ? THEME.textInv : THEME.textMut,
      outline: THEME.line, disabled: !reached || !entitled(), hover: inRect(mp, pr), fixed: true });
  }
  state._maxScroll = Math.max(0, tiers.length * (ROW_H + GAP) + HEAD_H + 8 - rh);
  // Pinned header LAST so the rows scroll under it: season + current tier + progress to next.
  k.drawRect({ pos: k.vec2(rx, ry), width: rw, height: HEAD_H, color: T("surface"), fixed: true });
  k.drawText({ text: `${SEASON.name}   Tier ${curTier} / ${tiers.length}`, pos: k.vec2(rx + 4, ry + 10), size: 14, font: FONT, color: T("text"), fixed: true });
  const barX = rx + 4, barY = ry + 34, barW = rw - 8;
  k.drawRect({ pos: k.vec2(barX, barY), width: barW, height: 6, radius: 3, color: T("line"), fixed: true });
  const base = xpForTier(curTier), span = Math.max(1, xpForTier(curTier + 1) - base);
  const frac = toNext == null ? 1 : Math.max(0, Math.min(1, (bpXp - base) / span));
  k.drawRect({ pos: k.vec2(barX, barY), width: barW * frac, height: 6, radius: 3, color: T("primary"), fixed: true });
  k.drawText({ text: toNext == null ? "Max tier reached" : `${toNext} XP to next tier`, pos: k.vec2(rx + rw - 4, ry + 8), size: 11, font: FONT, anchor: "topright", color: T("textMut"), fixed: true });
  // TQ-270: premium-track status where the benefit is shown — a Subscribe nudge when locked, or the
  // active-until date for a recurring subscriber (perpetual subs show a plain "Subscribed" badge).
  if (!entitled()) k.drawText({ text: "Premium track: unlock with a subscription", pos: k.vec2(rx + rw - 4, ry + 30), size: 10, font: FONT, anchor: "topright", color: T("violet"), fixed: true });
  else { const u = subUntilLabel(); k.drawText({ text: u ? `Subscribed until ${u}` : "Subscribed", pos: k.vec2(rx + rw - 4, ry + 30), size: 10, font: FONT, anchor: "topright", color: T("violet"), fixed: true }); }
}

// Tap → claim a reached, unclaimed reward (server-authoritative). `showToast` surfaces gating messages.
export function battlePassPanelTap(k, rect, state, p, showToast) {
  if (p.y < rowsTop(rect)) return false; // the pinned header isn't interactive
  const curTier = tierForXp(net.state.bpXp || 0);
  const tiers = SEASON.tiers;
  for (let i = 0; i < tiers.length; i++) {
    const def = tiers[i], r = rowRect(rect, i, state);
    if (curTier < def.tier) continue; // not reached → not claimable
    if (!claimedHas("free", def.tier) && inRect(p, freeBtn(r))) { haptic(8); sfx("click"); net.claimBpTier(def.tier, "free"); return true; }
    if (!claimedHas("premium", def.tier) && inRect(p, premBtn(r))) {
      if (!entitled()) { showToast && showToast("Premium track needs a subscription."); return true; }
      haptic(8); sfx("click"); net.claimBpTier(def.tier, "premium"); return true;
    }
  }
  return false;
}

export function battlePassPanelScroll(state, dy) { state.scrollY = Math.max(0, Math.min(state._maxScroll, state.scrollY + dy)); }
