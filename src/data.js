import { setGameData } from "./engine/gamedata.js";

export async function loadGameData() {
  const files = ["attacks.json", "groundtiles.json", "item.json", "spiritchains.json"];
  const responses = await Promise.all(files.map((f) => fetch(`/assets/data/${f}`)));
  responses.forEach((r, i) => {
    if (!r.ok) throw new Error(`Failed to load ${files[i]} (HTTP ${r.status})`);
  });
  const [attacks, staticTiles, items, spiritChains] = await Promise.all(
    responses.map((r) => r.json()),
  );

  const [monsterTypes, groundTiles, biomes] = await Promise.all([
    (async () => {
      try {
        const r = await fetch("/api/monstertypes");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const mt = await r.json();
        if (!Array.isArray(mt) || mt.length === 0) throw new Error("empty pool");
        return mt;
      } catch {
        const r = await fetch("/assets/data/monstertype.json");
        if (!r.ok) throw new Error(`Failed to load monstertype.json (HTTP ${r.status})`);
        return r.json();
      }
    })(),
    (async () => {
      try {
        const r = await fetch("/api/groundtiles");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const pool = await r.json();
        if (Array.isArray(pool) && pool.length) return pool;
        return staticTiles;
      } catch (e) {
        console.warn("[data] /api/groundtiles failed; using static tiles — map may differ from server:", e?.message || e);
        return staticTiles;
      }
    })(),
    (async () => {
      try {
        const r = await fetch("/api/biomes");
        if (r.ok) { const pool = await r.json(); return Array.isArray(pool) ? pool : []; }
        throw new Error(`HTTP ${r.status}`);
      } catch (e) {
        console.warn("[data] /api/biomes failed; using built-in biomes — map may differ from server:", e?.message || e);
        return [];
      }
    })(),
  ]);

  setGameData({ monsterTypes, attacks, groundTiles, items, spiritChains, biomes });
}

export { getMonsterTypes, cleanAttackName, getSpiritChain } from "./engine/gamedata.js";
