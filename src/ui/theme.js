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
import { drawCurrencyIcon } from "../render/currencyIcon.js"; // TQ-138: distinct per-currency icon (gold coin / essence gem)
import { drawIcon, iconSpriteKey } from "./icons.js"; // UI v4: drawn icon set (tabs, close, section labels, buttons)

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// Raw palette ----------------------------------------------------------------
// "Bioluminescent dark fantasy" — near-black violet base, glowing teal-green +
// violet accents, soft luminous ink. Matches the haunted-forest / spirit-portal
// reference art: moody, atmospheric, everything reads like it glows in the dark.
export const PAL = {
  // Layer 1 — deep base (NEUTRAL charcoal, no blue/violet tint)
  bg:        "#15110F", // UI v4: warm charcoal (lantern-lit), no blue/violet tint
  bgAlt:     "#0B0908",
  // Layer 2 — panels / cards (elevated = lighter neutral charcoal). Design upgrade 2026-11: surfaces
  // lifted a notch (more separation from the base) and rendered as a top-lit GRADIENT with an inner
  // top highlight + soft blurred shadow (see drawPanel), so panels read as material, not flat slabs.
  surface:   "#231C18",
  surface2:  "#302722", // raised (modal, hovered card)
  surfaceAlt:"#302722", // alias of surface2 (back-compat for existing scenes)
  surfaceHi: "#3C322C", // inner top-edge highlight on panels/buttons (the bevel catch-light)
  line:      "#483C35", // warm grey hairline
  lineSoft:  "#2A2320",
  lineHi:    "#5F5047", // hovered/selected hairline
  // Ink — neutral near-white headings; neutral grey body/mute (no blue or sage tint)
  text:      "#F5EFE9", // headings
  textBody:  "#CDC1B7", // body / secondary (UI v4: lifted for readability on glass)
  textMut:   "#A3968C", // dim labels (UI v4: lifted; still clearly secondary)
  textInv:   "#2A0B05", // dark warm ink on bright ember fills
  // Action — EMBER / crimson (the primary accent + brand glow). `teal` keeps its name for
  // back-compat (every scene references THEME.teal for the accent glow) but now holds the
  // bright ember used for glows/highlights, so the warm accent propagates everywhere.
  primary:   "#F0533D",
  primaryDk: "#B23625",
  // Neon accents — ember glow (stored as `teal`) + a warmer arcane violet (sparing secondary)
  teal:      "#FF7A52",
  violet:    "#B58BE6",
  amber:     "#E8B25E", // warm gold, used sparingly (rare/legendary)
  // Semantic
  success:   "#5BD18C",
  danger:    "#E63B46", // warm crimson-red — destructive/low-HP; reads warm (not the old cool neon pink)
  warn:      "#E8B25E",
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
  // In-game cave/forest world (deeper, atmospheric — neutral charcoal)
  cave:      "#0C0C0D",
  caveDeep:  "#060607",
  // Gameplay landmarks — the portal extraction point and the closing storm wall.
  // Duplicated as raw RGB across SP+MP before tokenization (audit-flagged drift risk).
  portal:    "#5ADCFF", // bright spirit-cyan: extraction portal blip + compass
  storm:     "#6EA0FF", // storm-wall blue: outer rings + minimap zone outline
  stormLite: "#B4DCFF", // lighter inner ring atop the storm wall
};

export const THEME = Object.fromEntries(Object.entries(PAL).map(([k, v]) => [k, hex(v)]));

// Type: FONT = display (Fredoka 500), FONT_BOLD = heavy display for buttons/headings (Fredoka 600,
// matching the title screen's bold .btn / logo), FONT_BODY = regular body (Fredoka 400).
export const FONT = "gameFont";
export const FONT_BOLD = "gameFontBold";
export const FONT_BODY = "gameFontBody";

// Shared monster/attack accent colour — ONE neutral accent for every monster, attack,
// roster/lobby card and combat button (TQ-349 removed the "element" concept, so colour
// never implied a taxonomy anyway). accentColor() is called per combatant + per combat
// button + per roster/lobby card EVERY frame — so re-parsing the hex and allocating a
// fresh [r,g,b] each call is pure waste. Compute it once at module load. Frozen because
// it's a shared instance: every call site only READS it (the THEME.primary fallback
// beside several of them is already a shared array), so freezing guarantees that
// contract and turns any accidental mutation into a loud error.
const NEUTRAL_ACCENT = Object.freeze(hex(PAL.neutral));
export function accentColor() {
  return NEUTRAL_ACCENT;
}

// HP-fraction → bar colour. The success/warn/danger thresholds were duplicated across every
// HP bar — the roster/lobby/characterSelect menu cards AND the in-round onlineGame team bars
// (which had drifted to raw RGB + a 0.2 threshold). One source so the palette + danger
// threshold stay in lockstep everywhere: >0.5 healthy, >0.25 warn, else danger.
export function hpColor(frac) {
  return frac > 0.5 ? THEME.success : frac > 0.25 ? THEME.warn : THEME.danger;
}

// ─── Kaboom/Phaser-shim UI primitives ────────────────────────────────────────

// A flat, elevated card: soft drop shadow + lighter fill + hairline border + a
// subtle top sheen so it reads as a raised surface on the dark base.
export function addPanel(k, { x, y, w, h, anchor = "center", fill = THEME.surface,
  border = THEME.line, radius = 16, opacity = 1, fixed = false, shadow = true, area = false, z, tag } = {}) {
  // `tag` (optional) is applied to EVERY layer (shadow/panel/sheen/rim) so a scene can
  // `destroyAll(tag)` the whole panel — letting overlays/modals use the real sheen-
  // bearing helper instead of hand-rolling a flatter rect (parity with addButton).
  // `area` (optional) gives the body an interaction area so a CLICKABLE card (e.g. the
  // character slot) can route through this helper and pick up the shadow+sheen+rim, then
  // attach its own onClick/onHover to the returned panel — interactive cards stay in the family.
  // `z` (optional) sets the stacking depth so an overlay panel can sit above immediate-mode content.
  const F = (comps) => {
    let c = fixed ? [...comps, k.fixed()] : [...comps];
    if (z != null) c.push(k.z(z));
    return tag ? [...c, tag] : c;
  };
  // Layers stack by add-order (the shim preserves insertion order at equal z).
  // Scene content added AFTER a panel draws on top of it (e.g. team sprites).
  // Design upgrade: a soft BLURRED drop shadow (the canvas backend's shadow option), a top-lit
  // GRADIENT body with a 1.5px hairline, and a 1px inner top highlight — the same material the
  // immediate-mode drawPanel paints, so retained + onDraw panels are one family.
  // UI v3 GLASS (retained twin of drawGlass / the frosted sheets): two flat shadow layers (no per-frame
  // ctx blur — retained objects repaint every frame), a dark tint, a white wash (raised surfaces wash
  // brighter), an outline-only white hairline (or the caller's accent border) and a top catch-light.
  const [ox, oy] = anchorOffset(anchor, w, h);
  const left = x - ox, top = y - oy;
  if (shadow) {
    k.add(F([k.rect(w + 12, h + 10, { radius: radius + 6 }), k.pos(left - 6, top + 4), k.anchor("topleft"), k.color(...THEME.bgAlt), k.opacity(0.22 * opacity)]));
    k.add(F([k.rect(w - 4, h + 2, { radius }), k.pos(left + 2, top + 6), k.anchor("topleft"), k.color(...THEME.bgAlt), k.opacity(0.32 * opacity)]));
  }
  k.add(F([k.rect(w, h, { radius }), k.pos(x, y), k.anchor(anchor), k.color(...THEME.bg), k.opacity(0.8 * opacity)]));
  const raised = _eqCol(fill, THEME.surface2) || _eqCol(fill, THEME.surfaceAlt);
  const bodyComps = [k.rect(w, h, { radius }), k.pos(x, y), k.anchor(anchor), k.color(...WHITE), k.opacity((raised ? 0.08 : 0.05) * opacity)];
  if (area) bodyComps.push(k.area());
  const panel = k.add(F(bodyComps));
  const accentBorder = !_eqCol(border, THEME.line);
  k.add(F([k.rect(w - 1, h - 1, { radius: Math.max(0, radius - 0.5), fill: false }), k.pos(left + 0.5, top + 0.5), k.anchor("topleft"),
    k.color(...(accentBorder ? border : WHITE)), k.opacity((accentBorder ? 1 : 0.12) * opacity), k.outline(accentBorder ? 1.5 : 1, k.rgb(...(accentBorder ? border : WHITE)))]));
  k.add(F([k.rect(Math.max(4, w - radius * 2), 1, { radius: 0.5 }), k.pos(left + radius, top + 1), k.anchor("topleft"), k.color(...WHITE), k.opacity(0.2 * opacity)]));
  return panel;
}

