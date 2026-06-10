// The walkable LOBBY HUB (user 2026-06-10): instead of a menu, the player walks their vector
// character around a small camp and approaches STATIONS — a CAVE ENTRANCE (start a run), a HEALER,
// a MERCHANT (spirit shop) and the VAULT (team/inventory). Rendered in the SAME flat-vector style
// as the in-run overworld: the player is `drawCharacter` (their equipped cosmetic), the cave is the
// real in-game `drawPortal` rift, and every structure is immediate-mode primitives. Stations route
// to the EXISTING scenes (onlineShop / roster / net.heal / the run handshake), so this only changes
// HOW you navigate to them, not what they do. Server session + run handshake are ported from
// lobby.js (the hub will replace it — step 4 flips routing onto the hub; until then it's reachable
// only directly so prod's menu lobby keeps working).

import { drawCharacter } from "../render/character.js";
import { getEquippedCharacterSkin } from "../render/characterCosmetics.js";
import { getEquippedSkin } from "../render/chainCosmetics.js";
import { drawPortal } from "../render/portal.js";
import { drawTiles, makeTileCache } from "../render/tiles.js";
import { drawAtmosphere } from "../render/atmosphere.js";
import { getCharacter, setCharacterServerToken, saveCharacter, getProfile, clearProfile } from "../storage.js";
import { healTeam } from "../engine/progression.js";
import { safeInsetsDesign } from "../systems/safearea.js";
import { getMonsterType, getGroundTiles } from "../engine/gamedata.js";
import { getMonsterStats } from "../engine/stats.js";
import { generateMap, isWalkable } from "../engine/mapgen.js";
import { GAME } from "../engine/schemas.js";
import { net } from "../netClient.js";
import { THEME, FONT, addButton, addPanel, addLabel } from "../ui/theme.js";
import { prefersReducedMotion } from "../systems/a11y.js";
import { gamepadMove, gamepadPressed, BTN } from "../systems/gamepad.js";

// The camp is a small ENCLOSED tiled room rendered by the SAME pipeline as the in-run overworld:
// real floor tiles (render/tiles.js), the surrounding void as rock walls + abyss, isWalkable wall
// collision, camera-follow, and the same atmosphere (vignette / spirit-glow / motes). Constants
// mirror the overworld so movement + scale feel identical.
const E = GAME.EFFECTIVE_TILE;   // 80 — world px per tile
const SPEED = GAME.BASE_SPEED;   // 200 px/s
const PR = GAME.PLAYER_RADIUS;   // 13 — body half-width for wall collision
const REACH = 104;               // interaction radius — how close you stand to a station to use it
// Floor room: a rectangle of walkable tiles inside a square grid; the rest is void → walls + abyss.
const GRID = 24;
const RX0 = 3, RY0 = 3, RX1 = 20, RY1 = 16;       // floor-room tile bounds (inclusive) → 18×14 floor
const TILE = (tx, ty) => ({ x: tx * E + E / 2, y: ty * E + E / 2 }); // tile centre → world px

// A couple of hues the flat theme doesn't name (the structures' identity colours).
const HEAL = [120, 222, 150];  // healing green (the Healer's cross + glow)
const WOOD = [124, 92, 60];    // the Merchant stall's timber counter/posts

// Build the camp map in the SAME shape a generated overworld map has, so the shared drawTiles +
// isWalkable treat it identically. One representative floor tile (a cave-ish biome when available)
// fills the room; the void border around it renders as the enclosing walls.
function buildCampMap() {
  const tiles = getGroundTiles() || [];
  const floor = tiles.find((t) => /stone|crystal|metal|astral|cave/i.test(t.biome || "") && !t.collidable)
    || tiles.find((t) => !t.collidable) || null;
  const fallback = { colorProfile_full_r: 46, colorProfile_full_g: 43, colorProfile_full_b: 58,
    colorProfile_top_r: 46, colorProfile_top_g: 43, colorProfile_top_b: 58,
    colorProfile_bottom_r: 40, colorProfile_bottom_g: 37, colorProfile_bottom_b: 52,
    colorProfile_left_r: 43, colorProfile_left_g: 40, colorProfile_left_b: 55,
    colorProfile_right_r: 43, colorProfile_right_g: 40, colorProfile_right_b: 55, collidable: 0 };
  const base = floor || fallback;
  const voidMap = [], tileMap = [];
  for (let x = 0; x < GRID; x++) { voidMap[x] = new Array(GRID).fill(false); tileMap[x] = new Array(GRID).fill(null); }
  for (let x = RX0; x <= RX1; x++) for (let y = RY0; y <= RY1; y++) {
    voidMap[x][y] = true;
    tileMap[x][y] = { ...base, rotation: 0, activeMonster: null };
  }
  return { voidMap, tileMap, mapSize: GRID };
}

