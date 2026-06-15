// TQ-292 (TQ-26: ads on the website). Ad GATING + an INERT scaffold. Ads are dormant by default and only
// ever show when the operator explicitly enables them AND a publisher id is provisioned (TQ-78 ad-network
// account, Human Task) AND the visitor is NOT ad-free. "Ad-free" is the shared entitlement (isAdFree in
// src/engine/schemas.js): the standalone remove-ads purchase (TQ-174) OR an active recurring subscription
// (TQ-267) — so subscribers never see ads (AC2).
//
// Deliberately NO live AdSense script, NO ad markup, NO placement here — those + consent (GDPR) are TQ-78
// (account) + TQ-45 (legal). This lands the suppression logic + a no-op mount so the rest of the page is
// safe/inert before launch, exactly like the Paddle "inert until the price id is provisioned" pattern.

/**
 * Whether ads should display for this visitor. OFF unless ALL hold:
 *  - `adsEnabled`: the operator kill-switch is on (world.cfg / config flag),
 *  - `publisherId`: an ad-network publisher id is provisioned (TQ-78),
 *  - NOT `adFree`: the visitor lacks the ad-free entitlement (subscriber / remove-ads; pass isAdFree()).
 * Pure — no DOM. Default false (dormant).
 * @param {{adsEnabled?:boolean, publisherId?:string, adFree?:boolean}} [opts]
 * @returns {boolean}
 */
export function shouldShowAds({ adsEnabled = false, publisherId = "", adFree = false } = {}) {
  return !!(adsEnabled && publisherId && !adFree);
}

/**
 * Mount an ad into `el` IF and only if shouldShowAds(opts) — otherwise a no-op (the slot stays empty). The
 * actual ad-network embed is intentionally not implemented yet (TQ-78); this gates + reserves the seam so
 * a content page can call mountAdSlot(footerEl, {...}) today and it simply does nothing until configured.
 * Never throws (defensive for static pages without the full config). Returns true only if it mounted.
 * @param {Element|null} el @param {{adsEnabled?:boolean, publisherId?:string, adFree?:boolean, slot?:string}} [opts]
 * @returns {boolean}
 */
export function mountAdSlot(el, opts = {}) {
  try {
    if (!el || !shouldShowAds(opts)) return false;
    // TQ-78/TQ-45: the live AdSense <ins class="adsbygoogle"> embed + consent gating land here once the
    // publisher account is approved and the disclosures are in place. Until then this branch is unreachable
    // (no publisherId ⇒ shouldShowAds is false), so the page renders no ads.
    return true;
  } catch (e) { void e; return false; }
}
