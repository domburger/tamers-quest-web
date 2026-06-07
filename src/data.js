// Client game-data loader. Fetches the JSON bundles and populates the shared
// engine store, then re-exports the engine accessors + stat math so existing
// imports (`from "../data.js"`) keep working unchanged. The pure logic lives in
// engine/ (gamedata, stats) so the server can reuse it without fetch/DOM.

import { setGameData } from "./engine/gamedata.js";

export async function loadGameData() {
  const files = ["attacks.json", "groundtiles.json", "item.json", "spiritchains.json"];
  const responses = await Promise.all(files.map((f) => fetch(`/assets/data/${f}`)));
  responses.forEach((r, i) => {
    if (!r.ok) throw new Error(`Failed to load ${files[i]} (HTTP ${r.status})`);
  });
  const [attacks, groundTiles, items, spiritChains] = await Promise.all(
    responses.map((r) => r.json()),
  );

  // Monster types: prefer the server's live pool (includes AI-generated, P5);
  // fall back to the static bundle (offline / static host).
  let monsterTypes;
  try {
    const r = await fetch("/api/monstertypes");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    monsterTypes = await r.json();
    if (!Array.isArray(monsterTypes) || monsterTypes.length === 0) throw new Error("empty pool");
  } catch {
    const r = await fetch("/assets/data/monstertype.json");
    if (!r.ok) throw new Error(`Failed to load monstertype.json (HTTP ${r.status})`);
    monsterTypes = await r.json();
  }
  setGameData({ monsterTypes, attacks, groundTiles, items, spiritChains });
}

// Re-exports — keep the existing import surface stable for scenes/systems.
export {
  getMonsterTypes,
  getMonsterType,
  getAttack,
  getAttacksForMonster,
  cleanAttackName,
  getGroundTiles,
  getItems,
  getSpiritChains,
  getSpiritChain,
} from "./engine/gamedata.js";
export { calcStat, getMonsterStats } from "./engine/stats.js";
