// Player-character cosmetics (visual only — no gameplay effect). Each skin sets
// the character's accent (rim-light, eyes, spirit-chain glow) and cloak tint.
// Used by the cosmetics store (scenes/cosmetics.js "Player Character" tab) and the
// local player's draw (render/character.js via the equipped accent/cloak). Pure
// data + a per-client localStorage equip, mirroring chainCosmetics.js.

// CN-9: acquisition mix (see engine/cosmetics.js) — commons + the uncommon free,
// rarer skins an earned gold/essence sink (legendary = scarce essence). Per-skin
// hues are intentional identities; the default Azure anchors on PAL.water so a fresh
// player's accent is on-palette (was a plain sky-blue [90,170,255] that drifted off
// the bioluminescent direction).
//
// `model` (render/character.js) picks the BODY SILHOUETTE — "cloak" (the original
// hooded tamer, default) | "knight" | "mage" | "automaton" | "wisp" | "warden" |
// "seraph" | "diver" | "monarch" | "corvid" | "ronin" | "golem" | "naga" | "jester" |
// "treant" | "lich" | "anubis" | "myconid" | "angler" | "scarecrow". This is what
// makes a skin a genuinely different figure, not just a recolour. The first batch are
// all cloak recolours; the rest are distinct models (one skin per model).
export const CHARACTER_SKINS = [
  { id: "azure",   name: "Azure Tamer",    rarity: "Common",    model: "cloak", accent: [70, 166, 255],  cloak: [24, 21, 34], acquire: { kind: "free" } }, // PAL.water
  { id: "ember",   name: "Ember Warden",   rarity: "Common",    model: "cloak", accent: [255, 132, 80],  cloak: [34, 20, 18], acquire: { kind: "free" } },
  { id: "verdant", name: "Verdant Walker", rarity: "Uncommon",  model: "cloak", accent: [96, 214, 134],  cloak: [18, 30, 22], acquire: { kind: "free" } },
  { id: "gilded",  name: "Gilded Seeker",  rarity: "Rare",      model: "cloak", accent: [245, 205, 90],  cloak: [34, 28, 14], acquire: { kind: "cost", cur: "gold", amount: 250 } },
  { id: "dusk",    name: "Dusk Acolyte",   rarity: "Rare",      model: "cloak", accent: [175, 130, 255], cloak: [26, 18, 38], acquire: { kind: "cost", cur: "gold", amount: 250 } },
  { id: "frost",   name: "Frostbound",     rarity: "Epic",      model: "cloak", accent: [150, 225, 255], cloak: [18, 26, 36], acquire: { kind: "cost", cur: "gold", amount: 600 } },
  { id: "prism",   name: "Prism Herald",   rarity: "Legendary", model: "cloak", accent: [255, 120, 200], cloak: [34, 20, 40], acquire: { kind: "cost", cur: "essence", amount: 150 } },
  // ── Distinct models (different figures, not colour swaps) ──────────────────
  { id: "vanguard",   name: "Iron Vanguard",      rarity: "Uncommon",  model: "knight",    accent: [200, 212, 230], cloak: [40, 44, 54], acquire: { kind: "free" } },
  { id: "warden",     name: "Wild Warden",        rarity: "Uncommon",  model: "warden",    accent: [214, 150, 92],  cloak: [34, 26, 20], acquire: { kind: "free" } },
  { id: "diver",      name: "Abyssal Diver",      rarity: "Rare",      model: "diver",     accent: [90, 220, 230],  cloak: [20, 30, 38], acquire: { kind: "cost", cur: "gold", amount: 400 } },
  { id: "corvid",     name: "Plague Corvid",      rarity: "Rare",      model: "corvid",    accent: [150, 220, 130], cloak: [22, 24, 26], acquire: { kind: "cost", cur: "gold", amount: 450 } },
  { id: "starweaver", name: "Starweaver",         rarity: "Rare",      model: "mage",      accent: [158, 132, 255], cloak: [26, 22, 46], acquire: { kind: "cost", cur: "gold", amount: 350 } },
  { id: "sentinel",   name: "Clockwork Sentinel", rarity: "Epic",      model: "automaton", accent: [120, 230, 200], cloak: [30, 34, 42], acquire: { kind: "cost", cur: "gold", amount: 750 } },
  { id: "monarch",    name: "Gilded Monarch",     rarity: "Epic",      model: "monarch",   accent: [245, 205, 90],  cloak: [36, 22, 40], acquire: { kind: "cost", cur: "gold", amount: 800 } },
  { id: "seraph",     name: "Dawn Seraph",        rarity: "Epic",      model: "seraph",    accent: [255, 235, 170], cloak: [40, 38, 30], acquire: { kind: "cost", cur: "essence", amount: 120 } },
  { id: "wisp",       name: "Hollow Wisp",        rarity: "Legendary", model: "wisp",      accent: [140, 255, 225], cloak: [20, 30, 34], acquire: { kind: "cost", cur: "essence", amount: 180 } },
  { id: "ronin",      name: "Wandering Ronin",    rarity: "Uncommon",  model: "ronin",     accent: [235, 110, 96],  cloak: [30, 28, 32], acquire: { kind: "free" } },
  { id: "golem",      name: "Runestone Golem",    rarity: "Rare",      model: "golem",     accent: [255, 150, 70],  cloak: [40, 36, 34], acquire: { kind: "cost", cur: "gold", amount: 450 } },
  { id: "naga",       name: "Serpent Oracle",     rarity: "Rare",      model: "naga",      accent: [120, 230, 120], cloak: [22, 32, 26], acquire: { kind: "cost", cur: "gold", amount: 500 } },
  { id: "jester",     name: "Masque Harlequin",   rarity: "Epic",      model: "jester",    accent: [240, 110, 220], cloak: [30, 22, 40], acquire: { kind: "cost", cur: "gold", amount: 700 } },
  { id: "treant",     name: "Elder Sylvan",       rarity: "Epic",      model: "treant",    accent: [150, 230, 120], cloak: [34, 28, 18], acquire: { kind: "cost", cur: "essence", amount: 130 } },
  { id: "myconid",    name: "Sporeling Myconid",  rarity: "Uncommon",  model: "myconid",   accent: [186, 140, 255], cloak: [34, 28, 32], acquire: { kind: "free" } },
  { id: "lich",       name: "Bonecaller Lich",    rarity: "Rare",      model: "lich",      accent: [150, 255, 180], cloak: [22, 26, 24], acquire: { kind: "cost", cur: "gold", amount: 500 } },
  { id: "jackal",     name: "Tomb Jackal",        rarity: "Rare",      model: "anubis",    accent: [240, 200, 90],  cloak: [30, 26, 20], acquire: { kind: "cost", cur: "gold", amount: 500 } },
  { id: "angler",     name: "Gloomlure Angler",   rarity: "Epic",      model: "angler",    accent: [110, 235, 215], cloak: [16, 24, 30], acquire: { kind: "cost", cur: "gold", amount: 700 } },
  { id: "scarecrow",  name: "Hollow Harvest",     rarity: "Epic",      model: "scarecrow", accent: [240, 178, 80],  cloak: [34, 28, 18], acquire: { kind: "cost", cur: "essence", amount: 130 } },
];
export const DEFAULT_CHARACTER_SKIN = CHARACTER_SKINS[0];
export const getCharacterSkin = (id) => CHARACTER_SKINS.find((s) => s.id === id) || DEFAULT_CHARACTER_SKIN;

const KEY = "tq_char_skin";
let _equipped = null;
export function getEquippedCharacterSkinId() {
  if (_equipped == null) { try { _equipped = localStorage.getItem(KEY) || DEFAULT_CHARACTER_SKIN.id; } catch { _equipped = DEFAULT_CHARACTER_SKIN.id; } }
  return _equipped;
}
export function setEquippedCharacterSkinId(id) { _equipped = id; try { localStorage.setItem(KEY, id); } catch { /* ignore */ } }
export const getEquippedCharacterSkin = () => getCharacterSkin(getEquippedCharacterSkinId());
