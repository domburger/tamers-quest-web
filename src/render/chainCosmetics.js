// Spirit-chain cosmetics (visual only — no gameplay effect). A set of skin
// variations + one shared renderer used by the player character (render/
// character.js) and the cosmetics store (scenes/cosmetics.js). Pure k.* draws
// (Phaser shim). The equipped skin is per-client (localStorage).

// CN-9: each skin carries an `acquire` descriptor (free | cost | unlock). The
// commons + one uncommon are free so every player has variety; rarer skins are an
// earned gold/essence sink (the legendary costs the scarcer essence). Pure data —
// ownership/equip-gating lives in engine/cosmetics.js.
export const CHAIN_SKINS = [
  { id: "aether",  name: "Aether Loop",    rarity: "Common",    ring: [70, 230, 198], link: [234, 255, 251], core: [255, 255, 255], links: 8,  style: "round",   glow: 1.0,  acquire: { kind: "cost", cur: "gold", amount: 150 } }, // TQ-134: only the default (Ember Coil) is free
  { id: "ember",   name: "Ember Coil",     rarity: "Common",    ring: [255, 138, 80], link: [255, 224, 170], core: [255, 245, 220], links: 8,  style: "round",   glow: 1.1,  acquire: { kind: "free" } },
  { id: "verdant", name: "Verdant Bind",   rarity: "Uncommon",  ring: [91, 209, 126], link: [214, 255, 214], core: [245, 255, 245], links: 10, style: "round",   glow: 1.0,  acquire: { kind: "cost", cur: "gold", amount: 200 } },
  { id: "void",    name: "Void Halo",      rarity: "Rare",      ring: [170, 130, 255],link: [232, 216, 255], core: [255, 255, 255], links: 8,  style: "diamond", glow: 1.15, acquire: { kind: "cost", cur: "gold", amount: 250 } },
  { id: "frost",   name: "Frost Shard",    rarity: "Rare",      ring: [143, 224, 255],link: [236, 250, 255], core: [255, 255, 255], links: 6,  style: "crystal", glow: 1.2,  acquire: { kind: "cost", cur: "gold", amount: 250 } },
  { id: "rune",    name: "Runed Circlet",  rarity: "Epic",      ring: [120, 220, 255],link: [220, 245, 255], core: [255, 255, 255], links: 8,  style: "rune",    glow: 1.15, acquire: { kind: "cost", cur: "gold", amount: 600 } },
  { id: "sol",     name: "Solar Crown",    rarity: "Epic",      ring: [255, 206, 90], link: [255, 240, 180], core: [255, 250, 225], links: 12, style: "spiky",   glow: 1.3,  acquire: { kind: "cost", cur: "gold", amount: 600 } },
  { id: "prism",   name: "Prism Eternal",  rarity: "Legendary", ring: [255, 120, 200],link: [255, 255, 255], core: [255, 255, 255], links: 10, style: "crystal", glow: 1.5,  sparkle: true, acquire: { kind: "cost", cur: "essence", amount: 150 } },
  { id: "thorn",   name: "Thornwood Snare", rarity: "Uncommon",  ring: [120, 196, 96], link: [216, 240, 180], core: [245, 255, 230], links: 9,  style: "blade",   glow: 1.0,  acquire: { kind: "cost", cur: "gold", amount: 200 } },
  { id: "tide",    name: "Tidecaller Ring", rarity: "Rare",      ring: [80, 188, 230], link: [206, 240, 255], core: [240, 252, 255], links: 10, style: "petal",   glow: 1.1,  acquire: { kind: "cost", cur: "gold", amount: 300 } },
  { id: "clockwork", name: "Clockwork Gyre", rarity: "Rare",     ring: [214, 168, 92], link: [248, 224, 168], core: [255, 244, 214], links: 6,  style: "gear",    glow: 1.1,  acquire: { kind: "cost", cur: "gold", amount: 300 } },
  { id: "bloom",   name: "Bloom Eternal",   rarity: "Epic",      ring: [240, 130, 196], link: [255, 218, 238], core: [255, 248, 252], links: 8,  style: "petal",   glow: 1.2,  acquire: { kind: "cost", cur: "gold", amount: 600 } },
  { id: "starfall", name: "Starfall Wreath", rarity: "Epic",     ring: [150, 150, 255], link: [224, 224, 255], core: [255, 255, 255], links: 7,  style: "star",    glow: 1.25, acquire: { kind: "cost", cur: "gold", amount: 650 } },
  { id: "chrono",  name: "Chrono Halo",     rarity: "Legendary", ring: [255, 206, 110],link: [255, 240, 200], core: [255, 252, 235], links: 8,  style: "gear",    glow: 1.5,  sparkle: true, acquire: { kind: "cost", cur: "essence", amount: 170 } },
  { id: "pearl",   name: "Pearl Wreath",    rarity: "Uncommon",  ring: [226, 214, 236],link: [255, 246, 250], core: [255, 255, 255], links: 9,  style: "orb",     glow: 1.0,  acquire: { kind: "cost", cur: "gold", amount: 200 } },
  { id: "tempest", name: "Tempest Coil",    rarity: "Rare",      ring: [96, 196, 255], link: [206, 236, 255], core: [255, 255, 255], links: 7,  style: "bolt",    glow: 1.2,  acquire: { kind: "cost", cur: "gold", amount: 300 } },
  { id: "obsidian", name: "Obsidian Fang",  rarity: "Rare",      ring: [220, 92, 96],  link: [255, 196, 180], core: [255, 235, 230], links: 8,  style: "blade",   glow: 1.1,  acquire: { kind: "cost", cur: "gold", amount: 350 } },
  { id: "wraith",  name: "Wraith Lantern",  rarity: "Epic",      ring: [120, 230, 170],link: [212, 255, 230], core: [245, 255, 250], links: 9,  style: "orb",     glow: 1.3,  acquire: { kind: "cost", cur: "gold", amount: 600 } },
  { id: "astral",  name: "Astral Gate",     rarity: "Epic",      ring: [176, 130, 255],link: [228, 214, 255], core: [255, 255, 255], links: 8,  style: "rune",    glow: 1.3,  acquire: { kind: "cost", cur: "gold", amount: 650 } },
  { id: "eclipse", name: "Eclipse Crown",   rarity: "Legendary", ring: [255, 214, 120],link: [255, 240, 200], core: [255, 252, 235], links: 10, style: "bolt",    glow: 1.5,  sparkle: true, acquire: { kind: "cost", cur: "essence", amount: 170 } },
  { id: "clover",  name: "Clover Charm",    rarity: "Uncommon",  ring: [120, 206, 110],link: [212, 248, 196], core: [244, 255, 236], links: 8,  style: "clover",  glow: 1.0,  acquire: { kind: "cost", cur: "gold", amount: 200 } },
  { id: "mirage",  name: "Mirage Loop",     rarity: "Rare",      ring: [224, 188, 110],link: [255, 234, 188], core: [255, 246, 222], links: 8,  style: "eye",     glow: 1.1,  acquire: { kind: "cost", cur: "gold", amount: 300 } },
  { id: "hex",     name: "Hex Sigil",       rarity: "Rare",      ring: [168, 120, 240],link: [224, 206, 255], core: [248, 240, 255], links: 7,  style: "eye",     glow: 1.15, acquire: { kind: "cost", cur: "gold", amount: 350 } },
  { id: "tideweaver", name: "Tideweaver",   rarity: "Epic",      ring: [88, 200, 214], link: [206, 244, 248], core: [240, 254, 255], links: 10, style: "clover",  glow: 1.2,  acquire: { kind: "cost", cur: "gold", amount: 600 } },
  { id: "emberfang", name: "Emberfang",     rarity: "Epic",      ring: [255, 120, 70], link: [255, 206, 160], core: [255, 236, 210], links: 9,  style: "spiky",   glow: 1.3,  acquire: { kind: "cost", cur: "gold", amount: 650 } },
  { id: "oracle",  name: "Oracle's Eye",    rarity: "Legendary", ring: [236, 224, 255],link: [255, 255, 255], core: [255, 255, 255], links: 8,  style: "eye",     glow: 1.5,  sparkle: true, acquire: { kind: "cost", cur: "essence", amount: 170 } },
  // TQ-67/TQ-132: a premium cosmetic — purely visual, bought with essence (the paid currency).
  // Price is a tunable starter offering for monetization (00005) to curate.
  { id: "voidstar", name: "Voidstar Bind",  rarity: "Legendary", ring: [150, 120, 255],link: [216, 200, 255], core: [255, 255, 255], links: 10, style: "rune",    glow: 1.5,  sparkle: true, acquire: { kind: "cost", cur: "essence", amount: 120 } },
];
// Default to the (free) Ember Coil so the held spirit-chain glows warm in lockstep with the ember
// palette + default Ember tamer, instead of the old teal Aether Loop. Aether stays choosable.
export const DEFAULT_SKIN = CHAIN_SKINS.find((s) => s.id === "ember") || CHAIN_SKINS[0];
export const getSkin = (id) => CHAIN_SKINS.find((s) => s.id === id) || DEFAULT_SKIN;

