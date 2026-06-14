import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData, getMonsterTypes } from "../engine/gamedata.js";
import { drawMonsterDetail, monsterDetailRect, isInsidePanel } from "./monsterDetail.js";

// The renderer is immediate-mode (k.draw* inside onDraw). We smoke-test it with a Proxy mock `k`
// that records drawText calls and no-ops every other draw method, then assert it renders all the
// spec fields (identity, vitals, stats, attacks, passive) without throwing — feasible per TQ-123.
function loadData() {
  const read = (f) => JSON.parse(readFileSync(`./public/assets/data/${f}`, "utf8"));
  setGameData({
    monsterTypes: read("monstertype.json"), attacks: read("attacks.json"),
    groundTiles: read("groundtiles.json"), items: read("item.json"), spiritChains: read("spiritchains.json"),
  });
}
function mockK(w = 1280, h = 720) {
  const texts = [];
  return {
    texts,
    k: new Proxy({}, {
      get(_t, prop) {
        if (prop === "width") return () => w;
        if (prop === "height") return () => h;
        if (prop === "vec2") return (x, y) => ({ x, y });
        if (prop === "rgb") return (r, g, b) => ({ r, g, b });
        if (prop === "drawText") return (o) => { if (o && o.text != null) texts.push(String(o.text)); };
        return () => {}; // any other draw* / method → no-op
      },
    }),
  };
}

test("drawMonsterDetail renders all spec fields from a monster object (wide)", () => {
  loadData();
  const mt = getMonsterTypes().find((m) => (m.description || "").length > 0) || getMonsterTypes()[0];
  const { k, texts } = mockK();
  assert.doesNotThrow(() => drawMonsterDetail(k, mt, { vitals: { currentHealth: 12, maxHealth: 30, currentEnergy: 4, maxEnergy: 9 } }));
  assert.ok(texts.includes(mt.typeName), "renders the monster name");
  const joined = texts.join("\n");
  assert.ok(texts.some((t) => t.includes(mt.element)), "renders the element/rarity/size line");
  assert.match(joined, /Stats {4}Lv\.1/, "renders the stats header");
  assert.match(joined, /Attacks/, "renders the attacks header");
  assert.match(joined, /HP 12\/30/, "renders live vitals when provided");
  // at least one real stat label + one attack name appear
  assert.ok(texts.includes("strength"), "renders stat rows");
});

test("drawMonsterDetail is responsive (narrow) and safe with a minimal monster + no vitals", () => {
  loadData();
  const { k, texts } = mockK(390, 780); // mobile portrait → narrow
  assert.doesNotThrow(() => drawMonsterDetail(k, { typeName: "Stubmaw", element: "Dark", passiveEffect: "Regenerates each turn." }, {}));
  assert.ok(texts.includes("Stubmaw"));
  assert.match(texts.join("\n"), /Passive/, "renders the passive ability with its detail");
  assert.ok(!texts.some((t) => /HP \d/.test(t)), "no vitals line when none supplied");
});

test("drawMonsterDetail tolerates a null monster (no throw, draws nothing)", () => {
  const { k, texts } = mockK();
  assert.doesNotThrow(() => drawMonsterDetail(k, null));
  assert.equal(texts.length, 0);
});

test("drawMonsterDetail: owned-monster mode shows current-level stats + XP-to-next (TQ-129)", () => {
  loadData();
  const mt = getMonsterTypes()[0];
  // Default (catalog) = the Lv.1 → Lv.50 range.
  const a = mockK();
  drawMonsterDetail(a.k, mt, {});
  assert.match(a.texts.join("\n"), /Stats {4}Lv\.1 {2}→ {2}Lv\.50/, "no level → range header");
  // Owned mode = current level header + an XP line.
  const b = mockK();
  drawMonsterDetail(b.k, mt, { level: 7, vitals: { currentHealth: 5, maxHealth: 20, currentEnergy: 2, maxEnergy: 8, xp: 30, xpToNext: 100 } });
  const joined = b.texts.join("\n");
  assert.match(joined, /Stats {4}Lv\.7/, "level → current-level header");
  assert.ok(!/Lv\.1 {2}→ {2}Lv\.50/.test(joined), "current mode does NOT show the range");
  assert.match(joined, /XP 30\/100/, "renders XP-to-next when supplied");
});

test("drawMonsterDetail: opts.footer is invoked with the panel geometry and suppresses the close-hint (TQ-130)", () => {
  loadData();
  const mt = getMonsterTypes()[0];
  const { k, texts } = mockK();
  let geom = null, calls = 0;
  drawMonsterDetail(k, mt, { footer: (kk, g) => { calls++; geom = g; } });
  assert.equal(calls, 1, "footer called exactly once");
  assert.ok(geom && geom.PW > 0 && geom.PH > 0, "geom carries the panel size");
  const { px, py, PW, PH } = monsterDetailRect(k);
  assert.equal(geom.px, px); assert.equal(geom.py, py); assert.equal(geom.PW, PW); assert.equal(geom.PH, PH);
  assert.equal(geom.footerTop, py + PH - 54, "footerTop = panel bottom minus the default footer height");
  assert.ok(!texts.some((t) => /tap.*close/i.test(t)), "default close-hint is suppressed when a footer is supplied");
  // A custom footerHeight moves the strip; no footer => the close-hint returns.
  let g2 = null;
  drawMonsterDetail(mockK().k, mt, { footer: (kk, g) => { g2 = g; }, footerHeight: 80 });
  assert.equal(g2.footerTop, g2.py + g2.PH - 80, "footerHeight overrides the reserved strip");
  const plain = mockK();
  drawMonsterDetail(plain.k, mt, {});
  assert.ok(plain.texts.some((t) => /tap.*close/i.test(t)), "no footer → close-hint still drawn");
});

test("monsterDetailRect + isInsidePanel: centered panel, hit-test inside vs outside", () => {
  const { k } = mockK(1280, 720);
  const r = monsterDetailRect(k);
  assert.ok(r.PW > 0 && r.PH > 0 && r.px >= 0 && r.py >= 0);
  assert.equal(isInsidePanel(k, r.px + r.PW / 2, r.py + r.PH / 2), true, "centre is inside");
  assert.equal(isInsidePanel(k, 2, 2), false, "top-left corner is outside");
});
