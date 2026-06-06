import { net } from "../netClient.js";

// Minimal online round view: server-authoritative positions rendered as labelled
// dots, camera follows you, WASD sends movement intents (throttled to ~20Hz).
// Full seeded-map tile rendering is the next P2 step; this proves the live
// multiplayer loop end-to-end. Single-player game scene is unchanged.
export default function onlineGameScene(k) {
  k.scene("onlineGame", () => {
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
