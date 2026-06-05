// Client game-data loader. Fetches the JSON bundles and populates the shared
// engine store, then re-exports the engine accessors + stat math so existing
// imports (`from "../data.js"`) keep working unchanged. The pure logic lives in
// engine/ (gamedata, stats) so the server can reuse it without fetch/DOM.

import { setGameData } from "./engine/gamedata.js";

export async function loadGameData() {
  const [monsterRes, attackRes, tileRes, itemRes] = await Promise.all([
    fetch("/assets/data/monstertype.json"),
    fetch("/assets/data/attacks.json"),
    fetch("/assets/data/groundtiles.json"),
    fetch("/assets/data/item.json"),
  ]);

  setGameData({
    monsterTypes: await monsterRes.json(),
    attacks: await attackRes.json(),
    groundTiles: await tileRes.json(),
    items: await itemRes.json(),
  });
}

// Re-exports — keep the existing import surface stable for scenes/systems.
export {
  getMonsterTypes,
  getMonsterType,
  getAttack,
  getAttacksForMonster,
  getGroundTiles,
  getItems,
} from "./engine/gamedata.js";
export { calcStat, getMonsterStats } from "./engine/stats.js";
