import test from "node:test";
import assert from "node:assert/strict";
import { ensureMonsterSvgSprite, resetMonsterSvgSprite, _spriteSvgState } from "./spriteRegistry.js";

const SVG = '<svg viewBox="0 0 256 256"><circle cx="128" cy="128" r="80" fill="#345"/></svg>';

test("ensureMonsterSvgSprite: a known type with no SVG model is marked nomodel and never registers", () => {
  const calls = [];
  const k = { loadSprite: (n) => calls.push(n) };
  resetMonsterSvgSprite("blobby");
  ensureMonsterSvgSprite(k, "blobby", { typeName: "Blobby" }); // no .svg
  assert.equal(_spriteSvgState("blobby"), "nomodel");
  ensureMonsterSvgSprite(k, "blobby", { typeName: "Blobby" }); // second call is a no-op
  assert.equal(calls.length, 0, "never loads a sprite for a model-less monster");
});

test("ensureMonsterSvgSprite: an unknown (unloaded) type is left absent so a later draw can retry", () => {
  const k = { loadSprite: () => {} };
  resetMonsterSvgSprite("ghost");
  ensureMonsterSvgSprite(k, "ghost", undefined); // type not in gamedata yet
  assert.equal(_spriteSvgState("ghost"), undefined, "no terminal state cached → retryable");
});

test("ensureMonsterSvgSprite: an SVG monster goes pending synchronously; second call no-ops", () => {
  const k = { loadSprite: () => {} };
  resetMonsterSvgSprite("drake");
  const mt = { typeName: "Drake", svg: { base: SVG } };
  ensureMonsterSvgSprite(k, "drake", mt);
  assert.equal(_spriteSvgState("drake"), "pending", "rasterize kicked off immediately");
  ensureMonsterSvgSprite(k, "drake", mt); // must not start a second rasterize
  assert.equal(_spriteSvgState("drake"), "pending");
});

test("ensureMonsterSvgSprite: with no DOM the raster resolves null → failed, and no broken sprite is registered", async () => {
  const calls = [];
  const k = { loadSprite: (n) => calls.push(n) };
  resetMonsterSvgSprite("wyrm");
  ensureMonsterSvgSprite(k, "wyrm", { typeName: "Wyrm", svg: { base: SVG } });
  await new Promise((r) => setTimeout(r, 0)); // let the rasterize microtask settle (node: no document)
  assert.equal(_spriteSvgState("wyrm"), "failed");
  assert.equal(calls.length, 0, "a null raster never registers a sprite (no sync-path breakage)");
});

test("ensureMonsterSvgSprite: never throws on a bad context", () => {
  assert.doesNotThrow(() => ensureMonsterSvgSprite(null, "x", { svg: { base: SVG } }));
  assert.doesNotThrow(() => ensureMonsterSvgSprite({}, "x", { svg: { base: SVG } })); // no loadSprite fn
});
