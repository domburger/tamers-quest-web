// Shared monster-detail popup (TQ-123 / epic TQ-87): ONE reusable renderer for the full monster
// detail shown across the bestiary, roster, hub and combat. Immediate-mode (call inside an onDraw),
// matching how those scenes draw — drawMonsterDetail(k, monsterType, opts). Pure presentation: it
// reads a monster TYPE object (typeName, element, rarity, size, description, passiveEffect) plus
// optional live `vitals`, and draws a scrim + panel + procedural sprite + identity + vitals + lore +
// stats (Lv.1 → Lv.50) + attacks WITH their descriptions + the passive ability. Responsive (a narrow
// screen stacks one column; wide uses a right column). No gameplay/balance/spritegen changes.
//
// Landed in TQ-123 and wired into the scenes (TQ-124/125) so the bestiary, roster, hub and combat all
// share this renderer instead of a hand-rolled copy. `isInsidePanel` helps callers gate tap-to-close.
import { getAttacksForMonster, cleanAttackName } from "../engine/gamedata.js";
import { getMonsterStats } from "../engine/stats.js";
import { THEME, accentColor, FONT_BOLD, drawChip, drawEyebrow, drawMeter, hpColor, drawCloseX } from "./theme.js";
import { drawIcon } from "./icons.js";
import { drawGlassSheet } from "./stationPopup.js"; // UI v3: the detail is a frosted modal sheet
import { syncDetailHtml } from "./monsterDetailHtml.js"; // TQ-309: html-model monsters render as a live-DOM node in the slot (not a canvas sprite)
import { drawMonsterIcon } from "../render/monster.js"; // TQ-353: fit a tall baked sprite to the panel (was bleeding above the frame onto the scrim)

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
  // Taller default (was 470) so all 4 attacks fit with FULL wrapped descriptions even in the footer
  // (bestiary/roster) variant; clamps to the viewport on short screens.
  const PH = Math.min(opts.h ?? (narrow ? H - 56 : 540), H - 32);
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
 * @param {object} [opts] { vitals?:{currentHealth,maxHealth,currentEnergy,maxEnergy,xp?,xpToNext?},
 *                          level?:number, scrim?:bool=true, narrow?:bool, w?:number, h?:number,
 *                          closeHint?:string, footer?:(k, geom)=>void, footerHeight?:number }
 *   opts.level (TQ-129): an OWNED monster's level → show its CURRENT stats (roster/hub) instead of the
 *   catalog Lv.1→Lv.50 range (bestiary, the default). vitals.xp/xpToNext (TQ-129) add an XP-to-next line.
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
  const col = accentColor();

  if (opts.scrim !== false) k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: k.rgb(0, 0, 0), opacity: 0.5, fixed: true });
  if (k.requestFrost && k.frostReady && !k.frostReady()) k.requestFrost();
  drawGlassSheet(k, { rect: [px, py, PW, PH], radius: 22, accent: col });
  // UI v4: a glass close button (any tap closes the modal — this makes the affordance visible).
  const cs = narrow ? 34 : 38;
  drawCloseX(k, { rect: [px + PW - cs - 12, py + 12, cs, cs], hover: false, fixed: true });

  // ── Left column: sprite + identity + (vitals) + lore + passive ──
  const lx = px + 28;
  [[60, 0.10], [42, 0.15], [26, 0.20]].forEach(([r, o]) =>
    k.drawCircle({ pos: k.vec2(lx + 90, py + 90), radius: r, color: k.rgb(col[0], col[1], col[2]), opacity: o, fixed: true }));
  // TQ-309: an html-model monster shows its real visual as a live-DOM node over the slot (the canvas
  // sprite doesn't exist for html-only monsters); everything else keeps the baked sprite path. The DOM
  // node is positioned/torn down by monsterDetailHtml (screen-space; auto-hides when the popup closes).
  if (!syncDetailHtml(k, mt, lx + 90, py + 90, 150)) {
    // TQ-353: fit the baked sprite to the panel — a tall monster at the fixed scale 1.1 bled ABOVE the
    // panel top onto the scrim. drawMonsterIcon shrinks ONLY tall ones (art-top clamped to py+8); compact
    // monsters keep scale 1.1 (full showcase size). fixed:true — popup is screen-space.
    drawMonsterIcon(k, { sprite: slug(mt.typeName), cx: lx + 90, cy: py + 90, scale: 0.64, topY: py + 8, fixed: true } /* 0.64 × 256px raster ≈ the 160px art box (1.1 spilled a tall baked sprite onto the chips) */);
  }

  const nmSz = Math.max(13, Math.min(20, Math.floor(230 / Math.max(1, String(mt.typeName).length * 0.56)))); // shrink a long AI name to one line
  // Identity sits BELOW the 150px art box (art spans py+15..py+165): name, then rarity / size chips.
  k.drawText({ text: mt.typeName || "Monster", pos: k.vec2(lx, py + 172), size: nmSz + 2, font: FONT_BOLD, width: 230, color: T("text"), fixed: true });
  const idc = ink(col);
  const c1 = drawChip(k, { x: lx, y: py + 200, text: `Rarity ${mt.rarity ?? "?"}`, color: idc, size: 9, h: 18, fixed: true });
  drawChip(k, { x: c1[0] + c1[2] + 6, y: py + 200, text: `Size ${mt.size ?? "?"}`, color: THEME.textBody, size: 9, h: 18, fixed: true });

  let ly = py + 230;
  const leftW = narrow ? PW - 56 : 240;
  if (opts.vitals) {
    const v = opts.vitals;
    // UI v4: vitals as icon + meter rows (HP heart, EN bolt, XP arrow) with the numbers right-aligned.
    const vw = narrow ? PW - 56 : 240;
    const row = (icon, color, cur, max, label) => {
      const frac = max > 0 ? Math.max(0, Math.min(1, (cur || 0) / max)) : 0;
      drawIcon(k, icon, { x: lx + 7, y: ly + 7, size: 13, color, fixed: true });
      k.drawText({ text: label, pos: k.vec2(lx + 20, ly), size: 11, font: FONT_BOLD, color: T("textMut"), fixed: true });
      k.drawText({ text: `${cur ?? "?"} / ${max ?? "?"}`, pos: k.vec2(lx + vw, ly), size: 11, font: FONT_BOLD, anchor: "topright", color: k.rgb(...color), fixed: true });
      drawMeter(k, { rect: [lx + 20, ly + 15, vw - 20, 5], frac, color, fixed: true });
      ly += 26;
    };
    row("heart", hpColor(v.maxHealth > 0 ? (v.currentHealth || 0) / v.maxHealth : 1), v.currentHealth, v.maxHealth, "Health");
    row("bolt", [120, 180, 250], v.currentEnergy, v.maxEnergy, "Energy");
    // TQ-129: XP-to-next for an OWNED monster (when supplied) — roster/hub pass it; catalog views don't.
    if (v.xp != null && v.xpToNext != null) row("xp", THEME.amber, v.xp, v.xpToNext, "Experience");
    ly += 2;
  }
  const rawDesc = (mt.description || "").trim();
  const descTxt = narrow && rawDesc.length > 210 ? rawDesc.slice(0, 207).replace(/\s+\S*$/, "") + "…" : rawDesc;
  if (descTxt) {
    k.drawText({ text: descTxt, pos: k.vec2(lx, ly), size: 12, font: "gameFont", width: leftW, color: T("textMut"), fixed: true });
    ly += Math.max(2, Math.ceil(descTxt.length / Math.max(1, leftW / 7.0))) * 15 + 12;
  }
  const passive = (mt.passiveEffect || "").trim();
  if (passive) {
    drawEyebrow(k, { x: lx, y: ly + 1, text: "Passive", size: 10, color: THEME.primary, fixed: true });
    k.drawText({ text: passive, pos: k.vec2(lx, ly + 16), size: 11, font: "gameFont", width: leftW, color: T("textMut"), fixed: true });
    ly += 16 + Math.max(1, Math.ceil(passive.length / Math.max(1, leftW / 6.5))) * 14 + 12;
  }

  // ── Stats (Lv.1 → Lv.50) + attacks. Wide: a right column beside the sprite. Narrow: stacked
  // below the left content (the running `ly`), full width. ──
  const rx = narrow ? lx : px + 300;
  const valX = px + PW - 28;
  let ry = narrow ? ly : py + 24;
  // TQ-129: opts.level → OWNED-monster mode = the monster's CURRENT stats (roster/hub); otherwise the
  // catalog's Lv.1 → Lv.50 potential range (bestiary). Backward-compatible: no level = range, as before.
  if (opts.level) {
    const sc = getMonsterStats(mt, opts.level);
    drawEyebrow(k, { x: rx, y: ry + 2, text: `Stats at level ${opts.level}`, size: 10, color: THEME.primary, fixed: true });
    STATS.forEach((st, i) => {
      const y = ry + 24 + i * 19;
      k.drawText({ text: st, pos: k.vec2(rx, y), size: 12, font: "gameFont", color: T("textMut"), fixed: true });
      k.drawText({ text: `${sc[st] ?? "?"}`, pos: k.vec2(valX, y), size: 12, font: "gameFont", anchor: "right", color: T("text"), fixed: true });
    });
  } else {
    const s1 = getMonsterStats(mt, 1), s50 = getMonsterStats(mt, 50);
    drawEyebrow(k, { x: rx, y: ry + 2, text: "Stats, level 1 to 50", size: 10, color: THEME.primary, fixed: true });
    STATS.forEach((st, i) => {
      const y = ry + 24 + i * 19;
      k.drawText({ text: st, pos: k.vec2(rx, y), size: 12, font: "gameFont", color: T("textMut"), fixed: true });
      k.drawText({ text: `${s1[st]}  →  ${s50[st]}`, pos: k.vec2(valX, y), size: 12, font: "gameFont", anchor: "right", color: T("text"), fixed: true });
    });
  }
  ry += 24 + STATS.length * 19 + 14;

  const attacks = getAttacksForMonster(mt) || [];
  drawEyebrow(k, { x: rx, y: ry + 2, text: "Attacks", size: 10, color: THEME.primary, fixed: true });
  // Show the FULL attack description, WRAPPED to the column width (no more single-line "..." truncation).
  // Each row's height is the wrapped line count, so rows never overlap; `width` makes drawText wrap.
  const descW = narrow ? PW - 64 : PW - 320;
  const charsPerLine = Math.max(8, descW / 5.4); // ~5.4px per glyph at size 10
  // TQ-128: reserve the footer strip — stop before any row would collide with it (measure-then-drop),
  // so a footer never overlaps the content on a tall narrow stack.
  const footerH = (typeof opts.footer === "function") ? (opts.footerHeight ?? 54) : 0;
  const contentMaxY = py + PH - footerH - 8;
  const ac = ink(accentColor());
  let ay = ry + 22;
  const shown = attacks.slice(0, 4);
  // Phone-height fix: measure the full (wrapped) block; when it would not fit above the footer, fall
  // back to a COMPACT one-line-per-attack list ("Name — short description…") so every attack is at
  // least named instead of the tail being cut off (it was: the Attacks header with nothing under it).
  const blockOf = (a) => {
    const desc = (a.description || "").trim();
    const sub = desc || (`DMG ${a.damage ?? "?"}     EN ${a.energyCost ?? "?"}` + (a.inflictedStatus ? `     ${a.inflictedStatus}` : ""));
    const lines = Math.max(1, Math.ceil(sub.length / charsPerLine));
    return { sub, blockH: 14 + lines * 13 + 6 };
  };
  const fullH = shown.reduce((s, a) => s + blockOf(a).blockH, 0);
  const compact = ay + fullH > contentMaxY;
  for (const a of shown) {
    if (compact) {
      if (ay + 15 > contentMaxY) break;
      const name = cleanAttackName(a.name), desc = (a.description || "").trim();
      const room = Math.max(10, Math.floor(descW / 5.6) - name.length - 3);
      const line = desc ? `${name} — ${desc.length > room ? desc.slice(0, Math.max(0, room - 1)).replace(/\s+\S*$/, "") + "…" : desc}` : name;
      k.drawText({ text: name, pos: k.vec2(rx, ay), size: 11, font: "gameFont", color: k.rgb(ac[0], ac[1], ac[2]), fixed: true });
      k.drawText({ text: line.slice(name.length), pos: k.vec2(rx + name.length * 6.3, ay + 1), size: 10, font: "gameFont", color: T("textMut"), fixed: true });
      ay += 15;
      continue;
    }
    const { sub, blockH } = blockOf(a);
    if (ay + blockH > contentMaxY) break; // would collide with the footer → stop (rows only grow downward)
    k.drawText({ text: cleanAttackName(a.name), pos: k.vec2(rx, ay), size: 12, font: "gameFont", color: k.rgb(ac[0], ac[1], ac[2]), fixed: true });
    k.drawText({ text: sub, pos: k.vec2(rx, ay + 14), size: 10, font: "gameFont", width: descW, color: T("textMut"), fixed: true });
    ay += blockH;
  }

  // TQ-130: a caller can attach extras/actions in a reserved bottom strip via opts.footer; it then
  // owns the bottom, so the default close-hint is suppressed. No footer → unchanged close-hint.
  if (typeof opts.footer === "function") {
    opts.footer(k, { px, py, PW, PH, lx, narrow, footerTop: py + PH - (opts.footerHeight ?? 54) });
  } else {
    k.drawText({ text: opts.closeHint ?? "tap / ESC to close", pos: k.vec2(px + PW / 2, py + PH - 16), size: 12, font: "gameFont", anchor: "center", color: T("textMut"), fixed: true });
  }
}
