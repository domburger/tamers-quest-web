import { loadGameData, getMonsterTypes } from "./data.js";
import {
  generateMonsterSprite,
  generateMenuBackground,
} from "./systems/spritegen.js";
import startScene from "./scenes/start.js";
import characterSelectScene from "./scenes/characterSelect.js";
import hubScene from "./scenes/hub.js";
import onlineGameScene from "./scenes/onlineGame.js";
import bestiaryScene from "./scenes/bestiary.js";
import profileScene from "./scenes/profile.js";
import accountScene from "./scenes/account.js";
import { slugOf } from "./render/monster.js";
import { hasHtmlModel } from "./systems/htmlModel.js";
import { installFeatureScenes } from "./scenes/featureScenes.js";
import { setGuestProfile, setAuthedProfile, setProfileNickname, clearGuestCharacters, clearProfile, markSession, resolveSessionPersistence } from "./storage.js";
import { TOKEN_KEY } from "./net.js";
import { net } from "./netClient.js";
import { initAutoReload } from "./systems/autoReload.js";
import { initTitleGamepad } from "./systems/titleGamepad.js";
import { makeCanvasShim } from "./compat/canvasShim.js";

const k = makeCanvasShim();
k.start({ hideTitle: false, zIndex: "0" });
try { initTitleGamepad(); } catch (e) { console.warn("titleGamepad", e); }

async function init() {
  await loadGameData();

  k.loadFont("gameFont", "/assets/font/fredoka-500.woff2");
  k.loadFont("gameFontBody", "/assets/font/fredoka-400.woff2");
  k.loadFont("gameFontBold", "/assets/font/fredoka-600.woff2");

  k.loadSprite("menu_background", generateMenuBackground());

  startScene(k);
  characterSelectScene(k);
  hubScene(k);
  onlineGameScene(k);
  bestiaryScene(k);
  profileScene(k);
  accountScene(k);
  installFeatureScenes(k);

  // window.tq* hooks are called from index.html; keep names and signatures.
  window.tqGo = (dest, args) => { try { k.go(dest, args); } catch (e) { console.warn("tqGo", dest, e); } };

  if (!import.meta.env.DEV) {
    const seen = new Set(); let budget = 6;
    const beacon = (message, stack) => {
      try {
        const msg = String(message || "(unknown)").slice(0, 300);
        if (budget <= 0 || seen.has(msg)) return;
        seen.add(msg); budget--;
        const body = JSON.stringify({ message: msg, stack: String(stack || "").slice(0, 1200), url: location.pathname + location.hash, scene: (k._lastGo && k._lastGo.name) || "", ua: navigator.userAgent.slice(0, 160), build: (document.querySelector('script[src*="/assets/index-"]')?.getAttribute("src") || "").match(/index-([A-Za-z0-9_-]+)\.js/)?.[1] || "" });
        if (navigator.sendBeacon) navigator.sendBeacon("/api/clienterror", new Blob([body], { type: "application/json" }));
        else fetch("/api/clienterror", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
      } catch {}
    };
    window.addEventListener("error", (e) => beacon(e.message || (e.error && e.error.message), e.error && e.error.stack));
    window.addEventListener("unhandledrejection", (e) => { const r = e.reason; beacon("unhandledrejection: " + ((r && r.message) || String(r)), r && r.stack); });
  }

  window.tqGuest = (nickname) => { try { setGuestProfile(nickname); } catch (e) { console.warn("tqGuest", e); } };

  window.tqAuthed = (token, nickname, accountSession, remember) => {
    try {
      const keep = remember !== false;
      setAuthedProfile(token, nickname, accountSession, keep);
      markSession(keep);
      if (token) localStorage.setItem(TOKEN_KEY, token);
    } catch (e) { console.warn("tqAuthed", e); }
  };

  window.tqSetNickname = (nickname) => {
    try { setProfileNickname(nickname); } catch (e) { console.warn("tqSetNickname", e); }
  };

  window.tqSignOut = () => {
    try { net.clearSession(); } catch {}
    try { clearProfile(); } catch (e) { console.warn("tqSignOut", e); }
  };

  try { clearGuestCharacters(); } catch {}

  const path = (() => { try { return location.pathname; } catch { return "/"; } })();
  if (path === "/bestiary" || path === "/bestiary/") {
    const admin = (() => { try { return !!localStorage.getItem("tq_admin_token"); } catch { return false; } })();
    try { const t = document.getElementById("title"); if (t) { t.classList.add("hidden"); t.style.display = "none"; } } catch {}
    k.go("bestiary", { admin });
    return;
  }

  // Must run before anything below reads the profile.
  try { resolveSessionPersistence(); } catch {}

  // index.html sets __tqLaunching for a pending tqGo; don't re-show the title over it.
  if (!window.__tqLaunching) k.go("start");

  warmMonsterSprites();
}

function warmMonsterSprites() {
  const types = getMonsterTypes().filter((mt) => mt && !hasHtmlModel(mt));
  const raf = (typeof requestAnimationFrame === "function") ? requestAnimationFrame : (cb) => setTimeout(cb, 16);
  const CHUNK = 6;
  let i = 0;
  const step = () => {
    const end = Math.min(i + CHUNK, types.length);
    for (; i < end; i++) {
      const mt = types[i];
      try { k.loadSprite(slugOf(mt.typeName), generateMonsterSprite(mt)); } catch {}
    }
    if (i < types.length) raf(step);
  };
  raf(step);
}

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("SW register failed", e));
  });
}

if (import.meta.env.PROD) {
  try { initAutoReload({ getInRun: () => net.state.phase === "in_round" }); } catch (e) { console.warn("autoReload", e); }
}

init().catch((err) => {
  console.error("Tamers Quest failed to start:", err);
  k.add([
    k.text("Failed to load game data.\nCheck the console and refresh.", {
      size: 24,
      align: "center",
    }),
    k.pos(k.width() / 2, k.height() / 2),
    k.anchor("center"),
    k.color(255, 100, 100),
  ]);
});
