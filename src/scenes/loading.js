import { generateMap } from "../engine/mapgen.js";

export default function loadingScene(k) {
  k.scene("loading", ({ characterId }) => {
    k.add([
      k.rect(k.width(), k.height()),
      k.pos(0, 0),
      k.color(8, 8, 16),
    ]);

    const statusText = k.add([
      k.text("Generating Dungeon...", { size: 28, font: "gameFont" }),
      k.pos(k.width() / 2, k.height() / 2 - 50),
      k.anchor("center"),
      k.color(200, 200, 220),
    ]);

    const barW = 400;
    const barH = 24;
    const barX = k.width() / 2 - barW / 2;
    const barY = k.height() / 2 + 10;

    k.add([
      k.rect(barW, barH, { radius: 4 }),
      k.pos(barX, barY),
      k.color(30, 30, 50),
      k.outline(1, k.Color.fromHex("#555555")),
    ]);

    const fill = k.add([
      k.rect(1, barH - 4, { radius: 3 }),
      k.pos(barX + 2, barY + 2),
      k.color(60, 180, 120),
    ]);

    const detailText = k.add([
      k.text("", { size: 14, font: "gameFont" }),
      k.pos(k.width() / 2, barY + 50),
      k.anchor("center"),
      k.color(120, 120, 140),
    ]);

    generateMap((progress, message) => {
      fill.width = Math.max(1, (barW - 4) * progress);
      if (message) detailText.text = message;
    }).then((mapData) => {
      k.go("game", { characterId, mapData });
    });
  });
}
