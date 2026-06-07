import { THEME, addLabel, addButton, addPanel, addMenuBackground, addHeader } from "../ui/theme.js";
import { isMuted, toggleMuted } from "../systems/audio.js";
import { reduceMotionSetting, setReduceMotion } from "../systems/a11y.js";

export default function settingsScene(k) {
  k.scene("settings", ({ characterId }) => {
    const cx = k.width() / 2;
    addMenuBackground(k);

    addHeader(k, { x: cx, y: 46, text: "SETTINGS", size: 34 });

    // Framed card so the controls read as an intentional panel rather than floating
    // in the void (matches the polished card treatment used elsewhere).
    addPanel(k, { x: cx, y: 188, w: 520, h: 150, radius: 16, fill: THEME.surface });
    addLabel(k, { x: cx, y: 138, text: "AUDIO", size: 13, color: THEME.teal });

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

    // Accessibility: Reduce Motion (extends VS-18, which only read the OS setting).
    // 3-state: Auto follows the device; On/Off override it. Render code reads
    // prefersReducedMotion() live, so the choice applies next time you're in a round.
    addPanel(k, { x: cx, y: 360, w: 520, h: 130, radius: 16, fill: THEME.surface });
    addLabel(k, { x: cx, y: 314, text: "ACCESSIBILITY", size: 13, color: THEME.teal });
    addLabel(k, { x: cx - 96, y: 352, text: "Reduce Motion", size: 22, color: THEME.text });
    const RM_LABEL = { auto: "Auto", on: "On", off: "Off" };
    const RM_NEXT = { auto: "on", on: "off", off: "auto" };
    function drawRmBtn() {
      k.destroyAll("rmbtn");
      const s = reduceMotionSetting();
      addButton(k, {
        x: cx + 78, y: 352, w: 140, h: 46, text: RM_LABEL[s] || "Auto",
        fill: s === "on" ? THEME.success : s === "off" ? THEME.surfaceAlt : THEME.primary,
        textColor: s === "off" ? THEME.textMut : THEME.textInv,
        tag: "rmbtn",
        onClick: () => { setReduceMotion(RM_NEXT[reduceMotionSetting()] || "on"); drawRmBtn(); },
      });
    }
    drawRmBtn();
    addLabel(k, { x: cx, y: 408, text: "Auto follows your device; dims ambient motion (motes, pulses, glow).",
      size: 13, color: THEME.textMut });

    // Back button — a real themed button (chrome + hover glow + SFX), matching the
    // nav buttons elsewhere instead of the lone bare-text link this used to be.
    addButton(k, {
      x: 92, y: 44, w: 124, h: 40, text: "< Back", size: 18,
      fill: THEME.surface, textColor: THEME.text,
      onClick: () => k.go("lobby", { characterId }),
    });
    k.onKeyPress("escape", () => k.go("lobby", { characterId })); // VS-15: Escape = Back (menu-nav consistency)
  });
}
