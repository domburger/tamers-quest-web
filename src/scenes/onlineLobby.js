import { net } from "../netClient.js";
import { generateMap } from "../engine/mapgen.js";
import { THEME, PAL, addButton, addMenuBackground } from "../ui/theme.js";

// Online lobby: nickname → connect → join → queue → matchmaking status →
// onlineGame on roundStart. Uses a real HTML <input> for the nickname so the
// mobile soft-keyboard appears (Kaboom captures keys on the canvas, which never
// triggers it). Single-player flow is untouched.
export default function onlineLobbyScene(k) {
  k.scene("onlineLobby", () => {
    addMenuBackground(k);
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

    // VS-9: route through the shared themed addButton (hover halo/glow + click/hover
    // SFX + sheen + drop shadow) so the first MP screen matches the rest of the UI.
    function button(label, x, y, onClick, fill = THEME.primary, textColor = THEME.textInv, w = 260, h = 52, size = 20) {
      return addButton(k, { x, y, w, h, text: label, onClick, fill, textColor, size });
    }
    // VS-15: leave the lobby (close the socket → title). Idempotent so the canvas
    // Esc handler and the input's Esc listener can't double-fire it.
    let left = false;
    const back = () => { if (left) return; left = true; cleanup(); net.close(); k.go("start"); };

    // Layout: one prominent primary CTA, then a 2-column grid of the account/
    // management screens (LS-14: online players can now reach Bestiary + Cosmetics
    // too — previously title-only, unreachable once in the lobby). A single column
    // of 7 buttons overflows the screen, so the secondaries grid 2-up.
    const cx = k.width() / 2;
    const primaryY = k.height() * 0.51;
    button("Connect & Queue", cx, primaryY, () => startConnect(), THEME.primary, THEME.textInv, 300, 52, 20);
    const COL = 110, GW = 200, GH = 44, GS = 16; // half-gap between cols, grid button w/h/text-size
    const rowY = (r) => primaryY + 64 + r * 54;
    const grid = [
      ["Manage Team", () => manageTeam()],
      ["Spirit Shop", () => openShop()],
      ["Base Upgrades", () => openUpgrades()], // CN-1
      ["Bestiary", () => openBestiary()],      // LS-14
      ["Cosmetics", () => openCosmetics()],    // LS-14
    ];
    grid.forEach(([label, fn], i) => {
      button(label, cx + (i % 2 ? COL : -COL), rowY(Math.floor(i / 2)), fn, THEME.surface, THEME.text, GW, GH, GS);
    });
    button("Back", cx + COL, rowY(2), back, THEME.surface, THEME.danger, GW, GH, GS); // 6th grid cell
    // Esc backs out from either focus: the canvas (input blurred) and the nickname
    // input (auto-focused on entry) — menu-nav consistency with every other scene.
    k.onKeyPress("escape", back);
    input.addEventListener("keydown", (e) => { if (e.key === "Escape") back(); });

    const offs = [
      net.on("open", () => { setStatus("Connected. Joining…"); net.join(nick()); }),
      net.on("welcome", () => {
        if (intent === "roster") { cleanup(); k.go("roster"); return; }
        if (intent === "shop") { cleanup(); k.go("onlineShop"); return; }
        if (intent === "upgrades") { cleanup(); k.go("onlineBaseUpgrades"); return; } // CN-1
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
    // Spirit Shop: ensure we're joined (so gold + chains are synced), then open
    // the online shop. Like Manage Team, doesn't queue.
    function openShop() {
      if (net.state.playerId) { cleanup(); k.go("onlineShop"); return; } // already joined
      if (!nick()) { setStatus("Enter a nickname first to open the shop."); input.focus(); return; }
      intent = "shop";
      setStatus("Connecting…");
      if (net.state.connected) net.join(nick());
      else net.connect();
    }
    // Base Upgrades (CN-1): ensure we're joined (so gold + upgrade levels sync),
    // then open the online meta-upgrade scene. Like the others, doesn't queue.
    function openUpgrades() {
      if (net.state.playerId) { cleanup(); k.go("onlineBaseUpgrades"); return; } // already joined
      if (!nick()) { setStatus("Enter a nickname first to buy upgrades."); input.focus(); return; }
      intent = "upgrades";
      setStatus("Connecting…");
      if (net.state.connected) net.join(nick());
      else net.connect();
    }
    // Bestiary + Cosmetics (LS-14) are client-only — the bestiary reads the global
    // monster pool and chain skins live in localStorage — so neither needs a server
    // join. Open directly with a back-route to this lobby (both scenes honour
    // `backScene`; bestiary gained it for this).
    function openBestiary() { cleanup(); k.go("bestiary", { backScene: "onlineLobby" }); }
    function openCosmetics() { cleanup(); k.go("cosmetics", { backScene: "onlineLobby" }); }
    function cleanup() {
      offs.forEach((off) => off && off());
      input.remove();
    }
    k.onSceneLeave(() => input.remove());
  });
}
