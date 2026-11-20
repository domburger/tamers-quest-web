export function clampText(s, max = 240) {
  const t = String(s == null ? "" : s).trim();
  if (t.length <= max) return t;
  const slice = t.slice(0, max);
  let end = -1;
  for (const m of slice.matchAll(/[.!?]/g)) end = m.index;
  if (end >= max * 0.6) return slice.slice(0, end + 1).trim();
  const lastSpace = slice.lastIndexOf(" ");
  const body = (lastSpace > max * 0.5 ? slice.slice(0, lastSpace) : slice).replace(/[\s,;:]+$/, "");
  return body + "...";
}

// Replacer fn on purpose: a string replacement would expand $& / $$ in val.
export function fillSlot(tpl, key, val) {
  const t = String(tpl == null ? "" : tpl);
  const v = val == null ? "" : String(val);
  return t.replaceAll(key, () => v);
}
