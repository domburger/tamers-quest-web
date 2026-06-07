import { generateMap } from "../engine/mapgen.js";
import { THEME, FONT } from "../ui/theme.js";

export default function loadingScene(k) {
  k.scene("loading", ({ characterId }) => {
    const cx = k.width() / 2, cy = k.height() / 2;

    k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(...THEME.bg)]);

    // Soft teal spirit-glow behind the loader, gently pulsing.
    const glow = k.add([
      k.circle(150), k.pos(cx, cy - 6), k.anchor("center"),
      k.color(...THEME.teal), k.opacity(0.06),
    ]);
    k.onUpdate(() => { glow.opacity = 0.05 + 0.05 * Math.abs(Math.sin(k.time() * 1.6)); });

    const statusText = k.add([
      k.text("OPENING THE PORTAL", { size: 28, font: FONT }),
      k.pos(cx, cy - 54), k.anchor("center"), k.color(...THEME.text),
    ]);

    const barW = 420, barH = 18;
    const barX = cx - barW / 2, barY = cy + 6;

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
      k.text("", { size: 14, font: FONT }),
      k.pos(cx, barY + 44), k.anchor("center"), k.color(...THEME.textMut),
    ]);

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
