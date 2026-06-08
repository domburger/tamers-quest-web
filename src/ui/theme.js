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

// Element name -> hex (folds dual-types & synonyms). Colorblind-tuned (VS-3/VS-4).
// This is the single source of truth for element color — `onlineGame`/`bestiary`
// should migrate their local maps onto `elementColor` (VS-4 de-dup).
const ELEMENT_HEX = {
  fire: PAL.fire, water: PAL.water, nature: PAL.nature, grass: PAL.nature,
  earth: PAL.earth, sand: PAL.earth, rock: PAL.earth, air: PAL.air, wind: PAL.air,
  ice: PAL.ice, dark: PAL.dark, darkness: PAL.dark, shadow: PAL.dark, void: PAL.dark,
  light: PAL.light, holy: PAL.light, electric: PAL.light, lightning: PAL.light,
  poison: PAL.poison, acid: PAL.nature, metal: PAL.metal, steel: PAL.metal, mercury: PAL.metal,
  psychic: PAL.psychic, ghost: PAL.air, ethereal: PAL.air, celestial: PAL.air, lunar: PAL.air,
  spirit: PAL.air, arcane: PAL.dark, cosmic: PAL.dark, mystic: PAL.dark,
  sound: PAL.amber, sonic: PAL.amber, chaos: PAL.danger,
  normal: PAL.neutral, physical: PAL.neutral, none: PAL.neutral,
};
// Unknown (AI-freeform) elements hash into a small spread of palette accents, so
// they read as distinct rather than all the same gray (parity with onlineGame's
// map; VS-4). Known elements always win the lookup above.
const ELEMENT_FALLBACK = [PAL.fire, PAL.water, PAL.nature, PAL.earth, PAL.poison, PAL.air, PAL.amber, PAL.metal];
export function elementColor(name) {
  const key = String(name || "").toLowerCase().split("/")[0].trim();
  if (ELEMENT_HEX[key]) return hex(ELEMENT_HEX[key]);
  if (!key) return hex(PAL.neutral);
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return hex(ELEMENT_FALLBACK[h % ELEMENT_FALLBACK.length]);
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
  fill = THEME.primary, textColor = THEME.textInv, size = 20, radius = 12,
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
  return k.add(comps);
}

// Page header: the title text + a glowing teal accent rule beneath it — the same
// signature the HTML title screen uses (.rule), so every in-canvas page reads as
// part of the same polished family. Optional subtitle sits under the rule.
export function addHeader(k, { x, y = 46, text, size = 34, sub, color = THEME.text, ruleW = 190 } = {}) {
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
  color = THEME.text, width, fixed = false, opacity = 1, font = FONT, tag } = {}) {
  const comps = [
    k.text(text, { size, font, ...(width ? { width } : {}) }),
    k.pos(x, y), k.anchor(anchor), k.color(...color), k.opacity(opacity),
  ];
  if (fixed) comps.push(k.fixed());
  if (tag) comps.push(tag); // optional tag so destroyAll(tag) reaps it (overlay re-renders)
  return k.add(comps);
}
