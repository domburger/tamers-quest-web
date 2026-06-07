import { getCharacters, createCharacter, deleteCharacter, saveCharacter } from "../storage.js";
import { getMonsterTypes, getMonsterStats } from "../data.js";
import { uid } from "../uid.js";
import { THEME, addMenuBackground, addHeader } from "../ui/theme.js";

export default function characterSelectScene(k) {
  k.scene("characterSelect", () => {
    addMenuBackground(k);

    addHeader(k, { x: k.width() / 2, y: 50, text: "SELECT CHARACTER", size: 36 });

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
          k.rect(500, 64, { radius: 12 }),
          k.pos(k.width() / 2, y),
          k.anchor("center"),
          k.color(...THEME.surface),
          k.outline(2, k.rgb(...THEME.line)),
          k.area(),
          "charUI",
        ]);

        slot.onClick(() => {
          k.go("lobby", { characterId: char.id });
        });

        slot.onHoverUpdate(() => {
          slot.color = k.rgb(...THEME.surfaceAlt);
        });

        slot.onHoverEnd(() => {
          slot.color = k.rgb(...THEME.surface);
        });

        k.add([
          k.text(char.name, { size: 22, font: "gameFont" }),
          k.pos(k.width() / 2 - 200, y),
          k.anchor("left"),
          k.color(...THEME.text),
          "charUI",
        ]);

        k.add([
          k.text(`Lv.${char.level}     Monsters: ${monsterCount}`, {
            size: 16,
            font: "gameFont",
          }),
          k.pos(k.width() / 2 + 60, y),
          k.anchor("left"),
          k.color(...THEME.textMut),
          "charUI",
        ]);

        const delBtn = k.add([
          k.rect(30, 30, { radius: 8 }),
          k.pos(k.width() / 2 + 230, y),
          k.anchor("center"),
          k.color(...THEME.surfaceAlt),
          k.area(),
          "charUI",
        ]);

        k.add([
          k.text("X", { size: 16, font: "gameFont" }),
          k.pos(k.width() / 2 + 230, y),
          k.anchor("center"),
          k.color(...THEME.danger),
          "charUI",
        ]);

        delBtn.onClick(() => {
          showDeleteConfirm(char);
        });
      });

      // Inviting empty state — the player avatar + a welcome line fill what was an
      // empty void when no tamers exist yet.
      if (characters.length === 0) {
        try {
          k.add([k.sprite("player"), k.pos(k.width() / 2, 250), k.anchor("center"), k.scale(2.6), "charUI"]);
        } catch { /* sprite not ready */ }
        k.add([k.text("No tamers yet", { size: 24, font: "gameFont" }),
          k.pos(k.width() / 2, 360), k.anchor("center"), k.color(...THEME.text), "charUI"]);
        k.add([k.text("Create your first tamer to enter the caves.", { size: 15, font: "gameFont" }),
          k.pos(k.width() / 2, 392), k.anchor("center"), k.color(...THEME.textMut), "charUI"]);
      }
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
        k.color(255, 255, 255),
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
      k.rect(240, 48, { radius: 12 }),
      k.pos(k.width() / 2, k.height() - 80),
      k.anchor("center"),
      k.color(...THEME.success),
      k.area(),
    ]);

    k.add([
      k.text("+ New Character", { size: 20, font: "gameFont" }),
      k.pos(k.width() / 2, k.height() - 80),
      k.anchor("center"),
      k.color(...THEME.textInv),
    ]);

    newBtn.onClick(() => {
      showNameInput();
    });
    newBtn.onHoverUpdate(() => { newBtn.color = k.rgb(...THEME.success).lighten(18); });
    newBtn.onHoverEnd(() => { newBtn.color = k.rgb(...THEME.success); });

    const backBtn = k.add([
      k.text("< Back", { size: 20, font: "gameFont" }),
      k.pos(30, 30),
      k.anchor("topleft"),
      k.color(...THEME.textMut),
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
        k.color(...THEME.text),
        "nameInput",
      ]);

      k.add([
        k.rect(360, 44, { radius: 6 }),
        k.pos(k.width() / 2, k.height() / 2),
        k.anchor("center"),
        k.color(...THEME.surface),
        k.outline(2, k.rgb(...THEME.line)),
        "nameInput",
      ]);

      const inputLabel = k.add([
        k.text("_", { size: 22, font: "gameFont" }),
        k.pos(k.width() / 2, k.height() / 2),
        k.anchor("center"),
        k.color(...THEME.text),
        "nameInput",
      ]);

      const hint = k.add([
        k.text("Press ENTER to confirm, ESC to cancel", { size: 14, font: "gameFont" }),
        k.pos(k.width() / 2, k.height() / 2 + 50),
        k.anchor("center"),
        k.color(...THEME.textMut),
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
      const char = createCharacter(name);
      char.activeMonsters = starters;
      saveCharacter(char);
      k.destroyAll("nameInput");
      renderList();
    }
  });
}
