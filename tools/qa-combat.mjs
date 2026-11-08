// Combat QA against the local MOCK judge: enter a solo run, walk into a wild monster (ENCOUNTER_RADIUS=600 on
// the server makes that quick), attack until the fight ends, screenshot the end-of-fight overview; then
// fight again and CATCH. Prints the combatEnd payload (outcome / gains / caught / placement).
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:5173";
const OUT = "C:/Users/domin/AppData/Local/Temp/claude/55a526f3ad7fb144/9162f8de-10a2-4c6b-9c8d-24e83f32f241/scratchpad/shots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MOBILE = process.env.MOBILE === "1";
const b = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = MOBILE ? await b.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 1 }) : await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
const PFX = MOBILE ? "cm-" : "cd-";
p.on("pageerror", (e) => console.log("PAGEERR:", e.message));
const shot = async (n) => { await p.screenshot({ path: `${OUT}/${PFX}${n}.png` }); console.log("shot:", PFX + n); };
const st = () => p.evaluate(() => { const s = globalThis.__net?.state; const c = s?.combat; return { inCombat: !!c, outcome: c?.outcome || null, logLen: c?.log?.length || 0, gains: c?.gains || null, caught: c?.caught || null, placement: c?.placement || null, x: s?.self?.x, y: s?.self?.y }; });
await p.goto(URL + "/", { waitUntil: "networkidle" });
await p.waitForSelector("canvas", { timeout: 20000 }); await sleep(3000);
await p.click("#guestBtn").catch(() => {}); await sleep(800); await p.fill("#guest-nick", "Scout").catch(() => {}); await p.click("#guest-go").catch(() => {}); await sleep(2500);
const vp = p.viewportSize(); await p.mouse.click(vp.width / 2, vp.height - (MOBILE ? 70 : 80)); await sleep(1200);
await p.fill('input[placeholder="Character name"]', "Scout").catch(() => {}); await p.keyboard.press("Enter"); await sleep(3000);
await p.evaluate(() => window.__openStation && window.__openStation("portal")); await sleep(1200);
if (MOBILE) await p.touchscreen.tap(vp.width / 2, 140); else await p.mouse.click(640, 208);
await sleep(8000);
await p.keyboard.press("KeyD"); await sleep(800); // dismiss onboarding
const walkUntilCombat = async () => {
  const dirs = ["KeyD", "KeyS", "KeyA", "KeyW"];
  for (let i = 0; i < 40; i++) {
    const key = dirs[Math.floor(i / 5) % 4];
    await p.keyboard.down(key); await sleep(600); await p.keyboard.up(key); await sleep(300);
    const s = await st(); if (s.inCombat) return true;
    if (i % 5 === 0) console.log(`  walk ${i}: pos ${Math.round(s.x)},${Math.round(s.y)} monsters-in-view ${await p.evaluate(() => (globalThis.__net?.state?.monsters || []).length)} onboard ${await p.evaluate(() => !!document.querySelector("canvas"))}`);
  }
  return false;
};
const fight = async (mode, tag) => {
  if (!(await walkUntilCombat())) { console.log("no combat reached"); return; }
  await sleep(1500); await shot(`${tag}-0-start`);
  // PRE_COMBAT: optional JS to stage the open fight (e.g. a long attack name), then a second shot.
  if (process.env.PRE_COMBAT) { await p.evaluate((code) => { try { (0, eval)(code); } catch (e) { console.log("PRE failed", e.message); } }, process.env.PRE_COMBAT); await sleep(400); await shot(`${tag}-0-staged`); }
  for (let turn = 0; turn < (Number(process.env.MAXT) || 10); turn++) {
    const before = await st(); if (before.outcome) break;
    await p.keyboard.press(mode === "catch" ? "KeyC" : "Digit1");
    if (process.env.CPUPROF && turn === 0) { // CPU profile across the first action: top self-time functions
      const cdp = await p.context().newCDPSession(p);
      await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 500 }); await cdp.send("Profiler.start");
      await sleep(Number(process.env.CPUPROF) || 6000);
      const { profile } = await cdp.send("Profiler.stop");
      const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n]));
      const dt = profile.timeDeltas || []; const tick = new Map();
      (profile.samples || []).forEach((id, i) => tick.set(id, (tick.get(id) || 0) + (dt[i] || 0)));
      for (const [id, us] of tick) { const n = byId.get(id); const cf = n.callFrame; const key = `${cf.functionName || "(anon)"} ${cf.url.split("/").pop()}:${cf.lineNumber + 1}`; self.set(key, (self.get(key) || 0) + us); }
      // Caller chains of the hottest native call (e.g. getImageData): walk parents of its sample nodes.
      const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
      const hot = [...tick.entries()].sort((a, b) => b[1] - a[1])[0];
      if (hot) { const chains = new Map(); for (const [id, us] of tick) { if (byId.get(id).callFrame.functionName !== byId.get(hot[0]).callFrame.functionName) continue; let cur = parent.get(id), chain = []; while (cur && chain.length < 7) { const cf = byId.get(cur).callFrame; chain.push(`${cf.functionName || "(anon)"}:${cf.url.split("/").pop().split("?")[0]}:${cf.lineNumber + 1}`); cur = parent.get(cur); } const key2 = chain.join(" < "); chains.set(key2, (chains.get(key2) || 0) + us); }
        console.log("callers of", byId.get(hot[0]).callFrame.functionName); [...chains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).forEach(([c, us]) => console.log("  ", Math.round(us / 1000) + "ms", c)); }
      console.log("CPU top:"); [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).forEach(([k2, us]) => console.log("  ", Math.round(us / 1000) + "ms", k2));
    }
    if (process.env.FRAMEPROBE && turn === 0) { // rAF gap probe over the first action (a long gap = a frozen page)
      await p.evaluate(() => { window.__gaps = []; let last = performance.now(); const t0 = last; const f = () => { const n = performance.now(); window.__gaps.push(Math.round(n - last)); last = n; if (n - t0 < 4000) requestAnimationFrame(f); }; requestAnimationFrame(f); });
      await sleep(4500);
      const g = await p.evaluate(() => window.__gaps); const sorted = [...g].sort((a, b) => b - a);
      console.log("frames", g.length, "worst gaps ms", sorted.slice(0, 8).join(" "));
    }
    if (process.env.MIDSHOTS && turn === 0) { for (const ms of [350, 900, 1600]) { await sleep(ms === 350 ? 350 : ms === 900 ? 550 : 700); await shot(`${tag}-mid-${ms}`); } } // the throw / hold / resolve frames of the first action
    for (let w = 0; w < 30; w++) { await sleep(300); const s = await st(); if (s.outcome || s.logLen > before.logLen) break; }
  }
  await sleep(800);
  const end = await st(); console.log(`${tag}:`, JSON.stringify({ outcome: end.outcome, gains: end.gains, caught: end.caught && { name: end.caught.name, level: end.caught.level }, placement: end.placement }));
  await shot(`${tag}-1-end`);
  await p.keyboard.press("Space"); await sleep(1500);
};
const MODE = process.env.MODE || "attack";
await fight(MODE, MODE === "catch" ? "catch" : "win");
if (process.env.SECOND) await fight(process.env.SECOND, process.env.SECOND === "catch" ? "catch2" : "win2");
await b.close(); console.log("done");
