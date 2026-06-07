import { net } from "../netClient.js";
import { GAME } from "../engine/schemas.js";
import { generateMap, biomeTintAt } from "../engine/mapgen.js";
import { getSpiritChain, cleanAttackName } from "../data.js";
import { getMonsterType } from "../engine/gamedata.js"; // team-card element lookup (PV-T8)
import { nextChainId } from "../engine/inventory.js"; // PARITY-3: shared chain-cycle (SP↔MP)
import { objectiveText } from "../ui/objective.js"; // PT2-T10: persistent objective HUD (SP↔MP shared)
import { drawBiomeChip } from "../ui/biomeHud.js"; // PT1-T18: current-biome + speed HUD chip (shared SP↔MP)
import { drawCharacter } from "../render/character.js";
import { getSkin, getEquippedSkin, getEquippedSkinId } from "../render/chainCosmetics.js"; // CN-12: per-player skins
import { getEquippedCharacterSkin } from "../render/characterCosmetics.js"; // self's character skin in MP (accent + cloak)
import { drawSpiritChainProjectile, drawSpiritChainModel, drawChest, chainColor } from "../render/spiritchain.js";
import { drawTiles, makeTileCache } from "../render/tiles.js";
import { drawAtmosphere } from "../render/atmosphere.js";
import { emit, emitText, updateFx, drawFx, drawFxScreen, clearFx } from "../render/fx.js";
import { drawPortal, drawExtractFlash } from "../render/portal.js";
import { minimapWindow } from "../render/minimap.js"; // PT1-T24: shared zoom-window math (SP↔MP)
import { initAudio, toggleMuted, isMuted, sfx, haptic } from "../systems/audio.js";
import { gamepadMove, gamepadPressed, BTN } from "../systems/gamepad.js";
import { readSafeAreaInsets } from "../systems/safearea.js"; // MB-4: keep touch HUD off the notch/home-bar
import { prefersReducedMotion } from "../systems/a11y.js"; // a11y: freeze decorative monster bob
import { elementColor, THEME } from "../ui/theme.js";

// HUD chrome routed through the design system (PV-A1). Only neutral *chrome*
// (plain HUD/overlay text, panel + scrim fills, frame outlines) is themed here —
// procedural art (minimap blips, storm rings, FX, sprites, shadows), semantic
// accents (gold titles, win/lose, danger alerts, damage numbers, bar fills) and
// the self-contained touch/pause widgets keep their own intentional colors.
const UI = {
  text:  THEME.text,     // primary HUD / overlay text (was ad-hoc white)
  body:  THEME.textBody,  // secondary HUD text
  mut:   THEME.textMut,   // dim section labels
  panel: THEME.bgAlt,     // HUD panel + overlay scrim fill (near-black violet)
  track: THEME.surface2,  // recessed bar track
  line:  THEME.line,       // panel / frame outline
  amber: THEME.amber, danger: THEME.danger, primary: THEME.primary,
};