export default function hubScene(k) {
  k.scene("hub", ({ characterId } = {}) => {
    const character = getCharacter(characterId);
    if (!character) { k.go("characterSelect"); return; }

    // The tiled camp room (same renderer as the overworld) + its sprite cache.
    const campMap = buildCampMap();
    const tileCache = makeTileCache();

    // ── Stations: anchored on FLOOR TILES around the room. Cave at the top wall (the way you face on
    //    spawn), Healer left, Merchant right, Vault at the bottom. `act` is the interact handler. ──
    const stations = [
      // `rdy` shifts the proximity centre DOWN to the cave's mouth/portal — you approach the glowing
      // entrance (≈y+40), not the rock-mound top the structure is anchored at, so reach feels right.
      // Embedded in the TOP WALL (row 3) so walking up to the wall lands you at the cave mouth — its
      // reach centres on the anchor (rdy 0), which the wall-clamped player sits inside.
      { id: "cave",     ...TILE(11.5, 3),   label: "CAVE ENTRANCE", hint: "start a run",      accent: THEME.teal,   rdy: 0,  act: () => openPlay() },
      { id: "healer",   ...TILE(5, 9.5),    label: "HEALER",        hint: "heal your team",   accent: HEAL,         act: () => healNow() },
      { id: "merchant", ...TILE(18, 9.5),   label: "MERCHANT",      hint: "spirit shop",      accent: THEME.amber,  act: () => k.go("onlineShop", { characterId, backScene: "hub", backArgs: { characterId } }) },
      { id: "vault",    ...TILE(11.5, 15),  label: "VAULT",         hint: "team & inventory", accent: THEME.violet, act: () => k.go("roster", { characterId, backScene: "hub", backArgs: { characterId } }) },
    ];

    // Player state — a LOCAL walkable position (no server needed to idle in camp). Spawn centre-floor.
    const me = { ...TILE(11.5, 9.5) };
    let dir = { x: 0, y: -1 };            // facing up toward the cave on entry
    let moving = false;
    let near = null;                      // the station currently in reach (or null)
    const cos = getEquippedCharacterSkin(); // the player's accent / cloak / body model

    // a11y: freeze the camp's continuous pulses (glows, rings, keyhole) under reduce-motion. The
    // cave portal + the player figure already handle reduce-motion in their own renderers.
    const reduce = prefersReducedMotion();

    // Account / identity for the HUD (top-right avatar + currency chips + the dropdown).
    const accent = cos.accent || THEME.teal;
    const profile = getProfile();
    const authed = !!(profile && !profile.isGuest);   // signed-in (vs guest) → richer account dropdown
    const ins = safeInsetsDesign(k);                  // keep the avatar off a phone notch
    const acctInitial = (((profile && profile.nickname) || character.name || "T").trim()[0] || "T").toUpperCase();

    // Touch/mouse joystick state (mobile has no keyboard — without this the camp is unwalkable there).
    // Ported from the in-run overworld (onlineGame.js) so the feel is identical: a FLOATING stick that
    // spawns under the thumb, drag to move. A thumb "USE" button (bottom-right) interacts on touch.
    const TOUCH = typeof k.isTouchscreen === "function" ? k.isTouchscreen() : (typeof window !== "undefined" && "ontouchstart" in window);
    const JOY_R = 70, IBTN_R = 44;
    let joyId = null, joyVec = { x: 0, y: 0 }, joyBase = k.vec2(0, 0), joyThumb = k.vec2(0, 0);

    // ── Server session foundation (ported from lobby.js — SP/MP unify, Phase A) ───────
    // The SERVER profile is the single source of truth for team/currency. Bind this slot to its
    // token-keyed server profile and establish the session on entry, so the Healer (net.heal) and
    // the Cave run-handshake work without a cold connect. Loss-safe one-time migration as in lobby.
    const sessionOffs = [];
    function offSession() { sessionOffs.forEach((o) => o && o()); sessionOffs.length = 0; }
    let imported = false;
    function localLoadout() {
      return {
        activeMonsters: character.activeMonsters || [],
        vaultMonsters: character.vaultMonsters || [],
        chains: character.chains || [],
        equippedChainId: character.equippedChainId || null,
        gold: character.gold || 0,
        essence: character.essence || 0,
        upgrades: character.upgrades || {},
      };
    }
    function establishSession() {
      try {
        net.state.token = character.serverToken || net.state.token || null;
        sessionOffs.push(
          net.on("open", () => { try { net.join(nick()); } catch {} }),
          net.on("welcome", () => {
            if (net.state.token && net.state.token !== character.serverToken) {
              try { setCharacterServerToken(characterId, net.state.token); character.serverToken = net.state.token; } catch {}
            }
            if (!net.state.migrated && !imported) { imported = true; try { net.importProfile(localLoadout()); } catch {} }
          }),
        );
        if (net.state.playerId) { /* already joined this session */ }
        else if (net.state.connected) net.join(nick());
        else net.connect();
      } catch { /* offline / no WS — the Cave run handshake surfaces the connect error UI */ }
    }
    // The EFFECTIVE profile: the authoritative SERVER profile once joined, else the local slot as a
    // fallback while connecting/offline. Used by the Healer (injured check) and step-4 currency HUD.
    function prof() {
      if (net.state.playerId) {
        return {
          activeMonsters: net.state.team || [],
          gold: net.state.gold || 0,
          essence: net.state.essence || 0,
        };
      }
      return character;
    }
    establishSession();
    function nick() { return (character.name || net.state.nickname || "Tamer").slice(0, 20); }

    // ── input → local movement + station proximity (keyboard + arrows) ────────────────
    k.onUpdate(() => {
      const gpEdges = gamepadPressed(); // once per frame (edge detection); A = interact
      if (overlayOpen) return; // freeze the player while a modal (run handshake / picker) is up
      if (gpEdges.has(BTN.A) || gpEdges.has(BTN.START)) interact();
      let dx = 0, dy = 0;
      if (k.isKeyDown("w") || k.isKeyDown("up")) dy -= 1;
      if (k.isKeyDown("s") || k.isKeyDown("down")) dy += 1;
      if (k.isKeyDown("a") || k.isKeyDown("left")) dx -= 1;
      if (k.isKeyDown("d") || k.isKeyDown("right")) dx += 1;
      // Touch/mouse joystick OR gamepad stick override the keys — both are proper 0..1 vectors (the
      // magnitude IS the speed), so they skip the keyboard's diagonal re-normalization.
      const gm = gamepadMove();
      let usingVec = false;
      if (joyVec.x || joyVec.y) { dx = joyVec.x; dy = joyVec.y; usingVec = true; }
      else if (gm.x || gm.y) { dx = gm.x; dy = gm.y; usingVec = true; }
      moving = !!(dx || dy);
      if (moving) {
        dir = { x: dx, y: dy };
        if (!usingVec && dx && dy) { dx *= 0.707; dy *= 0.707; } // normalize diagonal (keyboard only)
        const step = SPEED * k.dt();
        // Axis-separated WALL collision (same rule as the overworld): test the body edge against
        // isWalkable per axis, so you slide along the camp walls instead of sticking.
        const nx = me.x + dx * step, ny = me.y + dy * step;
        if (isWalkable(campMap, nx + Math.sign(dx) * PR, me.y)) me.x = nx;
        if (isWalkable(campMap, me.x, ny + Math.sign(dy) * PR)) me.y = ny;
      }
      // Nearest station within reach becomes the interactable (drives the prompt + interact key).
      near = null; let best = REACH * REACH;
      for (const s of stations) {
        const ddx = s.x - me.x, ddy = (s.y + (s.rdy || 0)) - me.y, d2 = ddx * ddx + ddy * ddy;
        if (d2 < best) { best = d2; near = s; }
      }
      // Camera follows the player (1×, like the overworld); the surrounding walls + abyss fill the
      // screen edges, so the camp reads as an enclosed cave chamber.
      k.camPos(me.x, me.y);
    });

    // Interact: walk up to a station and press E / Enter / Space to use it.
    function interact() { if (!overlayOpen && near) near.act(); }
    k.onKeyPress("e", interact);
    k.onKeyPress("enter", interact);
    k.onKeyPress("space", interact);

    // ── render the camp + stations + player (immediate mode, same as the overworld) ───
    k.onDraw(() => {
      // The run-handshake/picker overlay is built from `fixed` k.add objects that draw BELOW this
      // immediate-mode pass — so while one is open we skip the whole camp, letting the modal show
      // over the dim backdrop (same reason lobby.js skips its onDraw tamer when an overlay is up).
      if (overlayOpen) return;
      const t = k.time();
      // Floor + walls via the SAME renderer as the overworld: textured tiles, void→rock walls + abyss,
      // edge shadows, and the dark mood wash (camera-centred on the player).
      drawTiles(k, campMap, me.x, me.y, tileCache, E);
      // Stations behind/around the player; the player is drawn last so it never hides behind one.
      for (const s of stations) drawStation(s, t, s === near);
      drawCharacter(k, { x: me.x, y: me.y, t, moving, color: cos.accent, cloak: cos.cloak, model: cos.model, dir, skin: getEquippedSkin() });
      drawAtmosphere(k, { t }); // vignette + spirit glow + drifting motes — the same ambient as a run
      drawHud();
      drawTouchControls();
    });

    // ── a station: ground shadow + accent glow + its structure + name + active ring ───
    function drawStation(s, t, active) {
      const col = (c, o = 1) => ({ color: k.rgb(...c), opacity: o });
      // Soft ground shadow so the structure sits ON the floor, not floating.
      k.drawEllipse({ pos: k.vec2(s.x, s.y + 52), radiusX: 70, radiusY: 20, ...col([0, 0, 0], 0.22) });
      // A faint accent glow disc (brighter when you're standing in reach).
      const pulse = reduce ? 0.85 : 0.5 + 0.5 * Math.sin(t * 2.4 + s.x);
      k.drawEllipse({ pos: k.vec2(s.x, s.y + 30), radiusX: 64, radiusY: 30, ...col(s.accent, (active ? 0.22 : 0.10) + 0.05 * pulse) });

      if (s.id === "cave") drawCave(s, t);
      else if (s.id === "healer") drawHealer(s, t);
      else if (s.id === "merchant") drawMerchant(s, t);
      else if (s.id === "vault") drawVault(s, t);

      // Name plate under the structure.
      k.drawText({ text: s.label, pos: k.vec2(s.x, s.y + 72), anchor: "top", size: 14, font: FONT, color: k.rgb(...(active ? s.accent : THEME.textBody)) });

      // Active ring + a floating key bubble when you're in reach.
      if (active) {
        const r = reduce ? 58 : 58 + 3 * Math.sin(t * 4);
        k.drawCircle({ pos: k.vec2(s.x, s.y + 18), radius: r, fill: false, outline: { width: 3, color: k.rgb(...s.accent) }, opacity: 0.5 + 0.3 * pulse });
        const by = s.y - 74;
        k.drawRect({ pos: k.vec2(s.x - 16, by - 14), width: 32, height: 28, radius: 7, color: k.rgb(...THEME.bgAlt), outline: { width: 2, color: k.rgb(...s.accent) } });
        k.drawText({ text: "E", pos: k.vec2(s.x, by), anchor: "center", size: 16, font: FONT, color: k.rgb(...s.accent) });
      }
    }

    // CAVE — a rocky mound with a dark mouth and the real in-game spirit rift glowing within.
    function drawCave(s, t) {
      const rock = [44, 48, 60], rockDk = [30, 33, 42];
      k.drawEllipse({ pos: k.vec2(s.x, s.y - 6), radiusX: 150, radiusY: 96, color: k.rgb(...rockDk) });
      k.drawEllipse({ pos: k.vec2(s.x, s.y - 16), radiusX: 132, radiusY: 84, color: k.rgb(...rock) });
      k.drawEllipse({ pos: k.vec2(s.x - 54, s.y - 40), radiusX: 40, radiusY: 26, color: k.rgb(...rock), opacity: 0.7 }); // a couple of boulders for relief
      k.drawEllipse({ pos: k.vec2(s.x + 60, s.y - 30), radiusX: 34, radiusY: 22, color: k.rgb(...rockDk), opacity: 0.8 });
      // The dark cave mouth (recess) the rift sits in.
      k.drawEllipse({ pos: k.vec2(s.x, s.y + 4), radiusX: 56, radiusY: 70, color: k.rgb(7, 8, 11) });
      // The extraction-style rift, reused from the overworld (always fully risen here).
      drawPortal(k, { x: s.x, y: s.y + 46, t, age: 999 });
    }

    // HEALER — a canvas relief tent with a glowing green cross (free team heal).
    function drawHealer(s, t) {
      const canvas = [212, 206, 190], shade = [176, 170, 156];
      const pulse = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 2.5);
      // Tent body (two panels for a shaded fold) + a peaked top faked with stacked narrowing rects.
      k.drawRect({ pos: k.vec2(s.x - 44, s.y - 18), width: 88, height: 66, radius: 8, color: k.rgb(...canvas) });
      k.drawRect({ pos: k.vec2(s.x, s.y - 18), width: 44, height: 66, radius: 8, color: k.rgb(...shade), opacity: 0.6 });
      k.drawRect({ pos: k.vec2(s.x - 50, s.y - 30), width: 100, height: 16, radius: 6, color: k.rgb(...shade) });   // eaves
      k.drawRect({ pos: k.vec2(s.x - 34, s.y - 42), width: 68, height: 16, radius: 6, color: k.rgb(...canvas) });   // roof
      k.drawRect({ pos: k.vec2(s.x - 18, s.y - 52), width: 36, height: 14, radius: 6, color: k.rgb(...shade) });    // peak
      // Glowing green cross on the canvas.
      k.drawRect({ pos: k.vec2(s.x - 5, s.y - 8), width: 10, height: 34, radius: 2, color: k.rgb(...HEAL), opacity: 0.85 + 0.15 * pulse });
      k.drawRect({ pos: k.vec2(s.x - 17, s.y + 4), width: 34, height: 10, radius: 2, color: k.rgb(...HEAL), opacity: 0.85 + 0.15 * pulse });
    }

    // MERCHANT — a timber stall: posts, a striped awning, a counter, and a few wares.
    function drawMerchant(s, _t) {
      const stripe = THEME.amber, stripe2 = THEME.danger;
      // Posts.
      k.drawRect({ pos: k.vec2(s.x - 56, s.y - 46), width: 8, height: 90, radius: 2, color: k.rgb(...WOOD) });
      k.drawRect({ pos: k.vec2(s.x + 48, s.y - 46), width: 8, height: 90, radius: 2, color: k.rgb(...WOOD) });
      // Counter.
      k.drawRect({ pos: k.vec2(s.x - 58, s.y + 16), width: 116, height: 28, radius: 5, color: k.rgb(...WOOD) });
      k.drawRect({ pos: k.vec2(s.x - 58, s.y + 16), width: 116, height: 8, radius: 4, color: k.rgb(...stripe), opacity: 0.5 }); // lit counter lip
      // Striped awning (alternating amber/red panels).
      for (let i = 0; i < 6; i++) {
        k.drawRect({ pos: k.vec2(s.x - 58 + i * 19, s.y - 50), width: 19, height: 22, color: k.rgb(...(i % 2 ? stripe2 : stripe)) });
      }
      k.drawRect({ pos: k.vec2(s.x - 60, s.y - 30), width: 120, height: 6, radius: 3, color: k.rgb(...THEME.bgAlt), opacity: 0.5 }); // awning underside shadow
      // A few wares on the counter (spirit-chain orbs).
      k.drawCircle({ pos: k.vec2(s.x - 30, s.y + 10), radius: 7, color: k.rgb(...THEME.teal) });
      k.drawCircle({ pos: k.vec2(s.x, s.y + 10), radius: 7, color: k.rgb(...THEME.violet) });
      k.drawCircle({ pos: k.vec2(s.x + 30, s.y + 10), radius: 7, color: k.rgb(...THEME.ice) });
    }

    // VAULT — a banded strongbox/chest with a lock, lit by a violet glow.
    function drawVault(s, t) {
      const steel = [96, 104, 120], steelDk = [66, 72, 86], band = THEME.amber;
      const pulse = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 2.2);
      // Body + lid.
      k.drawRect({ pos: k.vec2(s.x - 48, s.y - 6), width: 96, height: 52, radius: 7, color: k.rgb(...steel) });
      k.drawRect({ pos: k.vec2(s.x - 52, s.y - 28), width: 104, height: 26, radius: 9, color: k.rgb(...steelDk) });
      // Metal bands (vertical) + a horizontal seam.
      k.drawRect({ pos: k.vec2(s.x - 30, s.y - 26), width: 8, height: 70, color: k.rgb(...band), opacity: 0.85 });
      k.drawRect({ pos: k.vec2(s.x + 22, s.y - 26), width: 8, height: 70, color: k.rgb(...band), opacity: 0.85 });
      k.drawRect({ pos: k.vec2(s.x - 52, s.y - 4), width: 104, height: 4, color: k.rgb(...steelDk) });
      // Lock plate + glowing keyhole.
      k.drawRect({ pos: k.vec2(s.x - 11, s.y - 8), width: 22, height: 22, radius: 4, color: k.rgb(...band) });
      k.drawCircle({ pos: k.vec2(s.x, s.y + 2), radius: 4, color: k.rgb(...THEME.violet), opacity: 0.7 + 0.3 * pulse });
    }

    // ── fixed HUD: camp name + the active station's interaction prompt ────────────────
    function drawHud() {
      const P = prof();
      // Top-LEFT: camp name + this character's identity (top-CENTRE would collide with the cave).
      k.drawText({ text: "CAMP", pos: k.vec2(18, 14), anchor: "topleft", size: 15, font: FONT, color: k.rgb(...THEME.textMut), fixed: true });
      k.drawText({ text: `${character.name}${character.isGuest ? "  (guest)" : ""}    Lv ${character.level}`, pos: k.vec2(18, 34), anchor: "topleft", size: 13, font: FONT, color: k.rgb(...THEME.textBody), fixed: true });

      // Top-CENTRE: currencies in their identity hues (gold = amber, essence = teal).
      const cxm = k.width() / 2;
      k.drawText({ text: `${P.gold || 0} gold`, pos: k.vec2(cxm - 10, 18), anchor: "topright", size: 14, font: FONT, color: k.rgb(...THEME.amber), fixed: true });
      k.drawText({ text: `${P.essence || 0} essence`, pos: k.vec2(cxm + 10, 18), anchor: "topleft", size: 14, font: FONT, color: k.rgb(...THEME.teal), fixed: true });

      // Top-RIGHT: account avatar badge (the CLICK target is a separate invisible fixed area added at
      // scene init — immediate-mode draws can't receive clicks; see the acctHit block below).
      const aR = 20, aX = k.width() - aR - 16 - ins.right, aY = aR + 14 + ins.top;
      k.drawCircle({ pos: k.vec2(aX, aY), radius: aR, color: k.rgb(...(authed ? accent : THEME.surfaceAlt)),
        outline: { width: 2, color: k.rgb(...(authed ? accent : THEME.line)) }, fixed: true });
      k.drawText({ text: acctInitial, pos: k.vec2(aX, aY + 1), anchor: "center", size: 18, font: FONT, color: k.rgb(...(authed ? THEME.bg : THEME.textMut)), fixed: true });

      if (near) {
        const txt = TOUCH ? near.hint : `Press  E  —  ${near.hint}`;
        const w = txt.length * 9 + 28;
        const cx = k.width() / 2, y = k.height() - 46;
        k.drawRect({ pos: k.vec2(cx - w / 2, y - 16), width: w, height: 32, radius: 9, color: k.rgb(...THEME.bgAlt), opacity: 0.92, outline: { width: 2, color: k.rgb(...near.accent) }, fixed: true });
        k.drawText({ text: txt, pos: k.vec2(cx, y), anchor: "center", size: 15, font: FONT, color: k.rgb(...THEME.text), fixed: true });
      } else {
        k.drawText({ text: TOUCH ? "drag to move" : "WASD / arrows to move", pos: k.vec2(k.width() / 2, k.height() - 30), anchor: "center", size: 12, font: FONT, color: k.rgb(...THEME.textMut), opacity: 0.8, fixed: true });
      }
    }

    // ── Healer (ported from lobby.js task 50): free full heal of the active team ──────
    function teamInjured() {
      return (prof().activeMonsters || []).some((m) => {
        try {
          const st = getMonsterStats(getMonsterType(m.typeName), m.level);
          return (m.currentHealth ?? st.health) < st.health || (m.currentEnergy ?? st.energy) < st.energy || !!m.status;
        } catch { return false; }
      });
    }
    function healNow() {
      if (!teamInjured()) { toast("Team already at full health"); return; }
      if (net.state.playerId) {
        try { net.heal(); } catch {}
        const off = net.on("roster", () => { off(); toast("Team healed"); });
        sessionOffs.push(off);
      } else {
        try { healTeam(character.activeMonsters); saveCharacter(character); } catch {}
        toast("Team healed");
      }
    }

    // A tiny transient confirmation (the camp has no scene reload to signal an action landed).
    let toastMsg = "", toastUntil = 0;
    function toast(msg) { toastMsg = msg; toastUntil = k.time() + 1.8; }
    k.onDraw(() => {
      if (overlayOpen || !toastMsg || k.time() > toastUntil) return;
      const op = Math.min(1, (toastUntil - k.time()) / 0.4);
      const w = toastMsg.length * 9 + 28, cx = k.width() / 2, y = 70;
      k.drawRect({ pos: k.vec2(cx - w / 2, y - 15), width: w, height: 30, radius: 8, color: k.rgb(...THEME.surface2), opacity: 0.95 * op, fixed: true });
      k.drawText({ text: toastMsg, pos: k.vec2(cx, y), anchor: "center", size: 14, font: FONT, color: k.rgb(...THEME.text), opacity: op, fixed: true });
    });

    // ── Cave run handshake (ported from lobby.js): SP/MP picker → connect/queue → onlineGame ──
    const netOffs = [];
    let leaving = false;
    let overlayOpen = false;
    let connectTimer = null;
    const cancelConnectTimer = () => { if (connectTimer) { connectTimer.cancel(); connectTimer = null; } };
    function clearNet() { netOffs.forEach((off) => off && off()); netOffs.length = 0; }
    function closeOverlay() { cancelConnectTimer(); clearNet(); k.destroyAll("overlay"); overlayOpen = false; }

    // Overlays are FIXED (screen-space) so the moving camera never shifts them. Movement is frozen
    // while one is open (onUpdate early-returns), so the camera holds steady behind the dim too.
    function dim() {
      k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.anchor("topleft"), k.color(0, 0, 0), k.opacity(0.72), k.fixed(), "overlay"]);
    }
    const cw = (cap) => Math.min(cap, k.width() - 32);

    function openPlay() {
      if (overlayOpen) return;
      k.destroyAll("overlay");
      overlayOpen = true;
      dim();
      const cx = k.width() / 2, my = k.height() / 2;
      const hasMonsters = (prof().activeMonsters || []).length > 0;
      addPanel(k, { x: cx, y: my, w: cw(380), h: 320, radius: 18, fixed: true, tag: "overlay" });
      addLabel(k, { x: cx, y: my - 130, text: "ENTER A RUN", size: 22, color: THEME.text, fixed: true, tag: "overlay" });
      addLabel(k, { x: cx, y: my - 104, text: "The same team — pick this run's mode", size: 13, color: THEME.textMut, fixed: true, tag: "overlay" });
      addButton(k, { x: cx, y: my - 60, w: cw(300), h: 48, text: "Singleplayer", size: 19,
        fill: hasMonsters ? THEME.primary : THEME.surfaceAlt, textColor: hasMonsters ? THEME.textInv : THEME.textMut,
        disabled: !hasMonsters, fixed: true, tag: "overlay", onClick: () => { if (hasMonsters) startServerRun(true); } });
      addLabel(k, { x: cx, y: my - 30, text: hasMonsters ? "Solo run with your saved team" : "No monsters — visit the Vault first",
        size: 11, color: hasMonsters ? THEME.textMut : THEME.warn, fixed: true, tag: "overlay" });
      addButton(k, { x: cx, y: my + 20, w: cw(300), h: 48, text: "Multiplayer", size: 19,
        fill: THEME.violet, textColor: THEME.textInv, fixed: true, tag: "overlay", onClick: () => startServerRun(false) });
      addLabel(k, { x: cx, y: my + 50, text: "Live extraction vs other tamers", size: 11, color: THEME.textMut, fixed: true, tag: "overlay" });
      addButton(k, { x: cx, y: my + 116, w: cw(200), h: 40, text: "Cancel", size: 16,
        fill: THEME.surface, textColor: THEME.danger, fixed: true, tag: "overlay", onClick: closeOverlay });
    }

    // Both modes run a SERVER-AUTHORITATIVE round (SP/MP unify): connect (or reuse the session) →
    // join → queue → roundStart generates the map → onlineGame. SP uses queueSolo (instant private),
    // MP uses queue (matchmaking). Identical to lobby.js's handshake.
    function startServerRun(solo) {
      k.destroyAll("overlay");
      overlayOpen = true;
      dim();
      const cx = k.width() / 2, my = k.height() / 2;
      addPanel(k, { x: cx, y: my, w: cw(380), h: 220, radius: 18, fixed: true, tag: "overlay" });
      addLabel(k, { x: cx, y: my - 70, text: solo ? "SINGLEPLAYER" : "MULTIPLAYER", size: 22, color: THEME.text, fixed: true, tag: "overlay" });
      const status = k.add([k.text(solo ? "Starting your run…" : "Connecting…", { size: 16, font: FONT, width: cw(380) - 40, align: "center" }),
        k.pos(cx, my - 16), k.anchor("center"), k.color(...THEME.textMut), k.fixed(), "overlay"]);
      const setStatus = (sx) => { try { status.text = sx; } catch {} };
      addButton(k, { x: cx, y: my + 64, w: cw(200), h: 42, text: "Cancel", size: 16,
        fill: THEME.surface, textColor: THEME.danger, fixed: true, tag: "overlay",
        onClick: () => { try { net.unqueue(); } catch {} closeOverlay(); } });

      clearNet();
      const enterQueue = () => { try { if (solo) net.queueSolo(); else net.queue(); } catch {} };
      cancelConnectTimer();
      connectTimer = k.wait(14, () => { connectTimer = null; if (overlayOpen && !net.state.connected) setStatus("Couldn't reach the server — it may be waking up. Cancel and retry."); });
      netOffs.push(
        net.on("open", () => { cancelConnectTimer(); setStatus(solo ? "Connected. Preparing…" : "Connected. Joining…"); net.join(nick()); }),
        net.on("welcome", () => { setStatus(solo ? "Starting your run…" : "Joined. Entering queue…"); enterQueue(); }),
        net.on("queued", (m) => setStatus(`In queue (#${m?.position ?? "?"})… waiting for players.`)),
        net.on("matchFound", () => setStatus(solo ? "Generating your world…" : "Match found! Generating the world…")),
        net.on("roundStart", () => {
          clearNet();
          setStatus("Generating world…");
          generateMap((p) => setStatus(`Generating world… ${Math.round(p * 100)}%`), net.state.seed)
            .then((map) => { if (!leaving) k.go("onlineGame", { map, characterId, backScene: "hub" }); })
            .catch(() => setStatus("Failed to generate the world."));
        }),
        net.on("error", () => setStatus("Connection error — is the server up?")),
        net.on("close", () => { if (net.state.phase !== "in_round") setStatus("Disconnected. Cancel and retry."); }),
      );
      if (net.state.playerId) enterQueue();
      else if (net.state.connected) net.join(nick());
      else net.connect();
    }

    // ── Top-right account dropdown (View Profile / Account / Settings / Switch Character / Sign out) ──
    // Toggled by the avatar badge (acctHit below) or Esc. Reuses the overlay infra (fixed/screen-space)
    // so a click on the faint backdrop or Esc both dismiss it. Signed-in vs guest get different items.
    function openAcctMenu() {
      if (overlayOpen) { closeOverlay(); return; } // toggle / dismiss any open overlay (incl. the run picker)
      overlayOpen = true;
      k.destroyAll("overlay");
      k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.anchor("topleft"), k.color(0, 0, 0), k.opacity(0.35), k.area(), k.fixed(), "overlay"]).onClick(closeOverlay);
      const items = authed ? [
        { label: "View Profile", go: () => k.go("profile", { backScene: "hub", backArgs: { characterId } }) },
        { label: "Account", go: () => k.go("account", { backScene: "hub", backArgs: { characterId } }) },
        { label: "Settings", go: () => k.go("settings", { characterId, backScene: "hub" }) },
        { label: "Switch Character", go: () => k.go("characterSelect") },
        { label: "Sign out", danger: true, go: () => { try { net.clearSession(); } catch { /* none */ } clearProfile(); k.go("start"); } },
      ] : [
        { label: "Settings", go: () => k.go("settings", { characterId, backScene: "hub" }) },
        { label: "Switch Character", go: () => k.go("characterSelect") },
        { label: "Log in", go: () => k.go("start") },
      ];
      const pwid = 200, rowH = 42, ph = items.length * rowH + 14;
      const pcx = k.width() - ins.right - 16 - pwid / 2;
      const ptop = (20 + 14 + ins.top) + 8; // just below the avatar badge (aY + aR + a small gap)
      addPanel(k, { x: pcx, y: ptop + ph / 2, w: pwid, h: ph, radius: 12, fixed: true, tag: "overlay" });
      items.forEach((it, i) => addButton(k, { x: pcx, y: ptop + 7 + rowH / 2 + i * rowH, w: pwid - 18, h: rowH - 6,
        text: it.label, size: 15, fill: THEME.surface, textColor: it.danger ? THEME.danger : THEME.text, fixed: true, tag: "overlay", onClick: it.go }));
    }

    // Invisible fixed click target over the avatar badge (immediate-mode draws can't receive clicks).
    {
      const aR = 20, aX = k.width() - aR - 16 - ins.right, aY = aR + 14 + ins.top;
      const hit = k.add([k.circle(aR + 2), k.pos(aX, aY), k.anchor("center"), k.opacity(0), k.area(), k.fixed()]);
      hit.onHover(() => k.setCursor("pointer"));
      hit.onHoverEnd(() => k.setCursor("default"));
      hit.onClick(() => openAcctMenu());
    }

    // ── Touch joystick + thumb interact button (drawn above the camp; wired below) ───────────────────
    const interactBtnPos = () => k.vec2(k.width() - IBTN_R - 22 - ins.right, k.height() - IBTN_R - 22 - ins.bottom);
    const joyRestPos = () => k.vec2(JOY_R + 24 + ins.left, k.height() - JOY_R - 24 - ins.bottom); // bottom-left hint
    function drawTouchControls() {
      if (joyId !== null) { // floating stick — shown wherever the thumb is while dragging
        k.drawCircle({ pos: joyBase, radius: JOY_R, color: k.rgb(...THEME.surface), opacity: 0.18, fixed: true });
        k.drawCircle({ pos: joyBase, radius: JOY_R, fill: false, outline: { width: 3, color: k.rgb(...THEME.line) }, opacity: 0.55, fixed: true });
        k.drawCircle({ pos: joyThumb, radius: 28, color: k.rgb(...accent), opacity: 0.7, fixed: true });
      } else if (TOUCH) { // discoverable rest hint at bottom-left (mirrors the in-run joystick)
        const r = joyRestPos();
        k.drawCircle({ pos: r, radius: JOY_R, fill: false, outline: { width: 2, color: k.rgb(...THEME.line) }, opacity: 0.28, fixed: true });
        k.drawCircle({ pos: r, radius: 22, color: k.rgb(...accent), opacity: 0.16, fixed: true });
      }
      if (TOUCH && near) { // thumb "USE" button (the touch equivalent of pressing E)
        const b = interactBtnPos();
        k.drawCircle({ pos: b, radius: IBTN_R + 4, color: k.rgb(...near.accent), opacity: 0.18, fixed: true }); // halo so it pops
        k.drawCircle({ pos: b, radius: IBTN_R, color: k.rgb(...THEME.bgAlt), opacity: 0.95, outline: { width: 2, color: k.rgb(...near.accent) }, fixed: true });
        k.drawText({ text: "USE", pos: b, anchor: "center", size: 16, font: FONT, color: k.rgb(...near.accent), fixed: true });
      }
    }
    function joyStart(id, p) {
      if (joyId !== null || overlayOpen) return;
      if (p.y < 96) return; // keep the top HUD (avatar / currency) tappable, not a movement start
      joyId = id;
      joyBase = k.vec2(Math.max(JOY_R, Math.min(k.width() - JOY_R, p.x)), Math.max(JOY_R, Math.min(k.height() - JOY_R, p.y)));
      joyThumb = joyBase; joyMove(id, p);
    }
    function joyMove(id, p) {
      if (id !== joyId) return;
      let d = p.sub(joyBase); const len = d.len() || 1;
      if (len > JOY_R) d = d.scale(JOY_R / len);
      joyThumb = joyBase.add(d); joyVec = { x: d.x / JOY_R, y: d.y / JOY_R };
    }
    function joyEnd(id) { if (id !== joyId) return; joyId = null; joyVec = { x: 0, y: 0 }; joyThumb = joyBase; }
    function pointerDown(id, p) {
      if (overlayOpen) return;
      if (TOUCH && near) { const b = interactBtnPos(); if (Math.hypot(p.x - b.x, p.y - b.y) <= IBTN_R) { interact(); return; } }
      joyStart(id, p);
    }
    k.onTouchStart((p, t) => pointerDown(t?.identifier ?? 0, p));
    k.onTouchMove((p, t) => joyMove(t?.identifier ?? 0, p));
    k.onTouchEnd((p, t) => joyEnd(t?.identifier ?? 0));
    if (!TOUCH) {
      // Desktop also drives the same stick with a mouse drag (clicks on the top HUD / open overlays are
      // excluded in joyStart/pointerDown), so the camp is walkable by drag as well as WASD.
      k.onMousePress(() => pointerDown("m", k.mousePos()));
      k.onMouseMove(() => { if (joyId === "m") joyMove("m", k.mousePos()); });
      k.onMouseRelease(() => joyEnd("m"));
    }

    // Esc toggles the account menu (and dismisses any open overlay first, via openAcctMenu's guard).
    k.onKeyPress("escape", () => openAcctMenu());
    k.onSceneLeave(() => { leaving = true; cancelConnectTimer(); clearNet(); offSession(); });
  });
}
