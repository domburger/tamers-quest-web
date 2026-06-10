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
import { drawPlayWindow, playWindowLayout } from "../render/playWindow.js";
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
// Floor: a CAVERN — a rounded central chamber with four ALCOVES recessed into the rock, one per
// station (cave N / vault S / healer W / merchant E). The void around this shape renders as the
// enclosing rock walls + abyss, so each facility sits in its own carved niche in the cave (not on a
// flat rectangle). The station positions below sit at the alcove ends.
const GRID = 24;
const CCX = 11.5, CCY = 9.5;                       // chamber centre (tiles) — the player spawns here
const TILE = (tx, ty) => ({ x: tx * E + E / 2, y: ty * E + E / 2 }); // tile centre → world px
// Walkable predicate: rounded chamber ∪ four rectangular alcoves toward each station.
function inCamp(tx, ty) {
  const ex = (tx - CCX) / 6.6, ey = (ty - CCY) / 4.9;
  if (ex * ex + ey * ey <= 1) return true;                            // central rounded chamber
  if (tx >= 9 && tx <= 14 && ty >= 3 && ty <= CCY) return true;       // N alcove (cave)
  if (tx >= 9 && tx <= 14 && ty >= CCY && ty <= 16) return true;      // S alcove (vault)
  if (tx >= 3 && tx <= CCX && ty >= 7 && ty <= 12) return true;       // W alcove (healer)
  if (tx >= CCX && tx <= 20 && ty >= 7 && ty <= 12) return true;      // E alcove (merchant)
  return false;
}

