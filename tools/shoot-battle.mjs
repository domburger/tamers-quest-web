// Reach the game world, then walk DETERMINISTICALLY toward the nearest wild
// monster (read from the dev-only __net global) until combat starts, and
// screenshot the battle screen. Falls back to roaming if __net is unavailable.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const URL = process.env.GAME_URL || "http://localhost:8080";
const OUT = ".screenshots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: Number(process.env.DSF) || 2 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); console.log("shot:", n); };

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 15000 });
await sleep(8000);
// Title → guest → character → lobby → Play → Singleplayer → world (proven nav).
await page.click("#guestBtn"); await sleep(600);
await page.fill("#guest-nick", "Scout"); await page.click("#guest-go"); await sleep(2200);
await page.mouse.click(640, 720 - 80); await sleep(1200);
await page.fill('input[placeholder="Character name"]', "Scout"); await sleep(300);
await page.press('input[placeholder="Character name"]', "Enter"); await sleep(2200);
await page.mouse.click(640, 130); await sleep(2500);     // → lobby
await page.mouse.click(230, 150); await sleep(900);       // Play
await page.mouse.click(640, 300); await sleep(6000);      // Singleplayer → world

// Dismiss the HOW TO PLAY intro with a tap of movement.
await page.keyboard.down("KeyD"); await sleep(300); await page.keyboard.up("KeyD"); await sleep(500);

const state = async () => {
  try {
    return await page.evaluate(() => {
      const n = globalThis.__net; if (!n || !n.state) return null;
      const s = n.state;
      return {
        self: s.self ? { x: s.self.x, y: s.self.y } : null,
        playerId: s.playerId || null,
        seed: s.seed ?? null,
        monsters: (s.monsters || []).map((m) => ({ x: m.x, y: m.y })),
        inCombat: !!s.combat,
        onTitle: !document.getElementById("title")?.classList.contains("hidden"),
      };
    });
  } catch { return null; } // transient navigation / context destroyed
};

const s0 = await state();
console.log("dev __net:", !!s0, "self:", s0?.self ? `${Math.round(s0.self.x)},${Math.round(s0.self.y)}` : "none",
  "seed:", s0?.seed, "monsters:", s0 ? s0.monsters.length : "n/a", "onTitle:", s0?.onTitle);
if (!s0 || !s0.self || s0.seed == null) { await shot("battle-notinworld"); console.log("NOT IN WORLD — nav flaked"); await browser.close(); process.exit(0); }

let reached = false;
let prevPos = null, stuck = 0;
for (let step = 0; step < 90 && !reached; step++) {
  const st = await state();
  if (!st || !st.self) break;
  if (st.inCombat) { reached = true; break; }
  if (step % 10 === 0) console.log(`step ${step}: monsters=${st.monsters.length} self=${Math.round(st.self.x)},${Math.round(st.self.y)}`);
  if (!st.monsters.length) {
    // none in view — sweep in a long line to discover one (each direction held ~1.4s)
    const k = ["KeyD", "KeyS", "KeyA", "KeyW"][Math.floor(step / 3) % 4];
    await page.keyboard.down(k); await sleep(700); await page.keyboard.up(k);
    continue;
  }
  // nearest monster
  let best = st.monsters[0], bd = Infinity;
  for (const m of st.monsters) { const d = (m.x - st.self.x) ** 2 + (m.y - st.self.y) ** 2; if (d < bd) { bd = d; best = m; } }
  const dx = best.x - st.self.x, dy = best.y - st.self.y;
  const keysDown = [];
  if (dx > 12) keysDown.push("KeyD"); else if (dx < -12) keysDown.push("KeyA");
  if (dy > 12) keysDown.push("KeyS"); else if (dy < -12) keysDown.push("KeyW");
  if (!keysDown.length) keysDown.push("KeyD");
  // Unstick: if the last move barely changed our position (walked into a wall toward the
  // target), juke perpendicular for a beat to get around it before resuming the chase.
  if (prevPos && Math.hypot(st.self.x - prevPos.x, st.self.y - prevPos.y) < 8) {
    stuck++;
    if (stuck >= 2) {
      const perp = Math.abs(dx) > Math.abs(dy) ? (stuck % 4 < 2 ? "KeyS" : "KeyW") : (stuck % 4 < 2 ? "KeyD" : "KeyA");
      await page.keyboard.down(perp); await sleep(500); await page.keyboard.up(perp);
      prevPos = { x: st.self.x, y: st.self.y };
      continue;
    }
  } else stuck = 0;
  prevPos = { x: st.self.x, y: st.self.y };
  for (const k of keysDown) await page.keyboard.down(k);
  await sleep(260);
  for (const k of keysDown) await page.keyboard.up(k);
}

