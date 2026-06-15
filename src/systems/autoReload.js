// TQ-206: a long-lived tab keeps running an OLD build across the frequent auto-deploys (orientation
// flip on the title just makes the stale build visible — it's not the cause). The server serves
// index.html no-cache with CONTENT-HASHED bundles (assets/index-<hash>.js), so the bundle hash IS the
// deploy version. Poll index.html, compare its hash to the one THIS tab booted with; when they differ
// AND the player is on a safe screen (NOT in a live run), show a "new version — refresh" pill. We
// never force-reload mid-match (that would kick the player); the pill is user-initiated. Pure helpers
// are exported for tests; the init wires the timers and is a no-op outside the browser / in dev (no
// hashed bundle to compare).

const BUNDLE_RE = /assets\/index-[A-Za-z0-9_-]+\.js/;

// The content-hashed main-bundle filename embedded in an index.html string, e.g.
// "assets/index-DffBs6V3.js" — or null if absent (dev serves /src/main.js, no hashed bundle).
export function extractBundleHash(html) {
  if (typeof html !== "string") return null;
  const m = html.match(BUNDLE_RE);
  return m ? m[0] : null;
}

// A new deploy is detected only when BOTH hashes are known and they differ (never on a missing read).
export function isNewVersion(current, latest) {
  return !!(current && latest && current !== latest);
}

// The bundle this tab is currently running, read from its own loaded <script src=…assets/index-*.js>.
export function currentBundleHash(doc = (typeof document !== "undefined" ? document : null)) {
  if (!doc || !doc.querySelector) return null;
  const s = doc.querySelector('script[src*="assets/index-"]');
  if (!s) return null;
  return extractBundleHash(s.getAttribute("src") || s.src || "");
}

async function fetchLatestHash() {
  try {
    // Cache-bust + no-store so we read the freshly-revalidated index.html (the SW is network-first).
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
  el.addEventListener("click", () => { try { location.reload(); } catch { /* noop */ } });
  document.body.appendChild(el);
}

/**
 * Start watching for a new deploy. `getInRun()` must return true while the player is in a live round
 * (so we defer the refresh — never mid-match). Returns a stop() fn. No-op in non-browser / dev.
 */
export function initAutoReload({ getInRun = () => false, intervalMs = 5 * 60 * 1000 } = {}) {
  if (typeof window === "undefined" || typeof fetch === "undefined") return () => {};
  const current = currentBundleHash();
  if (!current) return () => {}; // dev or unknown shell → nothing to compare against
  let stopped = false;
  const check = async () => {
    if (stopped || _pillShown || (typeof document !== "undefined" && document.hidden)) return;
    const latest = await fetchLatestHash();
    if (!isNewVersion(current, latest)) return;
    if (getInRun()) return; // a new build is live, but defer — re-checks on the next tick / focus
    showReloadPill();
    stopped = true;
  };
  const timer = setInterval(check, intervalMs);
  const onVisible = () => { if (!document.hidden) check(); };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", check);
  const kick = setTimeout(check, 15000); // first check shortly after boot
  return () => { stopped = true; clearInterval(timer); clearTimeout(kick); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", check); };
}
