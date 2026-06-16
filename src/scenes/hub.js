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
import { drawPlayWindow, playWindowLayout } from "../render/playWindow.js";
import { drawHubPanel } from "../render/hubPanel.js"; // polished identity + inventory (team/chains/items) HUD panel
import { getCharacter, setCharacterServerToken, saveCharacter, getProfile, clearProfile } from "../storage.js";
import { healTeam } from "../engine/progression.js";
import { safeInsetsDesign } from "../systems/safearea.js";
import { getMonsterType, getGroundTiles, getAttacksForMonster, cleanAttackName } from "../engine/gamedata.js";
import { getMonsterStats } from "../engine/stats.js";
import { generateMap, isWalkable } from "../engine/mapgen.js";
import { GAME } from "../engine/schemas.js";
import { sprintingNow, tickStamina, sprintMult } from "../engine/movement.js"; // TQ-89: shared sprint/stamina rule, same as the in-run game
import { net } from "../netClient.js";
import { THEME, FONT, FONT_BODY, addButton, addPanel, addLabel, inRect, drawToast, drawButton } from "../ui/theme.js";
import { drawMonsterDetail } from "../ui/monsterDetail.js"; // TQ-128: the SHARED monster-detail popup (replaces hub's hand-rolled modal)
import { drawStationPopup, stationContentRect, stationCloseRect, stationPopupInside } from "../ui/stationPopup.js"; // TQ-118: in-lobby station-popup shell
import { drawBestiaryPanel, bestiaryPanelState, bestiaryPanelTap, bestiaryPanelScroll } from "../ui/bestiaryPanel.js"; // TQ-118: Bestiary pilot content
import { drawShopPanel, shopPanelState, shopPanelTap, shopPanelScroll } from "../ui/shopPanel.js"; // TQ-119: Spirit Shop content
import { drawCosmeticsPanel, cosmeticsPanelState, cosmeticsPanelTap, cosmeticsPanelScroll } from "../ui/cosmeticsPanel.js"; // TQ-120: Cosmetics content
import { drawBattlePassPanel, battlePassPanelState, battlePassPanelTap, battlePassPanelScroll } from "../ui/battlePassPanel.js"; // TQ-184: Battle Pass content
import { drawSettingsPanel, settingsPanelState, settingsPanelTap, settingsPanelScroll } from "../ui/settingsPanel.js"; // TQ-121: Settings content (client-pref toggles)
import { drawProfilePanel, drawProfileModal, profilePanelState, profilePanelTap, profilePanelScroll } from "../ui/profilePanel.js"; // TQ-199: Profile content (read view + in-popup rename)
import { touchPrimary, drawJoystick, drawTouchButton } from "../systems/inputMode.js"; // mobile-only on-screen controls + standardized renderers (shared with the in-run overworld)
import { prefersReducedMotion } from "../systems/a11y.js";
import { gamepadMove, gamepadPressed, BTN } from "../systems/gamepad.js";
import { sfx, haptic, isMuted, toggleMuted } from "../systems/audio.js"; // the overlay buttons self-wire SFX; the WALKABLE lobby (E/USE, proximity, heal) needs it added here; mute toggle in the account menu