const stf = await state();
if (stf && stf.inCombat) {
  await sleep(1200); await shot("battle-00-combat");
  await sleep(2500); await shot("battle-01-combat");
  console.log("REACHED COMBAT");
  await sleep(1500); // ensure the 2.34s entry cinematic finished (buttons inert until then)
  if (process.env.PVP_FLIP === "1") {
    // Flip the live combat to PvP rendering (c.pvp=true) to audit the PvP combat panel
    // delta (no Catch button, rival framing) without needing two clients to collide in
    // the huge world. Same panel layout; only the action row + log text differ.
    await page.evaluate(() => { const c = globalThis.__net?.state?.combat; if (c) { c.pvp = true; if (c.enemy) c.enemy.owner = "Rival"; } });
    await sleep(600); await shot("battle-pvp-panel");
  }
  if (process.env.WIN_FLIP === "1") {
    // Inject a won outcome into the live combat to render the victory state (the combat
    // log line gains "— WON! (tap/space)"); a real win needs a level/RNG edge a fresh
    // Lv.1 team rarely gets vs high-level wilds. outcome value matches server/combat.js.
    await page.evaluate(() => {
      const c = globalThis.__net?.state?.combat;
      if (c) { c.outcome = "won"; c.log = (c.log || []).concat(["The wild monster fainted! Your monster leveled up!"]); }
    });
    await sleep(600); await shot("battle-win-state");
  }
  if (process.env.PORTRAIT === "1") {
    // Flip to portrait mid-combat to audit the WIN-T3 square-window combat panel layout.
    await page.setViewportSize({ width: 480, height: 800 }); await sleep(1200);
    await shot("battle-portrait-combat");
    await page.setViewportSize({ width: 1280, height: 720 }); await sleep(800);
  }
  // Button centers in the SQUARE play window (combatButtons(): m=pw.x+12=292, attack row
  // y=556, action row y2=618; landscape 1280×720). First attack ≈ (376,583); action row
  // [Catch ≈405, Swap ≈639, Flee ≈874] all at y≈645.
  if (process.env.ATTACK === "1") {
    await page.mouse.click(376, 583);
    await sleep(900); await shot("battle-02-resolving"); // mid-resolution (Resolving… / floaters)
    await sleep(3500); await shot("battle-03-resolved"); // settled turn result + updated log
  }
  if (process.env.SWAP === "1") {
    await page.mouse.click(639, 645); // Swap → opens the bench sub-menu
    await sleep(700); await shot("battle-04-swapmenu");
  }
  if (process.env.CATCH === "1") {
    await page.mouse.click(405, 645); // Catch → spirit-chain throw/catch flow
    await sleep(1100); await shot("battle-05-catch-a");
    await sleep(2500); await shot("battle-05-catch-b");
  }
  if (process.env.FIGHT === "1") {
    // Spam the first attack until the fight resolves (enemy defeated → back to world, or
    // our monster faints). Capture the end-state (victory/level-up banner or the swap/loss).
    for (let t = 0; t < 10; t++) {
      const cs = await page.evaluate(() => { const c = globalThis.__net?.state?.combat; return { inCombat: !!c, outcome: c?.outcome || null, rr: !!globalThis.__net?.state?.roundResult }; });
      if (!cs.inCombat || cs.rr) { console.log(`fight ended at turn ${t}: rr=${cs.rr}`); break; }
      await page.mouse.click(376, 583); // first attack
      await sleep(3200);
      if (t === 0 || t === 3) await shot(`battle-06-fight-${t}`);
    }
    await sleep(1500); await shot("battle-07-fightend");
  }
}
else { await shot("battle-nomatch"); console.log("did not reach combat; inCombat:", stf ? stf.inCombat : "n/a"); }

await browser.close();
console.log("done");
