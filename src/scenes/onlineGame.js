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
    k.add([
      k.text("WASD to move · ESC to leave", { size: 12, font: "gameFont" }),
      k.pos(12, k.height() - 24), k.color(210, 210, 220), k.fixed(), k.z(100),
    ]);

    // Smooth render positions (interpolate toward authoritative snapshots).
    const lerp = (a, b, t) => a + (b - a) * t;
    const selfRender = { x: net.state.self.x, y: net.state.self.y };
    const othersRender = new Map(); // id -> { x, y, moving }
    let selfMoving = false;
    let awaiting = false; // true while a combat turn is being resolved (AI ~1-2s)
    let lastLogLen = 0;

    let sendAcc = 0;
    k.onUpdate(() => {
      let dx = 0, dy = 0;
      if (k.isKeyDown("w") || k.isKeyDown("up")) dy = -1;
      if (k.isKeyDown("s") || k.isKeyDown("down")) dy = 1;
      if (k.isKeyDown("a") || k.isKeyDown("left")) dx = -1;
      if (k.isKeyDown("d") || k.isKeyDown("right")) dx = 1;
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

      // Combat overlay (server locks movement during a fight).
      const c = net.state.combat;
      if (c) {
        const H = 150, top = k.height() - H;
        k.drawRect({ pos: k.vec2(0, top), width: k.width(), height: H, color: k.rgb(10, 10, 20), opacity: 0.92, fixed: true });
        k.drawText({ text: `Wild ${c.enemy.typeName} Lv.${c.enemy.level}  HP ${c.enemy.currentHealth}/${c.enemy.maxHealth}`, pos: k.vec2(16, top + 10), size: 16, font: "gameFont", color: k.rgb(255, 255, 255), fixed: true });
        k.drawText({ text: `Your ${c.active.name} Lv.${c.active.level}  HP ${c.active.currentHealth}/${c.active.maxHealth}`, pos: k.vec2(16, top + 34), size: 16, font: "gameFont", color: k.rgb(255, 255, 255), fixed: true });
        k.drawText({ text: (c.attacks || []).map((a, i) => `[${i + 1}] ${a.name}`).join("    "), pos: k.vec2(16, top + 62), size: 13, font: "gameFont", color: k.rgb(255, 255, 255), fixed: true });
        k.drawText({ text: "[C] Catch    [F] Flee", pos: k.vec2(16, top + 84), size: 13, font: "gameFont", color: k.rgb(255, 255, 255), fixed: true });
        const last = c.log[c.log.length - 1] || "A wild monster appeared!";
        const line = c.outcome ? `${last}  —  ${c.outcome.toUpperCase()}!  [space]` : (awaiting ? "Resolving…" : last);
        k.drawText({ text: line, pos: k.vec2(16, top + 110), size: 13, font: "gameFont", width: k.width() - 32, color: k.rgb(255, 255, 255), fixed: true });
      }

      // Round result (extracted / died) overlay.
      const rr = net.state.roundResult;
      if (rr) {
        k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: k.rgb(0, 0, 0), opacity: 0.7, fixed: true });
        const win = rr.outcome === "extracted";
        k.drawText({ text: win ? "EXTRACTED!" : "RUN OVER", pos: k.vec2(k.width() / 2, k.height() / 2 - 30), size: 48, font: "gameFont", anchor: "center", color: win ? k.rgb(120, 230, 150) : k.rgb(230, 120, 120), fixed: true });
        k.drawText({ text: `${rr.reason}  ·  [space] to return`, pos: k.vec2(k.width() / 2, k.height() / 2 + 30), size: 18, font: "gameFont", anchor: "center", color: k.rgb(220, 220, 230), fixed: true });
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
      if (net.state.roundResult) { net.close(); k.go("start"); return; }
      const cc = net.state.combat;
      if (cc && cc.outcome) net.clearCombat();
    });

    k.onKeyPress("escape", () => { net.close(); k.go("start"); });
  });
}
