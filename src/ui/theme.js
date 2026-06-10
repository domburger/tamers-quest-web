// ─────────────────────────────────────────────────────────────────────────────
// Design system — "Polished dark game UI" (slate + teal/amber neon accents)
//
// One source of truth for color, type and UI primitives. Built on the dark-game-
// UI principles: a 4-layer value system (base → panel → muted → vivid), depth via
// lighter-than-base elevated fills + a top sheen + a soft drop shadow + an accent
// glow on hover, and pure-white reserved for headings (body text is muted).
//
// Engine note: the game runs on Phaser 3 via the k.* shim (src/compat/
// kaboomShim.js). Everything here is k.* calls routed through the shim.
// ─────────────────────────────────────────────────────────────────────────────

import { sfx, haptic } from "../systems/audio.js"; // menu SFX + haptics wired centrally in addButton
import { prefersReducedMotion } from "../systems/a11y.js"; // freeze ambient menu motes under reduce-motion

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// Raw palette ----------------------------------------------------------------
// "Bioluminescent dark fantasy" — near-black violet base, glowing teal-green +
// violet accents, soft luminous ink. Matches the haunted-forest / spirit-portal
// reference art: moody, atmospheric, everything reads like it glows in the dark.
export const PAL = {
  // Layer 1 — deep base (near-black, violet-tinted)
  bg:        "#0C0A14",
  bgAlt:     "#070610",
  // Layer 2 — panels / cards (elevated = lighter than base, dusky violet)
  surface:   "#16131F",
  surface2:  "#221D31", // raised (modal, hovered card)
  surfaceAlt:"#221D31", // alias of surface2 (back-compat for existing scenes)
  line:      "#322A47", // dusky violet hairline
  lineSoft:  "#241E33",
  // Ink — luminous, faintly green-white for headings; muted sage for body
  text:      "#ECF4EF", // headings
  textBody:  "#A6B6AE", // body / secondary
  textMut:   "#8A8AA8", // dim labels (lifted for WCAG-AA on small text — VS-3/PV-A2)
  textInv:   "#04231C", // dark ink on bright teal fills
  // Action — bioluminescent teal (the spirit/portal glow)
  primary:   "#2FD3B5",
  primaryDk: "#1B8E7B",
  // Neon accents — teal glow + arcane violet
  teal:      "#46E6C6",
  violet:    "#9B7FE6",
  amber:     "#E0A85C", // warm ember, used sparingly (rare/legendary)
  // Semantic
  success:   "#4BD18C",
  danger:    "#E0566E",
  warn:      "#E0A85C",
  // Element identity (luminous on the dark base)
  fire:      "#FF6A4D",
  water:     "#46A6FF",
  nature:    "#5BD17E",
  earth:     "#D6A05A",
  air:       "#6FD8E8",
  ice:       "#C8F0FF", // paler frost — distinct from air (VS-4/PV-A2: were near-identical)
  dark:      "#A67FE6",
  light:     "#FFDC6A",
  poison:    "#C46FD6",
  metal:     "#7E8AA0", // darker blue-grey — separates from psychic under deuteranopia (VS-4)
  psychic:   "#FF6FC2",
  neutral:   "#93A0A6",
  // In-game cave/forest world (deeper, atmospheric)
  cave:      "#0C0A14",
  caveDeep:  "#070610",
  // Gameplay landmarks — the portal extraction point and the closing storm wall.
  // Duplicated as raw RGB across SP+MP before tokenization (audit-flagged drift risk).
  portal:    "#5ADCFF", // bright spirit-cyan: extraction portal blip + compass
  storm:     "#6EA0FF", // storm-wall blue: outer rings + minimap zone outline
  stormLite: "#B4DCFF", // lighter inner ring atop the storm wall
};

export const THEME = Object.fromEntries(Object.entries(PAL).map(([k, v]) => [k, hex(v)]));

// Type: FONT = bold display (headings/buttons), FONT_BODY = regular (body).
export const FONT = "gameFont";
export const FONT_BODY = "gameFontBody";

