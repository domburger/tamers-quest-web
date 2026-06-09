// Shared monster VISUAL-MODEL vocabulary — the single source of truth used by BOTH the
// procedural renderer (src/systems/spritegen.js) and the AI "builder"/Model agent
// (server/genPipeline.js schema + server/genStages.js prompt). Keeping it here means the
// builder is told EXACTLY what the renderer can draw, so it never specs a silhouette or
// feature the renderer can't realize, and the one model object becomes the monster's single
// sprite reused everywhere (HUD icon, combat portrait, bestiary art).
//
// Framework-free (no DOM, no server deps) so both the client renderer and the Node server
// import it safely.

// The six silhouette archetypes the renderer rigs to (drawBeast/drawRaptor/…).
export const BODY_SHAPES = ["beast", "raptor", "saurian", "leviathan", "arthropod", "brute"];

export const ARCHETYPE_DESC = {
  beast: "four-legged predator (wolf / big cat): low horizontal body, fanged snout, lashing tail",
  raptor: "upright winged hunter (bird / harpy): hooked beak, fanned wings, taloned feet",
  saurian: "sprawling reptile (dragon / lizard): long low body, dorsal plates, heavy tail",
  leviathan: "finned aquatic horror (eel / kraken): legless S-curve, fins, wide fanged maw",
  arthropod: "segmented bug (spider / scorpion / beetle): domed carapace, many legs, raised pincers",
  brute: "hulking front-facing giant (golem / ogre): massive clawed arms, sunken head, tusks",
};

// Feature vocabulary surfaced to the AI builder via renderEnvironmentBrief(). The builder
// now authors each creature FROM SCRATCH as shape primitives (modelRender.js), so these are
// inspiration cues in the prompt brief — no longer a dedicated draw-branch switch.
export const FEATURE_VOCAB = [
  "horns", "spines", "plates", "tusks", "wings",
  "tail_spike", "extra_eyes", "mane", "crystals", "bone_spurs",
];

export const FEATURE_DESC = {
  horns: "curved horns on the head",
  spines: "a tall row of dorsal spikes down the back",
  plates: "armored carapace plates over the body",
  tusks: "jutting bone tusks at the mouth",
  wings: "membranous wings spread behind the shoulders",
  tail_spike: "a bladed spike / stinger on the tail",
  extra_eyes: "additional glowing eyes",
  mane: "a spiky mane / frill around the neck",
  crystals: "crystalline shards growing from the back",
  bone_spurs: "exposed bone spurs and ridges",
};

// Free-form → canonical feature key, so the builder's natural wording ("two great horns",
// "chitin armor", "barbed tail") still resolves to a drawable feature.
const FEATURE_ALIASES = {
  horn: "horns", antler: "horns", antlers: "horns",
  spike: "spines", spikes: "spines", quill: "spines", quills: "spines", dorsal: "spines", ridge: "spines", spine: "spines",
  armor: "plates", armour: "plates", carapace: "plates", chitin: "plates", shell: "plates", scale: "plates", scales: "plates", plate: "plates", plating: "plates",
  tusk: "tusks", fang: "tusks", fangs: "tusks", teeth: "tusks",
  wing: "wings", membrane: "wings", batwing: "wings",
  stinger: "tail_spike", barb: "tail_spike", barbed: "tail_spike", scorpion: "tail_spike", blade: "tail_spike",
  eye: "extra_eyes", eyes: "extra_eyes",
  frill: "mane", ruff: "mane", crest: "mane",
  crystal: "crystals", crystalline: "crystals", shard: "crystals", shards: "crystals", gem: "crystals", gems: "crystals",
  bone: "bone_spurs", spur: "bone_spurs", spurs: "bone_spurs", skull: "bone_spurs",
};

export function canonicalFeature(s) {
  const t = String(s || "").trim().toLowerCase();
  if (!t) return null;
  if (FEATURE_VOCAB.includes(t)) return t;
  if (FEATURE_ALIASES[t]) return FEATURE_ALIASES[t];
  // loose contains-match so a free-form phrase still maps to a drawable feature
  for (const k of Object.keys(FEATURE_ALIASES)) if (t.includes(k)) return FEATURE_ALIASES[k];
  for (const v of FEATURE_VOCAB) if (t.includes(v.replace("_", " ")) || t.includes(v)) return v;
  return null;
}

// Clean an arbitrary features array → de-duped canonical keys (max 4 so a sprite stays readable).
export function canonicalFeatures(arr) {
  const out = [];
  if (!Array.isArray(arr)) return out;
  for (const f of arr) {
    const k = canonicalFeature(f);
    if (k && !out.includes(k)) out.push(k);
    if (out.length === 4) break;
  }
  return out;
}

// The compact "render target" brief injected into the builder/Model agent's prompt, so it
// designs WITHIN what the 2D procedural renderer can draw — and understands how Phaser reuses
// the result. Built from the vocabulary above so the prompt can never drift from the renderer.
export function renderEnvironmentBrief() {
  const shapes = BODY_SHAPES.map((s) => `  - ${s}: ${ARCHETYPE_DESC[s]}`).join("\n");
  const feats = FEATURE_VOCAB.map((f) => `  - ${f}: ${FEATURE_DESC[f]}`).join("\n");
  return `RENDER TARGET — how this monster gets drawn (design within it):
The game draws monsters with a PROCEDURAL 2D generator on an HTML canvas (NOT raster paintings or 3D models). Your spec IS the input to that generator: it builds ONE 128x128 sprite from your bodyShape + palette + features, and Phaser then reuses that single sprite at every size — a tiny team/HUD icon, the combat portrait, and the full-size bestiary art. So the SAME model must read clearly both small and large: choose a bold, distinct silhouette and 1-3 strong features rather than fine detail that vanishes when shrunk.

bodyShape — pick the ONE silhouette closest to the creature:
${shapes}

features — pick 1-3 from this exact list (other words are ignored by the renderer):
${feats}

palette — primary/secondary/accent, each a #hex value or a colour word (e.g. "crimson", "ash", "bone"); leave a field empty to fall back to the element's palette. Keep it grim and brutal, never pastel or cute.`;
}
