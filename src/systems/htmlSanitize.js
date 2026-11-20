// Security-critical default-deny XSS barrier (also runs server-side). Served raw at /admin/: import only ./htmlModel.js.
import { HTML_CANVAS, HTML_STATES, HTML_ALLOWED_TAGS, HTML_ALLOWED_ATTRS, HTML_ALLOWED_CSS_PROPS, HTML_FORBIDDEN } from "./htmlModel.js";

const ALLOWED_TAGS = new Set(HTML_ALLOWED_TAGS.map((t) => t.toLowerCase()));
const ALLOWED_ATTRS = new Set(HTML_ALLOWED_ATTRS.map((a) => a.toLowerCase()));
// Keep SVG name case: icons parse this markup as XML (linearGradient, viewBox).
const CANON_TAG = new Map(HTML_ALLOWED_TAGS.map((t) => [t.toLowerCase(), t]));
const CANON_ATTR = new Map(HTML_ALLOWED_ATTRS.map((a) => [a.toLowerCase(), a]));
const ALLOWED_CSS = new Set(HTML_ALLOWED_CSS_PROPS.map((p) => p.toLowerCase()));
const FORBIDDEN = new Set(HTML_FORBIDDEN.map((t) => t.toLowerCase()));
const RAW_CONTENT_TAGS = ["script", "iframe", "object", "embed", "noscript", "template", "title", "textarea", "xmp"];
const CSS_VALUE_BLOCK = /expression\s*\(|javascript:|vbscript:|data:|@import|behavior\s*:|-moz-binding|[<>]|\\/i;
const ATTR_VALUE_BLOCK = /[<>]|javascript:|vbscript:|data:|expression\s*\(|url\s*\(\s*(?!#)/i;

export function sanitizeCss(style, { maxLen = 4000 } = {}) {
  const s = typeof style === "string" ? style : "";
  if (!s || s.length > maxLen) return "";
  const out = [];
  for (const decl of s.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim();
    if (!prop || !value) continue;
    if (!ALLOWED_CSS.has(prop)) continue;
    if (CSS_VALUE_BLOCK.test(value)) continue;
    if (/url\s*\(/i.test(value)) continue; // Never allow url() in CSS: the CSS prop allow-list is only safe because of this.
    if (prop === "position" && /\bfixed\b/i.test(value)) continue;
    out.push(`${prop}: ${value}`);
  }
  return out.join("; ");
}

// <style> may only carry rebuilt, allow-listed @keyframes; never pass raw style text through (mXSS).

const KF_STEP = /^(?:from|to|-?\d+(?:\.\d+)?%)$/i;

function cleanKeyframeBody(body) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(body))) {
    const sels = m[1].split(",").map((x) => x.trim()).filter((x) => KF_STEP.test(x));
    if (!sels.length) continue;
    const decls = sanitizeCss(m[2]);
    if (decls) out.push(`${sels.join(",")}{${decls}}`);
  }
  return out.join("");
}

// Don't loosen: no combinators, pseudos, lists or attr selectors (global CSS escape).
const SCOPED_SELECTOR = /^\.tq-(?:moving|attacking)(?:\s+[A-Za-z*.#][\w-]*(?:[.#][\w-]+)*)*$/;

function cleanStyleContent(css, maxLen = 8000) {
  const s = typeof css === "string" ? css.slice(0, maxLen) : "";
  const out = [];
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf("{", i);
    if (open < 0) break;
    const selector = s.slice(i, open).trim();
    let depth = 0, end = -1;
    for (let j = open; j < s.length; j++) {
      const c = s[j];
      if (c === "{") depth++;
      else if (c === "}" && --depth === 0) { end = j; break; }
    }
    if (end < 0) break;
    const body = s.slice(open + 1, end);
    i = end + 1;
    const kf = selector.match(/^@(?:-webkit-)?keyframes\s+([A-Za-z_][\w-]*)$/);
    if (kf) {
      const steps = cleanKeyframeBody(body);
      if (steps) out.push(`@keyframes ${kf[1]}{${steps}}`);
    } else if (SCOPED_SELECTOR.test(selector)) {
      const decls = sanitizeCss(body);
      if (decls) out.push(`${selector}{${decls}}`);
    }
  }
  return out.join("");
}

function cleanStyleBlocks(s) {
  const NUL = String.fromCharCode(0);
  const blocks = [];
  s = s.split(NUL).join(""); // Strip NULs first so injected markup can't forge the block sentinel.
  s = s.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_full, body) => {
    const kf = cleanStyleContent(body);
    if (!kf) return "";
    blocks.push(`<style>${kf}</style>`);
    return NUL + (blocks.length - 1) + NUL;
  });
  s = s.replace(/<style\b[^>]*>[\s\S]*$/gi, "");
  return s.replace(new RegExp(NUL + "([0-9]+)" + NUL, "g"), (_f, i) => blocks[Number(i)] || "");
}

function hash36(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const KF_SCOPED = /^kf[0-9a-z]+_/;

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
  out = out.replace(/(animation(?:-name)?\s*:\s*)([^;"'}]*)/gi, (_f, pre, val) => {
    let v = val;
    for (const n of names) v = v.replace(new RegExp(`\\b${esc(n)}\\b`, "g"), `${salt}${n}`);
    return pre + v;
  });
  return out;
}

function sanitizeAttrs(attrStr) {
  const out = [];
  const re = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(attrStr))) {
    const name = m[1].toLowerCase();
    const val = m[3] ?? m[4] ?? m[5] ?? "";
    if (name.startsWith("on")) continue;
    if (!ALLOWED_ATTRS.has(name)) continue;
    if (name === "style") {
      const css = sanitizeCss(val);
      if (css) out.push(`style="${css}"`);
      continue;
    }
    if (ATTR_VALUE_BLOCK.test(val)) continue;
    out.push(`${CANON_ATTR.get(name) || name}="${String(val).replace(/"/g, "&quot;")}"`);
  }
  return out.length ? " " + out.join(" ") : "";
}