// Element accent colour. Elements are FREE-FORM flavour (AI-invented by the
// generation agent, interpreted by the fight judge) — there is no fixed element
// set and NO per-element colour coding (user 2026-06-10: the old element→hex map +
// synonym/dual-type folding were removed). Every monster/attack frame uses ONE
// neutral accent, so colour never implies an element taxonomy. The `name` argument
// is ignored; kept so existing call sites (`elementColor(mt.element)`) still work.
export function elementColor() {
  return hex(PAL.neutral);
}

// ─── Kaboom/Phaser-shim UI primitives ────────────────────────────────────────

// A flat, elevated card: soft drop shadow + lighter fill + hairline border + a
// subtle top sheen so it reads as a raised surface on the dark base.
export function addPanel(k, { x, y, w, h, anchor = "center", fill = THEME.surface,
  border = THEME.line, radius = 16, opacity = 1, fixed = false, shadow = true, tag } = {}) {
  // `tag` (optional) is applied to EVERY layer (shadow/panel/sheen) so a scene can
  // `destroyAll(tag)` the whole panel — letting overlays/modals use the real sheen-
  // bearing helper instead of hand-rolling a flatter rect (parity with addButton).
  const F = (comps) => {
    const c = fixed ? [...comps, k.fixed()] : comps;
    return tag ? [...c, tag] : c;
  };
  // Layers stack by add-order (the shim preserves insertion order at equal z).
  // Scene content added AFTER a panel draws on top of it (e.g. team sprites).
  if (shadow) {
    k.add(F([k.rect(w, h, { radius }), k.pos(x, y + 5), k.anchor(anchor),
      k.color(0, 0, 0), k.opacity(0.35 * opacity)]));
  }
  const panel = k.add(F([k.rect(w, h, { radius }), k.pos(x, y), k.anchor(anchor),
    k.color(...fill), k.outline(2, k.rgb(...border)), k.opacity(opacity)]));
  // Top sheen (a hair lighter), clipped to the upper band for a beveled feel.
  k.add(F([k.rect(w - 8, Math.min(h * 0.4, 22), { radius: radius - 4 }),
    k.pos(x, y - h / 2 + Math.min(h * 0.2, 12)), k.anchor("center"),
    k.color(...THEME.surface2), k.opacity(0.5 * opacity)]));
  return panel;
}

// A polished button: hover glow halo + drop shadow + fill + top sheen + label.
export function addButton(k, { x, y, w = 240, h = 54, text = "", anchor = "center",
  fill = THEME.primary, textColor = THEME.textInv, size = 20, radius = 14,
  onClick, fixed = false, glow = THEME.teal, disabled = false, tag } = {}) {
  // `tag` (optional) is applied to *every* layer so a scene can `destroyAll(tag)`
  // the whole button — shadow/sheen/glow/label included — not just the returned
  // hit rect (used by fight.js's per-menu rebuild). `disabled` greys it out and
  // drops all interaction (e.g. an unaffordable attack). Both default to the prior
  // behaviour, so existing callers are unaffected (VS-9).
  const extra = tag ? [tag] : [];
  const F = (comps) => {
    const c = [...comps, ...extra];
    return fixed ? [...c, k.fixed()] : c;
  };
  const base = disabled ? k.rgb(...THEME.surfaceAlt) : k.rgb(...fill);
  const hover = base.lighten(16);
  const sheen = base.lighten(30);
  const ink = disabled ? THEME.textMut : textColor;

  const halo = k.add(F([k.rect(w + 16, h + 16, { radius: radius + 8 }), k.pos(x, y),
    k.anchor(anchor), k.color(...glow), k.opacity(0)]));
  k.add(F([k.rect(w, h, { radius }), k.pos(x, y + 4), k.anchor(anchor),
    k.color(0, 0, 0), k.opacity(disabled ? 0.25 : 0.4)]));
  const btn = k.add(F([k.rect(w, h, { radius }), k.pos(x, y), k.anchor(anchor),
    k.color(base), k.outline(2, k.rgb(...THEME.bgAlt)), k.area(), "tq-button"]));
  k.add(F([k.rect(w - 6, h * 0.42, { radius: radius - 2 }), k.pos(x, y - h * 0.22),
    k.anchor("center"), k.color(sheen), k.opacity(disabled ? 0.18 : 0.45)]));
  btn.label = k.add(F([k.text(text, { size, font: FONT }), k.pos(x, y + 1),
    k.anchor(anchor), k.color(...ink)]));

  if (!disabled) {
    btn.onHover(() => { k.setCursor("pointer"); sfx("hover"); }); // fires once on pointer enter
    btn.onHoverUpdate(() => { btn.color = hover; halo.opacity = 0.3; });
    btn.onHoverEnd(() => { btn.color = base; halo.opacity = 0; k.setCursor("default"); });
    if (onClick) btn.onClick(() => {
      sfx("click"); haptic(8); // MB-12: tactile tap
      // PV-T9 press feedback: a brief brighten + halo "pop" on tap, auto-restored
      // via k.wait (the same safe flash pattern as fight.js). onHoverUpdate re-
      // applies the hover tint next frame; if onClick changes scene the restore
      // no-ops on the now-destroyed button (try/catch). Most visible on in-place
      // buttons (toggles, +/-, shop) where the scene doesn't change under it.
      try { btn.color = sheen; halo.opacity = 0.6; } catch {}
      k.wait(0.09, () => { try { btn.color = base; halo.opacity = 0; } catch {} });
      onClick();
    });
  }
  return btn;
}

