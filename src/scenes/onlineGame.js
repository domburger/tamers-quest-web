import { net } from "../netClient.js";
import { GAME } from "../engine/schemas.js";
import { generateMap } from "../engine/mapgen.js";
import { drawCharacter } from "../render/character.js";

// Online round view: the seeded map (regenerated client-side from the server
// seed) drawn as culled, biome-colored tiles, plus server-authoritative players.
// WASD -> server (~20Hz). Single-player game scene is unchanged.
export default function onlineGameScene(k) {
  k.scene("onlineGame", (args = {}) => {
    let map = args.map || null;
    // Defensive: if entered without a prebuilt map, regenerate it from the seed.
    if (!map && net.state.seed != null) {
      generateMap(null, net.state.seed).then((m) => { map = m; }).catch(() => {});
    }
    k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(10, 14, 18), k.fixed(), k.z(-10)]);

    const info = k.add([
      k.text("", { size: 14, font: "gameFont" }),
      k.pos(12, 12), k.color(255, 255, 255), k.fixed(), k.z(100),
    ]);
    const hint = k.add([
      k.text("Move: WASD or drag · Leave: ESC", { size: 12, font: "gameFont" }),
      k.pos(12, k.height() - 24), k.color(210, 210, 220), k.fixed(), k.z(100),
    ]);

    // Smooth render positions (interpolate toward authoritative snapshots).
    const lerp = (a, b, t) => a + (b - a) * t;
    const selfRender = { x: net.state.self.x, y: net.state.self.y };
    const othersRender = new Map(); // id -> { x, y, moving }
    let selfMoving = false;
    let awaiting = false; // true while a combat turn is being resolved (AI ~1-2s)
    let lastLogLen = 0;

    // ── Onscreen controls (mobile) ──
    const TOUCH = typeof k.isTouchscreen === "function" ? k.isTouchscreen() : ("ontouchstart" in window);
    const COMBAT_H = 220;

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
    function drawCombatant(mon, y, title, m, W) {
      if (!mon) return;
      const el = elemColor(mon.element);
      k.drawCircle({ pos: k.vec2(m + 6, y + 7), radius: 5, color: k.rgb(el[0], el[1], el[2]), fixed: true });
      k.drawText({ text: `${title}  Lv.${mon.level}`, pos: k.vec2(m + 18, y), size: 14, font: "gameFont", color: k.rgb(255, 255, 255), fixed: true });
      if (mon.status) k.drawText({ text: String(mon.status), pos: k.vec2(m + W, y), size: 12, font: "gameFont", anchor: "right", color: k.rgb(240, 200, 120), fixed: true });
      const hpR = mon.maxHealth ? mon.currentHealth / mon.maxHealth : 0;
      drawBar(m, y + 18, W, 12, hpR, hpColor(hpR), `${mon.currentHealth}/${mon.maxHealth}`);
      if (mon.maxEnergy) drawBar(m, y + 33, W, 5, mon.currentEnergy / mon.maxEnergy, [90, 160, 240], null);
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
      for (const p of net.state.players) k.drawCircle({ pos: mm(p.x, p.y), radius: 2.5, color: k.rgb(230, 90, 90), fixed: true });
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

    const JOY = k.vec2(120, k.height() - 120);
    const JOY_R = 70;
    let joyId = null;
    let joyVec = { x: 0, y: 0 };
    let thumb = JOY;

    function joyStart(id, p) {
      if (p.x > k.width() * 0.5) return; // left half only — keeps the right side free
      joyId = id;
      joyMove(id, p);
    }
    function joyMove(id, p) {
      if (id !== joyId) return;
      let d = p.sub(JOY);
      const len = d.len() || 1;
      if (len > JOY_R) d = d.scale(JOY_R / len);
      thumb = JOY.add(d);
      joyVec = { x: d.x / JOY_R, y: d.y / JOY_R };
    }
    function joyEnd(id) {
      if (id !== joyId) return;
      joyId = null;
      joyVec = { x: 0, y: 0 };
      thumb = JOY;
    }

    // Combat action buttons (shared by render + hit-testing).
    function combatButtons() {
      const c = net.state.combat;
      if (!c || c.outcome) return [];
      const top = k.height() - COMBAT_H, m = 12, gap = 8, h = 40;
      const energy = c.active?.currentEnergy ?? 0;
      const atks = (c.attacks || []).slice(0, 4);
      const w = (k.width() - m * 2 - gap * 3) / 4, y = top + 96; // below the two stat rows
      const btns = atks.map((a, i) => ({
        rect: [m + i * (w + gap), y, w, h], label: a.name,
        element: a.element, cost: a.energyCost,
        affordable: (a.energyCost ?? 0) <= energy,
        action: { kind: "attack", attackName: a.name },
      }));
      const w2 = (k.width() - m * 2 - gap) / 2, y2 = y + h + gap;
      btns.push({ rect: [m, y2, w2, h], label: "Catch", action: { kind: "catch" } });
      btns.push({ rect: [m + w2 + gap, y2, w2, h], label: "Flee", action: { kind: "flee" } });
      return btns;
    }
    function hitButton(p) {
      for (const b of combatButtons()) {
        const [x, y, w, h] = b.rect;
        if (p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h) return b.action;
      }
      return null;
    }

    let sendAcc = 0;
    k.onUpdate(() => {
      let dx = 0, dy = 0;
      if (k.isKeyDown("w") || k.isKeyDown("up")) dy = -1;
      if (k.isKeyDown("s") || k.isKeyDown("down")) dy = 1;
      if (k.isKeyDown("a") || k.isKeyDown("left")) dx = -1;
      if (k.isKeyDown("d") || k.isKeyDown("right")) dx = 1;
      if (net.state.combat) { joyId = null; joyVec = { x: 0, y: 0 }; thumb = JOY; } // no joystick mid-fight
      else if (joyVec.x || joyVec.y) { dx = joyVec.x; dy = joyVec.y; } // joystick overrides keys
      selfMoving = !!(dx || dy);
      // Send continuously while held (server consumes one intent per tick), ~20Hz.
      sendAcc += k.dt();
      if ((dx || dy) && sendAcc >= 0.05) { net.move(dx, dy); sendAcc = 0; }

      // Interpolate render positions toward the latest server state.
      const a = Math.min(1, k.dt() * 14);
      selfRender.x = lerp(selfRender.x, net.state.self.x, a);
      selfRender.y = lerp(selfRender.y, net.state.self.y, a);
      const seen = new Set();
      for (const p of net.state.players) {
        seen.add(p.id);
        let r = othersRender.get(p.id);
        if (!r) { r = { x: p.x, y: p.y, moving: false }; othersRender.set(p.id, r); }
        r.moving = Math.abs(p.x - r.x) + Math.abs(p.y - r.y) > 1.5;
        r.x = lerp(r.x, p.x, a);
        r.y = lerp(r.y, p.y, a);
      }
      for (const id of [...othersRender.keys()]) if (!seen.has(id)) othersRender.delete(id);

      k.camPos(selfRender.x, selfRender.y);
      const t = net.state.time || 0;
      const mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, "0");
      info.text =
        `Online · ${mm}:${ss} left · seed ${net.state.seed ?? "?"}\n` +
        `You (${net.state.nickname ?? "?"}): (${Math.round(net.state.self.x)}, ${Math.round(net.state.self.y)})\n` +
        `Players in view: ${net.state.players.length + 1}`;

      // Hide the movement hint behind the combat / result overlays.
      hint.hidden = !!(net.state.combat || net.state.roundResult);

      // Clear the "Resolving…" indicator once a turn result / end arrives.
      const cb = net.state.combat;
      if (cb) { if (cb.log.length !== lastLogLen || cb.outcome) { awaiting = false; lastLogLen = cb.log.length; } }
      else { awaiting = false; lastLogLen = 0; }
    });

    k.onDraw(() => {
      // Seeded map — culled, biome-colored tiles (void stays dark).
      if (map) {
        const E = GAME.EFFECTIVE_TILE;
        const camX = net.state.self.x, camY = net.state.self.y;
        const halfW = k.width() / 2, halfH = k.height() / 2;
        const x0 = Math.max(0, Math.floor((camX - halfW) / E) - 1);
        const x1 = Math.min(map.mapSize - 1, Math.ceil((camX + halfW) / E) + 1);
        const y0 = Math.max(0, Math.floor((camY - halfH) / E) - 1);
        const y1 = Math.min(map.mapSize - 1, Math.ceil((camY + halfH) / E) + 1);
        for (let x = x0; x <= x1; x++) {
          for (let y = y0; y <= y1; y++) {
            const t = map.tileMap[x][y];
            if (!t) continue;
            k.drawRect({
              pos: k.vec2(x * E, y * E), width: E + 1, height: E + 1,
              color: k.rgb(t.colorProfile_full_r, t.colorProfile_full_g, t.colorProfile_full_b),
            });
          }
        }
      }

      // Safe zone (shrinking) + extraction portals.
      if (net.state.circle) {
        k.drawCircle({ pos: k.vec2(net.state.circle.x, net.state.circle.y), radius: net.state.circle.r, fill: false, outline: { width: 4, color: k.rgb(120, 180, 255) }, opacity: 0.5 });
      }
      for (const p of net.state.portals) {
        const pulse = 0.6 + 0.4 * Math.sin(k.time() * 4);
        k.drawCircle({ pos: k.vec2(p.x, p.y), radius: 18 * pulse, color: k.rgb(80, 220, 255), opacity: 0.35 });
        k.drawCircle({ pos: k.vec2(p.x, p.y), radius: 10, color: k.rgb(150, 240, 255) });
      }

      // Monsters in view (server AoI; hidden ones only appear up close).
      for (const mo of net.state.monsters) {
        const slug = mo.typeName.toLowerCase().replace(/\s+/g, "_");
        try {
          k.drawSprite({ sprite: slug, pos: k.vec2(mo.x, mo.y), anchor: "center", scale: 0.45 });
        } catch {
          k.drawCircle({ pos: k.vec2(mo.x, mo.y), radius: 8, color: k.rgb(220, 180, 80) });
        }
      }

      // Other players — animated characters at interpolated positions.
      const now = k.time();
      for (const p of net.state.players) {
        const r = othersRender.get(p.id) || p;
        drawCharacter(k, { x: r.x, y: r.y, t: now + (p.id ? p.id.length : 0), moving: r.moving, color: [210, 90, 90] });
        k.drawText({ text: p.name || "?", pos: k.vec2(r.x, r.y - 40), size: 12, font: "gameFont", anchor: "center", color: k.rgb(255, 255, 255) });
      }
      // You.
      drawCharacter(k, { x: selfRender.x, y: selfRender.y, t: now, moving: selfMoving, color: [90, 170, 255] });
      k.drawText({ text: net.state.nickname || "You", pos: k.vec2(selfRender.x, selfRender.y - 40), size: 12, font: "gameFont", anchor: "center", color: k.rgb(255, 255, 255) });

      // Virtual joystick (touch) — left side, hidden during combat / results.
      if (TOUCH && !net.state.combat && !net.state.roundResult) {
        k.drawCircle({ pos: JOY, radius: JOY_R, color: k.rgb(255, 255, 255), opacity: 0.08, fixed: true });
        k.drawCircle({ pos: JOY, radius: JOY_R, fill: false, outline: { width: 2, color: k.rgb(255, 255, 255) }, opacity: 0.25, fixed: true });
        k.drawCircle({ pos: thumb, radius: 26, color: k.rgb(255, 255, 255), opacity: 0.4, fixed: true });
      }

      // Minimap + team HP + danger warning (hidden behind the round-result overlay).
      if (!net.state.roundResult) drawMinimap();
      if (!net.state.roundResult) drawTeamHp();
      if (!net.state.combat && !net.state.roundResult) drawDanger();

      // Combat overlay (server locks movement during a fight). Tappable buttons;
      // keyboard 1-4 / C / F still work on desktop.
      const c = net.state.combat;
      if (c) {
        const H = COMBAT_H, top = k.height() - H, m = 12, W = k.width() - m * 2;
        k.drawRect({ pos: k.vec2(0, top), width: k.width(), height: H, color: k.rgb(10, 10, 20), opacity: 0.94, fixed: true });
        drawCombatant(c.enemy, top + 8, `Wild ${c.enemy.typeName}`, m, W);
        drawCombatant(c.active, top + 50, c.active.name, m, W);
        for (const b of combatButtons()) {
          const [x, y, w, h] = b.rect;
          const aff = b.affordable !== false;
          const accent = b.element ? elemColor(b.element) : [120, 150, 200];
          k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius: 6, color: k.rgb(40, 55, 80), opacity: aff ? 1 : 0.45, outline: { width: 2, color: k.rgb(accent[0], accent[1], accent[2]) }, fixed: true });
          k.drawText({ text: b.label, pos: k.vec2(x + w / 2, y + (b.cost != null ? h / 2 - 6 : h / 2)), size: 13, font: "gameFont", anchor: "center", color: k.rgb(255, 255, 255), width: w - 8, opacity: aff ? 1 : 0.55, fixed: true });
          if (b.cost != null) k.drawText({ text: `EN ${b.cost}`, pos: k.vec2(x + w / 2, y + h - 11), size: 10, font: "gameFont", anchor: "center", color: k.rgb(190, 205, 230), opacity: aff ? 0.9 : 0.45, fixed: true });
        }
        const last = c.log[c.log.length - 1] || "A wild monster appeared!";
        const line = c.outcome ? `${last}  —  ${c.outcome.toUpperCase()}!  (tap / space)` : (awaiting ? "Resolving…" : last);
        k.drawText({ text: line, pos: k.vec2(m, top + H - 24), size: 13, font: "gameFont", width: W, color: k.rgb(255, 255, 255), fixed: true });
      }

      // Round result (extracted / died) overlay.
      const rr = net.state.roundResult;
      if (rr) {
        k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: k.rgb(0, 0, 0), opacity: 0.7, fixed: true });
        const win = rr.outcome === "extracted";
        k.drawText({ text: win ? "EXTRACTED!" : "RUN OVER", pos: k.vec2(k.width() / 2, k.height() / 2 - 30), size: 48, font: "gameFont", anchor: "center", color: win ? k.rgb(120, 230, 150) : k.rgb(230, 120, 120), fixed: true });
        k.drawText({ text: `${rr.reason}  ·  tap / space to return`, pos: k.vec2(k.width() / 2, k.height() / 2 + 30), size: 18, font: "gameFont", anchor: "center", color: k.rgb(255, 255, 255), fixed: true });
      }

      // Connection lost (server/network dropped) — don't leave the player frozen
      // with no explanation. Drawn on top; reconnection itself is P6-T1 (Q12).
      if (!net.state.connected) {
        k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: k.rgb(0, 0, 0), opacity: 0.82, fixed: true });
        k.drawText({ text: "CONNECTION LOST", pos: k.vec2(k.width() / 2, k.height() / 2 - 24), size: 40, font: "gameFont", anchor: "center", color: k.rgb(230, 120, 120), fixed: true });
        k.drawText({ text: "tap / space to return to the menu", pos: k.vec2(k.width() / 2, k.height() / 2 + 28), size: 18, font: "gameFont", anchor: "center", color: k.rgb(255, 255, 255), fixed: true });
      }
    });

    // Combat controls (movement is locked server-side during a fight).
    const act = (action) => {
      const c = net.state.combat;
      if (c && !c.outcome && !awaiting) { awaiting = true; net.combatAction(action); }
    };
    for (const n of [1, 2, 3, 4]) {
      k.onKeyPress(String(n), () => {
        const a = net.state.combat?.attacks?.[n - 1];
        if (a) act({ kind: "attack", attackName: a.name });
      });
    }
    k.onKeyPress("c", () => act({ kind: "catch" }));
    k.onKeyPress("f", () => act({ kind: "flee" }));
    k.onKeyPress("space", () => {
      if (!net.state.connected || net.state.roundResult) { net.close(); k.go("start"); return; }
      const cc = net.state.combat;
      if (cc && cc.outcome) net.clearCombat();
    });

    k.onKeyPress("escape", () => { net.close(); k.go("start"); });

    // Pointer/touch input: during combat, taps hit the action buttons; otherwise
    // the left-side virtual joystick drives movement. Works for touch and mouse.
    function pointerDown(id, p) {
      if (!net.state.connected || net.state.roundResult) { net.close(); k.go("start"); return; }
      const cc = net.state.combat;
      if (cc) {
        if (cc.outcome) { net.clearCombat(); return; }
        const action = hitButton(p);
        if (action) act(action);
        return;
      }
      joyStart(id, p);
    }
    k.onTouchStart((p, t) => pointerDown(t?.identifier ?? 0, p));
    k.onTouchMove((p, t) => joyMove(t?.identifier ?? 0, p));
    k.onTouchEnd((p, t) => joyEnd(t?.identifier ?? 0));
    if (!TOUCH) {
      // Desktop: mouse drives the same joystick / button taps (touch devices use
      // the touch handlers; skip mouse to avoid synthesized double-fires).
      k.onMousePress(() => pointerDown("m", k.mousePos()));
      k.onMouseMove(() => { if (joyId === "m") joyMove("m", k.mousePos()); });
      k.onMouseRelease(() => joyEnd("m"));
    }
  });
}
