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
      k.text("Press ENTER for Single Player", { size: 24, font: "gameFont" }),
      k.pos(k.width() / 2, k.height() * 0.66),
      k.anchor("center"),
      k.color(255, 255, 255),
      k.opacity(1),
    ]);

    let elapsed = 0;
    prompt.onUpdate(() => {
      elapsed += k.dt();
      prompt.opacity = 0.4 + 0.6 * Math.abs(Math.sin(elapsed * 2));
    });

    // Online entry (non-destructive — single-player is unchanged).
    const onlineBtn = k.add([
      k.rect(240, 50, { radius: 8 }),
      k.pos(k.width() / 2, k.height() * 0.78),
      k.anchor("center"),
      k.color(60, 110, 150),
      k.outline(2, k.Color.fromHex("#6fb0e0")),
      k.area(),
    ]);
    k.add([
      k.text("Play Online", { size: 22, font: "gameFont" }),
      k.pos(k.width() / 2, k.height() * 0.78),
      k.anchor("center"),
      k.color(225, 240, 255),
    ]);
    onlineBtn.onClick(() => k.go("onlineLobby"));
    onlineBtn.onHoverUpdate(() => { onlineBtn.color = k.rgb(80, 135, 180); });
    onlineBtn.onHoverEnd(() => { onlineBtn.color = k.rgb(60, 110, 150); });

    // Bestiary (procedural-art / monster gallery).
    const bestBtn = k.add([
      k.rect(200, 42, { radius: 8 }),
      k.pos(k.width() / 2, k.height() * 0.88),
      k.anchor("center"),
      k.color(78, 70, 110),
      k.outline(2, k.Color.fromHex("#a98fd0")),
      k.area(),
    ]);
    k.add([
      k.text("Bestiary", { size: 20, font: "gameFont" }),
      k.pos(k.width() / 2, k.height() * 0.88),
      k.anchor("center"),
      k.color(232, 224, 248),
    ]);
    bestBtn.onClick(() => k.go("bestiary"));
    bestBtn.onHoverUpdate(() => { bestBtn.color = k.rgb(98, 88, 138); });
    bestBtn.onHoverEnd(() => { bestBtn.color = k.rgb(78, 70, 110); });
    k.onKeyPress("b", () => k.go("bestiary"));

    k.add([
      k.text("v1.0.0", { size: 16, font: "gameFont" }),
      k.pos(k.width() - 16, k.height() - 16),
      k.anchor("botright"),
      k.color(180, 180, 180),
    ]);

    // Leaderboard (P8-T4) — top extractors, fetched from the live server.
    const board = k.add([
      k.text("", { size: 16, font: "gameFont", width: 280 }),
      k.pos(20, 20), k.color(210, 210, 220), k.fixed(),
    ]);
    fetch("/api/leaderboard")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const top = (d && d.extractions) || [];
        if (top.length) {
          board.text = "TOP EXTRACTORS\n" + top.slice(0, 5).map((e, i) => `${i + 1}. ${e.name} — ${e.value}`).join("\n");
        }
      })
      .catch(() => {});

    k.onKeyPress("enter", () => k.go("characterSelect"));
    k.onKeyPress("space", () => k.go("characterSelect"));
  });
}
