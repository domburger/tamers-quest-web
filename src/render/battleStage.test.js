import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { drawBattleStage, BATTLE_INTRO_DURATION } from "./battleStage.js";
import { addMonsterType, removeMonsterType } from "../engine/gamedata.js";

// A fake kaboom context: every draw* call is a no-op recorder; vec2/rgb return plain values. Records
// the sprite slugs drawn so we can assert a combatant did (or did NOT) take the canvas sprite path.
function fakeK() {
  const sprites = [];
  const k = new Proxy({ _sprites: sprites }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === "vec2") return (x, y) => ({ x, y });
      if (prop === "rgb") return (...a) => a;
      if (prop === "width") return () => 1280;
      if (prop === "height") return () => 720;
      if (prop === "time") return () => 0;
      if (prop === "drawSprite") return (o) => { sprites.push(o.sprite); };
      if (typeof prop === "string" && prop.startsWith("draw")) return () => {};
      return () => {};
    },
  });
  return k;
}

const RECT = { x: 280, y: 0, w: 720, h: 720, size: 720, cx: 640, cy: 360, right: 1000, bottom: 720 };
const HTML = { canvas: 256, base: "<div style='width:256px;height:256px;background:#a33'></div>" };

beforeEach(() => {
  addMonsterType({ name: "DomMon", typeName: "DomMon", element: "fire", html: HTML });   // has an html model
  addMonsterType({ name: "SpriteMon", typeName: "SpriteMon", element: "water" });          // no html model
});
afterEach(() => { removeMonsterType("DomMon"); removeMonsterType("SpriteMon"); });

function run({ enemy, active, sink }) {
  drawBattleStage(fakeK_shared, {
    rect: RECT, stageBottom: 480, enemy, active,
    chainCol: [120, 200, 255], charSkin: { model: "cloak" },
    time: 1, introElapsed: BATTLE_INTRO_DURATION + 0.5, reducedMotion: true,
    htmlSink: sink,
  });
}
let fakeK_shared;

test("TQ-262: an html-model enemy goes to the DOM sink, not the canvas sprite", () => {
  fakeK_shared = fakeK();
  const sink = [];
  run({ enemy: { typeName: "DomMon", element: "fire" }, active: null, sink });
  const e = sink.find((s) => s.id === "combat-enemy");
  assert.ok(e, "enemy pushed to the sink");
  assert.equal(e.typeName, "DomMon");
  assert.equal(e.facing, -1, "enemy faces left toward the player");
  assert.ok(!fakeK_shared._sprites.includes("dommon"), "no canvas sprite drawn for the DOM enemy");
});

test("TQ-262: a sprite-only enemy takes the canvas path, sink stays empty", () => {
  fakeK_shared = fakeK();
  const sink = [];
  run({ enemy: { typeName: "SpriteMon", element: "water" }, active: null, sink });
  assert.equal(sink.length, 0, "nothing pushed to the DOM sink");
  assert.ok(fakeK_shared._sprites.includes("spritemon"), "canvas sprite drawn for the sprite-only enemy");
});

test("TQ-262: html-model active monster goes to the sink facing right once settled", () => {
  fakeK_shared = fakeK();
  const sink = [];
  run({ enemy: null, active: { typeName: "DomMon", element: "fire" }, sink });
  const a = sink.find((s) => s.id === "combat-active");
  assert.ok(a, "active pushed to the sink");
  assert.equal(a.facing, 1, "active faces right toward the enemy");
  assert.ok(!fakeK_shared._sprites.includes("dommon"), "no canvas sprite for the DOM active monster");
});

test("TQ-262: no sink passed → both combatants use the canvas path (back-compat)", () => {
  fakeK_shared = fakeK();
  drawBattleStage(fakeK_shared, {
    rect: RECT, stageBottom: 480, enemy: { typeName: "DomMon", element: "fire" }, active: { typeName: "DomMon", element: "fire" },
    chainCol: [120, 200, 255], charSkin: { model: "cloak" }, time: 1, introElapsed: BATTLE_INTRO_DURATION + 0.5, reducedMotion: true,
    // htmlSink omitted
  });
  assert.ok(fakeK_shared._sprites.includes("dommon"), "without a sink, even an html-model type draws its sprite");
});

// ── Catch cinematic (chain thrown AT the enemy → caught / broke free) ──────────
function runCatch(k, { catchElapsed = 1.5, catchResolve, catchResolveElapsed }) {
  drawBattleStage(k, {
    rect: RECT, stageBottom: 480, enemy: { typeName: "SpriteMon", element: "water" }, active: null,
    chainCol: [120, 200, 255], charSkin: { model: "cloak" }, time: 1,
    introElapsed: BATTLE_INTRO_DURATION + 0.5, reducedMotion: false, // intro settled; catch anim active
    catchElapsed, catchResolve, catchResolveElapsed,
  });
}

test("catch: a fully-resolved CAUGHT removes the enemy (sucked into the chain)", () => {
  const k = fakeK();
  runCatch(k, { catchResolve: "caught", catchResolveElapsed: 1.0 }); // > CATCH_SUCCESS_DUR → captureScale/opacity 0
  assert.ok(!k._sprites.includes("spritemon"), "caught enemy is gone");
});

test("catch: a fully-resolved BROKE keeps the enemy (it burst back out)", () => {
  const k = fakeK();
  runCatch(k, { catchResolve: "broke", catchResolveElapsed: 1.0 }); // > CATCH_BREAK_DUR → captureScale back to 1
  assert.ok(k._sprites.includes("spritemon"), "enemy that broke free is back on the field");
});

test("catch: mid-throw + holding phases keep the enemy on the field and never throw", () => {
  for (const catchElapsed of [0.2 /* chain in flight */, 0.5 /* landed, holding, awaiting verdict */]) {
    const k = fakeK();
    assert.doesNotThrow(() => runCatch(k, { catchElapsed, catchResolve: null, catchResolveElapsed: -1 }));
    assert.ok(k._sprites.includes("spritemon"), `enemy still on the field at catchElapsed=${catchElapsed}`);
  }
});

test("catch: inert when no catch is active (default params) — enemy renders normally", () => {
  const k = fakeK();
  drawBattleStage(k, {
    rect: RECT, stageBottom: 480, enemy: { typeName: "SpriteMon", element: "water" }, active: null,
    chainCol: [120, 200, 255], charSkin: { model: "cloak" }, time: 1,
    introElapsed: BATTLE_INTRO_DURATION + 0.5, reducedMotion: false, // catchElapsed defaults to -1
  });
  assert.ok(k._sprites.includes("spritemon"), "enemy drawn when no catch is in progress");
});
