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
  const [attacks, staticTiles, items, spiritChains] = await Promise.all(
    responses.map((r) => r.json()),
  );

  // The three live-pool endpoints below are INDEPENDENT (no data dependency on each other), so fetch
  // them in PARALLEL instead of three sequential awaits — boot data-load latency drops from the SUM of
  // the round-trips to the SLOWEST one (faster time-to-interactive). Each keeps its own try/catch +
  // fallback, so the failure semantics are byte-identical; only the network waits overlap.
  const [monsterTypes, groundTiles, biomes] = await Promise.all([
    // Monster types: prefer the server's live pool (includes AI-generated, P5); fall back to the static
    // bundle (offline / static host). A failing fallback rejects → loadGameData rejects (fatal, as before).
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
    // Ground tiles: prefer the server's live pool (seed + AI-generated) so the client regenerates the
    // SAME deterministic map (mapgen reads the tile pool); fall back to the static bundle. The server
    // returns the seed tiles in the same file order + generated appended, so the WFC inputs match.
    (async () => {
      try {
        const r = await fetch("/api/groundtiles");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const pool = await r.json();
        if (Array.isArray(pool) && pool.length) return pool;
        return staticTiles; // ok but empty/non-array → keep the static bundle (no warn, as before)
      } catch (e) {
        // Falling back to the static bundle. If the server has GENERATED tiles, its tile pool now
        // differs from ours → mapgen selects different tiles for the same seed, which can shift
        // collidable (water) tiles and cause prediction rubberbanding near them (the server stays
        // authoritative, so it self-corrects). Warn so this is diagnosable.
        console.warn("[data] /api/groundtiles failed; using static tiles — map may differ from server:", e?.message || e);
        return staticTiles;
      }
    })(),
    // Generated biomes: augment the built-in BIOME_DEFS baseline (mapgen concatenates them). Empty (or
    // unreachable) → mapgen just uses the built-ins. Best-effort; never fatal.
    (async () => {
      try {
        const r = await fetch("/api/biomes");
        if (r.ok) { const pool = await r.json(); return Array.isArray(pool) ? pool : []; }
        throw new Error(`HTTP ${r.status}`);
      } catch (e) {
        // Same determinism caveat as tiles above: a biome-pool mismatch shifts per-region tile
        // selection. Built-in biomes only; warn so a "walls don't match" report is traceable.
        console.warn("[data] /api/biomes failed; using built-in biomes — map may differ from server:", e?.message || e);
        return [];
      }
    })(),
  ]);

  setGameData({ monsterTypes, attacks, groundTiles, items, spiritChains, biomes });
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
