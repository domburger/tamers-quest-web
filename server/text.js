// Shared text helpers (server-side). Pure, dependency-free.

// Trim a string to <=max chars on a CLEAN boundary instead of chopping a word (or
// a multibyte char) in half (FGT-T7). If a sentence end (.!?) lands in the back of
// the window we cut there (a complete thought, no marker); otherwise we back off to
// the last word boundary and append an ASCII "..." to signal the cut. ASCII-only
// output (respects the no-decorative-glyph UI rule); non-string/nullish → safe
// string. Used for AI combat narrative and generated monster lore/effects.
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

// Insert a slot value into an (admin-overridable) prompt template by replacing EVERY occurrence of
// the {placeholder}. NO append-if-missing: if a prompt override DROPS the placeholder, the value is
// intentionally omitted — a dropped slot is respected (it's "missing for a reason"), so the prompt the
// operator sees/edits in /admin is exactly what the model receives (Dominik 2026-06-16). replaceAll
// fills repeated placeholders too (no literal "{slot}" leaking on the 2nd+); a FUNCTION replacement
// keeps a "$" in the value (e.g. "$&" / "$`" / "$$") VERBATIM rather than a String.replace special.
// Pure; shared by the monster / item / biome / tile generation pipelines. (The old optional `label`
// arg drove the removed append branch; extra args are harmless, so callers passing it still work.)
export function fillSlot(tpl, key, val) {
  const t = String(tpl == null ? "" : tpl);
  const v = val == null ? "" : String(val);
  return t.replaceAll(key, () => v);
}
