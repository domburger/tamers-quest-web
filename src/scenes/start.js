import { THEME, FONT, addButton, addLabel, addPanel } from "../ui/theme.js";

export default function startScene(k) {
  k.scene("start", () => {
    const cx = k.width() / 2;

    // Procedural slate background + inset frame.
    k.add([k.sprite("title_background"), k.pos(cx, k.height() / 2), k.anchor("center"), k.z(-10)]);
    // Animated portal pulse over the baked glow (sits behind the wordmark).
    const portal = k.add([
      k.circle(120), k.pos(cx, k.height() * 0.40), k.anchor("center"),
      k.color(...THEME.teal), k.opacity(0.1), k.scale(1), k.z(-9),
    ]);
    k.onUpdate(() => {
      const p = 0.5 + 0.5 * Math.sin(k.time() * 1.8);
      portal.opacity = 0.06 + 0.08 * p;
      portal.scale = k.vec2(0.85 + 0.2 * p);
    });
    k.add([k.sprite("title_background_border"), k.pos(cx, k.height() / 2), k.anchor("center"), k.opacity(0.9), k.z(-8)]);

    // Wordmark — bright "TAMERS", teal-glow "QUEST", amber accent rule.
    const titleY = k.height() * 0.22;
    // soft glow behind the teal word (stacked translucent copies, no blur needed)
    for (const o of [6, 4, 2]) {
      k.add([k.text("QUEST", { size: 96, font: FONT }), k.pos(cx, titleY + 92),
        k.anchor("center"), k.color(...THEME.teal), k.opacity(0.12), k.scale(1 + o * 0.01), k.z(-1)]);
    }
    k.add([k.text("TAMERS", { size: 96, font: FONT }), k.pos(cx, titleY),
      k.anchor("center"), k.color(...THEME.text)]);
    k.add([k.text("QUEST", { size: 96, font: FONT }), k.pos(cx, titleY + 92),
      k.anchor("center"), k.color(...THEME.teal)]);
    k.add([k.rect(230, 5, { radius: 3 }), k.pos(cx, titleY + 150), k.anchor("center"), k.color(...THEME.violet)]);
    // Tagline — light text over a soft dark shadow so it stays legible across the
    // bright portal glow (middle) AND the dark backdrop (ends); plain `textMut`
    // washed out against the glow.
    const tagY = titleY + 178, tagText = "MONSTER TAMING · CAVE EXTRACTION";
    k.add([k.text(tagText, { size: 16, font: FONT }), k.pos(cx + 1.5, tagY + 1.5),
      k.anchor("center"), k.color(...THEME.bgAlt), k.opacity(0.85)]);
    addLabel(k, { x: cx, y: tagY, text: tagText, size: 16, color: THEME.textBody });

    // Grouped call-to-action panel.
    const panelY = k.height() * 0.74;
    addPanel(k, { x: cx, y: panelY, w: 380, h: 196, radius: 18, fill: THEME.surface });

    addButton(k, { x: cx, y: panelY - 52, w: 300, h: 56, text: "Play Online", size: 24,
      fill: THEME.primary, onClick: () => k.go("onlineLobby") });
    addButton(k, { x: cx - 78, y: panelY + 26, w: 144, h: 48, text: "Single Player", size: 16,
      fill: THEME.surface2, textColor: THEME.text, onClick: () => k.go("characterSelect") });
    addButton(k, { x: cx + 78, y: panelY + 26, w: 144, h: 48, text: "Bestiary", size: 16,
      fill: THEME.surface2, textColor: THEME.text, onClick: () => k.go("bestiary") });

    addLabel(k, { x: cx, y: k.height() - 26, text: "Press ENTER for Single Player",
      size: 14, color: THEME.textMut });
    addLabel(k, { x: k.width() - 18, y: k.height() - 16, text: "v1.0.0",
      size: 13, anchor: "botright", color: THEME.textMut });

    // Leaderboard card — top extractors, fetched from the live server.
    const card = addPanel(k, { x: 150, y: 96, w: 252, h: 140, radius: 14, fixed: true, opacity: 0 });
    const board = addLabel(k, { x: 40, y: 40, text: "", size: 15, width: 230,
      anchor: "topleft", color: THEME.textBody, fixed: true });
    fetch("/api/leaderboard")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const top = (d && d.extractions) || [];
        if (top.length) {
          card.opacity = 1;
          board.text = "TOP EXTRACTORS\n" + top.slice(0, 5).map((e, i) => `${i + 1}. ${e.name} — ${e.value}`).join("\n");
        }
      })
      .catch(() => {});

    k.onKeyPress("enter", () => k.go("characterSelect"));
    k.onKeyPress("space", () => k.go("characterSelect"));
    k.onKeyPress("b", () => k.go("bestiary"));
  });
}
