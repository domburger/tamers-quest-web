// AI monster generation (P5). Decision Q4: generate-on-empty, then ~90% reuse;
// everything generated is persisted to the DB. This module is the framework-
// agnostic core so it's testable without a DB or live API spend:
//
//   normalizeGeneratedMonster — turn arbitrary LLM JSON into a schema-valid,
//     clamped MonsterType, guaranteed consumable by getMonsterStats/combat.
//   assignAttacks — give a type 4 attacks from the EXISTING attack pool. v1 reuses
//     attacks (combat works immediately); generating bespoke balanced attacks is a
//     later enhancement.
//   pickReuseOrGenerate — the reuse policy (Q4).
//   buildMonsterPrompt / aiGenerateMonster — live generation, gated by aiEnabled().
//
// Live generation + DB persistence wire in once the DB is provisioned (P1-T2);
// until then this is dormant infrastructure with full unit coverage.

import { aiEnabled, sanitizePromptText } from "./ai.js";
import { getPrompt } from "./prompts.js";
import { getAiConfig } from "./aiconfig.js";
import { getAttacks } from "../src/engine/gamedata.js";

const STAT_KEYS = ["Health", "Strength", "Defense", "Speed", "Power", "Energy", "Luck"];

function num(v, def, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, n));
}
function str(v, def) {
  return typeof v === "string" && v.trim() ? v.trim() : def;
}
function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Arbitrary/partial/garbage LLM JSON → a guaranteed-valid MonsterType. Numeric
// fields are clamped to sane ranges (mirrors the existing hand-authored data);
// missing fields get defaults; typeName is made unique vs opts.existingNames.
export function normalizeGeneratedMonster(raw = {}, opts = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  let typeName = str(r.typeName, "").slice(0, 40);
  if (!typeName) typeName = "Wild Beast";
  const existing = opts.existingNames;
  if (existing?.has?.(typeName)) {
    let i = 2;
    while (existing.has(`${typeName} ${i}`)) i++;
    typeName = `${typeName} ${i}`;
  }
  const mt = {
    id: opts.id ?? null,
    typeName,
    element: str(r.element, "Normal").slice(0, 24),
    rarity: Math.round(num(r.rarity, 2, 1, 5)),
    size: Math.round(num(r.size, 3, 1, 6)),
    description: str(r.description, `A mysterious ${typeName}.`).slice(0, 600),
    passiveEffect: str(r.passiveEffect, "").slice(0, 240),
    activeEffect: str(r.activeEffect, "").slice(0, 240),
    biome: opts.biome ?? (typeof r.biome === "string" ? r.biome.slice(0, 40) : null),
  };
  for (const k of STAT_KEYS) {
    const lk = k.toLowerCase();
    mt[`base${k}`] = Math.round(num(r[`base${k}`], 60, 1, 400));
    mt[`${lk}Scaling1`] = num(r[`${lk}Scaling1`], 1, 0, 5);
    // scaling2 is the exponent in base + s1*level^s2; cap at 1.3 — CN-4 tightened the
    // hand-authored data to this 95th-pct ceiling (with a regression test), so a
    // generated monster must not exceed it either or it'd reintroduce runaway
    // high-level stats (the exact thing CN-4 fixed) via the generation path.
    mt[`${lk}Scaling2`] = num(r[`${lk}Scaling2`], 1, 0, 1.3);
  }
  return mt;
}

// Set attack_1..4 from the existing attack pool, preferring the monster's element
// then any. `rand` is a () => [0,1) source (engine rng.next or Math.random).
export function assignAttacks(mt, attackPool, rand = Math.random) {
  const pool = Array.isArray(attackPool) ? attackPool.filter((a) => a && a.name) : [];
  const el = (mt.element || "").toLowerCase();
  const same = pool.filter((a) => (a.elementalType || "").toLowerCase() === el);
  const ordered = shuffle(same, rand).concat(shuffle(pool, rand)); // same element first
  const chosen = [];
  const seen = new Set();
  for (const a of ordered) {
    if (seen.has(a.name)) continue;
    seen.add(a.name);
    chosen.push(a.name);
    if (chosen.length === 4) break;
  }
  mt.attack_1 = chosen[0] ?? null;
  mt.attack_2 = chosen[1] ?? null;
  mt.attack_3 = chosen[2] ?? null;
  mt.attack_4 = chosen[3] ?? null;
  return mt;
}

// Q4 reuse policy: an empty pool must generate; otherwise reuse ~reusePct% of the
// time. `rand` is a () => [0,1) source.
export function pickReuseOrGenerate(poolSize, rand = Math.random, reusePct = 90) {
  if (!poolSize || poolSize <= 0) return "generate";
  return rand() * 100 < reusePct ? "reuse" : "generate";
}

export function buildMonsterPrompt({ element, biome, rarity } = {}) {
  // SEC-A3: sanitize the dynamic hint values before they land in the prompt — same
  // defense the combat path uses (strips newlines/control chars + caps length) so a
  // crafted element/biome string can't break out of its line and inject instructions.
  // Admin-gated today, but the P5-T4 pipeline may feed AI-generated concepts here.
  const S = sanitizePromptText;
  const rnum = Number(rarity);
  const hints = [
    element ? `Element: ${S(element, 24)}.` : "Choose a fitting element.",
    biome ? `Biome: ${S(biome, 40)}.` : "",
    Number.isFinite(rnum) ? `Target rarity (1-5): ${Math.max(1, Math.min(5, Math.round(rnum)))}.` : "Pick a rarity 1-5 (higher = stronger/rarer).",
  ].filter(Boolean).join(" ");
  // Admin-editable prompts (prompts.js); {hints} in the user prompt is the dynamic
  // targeting slot.
  return {
    system: getPrompt("monsterSystem"),
    user: getPrompt("monsterUser").replace("{hints}", hints),
  };
}

// Live generation (gated by OPENAI_API_KEY). Returns a schema-valid MonsterType
// with attacks assigned, or null on failure. Not yet wired into round generation
// (that lands with DB persistence, P1-T2).
export async function aiGenerateMonster(opts = {}) {
  if (!aiEnabled()) return null;
  const { system, user } = buildMonsterPrompt(opts);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: getAiConfig("model"),
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        response_format: { type: "json_object" },
        temperature: getAiConfig("genTemperature"),
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const data = await res.json();
    const raw = JSON.parse(data.choices?.[0]?.message?.content || "{}");
    const mt = normalizeGeneratedMonster(raw, opts);
    assignAttacks(mt, getAttacks(), Math.random);
    return mt;
  } catch (e) {
    console.error("[gen] monster generation failed:", e.message);
    return null;
  }
}