// Anchor → top-left offset for a w×h box (retained helpers position by anchor; the highlight line is
// placed from the box's top-left).
function anchorOffset(anchor, w, h) {
  const a = String(anchor || "center");
  const ox = /left/.test(a) ? 0 : /right/.test(a) ? w : w / 2;
  const oy = /top/.test(a) ? 0 : /bot/.test(a) ? h : h / 2;
  return [ox, oy];
}

// The panel material: a top-lit vertical gradient from a lifted top to a slightly sunk bottom.
export function panelGradient(fill) {
  return { dir: "v", stops: [[0, lighten(fill, 12)], [0.55, fill], [1, darken(fill, 6)]] };
}
// The filled-button material: hot top → base → deep bottom (a pressable, dimensional pill).
export function buttonGradient(fill) {
  return { dir: "v", stops: [[0, lighten(fill, 26)], [0.5, fill], [1, darken(fill, 22)]] };
}

// Surface-token test: is this fill one of the dark panel surfaces (→ a GHOST button) rather than a
// bright accent (→ a FILLED pill)? Value-compared so a copied token still matches.
const _eqCol = (a, b) => a === b || (Array.isArray(a) && Array.isArray(b) && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);
export const isSurfaceFill = (c) => _eqCol(c, THEME.surface) || _eqCol(c, THEME.surfaceAlt) || _eqCol(c, THEME.surface2);

