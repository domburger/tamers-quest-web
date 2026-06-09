import { generateMap } from "../engine/mapgen.js";
import { THEME, FONT_BODY, addHeader } from "../ui/theme.js";
import { prefersReducedMotion } from "../systems/a11y.js";

export default function loadingScene(k) {
  k.scene("loading", ({ characterId }) => {
    const cx = k.width() / 2, cy = k.height() / 2;

    k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(...THEME.bg)]);

    // Spirit-portal glow behind the loader: concentric translucent teal circles
    // form a soft radial glow with a bright core, gently breathing — echoes the
    // title screen's portal motif so "opening the portal" reads visually instead
    // of as an empty void.
    const layers = [[250, 0.045], [185, 0.07], [125, 0.10], [72, 0.15], [38, 0.22]];
    const glows = layers.map(([r, o]) =>
      k.add([k.circle(r), k.pos(cx, cy - 6), k.anchor("center"), k.color(...THEME.teal), k.opacity(o)]));
    const rm = prefersReducedMotion(); // a11y: freeze the pulse if reduce-motion is set
    k.onUpdate(() => {
      const p = rm ? 1 : 0.72 + 0.28 * Math.abs(Math.sin(k.time() * 1.6));
      for (let i = 0; i < glows.length; i++) glows[i].opacity = layers[i][1] * p;
    });

    // Title gets the shared page-header signature (teal accent rule) so the loader
    // reads as part of the same polished family as every other screen.
    const statusText = addHeader(k, { x: cx, y: cy - 58, text: "OPENING THE PORTAL", size: 28, ruleW: 150 });

    const barW = Math.min(420, k.width() - 80), barH = 18;
    const barX = cx - barW / 2, barY = cy + 6;

    // Soft teal glow halo behind the bar (parity with the button glow + the portal
    // motif) so the hero loader element reads as luminous, not a flat slab.
    k.add([
      k.rect(barW + 18, barH + 14, { radius: (barH + 14) / 2 }), k.pos(barX - 9, barY - 7),
      k.color(...THEME.teal), k.opacity(0.12),
    ]);
    // Track + fill (teal), with a hairline border.
    k.add([
      k.rect(barW, barH, { radius: barH / 2 }), k.pos(barX, barY),
      k.color(...THEME.surface), k.outline(2, k.rgb(...THEME.line)),
    ]);
    const fill = k.add([
      k.rect(2, barH - 6, { radius: (barH - 6) / 2 }), k.pos(barX + 3, barY + 3),
      k.color(...THEME.primary),
    ]);

    const detailText = k.add([
      k.text("", { size: 14, font: FONT_BODY }),
      k.pos(cx, barY + 44), k.anchor("center"), k.color(...THEME.textMut),
    ]);

    // Rotating gameplay tips — the loading wait is free onboarding airtime. These
    // reinforce the mechanics playtesters found unclear (chains, biomes, the storm,
    // extraction stakes). Short, glyph-free, swapped every few seconds.
    const TIPS = [
      "Throw a spirit chain (Space) along your heading to catch wild monsters.",
      "Cycle equipped chains with [ and ] — higher tiers catch rarer monsters.",
      "Reach a glowing portal to EXTRACT — it banks the chains you found this run.",
      "Die in the caves and you lose the chains you found this run. Extract to keep them.",
      "The safe zone shrinks over time. Outside it, the storm drains your team.",
      "The caves are split into biomes — each with its own mood and palette.",
      "Hold Shift to sprint when stamina allows; let it recharge between dashes.",
      "Teams no longer auto-heal — visit the free Healer in the lobby between runs.",
      "Open loot chests for spirit chains and essence — essence upgrades chains.",
      "Spend gold between runs at the Spirit Shop, and on permanent Base Upgrades.",
    ];
    let tipIdx = Math.floor(Math.random() * TIPS.length);
    const tipText = k.add([
      k.text(TIPS[tipIdx], { size: 14, font: FONT_BODY, width: Math.min(barW + 120, k.width() - 48) }),
      k.pos(cx, barY + 92), k.anchor("center"), k.color(...THEME.textBody),
    ]);
    let tipT = 0;
    k.onUpdate(() => {
      tipT += k.dt();
      if (tipT >= 3.2) { tipT = 0; tipIdx = (tipIdx + 1) % TIPS.length; tipText.text = TIPS[tipIdx]; }
    });

    generateMap((progress, message) => {
      fill.width = Math.max(2, (barW - 6) * progress);
      if (message) detailText.text = message;
    }).then((mapData) => {
      k.go("game", { characterId, mapData });
    }).catch((e) => {
      // Without this, a generation failure leaves the player stuck on the loading
      // screen forever (no back button) with an unhandled rejection. Surface it and
      // return to the lobby so they can retry. (Mirrors onlineLobby's guard.)
      console.error("Map generation failed:", e);
      statusText.text = "MAP GENERATION FAILED";
      statusText.color = k.rgb(...THEME.danger);
      // VS-14: surface the actual error on-screen in DEV (saves opening the
      // console); prod keeps a generic, non-leaky message.
      detailText.text = import.meta.env.DEV ? `${e?.message || e}`.slice(0, 90) : "Returning to lobby…";
      k.wait(2, () => k.go("lobby", { characterId }));
    });
  });
}
