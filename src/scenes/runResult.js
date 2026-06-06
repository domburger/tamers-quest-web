import { getCharacter, saveCharacter } from "../storage.js";
import { getMonsterTypes, getMonsterType, getMonsterStats } from "../data.js";

export default function runResultScene(k) {
  k.scene("runResult", ({ characterId, result }) => {
    const character = getCharacter(characterId);
    if (!character) {
      k.go("characterSelect");
      return;
    }

    k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(8, 8, 16)]);

    const isVictory = result === "victory";

    if (isVictory) {
      // Heal all active monsters to full
      const active = character.activeMonsters || [];
      for (const mon of active) {
        const mt = getMonsterType(mon.typeName);
        if (mt) {
          const stats = getMonsterStats(mt, mon.level);
          mon.currentHealth = stats.health;
          mon.currentEnergy = stats.energy;
          mon.status = null;
        }
      }
      saveCharacter(character);
    } else {
      // Defeat: lose entire team, get 4 random starters
      const allMonsters = getMonsterTypes();
      const shuffled = [...allMonsters].sort(() => Math.random() - 0.5);
      const starters = [];
      for (let i = 0; i < Math.min(4, shuffled.length); i++) {
        const mt = shuffled[i];
        const stats = getMonsterStats(mt, 1);
        starters.push({
          id: Date.now() + i,
          typeName: mt.typeName,
          name: mt.typeName,
          level: 1,
          xp: 0,
          currentHealth: stats.health,
          currentEnergy: stats.energy,
          status: null,
        });
      }
      character.activeMonsters = starters;
      character.vaultMonsters = character.vaultMonsters || [];
      saveCharacter(character);
    }

    const title = isVictory ? "You Escaped!" : "Defeat!";
    const subtitle = isVictory
      ? "You made it through the portal. Your team has been fully healed."
      : "All your monsters have been lost. You received 4 new random monsters.";

    k.add([
      k.text(title, { size: 48, font: "gameFont" }),
      k.pos(k.width() / 2, k.height() / 2 - 80),
      k.anchor("center"),
      k.color(isVictory ? 80 : 255, isVictory ? 220 : 80, isVictory ? 140 : 80),
    ]);

    k.add([
      k.text(subtitle, { size: 18, font: "gameFont", width: 600 }),
      k.pos(k.width() / 2, k.height() / 2 - 10),
      k.anchor("center"),
      k.color(255, 255, 255),
    ]);

    // Show new team preview on defeat
    if (!isVictory) {
      const monsters = character.activeMonsters;
      const previewY = k.height() / 2 + 50;
      const teamWidth = monsters.length * 120;
      const startX = k.width() / 2 - teamWidth / 2 + 60;

      monsters.forEach((mon, i) => {
        const x = startX + i * 120;
        const spriteName = mon.typeName.toLowerCase().replace(/\s+/g, "_");
        try {
          k.add([
            k.sprite(spriteName),
            k.pos(x, previewY + 10),
            k.anchor("center"),
            k.scale(0.5),
          ]);
        } catch {
          k.add([
            k.rect(48, 48, { radius: 6 }),
            k.pos(x, previewY + 10),
            k.anchor("center"),
            k.color(50, 50, 70),
          ]);
        }
        k.add([
          k.text(mon.typeName, { size: 11, font: "gameFont", width: 100 }),
          k.pos(x, previewY + 45),
          k.anchor("center"),
          k.color(255, 255, 255),
        ]);
      });
    }

    const btnY = isVictory ? k.height() / 2 + 80 : k.height() / 2 + 140;
    const btn = k.add([
      k.rect(200, 48, { radius: 8 }),
      k.pos(k.width() / 2, btnY),
      k.anchor("center"),
      k.color(50, 100, 80),
      k.area(),
    ]);

    k.add([
      k.text("Continue", { size: 22, font: "gameFont" }),
      k.pos(k.width() / 2, btnY),
      k.anchor("center"),
      k.color(220, 255, 220),
    ]);

    btn.onClick(() => {
      k.go("lobby", { characterId });
    });

    btn.onHoverUpdate(() => {
      btn.color = k.rgb(70, 130, 100);
    });
    btn.onHoverEnd(() => {
      btn.color = k.rgb(50, 100, 80);
    });

    k.onKeyPress("enter", () => {
      k.go("lobby", { characterId });
    });
  });
}