// A button matching the HTML TITLE SCREEN (.btn): two clean families, no glassy bevel —
//   • FILLED — a solid accent pill (teal primary / danger / success…) + appropriate ink and a soft
//     COLOURED outer glow (the title's `.btn.primary` box-shadow). No outline, no sheen/shade/rim.
//   • GHOST  — a translucent dark surface fill + a faint light hairline (the title's `.btn`/`.ghost`),
//     white-ish text, no resting glow (a teal glow blooms on hover).
// Hover brightens the fill + intensifies the glow; press flashes brighter. `tag` is applied to every
// layer so a scene can destroyAll(tag) the whole button; `disabled` greys it + drops interaction.
export function addButton(k, { x, y, w = 240, h = 54, text = "", anchor = "center",
  fill = THEME.primary, textColor = THEME.textInv, size = 20, radius = 14,
  onClick, fixed = false, glow = THEME.teal, glowOn = false, disabled = false, z, tag, icon = null } = {}) {
  const extra = tag ? [tag] : [];
  const F = (comps) => {
    const c = [...comps, ...extra];
    if (z != null) c.push(k.z(z)); // optional stacking depth so an overlay can sit above immediate-mode content
    return fixed ? [...c, k.fixed()] : c;
  };
  const ghost = isSurfaceFill(fill);
  const base = disabled ? THEME.surfaceAlt : fill;
  const ink = disabled ? THEME.textMut : textColor;
  // TQ-139: the outer glow is now OPT-IN (glowOn) and OFF by default — Dominik wants standard buttons
  // to be a clean fill + drop shadow with no halo. A primary CTA can pass glowOn:true to keep it.
  const restGlow = (glowOn && !ghost && !disabled) ? 0.2 : 0;
  const baseC = k.rgb(...base), hoverC = k.rgb(...lighten(base, ghost ? 18 : 12)), pressC = k.rgb(...lighten(base, 26));

  // `lift` collects the layers that rise on hover (the title's `.btn:hover` translateY(-2px)) — the
  // body, gloss bands, label and glow. The DROP SHADOW is left in place, so the button reads as
  // rising off its shadow. Each entry stores its resting y so the lift is absolute (never accumulates).
  const lift = [];
  // Soft coloured outer glow — TWO concentric layers (a faint wide bloom UNDER a tighter edge-hugging
  // glow) for a soft falloff that hugs the button, instead of the old single solid rect that stuck out
  // ~13px on every side and read as a hard band (TQ-97). setGlow() scales both together on hover/press.
  // TQ-133: the shadow + glow layers use a FULL-PILL corner radius (half the shortest side) so they
  // are always at least as round as the button body. With the old fixed `radius` (~14) the corners of
  // these behind-the-body layers were squarer than a pill body (radius ~h/2) and poked out as a dark
  // rounded-rectangle behind the pill. min(w,h)/2 is the Phaser pill cap, so it's a clean stadium.
  const haloOut = k.add(F([k.rect(w + 14, h + 14, { radius: Math.min(w + 14, h + 14) / 2 }), k.pos(x, y + 4),
    k.anchor(anchor), k.color(...glow), k.opacity(restGlow * 0.45)]));
  const haloIn = k.add(F([k.rect(w + 6, h + 6, { radius: Math.min(w + 6, h + 6) / 2 }), k.pos(x, y + 4),
    k.anchor(anchor), k.color(...glow), k.opacity(restGlow)]));
  lift.push({ o: haloOut, y0: y + 4 }, { o: haloIn, y0: y + 4 });
  const setGlow = (lv) => { try { haloIn.opacity = lv; haloOut.opacity = lv * 0.45; } catch { /* destroyed */ } };
  let btn;
  const glassy = ghost || disabled;
  if (glassy) {
    // UI v3 GLASS family (secondary / disabled): a white wash + white hairline, no shadow or bevel — the
    // retained twin of drawButton's ghost branch. Hover/press raise the wash opacity (not the colour).
    const wash = disabled ? 0.04 : 0.07;
    const bodyComps = [k.rect(w, h, { radius }), k.pos(x, y), k.anchor(anchor), k.color(...WHITE), k.opacity(wash), k.area(), "tq-button"];
    btn = k.add(F(bodyComps));
    lift.push({ o: btn, y0: y });
    btn._wash = wash;
    // White hairline as its own outline-only object (retained objects carry ONE opacity, and the wash is 7%).
    lift.push({ o: k.add(F([k.rect(w, h, { radius, fill: false }), k.pos(x, y), k.anchor(anchor), k.color(...WHITE), k.opacity(disabled ? 0.08 : 0.16), k.outline(1, k.rgb(...WHITE))])), y0: y });
  } else {
    // FILLED family (primary action): one soft shadow + a top-lit gradient body + a catch-light.
    k.add(F([k.rect(w, h, { radius: Math.min(w, h) / 2 }), k.pos(x, y + 3), k.anchor(anchor), k.color(...THEME.bgAlt), k.opacity(0.45)]));
    const bodyComps = [k.rect(w, h, { radius, gradient: buttonGradient(base) }), k.pos(x, y), k.anchor(anchor), k.color(baseC),
      k.outline(1, k.rgb(...darken(base, 40))), k.area(), "tq-button"];
    btn = k.add(F(bodyComps));
    lift.push({ o: btn, y0: y });
    const [ox, oy] = anchorOffset(anchor, w, h);
    const hy = y - oy + 1.5;
    lift.push({ o: k.add(F([k.rect(Math.max(4, w - radius * 2), 1.2, { radius: 0.6 }), k.pos(x - ox + radius, hy), k.anchor("topleft"),
      k.color(...lighten(base, 90)), k.opacity(0.5)])), y0: hy, x0: x - ox + radius }); // x0: keep the top-left-anchored line where it is on hover (was snapped to the centre x)
  }
  // UI v4: optional leading ICON (a rasterized stroke icon from icons.js) — the icon + label pair is centred
  // as one group, replacing typed glyph prefixes like "< Back" / "+ New". Centre-anchored buttons only.
  let labelX = x;
  const iconKey = icon && anchor === "center" ? iconSpriteKey(k, icon, { size: Math.round(size * 1.05), color: ink }) : null;
  if (iconKey) {
    const isz = Math.round(size * 1.05), gap = Math.round(size * 0.45);
    const tw = typeof k.measureText === "function" ? k.measureText(text, size, FONT_BOLD) : String(text).length * size * 0.55;
    const left = x - (isz + gap + tw) / 2;
    const ix = left + isz / 2;
    labelX = left + isz + gap + tw / 2;
    lift.push({ o: k.add(F([k.sprite(iconKey), k.pos(ix, y), k.anchor("center"), k.scale(0.5)])), y0: y, x0: ix });
  }
  btn.label = k.add(F([k.text(text, { size, font: FONT_BOLD }), k.pos(labelX, y + 1),
    k.anchor(anchor), k.color(...ink)]));
  lift.push({ o: btn.label, y0: y + 1, x0: labelX });
  const setLift = (dy) => { for (const { o, y0, x0 } of lift) { try { o.pos = k.vec2(x0 != null ? x0 : x, y0 + dy); } catch { /* destroyed */ } } };
  const setHot = (lv) => { try { if (glassy) btn.opacity = lv === 2 ? GLASS.fillPress : lv === 1 ? GLASS.fillHover : btn._wash; else btn.color = lv === 2 ? pressC : lv === 1 ? hoverC : baseC; } catch { /* destroyed */ } };

  if (!disabled) {
    btn.onHover(() => { k.setCursor("pointer"); sfx("hover"); }); // fires once on pointer enter
    btn.onHoverUpdate(() => { setHot(1); setGlow(glowOn ? (ghost ? 0.22 : 0.36) : 0); setLift(-2); }); // rise on hover (TQ-139: glow only when opt-in)
    btn.onHoverEnd(() => { setHot(0); setGlow(restGlow); setLift(0); k.setCursor("default"); });
    if (onClick) btn.onClick(() => {
      sfx("click"); haptic(8); // MB-12: tactile tap
      // Brief press flash (brighten + glow pop + settle back down), auto-restored via k.wait; no-ops
      // if the click changes scene (try/catch). Most visible on in-place buttons (toggles, +/-, shop).
      try { setHot(2); setGlow(glowOn ? (ghost ? 0.4 : 0.52) : 0); setLift(0); } catch {}
      k.wait(0.09, () => { try { setHot(0); setGlow(restGlow); } catch {} });
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

// Darken an [r,g,b] toward black by `amt` per channel — the twin of lighten, used for
// the buttons' bottom shade band so the fill reads as a top-lit vertical gradient.
export function darken(rgb, amt) {
  return [Math.max(0, rgb[0] - amt), Math.max(0, rgb[1] - amt), Math.max(0, rgb[2] - amt)];
}

// Pointer-in-rect hit test for [x,y,w,h] rects — the canonical version every
// immediate-mode scene re-declared locally. Import this instead of redefining it.
export function inRect(p, [x, y, w, h]) {
  return p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;
}

// The dimensional-pill GRADIENT BODY — fill + outline → top sheen → bottom shade → specular
// top rim — shared by drawButton AND the in-round combat action pills (onlineGame.js), which
// used to hand-mirror this exact 4-layer recipe and so drifted every time the look changed (the
// rim was the latest miss). One source now: enhance the pill here and BOTH update in lockstep.
// Draws no shadow/glow/label (the caller owns those) so it composes into either idiom. `base`
// feeds the shade (the un-brightened fill), `fillCol` the fill/sheen/rim (the hover/press-lit
// fill); per-layer opacities + shade depth are caller-tunable so combat's affordable/lock
// dimming maps in exactly. Pass the SAME radius the caller draws its fill at (rim/sheen track it).
export function drawPillFill(k, { rect, base, fillCol = base, radius = 14, outline = THEME.line,
  outlineW = 2, fillOp = 1, sheenOp = 0.42, shadeOp = 0.3, rimOp = 0.5, shadeAmt = 26, fixed = false } = {}) {
  const [x, y, w, h] = rect;
  const col = (t) => k.rgb(...t);
  // Fill + hairline (outline color overridable — e.g. a selected-tab, danger, or element accent).
  k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius, color: col(fillCol), opacity: fillOp,
    outline: { width: outlineW, color: col(outline) }, fixed });
  // Top sheen (upper band, a hair lighter) — the beveled-surface read.
  k.drawRect({ pos: k.vec2(x + 4, y + 3), width: w - 8, height: Math.max(6, h * 0.4),
    radius: Math.max(2, radius - 4), color: col(lighten(fillCol, 30)), opacity: sheenOp, fixed });
  // Bottom shade (lower band, a hair darker) — pairs with the sheen so the fill reads as a
  // top-lit vertical gradient: a rounded, dimensional pill rather than a flat slab.
  const shadeH = Math.max(5, h * 0.34);
  k.drawRect({ pos: k.vec2(x + 4, y + h - shadeH - 3), width: w - 8, height: shadeH,
    radius: Math.max(2, radius - 4), color: col(darken(base, shadeAmt)), opacity: shadeOp, fixed });
  // Specular top rim — a thin bright line hugging the top edge: the crisp catch-light that lifts
  // the gradient into a glassy pill. Inset from the corners by the radius so it follows the round top.
  k.drawRect({ pos: k.vec2(x + radius * 0.7, y + 1.6), width: Math.max(4, w - radius * 1.4), height: 1.6,
    radius: 0.8, color: col(lighten(fillCol, 90)), opacity: rimOp, fixed });
}

// Immediate-mode button — the onDraw twin of addButton. `rect` is [x,y,w,h]; pass
// `hover` (from inRect(pointer, rect)) for the glow+brighten, `disabled` to grey it
// out, `pressed` for the tap-flash. `fill` is the base color (THEME.primary CTA,
// THEME.violet alt, THEME.surfaceAlt neutral). Draws shadow→glow→fill→sheen→label.
export function drawButton(k, { rect, text = "", fill = THEME.primary, textColor = THEME.textInv,
  size = 16, radius = 14, hover = false, pressed = false, disabled = false, opacity = 1,
  font = FONT_BOLD, glow = THEME.teal, glowOn = false, outline = THEME.line, outlineW = 2, fixed = false } = {}) {
  const [x, y, w, h] = rect;
  const col = (t) => k.rgb(...t);
  const live = !disabled;
  const base = disabled ? THEME.surfaceAlt : fill;
  const fillCol = pressed && live ? lighten(base, 30) : hover && live ? lighten(base, 16) : base;
  const op = disabled ? 0.55 : opacity;
  const ghost = isSurfaceFill(fill);
  // Soft coloured outer glow — TQ-139: now OPT-IN (glowOn) and OFF by default. Standard buttons are a
  // clean fill + drop shadow with no halo; a CTA can pass glowOn:true to restore the resting/hover glow.
  const glowOp = (!live || !glowOn) ? 0 : pressed ? (ghost ? 0.4 : 0.52) : hover ? (ghost ? 0.22 : 0.36) : (ghost ? 0 : 0.18);
  // TQ-97: two concentric layers — a faint wide bloom UNDER a tighter edge-hugging glow — give a soft
  // falloff, instead of the old single solid rect that stuck out ~11px on every side and read as a hard band.
  // TQ-133: full-pill corner radii (half the shortest side) for the glow + shadow so these
  // behind-the-body layers are never squarer than a pill body — the old fixed `radius` (~14) let
  // their corners poke out as a dark rounded-rectangle behind the pill.
  if (glowOp > 0) {
    k.drawRect({ pos: k.vec2(x - 7, y - 7), width: w + 14, height: h + 14, radius: Math.min(w + 14, h + 14) / 2, color: col(glow), opacity: glowOp * 0.45 * op, fixed }); // faint outer bloom (~7px)
    k.drawRect({ pos: k.vec2(x - 3, y - 3), width: w + 6,  height: h + 6,  radius: Math.min(w + 6, h + 6) / 2, color: col(glow), opacity: glowOp * op, fixed });        // glow hugging the edge (~3px)
  }
  const press = pressed && live ? 1 : 0;
  const custom = outline !== THEME.line ? outline : null;
  if (ghost || !live) {
    // UI v3 GLASS family (secondary actions + disabled): a white wash + white hairline, no shadow, no bevel.
    // Reads as part of the frosted sheet instead of a grey slab sitting on it. A custom outline colour
    // (selected / danger) replaces the hairline.
    const wash = !live ? 0.04 : pressed ? GLASS.fillPress : hover ? GLASS.fillHover : 0.07;
    k.drawRect({ pos: k.vec2(x, y + press), width: w, height: h, radius, color: col(WHITE), opacity: wash * op, fixed });
    k.drawRect({ pos: k.vec2(x + 0.5, y + press + 0.5), width: w - 1, height: h - 1, radius: Math.max(0, radius - 0.5), color: col(custom || WHITE),
      opacity: (custom ? 1 : !live ? 0.08 : hover ? 0.3 : 0.16) * op, fill: false, outline: { width: custom ? outlineW : 1, color: col(custom || WHITE) }, fixed });
  } else {
    // FILLED family (the primary action): one soft offset shadow + a top-lit gradient body + a catch-light.
    // Perf: list screens draw dozens of buttons per frame, so no ctx blur here.
    k.drawRect({ pos: k.vec2(x, y + 3 - press), width: w, height: h, radius: Math.min(w, h) / 2, color: col(THEME.bgAlt), opacity: 0.45 * op, fixed });
    k.drawRect({ pos: k.vec2(x, y + press), width: w, height: h, radius, color: col(fillCol), opacity: op, gradient: buttonGradient(fillCol),
      outline: { width: custom ? outlineW : 1, color: col(custom || darken(base, 40)) }, fixed });
    const inset = Math.max(2, radius * 0.9);
    k.drawRect({ pos: k.vec2(x + inset, y + press + 1.5), width: Math.max(4, w - inset * 2), height: 1.2, radius: 0.6,
      color: col(lighten(fillCol, 90)), opacity: 0.5 * op, fixed });
  }
  k.drawText({ text, pos: k.vec2(x + w / 2, y + h / 2 + press), size, font, anchor: "center",
    color: col(disabled ? THEME.textMut : textColor), fixed });
}

// Immediate-mode card/panel — the onDraw twin of addPanel (shadow + fill + hairline +
// top sheen). Use for rows, cards, modals, toasts in draw-mode scenes. Pass `hover`
// (from inRect(pointer, rect), desktop-only) for an interactive-row lift: a faint teal
// bloom + lit border + slightly brighter fill, so a pointer over a selectable card reads
// as actionable — the list-row counterpart of drawButton's hover. Opt-in: static panels
// pass no `hover` and render exactly as before.
export function drawPanel(k, { rect, fill = THEME.surface, border = THEME.line, radius = 14,
  opacity = 1, sheen = true, shadow = true, hover = false, glow = THEME.teal, borderW = 2, fixed = false } = {}) {
  const [x, y, w, h] = rect;
  const col = (t) => k.rgb(...t);
  // Soft drop shadow WITHOUT ctx blur (a blurred 760×560 panel shadow rasterized at ~20ms/frame on a
  // software canvas — tools/qa-bench.mjs). Large panels (popups, HUD cards, modals) stack three
  // widening translucent layers for a soft falloff; small rows/cards use one cheap offset layer.
  const big = w * h > 90000;
  if (shadow && big) {
    k.drawRect({ pos: k.vec2(x - 10, y + 2), width: w + 20, height: h + 18, radius: radius + 10, color: col(THEME.bgAlt), opacity: 0.18 * opacity, fixed });
    k.drawRect({ pos: k.vec2(x - 5, y + 4), width: w + 10, height: h + 10, radius: radius + 5, color: col(THEME.bgAlt), opacity: 0.28 * opacity, fixed });
    k.drawRect({ pos: k.vec2(x, y + 6), width: w, height: h, radius, color: col(THEME.bgAlt), opacity: 0.5 * opacity, fixed });
  } else if (shadow) {
    k.drawRect({ pos: k.vec2(x, y + 3), width: w, height: h, radius, color: col(THEME.bgAlt), opacity: 0.45 * opacity, fixed });
  }
  // UI v3 GLASS body (the immediate-mode twin of addPanel / drawGlass): a dark tint, a white wash (raised
  // surface tokens + hover wash brighter), then the edge — a white hairline, or the caller's ACCENT border
  // (selected / danger) when it isn't the neutral line token — and a top catch-light. `glow` is kept for
  // API compatibility (the hover lift is the wash now; no per-frame ctx blur).
  void glow;
  const raised = _eqCol(fill, THEME.surface2) || _eqCol(fill, THEME.surfaceAlt);
  k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius, color: col(THEME.bg), opacity: 0.8 * opacity, fixed });
  k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius, color: col(WHITE), opacity: (hover ? 0.1 : raised ? 0.08 : 0.05) * opacity, fixed });
  const accentBorder = !_eqCol(border, THEME.line);
  k.drawRect({ pos: k.vec2(x + 0.5, y + 0.5), width: w - 1, height: h - 1, radius: Math.max(0, radius - 0.5), color: col(accentBorder ? border : WHITE),
    opacity: (accentBorder ? 1 : hover ? GLASS.lineHover : 0.12) * opacity, fill: false, outline: { width: accentBorder ? Math.max(1, borderW) : 1, color: col(accentBorder ? border : WHITE) }, fixed });
  if (sheen) k.drawRect({ pos: k.vec2(x + radius, y + 1), width: Math.max(4, w - radius * 2), height: 1, radius: 0.5, color: col(WHITE), opacity: 0.2 * opacity, fixed });
}