// Online round view: the seeded map (regenerated client-side from the server
// seed) drawn as culled, biome-colored tiles, plus server-authoritative players.
// WASD -> server (~20Hz). Single-player game scene is unchanged.
export default function onlineGameScene(k) {
  k.scene("onlineGame", (args = {}) => {
    let map = args.map || null;
    initAudio(net); // P8-T6: wire procedural SFX to net events (idempotent)
    net.setSkin(getEquippedSkinId()); // CN-12: tell the server our equipped cosmetic so rivals see it
    // Defensive: if entered without a prebuilt map, regenerate it from the seed.
    if (!map && net.state.seed != null) {
      generateMap(null, net.state.seed).then((m) => { map = m; }).catch(() => {});
    }
    const tileCache = makeTileCache(); // P-floortile: textured floor, cached per tile type
    k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(10, 14, 18), k.fixed(), k.z(-10)]);

    // Fog of war (PT1-T08, headline demand) — client-side, mirrors SP `game.js`. The
    // map hides until you walk near it; `explored` holds revealed tile keys for the
    // round, the floor + minimap gate on it. No server change (each client tracks its own).
    const explored = new Set();
    const FOG_REVEAL = 6; // tiles revealed around the player (< the on-screen radius)
    const fogKey = (x, y) => x * 100000 + y;
    const isExplored = (x, y) => explored.has(fogKey(x, y));
    function revealAround() {
      const self = net.state.self; if (!self) return;
      const ptx = Math.floor(self.x / GAME.EFFECTIVE_TILE), pty = Math.floor(self.y / GAME.EFFECTIVE_TILE);
      const r2 = FOG_REVEAL * FOG_REVEAL;
      for (let dx = -FOG_REVEAL; dx <= FOG_REVEAL; dx++)
        for (let dy = -FOG_REVEAL; dy <= FOG_REVEAL; dy++)
          if (dx * dx + dy * dy <= r2) explored.add(fogKey(ptx + dx, pty + dy));
    }

    const info = k.add([
      k.text("", { size: 14, font: "gameFont" }),
      k.pos(12, 12), k.color(255, 255, 255), k.fixed(), k.z(100),
    ]);
    const hint = k.add([
      k.text("Move: WASD or drag     Throw chain: Space     Cycle chain: [ ]     Leave: ESC     M mute", { size: 12, font: "gameFont" }),
      k.pos(12, k.height() - 24), k.color(210, 210, 220), k.fixed(), k.z(100),
    ]);
    // PT2-T10 (#9): a persistent objective line so a new player always knows the
    // goal — from "catch & loot" early to "extract" once the storm closes.
    const objective = k.add([
      k.text("", { size: 13, font: "gameFont" }),
      k.pos(k.width() / 2, 34), k.anchor("center"), k.color(150, 210, 235), k.fixed(), k.z(100),
    ]);

    // Smooth render positions (interpolate toward authoritative snapshots).
    const lerp = (a, b, t) => a + (b - a) * t;
    const selfRender = { x: net.state.self.x, y: net.state.self.y };
    const othersRender = new Map(); // id -> { x, y, moving }
    const projRender = new Map(); // projectile id -> { x, y, vx, vy, chainId } (extrapolated)
    const portalSeen = new Map(); // portal "x,y" -> first-seen time (drives the rise animation)
    let selfMoving = false;
    let stepAcc = 0; // throttle for footstep SFX while roaming
    let prevLevels = new Map(); // monsterId -> last level, for level-up SFX (state diff)
    let prevChests = null; // last frame's chests, for chest-open SFX (state diff); null = first frame
    let selfDir = { x: 0, y: 1 }; // last heading, for character facing
    // P8-T8: first-run onboarding overlay — shown once (localStorage), dismissed by
    // moving or tapping. An overlay in this scene (not a new scene — main.js is @phaser's).
    let onboard = false;
    try { onboard = !localStorage.getItem("tq_onboarded"); } catch {}
    let onboardT = 0;
    const dismissOnboard = () => { if (!onboard) return; onboard = false; try { localStorage.setItem("tq_onboarded", "1"); } catch {} };
    function drawOnboarding() {
      onboardT += k.dt();
      const W = k.width(), H = k.height(), cx = W / 2;
      k.drawRect({ pos: k.vec2(0, 0), width: W, height: H, color: k.rgb(...UI.panel), opacity: 0.86, fixed: true });
      k.drawText({ text: "HOW TO PLAY", pos: k.vec2(cx, H * 0.18), size: 40, font: "gameFont", anchor: "center", color: k.rgb(245, 215, 120), fixed: true });
      // MB-11: hints match the actual controls — touch gestures on touch devices,
      // keys on desktop (showing "WASD/Q/1-4/ESC" to a phone player was confusing).
      const lines = TOUCH ? [
        "MOVE — drag the left side of the screen",
        "THROW A SPIRIT CHAIN — tap the THROW button to catch wild monsters",
        "IN A FIGHT — tap an attack, or Catch / Flee",
        "EXTRACT — reach a glowing portal before the storm closes in",
        "THE STAKES — die and you lose the spirit chains you found this run",
        "PAUSE / LEAVE — tap the pause button (top)",
      ] : [
        "MOVE — WASD or drag the left side of the screen",
        "THROW A SPIRIT CHAIN — Space (aimed along your heading) to catch wild monsters",
        "IN A FIGHT — 1-4 attack    C catch    F flee",
        "EXTRACT — reach a glowing portal before the storm closes in",
        "THE STAKES — die and you lose the spirit chains you found this run",
        "LEAVE — ESC",
      ];
      lines.forEach((ln, i) => k.drawText({ text: ln, pos: k.vec2(cx, H * 0.34 + i * 36), size: 18, font: "gameFont", anchor: "center", width: W - 140, color: k.rgb(...UI.text), fixed: true }));
      const pulse = 0.55 + 0.45 * Math.sin(k.time() * 4);
      k.drawText({ text: "move or tap to begin", pos: k.vec2(cx, H * 0.82), size: 18, font: "gameFont", anchor: "center", color: k.rgb(...UI.text), opacity: pulse, fixed: true });
    }
    let awaiting = false; // true while a combat turn is being resolved (AI ~1-2s)
    let lastLogLen = 0;

    // ── Onscreen controls (mobile) ──
    const TOUCH = typeof k.isTouchscreen === "function" ? k.isTouchscreen() : ("ontouchstart" in window);
    // MB-4: keep the touch controls clear of the notch / rounded corners / home-bar.
    // env(safe-area-inset-*) is in CSS px; the canvas is uniformly FIT-scaled (design
    // height = k.height()), so 1 design unit = canvasCssHeight/k.height() CSS px —
    // divide to convert insets into the design space the HUD is laid out in. Cached
    // (DOM reads aren't free) + refreshed on a throttle in onUpdate; computed only on
    // touch devices, so desktop stays all-zero and nothing moves.
    let safeInset = { top: 0, right: 0, bottom: 0, left: 0 };
    const recomputeSafeInset = () => {
      const css = readSafeAreaInsets(); // CSS px; zeros if no notch / non-browser
      const cv = typeof document !== "undefined" ? document.querySelector("canvas") : null;
      const hCss = cv ? cv.getBoundingClientRect().height : 0;
      const scale = hCss > 0 ? hCss / k.height() : 1; // CSS px per design unit
      safeInset = { top: css.top / scale, right: css.right / scale, bottom: css.bottom / scale, left: css.left / scale };
    };
    if (TOUCH) recomputeSafeInset();
    const COMBAT_H = 264; // taller panel: room for larger, touch-friendly action buttons
    const THROW_R = 46; // touch THROW button (right thumb) — mobile spirit-chain throw
    const throwBtnC = () => k.vec2(k.width() - 88 - safeInset.right, k.height() - 124 - safeInset.bottom);
    // MB-11: touch pause button (top-center) — the pause/leave menu was ESC-only,
    // so touch players had no way to pause or leave a round. The menu itself is
    // already touch-operable (see pointerDown's menuBtns hit-test).
    const pauseBtnRect = () => [k.width() / 2 - 22, 10 + safeInset.top, 44, 34];
    // ESC pause/settings overlay (Resume · Sound · Leave). ESC no longer instantly
    // quits the round (was accidental round-loss). The world keeps running server-side.
    let menuOpen = false;
    let extractFlashT = null; // extraction climax flash start (PV juice, MP parity with SP)
    const menuBtns = () => {
      const cx = k.width() / 2, bw = 280, bh = 56, gap = 16, y0 = k.height() / 2 - 64;
      return [
        { rect: [cx - bw / 2, y0, bw, bh], label: "Resume", act: () => { menuOpen = false; } },
        { rect: [cx - bw / 2, y0 + (bh + gap), bw, bh], label: `Sound: ${isMuted() ? "Off" : "On"}`, act: () => { toggleMuted(); } },
        { rect: [cx - bw / 2, y0 + (bh + gap) * 2, bw, bh], label: "Leave round", act: () => { net.close(); k.go("start"); } },
      ];
    };

    // Element → accent color for badges and attack tints. VS-4: this now comes from
    // the one source of truth (theme.elementColor — colorblind-tuned, comprehensive,
    // with a hashed fallback for open-ended AI elements), not a local duplicate map.
    const elemColor = elementColor;
    const hpColor = (r) => (r > 0.5 ? [90, 200, 110] : r > 0.2 ? [230, 200, 80] : [220, 90, 90]);
    // Rounded stat bar in fixed/overlay space, with an optional right-aligned label.
    function drawBar(x, y, w, h, ratio, col, label) {
      const r = Math.max(0, Math.min(1, ratio || 0));
      k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius: h / 2, color: k.rgb(...UI.track), fixed: true });
      if (r > 0) k.drawRect({ pos: k.vec2(x, y), width: Math.max(h, w * r), height: h, radius: h / 2, color: k.rgb(col[0], col[1], col[2]), fixed: true });
      if (label) k.drawText({ text: label, pos: k.vec2(x + w - 6, y + h / 2), size: 11, font: "gameFont", anchor: "right", color: k.rgb(...UI.text), fixed: true });
    }
    // One combatant's header (element badge + name + Lv + status) and HP/energy bars.
    // `side`: "enemy" | "self" for the VS-6 orientation accent.
    function drawCombatant(mon, y, title, m, W, flash = 0, side = null) {
      if (!mon) return;
      // VS-6: a colored left-edge strip (enemy = danger red, you = teal) so it's
      // instantly clear which row is the enemy vs your monster.
      if (side) k.drawRect({ pos: k.vec2(m - 8, y - 3), width: 3, height: 42, radius: 1.5, color: side === "enemy" ? k.rgb(...UI.danger) : k.rgb(...UI.primary), fixed: true });
      const el = elemColor(mon.element);
      // VS-5: element badge = colored dot + the element's first letter, so the element
      // is readable without relying on hue (colorblind-safe; covers pairs hue can't fix).
      k.drawCircle({ pos: k.vec2(m + 7, y + 8), radius: 7, color: k.rgb(el[0], el[1], el[2]), fixed: true });
      const elum = 0.299 * el[0] + 0.587 * el[1] + 0.114 * el[2];
      const eLetter = (String(mon.element || "?").trim()[0] || "?").toUpperCase();
      k.drawText({ text: eLetter, pos: k.vec2(m + 7, y + 8), size: 9, font: "gameFont", anchor: "center", color: elum > 140 ? k.rgb(18, 18, 26) : k.rgb(245, 245, 250), fixed: true });
      k.drawText({ text: `${title}  Lv.${mon.level}`, pos: k.vec2(m + 20, y), size: 14, font: "gameFont", color: k.rgb(...UI.text), fixed: true });
      if (mon.status) k.drawText({ text: String(mon.status), pos: k.vec2(m + W, y), size: 12, font: "gameFont", anchor: "right", color: k.rgb(...UI.amber), fixed: true });
      const hpR = mon.maxHealth ? mon.currentHealth / mon.maxHealth : 0;
      drawBar(m, y + 18, W, 12, hpR, hpColor(hpR), `${mon.currentHealth}/${mon.maxHealth}`);
      if (mon.maxEnergy) drawBar(m, y + 33, W, 5, mon.currentEnergy / mon.maxEnergy, [90, 160, 240], null);
      // Hit-flash: a brief white pulse over the row when this combatant took damage (PV-A5 juice).
      if (flash > 0) k.drawRect({ pos: k.vec2(m - 5, y - 4), width: W + 10, height: 44, radius: 5, color: k.rgb(255, 255, 255), opacity: 0.3 * flash, fixed: true });
    }

    // ── Minimap / radar (P2-T5 readability) ── Always shows the objective: the
    // shrinking safe zone + extraction portals + your position, over a faint
    // downsampled terrain, so you can navigate to extract before the zone closes.
    const mmSize = Math.max(120, Math.min(200, Math.round(Math.min(k.width(), k.height()) * 0.3)));
    const mmPad = 12;
    let mmCells = null; // precomputed terrain: [{fx, fy, col}] as 0..1 map fractions
    let mmZoom = 1; // PT1-T24 parity: 1x full map ↔ 2x player-centered (tap the minimap)
    function buildMinimap() {
      if (!map) return;
      const N = 34, step = Math.max(1, Math.floor(map.mapSize / N));
      const cells = [];
      for (let x = 0; x < map.mapSize; x += step) {
        for (let y = 0; y < map.mapSize; y += step) {
          const t = map.tileMap[x]?.[y];
          if (!t) continue;
          // PT1-T07: bias the radar cell toward its biome's representative tint so
          // biomes read distinctly (was muddy per-tile averages → "all green");
          // keep a little tile variation for texture. Matches the SP minimap.
          const tc = [t.colorProfile_full_r, t.colorProfile_full_g, t.colorProfile_full_b];
          const tint = biomeTintAt(map, x, y);
          const col = tint
            ? [Math.round(tint[0] * 0.65 + tc[0] * 0.35), Math.round(tint[1] * 0.65 + tc[1] * 0.35), Math.round(tint[2] * 0.65 + tc[2] * 0.35)]
            : tc;
          cells.push({ tx: x, ty: y, fx: x / map.mapSize, fy: y / map.mapSize, col });
        }
      }
      mmCells = { cells, frac: step / map.mapSize };
    }
    function drawMinimap() {
      if (!map) return;
      if (!mmCells) buildMinimap();
      const E = GAME.EFFECTIVE_TILE;
      const ox = k.width() - mmSize - mmPad, oy = mmPad;
      // PT1-T24 parity: SAME zoom-window math as the SP radar (render/minimap.js,
      // "fix once"). Tile-space module → world-space wrappers for the net entities.
      // At Z=1 the window is the whole map → byte-identical to the old full radar.
      const view = minimapWindow({ mapSize: map.mapSize, mmSize, mmX: ox, mmY: oy, zoom: mmZoom, playerTileX: selfRender.x / E, playerTileY: selfRender.y / E });
      const Z = view.zoom;
      const mm = (wx, wy) => { const p = view.project(wx / E, wy / E); return k.vec2(p.x, p.y); };
      const inWin = (wx, wy) => view.inWindow(wx / E, wy / E);
      k.drawRect({ pos: k.vec2(ox - 4, oy - 4), width: mmSize + 8, height: mmSize + 8, radius: 6, color: k.rgb(...UI.panel), opacity: 0.82, outline: { width: 2, color: k.rgb(...UI.line) }, fixed: true });
      if (mmCells) {
        const step = Math.max(1, Math.round(mmCells.frac * map.mapSize)); // tiles per radar cell
        const cw = Math.max(2, step * view.scale + 0.5);
        for (const c of mmCells.cells) { // fog of war: only reveal walked-near terrain on the radar
          if (!isExplored(c.tx, c.ty)) continue;
          if (!view.cellVisible(c.tx, c.ty, step)) continue; // cull to the box, no spill (1× = always)
          const p = view.project(c.tx, c.ty);
          k.drawRect({ pos: k.vec2(p.x, p.y), width: cw, height: cw, color: k.rgb(c.col[0], c.col[1], c.col[2]), opacity: 0.5, fixed: true });
        }
      }
      // Storm ring: 1× only — a circle can't be clipped to the box, so at zoom it would overflow.
      if (net.state.circle && Z === 1) {
        const c = net.state.circle;
        k.drawCircle({ pos: mm(c.x, c.y), radius: Math.max(2, (c.r / E) * view.scale), fill: false, outline: { width: 1.5, color: k.rgb(120, 180, 255) }, opacity: 0.85, fixed: true });
      }
      const pulse = 0.6 + 0.4 * Math.sin(k.time() * 4);
      for (const p of net.state.portals) { if (Z > 1 && !inWin(p.x, p.y)) continue; k.drawCircle({ pos: mm(p.x, p.y), radius: 3.5 * pulse + 1.5, color: k.rgb(80, 220, 255), fixed: true }); }
      for (const mo of net.state.monsters) { if (Z > 1 && !inWin(mo.x, mo.y)) continue; k.drawCircle({ pos: mm(mo.x, mo.y), radius: 1.6, color: k.rgb(220, 180, 80), fixed: true }); }
      // Chests reveal on the minimap only when you're close (discovery, not a full loot map).
      const cmr2 = GAME.SPIRIT_CHAIN.CHEST_MINIMAP_RADIUS ** 2;
      for (const c of net.state.chests) {
        const dx = c.x - selfRender.x, dy = c.y - selfRender.y;
        if (dx * dx + dy * dy > cmr2) continue;
        if (Z > 1 && !inWin(c.x, c.y)) continue;
        k.drawCircle({ pos: mm(c.x, c.y), radius: 2.2, color: k.rgb(228, 206, 128), fixed: true });
      }
      // Rivals as a tiny character glyph (head + body) — reads as a *player*, distinct
      // from the round amber monster blobs (radar scale: shapes > mushy mini-sprites).
      for (const p of net.state.players) {
        if (Z > 1 && !inWin(p.x, p.y)) continue;
        const mp = mm(p.x, p.y);
        k.drawRect({ pos: k.vec2(mp.x - 1.5, mp.y - 1), width: 3, height: 4, color: k.rgb(235, 95, 95), fixed: true });
        k.drawCircle({ pos: k.vec2(mp.x, mp.y - 2), radius: 1.6, color: k.rgb(235, 95, 95), fixed: true });
      }
      const sp = mm(selfRender.x, selfRender.y);
      k.drawCircle({ pos: sp, radius: 3.5, color: k.rgb(90, 170, 255), outline: { width: 1.5, color: k.rgb(255, 255, 255) }, fixed: true });
      // Heading "nose": a short line in the facing direction so you can read your
      // orientation on the radar at a glance — matters for PvP + extraction routing.
      if (selfDir && (selfDir.x || selfDir.y)) {
        const dl = Math.hypot(selfDir.x, selfDir.y) || 1, nx = selfDir.x / dl, ny = selfDir.y / dl;
        k.drawLine({ p1: k.vec2(sp.x + nx * 3, sp.y + ny * 3), p2: k.vec2(sp.x + nx * 9, sp.y + ny * 9), width: 2.2, color: k.rgb(255, 255, 255), opacity: 0.95, fixed: true });
      }
      // Zoom badge (discoverable; only when zoomed in).
      if (Z !== 1) k.drawText({ text: `${Z}x`, pos: k.vec2(ox + 5, oy + 4), size: 11, font: "gameFont", color: k.rgb(...UI.text), opacity: 0.85, fixed: true });
    }

    // Team HUD layout (top-left). Shared constants so drawTeamHp + drawChainHud
    // can't desync when the row height changes (PV-T8 compact cards).
    const TEAM_X = 12, TEAM_Y0 = 78, TEAM_ROW_H = 22, TEAM_CARD_W = 134, TEAM_BAR_H = 7, STAMINA_H = 7;
    const teamLen = () => net.state.self?.team?.length || 0;
    const staminaY = () => TEAM_Y0 + teamLen() * TEAM_ROW_H + 6;
    const teamHudBottom = () => staminaY() + STAMINA_H + 8; // y where the chain HUD starts
    const trunc = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

    // Team HP HUD (top-left): a compact card per active monster — element-tinted
    // dot + name + live HP bar — so storm/combat damage to a *specific* reserve is
    // identifiable at a glance (was anonymous bars). Names/elements come from the
    // full active-team objects (state.team, from welcome/roster), index-aligned to
    // the in-round hp/max snapshot (state.self.team) — no extra snapshot payload.
    function drawTeamHp() {
      const team = net.state.self?.team;
      if (!team || !team.length) return;
      const full = net.state.team || []; // full active-team (name/typeName/element), index-aligned
      k.drawText({ text: "TEAM", pos: k.vec2(TEAM_X, TEAM_Y0 - 15), size: 11, font: "gameFont", color: k.rgb(...UI.mut), fixed: true });
      team.forEach((mo, i) => {
        const y = TEAM_Y0 + i * TEAM_ROW_H;
        const r = mo.max ? mo.hp / mo.max : 0;
        const fainted = mo.hp <= 0;
        const m = full[i];
        const ec = m ? elemColor((getMonsterType(m.typeName) || {}).element) : UI.mut;
        const name = m ? (m.name || m.typeName || "?") : `Monster ${i + 1}`;
        // element accent dot (dimmed if fainted)
        k.drawCircle({ pos: k.vec2(TEAM_X + 4, y + 4), radius: 4, color: k.rgb(ec[0], ec[1], ec[2]), opacity: fainted ? 0.3 : 0.95, fixed: true });
        // name above the bar
        k.drawText({ text: trunc(name, 16), pos: k.vec2(TEAM_X + 13, y - 1), size: 10, font: "gameFont", color: k.rgb(...(fainted ? UI.mut : UI.text)), opacity: fainted ? 0.7 : 1, fixed: true });
        // live HP bar with the number
        drawBar(TEAM_X + 13, y + 12, TEAM_CARD_W - 13, TEAM_BAR_H, r, fainted ? [70, 70, 78] : hpColor(r), String(mo.hp));
      });
      // Stamina bar (sprint) under the team.
      const sy = staminaY();
      const sr = (net.state.stamina ?? GAME.SPRINT.STAMINA_MAX) / GAME.SPRINT.STAMINA_MAX;
      k.drawText({ text: "STAMINA", pos: k.vec2(TEAM_X, sy - 1), size: 9, font: "gameFont", color: k.rgb(...UI.mut), fixed: true });
      drawBar(TEAM_X + 56, sy, TEAM_CARD_W - 56, STAMINA_H, sr, sr > 0.3 ? [120, 200, 230] : [220, 170, 80], null);
    }

    // The live instance + definition of the player's equipped spirit chain.
    function equippedChain() {
      const id = net.state.equippedChainId;
      const cs = (net.state.chains || []).find((c) => c.chainId === id);
      return cs ? { cs, def: getSpiritChain(cs.chainId) } : null;
    }

    // Equipped-chain HUD (left, under TEAM): icon, name, throws, charges.
    function drawChainHud() {
      const e = equippedChain();
      const x = TEAM_X, y = teamHudBottom();
      k.drawRect({ pos: k.vec2(x, y), width: 150, height: 40, radius: 4, color: k.rgb(...UI.panel), opacity: 0.8, fixed: true });
      if (e && e.def) {
        const col = chainColor(e.def);
        k.drawCircle({ pos: k.vec2(x + 20, y + 20), radius: 9, color: k.rgb(col[0], col[1], col[2]), opacity: 0.9, fixed: true });
        const throws = e.cs.throwCount == null ? "∞" : String(e.cs.throwCount);
        k.drawText({ text: e.def.name, pos: k.vec2(x + 38, y + 5), size: 11, font: "gameFont", color: k.rgb(...UI.text), fixed: true });
        k.drawText({ text: `Space throw    ${throws}/${e.cs.durability}`, pos: k.vec2(x + 38, y + 22), size: 10, font: "gameFont", color: k.rgb(...UI.body), fixed: true });
      } else {
        k.drawText({ text: "No chain", pos: k.vec2(x + 10, y + 14), size: 11, font: "gameFont", color: k.rgb(...UI.mut), fixed: true });
      }
    }

    // Faint aim line from the player along the current heading (world space).
    function drawAim(now) {
      const e = equippedChain();
      if (!e || !e.def) return;
      const len = Math.hypot(selfDir.x, selfDir.y) || 1;
      const ux = selfDir.x / len, uy = selfDir.y / len;
      const col = chainColor(e.def);
      k.drawLine({
        p1: k.vec2(selfRender.x, selfRender.y),
        p2: k.vec2(selfRender.x + ux * e.def.throwRange, selfRender.y + uy * e.def.throwRange),
        width: 1.5, color: k.rgb(col[0], col[1], col[2]), opacity: 0.16,
      });
    }

    // Danger overlay: pulsing red border + warning when outside the safe zone
    // (where the storm drains your active monster). Purely client-side from the
    // authoritative self position vs the circle.
    function drawDanger() {
      const c = net.state.circle, self = net.state.self;
      if (!c) return;
      const dx = self.x - c.x, dy = self.y - c.y;
      if (dx * dx + dy * dy <= c.r * c.r) return; // inside the zone — safe
      const pulse = 0.5 + 0.5 * Math.sin(k.time() * 6);
      const W = k.width(), H = k.height(), t = 8, op = 0.25 + 0.45 * pulse;
      const red = k.rgb(230, 60, 60);
      k.drawRect({ pos: k.vec2(0, 0), width: W, height: t, color: red, opacity: op, fixed: true });
      k.drawRect({ pos: k.vec2(0, H - t), width: W, height: t, color: red, opacity: op, fixed: true });
      k.drawRect({ pos: k.vec2(0, 0), width: t, height: H, color: red, opacity: op, fixed: true });
      k.drawRect({ pos: k.vec2(W - t, 0), width: t, height: H, color: red, opacity: op, fixed: true });
      const cy = Math.round(H * 0.26);
      k.drawText({ text: "OUTSIDE SAFE ZONE", pos: k.vec2(W / 2, cy), size: 22, font: "gameFont", anchor: "center", color: k.rgb(255, 120, 120), opacity: 0.7 + 0.3 * pulse, fixed: true });
      // PT2-T08: make the punishment ACTIONABLE — a screen-edge arrow toward the zone
      // centre (the nearest safe direction) + the distance still to cross. Without
      // this the warning says you're in danger but not which way to run.
      const dist = Math.hypot(dx, dy);
      const toSafe = Math.max(0, Math.round((dist - c.r) / GAME.EFFECTIVE_TILE));
      k.drawText({ text: `${toSafe} tiles to safety — run toward the arrow`, pos: k.vec2(W / 2, cy + 26), size: 14, font: "gameFont", anchor: "center", color: k.rgb(255, 185, 185), fixed: true });
      // Arrow toward the centre, projected to the screen edge (camera centres self).
      const ang = Math.atan2(-dy, -dx), cs = Math.cos(ang), sn = Math.sin(ang);
      const hw = W / 2 - 60, hh = H / 2 - 60;
      const scale = Math.min(hw / (Math.abs(cs) || 1e-6), hh / (Math.abs(sn) || 1e-6));
      const ax = W / 2 + cs * scale, ay = H / 2 + sn * scale;
      const aw = 4, head = 12;
      k.drawCircle({ pos: k.vec2(ax, ay), radius: 20, color: k.rgb(20, 6, 6), opacity: 0.55, fixed: true });
      const tip = k.vec2(ax + cs * 12, ay + sn * 12), a1 = ang + Math.PI * 0.8, a2 = ang - Math.PI * 0.8;
      k.drawLine({ p1: k.vec2(ax - cs * 9, ay - sn * 9), p2: tip, width: aw, color: red, opacity: 0.7 + 0.3 * pulse, fixed: true });
      k.drawLine({ p1: tip, p2: k.vec2(tip.x + Math.cos(a1) * head, tip.y + Math.sin(a1) * head), width: aw, color: red, opacity: 0.7 + 0.3 * pulse, fixed: true });
      k.drawLine({ p1: tip, p2: k.vec2(tip.x + Math.cos(a2) * head, tip.y + Math.sin(a2) * head), width: aw, color: red, opacity: 0.7 + 0.3 * pulse, fixed: true });
    }

    // Storm-damage hit flash (PV-T13): a brief, brighter pulse of the danger border
    // on the frame the storm actually ticks HP, fading over ~0.45s. Independent of
    // drawDanger so it can finish fading even if you've just run back inside the zone.
    // a11y: under reduce-motion keep it (a fade, not a strobe) but cap the peak alpha.
    function drawStormHit() {
      if (stormHitT < 0) return;
      const age = k.time() - stormHitT;
      if (age > 0.45) return;
      const peak = prefersReducedMotion() ? 0.3 : 0.45;
      const a = (1 - age / 0.45) * peak;
      const W = k.width(), H = k.height(), t = 26, red = k.rgb(235, 50, 50);
      k.drawRect({ pos: k.vec2(0, 0), width: W, height: t, color: red, opacity: a, fixed: true });
      k.drawRect({ pos: k.vec2(0, H - t), width: W, height: t, color: red, opacity: a, fixed: true });
      k.drawRect({ pos: k.vec2(0, 0), width: t, height: H, color: red, opacity: a, fixed: true });
      k.drawRect({ pos: k.vec2(W - t, 0), width: t, height: H, color: red, opacity: a, fixed: true });
    }

    // Off-screen extraction guidance: a screen-edge arrow toward the NEAREST portal
    // when it isn't already on-screen, so you know which way to run to extract.
    // Portals otherwise only show on the minimap + once they're in view — easy to
    // miss in a closing round. Portal-cyan (matches the minimap dots) reads as
    // "extraction". Hidden once the rift is on-screen (you can see it).
    function drawPortalCompass() {
      const portals = net.state.portals, self = net.state.self;
      if (!portals || !portals.length || !self) return;
      let np = null, best = Infinity;
      for (const p of portals) {
        const d = (p.x - self.x) ** 2 + (p.y - self.y) ** 2;
        if (d < best) { best = d; np = p; }
      }
      if (!np) return;
      const W = k.width(), H = k.height(), margin = 54;
      // World → screen (the camera centers selfRender on screen).
      const sx = (np.x - selfRender.x) + W / 2, sy = (np.y - selfRender.y) + H / 2;
      if (sx >= margin && sx <= W - margin && sy >= margin && sy <= H - margin) return; // on-screen → rift visible
      const ang = Math.atan2(sy - H / 2, sx - W / 2), c = Math.cos(ang), s = Math.sin(ang);
      const hw = W / 2 - margin, hh = H / 2 - margin;
      const scale = Math.min(hw / (Math.abs(c) || 1e-6), hh / (Math.abs(s) || 1e-6));
      const ax = W / 2 + c * scale, ay = H / 2 + s * scale; // edge position toward the portal
      const cyan = k.rgb(90, 220, 255), pulse = 0.6 + 0.4 * Math.sin(k.time() * 4), wid = 3;
      k.drawCircle({ pos: k.vec2(ax, ay), radius: 17, color: k.rgb(8, 12, 20), opacity: 0.7, fixed: true });
      k.drawCircle({ pos: k.vec2(ax, ay), radius: 17, fill: false, outline: { width: 1.5, color: cyan }, opacity: 0.5 + 0.35 * pulse, fixed: true });
      const tip = k.vec2(ax + c * 9, ay + s * 9), b = 8, a1 = ang + Math.PI * 0.78, a2 = ang - Math.PI * 0.78;
      k.drawLine({ p1: k.vec2(ax - c * 7, ay - s * 7), p2: tip, width: wid, color: cyan, fixed: true }); // shaft
      k.drawLine({ p1: tip, p2: k.vec2(tip.x + Math.cos(a1) * b, tip.y + Math.sin(a1) * b), width: wid, color: cyan, fixed: true });
      k.drawLine({ p1: tip, p2: k.vec2(tip.x + Math.cos(a2) * b, tip.y + Math.sin(a2) * b), width: wid, color: cyan, fixed: true });
      const dist = Math.round(Math.sqrt(best) / GAME.EFFECTIVE_TILE); // distance in tiles
      k.drawText({ text: `${dist}`, pos: k.vec2(ax - c * 31, ay - s * 31), size: 13, font: "gameFont", anchor: "center", color: cyan, fixed: true });
    }

    // Final-minute extraction urgency: the round clock is the deadline, but it's
    // otherwise just small text in the top-left info line. In the last 60s show a
    // big centered timer (amber), going red + pulsing in the last 30s, so the
    // pressure to reach a portal is unmissable. `net.state.time` = seconds left.
    function drawTimeWarning() {
      const t = net.state.time || 0;
      if (t <= 0 || t > 60) return;
      const W = k.width(), mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, "0");
      const crit = t <= 30, pulse = crit ? 0.55 + 0.45 * Math.sin(k.time() * 8) : 1;
      const col = crit ? k.rgb(255, 80, 80) : k.rgb(255, 190, 80);
      k.drawText({ text: `${mm}:${ss}`, pos: k.vec2(W / 2, 64), size: crit ? 34 : 28, font: "gameFont", anchor: "center", color: col, opacity: pulse, fixed: true });
      k.drawText({ text: crit ? "STORM CLOSING — EXTRACT NOW" : "extract soon", pos: k.vec2(W / 2, crit ? 92 : 88), size: crit ? 14 : 12, font: "gameFont", anchor: "center", color: col, opacity: 0.85 * pulse, fixed: true });
    }

    // Kill feed (P8-T5): recent round events (PvP defeats, eliminations, escapes)
    // right-aligned under the minimap, fading out after a few seconds.
    function drawKillFeed() {
      const feed = net.state.killfeed;
      if (!feed || !feed.length) return;
      const now = Date.now(), SHOW = 4000, FADE = 2000;
      const x = k.width() - mmPad;
      let y = mmPad + mmSize + 14;
      for (const e of feed) {
        const age = now - (e.recvAt || now);
        if (age > SHOW + FADE) continue;
        const op = age < SHOW ? 1 : Math.max(0, 1 - (age - SHOW) / FADE);
        let text, col;
        if (e.cause === "pvp") { text = `${e.killer || "?"} defeated ${e.victim}`; col = [240, 120, 90]; }
        else if (e.cause === "extracted") { text = `${e.victim} escaped`; col = [120, 220, 150]; }
        else if (e.cause === "zone") { text = `${e.victim} lost to the storm`; col = [230, 150, 150]; }
        else if (e.cause === "timeout") { text = `${e.victim} ran out of time`; col = [200, 200, 210]; }
        else if (e.cause === "disconnect") { text = `${e.victim} disconnected`; col = [180, 180, 190]; }
        else { text = `${e.victim} is out`; col = [200, 200, 210]; }
        // Backing strip + cause tick so the feed stays legible over busy terrain
        // (was bare text). Width is approximated from the string length.
        const tw = text.length * 6.5 + 14;
        k.drawRect({ pos: k.vec2(x - tw, y - 2), width: tw, height: 16, radius: 3, color: k.rgb(...UI.panel), opacity: 0.5 * op, fixed: true });
        k.drawRect({ pos: k.vec2(x + 3, y - 2), width: 2.5, height: 16, radius: 1, color: k.rgb(col[0], col[1], col[2]), opacity: 0.95 * op, fixed: true });
        k.drawText({ text, pos: k.vec2(x - 4, y), size: 12, font: "gameFont", anchor: "topright", color: k.rgb(...col), opacity: op, fixed: true });
        y += 19;
      }
    }

    // FGT-T1: brief top-center toast when the server reports the AI combat judge is
    // offline (so engaging a monster did nothing) — surfaced instead of a silent
    // deterministic fight. Auto-fades; prod always has the judge, so this is rare.
    function drawCombatNotice() {
      const n = net.state.combatNotice;
      if (!n) return;
      const age = Date.now() - (n.at || 0), SHOW = 3000, FADE = 1200;
      if (age > SHOW + FADE) { net.state.combatNotice = null; return; }
      const op = age < SHOW ? 1 : Math.max(0, 1 - (age - SHOW) / FADE);
      const cx = k.width() / 2, y = 110, tw = Math.min(k.width() - 24, n.text.length * 7 + 28);
      k.drawRect({ pos: k.vec2(cx - tw / 2, y - 14), width: tw, height: 28, radius: 6, color: k.rgb(...UI.panel), opacity: 0.82 * op, outline: { width: 1, color: k.rgb(...UI.amber) }, fixed: true });
      k.drawText({ text: n.text, pos: k.vec2(cx, y), size: 13, font: "gameFont", anchor: "center", width: tw - 16, color: k.rgb(...UI.amber), opacity: op, fixed: true });
    }

    const JOY_R = 70;
    const joyRest = () => k.vec2(110 + safeInset.left, k.height() - 110 - safeInset.bottom); // faint idle-hint position (MB-4: clear the home-bar/notch)
    let joyId = null;
    let joyVec = { x: 0, y: 0 };
    let joyBase = joyRest(); // floating: the base spawns where the thumb lands
    let thumb = joyBase;

    function joyStart(id, p) {
      if (joyId !== null) return; // MB-3: one finger owns movement; a 2nd touch can't hijack the stick
      if (p.x > k.width() * 0.5) return; // left half only — keeps the right side free
      joyId = id;
      // Floating joystick: spawn the base under the thumb (clamped to stay on-screen)
      // rather than a fixed corner — works for any hand size / screen.
      joyBase = k.vec2(
        Math.max(JOY_R, Math.min(k.width() * 0.5, p.x)),
        Math.max(JOY_R, Math.min(k.height() - JOY_R, p.y)),
      );
      thumb = joyBase;
      joyMove(id, p);
    }
    function joyMove(id, p) {
      if (id !== joyId) return;
      let d = p.sub(joyBase);
      const len = d.len() || 1;
      if (len > JOY_R) d = d.scale(JOY_R / len);
      thumb = joyBase.add(d);
      joyVec = { x: d.x / JOY_R, y: d.y / JOY_R };
    }
    function joyEnd(id) {
      if (id !== joyId) return;
      joyId = null;
      joyVec = { x: 0, y: 0 };
      thumb = joyBase;
    }

    // Combat action buttons (shared by render + hit-testing).
    // FGT-T4: the living bench (active team minus the in-combat active, hp > 0). Names
    // come from the full active-team objects (state.team); live HP from the index-aligned
    // hp snapshot (state.self.team). The server re-validates by id, so a stale row is safe.
    function benchList() {
      const c = net.state.combat;
      const full = net.state.team || [];
      const hp = net.state.self?.team || [];
      const activeId = c?.active?.id;
      const out = [];
      full.forEach((mo, i) => {
        if (!mo || mo.id == null || mo.id === activeId) return;
        const snap = hp[i] || {};
        const cur = snap.hp != null ? snap.hp : (mo.currentHealth ?? 0);
        const max = snap.max != null ? snap.max : cur;
        if (cur > 0) out.push({ m: mo, cur, max });
      });
      return out;
    }

    function combatButtons() {
      const c = net.state.combat;
      if (!c || c.outcome || c.waiting) { swapOpen = false; return []; } // PvP: no input while awaiting the opponent
      const top = k.height() - COMBAT_H - safeInset.bottom, m = 12, gap = 8, h = 54; // larger, touch-friendly targets (MB-4: above the home-bar)
      const y = top + 100; // below the two stat rows
      // FGT-T4: Swap sub-menu — pick a living bench monster to switch to (free action).
      if (swapOpen) {
        const fw = k.width() - m * 2;
        const bench = benchList().slice(0, 3);
        const btns = bench.map((b, i) => ({
          rect: [m, y + i * (h + gap), fw, h],
          label: `Swap to ${trunc(b.m.name || b.m.typeName, 16)}  Lv.${b.m.level}  (${b.cur}/${b.max})`,
          action: { kind: "swap", monsterId: b.m.id },
        }));
        btns.push({ rect: [m, y + bench.length * (h + gap), fw, h], label: "Back", action: { kind: "closeSwap" } });
        return btns;
      }
      const energy = c.active?.currentEnergy ?? 0;
      const atks = (c.attacks || []).slice(0, 4);
      const w = (k.width() - m * 2 - gap * 3) / 4;
      const btns = atks.map((a, i) => ({
        rect: [m + i * (w + gap), y, w, h], label: cleanAttackName(a.name), // CN-7: display strip
        element: a.element, cost: a.energyCost,
        affordable: (a.energyCost ?? 0) <= energy,
        action: { kind: "attack", attackName: a.name }, // keep the FULL name as the server lookup key
      }));
      // Action row: Catch · Swap · Flee (PvE) / Swap · Flee (PvP). Swap appears only when
      // a living bench monster exists; the row splits evenly to fit 2 or 3 buttons.
      const y2 = y + h + gap;
      const row = [];
      if (!c.pvp) row.push({ label: "Catch", action: { kind: "catch" } });
      if (benchList().length > 0) row.push({ label: "Swap", action: { kind: "openSwap" } });
      row.push({ label: "Flee", action: { kind: "flee" } });
      const rw = (k.width() - m * 2 - gap * (row.length - 1)) / row.length;
      row.forEach((r, i) => btns.push({ rect: [m + i * (rw + gap), y2, rw, h], label: r.label, action: r.action }));
      return btns;
    }
    function hitButton(p) {
      for (const b of combatButtons()) {
        const [x, y, w, h] = b.rect;
        if (p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h) return b.action;
      }
      return null;
    }

    let sendAcc = 0, pingAcc = 0, safeAcc = 0;
    let combatPress = null; // { kind, name, t } — brief tap-feedback flash on combat buttons
    let swapOpen = false; // FGT-T4: the combat "Swap" sub-menu (pick a living bench monster) is open
    let prevEnemyHp = null, prevActiveHp = null, hitFlashE = -9, hitFlashA = -9, lastCombatId = null, caughtFxDone = false; // combat hit-flash + catch sparkle
    let dmgFloaters = []; // floating damage numbers — { x, y, dmg, col:[r,g,b], t0 }
    clearFx(); // reset the shared particle pool on (re)entry (PV-T12)
    k.onUpdate(() => {
      updateFx(k.dt()); // advance world particles (PV-T12)
      // Latency probe every 2s while connected (drives the HUD ping readout).
      pingAcc += k.dt();
      if (pingAcc >= 2 && net.state.connected) { net.ping(); pingAcc = 0; }
      // MB-4: refresh safe-area insets on a throttle (cheap; touch only) so a mid-round
      // rotation or mobile URL-bar show/hide re-flows the touch HUD within ~1s.
      if (TOUCH) { safeAcc += k.dt(); if (safeAcc >= 1) { recomputeSafeInset(); safeAcc = 0; } }

      let dx = 0, dy = 0;
      if (k.isKeyDown("w") || k.isKeyDown("up")) dy = -1;
      if (k.isKeyDown("s") || k.isKeyDown("down")) dy = 1;
      if (k.isKeyDown("a") || k.isKeyDown("left")) dx = -1;
      if (k.isKeyDown("d") || k.isKeyDown("right")) dx = 1;
      if (net.state.combat) { joyId = null; joyVec = { x: 0, y: 0 }; thumb = joyRest(); } // no joystick mid-fight (was `JOY`, undefined → crashed combat)
      else if (joyVec.x || joyVec.y) { dx = joyVec.x; dy = joyVec.y; } // joystick overrides keys
      if (!net.state.combat) { const gm = gamepadMove(); if (gm.x || gm.y) { dx = gm.x; dy = gm.y; } } // gamepad stick/d-pad (roaming)
      selfMoving = !!(dx || dy);
      if (dx || dy) selfDir = { x: dx, y: dy };
      if (onboard && (dx || dy) && onboardT > 0.3) dismissOnboard(); // P8-T8: move to begin
      // Hold Shift to sprint (server validates against stamina). Send continuously
      // while held (server consumes one intent per tick), ~20Hz.
      const sprint = k.isKeyDown("shift");
      sendAcc += k.dt();
      if (!menuOpen && (dx || dy) && sendAcc >= 0.05) { net.move(dx, dy, sprint); sendAcc = 0; }
      // Throttled footstep while actually roaming (subtle; user-requested SFX).
      // Faster cadence when sprinting. Gated off menu/combat so it only plays in-world.
      stepAcc += k.dt();
      if (selfMoving && !menuOpen && !net.state.combat && stepAcc >= (sprint ? 0.24 : 0.34)) {
        sfx("step"); stepAcc = 0;
        emit({ x: selfRender.x, y: selfRender.y + 16, n: 3, color: [150, 140, 122], speed: 16, life: 0.4, size: 2.6, spread: Math.PI * 0.9, dir: -Math.PI / 2, gravity: 30, drag: 2 }); // PV-T12 footstep dust
      }

      // Interaction SFX via state-diffs (no server event needed): level-up = a
      // team monster's level rose; chest-open = a chest right next to you vanished
      // (the <56px gate excludes chests that merely scrolled out of view range).
      const myTeam = net.state.self?.team;
      if (myTeam) for (const mon of myTeam) {
        if (!mon || mon.id == null) continue;
        const pl = prevLevels.get(mon.id);
        if (pl != null && mon.level > pl) { sfx("levelup"); emit({ x: selfRender.x, y: selfRender.y, n: 14, color: [255, 220, 120], speed: 70, life: 0.7, size: 3, gravity: -40, drag: 1.5 }); emitText({ x: selfRender.x, y: selfRender.y - 22, text: `${mon.name || "Monster"} Lv ${mon.level}`, color: [255, 224, 130], size: 13 }); } // PV-T12 level-up burst + label (PT2-T07)
        prevLevels.set(mon.id, mon.level);
      }
      const curChests = net.state.chests || [];
      if (prevChests && prevChests !== curChests) { // only diff when the snapshot replaced the array
        const sx = net.state.self.x, sy = net.state.self.y;
        for (const pc of prevChests) {
          if (!curChests.some((c) => c.x === pc.x && c.y === pc.y) && Math.hypot(pc.x - sx, pc.y - sy) < 56) { sfx("chest"); emit({ x: pc.x, y: pc.y, n: 12, color: [245, 210, 90], speed: 55, life: 0.6, size: 2.8, gravity: -30, drag: 1.5 }); emitText({ x: pc.x, y: pc.y - 18, text: "Chest opened!", color: [245, 214, 110], size: 14 }); } // PV-T12 chest-open sparkle + label (PT2-T07)
        }
      }
      prevChests = curChests;

      // Storm-damage hit feedback (PV-T13): the continuous danger border tells you
      // you're *in* danger, but nothing marked the *moment* the storm actually drained
      // HP. Detect a team-HP drop while you're outside the safe circle (and not in a
      // duel, so combat damage isn't misattributed) → discrete red flash + burst +
      // haptic + a "STORM -N" floater. State-diff only, no extra snapshot payload.
      {
        const cir = net.state.circle, sf = net.state.self;
        const curTeamHp = (sf?.team || []).reduce((s, mo) => s + Math.max(0, mo.hp || 0), 0);
        const outside = !!(cir && sf && !net.state.combat && !net.state.roundResult &&
          ((sf.x - cir.x) ** 2 + (sf.y - cir.y) ** 2) > cir.r * cir.r);
        if (outside && prevTeamHp != null && curTeamHp < prevTeamHp) {
          stormHitT = k.time();
          haptic(20);
          const dmg = Math.round(prevTeamHp - curTeamHp);
          emit({ x: selfRender.x, y: selfRender.y, n: 10, color: [235, 70, 70], speed: 80, life: 0.5, size: 2.8, gravity: -10, drag: 2 });
          emitText({ x: selfRender.x, y: selfRender.y - 22, text: `STORM -${dmg}`, color: [255, 120, 120], size: 14 });
        }
        prevTeamHp = curTeamHp;
      }

      // Controller actions (gamepad): map buttons to the SAME handlers as keyboard.
      // Edge-detected, so gamepadPressed() must run exactly once per frame. Bindings:
      // A/B/X/Y = attack 1-4 in combat (A = throw chain while roaming), LB = catch,
      // RB = flee. Menus + SP fight not wired yet (follow-up).
      const gpEdges = gamepadPressed();
      if (gpEdges.size && !menuOpen) {
        if (onboard && onboardT > 0.3) dismissOnboard();
        else if (net.state.combat) {
          for (let i = 0; i < 4; i++) if (gpEdges.has(i)) { const a = net.state.combat.attacks?.[i]; if (a) act({ kind: "attack", attackName: a.name }); }
          if (gpEdges.has(BTN.LB)) act({ kind: "catch" });
          if (gpEdges.has(BTN.RB)) act({ kind: "flee" });
        } else if (!net.state.roundResult && (gpEdges.has(BTN.A) || gpEdges.has(BTN.RT))) {
          const e = equippedChain();
          if (e) net.throwChain(selfDir, e.cs.chainId);
        }
      }

      // Interpolate render positions toward the latest server state.
      const a = Math.min(1, k.dt() * 14);
      selfRender.x = lerp(selfRender.x, net.state.self.x, a);
      selfRender.y = lerp(selfRender.y, net.state.self.y, a);
      const seen = new Set();
      for (const p of net.state.players) {
        seen.add(p.id);
        let r = othersRender.get(p.id);
        if (!r) { r = { x: p.x, y: p.y, moving: false, dir: { x: 0, y: 1 } }; othersRender.set(p.id, r); }
        const ddx = p.x - r.x, ddy = p.y - r.y;
        r.moving = Math.abs(ddx) + Math.abs(ddy) > 1.5;
        if (r.moving) r.dir = { x: ddx, y: ddy };
        r.x = lerp(r.x, p.x, a);
        r.y = lerp(r.y, p.y, a);
      }
      for (const id of [...othersRender.keys()]) if (!seen.has(id)) othersRender.delete(id);

      // Spirit-chain projectiles: extrapolate from the authoritative position by
      // velocity for smooth flight between half-rate snapshots, nudging toward truth.
      const pseen = new Set();
      for (const pr of net.state.projectiles) {
        pseen.add(pr.id);
        let r = projRender.get(pr.id);
        if (!r) { r = { x: pr.x, y: pr.y }; projRender.set(pr.id, r); }
        r.x = lerp(r.x + pr.vx * k.dt(), pr.x, 0.2);
        r.y = lerp(r.y + pr.vy * k.dt(), pr.y, 0.2);
        r.vx = pr.vx; r.vy = pr.vy; r.chainId = pr.chainId;
      }
      for (const id of [...projRender.keys()]) if (!pseen.has(id)) projRender.delete(id);

      k.camPos(selfRender.x, selfRender.y);
      const t = net.state.time || 0;
      const mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, "0");
      const ping = net.state.rtt == null ? "" : `   ${net.state.rtt}ms`;
      // P6-T3 player list: name the rivals currently in view. AoI-filtered, so it
      // respects the "you only see those near you" design (Q13) — no full roster.
      const rivals = net.state.players || [];
      const rivalLine = rivals.length
        ? `Rivals in view (${rivals.length}): ${rivals.slice(0, 4).map((p) => p.name || "?").join(", ")}${rivals.length > 4 ? `, +${rivals.length - 4}` : ""}`
        : "No rivals in view";
      // VS-8: keep gameplay info (timer/ping/name/rivals) but hide debug data
      // (map seed + live coords) in production — seed leaks map knowledge.
      const dev = import.meta.env.DEV;
      info.text =
        `Online   ${mm}:${ss} left${ping}${dev ? `   seed ${net.state.seed ?? "?"}` : ""}\n` +
        `You (${net.state.nickname ?? "?"})${dev ? `: (${Math.round(net.state.self.x)}, ${Math.round(net.state.self.y)})` : ""}\n` +
        rivalLine;

      // PT2-T10 objective line: contextual goal, hidden behind overlays.
      const circle = net.state.circle, self = net.state.self;
      const outsideZone = !!(circle && self && ((self.x - circle.x) ** 2 + (self.y - circle.y) ** 2) > circle.r * circle.r);
      objective.text = objectiveText({ circleStarted: !!circle, portalsOpen: (net.state.portals || []).length > 0, outsideZone });
      objective.hidden = !!(net.state.combat || net.state.roundResult);

      // Hide the movement hint behind the combat / result overlays.
      hint.hidden = !!(net.state.combat || net.state.roundResult);

      // Clear the "Resolving…" indicator once a turn result / end arrives.
      const cb = net.state.combat;
      if (cb) { if (cb.log.length !== lastLogLen || cb.outcome) { awaiting = false; lastLogLen = cb.log.length; } }
      else { awaiting = false; lastLogLen = 0; }
    });

    k.onDraw(() => {
      // Seeded map — culled floor, now textured per tile type + rotation
      // (src/render/tiles.js) instead of flat color rects.
      revealAround(); // fog of war: reveal the disc around the player this frame
      drawTiles(k, map, net.state.self.x, net.state.self.y, tileCache, GAME.EFFECTIVE_TILE, isExplored);

      // Safe zone (shrinking) + extraction portals.
      // Storm wall (PV-T13): the closing safe-zone edge reads as a glowing, pulsing
      // energy barrier — an outward glow band fading into the storm + a bright pulsing
      // inner edge — instead of one flat thin outline.
      if (net.state.circle) {
        // a11y: freeze the storm-wall breathing pulse under reduce-motion — the
        // barrier stays fully visible (a critical danger landmark), just steady.
        const reduce = prefersReducedMotion();
        const c = net.state.circle, pulse = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(k.time() * 3);
        for (let i = 3; i >= 1; i--) {
          k.drawCircle({ pos: k.vec2(c.x, c.y), radius: c.r + i * 7, fill: false, outline: { width: 4, color: k.rgb(110, 160, 255) }, opacity: (0.30 - i * 0.07) * pulse });
        }
        k.drawCircle({ pos: k.vec2(c.x, c.y), radius: c.r, fill: false, outline: { width: 3, color: k.rgb(180, 220, 255) }, opacity: reduce ? 0.7 : 0.55 + 0.25 * Math.sin(k.time() * 3) });
      }
      for (const p of net.state.portals) {
        // First-seen time (client-side) drives the rise-from-the-ground animation
        // when a portal pops into the snapshot.
        const key = `${p.x},${p.y}`;
        let born = portalSeen.get(key);
        if (born == null) { born = k.time(); portalSeen.set(key, born); }
        drawPortal(k, { x: p.x, y: p.y, t: k.time(), age: k.time() - born });
      }

      const now = k.time();
      // Loot chests sit on the ground — drawn under the entities.
      for (const c of net.state.chests) drawChest(k, { x: c.x, y: c.y, t: now });

      // Y-sorted entities (monsters + other players + you): nearer (lower y) draw
      // on top of farther (higher y) ones, so overlaps read as depth rather than
      // array/draw order (P-natural top-down look).
      const ents = [];
      const reduceMo = prefersReducedMotion(); // a11y: once per frame, freeze the idle bob
      for (const mo of net.state.monsters) {
        const slug = mo.typeName.toLowerCase().replace(/\s+/g, "_");
        ents.push({ y: mo.y, draw: () => {
          const idle = reduceMo ? 0 : Math.sin(now * 2 + (mo.x + mo.y) * 0.013); // PV-T14: gentle idle bob + breath (per-monster phase)
          k.drawEllipse({ pos: k.vec2(mo.x, mo.y + 20), radiusX: 15, radiusY: 5, color: k.rgb(0, 0, 0), opacity: 0.28 }); // ground shadow (stays put)
          try { k.drawSprite({ sprite: slug, pos: k.vec2(mo.x, mo.y + idle * 2), anchor: "center", scale: 0.45 * (1 + idle * 0.03) }); }
          catch { k.drawCircle({ pos: k.vec2(mo.x, mo.y), radius: 8, color: k.rgb(220, 180, 80) }); }
        } });
      }
      for (const p of net.state.players) {
        const r = othersRender.get(p.id) || p;
        ents.push({ y: r.y, draw: () => {
          drawCharacter(k, { x: r.x, y: r.y, t: now + (p.id ? p.id.length : 0), moving: r.moving, color: [210, 90, 90], dir: r.dir, skin: getSkin(p.skinId) }); // CN-12: rival's own skin
          k.drawText({ text: p.name || "?", pos: k.vec2(r.x, r.y - 40), size: 12, font: "gameFont", anchor: "center", color: k.rgb(...UI.text) });
        } });
      }
      ents.push({ y: selfRender.y, draw: () => {
        const meCos = getEquippedCharacterSkin(); // your character cosmetic (accent + cloak) — mirrors SP; safe for self (camera-centered, no self/rival color-coding to preserve)
        drawCharacter(k, { x: selfRender.x, y: selfRender.y, t: now, moving: selfMoving, color: meCos.accent, cloak: meCos.cloak, dir: selfDir, skin: getEquippedSkin() });
        k.drawText({ text: net.state.nickname || "You", pos: k.vec2(selfRender.x, selfRender.y - 40), size: 12, font: "gameFont", anchor: "center", color: k.rgb(...UI.text) });
      } });
      ents.sort((a, b) => a.y - b.y);
      for (const e of ents) e.draw();
      drawFx(k); // world particles (footstep dust, etc.) — over the floor, under the HUD (PV-T12)

      // Aim telegraph + in-flight spirit chains (in-air — over the entities). Skip during combat/results.
      if (!net.state.combat && !net.state.roundResult) drawAim(now);
      for (const pr of projRender.values()) {
        drawSpiritChainProjectile(k, pr, chainColor(getSpiritChain(pr.chainId)), now);
      }

      // Atmosphere overlay (vignette + spirit-light + motes) — over the world,
      // under the HUD. Skipped during combat (its own panel) and results. Outside
      // the safe zone (same test as drawDanger), pass danger=1 so the spirit-glow
      // reddens — parity with SP's storm atmosphere (the explicit border/warning
      // still draws on top via drawDanger).
      if (!net.state.combat && !net.state.roundResult) {
        const cc = net.state.circle, sf = net.state.self;
        let dgr = 0;
        if (cc && sf) { const ex = sf.x - cc.x, ey = sf.y - cc.y; if (ex * ex + ey * ey > cc.r * cc.r) dgr = 1; }
        drawAtmosphere(k, { t: now, danger: dgr });
      }

      // Virtual joystick (touch) — left side, hidden during combat / results.
      if (TOUCH && !net.state.combat && !net.state.roundResult) {
        const joyActive = joyId !== null;
        const joyDrawBase = joyActive ? joyBase : joyRest(); // faint hint at rest; ring under thumb when active
        k.drawCircle({ pos: joyDrawBase, radius: JOY_R, color: k.rgb(255, 255, 255), opacity: joyActive ? 0.12 : 0.05, fixed: true });
        k.drawCircle({ pos: joyDrawBase, radius: JOY_R, fill: false, outline: { width: 2, color: k.rgb(255, 255, 255) }, opacity: joyActive ? 0.4 : 0.15, fixed: true });
        if (joyActive) k.drawCircle({ pos: thumb, radius: 30, color: k.rgb(120, 190, 255), opacity: 0.55, fixed: true }); // press feedback
        // Touch THROW button (right thumb) — fixes the mobile gap where a chain
        // could only be thrown via the keyboard (Space/Q). Dimmed when no chain is equipped.
        const eqc = equippedChain();
        const hasChain = !!eqc;
        const throwsLeft = eqc && eqc.cs && eqc.cs.throwCount != null ? eqc.cs.throwCount : null;
        const tb = throwBtnC();
        k.drawCircle({ pos: tb, radius: THROW_R, color: k.rgb(90, 170, 255), opacity: hasChain ? 0.32 : 0.12, fixed: true });
        k.drawCircle({ pos: tb, radius: THROW_R, fill: false, outline: { width: 2, color: k.rgb(120, 190, 255) }, opacity: hasChain ? 0.7 : 0.25, fixed: true });
        k.drawText({ text: "THROW", pos: k.vec2(tb.x, tb.y - (throwsLeft != null ? 7 : 0)), size: 13, font: "gameFont", anchor: "center", color: k.rgb(255, 255, 255), opacity: hasChain ? 0.9 : 0.4, fixed: true });
        if (throwsLeft != null) k.drawText({ text: `${throwsLeft} left`, pos: k.vec2(tb.x, tb.y + 9), size: 11, font: "gameFont", anchor: "center", color: k.rgb(185, 212, 255), opacity: hasChain ? 0.9 : 0.4, fixed: true });
        // MB-11: touch pause button (top-center) — opens the pause/leave menu.
        if (!onboard) {
          const [pbx, pby, pbw, pbh] = pauseBtnRect();
          k.drawRect({ pos: k.vec2(pbx, pby), width: pbw, height: pbh, radius: 8, color: k.rgb(8, 10, 16), opacity: 0.6, outline: { width: 1, color: k.rgb(120, 130, 150) }, fixed: true });
          k.drawRect({ pos: k.vec2(pbx + pbw / 2 - 7, pby + 9), width: 5, height: pbh - 18, radius: 1, color: k.rgb(220, 225, 235), fixed: true });
          k.drawRect({ pos: k.vec2(pbx + pbw / 2 + 2, pby + 9), width: 5, height: pbh - 18, radius: 1, color: k.rgb(220, 225, 235), fixed: true });
        }
      }

      // Minimap + team HP + danger warning (hidden behind the round-result overlay).
      if (!net.state.roundResult) drawMinimap();
      if (!net.state.roundResult) drawTeamHp();
      if (!net.state.combat && !net.state.roundResult) drawChainHud();
      if (!net.state.combat && !net.state.roundResult && !onboard) drawBiomeChip(k, { x: k.width() / 2, y: k.height() - 34, map, wx: selfRender.x, wy: selfRender.y }); // PT1-T18
      if (!net.state.roundResult) drawKillFeed();
      drawCombatNotice(); // FGT-T1: transient "combat judge offline" toast
      if (onboard && !net.state.combat && !net.state.roundResult) drawOnboarding(); // P8-T8 overlay over the HUD
      if (!net.state.combat && !net.state.roundResult) drawDanger();
      if (!net.state.roundResult) drawStormHit(); // PV-T13: discrete storm-damage flash (fades even after re-entering the zone)
      if (!net.state.combat && !net.state.roundResult && !menuOpen && !onboard) drawPortalCompass();
      if (!net.state.combat && !net.state.roundResult && !menuOpen && !onboard) drawTimeWarning();

      // Combat overlay (server locks movement during a fight). Tappable buttons;
      // keyboard 1-4 / C / F still work on desktop.
      const c = net.state.combat;
      if (c) {
        // MB-4: content anchors `safeInset.bottom` above the screen edge (so the
        // buttons/log clear the home-bar); the background fill (height H) still spans
        // down to the very bottom behind it. At zero insets this is the old layout.
        const top = k.height() - COMBAT_H - safeInset.bottom, H = COMBAT_H + safeInset.bottom, m = 12, W = k.width() - m * 2;
        // Hit-flash bookkeeping: flash a row when its HP drops; reset per-side trackers
        // on a new combat so a stale value can't false-trigger on the first frame.
        const tF = k.time();
        if (c.combatId !== lastCombatId) { prevEnemyHp = prevActiveHp = null; caughtFxDone = false; dmgFloaters = []; lastCombatId = c.combatId; }
        if (c.enemy && prevEnemyHp != null && c.enemy.currentHealth < prevEnemyHp) { hitFlashE = tF; emit({ x: k.width() / 2, y: top + 26, n: 8, color: [255, 180, 120], speed: 110, life: 0.4, size: 2.5, drag: 2, fixed: true }); dmgFloaters.push({ x: k.width() - 92, y: top + 18, dmg: Math.round(prevEnemyHp - c.enemy.currentHealth), col: [255, 210, 90], t0: tF }); } // hit-sparks + damage number
        if (c.enemy && prevEnemyHp != null && c.enemy.currentHealth > prevEnemyHp) dmgFloaters.push({ x: k.width() - 92, y: top + 18, dmg: Math.round(c.enemy.currentHealth - prevEnemyHp), col: [120, 230, 150], t0: tF, heal: true }); // VS-22: heal +N
        prevEnemyHp = c.enemy ? c.enemy.currentHealth : null;
        if (c.active && prevActiveHp != null && c.active.currentHealth < prevActiveHp) { hitFlashA = tF; haptic(15); emit({ x: k.width() / 2, y: top + 68, n: 8, color: [255, 180, 120], speed: 110, life: 0.4, size: 2.5, drag: 2, fixed: true }); dmgFloaters.push({ x: k.width() - 92, y: top + 60, dmg: Math.round(prevActiveHp - c.active.currentHealth), col: [255, 90, 90], t0: tF }); } // hit-sparks + haptic + damage number
        if (c.active && prevActiveHp != null && c.active.currentHealth > prevActiveHp) dmgFloaters.push({ x: k.width() - 92, y: top + 60, dmg: Math.round(c.active.currentHealth - prevActiveHp), col: [120, 230, 150], t0: tF, heal: true }); // VS-22: heal +N
        prevActiveHp = c.active ? c.active.currentHealth : null;
        const eF = Math.max(0, 1 - (tF - hitFlashE) / 0.3), aF = Math.max(0, 1 - (tF - hitFlashA) / 0.3);
        // Catch-success sparkle (PV-T12, screen-space) — the taming payoff; burst once at the captured row.
        if (c.outcome === "caught" && !caughtFxDone) { caughtFxDone = true; haptic([0, 30, 40, 60]); emit({ x: k.width() / 2, y: top + 26, n: 22, color: [120, 240, 255], speed: 95, life: 0.85, size: 3, gravity: -25, drag: 1.5, fixed: true }); } // MB-12: catch-success buzz
        k.drawRect({ pos: k.vec2(0, top), width: k.width(), height: H, color: k.rgb(...UI.panel), opacity: 0.94, fixed: true });
        const enemyTitle = c.pvp ? `${c.opponent || "Rival"}: ${c.enemy.typeName}` : `Wild ${c.enemy.typeName}`;
        drawCombatant(c.enemy, top + 8, enemyTitle, m, W, eF, "enemy");
        drawCombatant(c.active, top + 50, c.active.name, m, W, aF, "self");
        const nowC = k.time();
        // Input is locked while the AI judge resolves the turn (~1-2s) or we await a
        // PvP opponent's move — dim the action buttons so they read as inactive
        // (taps are no-ops here) rather than looking live but doing nothing.
        const inputLocked = !c.outcome && (awaiting || c.waiting);
        const lockDim = inputLocked ? 0.4 : 1;
        for (const b of combatButtons()) {
          const [x, y, w, h] = b.rect;
          const aff = b.affordable !== false;
          const accent = b.element ? elemColor(b.element) : [120, 150, 200];
          // Element-tinted dark fill so each attack reads as its element (catch/flee stay neutral slate).
          const base = b.element ? [40 + (accent[0] - 40) * 0.22, 55 + (accent[1] - 55) * 0.22, 80 + (accent[2] - 80) * 0.22] : [40, 55, 80];
          // Brief press-flash on the just-tapped button (tap feedback the mobile controls lacked).
          const pressed = combatPress && combatPress.kind === b.action.kind && combatPress.name === (b.action.attackName || b.action.kind) && nowC - combatPress.t < 0.18;
          const fill = pressed ? base.map((v) => Math.min(255, v + 60)) : base;
          k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius: 8, color: k.rgb(fill[0], fill[1], fill[2]), opacity: (aff ? 1 : 0.45) * lockDim, outline: { width: pressed ? 3 : 2, color: k.rgb(accent[0], accent[1], accent[2]) }, fixed: true });
          k.drawText({ text: b.label, pos: k.vec2(x + w / 2, y + (b.cost != null ? h / 2 - 7 : h / 2)), size: 14, font: "gameFont", anchor: "center", color: k.rgb(...UI.text), width: w - 10, opacity: (aff ? 1 : 0.55) * lockDim, fixed: true });
          if (b.cost != null) k.drawText({ text: `EN ${b.cost}`, pos: k.vec2(x + w / 2, y + h - 13), size: 11, font: "gameFont", anchor: "center", color: k.rgb(...UI.body), opacity: (aff ? 0.9 : 0.45) * lockDim, fixed: true });
        }
        const last = c.log[c.log.length - 1] || (c.pvp ? "A rival challenges you!" : "A wild monster appeared!");
        const line = c.outcome ? `${last}  —  ${c.outcome.toUpperCase()}!  (tap / space)` : last;
        k.drawText({ text: line, pos: k.vec2(m, top + COMBAT_H - 24), size: 13, font: "gameFont", width: W, color: k.rgb(...UI.text), fixed: true }); // MB-4: content-bottom, not the home-bar-inflated H
        // Core-loop latency feedback: AI-resolved combat takes ~1-2s. A single small
        // "Resolving…" line was easy to miss (combat looked frozen / taps felt dead),
        // so show a prominent animated badge (spinner + label) centered on the dimmed
        // buttons while input is locked — for both the AI turn and the PvP wait.
        if (inputLocked) {
          const bx = k.width() / 2, by = top + 158, bw = 232, bh = 44;
          k.drawRect({ pos: k.vec2(bx, by), width: bw, height: bh, radius: 12, anchor: "center", color: k.rgb(...UI.panel), opacity: 0.9, outline: { width: 1, color: k.rgb(...UI.line) }, fixed: true });
          const sr = 11, sx = bx - 82, sn = 8, head = (k.time() * 1.5) % 1; // 8-dot rotating spinner
          for (let i = 0; i < sn; i++) {
            const a = (i / sn) * Math.PI * 2 - Math.PI / 2;
            let d = i / sn - head; d -= Math.floor(d); // 0..1 trailing distance behind the head
            k.drawCircle({ pos: k.vec2(sx + Math.cos(a) * sr, by + Math.sin(a) * sr), radius: 2.2, color: k.rgb(150, 200, 255), opacity: 0.15 + 0.85 * (1 - d), fixed: true });
          }
          k.drawText({ text: c.waiting ? "Waiting for opponent…" : "Resolving turn…", pos: k.vec2(bx + 18, by), size: 15, font: "gameFont", anchor: "center", color: k.rgb(...UI.body), fixed: true });
        }
        // Floating damage/heal numbers — make each hit's magnitude readable (was only
        // an HP-bar change). Rise + fade over ~0.8s; -N amber on the enemy / red on
        // you, +N green for heals (CB-2 heal moves).
        const DMG_LIFE = 0.8;
        dmgFloaters = dmgFloaters.filter((f) => tF - f.t0 < DMG_LIFE);
        for (const f of dmgFloaters) {
          if (f.dmg <= 0) continue;
          const age = tF - f.t0, op = 1 - age / DMG_LIFE;
          k.drawText({ text: `${f.heal ? "+" : "-"}${f.dmg}`, pos: k.vec2(f.x, f.y - age * 34), size: 18, font: "gameFont", anchor: "center", color: k.rgb(f.col[0], f.col[1], f.col[2]), opacity: op, fixed: true });
        }
        drawFxScreen(k); // screen-space particles (catch sparkle) over the combat panel (PV-T12)
      }

      // ESC pause/settings overlay (drawn over everything; world keeps running).
      if (menuOpen && !net.state.roundResult) {
        k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: k.rgb(0, 0, 0), opacity: 0.72, fixed: true });
        k.drawText({ text: "PAUSED", pos: k.vec2(k.width() / 2, k.height() / 2 - 130), size: 44, font: "gameFont", anchor: "center", color: k.rgb(245, 215, 120), fixed: true });
        for (const b of menuBtns()) {
          const [x, y, w, h] = b.rect;
          k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius: 10, color: k.rgb(40, 55, 80), outline: { width: 2, color: k.rgb(120, 150, 200) }, fixed: true });
          k.drawText({ text: b.label, pos: k.vec2(x + w / 2, y + h / 2), size: 20, font: "gameFont", anchor: "center", color: k.rgb(...UI.text), fixed: true });
        }
        k.drawText({ text: "ESC to resume — the round keeps going", pos: k.vec2(k.width() / 2, k.height() / 2 + 130), size: 13, font: "gameFont", anchor: "center", color: k.rgb(...UI.mut), fixed: true });
      }

      // Round result (extracted / died) overlay.
      const rr = net.state.roundResult;
      if (rr) {
        k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: k.rgb(0, 0, 0), opacity: 0.7, fixed: true });
        const win = rr.outcome === "extracted";
        const accent = win ? [120, 230, 150] : [230, 120, 120];
        // Result card — frames the outcome as a designed screen (win/loss-tinted
        // border + top accent bar) instead of text floating on the scrim.
        const cardX = k.width() / 2, cardY = k.height() / 2 + 18, cardW = 600, cardH = 232;
        k.drawRect({ pos: k.vec2(cardX, cardY), width: cardW, height: cardH, radius: 18, anchor: "center", color: k.rgb(...UI.panel), opacity: 0.95, outline: { width: 2, color: k.rgb(accent[0], accent[1], accent[2]) }, fixed: true });
        k.drawRect({ pos: k.vec2(cardX, cardY - cardH / 2 + 5), width: cardW - 26, height: 4, radius: 2, anchor: "center", color: k.rgb(accent[0], accent[1], accent[2]), opacity: 0.9, fixed: true });
        k.drawText({ text: win ? "EXTRACTED!" : "RUN OVER", pos: k.vec2(k.width() / 2, k.height() / 2 - 30), size: 48, font: "gameFont", anchor: "center", color: k.rgb(accent[0], accent[1], accent[2]), fixed: true });
        k.drawText({ text: `${rr.reason}     tap / space to return`, pos: k.vec2(k.width() / 2, k.height() / 2 + 30), size: 18, font: "gameFont", anchor: "center", color: k.rgb(...UI.text), fixed: true });
        // P8-T3: per-run gains summary (caught / XP / level-ups / survival time).
        const g = rr.gains;
        if (g) {
          const parts = [];
          if (g.caught) parts.push(`Caught ${g.caught}`);
          if (g.xpGained) parts.push(`+${g.xpGained} XP`);
          if (g.levelUps) parts.push(`${g.levelUps} level-up${g.levelUps > 1 ? "s" : ""}`);
          parts.push(`survived ${Math.floor((g.survivedS || 0) / 60)}:${String((g.survivedS || 0) % 60).padStart(2, "0")}`);
          k.drawText({ text: "THIS RUN     " + parts.join("     "), pos: k.vec2(k.width() / 2, k.height() / 2 + 62), size: 15, font: "gameFont", anchor: "center", color: k.rgb(245, 215, 120), fixed: true });
        }
        const st = net.state.stats || {};
        k.drawText({ text: `LIFETIME     Extractions ${st.extractions || 0}     Deaths ${st.deaths || 0}     Caught ${st.caught || 0}     PvP wins ${st.pvpWins || 0}     Runs ${st.runs || 0}`, pos: k.vec2(k.width() / 2, k.height() / 2 + 92), size: 14, font: "gameFont", anchor: "center", color: k.rgb(...UI.mut), fixed: true });
      }

      // Dropped connection: auto-reconnect resumes the round within the server's
      // 120s grace (P6-T1/Q12). Show "Reconnecting…" while retrying; only offer the
      // bail-to-menu once we've given up.
      if (!net.state.connected) {
        const reconnecting = net.state.reconnecting;
        k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: k.rgb(0, 0, 0), opacity: reconnecting ? 0.62 : 0.82, fixed: true });
        k.drawText({ text: reconnecting ? "RECONNECTING…" : "CONNECTION LOST", pos: k.vec2(k.width() / 2, k.height() / 2 - 24), size: 38, font: "gameFont", anchor: "center", color: reconnecting ? k.rgb(245, 215, 120) : k.rgb(230, 120, 120), fixed: true });
        k.drawText({ text: reconnecting ? "resuming your run…" : "tap / space to return to the menu", pos: k.vec2(k.width() / 2, k.height() / 2 + 28), size: 18, font: "gameFont", anchor: "center", color: k.rgb(...UI.text), fixed: true });
      }

      // Extraction climax (PV juice — MP parity with SP game.js): a flash burst the
      // moment you escape, over the result card. One-time transient, but a full-
      // screen white-out → skip it under reduce-motion (photosensitivity).
      const rrf = net.state.roundResult;
      if (rrf && rrf.outcome === "extracted" && extractFlashT == null && !prefersReducedMotion()) extractFlashT = k.time();
      if (extractFlashT != null) {
        const fp = (k.time() - extractFlashT) / 0.6;
        if (fp < 1) drawExtractFlash(k, { x: k.width() / 2, y: k.height() / 2, p: fp });
      }
    });

    // Combat controls (movement is locked server-side during a fight).
    const act = (action) => {
      if (!action) return;
      // FGT-T4: open/close the Swap picker locally (no server round-trip).
      if (action.kind === "openSwap") { if (benchList().length) { swapOpen = true; haptic(8); } return; }
      if (action.kind === "closeSwap") { swapOpen = false; haptic(8); return; }
      const c = net.state.combat;
      if (c && !c.outcome && !c.waiting && !awaiting) {
        awaiting = true;
        combatPress = { kind: action.kind, name: action.attackName || action.kind, t: k.time() }; // tap feedback
        haptic(8); // MB-12: tactile combat-action tap
        if (action.kind === "swap") swapOpen = false; // leaving the picker on a pick
        net.combatAction(action);
      }
    };
    for (const n of [1, 2, 3, 4]) {
      k.onKeyPress(String(n), () => {
        if (swapOpen) { const b = benchList()[n - 1]; if (b) act({ kind: "swap", monsterId: b.m.id }); return; } // pick a bench monster
        const a = net.state.combat?.attacks?.[n - 1];
        if (a) act({ kind: "attack", attackName: a.name });
      });
    }
    k.onKeyPress("c", () => act({ kind: "catch" }));
    k.onKeyPress("f", () => act({ kind: "flee" }));
    k.onKeyPress("x", () => { if (net.state.combat && !net.state.combat.outcome) act({ kind: swapOpen ? "closeSwap" : "openSwap" }); }); // FGT-T4: toggle Swap picker

    // Throw the equipped spirit chain along the current heading (engages combat /
    // PvP on hit). Cycle the equipped chain with [ / ]. Only while roaming.
    // PT1-T06: Space is the primary throw key; Q kept as a legacy alias.
    const throwEquippedChain = () => {
      if (net.state.combat || net.state.roundResult) return;
      const e = equippedChain();
      if (e) net.throwChain(selfDir, e.cs.chainId);
    };
    k.onKeyPress("space", throwEquippedChain);
    k.onKeyPress("q", throwEquippedChain);
    function cycleChain(dir) {
      const next = nextChainId(net.state.chains, net.state.equippedChainId, dir); // PARITY-3: shared cycle
      if (!next) return;
      net.state.equippedChainId = next; // optimistic; server echoes in snapshot
      net.setEquippedChain(next);
    }
    k.onKeyPress("[", () => { if (!net.state.combat && !net.state.roundResult) cycleChain(-1); });
    k.onKeyPress("]", () => { if (!net.state.combat && !net.state.roundResult) cycleChain(1); });
    k.onKeyPress("space", () => {
      if (net.state.roundResult || (!net.state.connected && !net.state.reconnecting)) { net.close(); k.go("start"); return; }
      const cc = net.state.combat;
      if (cc && cc.outcome) net.clearCombat();
    });

    k.onKeyPress("escape", () => { if (net.state.roundResult) { net.close(); k.go("start"); } else { menuOpen = !menuOpen; } });
    k.onKeyPress("m", () => toggleMuted()); // P8-T6: mute toggle (persisted)

    // Pointer/touch input: during combat, taps hit the action buttons; otherwise
    // the left-side virtual joystick drives movement. Works for touch and mouse.
    function pointerDown(id, p) {
      if (menuOpen) { for (const b of menuBtns()) { const [x, y, w, h] = b.rect; if (p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h) { b.act(); return; } } return; }
      if (net.state.roundResult || (!net.state.connected && !net.state.reconnecting)) { net.close(); k.go("start"); return; }
      const cc = net.state.combat;
      if (cc) {
        if (cc.outcome) { net.clearCombat(); return; }
        const action = hitButton(p);
        if (action) act(action);
        return;
      }
      // PT1-T24 parity: tap the minimap (top-right) to toggle zoom (1× ↔ 2×). M is
      // mute in MP, so tap is the toggle (works for mouse + touch).
      { const mox = k.width() - mmSize - mmPad, moy = mmPad;
        if (p.x >= mox - 4 && p.x <= mox + mmSize + 4 && p.y >= moy - 4 && p.y <= moy + mmSize + 4) { mmZoom = mmZoom === 1 ? 2 : 1; return; } }
      // MB-11: tap the touch pause button → open the pause/leave menu (was ESC-only).
      if (TOUCH && !onboard) { const [px, py, pw, ph] = pauseBtnRect(); if (p.x >= px && p.x <= px + pw && p.y >= py && p.y <= py + ph) { menuOpen = true; return; } }
      // Touch THROW button (mobile): throw the equipped chain along the heading.
      if (TOUCH && !onboard) {
        const tb = throwBtnC();
        if (Math.hypot(p.x - tb.x, p.y - tb.y) <= THROW_R) {
          const e = equippedChain();
          if (e) net.throwChain(selfDir, e.cs.chainId);
          return;
        }
      }
      joyStart(id, p);
    }
    k.onTouchStart((p, t) => pointerDown(t?.identifier ?? 0, p));
    k.onTouchMove((p, t) => joyMove(t?.identifier ?? 0, p));
    k.onTouchEnd((p, t) => joyEnd(t?.identifier ?? 0));
    // P8-T8: tap / click also dismisses the onboarding overlay (idempotent; in
    // addition to moving). Grace (>0.3s) avoids an instant dismiss at spawn.
    k.onTouchStart(() => { if (onboard && onboardT > 0.3) dismissOnboard(); });
    k.onMousePress(() => { if (onboard && onboardT > 0.3) dismissOnboard(); });
    if (!TOUCH) {
      // Desktop: mouse drives the same joystick / button taps (touch devices use
      // the touch handlers; skip mouse to avoid synthesized double-fires).
      k.onMousePress(() => pointerDown("m", k.mousePos()));
      k.onMouseMove(() => { if (joyId === "m") joyMove("m", k.mousePos()); });
      k.onMouseRelease(() => joyEnd("m"));
    }
  });
}
