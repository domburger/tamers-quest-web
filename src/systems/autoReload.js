// Bundle hash = deploy version (relies on hashed assets/index-*.js); never reload mid-run.

const BUNDLE_RE = /assets\/index-[A-Za-z0-9_-]+\.js/;

export function extractBundleHash(html) {
  if (typeof html !== "string") return null;
  const m = html.match(BUNDLE_RE);
  return m ? m[0] : null;
}

export function isNewVersion(current, latest) {
  return !!(current && latest && current !== latest);
}

export function currentBundleHash(doc = (typeof document !== "undefined" ? document : null)) {
  if (!doc || !doc.querySelector) return null;
  const s = doc.querySelector('script[src*="assets/index-"]');
  if (!s) return null;
  return extractBundleHash(s.getAttribute("src") || s.src || "");
}

async function fetchLatestHash() {
  try {
    const r = await fetch("/?_v=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return null;
    return extractBundleHash(await r.text());
  } catch { return null; }
}

let _pillShown = false;
function showReloadPill() {
  if (_pillShown || typeof document === "undefined" || !document.body) return;
  _pillShown = true;
  const el = document.createElement("div");
  el.id = "tq-update-pill";
  el.setAttribute("role", "button");
  el.textContent = "New version available — Refresh";
  Object.assign(el.style, {
    position: "fixed", left: "50%", bottom: "16px", transform: "translateX(-50%)", zIndex: "99999",
    background: "#1f2230", color: "#f0f0f0", border: "1px solid #3a3f52", borderRadius: "999px",
    padding: "10px 18px", font: "600 14px system-ui, sans-serif", cursor: "pointer",
    boxShadow: "0 6px 24px rgba(0,0,0,.45)",
  });
  el.addEventListener("click", () => { try { location.reload(); } catch {} });
  document.body.appendChild(el);
}

export function initAutoReload({ getInRun = () => false, intervalMs = 5 * 60 * 1000 } = {}) {
  if (typeof window === "undefined" || typeof fetch === "undefined") return () => {};
  const current = currentBundleHash();
  if (!current) return () => {};
  let stopped = false;
  const check = async () => {
    if (stopped || _pillShown || (typeof document !== "undefined" && document.hidden)) return;
    const latest = await fetchLatestHash();
    if (!isNewVersion(current, latest)) return;
    if (getInRun()) return;
    showReloadPill();
    stopped = true;
  };
  const timer = setInterval(check, intervalMs);
  const onVisible = () => { if (!document.hidden) check(); };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", check);
  const kick = setTimeout(check, 15000);
  return () => { stopped = true; clearInterval(timer); clearTimeout(kick); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", check); };
}