// ─── Immediate-mode (onDraw) UI primitives ───────────────────────────────────
// The retained helpers above (addButton/addPanel/addHeader) can't be used by the
// onDraw-based scenes (roster, shops, bestiary, cosmetics, the in-round HUD), which
// draw every frame and hit-test manually — so those scenes used to hand-roll a
// flatter button (plain rect, no glow/sheen/hover) and drifted from the title look.
// These draw* helpers paint the SAME signature (radius-14 fill + drop shadow + top
// sheen + hairline + hover glow) in immediate mode, so both idioms render one
// consistent button/panel/header family. A scene computes `hover` from the pointer
// (inRect) and passes it in; press feedback is the caller's brief flash if wanted.

// Lighten an [r,g,b] toward white by `amt` per channel (mirrors kaboom Color.lighten,
// which addButton uses) so immediate-mode hover/sheen tints match the retained ones.
export function lighten(rgb, amt) {
  return [Math.min(255, rgb[0] + amt), Math.min(255, rgb[1] + amt), Math.min(255, rgb[2] + amt)];
}

// Pointer-in-rect hit test for [x,y,w,h] rects — the canonical version every
// immediate-mode scene re-declared locally. Import this instead of redefining it.
export function inRect(p, [x, y, w, h]) {
  return p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;
}

// Immediate-mode button — the onDraw twin of addButton. `rect` is [x,y,w,h]; pass
// `hover` (from inRect(pointer, rect)) for the glow+brighten, `disabled` to grey it
// out, `pressed` for the tap-flash. `fill` is the base color (THEME.primary CTA,
// THEME.violet alt, THEME.surfaceAlt neutral). Draws shadow→glow→fill→sheen→label.
export function drawButton(k, { rect, text = "", fill = THEME.primary, textColor = THEME.textInv,
  size = 16, radius = 14, hover = false, pressed = false, disabled = false, opacity = 1,
  font = FONT, glow = THEME.teal, outline = THEME.bgAlt, outlineW = 2, fixed = false } = {}) {
  const [x, y, w, h] = rect;
  const col = (t) => k.rgb(...t);
  const live = !disabled;
  const base = disabled ? THEME.surfaceAlt : fill;
  const fillCol = pressed && live ? lighten(base, 30) : hover && live ? lighten(base, 16) : base;
  const op = disabled ? 0.55 : opacity;
  // Hover/press glow halo behind the button (the title's teal hover bloom).
  if ((hover || pressed) && live) {
    k.drawRect({ pos: k.vec2(x - 6, y - 6), width: w + 12, height: h + 12, radius: radius + 6,
      color: col(glow), opacity: pressed ? 0.5 : 0.26, fixed });
  }
  // Drop shadow → raised feel.
  k.drawRect({ pos: k.vec2(x, y + 3), width: w, height: h, radius, color: col(THEME.bgAlt), opacity: 0.5 * op, fixed });
  // Fill + hairline (outline color overridable — e.g. a selected-tab or danger affordance).
  k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius, color: col(fillCol), opacity: op,
    outline: { width: outlineW, color: col(outline) }, fixed });
  // Top sheen (upper band, a hair lighter) — the beveled-surface read.
  k.drawRect({ pos: k.vec2(x + 4, y + 3), width: w - 8, height: Math.max(6, h * 0.4),
    radius: Math.max(2, radius - 4), color: col(lighten(base, 30)), opacity: disabled ? 0.15 : 0.42, fixed });
  k.drawText({ text, pos: k.vec2(x + w / 2, y + h / 2), size, font, anchor: "center",
    color: col(disabled ? THEME.textMut : textColor), fixed });
}

