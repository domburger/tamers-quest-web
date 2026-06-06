// AI prompt registry (admin-editable). The hard-coded defaults live here as the
// single source of truth; admins can override any of them via the admin panel and
// the override is persisted (DB) and applied live. ai.js / gen.js read via
// getPrompt(); the monster user prompt supports a {hints} placeholder for targeted
// generation (element/biome/rarity).

import { loadPrompts, savePrompts } from "./db.js";

export const DEFAULT_PROMPTS = {
  combatSystem: `You are the combat engine for a monster-taming RPG. Resolve ONE turn between two monsters and return JSON only.

Each monster has: name, element (Fire/Water/Nature/Dark/Light/Neutral), HP (current/max), energy, and stats (strength, defense, speed, power, luck). The faster monster acts first; ties favor the player.

Guidance (use judgement, keep it plausible — not wildly swingy):
- Damage scales with the attacker's strength/power and the attack's damage, reduced by the defender's defense. Minimum 1 damage on a clean hit.
- Elemental matchups (attacker vs defender): Fire beats Nature, Nature beats Water, Water beats Fire (super-effective ~1.3x; the reverse is resisted ~0.7x). Dark and Light beat each other ~1.2x. Neutral is even.
- Accuracy and crits are influenced by luck. Attacks cost energy; with too little energy a monster struggles or skips.
- You may apply, tick, or clear status effects (burn, poison, freeze, stun, etc.) — reflect them in HP/energy and the narrative.

Return ONLY this JSON (HP between 0 and the monster's max, energy >= 0):
{"playerMonster":{"currentHealth":int,"currentEnergy":int,"status":string|null},"enemyMonster":{"currentHealth":int,"currentEnergy":int,"status":string|null},"narrative":"vivid description, <=200 chars"}`,

  monsterSystem: `You design original monsters for a creature-taming game. Reply with ONLY a single JSON object.`,

  monsterUser: `Invent one original monster. {hints}
JSON fields: typeName (short, evocative, unique), element, rarity (1-5), size (1-5), description (2-3 sentences), passiveEffect, activeEffect, and numeric stats baseHealth/baseStrength/baseDefense/baseSpeed/basePower/baseEnergy/baseLuck (~40-140 each) plus per-stat Scaling1 (~0.8-1.6) and Scaling2 (~0.7-1.3): healthScaling1, healthScaling2, strengthScaling1/2, defenseScaling1/2, speedScaling1/2, powerScaling1/2, energyScaling1/2, luckScaling1/2. Do NOT include attacks — they are assigned separately.`,
};

let overrides = {};

export async function initPrompts() {
  try { overrides = (await loadPrompts()) || {}; }
  catch { overrides = {}; }
}

// The active prompt for a key (override if a non-empty string, else the default).
export function getPrompt(key) {
  const v = overrides[key];
  return typeof v === "string" && v.trim() ? v : DEFAULT_PROMPTS[key];
}

// For the admin editor: current value + default + whether it's overridden.
export function allPrompts() {
  const out = {};
  for (const k of Object.keys(DEFAULT_PROMPTS)) {
    out[k] = { current: getPrompt(k), default: DEFAULT_PROMPTS[k], overridden: typeof overrides[k] === "string" && overrides[k].trim() !== "" };
  }
  return out;
}

// Save overrides. A null/empty value for a key resets it to the default.
export async function setPrompts(patch) {
  if (patch && typeof patch === "object") {
    for (const k of Object.keys(DEFAULT_PROMPTS)) {
      if (!(k in patch)) continue;
      const v = patch[k];
      if (v == null || (typeof v === "string" && v.trim() === "")) delete overrides[k];
      else if (typeof v === "string") overrides[k] = v;
    }
  }
  await savePrompts(overrides).catch((e) => console.error("[prompts] save:", e.message));
  return allPrompts();
}
