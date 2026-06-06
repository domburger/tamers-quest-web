import kaboom from "./compat/kaboomShim.js";
import { loadGameData, getMonsterTypes } from "./data.js";
import {
  generateMonsterSprite,
  generatePlayerSprite,
  generateTitleBackground,
  generateTitleBorder,
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
import shopScene from "./scenes/shop.js";

const k = kaboom({
  width: 1280,
  height: 720,
  letterbox: true,
  background: [18, 20, 27], // THEME.bg — dark cave flat
  global: false,
  crisp: true,
  // Render the backing buffer at the screen's real pixel density so text and
  // shapes stay sharp on HiDPI / scaled displays instead of being upscaled blurry.
  pixelDensity: Math.min(3, Math.max(2, Math.ceil(window.devicePixelRatio || 1))),
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

  // Fonts — standardized on Chakra Petch (sharp, modern, fits the sci-fi/cave
  // theme). Bold = display/headings/buttons; Regular = body/secondary text.
  k.loadFont("gameFont", "/assets/font/ChakraPetch-Bold.ttf");
  k.loadFont("gameFontBody", "/assets/font/ChakraPetch-Regular.ttf");

  // Procedurally generated UI textures (no PNGs)
  k.loadSprite("title_background", generateTitleBackground());
  k.loadSprite("title_background_border", generateTitleBorder());
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
  shopScene(k);

  // Start
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
