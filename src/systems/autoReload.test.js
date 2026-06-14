import { test } from "node:test";
import assert from "node:assert/strict";
import { extractBundleHash, isNewVersion, currentBundleHash, initAutoReload } from "./autoReload.js";

test("extractBundleHash: pulls the content-hashed main bundle from index.html", () => {
  const html = '<!doctype html><html><head><script type="module" crossorigin src="/assets/index-DffBs6V3.js"></script></head><body></body></html>';
  assert.equal(extractBundleHash(html), "assets/index-DffBs6V3.js");
});

test("extractBundleHash: handles hashes with - and _ (base64url)", () => {
  assert.equal(extractBundleHash('src="/assets/index-A_b-9Zx0.js"'), "assets/index-A_b-9Zx0.js");
});

test("extractBundleHash: null when absent (dev serves /src/main.js, no hashed bundle) or non-string", () => {
  assert.equal(extractBundleHash('<script src="/src/main.js"></script>'), null);
  assert.equal(extractBundleHash(null), null);
  assert.equal(extractBundleHash(undefined), null);
});

test("isNewVersion: true only when both known AND different", () => {
  assert.equal(isNewVersion("assets/index-AAA.js", "assets/index-BBB.js"), true);
  assert.equal(isNewVersion("assets/index-AAA.js", "assets/index-AAA.js"), false, "same build → no nag");
  assert.equal(isNewVersion(null, "assets/index-BBB.js"), false, "unknown current → no false positive");
  assert.equal(isNewVersion("assets/index-AAA.js", null), false, "failed fetch → no false positive");
  assert.equal(isNewVersion(null, null), false);
});

test("currentBundleHash: reads the loaded <script> via a doc-like stub; null when none", () => {
  const docWith = { querySelector: (sel) => (sel.includes("assets/index-") ? { getAttribute: () => "/assets/index-Zz9.js", src: "" } : null) };
  assert.equal(currentBundleHash(docWith), "assets/index-Zz9.js");
  const docWithout = { querySelector: () => null };
  assert.equal(currentBundleHash(docWithout), null);
  assert.equal(currentBundleHash(null), null);
});

test("initAutoReload: no-op (returns a stop fn) outside the browser", () => {
  const stop = initAutoReload({ getInRun: () => false });
  assert.equal(typeof stop, "function");
  stop(); // must not throw
});