// Rarity tint — anchored on PAL tokens so cosmetics, store, and bestiary tag the
// same rarity with the same hue (values mirrored from theme.js; file is intentionally
// import-free per its design note). Visible drift was Legendary 255,178,62 → amber.
export const RARITY_COLOR = {
  Common:    [147, 160, 166], // PAL.neutral
  Uncommon:  [75, 209, 140],  // PAL.success
  Rare:      [70, 166, 255],  // PAL.water
  Epic:      [166, 127, 230], // PAL.dark
  Legendary: [224, 168, 92],  // PAL.amber
};

// TQ-143 (decision TQ-151 "143 only"): a spirit chain's TIER is shown by the COLOUR of its centre
// dot — the one element shared across every chain skin — replacing the per-tier badge from TQ-142.
// A readable low→high progression (grey → green → blue → purple → gold → prismatic). Import-free
// raw RGB to match this module's design note. Clamped to the 6 defined tiers.
const TIER_COLORS = [
  [150, 160, 166], // T1 neutral grey
  [90, 205, 130],  // T2 green
  [80, 170, 255],  // T3 blue
  [175, 130, 255], // T4 purple
  [240, 180, 90],  // T5 amber/gold
  [255, 150, 215], // T6 prismatic
];
export const tierColor = (tier) => TIER_COLORS[Math.max(1, Math.min(6, tier || 1)) - 1];

