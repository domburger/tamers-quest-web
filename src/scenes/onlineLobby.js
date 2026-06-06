import { net } from "../netClient.js";
import { generateMap } from "../engine/mapgen.js";
import { THEME, PAL } from "../ui/theme.js";

// Online lobby: nickname → connect → join → queue → matchmaking status →
// onlineGame on roundStart. Uses a real HTML <input> for the nickname so the
// mobile soft-keyboard appears (Kaboom captures keys on the canvas, which never
// triggers it). Single-player flow is untouched.
export default function onlineLobbyScene(k) {
  k.scene("onlineLobby", () => {
    k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(...THEME.bg)]);
    k.add([
      k.text("PLAY ONLINE", { size: 40, font: "gameFont" }),
      k.pos(k.width() / 2, k.height() * 0.26), k.anchor("center"), k.color(...THEME.text),
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
      textAlign: "center", color: PAL.text, background: PAL.surface,
      border: `2px solid ${PAL.line}`, borderRadius: "12px", outline: "none", fontFamily: "inherit",
    });
    document.body.appendChild(input);
    setTimeout(() => input.focus(), 50);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") startConnect(); });

    const status = k.add([
      k.text("Enter a nickname, then Connect.", { size: 18, font: "gameFont", width: k.width() - 80 }),
      k.pos(k.width() / 2, k.height() - 90), k.anchor("center"), k.color(...THEME.textMut),
    ]);
    const setStatus = (s) => { status.text = s; };
    let connecting = false;
    let intent = "queue"; // after join: "queue" (find a round) or "roster" (manage team)
    if (net.state.connected && net.state.playerId) setStatus(`Connected as ${net.state.nickname || "Tamer"}. Queue up or manage your team.`);

    function button(label, y, onClick, fill = THEME.primary, textColor = THEME.textInv) {
      const base = k.rgb(...fill);
      const bg = k.add([
        k.rect(260, 52, { radius: 12 }), k.pos(k.width() / 2, y), k.anchor("center"),
        k.color(base), k.area(),
      ]);
      k.add([k.text(label, { size: 20, font: "gameFont" }), k.pos(k.width() / 2, y), k.anchor("center"), k.color(...textColor)]);
      bg.onClick(onClick);
      bg.onHover(() => k.setCursor("pointer"));
      bg.onHoverUpdate(() => { bg.color = base.lighten(18); });
      bg.onHoverEnd(() => { bg.color = base; k.setCursor("default"); });
      return bg;
    }
    button("Connect & Queue", k.height() * 0.56, () => startConnect());
    button("Manage Team", k.height() * 0.56 + 64, () => manageTeam(), THEME.surface, THEME.text);
    button("Back", k.height() * 0.56 + 128, () => { cleanup(); net.close(); k.go("start"); }, THEME.surface, THEME.danger);

    const offs = [
      net.on("open", () => { setStatus("Connected. Joining…"); net.join(nick()); }),
      net.on("welcome", () => {
        if (intent === "roster") { cleanup(); k.go("roster"); return; }
        setStatus("Joined. Entering queue…"); net.queue();
      }),
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
      connecting = true; intent = "queue";
      setStatus("Connecting…");
      if (net.state.playerId) net.queue();            // already joined (e.g. back from Manage Team)
      else if (net.state.connected) net.join(nick());
      else net.connect();
    }
    // Manage Team: ensure we're joined (so the server knows our profile), then open
    // the roster/vault scene. Doesn't queue — the team is locked once you queue.
    function manageTeam() {
      if (net.state.playerId) { cleanup(); k.go("roster"); return; } // already joined
      if (!nick()) { setStatus("Enter a nickname first to manage your team."); input.focus(); return; }
      intent = "roster";
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
