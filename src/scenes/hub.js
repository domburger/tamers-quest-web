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

// The camp is a small VILLAGE in a forest clearing (user vision): an open walkable green ringed by
// DENSE TREES (the natural boundary — no black void), with reusable houses for the facilities. The
// whole visible ground is forest-floor tiles (render/tiles.js draws it continuously); collision is a
// custom walkable() — the tree ring + each house footprint block movement, the clearing stays open.
// Rendered with the same camera-follow + atmosphere + SQUARE play-window framing as a run.
const E = GAME.EFFECTIVE_TILE;   // 80 — world px per tile
const SPEED = GAME.BASE_SPEED;   // 200 px/s
const PR = GAME.PLAYER_RADIUS;   // 13 — body half-width
const REACH = 116;               // interaction radius — how close you stand to a building to use it
const GRID = 30;
const VCX = 15, VCY = 13.5;                // village centre (tiles) — the player spawns here
const TILE = (tx, ty) => ({ x: tx * E + E / 2, y: ty * E + E / 2 }); // tile centre → world px
// The clearing is an organic UNION of lobes — a central plaza + a bay bulging toward each building
// cluster — NOT one plain ellipse, so the village reads as carved out of the forest rather than a
// circle (user 2026-06-11). Each lobe is [centreX, centreY, radX, radY] in tiles.
const LOBES = [
  [15.0, 13.5, 9.6, 7.0],   // central plaza
  [15.0, 6.6, 5.8, 4.8],    // N  bay — cave portal
  [20.0, 10.0, 5.8, 5.4],   // E  bay — merchant
  [8.6, 11.0, 5.4, 5.4],    // W  bay — healer
  [20.4, 17.5, 5.8, 5.4],   // SE bay — vault
  [10.2, 18.0, 5.4, 5.0],   // SW bay — house
];
// Squared-distance to the NEAREST lobe: <1 inside ANY lobe (the green), ~1 on the tree ring, >1 forest.
const ellip = (cx, cy) => {
  let m = Infinity;
  for (let i = 0; i < LOBES.length; i++) {
    const L = LOBES[i], a = (cx - L[0]) / L[2], b = (cy - L[1]) / L[3], v = a * a + b * b;
    if (v < m) m = v;
  }
  return m;
};
// Deterministic [0,1) hash so the trees are STABLE across frames + visits (not Math.random shimmer).
function hash(x, y, k = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(k | 0, 1442695040)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// A couple of hues the flat theme doesn't name (the structures' identity colours).
const HEAL = [120, 222, 150];  // healing green (the Healer's cross + glow)
const WOOD = [124, 92, 60], WOOD_DK = [86, 62, 40], WOOD_LT = [158, 120, 82]; // timber tones
const STONE = [108, 112, 126], STONE_DK = [72, 76, 90], STONE_LT = [150, 154, 168]; // masonry tones
const LEAF = [58, 104, 60], LEAF_DK = [38, 74, 44], LEAF_LT = [86, 140, 78], BARK = [74, 58, 44]; // foliage
const PATH = [128, 110, 82], PATH_LT = [150, 132, 102], PATH_DK = [98, 84, 62]; // trodden dirt road tones
// Characters read as the FOCAL scale (user: the hero was much too small vs the buildings).
const PLAYER_SCALE = 1.6;

// Fill the WHOLE grid with one forest-floor tile so drawTiles renders continuous ground (no abyss);
// the village green vs forest read comes from a drawn clearing overlay + the tree density, and
// collision is the custom walkable() below — not the tile void map (which we leave all-true).
function buildCampMap() {
  const tiles = getGroundTiles() || [];
  const grass = tiles.find((t) => /forest|plains|swamp|mushroom|jungle/i.test(t.biome || "") && !t.collidable)
    || tiles.find((t) => !t.collidable)
    || { colorProfile_full_r: 54, colorProfile_full_g: 74, colorProfile_full_b: 52,
         colorProfile_top_r: 54, colorProfile_top_g: 74, colorProfile_top_b: 52,
         colorProfile_bottom_r: 46, colorProfile_bottom_g: 64, colorProfile_bottom_b: 46,
         colorProfile_left_r: 50, colorProfile_left_g: 69, colorProfile_left_b: 49,
         colorProfile_right_r: 50, colorProfile_right_g: 69, colorProfile_right_b: 49, collidable: 0 };
  const voidMap = [], tileMap = [];
  for (let x = 0; x < GRID; x++) {
    voidMap[x] = new Array(GRID).fill(true);
    tileMap[x] = new Array(GRID).fill(null);
    for (let y = 0; y < GRID; y++) tileMap[x][y] = { ...grass, rotation: 0, activeMonster: null };
  }
  return { voidMap, tileMap, mapSize: GRID };
}

// Deterministic tree field: very sparse deep in the clearing, a DENSE ring on the clearing edge (the
// boundary), and a filled forest beyond. Each tree blocks movement (a small base radius).
function buildTrees() {
  const trees = [];
  for (let tx = -1; tx <= GRID; tx++) for (let ty = -1; ty <= GRID; ty++) {
    const cx = tx + 0.5, cy = ty + 0.5, e = ellip(cx, cy);
    // Trees ONLY at/beyond the clearing boundary so none sit in the walkable green (no walk-through):
    // a dense ring on the edge fading into the forest (user: trees AROUND the village).
    const p = e < 1.05 ? 0 : e < 1.35 ? 0.85 : 0.6;
    if (hash(tx, ty) >= p) continue;
    const jx = (hash(tx, ty, 1) - 0.5) * 0.5, jy = (hash(tx, ty, 2) - 0.5) * 0.5;
    trees.push({ x: (cx + jx) * E, y: (cy + jy) * E, kind: Math.floor(hash(tx, ty, 3) * 3), s: 0.9 + hash(tx, ty, 4) * 0.6 });
  }
  return trees;
}

export default function hubScene(k) {
  k.scene("hub", ({ characterId } = {}) => {
    const character = getCharacter(characterId);
    if (!character) { k.go("characterSelect"); return; }

    // The forest-floor map + sprite cache + the stable tree field (the village's leafy boundary).
    const campMap = buildCampMap();
    const tileCache = makeTileCache();
    const trees = buildTrees();

    // ── The VILLAGE: TOP-DOWN buildings (you see the roof from above) clustered in the clearing, plus a
    //    dungeon CAVE PORTAL at the treeline. `w`×`h` is the roof footprint AND the collision hitbox —
    //    you walk AROUND buildings. Approaching a building fades its roof open (roofA, lerped in
    //    onUpdate) to reveal the interior + keeper. Bigger than before (user request). ────────────────
    const buildings = [
      { id: "cave",     kind: "cave",  ...TILE(15, 5.6),    w: 300, h: 150, accent: THEME.teal,   label: "CAVE PORTAL",   hint: "start a run",      rdy: 8,  act: () => openPlay() },
      { id: "merchant", kind: "house", design: 0, ...TILE(20, 9.5),    w: 300, h: 224, accent: THEME.amber,  label: "MERCHANT", hint: "spirit shop",      keeper: (x, y, t) => drawTraderKeeper(x, y, t), act: () => k.go("onlineShop", { characterId, backScene: "hub", backArgs: { characterId } }) },
      { id: "healer",   kind: "house", design: 2, ...TILE(8.5, 10),    w: 256, h: 196, accent: HEAL,         label: "HEALER",   hint: "heal your team",   keeper: (x, y, t) => drawClericKeeper(x, y, t), act: () => healNow() },
      { id: "vault",    kind: "house", design: 1, ...TILE(20.5, 17.5), w: 256, h: 196, accent: THEME.violet, label: "VAULT",    hint: "team & inventory", keeper: (x, y, t) => drawGolemKeeper(x, y, t), act: () => k.go("roster", { characterId, backScene: "hub", backArgs: { characterId } }) },
      { id: "g1",       kind: "house", design: 3, ...TILE(9, 17.5),    w: 224, h: 176 },
      { id: "g2",       kind: "house", design: 0, ...TILE(14.8, 20),   w: 224, h: 176 },
    ];
    buildings.forEach((b) => { b.roofA = 1; });
    const stations = buildings.filter((b) => b.act); // the interactable subset (proximity + prompt + act)

    // ── Village DECOR: deliberate props that make the clearing feel lived-in — a central WELL focal
    //    point, lit LANTERN posts along the paths, a SIGNPOST by spawn, and stock (barrels/crates/
    //    planters) by the shops. Each is y-sorted with the buildings + has a small collision circle so
    //    you walk around it (see walkable()). Flowers/grass are flat scatter (drawGroundScatter). ──────
    const decor = [
      { kind: "well",    ...TILE(15, 11.6),   r: 26 },
      { kind: "sign",    ...TILE(12.9, 14.6), r: 7 },
      { kind: "lantern", ...TILE(11.4, 12.0), r: 6 },
      { kind: "lantern", ...TILE(18.6, 12.0), r: 6 },
      { kind: "lantern", ...TILE(12.6, 16.8), r: 6 },
      { kind: "lantern", ...TILE(17.6, 16.6), r: 6 },
      { kind: "barrel",  ...TILE(22.1, 8.9),  r: 9 },  // merchant stock
      { kind: "crate",   ...TILE(22.4, 10.1), r: 10 },
      { kind: "planter", ...TILE(6.9, 9.4),   r: 11 }, // healer herb garden
      { kind: "planter", ...TILE(6.9, 11.0),  r: 11 },
      { kind: "barrel",  ...TILE(22.6, 19.0), r: 9 },  // vault crates
      { kind: "crate",   ...TILE(22.4, 17.6), r: 10 },
    ];
    // The building footprint = its roof rect; it is the collision hitbox (you walk AROUND it). The cave
    // portal blocks only a thin back arc (you approach the mouth), handled in walkable().
    const footRect = (b) => ({ x0: b.x - b.w / 2, x1: b.x + b.w / 2, y0: b.y - b.h / 2, y1: b.y + b.h / 2 });
    // Walkable = inside the clearing (the tree ring blocks beyond it) AND not inside a building footprint
    // (you walk AROUND houses). The cave portal blocks only its UPPER rock half, so you can step up to
    // the glowing mouth from below.
    function walkable(x, y) {
      if (ellip(x / E, y / E) > 1.05) return false;
      for (const b of buildings) {
        const r = footRect(b);
        if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) {
          if (b.kind === "cave") { if (y < b.y - 6) return false; } // upper rock blocks; mouth (lower) is open
          else return false;
        }
      }
      // Decor props (well / lanterns / sign / stock) are small solids — walk around them.
      for (const d of decor) { const dx = x - d.x, dy = y - d.y, rr = d.r + 2; if (dx * dx + dy * dy < rr * rr) return false; }
      return true;
    }

    // Player state. Spawn in the central plaza, facing up.
    const me = { ...TILE(15, 13.5) };
    let dir = { x: 0, y: -1 };
    let moving = false;
    let near = null;                      // the building currently in reach (or null)
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
        // Axis-separated collision against walkable() — slide along the tree ring + house walls.
        const nx = me.x + dx * step, ny = me.y + dy * step;
        if (walkable(nx + Math.sign(dx) * PR, me.y)) me.x = nx;
        if (walkable(me.x, ny + Math.sign(dy) * PR)) me.y = ny;
      }
      // Nearest interactable building within reach — measured to its FRONT (where you stand), since the
      // footprints are large: the door edge (b.y + h/2) for houses, the mouth for the cave.
      near = null; let best = REACH * REACH;
      for (const s of stations) {
        const fy = s.y + (s.kind === "cave" ? 44 : s.h / 2);
        const ddx = s.x - me.x, ddy = fy - me.y, d2 = ddx * ddx + ddy * ddy;
        if (d2 < best) { best = d2; near = s; }
      }
      // Each house's roof fades open as you walk up to its front (a soft "step inside" reveal).
      for (const b of buildings) if (b.kind === "house") b.roofA += (((near === b) ? 0.12 : 1) - b.roofA) * Math.min(1, k.dt() * 6);
      // Camera follows the player (1×, like the overworld); the forest + trees fill the screen edges.
      k.camPos(me.x, me.y);
    });

    // Interact: walk up to a station and press E / Enter / Space to use it.
    function interact() { if (!overlayOpen && near) near.act(); }
    k.onKeyPress("e", interact);
    k.onKeyPress("enter", interact);
    k.onKeyPress("space", interact);

    // ── render the VILLAGE: forest floor → clearing → y-sorted trees/houses/player → labels → HUD ──
    k.onDraw(() => {
      if (overlayOpen) return; // a modal is up; skip the world so the dim backdrop shows
      const t = k.time();
      drawTiles(k, campMap, me.x, me.y, tileCache, E); // continuous forest floor (no abyss)
      drawClearing();                                   // lift the village green + a worn plaza
      drawPaths();                                       // dirt paths plaza → each building
      drawGroundScatter(t);                              // flat flowers + grass tufts + path pebbles
      // Depth: trees (culled to view) + buildings + decor + player, sorted by base-y, drawn back→front.
      const cullX = k.width() / 2 + 100, cullY = k.height() / 2 + 150;
      const props = [];
      for (const tr of trees) if (Math.abs(tr.x - me.x) <= cullX && Math.abs(tr.y - me.y) <= cullY) props.push({ y: tr.y, d: () => drawTree(tr, t) });
      for (const d of decor) props.push({ y: d.y, d: () => drawDecor(d, t) });
      for (const b of buildings) props.push({ y: b.y, d: () => drawBuilding(b, t) });
      props.push({ y: me.y, d: () => drawCharacter(k, { x: me.x, y: me.y, t, moving, color: cos.accent, cloak: cos.cloak, model: cos.model, dir, skin: getEquippedSkin(), scale: PLAYER_SCALE }) });
      props.sort((a, b) => a.y - b.y);
      for (const p of props) p.d();
      drawLabels(t);             // building name plates + the active ring / E bubble, over the props
      drawAtmosphere(k, { t });  // same vignette + glow + motes ambient as a run
      drawPlayWindow(k);         // crop to the centred square; the HUD lives in the gutters
      drawHud();
      drawTouchControls();
    });

    // The village green: a warmer lifted clearing over the forest floor + a trodden dirt plaza, so the
    // open village reads distinct from the darker tree-filled forest around it.
    function drawClearing() {
      // Lifted green over each lobe (overlaps read as a greener, well-trodden centre — organic), then
      // a dirt plaza at the very centre. Matches the lobed walkable shape so the green isn't a circle.
      for (let i = 0; i < LOBES.length; i++) {
        const L = LOBES[i];
        k.drawEllipse({ pos: k.vec2(L[0] * E, L[1] * E), radiusX: L[2] * E * 1.02, radiusY: L[3] * E * 1.02, color: k.rgb(98, 134, 86), opacity: 0.13 });
      }
      k.drawEllipse({ pos: k.vec2(VCX * E, VCY * E + 12), radiusX: 5.4 * E, radiusY: 3.3 * E, color: k.rgb(122, 106, 80), opacity: 0.16 });
    }

    // Worn DIRT PATHS plaza → every building front: a tapered ribbon of dirt ellipses. Flat (under
    // the props) so trees/buildings/the player draw on top.
    function drawPaths() {
      const px = VCX * E, py = VCY * E, dirt = [120, 102, 76];
      for (const b of buildings) {
        const fy = b.y + (b.kind === "cave" ? 34 : b.h / 2 - 8);
        const n = 16;
        for (let i = 0; i <= n; i++) {
          const f = i / n, x = px + (b.x - px) * f, y = py + (fy - py) * f, w = 19 - 5 * f;
          k.drawEllipse({ pos: k.vec2(x, y), radiusX: w, radiusY: w * 0.7, color: k.rgb(...dirt), opacity: 0.4 });
        }
      }
    }

    // Flat ground scatter — deterministic flowers + grass tufts in the green (hash-stable, culled to
    // view). Cheap per-frame; adds life without z-sorting (they're tiny + flat).
    const FLOWERS = [[235, 120, 150], [240, 222, 120], [176, 152, 240], [238, 240, 250]];
    function drawGroundScatter(t) {
      const vx = k.width() / 2 + 70, vy = k.height() / 2 + 70;
      for (let tx = 2; tx < GRID - 1; tx++) for (let ty = 2; ty < GRID - 1; ty++) {
        const wx = (tx + 0.5) * E, wy = (ty + 0.5) * E;
        if (Math.abs(wx - me.x) > vx || Math.abs(wy - me.y) > vy) continue;
        if (ellip(tx + 0.5, ty + 0.5) > 0.98) continue; // only on the green
        const h0 = hash(tx, ty, 7);
        if (h0 > 0.46) continue;
        const gx = wx + (hash(tx, ty, 8) - 0.5) * 58, gy = wy + (hash(tx, ty, 9) - 0.5) * 58;
        if (h0 < 0.32) { // grass tuft
          for (let i = -1; i <= 1; i++) k.drawLine({ p1: k.vec2(gx + i * 3, gy), p2: k.vec2(gx + i * 4, gy - 7 - (i === 0 ? 3 : 0)), width: 2, color: k.rgb(...LEAF_LT), opacity: 0.5 });
        } else { // flower
          const c = FLOWERS[Math.floor(hash(tx, ty, 10) * FLOWERS.length)];
          k.drawLine({ p1: k.vec2(gx, gy), p2: k.vec2(gx, gy - 6), width: 1.5, color: k.rgb(...LEAF), opacity: 0.6 });
          k.drawCircle({ pos: k.vec2(gx, gy - 7), radius: 2.6, color: k.rgb(...c), opacity: 0.85 });
          k.drawCircle({ pos: k.vec2(gx, gy - 7), radius: 1, color: k.rgb(245, 235, 150), opacity: 0.9 });
        }
      }
    }

    // ── Village decor props (y-sorted with buildings; collision in walkable). ──
    function drawDecor(d, t) {
      if (d.kind === "well") drawWell(d.x, d.y, t);
      else if (d.kind === "lantern") drawLantern(d.x, d.y, t);
      else if (d.kind === "sign") drawSignpost(d.x, d.y);
      else if (d.kind === "barrel") drawBarrelProp(d.x, d.y);
      else if (d.kind === "crate") drawCrateProp(d.x, d.y);
      else if (d.kind === "planter") drawPlanter(d.x, d.y, t);
    }
    // A stone WELL with an A-frame roof + hanging bucket — the village focal point.
    function drawWell(x, y, t) {
      k.drawEllipse({ pos: k.vec2(x, y + 10), radiusX: 30, radiusY: 12, color: k.rgb(0, 0, 0), opacity: 0.22 });
      k.drawEllipse({ pos: k.vec2(x, y), radiusX: 28, radiusY: 18, color: k.rgb(...STONE_DK) });
      k.drawEllipse({ pos: k.vec2(x, y - 2), radiusX: 26, radiusY: 16, color: k.rgb(...STONE) });
      k.drawEllipse({ pos: k.vec2(x, y - 2), radiusX: 18, radiusY: 11, color: k.rgb(18, 38, 54) });
      k.drawEllipse({ pos: k.vec2(x, y - 3), radiusX: 14, radiusY: 8, color: k.rgb(...THEME.water), opacity: 0.38 });
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; k.drawCircle({ pos: k.vec2(x + Math.cos(a) * 24, y - 2 + Math.sin(a) * 15), radius: 3.6, color: k.rgb(...STONE_LT), opacity: 0.5 }); }
      k.drawRect({ pos: k.vec2(x - 22, y - 46), width: 5, height: 48, color: k.rgb(...WOOD_DK) });
      k.drawRect({ pos: k.vec2(x + 17, y - 46), width: 5, height: 48, color: k.rgb(...WOOD_DK) });
      k.drawRect({ pos: k.vec2(x - 31, y - 54), width: 62, height: 13, radius: 3, color: k.rgb(...WOOD) });
      k.drawRect({ pos: k.vec2(x - 31, y - 54), width: 62, height: 4, radius: 2, color: k.rgb(...WOOD_LT), opacity: 0.6 });
      k.drawLine({ p1: k.vec2(x, y - 49), p2: k.vec2(x, y - 13), width: 1.5, color: k.rgb(...WOOD_DK) });
      k.drawRect({ pos: k.vec2(x - 5, y - 16), width: 10, height: 9, radius: 2, color: k.rgb(...WOOD) });
      k.drawRect({ pos: k.vec2(x - 5, y - 16), width: 10, height: 2.5, color: k.rgb(...WOOD_LT), opacity: 0.6 });
    }
    // A LANTERN post — warm flickering light + a soft glow disc on the path (the village's night-light).
    function drawLantern(x, y, t) {
      const flick = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 6 + x * 0.1);
      k.drawCircle({ pos: k.vec2(x, y - 2), radius: 30, color: k.rgb(255, 198, 110), opacity: 0.10 * flick }); // ground glow
      k.drawEllipse({ pos: k.vec2(x, y + 4), radiusX: 7, radiusY: 3, color: k.rgb(0, 0, 0), opacity: 0.2 });
      k.drawRect({ pos: k.vec2(x - 2.5, y - 46), width: 5, height: 50, radius: 2, color: k.rgb(...WOOD_DK) });
      k.drawRect({ pos: k.vec2(x - 9, y - 48), width: 14, height: 4, radius: 2, color: k.rgb(...WOOD_DK) });
      k.drawCircle({ pos: k.vec2(x + 8, y - 44), radius: 11, color: k.rgb(255, 196, 110), opacity: 0.18 * flick });
      k.drawRect({ pos: k.vec2(x + 3, y - 51), width: 11, height: 15, radius: 3, color: k.rgb(...WOOD) });
      k.drawRect({ pos: k.vec2(x + 4.5, y - 49), width: 8, height: 11, radius: 2, color: k.rgb(255, 212, 132), opacity: 0.5 + 0.45 * flick });
    }
    // A wooden SIGNPOST with direction boards (accent dots = teal cave / amber merchant / green healer).
    function drawSignpost(x, y) {
      k.drawEllipse({ pos: k.vec2(x, y + 3), radiusX: 7, radiusY: 3, color: k.rgb(0, 0, 0), opacity: 0.2 });
      k.drawRect({ pos: k.vec2(x - 3, y - 42), width: 6, height: 46, radius: 2, color: k.rgb(...WOOD_DK) });
      const boards = [[-24, -36, 1, THEME.teal], [8, -24, 1, THEME.amber], [-22, -12, -1, HEAL]];
      for (const [bx, by, fl, c] of boards) {
        k.drawRect({ pos: k.vec2(x + bx, y + by), width: 26, height: 9, radius: 2, color: k.rgb(...WOOD) });
        k.drawRect({ pos: k.vec2(x + bx, y + by), width: 26, height: 9, fill: false, outline: { width: 1.2, color: k.rgb(...WOOD_DK) } });
        k.drawCircle({ pos: k.vec2(x + bx + (fl > 0 ? 22 : 4), y + by + 4.5), radius: 2, color: k.rgb(...c), opacity: 0.85 });
      }
    }
    function drawBarrelProp(x, y) {
      k.drawEllipse({ pos: k.vec2(x, y + 8), radiusX: 12, radiusY: 4, color: k.rgb(0, 0, 0), opacity: 0.2 });
      k.drawRect({ pos: k.vec2(x - 10, y - 18), width: 20, height: 26, radius: 7, color: k.rgb(...WOOD) });
      k.drawEllipse({ pos: k.vec2(x, y - 18), radiusX: 10, radiusY: 4, color: k.rgb(...WOOD_LT) });
      k.drawRect({ pos: k.vec2(x - 10, y - 10), width: 20, height: 3, color: k.rgb(...WOOD_DK) });
      k.drawRect({ pos: k.vec2(x - 10, y + 0), width: 20, height: 3, color: k.rgb(...WOOD_DK) });
    }
    function drawCrateProp(x, y) {
      k.drawEllipse({ pos: k.vec2(x, y + 8), radiusX: 13, radiusY: 4, color: k.rgb(0, 0, 0), opacity: 0.2 });
      k.drawRect({ pos: k.vec2(x - 12, y - 20), width: 24, height: 28, radius: 3, color: k.rgb(...WOOD) });
      k.drawRect({ pos: k.vec2(x - 12, y - 20), width: 24, height: 28, fill: false, outline: { width: 2, color: k.rgb(...WOOD_DK) } });
      k.drawLine({ p1: k.vec2(x - 12, y - 20), p2: k.vec2(x + 12, y + 8), width: 1.5, color: k.rgb(...WOOD_DK), opacity: 0.5 });
      k.drawLine({ p1: k.vec2(x + 12, y - 20), p2: k.vec2(x - 12, y + 8), width: 1.5, color: k.rgb(...WOOD_DK), opacity: 0.5 });
    }
    // A herb PLANTER (healer-themed) — a wooden box of swaying green sprigs.
    function drawPlanter(x, y, t) {
      const sway = reduce ? 0 : Math.sin(t * 1.5 + x * 0.1);
      k.drawEllipse({ pos: k.vec2(x, y + 6), radiusX: 15, radiusY: 5, color: k.rgb(0, 0, 0), opacity: 0.2 });
      for (let i = -2; i <= 2; i++) { const hx = x + i * 5; k.drawLine({ p1: k.vec2(hx, y - 2), p2: k.vec2(hx + sway * i * 0.6, y - 15 - (i % 2 ? 0 : 4)), width: 2, color: k.rgb(...HEAL), opacity: 0.7 }); k.drawCircle({ pos: k.vec2(hx + sway * i * 0.6, y - 16 - (i % 2 ? 0 : 4)), radius: 2, color: k.rgb(...HEAL), opacity: 0.6 }); }
      k.drawRect({ pos: k.vec2(x - 14, y - 4), width: 28, height: 14, radius: 3, color: k.rgb(...WOOD) });
      k.drawRect({ pos: k.vec2(x - 14, y - 4), width: 28, height: 4, radius: 2, color: k.rgb(...WOOD_LT), opacity: 0.5 });
    }

    // A TREE: trunk + layered foliage; kinds 0 round / 1 pine / 2 broad. Scaled, with a soft sway.
    function drawTree(tr, t) {
      const x = tr.x, y = tr.y, s = tr.s, kind = tr.kind;
      const sway = reduce ? 0 : Math.sin(t * 1.1 + x * 0.05) * 2 * s;
      k.drawEllipse({ pos: k.vec2(x, y), radiusX: 15 * s, radiusY: 5 * s, color: k.rgb(0, 0, 0), opacity: 0.2 });
      k.drawRect({ pos: k.vec2(x - 4 * s, y - 26 * s), width: 8 * s, height: 28 * s, radius: 2, color: k.rgb(...BARK) });
      if (kind === 1) {
        for (let i = 0; i < 4; i++) k.drawEllipse({ pos: k.vec2(x + sway * (i / 3), y - 24 * s - i * 15 * s), radiusX: (27 - i * 5.2) * s, radiusY: 12 * s, color: k.rgb(...(i % 2 ? LEAF : LEAF_DK)) });
        k.drawEllipse({ pos: k.vec2(x + sway, y - 24 * s - 45 * s), radiusX: 6 * s, radiusY: 8 * s, color: k.rgb(...LEAF_LT), opacity: 0.7 });
      } else {
        const r = (kind === 2 ? 31 : 26) * s;
        k.drawCircle({ pos: k.vec2(x + sway, y - 42 * s), radius: r, color: k.rgb(...LEAF_DK) });
        k.drawCircle({ pos: k.vec2(x - r * 0.45 + sway, y - 36 * s), radius: r * 0.66, color: k.rgb(...LEAF) });
        k.drawCircle({ pos: k.vec2(x + r * 0.5 + sway, y - 39 * s), radius: r * 0.62, color: k.rgb(...LEAF) });
        k.drawCircle({ pos: k.vec2(x - r * 0.25 + sway, y - 50 * s), radius: r * 0.5, color: k.rgb(...LEAF_LT), opacity: 0.7 });
      }
    }

    // A BUILDING: a generic house (4 designs) or the dungeon cave mouth.
    function drawBuilding(b, t) {
      if (b.kind === "cave") drawCavePortal(b, t);
      else drawHouse(b, t);
    }

    const ROOF = [[156, 86, 66], [92, 112, 140], [74, 104, 88], [156, 128, 80]]; // terracotta / slate / green / thatch
    // A little corked potion bottle (body + round base + neck + cork + glint) — merchant interior ware.
    function potion(px, py, c) {
      k.drawRect({ pos: k.vec2(px - 4, py - 3), width: 8, height: 11, radius: 3, color: k.rgb(...c), opacity: 0.92 });
      k.drawCircle({ pos: k.vec2(px, py + 5), radius: 5, color: k.rgb(...c), opacity: 0.92 });
      k.drawRect({ pos: k.vec2(px - 1.5, py - 8), width: 3, height: 5, color: k.rgb(...WOOD_LT) });
      k.drawRect({ pos: k.vec2(px - 2.5, py - 10), width: 5, height: 3, radius: 1, color: k.rgb(...WOOD_DK) });
      k.drawCircle({ pos: k.vec2(px - 1.5, py + 3), radius: 1.6, color: k.rgb(255, 255, 255), opacity: 0.4 });
    }
    // A reusable TOP-DOWN building (roof from above; the footprint is the hitbox): interior (plank floor
    // + themed furniture + keeper) revealed as the roof fades open (b.roofA) when you walk up, then the
    // tiled roof + chimney + a themed roof emblem (awning / cross / lock). Generalised from the old
    // merchant the user liked.
    function drawHouse(b, t) {
      const x = b.x, y = b.y, BW = b.w, BH = b.h, id = b.id;
      const lft = x - BW / 2, rgt = x + BW / 2, top = y - BH / 2, bot = y + BH / 2;
      const ra = b.roofA != null ? b.roofA : 1;
      const roof = ROOF[b.design || 0], roofDk = roof.map((v) => Math.round(v * 0.66)), roofLt = roof.map((v) => Math.min(255, v + 30));
      const amber = THEME.amber, vio = THEME.violet, mid = y - 6;
      k.drawEllipse({ pos: k.vec2(x, bot + 4), radiusX: BW / 2 + 6, radiusY: 18, color: k.rgb(0, 0, 0), opacity: 0.26 }); // footprint shadow
      // ── INTERIOR (drawn first; the roof above hides it until you arrive) ──
      k.drawRect({ pos: k.vec2(lft + 8, top + 14), width: BW - 16, height: BH - 22, radius: 6, color: k.rgb(48, 40, 34) });
      for (let i = 1; i < 6; i++) k.drawLine({ p1: k.vec2(lft + 8, top + 14 + i * (BH - 22) / 6), p2: k.vec2(rgt - 8, top + 14 + i * (BH - 22) / 6), width: 1, color: k.rgb(...WOOD_DK), opacity: 0.3 });
      k.drawRect({ pos: k.vec2(lft + 8, top + 14), width: BW - 16, height: BH - 22, radius: 6, fill: false, outline: { width: 4, color: k.rgb(...WOOD_DK) } });
      if (id === "merchant") {
        k.drawRect({ pos: k.vec2(lft + 18, top + 22), width: BW - 36, height: 18, radius: 2, color: k.rgb(...WOOD) });
        const wares = [THEME.teal, vio, amber, THEME.ice, THEME.danger, HEAL];
        for (let i = 0; i < 6; i++) potion(lft + 34 + i * ((BW - 68) / 5), top + 27, wares[i]);
      } else if (id === "healer") {
        const pulse = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 2.5);
        k.drawEllipse({ pos: k.vec2(x, top + 42), radiusX: 36, radiusY: 14, color: k.rgb(...STONE) });
        k.drawEllipse({ pos: k.vec2(x, top + 40), radiusX: 28, radiusY: 10, color: k.rgb(...HEAL), opacity: 0.5 + 0.25 * pulse });
        k.drawEllipse({ pos: k.vec2(x - 4, top + 38), radiusX: 13, radiusY: 4, color: k.rgb(210, 255, 225), opacity: 0.4 * pulse });
      } else if (id === "vault") {
        k.drawRect({ pos: k.vec2(x - 58, top + 22), width: 116, height: 32, radius: 5, color: k.rgb(70, 76, 92) });
        [[-38, THEME.teal], [-13, amber], [13, vio], [38, THEME.ice]].forEach(([ox, c]) => { k.drawCircle({ pos: k.vec2(x + ox, top + 38), radius: 8, color: k.rgb(...c), opacity: 0.3 }); k.drawCircle({ pos: k.vec2(x + ox, top + 38), radius: 5, color: k.rgb(...c) }); });
      } else {
        k.drawRect({ pos: k.vec2(x - 16, top + 22), width: 32, height: 18, radius: 3, color: k.rgb(...STONE_DK) });
        k.drawEllipse({ pos: k.vec2(x, top + 31), radiusX: 9, radiusY: 5, color: k.rgb(255, 150, 70), opacity: reduce ? 0.45 : 0.35 + 0.2 * Math.sin(t * 4 + x) });
      }
      if (b.keeper) b.keeper(x, y + 8, t); // the keeper inside
      if (id === "merchant") { // front counter over the keeper's lower body
        k.drawRect({ pos: k.vec2(x - 62, bot - 46), width: 124, height: 24, radius: 4, color: k.rgb(...WOOD) });
        k.drawRect({ pos: k.vec2(x - 64, bot - 51), width: 128, height: 7, radius: 3, color: k.rgb(...WOOD_LT) });
        potion(x - 42, bot - 52, THEME.teal); potion(x - 24, bot - 52, vio);
        k.drawCircle({ pos: k.vec2(x + 10, bot - 54), radius: 6, color: k.rgb(...THEME.ice) });
      }
      // ── ROOF (opacity ra) — the building seen from above ──
      if (ra > 0.03) {
        k.drawRect({ pos: k.vec2(lft - 8, top + 4), width: BW + 16, height: BH - 2, radius: 10, color: k.rgb(...roofDk), opacity: ra });          // eaves overhang
        k.drawRect({ pos: k.vec2(lft - 3, top + 6), width: BW + 6, height: mid - (top + 6), radius: 7, color: k.rgb(...roof), opacity: ra });       // back pitch (lit)
        k.drawRect({ pos: k.vec2(lft - 3, mid), width: BW + 6, height: (bot - 4) - mid, radius: 7, color: k.rgb(...roofDk), opacity: ra });         // front pitch (shaded)
        k.drawRect({ pos: k.vec2(lft - 3, mid - 2), width: BW + 6, height: 5, radius: 2, color: k.rgb(...roofLt), opacity: 0.8 * ra });             // ridge
        for (let i = 1; i < 4; i++) { const yy = top + 6 + i * (mid - top - 6) / 4; k.drawLine({ p1: k.vec2(lft, yy), p2: k.vec2(rgt, yy), width: 1.5, color: k.rgb(...roofDk), opacity: 0.45 * ra }); }
        for (let i = 1; i < 4; i++) { const yy = mid + i * (bot - 4 - mid) / 4; k.drawLine({ p1: k.vec2(lft, yy), p2: k.vec2(rgt, yy), width: 1.5, color: k.rgb(...WOOD_DK), opacity: 0.4 * ra }); }
        k.drawRect({ pos: k.vec2(lft + 22, top - 8), width: 18, height: 24, radius: 2, color: k.rgb(...STONE), opacity: ra });                      // chimney
        k.drawRect({ pos: k.vec2(lft + 20, top - 11), width: 22, height: 6, radius: 2, color: k.rgb(...STONE_DK), opacity: ra });
        if (!reduce && ra > 0.5) for (let i = 0; i < 3; i++) { const f = (t * 0.4 + i * 0.33) % 1; k.drawCircle({ pos: k.vec2(lft + 31 + Math.sin((t + i) * 1.5) * 6, top - 12 - f * 30), radius: 3 + f * 4, color: k.rgb(150, 150, 160), opacity: 0.16 * (1 - f) * ra }); }
        drawRoofEmblem(b, t, lft, rgt, top, bot, mid, ra);
      }
    }

    // The functional buildings' roof feature: merchant striped awning + coin sign, healer glowing cross,
    // vault lock plate. Generic houses just get the plain roof.
    function drawRoofEmblem(b, t, lft, rgt, top, bot, mid, ra) {
      const x = b.x, BW = b.w, amber = THEME.amber, red = THEME.danger;
      if (b.id === "merchant") {
        for (let i = 0; i < 9; i++) k.drawRect({ pos: k.vec2(lft + 6 + i * ((BW - 12) / 9), bot - 8), width: (BW - 12) / 9, height: 16, color: k.rgb(...(i % 2 ? red : amber)), opacity: ra });
        for (let i = 0; i < 9; i++) k.drawCircle({ pos: k.vec2(lft + 6 + (BW - 12) / 18 + i * ((BW - 12) / 9), bot + 8), radius: (BW - 12) / 18, color: k.rgb(...(i % 2 ? red : amber)), opacity: ra });
        k.drawRect({ pos: k.vec2(lft + 2, bot + 2), width: 32, height: 20, radius: 3, color: k.rgb(...WOOD_LT), opacity: ra });
        k.drawCircle({ pos: k.vec2(lft + 18, bot + 12), radius: 7, color: k.rgb(...amber), opacity: ra });
        k.drawCircle({ pos: k.vec2(lft + 18, bot + 12), radius: 2.6, color: k.rgb(...WOOD_DK), opacity: 0.5 * ra });
      } else if (b.id === "healer") {
        const g = HEAL, glow = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 2.5);
        k.drawCircle({ pos: k.vec2(x, mid - 2), radius: 20, color: k.rgb(...g), opacity: 0.14 * glow * ra });
        k.drawRect({ pos: k.vec2(x - 6, mid - 20), width: 12, height: 34, radius: 2, color: k.rgb(...g), opacity: ra });
        k.drawRect({ pos: k.vec2(x - 16, mid - 9), width: 32, height: 12, radius: 2, color: k.rgb(...g), opacity: ra });
      } else if (b.id === "vault") {
        const v = THEME.violet;
        k.drawRect({ pos: k.vec2(x - 17, mid - 15), width: 34, height: 32, radius: 5, color: k.rgb(...v), opacity: 0.9 * ra });
        k.drawCircle({ pos: k.vec2(x, mid - 5), radius: 8, fill: false, outline: { width: 3, color: k.rgb(40, 34, 30) }, opacity: ra });
        k.drawRect({ pos: k.vec2(x - 2, mid - 3), width: 4, height: 11, color: k.rgb(40, 34, 30), opacity: ra });
      }
    }

    // Building name plates (above houses, below the cave) + the active building's ring + E bubble.
    function drawLabels(t) {
      const pulse = reduce ? 0.85 : 0.5 + 0.5 * Math.sin(t * 3);
      for (const b of buildings) {
        if (!b.label) continue;
        const isCave = b.kind === "cave";
        const ly = isCave ? b.y + 80 : b.y - b.h / 2 - 14;
        k.drawText({ text: b.label, pos: k.vec2(b.x, ly), anchor: isCave ? "top" : "bot", size: 14, font: FONT, color: k.rgb(...(b === near ? b.accent : THEME.textBody)) });
      }
      if (near) {
        const b = near, isCave = b.kind === "cave";
        const fy = b.y + (isCave ? 44 : b.h / 2); // the front edge where you stand
        const rr = (isCave ? 56 : 46) + (reduce ? 0 : 3 * Math.sin(t * 4));
        k.drawCircle({ pos: k.vec2(b.x, fy + 16), radius: rr, fill: false, outline: { width: 3, color: k.rgb(...b.accent) }, opacity: 0.4 + 0.3 * pulse });
        if (!TOUCH) {
          const by = isCave ? b.y - 92 : b.y - b.h / 2 - 42;
          k.drawRect({ pos: k.vec2(b.x - 16, by - 14), width: 32, height: 28, radius: 7, color: k.rgb(...THEME.bgAlt), outline: { width: 2, color: k.rgb(...b.accent) } });
          k.drawText({ text: "E", pos: k.vec2(b.x, by), anchor: "center", size: 16, font: FONT, color: k.rgb(...b.accent) });
        }
      }
    }

    // CAVE PORTAL — a dramatic glowing GATEWAY at the village treeline: a dark rock arch framing a
    // swirling vortex of spirit-light (rotating concentric rings + a bright pulsing core + orbiting
    // sparks + an outward glow + rising motes), flanked by teal braziers. The way OUT to a run.
    function drawCavePortal(s, t) {
      const x = s.x, y = s.y;
      const rock = [46, 50, 64], rockDk = [28, 31, 42], rockLt = [80, 84, 102];
      const teal = THEME.teal, ice = THEME.ice;
      const spin = reduce ? 0 : t, pulse = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 2.5);
      // Rocky bluff the portal is set into.
      k.drawEllipse({ pos: k.vec2(x, y - 4), radiusX: 152, radiusY: 112, color: k.rgb(...rockDk) });
      k.drawEllipse({ pos: k.vec2(x, y - 14), radiusX: 132, radiusY: 96, color: k.rgb(...rock) });
      k.drawEllipse({ pos: k.vec2(x - 68, y - 46), radiusX: 34, radiusY: 24, color: k.rgb(...rockLt), opacity: 0.35 });
      k.drawEllipse({ pos: k.vec2(x + 72, y - 34), radiusX: 28, radiusY: 20, color: k.rgb(...rockDk), opacity: 0.8 });
      // Carved arch (jambs + a faint band + keystone) around the gateway.
      k.drawRect({ pos: k.vec2(x - 76, y - 30), width: 18, height: 88, radius: 3, color: k.rgb(...rockLt), opacity: 0.5 });
      k.drawRect({ pos: k.vec2(x + 58, y - 30), width: 18, height: 88, radius: 3, color: k.rgb(...rockLt), opacity: 0.5 });
      k.drawEllipse({ pos: k.vec2(x, y - 34), radiusX: 74, radiusY: 38, color: k.rgb(...rockLt), opacity: 0.3 });
      k.drawRect({ pos: k.vec2(x - 11, y - 64), width: 22, height: 18, radius: 3, color: k.rgb(...rockLt), opacity: 0.6 });
      // ── the VORTEX ──
      for (const [r, o] of [[80, 0.10], [60, 0.16], [42, 0.22]]) k.drawEllipse({ pos: k.vec2(x, y + 6), radiusX: r, radiusY: r * 1.15, color: k.rgb(...teal), opacity: o * pulse }); // outward glow
      k.drawEllipse({ pos: k.vec2(x, y + 6), radiusX: 50, radiusY: 60, color: k.rgb(5, 8, 12) }); // dark recess
      for (let i = 0; i < 5; i++) { // rotating concentric rings
        const rr = 46 - i * 8, a = spin * (1 + i * 0.3), ox = Math.cos(a) * (3 + i), oy = Math.sin(a) * (2 + i * 0.6);
        k.drawEllipse({ pos: k.vec2(x + ox, y + 6 + oy), radiusX: rr, radiusY: rr * 1.18, fill: false, outline: { width: 3, color: k.rgb(...(i % 2 ? teal : ice)) }, opacity: 0.3 + 0.1 * i });
      }
      k.drawEllipse({ pos: k.vec2(x, y + 6), radiusX: 16 * pulse, radiusY: 19 * pulse, color: k.rgb(...teal), opacity: 0.5 }); // core
      k.drawEllipse({ pos: k.vec2(x, y + 6), radiusX: 9 * pulse, radiusY: 11 * pulse, color: k.rgb(...ice) });
      k.drawCircle({ pos: k.vec2(x, y + 4), radius: 5 * pulse, color: k.rgb(235, 255, 255) });
      if (!reduce) for (let i = 0; i < 8; i++) { // orbiting sparks
        const a = spin * 1.6 + (i / 8) * Math.PI * 2, px = x + Math.cos(a) * 44, py = y + 6 + Math.sin(a) * 52, nr = (Math.sin(a) + 1) / 2;
        k.drawCircle({ pos: k.vec2(px, py), radius: 1.4 + 2 * nr, color: k.rgb(...ice), opacity: 0.4 + 0.5 * nr });
      }
      if (!reduce) for (let i = 0; i < 5; i++) { const f = (t * 0.5 + i * 0.2) % 1; k.drawCircle({ pos: k.vec2(x + Math.sin(t + i * 2) * 26, y + 40 - f * 50), radius: Math.max(0.5, (1 - f) * 2.4), color: k.rgb(...teal), opacity: 0.5 * (1 - f) }); } // rising motes
      for (const tx of [x - 78, x + 78]) { // flanking teal braziers
        const fl = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 7 + tx);
        k.drawRect({ pos: k.vec2(tx - 4, y + 6), width: 8, height: 30, radius: 2, color: k.rgb(...rockDk) });
        k.drawEllipse({ pos: k.vec2(tx, y + 4), radiusX: 9, radiusY: 5, color: k.rgb(...rockLt) });
        k.drawCircle({ pos: k.vec2(tx, y - 4), radius: 12, color: k.rgb(120, 220, 255), opacity: 0.18 * fl });
        k.drawEllipse({ pos: k.vec2(tx, y - 5), radiusX: 4, radiusY: 8, color: k.rgb(...ice), opacity: 0.85 });
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
