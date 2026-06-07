import { getCharacter } from "../storage.js";
import { THEME, FONT, addButton, addLabel, addPanel, addMenuBackground, addHeader } from "../ui/theme.js";
import { getMonsterType } from "../engine/gamedata.js";
import { getMonsterStats } from "../engine/stats.js";
import { net } from "../netClient.js";
import { generateMap } from "../engine/mapgen.js";

// THE single lobby hub (FLOW screen 3 / PT1-T04+T05). Reached from character
// select with { characterId }. It unifies the old SP `lobby` and MP `onlineLobby`:
// every account screen (Inventory/Team, Spirit Shop, Base Upgrades, Bestiary,
// Cosmetics, Settings) opens from here, and the SP-vs-MP choice happens at ROUND
// START via the "Play" station — not on the title. Layout target (PT1-T05):
// menu-left / rotatable character-centre / settings-right on wide screens, with a
// single-column stack fallback on narrow/mobile. Esc opens an overlay menu.
export default function lobbyScene(k) {
  k.scene("lobby", ({ characterId }) => {
    const character = getCharacter(characterId);
    if (!character) {
      k.go("characterSelect");
      return;
    }

    const W = k.width(), Hh = k.height();
    const cx = W / 2;
    // 3-column hub only when there's horizontal room; otherwise stack centred so
    // the lobby stays usable on narrow/portrait (design height is a fixed 720, so
    // only width varies — a single centred column always fits vertically).
    const wide = W >= 920;
    const leftX = wide ? Math.max(196, cx - W * 0.32) : cx;
    const rightX = wide ? Math.min(W - 196, cx + W * 0.32) : cx;

    addMenuBackground(k);

    // ── Header + identity ──────────────────────────────────────────────────────
    addHeader(k, { x: cx, y: 44, text: "TAMER'S QUEST", size: 34 });
    addLabel(k, { x: cx, y: 84, text: `${character.name}${character.isGuest ? "  (guest)" : ""}     Lv ${character.level}`, size: 18, color: THEME.textMut });
    // Currencies in their game-identity hues (gold = amber, essence = teal).
    addLabel(k, { x: cx - 12, y: 106, anchor: "right", text: `${character.gold || 0} gold`, size: 14, color: THEME.amber });
    addLabel(k, { x: cx + 12, y: 106, anchor: "left", text: `${character.essence || 0} essence`, size: 14, color: THEME.teal });

    const hasMonsters = character.activeMonsters && character.activeMonsters.length > 0;

    // ── Centre: rotatable character "turntable" ─────────────────────────────────
    // A static top-down sprite spun in-plane (the only rotation a 2-D sprite has) —
    // grab-and-spin via the < > buttons or Left/Right arrow keys, eased so it reads
    // as a turntable rather than a snap.
    const charX = cx, charY = wide ? Hh * 0.5 : 150;
    if (wide) {
      addPanel(k, { x: charX, y: charY, w: 240, h: 260, radius: 18, fill: THEME.surface });
      addLabel(k, { x: charX, y: charY - 116, text: "YOUR TAMER", size: 13, color: THEME.textMut });
    }
    let charSprite = null;
    try {
      charSprite = k.add([k.sprite("player"), k.pos(charX, charY - (wide ? 8 : 0)),
        k.anchor("center"), k.scale(wide ? 3.2 : 1.8)]);
    } catch { /* sprite not ready — skip the preview */ }

    let targetAngle = 0, curAngle = 0;
    const spin = (deg) => { targetAngle += deg; };
    if (charSprite) {
      k.onUpdate(() => {
        curAngle += (targetAngle - curAngle) * Math.min(1, k.dt() * 8);
        try { charSprite.angle = curAngle; } catch {}
      });
      // Rotate buttons flank the sprite on wide; on narrow they sit just under it.
      const ay = wide ? charY : charY + 46;
      const aOff = wide ? 150 : 90;
      addButton(k, { x: charX - aOff, y: ay, w: 44, h: 44, text: "<", size: 24, fill: THEME.surface, textColor: THEME.text, onClick: () => spin(-45) });
      addButton(k, { x: charX + aOff, y: ay, w: 44, h: 44, text: ">", size: 24, fill: THEME.surface, textColor: THEME.text, onClick: () => spin(45) });
      k.onKeyPress("left", () => spin(-45));
      k.onKeyPress("right", () => spin(45));
    }

    // ── Menu stations (left column on wide, top of the stack on narrow) ──────────
    const stations = [
      { label: "Inventory / Team", scene: "inventory", args: { characterId } },
      { label: "Spirit Shop", scene: "shop", args: { characterId } },
      { label: "Base Upgrades", scene: "baseUpgrades", args: { characterId } },
      { label: "Bestiary", scene: "bestiary", args: { backScene: "lobby", backArgs: { characterId }, characterId } },
      { label: "Cosmetics", scene: "cosmetics", args: { backScene: "lobby", backArgs: { characterId } } },
    ];

    const bw = 240, bh = 46, gap = 12;
    if (wide) {
      // Left column: Play CTA on top, then the account stations.
      const colTop = 150;
      addButton(k, { x: leftX, y: colTop, w: bw, h: 56, text: "Play", size: 22,
        fill: THEME.success, textColor: THEME.textInv, onClick: openPlay });
      stations.forEach((s, i) => {
        addButton(k, { x: leftX, y: colTop + 56 / 2 + 24 + bh / 2 + i * (bh + gap), w: bw, h: bh,
          text: s.label, size: 17, fill: THEME.surface, textColor: THEME.text, onClick: () => k.go(s.scene, s.args) });
      });
      // Right column: Settings + Switch Character.
      const rTop = 200;
      addButton(k, { x: rightX, y: rTop, w: bw, h: bh, text: "Settings", size: 18,
        fill: THEME.surface, textColor: THEME.text, onClick: () => k.go("settings", { characterId }) });
      addButton(k, { x: rightX, y: rTop + bh + gap, w: bw, h: bh, text: "Switch Character", size: 16,
        fill: THEME.surface, textColor: THEME.text, onClick: () => k.go("characterSelect") });
      addLabel(k, { x: rightX, y: rTop + 2 * (bh + gap) + 22, text: "Esc — menu", size: 12, color: THEME.textMut });
    } else {
      // Narrow: a single centred column under the preview.
      const all = [
        { label: "Play", fill: THEME.success, textColor: THEME.textInv, onClick: openPlay },
        ...stations.map((s) => ({ label: s.label, fill: THEME.surface, textColor: THEME.text, onClick: () => k.go(s.scene, s.args) })),
        { label: "Settings", fill: THEME.surface, textColor: THEME.text, onClick: () => k.go("settings", { characterId }) },
        { label: "Switch Character", fill: THEME.surface, textColor: THEME.danger, onClick: () => k.go("characterSelect") },
      ];
      const cw = Math.min(280, W - 40);
      const startY = 230 + bh / 2;
      all.forEach((b, i) => {
        addButton(k, { x: cx, y: startY + i * (bh + 8), w: cw, h: bh, text: b.label, size: 17,
          fill: b.fill, textColor: b.textColor, onClick: b.onClick });
      });
    }

    // ── Team strip (bottom) ──────────────────────────────────────────────────────
    const monsters = character.activeMonsters || [];
    if (wide) {
      const teamY = Hh - 96;
      // #8 (PT2-T13): explain the heal — the team rests to full at run start
      // (PT2-T04), so an injured team here isn't a dead end, it's a between-runs
      // state. Surfaces the mechanic so it reads as "handled", not "no way to heal".
      addLabel(k, { x: cx, y: teamY - 46, text: "YOUR TEAM   -   heals to full when a run starts", size: 14, color: THEME.textMut });
      const slot = 92;
      const teamStartX = cx - (Math.max(1, monsters.length) * slot) / 2 + slot / 2;
      monsters.forEach((mon, i) => drawTeamSlot(mon, teamStartX + i * slot, teamY));
    }

    function drawTeamSlot(mon, x, y) {
      addPanel(k, { x, y, w: 78, h: 78, radius: 14, fill: THEME.surface });
      const spriteName = mon.typeName.toLowerCase().replace(/\s+/g, "_");
      try {
        k.add([k.sprite(spriteName), k.pos(x, y - 6), k.anchor("center"), k.scale(0.38)]);
      } catch {
        k.add([k.rect(46, 46, { radius: 10 }), k.pos(x, y - 6), k.anchor("center"), k.color(...THEME.surfaceAlt)]);
      }
      // GP-9: team HP bar — SP monsters keep HP between runs, so an injured team is
      // otherwise invisible before you commit to a run.
      const mt = getMonsterType(mon.typeName);
      let maxHp = mon.currentHealth;
      try { maxHp = getMonsterStats(mt, mon.level).health; } catch {}
      const frac = maxHp > 0 ? Math.max(0, Math.min(1, (mon.currentHealth ?? maxHp) / maxHp)) : 1;
      const barC = frac > 0.5 ? THEME.success : frac > 0.25 ? THEME.warn : THEME.danger;
      const barW = 54;
      k.add([k.rect(barW, 4, { radius: 2 }), k.pos(x - barW / 2, y + 16), k.anchor("topleft"), k.color(...THEME.line)]);
      if (frac > 0) k.add([k.rect(barW * frac, 4, { radius: 2 }), k.pos(x - barW / 2, y + 16), k.anchor("topleft"), k.color(...barC)]);
      addLabel(k, { x, y: y + 30, text: `Lv.${mon.level}`, size: 12, color: THEME.textMut });
    }

    // ── Play → Singleplayer / Multiplayer picker ────────────────────────────────
    // The mode is chosen HERE, at round start (FLOW screen 3). SP enters the local
    // loading→game flow; MP folds in the old onlineLobby connect→join→queue→
    // roundStart sequence, using the character name as the network nickname.
    const netOffs = [];
    let leaving = false;
    let overlayOpen = false;
    function clearNet() { netOffs.forEach((off) => off && off()); netOffs.length = 0; }
    function closeOverlay() { clearNet(); k.destroyAll("overlay"); overlayOpen = false; }

    function dim() {
      k.add([k.rect(W, Hh), k.pos(0, 0), k.anchor("topleft"), k.color(0, 0, 0), k.opacity(0.72), "overlay"]);
    }
    // Tagged panel/label so closeOverlay's destroyAll("overlay") reaps every layer
    // (addPanel/addLabel don't take a tag, so their layers would otherwise leak).
    function oPanel(x, y, w, h) {
      k.add([k.rect(w, h, { radius: 18 }), k.pos(x, y + 5), k.anchor("center"), k.color(0, 0, 0), k.opacity(0.35), "overlay"]);
      k.add([k.rect(w, h, { radius: 18 }), k.pos(x, y), k.anchor("center"), k.color(...THEME.surface), k.outline(2, k.rgb(...THEME.line)), "overlay"]);
    }
    function oLabel(x, y, text, size, color) {
      k.add([k.text(text, { size, font: FONT, width: 340 }), k.pos(x, y), k.anchor("center"), k.color(...color), "overlay"]);
    }

    function openPlay() {
      k.destroyAll("overlay");
      overlayOpen = true;
      dim();
      oPanel(cx, Hh / 2, 360, 280);
      oLabel(cx, Hh / 2 - 104, "ENTER A RUN", 22, THEME.text);
      oLabel(cx, Hh / 2 - 74, "Choose how you want to play", 13, THEME.textMut);

      const tag = "overlay";
      addButton(k, { x: cx, y: Hh / 2 - 30, w: 280, h: 52, text: "Singleplayer", size: 19,
        fill: hasMonsters ? THEME.primary : THEME.surfaceAlt,
        textColor: hasMonsters ? THEME.textInv : THEME.textMut,
        disabled: !hasMonsters, tag, onClick: startSingle });
      if (!hasMonsters) oLabel(cx, Hh / 2 + 2, "No monsters — visit Inventory first", 11, THEME.warn);
      addButton(k, { x: cx, y: Hh / 2 + 34, w: 280, h: 52, text: "Multiplayer", size: 19,
        fill: THEME.violet, textColor: THEME.textInv, tag, onClick: startMulti });
      addButton(k, { x: cx, y: Hh / 2 + 104, w: 200, h: 40, text: "Cancel", size: 16,
        fill: THEME.surface, textColor: THEME.danger, tag, onClick: closeOverlay });
    }

    function startSingle() {
      if (!hasMonsters) return;
      closeOverlay();
      k.go("loading", { characterId });
    }

    // MP search overlay: connect (or reuse an existing connection) → join with the
    // character name → queue → roundStart generates the map → onlineGame.
    function startMulti() {
      k.destroyAll("overlay");
      overlayOpen = true;
      dim();
      oPanel(cx, Hh / 2, 380, 220);
      oLabel(cx, Hh / 2 - 70, "MULTIPLAYER", 22, THEME.text);
      const status = k.add([k.text("Connecting…", { size: 16, font: FONT, width: 340 }),
        k.pos(cx, Hh / 2 - 16), k.anchor("center"), k.color(...THEME.textMut), "overlay"]);
      const setStatus = (s) => { try { status.text = s; } catch {} };
      addButton(k, { x: cx, y: Hh / 2 + 64, w: 200, h: 42, text: "Cancel", size: 16,
        fill: THEME.surface, textColor: THEME.danger, tag: "overlay",
        onClick: () => { try { net.unqueue(); } catch {} closeOverlay(); } });

      clearNet();
      netOffs.push(
        net.on("open", () => { setStatus("Connected. Joining…"); net.join(nick()); }),
        net.on("welcome", () => { setStatus("Joined. Entering queue…"); net.queue(); }),
        net.on("queued", (m) => setStatus(`In queue (#${m?.position ?? "?"})… waiting for players.`)),
        net.on("matchFound", () => setStatus("Match found! Generating the world…")),
        net.on("roundStart", () => {
          clearNet();
          setStatus("Generating world…");
          generateMap((p) => setStatus(`Generating world… ${Math.round(p * 100)}%`), net.state.seed)
            .then((map) => { if (!leaving) k.go("onlineGame", { map }); })
            .catch(() => setStatus("Failed to generate the world."));
        }),
        net.on("error", () => setStatus("Connection error — is the server up?")),
        net.on("close", () => { if (net.state.phase !== "in_round") setStatus("Disconnected. Cancel and retry."); }),
      );

      if (net.state.playerId) net.queue();            // already joined this session
      else if (net.state.connected) net.join(nick());
      else net.connect();
    }
    function nick() { return (character.name || net.state.nickname || "Tamer").slice(0, 20); }

    // ── Esc overlay menu ─────────────────────────────────────────────────────────
    function openMenu() {
      if (overlayOpen) { closeOverlay(); return; } // toggle / dismiss any open overlay
      overlayOpen = true;
      k.destroyAll("overlay");
      dim();
      oPanel(cx, Hh / 2, 320, 280);
      oLabel(cx, Hh / 2 - 104, "MENU", 22, THEME.text);
      const items = [
        { label: "Resume", fill: THEME.primary, textColor: THEME.textInv, onClick: closeOverlay },
        { label: "Settings", fill: THEME.surface, textColor: THEME.text, onClick: () => k.go("settings", { characterId }) },
        { label: "Switch Character", fill: THEME.surface, textColor: THEME.text, onClick: () => k.go("characterSelect") },
        { label: "Quit to Title", fill: THEME.surface, textColor: THEME.danger, onClick: () => k.go("start") },
      ];
      items.forEach((it, i) => {
        addButton(k, { x: cx, y: Hh / 2 - 56 + i * 52, w: 240, h: 44, text: it.label, size: 17,
          fill: it.fill, textColor: it.textColor, tag: "overlay", onClick: it.onClick });
      });
    }
    k.onKeyPress("escape", openMenu);

    // Never leak network listeners if we navigate away mid-search (don't close the
    // socket — a queued match may still be coming, and other scenes reuse it).
    k.onSceneLeave(() => { leaving = true; clearNet(); });
  });
}