// Immediate-mode card/panel — the onDraw twin of addPanel (shadow + fill + hairline +
// top sheen). Use for rows, cards, modals, toasts in draw-mode scenes.
export function drawPanel(k, { rect, fill = THEME.surface, border = THEME.line, radius = 14,
  opacity = 1, sheen = true, shadow = true, fixed = false } = {}) {
  const [x, y, w, h] = rect;
  const col = (t) => k.rgb(...t);
  if (shadow) k.drawRect({ pos: k.vec2(x, y + 4), width: w, height: h, radius, color: col(THEME.bgAlt), opacity: 0.4 * opacity, fixed });
  k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius, color: col(fill), opacity,
    outline: { width: 2, color: col(border) }, fixed });
  if (sheen) k.drawRect({ pos: k.vec2(x + 6, y + 4), width: w - 12, height: Math.min(h * 0.4, 14),
    radius: Math.max(2, radius - 4), color: col(THEME.surface2), opacity: 0.45 * opacity, fixed });
}

// Immediate-mode page header — title text + the glowing teal accent rule (the canvas
// `.rule`), matching addHeader so draw-mode pages read as the same family. Returns the
// y just below the rule so callers can lay content beneath it.
export function drawHeader(k, { x = 20, y = 18, title = "", size = 22, ruleW = 150, color = THEME.text, fixed = true } = {}) {
  const col = (t) => k.rgb(...t);
  k.drawText({ text: title, pos: k.vec2(x, y), size, font: FONT, color: col(color), fixed });
  const ry = y + size + 4;
  k.drawRect({ pos: k.vec2(x, ry), width: ruleW + 10, height: 6, radius: 3, color: col(THEME.teal), opacity: 0.16, fixed });
  k.drawRect({ pos: k.vec2(x + 5, ry + 2), width: ruleW, height: 2, radius: 1, color: col(THEME.teal), opacity: 0.9, fixed });
  return ry + 6;
}

// Shared atmospheric menu backdrop (the procedural "menu_background" texture).
// Scaled to COVER the current design area so it fills any aspect ratio with no
// dark gaps at the screen edges — the design width is now responsive (the shim
// matches the window aspect), so a fixed 1280×720 sprite must be cover-scaled.
// Pass { fixed, z } for immediate-mode scenes that need it behind onDraw content.
const MENU_BG_W = 1280, MENU_BG_H = 720; // generateMenuBackground() output size
export function addMenuBackground(k, { fixed = false, z } = {}) {
  const cover = Math.max(k.width() / MENU_BG_W, k.height() / MENU_BG_H);
  const comps = [k.sprite("menu_background"), k.pos(k.width() / 2, k.height() / 2),
    k.anchor("center"), k.scale(cover)];
  if (z != null) comps.push(k.z(z));
  if (fixed) comps.push(k.fixed());
  const bg = k.add(comps);
  // PV-T9: ambient spirit-dust drifting up behind the menu UI — added right after the
  // backdrop (before the scene's UI) so the retained dots sit behind every panel/button
  // by insertion order. Default retained-UI menus only; immediate-mode scenes that pass
  // {fixed,z} draw via onDraw with their own z-banding, so skip them here.
  if (!fixed && z == null) addMenuMotes(k);
  return bg;
}

