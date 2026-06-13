// Shared monster-detail popup (TQ-123 / epic TQ-87): ONE reusable renderer for the full monster
// detail shown across the bestiary, roster, hub and combat. Immediate-mode (call inside an onDraw),
// matching how those scenes draw — drawMonsterDetail(k, monsterType, opts). Pure presentation: it
// reads a monster TYPE object (typeName, element, rarity, size, description, passiveEffect) plus
// optional live `vitals`, and draws a scrim + panel + procedural sprite + identity + vitals + lore +
// stats (Lv.1 → Lv.50) + attacks WITH their descriptions + the passive ability. Responsive (a narrow
// screen stacks one column; wide uses a right column). No gameplay/balance/spritegen changes.
//
// Landed ADDITIVELY (TQ-123): not yet wired into the scenes — the wiring stories (TQ-124/125) replace
// each scene's hand-rolled copy with this. `hitClose`/`isInsidePanel` help callers gate tap-to-close.
import { getAttacksForMonster, cleanAttackName } from "../engine/gamedata.js";
import { getMonsterStats } from "../engine/stats.js";
import { THEME, elementColor, drawPanel } from "./theme.js";

const STATS = ["health", "strength", "defense", "speed", "power", "energy", "luck"];
const slug = (n) => String(n || "").toLowerCase().replace(/\s+/g, "_");

// Brighten a dark element colour so it stays legible as text on the dark panel (mirrors bestiary).
function ink(c) {
  const lum = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
  if (lum >= 0.5) return c;
  const f = 0.5 / Math.max(0.12, lum);
  return [Math.min(255, Math.round(c[0] * f)), Math.min(255, Math.round(c[1] * f)), Math.min(255, Math.round(c[2] * f))];
}

// Compute the panel rect for the current viewport (shared by the renderer + the hit-tests so callers
// can gate "tap outside / on close to dismiss" without re-deriving the geometry).
export function monsterDetailRect(k, opts = {}) {
  const W = k.width(), H = k.height();
  const narrow = opts.narrow ?? (W < 560);
  const PW = Math.min(opts.w ?? (narrow ? W - 24 : 620), W - 24);
  const PH = Math.min(opts.h ?? (narrow ? H - 56 : 470), H - 32);
  return { px: (W - PW) / 2, py: (H - PH) / 2, PW, PH, narrow };
}

export function isInsidePanel(k, x, y, opts = {}) {
  const { px, py, PW, PH } = monsterDetailRect(k, opts);
  return x >= px && x <= px + PW && y >= py && y <= py + PH;
}

/**
 * Draw the monster-detail popup. Immediate-mode — call every frame inside onDraw while open.
 * @param k kaboom/compat ctx
 * @param mt monster TYPE object (typeName, element, rarity, size, description, passiveEffect)
 * @param {object} [opts] { vitals?:{currentHealth,maxHealth,currentEnergy,maxEnergy}, scrim?:bool=true,
 *                          narrow?:bool, w?:number, h?:number, closeHint?:string,
 *                          footer?:(k, geom)=>void, footerHeight?:number }
 *   opts.footer (TQ-130): a callback invoked AFTER the content to draw caller-specific extras/actions
 *   in a reserved bottom strip — geom = { px, py, PW, PH, lx, narrow, footerTop } where
 *   footerTop = py + PH - (footerHeight ?? 54). When supplied, the default "tap to close" hint is
 *   suppressed (the footer owns the bottom). Used by the bestiary (catch/collection lines) + roster
 *   (Field/Store/Release buttons) so they can adopt this renderer without losing their extras.
 */
