// Feature-scene registry (@feature lane). Gameplay-feature scenes register here
// instead of editing the @phaser-owned src/main.js bootstrap per scene: main.js
// calls installFeatureScenes(k) ONCE, and new feature scenes are added to this
// list. Keeps scene growth inside the feature lane and the bootstrap stable.
import friendsScene from "./friends.js"; // TQ-75: friends list / requests / add-block

// The shop / base-upgrades / roster / settings / cosmetics scenes were removed on 2026-11-08: those are
// village station popups (ui/*Panel.js) now. Base Upgrades live in the Spirit Shop popup.
export function installFeatureScenes(k) {
  friendsScene(k); // TQ-75: social — friends list, requests, presence
}
