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
function titleCase(s) {
  return String(s || "").trim().replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 40);
}
function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function normalizeGeneratedMonster(raw = {}, opts = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  let typeName = str(r.typeName, "").slice(0, 40);
  if (!typeName && opts.inspiration) {
    typeName = titleCase(opts.inspiration);
    if (typeName) console.warn(`[gen] Attributes stage returned no typeName; recovered from inspiration → "${typeName}"`);
  }
  if (!typeName) {
    console.warn("[gen] rejected a nameless generation: Attributes stage returned no typeName and no inspiration to recover one");
    return null;
  }
  const existing = opts.existingNames;
  if (existing?.has?.(typeName)) {
    let i = 2;
    while (existing.has(`${typeName} ${i}`)) i++;
    typeName = `${typeName} ${i}`;
  }
  const mt = {
    id: opts.id ?? null,
    typeName,
    rarity: Math.round(num(r.rarity, 2, 1, 5)),
    size: Math.round(num(r.size, 3, 1, 6)),
    description: clampText(str(r.description, `A mysterious ${typeName}.`), 600),
    passiveEffect: clampText(str(r.passiveEffect, ""), 240),
    biome: opts.biome ?? (typeof r.biome === "string" ? r.biome.slice(0, 40) : null),
    visualDescription: clampText(str(r.visualDescription, ""), 400),
    genAttacks: normalizeGenAttacks(r.attacks),
    animations: [...MONSTER_ANIMS],
  };
  for (const k of STAT_KEYS) {
    const lk = k.toLowerCase();
    mt[`base${k}`] = Math.round(num(r[`base${k}`], 60, 1, 400));
    mt[`${lk}Scaling1`] = num(r[`${lk}Scaling1`], 1, 0, 5);
    mt[`${lk}Scaling2`] = num(r[`${lk}Scaling2`], 1, 0, 1.3);
  }
  return mt;
}

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

export function assignAttacks(mt, attackPool, rand = Math.random) {
  const pool = Array.isArray(attackPool) ? attackPool.filter((a) => a && a.name) : [];
  const ordered = shuffle(pool, rand);
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


