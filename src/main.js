import { loadGameData, getMonsterTypes } from "./data.js";
import {
  generateMonsterSprite,
  generateCombatBackground,
  generateMenuBackground,
} from "./systems/spritegen.js";
import startScene from "./scenes/start.js";
import characterSelectScene from "./scenes/characterSelect.js";
import lobbyScene from "./scenes/lobby.js";
import hubScene from "./scenes/hub.js";
import settingsScene from "./scenes/settings.js";
import onlineGameScene from "./scenes/onlineGame.js";
import bestiaryScene from "./scenes/bestiary.js";
import rosterScene from "./scenes/roster.js";
import cosmeticsScene from "./scenes/cosmetics.js";
import profileScene from "./scenes/profile.js";
import accountScene from "./scenes/account.js";
import { slugOf } from "./render/monster.js"; // canonical sprite-key derivation — shared so boot registration can't drift from draw-time lookup
import { hasHtmlModel } from "./systems/htmlModel.js"; // an html-model monster renders via the live-DOM overlay / html-raster icon, never the baked procedural sprite — so skip warming one for it
import { installFeatureScenes } from "./scenes/featureScenes.js";
import { setGuestProfile, setAuthedProfile, setProfileNickname, clearGuestCharacters, clearProfile, markSession, resolveSessionPersistence } from "./storage.js";
import { TOKEN_KEY } from "./net.js";
import { net } from "./netClient.js";
import { initAutoReload } from "./systems/autoReload.js"; // TQ-206: refresh a long-lived tab on a new deploy (safe moments only)
import { makeCanvasShim } from "./compat/canvasShim.js"; // the raw-canvas2D backend — the SOLE renderer

// TQ-227 / TQ-298 — ENGINE REMOVAL COMPLETE (Dominik confirmed canvas works in a live run 2026-06-15):
// the hand-rolled raw-canvas2D backend (compat/canvasShim.js) is the ONLY renderer. Phaser and its
// compat shim (the old compat/kaboomShim.js) + the `phaser` dependency are GONE — no kill-switch, no
// fallback. `k` is the canvas shim; init() below registers every scene + boots to start on it.
const k = makeCanvasShim();
// Boot the canvas runtime BEHIND the HTML title overlay (low zIndex; the scenes control the title).
k.start({ hideTitle: false, zIndex: "0" });

