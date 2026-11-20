import { drawCharacter } from "../render/character.js";
import { getEquippedCharacterSkin, getCharacterSkin } from "../render/characterCosmetics.js";
import { getEquippedSkin, getSkin } from "../render/chainCosmetics.js";
import { drawTiles, makeTileCache } from "../render/tiles.js";
import { drawPlayWindow, playWindowLayout } from "../render/playWindow.js";
import { drawHubPanel } from "../render/hubPanel.js";
import { getCharacter, setCharacterServerToken, saveCharacter, getProfile, clearProfile } from "../storage.js";
import { healTeam } from "../engine/progression.js";
import { safeInsetsDesign } from "../systems/safearea.js";
import { getBindings } from "../systems/keybinds.js";
import { getMonsterType, getGroundTiles } from "../engine/gamedata.js";
import { getMonsterStats } from "../engine/stats.js";
import { generateMap } from "../engine/mapgen.js";
import { GAME } from "../engine/schemas.js";
import { sprintingNow, tickStamina, sprintMult } from "../engine/movement.js";
import { net } from "../netClient.js";
import { THEME, FONT, FONT_BOLD, addButton, addPanel, inRect, drawToast, drawButton, drawGlass, drawChip, drawEyebrow, drawIconTab, WHITE } from "../ui/theme.js";
import { drawIcon, iconSpriteKey } from "../ui/icons.js";
import { sheetEntrance, drawGlassSheet } from "../ui/stationPopup.js";
import { drawMonsterDetail } from "../ui/monsterDetail.js";
import { drawStationPopup, stationContentRect, stationCloseRect, stationPopupInside } from "../ui/stationPopup.js";
import { drawBestiaryPanel, bestiaryPanelState, bestiaryPanelTap, bestiaryPanelScroll, bestiaryPanelFocusables } from "../ui/bestiaryPanel.js";
import { drawShopPanel, shopPanelState, shopPanelTap, shopPanelScroll, shopPanelFocusables } from "../ui/shopPanel.js";
import { drawCosmeticsPanel, cosmeticsPanelState, cosmeticsPanelTap, cosmeticsPanelScroll, cosmeticsPanelFocusables } from "../ui/cosmeticsPanel.js";
import { drawBattlePassPanel, battlePassPanelState, battlePassPanelTap, battlePassPanelScroll } from "../ui/battlePassPanel.js";
import { drawSettingsPanel, settingsPanelState, settingsPanelTap, settingsPanelScroll, settingsPanelFocusables } from "../ui/settingsPanel.js";
import { drawProfilePanel, drawProfileModal, profilePanelState, profilePanelTap, profilePanelScroll, profilePanelFocusables } from "../ui/profilePanel.js";
import { drawRosterPanel, drawRosterModal, rosterPanelState, rosterPanelTap, rosterPanelScroll, rosterPanelFocusables, rosterModalFocusables } from "../ui/rosterPanel.js";
import { drawMarketplacePanel, marketplacePanelState, marketplacePanelTap, marketplacePanelScroll, marketplacePanelFocusables } from "../ui/marketplacePanel.js";
import { touchPrimary, drawJoystick, drawTouchButton } from "../systems/inputMode.js";
import { prefersReducedMotion } from "../systems/a11y.js";
import { gamepadMove, gamepadPressed, gamepadConnected, BTN } from "../systems/gamepad.js";
import { sfx, haptic, isMuted, toggleMuted } from "../systems/audio.js";

