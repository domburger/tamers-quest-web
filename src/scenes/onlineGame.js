import { net } from "../netClient.js";
import { GAME } from "../engine/schemas.js";
import { generateMap } from "../engine/mapgen.js";

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
      k.pos(12, 12), k.color(200, 210, 220), k.fixed(), k.z(100),
    ]);
    k.add([
      k.text("WASD to move · ESC to leave", { size: 12, font: "gameFont" }),
      k.pos(12, k.height() - 24), k.color(120, 130, 150), k.fixed(), k.z(100),
    ]);

    let sendAcc = 0;
    k.onUpdate(() => {
      let dx = 0, dy = 0;
      if (k.isKeyDown("w") || k.isKeyDown("up")) dy = -1;
      if (k.isKeyDown("s") || k.isKeyDown("down")) dy = 1;
      if (k.isKeyDown("a") || k.isKeyDown("left")) dx = -1;
      if (k.isKeyDown("d") || k.isKeyDown("right")) dx = 1;
      // Send continuously while held (server consumes one intent per tick), ~20Hz.
      sendAcc += k.dt();
      if ((dx || dy) && sendAcc >= 0.05) { net.move(dx, dy); sendAcc = 0; }

      k.camPos(net.state.self.x, net.state.self.y);
      info.text =
        `Online · round ${net.state.roundId ?? "?"} · seed ${net.state.seed ?? "?"}\n` +
        `You (${net.state.nickname ?? "?"}): (${Math.round(net.state.self.x)}, ${Math.round(net.state.self.y)})\n` +
        `Players in view: ${net.state.players.length + 1}`;
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

      // Other players (server-authoritative positions from snapshots).
      for (const p of net.state.players) {
        k.drawCircle({ pos: k.vec2(p.x, p.y), radius: 12, color: k.rgb(230, 120, 120) });
        k.drawText({ text: p.name || "?", pos: k.vec2(p.x, p.y - 22), size: 12, font: "gameFont", anchor: "center", color: k.rgb(255, 200, 200) });
      }
      // You.
      const me = net.state.self;
      k.drawCircle({ pos: k.vec2(me.x, me.y), radius: 12, color: k.rgb(120, 200, 255) });
      k.drawText({ text: net.state.nickname || "You", pos: k.vec2(me.x, me.y - 22), size: 12, font: "gameFont", anchor: "center", color: k.rgb(200, 230, 255) });
    });

    k.onKeyPress("escape", () => { net.close(); k.go("start"); });
  });
}
