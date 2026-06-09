import { getCharacter, setCharacterServerToken, saveCharacter } from "../storage.js";
import { healTeam } from "../engine/progression.js";
import { THEME, FONT, addButton, addLabel, addPanel, addMenuBackground, addHeader, elementColor } from "../ui/theme.js";
import { getMonsterType, getMonsterTypes, getSpiritChain } from "../engine/gamedata.js";
import { caughtSpeciesSet, newSpeciesCount } from "../engine/collection.js"; // PV-T16: NEW-species badge on the Bestiary station
import { getMonsterStats } from "../engine/stats.js";
import { net } from "../netClient.js";
import { generateMap } from "../engine/mapgen.js";
import { getEquippedCharacterSkin } from "../render/characterCosmetics.js";

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

    // ── Server session foundation (SP/MP unify — Phase A) ───────────────────────
    // DECISION (2026-06-09): the SERVER profile is the single source of truth for
    // team/currency/upgrades in BOTH modes (so SP is cheat-proof too). We bind this
    // character slot to ONE token-keyed server profile and establish the session on
    // entry — additive, non-destructive: the lobby still DISPLAYS the local character,
    // but every slot now resumes the same authoritative server profile, which both the
    // MP "Play" path and (future Phases B–C) management/SP-runs build on. The minted
    // token is persisted back onto the slot so it's stable across reloads. The full
    // server-authoritative SP migration is specced in requirements.md (Phases B–D).
    const sessionOffs = [];
    function offSession() { sessionOffs.forEach((o) => o && o()); sessionOffs.length = 0; }
    // First bind of this slot (no server token yet) → the server mints a FRESH profile, into
    // which we migrate this character's local loadout ONCE (server validates + gates). Captured
    // before binding; `imported` guards against re-firing on the post-import re-welcome.
    const firstBind = !character.serverToken;
    let imported = false;
    function localLoadout() {
      return {
        activeMonsters: character.activeMonsters || [],
        vaultMonsters: character.vaultMonsters || [],
        chains: character.chains || [],
        equippedChainId: character.equippedChainId || null,
        gold: character.gold || 0,
        essence: character.essence || 0,
        upgrades: character.upgrades || {},
      };
    }
    function establishSession() {
      try {
        // Bind to THIS slot's server profile (null token → the server mints a fresh
        // one and returns it in `welcome`, which we then persist to the slot).
        net.state.token = character.serverToken || net.state.token || null;
        sessionOffs.push(
          net.on("open", () => { try { net.join(nick()); } catch {} }),
          net.on("welcome", () => {
            // Persist a freshly-minted token so this slot always resumes this profile.
            if (net.state.token && net.state.token !== character.serverToken) {
              try { setCharacterServerToken(characterId, net.state.token); character.serverToken = net.state.token; } catch {}
            }
            // One-time migration: push the local loadout into the fresh server profile.
            if (firstBind && !imported) { imported = true; try { net.importProfile(localLoadout()); } catch {} }
          }),
        );
        if (net.state.playerId) { /* already joined this session */ }
        else if (net.state.connected) net.join(nick());
        else net.connect();
      } catch { /* offline / no WS — MP "Play" surfaces the connect error UI */ }
    }
    establishSession();

    const W = k.width(), Hh = k.height();
    const cx = W / 2;
    // 3-column hub only when there's horizontal room; otherwise stack centred so
    // the lobby stays usable on narrow/portrait (design height is a fixed 720, so
    // only width varies — a single centred column always fits vertically).
    const wide = W >= 920;
    const leftX = wide ? Math.max(196, cx - W * 0.32) : cx;
    const rightX = wide ? Math.min(W - 196, cx + W * 0.32) : cx;

    addMenuBackground(k); // ambient spirit-dust motes now ride along (theme.js addMenuMotes)

    // ── Header + identity ──────────────────────────────────────────────────────
    addHeader(k, { x: cx, y: 44, text: "TAMER'S QUEST", size: 34 });
    addLabel(k, { x: cx, y: 84, text: `${character.name}${character.isGuest ? "  (guest)" : ""}     Lv ${character.level}`, size: 18, color: THEME.textMut });
    // Currencies in their game-identity hues (gold = amber, essence = teal).
    addLabel(k, { x: cx - 12, y: 106, anchor: "right", text: `${character.gold || 0} gold`, size: 14, color: THEME.amber });
    addLabel(k, { x: cx + 12, y: 106, anchor: "left", text: `${character.essence || 0} essence`, size: 14, color: THEME.teal });
    // Run-prep: surface the equipped spirit chain (your catch tool). The lobby is
    // where you ready a run, but it only showed the team + cosmetic, not the chain.
    const eqChain = character.equippedChainId ? getSpiritChain(character.equippedChainId) : null;
    // Wide only — on narrow the centered tamer sprite sits at y≈150 (glow ~107–193), so
    // this line would overlap it (same reason the lifetime line below is wide-gated). On
    // narrow the equipped chain still reads in the Inventory/Team station.
    // Append what the chain can CATCH (its rarity gate) — the key run-prep fact: a low
    // chain can't tame rare monsters (engine/spiritchains.js). Pairs with the bestiary's
    // "Catch with" hint so the player can plan the right tool before a run.
    const eqCatch = eqChain ? (eqChain.special === "guaranteed" ? "guaranteed catch" : `catches up to rarity ${eqChain.maxRarity}`) : "";
    const eqSpecial = eqChain && eqChain.special && eqChain.special !== "guaranteed" ? `, ${eqChain.special}` : "";
    // Remaining throws come from the owned INSTANCE (eqChain is the static def) — a
    // depleted chain (0 throws) can't catch anything this run, so warn at run-prep.
    const eqInst = eqChain ? (character.chains || []).find((c) => c.chainId === character.equippedChainId) : null;
    const depleted = !!eqInst && eqInst.throwCount === 0;
    const eqThrows = eqInst ? (eqInst.throwCount == null ? "∞ throws" : `${eqInst.throwCount} throw${eqInst.throwCount === 1 ? "" : "s"} left`) : "";
    if (wide) addLabel(k, { x: cx, y: 128, size: 13,
      color: !eqChain ? THEME.textMut : depleted ? THEME.danger : THEME.textBody,
      text: !eqChain ? "No spirit chain equipped — set one in Inventory"
        : depleted ? `${eqChain.name}: out of throws — refill or switch in Inventory`
        : `Spirit chain:  ${eqChain.name}  (T${eqChain.tier}, ${eqCatch}${eqSpecial}, ${eqThrows})` });
    // Lifetime record (P8-T1) — surface the persistent stats the result screen tracks
    // so a player's progress reads at the hub, not only after a run. Only on `wide`
    // layouts: the narrow stack puts the tamer sprite at y≈150, where this would collide.
    const lstats = character.stats || {};
    if (wide && (lstats.runs || lstats.extractions || lstats.caught || lstats.deaths)) {
      addLabel(k, { x: cx, y: 150, size: 12, color: THEME.textMut,
        text: `Runs ${lstats.runs || 0}     Extracted ${lstats.extractions || 0}     Caught ${lstats.caught || 0}     Deaths ${lstats.deaths || 0}` });
    }

    const hasMonsters = character.activeMonsters && character.activeMonsters.length > 0;

    // ── Centre: character preview ───────────────────────────────────────────────
    // A static top-down tamer sprite with an accent glow. (The rotate "turntable"
    // controls — the < > buttons + Left/Right arrow keys — were removed 2026-06-09 at
    // the user's request.)
    const charX = cx, charY = wide ? Hh * 0.5 : 150;
    // CN-12: reflect the player's equipped character cosmetic in the hub — its accent
    // colour glows behind the tamer and its name is shown, so the skin you bought/
    // chose actually reads here (not only in-round / the cosmetics store).
    const skin = getEquippedCharacterSkin();
    const accent = skin.accent || THEME.teal;
    if (wide) {
      addPanel(k, { x: charX, y: charY, w: 240, h: 260, radius: 18, fill: THEME.surface });
      addLabel(k, { x: charX, y: charY - 116, text: "YOUR TAMER", size: 13, color: THEME.textMut });
    }
    // Accent glow behind the tamer (added before the sprite so it sits behind it).
    // Glow rings are scaled to the preview size — the wide preview is 3.2x but the
    // narrow preview is 1.8x, so the 68px outer ring was overshoooting and crawling
    // into the currency row at y=106 (audit LOW overlap on narrow viewports).
    const glowY = charY - (wide ? 8 : 0);
    const glowScale = wide ? 1 : 0.6;
    [[68, 0.10], [46, 0.16], [28, 0.22]].forEach(([r, o]) =>
      k.add([k.circle(r * glowScale), k.pos(charX, glowY), k.anchor("center"), k.color(...accent), k.opacity(o)]));
    try {
      k.add([k.sprite("player"), k.pos(charX, glowY),
        k.anchor("center"), k.scale((wide ? 3.2 : 1.8) / 3)]); // /3: 3x-res player sprite (crisp), same display size
    } catch { /* sprite not ready — skip the preview */ }
    if (wide) addLabel(k, { x: charX, y: charY + 110, text: skin.name, size: 13, color: accent });

    // ── Menu stations (left column on wide, top of the stack on narrow) ──────────
    // PV-T16: badge the Bestiary station with the count of caught-but-uninspected
    // species (same formula as the bestiary header) — a collection hook visible in
    // the most-visited screen, drawing players into the Pokédex after a run.
    const bestiaryNew = newSpeciesCount(getMonsterTypes(), caughtSpeciesSet(character.activeMonsters, character.vaultMonsters));
    const stations = [
      { label: "Inventory / Team", scene: "inventory", args: { characterId } },
      { label: "Spirit Shop", scene: "shop", args: { characterId } },
      { label: "Base Upgrades", scene: "baseUpgrades", args: { characterId } },
      // Task 50: the free Healer. Teams no longer auto-heal at run start, so this is
      // where you patch up between runs (no cost). `onClick` action instead of a scene.
      { label: teamInjured() ? "Healer  —  free heal" : "Healer  —  team healthy", onClick: healNow },
      { label: bestiaryNew ? `Bestiary  (${bestiaryNew} NEW)` : "Bestiary", scene: "bestiary", args: { backScene: "lobby", backArgs: { characterId }, characterId } },
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
          text: s.label, size: 17, fill: THEME.surface, textColor: THEME.text, onClick: s.onClick || (() => k.go(s.scene, s.args)) });
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
        ...stations.map((s) => ({ label: s.label, fill: THEME.surface, textColor: THEME.text, onClick: s.onClick || (() => k.go(s.scene, s.args)) })),
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
      // Task 50: teams no longer auto-heal at run start — point players at the free
      // Healer station so an injured team reads as "heal here", not a dead end.
      addLabel(k, { x: cx, y: teamY - 46, text: teamInjured() ? "YOUR TEAM   -   injured? heal free at the Healer" : "YOUR TEAM", size: 14, color: THEME.textMut });
      const slot = 92;
      const teamStartX = cx - (Math.max(1, monsters.length) * slot) / 2 + slot / 2;
      monsters.forEach((mon, i) => drawTeamSlot(mon, teamStartX + i * slot, teamY));
    }

    function drawTeamSlot(mon, x, y) {
      const mt = getMonsterType(mon.typeName);
      // Element-tinted border so the team reads by element at a glance (matches the
      // roster's element-coded cards).
      addPanel(k, { x, y, w: 78, h: 78, radius: 14, fill: THEME.surface, border: elementColor(mt?.element) });
      const spriteName = mon.typeName.toLowerCase().replace(/\s+/g, "_");
      try {
        k.add([k.sprite(spriteName), k.pos(x, y - 6), k.anchor("center"), k.scale(0.38)]);
      } catch {
        k.add([k.rect(46, 46, { radius: 10 }), k.pos(x, y - 6), k.anchor("center"), k.color(...THEME.surfaceAlt)]);
      }
      // GP-9: team HP bar — SP monsters keep HP between runs, so an injured team is
      // otherwise invisible before you commit to a run.
      let maxHp = mon.currentHealth;
      try { maxHp = getMonsterStats(mt, mon.level).health; } catch {}
      const frac = maxHp > 0 ? Math.max(0, Math.min(1, (mon.currentHealth ?? maxHp) / maxHp)) : 1;
      const barC = frac > 0.5 ? THEME.success : frac > 0.25 ? THEME.warn : THEME.danger;
      const barW = 54;
      k.add([k.rect(barW, 4, { radius: 2 }), k.pos(x - barW / 2, y + 16), k.anchor("topleft"), k.color(...THEME.line)]);
      if (frac > 0) k.add([k.rect(barW * frac, 4, { radius: 2 }), k.pos(x - barW / 2, y + 16), k.anchor("topleft"), k.color(...barC)]);
      addLabel(k, { x, y: y + 30, text: `Lv.${mon.level}`, size: 12, color: THEME.textMut });
    }

    // ── Free Healer (task 50) ────────────────────────────────────────────────────
    // Teams no longer auto-heal at run start; this restores the active team to full HP/
    // energy (and clears status) for free. Heals the local character AND, when a server
    // session is up (Phase A), the authoritative server profile too, so the heal carries
    // into the upcoming MP/SP run. Refresh the lobby so the team HP bars redraw.
    function teamInjured() {
      return (character.activeMonsters || []).some((m) => {
        try {
          const st = getMonsterStats(getMonsterType(m.typeName), m.level);
          return (m.currentHealth ?? st.health) < st.health || (m.currentEnergy ?? st.energy) < st.energy || !!m.status;
        } catch { return false; }
      });
    }
    function healNow() {
      if (!teamInjured()) return; // already full — no-op (avoids a pointless reload)
      try { healTeam(character.activeMonsters); saveCharacter(character); } catch {}
      try { if (net.state.connected) net.heal(); } catch {}
      k.go("lobby", { characterId }); // redraw with full HP bars
    }

    // ── Play → Singleplayer / Multiplayer picker ────────────────────────────────
    // The mode is chosen HERE, at round start (FLOW screen 3). SP enters the local
    // loading→game flow; MP folds in the old onlineLobby connect→join→queue→
    // roundStart sequence, using the character name as the network nickname.
    const netOffs = [];
    let leaving = false;
    let overlayOpen = false;
    let connectTimer = null; // MP connect watchdog (see startMulti) — cancel on progress/close
    const cancelConnectTimer = () => { if (connectTimer) { connectTimer.cancel(); connectTimer = null; } };
    function clearNet() { netOffs.forEach((off) => off && off()); netOffs.length = 0; }
    function closeOverlay() { cancelConnectTimer(); clearNet(); k.destroyAll("overlay"); overlayOpen = false; }

    function dim() {
      k.add([k.rect(W, Hh), k.pos(0, 0), k.anchor("topleft"), k.color(0, 0, 0), k.opacity(0.72), "overlay"]);
    }
    // Tagged panel/label so closeOverlay's destroyAll("overlay") reaps every layer.
    // Use the shared helpers (now tag-aware) so overlays get the same shadow + fill +
    // border + top sheen as on-page panels — they used to be flatter hand-rolled rects.
    // Width is clamped so a modal never overflows a narrow/portrait viewport.
    const oW = (cap) => Math.min(cap, W - 32);
    function oPanel(x, y, w, h) {
      addPanel(k, { x, y, w: oW(w), h, radius: 18, tag: "overlay" });
    }
    function oLabel(x, y, text, size, color) {
      addLabel(k, { x, y, text, size, color, width: oW(360) - 24, tag: "overlay" });
    }

    function openPlay() {
      k.destroyAll("overlay");
      overlayOpen = true;
      dim();
      const my = Hh / 2;
      oPanel(cx, my, 380, 320);
      oLabel(cx, my - 130, "ENTER A RUN", 22, THEME.text);
      oLabel(cx, my - 104, "The same team — pick this run's mode", 13, THEME.textMut);

      const tag = "overlay";
      // Each mode gets a one-line description so the round-start choice (moved here
      // from the title) is self-explanatory.
      addButton(k, { x: cx, y: my - 60, w: oW(300), h: 48, text: "Singleplayer", size: 19,
        fill: hasMonsters ? THEME.primary : THEME.surfaceAlt,
        textColor: hasMonsters ? THEME.textInv : THEME.textMut,
        disabled: !hasMonsters, tag, onClick: startSingle });
      oLabel(cx, my - 30, hasMonsters ? "Solo run with your saved team" : "No monsters — visit Inventory first",
        11, hasMonsters ? THEME.textMut : THEME.warn);
      addButton(k, { x: cx, y: my + 20, w: oW(300), h: 48, text: "Multiplayer", size: 19,
        fill: THEME.violet, textColor: THEME.textInv, tag, onClick: startMulti });
      oLabel(cx, my + 50, "Live extraction vs other tamers", 11, THEME.textMut);
      addButton(k, { x: cx, y: my + 116, w: oW(200), h: 40, text: "Cancel", size: 16,
        fill: THEME.surface, textColor: THEME.danger, tag, onClick: closeOverlay });
    }

    function startSingle() {
      if (!hasMonsters) return;
      closeOverlay();
      // NOTE (SP/MP unify): SP still runs the LOCAL flow for now. The server-authoritative SP
      // path (server solo round via `startServerRun(true)`) is built + ready, but flipping it on
      // requires the lobby to read `net.state` AND a loss-safe MERGE migration for existing
      // players who hold BOTH local SP progress and server MP progress — specced in requirements.md
      // so it lands as one coherent, loss-safe change (production auto-deploys). Until then: local.
      k.go("loading", { characterId });
    }
    function startMulti() { startServerRun(false); }

    // Both modes now run a SERVER-AUTHORITATIVE round (SP/MP unify): connect (or reuse the
    // session) → join → enter the queue → roundStart generates the map → onlineGame. SP uses
    // `queueSolo` (an instant private 1-player round, no matchmaking wait), MP uses `queue`
    // (matchmaking). SP play is therefore server-resolved = cheat-proof, and both share onlineGame.
    function startServerRun(solo) {
      k.destroyAll("overlay");
      overlayOpen = true;
      dim();
      oPanel(cx, Hh / 2, 380, 220);
      oLabel(cx, Hh / 2 - 70, solo ? "SINGLEPLAYER" : "MULTIPLAYER", 22, THEME.text);
      const status = k.add([k.text(solo ? "Starting your run…" : "Connecting…", { size: 16, font: FONT, width: 340 }),
        k.pos(cx, Hh / 2 - 16), k.anchor("center"), k.color(...THEME.textMut), "overlay"]);
      const setStatus = (s) => { try { status.text = s; } catch {} };
      addButton(k, { x: cx, y: Hh / 2 + 64, w: oW(200), h: 42, text: "Cancel", size: 16,
        fill: THEME.surface, textColor: THEME.danger, tag: "overlay",
        onClick: () => { try { net.unqueue(); } catch {} closeOverlay(); } });

      clearNet();
      const enterQueue = () => { try { if (solo) net.queueSolo(); else net.queue(); } catch {} };
      // Connect watchdog: if the WS hasn't even opened after a while, the server is
      // unreachable or cold-starting (Railway can sleep) — say so instead of spinning
      // on "Connecting…" forever (Cancel was the only signal). Cancelled once we open.
      cancelConnectTimer();
      connectTimer = k.wait(14, () => { connectTimer = null; if (overlayOpen && !net.state.connected) setStatus("Couldn't reach the server — it may be waking up. Cancel and retry."); });
      netOffs.push(
        net.on("open", () => { cancelConnectTimer(); setStatus(solo ? "Connected. Preparing…" : "Connected. Joining…"); net.join(nick()); }),
        net.on("welcome", () => { setStatus(solo ? "Starting your run…" : "Joined. Entering queue…"); enterQueue(); }),
        net.on("queued", (m) => setStatus(`In queue (#${m?.position ?? "?"})… waiting for players.`)),
        net.on("matchFound", () => setStatus(solo ? "Generating your world…" : "Match found! Generating the world…")),
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

      if (net.state.playerId) enterQueue();            // already joined this session (establishSession)
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
        addButton(k, { x: cx, y: Hh / 2 - 56 + i * 52, w: oW(240), h: 44, text: it.label, size: 17,
          fill: it.fill, textColor: it.textColor, tag: "overlay", onClick: it.onClick });
      });
    }
    k.onKeyPress("escape", openMenu);

    // Never leak network listeners if we navigate away mid-search (don't close the
    // socket — a queued match may still be coming, and other scenes reuse it).
    k.onSceneLeave(() => { leaving = true; cancelConnectTimer(); clearNet(); offSession(); });
  });
}