// ── Design-upgrade helpers (2026-11) — shared chrome so every screen reads as one premium family ──

// ── UI v4 "Lantern" (2026-11, after v3) ─────────────────────────────────────────────────────────────
// Identity + life + readability on top of the v3 glass: a drawn ICON SET (icons.js), a SIGNATURE FRAME
// (icon tab on the top edge, corner ticks, per-station accent glow), ENTRANCE motion (rows/cards slide in
// with a stagger), an animated tab underline, count-up numbers, drifting motes and a header light sweep,
// and a bigger type scale. Everything stays canvas primitives (no images), so it themes like text.
export const TYPE = { display: 36, title: 28, h2: 20, body: 15, small: 13, micro: 11, eyebrow: 11 };

// Count-up: the displayed number eases toward the real value (wallets, XP). Keyed per call site.
const _count = new Map(); // key → { shown, t }
export function countUp(k, key, value) {
  const v = Number(value) || 0;
  const now = typeof k.time === "function" ? k.time() : 0;
  const c = _count.get(key);
  if (!c) { _count.set(key, { shown: v, t: now }); return v; }
  const dt = Math.min(0.1, Math.max(0, now - c.t)); c.t = now;
  if (Math.abs(v - c.shown) < 0.6) { c.shown = v; return v; }
  c.shown += (v - c.shown) * (1 - Math.exp(-dt * 7));
  return Math.round(c.shown);
}

// Entrance stagger: item i of a list that appeared at `openedT` slides up from +14px over 0.22s, each
// item 30ms after the previous. Returns the y offset to ADD (0 once settled). Pure (no state).
export function entranceDy(k, openedT, i, { step = 0.03, dur = 0.22, from = 14 } = {}) {
  if (openedT == null || typeof k.time !== "function") return 0;
  const t = k.time() - openedT - i * step;
  if (t >= dur) return 0;
  if (t <= 0) return from;
  const p = t / dur, e = 1 - (1 - p) * (1 - p) * (1 - p);
  return (1 - e) * from;
}

// Corner ticks: short L-shaped accent lines in the four corners of a frame (an "ornament" that says
// "designed", not "default rounded rect"). `inset` from the edge; `len` arm length.
export function drawCornerTicks(k, { rect, color = THEME.primary, opacity = 0.7, inset = 12, len = 14, width = 2, which = ["tl", "tr", "bl", "br"], fixed = false } = {}) {
  const [x, y, w, h] = rect;
  const c = k.rgb(...color);
  const all = { tl: [x + inset, y + inset, 1, 1], tr: [x + w - inset, y + inset, -1, 1], bl: [x + inset, y + h - inset, 1, -1], br: [x + w - inset, y + h - inset, -1, -1] };
  const corners = which.map((n) => all[n]).filter(Boolean);
  for (const [cx, cy, sx, sy] of corners) {
    k.drawLine({ p1: k.vec2(cx, cy), p2: k.vec2(cx + sx * len, cy), width, color: c, opacity, fixed });
    k.drawLine({ p1: k.vec2(cx, cy), p2: k.vec2(cx, cy + sy * len), width, color: c, opacity, fixed });
  }
}