// Equipped skin — cached so per-frame draws don't hit localStorage repeatedly.
const KEY = "tq_chain_skin";
let _equipped = null;
export function getEquippedSkinId() {
  if (_equipped == null) { try { _equipped = localStorage.getItem(KEY) || DEFAULT_SKIN.id; } catch { _equipped = DEFAULT_SKIN.id; } }
  return _equipped;
}
export function setEquippedSkinId(id) { _equipped = id; try { localStorage.setItem(KEY, id); } catch { /* ignore */ } }
export const getEquippedSkin = () => getSkin(getEquippedSkinId());

// Refined spirit-chain ring at (x,y), ring radius r, animated by t.
export function drawChainSkin(k, { x, y, r = 24, t = 0, skin = DEFAULT_SKIN, tier = null, fixed = false }) {
  const C = (c) => k.rgb(c[0], c[1], c[2]);
  // Build each reused colour ONCE per draw (this runs for every character every frame). The link colour
  // especially was rebuilt every loop iteration (skin.links≈8) and the ring colour 3×, so the same KColor
  // was re-allocated ~10× per chain ring. ringC/linkC/coreC are read-only consumers (drawCircle/drawLink
  // copy out the channels immediately), so sharing one object across the draws is safe + output-identical.
  const ringC = C(skin.ring), linkC = C(skin.link), coreC = C(skin.core);
  const pulse = 0.72 + 0.28 * Math.sin(t * 4);
  const g = skin.glow || 1;
  // layered glow halo
  k.drawCircle({ pos: k.vec2(x, y), radius: r * 2.0, color: ringC, opacity: 0.09 * g * pulse, fixed });
  k.drawCircle({ pos: k.vec2(x, y), radius: r * 1.35, color: ringC, opacity: 0.16 * g * pulse, fixed });
  // double ring band
  k.drawCircle({ pos: k.vec2(x, y), radius: r, fill: false, outline: { width: Math.max(2, r * 0.12), color: ringC }, fixed });
  k.drawCircle({ pos: k.vec2(x, y), radius: r * 0.76, fill: false, outline: { width: Math.max(1, r * 0.05), color: linkC }, opacity: 0.45, fixed });
  // links around the ring (rotating)
  const n = skin.links || 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + t * 0.6;
    drawLink(k, skin.style, x + Math.cos(a) * r, y + Math.sin(a) * r, a, r * 0.2, linkC, fixed);
  }
  // core — TQ-143: the centre dot is TIER-COLOURED when a tier is supplied (the shared tier
  // indicator), else the skin's own neutral core (store previews / tier-agnostic contexts).
  const coreCol = tier != null ? tierColor(tier) : skin.core;
  k.drawCircle({ pos: k.vec2(x, y), radius: r * 0.2, color: tier != null ? C(coreCol) : coreC, opacity: (tier != null ? 0.7 : 0.4) * g, fixed });
  k.drawCircle({ pos: k.vec2(x, y), radius: r * 0.1, color: k.rgb(255, 255, 255), opacity: tier != null ? 0.85 : 1, fixed });
  // legendary orbiting sparkles
  if (skin.sparkle) {
    for (let i = 0; i < 3; i++) {
      const a = -t * 1.4 + i * 2.1;
      k.drawCircle({ pos: k.vec2(x + Math.cos(a) * r * 1.32, y + Math.sin(a) * r * 1.32), radius: Math.max(1, r * 0.07), color: coreC, opacity: 0.85, fixed });
    }
  }
}