async function init() {
  // Load game data from JSON
  await loadGameData();

  // Fonts: Fredoka is the ONE font used everywhere (Electrolize retired). Both
  // `gameFont` (display) and `gameFontBody` (body) alias Fredoka weights so every
  // scene that references either alias renders in Fredoka.
  k.loadFont("gameFont", "/assets/font/fredoka-500.woff2");
  k.loadFont("gameFontBody", "/assets/font/fredoka-400.woff2");
  // `gameFontBold` (Fredoka 600) — the heavier weight buttons/headings use so the canvas UI matches
  // the title screen's bold (font-weight:700) buttons. Loaded at boot so it's ready in every scene.
  k.loadFont("gameFontBold", "/assets/font/fredoka-600.woff2");

  // Procedurally generated UI textures (no PNGs). The title screen is now pure
  // HTML (index.html) — no procedural title background/border sprites.
  k.loadSprite("combat_background", generateCombatBackground());
  k.loadSprite("menu_background", generateMenuBackground());
  // (No "player" sprite: the player is drawn everywhere via the vector drawCharacter (render/character.js)
  // — overworld, hub, combat stage, character-select all use it — so the old back-facing baked k.sprite
  // ("player") has no draw site left. Baking it here was dead synchronous boot work + a wasted texture.)

  // Procedurally generated monster sprites — DEFERRED off the boot path (TQ-325). Each
  // generateMonsterSprite is a full procedural canvas rasterization (~52KB of draw code) and there are
  // ~115 types, so doing them synchronously here blocked first paint (and let a logged-in player's
  // "Enter the caves" click land mid-boot — the double-click lag noted below). The title + menus are
  // HTML and need NO monster sprites, so we paint immediately and warm the sprites AFTER first paint,
  // chunked across frames (warmMonsterSprites() at the end of init). drawMonster's tinted-blob fallback
  // covers any monster drawn during the brief (<1s) warm-up; registration uses the SAME slug key.

  // Register all scenes
  startScene(k);
  characterSelectScene(k);
  lobbyScene(k);
  hubScene(k);
  settingsScene(k);
  // SP/MP unify: SP now runs the server-authoritative `onlineGame` round + the server-backed
  // management scenes (roster/onlineShop/onlineBaseUpgrades), so the old local-only SP scenes
  // (inventory/loading/game/fight/runResult) and the dead `onlineLobby` were retired (Phase D).
  onlineGameScene(k);
  bestiaryScene(k);
  rosterScene(k);
  cosmeticsScene(k);
  profileScene(k); // login indicator's detail view: avatar + player data + match history
  accountScene(k); // account/security home (linked providers, email, manage characters)
  installFeatureScenes(k); // @feature lane: registers shop/onlineShop (+ future feature scenes)

  // The title screen is the HTML overlay (index.html). Buttons there call
  // window.tqGo(dest) to launch a Phaser scene; the "start" scene re-shows the
  // overlay (via the tq:title event) so in-game "Back" returns to the title.
  // Accepts an optional scene-args object so callers (and QA harnesses) can deep-link
  // a scene that needs args, e.g. tqGo("hub", { characterId }). The HTML title only
  // ever passes one arg; scenes default their args object, so the bare form is safe.
  window.tqGo = (dest, args) => { try { k.go(dest, args); } catch (e) { console.warn("tqGo", dest, e); } };

  // QA/debug hook (TQ-262): map a design-space point to page CSS px via the shim's worldToScreen, so
  // the live-DOM monster-layer wiring + its headless capture can verify on-screen placement. Mirrors
  // the existing harness hooks (tqGo/__hubTele). No effect on gameplay.
  window.tqWorldToScreen = (x, y, opts) => { try { return k.worldToScreen(x, y, opts); } catch (e) { return { error: String(e) }; } };

  // FLOW screen 1: the HTML title's "Play as guest" path calls this with the
  // chosen nickname before routing to character select, so the local profile is
  // marked as a guest (isGuest:true) with that nickname.
  window.tqGuest = (nickname) => { try { setGuestProfile(nickname); } catch (e) { console.warn("tqGuest", e); } };

  // AUTH-T2/T3: the title's login buttons call this after a successful sign-in
  // (OAuth callback `?token=…`, or a native /auth/{login,signup} response). Mark
  // the local profile as a logged-in account AND store the session token under
  // net's TOKEN_KEY so multiplayer resumes this same server profile.
  window.tqAuthed = (token, nickname, accountSession, remember) => {
    try {
      const keep = remember !== false; // "Stay signed in" — default true (undefined / older callers)
      setAuthedProfile(token, nickname, accountSession, keep); // Phase 2: persist the cloud-account session
      markSession(keep); // ephemeral session ends when the browser closes (resolved at boot)
      if (token) localStorage.setItem(TOKEN_KEY, token);
    } catch (e) { console.warn("tqAuthed", e); }
  };

  // First-login username prompt (index.html) / profile-page rename: persist the chosen display
  // name on the local profile so the login indicator updates without a re-login.
  window.tqSetNickname = (nickname) => {
    try { setProfileNickname(nickname); } catch (e) { console.warn("tqSetNickname", e); }
  };

  // The HTML title's "Log out" button (returning signed-in player) calls this: drop the server
  // session token AND the local identity, so the title re-shows the guest/login menu. Same teardown
  // the in-game "Sign out" buttons use, minus the scene navigation (the title is already shown).
  window.tqSignOut = () => {
    try { net.clearSession(); } catch { /* no session */ }
    try { clearProfile(); } catch (e) { console.warn("tqSignOut", e); }
  };

  // Boot to the (now minimal) start scene; the HTML title overlay covers it.
  // Phase 3: guests are session-only — wipe any persisted guest characters on boot so a guest
  // always starts fresh each page session (sign up to keep progress). Logged-in saves are on the
  // server and untouched.
  try { clearGuestCharacters(); } catch { /* storage disabled */ }

  // Admin → "/bestiary" deep link (admin.html links here). Boots straight into the
  // bestiary; the FULL pool is shown only with a valid admin token (set by the admin
  // page) — a normal visitor lands on their own encountered-only view. Back returns
  // to /admin.html (handled in the scene).
  const path = (() => { try { return location.pathname; } catch { return "/"; } })();
  if (path === "/bestiary" || path === "/bestiary/") {
    const admin = (() => { try { return !!localStorage.getItem("tq_admin_token"); } catch { return false; } })();
    try { const t = document.getElementById("title"); if (t) { t.classList.add("hidden"); t.style.display = "none"; } } catch { /* no DOM */ }
    k.go("bestiary", { admin });
    return;
  }

  // "Stay signed in": an ephemeral (don't-remember) session that has outlived its browser session is
  // dropped here, so the player returns to the title instead of silently resuming. Must run before
  // the auto-skip below reads the profile.
  try { resolveSessionPersistence(); } catch { /* storage disabled */ }

  // A returning logged-in account lands on the title, which (via the HTML overlay's signedInProfile
  // check) shows an "Enter as <name> / Log out" choice instead of the guest/login menu — the player
  // confirms who they are rather than being silently dropped into character-select. Guests and signed-
  // out visitors get the normal title too. A stale session is still handled in character-select (the
  // /account/characters sync signs out cleanly on a 401) once they choose to enter.
  //
  // Race guard: the title's HTML is interactive from first paint, so a logged-in player can click
  // "Enter the caves" DURING this (sprite-heavy) boot — that calls launch(), which hides the title and
  // queues a tqGo() until this init defines it. If we then unconditionally k.go("start") it re-shows the
  // title OVER the pending navigation, forcing a second click (the "click enter twice / reload-like
  // lag" bug). When a launch is already in flight, stand down and let it drive navigation.
  if (!window.__tqLaunching) k.go("start");

  warmMonsterSprites(); // TQ-325: rasterize the ~115 monster sprites AFTER first paint, chunked per frame
}

