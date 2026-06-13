// Feature-scene registry (@feature lane). Gameplay-feature scenes register here
// instead of editing the @phaser-owned src/main.js bootstrap per scene: main.js
// calls installFeatureScenes(k) ONCE, and new feature scenes are added to this
// list. Keeps scene growth inside the feature lane and the bootstrap stable.
import onlineShopScene from "./onlineShop.js";
import onlineBaseUpgradesScene from "./onlineBaseUpgrades.js";
import friendsScene from "./friends.js"; // TQ-75: friends list / requests / add-block

// SP/MP unify (Phase D): the local-only shop/baseUpgrades scenes were retired — SP now opens the
// SERVER-backed onlineShop/onlineBaseUpgrades from the lobby, same as MP.
export function installFeatureScenes(k) {
  onlineShopScene(k);
  onlineBaseUpgradesScene(k); // CN-1: MP meta-upgrade UI
  friendsScene(k); // TQ-75: social — friends list, requests, presence
}
