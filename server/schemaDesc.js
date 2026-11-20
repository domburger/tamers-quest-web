import { SCHEMA_DESC_DEFAULTS } from "./genPipeline.js";
import { loadSchemaDesc, saveSchemaDesc } from "./db.js";

let overrides = {};

export async function initSchemaDesc() {
  try { overrides = (await loadSchemaDesc()) || {}; }
  catch { overrides = {}; }
}

export function getSchemaDesc(key) {
  const v = overrides[key];
  if (typeof v === "string" && v.trim()) return v;
  return SCHEMA_DESC_DEFAULTS[key] ?? "";
}

export function allSchemaDesc() {
  const out = {};
  for (const k of Object.keys(SCHEMA_DESC_DEFAULTS)) {
    out[k] = { current: getSchemaDesc(k), default: SCHEMA_DESC_DEFAULTS[k], overridden: typeof overrides[k] === "string" && overrides[k].trim() !== "" };
  }
  return out;
}

export function describeFields(fields = []) {
  const lines = [];
  for (const [label, key] of fields) {
    const d = getSchemaDesc(key);
    if (d) lines.push(`- ${label}: ${d}`);
  }
  return lines.length ? `Field guidance (admin-tunable):\n${lines.join("\n")}` : "";
}

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
