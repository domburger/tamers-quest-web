import { getCharacter, setCharacterServerToken, saveCharacter, getProfile, clearProfile } from "../storage.js";
import { healTeam } from "../engine/progression.js";
import { safeInsetsDesign } from "../systems/safearea.js"; // keep the top-right avatar off the notch
import { prefersReducedMotion } from "../systems/a11y.js"; // a11y: freeze the tamer turntable under Reduce Motion
import { THEME, FONT, addButton, addLabel, addPanel, addMenuBackground, addHeader, elementColor, hpColor } from "../ui/theme.js";
import { getMonsterType, getMonsterTypes, getSpiritChain } from "../engine/gamedata.js";
import { caughtSpeciesSet, newSpeciesCount } from "../engine/collection.js"; // PV-T16: NEW-species badge on the Bestiary station
import { getMonsterStats } from "../engine/stats.js";
import { net } from "../netClient.js";
import { generateMap } from "../engine/mapgen.js";
import { getEquippedCharacterSkin } from "../render/characterCosmetics.js";
import { drawCharacter } from "../render/character.js";

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
    // The server profile is migrated from this slot's local loadout ONCE, the first time we see a
    // profile the server reports as NOT yet migrated (covers fresh AND returning/Phase-A-bound
    // players). The server MERGE is loss-safe; `imported` guards against re-firing per scene entry.
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
            // One-time migration: if the server says this profile isn't migrated yet, push the
            // local loadout for a loss-safe server-side MERGE (no-op once migrated).
            if (!net.state.migrated && !imported) { imported = true; try { net.importProfile(localLoadout()); } catch {} return; }
            // Profile settled (migrated) → if the lobby rendered the LOCAL fallback (we weren't
            // joined at entry), re-enter so it redraws from the authoritative SERVER profile.
            if (needsServerRerender) { needsServerRerender = false; try { k.go("lobby", { characterId }); } catch {} }
          }),
        );
        if (net.state.playerId) { /* already joined this session */ }
        else if (net.state.connected) net.join(nick());
        else net.connect();
      } catch { /* offline / no WS — MP "Play" surfaces the connect error UI */ }
    }
    // If we're not joined at entry, the first render uses the local fallback → re-render once
    // the server profile arrives (see establishSession welcome handler).
    let needsServerRerender = !net.state.playerId;
    // The EFFECTIVE profile the lobby displays: the authoritative SERVER profile (net.state) once
    // joined — the single source of truth (SP/MP unify) — else the local character as a fallback
    // while connecting/offline. Identity (name/level/cosmetic) always reads the local slot.
    function prof() {
      if (net.state.playerId) {
        return {
          activeMonsters: net.state.team || [],
          vaultMonsters: net.state.vault || [],
          chains: net.state.chains || [],
          equippedChainId: net.state.equippedChainId || null,
          equippedChainIds: net.state.equippedChainIds || [],
          gold: net.state.gold || 0,
          essence: net.state.essence || 0,
          upgrades: net.state.upgrades || {},
          stats: net.state.stats || {},
        };
      }
      return character;
    }
    const p = prof();

    establishSession();

    const W = k.width(), Hh = k.height();
    const cx = W / 2;
    // 3-column hub only when there's horizontal room; otherwise stack centred so
    // the lobby stays usable on narrow/portrait (design height is a fixed 720, so
    // only width varies — a single centred column always fits vertically).
    const wide = W >= 920;
    const leftX = wide ? Math.max(196, cx - W * 0.32) : cx;
    const rightX = wide ? Math.min(W - 196, cx + W * 0.32) : cx;
    const ins = safeInsetsDesign(k);
    const profile = getProfile();
    const authed = !!(profile && !profile.isGuest); // signed-in (vs guest) → richer account dropdown

    addMenuBackground(k); // ambient spirit-dust motes now ride along (theme.js addMenuMotes)

    // ── Header + identity ──────────────────────────────────────────────────────
    addHeader(k, { x: cx, y: 44, text: "TAMER'S QUEST", size: 34 });
    addLabel(k, { x: cx, y: 84, text: `${character.name}${character.isGuest ? "  (guest)" : ""}     Lv ${character.level}`, size: 18, color: THEME.textMut });
    // Currencies in their game-identity hues (gold = amber, essence = teal).
    addLabel(k, { x: cx - 12, y: 106, anchor: "right", text: `${p.gold || 0} gold`, size: 14, color: THEME.amber });
    addLabel(k, { x: cx + 12, y: 106, anchor: "left", text: `${p.essence || 0} essence`, size: 14, color: THEME.teal });
    // Run-prep: surface the equipped spirit chain (your catch tool). The lobby is
    // where you ready a run, but it only showed the team + cosmetic, not the chain.
    const eqChain = p.equippedChainId ? getSpiritChain(p.equippedChainId) : null;
    // Wide only — on narrow the centered tamer sprite sits at y≈150 (glow ~107–193), so
    // this line would overlap it (same reason the lifetime line below is wide-gated). On
    // narrow the equipped chain still reads in the Inventory/Team station.
    // Append what the chain can CATCH (its rarity gate) — the key run-prep fact: a low
    // chain can't tame rare monsters (engine/spiritchains.js). Pairs with the bestiary's
    // "Catch with" hint so the player can plan the right tool before a run.
    const eqCatch = eqChain ? (eqChain.special === "guaranteed" ? "guaranteed catch" : `catches up to rarity ${eqChain.maxRarity}`) : "";
    const eqSpecial = eqChain && eqChain.special && eqChain.special !== "guaranteed" ? `, ${eqChain.special}` : "";
    // Throws are FREE now (boomerang) — the only resource is capture charges (durability).
    // Show the active chain + how many MORE chains are in the 3-slot loadout (swap in-run).
    const eqInst = eqChain ? (p.chains || []).find((c) => c.chainId === p.equippedChainId) : null;
    const charges = eqInst ? `${eqInst.durability} charge${eqInst.durability === 1 ? "" : "s"}` : "";
    const extra = Math.max(0, (p.equippedChainIds || []).length - 1);
    const more = extra > 0 ? `   +${extra} more in loadout` : "";
    if (wide) addLabel(k, { x: cx, y: 128, size: 13,
      color: !eqChain ? THEME.textMut : THEME.textBody,
      text: !eqChain ? "No spirit chain equipped — set one in Inventory"
        : `Spirit chain:  ${eqChain.name}  (T${eqChain.tier}, ${eqCatch}${eqSpecial}, ${charges})${more}` });
    // Lifetime record (P8-T1) — surface the persistent stats the result screen tracks
    // so a player's progress reads at the hub, not only after a run. Only on `wide`
    // layouts: the narrow stack puts the tamer sprite at y≈150, where this would collide.
    const lstats = p.stats || {};
    if (wide && (lstats.runs || lstats.extractions || lstats.caught || lstats.deaths)) {
      addLabel(k, { x: cx, y: 150, size: 12, color: THEME.textMut,
        text: `Runs ${lstats.runs || 0}     Extracted ${lstats.extractions || 0}     Caught ${lstats.caught || 0}     Deaths ${lstats.deaths || 0}` });
    }

    const hasMonsters = p.activeMonsters && p.activeMonsters.length > 0;

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

    // ── Top-right account indicator (the player's "profile picture" + dropdown) ──
    // A circular avatar badge tinted by the equipped skin accent with the player's
    // initial; click opens a dropdown (signed-in: View Profile / Account / Settings /
    // Sign out — guest: Settings / Log in). Settings now lives HERE, not in the station
    // columns (user 2026-06-10). Guests get a muted badge so the control is still present.
    {
      const aR = 22, aX = W - aR - 16 - ins.right, aY = aR + 14 + ins.top;
      const acctNick = (profile && profile.nickname) || character.name || "Tamer";
      const initial = ((acctNick.trim()[0]) || "T").toUpperCase();
      const fillCol = authed ? accent : THEME.surfaceAlt;
      const ringCol = authed ? accent : THEME.line;
      const inkCol = authed ? THEME.bg : THEME.textMut;
      const halo = k.add([k.circle(aR + 6), k.pos(aX, aY), k.anchor("center"), k.color(...accent), k.opacity(0)]);
      const av = k.add([k.circle(aR), k.pos(aX, aY), k.anchor("center"), k.color(...fillCol), k.outline(2, k.rgb(...ringCol)), k.area()]);
      k.add([k.text(initial, { size: 20, font: FONT }), k.pos(aX, aY + 1), k.anchor("center"), k.color(...inkCol)]);
      av.onHover(() => k.setCursor("pointer"));
      av.onHoverUpdate(() => { halo.opacity = 0.32; });
      av.onHoverEnd(() => { halo.opacity = 0; k.setCursor("default"); });
      av.onClick(() => openAcctMenu(aY + aR));
    }
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
    // The tamer avatar is drawn with the SAME vector character as in-game (render/character.js)
    // instead of a static sprite — so it's crisp at any size AND faces the player (dir {0,1} =
    // toward the camera; the old static sprite was back-facing). `scale` draws it large + sharp.
    const charScale = wide ? 3.2 : 1.8;
    k.onDraw(() => {
      // onDraw is immediate-mode — it paints ABOVE every game object, including an
      // open overlay's dim layer + panel. Skip it while a modal is up (ENTER A RUN
      // picker / Esc menu) so the tamer + spirit ring don't bleed through the modal.
      if (overlayOpen) return;
      drawCharacter(k, {
        x: charX, y: glowY + 4 * charScale, t: prefersReducedMotion() ? 0 : k.time(),
        dir: { x: 0, y: 1 }, scale: charScale, color: skin.accent, cloak: skin.cloak, model: skin.model,
      });
    });
    if (wide) addLabel(k, { x: charX, y: charY + 110, text: skin.name, size: 13, color: accent });

    // ── Menu stations (left column on wide, top of the stack on narrow) ──────────
    // PV-T16: badge the Bestiary station with the count of caught-but-uninspected
    // species (same formula as the bestiary header) — a collection hook visible in
    // the most-visited screen, drawing players into the Pokédex after a run.
    const bestiaryNew = newSpeciesCount(getMonsterTypes(), caughtSpeciesSet(p.activeMonsters, p.vaultMonsters));
    const stations = [
      // SP/MP unify: management opens the SERVER-backed scenes (they edit the authoritative
      // profile via net.state). The local-only inventory/shop/baseUpgrades scenes are retired.
      { label: "Inventory / Team", scene: "roster", args: { characterId } },
      { label: "Spirit Shop", scene: "onlineShop", args: { characterId } },
      { label: "Base Upgrades", scene: "onlineBaseUpgrades", args: { characterId } },
      // Task 50: the free Healer. Teams no longer auto-heal at run start, so this is
      // where you patch up between runs (no cost). `onClick` action instead of a scene.
      { label: teamInjured() ? "Healer  —  free heal" : "Healer  —  team healthy", onClick: healNow },
      { label: bestiaryNew ? `Bestiary  (${bestiaryNew} NEW)` : "Bestiary", scene: "bestiary", args: { backScene: "lobby", backArgs: { characterId }, characterId } },
      { label: "Cosmetics", scene: "cosmetics", args: { backScene: "lobby", backArgs: { characterId } } },
    ];

    const bw = 240, bh = 46, gap = 12;
    if (wide) {
      // Left column: Play CTA on top, then the account stations. Start below the centered
      // header block (currency y106 / chain y128 / lifetime y150, text reaching ~158): the
      // long centered chain+lifetime lines otherwise run under the Play button at narrower
      // "wide" widths (~960), where leftX is clamped to 196 and can't clear them.
      const colTop = 190;
      addButton(k, { x: leftX, y: colTop, w: bw, h: 56, text: "Play", size: 22,
        fill: THEME.primary, textColor: THEME.textInv, onClick: openPlay }); // teal primary = the title's "Play as guest" CTA (one button design)
      stations.forEach((s, i) => {
        addButton(k, { x: leftX, y: colTop + 56 / 2 + 24 + bh / 2 + i * (bh + gap), w: bw, h: bh,
          text: s.label, size: 17, fill: THEME.surface, textColor: THEME.text, onClick: s.onClick || (() => k.go(s.scene, s.args)) });
      });
      // Right column: Switch Character (Settings moved to the top-right account dropdown).
      const rTop = 190;
      addButton(k, { x: rightX, y: rTop, w: bw, h: bh, text: "Switch Character", size: 16,
        fill: THEME.surface, textColor: THEME.text, onClick: () => k.go("characterSelect") });
      addLabel(k, { x: rightX, y: rTop + (bh + gap) + 22, text: "Esc — menu", size: 12, color: THEME.textMut });
    } else {
      // Narrow: a single centred column under the preview.
      const all = [
        { label: "Play", fill: THEME.primary, textColor: THEME.textInv, onClick: openPlay }, // teal primary (one button design — matches the title CTA)
        ...stations.map((s) => ({ label: s.label, fill: THEME.surface, textColor: THEME.text, onClick: s.onClick || (() => k.go(s.scene, s.args)) })),
        // Settings moved to the top-right account dropdown.
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
    const monsters = p.activeMonsters || [];
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
      const barC = hpColor(frac);
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
      return (prof().activeMonsters || []).some((m) => {
        try {
          const st = getMonsterStats(getMonsterType(m.typeName), m.level);
          return (m.currentHealth ?? st.health) < st.health || (m.currentEnergy ?? st.energy) < st.energy || !!m.status;
        } catch { return false; }
      });
    }
    function healNow() {
      if (!teamInjured()) return; // already full — no-op (avoids a pointless reload)
      if (net.state.playerId) {
        // Server-authoritative heal — re-render once the server echoes the healed roster.
        try { net.heal(); } catch {}
        const off = net.on("roster", () => { off(); try { k.go("lobby", { characterId }); } catch {} });
        sessionOffs.push(off);
      } else {
        // Offline fallback: heal the local mirror and redraw immediately.
        try { healTeam(character.activeMonsters); saveCharacter(character); } catch {}
        k.go("lobby", { characterId });
      }
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
        fill: THEME.surfaceAlt, textColor: THEME.text, tag, onClick: closeOverlay });
    }

    // SP/MP unify (FLIPPED ON): SP now runs a server-authoritative solo round (cheat-proof),
    // the same path as MP but private + instant. The local game.js flow is retired (unreachable).
    function startSingle() {
      if (!hasMonsters) return;
      startServerRun(true);
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
      // Width tracks the responsive panel (oW(380)) minus padding, so a long status (the
      // cold-start watchdog line) wraps INSIDE the modal instead of overflowing on a phone.
      const status = k.add([k.text(solo ? "Starting your run…" : "Connecting…", { size: 16, font: FONT, width: oW(380) - 40, align: "center" }),
        k.pos(cx, Hh / 2 - 16), k.anchor("center"), k.color(...THEME.textMut), "overlay"]);
      const setStatus = (s) => { try { status.text = s; } catch {} };
      addButton(k, { x: cx, y: Hh / 2 + 64, w: oW(200), h: 42, text: "Cancel", size: 16,
        fill: THEME.surfaceAlt, textColor: THEME.text, tag: "overlay",
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
            .then((map) => { if (!leaving) k.go("onlineGame", { map, characterId }); })
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
      oPanel(cx, Hh / 2, 320, 232);
      oLabel(cx, Hh / 2 - 80, "MENU", 22, THEME.text);
      // Settings moved to the top-right account dropdown (openAcctMenu).
      const items = [
        { label: "Resume", fill: THEME.primary, textColor: THEME.textInv, onClick: closeOverlay },
        { label: "Switch Character", fill: THEME.surface, textColor: THEME.text, onClick: () => k.go("characterSelect") },
        { label: "Quit to Title", fill: THEME.surface, textColor: THEME.danger, onClick: () => k.go("start") },
      ];
      items.forEach((it, i) => {
        addButton(k, { x: cx, y: Hh / 2 - 36 + i * 52, w: oW(240), h: 44, text: it.label, size: 17,
          fill: it.fill, textColor: it.textColor, tag: "overlay", onClick: it.onClick });
      });
    }

    // ── Top-right account dropdown (View Profile / Account / Settings / Sign out) ──
    // Opened from the avatar badge. Reuses the overlay infra (overlayOpen + closeOverlay)
    // so Esc and a click on the faint backdrop both dismiss it. `yBelow` is the avatar's
    // bottom edge — the panel drops from there, right-aligned under the badge.
    function openAcctMenu(yBelow) {
      if (overlayOpen) { closeOverlay(); return; } // toggle
      overlayOpen = true;
      k.destroyAll("overlay");
      k.add([k.rect(W, Hh), k.pos(0, 0), k.anchor("topleft"), k.color(0, 0, 0), k.opacity(0.35), k.area(), "overlay"]).onClick(closeOverlay);
      const items = authed ? [
        { label: "View Profile", go: () => k.go("profile", { backScene: "lobby", backArgs: { characterId } }) },
        { label: "Account", go: () => k.go("account", { backScene: "lobby", backArgs: { characterId } }) },
        { label: "Settings", go: () => k.go("settings", { characterId }) },
        { label: "Sign out", danger: true, go: () => { try { net.clearSession(); } catch { /* none */ } clearProfile(); k.go("start"); } },
      ] : [
        { label: "Settings", go: () => k.go("settings", { characterId }) },
        { label: "Log in", go: () => k.go("start") },
      ];
      const pwid = 196, rowH = 42, ph = items.length * rowH + 14;
      const pcx = W - ins.right - 16 - pwid / 2;
      const ptop = yBelow + 8;
      addPanel(k, { x: pcx, y: ptop + ph / 2, w: pwid, h: ph, radius: 12, tag: "overlay" });
      items.forEach((it, i) => addButton(k, { x: pcx, y: ptop + 7 + rowH / 2 + i * rowH, w: pwid - 18, h: rowH - 6,
        text: it.label, size: 15, fill: THEME.surface, textColor: it.danger ? THEME.danger : THEME.text, tag: "overlay", onClick: it.go }));
    }
    k.onKeyPress("escape", openMenu);

    // Never leak network listeners if we navigate away mid-search (don't close the
    // socket — a queued match may still be coming, and other scenes reuse it).
    k.onSceneLeave(() => { leaving = true; cancelConnectTimer(); clearNet(); offSession(); });
  });
}
