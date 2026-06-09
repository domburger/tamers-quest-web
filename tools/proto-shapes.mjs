// PROTOTYPE: have the LLM author a monster's visual FROM SCRATCH as a list of 2D shape
// primitives (no archetype template). Writes .screenshots/proto-shapes.json for the render
// harness. Run: OPENAI_API_KEY=... node tools/proto-shapes.mjs [model]
import { writeFileSync, mkdirSync } from "node:fs";
import { openaiChatJson } from "../server/openai.js";

const MODEL = process.argv[2] || "gpt-5.4";

const SYSTEM = `You are a VISUAL BUILDER that draws a fearsome dark-fantasy monster FROM SCRATCH as 2D vector shapes on a 128x128 canvas. There is no template — you compose the WHOLE creature yourself.

Coordinate system: origin top-left, x increases RIGHT (0..128), y increases DOWN (0..128). The ground line is y≈116; the creature stands/sits on it and should fill most of the frame (about x 22..106, y 18..116). The creature faces RIGHT.

Primitives (each is one JSON object):
- {"kind":"ellipse","cx":..,"cy":..,"rx":..,"ry":..,"rot":deg,"fill":"#hex","stroke":"#hex","sw":2} — rounded MASSES: body, head, haunch, shoulder, muzzle.
- {"kind":"circle","cx":..,"cy":..,"r":..,"fill":"#hex"} — eyes, nostrils, joints, spots.
- {"kind":"polygon","points":[[x,y],[x,y],[x,y]...],"fill":"#hex","stroke":"#hex","sw":2} — ANGULAR/POINTED parts: horns, spikes, jaws, fangs, claws, fins, wings, crest, tail blade (3-12 points).
- {"kind":"limb","x1":..,"y1":..,"x2":..,"y2":..,"w":width,"fill":"#hex"} — a thick rounded bar: leg, arm, neck, tail segment.

Rules:
- Build BACK-TO-FRONT: far limbs + background masses first, then torso, then near limbs, head, and finally eyes/teeth ON TOP (later shapes cover earlier ones).
- FILLED shapes with a slightly darker outline. Colours are #hex. Use a cohesive GRIM palette (dark desaturated body; a BRIGHT accent only for eyes / glowing parts). Never pastel, never cute.
- A BOLD, instantly-readable predator silhouette. Use 16-32 shapes.
- Respond ONLY with JSON: {"shapes":[ ... ]}.`;

const CONCEPTS = [
  { name: "Cinderhorn", element: "Fire", concept: "a molten-basalt horned brute with cracked glowing skin" },
  { name: "Trench Leviathan", element: "Water", concept: "an abyssal finned eel-leviathan with a gaping fanged maw" },
  { name: "Mycobark Scorpid", element: "Nature", concept: "a bark-plated fungal scorpion with a barbed tail" },
  { name: "Voltclaw Raptor", element: "Electric", concept: "a storm-charged winged raptor with jagged talons" },
  { name: "Vaultmaw Colossus", element: "Ice", concept: "a hulking ice-troll colossus with frozen tusks" },
];

mkdirSync(".screenshots", { recursive: true });
const out = [];
for (const c of CONCEPTS) {
  process.stdout.write(`generating ${c.name} (${c.element}) … `);
  try {
    const r = await openaiChatJson({
      model: MODEL,
      system: SYSTEM,
      user: `Build the monster: ${c.concept}. Element: ${c.element}. Compose it from scratch as shapes. Respond as JSON {"shapes":[...]}.`,
      maxTokens: 6000,
      timeoutMs: 90000,
    });
    const shapes = Array.isArray(r && r.shapes) ? r.shapes : [];
    console.log(`${shapes.length} shapes`);
    out.push({ ...c, shapes });
  } catch (e) {
    console.log("FAIL:", e.message);
    out.push({ ...c, shapes: [], error: e.message });
  }
}
writeFileSync(".screenshots/proto-shapes.json", JSON.stringify(out, null, 1));
console.log(`\nwrote .screenshots/proto-shapes.json (model=${MODEL})`);
