// TQ-374: bake an item's authored VISUAL (the shape-layer paint spec from src/systems/itemModel.js,
// already validated + clamped by coerceItemVisual) into a small transparent ICON canvas. Mirrors
// render/tiles.js generateTileTexture: import-free + DOM-only-at-call-time, so the server can also
// serve this module verbatim at /admin/itemIcon.js for the admin preview (the prod-safe pattern,
// TQ-370). Geometry in the layers is normalized 0..1 of the icon box; we scale by S here.
function makeCanvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

function paintLayer(ctx, l, S) {
  const x = l.cx * S, y = l.cy * S;
  ctx.fillStyle = rgba(l.color, l.opacity);
  ctx.strokeStyle = rgba(l.color, l.opacity);
  switch (l.type) {
    case "disc":
      ctx.beginPath(); ctx.arc(x, y, l.r * S, 0, Math.PI * 2); ctx.fill(); break;
    case "ring":
      ctx.lineWidth = Math.max(1, l.width * S);
      ctx.beginPath(); ctx.arc(x, y, l.r * S, 0, Math.PI * 2); ctx.stroke(); break;
    case "roundrect": {
      const w = l.w * S, h = l.h * S, r = Math.min(l.radius * Math.min(w, h), w / 2, h / 2);
      const lft = x - w / 2, top = y - h / 2;
      ctx.beginPath();
      ctx.moveTo(lft + r, top);
      ctx.arcTo(lft + w, top, lft + w, top + h, r);
      ctx.arcTo(lft + w, top + h, lft, top + h, r);
      ctx.arcTo(lft, top + h, lft, top, r);
      ctx.arcTo(lft, top, lft + w, top, r);
      ctx.closePath(); ctx.fill(); break;
    }
    case "bar": {
      const w = l.w * S, h = l.h * S;
      ctx.save(); ctx.translate(x, y); ctx.rotate((l.angle || 0) * Math.PI / 180);
      ctx.fillRect(-w / 2, -h / 2, w, h); ctx.restore(); break;
    }
    case "diamond": {
      const r = l.r * S;
      ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill(); break;
    }
    case "triangle": {
      const r = l.r * S;
      ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.87, y + r * 0.5); ctx.lineTo(x - r * 0.87, y + r * 0.5); ctx.closePath(); ctx.fill(); break;
    }
    case "sparkle": {
      const r = l.r * S, t = r * 0.32; // 4-point star: two crossed kite shapes
      ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + t, y - t); ctx.lineTo(x + r, y); ctx.lineTo(x + t, y + t);
      ctx.lineTo(x, y + r); ctx.lineTo(x - t, y + t); ctx.lineTo(x - r, y); ctx.lineTo(x - t, y - t); ctx.closePath(); ctx.fill(); break;
    }
    default: break;
  }
}

// Returns a freshly baked <canvas> with the item's visual layers painted on transparent, or null when
// the item carries no usable visual (caller falls back to a text-only card).
export function generateItemIcon(item, S = 64) {
  const layers = item && item.visual && Array.isArray(item.visual.layers) ? item.visual.layers : null;
  if (!layers || !layers.length) return null;
  const c = makeCanvas(S, S);
  const ctx = c.getContext("2d");
  for (const l of layers) { try { paintLayer(ctx, l, S); } catch { /* skip a malformed layer */ } }
  return c;
}
