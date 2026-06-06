// Client game-data loader. Fetches the JSON bundles and populates the shared
// engine store, then re-exports the engine accessors + stat math so existing
// imports (`from "../data.js"`) keep working unchanged. The pure logic lives in
// engine/ (gamedata, stats) so the server can reuse it without fetch/DOM.

import { setGameData } from "./engine/gamedata.js";

export async function loadGameData() {
  const files = [
    "monstertype.json",
    "attacks.json",
    "groundtiles.json",
    "item.json",
  ];
  const responses = await Promise.all(
    files.map((f) => fetch(`/assets/data/${f}`))
  );
  responses.forEach((r, i) => {
    if (!r.ok) throw new Error(`Failed to load ${files[i]} (HTTP ${r.status})`);
  });

  const [monsterTypes, attacks, groundTiles, items] = await Promise.all(
    responses.map((r) => r.json())
  );
  setGameData({ monsterTypes, attacks, groundTiles, items });
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
