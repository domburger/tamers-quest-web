import { getApiKey, setApiKey } from "../systems/combat.js";
import { THEME, addButton, addLabel } from "../ui/theme.js";

export default function settingsScene(k) {
  k.scene("settings", ({ characterId }) => {
    const cx = k.width() / 2;
    k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(...THEME.bg)]);

    addLabel(k, { x: cx, y: 50, text: "SETTINGS", size: 36, color: THEME.text });

    // API Key section
    addLabel(k, { x: cx, y: 140, text: "OpenAI API Key", size: 22, color: THEME.text });
    addLabel(k, { x: cx, y: 174, width: 500,
      text: "Used for AI-mediated combat. Leave blank for offline mode.",
      size: 14, color: THEME.textMut });

    const currentKey = getApiKey();
    const masked = currentKey
      ? currentKey.slice(0, 7) + "..." + currentKey.slice(-4)
      : "(not set)";

    const keyDisplay = k.add([
      k.text(masked, { size: 16, font: "gameFont" }),
      k.pos(cx, 212),
      k.anchor("center"),
      k.color(currentKey ? k.rgb(...THEME.success) : k.rgb(...THEME.textMut)),
    ]);

    const setBtn = addButton(k, { x: cx - 110, y: 264, w: 200, h: 46, text: "Set Key",
      size: 18, fill: THEME.primary });
    const clearBtn = addButton(k, { x: cx + 110, y: 264, w: 200, h: 46, text: "Clear Key",
      size: 18, fill: THEME.danger });

    clearBtn.onClick(() => {
      setApiKey("");
      keyDisplay.text = "(not set)";
      keyDisplay.color = k.rgb(...THEME.textMut);
    });

    // Back button
    const backBtn = k.add([
      k.text("< Back", { size: 20, font: "gameFont" }),
      k.pos(30, 30),
      k.anchor("topleft"),
      k.color(...THEME.textMut),
      k.area(),
    ]);
    backBtn.onClick(() => {
      k.go("lobby", { characterId });
    });

    // Key input modal
    let inputActive = false;
    let inputText = "";
    let inputHandlers = [];

    setBtn.onClick(() => showKeyInput());

    function showKeyInput() {
      if (inputActive) return;
      inputActive = true;
      inputText = "";
      k.destroyAll("keyInput");

      k.add([
        k.rect(k.width(), k.height()),
        k.pos(0, 0),
        k.color(8, 9, 13),
        k.opacity(0.72),
        "keyInput",
      ]);

      k.add([
        k.text("Paste or type your OpenAI API key:", { size: 20, font: "gameFont" }),
        k.pos(k.width() / 2, k.height() / 2 - 80),
        k.anchor("center"),
        k.color(...THEME.text),
        "keyInput",
      ]);

      k.add([
        k.rect(500, 44, { radius: 10 }),
        k.pos(k.width() / 2, k.height() / 2),
        k.anchor("center"),
        k.color(...THEME.surface),
        k.outline(2, k.rgb(...THEME.line)),
        "keyInput",
      ]);

      const inputLabel = k.add([
        k.text("_", { size: 16, font: "gameFont", width: 480 }),
        k.pos(k.width() / 2, k.height() / 2),
        k.anchor("center"),
        k.color(...THEME.text),
        "keyInput",
      ]);

      k.add([
        k.text("ENTER to save, ESC to cancel", { size: 14, font: "gameFont" }),
        k.pos(k.width() / 2, k.height() / 2 + 50),
        k.anchor("center"),
        k.color(...THEME.textMut),
        "keyInput",
      ]);

      // Cancel handlers from a previous open so input isn't multiplied.
      inputHandlers.forEach((h) => h.cancel());
      inputHandlers = [
        k.onCharInput((ch) => {
          if (!inputActive) return;
          if (inputText.length < 200) {
            inputText += ch;
            const display =
              inputText.length > 40
                ? inputText.slice(0, 7) + "..." + inputText.slice(-4)
                : inputText;
            inputLabel.text = display + "_";
          }
        }),
        k.onKeyPress("backspace", () => {
          if (!inputActive) return;
          inputText = inputText.slice(0, -1);
          const display =
            inputText.length > 40
              ? inputText.slice(0, 7) + "..." + inputText.slice(-4)
              : inputText;
          inputLabel.text = (display || "") + "_";
        }),
        k.onKeyPress("enter", () => {
          if (!inputActive) return;
          inputActive = false;
          const key = inputText.trim();
          if (key) {
            setApiKey(key);
            keyDisplay.text = key.slice(0, 7) + "..." + key.slice(-4);
            keyDisplay.color = k.rgb(...THEME.success);
          }
          k.destroyAll("keyInput");
        }),
        k.onKeyPress("escape", () => {
          if (!inputActive) return;
          inputActive = false;
          k.destroyAll("keyInput");
        }),
      ];
    }
  });
}
