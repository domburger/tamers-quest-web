import { getCharacter } from "../storage.js";

export default function lobbyScene(k) {
  k.scene("lobby", ({ characterId }) => {
    const character = getCharacter(characterId);
    if (!character) {
      k.go("characterSelect");
      return;
    }

    k.add([
      k.rect(k.width(), k.height()),
      k.pos(0, 0),
      k.color(12, 12, 22),
    ]);

    k.add([
      k.text("Tamers Quest", { size: 38, font: "gameFont" }),
      k.pos(k.width() / 2, 50),
      k.anchor("center"),
      k.color(255, 255, 255),
    ]);

    k.add([
      k.text(`${character.name}  —  Level ${character.level}`, {
        size: 22,
        font: "gameFont",
      }),
      k.pos(k.width() / 2, 100),
      k.anchor("center"),
      k.color(180, 180, 200),
    ]);

    const hasMonsters = character.activeMonsters && character.activeMonsters.length > 0;

    const buttons = [
      { label: "Start Run", color: hasMonsters ? [60, 140, 90] : [50, 50, 50], action: () => {
        if (!hasMonsters) return;
        k.go("loading", { characterId });
      }},
      { label: "Inventory", color: [60, 90, 140], action: () => k.go("inventory", { characterId }) },
      { label: "Settings", color: [90, 80, 120], action: () => k.go("settings", { characterId }) },
      { label: "Back", color: [100, 60, 60], action: () => k.go("characterSelect") },
    ];

    const btnW = 280;
    const btnH = 56;
    const btnGap = 16;
    const startY = k.height() / 2 - ((buttons.length * (btnH + btnGap)) / 2);

    buttons.forEach((btn, i) => {
      const y = startY + i * (btnH + btnGap);

      const bg = k.add([
        k.rect(btnW, btnH, { radius: 8 }),
        k.pos(k.width() / 2, y),
        k.anchor("center"),
        k.color(...btn.color),
        k.outline(2, k.Color.fromHex("#555555")),
        k.area(),
      ]);

      k.add([
        k.text(btn.label, { size: 22, font: "gameFont" }),
        k.pos(k.width() / 2, y),
        k.anchor("center"),
        k.color(240, 240, 240),
      ]);

      bg.onHoverUpdate(() => {
        bg.color = k.rgb(btn.color[0] + 30, btn.color[1] + 30, btn.color[2] + 30);
      });

      bg.onHoverEnd(() => {
        bg.color = k.rgb(...btn.color);
      });

      bg.onClick(btn.action);
    });

    // Monster team preview
    const teamY = k.height() - 130;
    k.add([
      k.text("Your Team", { size: 18, font: "gameFont" }),
      k.pos(k.width() / 2, teamY - 30),
      k.anchor("center"),
      k.color(140, 140, 160),
    ]);

    const monsters = character.activeMonsters || [];
    const teamWidth = monsters.length * 100;
    const teamStartX = k.width() / 2 - teamWidth / 2 + 50;

    monsters.forEach((mon, i) => {
      const x = teamStartX + i * 100;
      const spriteName = mon.typeName.toLowerCase().replace(/\s+/g, "_");

      try {
        k.add([
          k.sprite(spriteName),
          k.pos(x, teamY + 20),
          k.anchor("center"),
          k.scale(0.4),
        ]);
      } catch {
        k.add([
          k.rect(64, 64, { radius: 8 }),
          k.pos(x, teamY + 20),
          k.anchor("center"),
          k.color(50, 50, 70),
        ]);
      }

      k.add([
        k.text(`Lv.${mon.level}`, { size: 12, font: "gameFont" }),
        k.pos(x, teamY + 60),
        k.anchor("center"),
        k.color(180, 180, 180),
      ]);
    });
  });
}
