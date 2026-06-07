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