const E = GAME.EFFECTIVE_TILE;
const SPEED = Math.round(GAME.BASE_SPEED * 1.2);
const PR = GAME.PLAYER_RADIUS;
const REACH = 116;
const GRID = 30;
const VCX = 15, VCY = 13.5;
const TILE = (tx, ty) => ({ x: tx * E + E / 2, y: ty * E + E / 2 });
const LOBES = [
  [15.0, 13.5, 9.6, 7.0],
  [13.0, 6.6, 5.8, 4.8],
  [20.0, 10.0, 5.8, 5.4],
  [8.6, 11.0, 5.4, 5.4],
  [9.5, 7.0, 5.2, 5.0],
  [7.6, 4.7, 4.8, 3.6],
  [20.4, 17.5, 5.8, 5.4],
  [10.2, 18.0, 5.4, 5.0],
  [14.8, 19.8, 4.2, 4.4],
];
const SHADE = [
  [10.2, 9.2], [15.0, 8.0], [20.4, 9.0],
  [7.8, 14.2], [22.2, 13.8],
  [10.6, 18.4], [15.0, 20.6], [19.8, 18.6],
  [12.6, 12.0],
];
const ellip = (cx, cy) => {
  let m = Infinity;
  for (let i = 0; i < LOBES.length; i++) {
    const L = LOBES[i], a = (cx - L[0]) / L[2], b = (cy - L[1]) / L[3], v = a * a + b * b;
    if (v < m) m = v;
  }
  return m;
};
function hash(x, y, k = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(k | 0, 1442695040)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const HEAL = [120, 222, 150];
const WOOD = [124, 92, 60], WOOD_DK = [86, 62, 40], WOOD_LT = [158, 120, 82];
const STONE = [108, 112, 126], STONE_DK = [72, 76, 90], STONE_LT = [150, 154, 168];
const LEAF = [58, 104, 60], LEAF_DK = [38, 74, 44], LEAF_LT = [86, 140, 78], BARK = [74, 58, 44];
const PLAYER_SCALE = 1.6;

function buildCampMap() {
  const tiles = getGroundTiles() || [];
  const grass = tiles.find((t) => /forest|plains|swamp|mushroom|jungle/i.test(t.biome || "") && !t.collidable)
    || tiles.find((t) => !t.collidable)
    || { colorProfile_full_r: 54, colorProfile_full_g: 74, colorProfile_full_b: 52, collidable: 0 };
  const voidMap = [], tileMap = [];
  for (let x = 0; x < GRID; x++) {
    voidMap[x] = new Array(GRID).fill(true);
    tileMap[x] = new Array(GRID).fill(null);
    for (let y = 0; y < GRID; y++) tileMap[x][y] = { ...grass, rotation: 0, activeMonster: null };
  }
  return { voidMap, tileMap, mapSize: GRID };
}

function buildTrees() {
  const trees = [];
  for (let tx = -12; tx <= GRID + 12; tx++) for (let ty = -12; ty <= GRID + 12; ty++) {
    const cx = tx + 0.5, cy = ty + 0.5, e = ellip(cx, cy);
    const p = e < 1.05 ? 0 : e < 1.35 ? 0.85 : 0.6;
    if (hash(tx, ty) >= p) continue;
    const jx = (hash(tx, ty, 1) - 0.5) * 0.5, jy = (hash(tx, ty, 2) - 0.5) * 0.5;
    trees.push({ x: (cx + jx) * E, y: (cy + jy) * E, kind: Math.floor(hash(tx, ty, 3) * 3), s: 0.9 + hash(tx, ty, 4) * 0.6 });
  }
  return trees;
}

let lastHubPos = null, lastHubChar = null;

export default function hubScene(k) {
  k.scene("hub", ({ characterId } = {}) => {
    const character = getCharacter(characterId);
    if (!character) { k.go("characterSelect"); return; }

    const campMap = buildCampMap();
    const tileCache = makeTileCache();
    const trees = buildTrees();
    const gt = (campMap.tileMap[0] && campMap.tileMap[0][0]) || {};
    const floorCol = [gt.colorProfile_full_r ?? 48, gt.colorProfile_full_g ?? 64, gt.colorProfile_full_b ?? 46];

    const buildings = [
      { id: "cave",     kind: "cave",  ...TILE(13, 5.4),    w: 360, h: 184, accent: [58, 212, 198], hint: "start a run",      rdy: 8,  act: () => openStationPopup("portal") },
      { id: "merchant", kind: "house", design: 0, ...TILE(20.2, 8.6),   w: 376, h: 286, accent: THEME.amber,  hint: "spirit shop",      barks: ["Wares for a wanderer?", "Fresh stock today!", "Spend it while you've got it."], keeper: (x, y, t) => drawTraderKeeper(x, y, t), act: () => openStationPopup("shop") },
      { id: "healer",   kind: "house", design: 2, ...TILE(8.2, 9.4),   w: 324, h: 252, accent: HEAL,         hint: "heal your team",   barks: ["Rest your spirits here.", "Let me tend your team.", "Be at ease, tamer."], keeper: (x, y, t) => drawClericKeeper(x, y, t), act: () => healNow() },
      { id: "vault",    kind: "house", design: 1, ...TILE(20.8, 17.8),  w: 324, h: 252, accent: THEME.violet, hint: "team & inventory", barks: ["Your team is safe with me.", "Nothing is lost here.", "Guarded, always."], keeper: (x, y, t) => drawGolemKeeper(x, y, t), act: () => openStationPopup("vault") },
      { id: "bestiary", kind: "house", design: 1, ...TILE(8.8, 17.8),   w: 312, h: 240, accent: THEME.water,   hint: "monster archive", barks: ["Every spirit, catalogued.", "Knowledge is the truest catch.", "Ah, a curious mind."], keeper: (x, y, t) => drawScholarKeeper(x, y, t), act: () => openStationPopup("bestiary") },
      { id: "cosmetics", kind: "house", design: 0, ...TILE(14.8, 20.6), w: 312, h: 240, accent: THEME.psychic, hint: "cosmetics",       barks: ["Let's find your look.", "Style befitting a tamer.", "A fresh thread, perhaps?"], keeper: (x, y, t) => drawTailorKeeper(x, y, t),  act: () => openStationPopup("cosmetics") },
      { id: "market",   kind: "house", design: 2, ...TILE(7.4, 4.3),   w: 240, h: 180, accent: THEME.success, hint: "marketplace",      barks: ["Buy low, sell high!", "Fresh listings every day.", "Trade with fellow tamers here."], keeper: (x, y, t) => drawTraderKeeper(x, y, t), act: () => openStationPopup("market") },
    ];
    buildings.forEach((b) => { b.roofA = 1; if (b.kind === "house") { b.w = Math.round(b.w * 1.5); b.h = Math.round(b.h * 1.5); } b.faceDown = (VCY * E) > b.y; });
    buildings.forEach((b) => { if (b.kind === "house") b.colliders = houseColliders(b); });
    // Mirrors the furniture drawn in drawHouse; change both.
    function houseColliders(b) {
      const x = b.x, y = b.y, BW = b.w, BH = b.h, lft = x - BW / 2, rgt = x + BW / 2, top = y - BH / 2, bot = y + BH / 2;
      const fd = b.faceDown !== false, s = fd ? 1 : -1;
      const by = (d) => fd ? top + d : bot - d, fy = (d) => fd ? bot - d : top + d, cy = (o) => y + s * o;
      const C = [
        { x, y: by(38), rx: (BW - 44) / 2, ry: 18 },
        { x: lft + 18, y, rx: 10, ry: 26 },
        { x: rgt - 18, y, rx: 10, ry: 26 },
        { x: x + 66, y: by(60), rx: 15, ry: 14 },
        { x: x - 72, y: cy(34), rx: 26, ry: 20 },
        { x, y: cy(8), rx: 14, ry: 15 },
        { x: lft + 34, y: fy(42), rx: 12, ry: 9 },
        { x: rgt - 34, y: fy(42), rx: 13, ry: 9 },
      ];
      if (b.id === "merchant") C.push({ x, y: cy(56), rx: 62, ry: 13 });
      return C;
    }
    const stations = buildings.filter((b) => b.act);
    const healerB = buildings.find((b) => b.id === "healer");

    // Keep decor outside building footprints (else draws over roofs / hidden colliders).
    const decor = [
      { kind: "well",    ...TILE(15, 11.6),   r: 26 },
      { kind: "fountain", ...TILE(12.2, 11.4), r: 30 },
      { kind: "sign",    ...TILE(12.9, 14.6), r: 7 },
      { kind: "lantern", ...TILE(12.6, 12.8), r: 6 },
      { kind: "lantern", ...TILE(17.6, 12.9), r: 6 },
      { kind: "lantern", ...TILE(12.6, 16.8), r: 6 },
      { kind: "lantern", ...TILE(17.6, 16.6), r: 6 },
      { kind: "lantern", ...TILE(12.8, 9.2),  r: 6 },
      { kind: "lantern", ...TILE(16.2, 9.2),  r: 6 },
      { kind: "bench",   ...TILE(12.6, 13.8), r: 18, basket: true },
      { kind: "bench",   ...TILE(17.4, 13.4), r: 18, cat: true },
    ];
    const critters = [];
    for (let i = 0; i < 2; i++) { const o = TILE(12.5 + i * 1.7, 14 + (i % 2) * 1.4); critters.push({ kind: "chicken", x: o.x, y: o.y, hx: o.x, hy: o.y, tx: o.x, ty: o.y, dir: 1, peck: 0, moving: false }); }
    const VPAL = [{ robe: [150, 96, 102], robeDk: [108, 66, 72], skin: [216, 172, 126], hair: [74, 54, 46] }, { robe: [92, 116, 150], robeDk: [62, 80, 110], skin: [224, 184, 142], hair: [58, 44, 38] }];
    for (let i = 0; i < 2; i++) { const o = TILE(13.4 + i * 3.2, 14.8 + (i % 2) * 1.6); critters.push({ kind: "villager", x: o.x, y: o.y, hx: o.x, hy: o.y, tx: o.x, ty: o.y, dir: 1, pause: 1 + i, moving: false, pal: VPAL[i % VPAL.length], ph: i * 2.1 }); }

    function walkable(x, y) {
      if (ellip(x / E, y / E) > 1.05) return false;
      for (const b of buildings) {
        if (b.kind !== "cave") continue;
        // Collider mirrors drawCavePortal's rock ellipse; change both.
        const rx = 146, ry = 106, cyc = b.y - 8;
        const nx = (x - b.x) / rx, ny = (y - cyc) / ry;
        if (nx * nx + ny * ny < 1 && y < b.y - 6) return false;
      }
      for (const b of buildings) {
        if (b.kind !== "house") continue;
        const ax = Math.abs(x - b.x), ay = Math.abs(y - b.y), hw = b.w / 2, hh = b.h / 2;
        if (ax > hw || ay > hh) continue;
        const wall = 8, ew = Math.max(48, Math.min(78, b.w * 0.15)), nearX = ax > hw - wall, nearY = ay > hh - wall;
        if (nearX || nearY) {
          const entSide = (b.faceDown !== false) ? (y > b.y) : (y < b.y);
          if (!(entSide && nearY && !nearX && ax < ew)) return false;
        }
        if (b.colliders) for (const c of b.colliders) { const dx = (x - c.x) / (c.rx + PR), dy = (y - c.y) / (c.ry + PR); if (dx * dx + dy * dy < 1) return false; }
      }
      for (const d of decor) { const dx = x - d.x, dy = y - d.y, rr = d.r + 2; if (dx * dx + dy * dy < rr * rr) return false; }
      return true;
    }

    const returning = !!(lastHubPos && lastHubChar === characterId && walkable(lastHubPos.x, lastHubPos.y));
    const me = returning ? { ...lastHubPos } : { ...TILE(15, 13.5) };
    let dir = { x: 0, y: -1 };
    let moving = false;
    // Snapshot bindings once per scene; no per-frame localStorage reads.
    const KB = getBindings();
    const anyDown = (action) => { const ks = KB[action]; for (let i = 0; i < ks.length; i++) if (k.isKeyDown(ks[i])) return true; return false; };
    let camX = null, camY = null;
    let movedTime = returning ? 999 : 0;
    let lastCluck = 0;
    let injured = false, injuredCheck = -999;
    let teamHP = [];
    let welcomeShow = false, welcomeStart = -1;
    try { welcomeShow = !localStorage.getItem("tq_hub_welcomed"); if (welcomeShow) localStorage.setItem("tq_hub_welcomed", "1"); } catch {}
    let navItems = null, navIdx = 0, navStickReady = true;
    let menuKeepsWorld = false;
    const OVERLAY_Z = 50; // Must exceed the immediate-mode world's ~0.5 z band.
    let near = null;
    let lastNearId = null;
    let hubStamina = GAME.SPRINT.STAMINA_MAX;
    let hubSprinting = false, hubWasSprinting = false;
    let healFx = 0, healFxX = 0, healFxY = 0;
    const cos = getEquippedCharacterSkin();
    const hubOthers = new Map();
    let hubSendAcc = 0;

    const reduce = prefersReducedMotion();

    const accent = cos.accent || THEME.teal;
    const profile = getProfile();
    const authed = !!(profile && !profile.isGuest);
    const ins = safeInsetsDesign(k);
    const acctInitial = (((profile && profile.nickname) || character.name || "T").trim()[0] || "T").toUpperCase();

    const TOUCH = touchPrimary(k);
    const JOY_R = 70, IBTN_R = 44;
    let joyId = null, joyVec = { x: 0, y: 0 }, joyBase = k.vec2(0, 0), joyThumb = k.vec2(0, 0);

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
          }),
        );
        if (net.state.playerId) {}
        else if (net.state.connected) net.join(nick());
        else net.connect();
      } catch {}
    }
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

    k.onUpdate(() => {
      const gpEdges = gamepadPressed(); // Call once per frame: gamepadPressed() consumes edge state.
      if (overlayOpen) {
        if (gpEdges.has(BTN.B) || gpEdges.has(BTN.START)) { try { net.unqueue(); } catch {} closeOverlay(); return; }
        if (gpEdges.has(BTN.A)) { navActivate(); return; }
        const gy = gamepadMove().y;
        if (Math.abs(gy) > 0.5) { if (navStickReady) { navMove(gy < 0 ? -1 : 1); navStickReady = false; } } else navStickReady = true;
        return;
      }
      if (detailMon) { if (gpEdges.has(BTN.B) || gpEdges.has(BTN.A) || gpEdges.has(BTN.START)) detailMon = null; return; }
      if (stationPopup) {
        if (stationPopup.hasDetail && stationPopup.state.selected && gpEdges.has(BTN.B)) { stationPopup.state.selected = null; sfx("ui"); return; }
        if (stationPopup.state.modalCapturesInput || stationPopup.state.renaming) {
          if (gpEdges.has(BTN.B)) {
            if (!(stationPopup.state.onEsc && stationPopup.state.onEsc())) { if (stationPopup.state.dispose) stationPopup.state.dispose(); else { stationPopup.state.inspect = null; stationPopup.state.modalCapturesInput = false; } }
            sfx("ui"); return;
          }
          if (stationPopup.modalFocusables) {
            const mf = stationPopup.modalFocusables(k, stationPopup.state), st2 = stationPopup.state;
            if (mf.length) {
              if (st2.modalFocus == null || st2.modalFocus >= mf.length) st2.modalFocus = 0;
              if (gpEdges.has(12) || gpEdges.has(14)) st2.modalFocus = (st2.modalFocus - 1 + mf.length) % mf.length;
              if (gpEdges.has(13) || gpEdges.has(15)) st2.modalFocus = (st2.modalFocus + 1) % mf.length;
              if (gpEdges.has(BTN.A)) { const r = mf[st2.modalFocus].rect; stationPopup.tap(k, stationContentRect(k), st2, k.vec2(r[0] + r[2] / 2, r[1] + r[3] / 2), popupShowToast); }
            }
          }
          return;
        }
        if (gpEdges.has(BTN.B) || gpEdges.has(BTN.START)) { closeStationPopup(); return; }
        if (stationPopup.id === "portal") {
          if (gpEdges.has(BTN.A)) { portalActivate(); return; }
          const gm = gamepadMove(), py = gm.y, px = gm.x;
          const pax = Math.abs(py) > 0.5 ? py : (Math.abs(px) > 0.5 ? px : 0); if (pax) { if (navStickReady) { stationPopup.state.focus = Math.max(0, Math.min(2, (stationPopup.state.focus || 0) + (pax < 0 ? -1 : 1))); sfx("hover"); navStickReady = false; } } else navStickReady = true;
        } else if (stationPopup.focusables && !(stationPopup.hasDetail && stationPopup.state.selected)) {
          const cr = stationContentRect(k);
          const foc = stationPopup.focusables(cr, stationPopup.state);
          if (foc.length) {
            if (stationPopup.state.focus == null || stationPopup.state.focus >= foc.length) stationPopup.state.focus = 0;
            if (gpEdges.has(12) || gpEdges.has(14)) stationPopup.state.focus = (stationPopup.state.focus - 1 + foc.length) % foc.length;
            if (gpEdges.has(13) || gpEdges.has(15)) stationPopup.state.focus = (stationPopup.state.focus + 1) % foc.length;
            if (gpEdges.has(BTN.A)) { const r = foc[stationPopup.state.focus].rect; stationPopup.tap(k, cr, stationPopup.state, k.vec2(r[0] + r[2] / 2, r[1] + r[3] / 2), popupShowToast); }
            // Scroll-to-focus only when the pad moved focus; per-frame breaks wheel/touch scroll.
            const padMoved = gpEdges.has(12) || gpEdges.has(13) || gpEdges.has(14) || gpEdges.has(15);
            const r2 = padMoved ? (stationPopup.focusables(cr, stationPopup.state)[stationPopup.state.focus] || {}).rect : null;
            if (r2) { if (r2[1] < cr[1]) stationPopup.scroll(stationPopup.state, r2[1] - cr[1] - 8); else if (r2[1] + r2[3] > cr[1] + cr[3]) stationPopup.scroll(stationPopup.state, (r2[1] + r2[3]) - (cr[1] + cr[3]) + 8); }
          }
          const py = gamepadMove().y;
          if (Math.abs(py) > 0.25) stationPopup.scroll(stationPopup.state, py * 14);
        } else if (typeof stationPopup.scroll === "function" && !(stationPopup.hasDetail && stationPopup.state.selected)) {
          const py = gamepadMove().y;
          if (Math.abs(py) > 0.25) stationPopup.scroll(stationPopup.state, py * 14);
          if (gpEdges.has(12)) stationPopup.scroll(stationPopup.state, -48);
          if (gpEdges.has(13)) stationPopup.scroll(stationPopup.state, 48);
        }
        return;
      }
      if (gpEdges.has(BTN.A)) interact();
      else if (gpEdges.has(BTN.START)) openAcctMenu();
      let dx = 0, dy = 0;
      if (anyDown("moveUp")) dy -= 1;
      if (anyDown("moveDown")) dy += 1;
      if (anyDown("moveLeft")) dx -= 1;
      if (anyDown("moveRight")) dx += 1;
      const gm = gamepadMove();
      if (joyVec.x || joyVec.y) { dx = joyVec.x; dy = joyVec.y; }
      else if (gm.x || gm.y) { dx = gm.x; dy = gm.y; }
      moving = !!(dx || dy);
      if (moving) movedTime += k.dt();
      const sprintInput = anyDown("sprint") || (joyVec.x * joyVec.x + joyVec.y * joyVec.y) > 0.85 || (gm.x * gm.x + gm.y * gm.y) > 0.85;
      hubSprinting = sprintingNow({ sprint: sprintInput, moving, stamina: hubStamina, wasSprinting: hubWasSprinting }, GAME);
      hubWasSprinting = hubSprinting;
      hubStamina = tickStamina(hubStamina, hubSprinting, k.dt(), GAME);
      if (moving) {
        dir = { x: dx, y: dy };
        const ml = Math.hypot(dx, dy) || 1; dx /= ml; dy /= ml;
        const step = SPEED * sprintMult(hubSprinting, GAME) * k.dt();
        const nx = me.x + dx * step, ny = me.y + dy * step;
        if (walkable(nx + Math.sign(dx) * PR, me.y)) me.x = nx;
        if (walkable(me.x, ny + Math.sign(dy) * PR)) me.y = ny;
      }
      // Idle keepalive must stay under server HUB_STALE_MS (4s).
      hubSendAcc += k.dt();
      if (hubSendAcc >= (moving ? 0.15 : 1.5)) { hubSendAcc = 0; try { net.hubMove(me.x, me.y); } catch {} }
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
      const nid = near ? near.id : null;
      if (nid && nid !== lastNearId) sfx(near.kind === "cave" ? "portal" : "hover");
      lastNearId = nid;
      for (const b of buildings) if (b.kind === "house") {
        const inside = Math.abs(me.x - b.x) < b.w / 2 - 4 && Math.abs(me.y - b.y) < b.h / 2 - 4;
        if (inside && !b._inside && b.barks) b._barkPick = Math.floor(Math.random() * b.barks.length);
        b._inside = inside;
        b.roofA += ((inside ? 0.08 : 1) - b.roofA) * Math.min(1, k.dt() * 6);
        if (b.doorA == null) b.doorA = 0;
        const doorTgt = (b === near || inside) ? 1 : 0;
        b.doorA += (doorTgt - b.doorA) * (reduce ? 1 : Math.min(1, k.dt() * 5));
      }
      for (const c of critters) {
        if (c.kind !== "chicken") continue;
        if (reduce) { c.moving = false; continue; }
        const pdx = c.x - me.x, pdy = c.y - me.y, pd = Math.hypot(pdx, pdy) || 1;
        const startled = pd < 72;
        if (startled) {
          if (!c.wasStartled && k.time() - lastCluck > 0.35) { sfx("cluck"); lastCluck = k.time(); }
          const fx = c.x + (pdx / pd) * 64, fy = c.y + (pdy / pd) * 64;
          if (walkable(fx, fy)) { c.tx = fx; c.ty = fy; }
          c.peck = 0;
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
      for (const c of critters) {
        if (c.kind !== "villager") continue;
        if (reduce) { c.moving = false; c.greet = false; continue; }
        const gpx = me.x - c.x, gpy = me.y - c.y, gpd = Math.hypot(gpx, gpy);
        c.greet = gpd < 84;
        if (c.greet) { c.moving = false; c.dir = gpx < 0 ? -1 : 1; if (c.pause < 0.3) c.pause = 0.3; continue; }
        const dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy) || 1;
        if (c.pause > 0) { c.pause -= k.dt(); c.moving = false; }
        else if (d > 4) { const sp = 26 * k.dt(); c.dir = dx < 0 ? -1 : 1; c.x += (dx / d) * sp; c.y += (dy / d) * sp; c.moving = true; }
        else {
          c.moving = false;
          const a = Math.random() * 6.283, rr = 50 + Math.random() * 150, nx = c.hx + Math.cos(a) * rr, ny = c.hy + Math.sin(a) * rr;
          if (walkable(nx, ny)) { c.tx = nx; c.ty = ny; }
          c.pause = 1.4 + Math.random() * 3.5;
        }
      }
      if (k.time() - injuredCheck > 1) { injuredCheck = k.time(); teamHP = (prof().activeMonsters || []).map(isHurt); injured = teamHP.some(Boolean); }
      const laMag = moving && !reduce ? 34 : 0;
      const dl = Math.hypot(dir.x, dir.y) || 1;
      const tx = me.x + (dir.x / dl) * laMag, ty = me.y + (dir.y / dl) * laMag;
      if (camX == null || reduce) { camX = me.x; camY = me.y; }
      else { const f = Math.min(1, k.dt() * 4.5); camX += (tx - camX) * f; camY += (ty - camY) * f; }
      k.camPos(camX, camY);
    });

    function interact() { if (!overlayOpen && near) { sfx("click"); haptic(8); near.act(); } }
    // One handler per confirm key: binding interact and navActivate double-fires.
    const confirmKey = () => { if (stationPopup) { if (stationPopup.id === "portal") portalActivate(); return; } if (overlayOpen) navActivate(); else interact(); };
    k.onKeyPress("e", confirmKey);
    k.onKeyPress("enter", confirmKey);
    k.onKeyPress("space", confirmKey);
    k.onKeyPress("up", () => navMove(-1));
    k.onKeyPress("w", () => navMove(-1));
    k.onKeyPress("down", () => navMove(1));
    k.onKeyPress("s", () => navMove(1));

    k.onDraw(() => {
      if (overlayOpen && !menuKeepsWorld) return;
      const t = k.time();
      k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: k.rgb(...floorCol), fixed: true });
      drawTiles(k, campMap, me.x, me.y, tileCache, E, null, { endless: true });
      drawClearing();
      drawCanopyShade(t);
      drawPaths();
      drawGroundScatter(t);
      drawForestFloor();
      const halfW = k.width() / 2, halfH = k.height() / 2;
      const inView = (x, y, mx, my) => Math.abs(x - me.x) <= halfW + mx && Math.abs(y - me.y) <= halfH + my;
      const props = [];
      for (const tr of trees) if (inView(tr.x, tr.y, 100, 150)) props.push({ y: tr.y, d: () => drawTree(tr, t) });
      for (const d of decor) if (inView(d.x, d.y, 72, 112)) props.push({ y: d.y, d: () => drawDecor(d, t) });
      for (const c of critters) if (c.kind === "chicken" && inView(c.x, c.y, 48, 48)) props.push({ y: c.y, d: () => drawChicken(c, t) });
      for (const c of critters) if (c.kind === "villager" && inView(c.x, c.y, 48, 56)) props.push({ y: c.y, d: () => drawVillager(c, t) });
      for (const b of buildings) if (b._inside || inView(b.x, b.y, b.w / 2 + 96, b.h / 2 + 140)) props.push({ y: b._inside ? me.y - 1 : b.y, d: () => drawBuilding(b, t) });
      for (const b of buildings) if (b.kind === "house" && (b._inside || inView(b.x, b.y, b.w / 2 + 96, b.h / 2 + 140))) props.push({ y: b.y + (b.faceDown !== false ? b.h / 2 + 64 : -(b.h / 2 + 8)), d: () => drawBuildingSign(b) });
      const hubList = net.state.hubPlayers || [];
      const hubSeen = new Set();
      for (const hp of hubList) {
        if (!hp || hp.id == null) continue;
        hubSeen.add(hp.id);
        let r = hubOthers.get(hp.id);
        if (!r) { r = { x: hp.x, y: hp.y, dir: { x: 0, y: 1 }, moving: false }; hubOthers.set(hp.id, r); }
        const odx = hp.x - r.x, ody = hp.y - r.y;
        r.moving = odx * odx + ody * ody > 1.5;
        if (r.moving) r.dir = { x: odx, y: ody };
        const a = Math.min(1, k.dt() * 10);
        r.x += odx * a; r.y += ody * a;
        const cs = getCharacterSkin(hp.charId) || {};
        const rx = r.x, ry = r.y, rMoving = r.moving, rDir = r.dir, nm = hp.name || "?";
        props.push({ y: ry, d: () => {
          drawCharacter(k, { x: rx, y: ry, t, moving: rMoving, color: cs.accent, cloak: cs.cloak, model: cs.model, dir: rDir, skin: getSkin(hp.skinId), chainTier: hp.chainTier ?? null, scale: PLAYER_SCALE });
          k.drawText({ text: nm.length > 14 ? nm.slice(0, 13) + "…" : nm, pos: k.vec2(rx, ry - 44), size: 12, font: "gameFont", anchor: "center", color: k.rgb(...THEME.text) });
        } });
      }
      for (const id of hubOthers.keys()) if (!hubSeen.has(id)) hubOthers.delete(id);
      props.push({ y: me.y, d: () => drawCharacter(k, { x: me.x, y: me.y, t, moving, color: cos.accent, cloak: cos.cloak, model: cos.model, dir, skin: getEquippedSkin(), scale: PLAYER_SCALE }) });
      props.sort((a, b) => a.y - b.y);
      for (const p of props) p.d();
      if (hubStamina < GAME.SPRINT.STAMINA_MAX - 0.5) {
        const sr = Math.max(0, Math.min(1, hubStamina / GAME.SPRINT.STAMINA_MAX)), bw = 34;
        k.drawRect({ pos: k.vec2(me.x - bw / 2, me.y + 26), width: bw, height: 4, radius: 2, color: k.rgb(0, 0, 0), opacity: 0.4 });
        k.drawRect({ pos: k.vec2(me.x - bw / 2, me.y + 26), width: bw * sr, height: 4, radius: 2, color: k.rgb(...(sr > 0.3 ? THEME.teal : THEME.amber)) });
      }
      drawHealBurst(t);
      drawKeeperBarks(t);
      drawHealBeacon(t);
      drawLabels(t);
      drawPlayWindow(k, { maxAspect: hubAspect() });
      drawHud();
      drawTouchControls();
      drawDetailPopup();
      drawStationPopupHub();
    });

    function drawClearing() {
      for (let i = 0; i < LOBES.length; i++) {
        const L = LOBES[i], cx = L[0] * E, cy = L[1] * E, rx = L[2] * E, ry = L[3] * E;
        k.drawEllipse({ pos: k.vec2(cx, cy), radiusX: rx * 1.04, radiusY: ry * 1.04, color: k.rgb(94, 130, 84), opacity: 0.045 });
        k.drawEllipse({ pos: k.vec2(cx, cy), radiusX: rx * 0.80, radiusY: ry * 0.80, color: k.rgb(100, 138, 88), opacity: 0.05 });
        k.drawEllipse({ pos: k.vec2(cx, cy), radiusX: rx * 0.52, radiusY: ry * 0.52, color: k.rgb(108, 146, 92), opacity: 0.055 });
      }
      k.drawEllipse({ pos: k.vec2(VCX * E, VCY * E + 12), radiusX: 5.4 * E, radiusY: 3.3 * E, color: k.rgb(122, 106, 80), opacity: 0.16 });
    }

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

    function drawPaths() {
      const px = VCX * E, py = VCY * E;
      const PRX = 58, PRY = 42;
      k.drawEllipse({ pos: k.vec2(px, py + 5), radiusX: PRX + 5, radiusY: PRY + 4, color: k.rgb(0, 0, 0), opacity: 0.16 });
      k.drawEllipse({ pos: k.vec2(px, py), radiusX: PRX, radiusY: PRY, color: k.rgb(...STONE_DK) });
      k.drawEllipse({ pos: k.vec2(px, py), radiusX: 19, radiusY: 14, color: k.rgb(...STONE) });
      for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2 + 0.4, sc = 0.8 + hash(i * 9, 3) * 0.5; k.drawEllipse({ pos: k.vec2(px + Math.cos(a) * 38, py + Math.sin(a) * 27), radiusX: 13 * sc, radiusY: 10 * sc, color: k.rgb(...(hash(i, 5) > 0.5 ? STONE : STONE_LT)) }); }
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2, lr = (i % 2 ? 16 : 30); k.drawLine({ p1: k.vec2(px, py), p2: k.vec2(px + Math.cos(a) * lr, py + Math.sin(a) * lr * 0.72), width: i % 2 ? 1.5 : 2.5, color: k.rgb(...STONE_LT), opacity: 0.4 }); }
      k.drawEllipse({ pos: k.vec2(px, py), radiusX: 9, radiusY: 6.5, fill: false, outline: { width: 1.5, color: k.rgb(...THEME.teal) }, opacity: 0.22 });
      k.drawCircle({ pos: k.vec2(px, py), radius: 2.6, color: k.rgb(...THEME.teal), opacity: 0.28 });
      for (const p of pathPellets()) k.drawEllipse({ pos: k.vec2(p.x, p.y), radiusX: p.rx, radiusY: p.ry, color: k.rgb(p.r, p.g, p.b), opacity: p.opacity });
    }
    let _pathPellets = null;
    function pathPellets() {
      if (_pathPellets) return _pathPellets;
      const px = VCX * E, py = VCY * E, dirt = [120, 102, 76], dirtDk = [96, 80, 58], dirtLt = [142, 122, 92], PRX = 58;
      const out = [];
      buildings.forEach((b, bi) => {
        const ey = b.y + (b.kind === "cave" ? 34 : b.faceDown !== false ? b.h / 2 + 50 : -(b.h / 2 + 2));
        const dx = b.x - px, dy = ey - py, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
        for (let i = 0; i < 26; i++) {
          const f = hash(bi * 131 + i * 7, 11);
          if (f * len < PRX + 16) continue;
          const perp = (hash(bi * 53 + i, 13) - 0.5) * 26;
          const x = px + dx * f + nx * perp, y = py + dy * f + ny * perp;
          const w = 4 + hash(bi * 17 + i, 3) * 7;
          const tone = hash(bi * 7 + i, 5), col = tone < 0.3 ? dirtDk : tone > 0.8 ? dirtLt : dirt;
          out.push({ x, y, rx: w, ry: w * 0.66, r: col[0], g: col[1], b: col[2], opacity: 0.32 + hash(bi + i, 9) * 0.22 });
        }
        if (b.kind === "house") {
          const doorY = b.y + (b.faceDown !== false ? b.h / 2 + 50 : -(b.h / 2 + 22));
          out.push({ x: b.x, y: doorY, rx: 34, ry: 16, r: dirtDk[0], g: dirtDk[1], b: dirtDk[2], opacity: 0.24 });
          out.push({ x: b.x, y: doorY, rx: 25, ry: 11, r: dirt[0], g: dirt[1], b: dirt[2], opacity: 0.3 });
        }
      });
      return (_pathPellets = out);
    }

    const FLOWERS = [[235, 120, 150], [240, 222, 120], [176, 152, 240], [238, 240, 250]];
    const GUST_PERIOD = 10;
    function gust(t, wx) {
      if (reduce) return 0;
      const phase = (t % GUST_PERIOD) / GUST_PERIOD;
      const frontX = (phase * 1.4 - 0.2) * (GRID * E);
      const d = (wx - frontX) / 220;
      const band = Math.exp(-d * d);
      return band * 4.5 * (0.82 + 0.18 * Math.sin(t * 9 + wx * 0.05));
    }
    let _forestItems = null;
    function forestItems() {
      if (_forestItems) return _forestItems;
      const out = [];
      for (let tx = 0; tx < GRID; tx++) for (let ty = 0; ty < GRID; ty++) {
        const e = ellip(tx + 0.5, ty + 0.5);
        if (e < 0.88 || e > 1.42) continue;
        if (hash(tx, ty, 21) > 0.6) continue;
        const wx = (tx + 0.5) * E, wy = (ty + 0.5) * E;
        const gx = wx + (hash(tx, ty, 22) - 0.5) * 60, gy = wy + (hash(tx, ty, 23) - 0.5) * 60;
        out.push({ wx, wy, gx, gy, mushroom: hash(tx, ty, 24) < 0.5 });
      }
      return (_forestItems = out);
    }
    function drawForestFloor() {
      const vx = k.width() / 2 + 90, vy = k.height() / 2 + 90;
      for (const f of forestItems()) {
        if (Math.abs(f.wx - me.x) > vx || Math.abs(f.wy - me.y) > vy) continue;
        const gx = f.gx, gy = f.gy;
        if (f.mushroom) {
          for (let i = 0; i < 3; i++) { const mx = gx + (i - 1) * 6, my = gy + (i % 2) * 3; k.drawRect({ pos: k.vec2(mx - 1.5, my - 2), width: 3, height: 6, radius: 1, color: k.rgb(228, 218, 198) }); k.drawEllipse({ pos: k.vec2(mx, my - 3), radiusX: 4, radiusY: 2.6, color: k.rgb(202, 92, 78) }); k.drawCircle({ pos: k.vec2(mx - 1, my - 3.6), radius: 0.8, color: k.rgb(246, 236, 220), opacity: 0.85 }); }
        } else {
          for (let i = -2; i <= 2; i++) k.drawLine({ p1: k.vec2(gx, gy + 2), p2: k.vec2(gx + i * 4, gy - 9 - Math.abs(i) * 1.5), width: 1.5, color: k.rgb(72, 112, 66), opacity: 0.72 });
        }
      }
    }
    let _scatterItems = null;
    function scatterItems() {
      if (_scatterItems) return _scatterItems;
      const out = [];
      for (let tx = 2; tx < GRID - 1; tx++) for (let ty = 2; ty < GRID - 1; ty++) {
        if (ellip(tx + 0.5, ty + 0.5) > 0.98) continue;
        const meadow = Math.hypot(tx + 0.5 - 9.5, ty + 0.5 - 7) < 3;
        const h0 = hash(tx, ty, 7);
        if (h0 > (meadow ? 0.78 : 0.46)) continue;
        const wx = (tx + 0.5) * E, wy = (ty + 0.5) * E;
        const gx = wx + (hash(tx, ty, 8) - 0.5) * 58, gy = wy + (hash(tx, ty, 9) - 0.5) * 58;
        const grass = h0 < (meadow ? 0.16 : 0.32);
        out.push({ wx, wy, gx, gy, grass, color: grass ? null : FLOWERS[Math.floor(hash(tx, ty, 10) * FLOWERS.length)], phase: tx * 0.6 + ty * 0.4 });
      }
      return (_scatterItems = out);
    }
    function drawGroundScatter(t) {
      const vx = k.width() / 2 + 70, vy = k.height() / 2 + 70;
      for (const s of scatterItems()) {
        if (Math.abs(s.wx - me.x) > vx || Math.abs(s.wy - me.y) > vy) continue;
        const gx = s.gx, gy = s.gy;
        let bx = reduce ? 0 : Math.sin(t * 1.1 + s.phase) * 1.6 + gust(t, gx) * 0.55;
        if (!reduce) { const ddx = gx - me.x, ddy = (gy - 7) - me.y, d = Math.hypot(ddx, ddy); if (d < 40) bx += (ddx / (d || 1)) * (1 - d / 40) * 5; }
        if (s.grass) {
          for (let i = -1; i <= 1; i++) k.drawLine({ p1: k.vec2(gx + i * 3, gy), p2: k.vec2(gx + i * 4 + bx, gy - 7 - (i === 0 ? 3 : 0)), width: 2, color: k.rgb(...LEAF_LT), opacity: 0.5 });
        } else {
          const c = s.color;
          k.drawLine({ p1: k.vec2(gx, gy), p2: k.vec2(gx + bx, gy - 6), width: 1.5, color: k.rgb(...LEAF), opacity: 0.6 });
          k.drawCircle({ pos: k.vec2(gx + bx, gy - 7), radius: 2.6, color: k.rgb(...c), opacity: 0.85 });
          k.drawCircle({ pos: k.vec2(gx + bx, gy - 7), radius: 1, color: k.rgb(245, 235, 150), opacity: 0.9 });
        }
      }
    }

    function drawVillager(c, t) {
      const x = c.x, p = c.pal, fl = c.dir;
      const moving = c.moving && !reduce;
      const bob = moving ? Math.abs(Math.sin(t * 8 + c.ph)) * 1.5 : 0, yy = c.y - bob;
      const sw = moving ? Math.sin(t * 8 + c.ph) * 2.5 : 0;
      k.drawEllipse({ pos: k.vec2(x, c.y + 8), radiusX: 9, radiusY: 3, color: k.rgb(0, 0, 0), opacity: 0.2 });
      k.drawRect({ pos: k.vec2(x - 5 + sw, yy + 2), width: 4, height: 9, radius: 1, color: k.rgb(...p.robeDk) });
      k.drawRect({ pos: k.vec2(x + 1 - sw, yy + 2), width: 4, height: 9, radius: 1, color: k.rgb(...p.robeDk) });
      k.drawEllipse({ pos: k.vec2(x - 8, yy - 1), radiusX: 3, radiusY: 7, color: k.rgb(...p.robe) });
      k.drawEllipse({ pos: k.vec2(x + 8, yy - 1), radiusX: 3, radiusY: 7, color: k.rgb(...p.robe) });
      k.drawEllipse({ pos: k.vec2(x, yy - 1), radiusX: 9, radiusY: 12, color: k.rgb(...p.robe) });
      k.drawRect({ pos: k.vec2(x - 8, yy + 3), width: 16, height: 8, radius: 3, color: k.rgb(...p.robe) });
      k.drawEllipse({ pos: k.vec2(x - 4, yy - 3), radiusX: 2.5, radiusY: 7, color: k.rgb(...p.robeDk), opacity: 0.35 });
      k.drawCircle({ pos: k.vec2(x, yy - 14), radius: 6, color: k.rgb(...p.skin) });
      k.drawEllipse({ pos: k.vec2(x, yy - 17), radiusX: 6.5, radiusY: 4.5, color: k.rgb(...p.hair) });
      k.drawEllipse({ pos: k.vec2(x - 6, yy - 14), radiusX: 1.6, radiusY: 3, color: k.rgb(...p.hair) });
      k.drawEllipse({ pos: k.vec2(x + 6, yy - 14), radiusX: 1.6, radiusY: 3, color: k.rgb(...p.hair) });
      k.drawCircle({ pos: k.vec2(x - 2 + fl * 0.6, yy - 13), radius: 1.1, color: k.rgb(44, 32, 30) });
      k.drawCircle({ pos: k.vec2(x + 2 + fl * 0.6, yy - 13), radius: 1.1, color: k.rgb(44, 32, 30) });
      if (c.greet && !reduce) {
        const hand = yy - 9 + Math.sin(t * 7 + c.ph) * 2;
        k.drawEllipse({ pos: k.vec2(x + fl * 9, yy - 4), radiusX: 3, radiusY: 6, color: k.rgb(...p.robe) });
        k.drawCircle({ pos: k.vec2(x + fl * 11, hand), radius: 2.6, color: k.rgb(...p.skin) });
        k.drawEllipse({ pos: k.vec2(x + fl * 0.6, yy - 11), radiusX: 2.6, radiusY: 1.3, color: k.rgb(150, 90, 80), opacity: 0.55 });
      }
    }
    function drawChicken(c, t) {
      const x = c.x, y = c.y, fl = c.dir;
      const bob = (c.moving && !reduce) ? Math.abs(Math.sin(t * 11)) * 2 : 0;
      const peckY = c.peck > 0 ? 4 : 0;
      k.drawEllipse({ pos: k.vec2(x, y + 5), radiusX: 9, radiusY: 3, color: k.rgb(0, 0, 0), opacity: 0.2 });
      k.drawLine({ p1: k.vec2(x - 2, y), p2: k.vec2(x - 2, y + 5), width: 1.5, color: k.rgb(222, 168, 60) });
      k.drawLine({ p1: k.vec2(x + 2, y), p2: k.vec2(x + 2, y + 5), width: 1.5, color: k.rgb(222, 168, 60) });
      k.drawEllipse({ pos: k.vec2(x - fl * 8, y - 9 - bob), radiusX: 4, radiusY: 6, color: k.rgb(222, 222, 212) });
      k.drawEllipse({ pos: k.vec2(x, y - 6 - bob), radiusX: 9, radiusY: 8, color: k.rgb(240, 240, 232) });
      const hx = x + fl * 7, hy = y - 12 - bob + peckY;
      k.drawCircle({ pos: k.vec2(hx, hy), radius: 4.5, color: k.rgb(240, 240, 232) });
      k.drawEllipse({ pos: k.vec2(hx - fl * 1, hy - 5), radiusX: 2.4, radiusY: 3, color: k.rgb(222, 72, 72) });
      k.drawRect({ pos: k.vec2(hx + fl * 3, hy - 1.2), width: 4, height: 2.4, color: k.rgb(242, 172, 40) });
      k.drawCircle({ pos: k.vec2(hx + fl * 1, hy - 1), radius: 0.9, color: k.rgb(40, 30, 30) });
      k.drawEllipse({ pos: k.vec2(hx - fl * 2, hy + 3), radiusX: 2, radiusY: 1.4, color: k.rgb(222, 72, 72), opacity: 0.8 });
    }

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
    function drawFountain(x, y, t) {
      const glow = HEAL, pulse = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 2.2);
      k.drawEllipse({ pos: k.vec2(x, y + 12), radiusX: 42, radiusY: 14, color: k.rgb(0, 0, 0), opacity: 0.22 });
      k.drawEllipse({ pos: k.vec2(x, y), radiusX: 38, radiusY: 22, color: k.rgb(...STONE_DK) });
      k.drawEllipse({ pos: k.vec2(x, y - 2), radiusX: 35, radiusY: 19, color: k.rgb(...STONE) });
      k.drawEllipse({ pos: k.vec2(x, y - 2), radiusX: 28, radiusY: 14, color: k.rgb(20, 50, 44) });
      k.drawEllipse({ pos: k.vec2(x, y - 3), radiusX: 24, radiusY: 11, color: k.rgb(...glow), opacity: 0.4 + 0.22 * pulse });
      k.drawEllipse({ pos: k.vec2(x - 7, y - 5), radiusX: 11, radiusY: 3.5, color: k.rgb(210, 255, 225), opacity: 0.32 * pulse });
      for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; k.drawCircle({ pos: k.vec2(x + Math.cos(a) * 33, y - 2 + Math.sin(a) * 18), radius: 3.4, color: k.rgb(...STONE_LT), opacity: 0.5 }); }
      k.drawRect({ pos: k.vec2(x - 6, y - 30), width: 12, height: 30, radius: 3, color: k.rgb(...STONE) });
      k.drawRect({ pos: k.vec2(x - 6, y - 30), width: 4, height: 30, color: k.rgb(...STONE_LT), opacity: 0.5 });
      k.drawEllipse({ pos: k.vec2(x, y - 30), radiusX: 18, radiusY: 9, color: k.rgb(...STONE_DK) });
      k.drawEllipse({ pos: k.vec2(x, y - 31), radiusX: 15, radiusY: 7, color: k.rgb(...STONE) });
      k.drawEllipse({ pos: k.vec2(x, y - 32), radiusX: 11, radiusY: 5, color: k.rgb(...glow), opacity: 0.5 + 0.25 * pulse });
      if (!reduce) {
        for (let i = 0; i < 5; i++) { const f = (t * 1.5 + i * 0.2) % 1; k.drawCircle({ pos: k.vec2(x + Math.sin(t * 3 + i) * 3, y - 34 - f * 17), radius: Math.max(0.5, 2 - f * 1.5), color: k.rgb(...glow), opacity: 0.6 * (1 - f) }); }
        for (const sx of [-13, 13]) for (let i = 0; i < 3; i++) { const f = (t * 1.7 + i * 0.33 + (sx > 0 ? 0.5 : 0)) % 1; k.drawCircle({ pos: k.vec2(x + sx, y - 30 + f * 27), radius: 1.4, color: k.rgb(...glow), opacity: 0.5 * (1 - f) }); }
        for (let i = 0; i < 4; i++) { const f = (t * 0.45 + i * 0.17) % 1; k.drawCircle({ pos: k.vec2(x + Math.sin(t * 1.2 + i * 2) * 22, y - 4 - f * 50), radius: Math.max(0.4, (1 - f) * 2.4), color: k.rgb(...glow), opacity: 0.42 * (1 - f) }); }
      }
    }
    function drawWell(x, y, t) {
      k.drawEllipse({ pos: k.vec2(x, y + 10), radiusX: 30, radiusY: 12, color: k.rgb(0, 0, 0), opacity: 0.22 });
      k.drawEllipse({ pos: k.vec2(x, y), radiusX: 28, radiusY: 18, color: k.rgb(...STONE_DK) });
      k.drawEllipse({ pos: k.vec2(x, y - 2), radiusX: 26, radiusY: 16, color: k.rgb(...STONE) });
      k.drawEllipse({ pos: k.vec2(x, y - 2), radiusX: 18, radiusY: 11, color: k.rgb(18, 38, 54) });
      k.drawEllipse({ pos: k.vec2(x, y - 3), radiusX: 14, radiusY: 8, color: k.rgb(...THEME.water), opacity: 0.38 });
      if (!reduce) {
        const rf = (t * 0.32) % 1;
        k.drawEllipse({ pos: k.vec2(x, y - 3), radiusX: 3 + rf * 11, radiusY: 2 + rf * 6, fill: false, outline: { width: 1, color: k.rgb(...THEME.water) }, opacity: 0.22 * (1 - rf) });
        k.drawEllipse({ pos: k.vec2(x + Math.sin(t * 0.7) * 6, y - 3 + Math.cos(t * 0.9) * 2.5), radiusX: 4.5, radiusY: 1.8, color: k.rgb(205, 230, 245), opacity: 0.16 + 0.12 * Math.sin(t * 1.6) });
      }
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; k.drawCircle({ pos: k.vec2(x + Math.cos(a) * 24, y - 2 + Math.sin(a) * 15), radius: 3.6, color: k.rgb(...STONE_LT), opacity: 0.5 }); }
      k.drawRect({ pos: k.vec2(x - 22, y - 46), width: 5, height: 48, color: k.rgb(...WOOD_DK) });
      k.drawRect({ pos: k.vec2(x + 17, y - 46), width: 5, height: 48, color: k.rgb(...WOOD_DK) });
      k.drawRect({ pos: k.vec2(x - 31, y - 54), width: 62, height: 13, radius: 3, color: k.rgb(...WOOD) });
      k.drawRect({ pos: k.vec2(x - 31, y - 54), width: 62, height: 4, radius: 2, color: k.rgb(...WOOD_LT), opacity: 0.6 });
      const bsway = reduce ? 0 : Math.sin(t * 1.3) * 2.5;
      k.drawLine({ p1: k.vec2(x, y - 49), p2: k.vec2(x + bsway, y - 13), width: 1.5, color: k.rgb(...WOOD_DK) });
      k.drawRect({ pos: k.vec2(x - 5 + bsway, y - 16), width: 10, height: 9, radius: 2, color: k.rgb(...WOOD) });
      k.drawRect({ pos: k.vec2(x - 5 + bsway, y - 16), width: 10, height: 2.5, color: k.rgb(...WOOD_LT), opacity: 0.6 });
    }
    function drawLantern(x, y, t) {
      const flick = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 6 + x * 0.1);
      k.drawEllipse({ pos: k.vec2(x, y + 2), radiusX: 54, radiusY: 31, color: k.rgb(255, 188, 92), opacity: 0.06 * flick });
      k.drawEllipse({ pos: k.vec2(x, y + 1), radiusX: 35, radiusY: 20, color: k.rgb(255, 198, 110), opacity: 0.09 * flick });
      k.drawEllipse({ pos: k.vec2(x, y),     radiusX: 18, radiusY: 11, color: k.rgb(255, 216, 142), opacity: 0.12 * flick });
      k.drawEllipse({ pos: k.vec2(x, y + 4), radiusX: 7, radiusY: 3, color: k.rgb(0, 0, 0), opacity: 0.2 });
      k.drawRect({ pos: k.vec2(x - 2.5, y - 46), width: 5, height: 50, radius: 2, color: k.rgb(...WOOD_DK) });
      k.drawRect({ pos: k.vec2(x - 9, y - 48), width: 14, height: 4, radius: 2, color: k.rgb(...WOOD_DK) });
      k.drawCircle({ pos: k.vec2(x + 8, y - 44), radius: 11, color: k.rgb(255, 196, 110), opacity: 0.18 * flick });
      k.drawRect({ pos: k.vec2(x + 3, y - 51), width: 11, height: 15, radius: 3, color: k.rgb(...WOOD) });
      k.drawRect({ pos: k.vec2(x + 4.5, y - 49), width: 8, height: 11, radius: 2, color: k.rgb(255, 212, 132), opacity: 0.5 + 0.45 * flick });
      if (!reduce) for (let i = 0; i < 3; i++) { const f = (t * 0.7 + i * 0.34 + x * 0.01) % 1; k.drawCircle({ pos: k.vec2(x + 8 + Math.sin(t * 2 + i * 2) * 3, y - 46 - f * 20), radius: Math.max(0.3, (1 - f) * 1.6), color: k.rgb(255, 198, 122), opacity: 0.55 * (1 - f) }); }
    }
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
    function drawBench(x, y, t, cat, basket) {
      k.drawEllipse({ pos: k.vec2(x, y + 9), radiusX: 28, radiusY: 6, color: k.rgb(0, 0, 0), opacity: 0.2 });
      for (const lx of [-22, 22]) for (const ly of [-1, 7]) k.drawRect({ pos: k.vec2(x + lx - 2, y + ly), width: 4, height: 7, color: k.rgb(...WOOD_DK) });
      k.drawRect({ pos: k.vec2(x - 27, y - 13), width: 54, height: 7, radius: 2, color: k.rgb(...WOOD_DK) });
      for (let i = 0; i < 5; i++) k.drawRect({ pos: k.vec2(x - 22 + i * 11, y - 12), width: 3, height: 8, color: k.rgb(...WOOD), opacity: 0.6 });
      k.drawRect({ pos: k.vec2(x - 27, y - 5), width: 54, height: 13, radius: 3, color: k.rgb(...WOOD) });
      k.drawRect({ pos: k.vec2(x - 27, y - 5), width: 54, height: 4, radius: 2, color: k.rgb(...WOOD_LT), opacity: 0.5 });
      for (let i = 1; i < 5; i++) k.drawLine({ p1: k.vec2(x - 27 + i * 10.8, y - 5), p2: k.vec2(x - 27 + i * 10.8, y + 8), width: 1, color: k.rgb(...WOOD_DK), opacity: 0.4 });
      if (cat) {
        const anim = typeof t === "number" && !reduce;
        const cx = x + 8, cy = y - 1, br = anim ? Math.sin(t * 1.6) * 0.5 : 0;
        const flick = anim && Math.sin(t * 0.6 + x) > 0.86 ? Math.sin(t * 11) * 3 : 0;
        const fur = [172, 162, 148], furDk = [132, 122, 110];
        k.drawEllipse({ pos: k.vec2(cx, cy + 1), radiusX: 14, radiusY: 8.5 + br, color: k.rgb(...fur) });
        k.drawEllipse({ pos: k.vec2(cx + 12, cy + 3 + flick), radiusX: 7, radiusY: 3, color: k.rgb(...furDk) });
        for (let i = 0; i < 4; i++) k.drawLine({ p1: k.vec2(cx - 6 + i * 5, cy - 3), p2: k.vec2(cx - 7 + i * 5, cy + 5), width: 1, color: k.rgb(...furDk), opacity: 0.4 });
        k.drawEllipse({ pos: k.vec2(cx - 10, cy - 1), radiusX: 6, radiusY: 5.5, color: k.rgb(...fur) });
        k.drawEllipse({ pos: k.vec2(cx - 13, cy - 5), radiusX: 2.2, radiusY: 2.8, color: k.rgb(...fur) });
        k.drawEllipse({ pos: k.vec2(cx - 7, cy - 5), radiusX: 2.2, radiusY: 2.8, color: k.rgb(...fur) });
        k.drawLine({ p1: k.vec2(cx - 13, cy), p2: k.vec2(cx - 9.5, cy), width: 1.2, color: k.rgb(...furDk), opacity: 0.75 });
      }
      if (basket) {
        const bx0 = x - 1, by0 = y - 2;
        k.drawRect({ pos: k.vec2(bx0 - 14, by0 - 1), width: 28, height: 12, radius: 5, color: k.rgb(150, 110, 66) });
        for (let i = 1; i < 4; i++) k.drawLine({ p1: k.vec2(bx0 - 14 + i * 7, by0 - 1), p2: k.vec2(bx0 - 14 + i * 7, by0 + 11), width: 1, color: k.rgb(116, 84, 50), opacity: 0.6 });
        k.drawEllipse({ pos: k.vec2(bx0, by0 - 1), radiusX: 14, radiusY: 4, color: k.rgb(170, 128, 80) });
        k.drawCircle({ pos: k.vec2(bx0 - 6, by0 - 3), radius: 4, color: k.rgb(...THEME.danger) });
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
    function drawPlanter(x, y, t) {
      const sway = reduce ? 0 : Math.sin(t * 1.5 + x * 0.1);
      k.drawEllipse({ pos: k.vec2(x, y + 6), radiusX: 15, radiusY: 5, color: k.rgb(0, 0, 0), opacity: 0.2 });
      for (let i = -2; i <= 2; i++) { const hx = x + i * 5; k.drawLine({ p1: k.vec2(hx, y - 2), p2: k.vec2(hx + sway * i * 0.6, y - 15 - (i % 2 ? 0 : 4)), width: 2, color: k.rgb(...HEAL), opacity: 0.7 }); k.drawCircle({ pos: k.vec2(hx + sway * i * 0.6, y - 16 - (i % 2 ? 0 : 4)), radius: 2, color: k.rgb(...HEAL), opacity: 0.6 }); }
      k.drawRect({ pos: k.vec2(x - 14, y - 4), width: 28, height: 14, radius: 3, color: k.rgb(...WOOD) });
      k.drawRect({ pos: k.vec2(x - 14, y - 4), width: 28, height: 4, radius: 2, color: k.rgb(...WOOD_LT), opacity: 0.5 });
    }

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

    function drawBuilding(b, t) {
      if (b.kind === "cave") drawCavePortal(b, t);
      else drawHouse(b, t);
    }

    const ROOF = [[156, 86, 66], [92, 112, 140], [74, 104, 88], [156, 128, 80]];
    const ROOF_DK = ROOF.map((c) => c.map((v) => Math.round(v * 0.66)));
    const ROOF_LT = ROOF.map((c) => c.map((v) => Math.min(255, v + 30)));
    function potion(px, py, c) {
      k.drawRect({ pos: k.vec2(px - 4, py - 3), width: 8, height: 11, radius: 3, color: k.rgb(...c), opacity: 0.92 });
      k.drawCircle({ pos: k.vec2(px, py + 5), radius: 5, color: k.rgb(...c), opacity: 0.92 });
      k.drawRect({ pos: k.vec2(px - 1.5, py - 8), width: 3, height: 5, color: k.rgb(...WOOD_LT) });
      k.drawRect({ pos: k.vec2(px - 2.5, py - 10), width: 5, height: 3, radius: 1, color: k.rgb(...WOOD_DK) });
      k.drawCircle({ pos: k.vec2(px - 1.5, py + 3), radius: 1.6, color: k.rgb(255, 255, 255), opacity: 0.4 });
    }
    function dressRoom(x, y, lft, rgt, top, bot, BW, BH, t, accent, fd) {
      const by = (d, h = 0) => fd ? top + d : bot - d - h;
      const fy = (d, h = 0) => fd ? bot - d - h : top + d;
      k.drawEllipse({ pos: k.vec2(x, y), radiusX: BW * 0.44, radiusY: BH * 0.38, color: k.rgb(255, 206, 144), opacity: 0.055 });
      k.drawRect({ pos: k.vec2(lft + 13, top + 19), width: BW - 26, height: BH - 32, radius: 5, fill: false, outline: { width: 1.5, color: k.rgb(...WOOD) }, opacity: 0.22 });
      for (const sxn of [lft + 13, rgt - 13]) {
        const fl = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 5 + sxn * 0.2);
        k.drawCircle({ pos: k.vec2(sxn, by(42)), radius: 11, color: k.rgb(255, 196, 110), opacity: 0.13 * fl });
        k.drawRect({ pos: k.vec2(sxn - 3, by(40, 8)), width: 6, height: 8, radius: 2, color: k.rgb(...WOOD_DK) });
        k.drawCircle({ pos: k.vec2(sxn, by(41)), radius: 2.6, color: k.rgb(255, 222, 150), opacity: 0.6 + 0.4 * fl });
        k.drawRect({ pos: k.vec2(sxn - 7, y - 8), width: 14, height: 16, radius: 2, color: k.rgb(...WOOD) });
        k.drawRect({ pos: k.vec2(sxn - 5, y - 6), width: 10, height: 12, radius: 1, color: k.rgb(...accent), opacity: 0.5 });
      }
      k.drawEllipse({ pos: k.vec2(x, fy(15)), radiusX: 26, radiusY: 8, color: k.rgb(...accent), opacity: 0.14 });
      k.drawEllipse({ pos: k.vec2(x, fy(15)), radiusX: 26, radiusY: 8, fill: false, outline: { width: 1.5, color: k.rgb(...accent) }, opacity: 0.26 });
    }
    function drawHouse(b, t) {
      const x = b.x, y = b.y, BW = b.w, BH = b.h, id = b.id;
      const lft = x - BW / 2, rgt = x + BW / 2, top = y - BH / 2, bot = y + BH / 2;
      const ra = b.roofA != null ? b.roofA : 1;
      const di = b.design || 0, roof = ROOF[di], roofDk = ROOF_DK[di], roofLt = ROOF_LT[di];
      const amber = THEME.amber, vio = THEME.violet, mid = y - 6;
      const fd = b.faceDown !== false, s = fd ? 1 : -1;
      const by = (d, h = 0) => fd ? top + d : bot - d - h;
      const fy = (d, h = 0) => fd ? bot - d - h : top + d;
      const oy = (d) => fd ? bot + d : top - d;
      const cy = (o) => y + s * o;
      const cyr = (o, h) => fd ? y + o : y - o - h;
      k.drawEllipse({ pos: k.vec2(x, bot + 4), radiusX: BW / 2 + 6, radiusY: 18, color: k.rgb(0, 0, 0), opacity: 0.26 });
      if (ra < 0.99) {
      k.drawRect({ pos: k.vec2(lft + 8, top + 14), width: BW - 16, height: BH - 22, radius: 6, color: k.rgb(48, 40, 34) });
      for (let i = 1; i < 6; i++) k.drawLine({ p1: k.vec2(lft + 8, top + 14 + i * (BH - 22) / 6), p2: k.vec2(rgt - 8, top + 14 + i * (BH - 22) / 6), width: 1, color: k.rgb(...WOOD_DK), opacity: 0.3 });
      k.drawRect({ pos: k.vec2(lft + 8, top + 14), width: BW - 16, height: BH - 22, radius: 6, fill: false, outline: { width: 4, color: k.rgb(...WOOD_DK) } });
      k.drawRect({ pos: k.vec2(lft + 11, top + 17), width: BW - 22, height: BH - 28, radius: 6, fill: false, outline: { width: 8, color: k.rgb(18, 14, 10) }, opacity: 0.16 });
      const rugC = ({ merchant: amber, healer: HEAL, vault: vio, bestiary: THEME.water, cosmetics: THEME.psychic }[id]) || WOOD;
      k.drawEllipse({ pos: k.vec2(x, cy(18)), radiusX: BW * 0.3, radiusY: BH * 0.24, color: k.rgb(...rugC), opacity: 0.16 });
      k.drawEllipse({ pos: k.vec2(x, cy(18)), radiusX: BW * 0.3, radiusY: BH * 0.24, fill: false, outline: { width: 2.5, color: k.rgb(...rugC) }, opacity: 0.3 });
      k.drawEllipse({ pos: k.vec2(x, cy(18)), radiusX: BW * 0.2, radiusY: BH * 0.16, fill: false, outline: { width: 1.5, color: k.rgb(...rugC) }, opacity: 0.22 });
      dressRoom(x, y, lft, rgt, top, bot, BW, BH, t, rugC, fd);
      const dl = Math.max(48, Math.min(78, BW * 0.15));
      k.drawEllipse({ pos: k.vec2(x, fy(30)), radiusX: dl * 0.95, radiusY: 26, color: k.rgb(150, 172, 205), opacity: 0.06 });
      k.drawEllipse({ pos: k.vec2(x, fy(20)), radiusX: dl * 0.72, radiusY: 17, color: k.rgb(162, 184, 216), opacity: 0.05 });
      k.drawCircle({ pos: k.vec2(x, by(9)), radius: 9, color: k.rgb(...rugC), opacity: 0.4 });
      k.drawCircle({ pos: k.vec2(x, by(9)), radius: 9, fill: false, outline: { width: 2, color: k.rgb(...rugC) }, opacity: 0.5 });
      k.drawCircle({ pos: k.vec2(x, by(9)), radius: 3.5, color: k.rgb(...rugC), opacity: 0.6 });
      for (const sx of [lft + 18, rgt - 18]) {
        k.drawRect({ pos: k.vec2(sx - 9, y - 25), width: 18, height: 50, radius: 2, color: k.rgb(...WOOD_DK) });
        k.drawRect({ pos: k.vec2(sx - 9, y - 25), width: 18, height: 4, radius: 1, color: k.rgb(...WOOD_LT), opacity: 0.5 });
        for (let i = 0; i < 3; i++) k.drawLine({ p1: k.vec2(sx - 9, y - 13 + i * 13), p2: k.vec2(sx + 9, y - 13 + i * 13), width: 1, color: k.rgb(...WOOD), opacity: 0.5 });
        k.drawRect({ pos: k.vec2(sx - 6, y - 4), width: 12, height: 9, radius: 2, color: k.rgb(...rugC), opacity: 0.55 });
      }
      const runMid = (fy(6) + cy(8)) / 2, runHalf = Math.abs(fy(6) - cy(8)) / 2 + 8;
      k.drawEllipse({ pos: k.vec2(x, runMid), radiusX: 21, radiusY: runHalf, color: k.rgb(...rugC), opacity: 0.1 });
      k.drawEllipse({ pos: k.vec2(x, runMid), radiusX: 21, radiusY: runHalf, fill: false, outline: { width: 1.5, color: k.rgb(...rugC) }, opacity: 0.2 });
      if (id === "healer") { drawPlanter(lft + 34, fy(42), t); drawPlanter(rgt - 34, fy(42), t); }
      else { drawBarrelProp(lft + 34, fy(42)); drawCrateProp(rgt - 34, fy(42)); }
      if (id === "merchant") {
        k.drawRect({ pos: k.vec2(lft + 18, by(22, 18)), width: BW - 36, height: 18, radius: 2, color: k.rgb(...WOOD) });
        const wares = [THEME.teal, vio, amber, THEME.ice, THEME.danger, HEAL];
        for (let i = 0; i < 6; i++) potion(lft + 34 + i * ((BW - 68) / 5), by(27), wares[i]);
        k.drawRect({ pos: k.vec2(x + 64, by(54, 26)), width: 22, height: 26, radius: 6, color: k.rgb(...WOOD) });
        k.drawEllipse({ pos: k.vec2(x + 75, by(54)), radiusX: 11, radiusY: 4, color: k.rgb(...WOOD_LT) });
        k.drawRect({ pos: k.vec2(x + 64, by(64, 3)), width: 22, height: 3, color: k.rgb(...WOOD_DK) });
        k.drawCircle({ pos: k.vec2(x + 75, by(50)), radius: 4, color: k.rgb(...amber) });
        k.drawCircle({ pos: k.vec2(x + 79, by(52)), radius: 4, color: k.rgb(...amber) });
        for (const [sx, so, r] of [[x - 72, 38, 12], [x - 56, 41, 10], [x - 64, 26, 10]]) { k.drawEllipse({ pos: k.vec2(sx, cy(so)), radiusX: r, radiusY: r * 0.92, color: k.rgb(...WOOD_LT) }); k.drawEllipse({ pos: k.vec2(sx, cy(so - r * 0.5)), radiusX: r * 0.45, radiusY: 2.6, color: k.rgb(...WOOD_DK), opacity: 0.5 }); k.drawLine({ p1: k.vec2(sx - r * 0.6, cy(so + 1)), p2: k.vec2(sx + r * 0.6, cy(so + 1)), width: 1, color: k.rgb(...WOOD_DK), opacity: 0.4 }); }
        k.drawRect({ pos: k.vec2(x - 100, cyr(28, 22)), width: 20, height: 22, radius: 2, color: k.rgb(...WOOD) });
        k.drawRect({ pos: k.vec2(x - 100, cyr(28, 22)), width: 20, height: 22, fill: false, outline: { width: 1.5, color: k.rgb(...WOOD_DK) } });
        for (const [cx, n] of [[x - 96, 3], [x - 88, 2]]) for (let i = 0; i < n; i++) k.drawEllipse({ pos: k.vec2(cx, cy(22 - i * 3)), radiusX: 4.5, radiusY: 2.2, color: k.rgb(...amber), opacity: 0.92 });
        k.drawLine({ p1: k.vec2(x - 30, by(14)), p2: k.vec2(x - 30, by(44)), width: 1.5, color: k.rgb(...WOOD_DK) });
        k.drawLine({ p1: k.vec2(x - 42, by(44)), p2: k.vec2(x - 18, by(44)), width: 2, color: k.rgb(...amber) });
        for (const dx of [-42, -18]) { k.drawLine({ p1: k.vec2(x + dx, by(44)), p2: k.vec2(x + dx, by(50)), width: 1, color: k.rgb(...WOOD_DK) }); k.drawEllipse({ pos: k.vec2(x + dx, by(51)), radiusX: 6, radiusY: 2.4, color: k.rgb(...amber), opacity: 0.8 }); }
      } else if (id === "healer") {
        const pulse = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 2.5);
        k.drawEllipse({ pos: k.vec2(x, by(42)), radiusX: 36, radiusY: 14, color: k.rgb(...STONE) });
        k.drawEllipse({ pos: k.vec2(x, by(40)), radiusX: 28, radiusY: 10, color: k.rgb(...HEAL), opacity: 0.5 + 0.25 * pulse });
        k.drawEllipse({ pos: k.vec2(x - 4, by(38)), radiusX: 13, radiusY: 4, color: k.rgb(210, 255, 225), opacity: 0.4 * pulse });
        k.drawRect({ pos: k.vec2(x + 60, by(58, 16)), width: 18, height: 16, radius: 3, color: k.rgb(...WOOD_DK) });
        k.drawEllipse({ pos: k.vec2(x + 69, by(58)), radiusX: 9, radiusY: 3, color: k.rgb(...WOOD) });
        for (const dx of [-5, 0, 5]) k.drawEllipse({ pos: k.vec2(x + 69 + dx, by(52)), radiusX: 3, radiusY: 7, color: k.rgb(...HEAL), opacity: 0.85 });
        const cb = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 3 + 1);
        k.drawRect({ pos: k.vec2(x - 76, cyr(30, 15)), width: 4, height: 15, color: k.rgb(...WOOD_DK) }); k.drawRect({ pos: k.vec2(x - 54, cyr(30, 15)), width: 4, height: 15, color: k.rgb(...WOOD_DK) });
        k.drawEllipse({ pos: k.vec2(x - 64, cy(30)), radiusX: 17, radiusY: 10, color: k.rgb(38, 42, 38) });
        k.drawEllipse({ pos: k.vec2(x - 64, cy(24)), radiusX: 14, radiusY: 5.5, color: k.rgb(...HEAL), opacity: 0.5 + 0.3 * cb });
        if (!reduce) for (let i = 0; i < 3; i++) { const f = (t * 0.6 + i * 0.34) % 1; k.drawCircle({ pos: k.vec2(x - 64 + (i - 1) * 5, cy(24) - f * 15), radius: Math.max(0.5, (1 - f) * 2), color: k.rgb(...HEAL), opacity: 0.5 * (1 - f) }); }
        for (const [bx, bo] of [[x - 92, 42], [x - 80, 42], [x - 86, 34]]) { k.drawCircle({ pos: k.vec2(bx, cy(bo)), radius: 6, color: k.rgb(238, 232, 214) }); k.drawCircle({ pos: k.vec2(bx, cy(bo)), radius: 2.4, color: k.rgb(...HEAL), opacity: 0.4 }); }
      } else if (id === "vault") {
        k.drawRect({ pos: k.vec2(x - 58, by(22, 32)), width: 116, height: 32, radius: 5, color: k.rgb(70, 76, 92) });
        const tn = Math.min(6, teamHP.length);
        if (tn) {
          const sp = tn > 1 ? Math.min(26, 96 / (tn - 1)) : 0, x0 = x - sp * (tn - 1) / 2;
          for (let i = 0; i < tn; i++) { const ox = x0 + i * sp, c = teamHP[i] ? amber : HEAL; k.drawCircle({ pos: k.vec2(ox, by(38)), radius: 8, color: k.rgb(...c), opacity: 0.3 }); k.drawCircle({ pos: k.vec2(ox, by(38)), radius: 5, color: k.rgb(...c) }); }
        } else { k.drawCircle({ pos: k.vec2(x, by(38)), radius: 5, fill: false, outline: { width: 2, color: k.rgb(...STONE_LT) }, opacity: 0.4 }); }
        k.drawRect({ pos: k.vec2(x + 56, by(60, 18)), width: 26, height: 18, radius: 3, color: k.rgb(72, 76, 92) });
        k.drawRect({ pos: k.vec2(x + 56, by(60, 5)), width: 26, height: 5, radius: 2, color: k.rgb(92, 96, 112) });
        k.drawCircle({ pos: k.vec2(x + 69, by(69)), radius: 2.5, color: k.rgb(...amber) });
        k.drawRect({ pos: k.vec2(x - 92, cyr(14, 38)), width: 36, height: 38, radius: 3, color: k.rgb(58, 64, 78) });
        k.drawRect({ pos: k.vec2(x - 92, cyr(14, 38)), width: 36, height: 38, fill: false, outline: { width: 2, color: k.rgb(90, 96, 112) } });
        k.drawCircle({ pos: k.vec2(x - 74, cy(34)), radius: 6, fill: false, outline: { width: 2, color: k.rgb(...STONE_LT) } });
        k.drawCircle({ pos: k.vec2(x - 74, cy(34)), radius: 1.6, color: k.rgb(...amber) });
        k.drawRect({ pos: k.vec2(x - 90, cyr(18, 3)), width: 7, height: 3, radius: 1, color: k.rgb(90, 96, 112) });
        for (const [gx, go] of [[x - 50, 48], [x - 38, 48], [x - 44, 42]]) { k.drawRect({ pos: k.vec2(gx - 7, cyr(go - 3, 6)), width: 14, height: 6, radius: 1, color: k.rgb(...amber) }); k.drawRect({ pos: k.vec2(gx - 7, cyr(go - 3, 2)), width: 14, height: 2, radius: 1, color: k.rgb(255, 230, 150), opacity: 0.7 }); }
      } else if (id === "bestiary") {
        const spines = [THEME.danger, amber, THEME.teal, vio, HEAL, THEME.water, THEME.psychic];
        for (let r = 0; r < 2; r++) {
          k.drawRect({ pos: k.vec2(lft + 16, by(18 + r * 16, 14)), width: BW - 32, height: 14, radius: 2, color: k.rgb(54, 44, 36) });
          const n = 12, sw = (BW - 44) / n;
          for (let i = 0; i < n; i++) k.drawRect({ pos: k.vec2(lft + 20 + i * sw, by(19 + r * 16, 11)), width: sw - 1.6, height: 11, color: k.rgb(...spines[(i + r * 3) % spines.length]), opacity: 0.82 });
        }
        k.drawRect({ pos: k.vec2(x + 62, by(58, 18)), width: 4, height: 18, color: k.rgb(...WOOD_DK) });
        k.drawEllipse({ pos: k.vec2(x + 64, by(76)), radiusX: 11, radiusY: 3, color: k.rgb(...WOOD_DK), opacity: 0.5 });
        k.drawRect({ pos: k.vec2(x + 52, by(50, 13)), width: 24, height: 13, radius: 2, color: k.rgb(...THEME.water), opacity: 0.85 });
        k.drawLine({ p1: k.vec2(x + 64, by(50)), p2: k.vec2(x + 64, by(63)), width: 1.5, color: k.rgb(40, 40, 52) });
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
        k.drawLine({ p1: k.vec2(lft + 18, by(22)), p2: k.vec2(rgt - 18, by(22)), width: 2, color: k.rgb(...STONE_LT) });
        const garments = [THEME.psychic, THEME.teal, amber, vio, HEAL, THEME.danger];
        for (let i = 0; i < 6; i++) { const gx = lft + 30 + i * ((BW - 60) / 5); k.drawEllipse({ pos: k.vec2(gx, by(23)), radiusX: 4, radiusY: 2, color: k.rgb(...garments[i]) }); k.drawRect({ pos: k.vec2(gx - 6, by(24, 20)), width: 12, height: 20, radius: 3, color: k.rgb(...garments[i]), opacity: 0.85 }); }
        k.drawEllipse({ pos: k.vec2(x + 64, by(56)), radiusX: 11, radiusY: 16, color: k.rgb(...THEME.psychic), opacity: 0.3 });
        k.drawEllipse({ pos: k.vec2(x + 64, by(56)), radiusX: 11, radiusY: 16, fill: false, outline: { width: 3, color: k.rgb(...WOOD) } });
        k.drawEllipse({ pos: k.vec2(x + 60, by(50)), radiusX: 3, radiusY: 6, color: k.rgb(255, 255, 255), opacity: 0.35 });
        k.drawRect({ pos: k.vec2(x + 62, by(72, 8)), width: 4, height: 8, color: k.rgb(...WOOD_DK) });
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
      if (b.keeper) b.keeper(x, cy(8), t);
      if (id === "merchant") {
        k.drawRect({ pos: k.vec2(x - 62, cyr(44, 24)), width: 124, height: 24, radius: 4, color: k.rgb(...WOOD) });
        k.drawRect({ pos: k.vec2(x - 64, cyr(39, 7)), width: 128, height: 7, radius: 3, color: k.rgb(...WOOD_LT) });
        potion(x - 42, cy(45), THEME.teal); potion(x - 24, cy(45), vio);
        k.drawCircle({ pos: k.vec2(x + 10, cy(43)), radius: 6, color: k.rgb(...THEME.ice) });
      }
      }
      drawSouthWall(b, t);
      if (ra > 0.03) {
        k.drawRect({ pos: k.vec2(lft - 8, top + 4), width: BW + 16, height: BH - 2, radius: 10, color: k.rgb(...roofDk), opacity: ra });
        k.drawRect({ pos: k.vec2(lft - 3, top + 6), width: BW + 6, height: mid - (top + 6), radius: 7, color: k.rgb(...roof), opacity: ra });
        k.drawRect({ pos: k.vec2(lft - 3, mid), width: BW + 6, height: (bot - 4) - mid, radius: 7, color: k.rgb(...roofDk), opacity: ra });
        k.drawRect({ pos: k.vec2(lft - 3, mid - 2), width: BW + 6, height: 5, radius: 2, color: k.rgb(...roofLt), opacity: 0.8 * ra });
        for (let i = 1; i < 4; i++) { const yy = top + 6 + i * (mid - top - 6) / 4; k.drawLine({ p1: k.vec2(lft, yy), p2: k.vec2(rgt, yy), width: 1.5, color: k.rgb(...roofDk), opacity: 0.45 * ra }); }
        for (let i = 1; i < 4; i++) { const yy = mid + i * (bot - 4 - mid) / 4; k.drawLine({ p1: k.vec2(lft, yy), p2: k.vec2(rgt, yy), width: 1.5, color: k.rgb(...WOOD_DK), opacity: 0.4 * ra }); }
        for (let i = 0; i < 3; i++) {
          const mx = lft + 16 + hash(b.x + i * 31, b.y) * (BW - 32);
          const my = mid + 4 + hash(b.x, b.y + i * 17) * (bot - 4 - mid - 8);
          k.drawEllipse({ pos: k.vec2(mx, my), radiusX: 5 + hash(b.x + i, b.y + i) * 5, radiusY: 3, color: k.rgb(80, 104, 60), opacity: 0.3 * ra });
        }
        const winY = fy(Math.round(BH / 4 + 6));
        const wlit = reduce ? 0.85 : 0.72 + 0.2 * Math.sin(t * 3 + b.x * 0.05);
        const ws = Math.min(1.3, Math.max(1, BW / 468));
        const nw = BW > 470 ? 3 : 2;
        for (let i = 0; i < nw; i++) {
          const wx = x + (i - (nw - 1) / 2) * (BW * 0.28);
          k.drawCircle({ pos: k.vec2(wx, winY), radius: 23 * ws, color: k.rgb(255, 198, 110), opacity: 0.11 * wlit * ra });
          k.drawRect({ pos: k.vec2(wx - 14 * ws, winY - 15 * ws), width: 28 * ws, height: 30 * ws, radius: 4, color: k.rgb(...WOOD_DK), opacity: ra });
          k.drawRect({ pos: k.vec2(wx - 10 * ws, winY - 11 * ws), width: 20 * ws, height: 22 * ws, radius: 3, color: k.rgb(255, 214, 140), opacity: (0.55 + 0.4 * wlit) * ra });
          k.drawLine({ p1: k.vec2(wx, winY - 11 * ws), p2: k.vec2(wx, winY + 11 * ws), width: 1.5, color: k.rgb(...WOOD_DK), opacity: 0.6 * ra });
          k.drawLine({ p1: k.vec2(wx - 10 * ws, winY), p2: k.vec2(wx + 10 * ws, winY), width: 1.5, color: k.rgb(...WOOD_DK), opacity: 0.6 * ra });
          k.drawRect({ pos: k.vec2(wx - 15 * ws, winY + (fd ? 11 * ws : -25 * ws)), width: 30 * ws, height: 8, radius: 2, color: k.rgb(...WOOD_DK), opacity: ra });
          for (let j = 0; j < 3; j++) { const fc = [THEME.danger, amber, THEME.psychic][(i + j) % 3]; const fx = wx + (j - 1) * 9 * ws; k.drawCircle({ pos: k.vec2(fx, winY + s * 14 * ws), radius: 3, color: k.rgb(...fc), opacity: 0.9 * ra }); k.drawCircle({ pos: k.vec2(fx, winY + s * 14 * ws), radius: 1.1, color: k.rgb(255, 240, 180), opacity: ra }); }
        }
        const ew = Math.max(48, Math.min(78, BW * 0.15)), eg = reduce ? 0.9 : 0.82 + 0.18 * Math.sin(t * 2.5 + b.x * 0.05);
        if (!fd) {
        const archY = top - 6;
        k.drawEllipse({ pos: k.vec2(x, oy(3)), radiusX: ew + 2, radiusY: 13, color: k.rgb(...STONE_DK), opacity: ra });
        k.drawEllipse({ pos: k.vec2(x, oy(1)), radiusX: ew * 0.84, radiusY: 10, color: k.rgb(...STONE), opacity: ra });
        k.drawEllipse({ pos: k.vec2(x, fy(1)), radiusX: ew * 0.56, radiusY: 6.5, color: k.rgb(...STONE_LT), opacity: 0.55 * ra });
        k.drawRect({ pos: k.vec2(x - ew, archY), width: ew * 2, height: 44, radius: 22, color: k.rgb(...STONE), opacity: ra });
        k.drawRect({ pos: k.vec2(x - ew + 6, archY + 4), width: ew * 2 - 12, height: 44, radius: 18, color: k.rgb(44, 33, 26), opacity: ra });
        k.drawRect({ pos: k.vec2(x - ew + 11, archY + 13), width: ew * 2 - 22, height: 36, radius: 14, color: k.rgb(255, 206, 128), opacity: 0.5 * eg * ra });
        k.drawEllipse({ pos: k.vec2(x, fy(2)), radiusX: ew * 0.82, radiusY: 11, color: k.rgb(255, 200, 120), opacity: 0.24 * eg * ra });
        }
        k.drawRect({ pos: k.vec2(lft + 22, top - 8), width: 18, height: 24, radius: 2, color: k.rgb(...STONE), opacity: ra });
        k.drawRect({ pos: k.vec2(lft + 20, top - 11), width: 22, height: 6, radius: 2, color: k.rgb(...STONE_DK), opacity: ra });
      }
    }

    function drawSouthWall(b, t) {
      const ra = b.roofA != null ? b.roofA : 1;
      if (ra <= 0.03) return;
      const x = b.x, BW = b.w, BH = b.h;
      const lft = x - BW / 2, rgt = x + BW / 2, bot = b.y + BH / 2;
      const wallMid = [150, 128, 100], wallLt = [182, 160, 130], wallDk = [108, 90, 68];
      const beam = WOOD_DK, doorC = [58, 42, 28];
      const wH = Math.round(Math.min(74, Math.max(50, BH * 0.17)));
      const wy = bot - 8, wl = lft + 2, wr = rgt - 2, ww = wr - wl;
      const southIsFront = b.faceDown !== false;
      k.drawEllipse({ pos: k.vec2(x, wy + wH + 3), radiusX: BW / 2 + 2, radiusY: 13, color: k.rgb(0, 0, 0), opacity: 0.26 * ra });
      k.drawRect({ pos: k.vec2(wl, wy), width: ww, height: wH, color: k.rgb(...wallMid), opacity: ra });
      k.drawRect({ pos: k.vec2(wl, wy), width: ww, height: 6, color: k.rgb(...wallLt), opacity: 0.5 * ra });
      k.drawRect({ pos: k.vec2(wl, wy + wH - 9), width: ww, height: 9, color: k.rgb(...wallDk), opacity: 0.5 * ra });
      k.drawRect({ pos: k.vec2(wl, wy), width: ww, height: 6, color: k.rgb(...beam), opacity: 0.9 * ra });
      k.drawRect({ pos: k.vec2(wl, wy + wH - 6), width: ww, height: 6, color: k.rgb(...beam), opacity: ra });
      k.drawRect({ pos: k.vec2(wl, wy), width: 8, height: wH, color: k.rgb(...beam), opacity: ra });
      k.drawRect({ pos: k.vec2(wr - 8, wy), width: 8, height: wH, color: k.rgb(...beam), opacity: ra });
      if (southIsFront) {
        const dw = Math.max(40, Math.min(64, ww * 0.16)), dyTop = wy + 12, dh = wH - 14;
        const da = b.doorA || 0, dlft = x - dw / 2;
        k.drawRect({ pos: k.vec2(dlft - 4, dyTop - 4), width: dw + 8, height: dh + 4, radius: 5, color: k.rgb(...beam), opacity: ra });
        k.drawRect({ pos: k.vec2(dlft, dyTop), width: dw, height: dh, radius: 4, color: k.rgb(22, 15, 11), opacity: ra });
        k.drawRect({ pos: k.vec2(dlft, dyTop), width: dw, height: dh, radius: 4, color: k.rgb(255, 206, 128), opacity: 0.2 * da * ra });
        const pw = Math.max(2, dw * (1 - 0.84 * da));
        k.drawRect({ pos: k.vec2(dlft, dyTop), width: pw, height: dh, radius: 4, color: k.rgb(...doorC), opacity: ra });
        for (let i = 1; i < 3; i++) { const lx = dlft + i * pw / 3; if (lx < dlft + pw - 1) k.drawLine({ p1: k.vec2(lx, dyTop + 2), p2: k.vec2(lx, dyTop + dh - 2), width: 1.5, color: k.rgb(...beam), opacity: 0.55 * ra }); }
        k.drawCircle({ pos: k.vec2(dlft + pw - 5, dyTop + dh * 0.55), radius: 2.4, color: k.rgb(...THEME.amber), opacity: ra });
        const eg = reduce ? 0.9 : 0.82 + 0.18 * Math.sin(t * 2.5 + b.x * 0.05);
        k.drawEllipse({ pos: k.vec2(x, wy + wH + 1), radiusX: dw * 0.72, radiusY: 7, color: k.rgb(255, 206, 128), opacity: (0.16 + 0.28 * da) * eg * ra });
      }
      const wlit = reduce ? 0.85 : 0.72 + 0.2 * Math.sin(t * 3 + b.x * 0.05);
      const offs = southIsFront ? [-0.30, 0.30] : [-0.32, 0, 0.32];
      const wwd = Math.min(34, ww * 0.13), wht = Math.min(30, wH - 24), wTop = wy + 13;
      for (const o of offs) {
        const cx = x + o * ww;
        k.drawCircle({ pos: k.vec2(cx, wTop + wht / 2), radius: wwd * 0.85, color: k.rgb(255, 198, 110), opacity: 0.08 * wlit * ra });
        k.drawRect({ pos: k.vec2(cx - wwd / 2 - 3, wTop - 3), width: wwd + 6, height: wht + 6, radius: 3, color: k.rgb(...beam), opacity: ra });
        k.drawRect({ pos: k.vec2(cx - wwd / 2, wTop), width: wwd, height: wht, radius: 2, color: k.rgb(255, 214, 140), opacity: (0.5 + 0.4 * wlit) * ra });
        k.drawLine({ p1: k.vec2(cx, wTop), p2: k.vec2(cx, wTop + wht), width: 1.5, color: k.rgb(...beam), opacity: 0.7 * ra });
        k.drawLine({ p1: k.vec2(cx - wwd / 2, wTop + wht / 2), p2: k.vec2(cx + wwd / 2, wTop + wht / 2), width: 1.5, color: k.rgb(...beam), opacity: 0.7 * ra });
      }
    }

    function drawBuildingSign(b) {
      if (b.kind !== "house") return;
      const fd = b.faceDown !== false, sx = b.x - b.w * 0.30, sy = b.y + (fd ? b.h / 2 + 62 : -(b.h / 2 + 14));
      k.drawEllipse({ pos: k.vec2(sx, sy + 7), radiusX: 17, radiusY: 5, color: k.rgb(0, 0, 0), opacity: 0.22 });
      k.drawRect({ pos: k.vec2(sx - 3, sy - 30), width: 6, height: 40, radius: 2, color: k.rgb(...WOOD_DK) });
      k.drawRect({ pos: k.vec2(sx - 24, sy - 52), width: 48, height: 32, radius: 4, color: k.rgb(...WOOD) });
      k.drawRect({ pos: k.vec2(sx - 24, sy - 52), width: 48, height: 6, radius: 2, color: k.rgb(...WOOD_LT), opacity: 0.6 });
      k.drawRect({ pos: k.vec2(sx - 24, sy - 52), width: 48, height: 32, radius: 4, fill: false, outline: { width: 2, color: k.rgb(...WOOD_DK) } });
      signIcon(b, sx, sy - 36);
    }
    const SIGN_ICON = { merchant: "shop", healer: "heal", vault: "vault", bestiary: "book", cosmetics: "tailor", market: "market", battlepass: "pass", settings: "cog" };
    function signIcon(b, cx, cy) {
      const name = SIGN_ICON[b.id];
      if (!name) return;
      k.drawCircle({ pos: k.vec2(cx, cy), radius: 12, color: k.rgb(...b.accent), opacity: 0.22 });
      drawIcon(k, name, { x: cx, y: cy, size: 18, color: b.accent, weight: 2.2 });
    }

    function drawHealBeacon(t) {
      if (!injured || !healerB) return;
      const b = healerB, bx = b.x, y = b.y - b.h / 2 - 24 + (reduce ? 0 : Math.sin(t * 2) * 2);
      const pulse = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 3);
      k.drawCircle({ pos: k.vec2(bx, y), radius: 17, color: k.rgb(...HEAL), opacity: 0.16 * pulse });
      k.drawCircle({ pos: k.vec2(bx, y), radius: 10, color: k.rgb(...HEAL), opacity: 0.9 });
      k.drawRect({ pos: k.vec2(bx - 5, y - 1.6), width: 10, height: 3.2, radius: 1, color: k.rgb(255, 255, 255), opacity: 0.95 });
      k.drawRect({ pos: k.vec2(bx - 1.6, y - 5), width: 3.2, height: 10, radius: 1, color: k.rgb(255, 255, 255), opacity: 0.95 });
    }

    function drawKeeperBarks() {
      for (const b of buildings) {
        if (b.kind !== "house" || !b.barks) continue;
        const ra = b.roofA != null ? b.roofA : 1;
        if (ra > 0.82) continue;
        const op = Math.min(1, (0.82 - ra) / 0.55);
        const base = b.barks[b._barkPick || 0] || b.barks[0];
        const txt = (b._barkUntil && k.time() < b._barkUntil) ? b._barkText : base;
        const w = txt.length * 6.4 + 18, by = b.y - 50;
        k.drawRect({ pos: k.vec2(b.x - w / 2, by - 11), width: w, height: 22, radius: 8, color: k.rgb(...THEME.bgAlt), opacity: 0.92 * op, outline: { width: 1.5, color: k.rgb(...b.accent) } });
        k.drawText({ text: txt, pos: k.vec2(b.x, by), anchor: "center", size: 11, font: FONT, color: k.rgb(...THEME.text), opacity: op });
      }
    }

    function drawLabels(t) {
      if (near) {
        const b = near, isCave = b.kind === "cave";
        const by = (isCave ? b.y - 92 : b.y - b.h / 2 - 42) + (reduce ? 0 : Math.sin((t || 0) * 2.2) * 3);
        const pulse = reduce ? 0.7 : 0.45 + 0.55 * (0.5 + 0.5 * Math.sin((t || 0) * 3.2));
        const bIcon = isCave ? "portal" : (SIGN_ICON[b.id] || "flag");
        k.drawCircle({ pos: k.vec2(b.x, by), radius: 30, color: k.rgb(...b.accent), opacity: 0.18 * pulse });
        k.drawCircle({ pos: k.vec2(b.x, by + 2), radius: 20, color: k.rgb(...THEME.bgAlt), opacity: 0.5 });
        k.drawCircle({ pos: k.vec2(b.x, by), radius: 20, color: k.rgb(...THEME.bg), opacity: 0.92, outline: { width: 2, color: k.rgb(...b.accent) } });
        drawIcon(k, bIcon, { x: b.x, y: by, size: 22, color: b.accent, weight: 2.4 });
        if (!TOUCH) {
          k.drawRect({ pos: k.vec2(b.x + 10, by + 8), width: 20, height: 20, radius: 6, color: k.rgb(...THEME.text), opacity: 0.95 });
          k.drawText({ text: "E", pos: k.vec2(b.x + 20, by + 18), anchor: "center", size: 12, font: FONT_BOLD, color: k.rgb(...THEME.textInv) });
        }
      }
    }

    function drawCavePortal(s, t) {
      const x = s.x, y = s.y;
      const rock = [46, 50, 64], rockDk = [28, 31, 42], rockLt = [80, 84, 102];
      const teal = [58, 212, 198], ice = [202, 240, 255];
      const beckon = Math.max(0, Math.min(1, (240 - Math.hypot(me.x - x, me.y - (y + 44))) / 160));
      const spin = reduce ? 0 : t * (1 + beckon * 0.5), pulse = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 2.5);
      k.drawEllipse({ pos: k.vec2(x, y - 4), radiusX: 152, radiusY: 112, color: k.rgb(...rockDk) });
      k.drawEllipse({ pos: k.vec2(x, y - 14), radiusX: 132, radiusY: 96, color: k.rgb(...rock) });
      k.drawEllipse({ pos: k.vec2(x - 68, y - 46), radiusX: 34, radiusY: 24, color: k.rgb(...rockLt), opacity: 0.35 });
      k.drawEllipse({ pos: k.vec2(x + 72, y - 34), radiusX: 28, radiusY: 20, color: k.rgb(...rockDk), opacity: 0.8 });
      k.drawRect({ pos: k.vec2(x - 76, y - 30), width: 18, height: 88, radius: 3, color: k.rgb(...rockLt), opacity: 0.5 });
      k.drawRect({ pos: k.vec2(x + 58, y - 30), width: 18, height: 88, radius: 3, color: k.rgb(...rockLt), opacity: 0.5 });
      k.drawEllipse({ pos: k.vec2(x, y - 34), radiusX: 74, radiusY: 38, color: k.rgb(...rockLt), opacity: 0.3 });
      k.drawRect({ pos: k.vec2(x - 11, y - 64), width: 22, height: 18, radius: 3, color: k.rgb(...rockLt), opacity: 0.6 });
      k.drawEllipse({ pos: k.vec2(x, y + 96), radiusX: 92, radiusY: 30, color: k.rgb(...STONE_DK), opacity: 0.9 });
      k.drawEllipse({ pos: k.vec2(x, y + 94), radiusX: 84, radiusY: 26, color: k.rgb(...STONE) });
      for (const sx of [-50, -17, 17, 50]) k.drawLine({ p1: k.vec2(x + sx * 0.62, y + 72), p2: k.vec2(x + sx, y + 118), width: 1.5, color: k.rgb(...STONE_DK), opacity: 0.45 });
      k.drawEllipse({ pos: k.vec2(x, y + 94), radiusX: 84, radiusY: 26, fill: false, outline: { width: 2, color: k.rgb(...STONE_LT) }, opacity: 0.28 });
      k.drawEllipse({ pos: k.vec2(x, y + 86), radiusX: 60, radiusY: 14, color: k.rgb(...teal), opacity: (0.05 + 0.1 * beckon) * pulse });
      for (const [r, o] of [[80, 0.10], [60, 0.16], [42, 0.22]]) k.drawEllipse({ pos: k.vec2(x, y + 6), radiusX: r * (1 + beckon * 0.12), radiusY: r * 1.15 * (1 + beckon * 0.12), color: k.rgb(...teal), opacity: o * pulse * (1 + beckon * 0.85) });
      k.drawEllipse({ pos: k.vec2(x, y + 6), radiusX: 53, radiusY: 64, color: k.rgb(...ice), opacity: 0.4 + 0.35 * beckon });
      k.drawEllipse({ pos: k.vec2(x, y + 6), radiusX: 50, radiusY: 60, color: k.rgb(5, 8, 12) });
      const starN = reduce ? 10 : 20;
      for (let i = 0; i < starN; i++) {
        const seed = i * 2.3994;
        const ang = seed * 2.0, base = Math.sin(seed * 12.9898) * 0.5 + 0.5;
        const depth = 0.35 + base * 0.65;
        const drift = reduce ? base : (t * (0.05 + depth * 0.07) + base) % 1;
        const rr = (1 - drift) * 0.9;
        const sx = x + Math.cos(ang) * rr * 46, sy = y + 6 + Math.sin(ang) * rr * 56;
        const tw = reduce ? 0.7 : 0.4 + 0.6 * ((Math.sin(t * 3 + seed) + 1) / 2);
        k.drawCircle({ pos: k.vec2(sx, sy), radius: Math.max(0.5, depth * 1.7 * tw),
          color: k.rgb(...(i % 4 ? ice : [150, 235, 255])), opacity: (0.25 + 0.5 * depth) * tw * (0.4 + 0.6 * (1 - drift)) });
      }
      for (let i = 0; i < 5; i++) {
        const rr = 46 - i * 8, a = spin * (1 + i * 0.3), ox = Math.cos(a) * (3 + i), oy = Math.sin(a) * (2 + i * 0.6);
        k.drawEllipse({ pos: k.vec2(x + ox, y + 6 + oy), radiusX: rr, radiusY: rr * 1.18, fill: false, outline: { width: 3, color: k.rgb(...(i % 2 ? teal : ice)) }, opacity: 0.3 + 0.1 * i });
      }
      k.drawEllipse({ pos: k.vec2(x, y + 6), radiusX: 16 * pulse, radiusY: 19 * pulse, color: k.rgb(...teal), opacity: 0.5 + 0.3 * beckon });
      k.drawEllipse({ pos: k.vec2(x, y + 6), radiusX: 9 * pulse, radiusY: 11 * pulse, color: k.rgb(...ice) });
      k.drawCircle({ pos: k.vec2(x, y + 4), radius: 5 * pulse, color: k.rgb(235, 255, 255) });
      if (!reduce) for (let i = 0; i < 8; i++) {
        const a = spin * 1.6 + (i / 8) * Math.PI * 2, px = x + Math.cos(a) * 44, py = y + 6 + Math.sin(a) * 52, nr = (Math.sin(a) + 1) / 2;
        k.drawCircle({ pos: k.vec2(px, py), radius: 1.4 + 2 * nr, color: k.rgb(...ice), opacity: 0.4 + 0.5 * nr });
      }
      if (!reduce) for (let i = 0; i < 5; i++) { const f = (t * 0.5 + i * 0.2) % 1; k.drawCircle({ pos: k.vec2(x + Math.sin(t + i * 2) * 26, y + 40 - f * 50), radius: Math.max(0.5, (1 - f) * 2.4), color: k.rgb(...teal), opacity: 0.5 * (1 - f) }); }
      if (!reduce && beckon > 0.05) {
        const f = (t * 0.45) % 1;
        k.drawEllipse({ pos: k.vec2(x, y + 6), radiusX: 44 + f * 46, radiusY: (44 + f * 46) * 1.16,
          fill: false, outline: { width: 2.5, color: k.rgb(...ice) }, opacity: 0.3 * beckon * (1 - f) });
      }
      for (const tx of [x - 78, x + 78]) {
        const fl = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 7 + tx);
        k.drawRect({ pos: k.vec2(tx - 4, y + 6), width: 8, height: 30, radius: 2, color: k.rgb(...rockDk) });
        k.drawEllipse({ pos: k.vec2(tx, y + 4), radiusX: 9, radiusY: 5, color: k.rgb(...rockLt) });
        k.drawCircle({ pos: k.vec2(tx, y - 4), radius: 12, color: k.rgb(120, 220, 255), opacity: 0.18 * fl });
        k.drawEllipse({ pos: k.vec2(tx, y - 5), radiusX: 4, radiusY: 8, color: k.rgb(...ice), opacity: 0.85 });
      }
    }

    function drawClericKeeper(x, y, t) {
      const robe = [74, 102, 88], robeDk = [46, 66, 58], glow = HEAL;
      const bob = reduce ? 0 : Math.sin(t * 2) * 1.4, yy = y - bob;
      k.drawEllipse({ pos: k.vec2(x, yy + 16), radiusX: 21, radiusY: 30, color: k.rgb(...robe) });
      for (let i = -2; i <= 2; i++) k.drawRect({ pos: k.vec2(x + i * 7 - 3.5, yy + 38), width: 7, height: 7 + (i === 0 ? 4 : 0), radius: 1, color: k.rgb(...robeDk) });
      k.drawEllipse({ pos: k.vec2(x, yy - 4), radiusX: 16, radiusY: 15, color: k.rgb(...robe) });
      k.drawEllipse({ pos: k.vec2(x - 11, yy - 2), radiusX: 3.5, radiusY: 10, color: k.rgb(...glow), opacity: 0.26 });
      k.drawEllipse({ pos: k.vec2(x, yy - 19), radiusX: 12, radiusY: 14, color: k.rgb(...robe) });
      k.drawEllipse({ pos: k.vec2(x, yy - 28), radiusX: 6.5, radiusY: 8, color: k.rgb(...robe) });
      k.drawEllipse({ pos: k.vec2(x, yy - 18), radiusX: 7.5, radiusY: 8.5, color: k.rgb(...robeDk) });
      k.drawCircle({ pos: k.vec2(x - 3, yy - 18), radius: 1.6, color: k.rgb(...glow) });
      k.drawCircle({ pos: k.vec2(x + 3, yy - 18), radius: 1.6, color: k.rgb(...glow) });
      const hy = yy - 38 + (reduce ? 0 : Math.sin(t * 2) * 0.8);
      k.drawCircle({ pos: k.vec2(x, hy), radius: 7, fill: false, outline: { width: 2, color: k.rgb(...glow) }, opacity: 0.75 });
      const vp = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 3);
      k.drawCircle({ pos: k.vec2(x + 13, yy + 8), radius: 9, color: k.rgb(...glow), opacity: 0.22 * vp });
      k.drawRect({ pos: k.vec2(x + 10, yy + 1), width: 6, height: 11, radius: 3, color: k.rgb(...glow), opacity: 0.92 });
      k.drawCircle({ pos: k.vec2(x + 13, yy + 9), radius: 4.5, color: k.rgb(...glow) });
      k.drawRect({ pos: k.vec2(x + 11.5, yy - 3), width: 3, height: 4, color: k.rgb(...STONE_LT) });
    }

    function drawTraderKeeper(x, y, t) {
      const coat = [152, 114, 74], coatDk = [104, 78, 50], skin = [212, 168, 120], amber = THEME.amber;
      const bob = reduce ? 0 : Math.sin(t * 1.8) * 1.1, yy = y - bob;
      k.drawEllipse({ pos: k.vec2(x, yy + 16), radiusX: 25, radiusY: 27, color: k.rgb(...coat) });
      k.drawRect({ pos: k.vec2(x - 22, yy + 17), width: 44, height: 6, color: k.rgb(...coatDk) });
      k.drawCircle({ pos: k.vec2(x + 16, yy + 22), radius: 6, color: k.rgb(...coatDk) });
      k.drawCircle({ pos: k.vec2(x + 16, yy + 22), radius: 3, color: k.rgb(...amber), opacity: 0.9 });
      k.drawEllipse({ pos: k.vec2(x - 19, yy + 6), radiusX: 7, radiusY: 12, color: k.rgb(...coat) });
      k.drawEllipse({ pos: k.vec2(x + 19, yy + 6), radiusX: 7, radiusY: 12, color: k.rgb(...coat) });
      k.drawEllipse({ pos: k.vec2(x, yy - 4), radiusX: 17, radiusY: 13, color: k.rgb(...coat) });
      k.drawEllipse({ pos: k.vec2(x - 12, yy - 2), radiusX: 3.5, radiusY: 8, color: k.rgb(...amber), opacity: 0.25 });
      k.drawCircle({ pos: k.vec2(x, yy - 16), radius: 9, color: k.rgb(...skin) });
      k.drawCircle({ pos: k.vec2(x - 3, yy - 17), radius: 1.5, color: k.rgb(44, 32, 30) });
      k.drawCircle({ pos: k.vec2(x + 3, yy - 17), radius: 1.5, color: k.rgb(44, 32, 30) });
      k.drawEllipse({ pos: k.vec2(x, yy - 12), radiusX: 3, radiusY: 1.4, color: k.rgb(150, 90, 80), opacity: 0.7 });
      k.drawEllipse({ pos: k.vec2(x, yy - 22), radiusX: 18, radiusY: 4.5, color: k.rgb(...coatDk) });
      k.drawEllipse({ pos: k.vec2(x, yy - 27), radiusX: 9, radiusY: 8, color: k.rgb(...coatDk) });
      k.drawRect({ pos: k.vec2(x - 9, yy - 23), width: 18, height: 2.5, color: k.rgb(...amber), opacity: 0.8 });
    }

    function drawGolemKeeper(x, y, t) {
      const rock = [94, 88, 106], rockDk = [60, 56, 74], rockLt = [128, 122, 142], vio = THEME.violet;
      const pulse = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 2), yy = y;
      k.drawEllipse({ pos: k.vec2(x - 27, yy + 8), radiusX: 9, radiusY: 14, color: k.rgb(...rockDk) });
      k.drawEllipse({ pos: k.vec2(x + 27, yy + 8), radiusX: 9, radiusY: 14, color: k.rgb(...rockDk) });
      k.drawEllipse({ pos: k.vec2(x, yy + 8), radiusX: 29, radiusY: 29, color: k.rgb(...rock) });
      k.drawEllipse({ pos: k.vec2(x - 13, yy - 1), radiusX: 8, radiusY: 10, color: k.rgb(...rockLt), opacity: 0.4 });
      k.drawEllipse({ pos: k.vec2(x + 12, yy + 12), radiusX: 9, radiusY: 8, color: k.rgb(...rockDk), opacity: 0.6 });
      k.drawRect({ pos: k.vec2(x - 2, yy - 4), width: 4, height: 22, radius: 1, color: k.rgb(...vio), opacity: 0.3 + 0.25 * pulse });
      k.drawRect({ pos: k.vec2(x - 8, yy + 6), width: 12, height: 3, radius: 1, color: k.rgb(...vio), opacity: 0.25 + 0.2 * pulse });
      k.drawRect({ pos: k.vec2(x - 13, yy - 32), width: 26, height: 22, radius: 5, color: k.rgb(...rock) });
      k.drawRect({ pos: k.vec2(x - 13, yy - 32), width: 26, height: 6, radius: 3, color: k.rgb(...rockLt), opacity: 0.4 });
      k.drawRect({ pos: k.vec2(x - 8.5, yy - 23), width: 6, height: 3.4, radius: 1, color: k.rgb(...vio), opacity: 0.5 + 0.4 * pulse });
      k.drawRect({ pos: k.vec2(x + 2.5, yy - 23), width: 6, height: 3.4, radius: 1, color: k.rgb(...vio), opacity: 0.5 + 0.4 * pulse });
    }
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


    function hubAspect() { const W = k.width(), H = k.height(); return H > W ? Math.max(4 / 3, H / W + 0.01) : 4 / 3; }
    function hubHud() {
      const W = k.width(), H = k.height();
      const lay = playWindowLayout(W, H, { maxAspect: hubAspect() });
      const sq = lay.square, pad = 12;
      const il = ins.left, ir = ins.right, it = ins.top, ib = ins.bottom;
      if (lay.landscape && sq.x >= 120) {
        const gRcx = sq.right + (W - sq.right) / 2;
        return { sq, avR: 20, idMaxW: sq.x - pad - il - 8, hintMaxW: sq.x - 16,
          idX: pad + il, idY: pad + it, curX: pad + il, curY: pad + it + 52, curAnchor: "topleft",
          avX: W - pad - 22 - ir, avY: pad + it + 22,
          promptX: sq.x / 2, promptY: H - ib - 120, hintX: sq.x / 2, hintY: H - ib - 150,
          joyX: sq.x / 2, joyY: H - ib - 84, useX: gRcx, useY: H - ib - 84 };
      }
      if (lay.portrait && sq.y >= 100) {
        const bcy = sq.bottom + (H - sq.bottom) / 2;
        return { sq, avR: 20, idMaxW: sq.cx - pad - il - 16, hintMaxW: W - 24,
          idX: pad + il, idY: pad + it, curX: sq.cx, curY: pad + it + 6, curAnchor: "top",
          avX: W - pad - 22 - ir, avY: pad + it + 22,
          promptX: sq.cx, promptY: sq.bottom + 16, hintX: sq.cx, hintY: H - ib - 14,
          joyX: sq.x + 84 + il, joyY: bcy + 6, useX: W - ir - 56, useY: bcy + 6 };
      }
      const sx = Math.max(sq.x, il), sy = Math.max(sq.y, it), sr = Math.min(sq.right, W - ir), sb = Math.min(sq.bottom, H - ib);
      return { sq, avR: 20, idMaxW: sq.cx - (sx + pad) - 16, hintMaxW: sq.size - 24,
        idX: sx + pad, idY: sy + pad, curX: sq.cx, curY: sy + pad, curAnchor: "top",
        avX: sr - pad - 22, avY: sy + pad + 22,
        promptX: sq.cx, promptY: sb - 40, hintX: sq.cx, hintY: sb - 18,
        joyX: sx + 90, joyY: sb - 90, useX: sr - 70, useY: sb - 70 };
    }

    function drawHud() {
      const L = hubHud();
      const hpW = Math.max(150, L.idMaxW || 200);
      const hpRoom = L.curAnchor === "topleft"
        ? k.height() - L.idY - 12 - ins.bottom
        : Math.max(0, L.sq.y - L.idY - 8);
      drawHubPanel(k, { x: L.idX, y: L.idY, w: hpW, maxH: hpRoom, character, teamHitOut: teamHits });
      const mp = !TOUCH ? k.mousePos() : null;
      const avHover = !overlayOpen && mp && Math.hypot(mp.x - L.avX, mp.y - L.avY) <= L.avR + 6;
      if (!TOUCH) k.setCursor(avHover || popupHover(mp) ? "pointer" : "default");
      if (avHover) k.drawCircle({ pos: k.vec2(L.avX, L.avY), radius: L.avR + 6, color: k.rgb(...accent), opacity: 0.22, fixed: true });
      k.drawCircle({ pos: k.vec2(L.avX, L.avY), radius: L.avR, color: k.rgb(...(authed ? accent : THEME.surfaceAlt)),
        outline: { width: avHover ? 3 : 2, color: k.rgb(...(authed ? accent : THEME.line)) }, fixed: true });
      k.drawText({ text: acctInitial, pos: k.vec2(L.avX, L.avY + 1), anchor: "center", size: 18, font: FONT, color: k.rgb(...(authed ? THEME.bg : THEME.textMut)), fixed: true });
      const chC = k.rgb(...(avHover ? accent : THEME.textMut)), chO = avHover ? 1 : 0.8;
      k.drawLine({ p1: k.vec2(L.avX - 4, L.avY + L.avR + 2), p2: k.vec2(L.avX, L.avY + L.avR + 6), width: 2, color: chC, opacity: chO, fixed: true });
      k.drawLine({ p1: k.vec2(L.avX + 4, L.avY + L.avR + 2), p2: k.vec2(L.avX, L.avY + L.avR + 6), width: 2, color: chC, opacity: chO, fixed: true });
      const online = !!net.state.playerId, pdx = L.avX + L.avR * 0.72, pdy = L.avY + L.avR * 0.72;
      const pPulse = (!online && !reduce) ? (0.55 + 0.45 * Math.sin(k.time() * 4)) : 1;
      k.drawCircle({ pos: k.vec2(pdx, pdy), radius: 6, color: k.rgb(...THEME.bg), fixed: true });
      if (online) k.drawCircle({ pos: k.vec2(pdx, pdy), radius: 4, color: k.rgb(82, 200, 124), fixed: true });
      else k.drawCircle({ pos: k.vec2(pdx, pdy), radius: 4, fill: false, outline: { width: 2, color: k.rgb(...THEME.amber) }, opacity: pPulse, fixed: true });
      if (avHover) {
        const st = online ? "Online" : "Connecting…", sc = online ? [82, 200, 124] : THEME.amber, tw = st.length * 7 + 16, ty = L.avY + L.avR + 22;
        k.drawRect({ pos: k.vec2(L.avX - tw / 2, ty - 9), width: tw, height: 18, radius: 6, color: k.rgb(...THEME.bgAlt), opacity: 0.92, fixed: true });
        k.drawText({ text: st, pos: k.vec2(L.avX, ty), anchor: "center", size: 11, font: FONT, color: k.rgb(...sc), fixed: true });
      }
      if (near) {
        const maxW = L.hintMaxW + 8;
        const STATION_ICON = { cave: "portal", merchant: "shop", healer: "heal", vault: "vault", bestiary: "book", cosmetics: "tailor", market: "market", battlepass: "pass", settings: "cog" };
        const pIcon = STATION_ICON[near.id] || "flag";
        let txt = near.hint.charAt(0).toUpperCase() + near.hint.slice(1), size = 15;
        const mw = (t, sz) => (typeof k.measureText === "function" ? k.measureText(t, sz, FONT_BOLD) : t.length * sz * 0.6);
        const capW = TOUCH ? 0 : 26, icoW = 22;
        let w = icoW + capW + mw(txt, size) + 34;
        while (w > maxW && size > 10) { size--; w = icoW + capW + mw(txt, size) + 34; }
        w = Math.min(w, maxW);
        const px0 = L.promptX - w / 2, py0 = L.promptY - 19;
        drawGlass(k, { rect: [px0, py0, w, 38], radius: 19, tint: 0.72, fill: 0.06, line: 0, fixed: true });
        k.drawRect({ pos: k.vec2(px0 + 0.5, py0 + 0.5), width: w - 1, height: 37, radius: 18.5, color: k.rgb(...near.accent), opacity: 0.8, fill: false, outline: { width: 1.5, color: k.rgb(...near.accent) }, fixed: true });
        let tx = px0 + 14;
        drawIcon(k, pIcon, { x: tx + 8, y: L.promptY, size: 18, color: near.accent, fixed: true });
        tx += icoW + 4;
        if (!TOUCH) {
          k.drawRect({ pos: k.vec2(tx, L.promptY - 10), width: 20, height: 20, radius: 6, color: k.rgb(...THEME.text), opacity: 0.92, fixed: true });
          k.drawText({ text: "E", pos: k.vec2(tx + 10, L.promptY), anchor: "center", size: 12, font: FONT_BOLD, color: k.rgb(...THEME.textInv), fixed: true });
          tx += capW;
        }
        k.drawText({ text: txt, pos: k.vec2(tx + 2, L.promptY), anchor: "left-center", size, font: FONT_BOLD, color: k.rgb(...THEME.text), fixed: true });
      } else {
        const hintOp = (movedTime < 2 ? 1 : Math.max(0, 1 - (movedTime - 2) / 1.5)) * 0.8;
        if (hintOp > 0.02 && !TOUCH && L.hintMaxW >= 120) {
          const cap = (x, y, w, label) => {
            k.drawRect({ pos: k.vec2(x, y), width: w, height: 19, radius: 5, color: k.rgb(...WHITE), opacity: 0.08 * hintOp / 0.8, fixed: true });
            k.drawRect({ pos: k.vec2(x, y), width: w, height: 19, radius: 5, fill: false, outline: { width: 1, color: k.rgb(...WHITE) }, opacity: 0.28 * hintOp / 0.8, fixed: true });
            k.drawRect({ pos: k.vec2(x + 2, y + 17), width: w - 4, height: 1.5, radius: 1, color: k.rgb(...WHITE), opacity: 0.12 * hintOp / 0.8, fixed: true });
            k.drawText({ text: label, pos: k.vec2(x + w / 2, y + 9.5), anchor: "center", size: 10, font: FONT_BOLD, color: k.rgb(...THEME.textBody), opacity: hintOp / 0.8, fixed: true });
          };
          const S = 19, G = 3, x0 = L.hintX - 60, yTop = Math.min(L.hintY - 35, k.height() - 8 - 71);
          cap(x0 + S + G, yTop, S, "W");
          cap(x0, yTop + S + G, S, "A"); cap(x0 + S + G, yTop + S + G, S, "S"); cap(x0 + 2 * (S + G), yTop + S + G, S, "D");
          k.drawText({ text: "Move", pos: k.vec2(x0 + 3 * S + 2 * G + 12, yTop + S + G / 2), anchor: "left-center", size: 12, font: FONT_BOLD, color: k.rgb(...THEME.textMut), opacity: hintOp, fixed: true });
          const yS = yTop + 2 * (S + G) + 8;
          cap(x0, yS, 3 * S + 2 * G, "Shift");
          k.drawText({ text: "Sprint", pos: k.vec2(x0 + 3 * S + 2 * G + 12, yS + S / 2), anchor: "left-center", size: 12, font: FONT_BOLD, color: k.rgb(...THEME.textMut), opacity: hintOp, fixed: true });
        } else if (hintOp > 0.02) {
          const hint = TOUCH ? "drag to move (push to sprint)" : "WASD / arrows to move (Shift to sprint)";
          const est = (s, sz) => s.length * sz * 0.56;
          const lines = est(hint, 12) > L.hintMaxW ? hint.replace(" (", "\n(").split("\n") : [hint];
          for (let li = 0; li < lines.length; li++) {
            const sz = Math.min(12, Math.max(9, Math.floor(L.hintMaxW / (lines[li].length * 0.56))));
            k.drawText({ text: lines[li], pos: k.vec2(L.hintX, L.hintY + (li - (lines.length - 1) / 2) * 15), anchor: "center", size: sz, font: FONT, color: k.rgb(...THEME.textMut), opacity: hintOp, fixed: true });
          }
        }
      }
    }

    function isHurt(m) {
      try {
        const st = getMonsterStats(getMonsterType(m.typeName), m.level);
        return (m.currentHealth ?? st.health) < st.health || (m.currentEnergy ?? st.energy) < st.energy || !!m.status;
      } catch { return false; }
    }
    function teamInjured() { return (prof().activeMonsters || []).some(isHurt); }
    function healNow() {
      if (!teamInjured()) { toast("Team already at full health"); return; }
      injured = false; injuredCheck = k.time();
      if (net.state.playerId) {
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
    function triggerHealBurst() { healFx = k.time() + 1.3; healFxX = me.x; healFxY = me.y; }
    function clericThanks() { if (healerB) { healerB._barkText = "Rest easy now, tamer."; healerB._barkUntil = k.time() + 3.5; } }
    function drawHealBurst(t) {
      if (!healFx || t > healFx) return;
      const f = (1.3 - (healFx - t)) / 1.3;
      const x = healFxX, y = healFxY, fade = 1 - f;
      k.drawCircle({ pos: k.vec2(x, y - 6), radius: 20 + f * 10, color: k.rgb(...HEAL), opacity: 0.16 * fade });
      const rr = 10 + f * 34;
      k.drawEllipse({ pos: k.vec2(x, y + 8), radiusX: rr, radiusY: rr * 0.5, fill: false, outline: { width: 3, color: k.rgb(...HEAL) }, opacity: 0.5 * fade });
      if (reduce) return;
      for (let i = 0; i < 7; i++) {
        const lf = (f + i * 0.06) % 1, op = 0.85 * (1 - lf), sz = 2 + (1 - lf) * 2;
        const mx = x + Math.cos(i * 1.7) * (7 + i * 3), my = y + 8 - lf * 46;
        k.drawRect({ pos: k.vec2(mx - sz, my - 0.8), width: sz * 2, height: 1.6, color: k.rgb(...HEAL), opacity: op });
        k.drawRect({ pos: k.vec2(mx - 0.8, my - sz), width: 1.6, height: sz * 2, color: k.rgb(...HEAL), opacity: op });
      }
    }

    let toastMsg = "", toastUntil = 0;
    function toast(msg) { toastMsg = msg; toastUntil = k.time() + 1.8; }
    k.onDraw(() => {
      if (overlayOpen || !toastMsg || k.time() > toastUntil) return;
      const op = Math.min(1, (toastUntil - k.time()) / 0.4);
      const w = toastMsg.length * 9 + 28, cx = k.width() / 2, y = 70;
      k.drawRect({ pos: k.vec2(cx - w / 2, y - 15), width: w, height: 30, radius: 8, color: k.rgb(...THEME.surface2), opacity: 0.95 * op, fixed: true });
      k.drawText({ text: toastMsg, pos: k.vec2(cx, y), anchor: "center", size: 14, font: FONT, color: k.rgb(...THEME.text), opacity: op, fixed: true });
    });

    k.onDraw(() => {
      if (overlayOpen || !welcomeShow) return;
      if (stationPopup) return;
      if (welcomeStart < 0) welcomeStart = k.time();
      const age = k.time() - welcomeStart;
      if (age > 7) { welcomeShow = false; return; }
      const op = Math.max(0, Math.min(1, age / 0.4, (7 - age) / 0.7));
      if (op <= 0.01) return;
      const sq = playWindowLayout(k.width(), k.height(), { maxAspect: hubAspect() }).square;
      const cx = sq.cx, y = sq.y + (k.width() < 560 ? 200 : 54), w = Math.min(sq.size - 24, 380);
      k.drawRect({ pos: k.vec2(cx - w / 2, y - 34), width: w, height: 68, radius: 18, color: k.rgb(...THEME.bg), opacity: 0.72 * op, fixed: true });
      k.drawRect({ pos: k.vec2(cx - w / 2, y - 34), width: w, height: 68, radius: 18, color: k.rgb(255, 255, 255), opacity: 0.05 * op, fixed: true });
      k.drawRect({ pos: k.vec2(cx - w / 2 + 0.5, y - 33.5), width: w - 1, height: 67, radius: 17.5, color: k.rgb(255, 255, 255), opacity: 0.14 * op, fill: false, outline: { width: 1, color: k.rgb(255, 255, 255) }, fixed: true });
      drawEyebrow(k, { x: cx, y: y - 22, text: "Welcome home", size: 10, color: THEME.primary, anchor: "center", opacity: op, fixed: true });
      k.drawText({ text: "Welcome to the village, tamer", pos: k.vec2(cx, y - 2), anchor: "center", size: 15, font: FONT_BOLD, color: k.rgb(...THEME.text), opacity: op, fixed: true });
      k.drawText({ text: "Talk to the keepers, then enter the glowing cave to run", pos: k.vec2(cx, y + 17), anchor: "center", size: 11, font: FONT, color: k.rgb(...THEME.textMut), opacity: op, fixed: true });
    });

    let evolveShownAt = 0, evolveStart = -1;
    k.onDraw(() => {
      if (overlayOpen) return;
      const ev = net.state.evolved;
      if (!ev || !ev.events || !ev.events.length) return;
      if (ev.at !== evolveShownAt) { evolveShownAt = ev.at; evolveStart = k.time(); }
      const age = k.time() - evolveStart;
      if (evolveStart < 0 || age > 6) return;
      const op = Math.max(0, Math.min(1, age / 0.4, (6 - age) / 0.7));
      if (op <= 0.01) return;
      const e0 = ev.events[0];
      const line = ev.events.length > 1 ? `${ev.events.length} monsters evolved!` : `${e0.fromName} evolved into ${e0.toName}!`;
      const sq = playWindowLayout(k.width(), k.height(), { maxAspect: hubAspect() }).square;
      const cx = sq.cx, y = sq.y + 56, w = Math.min(sq.size - 24, 400);
      k.drawRect({ pos: k.vec2(cx - w / 2, y - 28), width: w, height: 56, radius: 12, color: k.rgb(...THEME.bgAlt), opacity: 0.92 * op, outline: { width: 2, color: k.rgb(...THEME.amber) }, fixed: true });
      k.drawText({ text: "Evolution!", pos: k.vec2(cx, y - 8), anchor: "center", size: 13, font: FONT, color: k.rgb(...THEME.amber), opacity: op, fixed: true });
      k.drawText({ text: line, pos: k.vec2(cx, y + 11), anchor: "center", size: 12, font: FONT, color: k.rgb(...THEME.text), opacity: op, width: w - 20, align: "center", fixed: true });
    });

    const netOffs = [];
    let leaving = false;
    let overlayOpen = false;
    let connectingFx = false;
    let connectInfo = null;
    const connectLayout = () => { const W = k.width(), H = k.height(), w = Math.min(420, W - 32), h = 250, x = (W - w) / 2, y = H / 2 - h / 2; return { x, y, w, h, btnY: y + h - 44 }; };
    let acctPanelRect = null;
    let detailMon = null;
    const teamHits = [];
    let stationPopup = null;
    let popupPressing = false, popupLastY = 0, popupMoved = 0;
    let popupOpenedT = -1;
    let popupToast = "", popupToastT = 0, popupShopOff = null;
    const popupShowToast = (s) => { popupToast = s; popupToastT = 2.0; };
    function caughtSet() {
      const s = new Set();
      for (const m of [...(net.state.team || []), ...(net.state.vault || [])]) s.add(String(m.typeName || "").toLowerCase());
      return s.size ? s : null;
    }
    function openStationPopup(id) {
      if (overlayOpen || detailMon || stationPopup) return;
      sfx("ui"); popupPressing = false; popupToastT = 0; popupOpenedT = k.time(); if (k.requestFrost) k.requestFrost();
      if (id === "bestiary") stationPopup = { id, title: "Bestiary", state: bestiaryPanelState(caughtSet()), draw: drawBestiaryPanel, tap: bestiaryPanelTap, scroll: bestiaryPanelScroll, focusables: bestiaryPanelFocusables, hasDetail: true };
      else if (id === "shop") {
        stationPopup = { id, title: "Spirit Shop", state: shopPanelState(), draw: drawShopPanel, tap: shopPanelTap, scroll: shopPanelScroll, focusables: shopPanelFocusables, hasDetail: false };
        const offShop = net.on("shop", (m) => popupShowToast(m.ok ? "Done!" : m.locked ? "Locked during a run." : m.reason === "essence" ? "Not enough essence." : m.reason === "maxed" ? "Already max tier." : m.reason === "owned" ? "You don't own that chain." : "Not enough gold."));
        const offUpg = net.on("upgrades", (m) => popupShowToast(m.ok ? "Upgraded!" : m.locked ? "Locked during a run." : m.reason === "maxed" ? "Already maxed." : "Not enough gold."));
        popupShopOff = () => { try { offShop && offShop(); } catch {} try { offUpg && offUpg(); } catch {} };
      }
      else if (id === "cosmetics") {
        stationPopup = { id, title: "Cosmetics", state: cosmeticsPanelState(), draw: drawCosmeticsPanel, tap: cosmeticsPanelTap, scroll: cosmeticsPanelScroll, focusables: cosmeticsPanelFocusables, hasDetail: false };
        popupShopOff = net.on("cosmetic", (m) => popupShowToast(m.ok ? "Purchased!" : m.reason === "essence" ? "Not enough essence." : m.reason === "gold" ? "Not enough gold." : m.reason === "owned" ? "Already owned." : "Can't buy that."));
      }
      else if (id === "battlepass") {
        stationPopup = { id, title: "Battle Pass", state: battlePassPanelState(), draw: drawBattlePassPanel, tap: battlePassPanelTap, scroll: battlePassPanelScroll, hasDetail: false };
        popupShopOff = net.on("bp", (m) => popupShowToast(m.ok ? "Claimed!" : m.reason === "no-entitlement" ? "Premium needs a subscription." : m.reason === "claimed" ? "Already claimed." : m.reason === "locked-tier" ? "Tier not reached yet." : "Couldn't claim."));
      }
      else if (id === "settings") {
        stationPopup = { id, title: "Settings", state: settingsPanelState(), draw: drawSettingsPanel, tap: settingsPanelTap, scroll: settingsPanelScroll, focusables: settingsPanelFocusables, hasDetail: false };
      }
      else if (id === "profile") {
        stationPopup = { id, title: "Profile", state: profilePanelState(characterId), draw: drawProfilePanel, tap: profilePanelTap, scroll: profilePanelScroll, focusables: profilePanelFocusables, hasDetail: false, hasModal: true, modal: drawProfileModal };
      }
      else if (id === "portal") {
        stationPopup = { id, title: "Enter a Run", state: { focus: (prof().activeMonsters || []).length > 0 ? 0 : 1 }, draw: drawPortalPanel, tap: portalPanelTap, scroll: () => {}, hasDetail: false };
      }
      else if (id === "vault") {
        const st = rosterPanelState();
        stationPopup = { id, title: "Vault", state: st, draw: drawRosterPanel, tap: rosterPanelTap, scroll: rosterPanelScroll, focusables: rosterPanelFocusables, modalFocusables: rosterModalFocusables, hasDetail: false, hasModal: true, modal: drawRosterModal };
        st._lastReleaseAt = net.state.lastRelease?.at || 0;
        popupShopOff = net.on("roster", () => {
          st.reconcile();
          const lr = net.state.lastRelease;
          if (lr && lr.at && lr.at !== st._lastReleaseAt) {
            st._lastReleaseAt = lr.at;
            popupShowToast(lr.ok && lr.reward ? `Released   +${lr.reward.gold}g` : lr.locked ? "Can't release during a run." : lr.reason === "last-monster" ? "You need at least one monster." : "Couldn't release that monster.");
          }
        });
        net.getRoster();
      }
      else if (id === "market") {
        stationPopup = { id, title: "Marketplace", state: marketplacePanelState(), draw: drawMarketplacePanel, tap: marketplacePanelTap, scroll: marketplacePanelScroll, focusables: marketplacePanelFocusables, hasDetail: false };
        net.getRoster();
      }
    }
    let popupClosing = null;
    function closeStationPopup() { if (!stationPopup) return; sfx("back"); if (stationPopup.state && stationPopup.state.dispose) stationPopup.state.dispose(); popupClosing = { popup: stationPopup, t0: k.time() }; stationPopup = null; popupPressing = false; popupToastT = 0; if (popupShopOff) { popupShopOff(); popupShopOff = null; } }
    function popupHover(mp) {
      if (!stationPopup || !mp) return false;
      if (inRect(mp, stationCloseRect(k))) return true;
      if (stationPopup.id === "portal") { const L = portalLayout(stationContentRect(k)); return inRect(mp, L.sp) || inRect(mp, L.mp) || inRect(mp, L.adv); }
      if (stationPopup.hasDetail && stationPopup.state.selected) return false;
      if (stationPopup.hasModal && (stationPopup.state.modalCapturesInput || stationPopup.state.renaming)) {
        const mf = stationPopup.modalFocusables ? stationPopup.modalFocusables(k, stationPopup.state) : [];
        return mf.some((f) => inRect(mp, f.rect));
      }
      if (!stationPopup.focusables) return false;
      const cr = stationContentRect(k);
      if (!inRect(mp, cr)) return false;
      try { return stationPopup.focusables(cr, stationPopup.state).some((f) => inRect(mp, f.rect)); } catch { return false; }
    }
    const POPUP_EYEBROW = { bestiary: "Monster archive", shop: "The merchant", vault: "Team and inventory", cosmetics: "The tailor", battlepass: "This season", settings: "Preferences", profile: "Your account", portal: "Leave the village", market: "Trade with tamers" };
    const POPUP_ICON = { bestiary: "book", shop: "shop", vault: "vault", cosmetics: "tailor", battlepass: "pass", settings: "cog", profile: "person", portal: "portal", market: "market" };
    const POPUP_ACCENT = { bestiary: THEME.water, shop: THEME.amber, vault: THEME.violet, cosmetics: THEME.psychic, battlepass: THEME.light, settings: THEME.neutral, profile: THEME.primary, portal: [58, 212, 198], market: THEME.success };
    function drawStationPopupHub() {
      if (!stationPopup && popupClosing) {
        const { popup, t0 } = popupClosing;
        if (k.time() - t0 > 0.16) { popupClosing = null; return; }
        drawStationPopup(k, { title: popup.title, eyebrow: POPUP_EYEBROW[popup.id] || "Village", icon: POPUP_ICON[popup.id], accent: POPUP_ACCENT[popup.id], openedT: null, closeT: t0, content: (kk, rect) => popup.draw(kk, rect, popup.state) });
        return;
      }
      if (!stationPopup) return;
      drawStationPopup(k, { title: stationPopup.title, eyebrow: POPUP_EYEBROW[stationPopup.id] || "Village", icon: POPUP_ICON[stationPopup.id], accent: POPUP_ACCENT[stationPopup.id], pointer: k.mousePos(), openedT: popupOpenedT, content: (kk, rect) => stationPopup.draw(kk, rect, stationPopup.state) });
      if (stationPopup.focusables && stationPopup.state.focus != null && gamepadConnected()) {
        const foc = stationPopup.focusables(stationContentRect(k), stationPopup.state);
        const it = foc[stationPopup.state.focus];
        if (it) { const r = it.rect; k.drawRect({ pos: k.vec2(r[0] - 4, r[1] - 4), width: r[2] + 8, height: r[3] + 8, radius: 10, fill: false, outline: { width: 3, color: k.rgb(...THEME.primary) }, fixed: true }); }
      }
      if (stationPopup.hasDetail && stationPopup.state.selected) drawMonsterDetail(k, stationPopup.state.selected, { scrim: true });
      if (stationPopup.hasModal && stationPopup.modal) stationPopup.modal(k, stationPopup.state);
      if (stationPopup.modalFocusables && (stationPopup.state.modalCapturesInput || stationPopup.state.renaming) && stationPopup.state.modalFocus != null && gamepadConnected()) {
        const mf = stationPopup.modalFocusables(k, stationPopup.state), it = mf[stationPopup.state.modalFocus];
        if (it) { const r = it.rect; k.drawRect({ pos: k.vec2(r[0] - 4, r[1] - 4), width: r[2] + 8, height: r[3] + 8, radius: 10, fill: false, outline: { width: 3, color: k.rgb(...THEME.primary) }, fixed: true }); }
      }
      if (popupToastT > 0) { popupToastT -= k.dt(); drawToast(k, { text: popupToast, t: popupToastT }); }
    }
    function popupTap(p) {
      if (stationPopup.hasModal && (stationPopup.state.renaming || stationPopup.state.modalCapturesInput)) { stationPopup.tap(k, stationContentRect(k), stationPopup.state, p, popupShowToast); return; }
      if (stationPopup.hasDetail && stationPopup.state.selected) { stationPopup.state.selected = null; return; }
      if (inRect(p, stationCloseRect(k)) || !stationPopupInside(k, p)) { closeStationPopup(); return; }
      stationPopup.tap(k, stationContentRect(k), stationPopup.state, p, popupShowToast);
    }
    function popupMove(p) { if (!popupPressing) return; const dy = popupLastY - p.y; popupMoved += Math.abs(dy); popupLastY = p.y; if (!(stationPopup.hasDetail && stationPopup.state.selected)) stationPopup.scroll(stationPopup.state, dy); }
    function popupUp(p) { if (!popupPressing) return; popupPressing = false; if (popupMoved < 6) popupTap(p); }
    let connectTimer = null;
    const cancelConnectTimer = () => { if (connectTimer) { connectTimer.cancel(); connectTimer = null; } };
    function clearNet() { netOffs.forEach((off) => off && off()); netOffs.length = 0; }
    function closeOverlay() { cancelConnectTimer(); clearNet(); k.destroyAll("overlay"); overlayOpen = false; navItems = null; connectingFx = false; connectInfo = null; menuKeepsWorld = false; acctPanelRect = null; }

    k.onDraw(() => {
      if (!connectingFx || !overlayOpen) return;
      const t = k.time(), cx = k.width() / 2;
      const teal = [58, 212, 198], ice = [202, 240, 255];
      const spin = reduce ? 0 : t, pulse = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 2.5);
      const ci = connectInfo, L = connectLayout();
      const age = ci ? Math.max(0, t - ci.t0) : 1, ep = Math.min(1, age / 0.25), e = 1 - (1 - ep) * (1 - ep);
      const sy = L.y + (1 - e) * 14;
      let headline = "Opening the rift";
      if (ci) {
        headline = ci.pct != null ? "Shaping the world" : /queue/i.test(ci.status) ? "Waiting for tamers" : /Couldn|error|Disconnected|Failed/i.test(ci.status) ? "Something went wrong" : "Opening the rift";
        drawGlassSheet(k, { rect: [L.x, sy, L.w, L.h], radius: 24, opacity: e, accent: ci.accent });
        drawIconTab(k, { x: L.x + L.w / 2 - 26, y: sy - 26, size: 52, icon: "portal", accent: ci.accent, opacity: e, fixed: true });
        drawEyebrow(k, { x: cx, y: sy + 40, text: ci.title, size: 11, color: ci.accent, anchor: "center", opacity: e, fixed: true });
        k.drawText({ text: headline, pos: k.vec2(cx + 16, sy + 68), size: 24, font: FONT_BOLD, anchor: "center", color: k.rgb(...THEME.text), opacity: e, fixed: true });
        k.drawText({ text: ci.status, pos: k.vec2(cx, sy + 104), size: 13, font: FONT, anchor: "center", width: L.w - 60, align: "center", color: k.rgb(...THEME.textBody), opacity: e, fixed: true });
        const mx = L.x + 40, mw = L.w - 80, myy = sy + 150;
        k.drawRect({ pos: k.vec2(mx, myy), width: mw, height: 6, radius: 3, color: k.rgb(255, 255, 255), opacity: 0.1 * e, fixed: true });
        if (ci.pct != null) k.drawRect({ pos: k.vec2(mx, myy), width: Math.max(6, mw * ci.pct), height: 6, radius: 3, color: k.rgb(...ci.accent), opacity: e, fixed: true });
        else { const sw = mw * 0.28, sp = reduce ? 0.36 : ((t * 0.45) % 1); const sx0 = mx + (mw + sw) * sp - sw; const vx = Math.max(mx, sx0), vw = Math.max(0, Math.min(mx + mw, sx0 + sw) - vx);
          if (vw > 0) k.drawRect({ pos: k.vec2(vx, myy), width: vw, height: 6, radius: 3, color: k.rgb(...ci.accent), opacity: 0.9 * e, fixed: true }); }
      }
      const hw = typeof k.measureText === "function" ? k.measureText(headline, 24, FONT_BOLD) : 190;
      const vcx = cx + 16 - hw / 2 - 24, vy = sy + 68;
      for (const [r, o] of [[18, 0.12], [12, 0.18]]) k.drawCircle({ pos: k.vec2(vcx, vy), radius: r, color: k.rgb(...teal), opacity: o * pulse, fixed: true });
      for (let i = 0; i < 3; i++) { const rr = 11 - i * 2.6, a = spin * (1 + i * 0.4); k.drawEllipse({ pos: k.vec2(vcx + Math.cos(a) * (1.5 + i), vy + Math.sin(a) * (1 + i * 0.4)), radiusX: rr, radiusY: rr * 1.1, fill: false, outline: { width: 2, color: k.rgb(...(i % 2 ? teal : ice)) }, opacity: 0.35 + 0.1 * i, fixed: true }); }
      k.drawCircle({ pos: k.vec2(vcx, vy), radius: 4 * pulse, color: k.rgb(...ice), fixed: true });
      k.drawCircle({ pos: k.vec2(vcx, vy), radius: 2 * pulse, color: k.rgb(235, 255, 255), fixed: true });
    });

    function setNav(items) {
      navItems = items && items.length ? items : null;
      navIdx = 0;
      if (navItems) { while (navIdx < navItems.length && navItems[navIdx].disabled) navIdx++; if (navIdx >= navItems.length) navIdx = 0; }
    }
    function navMove(d) {
      if (stationPopup) { if (stationPopup.id === "portal") { const f = Math.max(0, Math.min(2, (stationPopup.state.focus || 0) + (d < 0 ? -1 : 1))); if (stationPopup.state.focus !== f) { stationPopup.state.focus = f; sfx("hover"); } } return; }
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

    function dim() {
      k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.anchor("topleft"), k.color(0, 0, 0), k.opacity(0.5), k.fixed(), "overlay"]);
    }
    const cw = (cap) => Math.min(cap, k.width() - 32);

    function portalLayout(rect) {
      const [rx, ry, rw, rh] = rect;
      const wide = rw >= 600;
      if (wide) {
        const gap = 14, cw = Math.min(260, (rw - gap * 2) / 3), ch = Math.min(rh - 70, 300), x0 = rx + (rw - (cw * 3 + gap * 2)) / 2, y0 = ry + 48;
        return { wide, sp: [x0, y0, cw, ch], mp: [x0 + cw + gap, y0, cw, ch], adv: [x0 + (cw + gap) * 2, y0, cw, ch] };
      }
      const cw = Math.min(rw - 8, 460), x0 = rx + (rw - cw) / 2, ch = 86, gap = 10, y0 = ry + 44;
      return { wide, sp: [x0, y0, cw, ch], mp: [x0, y0 + ch + gap, cw, ch], adv: [x0, y0 + (ch + gap) * 2, cw, ch] };
    }
    const PORTAL_CARDS = [
      { key: "sp", title: "Singleplayer", desc: "A solo run with your saved team. Reach a portal to extract and keep what you caught.", accent: THEME.primary, risk: "Team at risk", needsTeam: true },
      { key: "mp", title: "Multiplayer", desc: "Live extraction against other tamers. The storm closes in and the portals are shared.", accent: THEME.violet, risk: "Team at risk", needsTeam: false },
      { key: "adv", title: "Adventure", desc: "An endless journey across regions. No storm, no clock, and your team always comes home.", accent: THEME.amber, risk: "Team safe", needsTeam: true },
    ];
    function portalHasMonsters() { return (prof().activeMonsters || []).length > 0; }
    function drawPortalPanel(kk, rect, state) {
      const [rx, ry, rw] = rect;
      const T = (n) => kk.rgb(...THEME[n]);
      const teamN = (prof().activeMonsters || []).length, has = teamN > 0;
      const L = portalLayout(rect), mp = kk.mousePos();
      const intro = has ? `Your team of ${teamN} is ready. Choose how to leave the village.` : "No monsters on your team yet. Visit the Vault first, or try Multiplayer.";
      kk.drawText({ text: intro, pos: kk.vec2(rx + 2, ry + 10), size: 13, font: FONT, color: T(has ? "textBody" : "warn"), width: rw - 8, fixed: true });
      PORTAL_CARDS.forEach((card, i) => {
        const r0 = L[card.key];
        const r = [r0[0], r0[1] + sheetEntrance(kk, i, { step: 0.06, from: 18 }), r0[2], r0[3]], [x, y, w, h] = r;
        const enabled = !card.needsTeam || has;
        const hot = enabled && (inRect(mp, r0) || state.focus === i);
        const op = enabled ? 1 : 0.45;
        drawGlass(kk, { rect: r, radius: 20, fill: hot ? 0.09 : 0.045, line: hot ? 0 : 0.1, tint: 0.22, fixed: true });
        kk.drawRect({ pos: kk.vec2(x + 1, y + 1), width: w - 2, height: h - 2, radius: 19, color: kk.rgb(...card.accent), opacity: op,
          gradient: { dir: "radial", cx: L.wide ? 0.5 : 0.12, cy: L.wide ? 0.3 : 0.5, r: Math.max(w, h) * (L.wide ? 0.6 : 0.45), stops: [[0, card.accent, hot ? 0.3 : 0.18], [0.6, card.accent, 0.04], [1, card.accent, 0]] }, fixed: true });
        if (hot) kk.drawRect({ pos: kk.vec2(x + 1, y + 1), width: w - 2, height: h - 2, radius: 19, color: kk.rgb(...card.accent), fill: false, outline: { width: 2, color: kk.rgb(...card.accent) }, fixed: true });
        const modeIcon = card.key === "sp" ? "solo" : card.key === "mp" ? "multi" : "journey";
        if (L.wide) {
          kk.drawCircle({ pos: kk.vec2(x + w / 2, y + 66), radius: 34, color: kk.rgb(...card.accent), opacity: 0.14 * op, fixed: true });
          kk.drawCircle({ pos: kk.vec2(x + w / 2, y + 66), radius: 34, color: kk.rgb(...card.accent), opacity: 0.5 * op, fill: false, outline: { width: 1.5, color: kk.rgb(...card.accent) }, fixed: true });
          drawIcon(kk, modeIcon, { x: x + w / 2, y: y + 66, size: 36, color: card.accent, opacity: op, fixed: true });
          kk.drawText({ text: card.title, pos: kk.vec2(x + w / 2, y + 118), size: 22, font: FONT_BOLD, anchor: "center", color: T("text"), opacity: op, fixed: true });
          kk.drawText({ text: card.desc, pos: kk.vec2(x + w / 2, y + 148), size: 12, font: FONT, anchor: "center", width: w - 36, align: "center", color: T("textBody"), opacity: op, fixed: true });
          drawChip(kk, { x: x + w / 2, y: y + h - 62, text: card.risk, color: card.key === "adv" ? THEME.success : THEME.textMut, size: 10, h: 20, padX: 9, anchor: "center", fixed: true });
          drawButton(kk, { rect: [x + 18, y + h - 42, w - 36, 34], text: enabled ? "Enter" : "Needs a team", size: 13, radius: 12, fill: hot ? card.accent : THEME.surfaceAlt, textColor: hot ? THEME.textInv : THEME.text, disabled: !enabled, hover: hot, fixed: true });
        } else {
          kk.drawCircle({ pos: kk.vec2(x + 40, y + h / 2), radius: 24, color: kk.rgb(...card.accent), opacity: 0.14 * op, fixed: true });
          drawIcon(kk, modeIcon, { x: x + 40, y: y + h / 2, size: 26, color: card.accent, opacity: op, fixed: true });
          kk.drawText({ text: card.title, pos: kk.vec2(x + 78, y + 16), size: 18, font: FONT_BOLD, color: T("text"), opacity: op, fixed: true });
          kk.drawText({ text: card.desc, pos: kk.vec2(x + 78, y + 42), size: 11, font: FONT, width: w - 170, color: T("textBody"), opacity: op, fixed: true });
          drawChip(kk, { x: x + w - 12, y: y + 14, text: enabled ? card.risk : "Needs team", color: card.key === "adv" ? THEME.success : THEME.textMut, size: 9, h: 18, padX: 8, anchor: "right", fixed: true });
        }
      });
      if (!TOUCH) kk.drawText({ text: L.wide ? "Arrow keys to choose, Enter to go, Esc to close" : "Enter to go, Esc to close", pos: kk.vec2(rx + rw / 2, L.adv[1] + L.adv[3] + 14), size: 11, font: FONT, color: T("textMut"), anchor: "center", fixed: true });
    }
    const PORTAL_MODES = ["solo", "multi", "adventure"];
    function portalActivate() {
      if (!stationPopup || stationPopup.id !== "portal") return;
      const mode = PORTAL_MODES[stationPopup.state.focus] || "multi";
      if (mode !== "multi" && !portalHasMonsters()) { popupShowToast("No monsters — visit the Vault first"); return; }
      closeStationPopup(); startServerRun(mode);
    }
    function portalPanelTap(kk, rect, state, p, showToast) {
      const L = portalLayout(rect);
      const needTeam = () => { if (!portalHasMonsters()) { showToast && showToast("No monsters — visit the Vault first"); return false; } return true; };
      if (inRect(p, L.sp)) { if (!needTeam()) return true; closeStationPopup(); startServerRun("solo"); return true; }
      if (inRect(p, L.mp)) { closeStationPopup(); startServerRun("multi"); return true; }
      if (inRect(p, L.adv)) { if (!needTeam()) return true; closeStationPopup(); startServerRun("adventure"); return true; }
      return false;
    }

    function startServerRun(modeArg) {
      const mode = modeArg === true ? "solo" : modeArg === false ? "multi" : (modeArg || "multi");
      const solo = mode !== "multi";
      k.destroyAll("overlay");
      overlayOpen = true;
      connectingFx = true;
      dim();
      const cx = k.width() / 2;
      connectInfo = { mode, title: mode === "adventure" ? "Adventure" : solo ? "Singleplayer" : "Multiplayer", status: solo ? "Starting your run…" : "Connecting…", t0: k.time(), pct: null,
        accent: mode === "adventure" ? THEME.amber : solo ? THEME.primary : THEME.violet };
      if (k.requestFrost) k.requestFrost();
      const setStatus = (sx) => { if (!connectInfo) return; connectInfo.status = sx; const mm = /(\d+)%/.exec(sx); connectInfo.pct = mm ? Number(mm[1]) / 100 : null; };
      const CB = connectLayout();
      addButton(k, { x: cx, y: CB.btnY, w: cw(200), h: 42, text: "Cancel", size: 15, radius: 14, z: OVERLAY_Z,
        fill: THEME.surfaceAlt, textColor: THEME.text, fixed: true, tag: "overlay",
        onClick: () => { try { net.unqueue(); } catch {} closeOverlay(); } });
      setNav([{ x: cx, y: CB.btnY, w: cw(200), h: 42, action: () => { try { net.unqueue(); } catch {} closeOverlay(); } }]);

      clearNet();
      const enterQueue = () => { try { if (mode === "adventure") net.queueSolo("adventure"); else if (solo) net.queueSolo(); else net.queue(); } catch {} };
      cancelConnectTimer();
      connectTimer = k.wait(14, () => { connectTimer = null; if (overlayOpen && !net.state.connected) setStatus("Couldn't reach the server — it may be waking up. Cancel and retry."); });
      netOffs.push(
        net.on("open", () => { cancelConnectTimer(); setStatus(solo ? "Connected. Preparing…" : "Connected. Joining…"); net.join(nick()); }),
        net.on("welcome", () => { setStatus(solo ? "Starting your run…" : "Joined. Entering queue…"); enterQueue(); }),
        net.on("queued", (m) => setStatus(`In queue (#${m?.position ?? "?"}). Starting shortly, other tamers can still join.`)),
        net.on("matchFound", () => setStatus(solo ? "Generating your world…" : "Match found! Generating the world…")),
        net.on("roundStart", () => {
          clearNet();
          setStatus("Generating world…");
          generateMap((p) => setStatus(`Generating world… ${Math.round(p * 100)}%`), net.state.seed, net.state.roundBiomes, net.state.roundComp) // Must use the server's seed/biomes/comp or the client map diverges.
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

    function openAcctMenu() {
      if (overlayOpen) { sfx("back"); closeOverlay(); return; }
      sfx("ui");
      overlayOpen = true;
      menuKeepsWorld = true;
      k.destroyAll("overlay");
      const more = [
        { label: "How to Play", go: () => { try { window.open("/guide", "_blank", "noopener"); } catch {} } },
        { label: "Bestiary", go: () => { closeOverlay(); openStationPopup("bestiary"); } },
        { label: "Cosmetics", go: () => { closeOverlay(); openStationPopup("cosmetics"); } },
        { label: "Get Essence", go: () => { try { window.open("/pricing", "_blank", "noopener"); } catch {} } },
        { label: "Battle Pass", go: () => openStationPopup("battlepass") },
        { label: "Marketplace", go: () => { closeOverlay(); openStationPopup("market"); } },
      ];
      const muteItem = { label: isMuted() ? "Unmute sound" : "Mute sound", go: () => { toggleMuted(); closeOverlay(); } };
      const items = authed ? [
        { label: "View Profile", go: () => { closeOverlay(); openStationPopup("profile"); } },
        ...more,
        { label: "Account", go: () => k.go("account", { backScene: "hub", backArgs: { characterId } }) },
        muteItem,
        { label: "Settings", go: () => { closeOverlay(); openStationPopup("settings"); } },
        { label: "Switch Character", go: () => k.go("characterSelect") },
        { label: "Sign out", danger: true, go: () => { try { net.clearSession(); } catch {} clearProfile(); k.go("start"); } },
      ] : [
        ...more,
        muteItem,
        { label: "Settings", go: () => { closeOverlay(); openStationPopup("settings"); } },
        { label: "Switch Character", go: () => k.go("characterSelect") },
        { label: "Log in", go: () => k.go("start") },
      ];
      const pwid = 224, rowH = 42, ph = items.length * rowH + 14;
      const L = hubHud();
      const pcx = Math.max(pwid / 2 + 8, Math.min(L.avX, k.width() - ins.right - 8 - pwid / 2));
      const ptop = Math.max(8, Math.min(L.avY + L.avR + 8, k.height() - ph - 8));
      addPanel(k, { x: pcx, y: ptop + ph / 2, w: pwid, h: ph, radius: 12, fixed: true, z: OVERLAY_Z, tag: "overlay" });
      acctPanelRect = { x: pcx - pwid / 2, y: ptop, w: pwid, h: ph };
      // closeOverlay() before navigating, else a stale overlay survives the return.
      const choose = (it) => () => { closeOverlay(); it.go(); };
      const MENU_ICON = { "How to Play": "info", "Bestiary": "book", "Cosmetics": "tailor", "Get Essence": "gem", "Battle Pass": "pass", "Marketplace": "market", "Mute sound": "sound", "Unmute sound": "mute", "Settings": "cog", "Switch Character": "swap", "Log in": "person", "View Profile": "person", "Account": "person", "Sign out": "flee" };
      items.forEach((it, i) => {
        const by = ptop + 7 + rowH / 2 + i * rowH;
        addButton(k, { x: pcx, y: by, w: pwid - 18, h: rowH - 6, z: OVERLAY_Z,
          text: it.label, size: 15, fill: THEME.surface, textColor: it.danger ? THEME.danger : THEME.text, fixed: true, tag: "overlay", onClick: choose(it) });
        const sk = iconSpriteKey(k, MENU_ICON[it.label] || "dot", { size: 18, color: it.danger ? THEME.danger : THEME.primary });
        if (sk) k.add([k.sprite(sk), k.pos(pcx - pwid / 2 + 24, by), k.anchor("center"), k.scale(0.5), k.z(OVERLAY_Z + 1), k.fixed(), "overlay"]);
      });
      setNav(items.map((it, i) => ({ x: pcx, y: ptop + 7 + rowH / 2 + i * rowH, w: pwid - 18, h: rowH - 6, action: choose(it) })));
    }

    const interactBtnPos = () => { const L = hubHud(); return k.vec2(L.useX, L.useY); };
    const joyRestPos = () => { const L = hubHud(); return k.vec2(L.joyX, L.joyY); };
    const avatarHit = (p) => { const L = hubHud(); return Math.hypot(p.x - L.avX, p.y - L.avY) <= L.avR + 12; };
    function drawTouchControls() {
      if (!TOUCH) return;
      const joyActive = joyId !== null;
      drawJoystick(k, { base: joyActive ? joyBase : joyRestPos(), thumb: joyThumb, active: joyActive, radius: JOY_R });
      if (near) {
        drawTouchButton(k, { pos: interactBtnPos(), radius: IBTN_R, label: "Use", accent: near.accent, icon: near.kind === "cave" ? "portal" : (SIGN_ICON[near.id] || "flag") });
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
      // Pointers/vec2 are plain {x,y} on the canvas2D backend: no vec methods.
      let dx = p.x - joyBase.x, dy = p.y - joyBase.y;
      const len = Math.hypot(dx, dy) || 1;
      if (len > JOY_R) { const s = JOY_R / len; dx *= s; dy *= s; }
      joyThumb = k.vec2(joyBase.x + dx, joyBase.y + dy); joyVec = { x: dx / JOY_R, y: dy / JOY_R };
    }
    function joyEnd(id) { if (id !== joyId) return; joyId = null; joyVec = { x: 0, y: 0 }; joyThumb = joyBase; }
    function openMonsterDetail(m) {
      if (overlayOpen || !m) return;
      sfx("ui");
      detailMon = m;
    }
    function drawDetailPopup() {
      if (!detailMon) return;
      const mt = getMonsterType(detailMon.typeName);
      let st = {}; try { st = getMonsterStats(mt, detailMon.level); } catch {}
      drawMonsterDetail(k, mt, { vitals: {
        currentHealth: Math.round(detailMon.currentHealth ?? st.health ?? 0),
        maxHealth: st.health ?? Math.round(detailMon.currentHealth) ?? 1,
        currentEnergy: Math.round(detailMon.currentEnergy ?? 0),
        maxEnergy: st.energy ?? 0,
      } });
    }

    function pointerDown(id, p) {
      // Ignore the opening press's same-frame pointerdown or its release closes the popup.
      if (stationPopup) { if (k.time() !== popupOpenedT) { popupPressing = true; popupLastY = p.y; popupMoved = 0; } return; }
      if (detailMon) { detailMon = null; return; }
      if (overlayOpen) {
        if (menuKeepsWorld) {
          const r = acctPanelRect, inPanel = r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
          if (avatarHit(p) || !inPanel) closeOverlay();
        }
        return;
      }
      if (TOUCH && near) { const b = interactBtnPos(); if (Math.hypot(p.x - b.x, p.y - b.y) <= IBTN_R) { interact(); return; } }
      if (avatarHit(p)) { openAcctMenu(); return; }
      for (const ht of teamHits) {
        const [hx, hy, hw, hh] = ht.rect;
        if (p.x >= hx && p.x <= hx + hw && p.y >= hy && p.y <= hy + hh) { openMonsterDetail(ht.mon); return; }
      }
      // Touch-only: never start the joystick for mouse id 'm' (invisible mouse-walk).
      if (TOUCH && id !== "m") joyStart(id, p);
    }
    k.onTouchStart((p, t) => pointerDown(t?.identifier ?? 0, p));
    k.onTouchMove((p, t) => { if (stationPopup) { popupMove(p); return; } joyMove(t?.identifier ?? 0, p); });
    k.onTouchEnd((p, t) => { if (stationPopup) { popupUp(p); return; } joyEnd(t?.identifier ?? 0); });
    if (!TOUCH) {
      k.onMousePress(() => pointerDown("m", k.mousePos()));
      k.onMouseMove(() => { if (stationPopup) { popupMove(k.mousePos()); return; } if (joyId === "m") joyMove("m", k.mousePos()); });
      k.onMouseRelease(() => { if (stationPopup) { popupUp(k.mousePos()); return; } joyEnd("m"); });
    }
    k.onScroll((d) => { if (stationPopup && !(stationPopup.hasDetail && stationPopup.state.selected)) stationPopup.scroll(stationPopup.state, (d?.y || 0) * 0.5); });

    k.onKeyPress("escape", () => {
      if (stationPopup) { if (stationPopup.hasModal && stationPopup.state.renaming) { stationPopup.state.dispose(); return; } if (stationPopup.state.onEsc && stationPopup.state.onEsc()) return; if (stationPopup.hasDetail && stationPopup.state.selected) { stationPopup.state.selected = null; return; } closeStationPopup(); return; }
      if (detailMon) { detailMon = null; return; }
      openAcctMenu();
    });

    // DEV-only hooks used by tools/qa-*.mjs harnesses.
    if (import.meta.env && import.meta.env.DEV) {
      try { window.__hubTele = (sx, sy) => { me.x = sx; me.y = sy; }; } catch {}
      try { window.__openStation = (id) => openStationPopup(id); } catch {}
      try { window.__portalButtons = () => { const L = portalLayout(stationContentRect(k)); return [L.sp, L.mp, L.adv].map((r) => ({ x: r[0] + r[2] / 2, y: r[1] + r[3] / 2 })); }; } catch {}
      try { window.__closeStation = () => { if (stationPopup) closeStationPopup(); }; } catch {}
      try { window.__stationPopupId = () => (stationPopup ? stationPopup.id : null); } catch {}
      try { window.__avatarBadge = () => { const L = hubHud(); return { x: L.avX, y: L.avY, r: L.avR }; }; } catch {}
    }

    // Start the clock on first draw: k.time() at scene init uses a different basis.
    let enterT = -1;
    k.onDraw(() => {
      if (enterT < 0) enterT = k.time();
      const f = (k.time() - enterT) / 0.42;
      if (f >= 1) return;
      const e = 1 - (1 - f) * (1 - f);
      k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: k.rgb(...THEME.bg), opacity: 1 - e, fixed: true });
    });

    k.onSceneLeave(() => { leaving = true; lastHubPos = { x: me.x, y: me.y }; lastHubChar = characterId; cancelConnectTimer(); clearNet(); offSession(); if (popupShopOff) { popupShopOff(); popupShopOff = null; } }); // Also release popupShopOff: it isn't in sessionOffs/netOffs.
  });
}
