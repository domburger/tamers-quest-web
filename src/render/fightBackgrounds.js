// TQ-502: fancy fight-screen backgrounds, authored in HTML/CSS, dynamically tinted by the BIOME accent.
// The combat backdrop used to be a flat procedural gradient (battleStage.js). This adds 4 distinct,
// tasteful, on-brand (dark + bioluminescent) background "themes" — Aurora Veil, God Rays, Deep Bokeh,
// Energy Grid — each authored in HTML/CSS and tinted by the biome accent rgb, so a fight in a teal
// Crystal biome glows teal, a Volcano fight glows red, etc. One theme is picked per biome (stable hash),
// rasterised ONCE to a canvas (cached per design+accent), and drawn as the backdrop by battleStage; until
// the raster resolves (or if there's no DOM) battleStage keeps its gradient — purely additive + graceful.
//
// IMPORTANT (verified headless): an SVG <foreignObject> rasterised into an <img> only applies INLINE
// styles — <style> blocks, classes, ::before/::after and var() are IGNORED (it renders blank). So every
// theme is built from INLINE styles with the accent rgb baked in, using real child <div>s instead of
// pseudo-elements. themeHtml() is pure (no DOM) so it's unit-/screenshot-testable.

export const FIGHT_BG_COUNT = 4;
const RW = 480, RH = 360; // raster reference size (4:3, matches the fight stage); drawn stretched to the stage rect
const XMLNS = 'xmlns="http://www.w3.org/1999/xhtml"';

// Deep Bokeh orb placements (% pos, px size, opacity) — child divs (foreignObject can't do ::before).
const ORBS = [[8, 18, 160, 1], [62, 8, 106, 0.7], [68, 52, 200, 0.5], [28, 60, 80, 0.6], [46, 34, 54, 0.8]];

/**
 * Pure HTML for fight-background theme `idx` tinted by rgb(r,g,b). INLINE styles only (foreignObject-safe).
 * Returns the full root <div> (with xhtml xmlns) sized RW×RH. Exported so the raster + the screenshot
 * verifier share one source of truth.
 */
export function themeHtml(idx, r, g, b) {
  const a = `${r | 0},${g | 0},${b | 0}`;
  const root = (inner, bg) => `<div ${XMLNS} style="position:relative;overflow:hidden;width:${RW}px;height:${RH}px;background:${bg}">${inner}</div>`;
  switch (idx % FIGHT_BG_COUNT) {
    case 0: // Aurora Veil — soft layered accent glows over a deep base + vignette
      return root("", `radial-gradient(120% 80% at 50% -10%,rgba(${a},.42),transparent 60%),radial-gradient(90% 60% at 50% 115%,rgba(${a},.28),transparent 65%),radial-gradient(140% 100% at 50% 50%,transparent 55%,rgba(0,0,0,.55)),linear-gradient(180deg,#0c0e16,#07080d)`);
    case 1: { // God Rays — soft near-vertical light shafts from a top glow, fading down
      const bg = `repeating-linear-gradient(93deg,transparent 0 34px,rgba(${a},.085) 44px,transparent 54px 86px),radial-gradient(70% 48% at 50% -8%,rgba(${a},.55),transparent 62%),linear-gradient(180deg,#0a0c15,#060710 72%)`;
      const fade = `<div ${XMLNS} style="position:absolute;inset:0;background:linear-gradient(180deg,transparent 38%,rgba(6,7,14,.62))"></div>`;
      return root(fade, bg);
    }
    case 2: { // Deep Bokeh — blurred accent orbs for depth over a dark field
      const orbs = ORBS.map(([l, t, w, o]) => `<div ${XMLNS} style="position:absolute;left:${l}%;top:${t}%;width:${w}px;height:${w}px;border-radius:50%;filter:blur(18px);opacity:${o};background:radial-gradient(circle,rgba(${a},.55),transparent 70%)"></div>`).join("");
      return root(orbs, `radial-gradient(150% 120% at 50% 30%,#0e1018,#06070c)`);
    }
    default: { // Energy Grid — a glowing horizon line + a perspective grid receding below it
      const grid = `<div ${XMLNS} style="position:absolute;left:0;right:0;top:55%;bottom:0;opacity:.7;transform:perspective(260px) rotateX(60deg);transform-origin:top;background:linear-gradient(rgba(${a},.35),transparent 1px) 0 0/100% 30px,linear-gradient(90deg,rgba(${a},.22),transparent 1px) 0 0/42px 100%"></div>`;
      const horizon = `<div ${XMLNS} style="position:absolute;left:0;right:0;top:54%;height:3px;background:rgba(${a},.8);box-shadow:0 0 22px 5px rgba(${a},.55)"></div>`;
      return root(grid + horizon, `linear-gradient(180deg,#090b13,#0b0e18 52%,#07080e)`);
    }
  }
}

// Stable theme index for a biome name (so the same biome always gets the same backdrop).
function djb2(s) { let h = 5381; const str = String(s || ""); for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; return h; }
export function fightThemeIndex(biomeName) { return djb2(biomeName) % FIGHT_BG_COUNT; }

// key -> { canvas|null, status } so each (design,accent) rasterises ONCE; drawn thereafter as a bitmap.
const cache = new Map();
const accentKey = (a) => `${(a && a[0]) | 0},${(a && a[1]) | 0},${(a && a[2]) | 0}`;

/**
 * The rasterised fight-background canvas for a biome + accent, or null until ready / when unavailable.
 * Kicks off a one-time raster on first request; returns null meanwhile so the caller keeps its gradient.
 * @param {string} biomeName  picks the theme (stable hash)
 * @param {number[]} accent   [r,g,b] biome accent
 * @returns {HTMLCanvasElement|null}
 */
export function fightBackground(biomeName, accent) {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  const idx = fightThemeIndex(biomeName);
  const acc = accent || [120, 160, 200];
  const key = `${idx}|${accentKey(acc)}`;
  const ent = cache.get(key);
  if (ent) return ent.status === "ready" ? ent.canvas : null;

  const rec = { canvas: null, status: "pending" };
  cache.set(key, rec);
  const inner = themeHtml(idx, acc[0], acc[1], acc[2]);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${RW}" height="${RH}"><foreignObject width="100%" height="100%">${inner}</foreignObject></svg>`;
  const img = new Image();
  img.onload = () => {
    try {
      const cv = document.createElement("canvas");
      cv.width = RW; cv.height = RH;
      cv.getContext("2d").drawImage(img, 0, 0, RW, RH);
      rec.canvas = cv; rec.status = "ready";
    } catch { rec.status = "none"; } // tainted / unsupported → caller keeps the gradient
  };
  img.onerror = () => { rec.status = "none"; };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  return null;
}

// Test/teardown aid.
export function _resetFightBgCache() { cache.clear(); }
