// Admin-editable SCHEMA FIELD DESCRIPTIONS registry (mirrors prompts.js). Each structured-
// output schema property carries a `description` that is sent to the LLM to steer what it
// puts in that field — so these are effectively part of the generation prompt. The defaults
// live in genPipeline.js (SCHEMA_DESC_DEFAULTS, the single source of truth); admins override
// any of them in the admin panel, the override is persisted (DB settings id=4) and applied
// live (the schema BUILDER functions read getSchemaDesc).

import { SCHEMA_DESC_DEFAULTS } from "./genPipeline.js";
import { loadSchemaDesc, saveSchemaDesc } from "./db.js";

let overrides = {};

export async function initSchemaDesc() {
  try { overrides = (await loadSchemaDesc()) || {}; }
  catch { overrides = {}; }
}

// Active description for a key: a non-empty override, else the default. "" for an unknown key.
export function getSchemaDesc(key) {
  const v = overrides[key];
  if (typeof v === "string" && v.trim()) return v;
  return SCHEMA_DESC_DEFAULTS[key] ?? "";
}

// For the admin editor: per-key current/default/overridden.
export function allSchemaDesc() {
  const out = {};
  for (const k of Object.keys(SCHEMA_DESC_DEFAULTS)) {
    out[k] = { current: getSchemaDesc(k), default: SCHEMA_DESC_DEFAULTS[k], overridden: typeof overrides[k] === "string" && overrides[k].trim() !== "" };
  }
  return out;
}

// TQ-377: render an admin-tunable "Field guidance" block from the schema descriptions for a set of
// fields, to APPEND to a free-JSON generator's designer prompt (items/biomes/tiles — which don't use a
// structured-output schema the way monsters do). `fields` = [[label, descKey], …]. Each line reflects
// the live (override-aware) description, so an admin edit in the schema-desc panel steers the gen.
// Returns "" when no field has a description (so nothing is appended).
export function describeFields(fields = []) {
  const lines = [];
  for (const [label, key] of fields) {
    const d = getSchemaDesc(key);
    if (d) lines.push(`- ${label}: ${d}`);
  }
  return lines.length ? `Field guidance (admin-tunable):\n${lines.join("\n")}` : "";
}

// Save overrides. A null/empty value for a key resets it to the default.
export async function setSchemaDesc(patch) {
  if (patch && typeof patch === "object") {
    for (const k of Object.keys(SCHEMA_DESC_DEFAULTS)) {
      if (!(k in patch)) continue;
      const v = patch[k];
      if (v == null || (typeof v === "string" && v.trim() === "")) delete overrides[k];
      else if (typeof v === "string") overrides[k] = v;
    }
  }
  await saveSchemaDesc(overrides).catch((e) => console.error("[schemaDesc] save:", e.message));
  return allSchemaDesc();
}