function stringSanitize(markup, maxLen) {
  let s = typeof markup === "string" ? markup : "";
  if (s.length > maxLen) s = s.slice(0, maxLen);
  s = s.replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/gi, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<\?[\s\S]*?\?>/g, "");
  s = cleanStyleBlocks(s); // Must run before the tag walk so only inert CSS stays inside <style>.
  for (const tag of RAW_CONTENT_TAGS) {
    s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), "");
    s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*$`, "gi"), "");
  }
  s = s.replace(/<(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g, (_full, slash, name, attrs) => {
    const tag = name.toLowerCase();
    if (!ALLOWED_TAGS.has(tag) || FORBIDDEN.has(tag)) return "";
    const canon = CANON_TAG.get(tag) || tag;
    // Keep self-closing slash, else later SVG shapes nest inside <path> and vanish.
    const selfClose = !slash && /\/\s*$/.test(attrs);
    return slash ? `</${canon}>` : `<${canon}${sanitizeAttrs(attrs.replace(/\/\s*$/, ""))}${selfClose ? " /" : ""}>`;
  });
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "").replace(/vbscript:/gi, "");
  return s;
}

// Keep the DOMParser re-sanitize pass: it defeats parser-differential/mXSS bypasses.
export function sanitizeHtml(markup, { maxLen = 20000 } = {}) {
  let s = stringSanitize(markup, maxLen);
  if (typeof DOMParser !== "undefined") {
    try {
      const doc = new DOMParser().parseFromString(s, "text/html");
      // Include <head>: the parser may move a body <style> there.
      const inner = (doc.head ? doc.head.innerHTML : "") + (doc.body ? doc.body.innerHTML : "");
      s = stringSanitize(inner, maxLen);
    } catch {}
  }
  s = scopeKeyframeNames(s);
  return s.trim();
}

export function isSafeHtml(markup) {
  return /<[a-z]/i.test(sanitizeHtml(markup));
}

export function stripRootBackground(html) {
  if (typeof html !== "string") return html;
  return html.replace(/style\s*=\s*(["'])([\s\S]*?)\1/, (_m, q, css) => {
    const kept = css.split(";").map((d) => d.trim()).filter((d) => d && !/^background(-color|-image)?\s*:/i.test(d));
    return `style=${q}${kept.join("; ")}${q}`;
  });
}

export function sanitizeHtmlModel(model) {
  if (!model || typeof model !== "object") return null;
  const base = stripRootBackground(sanitizeHtml(model.base));
  if (!/<[a-z]/i.test(base)) return null;
  const out = { canvas: HTML_CANVAS, base };
  for (const st of HTML_STATES) {
    if (st === "base") continue;
    if (typeof model[st] === "string" && model[st].trim()) {
      const clean = stripRootBackground(sanitizeHtml(model[st]));
      if (/<[a-z]/i.test(clean)) out[st] = clean;
    }
  }
  return out;
}