// A couple of hues the flat theme doesn't name (the structures' identity colours).
const HEAL = [120, 222, 150];  // healing green (the Healer's font + glow)
const WOOD = [124, 92, 60], WOOD_DK = [86, 62, 40], WOOD_LT = [158, 120, 82]; // stall timber tones
const STONE = [108, 112, 126], STONE_DK = [72, 76, 90], STONE_LT = [150, 154, 168]; // shrine / vault masonry
// Characters read as the FOCAL scale of the camp (user: the player was much too small vs the stations).
// The hero is drawn larger than in a run; each station keeper is scaled per-station at its draw call.
const PLAYER_SCALE = 1.6;

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
  for (let x = 0; x < GRID; x++) for (let y = 0; y < GRID; y++) {
    if (!inCamp(x, y)) continue;
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
    let merchantRoofA = 1;                // merchant-building roof alpha: 1 (from above) → ~0.1 inside (lerped each frame)
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
      drawCharacter(k, { x: me.x, y: me.y, t, moving, color: cos.accent, cloak: cos.cloak, model: cos.model, dir, skin: getEquippedSkin(), scale: PLAYER_SCALE });
      drawAtmosphere(k, { t }); // vignette + spirit glow + drifting motes — the same ambient as a run
      // SAME framing as a run (user request): the world shows ONLY inside a centred SQUARE; opaque
      // bezel bands occlude the rest, turning the periphery into the gutter that hosts the HUD.
      drawPlayWindow(k);
      drawHud();          // identity / currency / avatar / prompt — placed in the gutters (see hubHud)
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

      // Stone dais — a flagstone platform that grounds the floor shrines on the alcove floor. The
      // cave is wall-embedded and the merchant is a full building (own floor), so they get none.
      if (s.id === "healer" || s.id === "vault") {
        k.drawEllipse({ pos: k.vec2(s.x, s.y + 42), radiusX: 74, radiusY: 25, ...col(STONE_DK, 0.55) });
        k.drawEllipse({ pos: k.vec2(s.x, s.y + 40), radiusX: 67, radiusY: 22, ...col(STONE, 0.5) });
        for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; k.drawLine({ p1: k.vec2(s.x, s.y + 40), p2: k.vec2(s.x + Math.cos(a) * 64, s.y + 40 + Math.sin(a) * 21), width: 1.5, ...col(STONE_DK, 0.4) }); }
        k.drawEllipse({ pos: k.vec2(s.x, s.y + 40), radiusX: 67, radiusY: 22, fill: false, outline: { width: 2, color: k.rgb(...s.accent) }, opacity: 0.26 + 0.12 * pulse });
      }

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

    // CAVE ENTRANCE — a rocky bluff carved into the top wall: a carved stone arch (jamb blocks +
    // keystone) around a dark mouth, the real in-game spirit rift inside, flanking torches, embedded
    // teal crystals, and stalactites. The gateway to a run — no keeper, just the dungeon mouth.
    function drawCave(s, t) {
      const x = s.x, y = s.y;
      const rock = [50, 54, 68], rockDk = [32, 35, 46], rockLt = [80, 84, 100];
      const flick = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 7 + x);
      // Rocky bluff (layered ellipses for volume) the cave is set into.
      k.drawEllipse({ pos: k.vec2(x, y + 2), radiusX: 128, radiusY: 96, color: k.rgb(...rockDk) });
      k.drawEllipse({ pos: k.vec2(x, y - 8), radiusX: 110, radiusY: 82, color: k.rgb(...rock) });
      k.drawEllipse({ pos: k.vec2(x - 58, y - 38), radiusX: 30, radiusY: 22, color: k.rgb(...rockLt), opacity: 0.4 });
      k.drawEllipse({ pos: k.vec2(x + 60, y - 28), radiusX: 26, radiusY: 18, color: k.rgb(...rockDk), opacity: 0.8 });
      // Embedded glowing teal crystals.
      for (const [cx, cy, cr] of [[x - 50, y - 52, 4], [x + 44, y - 48, 5], [x - 14, y - 66, 3.5], [x + 18, y - 60, 3]]) {
        k.drawCircle({ pos: k.vec2(cx, cy), radius: cr + 4, color: k.rgb(...THEME.teal), opacity: 0.18 });
        k.drawEllipse({ pos: k.vec2(cx, cy), radiusX: cr * 0.7, radiusY: cr, color: k.rgb(...THEME.ice) });
      }
      // Carved stone arch (jamb blocks + a faint arch band + a keystone).
      k.drawRect({ pos: k.vec2(x - 64, y - 24), width: 16, height: 72, radius: 3, color: k.rgb(...rockLt), opacity: 0.5 });
      k.drawRect({ pos: k.vec2(x + 48, y - 24), width: 16, height: 72, radius: 3, color: k.rgb(...rockLt), opacity: 0.5 });
      k.drawEllipse({ pos: k.vec2(x, y - 26), radiusX: 62, radiusY: 30, color: k.rgb(...rockLt), opacity: 0.35 });
      k.drawRect({ pos: k.vec2(x - 9, y - 52), width: 18, height: 16, radius: 3, color: k.rgb(...rockLt), opacity: 0.6 });
      // The dark mouth + the spirit rift inside (reused overworld portal, always risen).
      k.drawEllipse({ pos: k.vec2(x, y + 14), radiusX: 50, radiusY: 62, color: k.rgb(6, 7, 10) });
      drawPortal(k, { x, y: y + 52, t, age: 999 });
      // Stalactites hanging from the arch top.
      for (const sx of [x - 24, x - 6, x + 12, x + 28]) k.drawEllipse({ pos: k.vec2(sx, y - 34), radiusX: 3, radiusY: 9, color: k.rgb(...rockDk) });
      // Flanking torches (post + flame + warm glow).
      for (const tx of [x - 62, x + 62]) {
        k.drawRect({ pos: k.vec2(tx - 2.5, y - 2), width: 5, height: 34, color: k.rgb(...rockDk) });
        k.drawCircle({ pos: k.vec2(tx, y - 8), radius: 13, color: k.rgb(255, 150, 70), opacity: 0.18 * flick });
        k.drawEllipse({ pos: k.vec2(tx, y - 9), radiusX: 4.5, radiusY: 9, color: k.rgb(255, 168, 78), opacity: 0.85 });
        k.drawEllipse({ pos: k.vec2(tx, y - 11), radiusX: 2.2, radiusY: 5.5, color: k.rgb(255, 232, 150), opacity: 0.9 });
      }
    }

    // ── Bespoke station keepers (NOT the player body-models — each is its own NPC). ──
    // A robed APOTHECARY CLERIC tending the font: hood, gentle halo, a glowing healing vial. Green.
    function drawClericKeeper(x, y, t) {
      const robe = [74, 102, 88], robeDk = [46, 66, 58], glow = HEAL;
      const bob = reduce ? 0 : Math.sin(t * 2) * 1.4, yy = y - bob;
      // Long robe + tattered hem.
      k.drawEllipse({ pos: k.vec2(x, yy + 16), radiusX: 21, radiusY: 30, color: k.rgb(...robe) });
      for (let i = -2; i <= 2; i++) k.drawRect({ pos: k.vec2(x + i * 7 - 3.5, yy + 38), width: 7, height: 7 + (i === 0 ? 4 : 0), radius: 1, color: k.rgb(...robeDk) });
      // Shoulders + rim light.
      k.drawEllipse({ pos: k.vec2(x, yy - 4), radiusX: 16, radiusY: 15, color: k.rgb(...robe) });
      k.drawEllipse({ pos: k.vec2(x - 11, yy - 2), radiusX: 3.5, radiusY: 10, color: k.rgb(...glow), opacity: 0.26 });
      // Pointed hood + shadowed face with soft eyes.
      k.drawEllipse({ pos: k.vec2(x, yy - 19), radiusX: 12, radiusY: 14, color: k.rgb(...robe) });
      k.drawEllipse({ pos: k.vec2(x, yy - 28), radiusX: 6.5, radiusY: 8, color: k.rgb(...robe) });
      k.drawEllipse({ pos: k.vec2(x, yy - 18), radiusX: 7.5, radiusY: 8.5, color: k.rgb(...robeDk) });
      k.drawCircle({ pos: k.vec2(x - 3, yy - 18), radius: 1.6, color: k.rgb(...glow) });
      k.drawCircle({ pos: k.vec2(x + 3, yy - 18), radius: 1.6, color: k.rgb(...glow) });
      // Floating halo.
      const hy = yy - 38 + (reduce ? 0 : Math.sin(t * 2) * 0.8);
      k.drawCircle({ pos: k.vec2(x, hy), radius: 7, fill: false, outline: { width: 2, color: k.rgb(...glow) }, opacity: 0.75 });
      // Glowing vial cradled in front.
      const vp = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 3);
      k.drawCircle({ pos: k.vec2(x + 13, yy + 8), radius: 9, color: k.rgb(...glow), opacity: 0.22 * vp });
      k.drawRect({ pos: k.vec2(x + 10, yy + 1), width: 6, height: 11, radius: 3, color: k.rgb(...glow), opacity: 0.92 });
      k.drawCircle({ pos: k.vec2(x + 13, yy + 9), radius: 4.5, color: k.rgb(...glow) });
      k.drawRect({ pos: k.vec2(x + 11.5, yy - 3), width: 3, height: 4, color: k.rgb(...STONE_LT) });
    }

    // A jolly, rotund TRADER: wide coat, a coin pouch on the belt, a warm face under a wide-brim hat. Amber.
    function drawTraderKeeper(x, y, t) {
      const coat = [152, 114, 74], coatDk = [104, 78, 50], skin = [212, 168, 120], amber = THEME.amber;
      const bob = reduce ? 0 : Math.sin(t * 1.8) * 1.1, yy = y - bob;
      // Rotund coat body + belt + coin pouch.
      k.drawEllipse({ pos: k.vec2(x, yy + 16), radiusX: 25, radiusY: 27, color: k.rgb(...coat) });
      k.drawRect({ pos: k.vec2(x - 22, yy + 17), width: 44, height: 6, color: k.rgb(...coatDk) });
      k.drawCircle({ pos: k.vec2(x + 16, yy + 22), radius: 6, color: k.rgb(...coatDk) });
      k.drawCircle({ pos: k.vec2(x + 16, yy + 22), radius: 3, color: k.rgb(...amber), opacity: 0.9 });
      // Stubby arms.
      k.drawEllipse({ pos: k.vec2(x - 19, yy + 6), radiusX: 7, radiusY: 12, color: k.rgb(...coat) });
      k.drawEllipse({ pos: k.vec2(x + 19, yy + 6), radiusX: 7, radiusY: 12, color: k.rgb(...coat) });
      // Chest/collar + rim.
      k.drawEllipse({ pos: k.vec2(x, yy - 4), radiusX: 17, radiusY: 13, color: k.rgb(...coat) });
      k.drawEllipse({ pos: k.vec2(x - 12, yy - 2), radiusX: 3.5, radiusY: 8, color: k.rgb(...amber), opacity: 0.25 });
      // Head + jolly eyes.
      k.drawCircle({ pos: k.vec2(x, yy - 16), radius: 9, color: k.rgb(...skin) });
      k.drawCircle({ pos: k.vec2(x - 3, yy - 17), radius: 1.5, color: k.rgb(44, 32, 30) });
      k.drawCircle({ pos: k.vec2(x + 3, yy - 17), radius: 1.5, color: k.rgb(44, 32, 30) });
      k.drawEllipse({ pos: k.vec2(x, yy - 12), radiusX: 3, radiusY: 1.4, color: k.rgb(150, 90, 80), opacity: 0.7 }); // smile
      // Wide-brim hat + band.
      k.drawEllipse({ pos: k.vec2(x, yy - 22), radiusX: 18, radiusY: 4.5, color: k.rgb(...coatDk) });
      k.drawEllipse({ pos: k.vec2(x, yy - 27), radiusX: 9, radiusY: 8, color: k.rgb(...coatDk) });
      k.drawRect({ pos: k.vec2(x - 9, yy - 23), width: 18, height: 2.5, color: k.rgb(...amber), opacity: 0.8 });
    }

    // A craggy STONE-GOLEM guardian (NOT the tech automaton): boulder torso with rune cracks, blocky
    // head with glowing rune eyes, heavy stubby arms. Violet runelight.
    function drawGolemKeeper(x, y, t) {
      const rock = [94, 88, 106], rockDk = [60, 56, 74], rockLt = [128, 122, 142], vio = THEME.violet;
      const pulse = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 2), yy = y;
      // Heavy stubby arms (behind the torso).
      k.drawEllipse({ pos: k.vec2(x - 27, yy + 8), radiusX: 9, radiusY: 14, color: k.rgb(...rockDk) });
      k.drawEllipse({ pos: k.vec2(x + 27, yy + 8), radiusX: 9, radiusY: 14, color: k.rgb(...rockDk) });
      // Boulder torso + facets.
      k.drawEllipse({ pos: k.vec2(x, yy + 8), radiusX: 29, radiusY: 29, color: k.rgb(...rock) });
      k.drawEllipse({ pos: k.vec2(x - 13, yy - 1), radiusX: 8, radiusY: 10, color: k.rgb(...rockLt), opacity: 0.4 });
      k.drawEllipse({ pos: k.vec2(x + 12, yy + 12), radiusX: 9, radiusY: 8, color: k.rgb(...rockDk), opacity: 0.6 });
      // Glowing rune crack down the chest.
      k.drawRect({ pos: k.vec2(x - 2, yy - 4), width: 4, height: 22, radius: 1, color: k.rgb(...vio), opacity: 0.3 + 0.25 * pulse });
      k.drawRect({ pos: k.vec2(x - 8, yy + 6), width: 12, height: 3, radius: 1, color: k.rgb(...vio), opacity: 0.25 + 0.2 * pulse });
      // Blocky head + lit top edge + rune eyes.
      k.drawRect({ pos: k.vec2(x - 13, yy - 32), width: 26, height: 22, radius: 5, color: k.rgb(...rock) });
      k.drawRect({ pos: k.vec2(x - 13, yy - 32), width: 26, height: 6, radius: 3, color: k.rgb(...rockLt), opacity: 0.4 });
      k.drawRect({ pos: k.vec2(x - 8.5, yy - 23), width: 6, height: 3.4, radius: 1, color: k.rgb(...vio), opacity: 0.5 + 0.4 * pulse });
      k.drawRect({ pos: k.vec2(x + 2.5, yy - 23), width: 6, height: 3.4, radius: 1, color: k.rgb(...vio), opacity: 0.5 + 0.4 * pulse });
    }

    // HEALER — a healing shrine WITH a healer tending it: a stone arch (glowing green cross in the
    // lintel, candle flames on the pillars) framing a winged, haloed healer, and a restorative FONT of
    // glowing water in front with motes rising from it.
    function drawHealer(s, t) {
      const x = s.x, y = s.y, glow = HEAL;
      const pulse = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 2.5);
      const flick = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 6 + x);
      // Stone shrine arch (two pillars + a lit lintel) behind the healer.
      k.drawRect({ pos: k.vec2(x - 58, y - 72), width: 15, height: 108, radius: 3, color: k.rgb(...STONE_DK) });
      k.drawRect({ pos: k.vec2(x + 43, y - 72), width: 15, height: 108, radius: 3, color: k.rgb(...STONE_DK) });
      k.drawRect({ pos: k.vec2(x - 51, y - 70), width: 5, height: 104, color: k.rgb(...STONE), opacity: 0.6 });
      k.drawRect({ pos: k.vec2(x + 50, y - 70), width: 5, height: 104, color: k.rgb(...STONE), opacity: 0.6 });
      k.drawRect({ pos: k.vec2(x - 60, y - 82), width: 120, height: 18, radius: 5, color: k.rgb(...STONE) });
      k.drawRect({ pos: k.vec2(x - 60, y - 82), width: 120, height: 5, radius: 3, color: k.rgb(...STONE_LT), opacity: 0.7 });
      // Glowing green cross set in the lintel.
      k.drawCircle({ pos: k.vec2(x, y - 73), radius: 10, color: k.rgb(...glow), opacity: 0.22 + 0.2 * pulse });
      k.drawRect({ pos: k.vec2(x - 2.5, y - 79), width: 5, height: 13, radius: 1, color: k.rgb(...glow) });
      k.drawRect({ pos: k.vec2(x - 6, y - 75.5), width: 12, height: 5, radius: 1, color: k.rgb(...glow) });
      // Candle flames on the pillar tops.
      for (const cx of [x - 50, x + 50]) {
        k.drawRect({ pos: k.vec2(cx - 2, y - 64), width: 4, height: 8, color: k.rgb(...STONE_LT) });
        k.drawCircle({ pos: k.vec2(cx, y - 68), radius: 4, color: k.rgb(255, 180, 90), opacity: 0.25 * flick });
        k.drawEllipse({ pos: k.vec2(cx, y - 67), radiusX: 1.8, radiusY: 3.2, color: k.rgb(255, 212, 132), opacity: 0.7 + 0.3 * flick });
      }
      // The HEALER — a bespoke apothecary cleric (drawn before the font so the font overlaps).
      drawClericKeeper(x, y - 4, t);
      // Restorative FONT in front: stone pedestal + bowl of glowing water + highlight + rising motes.
      k.drawEllipse({ pos: k.vec2(x, y + 46), radiusX: 36, radiusY: 12, color: k.rgb(0, 0, 0), opacity: 0.22 });
      k.drawRect({ pos: k.vec2(x - 17, y + 18), width: 34, height: 28, radius: 5, color: k.rgb(...STONE) });
      k.drawRect({ pos: k.vec2(x - 17, y + 18), width: 6, height: 28, color: k.rgb(...STONE_LT), opacity: 0.5 });
      k.drawEllipse({ pos: k.vec2(x, y + 16), radiusX: 32, radiusY: 13, color: k.rgb(...STONE_LT) });
      k.drawEllipse({ pos: k.vec2(x, y + 16), radiusX: 27, radiusY: 10, color: k.rgb(...STONE_DK) });
      k.drawEllipse({ pos: k.vec2(x, y + 15), radiusX: 25, radiusY: 8.5, color: k.rgb(...glow), opacity: 0.5 + 0.25 * pulse });
      k.drawEllipse({ pos: k.vec2(x - 4, y + 13), radiusX: 13, radiusY: 4, color: k.rgb(210, 255, 225), opacity: 0.35 * pulse });
      if (!reduce) for (let i = 0; i < 6; i++) {
        const f = (t * 0.45 + i * 0.17) % 1;
        k.drawCircle({ pos: k.vec2(x + Math.sin(t * 1.2 + i * 2) * 15, y + 12 - f * 46), radius: Math.max(0.4, (1 - f) * 2.4), color: k.rgb(...glow), opacity: 0.5 * (1 - f) });
      }
    }

    // A little corked potion bottle on the counter (body + round base + neck + cork + glint).
    function potion(px, py, c) {
      k.drawRect({ pos: k.vec2(px - 4, py - 3), width: 8, height: 11, radius: 3, color: k.rgb(...c), opacity: 0.92 });
      k.drawCircle({ pos: k.vec2(px, py + 5), radius: 5, color: k.rgb(...c), opacity: 0.92 });
      k.drawRect({ pos: k.vec2(px - 1.5, py - 8), width: 3, height: 5, color: k.rgb(...WOOD_LT) });
      k.drawRect({ pos: k.vec2(px - 2.5, py - 10), width: 5, height: 3, radius: 1, color: k.rgb(...WOOD_DK) });
      k.drawCircle({ pos: k.vec2(px - 1.5, py + 3), radius: 1.6, color: k.rgb(255, 255, 255), opacity: 0.4 });
    }

    // MERCHANT — a BUILDING (user 2026-06-11): from OUTSIDE you see it from above (an opaque tiled
    // roof + chimney + entrance awning + shop sign); when the player walks INSIDE the footprint the
    // roof fades to near-transparent, revealing the interior (plank floor, back-wall wares shelf, the
    // trader keeper, and the front counter). The roof alpha lerps smoothly (merchantRoofA).
    function drawMerchant(s, t) {
      const amber = THEME.amber, red = THEME.danger, x = s.x, y = s.y;
      const BW = 196, BH = 150, bx = x, by = y - 8;            // building footprint (visual only — no collision)
      const top = by - BH / 2, bot = by + BH / 2, lft = bx - BW / 2, rgt = bx + BW / 2;
      // Player inside the footprint → fade the roof very transparent (smooth lerp).
      const inside = Math.abs(me.x - bx) < BW / 2 - 4 && Math.abs(me.y - by) < BH / 2 - 4;
      merchantRoofA += ((inside ? 0.1 : 1) - merchantRoofA) * Math.min(1, k.dt() * 6);
      const ra = merchantRoofA;
      const roofWood = [124, 92, 60], roofDk2 = [96, 70, 44];

      // Footprint shadow.
      k.drawEllipse({ pos: k.vec2(x, bot + 6), radiusX: BW / 2 + 6, radiusY: 16, color: k.rgb(0, 0, 0), opacity: 0.22 });

      // ── INTERIOR (drawn first; the roof above hides it when opaque) ──
      k.drawRect({ pos: k.vec2(lft + 8, top + 16), width: BW - 16, height: BH - 24, radius: 6, color: k.rgb(46, 38, 32) });
      for (let i = 1; i < 6; i++) k.drawLine({ p1: k.vec2(lft + 8, top + 16 + i * (BH - 24) / 6), p2: k.vec2(rgt - 8, top + 16 + i * (BH - 24) / 6), width: 1, color: k.rgb(...WOOD_DK), opacity: 0.3 });
      k.drawRect({ pos: k.vec2(lft + 8, top + 16), width: BW - 16, height: BH - 24, radius: 6, fill: false, outline: { width: 4, color: k.rgb(...WOOD_DK) } });
      // Back-wall shelf of wares.
      k.drawRect({ pos: k.vec2(lft + 18, top + 22), width: BW - 36, height: 16, radius: 2, color: k.rgb(...WOOD) });
      const wares = [THEME.teal, THEME.violet, amber, THEME.ice, red, HEAL];
      for (let i = 0; i < 6; i++) potion(lft + 32 + i * ((BW - 64) / 5), top + 26, wares[i]);
      // The trader keeper.
      drawTraderKeeper(x, y - 2, t);
      // Front counter + lit lip + wares.
      k.drawRect({ pos: k.vec2(x - 58, y + 26), width: 116, height: 24, radius: 4, color: k.rgb(...WOOD) });
      for (let i = 1; i < 5; i++) k.drawLine({ p1: k.vec2(x - 58 + i * 23, y + 28), p2: k.vec2(x - 58 + i * 23, y + 50), width: 1.5, color: k.rgb(...WOOD_DK), opacity: 0.5 });
      k.drawRect({ pos: k.vec2(x - 60, y + 21), width: 120, height: 7, radius: 3, color: k.rgb(...WOOD_LT) });
      potion(x - 40, y + 18, THEME.teal); potion(x - 22, y + 18, THEME.violet);
      k.drawCircle({ pos: k.vec2(x + 8, y + 16), radius: 6, color: k.rgb(...THEME.ice) });

      // ── ROOF (opacity ra) — the building seen from above ──
      if (ra > 0.03) {
        // Eaves (overhang) base.
        k.drawRect({ pos: k.vec2(lft - 6, top + 6), width: BW + 12, height: BH - 4, radius: 9, color: k.rgb(...WOOD_DK), opacity: ra });
        // Two pitched halves meeting at the central ridge (lighter back / darker front).
        const midY = by - 6;
        k.drawRect({ pos: k.vec2(lft - 2, top + 8), width: BW + 4, height: midY - (top + 8), radius: 6, color: k.rgb(...roofWood), opacity: ra });
        k.drawRect({ pos: k.vec2(lft - 2, midY), width: BW + 4, height: (bot - 4) - midY, radius: 6, color: k.rgb(...roofDk2), opacity: ra });
        // Ridge highlight + tile rows.
        k.drawRect({ pos: k.vec2(lft - 2, midY - 2), width: BW + 4, height: 4, radius: 2, color: k.rgb(...WOOD_LT), opacity: 0.7 * ra });
        for (let i = 1; i < 4; i++) k.drawLine({ p1: k.vec2(lft, top + 8 + i * (midY - top - 8) / 4), p2: k.vec2(rgt, top + 8 + i * (midY - top - 8) / 4), width: 1.5, color: k.rgb(...WOOD_DK), opacity: 0.4 * ra });
        for (let i = 1; i < 4; i++) k.drawLine({ p1: k.vec2(lft, midY + i * (bot - 4 - midY) / 4), p2: k.vec2(rgt, midY + i * (bot - 4 - midY) / 4), width: 1.5, color: k.rgb(...WOOD_DK), opacity: 0.4 * ra });
        // Chimney (back-left) with a warm-lit cap.
        k.drawRect({ pos: k.vec2(lft + 18, top - 6), width: 16, height: 22, radius: 2, color: k.rgb(...STONE), opacity: ra });
        k.drawRect({ pos: k.vec2(lft + 16, top - 8), width: 20, height: 5, radius: 2, color: k.rgb(...STONE_DK), opacity: ra });
        // Striped entrance awning along the front edge + scalloped lip.
        for (let i = 0; i < 8; i++) k.drawRect({ pos: k.vec2(lft + 6 + i * ((BW - 12) / 8), bot - 6), width: (BW - 12) / 8, height: 14, color: k.rgb(...(i % 2 ? red : amber)), opacity: ra });
        for (let i = 0; i < 8; i++) k.drawCircle({ pos: k.vec2(lft + 6 + (BW - 12) / 16 + i * ((BW - 12) / 8), bot + 8), radius: (BW - 12) / 16, color: k.rgb(...(i % 2 ? red : amber)), opacity: ra });
        // Hanging shop sign (coin glyph) at the front-left.
        k.drawRect({ pos: k.vec2(lft + 2, bot + 2), width: 30, height: 18, radius: 3, color: k.rgb(...WOOD_LT), opacity: ra });
        k.drawCircle({ pos: k.vec2(lft + 17, bot + 11), radius: 6, color: k.rgb(...amber), opacity: ra });
        k.drawCircle({ pos: k.vec2(lft + 17, bot + 11), radius: 2.4, color: k.rgb(...WOOD_DK), opacity: 0.5 * ra });
      }
    }

    // VAULT — a big reinforced strongbox of stored spirits WITH a guardian: a mechanical sentinel
    // stands behind an OPEN vault whose interior glows with the team's spirit-orbs; gold bands + a
    // violet-lit lock, and coins + a gem spilling from the front.
    function drawVault(s, t) {
      const x = s.x, y = s.y, vio = THEME.violet, gold = THEME.amber;
      const steel = [98, 106, 122], steelDk = [62, 68, 82];
      const pulse = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 2.2);
      // The GUARDIAN — a bespoke craggy stone golem standing behind the open vault (drawn first).
      drawGolemKeeper(x, y - 6, t);
      // Open lid (raised lip) + a dark interior glowing with the stored team's spirit-orbs.
      k.drawRect({ pos: k.vec2(x - 54, y - 34), width: 108, height: 18, radius: 7, color: k.rgb(...steelDk) });
      k.drawEllipse({ pos: k.vec2(x, y - 16), radiusX: 48, radiusY: 11, color: k.rgb(9, 9, 15) });
      [[-30, THEME.teal], [-10, gold], [10, vio], [30, THEME.ice]].forEach(([ox, c]) => {
        k.drawCircle({ pos: k.vec2(x + ox, y - 16), radius: 7.5, color: k.rgb(...c), opacity: 0.3 });
        k.drawCircle({ pos: k.vec2(x + ox, y - 16), radius: 4.5, color: k.rgb(...c) });
      });
      // Strongbox body (front face) + a lit top edge.
      k.drawRect({ pos: k.vec2(x - 52, y - 6), width: 104, height: 52, radius: 8, color: k.rgb(...steel) });
      k.drawRect({ pos: k.vec2(x - 52, y - 6), width: 104, height: 9, radius: 6, color: k.rgb(...STONE_LT), opacity: 0.45 });
      // Gold bands + a big lock plate with a violet keyhole glow.
      k.drawRect({ pos: k.vec2(x - 30, y - 6), width: 8, height: 52, color: k.rgb(...gold), opacity: 0.85 });
      k.drawRect({ pos: k.vec2(x + 22, y - 6), width: 8, height: 52, color: k.rgb(...gold), opacity: 0.85 });
      k.drawRect({ pos: k.vec2(x - 14, y + 8), width: 28, height: 26, radius: 4, color: k.rgb(...gold) });
      k.drawCircle({ pos: k.vec2(x, y + 19), radius: 7, color: k.rgb(...vio), opacity: 0.25 + 0.25 * pulse });
      k.drawCircle({ pos: k.vec2(x, y + 19), radius: 3.5, color: k.rgb(...vio) });
      // Coins + a gem spilling from the front.
      for (let i = 0; i < 6; i++) k.drawEllipse({ pos: k.vec2(x - 44 + i * 6, y + 46), radiusX: 5, radiusY: 2.6, color: k.rgb(...gold) });
      k.drawEllipse({ pos: k.vec2(x + 40, y + 46), radiusX: 5, radiusY: 5, color: k.rgb(...THEME.teal), opacity: 0.9 });
    }

    // ── fixed HUD: camp name + the active station's interaction prompt ────────────────
    // Gutter HUD layout: where each cluster sits in the bezel AROUND the square play window. Mirrors
    // the in-run hudLayout philosophy (identity top-left, controls bottom, avatar top-right) and adapts
    // to landscape (gutters left/right) vs portrait (gutters top/bottom); near-square tucks on edges.
    function hubHud() {
      const W = k.width(), H = k.height();
      const lay = playWindowLayout(W, H);
      const sq = lay.square, pad = 12;
      const il = ins.left, ir = ins.right, it = ins.top, ib = ins.bottom;
      if (lay.landscape && sq.x >= 120) {
        const gRcx = sq.right + (W - sq.right) / 2;
        return { sq, avR: 20,
          idX: pad + il, idY: pad + it, curX: pad + il, curY: pad + it + 52, curAnchor: "topleft",
          avX: gRcx, avY: pad + it + 22,
          promptX: sq.x / 2, promptY: H - ib - 120, hintX: sq.x / 2, hintY: H - ib - 150,
          joyX: sq.x / 2, joyY: H - ib - 84, useX: gRcx, useY: H - ib - 84 };
      }
      if (lay.portrait && sq.y >= 100) {
        const bcy = sq.bottom + (H - sq.bottom) / 2;
        return { sq, avR: 20,
          idX: pad + il, idY: pad + it, curX: sq.cx, curY: pad + it + 6, curAnchor: "top",
          avX: W - pad - 22 - ir, avY: pad + it + 22,
          promptX: sq.cx, promptY: sq.bottom + 16, hintX: sq.cx, hintY: H - ib - 14,
          joyX: sq.x + 84 + il, joyY: bcy + 6, useX: W - ir - 56, useY: bcy + 6 };
      }
      // near-square aspect: tuck onto the square's own edges (graceful fallback).
      return { sq, avR: 20,
        idX: sq.x + pad, idY: sq.y + pad, curX: sq.cx, curY: sq.y + pad, curAnchor: "top",
        avX: sq.right - pad - 22, avY: sq.y + pad + 22,
        promptX: sq.cx, promptY: sq.bottom - 40, hintX: sq.cx, hintY: sq.bottom - 18,
        joyX: sq.x + 90, joyY: sq.bottom - 90, useX: sq.right - 70, useY: sq.bottom - 70 };
    }

    function drawHud() {
      const P = prof(), L = hubHud();
      // Identity (camp + name + level) — top of the first gutter.
      k.drawText({ text: "CAMP", pos: k.vec2(L.idX, L.idY), anchor: "topleft", size: 15, font: FONT, color: k.rgb(...THEME.textMut), fixed: true });
      k.drawText({ text: `${character.name}${character.isGuest ? "  (guest)" : ""}`, pos: k.vec2(L.idX, L.idY + 20), anchor: "topleft", size: 13, font: FONT, color: k.rgb(...THEME.textBody), fixed: true });
      k.drawText({ text: `Lv ${character.level}`, pos: k.vec2(L.idX, L.idY + 37), anchor: "topleft", size: 12, font: FONT, color: k.rgb(...THEME.textMut), fixed: true });
      // Currencies (gold amber / essence teal) — stacked under identity (landscape) or centred (portrait).
      k.drawText({ text: `${P.gold || 0} gold`, pos: k.vec2(L.curX, L.curY), anchor: L.curAnchor, size: 14, font: FONT, color: k.rgb(...THEME.amber), fixed: true });
      k.drawText({ text: `${P.essence || 0} essence`, pos: k.vec2(L.curX, L.curY + 18), anchor: L.curAnchor, size: 14, font: FONT, color: k.rgb(...THEME.teal), fixed: true });
      // Account avatar badge (clicks are hit-tested in pointerDown against this same position).
      k.drawCircle({ pos: k.vec2(L.avX, L.avY), radius: L.avR, color: k.rgb(...(authed ? accent : THEME.surfaceAlt)),
        outline: { width: 2, color: k.rgb(...(authed ? accent : THEME.line)) }, fixed: true });
      k.drawText({ text: acctInitial, pos: k.vec2(L.avX, L.avY + 1), anchor: "center", size: 18, font: FONT, color: k.rgb(...(authed ? THEME.bg : THEME.textMut)), fixed: true });
      // Interaction prompt / movement hint — in the bottom (or bottom-of-left) gutter.
      if (near) {
        const txt = TOUCH ? near.hint : `Press  E  —  ${near.hint}`;
        const w = txt.length * 9 + 28;
        k.drawRect({ pos: k.vec2(L.promptX - w / 2, L.promptY - 16), width: w, height: 32, radius: 9, color: k.rgb(...THEME.bgAlt), opacity: 0.92, outline: { width: 2, color: k.rgb(...near.accent) }, fixed: true });
        k.drawText({ text: txt, pos: k.vec2(L.promptX, L.promptY), anchor: "center", size: 15, font: FONT, color: k.rgb(...THEME.text), fixed: true });
      } else {
        k.drawText({ text: TOUCH ? "drag to move" : "WASD / arrows to move", pos: k.vec2(L.hintX, L.hintY), anchor: "center", size: 12, font: FONT, color: k.rgb(...THEME.textMut), opacity: 0.8, fixed: true });
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
      // The secondary facilities the old menu-lobby had as stations but the camp doesn't: Bestiary
      // (collection), Cosmetics (skins) and Base Upgrades (gold meta-upgrades). Routed here so they
      // stay reachable now that the camp is the ONLY lobby (otherwise they'd be dead). All return here.
      const more = [
        { label: "Bestiary", go: () => k.go("bestiary", { backScene: "hub", backArgs: { characterId }, characterId }) },
        { label: "Cosmetics", go: () => k.go("cosmetics", { backScene: "hub", backArgs: { characterId } }) },
        { label: "Base Upgrades", go: () => k.go("onlineBaseUpgrades", { characterId, backScene: "hub", backArgs: { characterId } }) },
      ];
      const items = authed ? [
        { label: "View Profile", go: () => k.go("profile", { backScene: "hub", backArgs: { characterId } }) },
        ...more,
        { label: "Account", go: () => k.go("account", { backScene: "hub", backArgs: { characterId } }) },
        { label: "Settings", go: () => k.go("settings", { characterId, backScene: "hub" }) },
        { label: "Switch Character", go: () => k.go("characterSelect") },
        { label: "Sign out", danger: true, go: () => { try { net.clearSession(); } catch { /* none */ } clearProfile(); k.go("start"); } },
      ] : [
        ...more,
        { label: "Settings", go: () => k.go("settings", { characterId, backScene: "hub" }) },
        { label: "Switch Character", go: () => k.go("characterSelect") },
        { label: "Log in", go: () => k.go("start") },
      ];
      const pwid = 204, rowH = 40, ph = items.length * rowH + 14;
      const L = hubHud();
      // Drop the panel from the avatar badge wherever it sits in the gutter, clamped on-screen.
      const pcx = Math.max(pwid / 2 + 8, Math.min(L.avX, k.width() - ins.right - 8 - pwid / 2));
      const ptop = Math.max(8, Math.min(L.avY + L.avR + 8, k.height() - ph - 8));
      addPanel(k, { x: pcx, y: ptop + ph / 2, w: pwid, h: ph, radius: 12, fixed: true, tag: "overlay" });
      items.forEach((it, i) => addButton(k, { x: pcx, y: ptop + 7 + rowH / 2 + i * rowH, w: pwid - 18, h: rowH - 6,
        text: it.label, size: 15, fill: THEME.surface, textColor: it.danger ? THEME.danger : THEME.text, fixed: true, tag: "overlay", onClick: it.go }));
    }

    // ── Touch joystick + thumb interact button — gutter-positioned via hubHud. The avatar badge is
    //    hit-tested in pointerDown (immediate-mode draws can't receive clicks, and its gutter position
    //    moves with orientation/resize, so a fixed k.add area would drift). ─────────────────────────────
    const interactBtnPos = () => { const L = hubHud(); return k.vec2(L.useX, L.useY); };
    const joyRestPos = () => { const L = hubHud(); return k.vec2(L.joyX, L.joyY); };
    const avatarHit = (p) => { const L = hubHud(); return Math.hypot(p.x - L.avX, p.y - L.avY) <= L.avR + 5; };
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
      if (avatarHit(p)) { openAcctMenu(); return; } // tap the account badge → dropdown (it's gutter-positioned)
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

    // DEV-only QA hook: drop the player at a world point (headless frame-timing makes walking to a
    // specific station unreliable). Stripped from the production bundle (import.meta.env.DEV).
    if (import.meta.env && import.meta.env.DEV) {
      try { window.__hubTele = (sx, sy) => { me.x = sx; me.y = sy; }; } catch { /* no window */ }
    }

    k.onSceneLeave(() => { leaving = true; cancelConnectTimer(); clearNet(); offSession(); });
  });
}