// ICON TAB: a rounded accent square riding the top edge of a frame, with the station's icon in dark ink.
// Returns its rect. The sheet header places the title to its right.
export function drawIconTab(k, { x, y, size = 52, icon = "village", accent = THEME.primary, opacity = 1, fixed = false } = {}) {
  const r = Math.round(size * 0.3);
  k.drawRect({ pos: k.vec2(x, y + 4), width: size, height: size, radius: r, color: k.rgb(...THEME.bgAlt), opacity: 0.5 * opacity, fixed });
  k.drawRect({ pos: k.vec2(x, y), width: size, height: size, radius: r, color: k.rgb(...accent), opacity, gradient: buttonGradient(accent),
    outline: { width: 1, color: k.rgb(...darken(accent, 40)) }, fixed });
  k.drawRect({ pos: k.vec2(x + r * 0.7, y + 1.5), width: size - r * 1.4, height: 1.2, radius: 0.6, color: k.rgb(...lighten(accent, 90)), opacity: 0.55 * opacity, fixed });
  drawIcon(k, icon, { x: x + size / 2, y: y + size / 2, size: size * 0.52, color: THEME.textInv, opacity, weight: Math.max(2, size / 22), fixed });
  return [x, y, size, size];
}

// Drifting MOTES inside a rect (sheet life): deterministic from time, no state. Drawn under content.
export function drawMotes(k, { rect, color = THEME.teal, count = 12, t = null, opacity = 0.18, fixed = false } = {}) {
  const [x, y, w, h] = rect;
  const now = t != null ? t : (typeof k.time === "function" ? k.time() : 0);
  const c = k.rgb(...color);
  for (let i = 0; i < count; i++) {
    const h1 = ((i * 7919) % 1000) / 1000, h2 = ((i * 104729) % 1000) / 1000, h3 = ((i * 1299709) % 1000) / 1000;
    const speed = 0.018 + h3 * 0.03; // fraction of the height per second
    const py = y + h * (1 - ((h2 + now * speed) % 1));
    const px = x + w * h1 + Math.sin(now * 0.6 + i) * 8;
    const r = 1.2 + h3 * 1.8;
    const op = opacity * (0.5 + 0.5 * Math.sin(now * 1.3 + i * 1.7));
    k.drawCircle({ pos: k.vec2(px, py), radius: r, color: c, opacity: op, fixed });
  }
}

// Header light SWEEP: a soft diagonal highlight that glides across `rect` every ~7s.
export function drawSweep(k, { rect, period = 7, width = 0.22, opacity = 0.07, fixed = false } = {}) {
  const [x, y, w, h] = rect;
  const now = typeof k.time === "function" ? k.time() : 0;
  const p = (now % period) / period;
  if (p > 0.45) return; // visible for the first 45% of the period, then rests
  const c = Math.min(1.2, Math.max(-0.2, p / 0.45 * 1.4 - 0.2));
  const s0 = Math.max(0, c - width), s1 = Math.min(1, c + width);
  k.drawRect({ pos: k.vec2(x, y), width: w, height: h, color: k.rgb(...WHITE), opacity: 1,
    gradient: { dir: "h", stops: [[0, WHITE, 0], [s0, WHITE, 0], [Math.min(1, Math.max(0, c)), WHITE, opacity], [s1, WHITE, 0], [1, WHITE, 0]] }, fixed });
}

// EMPTY STATE: a big faded icon with a title + hint, centred in `rect` — replaces lone grey sentences.
export function drawEmptyState(k, { rect, icon = "info", title = "", text = "", accent = THEME.primary, fixed = false } = {}) {
  const [x, y, w, h] = rect;
  const cx = x + w / 2, cy = y + Math.min(h / 2, 120);
  k.drawCircle({ pos: k.vec2(cx, cy - 10), radius: 40, color: k.rgb(...accent), opacity: 0.1, fixed });
  drawIcon(k, icon, { x: cx, y: cy - 10, size: 40, color: accent, opacity: 0.8, fixed });
  if (title) k.drawText({ text: title, pos: k.vec2(cx, cy + 44), size: TYPE.h2, font: FONT_BOLD, anchor: "center", color: k.rgb(...THEME.text), fixed });
  if (text) k.drawText({ text, pos: k.vec2(cx, cy + 72), size: TYPE.small, font: FONT, anchor: "center", width: Math.min(w - 40, 420), align: "center", color: k.rgb(...THEME.textMut), fixed });
}

// ── UI v3 "Glass & Ember" (2026-11) ───────────────────────────────────────────────────────────────
// The lobby sheets are FROSTED GLASS over the live village (k.drawFrost), so everything drawn on them is a
// translucent WHITE WASH over a dark tint rather than an opaque grey slab: rows/cards = white at 4–9%,
// hairlines = white at 8–20%, the ember accent reserved for the one primary action + selection. Type does
// the hierarchy: big bold titles, letter-spaced small-caps EYEBROWS for section names, muted body.
export const WHITE = [255, 255, 255];
export const GLASS = { fill: 0.05, fillHover: 0.09, fillPress: 0.13, line: 0.09, lineHover: 0.22, tint: 0.46 };

