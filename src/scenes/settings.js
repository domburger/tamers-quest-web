import { getApiKey, setApiKey } from "../systems/combat.js";

export default function settingsScene(k) {
  k.scene("settings", ({ characterId }) => {
    k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(12, 12, 22)]);

    k.add([
      k.text("Settings", { size: 38, font: "gameFont" }),
      k.pos(k.width() / 2, 50),
      k.anchor("center"),
      k.color(255, 255, 255),
    ]);

    // API Key section
    k.add([
      k.text("OpenAI API Key", { size: 22, font: "gameFont" }),
      k.pos(k.width() / 2, 140),
      k.anchor("center"),
      k.color(255, 255, 255),
    ]);

    k.add([
      k.text("Used for AI-mediated combat. Leave blank for offline mode.", {
        size: 14,
        font: "gameFont",
        width: 500,
      }),
      k.pos(k.width() / 2, 170),
      k.anchor("center"),
      k.color(255, 255, 255),
    ]);

    const currentKey = getApiKey();
    const masked = currentKey
      ? currentKey.slice(0, 7) + "..." + currentKey.slice(-4)
      : "(not set)";

    const keyDisplay = k.add([
      k.text(masked, { size: 16, font: "gameFont" }),
      k.pos(k.width() / 2, 210),
      k.anchor("center"),
      k.color(currentKey ? k.rgb(80, 200, 120) : k.rgb(180, 100, 100)),
    ]);

    // Set key button
    const setBtn = k.add([
      k.rect(200, 44, { radius: 8 }),
      k.pos(k.width() / 2 - 110, 260),
      k.anchor("center"),
      k.color(50, 80, 120),
      k.area(),
    ]);
    k.add([
      k.text("Set Key", { size: 18, font: "gameFont" }),
      k.pos(k.width() / 2 - 110, 260),
      k.anchor("center"),
      k.color(255, 255, 255),
    ]);

    // Clear key button
    const clearBtn = k.add([
      k.rect(200, 44, { radius: 8 }),
      k.pos(k.width() / 2 + 110, 260),
      k.anchor("center"),
      k.color(120, 50, 50),
      k.area(),
    ]);
    k.add([
      k.text("Clear Key", { size: 18, font: "gameFont" }),
      k.pos(k.width() / 2 + 110, 260),
      k.anchor("center"),
      k.color(255, 255, 255),
    ]);

    clearBtn.onClick(() => {
      setApiKey("");
      keyDisplay.text = "(not set)";
      keyDisplay.color = k.rgb(180, 100, 100);
    });

    // Back button
    const backBtn = k.add([
      k.text("< Back", { size: 20, font: "gameFont" }),
      k.pos(30, 30),
      k.anchor("topleft"),
      k.color(255, 255, 255),
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
        k.color(0, 0, 0),
        k.opacity(0.7),
        "keyInput",
      ]);

      k.add([
        k.text("Paste or type your OpenAI API key:", { size: 20, font: "gameFont" }),
        k.pos(k.width() / 2, k.height() / 2 - 80),
        k.anchor("center"),
        k.color(255, 255, 255),
        "keyInput",
      ]);

      k.add([
        k.rect(500, 44, { radius: 6 }),
        k.pos(k.width() / 2, k.height() / 2),
        k.anchor("center"),
        k.color(25, 25, 40),
        k.outline(2, k.Color.fromHex("#666666")),
        "keyInput",
      ]);

      const inputLabel = k.add([
        k.text("_", { size: 16, font: "gameFont", width: 480 }),
        k.pos(k.width() / 2, k.height() / 2),
        k.anchor("center"),
        k.color(255, 255, 255),
        "keyInput",
      ]);

      k.add([
        k.text("ENTER to save, ESC to cancel", { size: 14, font: "gameFont" }),
        k.pos(k.width() / 2, k.height() / 2 + 50),
        k.anchor("center"),
        k.color(255, 255, 255),
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
            keyDisplay.color = k.rgb(80, 200, 120);
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