// TQ-439: the spirit-chain SHOP icon — the player's EQUIPPED cosmetic skin (drawChainSkin) overlaid
// with the chain's TIER core, so the shop previews each chain in YOUR equipped look (parity with the
// held chain in-world: onlineGame.js / character.js), instead of the flat generic ring glyph. This is
// the "overlay the shop's tier/core visuals with the cosmetic skins" that never reached prod. `t`
// animates the ring; `fixed` for screen-space (popup shell / menu scene). Null-safe.
export function drawChainShopIcon(k, def, { x, y, r = 13, t = 0, fixed = false } = {}) {
  if (!def) return;
  drawChainSkin(k, { x, y, r, t, skin: getEquippedSkin(), tier: def.tier, fixed });
}

// TQ-143: the compact chain GLYPH for list/HUD surfaces (chains shop, roster Items/loadout, in-run
// HUD) — a small chain-link ring in the chain's own colour with a TIER-COLOURED centre dot. Replaces
// the TQ-142 per-tier badge (decision TQ-151 "143 only"): tier reads from the centre dot, nothing else.
export function drawChainGlyph(k, chain, { x, y, size = 28, fixed = true } = {}) {
  if (!chain) return;
  const C = (c) => k.rgb(c[0], c[1], c[2]);
  const ring = Array.isArray(chain.color) ? chain.color : [150, 150, 160];
  const ringC = C(ring); // built ONCE — was rebuilt 10x per glyph (halo + band + the 8-link loop)
  const r = size / 2, lr = r * 0.64;
  k.drawCircle({ pos: k.vec2(x, y), radius: r * 0.96, color: ringC, opacity: 0.14, fixed }); // soft halo
  k.drawCircle({ pos: k.vec2(x, y), radius: lr, fill: false, outline: { width: Math.max(1.5, size * 0.07), color: ringC }, opacity: 0.6, fixed }); // ring band
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; k.drawCircle({ pos: k.vec2(x + Math.cos(a) * lr, y + Math.sin(a) * lr), radius: Math.max(1.3, size * 0.085), color: ringC, fixed }); } // links
  const tc = tierColor(chain.tier);
  k.drawCircle({ pos: k.vec2(x, y), radius: Math.max(2.6, size * 0.2), color: C(tc), fixed }); // TIER centre dot — the only tier cue
  k.drawCircle({ pos: k.vec2(x, y), radius: Math.max(1.1, size * 0.09), color: k.rgb(255, 255, 255), opacity: 0.85, fixed }); // bright pip
}

