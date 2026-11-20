// Shim has no clip region: callers must cull every element to the minimap window.

export function minimapSize(W, H) {
  return Math.max(120, Math.min(200, Math.round(Math.min(W, H) * 0.3)));
}

export const MINIMAP_ZOOM_LEVELS = [1, 2, 4];

export function nextMinimapZoom(z) {
  const i = MINIMAP_ZOOM_LEVELS.indexOf(z);
  return MINIMAP_ZOOM_LEVELS[(i + 1) % MINIMAP_ZOOM_LEVELS.length];
}

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
    project: (tx, ty) => ({ x: mmX + (tx - ox) * scale, y: mmY + (ty - oy) * scale }),
    inWindow: (tx, ty) => tx >= ox && tx <= ox + win && ty >= oy && ty <= oy + win,
    cellVisible: (tx, ty, step = 1) =>
      Z === 1 || (tx >= ox && tx <= ox + win - step && ty >= oy && ty <= oy + win - step),
  };
}
