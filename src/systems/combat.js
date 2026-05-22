import { getMonsterType, getAttack, getAttacksForMonster, getMonsterStats } from "../data.js";

const COMBAT_SYSTEM_PROMPT = `You are a combat resolution engine for a monster-taming RPG. Given two monsters and their chosen actions, resolve one turn of combat and return the results as JSON.

## Rules

### Turn Order
The monster with higher speed acts first. Ties favor the player.

### Damage Formula
Physical damage = attacker.strength * (attack.damage / 100) - defender.defense * (1 - attack.penetration)
Elemental damage = attacker.power * attack.elementalDiffusion * (1 - attack.elementalPenetration vs defender)
Total damage = physical + elemental. Minimum 1 damage per hit.

### Accuracy
A random roll 0-100 must be <= attack.accuracy*100 + attacker.luck/2. If missed, 0 damage.

### Critical Hits
A random roll 0-100 must be <= attack.critChance*100 + attacker.luck/4. If crit, multiply total damage by attack.critMultiplier.

### Elemental Matchups
Fire > Nature > Water > Fire (1.3x / 0.7x). Dark <-> Light (1.2x each). Neutral has no bonus/penalty.

### Status Effects
Burn: 5% maxHP damage per turn. Poison: 3% maxHP per turn (stacks with burn). Freeze: 30% chance to skip turn. Stun: skip one turn then clears.
Only one status at a time. New status replaces old. Status is applied based on attack.statusChance.

### Energy
Each attack costs energy. If not enough energy, the monster skips instead. Energy does not regenerate.

### HP
A monster is defeated when HP reaches 0.

## Response
Return ONLY valid JSON with this exact structure:
{
  "playerMonster": { "currentHealth": <int>, "currentEnergy": <int>, "status": <string|null> },
  "enemyMonster": { "currentHealth": <int>, "currentEnergy": <int>, "status": <string|null> },
  "narrative": "<max 200 chars describing what happened>"
}`;

const CATCH_SYSTEM_PROMPT = `You are a catch resolution engine for a monster-taming RPG. The player is attempting to catch the enemy monster while the enemy attacks.

## Catch Difficulty
Based on enemy HP percentage:
- Below 25%: high catch chance (~70%)
- 25-50%: moderate chance (~40%)
- 50-75%: low chance (~20%)
- Above 75%: very low chance (~5%)

Modifiers: status effects +15% each, each player level above enemy +5%, rarity reduces chance.

The enemy still attacks the player's monster during the catch attempt (resolve damage normally).

## Response
Return ONLY valid JSON:
{
  "caught": <boolean>,
  "narrative": "<max 200 chars>",
  "playerMonster": { "currentHealth": <int>, "currentEnergy": <int>, "status": <string|null> }
}`;

export function chooseEnemyAttack(monster) {
  const monsterType = getMonsterType(monster.typeName);
  if (!monsterType) return null;
  const allAttacks = getAttacksForMonster(monsterType);
  const affordable = allAttacks.filter((a) => a.energyCost <= monster.currentEnergy);
  if (affordable.length === 0) return null;
  return affordable[Math.floor(Math.random() * affordable.length)];
}

function buildMonsterState(monster) {
  const mt = getMonsterType(monster.typeName);
  const stats = getMonsterStats(mt, monster.level);
  return {
    name: monster.name,
    typeName: monster.typeName,
    level: monster.level,
    element: mt.element,
    currentHealth: monster.currentHealth,
    maxHealth: stats.health,
    currentEnergy: monster.currentEnergy,
    maxEnergy: stats.energy,
    strength: stats.strength,
    defense: stats.defense,
    speed: stats.speed,
    power: stats.power,
    luck: stats.luck,
    status: monster.status || null,
  };
}

async function callLLM(apiKey, systemPrompt, userPrompt) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 300,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in response");
  return JSON.parse(jsonMatch[0]);
}

