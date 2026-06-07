// Spirit-chain cosmetics (visual only — no gameplay effect). A set of skin
// variations + one shared renderer used by the player character (render/
// character.js) and the cosmetics store (scenes/cosmetics.js). Pure k.* draws
// (Phaser shim). The equipped skin is per-client (localStorage).

// CN-9: each skin carries an `acquire` descriptor (free | cost | unlock). The
// commons + one uncommon are free so every player has variety; rarer skins are an
// earned gold/essence sink (the legendary costs the scarcer essence). Pure data —
// ownership/equip-gating lives in engine/cosmetics.js.
export const CHAIN_SKINS = [
  { id: "aether",  name: "Aether Loop",    rarity: "Common",    ring: [91, 240, 214], link: [234, 255, 251], core: [255, 255, 255], links: 8,  style: "round",   glow: 1.0,  acquire: { kind: "free" } },
  { id: "ember",   name: "Ember Coil",     rarity: "Common",    ring: [255, 138, 80], link: [255, 224, 170], core: [255, 245, 220], links: 8,  style: "round",   glow: 1.1,  acquire: { kind: "free" } },
  { id: "verdant", name: "Verdant Bind",   rarity: "Uncommon",  ring: [91, 209, 126], link: [214, 255, 214], core: [245, 255, 245], links: 10, style: "round",   glow: 1.0,  acquire: { kind: "free" } },
  { id: "void",    name: "Void Halo",      rarity: "Rare",      ring: [170, 130, 255],link: [232, 216, 255], core: [255, 255, 255], links: 8,  style: "diamond", glow: 1.15, acquire: { kind: "cost", cur: "gold", amount: 250 } },
  { id: "frost",   name: "Frost Shard",    rarity: "Rare",      ring: [143, 224, 255],link: [236, 250, 255], core: [255, 255, 255], links: 6,  style: "crystal", glow: 1.2,  acquire: { kind: "cost", cur: "gold", amount: 250 } },
  { id: "rune",    name: "Runed Circlet",  rarity: "Epic",      ring: [120, 220, 255],link: [220, 245, 255], core: [255, 255, 255], links: 8,  style: "rune",    glow: 1.15, acquire: { kind: "cost", cur: "gold", amount: 600 } },
  { id: "sol",     name: "Solar Crown",    rarity: "Epic",      ring: [255, 206, 90], link: [255, 240, 180], core: [255, 250, 225], links: 12, style: "spiky",   glow: 1.3,  acquire: { kind: "cost", cur: "gold", amount: 600 } },
  { id: "prism",   name: "Prism Eternal",  rarity: "Legendary", ring: [255, 120, 200],link: [255, 255, 255], core: [255, 255, 255], links: 10, style: "crystal", glow: 1.5,  sparkle: true, acquire: { kind: "cost", cur: "essence", amount: 150 } },
];
export const DEFAULT_SKIN = CHAIN_SKINS[0];
export const getSkin = (id) => CHAIN_SKINS.find((s) => s.id === id) || DEFAULT_SKIN;

export const RARITY_COLOR = {
  Common: [154, 166, 178], Uncommon: [91, 209, 126], Rare: [70, 166, 255],
  Epic: [170, 130, 255], Legendary: [255, 178, 62],
};

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
export function drawChainSkin(k, { x, y, r = 24, t = 0, skin = DEFAULT_SKIN, fixed = false }) {
  const C = (c) => k.rgb(c[0], c[1], c[2]);
  const pulse = 0.72 + 0.28 * Math.sin(t * 4);
  const g = skin.glow || 1;
  // layered glow halo
  k.drawCircle({ pos: k.vec2(x, y), radius: r * 2.0, color: C(skin.ring), opacity: 0.09 * g * pulse, fixed });
  k.drawCircle({ pos: k.vec2(x, y), radius: r * 1.35, color: C(skin.ring), opacity: 0.16 * g * pulse, fixed });
  // double ring band
  k.drawCircle({ pos: k.vec2(x, y), radius: r, fill: false, outline: { width: Math.max(2, r * 0.12), color: C(skin.ring) }, fixed });
  k.drawCircle({ pos: k.vec2(x, y), radius: r * 0.76, fill: false, outline: { width: Math.max(1, r * 0.05), color: C(skin.link) }, opacity: 0.45, fixed });
  // links around the ring (rotating)
  const n = skin.links || 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + t * 0.6;
    drawLink(k, skin.style, x + Math.cos(a) * r, y + Math.sin(a) * r, a, r * 0.2, C(skin.link), fixed);
  }
  // core
  k.drawCircle({ pos: k.vec2(x, y), radius: r * 0.18, color: C(skin.core), opacity: 0.4 * g, fixed });
  k.drawCircle({ pos: k.vec2(x, y), radius: r * 0.1, color: k.rgb(255, 255, 255), fixed });
  // legendary orbiting sparkles
  if (skin.sparkle) {
    for (let i = 0; i < 3; i++) {
      const a = -t * 1.4 + i * 2.1;
      k.drawCircle({ pos: k.vec2(x + Math.cos(a) * r * 1.32, y + Math.sin(a) * r * 1.32), radius: Math.max(1, r * 0.07), color: C(skin.core), opacity: 0.85, fixed });
    }
  }
}

// A single chain "link" in one of several styles (shim has no rotated rects, so
// shapes are built from circles + radial lines).
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
  } else { // round
    k.drawCircle({ pos: k.vec2(x, y), radius: s, color: col, fixed });
  }
}
