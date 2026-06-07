import { THEME, addLabel, addButton } from "../ui/theme.js";
import { isMuted, toggleMuted } from "../systems/audio.js";

export default function settingsScene(k) {
  k.scene("settings", ({ characterId }) => {
    const cx = k.width() / 2;
    k.add([k.sprite("menu_background"), k.pos(k.width() / 2, k.height() / 2), k.anchor("center")]);

    addLabel(k, { x: cx, y: 50, text: "SETTINGS", size: 36, color: THEME.text });

    // Sound on/off (persisted via audio.js localStorage). The mute was previously
    // only reachable via the in-round "M" key — undiscoverable from the menus.
    // Rebuild the button on toggle (tagged → destroyAll) so its base colour tracks
    // state cleanly rather than fighting addButton's captured-at-creation hover base.
    addLabel(k, { x: cx - 90, y: 176, text: "Sound", size: 24, color: THEME.text });
    function drawSoundBtn() {
      k.destroyAll("soundbtn");
      const on = !isMuted();
      addButton(k, {
        x: cx + 72, y: 176, w: 140, h: 46, text: on ? "On" : "Off",
        fill: on ? THEME.success : THEME.surfaceAlt,
        textColor: on ? THEME.textInv : THEME.textMut,
        tag: "soundbtn",
        onClick: () => { toggleMuted(); drawSoundBtn(); },
      });
    }
    drawSoundBtn();
    addLabel(k, { x: cx, y: 232, text: "All music & sound effects (also toggleable with M in-game).",
      size: 13, color: THEME.textMut });

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
    k.onKeyPress("escape", () => k.go("lobby", { characterId })); // VS-15: Escape = Back (menu-nav consistency)
  });
}