export async function evaluateTurn(apiKey, playerMonster, playerAttack, enemyMonster, enemyAttack) {
  const playerState = buildMonsterState(playerMonster);
  const enemyState = buildMonsterState(enemyMonster);

  const playerAction = playerAttack
    ? `Player's ${playerState.name} uses "${playerAttack.name}" (damage:${playerAttack.damage}, accuracy:${playerAttack.accuracy}, energy:${playerAttack.energyCost}, element:${playerAttack.elementalType}, diffusion:${playerAttack.elementalDiffusion}, penetration:${playerAttack.penetration}, elemPen:${playerAttack.elementalPenetration}, crit:${playerAttack.critChance}/${playerAttack.critMultiplier}, status:${playerAttack.inflictedStatus||"none"}/${playerAttack.statusChance})`
    : `Player's ${playerState.name} SKIPS this turn.`;

  const enemyAction = enemyAttack
    ? `Enemy's ${enemyState.name} uses "${enemyAttack.name}" (damage:${enemyAttack.damage}, accuracy:${enemyAttack.accuracy}, energy:${enemyAttack.energyCost}, element:${enemyAttack.elementalType}, diffusion:${enemyAttack.elementalDiffusion}, penetration:${enemyAttack.penetration}, elemPen:${enemyAttack.elementalPenetration}, crit:${enemyAttack.critChance}/${enemyAttack.critMultiplier}, status:${enemyAttack.inflictedStatus||"none"}/${enemyAttack.statusChance})`
    : `Enemy's ${enemyState.name} SKIPS (no energy).`;

  const userPrompt = `Player Monster: ${JSON.stringify(playerState)}
Enemy Monster: ${JSON.stringify(enemyState)}

${playerAction}
${enemyAction}

Resolve this turn.`;

  if (!apiKey) return fallbackCombat(playerMonster, playerAttack, enemyMonster, enemyAttack);

  try {
    const result = await callLLM(apiKey, COMBAT_SYSTEM_PROMPT, userPrompt);
    return {
      playerHealth: Math.max(0, result.playerMonster.currentHealth),
      playerEnergy: Math.max(0, result.playerMonster.currentEnergy),
      playerStatus: result.playerMonster.status,
      enemyHealth: Math.max(0, result.enemyMonster.currentHealth),
      enemyEnergy: Math.max(0, result.enemyMonster.currentEnergy),
      enemyStatus: result.enemyMonster.status,
      narrative: result.narrative || "The monsters clash!",
    };
  } catch (e) {
    console.error("Combat API error:", e);
    return fallbackCombat(playerMonster, playerAttack, enemyMonster, enemyAttack);
  }
}

export async function evaluateCatch(apiKey, playerMonster, enemyMonster, enemyAttack) {
  const playerState = buildMonsterState(playerMonster);
  const enemyState = buildMonsterState(enemyMonster);

  const enemyAction = enemyAttack
    ? `Enemy attacks with "${enemyAttack.name}" during catch attempt.`
    : `Enemy has no energy and skips.`;

  const userPrompt = `Player Monster: ${JSON.stringify(playerState)}
Enemy Monster: ${JSON.stringify(enemyState)}
Player attempts to CATCH the enemy monster.
${enemyAction}

Resolve the catch attempt and enemy attack.`;

  if (!apiKey) return fallbackCatch(playerMonster, enemyMonster, enemyAttack);

  try {
    const result = await callLLM(apiKey, CATCH_SYSTEM_PROMPT, userPrompt);
    return {
      caught: !!result.caught,
      narrative: result.narrative || "You throw a capture device...",
      playerHealth: Math.max(0, result.playerMonster.currentHealth),
      playerEnergy: Math.max(0, result.playerMonster.currentEnergy),
      playerStatus: result.playerMonster.status,
    };
  } catch (e) {
    console.error("Catch API error:", e);
    return fallbackCatch(playerMonster, enemyMonster, enemyAttack);
  }
}

