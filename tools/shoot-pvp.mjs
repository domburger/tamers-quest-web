// Two-client PvP: two guest contexts both join MULTIPLAYER (same match via the 5s
// countdown), then walk toward each other (read positions via dev __net) until they
// collide within pvpRadius (40) and a PvP duel starts. Screenshots the PvP combat.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const URL = process.env.GAME_URL || "http://localhost:8080";
const OUT = ".screenshots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

async function mkClient(nick) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`[${nick}] PAGEERR:`, e.message));
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas", { timeout: 15000 });
  return page;
}

const state = (page) => page.evaluate(() => {
  try {
    const n = globalThis.__net; if (!n || !n.state) return null;
    const s = n.state;
    return { self: s.self ? { x: s.self.x, y: s.self.y } : null, seed: s.seed ?? null,
      pid: s.playerId || null, players: (s.players || []).map((p) => ({ x: p.x, y: p.y })),
      inPvp: !!(s.combat && s.combat.pvp), inCombat: !!s.combat };
  } catch { return null; }
});

// Nav a client from title to the MP world. Returns after the Multiplayer click.
async function navToMP(page, nick) {
  await sleep(7000);
  await page.click("#guestBtn"); await sleep(500);
  await page.fill("#guest-nick", nick); await page.click("#guest-go"); await sleep(2000);
  await page.mouse.click(640, 640); await sleep(1100);
  await page.fill('input[placeholder="Character name"]', nick); await sleep(250);
  await page.press('input[placeholder="Character name"]', "Enter"); await sleep(2000);
  await page.mouse.click(640, 130); await sleep(2200);   // first char slot → lobby
  await page.mouse.click(230, 190); await sleep(800);    // Play
}

const [pA, pB] = await Promise.all([mkClient("Duelist"), mkClient("Rival")]);
await Promise.all([navToMP(pA, "Duelist"), navToMP(pB, "Rival")]);
// Click Multiplayer on BOTH within the 5s countdown window so they share a match.
await Promise.all([pA.mouse.click(640, 380), pB.mouse.click(640, 380)]);
console.log("both clicked Multiplayer; waiting for the round to spawn...");
await sleep(9000);
// Dismiss onboarding on both.
for (const p of [pA, pB]) { await p.keyboard.down("KeyD"); await sleep(250); await p.keyboard.up("KeyD"); }
await sleep(600);

const sA = await state(pA), sB = await state(pB);
console.log("A:", sA && sA.self ? `${Math.round(sA.self.x)},${Math.round(sA.self.y)} seed=${sA.seed}` : "none",
  "| B:", sB && sB.self ? `${Math.round(sB.self.x)},${Math.round(sB.self.y)} seed=${sB.seed}` : "none");
if (!sA?.self || !sB?.self || sA.seed == null || sB.seed == null) {
  await pA.screenshot({ path: `${OUT}/pvp-notinworld.png` }); console.log("not both in world"); await browser.close(); process.exit(0);
}
if (sA.seed !== sB.seed) console.log("WARN: different seeds — not in the same match!");

// Drive A toward B and B toward A until a duel starts (read live positions each step).
let done = false;
for (let step = 0; step < 80 && !done; step++) {
  const a = await state(pA), b = await state(pB);
  if (!a?.self || !b?.self) break;
  if (a.inPvp || b.inPvp) { done = true; break; }
  const walk = async (page, from, to) => {
    const dx = to.x - from.x, dy = to.y - from.y;
    const ks = [];
    if (dx > 10) ks.push("KeyD"); else if (dx < -10) ks.push("KeyA");
    if (dy > 10) ks.push("KeyS"); else if (dy < -10) ks.push("KeyW");
    if (!ks.length) ks.push("KeyD");
    for (const k of ks) await page.keyboard.down(k);
    await sleep(220);
    for (const k of ks) await page.keyboard.up(k);
  };
  await Promise.all([walk(pA, a.self, b.self), walk(pB, b.self, a.self)]);
  if (step % 10 === 0) console.log(`step ${step}: A=${Math.round(a.self.x)},${Math.round(a.self.y)} B=${Math.round(b.self.x)},${Math.round(b.self.y)} d=${Math.round(Math.hypot(a.self.x-b.self.x, a.self.y-b.self.y))}`);
}

const fa = await state(pA);
if (fa?.inPvp) {
  await sleep(1500); await pA.screenshot({ path: `${OUT}/pvp-00-duel-A.png` });
  await pB.screenshot({ path: `${OUT}/pvp-01-duel-B.png` });
  console.log("PVP DUEL REACHED");
} else {
  await pA.screenshot({ path: `${OUT}/pvp-nomatch.png` });
  console.log("no duel; A.inPvp:", fa?.inPvp, "inCombat:", fa?.inCombat);
}
await browser.close();
console.log("done");
