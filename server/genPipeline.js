import { normalizeGeneratedMonster, assignAttacks } from "./gen.js";
import { getAttacks } from "../src/engine/gamedata.js";
import { coerceHtmlModel, HTML_SCHEMA_DESC_DEFAULTS } from "../src/systems/htmlModel.js";

// Mirrors gen.js STAT_KEYS; change both.
const STAT_KEYS = ["Health", "Strength", "Defense", "Speed", "Power", "Energy", "Luck"];

export const SCHEMA_DESC_DEFAULTS = {
  "idea.inspiration": "2-4 words to characterize the monster, e.g. 'volcanic armored beetle'.",
  "attributes.typeName": "Short evocative name (<=40 chars).",
  "attributes.description": "1-3 sentence bestiary blurb.",
  "attributes.passiveEffect": "Short passive-ability description, or empty.",
  "attributes.attacks": "EXACTLY 4 distinct attacks. Each: a 2-3 word title + a one-sentence description that BOTH reads to the player AND tells the fight-judge how to resolve it (its effect, rough power, any status it inflicts).",
  "attributes.attackTitle": "2-3 word attack name.",
  "attributes.attackDescription": "One sentence: what the attack does in a fight (effect / rough power / any status) - player- and judge-readable.",
  "attributes.visualDescription": "A vivid 1-2 sentence VISUAL description of the creature for the builder agent: silhouette/body plan, palette, and distinctive BRUTAL features.",
  "attributes.baseStat": "Base {stat} (1-400, ~60 typical).",
  ...HTML_SCHEMA_DESC_DEFAULTS,

  "item.name": "Short evocative item NAME (1-3 words, <=40 chars).",
  "item.description": "ONE sentence: what the item DOES when used in a fight (the action — player-readable AND an instruction to the fight-judge). No numbers required.",
  "biome.name": "Short evocative region NAME (1-2 words).",
  "biome.description": "One sentence describing the region's terrain + mood.",
  "biome.rarity": "Rarity 1-100 (higher = rarer / more dangerous).",
  "biome.size": "Typical region size 30-120 (how large this biome tends to be on the map).",
  "biome.tint": "Representative minimap colour {r,g,b} (0-255) — a saturated, legible hue distinct from neighbouring regions.",
  "tile.name": "Short evocative ground-type NAME (1-3 words).",
  "tile.description": "One sentence describing this ground surface.",
  "tile.color": "Base colour {r,g,b} (0-255) the renderer textures — fits BOTH the ground type and its biome.",
  "tile.rarity": "Rarity 1-100 (how common this ground type is within its biome).",
  "tile.slipperiness": "Slipperiness 0-10 (0 = normal footing).",
  "tile.emissiveness": "How much the ground glows in the dark cave, 0-5 (0 = none).",
};
const defaultDesc = (k) => SCHEMA_DESC_DEFAULTS[k] ?? "";

function str(v, def) {
  return typeof v === "string" && v.trim() ? v.trim() : def;
}

export function buildIdeaSchema(d = defaultDesc) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      inspiration: { type: "string", description: d("idea.inspiration") },
    },
    required: ["inspiration"],
  };
}
export const IDEA_SCHEMA = buildIdeaSchema();

export function buildAttributesSchema(d = defaultDesc) {
  const props = {
    typeName: { type: "string", description: d("attributes.typeName") },
    rarity: { type: "integer", minimum: 1, maximum: 5 },
    size: { type: "integer", minimum: 1, maximum: 6 },
    description: { type: "string", description: d("attributes.description") },
    passiveEffect: { type: "string", description: d("attributes.passiveEffect") },
    attacks: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      description: d("attributes.attacks"),
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", description: d("attributes.attackTitle") },
          description: { type: "string", description: d("attributes.attackDescription") },
        },
        required: ["title", "description"],
      },
    },
    visualDescription: { type: "string", description: d("attributes.visualDescription") },
  };
  for (const k of STAT_KEYS) {
    const lk = k.toLowerCase();
    props[`base${k}`] = { type: "integer", minimum: 1, maximum: 400, description: d("attributes.baseStat").replace(/\{stat\}/g, lk) };
    props[`${lk}Scaling1`] = { type: "number", minimum: 0, maximum: 5 };
    props[`${lk}Scaling2`] = { type: "number", minimum: 0, maximum: 1.3 };
  }
  return { type: "object", additionalProperties: false, properties: props, required: ["typeName", "rarity"] };
}
export const ATTRIBUTES_SCHEMA = buildAttributesSchema();

export function coerceIdea(raw = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  const inspiration = str(r.inspiration, str(r.theme, "a wild cave creature")).slice(0, 120);
  return { inspiration };
}

export async function runGenPipeline(stages = {}, opts = {}) {
  if (typeof stages.idea !== "function" || typeof stages.attributes !== "function") {
    throw new TypeError("runGenPipeline: stages.idea and stages.attributes must be functions");
  }
  try {
    const idea = coerceIdea(await stages.idea(opts));
    const attrRaw = await stages.attributes(idea, opts);
    if (!attrRaw || typeof attrRaw !== "object") return null;
    let monster = normalizeGeneratedMonster(attrRaw, { ...opts, inspiration: idea.inspiration });
    if (!monster) { console.warn("[genPipeline] generation rejected: no typeName"); return null; }
    assignAttacks(monster, opts.attackPool || getAttacks(), opts.rand || Math.random);
    let model = null;
    if (typeof stages.model === "function") {
      model = coerceHtmlModel(await stages.model({ idea, monster }, opts));
      if (model) monster.html = model;
    }
    return { monster, idea, model };
  } catch (e) {
    console.error("[genPipeline] generation failed:", e.message);
    return null;
  }
}
