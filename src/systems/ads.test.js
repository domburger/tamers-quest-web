import test from "node:test";
import assert from "node:assert/strict";
import { shouldShowAds, mountAdSlot } from "./ads.js";

test("TQ-292 shouldShowAds: dormant by default; needs adsEnabled + publisherId + NOT ad-free", () => {
  assert.equal(shouldShowAds(), false, "default = dormant (no ads)");
  assert.equal(shouldShowAds({ adsEnabled: true }), false, "no publisher id → off (inert until TQ-78)");
  assert.equal(shouldShowAds({ publisherId: "pub-123" }), false, "ads not enabled → off");
  assert.equal(shouldShowAds({ adsEnabled: true, publisherId: "pub-123" }), true, "enabled + provisioned + not ad-free → on");
});

test("TQ-292 shouldShowAds: ad-free entitlement suppresses ads (AC2 — subscribers/remove-ads)", () => {
  const live = { adsEnabled: true, publisherId: "pub-123" };
  assert.equal(shouldShowAds({ ...live, adFree: false }), true, "free visitor sees ads");
  assert.equal(shouldShowAds({ ...live, adFree: true }), false, "ad-free (subscriber / remove-ads) → ads suppressed");
});

test("TQ-292 mountAdSlot: no-op (false) unless ads should show; never throws", () => {
  const fakeEl = {};
  assert.equal(mountAdSlot(null, { adsEnabled: true, publisherId: "p" }), false, "no element → no-op");
  assert.equal(mountAdSlot(fakeEl, {}), false, "dormant config → no-op");
  assert.equal(mountAdSlot(fakeEl, { adsEnabled: true, publisherId: "p", adFree: true }), false, "ad-free → no-op");
  assert.equal(mountAdSlot(fakeEl, { adsEnabled: true, publisherId: "p" }), true, "configured + not ad-free → mounts");
  assert.doesNotThrow(() => mountAdSlot(undefined, undefined));
});
