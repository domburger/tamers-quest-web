// Player-character cosmetics (visual only — no gameplay effect). Each skin sets
// the character's accent (rim-light, eyes, spirit-chain glow) and cloak tint.
// Used by the cosmetics store (scenes/cosmetics.js "Player Character" tab) and the
// local player's draw (render/character.js via the equipped accent/cloak). Pure
// data + a per-client localStorage equip, mirroring chainCosmetics.js.

// CN-9: acquisition mix (see engine/cosmetics.js) — commons + the uncommon free,
// rarer skins an earned gold/essence sink (legendary = scarce essence).
export const CHARACTER_SKINS = [
  { id: "azure",   name: "Azure Tamer",    rarity: "Common",    accent: [90, 170, 255],  cloak: [24, 21, 34], acquire: { kind: "free" } },
  { id: "ember",   name: "Ember Warden",   rarity: "Common",    accent: [255, 132, 80],  cloak: [34, 20, 18], acquire: { kind: "free" } },
  { id: "verdant", name: "Verdant Walker", rarity: "Uncommon",  accent: [96, 214, 134],  cloak: [18, 30, 22], acquire: { kind: "free" } },
  { id: "gilded",  name: "Gilded Seeker",  rarity: "Rare",      accent: [245, 205, 90],  cloak: [34, 28, 14], acquire: { kind: "cost", cur: "gold", amount: 250 } },
  { id: "dusk",    name: "Dusk Acolyte",   rarity: "Rare",      accent: [175, 130, 255], cloak: [26, 18, 38], acquire: { kind: "cost", cur: "gold", amount: 250 } },
  { id: "frost",   name: "Frostbound",     rarity: "Epic",      accent: [150, 225, 255], cloak: [18, 26, 36], acquire: { kind: "cost", cur: "gold", amount: 600 } },
  { id: "prism",   name: "Prism Herald",   rarity: "Legendary", accent: [255, 120, 200], cloak: [34, 20, 40], acquire: { kind: "cost", cur: "essence", amount: 150 } },
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
