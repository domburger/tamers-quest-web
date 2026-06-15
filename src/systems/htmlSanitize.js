// TQ-261 — SECURITY-CRITICAL sanitizer for untrusted LLM-authored monster HTML/CSS (the HTML-swap
// visual builder, TQ-255). Unlike the SVG path (svgModel.js), HTML monsters render as LIVE DOM with
// no rasterize <img> escape hatch — so this sanitizer is the ONLY thing between injected markup and
// code execution in the page. Design: DEFAULT-DENY. Only the htmlModel.js allow-lists survive; every
// other tag/attribute/CSS-property/URL is stripped. Pure string transform (runs on the server during
// gen validation AND on the client before DOM insertion), mirroring sanitizeSvg(); when a DOM is
// available it adds a second, parser-normalising pass to defeat regex parser-differential / mXSS
// bypasses. The render path (TQ-262) MUST call sanitizeHtmlModel() before inserting any markup.
import { HTML_CANVAS, HTML_STATES, HTML_ALLOWED_TAGS, HTML_ALLOWED_ATTRS, HTML_ALLOWED_CSS_PROPS, HTML_FORBIDDEN } from "./htmlModel.js";

const ALLOWED_TAGS = new Set(HTML_ALLOWED_TAGS.map((t) => t.toLowerCase()));
const ALLOWED_ATTRS = new Set(HTML_ALLOWED_ATTRS.map((a) => a.toLowerCase()));
const ALLOWED_CSS = new Set(HTML_ALLOWED_CSS_PROPS.map((p) => p.toLowerCase()));
const FORBIDDEN = new Set(HTML_FORBIDDEN.map((t) => t.toLowerCase()));
// Containers whose CONTENT (not just the tag) must be dropped — anything that can carry script/CSS
// or re-parse its text as markup. Removed wholesale before the per-tag allow-list walk.
// `style` is NOT dropped wholesale here — it is conditionally allowed for @keyframes only and is
// handled by cleanStyleBlocks() below (parse → keep only valid @keyframes → rebuild) BEFORE the walk.
const RAW_CONTENT_TAGS = ["script", "iframe", "object", "embed", "noscript", "template", "title", "textarea", "xmp"];
// A CSS value carrying any execution / external-fetch / breakout vector → drop that declaration.
const CSS_VALUE_BLOCK = /expression\s*\(|javascript:|vbscript:|data:|@import|behavior\s*:|-moz-binding|[<>]|\\/i;
// A non-style attribute value carrying a script/navigation/fetch vector. url(#localRef) is allowed
// (SVG gradient refs); url( anything-else is not.
const ATTR_VALUE_BLOCK = /[<>]|javascript:|vbscript:|data:|expression\s*\(|url\s*\(\s*(?!#)/i;

// Sanitize an inline `style` value: keep only allow-listed properties with safe values; drop the rest.
export function sanitizeCss(style, { maxLen = 4000 } = {}) {
  const s = typeof style === "string" ? style : "";
  if (!s || s.length > maxLen) return ""; // empty or absurdly long → drop wholesale
  const out = [];
  for (const decl of s.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim();
    if (!prop || !value) continue;
    if (!ALLOWED_CSS.has(prop)) continue;                 // property allow-list (default-deny)
    if (CSS_VALUE_BLOCK.test(value)) continue;            // no expression()/url()/@import/javascript:/…
    if (/url\s*\(/i.test(value)) continue;                // no url() at all in CSS (no external assets)
    if (prop === "position" && /\bfixed\b/i.test(value)) continue; // fixed escapes the canvas box
    out.push(`${prop}: ${value}`);
  }
  return out.join("; ");
}

// ── CSS @keyframes (TQ-305) ───────────────────────────────────────────────
// `<style>` is allowed ONLY as a carrier for CSS @keyframes so a builder-authored creature can
// self-animate (no JS, no selectors, no fetches). We PARSE each <style> block, keep ONLY valid
// @keyframes whose step declarations pass the same CSS allow-list as inline styles, and REBUILD it
// clean — never passing raw style text through (defeats </style> breakout / mXSS). Keyframe names are
// then SCOPED per-fragment (scopeKeyframeNames) so two monsters' animations can't collide in the
// global keyframe namespace. A <style> that yields no valid @keyframes is removed entirely.

const KF_STEP = /^(?:from|to|-?\d+(?:\.\d+)?%)$/i; // a single keyframe step selector

// Rebuild ONE @keyframes body ("0%{…} 50%{…}"), keeping only valid steps + allow-listed declarations.
function cleanKeyframeBody(body) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(body))) {
    const sels = m[1].split(",").map((x) => x.trim()).filter((x) => KF_STEP.test(x));
    if (!sels.length) continue;                  // not a from/to/% step → drop
    const decls = sanitizeCss(m[2]);             // same default-deny CSS allow-list as inline styles
    if (decls) out.push(`${sels.join(",")}{${decls}}`);
  }
  return out.join("");
}

// Reduce a <style> block's CONTENT to ONLY valid @keyframes; everything else (selectors, @import,
// @media, stray text) is dropped. Returns "" when nothing valid survives.
function cleanStyleContent(css, maxLen = 8000) {
  const s = typeof css === "string" ? css.slice(0, maxLen) : "";
  const out = [];
  const re = /@(?:-webkit-)?keyframes\s+([A-Za-z_][\w-]*)\s*\{/g;
  let m;
  while ((m = re.exec(s))) {
    const open = re.lastIndex - 1;               // index of the opening '{'
    let depth = 0, end = -1;
    for (let j = open; j < s.length; j++) {
      const c = s[j];
      if (c === "{") depth++;
      else if (c === "}" && --depth === 0) { end = j; break; }
    }
    if (end < 0) break;                          // unbalanced braces → stop (conservative)
    re.lastIndex = end + 1;
    const steps = cleanKeyframeBody(s.slice(open + 1, end));
    if (steps) out.push(`@keyframes ${m[1]}{${steps}}`);
  }
  return out.join("");
}

// Replace every <style …>…</style> with a cleaned @keyframes-only block (or remove it when nothing
// valid survives); drop an unclosed <style to end. Runs BEFORE the tag allow-list walk so only inert
// CSS text (no '<') ever remains between the kept <style> markers.
function cleanStyleBlocks(s) {
  const NUL = String.fromCharCode(0);
  const blocks = [];
  s = s.split(NUL).join(""); // strip NULs so an injected sentinel can't be forged
  // 1) clean each CLOSED <style>...</style> and stash it behind a NUL sentinel, so the unclosed-drop
  //    in (2) can't greedily swallow the freshly-rebuilt block.
  s = s.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_full, body) => {
    const kf = cleanStyleContent(body);
    if (!kf) return "";
    blocks.push(`<style>${kf}</style>`);
    return NUL + (blocks.length - 1) + NUL;
  });
  // 2) any remaining <style ...> is necessarily UNCLOSED -> drop it to end (conservative).
  s = s.replace(/<style\b[^>]*>[\s\S]*$/gi, "");
  // 3) restore the cleaned blocks.
  return s.replace(new RegExp(NUL + "([0-9]+)" + NUL, "g"), (_f, i) => blocks[Number(i)] || "");
}

// djb2 → a short, stable, alphanumeric hash for per-fragment keyframe-name scoping.
function hash36(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const KF_SCOPED = /^kf[0-9a-z]+_/; // already-scoped name marker → keeps scoping idempotent

// Prefix every UNSCOPED @keyframes NAME with a per-fragment salt, and rewrite the matching name inside
// inline animation/animation-name values — so identical keyframe names in two different monsters do not
// collide in the global @keyframes namespace. Idempotent (a re-run finds no unscoped names). Pure.
function scopeKeyframeNames(markup) {
  const names = [];
  const defRe = /@(?:-webkit-)?keyframes\s+([A-Za-z_][\w-]*)/g;
  let m;
  while ((m = defRe.exec(markup))) if (!KF_SCOPED.test(m[1]) && !names.includes(m[1])) names.push(m[1]);
  if (!names.length) return markup;
  const salt = "kf" + hash36(markup) + "_";
  const esc = (n) => n.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  let out = markup;
  for (const n of names) out = out.replace(new RegExp(`(@(?:-webkit-)?keyframes\\s+)${esc(n)}\\b`, "g"), `$1${salt}${n}`);
  // rewrite references ONLY inside animation / animation-name values (never unrelated text/attributes)
  out = out.replace(/(animation(?:-name)?\s*:\s*)([^;"'}]*)/gi, (_f, pre, val) => {
    let v = val;
    for (const n of names) v = v.replace(new RegExp(`\\b${esc(n)}\\b`, "g"), `${salt}${n}`);
    return pre + v;
  });
  return out;
}

// Sanitize the raw attribute text of ONE allow-listed tag.
function sanitizeAttrs(attrStr) {
  const out = [];
  const re = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(attrStr))) {
    const name = m[1].toLowerCase();
    const val = m[3] ?? m[4] ?? m[5] ?? "";
    if (name.startsWith("on")) continue;                  // never any event handler
    if (!ALLOWED_ATTRS.has(name)) continue;               // attribute allow-list
    if (name === "style") {
      const css = sanitizeCss(val);
      if (css) out.push(`style="${css}"`);
      continue;
    }
    if (ATTR_VALUE_BLOCK.test(val)) continue;             // script/nav/fetch vector in a value
    out.push(`${name}="${String(val).replace(/"/g, "&quot;")}"`);
  }
  return out.length ? " " + out.join(" ") : "";
}

// The core string pass: comments/PI/CDATA out → raw-content containers out → per-tag allow-list →
// backstop scrub. Default-DENY; conservative — when in doubt, strip.
function stringSanitize(markup, maxLen) {
  let s = typeof markup === "string" ? markup : "";
  if (s.length > maxLen) s = s.slice(0, maxLen);
  s = s.replace(/<!--[\s\S]*?-->/g, "")                   // comments (can hide reforming tags)
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/gi, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<\?[\s\S]*?\?>/g, "");
  s = cleanStyleBlocks(s);                                // <style> → ONLY validated @keyframes (TQ-305)
  for (const tag of RAW_CONTENT_TAGS) {                   // drop script/iframe/etc. + their content
    s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), "");
    s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*$`, "gi"), ""); // unclosed → drop to end (conservative)
  }
  // Per-tag allow-list walk (quote-aware so a '>' inside an attr value doesn't end the tag early).
  s = s.replace(/<(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g, (_full, slash, name, attrs) => {
    const tag = name.toLowerCase();
    if (!ALLOWED_TAGS.has(tag) || FORBIDDEN.has(tag)) return ""; // strip disallowed tag markers (keep text)
    return slash ? `</${tag}>` : `<${tag}${sanitizeAttrs(attrs)}>`;
  });
  // Backstop: nuke any on*= / javascript:/vbscript: that survived in malformed leftovers, and any
  // remaining stray '<' that isn't an allow-listed tag open/close (defeats reforming-tag tricks).
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "").replace(/vbscript:/gi, "");
  return s;
}

// Sanitize ONE authored HTML state. String-sanitises always; when a DOM is available (client,
// pre-insertion) it then re-parses through an INERT DOMParser document (no script execution) and
// re-sanitises the browser-normalised markup — so a regex parser-differential / mutation-XSS bypass
// can't survive the round-trip. Idempotent.
export function sanitizeHtml(markup, { maxLen = 20000 } = {}) {
  let s = stringSanitize(markup, maxLen);
  if (typeof DOMParser !== "undefined") {
    try {
      const doc = new DOMParser().parseFromString(s, "text/html");
      // include <head> too: a body-level <style> can be relocated to <head> by the HTML parser, and we
      // must re-sanitise (not lose) it. Everything else in head is stripped by stringSanitize anyway.
      const inner = (doc.head ? doc.head.innerHTML : "") + (doc.body ? doc.body.innerHTML : "");
      s = stringSanitize(inner, maxLen);
    } catch { /* keep the string-sanitised version */ }
  }
  s = scopeKeyframeNames(s); // run ONCE on the final markup so @keyframes names are collision-scoped
  return s.trim();
}

// True when sanitised markup still has at least one allow-listed element (vs. stripped to bare text).
export function isSafeHtml(markup) {
  return /<[a-z]/i.test(sanitizeHtml(markup));
}

// Sanitize a stored HTML model (coerceHtmlModel output) before DOM insertion: clean base + each present
// state; drop a state that sanitises to nothing (falls back to base at render); clamp the canvas.
// Returns null when the base sanitises to no usable element (→ archetype fallback). Mirrors
// coerceSvgModel — this is what the render path (TQ-262) calls before touching the DOM.
export function sanitizeHtmlModel(model) {
  if (!model || typeof model !== "object") return null;
  const base = sanitizeHtml(model.base);
  if (!/<[a-z]/i.test(base)) return null;
  const out = { canvas: HTML_CANVAS, base };
  for (const st of HTML_STATES) {
    if (st === "base") continue;
    if (typeof model[st] === "string" && model[st].trim()) {
      const clean = sanitizeHtml(model[st]);
      if (/<[a-z]/i.test(clean)) out[st] = clean;
    }
  }
  return out;
}
