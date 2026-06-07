import kaboom from "./compat/kaboomShim.js";
import { loadGameData, getMonsterTypes } from "./data.js";
import {
  generateMonsterSprite,
  generatePlayerSprite,
  generateCombatBackground,
  generateMenuBackground,
} from "./systems/spritegen.js";
import startScene from "./scenes/start.js";
import characterSelectScene from "./scenes/characterSelect.js";
import lobbyScene from "./scenes/lobby.js";
import inventoryScene from "./scenes/inventory.js";
import loadingScene from "./scenes/loading.js";
import gameScene from "./scenes/game.js";
import fightScene from "./scenes/fight.js";
import runResultScene from "./scenes/runResult.js";
import settingsScene from "./scenes/settings.js";
import onlineLobbyScene from "./scenes/onlineLobby.js";
import onlineGameScene from "./scenes/onlineGame.js";
import bestiaryScene from "./scenes/bestiary.js";
import rosterScene from "./scenes/roster.js";
import cosmeticsScene from "./scenes/cosmetics.js";
import { installFeatureScenes } from "./scenes/featureScenes.js";
import { setGuestProfile } from "./storage.js";

const k = kaboom({
  width: 1280,
  height: 720,
  letterbox: true,
  background: [18, 20, 27], // THEME.bg — dark cave flat
  global: false,
  crisp: true,
  // Note: the Phaser shim (compat/kaboomShim.js) renders at the screen's real
  // device pixel ratio itself, so HiDPI sharpness is handled there — no
  // pixelDensity option here.
});

// Loading screen while assets load
k.add([
  k.text("Loading...", { size: 32 }),
  k.pos(k.width() / 2, k.height() / 2),
  k.anchor("center"),
  k.color(236, 239, 244),
]);

async function init() {
  // Load game data from JSON
  await loadGameData();

  // Fonts: Electrolize = primary (everywhere, incl. the HTML title); Fredoka =
  // smaller/secondary text. `gameFont` is the alias every scene already references.
  k.loadFont("gameFont", "/assets/font/electrolize-400.woff2");
  k.loadFont("gameFontBody", "/assets/font/fredoka-400.woff2");

  // Procedurally generated UI textures (no PNGs). The title screen is now pure
  // HTML (index.html) — no procedural title background/border sprites.
  k.loadSprite("combat_background", generateCombatBackground());
  k.loadSprite("menu_background", generateMenuBackground());
  k.loadSprite("player", generatePlayerSprite());

  // Procedurally generated monster sprites — registered under the same names
  // the scenes already reference (typeName slug).
  const monsterTypes = getMonsterTypes();
  for (const mt of monsterTypes) {
    const spriteName = mt.typeName.toLowerCase().replace(/\s+/g, "_");
    k.loadSprite(spriteName, generateMonsterSprite(mt));
  }

  // Register all scenes
  startScene(k);
  characterSelectScene(k);
  lobbyScene(k);
  inventoryScene(k);
  loadingScene(k);
  gameScene(k);
  fightScene(k);
  runResultScene(k);
  settingsScene(k);
  onlineLobbyScene(k);
  onlineGameScene(k);
  bestiaryScene(k);
  rosterScene(k);
  cosmeticsScene(k);
  installFeatureScenes(k); // @feature lane: registers shop/onlineShop (+ future feature scenes)

  // The title screen is the HTML overlay (index.html). Buttons there call
  // window.tqGo(dest) to launch a Phaser scene; the "start" scene re-shows the
  // overlay (via the tq:title event) so in-game "Back" returns to the title.
  window.tqGo = (dest) => { try { k.go(dest); } catch (e) { console.warn("tqGo", dest, e); } };

  // FLOW screen 1: the HTML title's "Play as guest" path calls this with the
  // chosen nickname before routing to character select, so the local profile is
  // marked as a guest (isGuest:true) with that nickname.
  window.tqGuest = (nickname) => { try { setGuestProfile(nickname); } catch (e) { console.warn("tqGuest", e); } };

  // Boot to the (now minimal) start scene; the HTML title overlay covers it.
  k.go("start");
}

// Register the service worker in production (enables PWA install + offline shell).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("SW register failed", e));
  });
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
