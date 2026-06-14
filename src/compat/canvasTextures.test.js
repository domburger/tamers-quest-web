import test from "node:test";
import assert from "node:assert/strict";
import { makeTextureRegistry } from "./canvasTextures.js";

test("TQ-284 registry: stores a canvas-like drawable synchronously via loadSprite + set", async () => {
  const reg = makeTextureRegistry();
  const canvasLike = { width: 32, height: 32 }; // stand-in for an HTMLCanvasElement (has width/height)
  assert.equal(reg.has("a"), false);
  const r = await reg.loadSprite("a", canvasLike);
  assert.equal(r, canvasLike, "loadSprite resolves to the drawable");
  assert.equal(reg.has("a"), true);
  assert.equal(reg.get("a"), canvasLike);
  reg.set("b", { naturalWidth: 16, naturalHeight: 16 }); // image-like (naturalWidth)
  assert.equal(reg.has("b"), true);
  assert.equal(reg.count(), 2);
  assert.deepEqual(reg.names().sort(), ["a", "b"]);
});

test("TQ-284 registry: a non-drawable / unknown src is rejected; get returns null when absent", async () => {
  const reg = makeTextureRegistry();
  assert.equal(await reg.loadSprite("x", 12345), null, "a number is not a texture");
  assert.equal(reg.has("x"), false);
  assert.equal(reg.get("missing"), null);
  reg.set("y", null);
  assert.equal(reg.has("y"), false, "set ignores a non-drawable");
});

test("TQ-284 registry: base64/url string load is async + headless-safe (no Image → null)", async () => {
  const reg = makeTextureRegistry();
  // In Node there's no global Image → loadSprite(string) resolves to null without throwing.
  assert.equal(typeof Image === "undefined" ? await reg.loadSprite("s", "data:image/png;base64,AAAA") : "skip-has-Image", typeof Image === "undefined" ? null : "skip-has-Image");
});

test("TQ-284 registry: delete + clear prune", () => {
  const reg = makeTextureRegistry();
  reg.set("a", { width: 1, height: 1 });
  reg.set("b", { width: 1, height: 1 });
  assert.equal(reg.delete("a"), true);
  assert.equal(reg.has("a"), false);
  reg.clear();
  assert.equal(reg.count(), 0);
});
