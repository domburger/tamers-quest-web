import { net } from "../netClient.js";
import { generateMap } from "../engine/mapgen.js";

// Online lobby: pick a nickname → connect → join (anonymous session) → queue →
// show matchmaking status → transition to onlineGame on roundStart. Single-player
// flow is untouched; this is reached via "Play Online" on the start screen.
export default function onlineLobbyScene(k) {
  k.scene("onlineLobby", () => {
    k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(12, 12, 22)]);
    k.add([
      k.text("Play Online", { size: 40, font: "gameFont" }),
      k.pos(k.width() / 2, 70), k.anchor("center"), k.color(255, 255, 255),
    ]);

    let nickname = net.state.nickname || "";
    let connecting = false;
    let status = "Enter a nickname, then Connect.";

    k.add([
      k.text("Nickname:", { size: 18, font: "gameFont" }),
      k.pos(k.width() / 2, k.height() / 2 - 70), k.anchor("center"), k.color(160, 160, 180),
    ]);
    k.add([
      k.rect(360, 44, { radius: 6 }), k.pos(k.width() / 2, k.height() / 2 - 30),
      k.anchor("center"), k.color(25, 25, 40), k.outline(2, k.Color.fromHex("#666688")),
    ]);
    const nickLabel = k.add([
      k.text(nickname + "_", { size: 22, font: "gameFont" }),
      k.pos(k.width() / 2, k.height() / 2 - 30), k.anchor("center"), k.color(255, 255, 255),
    ]);
    const statusLabel = k.add([
      k.text("", { size: 16, font: "gameFont", width: k.width() - 120 }),
      k.pos(k.width() / 2, k.height() - 90), k.anchor("center"), k.color(180, 180, 200),
    ]);
    const setStatus = (s) => { status = s; statusLabel.text = status; };
    setStatus(status);

    // Nickname input (handlers cancelled on scene leave to avoid leaks).
    const handlers = [
      k.onCharInput((ch) => { if (!connecting && nickname.length < 20) { nickname += ch; nickLabel.text = nickname + "_"; } }),
      k.onKeyPress("backspace", () => { if (!connecting) { nickname = nickname.slice(0, -1); nickLabel.text = nickname + "_"; } }),
      k.onKeyPress("enter", () => startConnect()),
    ];

    function button(label, y, color, onClick) {
      const bg = k.add([
        k.rect(240, 48, { radius: 8 }), k.pos(k.width() / 2, y), k.anchor("center"),
        k.color(...color), k.area(),
      ]);
      k.add([k.text(label, { size: 20, font: "gameFont" }), k.pos(k.width() / 2, y), k.anchor("center"), k.color(240, 240, 240)]);
      bg.onClick(onClick);
      bg.onHoverUpdate(() => { bg.color = k.rgb(color[0] + 25, color[1] + 25, color[2] + 25); });
      bg.onHoverEnd(() => { bg.color = k.rgb(...color); });
      return bg;
    }

    button("Connect & Queue", k.height() / 2 + 40, [60, 130, 90], () => startConnect());
    button("Back", k.height() / 2 + 100, [100, 60, 60], () => { cleanup(); net.close(); k.go("start"); });

    // Net event wiring — net.on returns an unsubscribe fn.
    const offs = [
      net.on("open", () => { setStatus("Connected. Joining…"); net.join(nickname.trim()); }),
      net.on("welcome", () => { setStatus("Joined. Entering queue…"); net.queue(); }),
      net.on("queued", (m) => setStatus(`In queue (position ${m.position})… waiting for players.`)),
      net.on("matchFound", () => setStatus("Match found! Generating the world…")),
      net.on("roundStart", () => {
        cleanup();
        setStatus("Generating world…");
        generateMap((p) => setStatus(`Generating world… ${Math.round(p * 100)}%`), net.state.seed)
          .then((map) => k.go("onlineGame", { map }))
          .catch(() => setStatus("Failed to generate the world."));
      }),
      net.on("error", () => { setStatus("Connection error — is the server running?"); connecting = false; }),
      net.on("close", () => { if (net.state.phase !== "in_round") { setStatus("Disconnected."); connecting = false; } }),
    ];

    function startConnect() {
      if (connecting) return;
      if (!nickname.trim()) { setStatus("Please enter a nickname first."); return; }
      connecting = true;
      setStatus("Connecting…");
      if (net.state.connected) net.join(nickname.trim());
      else net.connect();
    }

    function cleanup() {
      handlers.forEach((h) => h && h.cancel && h.cancel());
      offs.forEach((off) => off && off());
    }
  });
}