// A glass surface: optional dark tint (for sheets / wells), a white wash, and a white hairline. `hover`
// lifts the wash + hairline. Everything is one family so a row, a card, a chip and a sheet all match.
export function drawGlass(k, { rect, radius = 14, fill = GLASS.fill, line = GLASS.line, tint = 0, hover = false, fixed = false } = {}) {
  const [x, y, w, h] = rect;
  if (tint > 0) k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius, color: k.rgb(...THEME.bg), opacity: tint, fixed });
  const f = hover ? Math.max(fill, GLASS.fillHover) : fill;
  if (f > 0) k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius, color: k.rgb(...WHITE), opacity: f, fixed });
  const l = hover ? Math.max(line, GLASS.lineHover) : line;
  if (l > 0) k.drawRect({ pos: k.vec2(x + 0.5, y + 0.5), width: w - 1, height: h - 1, radius: Math.max(0, radius - 0.5), color: k.rgb(...WHITE), opacity: l, fill: false, outline: { width: 1, color: k.rgb(...WHITE) }, fixed });
}
// A list ROW on a sheet (shop / settings / market): glass with a hover lift. Thin wrapper so call sites read.
export function drawRow(k, { rect, radius = 14, hover = false, fixed = false } = {}) {
  drawGlass(k, { rect, radius, hover, fixed });
}
// A 1px white hairline (section separators).
export function drawHairline(k, { x, y, w, opacity = 0.08, fixed = false } = {}) {
  k.drawRect({ pos: k.vec2(x, y), width: w, height: 1, color: k.rgb(...WHITE), opacity, fixed });
}
// Letter-spaced small-caps EYEBROW label ("TEAM", "AUDIO", "SPIRIT SHOP"). Draws glyph by glyph with real
// metrics (k.measureText) so the tracking is even. Returns the drawn width. `anchor` left|center|right.
export function drawEyebrow(k, { x, y, text = "", size = 11, color = THEME.textMut, spacing = 2.2, anchor = "left", opacity = 1, fixed = false } = {}) {
  const s = String(text).toUpperCase();
  if (!s) return 0;
  const measure = typeof k.measureText === "function" ? (t) => k.measureText(t, size, FONT_BOLD) : (t) => t.length * size * 0.62;
  const widths = [...s].map((ch) => measure(ch));
  const total = widths.reduce((a, b) => a + b, 0) + spacing * Math.max(0, widths.length - 1);
  let cx = anchor === "center" ? x - total / 2 : anchor === "right" ? x - total : x;
  const c = k.rgb(...color);
  [...s].forEach((ch, i) => { if (ch !== " ") k.drawText({ text: ch, pos: k.vec2(cx, y), size, font: FONT_BOLD, color: c, opacity, fixed }); cx += widths[i] + spacing; });
  return total;
}
// A small CHIP / tag ("T3", "owned", "guest", "Lv 12"). `color` tints the wash + text. Returns the chip rect.
export function drawChip(k, { x, y, text = "", color = THEME.textBody, size = 10, padX = 7, h = 18, anchor = "left", solid = false, fixed = false } = {}) {
  const s = String(text);
  const tw = typeof k.measureText === "function" ? k.measureText(s, size, FONT_BOLD) : s.length * size * 0.6;
  const w = Math.ceil(tw + padX * 2);
  const cx = anchor === "center" ? x - w / 2 : anchor === "right" ? x - w : x;
  const r = [cx, y, w, h];
  if (solid) k.drawRect({ pos: k.vec2(cx, y), width: w, height: h, radius: h / 2, color: k.rgb(...color), fixed });
  else {
    k.drawRect({ pos: k.vec2(cx, y), width: w, height: h, radius: h / 2, color: k.rgb(...color), opacity: 0.16, fixed });
    k.drawRect({ pos: k.vec2(cx + 0.5, y + 0.5), width: w - 1, height: h - 1, radius: h / 2, color: k.rgb(...color), opacity: 0.35, fill: false, outline: { width: 1, color: k.rgb(...color) }, fixed });
  }
  k.drawText({ text: s, pos: k.vec2(cx + w / 2, y + h / 2), size, font: FONT_BOLD, anchor: "center", color: k.rgb(...(solid ? THEME.textInv : color)), fixed });
  return r;
}
// A SWITCH (on/off toggle) centred in `rect`: pill track (ember when on, glass when off) + a white knob that
// slides. The caller owns the hit-test (use the full rect). Returns the track rect.
export function drawSwitch(k, { rect, on = false, hover = false, w = 46, h = 26, fixed = false } = {}) {
  const [rx, ry, rw, rh] = rect;
  const x = rx + rw - w, y = ry + (rh - h) / 2;
  if (on) k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius: h / 2, color: k.rgb(...THEME.primary), gradient: buttonGradient(THEME.primary), fixed });
  else drawGlass(k, { rect: [x, y, w, h], radius: h / 2, fill: hover ? 0.12 : 0.08, line: hover ? 0.26 : 0.16, fixed });
  if (on && hover) k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius: h / 2, color: k.rgb(...WHITE), opacity: 0.1, fixed });
  const kr = h / 2 - 3, kx = on ? x + w - 3 - kr : x + 3 + kr;
  k.drawCircle({ pos: k.vec2(kx, y + h / 2 + 1), radius: kr, color: k.rgb(...THEME.bgAlt), opacity: 0.35, fixed });
  k.drawCircle({ pos: k.vec2(kx, y + h / 2), radius: kr, color: k.rgb(...(on ? WHITE : THEME.textBody)), fixed });
  return [x, y, w, h];
}
// A SEGMENTED control (2–4 short options, e.g. Auto / On / Off) inside `rect`: glass track + a lit segment.
// Returns the per-option rects for hit-testing.
export function drawSegments(k, { rect, options = [], active, pointer = null, size = 12, fixed = false } = {}) {
  const [x, y, w, h] = rect;
  drawGlass(k, { rect, radius: h / 2, fill: 0.05, line: 0.12, fixed });
  const n = Math.max(1, options.length), sw = (w - 4) / n, out = [];
  options.forEach(([id, label], i) => {
    const r = [x + 2 + i * sw, y + 2, sw, h - 4];
    const on = id === active, hov = pointer ? inRect(pointer, r) : false;
    if (on) k.drawRect({ pos: k.vec2(r[0], r[1]), width: r[2], height: r[3], radius: r[3] / 2, color: k.rgb(...THEME.primary), gradient: buttonGradient(THEME.primary), fixed });
    else if (hov) k.drawRect({ pos: k.vec2(r[0], r[1]), width: r[2], height: r[3], radius: r[3] / 2, color: k.rgb(...WHITE), opacity: 0.08, fixed });
    k.drawText({ text: label, pos: k.vec2(r[0] + r[2] / 2, r[1] + r[3] / 2), size, font: FONT_BOLD, anchor: "center", color: k.rgb(...(on ? WHITE : hov ? THEME.text : THEME.textBody)), fixed });
    out.push({ id, r });
  });
  return out;
}
// A METER bar (volume / XP / HP): glass track + a filled portion. `color` = fill.
export function drawMeter(k, { rect, frac = 0, color = THEME.primary, radius = null, fixed = false } = {}) {
  const [x, y, w, h] = rect, r = radius == null ? h / 2 : radius;
  k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius: r, color: k.rgb(...WHITE), opacity: 0.1, fixed });
  const f = Math.max(0, Math.min(1, frac));
  if (f > 0) k.drawRect({ pos: k.vec2(x, y), width: Math.max(h, w * f), height: h, radius: r, color: k.rgb(...color), fixed });
}

// TAB control: text tabs with an ember underline under the active one (no filled pill — the sheet's
// primary action keeps the only solid ember). Hover = faint glass pill. Returns the per-tab rects
// [{ id, r }] for hit-testing (the host keeps its own tap routing). `tabs` = [[id, label]].
const _tabAnim = new Map(); // animKey → { x, w, t } (the underline's current position; lerps toward the active tab)
export function drawTabs(k, { rect, tabs = [], active, pointer = null, size = 14, accent = THEME.primary, animKey = null, fixed = false } = {}) {
  const [x, y, w, h] = rect;
  const col = (t) => k.rgb(...t);
  const n = Math.max(1, tabs.length), tw = w / n;
  drawHairline(k, { x, y: y + h - 1, w, opacity: 0.08, fixed });
  const out = [];
  let target = null;
  tabs.forEach((tab, i) => {
    const [id, label, icon] = tab;
    const r = [x + i * tw, y, tw, h];
    const on = id === active, hov = pointer ? inRect(pointer, r) : false;
    if (hov && !on) k.drawRect({ pos: k.vec2(r[0] + 4, r[1] + 3), width: r[2] - 8, height: r[3] - 9, radius: 10, color: col(WHITE), opacity: 0.06, fixed });
    const textW = typeof k.measureText === "function" ? k.measureText(label, size, FONT_BOLD) : label.length * size * 0.6;
    const iconW = icon ? size + 8 : 0;
    const cx = r[0] + r[2] / 2, cy = r[1] + (r[3] - 3) / 2;
    const ink = on ? THEME.text : hov ? THEME.textBody : THEME.textMut;
    if (icon) drawIcon(k, icon, { x: cx - textW / 2 - 2, y: cy, size: size + 2, color: on ? accent : ink, fixed });
    k.drawText({ text: label, pos: k.vec2(cx + iconW / 2, cy), size, font: FONT_BOLD, anchor: "center", color: col(ink), fixed });
    if (on) target = { x: r[0] + (r[2] - Math.min(r[2] - 16, textW + iconW + 14)) / 2, w: Math.min(r[2] - 16, textW + iconW + 14) };
    out.push({ id, r });
  });
  if (target) {
    let cur = target;
    if (animKey) {
      const now = typeof k.time === "function" ? k.time() : 0;
      const a = _tabAnim.get(animKey);
      if (!a || Math.abs(a.y - y) > 1) { _tabAnim.set(animKey, { x: target.x, w: target.w, y, t: now }); cur = target; }
      else { const dt = Math.min(0.1, Math.max(0, now - a.t)); const f = 1 - Math.exp(-dt * 16); a.x += (target.x - a.x) * f; a.w += (target.w - a.w) * f; a.t = now; cur = a; }
    }
    k.drawRect({ pos: k.vec2(cur.x, y + h - 3), width: cur.w, height: 3, radius: 1.5, color: col(accent), fixed });
  }
  return out;
}

// A grid CARD (monster / cosmetic / chain) on a sheet: a dark well so the art pops, the glass wash, a soft
// radial accent glow behind the art, and a hairline that lights on hover / turns ember when selected.
export function drawCard(k, { rect, accent = THEME.neutral, hover = false, selected = false, radius = 14, glowY = 0.38, fixed = false } = {}) {
  const col = (t) => k.rgb(...t);
  // Hover lift: the card frame pops out by 3px (content stays put) — reads as the card rising toward you.
  const L = hover ? 3 : 0;
  const [x, y, w, h] = [rect[0] - L, rect[1] - L, rect[2] + L * 2, rect[3] + L * 2];
  if (hover) k.drawRect({ pos: k.vec2(x, y + 4), width: w, height: h, radius, color: col(THEME.bgAlt), opacity: 0.35, fixed });
  k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius, color: col(THEME.bg), opacity: 0.38, fixed });
  k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius, color: col(WHITE), opacity: hover || selected ? 0.08 : 0.045, fixed });
  // Radial accent glow in the upper card (behind the art) — gives every card a lit "stage".
  k.drawRect({ pos: k.vec2(x + 1, y + 1), width: w - 2, height: h - 2, radius: radius - 1, color: col(accent), opacity: 1,
    gradient: { dir: "radial", cx: 0.5, cy: glowY, r: Math.max(w, h) * 0.55, stops: [[0, accent, selected ? 0.3 : 0.2], [0.6, accent, 0.05], [1, accent, 0]] }, fixed });
  if (selected) k.drawRect({ pos: k.vec2(x + 1, y + 1), width: w - 2, height: h - 2, radius: radius - 1, color: col(THEME.primary), fill: false, outline: { width: 2, color: col(THEME.primary) }, fixed });
  else k.drawRect({ pos: k.vec2(x + 0.5, y + 0.5), width: w - 1, height: h - 1, radius: radius - 0.5, color: col(WHITE), opacity: hover ? GLASS.lineHover : GLASS.line, fill: false, outline: { width: 1, color: col(WHITE) }, fixed });
}

