import { getCharacter, saveCharacter } from "../storage.js";
import { getMonsterTypes, getMonsterType, getMonsterStats } from "../data.js";
import { uid } from "../uid.js";
import { THEME, addButton, addLabel } from "../ui/theme.js";

export default function runResultScene(k) {
  k.scene("runResult", ({ characterId, result }) => {
    const character = getCharacter(characterId);
    if (!character) {
      k.go("characterSelect");
      return;
    }

    k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(...THEME.caveDeep)]);

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
          id: uid(),
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

    addLabel(k, { x: k.width() / 2, y: k.height() / 2 - 80, text: title, size: 48,
      color: isVictory ? THEME.success : THEME.danger });

    addLabel(k, { x: k.width() / 2, y: k.height() / 2 - 10, text: subtitle, size: 18,
      width: 600, color: THEME.textMut });

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
            k.rect(48, 48, { radius: 10 }),
            k.pos(x, previewY + 10),
            k.anchor("center"),
            k.color(...THEME.surfaceAlt),
          ]);
        }
        k.add([
          k.text(mon.typeName, { size: 11, font: "gameFont", width: 100 }),
          k.pos(x, previewY + 45),
          k.anchor("center"),
          k.color(...THEME.text),
        ]);
      });
    }

    const btnY = isVictory ? k.height() / 2 + 80 : k.height() / 2 + 140;
    addButton(k, {
      x: k.width() / 2, y: btnY, w: 220, h: 50, text: "Continue", size: 22,
      fill: isVictory ? THEME.success : THEME.primary,
      onClick: () => k.go("lobby", { characterId }),
    });

    k.onKeyPress("enter", () => {
      k.go("lobby", { characterId });
    });
  });
}