// TQ-325: generate + register the procedural monster sprites a few per animation frame (instead of one
// synchronous boot loop), so the HTML title/menus paint immediately. requestAnimationFrame guarantees
// steady progress (a few rasterizations per frame), so the full set is ready in well under a second —
// long before navigation reaches a sprite-using scene (roster/bestiary/charselect/combat); any monster
// drawn during the warm-up falls back to drawMonster's tinted blob for a frame or two. Idempotent
// re-registration is harmless. Runs only in the browser (where requestAnimationFrame exists).
function warmMonsterSprites() {
  // Only warm the baked procedural sprite for types that ACTUALLY use it. A monster carrying an html
  // model renders via the live-DOM overlay (overworld/combat) and an html-raster/emblem icon
  // (drawMonsterIcon explicitly bypasses the baked sprite for it) — its generateMonsterSprite output is
  // never drawn — so rasterizing one is wasted CPU + a wasted sprite texture. In AI-content-only prod
  // (generated monsters carry html models) that's most/all of the pool; seed / non-html types warm as
  // before. hasHtmlModel checks a non-empty html.base — the same gate the icon path uses; stored models
  // are pre-sanitized so this matches the live-DOM render decision.
  const types = getMonsterTypes().filter((mt) => mt && !hasHtmlModel(mt));
  const raf = (typeof requestAnimationFrame === "function") ? requestAnimationFrame : (cb) => setTimeout(cb, 16);
  const CHUNK = 6; // ~115 / 6 ≈ 20 frames ≈ 0.3s; small enough not to drop a frame on the light title scene
  let i = 0;
  const step = () => {
    const end = Math.min(i + CHUNK, types.length);
    for (; i < end; i++) {
      const mt = types[i];
      try { k.loadSprite(slugOf(mt.typeName), generateMonsterSprite(mt)); } catch { /* skip a malformed type; its monsters keep the blob fallback */ }
    }
    if (i < types.length) raf(step);
  };
  raf(step);
}

// Register the service worker in production (enables PWA install + offline shell).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("SW register failed", e));
  });
}

// TQ-206: a tab left open across the frequent auto-deploys keeps running the OLD build (the title-screen
// orientation flip just made it visible). Watch for a new content-hashed bundle and offer a refresh —
// but only on a safe screen: never force-reload during a live round (it would kick the player).
if (import.meta.env.PROD) {
  try { initAutoReload({ getInRun: () => net.state.phase === "in_round" }); } catch (e) { console.warn("autoReload", e); }
}

init().catch((err) => {
  console.error("Tamers Quest failed to start:", err);
  k.add([
    k.text("Failed to load game data.\nCheck the console and refresh.", {
      size: 24,
      align: "center",
    }),
    k.pos(k.width() / 2, k.height() / 2),
    k.anchor("center"),
    k.color(255, 100, 100),
  ]);
});