// A bottom NAME PLATE band inside a card (legible over the art) — the shared plate the roster/bestiary
// cards each hand-rolled. Returns the plate rect.
export function drawCardPlate(k, { rect, h = 30, inset = 6, radius = 8, opacity = 0.62, fixed = false } = {}) {
  const [x, y, w, ch] = rect;
  const r = [x + inset, y + ch - h - inset, w - inset * 2, h];
  k.drawRect({ pos: k.vec2(r[0], r[1]), width: r[2], height: r[3], radius, color: k.rgb(...THEME.bg), opacity,
    gradient: { dir: "v", stops: [[0, THEME.bg, opacity * 0.8], [1, THEME.bgAlt, opacity]] }, fixed });
  return r;
}

// SECTION label: small-caps ember heading + a hairline rule fading out to the right. Returns the y
// below it. Used for "TEAM", "Active team", "Audio"… so groups read as designed sections, not stray text.
export function drawSectionLabel(k, { x, y, w = 200, text = "", size = 11, color = THEME.primary, fixed = false } = {}) {
  const col = (t) => k.rgb(...t);
  const label = String(text).toUpperCase();
  k.drawText({ text: label, pos: k.vec2(x, y), size, font: FONT_BOLD, color: col(color), fixed });
  const tw = label.length * size * 0.68 + 10;
  if (w - tw > 24) k.drawRect({ pos: k.vec2(x + tw, y + size / 2), width: w - tw, height: 1, color: col(color), opacity: 1,
    gradient: { dir: "h", stops: [[0, color, 0.55], [1, color, 0]] }, fixed });
  return y + size + 8;
}

// Round CLOSE button with a drawn cross (no glyph text — crisp at every size). `rect` is [x,y,w,h].
export function drawCloseX(k, { rect, hover = false, fixed = false } = {}) {
  const [x, y, w, h] = rect;
  const col = (t) => k.rgb(...t);
  drawButton(k, { rect, text: "", fill: THEME.surfaceAlt, radius: Math.min(w, h) / 2, hover, fixed });
  void col;
  drawIcon(k, "close", { x: x + w / 2, y: y + h / 2, size: Math.min(w, h) * 0.46, color: hover ? THEME.text : THEME.textBody, weight: 2.2, fixed });
}

// Full-screen VIGNETTE / scrim: darkens toward the edges (radial) so the centred UI pops and the
// scene behind reads as a stage. `opacity` = edge darkness; `center` = darkness at the middle.
export function drawVignette(k, { center = 0, opacity = 0.6, fixed = true } = {}) {
  const W = k.width(), H = k.height();
  k.drawRect({ pos: k.vec2(0, 0), width: W, height: H, color: k.rgb(0, 0, 0), opacity: 1,
    gradient: { dir: "radial", r: Math.hypot(W, H) * 0.56, stops: [[0, [0, 0, 0], center], [0.55, [0, 0, 0], center + (opacity - center) * 0.35], [1, [0, 0, 0], opacity]] }, fixed });
}

// Ornamental RULE: a thin ember line fading at both ends with a small bright core — the signature
// under popup titles and page headers. `anchor` "left" starts at x; "center" centres on x.
export function drawOrnamentRule(k, { x, y, w = 160, color = THEME.teal, anchor = "left", fixed = false } = {}) {
  const x0 = anchor === "center" ? x - w / 2 : x;
  k.drawRect({ pos: k.vec2(x0, y), width: w, height: 2, radius: 1, color: k.rgb(...color), opacity: 1,
    gradient: { dir: "h", stops: anchor === "center" ? [[0, color, 0], [0.5, color, 1], [1, color, 0]] : [[0, color, 1], [0.6, color, 0.7], [1, color, 0]] }, fixed });
  k.drawRect({ pos: k.vec2(x0 + (anchor === "center" ? w / 2 - 14 : 0), y - 1), width: 28, height: 4, radius: 2, color: k.rgb(...lighten(color, 60)), opacity: 0.001,
    shadow: { blur: 8, color, alpha: 0.9 }, fixed });
}

// Immediate-mode page header — title text + the glowing teal accent rule (the canvas
// `.rule`), matching addHeader so draw-mode pages read as the same family. Returns the
// y just below the rule so callers can lay content beneath it.
export function drawHeader(k, { x = 20, y = 16, title = "", size = 25, ruleW = 150, color = THEME.text, fixed = true } = {}) {
  const col = (t) => k.rgb(...t);
  k.drawText({ text: title, pos: k.vec2(x, y), size, font: FONT_BOLD, color: col(color), fixed });
  const ry = y + size + 4;
  // An ornamental rule fading out to the right (no wide glow — TQ-202 — just a crisp line that tapers).
  k.drawRect({ pos: k.vec2(x, ry + 2), width: ruleW, height: 2, radius: 1, color: col(THEME.teal), opacity: 1,
    gradient: { dir: "h", stops: [[0, THEME.teal, 1], [0.6, THEME.teal, 0.7], [1, THEME.teal, 0]] }, fixed });
  return ry + 6;
}

// Vertical scrollbar (subtle track + thumb) — the onDraw element every scroll scene
// (roster/bestiary/cosmetics/shop) re-rolled by hand with identical math but a divergent
// thumb colour and no track. `top` is the track's top y, `trackH` its height, `contentH`
// the full scrollable content height, `scrollY`/`maxScroll` the current + max scroll. The
// thumb math matches the prior per-scene code exactly; the faint track is the added polish
// so it reads as a proper scrollbar, not a floating nub. No-op when there's nothing to scroll.
export function drawScrollbar(k, { top, trackH, contentH, scrollY, maxScroll, x, w = 5,
  color = THEME.textMut, track = true } = {}) {
  if (!(maxScroll > 0) || !(contentH > 0)) return;
  const thumbH = Math.max(30, (trackH * trackH) / contentH);
  const thumbY = top + (scrollY / maxScroll) * (trackH - thumbH);
  const px = x != null ? x : k.width() - 7;
  const col = (t) => k.rgb(...t);
  if (track) k.drawRect({ pos: k.vec2(px, top), width: w, height: trackH, radius: w / 2, color: col(THEME.lineSoft), opacity: 0.6, fixed: true });
  k.drawRect({ pos: k.vec2(px, thumbY), width: w, height: thumbH, radius: w / 2, color: col(color), fixed: true });
}

// Transient bottom-center toast — the brief "Purchased!" / "Vault is full" pill that
// roster/cosmetics/shop/baseUpgrades each hand-rolled (two flat, two via drawPanel, at
// three different y's). One helper now renders them all: a drawPanel pill (shadow + sheen)
// at a fixed bottom anchor, the same width math, and a fade-out over the last ~0.4s (the
// added polish — they used to pop out hard). Callers keep their own `t` countdown and pass
// it in; renders nothing once it elapses. Width tracks `size` so big-text toasts still fit.
export function drawToast(k, { text, t, color = THEME.text, size = 13 } = {}) {
  if (!(t > 0) || !text) return;
  const op = Math.min(1, t / 0.4); // ease the last 0.4s out
  const tw = Math.min(k.width() - 40, size * text.length + 36);
  const x = k.width() / 2, y = k.height() - 44;
  drawPanel(k, { rect: [x - tw / 2, y - 15, tw, 30], radius: 8, opacity: op, fixed: true });
  k.drawText({ text, pos: k.vec2(x, y), size, font: FONT, anchor: "center", color: k.rgb(...color), opacity: op, fixed: true });
}

