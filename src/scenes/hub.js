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
const VRX = 10.6, VRY = 8.4;               // clearing radii (tiles) — the open green
const TILE = (tx, ty) => ({ x: tx * E + E / 2, y: ty * E + E / 2 }); // tile centre → world px
// Squared-ellipse value at a tile-centre: <1 inside the clearing, ~1 on the tree ring, >1 in the forest.
const ellip = (cx, cy) => ((cx - VCX) / VRX) ** 2 + ((cy - VCY) / VRY) ** 2;
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
    const p = e < 0.8 ? 0.05 : e < 1.18 ? 0.82 : 0.6; // clearing / ring / forest
    if (hash(tx, ty) >= p) continue;
    const jx = (hash(tx, ty, 1) - 0.5) * 0.7, jy = (hash(tx, ty, 2) - 0.5) * 0.7;
    trees.push({ x: (cx + jx) * E, y: (cy + jy) * E, kind: Math.floor(hash(tx, ty, 3) * 3), s: 0.85 + hash(tx, ty, 4) * 0.6, inClear: e < 0.9 });
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

    // ── The VILLAGE: reusable houses (4 designs) clustered in the clearing, plus a dungeon CAVE mouth
    //    at the treeline. The functional ones carry an `act`; the rest are flavour. `roofA` fades each
    //    building's roof open as the player steps under it (lerped in onUpdate). ──────────────────────
    const buildings = [
      { id: "cave",     kind: "cave",  ...TILE(15, 6),     w: 250, baseH: 70, accent: THEME.teal,   label: "CAVE ENTRANCE", hint: "start a run",      rdy: 16, act: () => openPlay() },
      { id: "merchant", kind: "house", design: 0, big: 1, ...TILE(20.5, 9),   w: 224, baseH: 96, accent: THEME.amber,  label: "MERCHANT", hint: "spirit shop",      keeper: (x, y, t) => drawTraderKeeper(x, y, t), act: () => k.go("onlineShop", { characterId, backScene: "hub", backArgs: { characterId } }) },
      { id: "healer",   kind: "house", design: 1, ...TILE(8.5, 10.5), w: 170, baseH: 80, accent: HEAL,         label: "HEALER",   hint: "heal your team",   keeper: (x, y, t) => drawClericKeeper(x, y, t), act: () => healNow() },
      { id: "vault",    kind: "house", design: 2, ...TILE(21, 17.5),  w: 170, baseH: 80, accent: THEME.violet, label: "VAULT",    hint: "team & inventory", keeper: (x, y, t) => drawGolemKeeper(x, y, t), act: () => k.go("roster", { characterId, backScene: "hub", backArgs: { characterId } }) },
      { id: "g1",       kind: "house", design: 3, ...TILE(9, 17),      w: 150, baseH: 72 },
      { id: "g2",       kind: "house", design: 0, ...TILE(14.5, 19.5), w: 150, baseH: 72 },
      { id: "g3",       kind: "house", design: 1, ...TILE(24, 13.5),   w: 146, baseH: 72 },
      { id: "g4",       kind: "house", design: 2, ...TILE(6, 14),      w: 146, baseH: 72 },
    ];
    buildings.forEach((b) => { b.roofA = 1; });
    const stations = buildings.filter((b) => b.act); // the interactable subset (proximity + prompt + act)
    // A building's solid base rect (the lower walls) — blocks movement; its roof above can be walked behind.
    const footRect = (b) => ({ x0: b.x - b.w * 0.42, x1: b.x + b.w * 0.42, y0: b.y - b.baseH * 0.55, y1: b.y + 8 });
    // Walkable = inside the clearing (the tree ring blocks beyond it) AND not inside any house base.
    function walkable(x, y) {
      if (ellip(x / E, y / E) > 1.05) return false;
      for (const b of buildings) { if (b.kind === "cave") continue; const r = footRect(b); if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return false; }
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
      // Nearest interactable building within reach (drives the prompt + the interact key).
      near = null; let best = REACH * REACH;
      for (const s of stations) {
        const ddx = s.x - me.x, ddy = (s.y + (s.rdy || 0)) - me.y, d2 = ddx * ddx + ddy * ddy;
        if (d2 < best) { best = d2; near = s; }
      }
      // Each house's roof fades open as you stand at it (a soft "step inside" reveal of the keeper).
      for (const b of buildings) if (b.kind === "house") b.roofA += (((near === b) ? 0.16 : 1) - b.roofA) * Math.min(1, k.dt() * 6);
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
      // Depth: trees (culled to view) + buildings + player, sorted by base-y, drawn back→front.
      const cullX = k.width() / 2 + 100, cullY = k.height() / 2 + 150;
      const props = [];
      for (const tr of trees) if (Math.abs(tr.x - me.x) <= cullX && Math.abs(tr.y - me.y) <= cullY) props.push({ y: tr.y, d: () => drawTree(tr, t) });
      for (const b of buildings) props.push({ y: b.y, d: () => drawBuilding(b, t, b === near) });
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
      const cx = VCX * E, cy = VCY * E;
      k.drawEllipse({ pos: k.vec2(cx, cy), radiusX: VRX * E, radiusY: VRY * E, color: k.rgb(98, 134, 86), opacity: 0.16 });
      k.drawEllipse({ pos: k.vec2(cx, cy + 12), radiusX: VRX * E * 0.6, radiusY: VRY * E * 0.58, color: k.rgb(122, 106, 80), opacity: 0.15 });
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
    function drawBuilding(b, t, active) {
      if (b.kind === "cave") drawCaveMouth(b, t);
      else drawHouse(b, t, active);
    }

    const ROOF = [[156, 86, 66], [92, 112, 140], [74, 104, 88], [156, 128, 80]]; // terracotta / slate / green / thatch
    const WALLC = [126, 110, 90], WALLD = [94, 82, 66], WALLL = [158, 140, 114];
    // A reusable HOUSE (4 roof designs; `big` = the merchant): shadow → walls (door + glowing windows +
    // corner timber) → keeper inside → roof (fades open as you arrive via b.roofA) → hanging sign +
    // chimney smoke. Drawn anchored at the front-base (b.x, b.y); the player can pass behind the roof.
    function drawHouse(b, t, active) {
      const x = b.x, y = b.y, w = b.w, d = b.design || 0, wallH = b.baseH;
      const roof = ROOF[d], roofDk = roof.map((v) => Math.round(v * 0.66));
      const acc = b.accent || WALLL; // generic (flavour) houses carry no facility accent
      const ra = b.roofA != null ? b.roofA : 1, wy = y - wallH;
      k.drawEllipse({ pos: k.vec2(x, y + 8), radiusX: w * 0.52, radiusY: w * 0.15, color: k.rgb(0, 0, 0), opacity: 0.26 });
      if (active) k.drawEllipse({ pos: k.vec2(x, y + 4), radiusX: w * 0.58, radiusY: w * 0.2, color: k.rgb(...acc), opacity: 0.14 });
      // Walls (shaded left / lit right) + timber corner posts.
      k.drawRect({ pos: k.vec2(x - w / 2, wy), width: w, height: wallH + 8, radius: 4, color: k.rgb(...WALLC) });
      k.drawRect({ pos: k.vec2(x - w / 2, wy), width: w * 0.16, height: wallH + 8, color: k.rgb(...WALLD), opacity: 0.45 });
      k.drawRect({ pos: k.vec2(x + w * 0.34, wy), width: w * 0.16, height: wallH + 8, color: k.rgb(...WALLL), opacity: 0.3 });
      k.drawRect({ pos: k.vec2(x - w / 2, wy), width: 6, height: wallH + 8, color: k.rgb(...WALLD) });
      k.drawRect({ pos: k.vec2(x + w / 2 - 6, wy), width: 6, height: wallH + 8, color: k.rgb(...WALLD) });
      // Glowing windows.
      const wg = reduce ? 0.7 : 0.5 + 0.25 * Math.sin(t * 2 + x);
      for (const wx of [x - w * 0.27, x + w * 0.27]) {
        k.drawRect({ pos: k.vec2(wx - 13, wy + wallH * 0.2), width: 26, height: 24, radius: 3, color: k.rgb(...WALLD) });
        k.drawRect({ pos: k.vec2(wx - 10, wy + wallH * 0.2 + 3), width: 20, height: 18, radius: 2, color: k.rgb(255, 208, 128), opacity: 0.45 + 0.3 * wg });
        k.drawLine({ p1: k.vec2(wx, wy + wallH * 0.2 + 3), p2: k.vec2(wx, wy + wallH * 0.2 + 21), width: 1.5, color: k.rgb(...WALLD) });
      }
      // Door (front, centred).
      const doorW = Math.max(30, w * 0.16), doorH = wallH * 0.66, doorY = y + 8 - doorH;
      k.drawRect({ pos: k.vec2(x - doorW / 2 - 3, doorY - 3), width: doorW + 6, height: doorH + 4, radius: 3, color: k.rgb(...WALLD) });
      k.drawRect({ pos: k.vec2(x - doorW / 2, doorY), width: doorW, height: doorH, radius: 2, color: k.rgb(...roofDk) });
      k.drawCircle({ pos: k.vec2(x + doorW * 0.28, doorY + doorH * 0.5), radius: 2.2, color: k.rgb(...acc) });
      // Keeper inside, revealed as the roof fades (drawn before the roof).
      if (ra < 0.86 && b.keeper) {
        k.drawRect({ pos: k.vec2(x - w / 2 + 7, wy + 6), width: w - 14, height: wallH, radius: 3, color: k.rgb(14, 12, 18), opacity: 0.86 - ra });
        b.keeper(x, y - wallH * 0.2, t);
      }
      drawRoof(x, wy, w, d, roof, roofDk, ra);
      if (b.act) drawSign(x + w * 0.42, y - wallH * 0.5, b);
      // Chimney + smoke.
      const cxp = x - w * 0.34;
      k.drawRect({ pos: k.vec2(cxp - 6, wy - (b.big ? 74 : 56)), width: 12, height: 20, color: k.rgb(...roofDk) });
      if (!reduce) for (let i = 0; i < 3; i++) { const f = (t * 0.4 + i * 0.33) % 1; k.drawCircle({ pos: k.vec2(cxp + Math.sin((t + i) * 1.5) * 6, wy - (b.big ? 80 : 62) - f * 30), radius: 3 + f * 4, color: k.rgb(150, 150, 160), opacity: 0.16 * (1 - f) }); }
    }

    // A roof above the walls: stacked narrowing bands (gable→point for designs 0/2, hip→flat-top for
    // 1/3) at the fade alpha, with an overhanging eave + a ridge highlight.
    function drawRoof(x, baseY, w, d, roof, roofDk, ra) {
      const roofH = Math.round(w * (d === 2 ? 0.6 : d === 3 ? 0.36 : 0.48));
      const eaveW = w + (d === 3 ? 30 : 20), topW = (d === 0 || d === 2) ? 10 : w * 0.4, bands = 9;
      k.drawRect({ pos: k.vec2(x - eaveW / 2, baseY - 4), width: eaveW, height: 6, radius: 2, color: k.rgb(...roofDk), opacity: ra });
      for (let i = 0; i < bands; i++) {
        const f = i / (bands - 1), bw = eaveW + (topW - eaveW) * f, by = baseY - 6 - roofH * f;
        k.drawRect({ pos: k.vec2(x - bw / 2, by - roofH / bands - 1), width: bw, height: roofH / bands + 1.5, color: k.rgb(...(i % 2 ? roofDk : roof)), opacity: ra });
      }
      k.drawRect({ pos: k.vec2(x - topW / 2, baseY - 6 - roofH - 2), width: topW, height: 4, radius: 2, color: k.rgb(...roof.map((v) => Math.min(255, v + 34))), opacity: ra });
    }

    // A hanging shop sign (a board on a bracket) with the facility's glyph: coin / cross / lock.
    function drawSign(x, y, b) {
      k.drawLine({ p1: k.vec2(x - 12, y - 2), p2: k.vec2(x, y - 2), width: 2, color: k.rgb(...WALLD) });
      k.drawRect({ pos: k.vec2(x - 3, y), width: 28, height: 26, radius: 3, color: k.rgb(...WALLD) });
      k.drawRect({ pos: k.vec2(x - 1, y + 2), width: 24, height: 22, radius: 2, color: k.rgb(...WALLC) });
      const gx = x + 11, gy = y + 13, a = b.accent;
      if (b.id === "merchant") { k.drawCircle({ pos: k.vec2(gx, gy), radius: 7, color: k.rgb(...a) }); k.drawCircle({ pos: k.vec2(gx, gy), radius: 3, fill: false, outline: { width: 1.5, color: k.rgb(...WALLD) }, opacity: 0.7 }); }
      else if (b.id === "healer") { k.drawRect({ pos: k.vec2(gx - 2.5, gy - 7), width: 5, height: 14, radius: 1, color: k.rgb(...a) }); k.drawRect({ pos: k.vec2(gx - 7, gy - 2.5), width: 14, height: 5, radius: 1, color: k.rgb(...a) }); }
      else if (b.id === "vault") { k.drawRect({ pos: k.vec2(gx - 6, gy - 3), width: 12, height: 11, radius: 2, color: k.rgb(...a) }); k.drawCircle({ pos: k.vec2(gx, gy - 3), radius: 5, fill: false, outline: { width: 2, color: k.rgb(...a) } }); }
    }

    // Building name plates (above houses, below the cave) + the active building's ring + E bubble.
    function drawLabels(t) {
      const pulse = reduce ? 0.85 : 0.5 + 0.5 * Math.sin(t * 3);
      for (const b of buildings) {
        if (!b.label) continue;
        const isCave = b.kind === "cave";
        const ly = isCave ? b.y + 72 : b.y - b.baseH - b.w * 0.55 - 12;
        k.drawText({ text: b.label, pos: k.vec2(b.x, ly), anchor: isCave ? "top" : "bot", size: b.big ? 16 : 13, font: FONT, color: k.rgb(...(b === near ? b.accent : THEME.textBody)) });
      }
      if (near) {
        const b = near, isCave = b.kind === "cave";
        const ringY = isCave ? b.y + 6 : b.y - b.baseH * 0.32;
        const rr = (isCave ? 52 : b.w * 0.36) + (reduce ? 0 : 3 * Math.sin(t * 4));
        k.drawCircle({ pos: k.vec2(b.x, ringY), radius: rr, fill: false, outline: { width: 3, color: k.rgb(...b.accent) }, opacity: 0.4 + 0.3 * pulse });
        if (!TOUCH) {
          const by = isCave ? b.y - 96 : b.y - b.baseH - b.w * 0.55 - 40;
          k.drawRect({ pos: k.vec2(b.x - 16, by - 14), width: 32, height: 28, radius: 7, color: k.rgb(...THEME.bgAlt), outline: { width: 2, color: k.rgb(...b.accent) } });
          k.drawText({ text: "E", pos: k.vec2(b.x, by), anchor: "center", size: 16, font: FONT, color: k.rgb(...b.accent) });
        }
      }
    }

    // CAVE MOUTH — a rocky bluff at the village treeline: a carved stone arch (jamb blocks + keystone)
    // around a dark mouth, the real in-game spirit rift inside, flanking torches, embedded teal
    // crystals, and stalactites. The gateway OUT to a run — no keeper, just the dungeon mouth.
    function drawCaveMouth(s, t) {
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
