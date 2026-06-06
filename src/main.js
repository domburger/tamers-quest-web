import kaboom from "kaboom";
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

const k = kaboom({
  width: 1280,
  height: 720,
  letterbox: true,
  background: [10, 10, 18],
  global: false,
  crisp: true,
});

// Loading screen while assets load
k.add([
  k.text("Loading...", { size: 32 }),
  k.pos(k.width() / 2, k.height() / 2),
  k.anchor("center"),
  k.color(200, 200, 200),
]);

async function init() {
  // Load game data from JSON
  await loadGameData();

  // Load fonts
  k.loadFont("gameFont", "/assets/font/ChakraPetch-Bold.ttf");

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

  // Start
  k.go("start");
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
