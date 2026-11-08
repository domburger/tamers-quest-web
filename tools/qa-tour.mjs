// Baseline UI tour: title → guest → char create → hub → every station popup + every tqGo scene, at desktop
// and phone-portrait. Writes PNGs to the scratch shots dir (prefix via PFX).
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:5173";
const OUT = "C:/Users/domin/AppData/Local/Temp/claude/55a526f3ad7fb144/9162f8de-10a2-4c6b-9c8d-24e83f32f241/scratchpad/tour";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MOBILE = process.env.MOBILE === "1";
const b = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = MOBILE ? await b.newContext({ ...devices["iPhone 13"], deviceScaleFactor: Number(process.env.DSF) || 1 }) : await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
const PFX = MOBILE ? "m-" : "d-";
p.on("pageerror", (e) => console.log("PAGEERR:", e.message));
const shot = async (n) => { await p.screenshot({ path: `${OUT}/${PFX}${n}.png` }); console.log("shot:", PFX + n); };
const tap = async (x, y) => { if (MOBILE) await p.touchscreen.tap(x, y); else await p.mouse.click(x, y); };
await p.goto(URL + "/", { waitUntil: "networkidle" });
await p.waitForSelector("canvas", { timeout: 20000 }); await sleep(3500);
await shot("00-title");
if (MOBILE) await p.tap("#guestBtn").catch(() => {}); else await p.click("#guestBtn").catch(() => {});
await sleep(800); await shot("01-guest-modal");
await p.fill("#guest-nick", "Scout").catch(() => {});
if (MOBILE) await p.tap("#guest-go").catch(() => {}); else await p.click("#guest-go").catch(() => {});
await sleep(2500); await shot("02-charselect");
const vp = p.viewportSize();
await tap(vp.width / 2, vp.height - (MOBILE ? 70 : 80)); await sleep(1200); await shot("03-charcreate");
await p.fill('input[placeholder="Character name"]', "Scout").catch(() => {});
await p.keyboard.press("Enter"); await sleep(3000); await shot("04-hub");
const charId = await p.evaluate(() => { try { return JSON.parse(localStorage.getItem("tamers_quest_save")).characters[0].id; } catch { return null; } });
for (const id of ["shop", "vault", "bestiary", "cosmetics", "battlepass", "settings", "profile", "market", "portal"]) {
  await p.evaluate((sid) => window.__openStation && window.__openStation(sid), id); await sleep(1500);
  await shot(`10-popup-${id}`);
  await p.evaluate(() => window.__closeStation && window.__closeStation()); await sleep(500);
  if (await p.evaluate(() => window.__stationPopupId && window.__stationPopupId())) { await p.keyboard.press("Escape"); await sleep(400); }
}
// account dropdown (avatar badge)
const av = await p.evaluate(() => window.__avatarBadge && window.__avatarBadge());
if (av) { const pt = await p.evaluate(([x, y]) => (window.__designToPage ? window.__designToPage(x, y) : null), [av.x, av.y]); if (pt) { await tap(pt.x, pt.y); await sleep(800); await shot("11-account-menu"); await p.keyboard.press("Escape"); await sleep(400); } }
for (const scene of ["roster", "bestiary", "cosmetics", "settings", "profile", "onlineShop", "onlineBaseUpgrades", "friends", "account", "lobby"]) {
  const ok = await p.evaluate(([s, cid]) => { try { window.tqGo(s, { characterId: cid, backScene: "hub" }); return true; } catch (e) { return String(e); } }, [scene, charId]);
  await sleep(1800); await shot(`20-scene-${scene}`); if (ok !== true) console.log("tqGo", scene, ok);
}
await b.close(); console.log("done");
