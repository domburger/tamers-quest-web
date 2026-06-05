export default function startScene(k) {
  k.scene("start", () => {
    // Procedural background (generated at 1280x720, matches canvas size)
    k.add([
      k.sprite("title_background"),
      k.pos(k.width() / 2, k.height() / 2),
      k.anchor("center"),
    ]);

    // Ornate border overlay
    k.add([
      k.sprite("title_background_border"),
      k.pos(k.width() / 2, k.height() / 2),
      k.anchor("center"),
      k.opacity(0.85),
    ]);

    // Stylized text logo (procedural — no PNG)
    k.add([
      k.text("TAMERS", { size: 84, font: "gameFont" }),
      k.pos(k.width() / 2, k.height() * 0.3),
      k.anchor("center"),
      k.color(245, 215, 120),
      k.outline(4, k.Color.fromHex("#2a2030")),
    ]);
    k.add([
      k.text("QUEST", { size: 84, font: "gameFont" }),
      k.pos(k.width() / 2, k.height() * 0.3 + 80),
      k.anchor("center"),
      k.color(220, 230, 255),
      k.outline(4, k.Color.fromHex("#2a2030")),
    ]);

    const prompt = k.add([
      k.text("Press any key to start", { size: 28, font: "gameFont" }),
      k.pos(k.width() / 2, k.height() * 0.72),
      k.anchor("center"),
      k.color(220, 220, 220),
      k.opacity(1),
    ]);

    let elapsed = 0;
    prompt.onUpdate(() => {
      elapsed += k.dt();
      prompt.opacity = 0.4 + 0.6 * Math.abs(Math.sin(elapsed * 2));
    });

    k.add([
      k.text("v1.0.0", { size: 16, font: "gameFont" }),
      k.pos(k.width() - 16, k.height() - 16),
      k.anchor("botright"),
      k.color(120, 120, 120),
    ]);

    k.onKeyPress(() => {
      k.go("characterSelect");
    });

    k.onMousePress(() => {
      k.go("characterSelect");
    });
  });
}
