import { THEME, addLabel, addButton, addPanel, addMenuBackground, addHeader } from "../ui/theme.js";
import { isMuted, toggleMuted, getVolume, setVolume, sfx } from "../systems/audio.js";
import { reduceMotionSetting, setReduceMotion } from "../systems/a11y.js";
import { shakeEnabled, toggleShake } from "../render/shake.js";
import { safeInsetsDesign } from "../systems/safearea.js"; // MOB: edge controls off notches/home bar
import { touchPrimary } from "../systems/inputMode.js"; // shared mobile detection (keyboard-availability hint)

export default function settingsScene(k) {
  k.scene("settings", ({ characterId, backScene }) => {
    const cx = k.width() / 2;
    const ins = safeInsetsDesign(k);
    const TOUCH = touchPrimary(k); // mobile (no physical keyboard) → adjust the mute hint accordingly
    addMenuBackground(k);

    // On narrow screens the wide "< Back" button (centred at x≈92, right edge ≈154) reaches
    // past where the centred title would sit, so drop the title just below the button (there's
    // room before the AUDIO label at y=132). Wide keeps it at the top.
    const narrow = k.width() < 560;
    addHeader(k, { x: cx, y: narrow ? 100 : 46, text: "SETTINGS", size: 34 });

    // Framed card so the controls read as an intentional panel rather than floating
    // in the void (matches the polished card treatment used elsewhere).
    const pw = Math.min(520, k.width() - 40);
    // Row labels are LEFT-anchored at the panel's left padding (not centred at cx-96, which
    // pushed long labels like "Reduce Motion" off the left edge once the portrait design width
    // shrinks to ~330px). Shrink them on narrow so they clear the right-side toggle button.
    const lblX = cx - pw / 2 + 18, lblSize = narrow ? 17 : 24;
    addPanel(k, { x: cx, y: 196, w: pw, h: 176, radius: 16, fill: THEME.surface });
    addLabel(k, { x: cx, y: 132, text: "AUDIO", size: 13, color: THEME.teal });

    // Sound on/off (persisted via audio.js localStorage). The mute was previously
    // only reachable via the in-round "M" key — undiscoverable from the menus.
    // Rebuild the button on toggle (tagged → destroyAll) so its base colour tracks
    // state cleanly rather than fighting addButton's captured-at-creation hover base.
    addLabel(k, { x: lblX, y: 176, text: "Sound", size: lblSize, anchor: "left", color: THEME.text });
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

    // Master volume — a fine control over all SFX (mute is the hard on/off). Stepped
    // −/+ in 10% increments: robust on canvas + touch (no drag-slider hit-testing), and
    // each change plays a tick at the new level so you hear it. Persisted via audio.js.
    addLabel(k, { x: lblX, y: 224, text: "Volume", size: lblSize, anchor: "left", color: THEME.text });
    function step(delta) { setVolume(Math.round(getVolume() * 100 + delta) / 100); sfx("ui"); drawVolCtl(); }
    function drawVolCtl() {
      k.destroyAll("volctl");
      const pct = Math.round(getVolume() * 100);
      addButton(k, { x: cx + 18, y: 224, w: 40, h: 42, text: "-", size: 28, fill: THEME.surfaceAlt, textColor: pct <= 0 ? THEME.textMut : THEME.text, tag: "volctl", onClick: () => step(-10) });
      addLabel(k, { x: cx + 72, y: 224, text: `${pct}%`, size: 20, color: pct === 0 ? THEME.textMut : THEME.text, tag: "volctl" });
      addButton(k, { x: cx + 126, y: 224, w: 40, h: 42, text: "+", size: 24, fill: THEME.surfaceAlt, textColor: pct >= 100 ? THEME.textMut : THEME.text, tag: "volctl", onClick: () => step(10) });
    }
    drawVolCtl();
    addLabel(k, { x: cx, y: 262, text: TOUCH ? "All music & sound effects (mute is also in the in-run pause menu)." : "All music & sound effects (mute also toggles with M in a run).",
      size: 13, color: THEME.textMut, width: pw - 16, align: "center" });

    // Accessibility: Reduce Motion (extends VS-18, which only read the OS setting).
    // 3-state: Auto follows the device; On/Off override it. Render code reads
    // prefersReducedMotion() live, so the choice applies next time you're in a round.
    addPanel(k, { x: cx, y: 388, w: pw, h: 186, radius: 16, fill: THEME.surface });
    addLabel(k, { x: cx, y: 314, text: "ACCESSIBILITY", size: 13, color: THEME.teal });
    addLabel(k, { x: lblX, y: 352, text: "Reduce Motion", size: lblSize, anchor: "left", color: THEME.text });
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
    addLabel(k, { x: cx, y: 392, text: "Auto follows your device; dims ambient motion (motes, pulses, glow).",
      size: 13, color: THEME.textMut, width: pw - 16, align: "center" });

    // Screen Shake — a dedicated toggle (shake is the most discomfort-prone effect, so it
    // gets its own switch independent of Reduce Motion). Persisted via shake.js.
    addLabel(k, { x: lblX, y: 430, text: "Screen Shake", size: lblSize, anchor: "left", color: THEME.text });
    function drawShakeBtn() {
      k.destroyAll("shkbtn");
      const on = shakeEnabled();
      addButton(k, {
        x: cx + 78, y: 430, w: 140, h: 46, text: on ? "On" : "Off",
        fill: on ? THEME.success : THEME.surfaceAlt, textColor: on ? THEME.textInv : THEME.textMut,
        tag: "shkbtn",
        onClick: () => { toggleShake(); drawShakeBtn(); },
      });
    }
    drawShakeBtn();
    addLabel(k, { x: cx, y: 466, text: "Camera kick on storm/combat hits (off = no shake, other motion kept).",
      size: 13, color: THEME.textMut, width: pw - 16, align: "center" });

    // Back button — a real themed button (chrome + hover glow + SFX), matching the
    // nav buttons elsewhere instead of the lone bare-text link this used to be.
    addButton(k, {
      x: 92 + ins.left, y: 44 + ins.top, w: 124, h: 40, text: "< Back", size: 18,
      fill: THEME.surfaceAlt, textColor: THEME.text,
      onClick: () => k.go(backScene || "lobby", { characterId }),
    });
    k.onKeyPress("escape", () => k.go(backScene || "lobby", { characterId })); // VS-15: Escape = Back (menu-nav consistency)
  });
}