// Deterministic fallback when API is unavailable
function fallbackCombat(playerMonster, playerAttack, enemyMonster, enemyAttack) {
  const pStats = buildMonsterState(playerMonster);
  const eStats = buildMonsterState(enemyMonster);

  let pH = playerMonster.currentHealth;
  let pE = playerMonster.currentEnergy;
  let eH = enemyMonster.currentHealth;
  let eE = enemyMonster.currentEnergy;
  let narrative = "";

  // Player attacks
  if (playerAttack && pE >= playerAttack.energyCost) {
    pE -= playerAttack.energyCost;
    if (Math.random() * 100 <= playerAttack.accuracy * 100 + pStats.luck / 2) {
      let dmg = pStats.strength * (playerAttack.damage / 100) - eStats.defense * (1 - playerAttack.penetration);
      dmg += pStats.power * playerAttack.elementalDiffusion;
      dmg = Math.max(1, Math.floor(dmg));
      if (Math.random() * 100 <= playerAttack.critChance * 100 + pStats.luck / 4) {
        dmg = Math.floor(dmg * playerAttack.critMultiplier);
        narrative += `Critical hit! `;
      }
      dmg = Math.floor(dmg * getElementMultiplier(playerAttack.elementalType, eStats.element));
      eH = Math.max(0, eH - dmg);
      narrative += `${pStats.name} deals ${dmg} damage. `;
    } else {
      narrative += `${pStats.name} misses! `;
    }
  } else {
    narrative += `${pStats.name} skips. `;
  }

  // Enemy attacks
  if (enemyAttack && eE >= enemyAttack.energyCost && eH > 0) {
    eE -= enemyAttack.energyCost;
    if (Math.random() * 100 <= enemyAttack.accuracy * 100 + eStats.luck / 2) {
      let dmg = eStats.strength * (enemyAttack.damage / 100) - pStats.defense * (1 - enemyAttack.penetration);
      dmg += eStats.power * enemyAttack.elementalDiffusion;
      dmg = Math.max(1, Math.floor(dmg));
      dmg = Math.floor(dmg * getElementMultiplier(enemyAttack.elementalType, pStats.element));
      pH = Math.max(0, pH - dmg);
      narrative += `${eStats.name} deals ${dmg}. `;
    } else {
      narrative += `${eStats.name} misses!`;
    }
  }

  return {
    playerHealth: pH, playerEnergy: pE, playerStatus: playerMonster.status,
    enemyHealth: eH, enemyEnergy: eE, enemyStatus: enemyMonster.status,
    narrative: narrative.trim(),
  };
}

function fallbackCatch(playerMonster, enemyMonster, enemyAttack) {
  const eStats = buildMonsterState(enemyMonster);
  const hpPercent = enemyMonster.currentHealth / eStats.maxHealth;
  let chance = hpPercent < 0.25 ? 0.7 : hpPercent < 0.5 ? 0.4 : hpPercent < 0.75 ? 0.2 : 0.05;
  if (enemyMonster.status) chance += 0.15;

  const caught = Math.random() < chance;
  let pH = playerMonster.currentHealth;
  let pE = playerMonster.currentEnergy;

  if (enemyAttack && enemyMonster.currentEnergy >= enemyAttack.energyCost) {
    const pStats = buildMonsterState(playerMonster);
    let dmg = eStats.strength * (enemyAttack.damage / 100) - pStats.defense * (1 - enemyAttack.penetration);
    dmg = Math.max(1, Math.floor(dmg + eStats.power * enemyAttack.elementalDiffusion));
    pH = Math.max(0, pH - dmg);
  }

  return {
    caught,
    narrative: caught ? `${eStats.name} was caught!` : `${eStats.name} broke free!`,
    playerHealth: pH, playerEnergy: pE, playerStatus: playerMonster.status,
  };
}

function getElementMultiplier(attackElement, defenderElement) {
  const advantages = { Fire: "Nature", Nature: "Water", Water: "Fire" };
  if (advantages[attackElement] === defenderElement) return 1.3;
  if (advantages[defenderElement] === attackElement) return 0.7;
  if (attackElement === "Dark" && defenderElement === "Light") return 1.2;
  if (attackElement === "Light" && defenderElement === "Dark") return 1.2;
  return 1.0;
}

export function getApiKey() {
  return localStorage.getItem("tq_openai_key") || "";
}

export function setApiKey(key) {
  localStorage.setItem("tq_openai_key", key);
}
