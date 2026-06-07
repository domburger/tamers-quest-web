// Shared minimap windowed-zoom math (PT1-T24, BUILD-THESE-FIRST #6). Pure and
// frame-agnostic so the single-player radar (`scenes/game.js`) and the multiplayer
// radar (`scenes/onlineGame.js`) compute the SAME tile→box transform and can't drift
// — the "fix once" rule the rest of the engine follows (inventory/progression).
//
// The Phaser compat shim has NO clip region, so callers must cull every element to the
// window by hand; this module returns the predicates to do that. Coordinates are in
// TILE space (worldPixels / tileSize); the box is `mmSize` px at top-left (mmX, mmY).

/**
 * Build the minimap view transform for a zoom level.
 *
 * At `zoom === 1` the whole map fits the box (ox=oy=0, scale=mmSize/mapSize) and every
 * cull passes — i.e. 1× is byte-identical to an un-zoomed full-map draw. At `zoom > 1`
 * a player-centered window of `mapSize/zoom` tiles is shown, its origin clamped to
 * `[0, mapSize-win]` so the edges never reveal out-of-bounds.
 *
 * @param {object} o
 * @param {number} o.mapSize        map edge length in tiles
 * @param {number} o.mmSize         minimap edge length in px
 * @param {number} [o.mmX=0]        minimap box top-left x (caller space)
 * @param {number} [o.mmY=0]        minimap box top-left y
 * @param {number} [o.zoom=1]       zoom factor (clamped to >= 1)
 * @param {number} [o.playerTileX=0] player x in TILE coords (worldX / tileSize)
 * @param {number} [o.playerTileY=0] player y in TILE coords
 * @returns {{
 *   zoom:number, scale:number, win:number, ox:number, oy:number,
 *   projectX:(tx:number)=>number, projectY:(ty:number)=>number,
 *   project:(tx:number,ty:number)=>{x:number,y:number},
 *   inWindow:(tx:number,ty:number)=>boolean,
 *   cellVisible:(tx:number,ty:number,step?:number)=>boolean,
 * }}
 */
export function minimapWindow({ mapSize, mmSize, mmX = 0, mmY = 0, zoom = 1, playerTileX = 0, playerTileY = 0 }) {
  const Z = Math.max(1, zoom || 1);
  const scale = (mmSize / mapSize) * Z;
  const win = mapSize / Z;
  const clampOrigin = (p) => Math.max(0, Math.min(mapSize - win, p - win / 2));
  const ox = clampOrigin(playerTileX);
  const oy = clampOrigin(playerTileY);
  return {
    zoom: Z,
    scale,
    win,
    ox,
    oy,
    projectX: (tx) => mmX + (tx - ox) * scale,
    projectY: (ty) => mmY + (ty - oy) * scale,
    project: (tx, ty) => ({ x: mmX + (tx - ox) * scale, y: mmY + (ty - oy) * scale }),
    // Point-like blips (player, portals, chests): visible if inside the window box.
    inWindow: (tx, ty) => tx >= ox && tx <= ox + win && ty >= oy && ty <= oy + win,
    // Stepped terrain cells span `step` tiles, so tighten by one cell — a filled rect
    // must never spill past the box edge (the shim can't clip it). At 1× always true,
    // so the full-map draw is unchanged regardless of mapSize parity.
    cellVisible: (tx, ty, step = 1) =>
      Z === 1 || (tx >= ox && tx <= ox + win - step && ty >= oy && ty <= oy + win - step),
  };
}
