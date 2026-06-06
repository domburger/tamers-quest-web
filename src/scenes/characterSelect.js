import { getCharacters, createCharacter, deleteCharacter, saveCharacter } from "../storage.js";
import { getMonsterTypes, getMonsterStats } from "../data.js";

export default function characterSelectScene(k) {
  k.scene("characterSelect", () => {
    k.add([
      k.rect(k.width(), k.height()),
      k.pos(0, 0),
      k.color(15, 15, 25),
    ]);

    k.add([
      k.text("Select Character", { size: 42, font: "gameFont" }),
      k.pos(k.width() / 2, 60),
      k.anchor("center"),
      k.color(255, 255, 255),
    ]);

    let characters = getCharacters();
    const listY = 130;
    const slotHeight = 80;
    const maxSlots = 5;

    function renderList() {
      k.destroyAll("charUI");

      characters = getCharacters();

      characters.slice(0, maxSlots).forEach((char, i) => {
        const y = listY + i * slotHeight;
        const monsterCount = char.activeMonsters ? char.activeMonsters.length : 0;

        const slot = k.add([
          k.rect(500, 64, { radius: 8 }),
          k.pos(k.width() / 2, y),
          k.anchor("center"),
          k.color(35, 35, 55),
          k.outline(2, k.Color.fromHex("#444444")),
          k.area(),
          "charUI",
        ]);

        slot.onClick(() => {
          k.go("lobby", { characterId: char.id });
        });

        slot.onHoverUpdate(() => {
          slot.color = k.rgb(50, 50, 75);
        });

        slot.onHoverEnd(() => {
          slot.color = k.rgb(35, 35, 55);
        });

        k.add([
          k.text(char.name, { size: 22, font: "gameFont" }),
          k.pos(k.width() / 2 - 200, y),
          k.anchor("left"),
          k.color(230, 230, 230),
          "charUI",
        ]);

        k.add([
          k.text(`Lv.${char.level}  Monsters: ${monsterCount}`, {
            size: 16,
            font: "gameFont",
          }),
          k.pos(k.width() / 2 + 60, y),
          k.anchor("left"),
          k.color(160, 160, 180),
          "charUI",
        ]);

        const delBtn = k.add([
          k.rect(30, 30, { radius: 4 }),
          k.pos(k.width() / 2 + 230, y),
          k.anchor("center"),
          k.color(80, 30, 30),
          k.area(),
          "charUI",
        ]);

        k.add([
          k.text("X", { size: 16, font: "gameFont" }),
          k.pos(k.width() / 2 + 230, y),
          k.anchor("center"),
          k.color(200, 80, 80),
          "charUI",
        ]);

        delBtn.onClick(() => {
          showDeleteConfirm(char);
        });
      });
    }

    function showDeleteConfirm(char) {
      k.destroyAll("deleteConfirm");

      k.add([
        k.rect(k.width(), k.height()),
        k.pos(0, 0),
        k.color(0, 0, 0),
        k.opacity(0.7),
        "deleteConfirm",
      ]);

      k.add([
        k.text(`Delete "${char.name}"?`, { size: 24, font: "gameFont" }),
        k.pos(k.width() / 2, k.height() / 2 - 40),
        k.anchor("center"),
        k.color(255, 200, 200),
        "deleteConfirm",
      ]);

      k.add([
        k.text("This cannot be undone.", { size: 14, font: "gameFont" }),
        k.pos(k.width() / 2, k.height() / 2 - 10),
        k.anchor("center"),
        k.color(140, 140, 160),
        "deleteConfirm",
      ]);

      const yesBtn = k.add([
        k.rect(140, 40, { radius: 6 }),
        k.pos(k.width() / 2 - 80, k.height() / 2 + 30),
        k.anchor("center"),
        k.color(140, 40, 40),
        k.area(),
        "deleteConfirm",
      ]);
      k.add([
        k.text("Delete", { size: 18, font: "gameFont" }),
        k.pos(k.width() / 2 - 80, k.height() / 2 + 30),
        k.anchor("center"),
        k.color(255, 200, 200),
        "deleteConfirm",
      ]);
      yesBtn.onClick(() => {
        deleteCharacter(char.id);
        k.destroyAll("deleteConfirm");
        renderList();
      });

      const noBtn = k.add([
        k.rect(140, 40, { radius: 6 }),
        k.pos(k.width() / 2 + 80, k.height() / 2 + 30),
        k.anchor("center"),
        k.color(50, 70, 50),
        k.area(),
        "deleteConfirm",
      ]);
      k.add([
        k.text("Cancel", { size: 18, font: "gameFont" }),
        k.pos(k.width() / 2 + 80, k.height() / 2 + 30),
        k.anchor("center"),
        k.color(200, 255, 200),
        "deleteConfirm",
      ]);
      noBtn.onClick(() => {
        k.destroyAll("deleteConfirm");
      });
    }

    renderList();

    const newBtn = k.add([
      k.rect(240, 48, { radius: 8 }),
      k.pos(k.width() / 2, k.height() - 80),
      k.anchor("center"),
      k.color(50, 120, 80),
      k.outline(2, k.Color.fromHex("#55aa55")),
      k.area(),
    ]);

    k.add([
      k.text("+ New Character", { size: 20, font: "gameFont" }),
      k.pos(k.width() / 2, k.height() - 80),
      k.anchor("center"),
      k.color(220, 255, 220),
    ]);

    newBtn.onClick(() => {
      showNameInput();
    });

    const backBtn = k.add([
      k.text("< Back", { size: 20, font: "gameFont" }),
      k.pos(30, 30),
      k.anchor("topleft"),
      k.color(180, 180, 180),
      k.area(),
    ]);

    backBtn.onClick(() => {
      k.go("start");
    });

    let inputActive = false;
    let inputText = "";
    let inputHandlers = [];

    function showNameInput() {
      if (inputActive) return;
      inputActive = true;
      inputText = "";
      k.destroyAll("nameInput");

      k.add([
        k.rect(k.width(), k.height()),
        k.pos(0, 0),
        k.color(0, 0, 0),
        k.opacity(0.7),
        "nameInput",
      ]);

      k.add([
        k.text("Enter character name:", { size: 24, font: "gameFont" }),
        k.pos(k.width() / 2, k.height() / 2 - 60),
        k.anchor("center"),
        k.color(220, 220, 220),
        "nameInput",
      ]);

      k.add([
        k.rect(360, 44, { radius: 6 }),
        k.pos(k.width() / 2, k.height() / 2),
        k.anchor("center"),
        k.color(25, 25, 40),
        k.outline(2, k.Color.fromHex("#666666")),
        "nameInput",
      ]);

      const inputLabel = k.add([
        k.text("_", { size: 22, font: "gameFont" }),
        k.pos(k.width() / 2, k.height() / 2),
        k.anchor("center"),
        k.color(255, 255, 255),
        "nameInput",
      ]);

      const hint = k.add([
        k.text("Press ENTER to confirm, ESC to cancel", { size: 14, font: "gameFont" }),
        k.pos(k.width() / 2, k.height() / 2 + 50),
        k.anchor("center"),
        k.color(120, 120, 140),
        "nameInput",
      ]);

      // Cancel handlers from a previous open so input isn't multiplied.
      inputHandlers.forEach((h) => h.cancel());
      inputHandlers = [
        k.onCharInput((ch) => {
          if (!inputActive) return;
          if (inputText.length < 20) {
            inputText += ch;
            inputLabel.text = inputText + "_";
          }
        }),
        k.onKeyPress("backspace", () => {
          if (!inputActive) return;
          inputText = inputText.slice(0, -1);
          inputLabel.text = (inputText || "") + "_";
        }),
        k.onKeyPress("enter", () => {
          if (!inputActive || !inputText.trim()) return;
          inputActive = false;
          confirmCharacter(inputText.trim());
        }),
        k.onKeyPress("escape", () => {
          if (!inputActive) return;
          inputActive = false;
          k.destroyAll("nameInput");
        }),
      ];
    }

    function confirmCharacter(name) {
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
      const char = createCharacter(name);
      char.activeMonsters = starters;
      saveCharacter(char);
      k.destroyAll("nameInput");
      renderList();
    }
  });
}
