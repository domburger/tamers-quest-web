import { THEME, FONT, addButton, addLabel } from "../ui/theme.js";

export default function startScene(k) {
  k.scene("start", () => {
    const cx = k.width() / 2;

    // Procedural flat background + thin frame
    k.add([k.sprite("title_background"), k.pos(cx, k.height() / 2), k.anchor("center")]);
    k.add([k.sprite("title_background_border"), k.pos(cx, k.height() / 2), k.anchor("center"), k.opacity(0.9)]);

    // Wordmark — bold flat ink with a single strong accent word + accent bar.
    k.add([
      k.text("TAMERS", { size: 92, font: FONT }),
      k.pos(cx, k.height() * 0.24), k.anchor("center"), k.color(...THEME.text),
    ]);
    k.add([
      k.text("QUEST", { size: 92, font: FONT }),
      k.pos(cx, k.height() * 0.24 + 88), k.anchor("center"), k.color(...THEME.primary),
    ]);
    // Accent underline bar
    k.add([
      k.rect(220, 6, { radius: 3 }),
      k.pos(cx, k.height() * 0.24 + 142), k.anchor("center"), k.color(...THEME.fire),
    ]);
    addLabel(k, { x: cx, y: k.height() * 0.24 + 168, text: "MONSTER TAMING · CAVE EXTRACTION",
      size: 16, color: THEME.textMut });

    // Primary call to action
    addButton(k, {
      x: cx, y: k.height() * 0.70, w: 280, h: 58, text: "Play Online", size: 24,
      fill: THEME.primary, onClick: () => k.go("onlineLobby"),
    });

    // Secondary actions (flat neutral cards)
    addButton(k, {
      x: cx - 150, y: k.height() * 0.70 + 74, w: 200, h: 46, text: "Single Player", size: 18,
      fill: THEME.surfaceAlt, textColor: THEME.text, onClick: () => k.go("characterSelect"),
    });
    addButton(k, {
      x: cx + 150, y: k.height() * 0.70 + 74, w: 200, h: 46, text: "Bestiary", size: 18,
      fill: THEME.surfaceAlt, textColor: THEME.text, onClick: () => k.go("bestiary"),
    });

    addLabel(k, { x: cx, y: k.height() - 30, text: "Press ENTER for Single Player",
      size: 15, color: THEME.textMut });

    addLabel(k, { x: k.width() - 16, y: k.height() - 16, text: "v1.0.0",
      size: 14, anchor: "botright", color: THEME.textMut });

    // Leaderboard card — top extractors, fetched from the live server.
    const card = k.add([
      k.rect(260, 132, { radius: 12 }), k.pos(20, 20), k.anchor("topleft"),
      k.color(...THEME.surface), k.outline(2, k.Color.fromHex("#CDD3DD")), k.fixed(), k.opacity(0),
    ]);
    const board = k.add([
      k.text("", { size: 15, font: FONT, width: 230 }),
      k.pos(36, 36), k.anchor("topleft"), k.color(...THEME.text), k.fixed(),
    ]);
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
