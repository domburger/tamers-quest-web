import { net } from "../netClient.js";
import { GAME } from "../engine/schemas.js";
import { generateMap } from "../engine/mapgen.js";
import { getSpiritChain } from "../data.js";
import { drawCharacter } from "../render/character.js";
import { drawSpiritChainProjectile, drawSpiritChainModel, drawChest, chainColor } from "../render/spiritchain.js";
import { drawTiles, makeTileCache } from "../render/tiles.js";
import { drawAtmosphere } from "../render/atmosphere.js";
import { emit, updateFx, drawFx, clearFx } from "../render/fx.js";
import { drawPortal } from "../render/portal.js";
import { initAudio, toggleMuted, isMuted, sfx } from "../systems/audio.js";
import { gamepadMove, gamepadPressed, BTN } from "../systems/gamepad.js";

// Online round view: the seeded map (regenerated client-side from the server
// seed) drawn as culled, biome-colored tiles, plus server-authoritative players.
// WASD -> server (~20Hz). Single-player game scene is unchanged.
export default function onlineGameScene(k) {
  k.scene("onlineGame", (args = {}) => {
    let map = args.map || null;
    initAudio(net); // P8-T6: wire procedural SFX to net events (idempotent)
    // Defensive: if entered without a prebuilt map, regenerate it from the seed.
    if (!map && net.state.seed != null) {
      generateMap(null, net.state.seed).then((m) => { map = m; }).catch(() => {});
    }
    const tileCache = makeTileCache(); // P-floortile: textured floor, cached per tile type
    k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(10, 14, 18), k.fixed(), k.z(-10)]);

    const info = k.add([
      k.text("", { size: 14, font: "gameFont" }),
      k.pos(12, 12), k.color(255, 255, 255), k.fixed(), k.z(100),
    ]);
    const hint = k.add([
      k.text("Move: WASD or drag · Leave: ESC · M mute", { size: 12, font: "gameFont" }),
      k.pos(12, k.height() - 24), k.color(210, 210, 220), k.fixed(), k.z(100),
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
      k.drawRect({ pos: k.vec2(0, 0), width: W, height: H, color: k.rgb(8, 10, 14), opacity: 0.86, fixed: true });
      k.drawText({ text: "HOW TO PLAY", pos: k.vec2(cx, H * 0.18), size: 40, font: "gameFont", anchor: "center", color: k.rgb(245, 215, 120), fixed: true });
      const lines = [
        "MOVE — WASD or drag the left side of the screen",
        "THROW A SPIRIT CHAIN — Q (aimed along your heading) to catch wild monsters",
        "IN A FIGHT — 1-4 attack  ·  C catch  ·  F flee",
        "EXTRACT — reach a glowing portal before the storm closes in",
        "LEAVE — ESC",
      ];
      lines.forEach((ln, i) => k.drawText({ text: ln, pos: k.vec2(cx, H * 0.34 + i * 36), size: 18, font: "gameFont", anchor: "center", width: W - 140, color: k.rgb(232, 236, 244), fixed: true }));
      const pulse = 0.55 + 0.45 * Math.sin(k.time() * 4);
      k.drawText({ text: "move or tap to begin", pos: k.vec2(cx, H * 0.82), size: 18, font: "gameFont", anchor: "center", color: k.rgb(255, 255, 255), opacity: pulse, fixed: true });
    }
    let awaiting = false; // true while a combat turn is being resolved (AI ~1-2s)
    let lastLogLen = 0;

    // ── Onscreen controls (mobile) ──
    const TOUCH = typeof k.isTouchscreen === "function" ? k.isTouchscreen() : ("ontouchstart" in window);
    const COMBAT_H = 264; // taller panel: room for larger, touch-friendly action buttons
    const THROW_R = 46; // touch THROW button (right thumb) — mobile spirit-chain throw
    const throwBtnC = () => k.vec2(k.width() - 88, k.height() - 124);
    // ESC pause/settings overlay (Resume · Sound · Leave). ESC no longer instantly
    // quits the round (was accidental round-loss). The world keeps running server-side.
    let menuOpen = false;
    const menuBtns = () => {
      const cx = k.width() / 2, bw = 280, bh = 56, gap = 16, y0 = k.height() / 2 - 64;
      return [
        { rect: [cx - bw / 2, y0, bw, bh], label: "Resume", act: () => { menuOpen = false; } },
        { rect: [cx - bw / 2, y0 + (bh + gap), bw, bh], label: `Sound: ${isMuted() ? "Off" : "On"}`, act: () => { toggleMuted(); } },
        { rect: [cx - bw / 2, y0 + (bh + gap) * 2, bw, bh], label: "Leave round", act: () => { net.close(); k.go("start"); } },
      ];
    };

    // Element → accent color for badges and attack tints. The element space is
    // open-ended (AI-generated), so known elements get hand-picked colors and the
    // rest get a stable color hashed into a palette (never a flat gray for all).
    const ELEM_COLORS = {
      fire: [240, 110, 70], water: [80, 150, 240], nature: [110, 200, 110], grass: [110, 200, 110],
      earth: [200, 160, 90], sand: [215, 195, 125], air: [150, 210, 230], wind: [150, 210, 230],
      ice: [150, 220, 245], dark: [165, 110, 215], darkness: [125, 95, 175], shadow: [125, 95, 175],
      light: [245, 225, 120], holy: [250, 240, 175], celestial: [220, 220, 255], lunar: [200, 210, 245],
      electric: [245, 215, 95], poison: [175, 110, 205], acid: [170, 210, 90], ghost: [185, 205, 225],
      void: [95, 85, 130], arcane: [205, 120, 235], cosmic: [150, 130, 235], mystic: [205, 120, 235],
      metal: [180, 185, 195], steel: [180, 185, 195], psychic: [230, 130, 205], spirit: [185, 205, 225],
      sound: [230, 205, 150], sonic: [230, 205, 150], chaos: [205, 80, 120], mercury: [190, 195, 205],
      ethereal: [200, 215, 235], normal: [185, 185, 190], physical: [200, 200, 200], none: [170, 170, 180],
    };
    const FALLBACK = [[230, 120, 120], [120, 200, 160], [150, 160, 240], [230, 190, 110], [200, 130, 210], [120, 200, 230], [230, 150, 90], [170, 190, 120]];
    const elemColor = (e) => {
      if (!e) return [170, 170, 180];
      const key = String(e).toLowerCase().split("/")[0].trim(); // primary of compound types
      if (ELEM_COLORS[key]) return ELEM_COLORS[key];
      let h = 0;
      for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
      return FALLBACK[h % FALLBACK.length];
    };
    const hpColor = (r) => (r > 0.5 ? [90, 200, 110] : r > 0.2 ? [230, 200, 80] : [220, 90, 90]);
    // Rounded stat bar in fixed/overlay space, with an optional right-aligned label.
    function drawBar(x, y, w, h, ratio, col, label) {
      const r = Math.max(0, Math.min(1, ratio || 0));
      k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius: h / 2, color: k.rgb(28, 32, 42), fixed: true });
      if (r > 0) k.drawRect({ pos: k.vec2(x, y), width: Math.max(h, w * r), height: h, radius: h / 2, color: k.rgb(col[0], col[1], col[2]), fixed: true });
      if (label) k.drawText({ text: label, pos: k.vec2(x + w - 6, y + h / 2), size: 11, font: "gameFont", anchor: "right", color: k.rgb(255, 255, 255), fixed: true });
    }
    // One combatant's header (element dot + name + Lv + status) and HP/energy bars.
    function drawCombatant(mon, y, title, m, W, flash = 0) {
      if (!mon) return;
      const el = elemColor(mon.element);
      k.drawCircle({ pos: k.vec2(m + 6, y + 7), radius: 5, color: k.rgb(el[0], el[1], el[2]), fixed: true });
      k.drawText({ text: `${title}  Lv.${mon.level}`, pos: k.vec2(m + 18, y), size: 14, font: "gameFont", color: k.rgb(255, 255, 255), fixed: true });
      if (mon.status) k.drawText({ text: String(mon.status), pos: k.vec2(m + W, y), size: 12, font: "gameFont", anchor: "right", color: k.rgb(240, 200, 120), fixed: true });
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
    function buildMinimap() {
      if (!map) return;
      const N = 34, step = Math.max(1, Math.floor(map.mapSize / N));
      const cells = [];
      for (let x = 0; x < map.mapSize; x += step) {
        for (let y = 0; y < map.mapSize; y += step) {
          const t = map.tileMap[x]?.[y];
          if (t) cells.push({ fx: x / map.mapSize, fy: y / map.mapSize, col: [t.colorProfile_full_r, t.colorProfile_full_g, t.colorProfile_full_b] });
        }
      }
      mmCells = { cells, frac: step / map.mapSize };
    }
    function drawMinimap() {
      if (!map) return;
      if (!mmCells) buildMinimap();
      const ext = map.mapSize * GAME.EFFECTIVE_TILE;
      const ox = k.width() - mmSize - mmPad, oy = mmPad, s = mmSize / ext;
      const mm = (wx, wy) => k.vec2(ox + wx * s, oy + wy * s);
      k.drawRect({ pos: k.vec2(ox - 4, oy - 4), width: mmSize + 8, height: mmSize + 8, radius: 6, color: k.rgb(8, 10, 16), opacity: 0.82, outline: { width: 2, color: k.rgb(70, 80, 100) }, fixed: true });
      if (mmCells) {
        const cw = Math.max(2, mmCells.frac * mmSize + 0.5);
        for (const c of mmCells.cells) k.drawRect({ pos: k.vec2(ox + c.fx * mmSize, oy + c.fy * mmSize), width: cw, height: cw, color: k.rgb(c.col[0], c.col[1], c.col[2]), opacity: 0.5, fixed: true });
      }
      if (net.state.circle) {
        const c = net.state.circle;
        k.drawCircle({ pos: mm(c.x, c.y), radius: Math.max(2, c.r * s), fill: false, outline: { width: 1.5, color: k.rgb(120, 180, 255) }, opacity: 0.85, fixed: true });
      }
      const pulse = 0.6 + 0.4 * Math.sin(k.time() * 4);
      for (const p of net.state.portals) k.drawCircle({ pos: mm(p.x, p.y), radius: 3.5 * pulse + 1.5, color: k.rgb(80, 220, 255), fixed: true });
      for (const mo of net.state.monsters) k.drawCircle({ pos: mm(mo.x, mo.y), radius: 1.6, color: k.rgb(220, 180, 80), fixed: true });
      // Chests reveal on the minimap only when you're close (discovery, not a full loot map).
      const cmr2 = GAME.SPIRIT_CHAIN.CHEST_MINIMAP_RADIUS ** 2;
      for (const c of net.state.chests) {
        const dx = c.x - selfRender.x, dy = c.y - selfRender.y;
        if (dx * dx + dy * dy <= cmr2) k.drawCircle({ pos: mm(c.x, c.y), radius: 2.2, color: k.rgb(228, 206, 128), fixed: true });
      }
      // Rivals as a tiny character glyph (head + body) — reads as a *player*, distinct
      // from the round amber monster blobs (radar scale: shapes > mushy mini-sprites).
      for (const p of net.state.players) {
        const mp = mm(p.x, p.y);
        k.drawRect({ pos: k.vec2(mp.x - 1.5, mp.y - 1), width: 3, height: 4, color: k.rgb(235, 95, 95), fixed: true });
        k.drawCircle({ pos: k.vec2(mp.x, mp.y - 2), radius: 1.6, color: k.rgb(235, 95, 95), fixed: true });
      }
      k.drawCircle({ pos: mm(selfRender.x, selfRender.y), radius: 3.5, color: k.rgb(90, 170, 255), outline: { width: 1.5, color: k.rgb(255, 255, 255) }, fixed: true });
    }

    // Team HP HUD (top-left): live per-monster bars, so storm/combat damage to
    // your reserves is visible at a glance.
    function drawTeamHp() {
      const team = net.state.self?.team;
      if (!team || !team.length) return;
      const x = 12, y0 = 78, w = 118, h = 9, gap = 5;
      k.drawText({ text: "TEAM", pos: k.vec2(x, y0 - 15), size: 11, font: "gameFont", color: k.rgb(210, 210, 220), fixed: true });
      team.forEach((mo, i) => {
        const r = mo.max ? mo.hp / mo.max : 0;
        drawBar(x, y0 + i * (h + gap), w, h, r, mo.hp > 0 ? hpColor(r) : [70, 70, 78], String(mo.hp));
      });
      // Stamina bar (sprint) under the team.
      const sy = y0 + team.length * (h + gap) + 4;
      const sr = (net.state.stamina ?? GAME.SPRINT.STAMINA_MAX) / GAME.SPRINT.STAMINA_MAX;
      k.drawText({ text: "STAMINA", pos: k.vec2(x, sy - 1), size: 9, font: "gameFont", color: k.rgb(200, 200, 215), fixed: true });
      drawBar(x + 56, sy, w - 56, h, sr, sr > 0.3 ? [120, 200, 230] : [220, 170, 80], null);
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
      const x = 12, y = 78 + (net.state.self?.team?.length || 0) * 14 + 14;
      k.drawRect({ pos: k.vec2(x, y), width: 150, height: 40, radius: 4, color: k.rgb(8, 10, 16), opacity: 0.8, fixed: true });
      if (e && e.def) {
        const col = chainColor(e.def);
        k.drawCircle({ pos: k.vec2(x + 20, y + 20), radius: 9, color: k.rgb(col[0], col[1], col[2]), opacity: 0.9, fixed: true });
        const throws = e.cs.throwCount == null ? "∞" : String(e.cs.throwCount);
        k.drawText({ text: e.def.name, pos: k.vec2(x + 38, y + 5), size: 11, font: "gameFont", color: k.rgb(225, 225, 235), fixed: true });
        k.drawText({ text: `Q throw  ·  ${throws}/${e.cs.durability}`, pos: k.vec2(x + 38, y + 22), size: 10, font: "gameFont", color: k.rgb(175, 185, 205), fixed: true });
      } else {
        k.drawText({ text: "No chain", pos: k.vec2(x + 10, y + 14), size: 11, font: "gameFont", color: k.rgb(150, 150, 160), fixed: true });
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
      k.drawText({ text: "get back inside the zone", pos: k.vec2(W / 2, cy + 26), size: 14, font: "gameFont", anchor: "center", color: k.rgb(255, 185, 185), fixed: true });
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
        k.drawText({ text, pos: k.vec2(x, y), size: 12, font: "gameFont", anchor: "topright", color: k.rgb(...col), opacity: op, fixed: true });
        y += 17;
      }
    }

    const JOY_R = 70;
    const joyRest = () => k.vec2(110, k.height() - 110); // faint idle-hint position
    let joyId = null;
    let joyVec = { x: 0, y: 0 };
    let joyBase = joyRest(); // floating: the base spawns where the thumb lands
    let thumb = joyBase;

    function joyStart(id, p) {
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
    function combatButtons() {
      const c = net.state.combat;
      if (!c || c.outcome || c.waiting) return []; // PvP: no input while awaiting the opponent
      const top = k.height() - COMBAT_H, m = 12, gap = 8, h = 54; // larger, touch-friendly targets
      const energy = c.active?.currentEnergy ?? 0;
      const atks = (c.attacks || []).slice(0, 4);
      const w = (k.width() - m * 2 - gap * 3) / 4, y = top + 100; // below the two stat rows
      const btns = atks.map((a, i) => ({
        rect: [m + i * (w + gap), y, w, h], label: a.name,
        element: a.element, cost: a.energyCost,
        affordable: (a.energyCost ?? 0) <= energy,
        action: { kind: "attack", attackName: a.name },
      }));
      const w2 = (k.width() - m * 2 - gap) / 2, y2 = y + h + gap;
      // No catching another player's monster in PvP.
      if (!c.pvp) btns.push({ rect: [m, y2, w2, h], label: "Catch", action: { kind: "catch" } });
      btns.push({ rect: [c.pvp ? m : m + w2 + gap, y2, c.pvp ? k.width() - m * 2 : w2, h], label: "Flee", action: { kind: "flee" } });
      return btns;
    }
    function hitButton(p) {
      for (const b of combatButtons()) {
        const [x, y, w, h] = b.rect;
        if (p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h) return b.action;
      }
      return null;
    }

    let sendAcc = 0, pingAcc = 0;
    let combatPress = null; // { kind, name, t } — brief tap-feedback flash on combat buttons
    let prevEnemyHp = null, prevActiveHp = null, hitFlashE = -9, hitFlashA = -9, lastCombatId = null; // combat hit-flash
    clearFx(); // reset the shared particle pool on (re)entry (PV-T12)
    k.onUpdate(() => {
      updateFx(k.dt()); // advance world particles (PV-T12)
      // Latency probe every 2s while connected (drives the HUD ping readout).
      pingAcc += k.dt();
      if (pingAcc >= 2 && net.state.connected) { net.ping(); pingAcc = 0; }

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
        if (pl != null && mon.level > pl) { sfx("levelup"); emit({ x: selfRender.x, y: selfRender.y, n: 14, color: [255, 220, 120], speed: 70, life: 0.7, size: 3, gravity: -40, drag: 1.5 }); } // PV-T12 level-up burst
        prevLevels.set(mon.id, mon.level);
      }
      const curChests = net.state.chests || [];
      if (prevChests && prevChests !== curChests) { // only diff when the snapshot replaced the array
        const sx = net.state.self.x, sy = net.state.self.y;
        for (const pc of prevChests) {
          if (!curChests.some((c) => c.x === pc.x && c.y === pc.y) && Math.hypot(pc.x - sx, pc.y - sy) < 56) { sfx("chest"); emit({ x: pc.x, y: pc.y, n: 12, color: [245, 210, 90], speed: 55, life: 0.6, size: 2.8, gravity: -30, drag: 1.5 }); } // PV-T12 chest-open sparkle
        }
      }
      prevChests = curChests;

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
      const ping = net.state.rtt == null ? "" : ` · ${net.state.rtt}ms`;
      // P6-T3 player list: name the rivals currently in view. AoI-filtered, so it
      // respects the "you only see those near you" design (Q13) — no full roster.
      const rivals = net.state.players || [];
      const rivalLine = rivals.length
        ? `Rivals in view (${rivals.length}): ${rivals.slice(0, 4).map((p) => p.name || "?").join(", ")}${rivals.length > 4 ? `, +${rivals.length - 4}` : ""}`
        : "No rivals in view";
      info.text =
        `Online · ${mm}:${ss} left${ping} · seed ${net.state.seed ?? "?"}\n` +
        `You (${net.state.nickname ?? "?"}): (${Math.round(net.state.self.x)}, ${Math.round(net.state.self.y)})\n` +
        rivalLine;

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
      drawTiles(k, map, net.state.self.x, net.state.self.y, tileCache, GAME.EFFECTIVE_TILE);

      // Safe zone (shrinking) + extraction portals.
      // Storm wall (PV-T13): the closing safe-zone edge reads as a glowing, pulsing
      // energy barrier — an outward glow band fading into the storm + a bright pulsing
      // inner edge — instead of one flat thin outline.
      if (net.state.circle) {
        const c = net.state.circle, pulse = 0.6 + 0.4 * Math.sin(k.time() * 3);
        for (let i = 3; i >= 1; i--) {
          k.drawCircle({ pos: k.vec2(c.x, c.y), radius: c.r + i * 7, fill: false, outline: { width: 4, color: k.rgb(110, 160, 255) }, opacity: (0.30 - i * 0.07) * pulse });
        }
        k.drawCircle({ pos: k.vec2(c.x, c.y), radius: c.r, fill: false, outline: { width: 3, color: k.rgb(180, 220, 255) }, opacity: 0.55 + 0.25 * Math.sin(k.time() * 3) });
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
      for (const mo of net.state.monsters) {
        const slug = mo.typeName.toLowerCase().replace(/\s+/g, "_");
        ents.push({ y: mo.y, draw: () => {
          const idle = Math.sin(now * 2 + (mo.x + mo.y) * 0.013); // PV-T14: gentle idle bob + breath (per-monster phase)
          k.drawEllipse({ pos: k.vec2(mo.x, mo.y + 20), radiusX: 15, radiusY: 5, color: k.rgb(0, 0, 0), opacity: 0.28 }); // ground shadow (stays put)
          try { k.drawSprite({ sprite: slug, pos: k.vec2(mo.x, mo.y + idle * 2), anchor: "center", scale: 0.45 * (1 + idle * 0.03) }); }
          catch { k.drawCircle({ pos: k.vec2(mo.x, mo.y), radius: 8, color: k.rgb(220, 180, 80) }); }
        } });
      }
      for (const p of net.state.players) {
        const r = othersRender.get(p.id) || p;
        ents.push({ y: r.y, draw: () => {
          drawCharacter(k, { x: r.x, y: r.y, t: now + (p.id ? p.id.length : 0), moving: r.moving, color: [210, 90, 90], dir: r.dir });
          k.drawText({ text: p.name || "?", pos: k.vec2(r.x, r.y - 40), size: 12, font: "gameFont", anchor: "center", color: k.rgb(255, 255, 255) });
        } });
      }
      ents.push({ y: selfRender.y, draw: () => {
        drawCharacter(k, { x: selfRender.x, y: selfRender.y, t: now, moving: selfMoving, color: [90, 170, 255], dir: selfDir });
        k.drawText({ text: net.state.nickname || "You", pos: k.vec2(selfRender.x, selfRender.y - 40), size: 12, font: "gameFont", anchor: "center", color: k.rgb(255, 255, 255) });
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
      // under the HUD. Skipped during combat (its own panel) and results.
      if (!net.state.combat && !net.state.roundResult) drawAtmosphere(k, { t: now });

      // Virtual joystick (touch) — left side, hidden during combat / results.
      if (TOUCH && !net.state.combat && !net.state.roundResult) {
        const joyActive = joyId !== null;
        const joyDrawBase = joyActive ? joyBase : joyRest(); // faint hint at rest; ring under thumb when active
        k.drawCircle({ pos: joyDrawBase, radius: JOY_R, color: k.rgb(255, 255, 255), opacity: joyActive ? 0.12 : 0.05, fixed: true });
        k.drawCircle({ pos: joyDrawBase, radius: JOY_R, fill: false, outline: { width: 2, color: k.rgb(255, 255, 255) }, opacity: joyActive ? 0.4 : 0.15, fixed: true });
        if (joyActive) k.drawCircle({ pos: thumb, radius: 30, color: k.rgb(120, 190, 255), opacity: 0.55, fixed: true }); // press feedback
        // Touch THROW button (right thumb) — fixes the mobile gap where a chain
        // could only be thrown via the Q key. Dimmed when no chain is equipped.
        const eqc = equippedChain();
        const hasChain = !!eqc;
        const throwsLeft = eqc && eqc.cs && eqc.cs.throwCount != null ? eqc.cs.throwCount : null;
        const tb = throwBtnC();
        k.drawCircle({ pos: tb, radius: THROW_R, color: k.rgb(90, 170, 255), opacity: hasChain ? 0.32 : 0.12, fixed: true });
        k.drawCircle({ pos: tb, radius: THROW_R, fill: false, outline: { width: 2, color: k.rgb(120, 190, 255) }, opacity: hasChain ? 0.7 : 0.25, fixed: true });
        k.drawText({ text: "THROW", pos: k.vec2(tb.x, tb.y - (throwsLeft != null ? 7 : 0)), size: 13, font: "gameFont", anchor: "center", color: k.rgb(255, 255, 255), opacity: hasChain ? 0.9 : 0.4, fixed: true });
        if (throwsLeft != null) k.drawText({ text: `${throwsLeft} left`, pos: k.vec2(tb.x, tb.y + 9), size: 11, font: "gameFont", anchor: "center", color: k.rgb(185, 212, 255), opacity: hasChain ? 0.9 : 0.4, fixed: true });
      }

      // Minimap + team HP + danger warning (hidden behind the round-result overlay).
      if (!net.state.roundResult) drawMinimap();
      if (!net.state.roundResult) drawTeamHp();
      if (!net.state.combat && !net.state.roundResult) drawChainHud();
      if (!net.state.roundResult) drawKillFeed();
      if (onboard && !net.state.combat && !net.state.roundResult) drawOnboarding(); // P8-T8 overlay over the HUD
      if (!net.state.combat && !net.state.roundResult) drawDanger();

      // Combat overlay (server locks movement during a fight). Tappable buttons;
      // keyboard 1-4 / C / F still work on desktop.
      const c = net.state.combat;
      if (c) {
        const H = COMBAT_H, top = k.height() - H, m = 12, W = k.width() - m * 2;
        // Hit-flash bookkeeping: flash a row when its HP drops; reset per-side trackers
        // on a new combat so a stale value can't false-trigger on the first frame.
        const tF = k.time();
        if (c.combatId !== lastCombatId) { prevEnemyHp = prevActiveHp = null; lastCombatId = c.combatId; }
        if (c.enemy && prevEnemyHp != null && c.enemy.currentHealth < prevEnemyHp) hitFlashE = tF;
        prevEnemyHp = c.enemy ? c.enemy.currentHealth : null;
        if (c.active && prevActiveHp != null && c.active.currentHealth < prevActiveHp) hitFlashA = tF;
        prevActiveHp = c.active ? c.active.currentHealth : null;
        const eF = Math.max(0, 1 - (tF - hitFlashE) / 0.3), aF = Math.max(0, 1 - (tF - hitFlashA) / 0.3);
        k.drawRect({ pos: k.vec2(0, top), width: k.width(), height: H, color: k.rgb(10, 10, 20), opacity: 0.94, fixed: true });
        const enemyTitle = c.pvp ? `${c.opponent || "Rival"}: ${c.enemy.typeName}` : `Wild ${c.enemy.typeName}`;
        drawCombatant(c.enemy, top + 8, enemyTitle, m, W, eF);
        drawCombatant(c.active, top + 50, c.active.name, m, W, aF);
        const nowC = k.time();
        for (const b of combatButtons()) {
          const [x, y, w, h] = b.rect;
          const aff = b.affordable !== false;
          const accent = b.element ? elemColor(b.element) : [120, 150, 200];
          // Element-tinted dark fill so each attack reads as its element (catch/flee stay neutral slate).
          const base = b.element ? [40 + (accent[0] - 40) * 0.22, 55 + (accent[1] - 55) * 0.22, 80 + (accent[2] - 80) * 0.22] : [40, 55, 80];
          // Brief press-flash on the just-tapped button (tap feedback the mobile controls lacked).
          const pressed = combatPress && combatPress.kind === b.action.kind && combatPress.name === (b.action.attackName || b.action.kind) && nowC - combatPress.t < 0.18;
          const fill = pressed ? base.map((v) => Math.min(255, v + 60)) : base;
          k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius: 8, color: k.rgb(fill[0], fill[1], fill[2]), opacity: aff ? 1 : 0.45, outline: { width: pressed ? 3 : 2, color: k.rgb(accent[0], accent[1], accent[2]) }, fixed: true });
          k.drawText({ text: b.label, pos: k.vec2(x + w / 2, y + (b.cost != null ? h / 2 - 7 : h / 2)), size: 14, font: "gameFont", anchor: "center", color: k.rgb(255, 255, 255), width: w - 10, opacity: aff ? 1 : 0.55, fixed: true });
          if (b.cost != null) k.drawText({ text: `EN ${b.cost}`, pos: k.vec2(x + w / 2, y + h - 13), size: 11, font: "gameFont", anchor: "center", color: k.rgb(200, 214, 236), opacity: aff ? 0.9 : 0.45, fixed: true });
        }
        const last = c.log[c.log.length - 1] || (c.pvp ? "A rival challenges you!" : "A wild monster appeared!");
        const line = c.outcome
          ? `${last}  —  ${c.outcome.toUpperCase()}!  (tap / space)`
          : c.waiting ? "Waiting for your opponent…" : (awaiting ? "Resolving…" : last);
        k.drawText({ text: line, pos: k.vec2(m, top + H - 24), size: 13, font: "gameFont", width: W, color: k.rgb(255, 255, 255), fixed: true });
      }

      // ESC pause/settings overlay (drawn over everything; world keeps running).
      if (menuOpen && !net.state.roundResult) {
        k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: k.rgb(0, 0, 0), opacity: 0.72, fixed: true });
        k.drawText({ text: "PAUSED", pos: k.vec2(k.width() / 2, k.height() / 2 - 130), size: 44, font: "gameFont", anchor: "center", color: k.rgb(245, 215, 120), fixed: true });
        for (const b of menuBtns()) {
          const [x, y, w, h] = b.rect;
          k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius: 10, color: k.rgb(40, 55, 80), outline: { width: 2, color: k.rgb(120, 150, 200) }, fixed: true });
          k.drawText({ text: b.label, pos: k.vec2(x + w / 2, y + h / 2), size: 20, font: "gameFont", anchor: "center", color: k.rgb(235, 240, 255), fixed: true });
        }
        k.drawText({ text: "ESC to resume · the round keeps going", pos: k.vec2(k.width() / 2, k.height() / 2 + 130), size: 13, font: "gameFont", anchor: "center", color: k.rgb(170, 180, 200), fixed: true });
      }

      // Round result (extracted / died) overlay.
      const rr = net.state.roundResult;
      if (rr) {
        k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: k.rgb(0, 0, 0), opacity: 0.7, fixed: true });
        const win = rr.outcome === "extracted";
        k.drawText({ text: win ? "EXTRACTED!" : "RUN OVER", pos: k.vec2(k.width() / 2, k.height() / 2 - 30), size: 48, font: "gameFont", anchor: "center", color: win ? k.rgb(120, 230, 150) : k.rgb(230, 120, 120), fixed: true });
        k.drawText({ text: `${rr.reason}  ·  tap / space to return`, pos: k.vec2(k.width() / 2, k.height() / 2 + 30), size: 18, font: "gameFont", anchor: "center", color: k.rgb(255, 255, 255), fixed: true });
        // P8-T3: per-run gains summary (caught / XP / level-ups / survival time).
        const g = rr.gains;
        if (g) {
          const parts = [];
          if (g.caught) parts.push(`Caught ${g.caught}`);
          if (g.xpGained) parts.push(`+${g.xpGained} XP`);
          if (g.levelUps) parts.push(`${g.levelUps} level-up${g.levelUps > 1 ? "s" : ""}`);
          parts.push(`survived ${Math.floor((g.survivedS || 0) / 60)}:${String((g.survivedS || 0) % 60).padStart(2, "0")}`);
          k.drawText({ text: "THIS RUN  ·  " + parts.join("  ·  "), pos: k.vec2(k.width() / 2, k.height() / 2 + 62), size: 15, font: "gameFont", anchor: "center", color: k.rgb(245, 215, 120), fixed: true });
        }
        const st = net.state.stats || {};
        k.drawText({ text: `LIFETIME · Extractions ${st.extractions || 0} · Deaths ${st.deaths || 0} · Caught ${st.caught || 0} · PvP wins ${st.pvpWins || 0} · Runs ${st.runs || 0}`, pos: k.vec2(k.width() / 2, k.height() / 2 + 92), size: 14, font: "gameFont", anchor: "center", color: k.rgb(190, 195, 215), fixed: true });
      }

      // Dropped connection: auto-reconnect resumes the round within the server's
      // 120s grace (P6-T1/Q12). Show "Reconnecting…" while retrying; only offer the
      // bail-to-menu once we've given up.
      if (!net.state.connected) {
        const reconnecting = net.state.reconnecting;
        k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: k.rgb(0, 0, 0), opacity: reconnecting ? 0.62 : 0.82, fixed: true });
        k.drawText({ text: reconnecting ? "RECONNECTING…" : "CONNECTION LOST", pos: k.vec2(k.width() / 2, k.height() / 2 - 24), size: 38, font: "gameFont", anchor: "center", color: reconnecting ? k.rgb(245, 215, 120) : k.rgb(230, 120, 120), fixed: true });
        k.drawText({ text: reconnecting ? "resuming your run…" : "tap / space to return to the menu", pos: k.vec2(k.width() / 2, k.height() / 2 + 28), size: 18, font: "gameFont", anchor: "center", color: k.rgb(255, 255, 255), fixed: true });
      }
    });

    // Combat controls (movement is locked server-side during a fight).
    const act = (action) => {
      const c = net.state.combat;
      if (c && !c.outcome && !c.waiting && !awaiting) {
        awaiting = true;
        combatPress = { kind: action.kind, name: action.attackName || action.kind, t: k.time() }; // tap feedback
        net.combatAction(action);
      }
    };
    for (const n of [1, 2, 3, 4]) {
      k.onKeyPress(String(n), () => {
        const a = net.state.combat?.attacks?.[n - 1];
        if (a) act({ kind: "attack", attackName: a.name });
      });
    }
    k.onKeyPress("c", () => act({ kind: "catch" }));
    k.onKeyPress("f", () => act({ kind: "flee" }));

    // Throw the equipped spirit chain along the current heading (engages combat /
    // PvP on hit). Cycle the equipped chain with [ / ]. Only while roaming.
    k.onKeyPress("q", () => {
      if (net.state.combat || net.state.roundResult) return;
      const e = equippedChain();
      if (e) net.throwChain(selfDir, e.cs.chainId);
    });
    function cycleChain(dir) {
      const chains = net.state.chains || [];
      if (chains.length <= 1) return;
      let idx = chains.findIndex((c) => c.chainId === net.state.equippedChainId);
      if (idx < 0) idx = 0;
      idx = (idx + dir + chains.length) % chains.length;
      net.state.equippedChainId = chains[idx].chainId; // optimistic; server echoes in snapshot
      net.setEquippedChain(chains[idx].chainId);
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