// A single chain "link" in one of several styles (shim has no rotated rects, so
// shapes are built from circles + radial lines): "round" (default) | "diamond" |
// "crystal" | "spiky" | "rune" | "star" | "gear" | "petal" | "blade" | "bolt" | "orb" |
// "clover" | "eye".
function drawLink(k, style, x, y, a, s, col, fixed) {
  if (style === "rune") {
    k.drawCircle({ pos: k.vec2(x, y), radius: s, fill: false, outline: { width: Math.max(1, s * 0.5), color: col }, fixed });
  } else if (style === "spiky" || style === "crystal") {
    const ca = Math.cos(a), sa = Math.sin(a), len = s * 1.7;
    k.drawLine({ p1: k.vec2(x - ca * s * 0.6, y - sa * s * 0.6), p2: k.vec2(x + ca * len, y + sa * len),
      width: style === "crystal" ? Math.max(1, s * 0.5) : Math.max(1.5, s * 0.9), color: col, fixed });
    k.drawCircle({ pos: k.vec2(x + ca * len, y + sa * len), radius: s * 0.5, color: col, fixed });
  } else if (style === "diamond") {
    const d = s * 1.15, w = Math.max(1, s * 0.5);
    k.drawLine({ p1: k.vec2(x - d, y), p2: k.vec2(x + d, y), width: w, color: col, fixed });
    k.drawLine({ p1: k.vec2(x, y - d), p2: k.vec2(x, y + d), width: w, color: col, fixed });
  } else if (style === "star") {
    // Four-armed sparkle (cross of radial spokes) + a bright centre.
    for (let i = 0; i < 4; i++) {
      const aa = a + i * Math.PI / 2;
      k.drawLine({ p1: k.vec2(x, y), p2: k.vec2(x + Math.cos(aa) * s * 1.3, y + Math.sin(aa) * s * 1.3), width: Math.max(1, s * 0.4), color: col, fixed });
    }
    k.drawCircle({ pos: k.vec2(x, y), radius: s * 0.45, color: col, fixed });
  } else if (style === "gear") {
    // Toothed cog: a ring + six short radial teeth (clockwork read).
    k.drawCircle({ pos: k.vec2(x, y), radius: s * 0.8, fill: false, outline: { width: Math.max(1, s * 0.4), color: col }, fixed });
    for (let i = 0; i < 6; i++) {
      const aa = a + i * Math.PI / 3;
      k.drawLine({ p1: k.vec2(x + Math.cos(aa) * s * 0.7, y + Math.sin(aa) * s * 0.7), p2: k.vec2(x + Math.cos(aa) * s * 1.2, y + Math.sin(aa) * s * 1.2), width: Math.max(1, s * 0.45), color: col, fixed });
    }
  } else if (style === "petal") {
    // Rounded petal/leaf — a big inner lobe + a smaller outer tip along the radius.
    const ca = Math.cos(a), sa = Math.sin(a);
    k.drawCircle({ pos: k.vec2(x + ca * s * 0.5, y + sa * s * 0.5), radius: s * 0.85, color: col, fixed });
    k.drawCircle({ pos: k.vec2(x + ca * s * 1.3, y + sa * s * 1.3), radius: s * 0.4, color: col, fixed });
  } else if (style === "blade") {
    // Dagger link — a long spike with a short crossguard at the base.
    const ca = Math.cos(a), sa = Math.sin(a), len = s * 2.0;
    k.drawLine({ p1: k.vec2(x - ca * s * 0.5, y - sa * s * 0.5), p2: k.vec2(x + ca * len, y + sa * len), width: Math.max(1, s * 0.45), color: col, fixed });
    k.drawLine({ p1: k.vec2(x - sa * s * 0.7, y + ca * s * 0.7), p2: k.vec2(x + sa * s * 0.7, y - ca * s * 0.7), width: Math.max(1, s * 0.4), color: col, fixed });
  } else if (style === "bolt") {
    // Lightning zigzag along the radius (out via two perpendicular kinks).
    const ca = Math.cos(a), sa = Math.sin(a), pxv = -sa, pyv = ca, w = Math.max(1, s * 0.4);
    const p0 = k.vec2(x - ca * s * 0.8, y - sa * s * 0.8);
    const p1 = k.vec2(x + pxv * s * 0.7, y + pyv * s * 0.7);
    const p2 = k.vec2(x - pxv * s * 0.5, y - pyv * s * 0.5);
    const p3 = k.vec2(x + ca * s * 1.4, y + sa * s * 1.4);
    k.drawLine({ p1: p0, p2: p1, width: w, color: col, fixed });
    k.drawLine({ p1, p2, width: w, color: col, fixed });
    k.drawLine({ p1: p2, p2: p3, width: w, color: col, fixed });
  } else if (style === "orb") {
    // Glowing bead — a soft halo + a bright core.
    k.drawCircle({ pos: k.vec2(x, y), radius: s * 1.3, color: col, opacity: 0.3, fixed });
    k.drawCircle({ pos: k.vec2(x, y), radius: s * 0.7, color: col, fixed });
  } else if (style === "clover") {
    // Trefoil — three lobes around the centre.
    for (let j = 0; j < 3; j++) {
      const aj = a + (j - 1) * 0.95;
      k.drawCircle({ pos: k.vec2(x + Math.cos(aj) * s * 0.7, y + Math.sin(aj) * s * 0.7), radius: s * 0.6, color: col, fixed });
    }
  } else if (style === "eye") {
    // Mystic eye sigil — an iris ring + a bright pupil.
    k.drawCircle({ pos: k.vec2(x, y), radius: s * 0.95, fill: false, outline: { width: Math.max(1, s * 0.35), color: col }, fixed });
    k.drawCircle({ pos: k.vec2(x, y), radius: s * 0.42, color: col, fixed });
  } else { // round
    k.drawCircle({ pos: k.vec2(x, y), radius: s, color: col, fixed });
  }
}