// Integer with thousands separators — shared so every wallet reads the same ("1,250", not "1250").
export const fmtCurrency = (n) => String(Math.floor(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// Canonical currency hues (game identity): gold = amber (earned), essence = arcane violet (premium/paid).
export const CURRENCY_HUE = { gold: THEME.amber, essence: THEME.violet };

// Shared currency chips — TQ-98. One consistent rendering for the wallet everywhere it's shown
// (shop / cosmetics / base-upgrades / hub), replacing the per-scene hand-rolled "X gold  Y essence"
// text that drifted in colour, layout and which currencies it listed. Each currency is a small
// coloured pip + its value in the matching hue. `items` is an ordered list of { kind, value }
// (kind ∈ gold|essence) or { color, value } for an explicit hue; entries with a null/undefined
// value are skipped (so a currency only shows once the profile carries it). Lays the row out from
// (x, y) per `anchor` (left|center|right, x is that edge/centre; y is the vertical centre) and
// returns { width } so callers can right-align or place a control after it.
export function drawCurrency(k, { x, y, items = [], size = 13, gap = 16, pip = 4, anchor = "left", animKey = null, fixed = true } = {}) {
  const col = (t) => k.rgb(...t);
  const chW = size * 0.6; // Fredoka digit/comma width estimate (no measureText in the shim)
  const list = items
    .filter((it) => it && it.value != null)
    .map((it) => {
      const color = it.color || CURRENCY_HUE[it.kind] || THEME.text;
      const text = fmtCurrency(animKey ? countUp(k, `${animKey}:${it.kind || it.color}`, it.value) : it.value);
      return { kind: it.kind, color, text, w: pip * 2 + 6 + text.length * chW };
    });
  const total = list.reduce((s, it) => s + it.w, 0) + gap * Math.max(0, list.length - 1);
  let cx = anchor === "right" ? x - total : anchor === "center" ? x - total / 2 : x;
  for (const it of list) {
    drawCurrencyIcon(k, it.kind, { x: cx + pip, y, r: pip, color: it.color, fixed }); // TQ-138: shaped per-currency icon (was a plain dot)
    // anchor "left-center" (left-aligned, MIDDLE baseline) so the amount centres on `y` — the SAME
    // centre the icon uses — instead of "left" (top baseline), which sat the text low under the icon.
    k.drawText({ text: it.text, pos: k.vec2(cx + pip * 2 + 6, y), anchor: "left-center", size, font: FONT, color: col(it.color), fixed });
    cx += it.w + gap;
  }
  return { width: total };
}

// TQ-192 (audit TQ-190 C): the shared WALLET PILL — a rounded panel chip wrapping drawCurrency, the
// canonical currency readout for screens where currency is shown/spent (cosmetics' TQ-140 pill; now
// also the spirit-shop + base-upgrades headers). `anchor` positions the pill's x edge: "right" → x is
// the right edge, "center" → x is the centre, "left" → x is the left edge. y is the pill's centre.
// Returns the pill rect [x,y,w,h] so a caller can place a "+" buy affordance flush against it.
export function drawWalletPill(k, { x, y, items = [], size = 15, anchor = "right", fixed = true } = {}) {
  const PIP = 5, GAP = 18, padX = 14, pillH = 34, chW = size * 0.6;
  const list = items.filter((it) => it && it.value != null);
  const contentW = list.reduce((s, it) => s + PIP * 2 + 6 + fmtCurrency(it.value).length * chW, 0) + GAP * Math.max(0, list.length - 1);
  const pillW = contentW + padX * 2;
  const px = anchor === "right" ? x - pillW : anchor === "center" ? x - pillW / 2 : x;
  const py = y - pillH / 2;
  drawPanel(k, { rect: [px, py, pillW, pillH], radius: pillH / 2, fill: THEME.surfaceAlt, border: THEME.line, borderW: 1, fixed });
  drawCurrency(k, { x: px + padX, y, anchor: "left", size, pip: PIP, gap: GAP, items: list, fixed });
  return [px, py, pillW, pillH];
}

// Shared atmospheric menu backdrop (the procedural "menu_background" texture).
// Scaled to COVER the current design area so it fills any aspect ratio with no
// dark gaps at the screen edges — the design width is now responsive (the shim
// matches the window aspect), so a fixed 1280×720 sprite must be cover-scaled.
// Pass { fixed, z } for immediate-mode scenes that need it behind onDraw content.
const MENU_BG_W = 1280, MENU_BG_H = 720; // generateMenuBackground() output size

// Font-load race guard. Phaser BAKES a text object's glyphs at creation time, so any menu
// that renders before the webfont (Fredoka) has parsed falls back to a system
// face — and only corrects on the next scene relayout. That's why menus "looked wrong until
// you resized the window" (resize re-runs the scene via the shim). Until/unless boot awaits the
// fonts, we re-render the current scene ONCE the moment the faces are ready, so the first menu a
// player sees is already correct. One-shot + guarded so it can never loop. No-op when the fonts
// were already parsed at first paint (the common warm-cache case).
let _fontReflowArmed = false;
function armFontReflow(k) {
  if (_fontReflowArmed) return;
  _fontReflowArmed = true;
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    // gameFontBold (loaded at boot in main.js) is included so the menu re-renders once the bold
    // weight buttons/headings use is ready too — not just the base faces.
    if (document.fonts.check("40px gameFont") && document.fonts.check("40px gameFontBody") && document.fonts.check("40px gameFontBold")) return;
  } catch { return; }
  document.fonts.ready.then(() => {
    try { if (k._lastGo) k.go(k._lastGo.name, k._lastGo.data); } catch { /* mid-transition — next nav fixes it */ }
  });
}

export function addMenuBackground(k, { fixed = false, z } = {}) {
  armFontReflow(k); // first menu paint: correct the font once the webfonts finish parsing
  const cover = Math.max(k.width() / MENU_BG_W, k.height() / MENU_BG_H);
  const comps = [k.sprite("menu_background"), k.pos(k.width() / 2, k.height() / 2),
    k.anchor("center"), k.scale(cover)];
  if (z != null) comps.push(k.z(z));
  if (fixed) comps.push(k.fixed());
  const bg = k.add(comps);
  // Design upgrade: a warm ember haze at the top + a vignette toward the edges, so menus read as a lit
  // stage instead of a flat dark field (retained gradient rects, screen-sized).
  const W = k.width(), H = k.height();
  const vig = [k.rect(W, H, { gradient: { dir: "radial", r: Math.hypot(W, H) * 0.56, stops: [[0, [0, 0, 0], 0], [0.6, [0, 0, 0], 0.18], [1, [0, 0, 0], 0.62]] } }),
    k.pos(W / 2, H / 2), k.anchor("center"), k.color(0, 0, 0)];
  const haze = [k.rect(W, H * 0.55, { gradient: { dir: "v", stops: [[0, THEME.teal, 0.07], [1, THEME.teal, 0]] } }),
    k.pos(W / 2, 0), k.anchor("top"), k.color(...THEME.teal)];
  if (z != null) { vig.push(k.z(z)); haze.push(k.z(z)); }
  if (fixed) { vig.push(k.fixed()); haze.push(k.fixed()); }
  k.add(haze); k.add(vig);
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
  // ~0.75·size px/glyph for the Fredoka display font. No-op on wide screens — the
  // caps only bite when width is small (portrait). On narrow widths we reserve ~150px
  // of corner room each side so the centered title clears a top-left/right button.
  const W = typeof k.width === "function" ? k.width() : 1280;
  const narrow = W < 560;
  const avail = narrow ? W - 220 : W - 40; // narrow: reserve ~110px/side so the centered title clears a top-corner Back/X button
  if (text && text.length) size = Math.max(12, Math.min(size, Math.floor(avail / (text.length * 0.75)))); // floor 12 so a long title on a tiny screen stays legible
  ruleW = Math.min(ruleW, W - 40);
  const label = addLabel(k, { x, y, text, size, color, font: FONT_BOLD }); // bold heading, like the title logo
  const ry = y + size * 0.8;
  // Ornamental rule: fades at both ends with a soft ember glow at its core.
  k.add([k.rect(ruleW, 2, { radius: 1, gradient: { dir: "h", stops: [[0, THEME.teal, 0], [0.5, THEME.teal, 1], [1, THEME.teal, 0]] } }), k.pos(x, ry), k.anchor("center"), k.color(...THEME.teal)]);
  k.add([k.rect(28, 4, { radius: 2, shadow: { blur: 10, color: THEME.teal, alpha: 0.9 } }), k.pos(x, ry), k.anchor("center"), k.color(...lighten(THEME.teal, 60)), k.opacity(0.001)]);
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
