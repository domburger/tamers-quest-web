// Monster-generation CORE helpers — framework-agnostic + unit-testable (no DB / API spend).
// The live multi-agent generator (server/genStages.js) + its pipeline (genPipeline.js) consume
// these; the single-call v1 generator was removed (2026-06-09), so this module no longer makes
// LLM calls itself.
//
//   normalizeGeneratedMonster — arbitrary LLM JSON → a schema-valid, clamped MonsterType.
//   normalizeGenAttacks        — the designer's 4 attacks → clean { title, description } objects.
//   assignAttacks              — assign attack_1..4 from a pool (the deterministic crash-net move set).
//   pickReuseOrGenerate        — the reuse-vs-generate policy (Q4).

import { clampText } from "./text.js";
import { MONSTER_ANIMS } from "../src/systems/monsterAnim.js";

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
    // Trim lore/effects on a clean word/sentence boundary (no mid-word chop) — these
    // show in the bestiary + monster-inspect panels. Shares clampText with FGT-T7.
    description: clampText(str(r.description, `A mysterious ${typeName}.`), 600),
    passiveEffect: clampText(str(r.passiveEffect, ""), 240),
    activeEffect: clampText(str(r.activeEffect, ""), 240),
    biome: opts.biome ?? (typeof r.biome === "string" ? r.biome.slice(0, 40) : null),
    // Spec: the designer generates a VISUAL DESCRIPTION (forwarded to the builder agent) and
    // the 4 ATTACKS (title + judge/player-readable description). Stored additively — the
    // pool-based attack_1..4 (assignAttacks) stay for the v1 judge + deterministic engine.
    visualDescription: clampText(str(r.visualDescription, ""), 400),
    genAttacks: normalizeGenAttacks(r.attacks),
    // Standardized animation set (idle/walk/attack) — declared on every generated monster so the
    // contract is explicit in the data. The clips are procedural (src/systems/monsterAnim.js) and
    // apply to the monster's baked sprite uniformly, so no per-monster animation data is authored;
    // this just guarantees the renderer (src/render/monster.js drawMonster) has the standard set.
    animations: [...MONSTER_ANIMS],
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

// Normalize the designer's generated attacks → up to 4 clean { title, description } objects
// (spec: each is a 2-3 word title + a judge/player-readable description). Drops malformed
// entries; returns [] when none are valid (the pool-based attack_1..4 remain the fallback).
export function normalizeGenAttacks(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const title = str(a.title, "").slice(0, 40);
    const description = clampText(str(a.description, ""), 240);
    if (title && description) out.push({ title, description });
    if (out.length === 4) break;
  }
  return out;
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

