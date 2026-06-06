// OpenAI-backed combat turn resolution (P3-T2) — the game's "AI-resolved combat"
// selling point. The deterministic engine (engine/combat.js) is the automatic
// fallback, so combat always works even with no key / API errors. Provider:
// OpenAI gpt-4o ("use openai for now"); the key comes from OPENAI_API_KEY.

const MODEL = "gpt-4o";

const SYSTEM_PROMPT = `You are the combat engine for a monster-taming RPG. Resolve ONE turn between two monsters and return JSON only.

Each monster has: name, element (Fire/Water/Nature/Dark/Light/Neutral), HP (current/max), energy, and stats (strength, defense, speed, power, luck). The faster monster acts first; ties favor the player.

Guidance (use judgement, keep it plausible — not wildly swingy):
- Damage scales with the attacker's strength/power and the attack's damage, reduced by the defender's defense. Minimum 1 damage on a clean hit.
- Elemental matchups (attacker vs defender): Fire beats Nature, Nature beats Water, Water beats Fire (super-effective ~1.3x; the reverse is resisted ~0.7x). Dark and Light beat each other ~1.2x. Neutral is even.
- Accuracy and crits are influenced by luck. Attacks cost energy; with too little energy a monster struggles or skips.
- You may apply, tick, or clear status effects (burn, poison, freeze, stun, etc.) — reflect them in HP/energy and the narrative.

Return ONLY this JSON (HP between 0 and the monster's max, energy >= 0):
{"playerMonster":{"currentHealth":int,"currentEnergy":int,"status":string|null},"enemyMonster":{"currentHealth":int,"currentEnergy":int,"status":string|null},"narrative":"vivid description, <=200 chars"}`;

export function aiEnabled() {
  return !!process.env.OPENAI_API_KEY;
}

function describe(label, m, attack) {
  const a = attack
    ? `uses "${attack.name}" (dmg ${attack.damage}, acc ${attack.accuracy}, energy ${attack.energyCost}, element ${attack.elementalType}, crit ${attack.critChance}/${attack.critMultiplier}${attack.inflictedStatus ? `, may inflict ${attack.inflictedStatus} @${attack.statusChance}` : ""})`
    : `has no usable move and skips`;
  return `${label}: ${m.name} [${m.element}] HP ${m.currentHealth}/${m.maxHealth}, energy ${m.currentEnergy}/${m.maxEnergy}, STR ${m.strength} DEF ${m.defense} SPD ${m.speed} POW ${m.power} LUCK ${m.luck}${m.status ? `, status ${m.status}` : ""} — ${a}`;
}

// Clamp + shape the model's output into the engine's result format.
export function mapAiResult(raw, player, enemy) {
  const clamp = (v, max, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(max, Math.round(n)));
  };
  return {
    player: {
      currentHealth: clamp(raw?.playerMonster?.currentHealth, player.maxHealth, player.currentHealth),
      currentEnergy: clamp(raw?.playerMonster?.currentEnergy, player.maxEnergy, player.currentEnergy),
      status: raw?.playerMonster?.status ?? null,
    },
    enemy: {
      currentHealth: clamp(raw?.enemyMonster?.currentHealth, enemy.maxHealth, enemy.currentHealth),
      currentEnergy: clamp(raw?.enemyMonster?.currentEnergy, enemy.maxEnergy, enemy.currentEnergy),
      status: raw?.enemyMonster?.status ?? null,
    },
    narrative: (raw?.narrative || "The monsters clash!").toString().slice(0, 240),
  };
}

// Resolve one turn via OpenAI. Throws on any failure (caller falls back to the
// deterministic engine).
export async function aiResolveTurn({ player, playerAttack, enemy, enemyAttack }) {
  const userPrompt =
    `${describe("Player", player, playerAttack)}\n` +
    `${describe("Enemy", enemy, enemyAttack)}\n\nResolve this turn.`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 400,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI: empty response");
  return mapAiResult(JSON.parse(content), player, enemy);
}
