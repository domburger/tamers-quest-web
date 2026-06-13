// In-game Essence checkout (TQ-169): opens a Paddle.js overlay to buy a premium-currency (Essence)
// pack from INSIDE the game — no /pricing tab hop. The overlay is plain DOM, so it works over the
// Phaser canvas. The purchase is credited server-side by the signature-verified webhook
// (server/paddle.js); this module only OPENS the checkout — it never grants currency.
//
// Inert-safe: until the PUBLIC client token (PADDLE_CLIENT_TOKEN, served via /api/paddle/config) is
// configured, openEssenceCheckout() resolves to { ok:false, reason } so the caller shows a friendly
// "coming soon" message — the same pattern as the /pricing buy buttons (TQ-68). The pack list comes
// from the server config (price IDs + amounts) so the picker can render even before the token lands.
import { TOKEN_KEY } from "../net.js";

const PADDLE_JS = "https://cdn.paddle.com/paddle/v2/paddle.js";
let _cfg = null, _cfgPromise = null, _initDone = false;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Paddle) return resolve();
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) { existing.addEventListener("load", () => resolve()); existing.addEventListener("error", () => reject(new Error("paddle.js failed"))); return; }
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = () => resolve(); s.onerror = () => reject(new Error("paddle.js failed to load"));
    document.head.appendChild(s);
  });
}

// Fetch the public checkout config once (clientToken / environment / packs). Cached; never throws.
export function loadEssenceConfig() {
  if (_cfgPromise) return _cfgPromise;
  _cfgPromise = fetch("/api/paddle/config")
    .then((r) => r.json())
    .then((c) => { _cfg = c; return c; })
    .catch(() => { _cfg = null; return null; });
  return _cfgPromise;
}

// The packs available from the last loaded config, or [] if not loaded yet.
export function essencePacks() { return (_cfg && _cfg.packs) || []; }

// Kick off the config fetch (+ Paddle.js if a client token is present) so the first click is instant.
export function preloadEssenceCheckout() {
  loadEssenceConfig().then((c) => { if (c && c.clientToken) loadScript(PADDLE_JS).catch(() => {}); });
}

function sessionToken() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }

// Open the Paddle checkout for a pack (by `pack` name or price ID). Resolves to { ok:true } or
// { ok:false, reason } where reason is one of: 'not-configured' (no client token yet),
// 'not-signed-in', 'unknown-pack', 'load-failed'. The caller turns the reason into a toast.
export async function openEssenceCheckout(packOrPriceId) {
  const cfg = await loadEssenceConfig();
  if (!cfg || !cfg.clientToken) return { ok: false, reason: "not-configured" };
  const token = sessionToken();
  if (!token) return { ok: false, reason: "not-signed-in" };
  const pick = (cfg.packs || []).find((p) => p.pack === packOrPriceId || p.priceId === packOrPriceId);
  const priceId = pick ? pick.priceId : packOrPriceId;
  if (!priceId) return { ok: false, reason: "unknown-pack" };
  try {
    await loadScript(PADDLE_JS);
    if (!_initDone) {
      if (cfg.environment === "sandbox" && window.Paddle.Environment) window.Paddle.Environment.set("sandbox");
      window.Paddle.Initialize({ token: cfg.clientToken });
      _initDone = true;
    }
    window.Paddle.Checkout.open({
      items: [{ priceId, quantity: 1 }],
      customData: { token },
      settings: { displayMode: "overlay", theme: "dark" },
    });
    return { ok: true };
  } catch { return { ok: false, reason: "load-failed" }; }
}
