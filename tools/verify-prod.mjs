// One-off production verification (@visual): confirm the headline flow actually
// renders for a real user on the LIVE site (tamersquest.com), not just local HEAD.
// Read-only (guest login is client-side localStorage). Screenshots title + lobby.
//
// Also an ACCEPTANCE CHECK for AUTH-T1 (the @phaser login-button wiring, board #10):
// reports whether "Continue with Google" actually navigates to the live /auth/google
// backend (WIRED) or is still the "coming soon" placeholder (INERT). The three auth
// backends are prod-verified live; this watches for the UI to catch up.
import { chromium } from "playwright";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = process.env.PROD_URL || "https://tamersquest.com/";
const b = await chromium.launch();
const p = await b.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push("PAGEERR " + e.message));
p.on("console", (m) => { if (m.type() === "error") errs.push("CONSOLE " + m.text()); });
await p.goto(URL, { waitUntil: "networkidle" });
await sleep(3500);
await p.screenshot({ path: ".screenshots/prod-1-title.png" });
// headline #1: title should expose guest entry, not SP/MP
const hasGuest = await p.$("#guestBtn") != null;
const titleTxt = await p.evaluate(() => document.body.innerText.slice(0, 400));
console.log("PROD URL:", URL);
console.log("has #guestBtn:", hasGuest);
console.log("title text:", JSON.stringify(titleTxt.replace(/\s+/g, " ").trim().slice(0, 200)));
// AUTH-T1 acceptance: does "Continue with Google" reach the live OAuth backend?
let loginWiring = "no-button";
const gBtn = await p.$('[data-login="Google"]');
if (gBtn) {
  await gBtn.click().catch(() => {});
  await sleep(1800);
  const u = p.url();
  loginWiring = u.includes("accounts.google.com") ? "WIRED → redirects to accounts.google.com"
    : (u.startsWith(URL) ? "INERT (still on title — placeholder toast)" : "unexpected: " + u);
  await p.goto(URL, { waitUntil: "networkidle" }).catch(() => {}); // reset for the guest test
  await sleep(2500);
}
console.log("AUTH-T1 login-button wiring:", loginWiring);
// try guest login → lobby (headline #2)
await p.click("#guestBtn").catch(() => {});
await sleep(600);
await p.fill("#guest-nick", "ProdCheck").catch(() => {});
await sleep(200);
await p.click("#guest-go").catch(() => {});
await sleep(2500);
await p.screenshot({ path: ".screenshots/prod-2-afterguest.png" });
const guestState = await p.evaluate(() => { try { return JSON.parse(localStorage.getItem("tamers_quest_save"))?.profile || null; } catch { return null; } });
console.log("guest profile after login:", JSON.stringify(guestState));
console.log("page errors:", errs.length ? errs.slice(0, 6) : "none");
await b.close();