// Faint teal motes for a menu backdrop (used by addMenuBackground; exported for scenes
// that build a custom backdrop). Retained dots that drift up + sway + wrap, driven by one
// scene-scoped onUpdate. a11y: placed but not animated under reduce-motion.
export function addMenuMotes(k, { count = 18, color = THEME.teal } = {}) {
  const W = k.width(), H = k.height(), motes = [];
  for (let i = 0; i < count; i++) {
    const s = 2 + Math.random() * 3, px = Math.random() * W, py = Math.random() * H;
    const obj = k.add([k.rect(s, s, { radius: s / 2 }), k.pos(px, py), k.anchor("center"),
      k.color(color[0], color[1], color[2]), k.opacity(0.08 + Math.random() * 0.14)]);
    motes.push({ obj, baseX: px, vy: 6 + Math.random() * 10, amp: 6 + Math.random() * 10, phase: Math.random() * Math.PI * 2 });
  }
  if (!prefersReducedMotion()) k.onUpdate(() => {
    const t = k.time(), dt = k.dt();
    for (const m of motes) {
      let y = m.obj.pos.y - m.vy * dt;
      if (y < -6) { y = H + 6; m.baseX = Math.random() * W; }
      m.obj.pos = k.vec2(m.baseX + Math.sin(t * 0.6 + m.phase) * m.amp, y);
    }
  });
  return motes;
}

// Page header: the title text + a glowing teal accent rule beneath it — the same
// signature the HTML title screen uses (.rule), so every in-canvas page reads as
// part of the same polished family. Optional subtitle sits under the rule.
export function addHeader(k, { x, y = 46, text, size = 34, sub, color = THEME.text, ruleW = 190 } = {}) {
  // Narrow/portrait-aware (WIN-T5): shrink the centered title so it neither clips the
  // viewport edges nor collides with a top-corner button (Back/X) on narrow layouts.
  // ~0.75·size px/glyph for the Electrolize display font. No-op on wide screens — the
  // caps only bite when width is small (portrait). On narrow widths we reserve ~150px
  // of corner room each side so the centered title clears a top-left/right button.
  const W = typeof k.width === "function" ? k.width() : 1280;
  const narrow = W < 560;
  const avail = narrow ? W - 220 : W - 40; // narrow: reserve ~110px/side so the centered title clears a top-corner Back/X button
  if (text && text.length) size = Math.max(12, Math.min(size, Math.floor(avail / (text.length * 0.75)))); // floor 12 so a long title on a tiny screen stays legible
  ruleW = Math.min(ruleW, W - 40);
  const label = addLabel(k, { x, y, text, size, color });
  const ry = y + size * 0.8;
  // soft glow behind the rule, then the crisp hairline rule
  k.add([k.rect(ruleW + 10, 7, { radius: 4 }), k.pos(x, ry), k.anchor("center"), k.color(...THEME.teal), k.opacity(0.16)]);
  k.add([k.rect(ruleW, 2, { radius: 1 }), k.pos(x, ry), k.anchor("center"), k.color(...THEME.teal), k.opacity(0.92)]);
  if (sub) addLabel(k, { x, y: ry + 20, text: sub, size: 14, color: THEME.textMut });
  return label;
}

// Themed text label. Headings should pass color: THEME.text; body uses textBody.
export function addLabel(k, { x, y, text, size = 22, anchor = "center",
  color = THEME.text, width, align, fixed = false, opacity = 1, font = FONT, tag } = {}) {
  // `align` (left/center/right) only matters for wrapped (width-bound) multi-line text;
  // the shim passes it to the Phaser text style. Omit → engine default (left).
  const comps = [
    k.text(text, { size, font, ...(width ? { width } : {}), ...(align ? { align } : {}) }),
    k.pos(x, y), k.anchor(anchor), k.color(...color), k.opacity(opacity),
  ];
  if (fixed) comps.push(k.fixed());
  if (tag) comps.push(tag); // optional tag so destroyAll(tag) reaps it (overlay re-renders)
  return k.add(comps);
}