export function drawMonsterDetail(k, mt, opts = {}) {
  if (!mt) return;
  const T = (n) => { const c = THEME[n] || [255, 255, 255]; return k.rgb(c[0], c[1], c[2]); };
  const { px, py, PW, PH, narrow } = monsterDetailRect(k, opts);
  const col = elementColor(mt.element);

  if (opts.scrim !== false) k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: k.rgb(0, 0, 0), opacity: 0.72, fixed: true });
  drawPanel(k, { rect: [px, py, PW, PH], radius: 16, fill: THEME.surface, border: col, borderW: 3, fixed: true });

  // ── Left column: sprite + identity + (vitals) + lore + passive ──
  const lx = px + 28;
  [[60, 0.10], [42, 0.15], [26, 0.20]].forEach(([r, o]) =>
    k.drawCircle({ pos: k.vec2(lx + 90, py + 90), radius: r, color: k.rgb(col[0], col[1], col[2]), opacity: o, fixed: true }));
  try { k.drawSprite({ sprite: slug(mt.typeName), pos: k.vec2(lx + 90, py + 90), anchor: "center", scale: 1.1 }); } catch { /* sprite not generated yet */ }

  const nmSz = Math.max(13, Math.min(20, Math.floor(230 / Math.max(1, String(mt.typeName).length * 0.56)))); // shrink a long AI name to one line
  k.drawText({ text: mt.typeName || "Monster", pos: k.vec2(lx, py + 156), size: nmSz, font: "gameFont", width: 230, color: T("text"), fixed: true });
  const idc = ink(col);
  k.drawText({ text: `${mt.element || "Neutral"}     rarity ${mt.rarity ?? "?"}     size ${mt.size ?? "?"}`, pos: k.vec2(lx, py + 188), size: 13, font: "gameFont", color: k.rgb(idc[0], idc[1], idc[2]), fixed: true });

  let ly = py + 214;
  const leftW = narrow ? PW - 56 : 240;
  if (opts.vitals) {
    const v = opts.vitals;
    k.drawText({ text: `HP ${v.currentHealth ?? "?"}/${v.maxHealth ?? "?"}      EN ${v.currentEnergy ?? "?"}/${v.maxEnergy ?? "?"}`,
      pos: k.vec2(lx, ly), size: 13, font: "gameFont", color: T("teal"), fixed: true });
    ly += 24;
  }
  const rawDesc = (mt.description || "").trim();
  const descTxt = narrow && rawDesc.length > 210 ? rawDesc.slice(0, 207).replace(/\s+\S*$/, "") + "…" : rawDesc;
  if (descTxt) {
    k.drawText({ text: descTxt, pos: k.vec2(lx, ly), size: 12, font: "gameFont", width: leftW, color: T("textMut"), fixed: true });
    ly += Math.max(2, Math.ceil(descTxt.length / Math.max(1, leftW / 7.0))) * 15 + 12;
  }
  const passive = (mt.passiveEffect || "").trim();
  if (passive) {
    k.drawText({ text: "PASSIVE", pos: k.vec2(lx, ly), size: 12, font: "gameFont", color: T("primary"), fixed: true });
    k.drawText({ text: passive, pos: k.vec2(lx, ly + 16), size: 11, font: "gameFont", width: leftW, color: T("textMut"), fixed: true });
    ly += 16 + Math.max(1, Math.ceil(passive.length / Math.max(1, leftW / 6.5))) * 14 + 12;
  }

  // ── Stats (Lv.1 → Lv.50) + attacks. Wide: a right column beside the sprite. Narrow: stacked
  // below the left content (the running `ly`), full width. ──
  const rx = narrow ? lx : px + 300;
  const valX = px + PW - 28;
  let ry = narrow ? ly : py + 24;
  const s1 = getMonsterStats(mt, 1), s50 = getMonsterStats(mt, 50);
  k.drawText({ text: "STATS    Lv.1  →  Lv.50", pos: k.vec2(rx, ry), size: 13, font: "gameFont", color: T("primary"), fixed: true });
  STATS.forEach((st, i) => {
    const y = ry + 24 + i * 19;
    k.drawText({ text: st, pos: k.vec2(rx, y), size: 12, font: "gameFont", color: T("textMut"), fixed: true });
    k.drawText({ text: `${s1[st]}  →  ${s50[st]}`, pos: k.vec2(valX, y), size: 12, font: "gameFont", anchor: "right", color: T("text"), fixed: true });
  });
  ry += 24 + STATS.length * 19 + 14;

  const attacks = getAttacksForMonster(mt) || [];
  k.drawText({ text: "ATTACKS", pos: k.vec2(rx, ry), size: 13, font: "gameFont", color: T("primary"), fixed: true });
  const colChars = Math.max(10, Math.floor((narrow ? PW - 64 : PW - 312) / 5.6));
  // TQ-128: reserve the footer strip — drop trailing attack rows that would collide with it (the
  // measure-then-drop the spec calls for), so a footer never overlaps the content on a tall narrow stack.
  const footerH = (typeof opts.footer === "function") ? (opts.footerHeight ?? 54) : 0;
  const contentMaxY = py + PH - footerH - 8;
  attacks.slice(0, 4).forEach((a, i) => {
    const y = ry + 22 + i * 30;
    if (y + 24 > contentMaxY) return; // would collide with the footer → drop it (and the rest, y only grows)
    const ac = ink(elementColor(a.elementalType));
    k.drawText({ text: cleanAttackName(a.name), pos: k.vec2(rx, y), size: 12, font: "gameFont", color: k.rgb(ac[0], ac[1], ac[2]), fixed: true });
    const desc = (a.description || "").trim();
    const sub = desc
      ? (desc.length > colChars ? desc.slice(0, colChars - 3).replace(/[\s,;:.]+$/, "") + "..." : desc)
      : `${a.elementalType || "Neutral"}     DMG ${a.damage ?? "?"}     EN ${a.energyCost ?? "?"}` + (a.inflictedStatus ? `     ${a.inflictedStatus}` : "");
    k.drawText({ text: sub, pos: k.vec2(rx, y + 14), size: 10, font: "gameFont", color: T("textMut"), fixed: true });
  });

  // TQ-130: a caller can attach extras/actions in a reserved bottom strip via opts.footer; it then
  // owns the bottom, so the default close-hint is suppressed. No footer → unchanged close-hint.
  if (typeof opts.footer === "function") {
    opts.footer(k, { px, py, PW, PH, lx, narrow, footerTop: py + PH - (opts.footerHeight ?? 54) });
  } else {
    k.drawText({ text: opts.closeHint ?? "tap / ESC to close", pos: k.vec2(px + PW / 2, py + PH - 16), size: 12, font: "gameFont", anchor: "center", color: T("textMut"), fixed: true });
  }
}