// The camp is a small VILLAGE in a forest clearing (user vision): an open walkable green ringed by
// DENSE TREES (the natural boundary — no black void), with reusable houses for the facilities. The
// whole visible ground is forest-floor tiles (render/tiles.js draws it continuously); collision is a
// custom walkable() — the tree ring + each house footprint block movement, the clearing stays open.
// Rendered with the same camera-follow + atmosphere + SQUARE play-window framing as a run.
const E = GAME.EFFECTIVE_TILE;   // 80 — world px per tile
const SPEED = Math.round(GAME.BASE_SPEED * 1.2); // 240 px/s — TQ-89 walks faster than the in-run base (large village); TQ-135 eased the bump down from 1.4 (felt too fast) to between base (200) and the old 280; sprint multiplies on top
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
  [13.0, 6.6, 5.8, 4.8],    // N  bay — cave portal (TQ-90: shifted left with the cave)
  [20.0, 10.0, 5.8, 5.4],   // E  bay — merchant
  [8.6, 11.0, 5.4, 5.4],    // W  bay — healer
  [9.5, 7.0, 5.2, 5.0],     // NW bay — workshop (base upgrades)
  [20.4, 17.5, 5.8, 5.4],   // SE bay — vault
  [10.2, 18.0, 5.4, 5.0],   // SW bay — bestiary
  [14.8, 19.8, 4.2, 4.4],   // S  bay — outfitter (its front sat in the treeline; carve it clear)
];
// Soft CANOPY-SHADE anchors (tile coords) — large faint pools of shade the ringing forest casts onto
// the open green. Spread around the mid-ring (NOT dead-centre, where the hearth glow + player sit) so
// the clearing reads lush light-and-shade instead of a flat wash, and the lit centre vs shaded edges
// form a natural focal vignette. Drawn flat under the props (see drawCanopyShade).
const SHADE = [
  [10.2, 9.2], [15.0, 8.0], [20.4, 9.0],
  [7.8, 14.2], [22.2, 13.8],
  [10.6, 18.4], [15.0, 20.6], [19.8, 18.6],
  [12.6, 12.0],
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
  // Extend WELL beyond the grid (the camera reaches ~9 tiles past the player) so the forest fills the
  // whole view to every edge — an endless forest, never a hard map border (user 2026-06-11).
  for (let tx = -12; tx <= GRID + 12; tx++) for (let ty = -12; ty <= GRID + 12; ty++) {
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

// Session-persistent spawn: returning from a station/run drops you back where you left the village (a
// walkable hub shouldn't yank you to dead-centre every time). Kept per-character so a switch resets it.
let lastHubPos = null, lastHubChar = null;

export default function hubScene(k) {
  k.scene("hub", ({ characterId } = {}) => {
    const character = getCharacter(characterId);
    if (!character) { k.go("characterSelect"); return; }

    // The forest-floor map + sprite cache + the stable tree field (the village's leafy boundary).
    const campMap = buildCampMap();
    const tileCache = makeTileCache();
    const trees = buildTrees();
    // Forest-floor colour for the endless-forest backdrop (fills the view beyond the tile grid so there's
    // never a black map border — see onDraw). Pulled from the actual grass tile so it blends seamlessly.
    const gt = (campMap.tileMap[0] && campMap.tileMap[0][0]) || {};
    const floorCol = [gt.colorProfile_full_r ?? 48, gt.colorProfile_full_g ?? 64, gt.colorProfile_full_b ?? 46];

    // ── The VILLAGE: TOP-DOWN buildings (you see the roof from above) clustered in the clearing, plus a
    //    dungeon CAVE PORTAL at the treeline. `w`×`h` is the roof footprint AND the collision hitbox —
    //    you walk AROUND buildings. Approaching a building fades its roof open (roofA, lerped in
    //    onUpdate) to reveal the interior + keeper. Bigger than before (user request). ────────────────
    // Houses are BIG + WALKABLE (user 2026-06-11): you stroll INTO them and the roof fades open to
    // reveal the interior + keeper; no collision, no text name-plate (identity is the roof emblem +
    // keeper). Only the cave keeps its rock collision (you approach the glowing mouth).
    const buildings = [
      { id: "cave",     kind: "cave",  ...TILE(13, 5.4),    w: 360, h: 184, accent: [58, 212, 198], hint: "start a run",      rdy: 8,  act: () => openStationPopup("portal") }, // TQ-345: run launcher opens as the unified in-lobby popup (was a bespoke overlay modal); spirit-teal accent matches the rift; TQ-90: nudged left (tile 15→13)
      { id: "merchant", kind: "house", design: 0, ...TILE(20.2, 8.6),   w: 376, h: 286, accent: THEME.amber,  hint: "spirit shop",      barks: ["Wares for a wanderer?", "Fresh stock today!", "Spend it while you've got it."], keeper: (x, y, t) => drawTraderKeeper(x, y, t), act: () => openStationPopup("shop") }, // TQ-119: opens as an in-lobby popup (k.go("onlineShop",…) stays the out-of-lobby fallback route)
      { id: "healer",   kind: "house", design: 2, ...TILE(8.2, 9.4),   w: 324, h: 252, accent: HEAL,         hint: "heal your team",   barks: ["Rest your spirits here.", "Let me tend your team.", "Be at ease, tamer."], keeper: (x, y, t) => drawClericKeeper(x, y, t), act: () => healNow() },
      { id: "vault",    kind: "house", design: 1, ...TILE(20.8, 17.8),  w: 324, h: 252, accent: THEME.violet, hint: "team & inventory", barks: ["Your team is safe with me.", "Nothing is lost here.", "Guarded, always."], keeper: (x, y, t) => drawGolemKeeper(x, y, t), act: () => k.go("roster", { characterId, backScene: "hub", backArgs: { characterId } }) },
      // (forge / base-upgrades smith removed per user 2026-06-11 — no longer in the game)
      { id: "bestiary", kind: "house", design: 1, ...TILE(8.8, 17.8),   w: 312, h: 240, accent: THEME.water,   hint: "monster archive", barks: ["Every spirit, catalogued.", "Knowledge is the truest catch.", "Ah, a curious mind."], keeper: (x, y, t) => drawScholarKeeper(x, y, t), act: () => openStationPopup("bestiary") }, // TQ-118: opens as an in-lobby popup (k.go("bestiary",…) remains the out-of-lobby fallback route)
      { id: "cosmetics", kind: "house", design: 0, ...TILE(14.8, 20.6), w: 312, h: 240, accent: THEME.psychic, hint: "cosmetics",       barks: ["Let's find your look.", "Style befitting a tamer.", "A fresh thread, perhaps?"], keeper: (x, y, t) => drawTailorKeeper(x, y, t),  act: () => openStationPopup("cosmetics") }, // TQ-120: opens as an in-lobby popup (k.go("cosmetics",…) stays the out-of-lobby fallback route)
    ];
    // Houses ~1.5x bigger (user 2026-06-11) — grander buildings you walk into. Cave unchanged.
    buildings.forEach((b) => { b.roofA = 1; if (b.kind === "house") { b.w = Math.round(b.w * 1.5); b.h = Math.round(b.h * 1.5); } b.faceDown = (VCY * E) > b.y; }); // entrance/facade faces the plaza: buildings north of centre open downward, southern ones open upward
    buildings.forEach((b) => { if (b.kind === "house") b.colliders = houseColliders(b); }); // interior furniture solids (walk around them), face-aware
    // Interior furniture COLLIDERS (ellipses, face-aware) — mirror the solids drawn in drawHouse so the
    // player walks around them; the entrance side stays clear so you can always step in.
    function houseColliders(b) {
      const x = b.x, y = b.y, BW = b.w, BH = b.h, lft = x - BW / 2, rgt = x + BW / 2, top = y - BH / 2, bot = y + BH / 2;
      const fd = b.faceDown !== false, s = fd ? 1 : -1;
      const by = (d) => fd ? top + d : bot - d, fy = (d) => fd ? bot - d : top + d, cy = (o) => y + s * o;
      const C = [
        { x, y: by(38), rx: (BW - 44) / 2, ry: 18 },   // back-wall display
        { x: lft + 18, y, rx: 10, ry: 26 },            // left cabinet
        { x: rgt - 18, y, rx: 10, ry: 26 },            // right cabinet
        { x: x + 66, y: by(60), rx: 15, ry: 14 },      // distinctive back-right prop
        { x: x - 72, y: cy(34), rx: 26, ry: 20 },      // left clutter cluster
        { x, y: cy(8), rx: 14, ry: 15 },               // the keeper
        { x: lft + 34, y: fy(42), rx: 12, ry: 9 },     // front-corner barrel
        { x: rgt - 34, y: fy(42), rx: 13, ry: 9 },     // front-corner crate
      ];
      if (b.id === "merchant") C.push({ x, y: cy(56), rx: 62, ry: 13 }); // shop counter (in front of the keeper, clear of the doorway)
      return C;
    }
    const stations = buildings.filter((b) => b.act); // the interactable subset (proximity + prompt + act)
    const healerB = buildings.find((b) => b.id === "healer"); // the Healer (for the needs-healing beacon)

    // ── Village DECOR: deliberate props that make the clearing feel lived-in — a central WELL focal
    //    point, lit LANTERN posts along the paths, a SIGNPOST by spawn, and stock (barrels/crates/
    //    planters) by the shops. Each is y-sorted with the buildings + has a small collision circle so
    //    you walk around it (see walkable()). Flowers/grass are flat scatter (drawGroundScatter). ──────
    // NOTE: all decor sits in the OPEN plaza, clear of the (1.5x-enlarged) building footprints — items
    // overlapping a footprint either draw over its roof or leave an invisible collider inside it.
    const decor = [
      { kind: "well",    ...TILE(15, 11.6),   r: 26 },
      { kind: "fountain", ...TILE(12.2, 11.4), r: 30 }, // the healer's spring — east flank, clear of the footprint, the south door, and the path
      { kind: "sign",    ...TILE(12.9, 14.6), r: 7 },
      { kind: "lantern", ...TILE(12.6, 12.8), r: 6 },  // plaza SW
      { kind: "lantern", ...TILE(17.6, 12.9), r: 6 },  // plaza SE (south of the merchant)
      { kind: "lantern", ...TILE(12.6, 16.8), r: 6 },
      { kind: "lantern", ...TILE(17.6, 16.6), r: 6 },
      { kind: "lantern", ...TILE(12.8, 9.2),  r: 6 },  // flank + light the path up to the cave (the run portal)
      { kind: "lantern", ...TILE(16.2, 9.2),  r: 6 },
      { kind: "bench",   ...TILE(12.6, 13.8), r: 18, basket: true }, // plaza seating; a market basket rests on this one
      { kind: "bench",   ...TILE(17.4, 13.4), r: 18, cat: true },    // and a sleeping village cat curls on this one
    ];
    // ── Critters: a few CHICKENS pecking around the plaza — pure ambient LIFE (no interaction).
    //    Chickens wander toward random walkable targets within a home radius + peck. (TQ-304: the
    //    decorative butterflies were removed for a calmer, leaner lobby.) ────────
    const critters = [];
    for (let i = 0; i < 2; i++) { const o = TILE(12.5 + i * 1.7, 14 + (i % 2) * 1.4); critters.push({ kind: "chicken", x: o.x, y: o.y, hx: o.x, hy: o.y, tx: o.x, ty: o.y, dir: 1, peck: 0, moving: false }); } // TQ-295: 4 -> 2 chickens (calmer, less cluttered plaza), wander/peck behaviour unchanged
    // VILLAGERS — a couple of townsfolk slowly strolling the plaza + pausing (people live here, not just
    // animals). Wander toward random walkable plaza points within a home radius; reduce-motion → static.
    const VPAL = [{ robe: [150, 96, 102], robeDk: [108, 66, 72], skin: [216, 172, 126], hair: [74, 54, 46] }, { robe: [92, 116, 150], robeDk: [62, 80, 110], skin: [224, 184, 142], hair: [58, 44, 38] }];
    for (let i = 0; i < 2; i++) { const o = TILE(13.4 + i * 3.2, 14.8 + (i % 2) * 1.6); critters.push({ kind: "villager", x: o.x, y: o.y, hx: o.x, hy: o.y, tx: o.x, ty: o.y, dir: 1, pause: 1 + i, moving: false, pal: VPAL[i % VPAL.length], ph: i * 2.1 }); }

    // The building footprint = its roof rect; it is the collision hitbox (you walk AROUND it). The cave
    // portal blocks only a thin back arc (you approach the mouth), handled in walkable().
    const footRect = (b) => ({ x0: b.x - b.w / 2, x1: b.x + b.w / 2, y0: b.y - b.h / 2, y1: b.y + b.h / 2 });
    // Walkable = inside the clearing (the tree ring blocks beyond it). HOUSES are now WALKABLE — you
    // stroll inside and the roof fades open (user 2026-06-11). Only the CAVE's upper rock blocks, so
    // you approach the glowing mouth from below.
    function walkable(x, y) {
      if (ellip(x / E, y / E) > 1.05) return false;
      for (const b of buildings) {
        if (b.kind !== "cave") continue; // cave keeps its rock collision; houses collide on interior furniture (below)
        // TQ-144: the rock bluff is DRAWN as an ellipse (drawCavePortal: rockDk rx152/ry112, rock rx132/ry96,
        // centred a touch ABOVE b.y at y-4/y-14), but the collider was footRect — a ±180-wide RECTANGLE. That
        // rect overhung the rounded rock (phantom walls in the open green either side + at the corners) and its
        // top edge stopped short of the rendered rock crown (a walk-into-rock gap up top). Match the visual:
        // block inside the rock ellipse, upper half only, so the glowing MOUTH + stone apron below stay open.
        const rx = 146, ry = 106, cyc = b.y - 8;        // a hair inside the drawn bluff so its edge reads solid, no margin
        const nx = (x - b.x) / rx, ny = (y - cyc) / ry;
        if (nx * nx + ny * ny < 1 && y < b.y - 6) return false; // upper rock blocks; mouth + apron (below b.y-6) stay walkable
      }
      // Houses are solid ROOMS: the perimeter WALLS block, except a doorway gap on the plaza-facing
      // entrance side, and the interior FURNITURE is solid too (you walk around it). Only evaluated when
      // the point is inside a footprint, so the plaza approach is never blocked.
      for (const b of buildings) {
        if (b.kind !== "house") continue;
        const ax = Math.abs(x - b.x), ay = Math.abs(y - b.y), hw = b.w / 2, hh = b.h / 2;
        if (ax > hw || ay > hh) continue;                                  // outside this footprint
        const wall = 8, ew = Math.max(48, Math.min(78, b.w * 0.15)), nearX = ax > hw - wall, nearY = ay > hh - wall;
        if (nearX || nearY) {                                              // in the wall band
          const entSide = (b.faceDown !== false) ? (y > b.y) : (y < b.y);  // the plaza-facing wall
          if (!(entSide && nearY && !nearX && ax < ew)) return false;      // solid unless it's the doorway opening
        }
        if (b.colliders) for (const c of b.colliders) { const dx = (x - c.x) / (c.rx + PR), dy = (y - c.y) / (c.ry + PR); if (dx * dx + dy * dy < 1) return false; }
      }
      // Decor props (well / lanterns / sign / stock) are small solids — walk around them.
      for (const d of decor) { const dx = x - d.x, dy = y - d.y, rr = d.r + 2; if (dx * dx + dy * dy < rr * rr) return false; }
      return true;
    }

    // Player state. Spawn where you left the village last (same character + still walkable), else the
    // central plaza, facing up. `returning` also retires the controls hint (a returning player knows).
    const returning = !!(lastHubPos && lastHubChar === characterId && walkable(lastHubPos.x, lastHubPos.y));
    const me = returning ? { ...lastHubPos } : { ...TILE(15, 13.5) };
    let dir = { x: 0, y: -1 };
    let moving = false;
    let camX = null, camY = null;         // smoothed follow-camera (lerps toward player + a small lookahead); inits to the player on first frame
    let movedTime = returning ? 999 : 0;  // cumulative move time — fades out the controls hint once learned (skip it for a returning player)
    let lastCluck = 0;                    // throttles the startled-hen cluck so walking through a flock isn't a racket
    let injured = false, injuredCheck = -999; // cached "team needs healing" flag (drives the Healer beacon); refreshed ~1s (first frame immediately)
    let teamHP = [];                      // cached per-active-monster hurt flags (drives the Vault's team orbs)
    // One-time WELCOME banner for a brand-new player — orients them to the goal (the cave) once, ever,
    // then never nags again (persisted flag). Auto-fades; non-blocking. Returning players never see it.
    // The clock starts on the FIRST draw (k.time() at scene-init isn't the same basis as at draw time).
    let welcomeShow = false, welcomeStart = -1;
    try { welcomeShow = !localStorage.getItem("tq_hub_welcomed"); if (welcomeShow) localStorage.setItem("tq_hub_welcomed", "1"); } catch { /* storage blocked */ }
    // Overlay keyboard/gamepad navigation: a focusable list of the open modal's buttons so the lobby's
    // core action (start a run) is usable without a mouse. Populated by each overlay; cleared on close.
    let navItems = null, navIdx = 0, navStickReady = true;
    let menuKeepsWorld = false; // the account dropdown keeps the village + HUD visible behind it (no dim/blank); set in openAcctMenu, cleared on close
    const OVERLAY_Z = 50; // stacking depth for an overlay that must sit ABOVE the immediate-mode world (which draws in the ~0.5 band)
    let near = null;                      // the building currently in reach (or null)
    let lastNearId = null;                // for a soft audio cue when you newly come within reach
    let hubStamina = GAME.SPRINT.STAMINA_MAX; // TQ-89: local sprint stamina for the lobby (no server authority here)
    let hubSprinting = false, hubWasSprinting = false;
    // Heal flourish: a green ring + rising "+" motes burst over the player when the Healer restores the
    // team (the heal resolves IN-scene, so it deserves a spatial reward, not just a text toast).
    let healFx = 0, healFxX = 0, healFxY = 0;
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
    // Mobile-only: touchPrimary() is true only when a finger is the primary input (phone/tablet),
    // NOT on a touchscreen laptop/desktop — those keep WASD + mouse-drag and show no virtual stick.
    const TOUCH = touchPrimary(k);
    const JOY_R = 70, IBTN_R = 44;
    let joyId = null, joyVec = { x: 0, y: 0 }, joyBase = k.vec2(0, 0), joyThumb = k.vec2(0, 0);

    // ── Server session foundation (ported from lobby.js — SP/MP unify, Phase A) ───────
    // The SERVER profile is the single source of truth for team/currency. Bind this slot to its
    // token-keyed server profile and establish the session on entry, so the Healer (net.heal) and
    // the Cave run-handshake work without a cold connect. (TQ-38/TQ-91 Option C: no local→server
    // import — everyone starts on the server profile.)
    const sessionOffs = [];
    function offSession() { sessionOffs.forEach((o) => o && o()); sessionOffs.length = 0; }
    function establishSession() {
      try {
        net.state.token = character.serverToken || net.state.token || null;
        sessionOffs.push(
          net.on("open", () => { try { net.join(nick()); } catch {} }),
          net.on("welcome", () => {
            if (net.state.token && net.state.token !== character.serverToken) {
              try { setCharacterServerToken(characterId, net.state.token); character.serverToken = net.state.token; } catch {}
            }
            // TQ-38 / TQ-91 Option C: no local→server import — everyone starts on the server profile.
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
      const gpEdges = gamepadPressed(); // once per frame (edge detection); A = interact/confirm, B/START = dismiss, START opens the menu
      if (overlayOpen) {
        // Controller drives the open modal: B / Back / Start dismisses (the Cancel buttons aren't stick-
        // navigable, so without this a gamepad-only player gets trapped); A activates the focused item;
        // the stick moves focus (edge-triggered via navStickReady so a held stick steps once per push).
        if (gpEdges.has(BTN.B) || gpEdges.has(BTN.START)) { try { net.unqueue(); } catch {} closeOverlay(); return; }
        if (gpEdges.has(BTN.A)) { navActivate(); return; }
        const gy = gamepadMove().y;
        if (Math.abs(gy) > 0.5) { if (navStickReady) { navMove(gy < 0 ? -1 : 1); navStickReady = false; } } else navStickReady = true;
        return; // otherwise freeze the player while a modal is up
      }
      // TQ-128: while the monster-detail popup is open, freeze movement/interaction (gamepad A/B/Start closes it).
      if (detailMon) { if (gpEdges.has(BTN.B) || gpEdges.has(BTN.A) || gpEdges.has(BTN.START)) detailMon = null; return; }
      // TQ-118: while a station popup is open, freeze the player; gamepad B/Start closes (A reserved for in-panel).
      if (stationPopup) {
        if (gpEdges.has(BTN.B) || gpEdges.has(BTN.START)) { closeStationPopup(); return; }
        // TQ-345: the run-launcher popup is the lobby's core action — keep it gamepad-usable: stick
        // chooses Singleplayer/Multiplayer, A confirms (the other popups stay tap-only).
        if (stationPopup.id === "portal") {
          if (gpEdges.has(BTN.A)) { portalActivate(); return; }
          const py = gamepadMove().y;
          if (Math.abs(py) > 0.5) { if (navStickReady) { stationPopup.state.focus = py < 0 ? 0 : 1; sfx("hover"); navStickReady = false; } } else navStickReady = true;
        }
        return;
      }
      if (gpEdges.has(BTN.A)) interact();
      else if (gpEdges.has(BTN.START)) openAcctMenu(); // Start = the account/options menu (its only gamepad route; A stays interact)
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
      if (moving) movedTime += k.dt(); // total time spent moving — retires the "how to move" hint once you've got it
      // TQ-89: sprint in the lobby, reusing the in-run rule. Sprint input = Shift / full joystick push /
      // full gamepad stick (same as onlineGame.js). sprintingNow gates on local stamina (+ hysteresis);
      // tickStamina drains while sprinting and regens otherwise — run EVERY frame so it recovers when idle.
      const sprintInput = k.isKeyDown("shift") || (joyVec.x * joyVec.x + joyVec.y * joyVec.y) > 0.85 || (gm.x * gm.x + gm.y * gm.y) > 0.85;
      hubSprinting = sprintingNow({ sprint: sprintInput, moving, stamina: hubStamina, wasSprinting: hubWasSprinting }, GAME);
      hubWasSprinting = hubSprinting;
      hubStamina = tickStamina(hubStamina, hubSprinting, k.dt(), GAME);
      if (moving) {
        dir = { x: dx, y: dy };
        const ml = Math.hypot(dx, dy) || 1; dx /= ml; dy /= ml; // unit direction → CONSTANT speed (no faster diagonals, no partial-stick slowdown); sprint applies a clean ×MULT on top
        const step = SPEED * sprintMult(hubSprinting, GAME) * k.dt();
        // Axis-separated collision against walkable() — slide along the tree ring + house walls.
        const nx = me.x + dx * step, ny = me.y + dy * step;
        if (walkable(nx + Math.sign(dx) * PR, me.y)) me.x = nx;
        if (walkable(me.x, ny + Math.sign(dy) * PR)) me.y = ny;
      }
      // The interactable building: the house you're standing INSIDE (walkable), else the nearest one
      // within reach of its front (the cave mouth / a house door edge).
      near = null;
      for (const s of stations) if (s.kind === "house" && Math.abs(me.x - s.x) < s.w / 2 && Math.abs(me.y - s.y) < s.h / 2) { near = s; break; }
      if (!near) {
        let best = REACH * REACH;
        for (const s of stations) {
          const fy = s.y + (s.kind === "cave" ? 44 : s.h / 2);
          const ddx = s.x - me.x, ddy = fy - me.y, d2 = ddx * ddx + ddy * ddy;
          if (d2 < best) { best = d2; near = s; }
        }
      }
      // Soft cue the moment you come within reach of a (new) station — discoverability + life. Fires
      // only on the transition (not every frame); the recipe is very quiet so it reads as a hint.
      const nid = near ? near.id : null;
      if (nid && nid !== lastNearId) sfx(near.kind === "cave" ? "portal" : "hover"); // the cave's approach sounds weightier than a house blip
      lastNearId = nid;
      // Roof fades open while you're INSIDE the (walkable) house footprint — a true "step inside" reveal.
      for (const b of buildings) if (b.kind === "house") {
        const inside = Math.abs(me.x - b.x) < b.w / 2 - 4 && Math.abs(me.y - b.y) < b.h / 2 - 4;
        if (inside && !b._inside && b.barks) b._barkPick = Math.floor(Math.random() * b.barks.length); // pick a fresh line each time you step in
        b._inside = inside;
        b.roofA += ((inside ? 0.08 : 1) - b.roofA) * Math.min(1, k.dt() * 6);
        // TQ-162: the station door swings OPEN when you're the active (within-reach) station or
        // standing inside, and closes when you leave — tied to the same `near` proximity that drives
        // the interaction prompt. Eased for a smooth swing; snaps under reduce-motion (no animation).
        if (b.doorA == null) b.doorA = 0;
        const doorTgt = (b === near || inside) ? 1 : 0;
        b.doorA += (doorTgt - b.doorA) * (reduce ? 1 : Math.min(1, k.dt() * 5));
      }
      // Chickens wander toward random nearby walkable targets, then peck a beat before re-targeting —
      // UNLESS the player walks up, which startles them into scurrying away: a reactive, living-world
      // touch (the world responds to you, not just ambient wander).
      for (const c of critters) {
        if (c.kind !== "chicken") continue;
        if (reduce) { c.moving = false; continue; } // a11y: freeze wandering under reduce-motion (static hens; the bob/peck is already gated)
        // Startle: while the player is close, keep retargeting a point directly AWAY from them so the
        // hen flees (and scurries faster); it settles back to idle wander once you step off.
        const pdx = c.x - me.x, pdy = c.y - me.y, pd = Math.hypot(pdx, pdy) || 1;
        const startled = pd < 72;
        if (startled) {
          if (!c.wasStartled && k.time() - lastCluck > 0.35) { sfx("cluck"); lastCluck = k.time(); } // soft cluck on the scatter (throttled across the flock)
          const fx = c.x + (pdx / pd) * 64, fy = c.y + (pdy / pd) * 64;
          if (walkable(fx, fy)) { c.tx = fx; c.ty = fy; }
          c.peck = 0; // too spooked to peck
        }
        c.wasStartled = startled;
        const dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy) || 1;
        if (d > 4) { const sp = (startled ? 82 : 34) * k.dt(); c.dir = dx < 0 ? -1 : 1; c.x += (dx / d) * sp; c.y += (dy / d) * sp; c.moving = true; }
        else {
          c.moving = false; c.peck = Math.max(0, c.peck - k.dt());
          if (c.peck <= 0) {
            const r = Math.random();
            if (r < 0.012) { const a = Math.random() * 6.283, rr = 24 + Math.random() * 90, nx = c.hx + Math.cos(a) * rr, ny = c.hy + Math.sin(a) * rr; if (walkable(nx, ny)) { c.tx = nx; c.ty = ny; } }
            else if (r < 0.03) c.peck = 0.5 + Math.random() * 0.4;
          }
        }
      }
      // Villagers stroll slowly between plaza spots, pausing to idle — people living in the village.
      for (const c of critters) {
        if (c.kind !== "villager") continue;
        if (reduce) { c.moving = false; c.greet = false; continue; }
        // Greet the player: when you pass close, the villager pauses, turns to you, and waves.
        const gpx = me.x - c.x, gpy = me.y - c.y, gpd = Math.hypot(gpx, gpy);
        c.greet = gpd < 84;
        if (c.greet) { c.moving = false; c.dir = gpx < 0 ? -1 : 1; if (c.pause < 0.3) c.pause = 0.3; continue; } // hold + face you while you're near
        const dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy) || 1;
        if (c.pause > 0) { c.pause -= k.dt(); c.moving = false; }
        else if (d > 4) { const sp = 26 * k.dt(); c.dir = dx < 0 ? -1 : 1; c.x += (dx / d) * sp; c.y += (dy / d) * sp; c.moving = true; }
        else { // arrived → pick a new stroll target + stand a moment
          c.moving = false;
          const a = Math.random() * 6.283, rr = 50 + Math.random() * 150, nx = c.hx + Math.cos(a) * rr, ny = c.hy + Math.sin(a) * rr;
          if (walkable(nx, ny)) { c.tx = nx; c.ty = ny; }
          c.pause = 1.4 + Math.random() * 3.5;
        }
      }
      // Refresh the "team needs healing" flag on a slow throttle (it drives the Healer beacon; cheap but
      // no need per-frame). Cleared instantly by healNow so the beacon vanishes the moment you heal.
      if (k.time() - injuredCheck > 1) { injuredCheck = k.time(); teamHP = (prof().activeMonsters || []).map(isHurt); injured = teamHP.some(Boolean); }
      // Smooth follow CAMERA with a gentle lookahead in the facing direction — the village pans
      // cinematically instead of snapping 1:1 to the player (premium game-feel). The lookahead is small
      // so the player stays well within the centred play square. Snapped (no drift) under reduce-motion.
      const laMag = moving && !reduce ? 34 : 0;
      const dl = Math.hypot(dir.x, dir.y) || 1;
      const tx = me.x + (dir.x / dl) * laMag, ty = me.y + (dir.y / dl) * laMag;
      if (camX == null || reduce) { camX = me.x; camY = me.y; }
      else { const f = Math.min(1, k.dt() * 4.5); camX += (tx - camX) * f; camY += (ty - camY) * f; }
      k.camPos(camX, camY);
    });

    // Interact: walk up to a station and press E / Enter / Space to use it.
    function interact() { if (!overlayOpen && near) { sfx("click"); haptic(8); near.act(); } }
    // E / Enter / Space CONFIRM: interact with a station while walking, or activate the focused button
    // when a modal is open — ONE handler per key. (Binding BOTH interact and navActivate to a key
    // double-fired on a single press: interact opened the picker, then navActivate instantly confirmed
    // its default option.) Arrows / W / S move focus within a modal (no-op while walking).
    const confirmKey = () => { if (stationPopup) { if (stationPopup.id === "portal") portalActivate(); return; } if (overlayOpen) navActivate(); else interact(); };
    k.onKeyPress("e", confirmKey);
    k.onKeyPress("enter", confirmKey);
    k.onKeyPress("space", confirmKey);
    k.onKeyPress("up", () => navMove(-1));
    k.onKeyPress("w", () => navMove(-1));
    k.onKeyPress("down", () => navMove(1));
    k.onKeyPress("s", () => navMove(1));

    // ── render the VILLAGE: forest floor → clearing → y-sorted trees/houses/player → labels → HUD ──
    k.onDraw(() => {
      if (overlayOpen && !menuKeepsWorld) return; // a focused modal (run picker) is up → skip the world for its dim backdrop; the account dropdown keeps the world visible behind it
      const t = k.time();
      k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: k.rgb(...floorCol), fixed: true }); // endless forest-floor backdrop (no black map border beyond the tile grid)
      drawTiles(k, campMap, me.x, me.y, tileCache, E); // continuous forest floor (no abyss)
      drawClearing();                                   // lift the village green + a worn plaza
      drawCanopyShade(t);                                // soft canopy-shade dapple (lush light-and-shade ground)
      drawPaths();                                       // dirt paths plaza → each building
      drawGroundScatter(t);                              // flat flowers + grass tufts + path pebbles
      drawForestFloor();                                 // mushrooms + ferns nestled at the treeline (woodland edge)
      // Depth: trees + buildings + decor + critters + player, sorted by base-y, drawn back→front.
      // VIEWPORT CULLING (TQ-49): the village extends well past the centred square play-window, so each
      // frame we skip the draw + per-frame animation work for anything fully off-screen — each house is
      // ~200 draw calls, so culling the buildings you're not looking at is the dominant saving on weak
      // devices. The camera follows the player 1:1 (see the tree cull this replaces), so me.x/me.y is the
      // view centre; margins pad by each prop's drawn half-extent so nothing pops in at the edge. Anything
      // on-screen draws/animates exactly as before, so the lobby's character is unchanged.
      const halfW = k.width() / 2, halfH = k.height() / 2;
      const inView = (x, y, mx, my) => Math.abs(x - me.x) <= halfW + mx && Math.abs(y - me.y) <= halfH + my;
      const props = [];
      for (const tr of trees) if (inView(tr.x, tr.y, 100, 150)) props.push({ y: tr.y, d: () => drawTree(tr, t) });
      for (const d of decor) if (inView(d.x, d.y, 72, 112)) props.push({ y: d.y, d: () => drawDecor(d, t) }); // lanterns/wells draw tall → pad y
      for (const c of critters) if (c.kind === "chicken" && inView(c.x, c.y, 48, 48)) props.push({ y: c.y, d: () => drawChicken(c, t) });
      for (const c of critters) if (c.kind === "villager" && inView(c.x, c.y, 48, 56)) props.push({ y: c.y, d: () => drawVillager(c, t) });
      // Sort the house you're INSIDE just before the player so YOU draw on top of the interior +
      // faded roof (you stand in the shop, not hidden behind the counter); others sort by base-y. The
      // building you're inside is never culled (you're standing in it). Pad by the footprint half-size
      // plus roof-peak/sign overhang so a building straddling the screen edge keeps drawing.
      for (const b of buildings) if (b._inside || inView(b.x, b.y, b.w / 2 + 96, b.h / 2 + 140)) props.push({ y: b._inside ? me.y - 1 : b.y, d: () => drawBuilding(b, t) });
      for (const b of buildings) if (b.kind === "house" && (b._inside || inView(b.x, b.y, b.w / 2 + 96, b.h / 2 + 140))) props.push({ y: b.y + (b.faceDown !== false ? b.h / 2 + 64 : -(b.h / 2 + 8)), d: () => drawBuildingSign(b) }); // emblem signs at the entrance, y-sorted (south-facing signs sit in front of the wall)
      props.push({ y: me.y, d: () => drawCharacter(k, { x: me.x, y: me.y, t, moving, color: cos.accent, cloak: cos.cloak, model: cos.model, dir, skin: getEquippedSkin(), scale: PLAYER_SCALE }) });
      props.sort((a, b) => a.y - b.y);
      for (const p of props) p.d();
      // TQ-89: a slim sprint-stamina bar under the player while it's draining/recovering (hidden at full,
      // so the calm lobby stays clean). World-space (inside the play window), teal → amber when low.
      if (hubStamina < GAME.SPRINT.STAMINA_MAX - 0.5) {
        const sr = Math.max(0, Math.min(1, hubStamina / GAME.SPRINT.STAMINA_MAX)), bw = 34;
        k.drawRect({ pos: k.vec2(me.x - bw / 2, me.y + 26), width: bw, height: 4, radius: 2, color: k.rgb(0, 0, 0), opacity: 0.4 });
        k.drawRect({ pos: k.vec2(me.x - bw / 2, me.y + 26), width: bw * sr, height: 4, radius: 2, color: k.rgb(...(sr > 0.3 ? THEME.teal : THEME.amber)) });
      }
      drawHealBurst(t);          // green heal flourish over the player when the Healer restores the team
      drawKeeperBarks(t);        // a keeper's greeting bubble, fading in as you step inside their building
      drawHealBeacon(t);         // pulsing healing-cross over the Healer when your team needs healing
      drawLabels(t);             // building name plates + the active ring / E bubble, over the props
      drawPlayWindow(k, { maxAspect: 4 / 3 }); // TQ-96: lobby uses the same ~4:3 play window as a run (never in combat → always wider-than-square); HUD lives in the gutters
      drawHud();
      drawTouchControls();
      drawDetailPopup();         // TQ-128: shared monster-detail popup over everything (its own scrim) when open
      drawStationPopupHub();     // TQ-118: in-lobby station popup (Bestiary pilot) over the village
    });

    // The village green: a warmer lifted clearing over the forest floor + a trodden dirt plaza, so the
    // open village reads distinct from the darker tree-filled forest around it.
    function drawClearing() {
      // Lifted green over each lobe, drawn as a 3-step radial FALLOFF (wide+faint → tight+brighter) so
      // each lobe's edge fades out instead of ending in a hard ring — overlaps then blend with no
      // visible seams, while the union still matches the lobed walkable shape (not a circle).
      for (let i = 0; i < LOBES.length; i++) {
        const L = LOBES[i], cx = L[0] * E, cy = L[1] * E, rx = L[2] * E, ry = L[3] * E;
        k.drawEllipse({ pos: k.vec2(cx, cy), radiusX: rx * 1.04, radiusY: ry * 1.04, color: k.rgb(94, 130, 84), opacity: 0.045 });
        k.drawEllipse({ pos: k.vec2(cx, cy), radiusX: rx * 0.80, radiusY: ry * 0.80, color: k.rgb(100, 138, 88), opacity: 0.05 });
        k.drawEllipse({ pos: k.vec2(cx, cy), radiusX: rx * 0.52, radiusY: ry * 0.52, color: k.rgb(108, 146, 92), opacity: 0.055 });
      }
      k.drawEllipse({ pos: k.vec2(VCX * E, VCY * E + 12), radiusX: 5.4 * E, radiusY: 3.3 * E, color: k.rgb(122, 106, 80), opacity: 0.16 });
    }

    // Soft CANOPY SHADE dappling the clearing — large faint pools of deep-green shade cast by the
    // surrounding forest canopy onto the open green. Pure ground tone (drawn under paths/scatter/props):
    // it breaks the flat green wash into lush light-and-shade and, with the bright central hearth glow,
    // forms a natural focal vignette (shaded edges → lit centre). Hash-stable sizes + a barely-there
    // canopy drift (frozen under reduce-motion); world-space, culled to view.
    function drawCanopyShade(t) {
      const vx = k.width() / 2 + 110, vy = k.height() / 2 + 110;
      for (let i = 0; i < SHADE.length; i++) {
        const a = SHADE[i];
        const cx = a[0] * E + (reduce ? 0 : Math.sin(t * 0.22 + i * 1.3) * 8);
        const cy = a[1] * E + (reduce ? 0 : Math.cos(t * 0.18 + i) * 5);
        if (Math.abs(cx - me.x) > vx || Math.abs(cy - me.y) > vy) continue;
        const rx = (2.5 + hash(i * 7 + 3, i * 13 + 5) * 1.7) * E;
        k.drawEllipse({ pos: k.vec2(cx, cy), radiusX: rx, radiusY: rx * 0.72, color: k.rgb(40, 70, 48), opacity: 0.085 });
      }
    }

    // Worn DIRT PATHS plaza → every building front: a tapered ribbon of dirt ellipses. Flat (under
    // the props) so trees/buildings/the player draw on top.
    function drawPaths() {
      const px = VCX * E, py = VCY * E, dirt = [120, 102, 76], dirtDk = [96, 80, 58], dirtLt = [142, 122, 92];
      const PRX = 58, PRY = 42; // central paved platform radii
      // CENTRAL PAVED PLATFORM — a small circle of irregular flagstones at the plaza centre (user 2026-06-11).
      k.drawEllipse({ pos: k.vec2(px, py + 5), radiusX: PRX + 5, radiusY: PRY + 4, color: k.rgb(0, 0, 0), opacity: 0.16 });
      k.drawEllipse({ pos: k.vec2(px, py), radiusX: PRX, radiusY: PRY, color: k.rgb(...STONE_DK) });           // mortar base
      k.drawEllipse({ pos: k.vec2(px, py), radiusX: 19, radiusY: 14, color: k.rgb(...STONE) });                // centre flagstone
      for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2 + 0.4, sc = 0.8 + hash(i * 9, 3) * 0.5; k.drawEllipse({ pos: k.vec2(px + Math.cos(a) * 38, py + Math.sin(a) * 27), radiusX: 13 * sc, radiusY: 10 * sc, color: k.rgb(...(hash(i, 5) > 0.5 ? STONE : STONE_LT)) }); } // ring of flagstones (gaps show mortar)
      // A decorative COMPASS-STAR mosaic inlaid at the plaza heart — marks the centre as a designed town
      // square (flat; the player stands on it). Faint stone tones with a teal spirit-accent centre.
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2, lr = (i % 2 ? 16 : 30); k.drawLine({ p1: k.vec2(px, py), p2: k.vec2(px + Math.cos(a) * lr, py + Math.sin(a) * lr * 0.72), width: i % 2 ? 1.5 : 2.5, color: k.rgb(...STONE_LT), opacity: 0.4 }); }
      k.drawEllipse({ pos: k.vec2(px, py), radiusX: 9, radiusY: 6.5, fill: false, outline: { width: 1.5, color: k.rgb(...THEME.teal) }, opacity: 0.22 });
      k.drawCircle({ pos: k.vec2(px, py), radius: 2.6, color: k.rgb(...THEME.teal), opacity: 0.28 });
      // PELLETS scattered RANDOMLY along each path (no straight ribbon), starting OUTSIDE the platform so
      // they don't pile up in the middle — varied size/tone, wandering off the line (user feedback).
      buildings.forEach((b, bi) => {
        const ey = b.y + (b.kind === "cave" ? 34 : b.faceDown !== false ? b.h / 2 + 50 : -(b.h / 2 + 2)); // lead to the ENTRANCE: south-facing houses now have their door on the dropped south WALL (~50px below the footprint), so reach that, not the eave
        const dx = b.x - px, dy = ey - py, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
        for (let i = 0; i < 26; i++) {
          const f = hash(bi * 131 + i * 7, 11);              // random position along the route
          if (f * len < PRX + 16) continue;                  // skip near the platform → not stacked in the middle
          const perp = (hash(bi * 53 + i, 13) - 0.5) * 26;   // wander off the line
          const x = px + dx * f + nx * perp, y = py + dy * f + ny * perp;
          const w = 4 + hash(bi * 17 + i, 3) * 7;            // varied pellet size
          const tone = hash(bi * 7 + i, 5), col = tone < 0.3 ? dirtDk : tone > 0.8 ? dirtLt : dirt;
          k.drawEllipse({ pos: k.vec2(x, y), radiusX: w, radiusY: w * 0.66, color: k.rgb(...col), opacity: 0.32 + hash(bi + i, 9) * 0.22 });
        }
        // a worn-dirt DOORSTEP just outside each house entrance — the path visibly ARRIVES at the door
        if (b.kind === "house") {
          const doorY = b.y + (b.faceDown !== false ? b.h / 2 + 50 : -(b.h / 2 + 22)); // south-facing door sits on the dropped wall
          k.drawEllipse({ pos: k.vec2(b.x, doorY), radiusX: 34, radiusY: 16, color: k.rgb(...dirtDk), opacity: 0.24 });
          k.drawEllipse({ pos: k.vec2(b.x, doorY), radiusX: 25, radiusY: 11, color: k.rgb(...dirt), opacity: 0.3 });
        }
      });
    }

    // Flat ground scatter — deterministic flowers + grass tufts in the green (hash-stable, culled to
    // view). Cheap per-frame; adds life without z-sorting (they're tiny + flat).
    const FLOWERS = [[235, 120, 150], [240, 222, 120], [176, 152, 240], [238, 240, 250]];
    // A WIND-GUST front sweeping across the village every ~10s — foliage (trees + grass + flowers) leans
    // harder as it passes, so the breeze reads as dynamic weather rather than a static sine loop. Returns
    // an extra rightward sway offset (px) for a given world-x. Frozen flat under reduce-motion.
    const GUST_PERIOD = 10;
    function gust(t, wx) {
      if (reduce) return 0;
      const phase = (t % GUST_PERIOD) / GUST_PERIOD;          // 0..1 each cycle
      const frontX = (phase * 1.4 - 0.2) * (GRID * E);        // sweeps L→R across the grid (with lead-in/out)
      const d = (wx - frontX) / 220;                          // band ~220px around the front
      const band = Math.exp(-d * d);                          // gaussian falloff at the gust front
      return band * 4.5 * (0.82 + 0.18 * Math.sin(t * 9 + wx * 0.05)); // up to ~4.5px lean + a fine shiver
    }
    // Woodland-floor detail nestled at the clearing EDGE (the ring just outside the walkable green, among
    // the first trees) — red-capped mushroom clusters + fern tufts, so the treeline reads as a living
    // forest floor rather than a uniform wall of trunks. Flat (drawn under the trees), hash-stable, static.
    function drawForestFloor() {
      const vx = k.width() / 2 + 90, vy = k.height() / 2 + 90;
      for (let tx = 0; tx < GRID; tx++) for (let ty = 0; ty < GRID; ty++) {
        const wx = (tx + 0.5) * E, wy = (ty + 0.5) * E;
        if (Math.abs(wx - me.x) > vx || Math.abs(wy - me.y) > vy) continue;
        const e = ellip(tx + 0.5, ty + 0.5);
        if (e < 0.88 || e > 1.42) continue;            // the grassy fringe + the ring just outside the clearing
        if (hash(tx, ty, 21) > 0.6) continue;          // sparse-ish
        const gx = wx + (hash(tx, ty, 22) - 0.5) * 60, gy = wy + (hash(tx, ty, 23) - 0.5) * 60;
        if (hash(tx, ty, 24) < 0.5) {                  // a small mushroom cluster (red caps + pale stems)
          for (let i = 0; i < 3; i++) { const mx = gx + (i - 1) * 6, my = gy + (i % 2) * 3; k.drawRect({ pos: k.vec2(mx - 1.5, my - 2), width: 3, height: 6, radius: 1, color: k.rgb(228, 218, 198) }); k.drawEllipse({ pos: k.vec2(mx, my - 3), radiusX: 4, radiusY: 2.6, color: k.rgb(202, 92, 78) }); k.drawCircle({ pos: k.vec2(mx - 1, my - 3.6), radius: 0.8, color: k.rgb(246, 236, 220), opacity: 0.85 }); }
        } else {                                       // a fern tuft (fronds splaying from a base)
          for (let i = -2; i <= 2; i++) k.drawLine({ p1: k.vec2(gx, gy + 2), p2: k.vec2(gx + i * 4, gy - 9 - Math.abs(i) * 1.5), width: 1.5, color: k.rgb(72, 112, 66), opacity: 0.72 });
        }
      }
    }
    function drawGroundScatter(t) {
      const vx = k.width() / 2 + 70, vy = k.height() / 2 + 70;
      for (let tx = 2; tx < GRID - 1; tx++) for (let ty = 2; ty < GRID - 1; ty++) {
        const wx = (tx + 0.5) * E, wy = (ty + 0.5) * E;
        if (Math.abs(wx - me.x) > vx || Math.abs(wy - me.y) > vy) continue;
        if (ellip(tx + 0.5, ty + 0.5) > 0.98) continue; // only on the green
        // A WILDFLOWER MEADOW reclaiming the old forge plot (NW) — denser + flower-biased scatter so the
        // quieter quadrant reads as an intentional garden, not an empty gap left by the removed smithy.
        const meadow = Math.hypot(tx + 0.5 - 9.5, ty + 0.5 - 7) < 3;
        const h0 = hash(tx, ty, 7);
        if (h0 > (meadow ? 0.78 : 0.46)) continue;
        const gx = wx + (hash(tx, ty, 8) - 0.5) * 58, gy = wy + (hash(tx, ty, 9) - 0.5) * 58;
        // Reactive foliage: the tuft/flower TOP bends away from the player as you pass (you part the
        // grass + wildflowers) — fits the reactive village (hens scatter, dust kicks up). Frozen under
        // reduce-motion. Cheap: only visible scatter, one distance check each.
        // Gentle ambient WIND sway (matches the swaying trees/planters) PLUS the reactive player-parting.
        let bx = reduce ? 0 : Math.sin(t * 1.1 + tx * 0.6 + ty * 0.4) * 1.6 + gust(t, gx) * 0.55;
        if (!reduce) { const ddx = gx - me.x, ddy = (gy - 7) - me.y, d = Math.hypot(ddx, ddy); if (d < 40) bx += (ddx / (d || 1)) * (1 - d / 40) * 5; }
        if (h0 < (meadow ? 0.16 : 0.32)) { // grass tuft
          for (let i = -1; i <= 1; i++) k.drawLine({ p1: k.vec2(gx + i * 3, gy), p2: k.vec2(gx + i * 4 + bx, gy - 7 - (i === 0 ? 3 : 0)), width: 2, color: k.rgb(...LEAF_LT), opacity: 0.5 });
        } else { // flower
          const c = FLOWERS[Math.floor(hash(tx, ty, 10) * FLOWERS.length)];
          k.drawLine({ p1: k.vec2(gx, gy), p2: k.vec2(gx + bx, gy - 6), width: 1.5, color: k.rgb(...LEAF), opacity: 0.6 });
          k.drawCircle({ pos: k.vec2(gx + bx, gy - 7), radius: 2.6, color: k.rgb(...c), opacity: 0.85 });
          k.drawCircle({ pos: k.vec2(gx + bx, gy - 7), radius: 1, color: k.rgb(245, 235, 150), opacity: 0.9 });
        }
      }
    }

    // A wandering CHICKEN (white hen): shadow, legs, plump body, tail, head with beak/comb/eye; the
    // head dips while pecking, the body bobs while walking. Mirrored by c.dir.
    // A strolling VILLAGER (townsperson) — simple robed figure with a walk bob + stride; palette varies.
    function drawVillager(c, t) {
      const x = c.x, p = c.pal, fl = c.dir;
      const moving = c.moving && !reduce;
      const bob = moving ? Math.abs(Math.sin(t * 8 + c.ph)) * 1.5 : 0, yy = c.y - bob;
      const sw = moving ? Math.sin(t * 8 + c.ph) * 2.5 : 0;
      k.drawEllipse({ pos: k.vec2(x, c.y + 8), radiusX: 9, radiusY: 3, color: k.rgb(0, 0, 0), opacity: 0.2 });                 // shadow
      k.drawRect({ pos: k.vec2(x - 5 + sw, yy + 2), width: 4, height: 9, radius: 1, color: k.rgb(...p.robeDk) });            // legs
      k.drawRect({ pos: k.vec2(x + 1 - sw, yy + 2), width: 4, height: 9, radius: 1, color: k.rgb(...p.robeDk) });
      k.drawEllipse({ pos: k.vec2(x - 8, yy - 1), radiusX: 3, radiusY: 7, color: k.rgb(...p.robe) });                        // arms
      k.drawEllipse({ pos: k.vec2(x + 8, yy - 1), radiusX: 3, radiusY: 7, color: k.rgb(...p.robe) });
      k.drawEllipse({ pos: k.vec2(x, yy - 1), radiusX: 9, radiusY: 12, color: k.rgb(...p.robe) });                           // body / tunic
      k.drawRect({ pos: k.vec2(x - 8, yy + 3), width: 16, height: 8, radius: 3, color: k.rgb(...p.robe) });                 // hem
      k.drawEllipse({ pos: k.vec2(x - 4, yy - 3), radiusX: 2.5, radiusY: 7, color: k.rgb(...p.robeDk), opacity: 0.35 });    // fold shading
      k.drawCircle({ pos: k.vec2(x, yy - 14), radius: 6, color: k.rgb(...p.skin) });                                        // head
      k.drawEllipse({ pos: k.vec2(x, yy - 17), radiusX: 6.5, radiusY: 4.5, color: k.rgb(...p.hair) });                      // hair
      k.drawEllipse({ pos: k.vec2(x - 6, yy - 14), radiusX: 1.6, radiusY: 3, color: k.rgb(...p.hair) });                    // side hair
      k.drawEllipse({ pos: k.vec2(x + 6, yy - 14), radiusX: 1.6, radiusY: 3, color: k.rgb(...p.hair) });
      k.drawCircle({ pos: k.vec2(x - 2 + fl * 0.6, yy - 13), radius: 1.1, color: k.rgb(44, 32, 30) });                      // eyes (toward walk dir)
      k.drawCircle({ pos: k.vec2(x + 2 + fl * 0.6, yy - 13), radius: 1.1, color: k.rgb(44, 32, 30) });
      if (c.greet && !reduce) { // a friendly WAVE when you pass — the village acknowledges you
        const hand = yy - 9 + Math.sin(t * 7 + c.ph) * 2;
        k.drawEllipse({ pos: k.vec2(x + fl * 9, yy - 4), radiusX: 3, radiusY: 6, color: k.rgb(...p.robe) });                // raised arm
        k.drawCircle({ pos: k.vec2(x + fl * 11, hand), radius: 2.6, color: k.rgb(...p.skin) });                            // waving hand
        k.drawEllipse({ pos: k.vec2(x + fl * 0.6, yy - 11), radiusX: 2.6, radiusY: 1.3, color: k.rgb(150, 90, 80), opacity: 0.55 }); // smile
      }
    }
    function drawChicken(c, t) {
      const x = c.x, y = c.y, fl = c.dir;
      const bob = (c.moving && !reduce) ? Math.abs(Math.sin(t * 11)) * 2 : 0;
      const peckY = c.peck > 0 ? 4 : 0;
      k.drawEllipse({ pos: k.vec2(x, y + 5), radiusX: 9, radiusY: 3, color: k.rgb(0, 0, 0), opacity: 0.2 });
      k.drawLine({ p1: k.vec2(x - 2, y), p2: k.vec2(x - 2, y + 5), width: 1.5, color: k.rgb(222, 168, 60) });
      k.drawLine({ p1: k.vec2(x + 2, y), p2: k.vec2(x + 2, y + 5), width: 1.5, color: k.rgb(222, 168, 60) });
      k.drawEllipse({ pos: k.vec2(x - fl * 8, y - 9 - bob), radiusX: 4, radiusY: 6, color: k.rgb(222, 222, 212) }); // tail
      k.drawEllipse({ pos: k.vec2(x, y - 6 - bob), radiusX: 9, radiusY: 8, color: k.rgb(240, 240, 232) });        // body
      const hx = x + fl * 7, hy = y - 12 - bob + peckY;
      k.drawCircle({ pos: k.vec2(hx, hy), radius: 4.5, color: k.rgb(240, 240, 232) });
      k.drawEllipse({ pos: k.vec2(hx - fl * 1, hy - 5), radiusX: 2.4, radiusY: 3, color: k.rgb(222, 72, 72) });   // comb
      k.drawRect({ pos: k.vec2(hx + fl * 3, hy - 1.2), width: 4, height: 2.4, color: k.rgb(242, 172, 40) });      // beak
      k.drawCircle({ pos: k.vec2(hx + fl * 1, hy - 1), radius: 0.9, color: k.rgb(40, 30, 30) });                  // eye
      k.drawEllipse({ pos: k.vec2(hx - fl * 2, hy + 3), radiusX: 2, radiusY: 1.4, color: k.rgb(222, 72, 72), opacity: 0.8 }); // wattle
    }

    // ── Village decor props (y-sorted with buildings; collision in walkable). ──
    function drawDecor(d, t) {
      if (d.kind === "well") drawWell(d.x, d.y, t);
      else if (d.kind === "fountain") drawFountain(d.x, d.y, t);
      else if (d.kind === "lantern") drawLantern(d.x, d.y, t);
      else if (d.kind === "sign") drawSignpost(d.x, d.y);
      else if (d.kind === "barrel") drawBarrelProp(d.x, d.y);
      else if (d.kind === "crate") drawCrateProp(d.x, d.y);
      else if (d.kind === "planter") drawPlanter(d.x, d.y, t);
      else if (d.kind === "bench") drawBench(d.x, d.y, t, d.cat, d.basket);
    }
    // The HEALER's glowing FOUNTAIN — a two-tier stone fountain of luminous healing water with an
    // upward jet, water spilling between bowls, and rising restorative motes (restored from the
    // pre-village healer's "font", made into a proper fountain). Green spirit-glow.
    function drawFountain(x, y, t) {
      const glow = HEAL, pulse = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 2.2);
      k.drawEllipse({ pos: k.vec2(x, y + 12), radiusX: 42, radiusY: 14, color: k.rgb(0, 0, 0), opacity: 0.22 }); // shadow
      // Lower basin + water.
      k.drawEllipse({ pos: k.vec2(x, y), radiusX: 38, radiusY: 22, color: k.rgb(...STONE_DK) });
      k.drawEllipse({ pos: k.vec2(x, y - 2), radiusX: 35, radiusY: 19, color: k.rgb(...STONE) });
      k.drawEllipse({ pos: k.vec2(x, y - 2), radiusX: 28, radiusY: 14, color: k.rgb(20, 50, 44) });
      k.drawEllipse({ pos: k.vec2(x, y - 3), radiusX: 24, radiusY: 11, color: k.rgb(...glow), opacity: 0.4 + 0.22 * pulse });
      k.drawEllipse({ pos: k.vec2(x - 7, y - 5), radiusX: 11, radiusY: 3.5, color: k.rgb(210, 255, 225), opacity: 0.32 * pulse }); // highlight
      // Rim stones.
      for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; k.drawCircle({ pos: k.vec2(x + Math.cos(a) * 33, y - 2 + Math.sin(a) * 18), radius: 3.4, color: k.rgb(...STONE_LT), opacity: 0.5 }); }
      // Central pillar + upper bowl + its glowing water.
      k.drawRect({ pos: k.vec2(x - 6, y - 30), width: 12, height: 30, radius: 3, color: k.rgb(...STONE) });
      k.drawRect({ pos: k.vec2(x - 6, y - 30), width: 4, height: 30, color: k.rgb(...STONE_LT), opacity: 0.5 });
      k.drawEllipse({ pos: k.vec2(x, y - 30), radiusX: 18, radiusY: 9, color: k.rgb(...STONE_DK) });
      k.drawEllipse({ pos: k.vec2(x, y - 31), radiusX: 15, radiusY: 7, color: k.rgb(...STONE) });
      k.drawEllipse({ pos: k.vec2(x, y - 32), radiusX: 11, radiusY: 5, color: k.rgb(...glow), opacity: 0.5 + 0.25 * pulse });
      if (!reduce) {
        for (let i = 0; i < 5; i++) { const f = (t * 1.5 + i * 0.2) % 1; k.drawCircle({ pos: k.vec2(x + Math.sin(t * 3 + i) * 3, y - 34 - f * 17), radius: Math.max(0.5, 2 - f * 1.5), color: k.rgb(...glow), opacity: 0.6 * (1 - f) }); }           // upward jet
        for (const sx of [-13, 13]) for (let i = 0; i < 3; i++) { const f = (t * 1.7 + i * 0.33 + (sx > 0 ? 0.5 : 0)) % 1; k.drawCircle({ pos: k.vec2(x + sx, y - 30 + f * 27), radius: 1.4, color: k.rgb(...glow), opacity: 0.5 * (1 - f) }); } // spill between bowls
        for (let i = 0; i < 4; i++) { const f = (t * 0.45 + i * 0.17) % 1; k.drawCircle({ pos: k.vec2(x + Math.sin(t * 1.2 + i * 2) * 22, y - 4 - f * 50), radius: Math.max(0.4, (1 - f) * 2.4), color: k.rgb(...glow), opacity: 0.42 * (1 - f) }); }            // rising healing motes (TQ-295: 6 -> 4, calmer)
      }
    }
    // A stone WELL with an A-frame roof + hanging bucket — the village focal point.
    function drawWell(x, y, t) {
      k.drawEllipse({ pos: k.vec2(x, y + 10), radiusX: 30, radiusY: 12, color: k.rgb(0, 0, 0), opacity: 0.22 });
      k.drawEllipse({ pos: k.vec2(x, y), radiusX: 28, radiusY: 18, color: k.rgb(...STONE_DK) });
      k.drawEllipse({ pos: k.vec2(x, y - 2), radiusX: 26, radiusY: 16, color: k.rgb(...STONE) });
      k.drawEllipse({ pos: k.vec2(x, y - 2), radiusX: 18, radiusY: 11, color: k.rgb(18, 38, 54) });
      k.drawEllipse({ pos: k.vec2(x, y - 3), radiusX: 14, radiusY: 8, color: k.rgb(...THEME.water), opacity: 0.38 });
      if (!reduce) { // gentle life on the village's focal point: a drifting surface glint + a slow ripple
        const rf = (t * 0.32) % 1;
        k.drawEllipse({ pos: k.vec2(x, y - 3), radiusX: 3 + rf * 11, radiusY: 2 + rf * 6, fill: false, outline: { width: 1, color: k.rgb(...THEME.water) }, opacity: 0.22 * (1 - rf) });
        k.drawEllipse({ pos: k.vec2(x + Math.sin(t * 0.7) * 6, y - 3 + Math.cos(t * 0.9) * 2.5), radiusX: 4.5, radiusY: 1.8, color: k.rgb(205, 230, 245), opacity: 0.16 + 0.12 * Math.sin(t * 1.6) });
      }
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; k.drawCircle({ pos: k.vec2(x + Math.cos(a) * 24, y - 2 + Math.sin(a) * 15), radius: 3.6, color: k.rgb(...STONE_LT), opacity: 0.5 }); }
      k.drawRect({ pos: k.vec2(x - 22, y - 46), width: 5, height: 48, color: k.rgb(...WOOD_DK) });
      k.drawRect({ pos: k.vec2(x + 17, y - 46), width: 5, height: 48, color: k.rgb(...WOOD_DK) });
      k.drawRect({ pos: k.vec2(x - 31, y - 54), width: 62, height: 13, radius: 3, color: k.rgb(...WOOD) });
      k.drawRect({ pos: k.vec2(x - 31, y - 54), width: 62, height: 4, radius: 2, color: k.rgb(...WOOD_LT), opacity: 0.6 });
      const bsway = reduce ? 0 : Math.sin(t * 1.3) * 2.5; // bucket gently swings on its rope (pivot at the winch)
      k.drawLine({ p1: k.vec2(x, y - 49), p2: k.vec2(x + bsway, y - 13), width: 1.5, color: k.rgb(...WOOD_DK) });
      k.drawRect({ pos: k.vec2(x - 5 + bsway, y - 16), width: 10, height: 9, radius: 2, color: k.rgb(...WOOD) });
      k.drawRect({ pos: k.vec2(x - 5 + bsway, y - 16), width: 10, height: 2.5, color: k.rgb(...WOOD_LT), opacity: 0.6 });
    }
    // A LANTERN post — warm flickering light + a soft glow disc on the path (the village's night-light).
    function drawLantern(x, y, t) {
      const flick = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 6 + x * 0.1);
      // Warm light POOL on the ground — layered radial falloff (wide+faint → tight+warm) so the lantern
      // actually lights its surroundings at dusk instead of a flat disc; flanking the paths, it marks the
      // lit way to the cave. Top-down ellipse (wider than tall).
      k.drawEllipse({ pos: k.vec2(x, y + 2), radiusX: 54, radiusY: 31, color: k.rgb(255, 188, 92), opacity: 0.06 * flick });
      k.drawEllipse({ pos: k.vec2(x, y + 1), radiusX: 35, radiusY: 20, color: k.rgb(255, 198, 110), opacity: 0.09 * flick });
      k.drawEllipse({ pos: k.vec2(x, y),     radiusX: 18, radiusY: 11, color: k.rgb(255, 216, 142), opacity: 0.12 * flick });
      k.drawEllipse({ pos: k.vec2(x, y + 4), radiusX: 7, radiusY: 3, color: k.rgb(0, 0, 0), opacity: 0.2 });
      k.drawRect({ pos: k.vec2(x - 2.5, y - 46), width: 5, height: 50, radius: 2, color: k.rgb(...WOOD_DK) });
      k.drawRect({ pos: k.vec2(x - 9, y - 48), width: 14, height: 4, radius: 2, color: k.rgb(...WOOD_DK) });
      k.drawCircle({ pos: k.vec2(x + 8, y - 44), radius: 11, color: k.rgb(255, 196, 110), opacity: 0.18 * flick });
      k.drawRect({ pos: k.vec2(x + 3, y - 51), width: 11, height: 15, radius: 3, color: k.rgb(...WOOD) });
      k.drawRect({ pos: k.vec2(x + 4.5, y - 49), width: 8, height: 11, radius: 2, color: k.rgb(255, 212, 132), opacity: 0.5 + 0.45 * flick });
      // A few embers drifting up from the flame — the lantern reads as a live fire, not a painted lamp.
      if (!reduce) for (let i = 0; i < 3; i++) { const f = (t * 0.7 + i * 0.34 + x * 0.01) % 1; k.drawCircle({ pos: k.vec2(x + 8 + Math.sin(t * 2 + i * 2) * 3, y - 46 - f * 20), radius: Math.max(0.3, (1 - f) * 1.6), color: k.rgb(255, 198, 122), opacity: 0.55 * (1 - f) }); }
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
    // A wooden plaza BENCH (top-down) — a gathering spot that furnishes the open square. Backrest +
    // slatted seat + four legs + a soft shadow; subtle plank seams + a top sheen for the carved look.
    function drawBench(x, y, t, cat, basket) {
      k.drawEllipse({ pos: k.vec2(x, y + 9), radiusX: 28, radiusY: 6, color: k.rgb(0, 0, 0), opacity: 0.2 });          // shadow
      for (const lx of [-22, 22]) for (const ly of [-1, 7]) k.drawRect({ pos: k.vec2(x + lx - 2, y + ly), width: 4, height: 7, color: k.rgb(...WOOD_DK) }); // legs
      k.drawRect({ pos: k.vec2(x - 27, y - 13), width: 54, height: 7, radius: 2, color: k.rgb(...WOOD_DK) });          // backrest rail
      for (let i = 0; i < 5; i++) k.drawRect({ pos: k.vec2(x - 22 + i * 11, y - 12), width: 3, height: 8, color: k.rgb(...WOOD), opacity: 0.6 }); // back slats
      k.drawRect({ pos: k.vec2(x - 27, y - 5), width: 54, height: 13, radius: 3, color: k.rgb(...WOOD) });             // seat plank
      k.drawRect({ pos: k.vec2(x - 27, y - 5), width: 54, height: 4, radius: 2, color: k.rgb(...WOOD_LT), opacity: 0.5 }); // sheen
      for (let i = 1; i < 5; i++) k.drawLine({ p1: k.vec2(x - 27 + i * 10.8, y - 5), p2: k.vec2(x - 27 + i * 10.8, y + 8), width: 1, color: k.rgb(...WOOD_DK), opacity: 0.4 }); // seams
      if (cat) {
        // A SLEEPING VILLAGE CAT curled on the seat — the cozy "someone lives here" pet. Soft grey tabby
        // (palette-independent); gentle breathing under motion, perfectly still under reduce-motion.
        const anim = typeof t === "number" && !reduce;
        const cx = x + 8, cy = y - 1, br = anim ? Math.sin(t * 1.6) * 0.5 : 0;
        const flick = anim && Math.sin(t * 0.6 + x) > 0.86 ? Math.sin(t * 11) * 3 : 0; // an occasional sleepy tail-tip twitch
        const fur = [172, 162, 148], furDk = [132, 122, 110];
        k.drawEllipse({ pos: k.vec2(cx, cy + 1), radiusX: 14, radiusY: 8.5 + br, color: k.rgb(...fur) });               // curled body
        k.drawEllipse({ pos: k.vec2(cx + 12, cy + 3 + flick), radiusX: 7, radiusY: 3, color: k.rgb(...furDk) });        // tail wrapped to the front (flicks now and then)
        for (let i = 0; i < 4; i++) k.drawLine({ p1: k.vec2(cx - 6 + i * 5, cy - 3), p2: k.vec2(cx - 7 + i * 5, cy + 5), width: 1, color: k.rgb(...furDk), opacity: 0.4 }); // faint tabby stripes
        k.drawEllipse({ pos: k.vec2(cx - 10, cy - 1), radiusX: 6, radiusY: 5.5, color: k.rgb(...fur) });                // head tucked in
        k.drawEllipse({ pos: k.vec2(cx - 13, cy - 5), radiusX: 2.2, radiusY: 2.8, color: k.rgb(...fur) });              // ears
        k.drawEllipse({ pos: k.vec2(cx - 7, cy - 5), radiusX: 2.2, radiusY: 2.8, color: k.rgb(...fur) });
        k.drawLine({ p1: k.vec2(cx - 13, cy), p2: k.vec2(cx - 9.5, cy), width: 1.2, color: k.rgb(...furDk), opacity: 0.75 }); // closed eye (asleep)
      }
      if (basket) {
        // A woven MARKET BASKET of produce resting on the seat — a little village-square life.
        const bx0 = x - 1, by0 = y - 2;
        k.drawRect({ pos: k.vec2(bx0 - 14, by0 - 1), width: 28, height: 12, radius: 5, color: k.rgb(150, 110, 66) });        // basket body
        for (let i = 1; i < 4; i++) k.drawLine({ p1: k.vec2(bx0 - 14 + i * 7, by0 - 1), p2: k.vec2(bx0 - 14 + i * 7, by0 + 11), width: 1, color: k.rgb(116, 84, 50), opacity: 0.6 }); // weave
        k.drawEllipse({ pos: k.vec2(bx0, by0 - 1), radiusX: 14, radiusY: 4, color: k.rgb(170, 128, 80) });                   // rim
        k.drawCircle({ pos: k.vec2(bx0 - 6, by0 - 3), radius: 4, color: k.rgb(...THEME.danger) });                          // produce
        k.drawCircle({ pos: k.vec2(bx0 + 1, by0 - 4.5), radius: 4.5, color: k.rgb(...HEAL) });
        k.drawCircle({ pos: k.vec2(bx0 + 7, by0 - 3), radius: 4, color: k.rgb(...THEME.amber) });
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
      const sway = reduce ? 0 : (Math.sin(t * 1.1 + x * 0.05) * 2 + gust(t, x)) * s;
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
    // Perf: the per-design dark/light roof shades are pure functions of the static ROOF palette, so
    // precompute them once instead of two .map() allocations per house per frame in drawHouse().
    const ROOF_DK = ROOF.map((c) => c.map((v) => Math.round(v * 0.66)));
    const ROOF_LT = ROOF.map((c) => c.map((v) => Math.min(255, v + 30)));
    // A little corked potion bottle (body + round base + neck + cork + glint) — merchant interior ware.
    function potion(px, py, c) {
      k.drawRect({ pos: k.vec2(px - 4, py - 3), width: 8, height: 11, radius: 3, color: k.rgb(...c), opacity: 0.92 });
      k.drawCircle({ pos: k.vec2(px, py + 5), radius: 5, color: k.rgb(...c), opacity: 0.92 });
      k.drawRect({ pos: k.vec2(px - 1.5, py - 8), width: 3, height: 5, color: k.rgb(...WOOD_LT) });
      k.drawRect({ pos: k.vec2(px - 2.5, py - 10), width: 5, height: 3, radius: 1, color: k.rgb(...WOOD_DK) });
      k.drawCircle({ pos: k.vec2(px - 1.5, py + 3), radius: 1.6, color: k.rgb(255, 255, 255), opacity: 0.4 });
    }
    // Shared INTERIOR DRESSING applied to EVERY house — architecture + ambience that make the revealed
    // rooms read as real, lit, lived-in spaces on top of each shop's themed furniture: a cozy warm
    // ambient fill, wall skirting, two lit wall sconces, framed pictures, a window with a dusk-light
    // spill on the floor, and an entry doormat at the threshold. All clear of the back-wall furniture
    // (top band), the centre keeper, the side cabinets, and the front counter.
    function dressRoom(x, y, lft, rgt, top, bot, BW, BH, t, accent, fd) {
      const by = (d, h = 0) => fd ? top + d : bot - d - h;   // back-wall anchored
      const fy = (d, h = 0) => fd ? bot - d - h : top + d;   // entrance-edge anchored
      // Cozy warm ambient fill — the room looks lit the moment the roof opens.
      k.drawEllipse({ pos: k.vec2(x, y), radiusX: BW * 0.44, radiusY: BH * 0.38, color: k.rgb(255, 206, 144), opacity: 0.055 });
      // Wall skirting — a faint inset line tracing the room base (symmetric).
      k.drawRect({ pos: k.vec2(lft + 13, top + 19), width: BW - 26, height: BH - 32, radius: 5, fill: false, outline: { width: 1.5, color: k.rgb(...WOOD) }, opacity: 0.22 });
      // Two lit wall SCONCES near the BACK wall (warm lamp + glow), framed PICTURES on the side walls.
      for (const sxn of [lft + 13, rgt - 13]) {
        const fl = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 5 + sxn * 0.2);
        k.drawCircle({ pos: k.vec2(sxn, by(42)), radius: 11, color: k.rgb(255, 196, 110), opacity: 0.13 * fl });
        k.drawRect({ pos: k.vec2(sxn - 3, by(40, 8)), width: 6, height: 8, radius: 2, color: k.rgb(...WOOD_DK) });
        k.drawCircle({ pos: k.vec2(sxn, by(41)), radius: 2.6, color: k.rgb(255, 222, 150), opacity: 0.6 + 0.4 * fl });
        k.drawRect({ pos: k.vec2(sxn - 7, y - 8), width: 14, height: 16, radius: 2, color: k.rgb(...WOOD) });           // picture frame (mid wall)
        k.drawRect({ pos: k.vec2(sxn - 5, y - 6), width: 10, height: 12, radius: 1, color: k.rgb(...accent), opacity: 0.5 });
      }
      // Entry DOORMAT at the threshold (entrance edge, plaza-facing).
      k.drawEllipse({ pos: k.vec2(x, fy(15)), radiusX: 26, radiusY: 8, color: k.rgb(...accent), opacity: 0.14 });
      k.drawEllipse({ pos: k.vec2(x, fy(15)), radiusX: 26, radiusY: 8, fill: false, outline: { width: 1.5, color: k.rgb(...accent) }, opacity: 0.26 });
    }
    // A reusable TOP-DOWN building (roof from above; the footprint is the hitbox): interior (plank floor
    // + themed furniture + keeper) revealed as the roof fades open (b.roofA) when you walk up, then the
    // tiled roof + chimney + a themed roof emblem (awning / cross / lock). Generalised from the old
    // merchant the user liked.
    function drawHouse(b, t) {
      const x = b.x, y = b.y, BW = b.w, BH = b.h, id = b.id;
      const lft = x - BW / 2, rgt = x + BW / 2, top = y - BH / 2, bot = y + BH / 2;
      const ra = b.roofA != null ? b.roofA : 1;
      const di = b.design || 0, roof = ROOF[di], roofDk = ROOF_DK[di], roofLt = ROOF_LT[di];
      const amber = THEME.amber, vio = THEME.violet, mid = y - 6;
      // FACE-AWARE interior: each building's entrance + facade face the PLAZA (b.faceDown). These map a
      // distance from the BACK wall / the ENTRANCE edge / the CENTRE to a world-y that's correct for both
      // orientations (rect helpers take the element height h so top-left anchoring mirrors cleanly).
      const fd = b.faceDown !== false, s = fd ? 1 : -1;
      const by = (d, h = 0) => fd ? top + d : bot - d - h;   // d into the room from the BACK wall
      const fy = (d, h = 0) => fd ? bot - d - h : top + d;   // d in from the ENTRANCE (plaza) edge
      const oy = (d) => fd ? bot + d : top - d;              // d OUTSIDE the entrance edge (porch/glow)
      const cy = (o) => y + s * o;                            // centre-relative point (+o = toward entrance)
      const cyr = (o, h) => fd ? y + o : y - o - h;           // centre-relative rect top-left (+o = toward entrance)
      k.drawEllipse({ pos: k.vec2(x, bot + 4), radiusX: BW / 2 + 6, radiusY: 18, color: k.rgb(0, 0, 0), opacity: 0.26 }); // footprint shadow
      // ── INTERIOR (drawn first; the roof above hides it until you arrive) ──
      // PERF: a fully-closed roof (ra≈1) is opaque and completely hides the interior — so skip drawing
      // all of it (floor, dressing, furniture, clutter, keeper) until the roof starts opening. Normally
      // only the one building you're at has an open roof, so this skips ~4 rooms' worth of draws/frame.
      if (ra < 0.99) {
      k.drawRect({ pos: k.vec2(lft + 8, top + 14), width: BW - 16, height: BH - 22, radius: 6, color: k.rgb(48, 40, 34) });
      for (let i = 1; i < 6; i++) k.drawLine({ p1: k.vec2(lft + 8, top + 14 + i * (BH - 22) / 6), p2: k.vec2(rgt - 8, top + 14 + i * (BH - 22) / 6), width: 1, color: k.rgb(...WOOD_DK), opacity: 0.3 });
      k.drawRect({ pos: k.vec2(lft + 8, top + 14), width: BW - 16, height: BH - 22, radius: 6, fill: false, outline: { width: 4, color: k.rgb(...WOOD_DK) } });
      k.drawRect({ pos: k.vec2(lft + 11, top + 17), width: BW - 22, height: BH - 28, radius: 6, fill: false, outline: { width: 8, color: k.rgb(18, 14, 10) }, opacity: 0.16 }); // soft inner-wall shadow (AO) — reads as an enclosed room
      // A themed floor RUG fills the (now bigger) interior + a back-wall wainscot strip, so the larger
      // rooms read furnished rather than empty.
      const rugC = ({ merchant: amber, healer: HEAL, vault: vio, bestiary: THEME.water, cosmetics: THEME.psychic }[id]) || WOOD;
      k.drawEllipse({ pos: k.vec2(x, cy(18)), radiusX: BW * 0.3, radiusY: BH * 0.24, color: k.rgb(...rugC), opacity: 0.16 });
      k.drawEllipse({ pos: k.vec2(x, cy(18)), radiusX: BW * 0.3, radiusY: BH * 0.24, fill: false, outline: { width: 2.5, color: k.rgb(...rugC) }, opacity: 0.3 });
      k.drawEllipse({ pos: k.vec2(x, cy(18)), radiusX: BW * 0.2, radiusY: BH * 0.16, fill: false, outline: { width: 1.5, color: k.rgb(...rugC) }, opacity: 0.22 });
      dressRoom(x, y, lft, rgt, top, bot, BW, BH, t, rugC, fd); // shared architecture + ambience (sconces, pictures, doormat)
      // Soft dusk light falling through the open doorway onto the interior floor (enter-the-room glow).
      const dl = Math.max(48, Math.min(78, BW * 0.15));
      k.drawEllipse({ pos: k.vec2(x, fy(30)), radiusX: dl * 0.95, radiusY: 26, color: k.rgb(150, 172, 205), opacity: 0.06 });
      k.drawEllipse({ pos: k.vec2(x, fy(20)), radiusX: dl * 0.72, radiusY: 17, color: k.rgb(162, 184, 216), opacity: 0.05 });
      // A themed back-wall CREST above the display (a little more decoration; universal across shops).
      k.drawCircle({ pos: k.vec2(x, by(9)), radius: 9, color: k.rgb(...rugC), opacity: 0.4 });
      k.drawCircle({ pos: k.vec2(x, by(9)), radius: 9, fill: false, outline: { width: 2, color: k.rgb(...rugC) }, opacity: 0.5 });
      k.drawCircle({ pos: k.vec2(x, by(9)), radius: 3.5, color: k.rgb(...rugC), opacity: 0.6 });
      // Side cabinets centred on both walls (orientation-neutral) so the interiors read furnished.
      for (const sx of [lft + 18, rgt - 18]) {
        k.drawRect({ pos: k.vec2(sx - 9, y - 25), width: 18, height: 50, radius: 2, color: k.rgb(...WOOD_DK) });
        k.drawRect({ pos: k.vec2(sx - 9, y - 25), width: 18, height: 4, radius: 1, color: k.rgb(...WOOD_LT), opacity: 0.5 });
        for (let i = 0; i < 3; i++) k.drawLine({ p1: k.vec2(sx - 9, y - 13 + i * 13), p2: k.vec2(sx + 9, y - 13 + i * 13), width: 1, color: k.rgb(...WOOD), opacity: 0.5 });
        k.drawRect({ pos: k.vec2(sx - 6, y - 4), width: 12, height: 9, radius: 2, color: k.rgb(...rugC), opacity: 0.55 }); // a themed item on top
      }
      // More interior: a RUNNER rug leading in from the entrance to the keeper + goods stacked in the
      // two front corners (flanking the doorway, never blocking it). Runner is flat (under everything).
      const runMid = (fy(6) + cy(8)) / 2, runHalf = Math.abs(fy(6) - cy(8)) / 2 + 8;
      k.drawEllipse({ pos: k.vec2(x, runMid), radiusX: 21, radiusY: runHalf, color: k.rgb(...rugC), opacity: 0.1 });
      k.drawEllipse({ pos: k.vec2(x, runMid), radiusX: 21, radiusY: runHalf, fill: false, outline: { width: 1.5, color: k.rgb(...rugC) }, opacity: 0.2 });
      if (id === "healer") { drawPlanter(lft + 34, fy(42), t); drawPlanter(rgt - 34, fy(42), t); } // herb planters flank the apothecary's door
      else { drawBarrelProp(lft + 34, fy(42)); drawCrateProp(rgt - 34, fy(42)); }
      if (id === "merchant") {
        k.drawRect({ pos: k.vec2(lft + 18, by(22, 18)), width: BW - 36, height: 18, radius: 2, color: k.rgb(...WOOD) });
        const wares = [THEME.teal, vio, amber, THEME.ice, THEME.danger, HEAL];
        for (let i = 0; i < 6; i++) potion(lft + 34 + i * ((BW - 68) / 5), by(27), wares[i]);
        // distinctive: a goods barrel with a coin pile on top (against the back wall)
        k.drawRect({ pos: k.vec2(x + 64, by(54, 26)), width: 22, height: 26, radius: 6, color: k.rgb(...WOOD) });
        k.drawEllipse({ pos: k.vec2(x + 75, by(54)), radiusX: 11, radiusY: 4, color: k.rgb(...WOOD_LT) });
        k.drawRect({ pos: k.vec2(x + 64, by(64, 3)), width: 22, height: 3, color: k.rgb(...WOOD_DK) });
        k.drawCircle({ pos: k.vec2(x + 75, by(50)), radius: 4, color: k.rgb(...amber) });
        k.drawCircle({ pos: k.vec2(x + 79, by(52)), radius: 4, color: k.rgb(...amber) });
        // Left-side STOCK: a pyramid of grain sacks, a crate with coin piles, a hanging scale — a busy shop floor.
        for (const [sx, so, r] of [[x - 72, 38, 12], [x - 56, 41, 10], [x - 64, 26, 10]]) { k.drawEllipse({ pos: k.vec2(sx, cy(so)), radiusX: r, radiusY: r * 0.92, color: k.rgb(...WOOD_LT) }); k.drawEllipse({ pos: k.vec2(sx, cy(so - r * 0.5)), radiusX: r * 0.45, radiusY: 2.6, color: k.rgb(...WOOD_DK), opacity: 0.5 }); k.drawLine({ p1: k.vec2(sx - r * 0.6, cy(so + 1)), p2: k.vec2(sx + r * 0.6, cy(so + 1)), width: 1, color: k.rgb(...WOOD_DK), opacity: 0.4 }); }
        k.drawRect({ pos: k.vec2(x - 100, cyr(28, 22)), width: 20, height: 22, radius: 2, color: k.rgb(...WOOD) });
        k.drawRect({ pos: k.vec2(x - 100, cyr(28, 22)), width: 20, height: 22, fill: false, outline: { width: 1.5, color: k.rgb(...WOOD_DK) } });
        for (const [cx, n] of [[x - 96, 3], [x - 88, 2]]) for (let i = 0; i < n; i++) k.drawEllipse({ pos: k.vec2(cx, cy(22 - i * 3)), radiusX: 4.5, radiusY: 2.2, color: k.rgb(...amber), opacity: 0.92 });
        k.drawLine({ p1: k.vec2(x - 30, by(14)), p2: k.vec2(x - 30, by(44)), width: 1.5, color: k.rgb(...WOOD_DK) }); // hanging scale (from the back wall)
        k.drawLine({ p1: k.vec2(x - 42, by(44)), p2: k.vec2(x - 18, by(44)), width: 2, color: k.rgb(...amber) });
        for (const dx of [-42, -18]) { k.drawLine({ p1: k.vec2(x + dx, by(44)), p2: k.vec2(x + dx, by(50)), width: 1, color: k.rgb(...WOOD_DK) }); k.drawEllipse({ pos: k.vec2(x + dx, by(51)), radiusX: 6, radiusY: 2.4, color: k.rgb(...amber), opacity: 0.8 }); }
      } else if (id === "healer") {
        const pulse = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 2.5);
        k.drawEllipse({ pos: k.vec2(x, by(42)), radiusX: 36, radiusY: 14, color: k.rgb(...STONE) });
        k.drawEllipse({ pos: k.vec2(x, by(40)), radiusX: 28, radiusY: 10, color: k.rgb(...HEAL), opacity: 0.5 + 0.25 * pulse });
        k.drawEllipse({ pos: k.vec2(x - 4, by(38)), radiusX: 13, radiusY: 4, color: k.rgb(210, 255, 225), opacity: 0.4 * pulse });
        // distinctive: a potted herb (against the back wall, beside the font)
        k.drawRect({ pos: k.vec2(x + 60, by(58, 16)), width: 18, height: 16, radius: 3, color: k.rgb(...WOOD_DK) });
        k.drawEllipse({ pos: k.vec2(x + 69, by(58)), radiusX: 9, radiusY: 3, color: k.rgb(...WOOD) });
        for (const dx of [-5, 0, 5]) k.drawEllipse({ pos: k.vec2(x + 69 + dx, by(52)), radiusX: 3, radiusY: 7, color: k.rgb(...HEAL), opacity: 0.85 });
        // Left side: a bubbling remedy CAULDRON on a stand (rising vapour) + a stack of bandage rolls — a working apothecary.
        const cb = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 3 + 1);
        k.drawRect({ pos: k.vec2(x - 76, cyr(30, 15)), width: 4, height: 15, color: k.rgb(...WOOD_DK) }); k.drawRect({ pos: k.vec2(x - 54, cyr(30, 15)), width: 4, height: 15, color: k.rgb(...WOOD_DK) });
        k.drawEllipse({ pos: k.vec2(x - 64, cy(30)), radiusX: 17, radiusY: 10, color: k.rgb(38, 42, 38) });
        k.drawEllipse({ pos: k.vec2(x - 64, cy(24)), radiusX: 14, radiusY: 5.5, color: k.rgb(...HEAL), opacity: 0.5 + 0.3 * cb });
        if (!reduce) for (let i = 0; i < 3; i++) { const f = (t * 0.6 + i * 0.34) % 1; k.drawCircle({ pos: k.vec2(x - 64 + (i - 1) * 5, cy(24) - f * 15), radius: Math.max(0.5, (1 - f) * 2), color: k.rgb(...HEAL), opacity: 0.5 * (1 - f) }); }
        for (const [bx, bo] of [[x - 92, 42], [x - 80, 42], [x - 86, 34]]) { k.drawCircle({ pos: k.vec2(bx, cy(bo)), radius: 6, color: k.rgb(238, 232, 214) }); k.drawCircle({ pos: k.vec2(bx, cy(bo)), radius: 2.4, color: k.rgb(...HEAL), opacity: 0.4 }); }
      } else if (id === "vault") {
        // The shelf shows YOUR ACTUAL active team — one orb per monster, green if healthy / amber if hurt
        // (status colour, not element — compliant). Reflects the cached teamHP; empty vault → a faint marker.
        k.drawRect({ pos: k.vec2(x - 58, by(22, 32)), width: 116, height: 32, radius: 5, color: k.rgb(70, 76, 92) });
        const tn = Math.min(6, teamHP.length);
        if (tn) {
          const sp = tn > 1 ? Math.min(26, 96 / (tn - 1)) : 0, x0 = x - sp * (tn - 1) / 2;
          for (let i = 0; i < tn; i++) { const ox = x0 + i * sp, c = teamHP[i] ? amber : HEAL; k.drawCircle({ pos: k.vec2(ox, by(38)), radius: 8, color: k.rgb(...c), opacity: 0.3 }); k.drawCircle({ pos: k.vec2(ox, by(38)), radius: 5, color: k.rgb(...c) }); }
        } else { k.drawCircle({ pos: k.vec2(x, by(38)), radius: 5, fill: false, outline: { width: 2, color: k.rgb(...STONE_LT) }, opacity: 0.4 }); }
        // distinctive: a small iron strongbox (against the back wall, beside the shelf)
        k.drawRect({ pos: k.vec2(x + 56, by(60, 18)), width: 26, height: 18, radius: 3, color: k.rgb(72, 76, 92) });
        k.drawRect({ pos: k.vec2(x + 56, by(60, 5)), width: 26, height: 5, radius: 2, color: k.rgb(92, 96, 112) });
        k.drawCircle({ pos: k.vec2(x + 69, by(69)), radius: 2.5, color: k.rgb(...amber) });
        // Left side: a heavy SAFE with a combination dial + a stack of gold BARS — a proper treasury.
        k.drawRect({ pos: k.vec2(x - 92, cyr(14, 38)), width: 36, height: 38, radius: 3, color: k.rgb(58, 64, 78) });
        k.drawRect({ pos: k.vec2(x - 92, cyr(14, 38)), width: 36, height: 38, fill: false, outline: { width: 2, color: k.rgb(90, 96, 112) } });
        k.drawCircle({ pos: k.vec2(x - 74, cy(34)), radius: 6, fill: false, outline: { width: 2, color: k.rgb(...STONE_LT) } });
        k.drawCircle({ pos: k.vec2(x - 74, cy(34)), radius: 1.6, color: k.rgb(...amber) });
        k.drawRect({ pos: k.vec2(x - 90, cyr(18, 3)), width: 7, height: 3, radius: 1, color: k.rgb(90, 96, 112) });
        for (const [gx, go] of [[x - 50, 48], [x - 38, 48], [x - 44, 42]]) { k.drawRect({ pos: k.vec2(gx - 7, cyr(go - 3, 6)), width: 14, height: 6, radius: 1, color: k.rgb(...amber) }); k.drawRect({ pos: k.vec2(gx - 7, cyr(go - 3, 2)), width: 14, height: 2, radius: 1, color: k.rgb(255, 230, 150), opacity: 0.7 }); }
      } else if (id === "bestiary") {
        // Bookshelves along the back wall (rows of colored spines).
        const spines = [THEME.danger, amber, THEME.teal, vio, HEAL, THEME.water, THEME.psychic];
        for (let r = 0; r < 2; r++) {
          k.drawRect({ pos: k.vec2(lft + 16, by(18 + r * 16, 14)), width: BW - 32, height: 14, radius: 2, color: k.rgb(54, 44, 36) });
          const n = 12, sw = (BW - 44) / n;
          for (let i = 0; i < n; i++) k.drawRect({ pos: k.vec2(lft + 20 + i * sw, by(19 + r * 16, 11)), width: sw - 1.6, height: 11, color: k.rgb(...spines[(i + r * 3) % spines.length]), opacity: 0.82 });
        }
        // distinctive: a reading lectern with an open tome (against the back wall)
        k.drawRect({ pos: k.vec2(x + 62, by(58, 18)), width: 4, height: 18, color: k.rgb(...WOOD_DK) });
        k.drawEllipse({ pos: k.vec2(x + 64, by(76)), radiusX: 11, radiusY: 3, color: k.rgb(...WOOD_DK), opacity: 0.5 });
        k.drawRect({ pos: k.vec2(x + 52, by(50, 13)), width: 24, height: 13, radius: 2, color: k.rgb(...THEME.water), opacity: 0.85 });
        k.drawLine({ p1: k.vec2(x + 64, by(50)), p2: k.vec2(x + 64, by(63)), width: 1.5, color: k.rgb(40, 40, 52) });
        // Left side: a GLOBE on a stand, a stack of study books, and a lit candle — a scholar's clutter.
        k.drawRect({ pos: k.vec2(x - 66, cyr(26, 18)), width: 4, height: 18, color: k.rgb(...WOOD_DK) });
        k.drawEllipse({ pos: k.vec2(x - 64, cy(46)), radiusX: 11, radiusY: 3, color: k.rgb(...WOOD_DK), opacity: 0.5 });
        k.drawCircle({ pos: k.vec2(x - 64, cy(20)), radius: 12, color: k.rgb(...THEME.water), opacity: 0.7 });
        k.drawCircle({ pos: k.vec2(x - 64, cy(20)), radius: 12, fill: false, outline: { width: 1.5, color: k.rgb(...WOOD) } });
        k.drawLine({ p1: k.vec2(x - 71, cy(15)), p2: k.vec2(x - 58, cy(25)), width: 1, color: k.rgb(...WOOD_LT), opacity: 0.5 });
        for (let i = 0; i < 3; i++) k.drawRect({ pos: k.vec2(x - 100, cyr(42 - i * 4, 4)), width: 18, height: 4, radius: 1, color: k.rgb(...[THEME.danger, amber, THEME.teal][i]), opacity: 0.85 });
        const cf = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 8);
        k.drawRect({ pos: k.vec2(x - 86, cyr(18, 10)), width: 3, height: 10, color: k.rgb(240, 236, 210) });
        k.drawEllipse({ pos: k.vec2(x - 84.5, cy(15)), radiusX: 2.4, radiusY: 4, color: k.rgb(255, 200, 110), opacity: 0.85 * cf });
        k.drawCircle({ pos: k.vec2(x - 84.5, cy(16)), radius: 8, color: k.rgb(255, 200, 120), opacity: 0.12 * cf });
      } else if (id === "cosmetics") {
        // A garment rail with hanging clothes (pink/varied).
        k.drawLine({ p1: k.vec2(lft + 18, by(22)), p2: k.vec2(rgt - 18, by(22)), width: 2, color: k.rgb(...STONE_LT) });
        const garments = [THEME.psychic, THEME.teal, amber, vio, HEAL, THEME.danger];
        for (let i = 0; i < 6; i++) { const gx = lft + 30 + i * ((BW - 60) / 5); k.drawEllipse({ pos: k.vec2(gx, by(23)), radiusX: 4, radiusY: 2, color: k.rgb(...garments[i]) }); k.drawRect({ pos: k.vec2(gx - 6, by(24, 20)), width: 12, height: 20, radius: 3, color: k.rgb(...garments[i]), opacity: 0.85 }); }
        // distinctive: a standing oval mirror (against the back wall)
        k.drawEllipse({ pos: k.vec2(x + 64, by(56)), radiusX: 11, radiusY: 16, color: k.rgb(...THEME.psychic), opacity: 0.3 });
        k.drawEllipse({ pos: k.vec2(x + 64, by(56)), radiusX: 11, radiusY: 16, fill: false, outline: { width: 3, color: k.rgb(...WOOD) } });
        k.drawEllipse({ pos: k.vec2(x + 60, by(50)), radiusX: 3, radiusY: 6, color: k.rgb(255, 255, 255), opacity: 0.35 });
        k.drawRect({ pos: k.vec2(x + 62, by(72, 8)), width: 4, height: 8, color: k.rgb(...WOOD_DK) });
        // Left side: a dress-form MANNEQUIN + a lean of rolled FABRIC BOLTS — a tailor's workspace.
        k.drawRect({ pos: k.vec2(x - 66, cyr(26, 20)), width: 4, height: 20, color: k.rgb(...WOOD_DK) });
        k.drawEllipse({ pos: k.vec2(x - 64, cy(48)), radiusX: 10, radiusY: 3, color: k.rgb(...WOOD_DK), opacity: 0.5 });
        k.drawEllipse({ pos: k.vec2(x - 64, cy(26)), radiusX: 12, radiusY: 15, color: k.rgb(...THEME.psychic), opacity: 0.6 });
        k.drawEllipse({ pos: k.vec2(x - 64, cy(26)), radiusX: 12, radiusY: 15, fill: false, outline: { width: 1.5, color: k.rgb(...WOOD) }, opacity: 0.5 });
        k.drawEllipse({ pos: k.vec2(x - 64, cy(12)), radiusX: 4.5, radiusY: 5, color: k.rgb(...WOOD_LT) });
        for (let i = 0; i < 4; i++) { const c = [THEME.teal, amber, vio, HEAL][i]; k.drawRect({ pos: k.vec2(x - 102 + i * 5, cyr(46 - i * 2, 32)), width: 8, height: 32, radius: 4, color: k.rgb(...c), opacity: 0.85 }); k.drawEllipse({ pos: k.vec2(x - 98 + i * 5, cy(46 - i * 2)), radiusX: 4, radiusY: 2.2, color: k.rgb(...c) }); }
      } else {
        k.drawRect({ pos: k.vec2(x - 16, by(22, 18)), width: 32, height: 18, radius: 3, color: k.rgb(...STONE_DK) });
        k.drawEllipse({ pos: k.vec2(x, by(31)), radiusX: 9, radiusY: 5, color: k.rgb(255, 150, 70), opacity: reduce ? 0.45 : 0.35 + 0.2 * Math.sin(t * 4 + x) });
      }
      if (b.keeper) b.keeper(x, cy(8), t); // the keeper inside (slightly toward the entrance)
      if (id === "merchant") { // shop counter in FRONT of the keeper, set back from the doorway (clear entrance)
        k.drawRect({ pos: k.vec2(x - 62, cyr(44, 24)), width: 124, height: 24, radius: 4, color: k.rgb(...WOOD) });
        k.drawRect({ pos: k.vec2(x - 64, cyr(39, 7)), width: 128, height: 7, radius: 3, color: k.rgb(...WOOD_LT) });
        potion(x - 42, cy(45), THEME.teal); potion(x - 24, cy(45), vio);
        k.drawCircle({ pos: k.vec2(x + 10, cy(43)), radius: 6, color: k.rgb(...THEME.ice) });
      }
      } // end interior (skipped when the roof is fully closed)
      drawSouthWall(b, t); // visible SOUTH-FACING wall facade below the roof — the roof eave overhangs it (drawn before the roof so it sits underneath)
      // ── ROOF (opacity ra) — the building seen from above ──
      if (ra > 0.03) {
        k.drawRect({ pos: k.vec2(lft - 8, top + 4), width: BW + 16, height: BH - 2, radius: 10, color: k.rgb(...roofDk), opacity: ra });          // eaves overhang
        k.drawRect({ pos: k.vec2(lft - 3, top + 6), width: BW + 6, height: mid - (top + 6), radius: 7, color: k.rgb(...roof), opacity: ra });       // back pitch (lit)
        k.drawRect({ pos: k.vec2(lft - 3, mid), width: BW + 6, height: (bot - 4) - mid, radius: 7, color: k.rgb(...roofDk), opacity: ra });         // front pitch (shaded)
        k.drawRect({ pos: k.vec2(lft - 3, mid - 2), width: BW + 6, height: 5, radius: 2, color: k.rgb(...roofLt), opacity: 0.8 * ra });             // ridge
        for (let i = 1; i < 4; i++) { const yy = top + 6 + i * (mid - top - 6) / 4; k.drawLine({ p1: k.vec2(lft, yy), p2: k.vec2(rgt, yy), width: 1.5, color: k.rgb(...roofDk), opacity: 0.45 * ra }); }
        for (let i = 1; i < 4; i++) { const yy = mid + i * (bot - 4 - mid) / 4; k.drawLine({ p1: k.vec2(lft, yy), p2: k.vec2(rgt, yy), width: 1.5, color: k.rgb(...WOOD_DK), opacity: 0.4 * ra }); }
        // Aged: a few soft MOSS patches creeping along the shaded front pitch — weathered-cottage
        // character without busying the roof. Hash-stable per building; fades with the roof (ra).
        for (let i = 0; i < 3; i++) {
          const mx = lft + 16 + hash(b.x + i * 31, b.y) * (BW - 32);
          const my = mid + 4 + hash(b.x, b.y + i * 17) * (bot - 4 - mid - 8);
          k.drawEllipse({ pos: k.vec2(mx, my), radiusX: 5 + hash(b.x + i, b.y + i) * 5, radiusY: 3, color: k.rgb(80, 104, 60), opacity: 0.3 * ra });
        }
        // Warm-lit DORMER WINDOWS on the front pitch — at dusk the cottages glow as if someone's home
        // (cozy, inhabited village). Gentle candle flicker; fades out with the roof (ra) as you step in.
        const winY = fy(Math.round(BH / 4 + 6));   // on the plaza-facing pitch
        const wlit = reduce ? 0.85 : 0.72 + 0.2 * Math.sin(t * 3 + b.x * 0.05); // TQ-162: calmer pulse (was 0.62+0.38) so the door is the focal motion
        const ws = Math.min(1.3, Math.max(1, BW / 468));   // windows scale with the building (proportional)
        const nw = BW > 470 ? 3 : 2;
        for (let i = 0; i < nw; i++) {
          const wx = x + (i - (nw - 1) / 2) * (BW * 0.28);
          k.drawCircle({ pos: k.vec2(wx, winY), radius: 23 * ws, color: k.rgb(255, 198, 110), opacity: 0.11 * wlit * ra });                          // warm glow halo
          k.drawRect({ pos: k.vec2(wx - 14 * ws, winY - 15 * ws), width: 28 * ws, height: 30 * ws, radius: 4, color: k.rgb(...WOOD_DK), opacity: ra }); // frame
          k.drawRect({ pos: k.vec2(wx - 10 * ws, winY - 11 * ws), width: 20 * ws, height: 22 * ws, radius: 3, color: k.rgb(255, 214, 140), opacity: (0.55 + 0.4 * wlit) * ra }); // lit pane
          k.drawLine({ p1: k.vec2(wx, winY - 11 * ws), p2: k.vec2(wx, winY + 11 * ws), width: 1.5, color: k.rgb(...WOOD_DK), opacity: 0.6 * ra });   // mullions
          k.drawLine({ p1: k.vec2(wx - 10 * ws, winY), p2: k.vec2(wx + 10 * ws, winY), width: 1.5, color: k.rgb(...WOOD_DK), opacity: 0.6 * ra });
          // a flower box under the sill (on the eave side) — cottage charm, lit by the window
          k.drawRect({ pos: k.vec2(wx - 15 * ws, winY + (fd ? 11 * ws : -25 * ws)), width: 30 * ws, height: 8, radius: 2, color: k.rgb(...WOOD_DK), opacity: ra });
          for (let j = 0; j < 3; j++) { const fc = [THEME.danger, amber, THEME.psychic][(i + j) % 3]; const fx = wx + (j - 1) * 9 * ws; k.drawCircle({ pos: k.vec2(fx, winY + s * 14 * ws), radius: 3, color: k.rgb(...fc), opacity: 0.9 * ra }); k.drawCircle({ pos: k.vec2(fx, winY + s * 14 * ws), radius: 1.1, color: k.rgb(255, 240, 180), opacity: ra }); }
        }
        // An open ARCHWAY entrance at the front — NO door panel (a flat door read wrong in the top-down
        // view). A stone arch framing a warm-lit opening you walk straight into, a porch step on the
        // ground, and interior light spilling out. Soft/rounded shapes only → reads cleanly from above.
        const ew = Math.max(48, Math.min(78, BW * 0.15)), eg = reduce ? 0.9 : 0.82 + 0.18 * Math.sin(t * 2.5 + b.x * 0.05);
        // The flat roof-plane archway is only drawn for NORTH-facing entrances; a SOUTH entrance now
        // has its door on the visible vertical south wall (drawSouthWall), so skip the flat arch there.
        if (!fd) {
        const archY = top - 6;   // the arch straddles the plaza-facing (north) eave
        k.drawEllipse({ pos: k.vec2(x, oy(3)), radiusX: ew + 2, radiusY: 13, color: k.rgb(...STONE_DK), opacity: ra });                              // porch step (outer)
        k.drawEllipse({ pos: k.vec2(x, oy(1)), radiusX: ew * 0.84, radiusY: 10, color: k.rgb(...STONE), opacity: ra });                              // porch step (tread)
        k.drawEllipse({ pos: k.vec2(x, fy(1)), radiusX: ew * 0.56, radiusY: 6.5, color: k.rgb(...STONE_LT), opacity: 0.55 * ra });                   // worn centre
        k.drawRect({ pos: k.vec2(x - ew, archY), width: ew * 2, height: 44, radius: 22, color: k.rgb(...STONE), opacity: ra });                      // stone arch surround
        k.drawRect({ pos: k.vec2(x - ew + 6, archY + 4), width: ew * 2 - 12, height: 44, radius: 18, color: k.rgb(44, 33, 26), opacity: ra });       // recessed opening (into the cottage)
        k.drawRect({ pos: k.vec2(x - ew + 11, archY + 13), width: ew * 2 - 22, height: 36, radius: 14, color: k.rgb(255, 206, 128), opacity: 0.5 * eg * ra }); // warm interior light pouring out
        k.drawEllipse({ pos: k.vec2(x, fy(2)), radiusX: ew * 0.82, radiusY: 11, color: k.rgb(255, 200, 120), opacity: 0.24 * eg * ra });             // light spilling onto the porch
        }
        k.drawRect({ pos: k.vec2(lft + 22, top - 8), width: 18, height: 24, radius: 2, color: k.rgb(...STONE), opacity: ra });                      // chimney
        k.drawRect({ pos: k.vec2(lft + 20, top - 11), width: 22, height: 6, radius: 2, color: k.rgb(...STONE_DK), opacity: ra });
        // (roof emblem removed 2026-06-11 — each building's symbol now lives on a SIGN in front of it,
        // drawBuildingSign; the roof stays clean tiles + chimney + moss.)
      }
    }

    // SOUTH-FACING WALL (experiment 2026-06-11): a vertical wall facade hung off the south edge of each
    // building so the cottages read as 3D structures (roof + visible wall) instead of flat top-down
    // roofs. Half-timber plaster panel with corner posts + top plate + sill beam, warm-lit windows, and
    // a door where the SOUTH side is the entrance (faceDown buildings) — northern-entrance buildings get
    // a windowed back wall. Drawn BEFORE the roof so the eave overhangs it; fades with the roof (ra) so
    // stepping inside still reveals the interior.
    function drawSouthWall(b, t) {
      const ra = b.roofA != null ? b.roofA : 1;
      if (ra <= 0.03) return;
      const x = b.x, BW = b.w, BH = b.h;
      const lft = x - BW / 2, rgt = x + BW / 2, bot = b.y + BH / 2;
      const wallMid = [150, 128, 100], wallLt = [182, 160, 130], wallDk = [108, 90, 68]; // warm plaster at dusk
      const beam = WOOD_DK, doorC = [58, 42, 28];
      const wH = Math.round(Math.min(74, Math.max(50, BH * 0.17)));
      const wy = bot - 8, wl = lft + 2, wr = rgt - 2, ww = wr - wl;
      const southIsFront = b.faceDown !== false;
      // grounded base shadow under the wall
      k.drawEllipse({ pos: k.vec2(x, wy + wH + 3), radiusX: BW / 2 + 2, radiusY: 13, color: k.rgb(0, 0, 0), opacity: 0.26 * ra });
      // plaster plane + top catch-light (under the eave) + grounded base shade
      k.drawRect({ pos: k.vec2(wl, wy), width: ww, height: wH, color: k.rgb(...wallMid), opacity: ra });
      k.drawRect({ pos: k.vec2(wl, wy), width: ww, height: 6, color: k.rgb(...wallLt), opacity: 0.5 * ra });
      k.drawRect({ pos: k.vec2(wl, wy + wH - 9), width: ww, height: 9, color: k.rgb(...wallDk), opacity: 0.5 * ra });
      // half-timber framing: top plate, sill beam, corner posts
      k.drawRect({ pos: k.vec2(wl, wy), width: ww, height: 6, color: k.rgb(...beam), opacity: 0.9 * ra });
      k.drawRect({ pos: k.vec2(wl, wy + wH - 6), width: ww, height: 6, color: k.rgb(...beam), opacity: ra });
      k.drawRect({ pos: k.vec2(wl, wy), width: 8, height: wH, color: k.rgb(...beam), opacity: ra });
      k.drawRect({ pos: k.vec2(wr - 8, wy), width: 8, height: wH, color: k.rgb(...beam), opacity: ra });
      // a centred door where the south side is the entrance (faceDown buildings). TQ-162: it SWINGS
      // OPEN as you approach (b.doorA 0..1) — the plank panel is hinged on the left and foreshortens
      // toward the jamb, revealing a warm-lit interior opening, with the threshold light swelling.
      if (southIsFront) {
        const dw = Math.max(40, Math.min(64, ww * 0.16)), dyTop = wy + 12, dh = wH - 14;
        const da = b.doorA || 0, dlft = x - dw / 2; // door left (hinge) edge
        k.drawRect({ pos: k.vec2(dlft - 4, dyTop - 4), width: dw + 8, height: dh + 4, radius: 5, color: k.rgb(...beam), opacity: ra }); // frame
        // the dark interior opening revealed behind the swinging panel + a warm glow that grows as it opens
        k.drawRect({ pos: k.vec2(dlft, dyTop), width: dw, height: dh, radius: 4, color: k.rgb(22, 15, 11), opacity: ra });
        k.drawRect({ pos: k.vec2(dlft, dyTop), width: dw, height: dh, radius: 4, color: k.rgb(255, 206, 128), opacity: 0.2 * da * ra }); // interior warmth
        // the plank PANEL — hinged left, width foreshortens as it swings inward (down to a thin edge)
        const pw = Math.max(2, dw * (1 - 0.84 * da));
        k.drawRect({ pos: k.vec2(dlft, dyTop), width: pw, height: dh, radius: 4, color: k.rgb(...doorC), opacity: ra });
        for (let i = 1; i < 3; i++) { const lx = dlft + i * pw / 3; if (lx < dlft + pw - 1) k.drawLine({ p1: k.vec2(lx, dyTop + 2), p2: k.vec2(lx, dyTop + dh - 2), width: 1.5, color: k.rgb(...beam), opacity: 0.55 * ra }); } // planks scale with the panel
        k.drawCircle({ pos: k.vec2(dlft + pw - 5, dyTop + dh * 0.55), radius: 2.4, color: k.rgb(...THEME.amber), opacity: ra }); // handle rides the swinging edge
        const eg = reduce ? 0.9 : 0.82 + 0.18 * Math.sin(t * 2.5 + b.x * 0.05);
        k.drawEllipse({ pos: k.vec2(x, wy + wH + 1), radiusX: dw * 0.72, radiusY: 7, color: k.rgb(255, 206, 128), opacity: (0.16 + 0.28 * da) * eg * ra }); // warm threshold light swells when open
      }
      // flanking warm-lit windows (dusk glow, matching the dormer windows); skip the door's centre
      const wlit = reduce ? 0.85 : 0.72 + 0.2 * Math.sin(t * 3 + b.x * 0.05); // TQ-162: calmer pulse (was 0.62+0.38) so the door is the focal motion
      const offs = southIsFront ? [-0.30, 0.30] : [-0.32, 0, 0.32];
      const wwd = Math.min(34, ww * 0.13), wht = Math.min(30, wH - 24), wTop = wy + 13;
      for (const o of offs) {
        const cx = x + o * ww;
        k.drawCircle({ pos: k.vec2(cx, wTop + wht / 2), radius: wwd * 0.85, color: k.rgb(255, 198, 110), opacity: 0.08 * wlit * ra });        // glow halo
        k.drawRect({ pos: k.vec2(cx - wwd / 2 - 3, wTop - 3), width: wwd + 6, height: wht + 6, radius: 3, color: k.rgb(...beam), opacity: ra }); // frame
        k.drawRect({ pos: k.vec2(cx - wwd / 2, wTop), width: wwd, height: wht, radius: 2, color: k.rgb(255, 214, 140), opacity: (0.5 + 0.4 * wlit) * ra }); // lit pane
        k.drawLine({ p1: k.vec2(cx, wTop), p2: k.vec2(cx, wTop + wht), width: 1.5, color: k.rgb(...beam), opacity: 0.7 * ra });
        k.drawLine({ p1: k.vec2(cx - wwd / 2, wTop + wht / 2), p2: k.vec2(cx + wwd / 2, wTop + wht / 2), width: 1.5, color: k.rgb(...beam), opacity: 0.7 * ra });
      }
    }

    // Each building's SYMBOL now lives on a wooden SIGN in front of it (replaces the old roof emblem,
    // user 2026-06-11). A post + board with a small icon; drawn as a y-sorted prop so it's always
    // visible (even with the roof open) and identifies the building from the path.
    function drawBuildingSign(b) {
      if (b.kind !== "house") return;
      const fd = b.faceDown !== false, sx = b.x - b.w * 0.30, sy = b.y + (fd ? b.h / 2 + 62 : -(b.h / 2 + 14)); // flank the entrance; south-facing signs sit on the path IN FRONT of the dropped south wall (north-facing unchanged)
      k.drawEllipse({ pos: k.vec2(sx, sy + 7), radiusX: 17, radiusY: 5, color: k.rgb(0, 0, 0), opacity: 0.22 });
      k.drawRect({ pos: k.vec2(sx - 3, sy - 30), width: 6, height: 40, radius: 2, color: k.rgb(...WOOD_DK) });            // post
      k.drawRect({ pos: k.vec2(sx - 24, sy - 52), width: 48, height: 32, radius: 4, color: k.rgb(...WOOD) });             // board
      k.drawRect({ pos: k.vec2(sx - 24, sy - 52), width: 48, height: 6, radius: 2, color: k.rgb(...WOOD_LT), opacity: 0.6 }); // top sheen
      k.drawRect({ pos: k.vec2(sx - 24, sy - 52), width: 48, height: 32, radius: 4, fill: false, outline: { width: 2, color: k.rgb(...WOOD_DK) } });
      signIcon(b, sx, sy - 36);
    }
    function signIcon(b, cx, cy) {
      const amber = THEME.amber;
      if (b.id === "merchant") { k.drawCircle({ pos: k.vec2(cx, cy), radius: 9, color: k.rgb(...amber) }); k.drawCircle({ pos: k.vec2(cx, cy), radius: 4.5, fill: false, outline: { width: 2, color: k.rgb(...WOOD_DK) } }); } // coin
      else if (b.id === "healer") { const g = HEAL; k.drawRect({ pos: k.vec2(cx - 3, cy - 9), width: 6, height: 18, radius: 1, color: k.rgb(...g) }); k.drawRect({ pos: k.vec2(cx - 9, cy - 3), width: 18, height: 6, radius: 1, color: k.rgb(...g) }); } // cross
      else if (b.id === "vault") { const v = THEME.violet; k.drawRect({ pos: k.vec2(cx - 8, cy - 2), width: 16, height: 13, radius: 2, color: k.rgb(...v) }); k.drawCircle({ pos: k.vec2(cx, cy - 2), radius: 6, fill: false, outline: { width: 2.5, color: k.rgb(...v) } }); k.drawCircle({ pos: k.vec2(cx, cy + 4), radius: 1.6, color: k.rgb(40, 34, 30) }); } // lock
      else if (b.id === "bestiary") { const bl = THEME.water; k.drawRect({ pos: k.vec2(cx - 9, cy - 7), width: 8, height: 15, radius: 1, color: k.rgb(...bl) }); k.drawRect({ pos: k.vec2(cx + 1, cy - 7), width: 8, height: 15, radius: 1, color: k.rgb(...bl) }); k.drawRect({ pos: k.vec2(cx - 1, cy - 8), width: 2, height: 17, color: k.rgb(40, 40, 52) }); } // open book
      else if (b.id === "cosmetics") { const pk = THEME.psychic; k.drawCircle({ pos: k.vec2(cx, cy), radius: 7, color: k.rgb(...pk) }); k.drawCircle({ pos: k.vec2(cx, cy), radius: 2.5, color: k.rgb(40, 34, 40) }); k.drawLine({ p1: k.vec2(cx - 9, cy + 8), p2: k.vec2(cx + 9, cy - 9), width: 2, color: k.rgb(230, 230, 240) }); } // spool + needle
    }

    // A "needs healing" BEACON — a pulsing healing-cross floating above the Healer when your active team
    // is hurt (common after a run). Guides you to free healing between runs without opening any menu;
    // vanishes the instant you heal. World-space (over the building); the pulse/bob freeze under reduce-motion.
    function drawHealBeacon(t) {
      if (!injured || !healerB) return;
      const b = healerB, bx = b.x, y = b.y - b.h / 2 - 24 + (reduce ? 0 : Math.sin(t * 2) * 2);
      const pulse = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 3);
      k.drawCircle({ pos: k.vec2(bx, y), radius: 17, color: k.rgb(...HEAL), opacity: 0.16 * pulse });   // soft glow
      k.drawCircle({ pos: k.vec2(bx, y), radius: 10, color: k.rgb(...HEAL), opacity: 0.9 });
      k.drawRect({ pos: k.vec2(bx - 5, y - 1.6), width: 10, height: 3.2, radius: 1, color: k.rgb(255, 255, 255), opacity: 0.95 }); // "+" cross
      k.drawRect({ pos: k.vec2(bx - 1.6, y - 5), width: 3.2, height: 10, radius: 1, color: k.rgb(255, 255, 255), opacity: 0.95 });
    }

    // A keeper's GREETING bubble — a short in-character line above the keeper's head that fades in as
    // the roof opens (you've stepped inside). Adds personality + reinforces what each building does,
    // without the static name-plates the user removed. Tail-less rounded pill (robust across the shim);
    // only the building you're inside shows one. Static (no animation) — fine under reduce-motion.
    function drawKeeperBarks() {
      for (const b of buildings) {
        if (b.kind !== "house" || !b.barks) continue;
        const ra = b.roofA != null ? b.roofA : 1;
        if (ra > 0.82) continue;                         // roof still mostly closed → keeper hidden
        const op = Math.min(1, (0.82 - ra) / 0.55);      // fade in with the interior reveal
        // The line chosen for this visit (varies per entry), unless a reactive override is active (e.g. cleric after a heal).
        const base = b.barks[b._barkPick || 0] || b.barks[0];
        const txt = (b._barkUntil && k.time() < b._barkUntil) ? b._barkText : base;
        const w = txt.length * 6.4 + 18, by = b.y - 50;
        k.drawRect({ pos: k.vec2(b.x - w / 2, by - 11), width: w, height: 22, radius: 8, color: k.rgb(...THEME.bgAlt), opacity: 0.92 * op, outline: { width: 1.5, color: k.rgb(...b.accent) } });
        k.drawText({ text: txt, pos: k.vec2(b.x, by), anchor: "center", size: 11, font: FONT, color: k.rgb(...THEME.text), opacity: op });
      }
    }

    // No text name-plates (user 2026-06-11) — each building is identified by its roof emblem + keeper.
    // Only the ACTIVE building gets a glowing ring + an E bubble (the interaction affordance).
    function drawLabels(t) {
      if (near) {
        const b = near, isCave = b.kind === "cave";
        // No proximity ring anywhere now (user 2026-06-11) — the E bubble + bottom prompt (and the
        // portal's own glow/beckon for the cave) signal interaction without a floating circle.
        if (!TOUCH) {
          const by = isCave ? b.y - 92 : b.y - b.h / 2 - 42;
          const pulse = reduce ? 0.7 : 0.45 + 0.55 * (0.5 + 0.5 * Math.sin((t || 0) * 3.2)); // the badge gently breathes to draw the eye to the action (text stays crisp/static)
          k.drawCircle({ pos: k.vec2(b.x, by), radius: 21, color: k.rgb(...b.accent), opacity: 0.16 * pulse });
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
      const teal = [58, 212, 198], ice = [202, 240, 255]; // the rift's own SPIRIT-LIGHT (cool teal + frost) — kept independent of the warm accent palette so the portal always reads as an otherworldly cool rift against the ember village
      // The portal BECKONS as you approach the mouth — glow swells, vortex spins up. Distance-based so it
      // still responds under reduce-motion (the spin boost is gated; the glow swell is static).
      const beckon = Math.max(0, Math.min(1, (240 - Math.hypot(me.x - x, me.y - (y + 44))) / 160));
      const spin = reduce ? 0 : t * (1 + beckon * 0.5), pulse = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 2.5);
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
      // A paved stone THRESHOLD landing in FRONT of the mouth (over the bluff base, spilling onto the
      // grass) — grounds the gateway and reads as a worn approach you step onto before a run.
      k.drawEllipse({ pos: k.vec2(x, y + 96), radiusX: 92, radiusY: 30, color: k.rgb(...STONE_DK), opacity: 0.9 });
      k.drawEllipse({ pos: k.vec2(x, y + 94), radiusX: 84, radiusY: 26, color: k.rgb(...STONE) });
      for (const sx of [-50, -17, 17, 50]) k.drawLine({ p1: k.vec2(x + sx * 0.62, y + 72), p2: k.vec2(x + sx, y + 118), width: 1.5, color: k.rgb(...STONE_DK), opacity: 0.45 }); // flagstone seams
      k.drawEllipse({ pos: k.vec2(x, y + 94), radiusX: 84, radiusY: 26, fill: false, outline: { width: 2, color: k.rgb(...STONE_LT) }, opacity: 0.28 }); // worn lit edge
      k.drawEllipse({ pos: k.vec2(x, y + 86), radiusX: 60, radiusY: 14, color: k.rgb(...teal), opacity: (0.05 + 0.1 * beckon) * pulse }); // the portal light spills onto the stone
      // ── the VORTEX ──
      for (const [r, o] of [[80, 0.10], [60, 0.16], [42, 0.22]]) k.drawEllipse({ pos: k.vec2(x, y + 6), radiusX: r * (1 + beckon * 0.12), radiusY: r * 1.15 * (1 + beckon * 0.12), color: k.rgb(...teal), opacity: o * pulse * (1 + beckon * 0.85) }); // outward glow (swells as you approach)
      // TQ-146: a crisp spirit-light LIP around the mouth so the rift reads against the stone bluff
      // (was muddy — the dark recess melted into the rock). Brightens as you approach (beckon).
      k.drawEllipse({ pos: k.vec2(x, y + 6), radiusX: 53, radiusY: 64, color: k.rgb(...ice), opacity: 0.4 + 0.35 * beckon });
      k.drawEllipse({ pos: k.vec2(x, y + 6), radiusX: 50, radiusY: 60, color: k.rgb(5, 8, 12) }); // dark recess
      // TQ-146: a layered parallax STARFIELD inside the rift — depth + magic. Each star keeps a fixed
      // angle/radius (trig hash, so it doesn't jitter per frame) and is pulled inward over time (the
      // vortex), dimmer/smaller the deeper it sits, fading out as it reaches the bright core. Clamped
      // inside the recess so it never spills onto the stone. Reduce-motion → a static scatter (still deep).
      const starN = reduce ? 10 : 20;
      for (let i = 0; i < starN; i++) {
        const seed = i * 2.3994; // ~golden-angle spread so they never clump
        const ang = seed * 2.0, base = Math.sin(seed * 12.9898) * 0.5 + 0.5; // fixed 0..1 per star
        const depth = 0.35 + base * 0.65; // parallax weight (front stars brighter/bigger/faster)
        const drift = reduce ? base : (t * (0.05 + depth * 0.07) + base) % 1; // inward 1→0 over time
        const rr = (1 - drift) * 0.9; // normalized radius (< recess edge)
        const sx = x + Math.cos(ang) * rr * 46, sy = y + 6 + Math.sin(ang) * rr * 56;
        const tw = reduce ? 0.7 : 0.4 + 0.6 * ((Math.sin(t * 3 + seed) + 1) / 2); // twinkle
        k.drawCircle({ pos: k.vec2(sx, sy), radius: Math.max(0.5, depth * 1.7 * tw),
          color: k.rgb(...(i % 4 ? ice : [150, 235, 255])), opacity: (0.25 + 0.5 * depth) * tw * (0.4 + 0.6 * (1 - drift)) });
      }
      for (let i = 0; i < 5; i++) { // rotating concentric rings
        const rr = 46 - i * 8, a = spin * (1 + i * 0.3), ox = Math.cos(a) * (3 + i), oy = Math.sin(a) * (2 + i * 0.6);
        k.drawEllipse({ pos: k.vec2(x + ox, y + 6 + oy), radiusX: rr, radiusY: rr * 1.18, fill: false, outline: { width: 3, color: k.rgb(...(i % 2 ? teal : ice)) }, opacity: 0.3 + 0.1 * i });
      }
      k.drawEllipse({ pos: k.vec2(x, y + 6), radiusX: 16 * pulse, radiusY: 19 * pulse, color: k.rgb(...teal), opacity: 0.5 + 0.3 * beckon }); // core (intensifies on approach)
      k.drawEllipse({ pos: k.vec2(x, y + 6), radiusX: 9 * pulse, radiusY: 11 * pulse, color: k.rgb(...ice) });
      k.drawCircle({ pos: k.vec2(x, y + 4), radius: 5 * pulse, color: k.rgb(235, 255, 255) });
      if (!reduce) for (let i = 0; i < 8; i++) { // orbiting sparks
        const a = spin * 1.6 + (i / 8) * Math.PI * 2, px = x + Math.cos(a) * 44, py = y + 6 + Math.sin(a) * 52, nr = (Math.sin(a) + 1) / 2;
        k.drawCircle({ pos: k.vec2(px, py), radius: 1.4 + 2 * nr, color: k.rgb(...ice), opacity: 0.4 + 0.5 * nr });
      }
      if (!reduce) for (let i = 0; i < 5; i++) { const f = (t * 0.5 + i * 0.2) % 1; k.drawCircle({ pos: k.vec2(x + Math.sin(t + i * 2) * 26, y + 40 - f * 50), radius: Math.max(0.5, (1 - f) * 2.4), color: k.rgb(...teal), opacity: 0.5 * (1 - f) }); } // rising motes
      // TQ-146: a BECKON pulse — when you step toward the mouth the rift sends a spirit-light ring
      // out to meet you (clearer "come in" cue than the static glow swell). Reduce-motion: no pulse.
      if (!reduce && beckon > 0.05) {
        const f = (t * 0.45) % 1; // 0→1 expand-and-fade
        k.drawEllipse({ pos: k.vec2(x, y + 6), radiusX: 44 + f * 46, radiusY: (44 + f * 46) * 1.16,
          fill: false, outline: { width: 2.5, color: k.rgb(...ice) }, opacity: 0.3 * beckon * (1 - f) });
      }
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
    // A robed SCHOLAR (bestiary) — flat cap, spectacles, an open glowing book. Blue.
    function drawScholarKeeper(x, y, t) {
      const robe = [70, 86, 120], robeDk = [44, 56, 84], blue = THEME.water, skin = [210, 176, 140];
      const bob = reduce ? 0 : Math.sin(t * 1.8) * 1.1, yy = y - bob;
      k.drawEllipse({ pos: k.vec2(x, yy + 16), radiusX: 20, radiusY: 28, color: k.rgb(...robe) });
      k.drawEllipse({ pos: k.vec2(x, yy - 4), radiusX: 15, radiusY: 14, color: k.rgb(...robe) });
      k.drawEllipse({ pos: k.vec2(x - 11, yy - 2), radiusX: 3.2, radiusY: 9, color: k.rgb(...blue), opacity: 0.25 });
      k.drawCircle({ pos: k.vec2(x, yy - 17), radius: 9, color: k.rgb(...skin) });
      k.drawRect({ pos: k.vec2(x - 11, yy - 22), width: 22, height: 6, radius: 2, color: k.rgb(...robeDk) });
      k.drawRect({ pos: k.vec2(x - 11, yy - 25), width: 22, height: 4, radius: 1, color: k.rgb(...robeDk) });
      k.drawCircle({ pos: k.vec2(x - 3.2, yy - 17), radius: 2, fill: false, outline: { width: 1, color: k.rgb(40, 40, 52) } });
      k.drawCircle({ pos: k.vec2(x + 3.2, yy - 17), radius: 2, fill: false, outline: { width: 1, color: k.rgb(40, 40, 52) } });
      k.drawRect({ pos: k.vec2(x - 12, yy + 4), width: 24, height: 14, radius: 2, color: k.rgb(...blue), opacity: 0.85 });
      k.drawRect({ pos: k.vec2(x - 11, yy + 5.5), width: 9, height: 1.5, color: k.rgb(255, 255, 255), opacity: 0.45 });
      k.drawRect({ pos: k.vec2(x + 2, yy + 5.5), width: 9, height: 1.5, color: k.rgb(255, 255, 255), opacity: 0.45 });
      k.drawLine({ p1: k.vec2(x, yy + 4), p2: k.vec2(x, yy + 18), width: 1.5, color: k.rgb(...robeDk) });
    }
    // A flamboyant TAILOR (outfitter / cosmetics) — measuring tape, feathered hat. Pink.
    function drawTailorKeeper(x, y, t) {
      const coat = [120, 80, 128], coatDk = [80, 52, 88], pink = THEME.psychic, skin = [214, 170, 140];
      const bob = reduce ? 0 : Math.sin(t * 1.9) * 1.1, yy = y - bob;
      k.drawEllipse({ pos: k.vec2(x, yy + 16), radiusX: 19, radiusY: 27, color: k.rgb(...coat) });
      k.drawLine({ p1: k.vec2(x - 10, yy - 6), p2: k.vec2(x - 6, yy + 14), width: 3, color: k.rgb(...pink), opacity: 0.85 });
      k.drawLine({ p1: k.vec2(x + 10, yy - 6), p2: k.vec2(x + 6, yy + 14), width: 3, color: k.rgb(...pink), opacity: 0.85 });
      k.drawEllipse({ pos: k.vec2(x, yy - 4), radiusX: 14, radiusY: 13, color: k.rgb(...coat) });
      k.drawEllipse({ pos: k.vec2(x - 10, yy - 2), radiusX: 3, radiusY: 8, color: k.rgb(...pink), opacity: 0.3 });
      k.drawCircle({ pos: k.vec2(x, yy - 17), radius: 9, color: k.rgb(...skin) });
      k.drawEllipse({ pos: k.vec2(x, yy - 23), radiusX: 14, radiusY: 4, color: k.rgb(...coatDk) });
      k.drawEllipse({ pos: k.vec2(x - 2, yy - 27), radiusX: 8, radiusY: 7, color: k.rgb(...coatDk) });
      k.drawEllipse({ pos: k.vec2(x + 10, yy - 31), radiusX: 3, radiusY: 9, color: k.rgb(...pink), opacity: 0.85 });
    }
    // (drawSmithKeeper removed 2026-06-11 — the forge / base-upgrades smith is no longer in the game)


    // ── fixed HUD: camp name + the active station's interaction prompt ────────────────
    // Gutter HUD layout: where each cluster sits in the bezel AROUND the square play window. Mirrors
    // the in-run hudLayout philosophy (identity top-left, controls bottom, avatar top-right) and adapts
    // to landscape (gutters left/right) vs portrait (gutters top/bottom); near-square tucks on edges.
    function hubHud() {
      const W = k.width(), H = k.height();
      const lay = playWindowLayout(W, H, { maxAspect: 4 / 3 }); // TQ-96: match drawPlayWindow's ~4:3 window
      const sq = lay.square, pad = 12;
      const il = ins.left, ir = ins.right, it = ins.top, ib = ins.bottom;
      if (lay.landscape && sq.x >= 120) {
        const gRcx = sq.right + (W - sq.right) / 2;
        return { sq, avR: 20, idMaxW: sq.x - pad - il - 8, hintMaxW: sq.x - 16, // text must fit the left gutter (don't spill into the world)
          idX: pad + il, idY: pad + it, curX: pad + il, curY: pad + it + 52, curAnchor: "topleft",
          avX: W - pad - 22 - ir, avY: pad + it + 22,   // true top-right corner (not gutter-centre)
          promptX: sq.x / 2, promptY: H - ib - 120, hintX: sq.x / 2, hintY: H - ib - 150,
          joyX: sq.x / 2, joyY: H - ib - 84, useX: gRcx, useY: H - ib - 84 };
      }
      if (lay.portrait && sq.y >= 100) {
        const bcy = sq.bottom + (H - sq.bottom) / 2;
        return { sq, avR: 20, idMaxW: sq.cx - pad - il - 16, hintMaxW: W - 24, // full-width bottom gutter for the hint
          idX: pad + il, idY: pad + it, curX: sq.cx, curY: pad + it + 6, curAnchor: "top",
          avX: W - pad - 22 - ir, avY: pad + it + 22,
          promptX: sq.cx, promptY: sq.bottom + 16, hintX: sq.cx, hintY: H - ib - 14,
          joyX: sq.x + 84 + il, joyY: bcy + 6, useX: W - ir - 56, useY: bcy + 6 };
      }
      // near-square aspect: tuck onto the square's own edges (graceful fallback).
      return { sq, avR: 20, idMaxW: sq.cx - (sq.x + pad) - 16, hintMaxW: sq.size - 24, // hint fits within the square
        idX: sq.x + pad, idY: sq.y + pad, curX: sq.cx, curY: sq.y + pad, curAnchor: "top",
        avX: sq.right - pad - 22, avY: sq.y + pad + 22,
        promptX: sq.cx, promptY: sq.bottom - 40, hintX: sq.cx, hintY: sq.bottom - 18,
        joyX: sq.x + 90, joyY: sq.bottom - 90, useX: sq.right - 70, useY: sq.bottom - 70 };
    }

    function drawHud() {
      const L = hubHud();
      // Polished identity + INVENTORY panel (render/hubPanel.js): identity + currency, the active
      // TEAM with HP, equipped CHAINS and ITEMS — standardized drawPanel sections (shadow+sheen+rim).
      // Sized to the gutter room: the full stack in the tall landscape LEFT gutter; just identity in a
      // short portrait TOP gutter (curAnchor "topleft" ⟺ the full-height left-gutter layout).
      const hpW = Math.max(150, L.idMaxW || 200); // fill the whole gutter (left edge → in-game window), no upper clamp
      const hpRoom = L.curAnchor === "topleft"
        ? k.height() - L.idY - 12 - ins.bottom
        : Math.max(0, L.sq.y - L.idY - 8);
      drawHubPanel(k, { x: L.idX, y: L.idY, w: hpW, maxH: hpRoom, character, teamHitOut: teamHits });
      // Account avatar badge (clicks are hit-tested in pointerDown against this same position). On
      // desktop it gains a hover glow + pointer cursor so it reads as the clickable account menu (it
      // looked like a static label before); a small chevron always hints the dropdown.
      const mp = !TOUCH ? k.mousePos() : null;
      const avHover = !overlayOpen && mp && Math.hypot(mp.x - L.avX, mp.y - L.avY) <= L.avR + 6;
      if (!TOUCH) k.setCursor(avHover ? "pointer" : "default");
      if (avHover) k.drawCircle({ pos: k.vec2(L.avX, L.avY), radius: L.avR + 6, color: k.rgb(...accent), opacity: 0.22, fixed: true });
      k.drawCircle({ pos: k.vec2(L.avX, L.avY), radius: L.avR, color: k.rgb(...(authed ? accent : THEME.surfaceAlt)),
        outline: { width: avHover ? 3 : 2, color: k.rgb(...(authed ? accent : THEME.line)) }, fixed: true });
      k.drawText({ text: acctInitial, pos: k.vec2(L.avX, L.avY + 1), anchor: "center", size: 18, font: FONT, color: k.rgb(...(authed ? THEME.bg : THEME.textMut)), fixed: true });
      // Chevron under the badge — a persistent "this opens a menu" cue (two short lines form a "v";
      // the shim has no triangle primitive). Brightens with the hover state.
      const chC = k.rgb(...(avHover ? accent : THEME.textMut)), chO = avHover ? 1 : 0.8;
      k.drawLine({ p1: k.vec2(L.avX - 4, L.avY + L.avR + 2), p2: k.vec2(L.avX, L.avY + L.avR + 6), width: 2, color: chC, opacity: chO, fixed: true });
      k.drawLine({ p1: k.vec2(L.avX + 4, L.avY + L.avR + 2), p2: k.vec2(L.avX, L.avY + L.avR + 6), width: 2, color: chC, opacity: chO, fixed: true });
      // Server presence dot (bottom-right of the badge) — green = online/ready to run, amber (gently
      // pulsing) = still connecting. A cold server can take a moment; this surfaces it before you commit.
      const online = !!net.state.playerId, pdx = L.avX + L.avR * 0.72, pdy = L.avY + L.avR * 0.72;
      const pPulse = (!online && !reduce) ? (0.55 + 0.45 * Math.sin(k.time() * 4)) : 1;
      k.drawCircle({ pos: k.vec2(pdx, pdy), radius: 6, color: k.rgb(...THEME.bg), fixed: true });                                  // separator ring
      // Shape distinguishes the state too (not just hue) — colourblind-safe per the project's deuteranopia
      // standard: SOLID green = online/ready, HOLLOW pulsing amber = connecting.
      if (online) k.drawCircle({ pos: k.vec2(pdx, pdy), radius: 4, color: k.rgb(82, 200, 124), fixed: true });
      else k.drawCircle({ pos: k.vec2(pdx, pdy), radius: 4, fill: false, outline: { width: 2, color: k.rgb(...THEME.amber) }, opacity: pPulse, fixed: true });
      if (avHover) { // spell out what the dot means on hover (desktop)
        const st = online ? "Online" : "Connecting…", sc = online ? [82, 200, 124] : THEME.amber, tw = st.length * 7 + 16, ty = L.avY + L.avR + 22;
        k.drawRect({ pos: k.vec2(L.avX - tw / 2, ty - 9), width: tw, height: 18, radius: 6, color: k.rgb(...THEME.bgAlt), opacity: 0.92, fixed: true });
        k.drawText({ text: st, pos: k.vec2(L.avX, ty), anchor: "center", size: 11, font: FONT, color: k.rgb(...sc), fixed: true });
      }
      // Interaction prompt / movement hint — in the bottom (or bottom-of-left) gutter.
      if (near) {
        const txt = TOUCH ? near.hint : `Press  E  —  ${near.hint}`;
        const w = txt.length * 9 + 28;
        k.drawRect({ pos: k.vec2(L.promptX - w / 2, L.promptY - 16), width: w, height: 32, radius: 9, color: k.rgb(...THEME.bgAlt), opacity: 0.92, outline: { width: 2, color: k.rgb(...near.accent) }, fixed: true });
        k.drawText({ text: txt, pos: k.vec2(L.promptX, L.promptY), anchor: "center", size: 15, font: FONT, color: k.rgb(...THEME.text), fixed: true });
      } else {
        // Retire the controls hint once the player has clearly learned to move (≥2s of motion, then a
        // 1.5s fade) — onboarding text shouldn't linger as permanent clutter for a returning player.
        const hintOp = (movedTime < 2 ? 1 : Math.max(0, 1 - (movedTime - 2) / 1.5)) * 0.8;
        if (hintOp > 0.02) {
          const hint = TOUCH ? "drag to move (push to sprint)" : "WASD / arrows to move (Shift to sprint)";
          k.drawText({ text: hint, pos: k.vec2(L.hintX, L.hintY), anchor: "center", size: 12, font: FONT, color: k.rgb(...THEME.textMut), opacity: hintOp, fixed: true });
        }
      }
    }

    // ── Healer (ported from lobby.js task 50): free full heal of the active team ──────
    function isHurt(m) {
      try {
        const st = getMonsterStats(getMonsterType(m.typeName), m.level);
        return (m.currentHealth ?? st.health) < st.health || (m.currentEnergy ?? st.energy) < st.energy || !!m.status;
      } catch { return false; }
    }
    function teamInjured() { return (prof().activeMonsters || []).some(isHurt); }
    function healNow() {
      if (!teamInjured()) { toast("Team already at full health"); return; }
      injured = false; injuredCheck = k.time(); // beacon off immediately (don't wait for the throttle)
      if (net.state.playerId) {
        // TQ-197: the server echoes a roster reply carrying ok/locked (emit passes the raw msg). Honour
        // it — a heal is gated to the IDLE state server-side, so a stale/non-idle session returns
        // {ok:false, locked:true}. Previously we toasted "Team healed" regardless, so a REFUSED heal
        // looked successful while HP never changed (a "Healer doesn't work" report). Report each case
        // truthfully and re-arm the beacon (injuredCheck=-999 → recheck next frame) when nothing healed.
        const onHealed = () => { toast("Team healed"); triggerHealBurst(); sfx("pickup"); clericThanks(); };
        const off = net.on("roster", (m) => {
          off();
          if (m && m.ok === false) { toast(m.locked ? "Can't heal during a run" : "Couldn't heal the team"); injuredCheck = -999; return; }
          onHealed();
        });
        sessionOffs.push(off);
        try { net.heal(); } catch { off(); toast("Healer unavailable"); injuredCheck = -999; }
      } else {
        try { healTeam(character.activeMonsters); saveCharacter(character); } catch {}
        toast("Team healed"); triggerHealBurst(); sfx("pickup"); clericThanks();
      }
    }
    // Fire the heal flourish at the player's current spot (they're standing in the Healer when it lands).
    function triggerHealBurst() { healFx = k.time() + 1.3; healFxX = me.x; healFxY = me.y; }
    // The cleric briefly acknowledges the heal (you're inside the Healer, so the bark bubble is showing).
    function clericThanks() { if (healerB) { healerB._barkText = "Rest easy now, tamer."; healerB._barkUntil = k.time() + 3.5; } }
    // The heal burst: an expanding green ring + soft halo + rising "+" cross motes, fading over ~1.3s.
    // World-space (anchored where the heal happened) and drawn over the props. Motes freeze under
    // reduce-motion — just the ring + halo fade, so the confirmation still reads without motion.
    function drawHealBurst(t) {
      if (!healFx || t > healFx) return;
      const f = (1.3 - (healFx - t)) / 1.3;          // 0..1 progress
      const x = healFxX, y = healFxY, fade = 1 - f;
      k.drawCircle({ pos: k.vec2(x, y - 6), radius: 20 + f * 10, color: k.rgb(...HEAL), opacity: 0.16 * fade });            // soft halo
      const rr = 10 + f * 34;
      k.drawEllipse({ pos: k.vec2(x, y + 8), radiusX: rr, radiusY: rr * 0.5, fill: false, outline: { width: 3, color: k.rgb(...HEAL) }, opacity: 0.5 * fade }); // ground ring
      if (reduce) return;
      for (let i = 0; i < 7; i++) {                  // rising "+" cross motes (the healer motif)
        const lf = (f + i * 0.06) % 1, op = 0.85 * (1 - lf), sz = 2 + (1 - lf) * 2;
        const mx = x + Math.cos(i * 1.7) * (7 + i * 3), my = y + 8 - lf * 46;
        k.drawRect({ pos: k.vec2(mx - sz, my - 0.8), width: sz * 2, height: 1.6, color: k.rgb(...HEAL), opacity: op });
        k.drawRect({ pos: k.vec2(mx - 0.8, my - sz), width: 1.6, height: sz * 2, color: k.rgb(...HEAL), opacity: op });
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

    // The one-time welcome banner (see welcomeEnd). Centred near the top of the play window so it sits
    // over the world, clear of the HUD gutters in both orientations; fades in then out on its own.
    k.onDraw(() => {
      if (overlayOpen || !welcomeShow) return;
      if (welcomeStart < 0) welcomeStart = k.time();        // begin the 7s window on the first real draw
      const age = k.time() - welcomeStart;
      if (age > 7) { welcomeShow = false; return; }
      const op = Math.max(0, Math.min(1, age / 0.4, (7 - age) / 0.7));
      if (op <= 0.01) return;
      const sq = playWindowLayout(k.width(), k.height(), { maxAspect: 4 / 3 }).square; // TQ-96: match drawPlayWindow's ~4:3 window
      const cx = sq.cx, y = sq.y + 54, w = Math.min(sq.size - 24, 380);
      k.drawRect({ pos: k.vec2(cx - w / 2, y - 32), width: w, height: 64, radius: 12, color: k.rgb(...THEME.bgAlt), opacity: 0.9 * op, outline: { width: 2, color: k.rgb(...THEME.teal) }, fixed: true });
      k.drawText({ text: "Welcome to the village, tamer!", pos: k.vec2(cx, y - 11), anchor: "center", size: 15, font: FONT, color: k.rgb(...THEME.text), opacity: op, fixed: true });
      k.drawText({ text: "Explore the keepers — enter the glowing cave to run.", pos: k.vec2(cx, y + 11), anchor: "center", size: 11, font: FONT, color: k.rgb(...THEME.textMut), opacity: op, fixed: true });
    });

    // ── Cave run handshake (ported from lobby.js): SP/MP picker → connect/queue → onlineGame ──
    const netOffs = [];
    let leaving = false;
    let overlayOpen = false;
    let connectingFx = false; // draw the rift vortex on the connecting/world-gen screen
    let acctPanelRect = null; // TQ-88: the account dropdown's panel rect {x,y,w,h} while open — pointerDown uses it to close on an outside press
    let detailMon = null; // TQ-128: the team monster whose SHARED detail popup is open (immediate-mode; drawn over the village, closed on Esc/tap)
    const teamHits = []; // TQ-17: hub-panel TEAM row rects (rebuilt each frame by drawHubPanel) for tap/click → detail
    // TQ-118/119: in-lobby STATION POPUP. A separate overlay (mirrors detailMon): drawn over the still-
    // visible village, freezes movement, consumed by pointer/Esc — does NOT set overlayOpen. Each station
    // supplies a content panel ({ draw, tap, scroll, state, hasDetail }); the shell clips it (TQ-164).
    let stationPopup = null;        // active panel object or null
    let popupPressing = false, popupLastY = 0, popupMoved = 0; // press → drag-scroll vs tap
    let popupOpenedT = -1;          // TQ-302: scene-time the popup opened — the OPENING press's stray pointerdown (same frame) must not arm popupPressing (else its release reads as an outside-tap → instant close)
    let popupToast = "", popupToastT = 0, popupShopOff = null; // shop buy/upgrade server-reply toast
    const popupShowToast = (s) => { popupToast = s; popupToastT = 2.0; };
    function caughtSet() { // lowercased typeNames the player owns → bestiary dims the rest
      const s = new Set();
      for (const m of [...(net.state.team || []), ...(net.state.vault || [])]) s.add(String(m.typeName || "").toLowerCase());
      return s.size ? s : null;
    }
    function openStationPopup(id) {
      if (overlayOpen || detailMon || stationPopup) return;
      sfx("ui"); popupPressing = false; popupToastT = 0; popupOpenedT = k.time(); // TQ-302: mark the open frame so the opening press can't be mistaken for an outside-tap close
      if (id === "bestiary") stationPopup = { id, title: "Bestiary", state: bestiaryPanelState(caughtSet()), draw: drawBestiaryPanel, tap: bestiaryPanelTap, scroll: bestiaryPanelScroll, hasDetail: true };
      else if (id === "shop") {
        stationPopup = { id, title: "Spirit Shop", state: shopPanelState(), draw: drawShopPanel, tap: shopPanelTap, scroll: shopPanelScroll, hasDetail: false };
        popupShopOff = net.on("shop", (m) => popupShowToast(m.ok ? "Done!" : m.locked ? "Locked during a run." : m.reason === "essence" ? "Not enough essence." : m.reason === "maxed" ? "Already max tier." : m.reason === "owned" ? "You don't own that chain." : "Not enough gold.")); // mirrors onlineShop's reply messages; the wallet syncs via net.state
      }
      else if (id === "cosmetics") {
        stationPopup = { id, title: "Cosmetics", state: cosmeticsPanelState(), draw: drawCosmeticsPanel, tap: cosmeticsPanelTap, scroll: cosmeticsPanelScroll, hasDetail: false };
        popupShopOff = net.on("cosmetic", (m) => popupShowToast(m.ok ? "Purchased!" : m.reason === "essence" ? "Not enough essence." : m.reason === "gold" ? "Not enough gold." : m.reason === "owned" ? "Already owned." : "Can't buy that.")); // CN-9 reply; wallet + owned sync via net.state
      }
      else if (id === "battlepass") {
        stationPopup = { id, title: "Battle Pass", state: battlePassPanelState(), draw: drawBattlePassPanel, tap: battlePassPanelTap, scroll: battlePassPanelScroll, hasDetail: false };
        popupShopOff = net.on("bp", (m) => popupShowToast(m.ok ? "Claimed!" : m.reason === "no-entitlement" ? "Premium needs a subscription." : m.reason === "claimed" ? "Already claimed." : m.reason === "locked-tier" ? "Tier not reached yet." : "Couldn't claim.")); // TQ-183 reply; bpXp/bpClaimed/wallet sync via net.state
      }
      else if (id === "settings") {
        stationPopup = { id, title: "Settings", state: settingsPanelState(), draw: drawSettingsPanel, tap: settingsPanelTap, scroll: settingsPanelScroll, hasDetail: false }; // TQ-121: client-pref toggles (audio/a11y/shake); no net reply to subscribe
      }
      else if (id === "profile") {
        stationPopup = { id, title: "Profile", state: profilePanelState(characterId), draw: drawProfilePanel, tap: profilePanelTap, scroll: profilePanelScroll, hasDetail: false, hasModal: true, modal: drawProfileModal }; // TQ-199: read view + in-popup rename (DOM input layered above)
      }
      else if (id === "portal") {
        // TQ-345: the run launcher (Singleplayer / Multiplayer) as the unified in-lobby popup. Focus
        // defaults to the first ENABLED option (Multiplayer when the team is empty, since SP is disabled).
        stationPopup = { id, title: "Enter a Run", state: { focus: (prof().activeMonsters || []).length > 0 ? 0 : 1 }, draw: drawPortalPanel, tap: portalPanelTap, scroll: () => {}, hasDetail: false };
      }
    }
    function closeStationPopup() { if (!stationPopup) return; sfx("back"); if (stationPopup.state && stationPopup.state.dispose) stationPopup.state.dispose(); stationPopup = null; popupPressing = false; popupToastT = 0; if (popupShopOff) { popupShopOff(); popupShopOff = null; } }
    function drawStationPopupHub() {
      if (!stationPopup) return;
      drawStationPopup(k, { title: stationPopup.title, pointer: k.mousePos(), content: (kk, rect) => stationPopup.draw(kk, rect, stationPopup.state) });
      if (stationPopup.hasDetail && stationPopup.state.selected) drawMonsterDetail(k, stationPopup.state.selected, { scrim: true }); // OVER the popup, outside the clip
      if (stationPopup.hasModal && stationPopup.modal) stationPopup.modal(k, stationPopup.state); // TQ-199: panel's own full-screen modal (rename) over the popup, outside the clip
      if (popupToastT > 0) { popupToastT -= k.dt(); drawToast(k, { text: popupToast, t: popupToastT }); }
    }
    function popupTap(p) { // press-release with little movement = a tap inside the open popup
      if (stationPopup.hasModal && stationPopup.state.renaming) { stationPopup.tap(k, stationContentRect(k), stationPopup.state, p, popupShowToast); return; } // TQ-199: a panel modal owns all taps (full-screen) until dismissed
      if (stationPopup.hasDetail && stationPopup.state.selected) { stationPopup.state.selected = null; return; } // close detail-in-panel first
      if (inRect(p, stationCloseRect(k)) || !stationPopupInside(k, p)) { closeStationPopup(); return; } // X or outside → close
      stationPopup.tap(k, stationContentRect(k), stationPopup.state, p, popupShowToast); // a content tap (card / buy / upgrade)
    }
    function popupMove(p) { if (!popupPressing) return; const dy = popupLastY - p.y; popupMoved += Math.abs(dy); popupLastY = p.y; if (!(stationPopup.hasDetail && stationPopup.state.selected)) stationPopup.scroll(stationPopup.state, dy); }
    function popupUp(p) { if (!popupPressing) return; popupPressing = false; if (popupMoved < 6) popupTap(p); }
    let connectTimer = null;
    const cancelConnectTimer = () => { if (connectTimer) { connectTimer.cancel(); connectTimer = null; } };
    function clearNet() { netOffs.forEach((off) => off && off()); netOffs.length = 0; }
    function closeOverlay() { cancelConnectTimer(); clearNet(); k.destroyAll("overlay"); overlayOpen = false; navItems = null; connectingFx = false; menuKeepsWorld = false; acctPanelRect = null; }

    // A small swirling RIFT VORTEX on the connecting/world-gen screen — ties the wait to the cave you
    // just stepped into (premium transition, esp. during MP queue waits). Reuses the portal aesthetic;
    // screen-space; rings freeze under reduce-motion. Drawn only while startServerRun's overlay is up.
    k.onDraw(() => {
      if (!connectingFx || !overlayOpen) return;
      const t = k.time(), cx = k.width() / 2, vy = k.height() / 2 - 43;
      const teal = [58, 212, 198], ice = [202, 240, 255]; // the rift's own SPIRIT-LIGHT (cool teal + frost) — kept independent of the warm accent palette so the portal always reads as an otherworldly cool rift against the ember village
      const spin = reduce ? 0 : t, pulse = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 2.5);
      for (const [r, o] of [[18, 0.12], [12, 0.18]]) k.drawCircle({ pos: k.vec2(cx, vy), radius: r, color: k.rgb(...teal), opacity: o * pulse, fixed: true });
      for (let i = 0; i < 3; i++) { const rr = 11 - i * 2.6, a = spin * (1 + i * 0.4); k.drawEllipse({ pos: k.vec2(cx + Math.cos(a) * (1.5 + i), vy + Math.sin(a) * (1 + i * 0.4)), radiusX: rr, radiusY: rr * 1.1, fill: false, outline: { width: 2, color: k.rgb(...(i % 2 ? teal : ice)) }, opacity: 0.35 + 0.1 * i, fixed: true }); }
      k.drawCircle({ pos: k.vec2(cx, vy), radius: 4 * pulse, color: k.rgb(...ice), fixed: true });
      k.drawCircle({ pos: k.vec2(cx, vy), radius: 2 * pulse, color: k.rgb(235, 255, 255), fixed: true });
    });

    // ── Overlay focus model: each modal registers its buttons (centre x/y + size + action) so they can
    //    be driven by keyboard (arrows/Enter) and gamepad (stick/A) — not just the mouse. setNav lands
    //    focus on the first ENABLED item; a pulsing ring (drawn below) shows it. ───────────────────────
    function setNav(items) {
      navItems = items && items.length ? items : null;
      navIdx = 0;
      if (navItems) { while (navIdx < navItems.length && navItems[navIdx].disabled) navIdx++; if (navIdx >= navItems.length) navIdx = 0; }
    }
    function navMove(d) {
      // TQ-345: arrows/W/S toggle the run-launcher popup's Singleplayer/Multiplayer focus.
      if (stationPopup) { if (stationPopup.id === "portal") { const f = d < 0 ? 0 : 1; if (stationPopup.state.focus !== f) { stationPopup.state.focus = f; sfx("hover"); } } return; }
      if (!overlayOpen || !navItems || navItems.length < 2) return;
      const n = navItems.length; let i = navIdx;
      for (let s = 0; s < n; s++) { i = (i + d + n) % n; if (!navItems[i].disabled) break; }
      if (i !== navIdx) { navIdx = i; sfx("hover"); }
    }
    function navActivate() {
      if (!overlayOpen || !navItems) return;
      const it = navItems[navIdx];
      if (it && !it.disabled && typeof it.action === "function") { sfx("click"); haptic(8); it.action(); }
    }
    // No selection ring on overlays (user request): the run picker + account dropdown are
    // mouse/touch-first, and the ring read as an unwanted highlight on the first item. Keyboard/
    // gamepad nav still works (arrows/stick move focus, Enter/A activates) — just without a drawn ring.

    // Overlays are FIXED (screen-space) so the moving camera never shifts them. Movement is frozen
    // while one is open (onUpdate early-returns), so the camera holds steady behind the dim too.
    function dim() {
      k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.anchor("topleft"), k.color(0, 0, 0), k.opacity(0.72), k.fixed(), "overlay"]);
    }
    const cw = (cap) => Math.min(cap, k.width() - 32);

    // TQ-345: the run launcher as the unified in-lobby station popup (was a bespoke overlay modal):
    // Singleplayer (disabled with no team) / Multiplayer drawn INTO the popup body; the shell draws the
    // "Enter a Run" title + Close[X] + scrim and routes taps. Keyboard/gamepad (focus + confirm) is wired
    // in the onUpdate station-popup branch + navMove/confirmKey so the lobby's core action stays usable
    // without a mouse. startServerRun() does the actual SP/MP handshake.
    function portalLayout(rect) {
      const [rx, ry, rw] = rect;
      const bw = Math.min(rw - 24, 300), bx = rx + rw / 2 - bw / 2;
      return { sp: [bx, ry + 56, bw, 48], mp: [bx, ry + 140, bw, 48] };
    }
    function portalHasMonsters() { return (prof().activeMonsters || []).length > 0; }
    function drawPortalPanel(kk, rect, state) {
      const [rx, ry, rw] = rect;
      const T = (n) => kk.rgb(...THEME[n]);
      const teamN = (prof().activeMonsters || []).length, has = teamN > 0;
      const stake = has ? `Both modes risk your ${teamN} monster${teamN > 1 ? "s" : ""} — extract to keep them` : "Both modes risk your saved team — extract to keep it";
      kk.drawText({ text: stake, pos: kk.vec2(rx + rw / 2, ry + 22), size: 13, font: FONT, color: T("textMut"), anchor: "center", width: rw - 16, align: "center", fixed: true });
      const L = portalLayout(rect), mp = kk.mousePos();
      drawButton(kk, { rect: L.sp, text: "Singleplayer", size: 19, fill: has ? THEME.primary : THEME.surfaceAlt, textColor: has ? THEME.textInv : THEME.textMut, disabled: !has, hover: inRect(mp, L.sp) || state.focus === 0, fixed: true });
      kk.drawText({ text: has ? "Solo run with your saved team" : "No monsters — visit the Vault first", pos: kk.vec2(rx + rw / 2, L.sp[1] + L.sp[3] + 12), size: 11, font: FONT, color: has ? T("textMut") : T("warn"), anchor: "center", fixed: true });
      drawButton(kk, { rect: L.mp, text: "Multiplayer", size: 19, fill: THEME.violet, textColor: THEME.textInv, hover: inRect(mp, L.mp) || state.focus === 1, fixed: true });
      kk.drawText({ text: "Live extraction vs other tamers", pos: kk.vec2(rx + rw / 2, L.mp[1] + L.mp[3] + 12), size: 11, font: FONT, color: T("textMut"), anchor: "center", fixed: true });
      if (!TOUCH) kk.drawText({ text: "Arrows / W / S to choose  —  Enter confirm  —  Esc close", pos: kk.vec2(rx + rw / 2, L.mp[1] + L.mp[3] + 38), size: 11, font: FONT, color: T("textMut"), anchor: "center", fixed: true });
    }
    function portalActivate() {
      if (!stationPopup || stationPopup.id !== "portal") return;
      const solo = stationPopup.state.focus === 0;
      if (solo && !portalHasMonsters()) { popupShowToast("No monsters — visit the Vault first"); return; }
      closeStationPopup(); startServerRun(solo);
    }
    function portalPanelTap(kk, rect, state, p, showToast) {
      const L = portalLayout(rect);
      if (inRect(p, L.sp)) { if (!portalHasMonsters()) { showToast && showToast("No monsters — visit the Vault first"); return true; } closeStationPopup(); startServerRun(true); return true; }
      if (inRect(p, L.mp)) { closeStationPopup(); startServerRun(false); return true; }
      return false;
    }

    // Both modes run a SERVER-AUTHORITATIVE round (SP/MP unify): connect (or reuse the session) →
    // join → queue → roundStart generates the map → onlineGame. SP uses queueSolo (instant private),
    // MP uses queue (matchmaking). Identical to lobby.js's handshake.
    function startServerRun(solo) {
      k.destroyAll("overlay");
      overlayOpen = true;
      connectingFx = true; // show the rift vortex while connecting / generating the world
      dim();
      const cx = k.width() / 2, my = k.height() / 2;
      addPanel(k, { x: cx, y: my, w: cw(380), h: 220, radius: 18, fixed: true, tag: "overlay" });
      addLabel(k, { x: cx, y: my - 74, text: solo ? "Singleplayer" : "Multiplayer", size: 22, color: THEME.text, fixed: true, tag: "overlay" });
      const status = k.add([k.text(solo ? "Starting your run…" : "Connecting…", { size: 16, font: FONT, width: cw(380) - 40, align: "center" }),
        k.pos(cx, my - 16), k.anchor("center"), k.color(...THEME.textMut), k.fixed(), "overlay"]);
      const setStatus = (sx) => { try { status.text = sx; } catch {} };
      addButton(k, { x: cx, y: my + 64, w: cw(200), h: 42, text: "Cancel", size: 16,
        fill: THEME.surfaceAlt, textColor: THEME.text, fixed: true, tag: "overlay",
        onClick: () => { try { net.unqueue(); } catch {} closeOverlay(); } });
      setNav([{ x: cx, y: my + 64, w: cw(200), h: 42, action: () => { try { net.unqueue(); } catch {} closeOverlay(); } }]);

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
          generateMap((p) => setStatus(`Generating world… ${Math.round(p * 100)}%`), net.state.seed, net.state.roundBiomes, net.state.roundComp) // TQ-365/367: same biome set + tile composition as the server
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
      if (overlayOpen) { sfx("back"); closeOverlay(); return; } // toggle / dismiss any open overlay (incl. the run picker)
      sfx("ui"); // audio feedback on open (parity with the run picker's click) — the avatar tap/Esc/Start were silent
      overlayOpen = true;
      menuKeepsWorld = true; // keep the village + HUD visible behind this dropdown (no dim, no blank screen)
      k.destroyAll("overlay");
      // The secondary facilities the old menu-lobby had as stations but the camp doesn't: Bestiary
      // (collection), Cosmetics (skins) and Base Upgrades (gold meta-upgrades). Routed here so they
      // stay reachable now that the camp is the ONLY lobby (otherwise they'd be dead). All return here.
      const more = [
        // How-to-play (TQ-47): open the canonical wiki (public/wiki.html redirects to the GitHub Wiki —
        // the single source of truth, NOT forked in-app). New tab so the run/session is never lost.
        { label: "How to Play", go: () => { try { window.open("/wiki.html", "_blank", "noopener"); } catch { /* popup blocked — no-op */ } } },
        { label: "Bestiary", go: () => k.go("bestiary", { backScene: "hub", backArgs: { characterId }, characterId }) },
        { label: "Cosmetics", go: () => k.go("cosmetics", { backScene: "hub", backArgs: { characterId } }) },
        // Get Essence (TQ-68): in-game entry to the premium-currency shop. Opens /pricing (the Buy
        // buttons there open a Paddle checkout; the verified webhook credits Essence to your profile).
        // New tab so the run/session is never lost — same pattern as How to Play.
        { label: "Get Essence", go: () => { try { window.open("/pricing", "_blank", "noopener"); } catch { /* popup blocked — no-op */ } } },
        { label: "Battle Pass", go: () => openStationPopup("battlepass") }, // TQ-184: in-lobby battle-pass popup
        // (Base Upgrades removed per user 2026-06-11 — the smith/base-upgrades feature is out of the game)
      ];
      // Quick audio toggle — the lobby has a soundscape (SFX + ambient birdsong); let players silence it
      // here without digging into Settings. Label reflects the live state; toggles then closes.
      const muteItem = { label: isMuted() ? "Unmute sound" : "Mute sound", go: () => { toggleMuted(); closeOverlay(); } };
      const items = authed ? [
        { label: "View Profile", go: () => { closeOverlay(); openStationPopup("profile"); } }, // TQ-199: opens as an in-lobby popup (k.go("profile",…) stays the out-of-lobby fallback route)
        ...more,
        { label: "Account", go: () => k.go("account", { backScene: "hub", backArgs: { characterId } }) },
        muteItem,
        { label: "Settings", go: () => { closeOverlay(); openStationPopup("settings"); } }, // TQ-121: opens as an in-lobby popup (k.go("settings",…) stays the out-of-lobby fallback route)
        { label: "Switch Character", go: () => k.go("characterSelect") },
        { label: "Sign out", danger: true, go: () => { try { net.clearSession(); } catch { /* none */ } clearProfile(); k.go("start"); } },
      ] : [
        ...more,
        muteItem,
        { label: "Settings", go: () => { closeOverlay(); openStationPopup("settings"); } }, // TQ-121: opens as an in-lobby popup (k.go("settings",…) stays the out-of-lobby fallback route)
        { label: "Switch Character", go: () => k.go("characterSelect") },
        { label: "Log in", go: () => k.go("start") },
      ];
      const pwid = 204, rowH = 40, ph = items.length * rowH + 14;
      const L = hubHud();
      // Drop the panel from the avatar badge wherever it sits in the gutter, clamped on-screen.
      const pcx = Math.max(pwid / 2 + 8, Math.min(L.avX, k.width() - ins.right - 8 - pwid / 2));
      const ptop = Math.max(8, Math.min(L.avY + L.avR + 8, k.height() - ph - 8));
      addPanel(k, { x: pcx, y: ptop + ph / 2, w: pwid, h: ph, radius: 12, fixed: true, z: OVERLAY_Z, tag: "overlay" });
      acctPanelRect = { x: pcx - pwid / 2, y: ptop, w: pwid, h: ph }; // TQ-88: pointerDown closes the menu on a press outside this rect
      // Always tear the dropdown down (resets overlayOpen/menuKeepsWorld) BEFORE navigating, so a menu
      // pick can't leave a stale overlay behind on return to the hub (TQ-14). closeOverlay() is
      // idempotent, so muteItem's existing self-close double-firing is harmless.
      const choose = (it) => () => { closeOverlay(); it.go(); };
      items.forEach((it, i) => addButton(k, { x: pcx, y: ptop + 7 + rowH / 2 + i * rowH, w: pwid - 18, h: rowH - 6, z: OVERLAY_Z,
        text: it.label, size: 15, fill: THEME.surface, textColor: it.danger ? THEME.danger : THEME.text, fixed: true, tag: "overlay", onClick: choose(it) }));
      setNav(items.map((it, i) => ({ x: pcx, y: ptop + 7 + rowH / 2 + i * rowH, w: pwid - 18, h: rowH - 6, action: choose(it) })));
    }

    // ── Touch joystick + thumb interact button — gutter-positioned via hubHud. The avatar badge is
    //    hit-tested in pointerDown (immediate-mode draws can't receive clicks, and its gutter position
    //    moves with orientation/resize, so a fixed k.add area would drift). ─────────────────────────────
    const interactBtnPos = () => { const L = hubHud(); return k.vec2(L.useX, L.useY); };
    const joyRestPos = () => { const L = hubHud(); return k.vec2(L.joyX, L.joyY); };
    // Generous tap target around the avatar badge (~64px) so opening the account menu is comfortable on
    // a phone — the visible badge is only ~40px, below the 44px touch-target guideline on its own.
    const avatarHit = (p) => { const L = hubHud(); return Math.hypot(p.x - L.avX, p.y - L.avY) <= L.avR + 12; };
    function drawTouchControls() {
      if (!TOUCH) return; // MOBILE ONLY — on desktop a mouse-drag would otherwise paint the stick (joyId="m"); WASD/mouse still move
      const joyActive = joyId !== null;
      // Standardized stick (shared with the in-run overworld via inputMode.js): floating ring +
      // knob while dragging, faint discoverable rest hint at bottom-left when idle.
      drawJoystick(k, { base: joyActive ? joyBase : joyRestPos(), thumb: joyThumb, active: joyActive, radius: JOY_R });
      if (near) { // standardized "USE" action button (the touch equivalent of pressing E)
        drawTouchButton(k, { pos: interactBtnPos(), radius: IBTN_R, label: "Use", accent: near.accent });
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
    // Tap/click a TEAM row in the hub panel → a focused monster detail modal (stats, level/XP, type,
    // abilities). Mirrors the proven openPlay modal (full dim + centered panel) so it sits cleanly
    // above the immediate-mode world; dismiss via Close or Esc (closeOverlay resets overlayOpen — no
    // stale-overlay bleed). Pointer + touch both route through pointerDown. (TQ-17)
    // TQ-128: open the SHARED monster-detail popup (immediate-mode) over the still-drawn village —
    // set the flag; the onDraw renders drawMonsterDetail (it draws its own scrim) and Esc / a tap
    // closes it. Replaces ~70 lines of hand-rolled retained modal so the hub matches every surface.
    function openMonsterDetail(m) {
      if (overlayOpen || !m) return; // a focused overlay (run picker / account menu) is up
      sfx("ui");
      detailMon = m;
    }
    function drawDetailPopup() {
      if (!detailMon) return;
      const mt = getMonsterType(detailMon.typeName);
      let st = {}; try { st = getMonsterStats(mt, detailMon.level); } catch { /* unknown type */ }
      drawMonsterDetail(k, mt, { vitals: {
        currentHealth: Math.round(detailMon.currentHealth ?? st.health ?? 0),
        maxHealth: st.health ?? Math.round(detailMon.currentHealth) ?? 1,
        currentEnergy: Math.round(detailMon.currentEnergy ?? 0),
        maxEnergy: st.energy ?? 0,
      } });
    }

    function pointerDown(id, p) {
      // TQ-118: press → drag-scroll or tap (resolved on release). TQ-302: a popup opened from a pointer
      // (e.g. the account-menu "Settings" button, whose onClick fires on pointerdown) gets a SECOND
      // pointerdown this same frame from the scene-level handler — ignore it, or its release would route
      // as an outside-tap and close the just-opened popup instantly. Genuine taps land on a later frame.
      if (stationPopup) { if (k.time() !== popupOpenedT) { popupPressing = true; popupLastY = p.y; popupMoved = 0; } return; }
      if (detailMon) { detailMon = null; return; } // TQ-128: a tap dismisses the monster-detail popup (consumed)
      if (overlayOpen) {
        // TQ-88: the account dropdown keeps the world visible behind it (menuKeepsWorld) with no dim
        // backdrop, so close it on a press OUTSIDE its panel, or on a second tap of the avatar badge
        // (toggle) — consumed here (return) so the closing press can't also drive the joystick or a
        // station behind it (overlay-bleed). Presses INSIDE the panel are menu items, handled by their
        // own button onClick. Other overlays (run picker / connecting / monster detail) have their own
        // dim backdrop + dismiss, so they keep the plain "ignore presses behind the modal" behaviour.
        if (menuKeepsWorld) {
          const r = acctPanelRect, inPanel = r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
          if (avatarHit(p) || !inPanel) closeOverlay();
        }
        return;
      }
      if (TOUCH && near) { const b = interactBtnPos(); if (Math.hypot(p.x - b.x, p.y - b.y) <= IBTN_R) { interact(); return; } }
      if (avatarHit(p)) { openAcctMenu(); return; } // tap the account badge → dropdown (it's gutter-positioned)
      for (const ht of teamHits) { // TQ-17: tap/click a team monster row → its detail modal
        const [hx, hy, hw, hh] = ht.rect;
        if (p.x >= hx && p.x <= hx + hw && p.y >= hy && p.y <= hy + hh) { openMonsterDetail(ht.mon); return; }
      }
      if (TOUCH) joyStart(id, p); // the virtual stick is TOUCH-ONLY — on desktop a mouse drag must NOT walk (the stick isn't even drawn there), WASD/gamepad only
    }
    k.onTouchStart((p, t) => pointerDown(t?.identifier ?? 0, p));
    k.onTouchMove((p, t) => { if (stationPopup) { popupMove(p); return; } joyMove(t?.identifier ?? 0, p); }); // TQ-118: drag-scroll the popup
    k.onTouchEnd((p, t) => { if (stationPopup) { popupUp(p); return; } joyEnd(t?.identifier ?? 0); });
    if (!TOUCH) {
      // Desktop: a mouse click still opens the account badge / overlays (via pointerDown), but it does
      // NOT drive the movement stick — the on-screen control is mobile-only; desktop walks with WASD.
      k.onMousePress(() => pointerDown("m", k.mousePos()));
      k.onMouseMove(() => { if (stationPopup) { popupMove(k.mousePos()); return; } if (joyId === "m") joyMove("m", k.mousePos()); }); // TQ-118
      k.onMouseRelease(() => { if (stationPopup) { popupUp(k.mousePos()); return; } joyEnd("m"); });
    }
    // TQ-118: wheel scrolls the open station popup (desktop).
    k.onScroll((d) => { if (stationPopup && !(stationPopup.hasDetail && stationPopup.state.selected)) stationPopup.scroll(stationPopup.state, (d?.y || 0) * 0.5); });

    // Esc toggles the account menu (and dismisses any open overlay first, via openAcctMenu's guard).
    k.onKeyPress("escape", () => { // TQ-118/128: station-popup detail → station popup → team-detail → account menu
      if (stationPopup) { if (stationPopup.hasModal && stationPopup.state.renaming) { stationPopup.state.dispose(); return; } if (stationPopup.hasDetail && stationPopup.state.selected) { stationPopup.state.selected = null; return; } closeStationPopup(); return; }
      if (detailMon) { detailMon = null; return; }
      openAcctMenu();
    });

    // DEV-only QA hook: drop the player at a world point (headless frame-timing makes walking to a
    // specific station unreliable). Stripped from the production bundle (import.meta.env.DEV).
    if (import.meta.env && import.meta.env.DEV) {
      try { window.__hubTele = (sx, sy) => { me.x = sx; me.y = sy; }; } catch { /* no window */ }
      try { window.__openStation = (id) => openStationPopup(id); } catch { /* no window */ } // TQ-118: QA hook for the in-lobby station popups
      try { window.__stationPopupId = () => (stationPopup ? stationPopup.id : null); } catch { /* no window */ } // TQ-302: observe which station popup is open (or null) for headless QA
      try { window.__avatarBadge = () => { const L = hubHud(); return { x: L.avX, y: L.avY, r: L.avR }; }; } catch { /* no window */ } // TQ-302: avatar-badge screen rect so QA can click it to open the account menu
    }

    // Smooth fade-IN on arrival — the lobby eases up from black instead of a hard cut, so every return
    // to the village (from a station or a finished run) feels like a polished arrival, not a jump-cut.
    // Registered last → drawn on top of the world, HUD AND any overlay; one short fade (a gentle ease,
    // not a strobe, so it's kept under reduce-motion). Self-contained; no scene-transition framework.
    // Start the clock on the FIRST draw — k.time() at scene-init is a different basis than at draw time,
    // so capturing enterT here (init) made f huge and the fade never showed (same trap as the welcome banner).
    let enterT = -1;
    k.onDraw(() => {
      if (enterT < 0) enterT = k.time();
      const f = (k.time() - enterT) / 0.42;
      if (f >= 1) return;
      const e = 1 - (1 - f) * (1 - f); // ease-out so it clears quickly then lingers faint
      k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: k.rgb(...THEME.bg), opacity: 1 - e, fixed: true });
    });

    k.onSceneLeave(() => { leaving = true; lastHubPos = { x: me.x, y: me.y }; lastHubChar = characterId; cancelConnectTimer(); clearNet(); offSession(); });
  });
}
