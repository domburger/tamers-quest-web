// Feature-scene registry (@feature lane). Gameplay-feature scenes register here
// instead of editing the @phaser-owned src/main.js bootstrap per scene: main.js
// calls installFeatureScenes(k) ONCE, and new feature scenes are added to this
// list. Keeps scene growth inside the feature lane and the bootstrap stable.
import shopScene from "./shop.js";
import onlineShopScene from "./onlineShop.js";
import baseUpgradesScene from "./baseUpgrades.js";
import onlineBaseUpgradesScene from "./onlineBaseUpgrades.js";

export function installFeatureScenes(k) {
  shopScene(k);
  onlineShopScene(k);
  baseUpgradesScene(k);
  onlineBaseUpgradesScene(k); // CN-1: MP meta-upgrade UI
}
