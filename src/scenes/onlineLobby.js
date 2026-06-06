import { net } from "../netClient.js";
import { generateMap } from "../engine/mapgen.js";

// Online lobby: nickname → connect → join → queue → matchmaking status →
// onlineGame on roundStart. Uses a real HTML <input> for the nickname so the
// mobile soft-keyboard appears (Kaboom captures keys on the canvas, which never
// triggers it). Single-player flow is untouched.
export default function onlineLobbyScene(k) {
  k.scene("onlineLobby", () => {
    k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(12, 12, 22)]);
    k.add([
      k.text("Play Online", { size: 42, font: "gameFont" }),
      k.pos(k.width() / 2, k.height() * 0.26), k.anchor("center"), k.color(255, 255, 255),
    ]);

    // Real DOM input → shows the mobile keyboard; overlaid on the canvas.
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Enter a nickname";
    input.maxLength = 20;
    input.value = net.state.nickname || "";
    Object.assign(input.style, {
      position: "fixed", left: "50%", top: "42%", transform: "translate(-50%, -50%)",
      zIndex: "1000", width: "min(70vw, 280px)", padding: "12px 14px", fontSize: "18px",
      textAlign: "center", color: "#ffffff", background: "#1b1b2b",
      border: "2px solid #555577", borderRadius: "8px", outline: "none", fontFamily: "inherit",
    });
    document.body.appendChild(input);
    setTimeout(() => input.focus(), 50);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") startConnect(); });

    const status = k.add([
      k.text("Enter a nickname, then Connect.", { size: 18, font: "gameFont", width: k.width() - 80 }),
      k.pos(k.width() / 2, k.height() - 90), k.anchor("center"), k.color(255, 255, 255),
    ]);
    const setStatus = (s) => { status.text = s; };
    let connecting = false;

    function button(label, y, onClick) {
      const bg = k.add([
        k.rect(240, 52, { radius: 8 }), k.pos(k.width() / 2, y), k.anchor("center"),
        k.color(60, 120, 150), k.area(),
      ]);
      k.add([k.text(label, { size: 20, font: "gameFont" }), k.pos(k.width() / 2, y), k.anchor("center"), k.color(255, 255, 255)]);
      bg.onClick(onClick);
      bg.onHoverUpdate(() => { bg.color = k.rgb(80, 145, 180); });
      bg.onHoverEnd(() => { bg.color = k.rgb(60, 120, 150); });
      return bg;
    }
    button("Connect & Queue", k.height() * 0.62, () => startConnect());
    button("Back", k.height() * 0.62 + 64, () => { cleanup(); net.close(); k.go("start"); });

    const offs = [
      net.on("open", () => { setStatus("Connected. Joining…"); net.join(nick()); }),
      net.on("welcome", () => { setStatus("Joined. Entering queue…"); net.queue(); }),
      net.on("queued", (m) => setStatus(`In queue (#${m.position})… waiting for players.`)),
      net.on("matchFound", () => setStatus("Match found! Generating the world…")),
      net.on("roundStart", () => {
        cleanup();
        setStatus("Generating world…");
        generateMap((p) => setStatus(`Generating world… ${Math.round(p * 100)}%`), net.state.seed)
          .then((map) => k.go("onlineGame", { map }))
          .catch(() => setStatus("Failed to generate the world."));
      }),
      net.on("error", () => { setStatus("Connection error — is the server up?"); connecting = false; }),
      net.on("close", () => { if (net.state.phase !== "in_round") { setStatus("Disconnected."); connecting = false; } }),
    ];

    function nick() { return (input.value || "").trim(); }
    function startConnect() {
      if (connecting) return;
      if (!nick()) { setStatus("Please enter a nickname first."); input.focus(); return; }
      connecting = true;
      setStatus("Connecting…");
      if (net.state.connected) net.join(nick());
      else net.connect();
    }
    function cleanup() {
      offs.forEach((off) => off && off());
      input.remove();
    }
    k.onSceneLeave(() => input.remove());
  });
}
