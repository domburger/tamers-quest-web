// Robust nav for the current flow. Waits on the HTML title's .hidden transition
// (set when any scene launches) instead of fixed sleeps, then steps through the
// canvas scenes with generous settles. toLobby() stops at the lobby; toGame()
// continues into a single-player run.
async function leftTitle(p){ await p.waitForFunction(()=>{const t=document.getElementById('title');return t&&t.classList.contains('hidden');},{timeout:15000}); }
export async function toLobby(p, sleep, name="Aria") {
  await p.goto("http://localhost:5173/",{waitUntil:"networkidle"});
  await p.waitForSelector('#guestBtn',{state:'visible',timeout:15000}); await sleep(700);
  await p.click('#guestBtn');
  await p.waitForSelector('#guest-nick',{state:'visible',timeout:8000}); await sleep(200);
  await p.fill('#guest-nick',name); await p.click('#guest-go');
  await leftTitle(p); await sleep(2000);                                  // -> characterSelect
  await p.mouse.click(640, 640); await sleep(800);                        // + New Character
  await p.fill('input[placeholder="Character name"]', name).catch(()=>{}); await sleep(200);
  await p.keyboard.press("Enter"); await sleep(1800);                     // create -> slot
  await p.mouse.click(640, 130); await sleep(1800);                       // slot -> lobby
}
export async function toGame(p, sleep) {
  await toLobby(p, sleep);
  await p.mouse.click(230, 190); await sleep(1200);                       // Play -> picker
  // Picker (lobby.js): modal centred at (cx=640, my=Hh/2=360); Singleplayer
  // button at y = my-60 = 300 (h=48). Earlier 330 landed in the gap below it.
  await p.mouse.click(640, 300); await sleep(8000);                      // Singleplayer -> loading -> game
}
