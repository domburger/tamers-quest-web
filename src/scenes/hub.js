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
import { sfx, haptic, isMuted, toggleMuted } from "../systems/audio.js"; // the overlay buttons self-wire SFX; the WALKABLE lobby (E/USE, proximity, heal) needs it added here; mute toggle in the account menu

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

    // ── The VILLAGE: TOP-DOWN buildings (you see the roof from above) clustered in the clearing, plus a
    //    dungeon CAVE PORTAL at the treeline. `w`×`h` is the roof footprint AND the collision hitbox —
    //    you walk AROUND buildings. Approaching a building fades its roof open (roofA, lerped in
    //    onUpdate) to reveal the interior + keeper. Bigger than before (user request). ────────────────
    // Houses are BIG + WALKABLE (user 2026-06-11): you stroll INTO them and the roof fades open to
    // reveal the interior + keeper; no collision, no text name-plate (identity is the roof emblem +
    // keeper). Only the cave keeps its rock collision (you approach the glowing mouth).
    const buildings = [
      { id: "cave",     kind: "cave",  ...TILE(15, 5.4),    w: 360, h: 184, accent: THEME.teal,   hint: "start a run",      rdy: 8,  act: () => openPlay() },
      { id: "merchant", kind: "house", design: 0, ...TILE(20.2, 9.4),   w: 376, h: 286, accent: THEME.amber,  hint: "spirit shop",      barks: ["Wares for a wanderer?", "Fresh stock today!", "Spend it while you've got it."], keeper: (x, y, t) => drawTraderKeeper(x, y, t), act: () => k.go("onlineShop", { characterId, backScene: "hub", backArgs: { characterId } }) },
      { id: "healer",   kind: "house", design: 2, ...TILE(8.2, 10.2),   w: 324, h: 252, accent: HEAL,         hint: "heal your team",   barks: ["Rest your spirits here.", "Let me tend your team.", "Be at ease, tamer."], keeper: (x, y, t) => drawClericKeeper(x, y, t), act: () => healNow() },
      { id: "vault",    kind: "house", design: 1, ...TILE(20.8, 17.8),  w: 324, h: 252, accent: THEME.violet, hint: "team & inventory", barks: ["Your team is safe with me.", "Nothing is lost here.", "Guarded, always."], keeper: (x, y, t) => drawGolemKeeper(x, y, t), act: () => k.go("roster", { characterId, backScene: "hub", backArgs: { characterId } }) },
      // (forge / base-upgrades smith removed per user 2026-06-11 — no longer in the game)
      { id: "bestiary", kind: "house", design: 1, ...TILE(8.8, 17.8),   w: 312, h: 240, accent: THEME.water,   hint: "monster archive", barks: ["Every spirit, catalogued.", "Knowledge is the truest catch.", "Ah, a curious mind."], keeper: (x, y, t) => drawScholarKeeper(x, y, t), act: () => k.go("bestiary", { backScene: "hub", backArgs: { characterId }, characterId }) },
      { id: "cosmetics", kind: "house", design: 0, ...TILE(14.8, 20.6), w: 312, h: 240, accent: THEME.psychic, hint: "cosmetics",       barks: ["Let's find your look.", "Style befitting a tamer.", "A fresh thread, perhaps?"], keeper: (x, y, t) => drawTailorKeeper(x, y, t),  act: () => k.go("cosmetics", { backScene: "hub", backArgs: { characterId } }) },
    ];
    buildings.forEach((b) => { b.roofA = 1; });
    const stations = buildings.filter((b) => b.act); // the interactable subset (proximity + prompt + act)
    const healerB = buildings.find((b) => b.id === "healer"); // the Healer (for the needs-healing beacon)

    // ── Village DECOR: deliberate props that make the clearing feel lived-in — a central WELL focal
    //    point, lit LANTERN posts along the paths, a SIGNPOST by spawn, and stock (barrels/crates/
    //    planters) by the shops. Each is y-sorted with the buildings + has a small collision circle so
    //    you walk around it (see walkable()). Flowers/grass are flat scatter (drawGroundScatter). ──────
    const decor = [
      { kind: "well",    ...TILE(15, 11.6),   r: 26 },
      { kind: "fountain", ...TILE(8.2, 12.9), r: 30 }, // the healer's glowing spring (restored from pre-village design)
      { kind: "sign",    ...TILE(12.9, 14.6), r: 7 },
      { kind: "lantern", ...TILE(11.4, 12.0), r: 6 },
      { kind: "lantern", ...TILE(18.6, 12.0), r: 6 },
      { kind: "lantern", ...TILE(12.6, 16.8), r: 6 },
      { kind: "lantern", ...TILE(17.6, 16.6), r: 6 },
      { kind: "lantern", ...TILE(12.8, 9.2),  r: 6 },  // flank + light the path up to the cave (the run portal)
      { kind: "lantern", ...TILE(17.2, 9.2),  r: 6 },
      { kind: "barrel",  ...TILE(23.4, 8.9),  r: 9 },  // merchant stock (beside the bigger building)
      { kind: "crate",   ...TILE(23.5, 10.2), r: 10 },
      { kind: "planter", ...TILE(5.6, 9.6),   r: 11 }, // healer herb garden (W side of the building)
      { kind: "planter", ...TILE(5.6, 11.2),  r: 11 },
      { kind: "barrel",  ...TILE(23.6, 18.6), r: 9 },  // vault crates
      { kind: "crate",   ...TILE(23.4, 17.3), r: 10 },
    ];
    // ── Critters: a few CHICKENS pecking around the plaza + BUTTERFLIES near the flowers — pure
    //    ambient LIFE (no interaction). Chickens wander toward random walkable targets within a home
    //    radius + peck; butterflies flutter a lissajous over the green. (Updated/drawn below.) ────────
    const critters = [];
    for (let i = 0; i < 4; i++) { const o = TILE(12.5 + i * 1.7, 14 + (i % 2) * 1.4); critters.push({ kind: "chicken", x: o.x, y: o.y, hx: o.x, hy: o.y, tx: o.x, ty: o.y, dir: 1, peck: 0, moving: false }); }
    for (let i = 0; i < 5; i++) { const o = TILE(11 + i * 1.7, 12 + (i % 2) * 2); critters.push({ kind: "butterfly", hx: o.x, hy: o.y, ph: i * 1.27 }); }

    // The building footprint = its roof rect; it is the collision hitbox (you walk AROUND it). The cave
    // portal blocks only a thin back arc (you approach the mouth), handled in walkable().
    const footRect = (b) => ({ x0: b.x - b.w / 2, x1: b.x + b.w / 2, y0: b.y - b.h / 2, y1: b.y + b.h / 2 });
    // Walkable = inside the clearing (the tree ring blocks beyond it). HOUSES are now WALKABLE — you
    // stroll inside and the roof fades open (user 2026-06-11). Only the CAVE's upper rock blocks, so
    // you approach the glowing mouth from below.
    function walkable(x, y) {
      if (ellip(x / E, y / E) > 1.05) return false;
      for (const b of buildings) {
        if (b.kind !== "cave") continue; // houses: no collision (walk in)
        const r = footRect(b);
        if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1 && y < b.y - 6) return false; // cave upper rock
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
    let movedTime = returning ? 999 : 0;  // cumulative move time — fades out the controls hint once learned (skip it for a returning player)
    let lastCluck = 0;                    // throttles the startled-hen cluck so walking through a flock isn't a racket
    let injured = false, injuredCheck = 0; // cached "team needs healing" flag (drives the Healer beacon); refreshed ~1s
    let nextChirp = -1;                    // schedules sparse ambient forest birdsong (a living-village sound bed)
    // One-time WELCOME banner for a brand-new player — orients them to the goal (the cave) once, ever,
    // then never nags again (persisted flag). Auto-fades; non-blocking. Returning players never see it.
    // The clock starts on the FIRST draw (k.time() at scene-init isn't the same basis as at draw time).
    let welcomeShow = false, welcomeStart = -1;
    try { welcomeShow = !localStorage.getItem("tq_hub_welcomed"); if (welcomeShow) localStorage.setItem("tq_hub_welcomed", "1"); } catch { /* storage blocked */ }
    // Overlay keyboard/gamepad navigation: a focusable list of the open modal's buttons so the lobby's
    // core action (start a run) is usable without a mouse. Populated by each overlay; cleared on close.
    let navItems = null, navIdx = 0, navStickReady = true;
    let near = null;                      // the building currently in reach (or null)
    let lastNearId = null;                // for a soft audio cue when you newly come within reach
    // Footstep dust: tiny puffs kicked up behind the feet while you walk — reactive game-feel (the world
    // responds to YOUR motion, not just ambient drift). Capped ring buffer; frozen under reduce-motion.
    const steps = [];
    let stepPhase = 0;
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
      if (moving) {
        dir = { x: dx, y: dy };
        if (!usingVec && dx && dy) { dx *= 0.707; dy *= 0.707; } // normalize diagonal (keyboard only)
        const step = SPEED * k.dt();
        // Axis-separated collision against walkable() — slide along the tree ring + house walls.
        const nx = me.x + dx * step, ny = me.y + dy * step;
        if (walkable(nx + Math.sign(dx) * PR, me.y)) me.x = nx;
        if (walkable(me.x, ny + Math.sign(dy) * PR)) me.y = ny;
        // Kick up a little dust puff behind the trailing foot at a walking cadence.
        if (!reduce) {
          stepPhase -= k.dt();
          if (stepPhase <= 0) {
            stepPhase = 0.15;
            const dl = Math.hypot(dx, dy) || 1;
            steps.push({
              x: me.x - (dx / dl) * 9 + (Math.random() - 0.5) * 6,
              y: me.y + 13 - (dy / dl) * 5 + (Math.random() - 0.5) * 4,
              t0: k.time(),
            });
            if (steps.length > 14) steps.shift();
          }
        }
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
      if (nid && nid !== lastNearId) sfx("hover");
      lastNearId = nid;
      // Roof fades open while you're INSIDE the (walkable) house footprint — a true "step inside" reveal.
      for (const b of buildings) if (b.kind === "house") {
        const inside = Math.abs(me.x - b.x) < b.w / 2 - 4 && Math.abs(me.y - b.y) < b.h / 2 - 4;
        if (inside && !b._inside && b.barks) b._barkPick = Math.floor(Math.random() * b.barks.length); // pick a fresh line each time you step in
        b._inside = inside;
        b.roofA += ((inside ? 0.08 : 1) - b.roofA) * Math.min(1, k.dt() * 6);
      }
      // Chickens wander toward random nearby walkable targets, then peck a beat before re-targeting —
      // UNLESS the player walks up, which startles them into scurrying away: a reactive, living-world
      // touch (the world responds to you, not just ambient wander).
      for (const c of critters) {
        if (c.kind !== "chicken") continue;
        if (reduce) { c.moving = false; continue; } // a11y: freeze wandering under reduce-motion (static hens; the bob/peck + butterflies + motes are already gated)
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
      // Refresh the "team needs healing" flag on a slow throttle (it drives the Healer beacon; cheap but
      // no need per-frame). Cleared instantly by healNow so the beacon vanishes the moment you heal.
      if (k.time() - injuredCheck > 1) { injuredCheck = k.time(); injured = teamInjured(); }
      // Sparse ambient birdsong — a faint, infrequent forest warble so the dusk village has a living
      // sound bed (not just reactive blips). First call a few seconds in, then every ~20–35s; muteable.
      if (nextChirp < 0) nextChirp = k.time() + 5 + Math.random() * 5;
      else if (k.time() > nextChirp) { sfx("birdcall"); nextChirp = k.time() + 20 + Math.random() * 15; }
      // Camera follows the player (1×, like the overworld); the forest + trees fill the screen edges.
      k.camPos(me.x, me.y);
    });

    // Interact: walk up to a station and press E / Enter / Space to use it.
    function interact() { if (!overlayOpen && near) { sfx("click"); haptic(8); near.act(); } }
    // E / Enter / Space CONFIRM: interact with a station while walking, or activate the focused button
    // when a modal is open — ONE handler per key. (Binding BOTH interact and navActivate to a key
    // double-fired on a single press: interact opened the picker, then navActivate instantly confirmed
    // its default option.) Arrows / W / S move focus within a modal (no-op while walking).
    const confirmKey = () => { if (overlayOpen) navActivate(); else interact(); };
    k.onKeyPress("e", confirmKey);
    k.onKeyPress("enter", confirmKey);
    k.onKeyPress("space", confirmKey);
    k.onKeyPress("up", () => navMove(-1));
    k.onKeyPress("w", () => navMove(-1));
    k.onKeyPress("down", () => navMove(1));
    k.onKeyPress("s", () => navMove(1));

    // ── render the VILLAGE: forest floor → clearing → y-sorted trees/houses/player → labels → HUD ──
    k.onDraw(() => {
      if (overlayOpen) return; // a modal is up; skip the world so the dim backdrop shows
      const t = k.time();
      drawTiles(k, campMap, me.x, me.y, tileCache, E); // continuous forest floor (no abyss)
      drawClearing();                                   // lift the village green + a worn plaza
      drawCanopyShade(t);                                // soft canopy-shade dapple (lush light-and-shade ground)
      drawPaths();                                       // dirt paths plaza → each building
      drawHearthGlow(t);                                 // soft warm light pooled over the village centre (cozy dusk)
      drawGroundScatter(t);                              // flat flowers + grass tufts + path pebbles
      drawFootsteps(t);                                  // dust puffs kicked up behind the walking player
      // Depth: trees (culled to view) + buildings + decor + player, sorted by base-y, drawn back→front.
      const cullX = k.width() / 2 + 100, cullY = k.height() / 2 + 150;
      const props = [];
      for (const tr of trees) if (Math.abs(tr.x - me.x) <= cullX && Math.abs(tr.y - me.y) <= cullY) props.push({ y: tr.y, d: () => drawTree(tr, t) });
      for (const d of decor) props.push({ y: d.y, d: () => drawDecor(d, t) });
      for (const c of critters) if (c.kind === "chicken") props.push({ y: c.y, d: () => drawChicken(c, t) });
      // Sort the house you're INSIDE just before the player so YOU draw on top of the interior +
      // faded roof (you stand in the shop, not hidden behind the counter); others sort by base-y.
      for (const b of buildings) props.push({ y: b._inside ? me.y - 1 : b.y, d: () => drawBuilding(b, t) });
      props.push({ y: me.y, d: () => drawCharacter(k, { x: me.x, y: me.y, t, moving, color: cos.accent, cloak: cos.cloak, model: cos.model, dir, skin: getEquippedSkin(), scale: PLAYER_SCALE }) });
      props.sort((a, b) => a.y - b.y);
      for (const p of props) p.d();
      drawFireflies(t);          // warm dusk fireflies drifting over the green (world-space, over props)
      drawButterflies(t);        // colourful butterflies fluttering over the flowers
      drawHealBurst(t);          // green heal flourish over the player when the Healer restores the team
      drawChimneySmoke(t);       // cozy smoke curling from each cottage chimney (fades as you step inside)
      drawLeaves(t);             // a few autumn leaves tumbling down on the breeze across the view
      drawBirds(t);              // an occasional flock gliding home across the dusk sky (fills the open air)
      drawKeeperBarks(t);        // a keeper's greeting bubble, fading in as you step inside their building
      drawHealBeacon(t);         // pulsing healing-cross over the Healer when your team needs healing
      drawLabels(t);             // building name plates + the active ring / E bubble, over the props
      drawAtmosphere(k, { t });  // same vignette + glow + motes ambient as a run
      drawPlayWindow(k);         // crop to the centred square; the HUD lives in the gutters
      drawHud();
      drawTouchControls();
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
      const px = VCX * E, py = VCY * E, dirt = [120, 102, 76];
      // A continuous worn ribbon UNDER the textured dabs so each path reads as a real trodden trail
      // rather than a dotted line — the uniform line fills the gaps between the dabs (which stay as
      // organic texture on top). The flat end-caps tuck under the plaza centre + the building.
      for (const b of buildings) {
        const fy = b.y + (b.kind === "cave" ? 34 : b.h / 2 - 8);
        k.drawLine({ p1: k.vec2(px, py), p2: k.vec2(b.x, fy), width: 24, color: k.rgb(...dirt), opacity: 0.22 });
      }
      for (const b of buildings) {
        const fy = b.y + (b.kind === "cave" ? 34 : b.h / 2 - 8);
        const n = 16;
        for (let i = 0; i <= n; i++) {
          const f = i / n, x = px + (b.x - px) * f, y = py + (fy - py) * f, w = 19 - 5 * f;
          k.drawEllipse({ pos: k.vec2(x, y), radiusX: w, radiusY: w * 0.7, color: k.rgb(...dirt), opacity: 0.4 });
        }
      }
    }

    // A soft warm HEARTH GLOW pooled over the village centre — a golden dusk light that ties the lit
    // village (lanterns, well, fireflies) together and reads cozy/inhabited against the cool forest +
    // teal cave portal. On the GROUND (props draw on top), 3 concentric steps (wide+faint → tight+
    // brighter) for a smooth falloff, subtle so it tints not washes, with a gentle breathe (frozen
    // under reduce-motion). The atmosphere vignette still keeps the far edges cool + dark.
    function drawHearthGlow(t) {
      const cx = VCX * E, cy = VCY * E, breathe = reduce ? 1 : 0.92 + 0.08 * Math.sin(t * 0.5);
      for (const [r, o] of [[7, 0.035], [5, 0.045], [3.2, 0.055]]) {
        k.drawEllipse({ pos: k.vec2(cx, cy), radiusX: r * E, radiusY: r * E * 0.82, color: k.rgb(255, 200, 134), opacity: o * breathe });
      }
    }

    // Footstep DUST — the puffs spawned behind the walking player (see onUpdate). Each is a small
    // dusty ellipse that expands + fades over ~0.55s; flat (drawn under the props) so it reads as dust
    // settling on the ground in the player's wake. Tan, low opacity — subtle tactile feedback.
    function drawFootsteps(t) {
      for (let i = 0; i < steps.length; i++) {
        const p = steps[i], f = (t - p.t0) / 0.55;
        if (f < 0 || f >= 1) continue;
        const r = 2 + f * 6;
        k.drawEllipse({ pos: k.vec2(p.x, p.y), radiusX: r, radiusY: r * 0.5, color: k.rgb(150, 134, 104), opacity: 0.24 * (1 - f) });
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
        // A WILDFLOWER MEADOW reclaiming the old forge plot (NW) — denser + flower-biased scatter so the
        // quieter quadrant reads as an intentional garden, not an empty gap left by the removed smithy.
        const meadow = Math.hypot(tx + 0.5 - 9.5, ty + 0.5 - 7) < 3;
        const h0 = hash(tx, ty, 7);
        if (h0 > (meadow ? 0.78 : 0.46)) continue;
        const gx = wx + (hash(tx, ty, 8) - 0.5) * 58, gy = wy + (hash(tx, ty, 9) - 0.5) * 58;
        if (h0 < (meadow ? 0.16 : 0.32)) { // grass tuft
          for (let i = -1; i <= 1; i++) k.drawLine({ p1: k.vec2(gx + i * 3, gy), p2: k.vec2(gx + i * 4, gy - 7 - (i === 0 ? 3 : 0)), width: 2, color: k.rgb(...LEAF_LT), opacity: 0.5 });
        } else { // flower
          const c = FLOWERS[Math.floor(hash(tx, ty, 10) * FLOWERS.length)];
          k.drawLine({ p1: k.vec2(gx, gy), p2: k.vec2(gx, gy - 6), width: 1.5, color: k.rgb(...LEAF), opacity: 0.6 });
          k.drawCircle({ pos: k.vec2(gx, gy - 7), radius: 2.6, color: k.rgb(...c), opacity: 0.85 });
          k.drawCircle({ pos: k.vec2(gx, gy - 7), radius: 1, color: k.rgb(245, 235, 150), opacity: 0.9 });
        }
      }
    }

    // Warm FIREFLIES drifting low over the green at dusk — sparse, slow, world-space (they pan with
    // the camera), each looping a lazy figure-8 around a fixed anchor spread across the clearing, with
    // a gentle blink. Warm amber so they read as village lamplight life — distinct from the teal,
    // screen-fixed spirit motes in drawAtmosphere. Frozen under reduce-motion.
    function drawFireflies(t) {
      if (reduce) return;
      const cx = VCX * E, cy = VCY * E;
      for (let i = 0; i < 13; i++) {
        const seed = i * 1.37;
        const ax = cx + Math.cos(seed * 2.1) * (70 + (i % 5) * 64);   // anchor spread across the green
        const ay = cy + Math.sin(seed * 1.7) * (60 + (i % 4) * 70);
        const x = ax + Math.sin(t * 0.5 + seed) * 26 + Math.cos(t * 0.31 + seed * 2) * 13; // figure-8 drift
        const y = ay + Math.cos(t * 0.43 + seed * 1.3) * 20 + Math.sin(t * 0.61 + seed) * 9;
        const blink = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 2.3 + seed * 3));
        k.drawCircle({ pos: k.vec2(x, y), radius: 6, color: k.rgb(255, 226, 142), opacity: 0.1 * blink });   // soft halo
        k.drawCircle({ pos: k.vec2(x, y), radius: 1.7, color: k.rgb(255, 242, 188), opacity: 0.85 * blink }); // bright core
      }
    }

    // A wandering CHICKEN (white hen): shadow, legs, plump body, tail, head with beak/comb/eye; the
    // head dips while pecking, the body bobs while walking. Mirrored by c.dir.
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

    // BUTTERFLIES — colourful flutterers tracing a lissajous over the green (flapping wings).
    const BFLY = [[255, 180, 90], [255, 140, 180], [150, 200, 255], [240, 230, 120]];
    function drawButterflies(t) {
      if (reduce) return;
      for (const c of critters) {
        if (c.kind !== "butterfly") continue;
        const px = c.hx + Math.sin(t * 0.8 + c.ph) * 72 + Math.cos(t * 0.5 + c.ph) * 30;
        const py = c.hy + Math.cos(t * 0.6 + c.ph * 1.4) * 50 - 18;
        if (ellip(px / E, py / E) > 1.05) continue;
        if (Math.abs(px - me.x) > k.width() / 2 + 40 || Math.abs(py - me.y) > k.height() / 2 + 50) continue;
        const flap = Math.abs(Math.sin(t * 15 + c.ph)), wing = 2.5 + flap * 4.5;
        const col = BFLY[Math.floor(c.ph) % BFLY.length];
        k.drawRect({ pos: k.vec2(px - 0.8, py - 4), width: 1.6, height: 8, color: k.rgb(40, 32, 30) });
        k.drawEllipse({ pos: k.vec2(px - wing * 0.55, py - 1), radiusX: wing, radiusY: 5, color: k.rgb(...col), opacity: 0.88 });
        k.drawEllipse({ pos: k.vec2(px + wing * 0.55, py - 1), radiusX: wing, radiusY: 5, color: k.rgb(...col), opacity: 0.88 });
        k.drawEllipse({ pos: k.vec2(px - wing * 0.5, py + 3), radiusX: wing * 0.7, radiusY: 3.5, color: k.rgb(...col), opacity: 0.7 });
        k.drawEllipse({ pos: k.vec2(px + wing * 0.5, py + 3), radiusX: wing * 0.7, radiusY: 3.5, color: k.rgb(...col), opacity: 0.7 });
      }
    }

    // Soft CHIMNEY SMOKE curling up from each cottage — a cozy "someone's home" cue that gives the
    // houses life from the outside. Per house (reads the buildings list); the chimney top is derived
    // from the same footprint drawHouse uses. Gated by the roof opacity (b.roofA) so it fades out as
    // you step inside, exactly like the chimney. World-space overlay; frozen under reduce-motion.
    function drawChimneySmoke(t) {
      if (reduce) return;
      for (const b of buildings) {
        if (b.kind !== "house") continue;
        const ra = b.roofA != null ? b.roofA : 1;
        if (ra < 0.35) continue;                                  // inside → chimney + smoke faded away
        const ox = b.x - b.w / 2 + 31, oy = b.y - b.h / 2 - 12;   // chimney top (matches drawHouse)
        for (let i = 0; i < 5; i++) {
          const f = (t * 0.32 + i * 0.2 + b.x * 0.0013) % 1;       // 0..1 rise progress (per-house phase)
          const xx = ox + Math.sin(t * 1.1 + i * 1.6 + b.x * 0.01) * (2 + f * 9); // curls outward as it rises
          k.drawCircle({ pos: k.vec2(xx, oy - f * 48), radius: 2.5 + f * 7, color: k.rgb(206, 206, 214), opacity: 0.2 * (1 - f) * ra });
        }
      }
    }

    // A few autumn LEAVES tumbling down on the breeze, spread across the view (camera-relative so they
    // always drift in frame). Each falls on its own slow cycle with a sideways sway; the radiusX
    // flutters edge-on↔flat to fake a tumble. Warm tones — a calm seasonal layer distinct from the
    // hovering fireflies + teal motes. Frozen under reduce-motion.
    const LEAF_TINT = [[198, 130, 66], [178, 94, 50], [156, 142, 70], [134, 152, 80], [210, 160, 92]];
    function drawLeaves(t) {
      if (reduce) return;
      const W = k.width(), H = k.height();
      for (let i = 0; i < 6; i++) {                          // few + big so they read as LEAVES, not specks
        const seed = i * 3.1, c = LEAF_TINT[i % LEAF_TINT.length];
        const period = 13 + (i % 4) * 3;                     // seconds to fall the column
        const f = ((t / period) + seed * 0.17) % 1;          // 0..1 fall progress
        const x = me.x - W / 2 + ((i + 0.5) / 6) * W + Math.sin(t * 0.6 + seed) * 38; // spread + sway
        const y = me.y - H / 2 - 30 + f * (H + 60);          // top → bottom of the view
        const tumble = Math.abs(Math.sin(t * 3.5 + seed * 3)); // 0 edge-on → 1 flat
        const rx = 2 + 6 * tumble;
        k.drawEllipse({ pos: k.vec2(x, y), radiusX: rx, radiusY: 6, color: k.rgb(...c), opacity: 0.6 });
        if (tumble > 0.45)                                   // a central vein when flat enough → reads as a leaf
          k.drawLine({ p1: k.vec2(x, y - 5.5), p2: k.vec2(x, y + 5.5), width: 1, color: k.rgb(Math.round(c[0] * 0.55), Math.round(c[1] * 0.55), Math.round(c[2] * 0.55)), opacity: 0.55 });
      }
    }

    // An occasional flock of BIRDS gliding home across the dusk sky — seen from above as little
    // flapping silhouettes sweeping the upper air in a loose V. On a long cycle: a brief pass, then an
    // EMPTY sky for a while (real birds, not a constant conveyor). Tracked to the visible play-window
    // square so they always cross frame, drawn OVER the props (they're above the village) — a different
    // KIND of life than the ground critters, filling the open air. Absent under reduce-motion.
    const FLOCK = [[0, 0], [-24, 13], [24, 13], [-48, 26], [48, 26]]; // leader + two trailing pairs
    function drawBirds(t) {
      if (reduce) return;
      const CYCLE = 30, VIS = 0.34;                 // a pass roughly every 30s, visible for the first ~third
      const cyc = (t % CYCLE) / CYCLE;
      if (cyc > VIS) return;                        // empty sky between passes
      const f = cyc / VIS;                          // 0..1 progress across the view
      const sq = playWindowLayout(k.width(), k.height()).square;
      const x0 = me.x + (sq.x - k.width() / 2) - 130, x1 = me.x + (sq.right - k.width() / 2) + 130;
      const baseX = x0 + f * (x1 - x0);
      const baseY = me.y + (sq.y - k.height() / 2) + 0.12 * sq.size + f * 0.14 * sq.size; // upper air, gentle descent
      const ink = k.rgb(38, 42, 56);
      for (let i = 0; i < FLOCK.length; i++) {
        const bx = baseX + FLOCK[i][0], by = baseY + FLOCK[i][1] + Math.sin(t * 1.6 + i) * 3;
        const beat = Math.sin(t * 6 + i * 0.8) * 0.5 + 0.5;        // 0..1 wing beat (desynced per bird)
        const w = 8 + beat * 4;                                     // wingspan
        const lift = w * (0.42 + beat * 0.24);                      // wingtip height above the body — always clearly angled
        k.drawLine({ p1: k.vec2(bx - w, by - lift), p2: k.vec2(bx, by), width: 2.4, color: ink, opacity: 0.8 }); // left wing (tip up → body)
        k.drawLine({ p1: k.vec2(bx, by), p2: k.vec2(bx + w, by - lift), width: 2.4, color: ink, opacity: 0.8 }); // right wing (body → tip up)
      }
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
        for (let i = 0; i < 6; i++) { const f = (t * 0.45 + i * 0.17) % 1; k.drawCircle({ pos: k.vec2(x + Math.sin(t * 1.2 + i * 2) * 22, y - 4 - f * 50), radius: Math.max(0.4, (1 - f) * 2.4), color: k.rgb(...glow), opacity: 0.42 * (1 - f) }); }            // rising healing motes
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
      } else if (id === "forge") {
        // Glowing hearth (left) + an anvil (right) + a wall tool-rack.
        const fl = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 5);
        k.drawRect({ pos: k.vec2(lft + 16, top + 20), width: 42, height: 30, radius: 4, color: k.rgb(...STONE_DK) });
        k.drawEllipse({ pos: k.vec2(lft + 37, top + 36), radiusX: 15, radiusY: 9, color: k.rgb(...THEME.fire), opacity: 0.32 * fl });
        k.drawEllipse({ pos: k.vec2(lft + 37, top + 36), radiusX: 8, radiusY: 5, color: k.rgb(255, 204, 124), opacity: 0.6 + 0.3 * fl });
        k.drawRect({ pos: k.vec2(rgt - 54, top + 34), width: 32, height: 7, radius: 2, color: k.rgb(72, 76, 90) });
        k.drawRect({ pos: k.vec2(rgt - 44, top + 40), width: 11, height: 8, color: k.rgb(58, 62, 76) });
        for (let i = 0; i < 3; i++) k.drawLine({ p1: k.vec2(x - 8 + i * 9, top + 18), p2: k.vec2(x - 8 + i * 9, top + 30), width: 2, color: k.rgb(...STONE_LT), opacity: 0.55 });
      } else if (id === "bestiary") {
        // Bookshelves along the back wall (rows of colored spines).
        const spines = [THEME.danger, amber, THEME.teal, vio, HEAL, THEME.water, THEME.psychic];
        for (let r = 0; r < 2; r++) {
          k.drawRect({ pos: k.vec2(lft + 16, top + 18 + r * 16), width: BW - 32, height: 14, radius: 2, color: k.rgb(54, 44, 36) });
          const n = 12, sw = (BW - 44) / n;
          for (let i = 0; i < n; i++) k.drawRect({ pos: k.vec2(lft + 20 + i * sw, top + 19 + r * 16), width: sw - 1.6, height: 11, color: k.rgb(...spines[(i + r * 3) % spines.length]), opacity: 0.82 });
        }
      } else if (id === "cosmetics") {
        // A garment rail with hanging clothes (pink/varied).
        k.drawLine({ p1: k.vec2(lft + 18, top + 22), p2: k.vec2(rgt - 18, top + 22), width: 2, color: k.rgb(...STONE_LT) });
        const garments = [THEME.psychic, THEME.teal, amber, vio, HEAL, THEME.danger];
        for (let i = 0; i < 6; i++) { const gx = lft + 30 + i * ((BW - 60) / 5); k.drawEllipse({ pos: k.vec2(gx, top + 23), radiusX: 4, radiusY: 2, color: k.rgb(...garments[i]) }); k.drawRect({ pos: k.vec2(gx - 6, top + 24), width: 12, height: 20, radius: 3, color: k.rgb(...garments[i]), opacity: 0.85 }); }
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
        // Aged: a few soft MOSS patches creeping along the shaded front pitch — weathered-cottage
        // character without busying the roof. Hash-stable per building; fades with the roof (ra).
        for (let i = 0; i < 3; i++) {
          const mx = lft + 16 + hash(b.x + i * 31, b.y) * (BW - 32);
          const my = mid + 4 + hash(b.x, b.y + i * 17) * (bot - 4 - mid - 8);
          k.drawEllipse({ pos: k.vec2(mx, my), radiusX: 5 + hash(b.x + i, b.y + i) * 5, radiusY: 3, color: k.rgb(80, 104, 60), opacity: 0.3 * ra });
        }
        k.drawRect({ pos: k.vec2(lft + 22, top - 8), width: 18, height: 24, radius: 2, color: k.rgb(...STONE), opacity: ra });                      // chimney
        k.drawRect({ pos: k.vec2(lft + 20, top - 11), width: 22, height: 6, radius: 2, color: k.rgb(...STONE_DK), opacity: ra });
        // (the chimney's rising smoke is drawn ONCE by the drawChimneySmoke overlay — see onDraw — so
        // it's not duplicated here; the old in-house plume + the overlay used to double up per house)
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
      } else if (b.id === "bestiary") {
        // An open book emblem (blue).
        const bl = THEME.water;
        k.drawRect({ pos: k.vec2(x - 18, mid - 10), width: 17, height: 24, radius: 2, color: k.rgb(...bl), opacity: ra });
        k.drawRect({ pos: k.vec2(x + 1, mid - 10), width: 17, height: 24, radius: 2, color: k.rgb(...bl), opacity: ra });
        k.drawRect({ pos: k.vec2(x - 1.5, mid - 12), width: 3, height: 28, color: k.rgb(40, 40, 52), opacity: ra });
        for (let i = 0; i < 3; i++) { k.drawRect({ pos: k.vec2(x - 15, mid - 5 + i * 5), width: 11, height: 1.6, color: k.rgb(255, 255, 255), opacity: 0.5 * ra }); k.drawRect({ pos: k.vec2(x + 4, mid - 5 + i * 5), width: 11, height: 1.6, color: k.rgb(255, 255, 255), opacity: 0.5 * ra }); }
      } else if (b.id === "cosmetics") {
        // A spool + needle emblem (pink).
        const pk = THEME.psychic;
        k.drawCircle({ pos: k.vec2(x, mid - 2), radius: 12, color: k.rgb(...pk), opacity: 0.9 * ra });
        k.drawCircle({ pos: k.vec2(x, mid - 2), radius: 4, color: k.rgb(40, 34, 40), opacity: ra });
        k.drawLine({ p1: k.vec2(x - 14, mid + 12), p2: k.vec2(x + 14, mid - 16), width: 2.5, color: k.rgb(230, 230, 240), opacity: ra });
        k.drawCircle({ pos: k.vec2(x - 14, mid + 12), radius: 2.4, fill: false, outline: { width: 1.5, color: k.rgb(230, 230, 240) }, opacity: ra });
      } else if (b.id === "forge") {
        // A gear emblem (orange) with a glowing centre.
        const fr = THEME.fire, glow = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 3);
        for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; k.drawRect({ pos: k.vec2(x + Math.cos(a) * 13 - 2.5, mid - 2 + Math.sin(a) * 13 - 2.5), width: 5, height: 5, radius: 1, color: k.rgb(...fr), opacity: ra }); }
        k.drawCircle({ pos: k.vec2(x, mid - 2), radius: 11, color: k.rgb(...fr), opacity: ra });
        k.drawCircle({ pos: k.vec2(x, mid - 2), radius: 5, color: k.rgb(255, 220, 150), opacity: (0.5 + 0.4 * glow) * ra });
      }
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
      const pulse = reduce ? 0.85 : 0.5 + 0.5 * Math.sin(t * 3);
      if (near) {
        const b = near, isCave = b.kind === "cave";
        // Ring only for the CAVE (you approach the portal mouth). Houses are walk-in — the keeper bark +
        // E bubble + bottom prompt already signal interaction, and a front-edge ring just floated as a
        // stray circle while you stood inside, so it's dropped for houses.
        if (isCave) {
          const rr = 56 + (reduce ? 0 : 3 * Math.sin(t * 4));
          k.drawCircle({ pos: k.vec2(b.x, b.y + 44 + 16), radius: rr, fill: false, outline: { width: 3, color: k.rgb(...b.accent) }, opacity: 0.4 + 0.3 * pulse });
        }
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
      // ── the VORTEX ──
      for (const [r, o] of [[80, 0.10], [60, 0.16], [42, 0.22]]) k.drawEllipse({ pos: k.vec2(x, y + 6), radiusX: r * (1 + beckon * 0.12), radiusY: r * 1.15 * (1 + beckon * 0.12), color: k.rgb(...teal), opacity: o * pulse * (1 + beckon * 0.85) }); // outward glow (swells as you approach)
      k.drawEllipse({ pos: k.vec2(x, y + 6), radiusX: 50, radiusY: 60, color: k.rgb(5, 8, 12) }); // dark recess
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
      const lay = playWindowLayout(W, H);
      const sq = lay.square, pad = 12;
      const il = ins.left, ir = ins.right, it = ins.top, ib = ins.bottom;
      if (lay.landscape && sq.x >= 120) {
        const gRcx = sq.right + (W - sq.right) / 2;
        return { sq, avR: 20, idMaxW: sq.x - pad - il - 8, // name must fit the left gutter (don't spill into the world)
          idX: pad + il, idY: pad + it, curX: pad + il, curY: pad + it + 52, curAnchor: "topleft",
          avX: gRcx, avY: pad + it + 22,
          promptX: sq.x / 2, promptY: H - ib - 120, hintX: sq.x / 2, hintY: H - ib - 150,
          joyX: sq.x / 2, joyY: H - ib - 84, useX: gRcx, useY: H - ib - 84 };
      }
      if (lay.portrait && sq.y >= 100) {
        const bcy = sq.bottom + (H - sq.bottom) / 2;
        return { sq, avR: 20, idMaxW: sq.cx - pad - il - 16, // name fits up to the centred currency
          idX: pad + il, idY: pad + it, curX: sq.cx, curY: pad + it + 6, curAnchor: "top",
          avX: W - pad - 22 - ir, avY: pad + it + 22,
          promptX: sq.cx, promptY: sq.bottom + 16, hintX: sq.cx, hintY: H - ib - 14,
          joyX: sq.x + 84 + il, joyY: bcy + 6, useX: W - ir - 56, useY: bcy + 6 };
      }
      // near-square aspect: tuck onto the square's own edges (graceful fallback).
      return { sq, avR: 20, idMaxW: sq.cx - (sq.x + pad) - 16, // name fits up to the centred currency
        idX: sq.x + pad, idY: sq.y + pad, curX: sq.cx, curY: sq.y + pad, curAnchor: "top",
        avX: sq.right - pad - 22, avY: sq.y + pad + 22,
        promptX: sq.cx, promptY: sq.bottom - 40, hintX: sq.cx, hintY: sq.bottom - 18,
        joyX: sq.x + 90, joyY: sq.bottom - 90, useX: sq.right - 70, useY: sq.bottom - 70 };
    }

    function drawHud() {
      const P = prof(), L = hubHud();
      // Identity (camp + name + level) — top of the first gutter.
      k.drawText({ text: "VILLAGE", pos: k.vec2(L.idX, L.idY), anchor: "topleft", size: 15, font: FONT, color: k.rgb(...THEME.textMut), fixed: true });
      // Fit the name (+ "(guest)") to the gutter so a long nick never spills into the play window.
      const suffix = character.isGuest ? "  (guest)" : "";
      const maxChars = Math.max(3, Math.floor((L.idMaxW || 200) / 7.2) - suffix.length);
      const nm = character.name.length > maxChars ? character.name.slice(0, maxChars - 1) + "…" : character.name;
      k.drawText({ text: `${nm}${suffix}`, pos: k.vec2(L.idX, L.idY + 20), anchor: "topleft", size: 13, font: FONT, color: k.rgb(...THEME.textBody), fixed: true });
      k.drawText({ text: `Lv ${character.level}`, pos: k.vec2(L.idX, L.idY + 37), anchor: "topleft", size: 12, font: FONT, color: k.rgb(...THEME.textMut), fixed: true });
      // Currencies (gold amber / essence teal) — stacked under identity (landscape) or centred (portrait).
      // Thousands separators so big balances read cleanly (exact — no precision lost), e.g. 1,250,000.
      const fmtN = (n) => String(Math.floor(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      k.drawText({ text: `${fmtN(P.gold)} gold`, pos: k.vec2(L.curX, L.curY), anchor: L.curAnchor, size: 14, font: FONT, color: k.rgb(...THEME.amber), fixed: true });
      k.drawText({ text: `${fmtN(P.essence)} essence`, pos: k.vec2(L.curX, L.curY + 18), anchor: L.curAnchor, size: 14, font: FONT, color: k.rgb(...THEME.teal), fixed: true });
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
        if (hintOp > 0.02) k.drawText({ text: TOUCH ? "drag to move" : "WASD / arrows to move", pos: k.vec2(L.hintX, L.hintY), anchor: "center", size: 12, font: FONT, color: k.rgb(...THEME.textMut), opacity: hintOp, fixed: true });
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
      injured = false; injuredCheck = k.time(); // beacon off immediately (don't wait for the throttle)
      if (net.state.playerId) {
        try { net.heal(); } catch {}
        const off = net.on("roster", () => { off(); toast("Team healed"); triggerHealBurst(); sfx("pickup"); clericThanks(); });
        sessionOffs.push(off);
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
      const sq = playWindowLayout(k.width(), k.height()).square;
      const cx = sq.cx, y = sq.y + 54, w = Math.min(sq.size - 24, 380);
      k.drawRect({ pos: k.vec2(cx - w / 2, y - 32), width: w, height: 64, radius: 12, color: k.rgb(...THEME.bgAlt), opacity: 0.9 * op, outline: { width: 2, color: k.rgb(...THEME.teal) }, fixed: true });
      k.drawText({ text: "Welcome to the village, tamer!", pos: k.vec2(cx, y - 11), anchor: "center", size: 15, font: FONT, color: k.rgb(...THEME.text), opacity: op, fixed: true });
      k.drawText({ text: "Explore the keepers — enter the glowing cave to run.", pos: k.vec2(cx, y + 11), anchor: "center", size: 11, font: FONT, color: k.rgb(...THEME.textMut), opacity: op, fixed: true });
    });

    // ── Cave run handshake (ported from lobby.js): SP/MP picker → connect/queue → onlineGame ──
    const netOffs = [];
    let leaving = false;
    let overlayOpen = false;
    let connectTimer = null;
    const cancelConnectTimer = () => { if (connectTimer) { connectTimer.cancel(); connectTimer = null; } };
    function clearNet() { netOffs.forEach((off) => off && off()); netOffs.length = 0; }
    function closeOverlay() { cancelConnectTimer(); clearNet(); k.destroyAll("overlay"); overlayOpen = false; navItems = null; }

    // ── Overlay focus model: each modal registers its buttons (centre x/y + size + action) so they can
    //    be driven by keyboard (arrows/Enter) and gamepad (stick/A) — not just the mouse. setNav lands
    //    focus on the first ENABLED item; a pulsing ring (drawn below) shows it. ───────────────────────
    function setNav(items) {
      navItems = items && items.length ? items : null;
      navIdx = 0;
      if (navItems) { while (navIdx < navItems.length && navItems[navIdx].disabled) navIdx++; if (navIdx >= navItems.length) navIdx = 0; }
    }
    function navMove(d) {
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
    // The focus ring — drawn over the retained overlay buttons (immediate-mode draws on top), only while
    // a modal with nav items is open. Teal so it's distinct from addButton's own hover tint.
    k.onDraw(() => {
      if (!overlayOpen || !navItems) return;
      const it = navItems[navIdx]; if (!it) return;
      const pulse = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(k.time() * 4);
      k.drawRect({ pos: k.vec2(it.x - it.w / 2 - 5, it.y - it.h / 2 - 5), width: it.w + 10, height: it.h + 10, radius: 14,
        fill: false, outline: { width: 3, color: k.rgb(...THEME.teal) }, opacity: 0.4 + 0.4 * pulse, fixed: true });
    });

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
      const teamN = (prof().activeMonsters || []).length;
      const hasMonsters = teamN > 0;
      addPanel(k, { x: cx, y: my, w: cw(380), h: 320, radius: 18, fixed: true, tag: "overlay" });
      addLabel(k, { x: cx, y: my - 130, text: "ENTER A RUN", size: 22, color: THEME.text, fixed: true, tag: "overlay" });
      // Spell out exactly what's at stake — how many monsters you're taking in (defeat loses them).
      const stake = hasMonsters ? `Both modes risk your ${teamN} monster${teamN > 1 ? "s" : ""} — extract to keep them` : "Both modes risk your saved team — extract to keep it";
      addLabel(k, { x: cx, y: my - 104, text: stake, size: 13, color: THEME.textMut, fixed: true, tag: "overlay" });
      addButton(k, { x: cx, y: my - 60, w: cw(300), h: 48, text: "Singleplayer", size: 19,
        fill: hasMonsters ? THEME.primary : THEME.surfaceAlt, textColor: hasMonsters ? THEME.textInv : THEME.textMut,
        disabled: !hasMonsters, fixed: true, tag: "overlay", onClick: () => { if (hasMonsters) startServerRun(true); } });
      addLabel(k, { x: cx, y: my - 30, text: hasMonsters ? "Solo run with your saved team" : "No monsters — visit the Vault first",
        size: 11, color: hasMonsters ? THEME.textMut : THEME.warn, fixed: true, tag: "overlay" });
      addButton(k, { x: cx, y: my + 20, w: cw(300), h: 48, text: "Multiplayer", size: 19,
        fill: THEME.violet, textColor: THEME.textInv, fixed: true, tag: "overlay", onClick: () => startServerRun(false) });
      addLabel(k, { x: cx, y: my + 50, text: "Live extraction vs other tamers", size: 11, color: THEME.textMut, fixed: true, tag: "overlay" });
      addButton(k, { x: cx, y: my + 116, w: cw(200), h: 40, text: "Cancel", size: 16,
        fill: THEME.surfaceAlt, textColor: THEME.text, fixed: true, tag: "overlay", onClick: closeOverlay });
      setNav([
        { x: cx, y: my - 60, w: cw(300), h: 48, disabled: !hasMonsters, action: () => { if (hasMonsters) startServerRun(true); } },
        { x: cx, y: my + 20, w: cw(300), h: 48, action: () => startServerRun(false) },
        { x: cx, y: my + 116, w: cw(200), h: 40, action: closeOverlay },
      ]);
      // Surface the (new) keyboard/gamepad navigation so it's discoverable — the player reached here by
      // pressing E / A, so they're primed to keep using it. Desktop/controller only (no keyboard on touch).
      if (!TOUCH) addLabel(k, { x: cx, y: my + 152, text: "Arrows / W / S to choose  —  Enter confirm  —  Esc cancel", size: 11, color: THEME.textMut, fixed: true, tag: "overlay" });
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
      if (overlayOpen) { sfx("back"); closeOverlay(); return; } // toggle / dismiss any open overlay (incl. the run picker)
      sfx("ui"); // audio feedback on open (parity with the run picker's click) — the avatar tap/Esc/Start were silent
      overlayOpen = true;
      k.destroyAll("overlay");
      k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.anchor("topleft"), k.color(0, 0, 0), k.opacity(0.35), k.area(), k.fixed(), "overlay"]).onClick(closeOverlay);
      // The secondary facilities the old menu-lobby had as stations but the camp doesn't: Bestiary
      // (collection), Cosmetics (skins) and Base Upgrades (gold meta-upgrades). Routed here so they
      // stay reachable now that the camp is the ONLY lobby (otherwise they'd be dead). All return here.
      const more = [
        { label: "Bestiary", go: () => k.go("bestiary", { backScene: "hub", backArgs: { characterId }, characterId }) },
        { label: "Cosmetics", go: () => k.go("cosmetics", { backScene: "hub", backArgs: { characterId } }) },
        // (Base Upgrades removed per user 2026-06-11 — the smith/base-upgrades feature is out of the game)
      ];
      // Quick audio toggle — the lobby has a soundscape (SFX + ambient birdsong); let players silence it
      // here without digging into Settings. Label reflects the live state; toggles then closes.
      const muteItem = { label: isMuted() ? "Unmute sound" : "Mute sound", go: () => { toggleMuted(); closeOverlay(); } };
      const items = authed ? [
        { label: "View Profile", go: () => k.go("profile", { backScene: "hub", backArgs: { characterId } }) },
        ...more,
        { label: "Account", go: () => k.go("account", { backScene: "hub", backArgs: { characterId } }) },
        muteItem,
        { label: "Settings", go: () => k.go("settings", { characterId, backScene: "hub" }) },
        { label: "Switch Character", go: () => k.go("characterSelect") },
        { label: "Sign out", danger: true, go: () => { try { net.clearSession(); } catch { /* none */ } clearProfile(); k.go("start"); } },
      ] : [
        ...more,
        muteItem,
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
      setNav(items.map((it, i) => ({ x: pcx, y: ptop + 7 + rowH / 2 + i * rowH, w: pwid - 18, h: rowH - 6, action: it.go })));
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
