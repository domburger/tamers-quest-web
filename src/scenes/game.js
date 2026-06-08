import { findSpawnPoint, biomeSpeedMultAt, biomeTintAt } from "../engine/mapgen.js";
import { hashString } from "../engine/rng.js";
import { getCharacter, saveCharacter, rollStarters } from "../storage.js";
import { getMonsterType, getMonsterStats, getSpiritChain, getSpiritChains } from "../data.js";
import { drawTiles as drawFloorTiles, makeTileCache } from "../render/tiles.js";
import { GAME, grantChain, finalizeRunChains } from "../engine/schemas.js";
import { grantExtractRewards, chestEssence, healTeam, stormDamageTeam } from "../engine/progression.js";
import { canThrow, rollChainDrop, clusterTargets } from "../engine/spiritchains.js";
import { nextChainId, loseRunTeam } from "../engine/inventory.js"; // PARITY-3: shared chain-cycle + Q10 death stake
import { objectiveText } from "../ui/objective.js"; // PT2-T10: persistent objective HUD (SP↔MP shared)
import { sprintingNow, tickStamina, sprintMult } from "../engine/movement.js";
import { drawCharacter } from "../render/character.js";
import { getEquippedCharacterSkin } from "../render/characterCosmetics.js";
import { drawAtmosphere } from "../render/atmosphere.js";
import { drawSpiritChainModel, drawSpiritChainProjectile, drawChest, drawChainImpact, chainColor } from "../render/spiritchain.js";
import { drawPortal, drawExtractFlash } from "../render/portal.js";
import { minimapWindow } from "../render/minimap.js"; // PT1-T24: shared minimap zoom-window math (SP↔MP)
import { emit, updateFx, drawFx, clearFx } from "../render/fx.js"; // PV-T12: particle juice (SP↔MP parity)
import { drawPlayWindow, playWindowRect } from "../render/playWindow.js"; // square play-window frame + geometry (user design 2026-06-08)
import { addShake, updateShake, shakeOffset, clearShake } from "../render/shake.js"; // PV-A5 screen shake (SP↔MP parity)
import { THEME, elementColor, addButton, addLabel } from "../ui/theme.js";
import { drawBiomeChip } from "../ui/biomeHud.js"; // PT1-T18: current-biome + speed HUD chip (shared SP↔MP)
import { safeInsetsDesign } from "../systems/safearea.js"; // MB-4: keep SP touch buttons off the notch/home-bar (shared design-unit helper)
import { prefersReducedMotion } from "../systems/a11y.js"; // a11y: freeze decorative monster bob (SP parity)
import { sfx, haptic, toggleMuted, isMuted } from "../systems/audio.js"; // MOB-T4: extract feedback + pause-menu Sound toggle (SP parity with MP pause overlay)

const TILE_SIZE = GAME.TILE_SIZE;
const TILE_OVERLAP = GAME.TILE_OVERLAP;
const EFFECTIVE_TILE = GAME.EFFECTIVE_TILE; // tileCoord * this = world px
const RENDER_DISTANCE = 20;
const BASE_SPEED = GAME.BASE_SPEED;
const RUN_DURATION = GAME.ROUND_DURATION_S; // 10 minutes
const CIRCLE_START_TIME = GAME.CIRCLE_START_S; // 5 minutes
const PORTAL_INTERVAL = GAME.PORTAL_INTERVAL_S;

export default function gameScene(k) {
  k.scene("game", ({ characterId, mapData, resumePos, resumeElapsed, resumePortals }) => {
    const character = getCharacter(characterId);
    if (!character) { k.go("characterSelect"); return; }

    const { voidMap, tileMap, mapSize } = mapData;

    // Player state — resume or fresh spawn
    let playerX, playerY;
    if (resumePos) {
      playerX = resumePos.x;
      playerY = resumePos.y;
    } else {
      const spawn = findSpawnPoint(voidMap);
      playerX = spawn.x * EFFECTIVE_TILE;
      playerY = spawn.y * EFFECTIVE_TILE;
      // PT2-T04 (SP parity with the server): a fresh run starts at full HP, clearing
      // any stale damage carried over from a previous (abandoned/unhealed) run. Only
      // on a fresh spawn — the fight→overworld resume above must NOT re-heal mid-run.
      healTeam(character.activeMonsters);
      saveCharacter(character);
    }

    // Timer state
    let elapsed = resumeElapsed || 0;
    let portals = resumePortals || [];
    let circleRadius = mapSize * EFFECTIVE_TILE;
    const circleCenterX = (mapSize / 2) * EFFECTIVE_TILE;
    const circleCenterY = (mapSize / 2) * EFFECTIVE_TILE;

    // Textured-floor cache (the shared MP/SP renderer in render/tiles.js loads a
    // sprite per tile *type* on demand) — P10-T2: SP now uses the same textured
    // floor + cave void/wall-border as the online view.
    const tileCache = makeTileCache();

    // Fog of war (PT1-T08, headline demand): the map is hidden until you walk near
    // it. `explored` holds revealed tile keys for the run; `revealAround` adds the
    // disc around the player each frame, and the tile + minimap draws gate on it.
    // Persisted on mapData (like chests) so it survives the game↔fight scene
    // round-trip — SP combat re-runs this scene, so a fresh Set would re-fog the
    // whole map after every fight. A new run gets fresh mapData → fresh fog.
    const explored = mapData.explored || (mapData.explored = new Set());
    const FOG_REVEAL = 6; // tiles revealed around the player (< the on-screen radius)
    function fogKey(x, y) { return x * 100000 + y; }
    function isExplored(x, y) { return explored.has(fogKey(x, y)); }
    function revealAround() {
      const ptx = Math.floor(playerX / EFFECTIVE_TILE), pty = Math.floor(playerY / EFFECTIVE_TILE);
      const r2 = FOG_REVEAL * FOG_REVEAL;
      for (let dx = -FOG_REVEAL; dx <= FOG_REVEAL; dx++)
        for (let dy = -FOG_REVEAL; dy <= FOG_REVEAL; dy++)
          if (dx * dx + dy * dy <= r2) explored.add(fogKey(ptx + dx, pty + dy));
    }
    revealAround(); // reveal the spawn area before the first frame

    // Camera
    k.camPos(playerX, playerY);
    clearFx(); // PV-T12: drop any particles a prior scene left behind (the fx pool is global)
    clearShake(); // PV-A5: reset screen-shake trauma on (re)entry

    let paused = false;
    let minimapZoom = 1; // PT1-T24: minimap zoom — 1× full map ↔ 2× player-centered (tap minimap / press M)
    let playerMoving = false;
    let stepAcc = 0; // PV-T12: throttle for SP footstep dust (SP↔MP parity)
    let playerDir = { x: 0, y: 1 };
    let extracting = false, extractT = 0; // brief extraction-flash before runResult

    // Spirit-chain throw state: at most one projectile in flight.
    let projectile = null; // { x, y, vx, vy, dist, maxDist, t, chainId }
    let impact = null; // { x, y, color, t0 } — brief landing FX where a thrown chain drops
    let flashMsg = "";
    let flashUntil = 0;
    // PV-T13 (SP parity): discrete storm-damage feedback. SP storm damage is applied
    // continuously per-frame (vs MP's discrete server ticks), so accumulate it and pop
    // a single rising "STORM -N" floater every ~0.6s instead of one per frame.
    let stormAccum = 0;
    let stormFloat = null; // { value, t0 } — current rising damage number
    let stormPtAcc = 0; // throttle for ambient storm debris particles (PV-T13)

    // Sprint stamina (local in single-player).
    let stamina = GAME.SPRINT.STAMINA_MAX;
    let wasSprinting = false;

    // Loot chests against walls (persisted on mapData so they survive game↔fight
    // round-trips, like tile monsters). Generated once per run; each holds 1–2
    // randomized chains, granted run-found (provisional until you extract).
    const rng = { next: Math.random };
    if (!mapData.chests) mapData.chests = generateChests();
    function isWall(x, y) {
      return x < 0 || x >= mapSize || y < 0 || y >= mapSize || !voidMap[x]?.[y] || tileMap[x][y]?.collidable;
    }
    function generateChests() {
      const defs = getSpiritChains();
      const out = [];
      for (let i = 0; i < GAME.SPIRIT_CHAIN.CHESTS_PER_RUN; i++) {
        for (let attempt = 0; attempt < 80; attempt++) {
          const tx = Math.floor(Math.random() * mapSize);
          const ty = Math.floor(Math.random() * mapSize);
          if (isWall(tx, ty)) continue;
          if (!(isWall(tx - 1, ty) || isWall(tx + 1, ty) || isWall(tx, ty - 1) || isWall(tx, ty + 1))) continue;
          const count = Math.random() < 0.35 ? 2 : 1;
          const loot = [];
          for (let n = 0; n < count; n++) { const d = rollChainDrop(defs, rng); if (d) loot.push(d.id); }
          if (loot.length) out.push({ id: `ch${i}`, x: tx * EFFECTIVE_TILE + EFFECTIVE_TILE / 2, y: ty * EFFECTIVE_TILE + EFFECTIVE_TILE / 2, loot });
          break;
        }
      }
      return out;
    }

    // Main update loop
    k.onUpdate(() => {
      if (paused || extracting) return; // freeze the world during the extraction flash
      elapsed += k.dt();
      updateFx(k.dt()); // PV-T12: advance world particles (footstep dust, chest sparkle)
      updateShake(k.dt()); // PV-A5: decay screen-shake trauma
      emitStormParticles(k.dt()); // PV-T13: ambient debris blown across the storm
      handleMovement();
      updateProjectile(k.dt());
      const sh = shakeOffset(); // PV-A5: trauma-based camera nudge (zero at rest)
      k.camPos(playerX + sh.x, playerY + sh.y);
      updateCircle();
      if (applyStormDamage()) return; // storm wiped the team → run ended this frame
      checkPortalCollision();
      checkChest();
      checkMonsterEncounter();
    });

    // HUD elements (fixed to screen). WIN-T2: anchor the top labels to the square play
    // window (no-op in landscape — square is centered + full-height; tucks onto the square
    // in portrait), parity with the MP scene.
    const pwHud = playWindowRect(k.width(), k.height());
    // WIN-T2: re-anchor these retained labels on a mid-round resize/orientation flip
    // (the shim doesn't restart gameplay scenes; the rest of the SP HUD is immediate-mode
    // so it adapts for free). Tracked + applied in the onUpdate below.
    let _winW = k.width(), _winH = k.height();
    const timerLabel = k.add([
      k.text("10:00", { size: 32, font: "gameFont" }),
      k.pos(pwHud.cx, pwHud.y + 30),
      k.anchor("center"),
      k.color(...THEME.text), // was raw 255,255,255 — the update loop already tints to warn/danger
      k.fixed(),
      k.z(100),
    ]);

    const portalHint = k.add([
      // Width-clamped so the centered objective text can't bleed into the top-left
      // team HUD's HP-bars column (~140px wide). 400px keeps it safely between the
      // team HUD and the right edge; longer objectives wrap to 2 lines instead.
      k.text("", { size: 16, font: "gameFont", width: 400 }),
      k.pos(pwHud.cx, pwHud.y + 60),
      k.anchor("center"),
      k.color(...THEME.teal), // was raw [80,220,255] cyan — unify with the spirit-light accent
      k.fixed(),
      k.z(100),
    ]);

    // Update HUD in the update loop
    k.onUpdate(() => {
      if (paused) return;
      // WIN-T2: re-anchor the retained timer + objective labels to the square when the
      // viewport size changes (orientation flip / resize — scene isn't restarted).
      if (k.width() !== _winW || k.height() !== _winH) {
        _winW = k.width(); _winH = k.height();
        const pw = playWindowRect(_winW, _winH);
        timerLabel.pos = k.vec2(pw.cx, pw.y + 30);
        portalHint.pos = k.vec2(pw.cx, pw.y + 60);
      }
      // Hide the HUD labels under the onboarding overlay — they're retained at z=100
      // and were bleeding through the immediate-mode dim (visible at the top of the
      // "HOW TO PLAY" screen). The other HUD draws are immediate-mode and stay below
      // the dim naturally; these two need explicit gating.
      timerLabel.hidden = onboard;
      portalHint.hidden = onboard;
      const remaining = Math.max(0, RUN_DURATION - elapsed);
      const minutes = Math.floor(remaining / 60);
      const seconds = Math.floor(remaining % 60);
      timerLabel.text = `${minutes}:${seconds.toString().padStart(2, "0")}`;

      if (remaining < 60) timerLabel.color = k.rgb(...THEME.danger);
      else if (remaining < 180) timerLabel.color = k.rgb(...THEME.warn);
      else timerLabel.color = k.rgb(...THEME.text);

      // PT2-T10 (#9): persistent contextual objective (SP parity with MP), via the
      // shared objectiveText helper — replaces the portals-only hint so a new player
      // always knows the goal (catch & loot → storm closing → extract → danger).
      const odx = playerX - circleCenterX, ody = playerY - circleCenterY;
      portalHint.text = objectiveText({
        circleStarted: elapsed >= CIRCLE_START_TIME,
        portalsOpen: portals.length > 0,
        outsideZone: odx * odx + ody * ody > circleRadius * circleRadius,
      });
    });

    // Rendering
    k.onDraw(() => {
      drawTiles();
      drawChests();
      drawAim();
      drawPlayer();
      drawProjectile();
      drawPortals();
      drawCircleOverlay();
      drawFx(k); // PV-T12: world particles (footstep dust, chest sparkle) — over world, under HUD
      drawStormFloater(); // PV-T13: rising "STORM -N" over the player when the zone bites
      // Caught in the storm (outside the shrinking safe zone — same test as the
      // damage tick): fade the spirit-glow + motes red so the danger is visceral.
      const sdx = playerX - circleCenterX, sdy = playerY - circleCenterY;
      const inStorm = sdx * sdx + sdy * sdy > circleRadius * circleRadius;
      drawAtmosphere(k, { t: k.time(), danger: inStorm ? 1 : 0 }); // vignette + spirit-light + motes (over world, under HUD)
      // Square play-window frame (user design 2026-06-08) — SP parity with MP. Frame-
      // only for now; map stays visible outside the square. See WIN-T* in the plan.
      if (!onboard) drawPlayWindow(k, { dim: 0 });
      // Hide all the in-round HUD chrome under the onboarding tutorial — these are
      // immediate-mode draws that bleed faintly through the 0.88 dim (light HP bars,
      // chain icons, minimap blips visible against the dark wash). Biome chip already
      // had the same gate; align team/chain/minimap with it.
      if (!onboard) { drawMinimap(); drawTeamHud(); drawChainHud(); }
      if (!onboard) { const pwb = playWindowRect(k.width(), k.height()); drawBiomeChip(k, { x: pwb.cx, y: pwb.bottom - 34, map: mapData, wx: playerX, wy: playerY }); } // PT1-T18 + WIN-T2: bottom-center of the square
      // Outside the safe zone: pulsing red border + warning (parity with the MP
      // danger overlay) so the storm reads as an explicit, actionable threat — not
      // just the ambient red atmosphere. `inStorm` computed above.
      if (!onboard && inStorm) {
        const W = k.width(), H = k.height(), bt = 8;
        const pulse = 0.5 + 0.5 * Math.sin(k.time() * 6), op = 0.25 + 0.45 * pulse;
        // Storm danger border + labels routed through THEME.danger (was hand-tuned
        // [230,60,60] orange-red + [255,120,120] / [255,185,185] lighter pinks).
        const red = k.rgb(...THEME.danger);
        k.drawRect({ pos: k.vec2(0, 0), width: W, height: bt, color: red, opacity: op, fixed: true });
        k.drawRect({ pos: k.vec2(0, H - bt), width: W, height: bt, color: red, opacity: op, fixed: true });
        k.drawRect({ pos: k.vec2(0, 0), width: bt, height: H, color: red, opacity: op, fixed: true });
        k.drawRect({ pos: k.vec2(W - bt, 0), width: bt, height: H, color: red, opacity: op, fixed: true });
        const cyw = Math.round(H * 0.26);
        k.drawText({ text: "OUTSIDE SAFE ZONE", pos: k.vec2(W / 2, cyw), size: 22, font: "gameFont", anchor: "center", color: red, opacity: 0.7 + 0.3 * pulse, fixed: true });
        k.drawText({ text: "get back inside the zone", pos: k.vec2(W / 2, cyw + 26), size: 14, font: "gameFont", anchor: "center", color: red, opacity: 0.8, fixed: true });
      }
      if (!onboard) drawPortalCompass(); // SP parity (VS-20): edge arrow to nearest portal — on top of HUD so it's never hidden
      drawTouchControls(); // MB-2: SP joystick + THROW (touch only)
      drawSpOnboarding(); // LS-7: first-run how-to overlay (over everything)
      // Extraction climax: a teal shockwave + white-out over everything while the
      // 0.6s transition to the result screen plays.
      if (extracting) drawExtractFlash(k, { x: k.width() / 2, y: k.height() / 2, p: Math.min(1, (k.time() - extractT) / 0.6) });
    });

    // ── MB-2: single-player touch controls — a floating joystick (left half) for
    // movement + a THROW button (right) so SP is playable on a phone (was keyboard-
    // only). Mirrors the online game's scheme. Desktop is unaffected: nothing draws
    // until a touch is used, and the joystick ring only shows while held.
    const JOY_R = 70, THROW_R = 46;
    const TOUCH = typeof k.isTouchscreen === "function" ? k.isTouchscreen() : (typeof window !== "undefined" && "ontouchstart" in window);
    // MB-4: keep the SP touch buttons clear of the notch / rounded corners / home-bar
    // (mirrors onlineGame). env(safe-area-inset-*) is CSS px → design units via the
    // canvas FIT scale (canvasCssHeight/k.height()); cached + refreshed on a 1s
    // throttle, touch-only — so desktop runs zero new code and nothing moves.
    let safeInset = { top: 0, right: 0, bottom: 0, left: 0 };
    const recomputeSafeInset = () => { safeInset = safeInsetsDesign(k); }; // shared helper (design-unit notch/home-bar insets)
    if (TOUCH) { recomputeSafeInset(); let safeAcc = 0; k.onUpdate(() => { safeAcc += k.dt(); if (safeAcc >= 1) { recomputeSafeInset(); safeAcc = 0; } }); }
    // WIN-T2: touch widgets + the minimap tap hit-test anchor to the square play window
    // (corners of the square, not the raw canvas) so they match the square-anchored HUD
    // and land correctly in portrait. `_pwj` = the square at scene start (rest position).
    const _pwj = playWindowRect(k.width(), k.height());
    let joyId = null, joyVec = { x: 0, y: 0 }, joyBase = k.vec2(_pwj.x + 110, _pwj.bottom - 110), thumb = joyBase, touchUsed = false;
    // SP HUD layout differs from MP: the minimap is bottom-right and the timer is
    // top-center, so the touch buttons sit clear of those — THROW just left of the
    // bottom-right minimap; pause top-right (free in SP). All anchored to the square.
    const throwBtnC = () => { const pw = playWindowRect(k.width(), k.height()); return k.vec2(pw.right - 236 - safeInset.right, pw.bottom - 80 - safeInset.bottom); };
    const pauseBtnRect = () => { const pw = playWindowRect(k.width(), k.height()); return [pw.right - 54 - safeInset.right, pw.y + 10 + safeInset.top, 44, 34]; }; // LS-7: touch pause; MB-4: clear the notch
    // PT1-T24: the minimap is drawn in world space but appears fixed at the square's
    // bottom-right (camera centers the player); this is its screen-space rect for tap
    // hit-testing — MUST match drawMinimap's square anchoring (WIN-T2) or tap-to-zoom drifts.
    const MM_SIZE = 160;
    const minimapRectScreen = () => { const pw = playWindowRect(k.width(), k.height()); return [pw.right - MM_SIZE - 16, pw.bottom - MM_SIZE - 16, MM_SIZE, MM_SIZE]; };
    const toggleMinimapZoom = () => { minimapZoom = minimapZoom === 1 ? 2 : 1; };
    // LS-7: first-run "how to play" overlay for single-player (was MP-only — new SP
    // players got zero guidance). Shares the "seen it" key with MP.
    let onboard = false, onboardT = 0;
    try { onboard = !localStorage.getItem("tq_onboarded"); } catch {}
    const dismissOnboard = () => { if (!onboard) return; onboard = false; try { localStorage.setItem("tq_onboarded", "1"); } catch {} };
    function joyStart(id, p) {
      if (p.x > k.width() * 0.5) return; // left half only — keeps the right thumb free
      joyId = id;
      joyBase = k.vec2(Math.max(JOY_R, Math.min(k.width() * 0.5, p.x)), Math.max(JOY_R, Math.min(k.height() - JOY_R, p.y)));
      thumb = joyBase; joyMove(id, p);
    }
    function joyMove(id, p) {
      if (id !== joyId) return;
      let d = p.sub(joyBase); const len = d.len() || 1;
      if (len > JOY_R) d = d.scale(JOY_R / len);
      thumb = joyBase.add(d); joyVec = { x: d.x / JOY_R, y: d.y / JOY_R };
    }
    function joyEnd(id) { if (id !== joyId) return; joyId = null; joyVec = { x: 0, y: 0 }; thumb = joyBase; }
    function touchDown(id, p) {
      touchUsed = true;
      if (onboard) { if (onboardT > 0.3) dismissOnboard(); return; } // tap dismisses the how-to
      if (paused) return;
      const pb = pauseBtnRect();
      if (p.x >= pb[0] && p.x <= pb[0] + pb[2] && p.y >= pb[1] && p.y <= pb[1] + pb[3]) { showPauseMenu(); return; } // LS-7 touch pause
      const tb = throwBtnC();
      if (Math.hypot(p.x - tb.x, p.y - tb.y) <= THROW_R) { tryThrowChain(); return; } // tap THROW
      const [mmrx, mmry, mmrw, mmrh] = minimapRectScreen();
      if (p.x >= mmrx && p.x <= mmrx + mmrw && p.y >= mmry && p.y <= mmry + mmrh) { toggleMinimapZoom(); return; } // PT1-T24: tap minimap = zoom
      joyStart(id, p);
    }
    k.onTouchStart((p, t) => touchDown(t?.identifier ?? 0, p));
    k.onTouchMove((p, t) => joyMove(t?.identifier ?? 0, p));
    k.onTouchEnd((p, t) => joyEnd(t?.identifier ?? 0));
    function drawTouchControls() {
      if (!touchUsed || onboard) return; // desktop / before first touch / during how-to: no clutter
      if (joyId !== null) {
        k.drawCircle({ pos: joyBase, radius: JOY_R, color: k.rgb(255, 255, 255), opacity: 0.10, fixed: true });
        k.drawCircle({ pos: joyBase, radius: JOY_R, fill: false, outline: { width: 2, color: k.rgb(255, 255, 255) }, opacity: 0.35, fixed: true });
        k.drawCircle({ pos: thumb, radius: 28, color: k.rgb(...THEME.primary), opacity: 0.6, fixed: true });
      }
      if (getEquippedChainState()) {
        const tb = throwBtnC();
        k.drawCircle({ pos: tb, radius: THROW_R, color: k.rgb(...THEME.surface), opacity: 0.7, fixed: true });
        k.drawCircle({ pos: tb, radius: THROW_R, fill: false, outline: { width: 2, color: k.rgb(...THEME.primary) }, opacity: 0.85, fixed: true });
        k.drawText({ text: "THROW", pos: k.vec2(tb.x, tb.y), size: 13, font: "gameFont", anchor: "center", color: k.rgb(...THEME.text), fixed: true });
      }
      if (!paused) { // LS-7: touch pause button (top-center) → opens the pause menu
        const [pbx, pby, pbw, pbh] = pauseBtnRect();
        k.drawRect({ pos: k.vec2(pbx, pby), width: pbw, height: pbh, radius: 8, color: k.rgb(...THEME.bg), opacity: 0.6, outline: { width: 1, color: k.rgb(...THEME.line) }, fixed: true });
        k.drawRect({ pos: k.vec2(pbx + pbw / 2 - 7, pby + 9), width: 5, height: pbh - 18, radius: 1, color: k.rgb(...THEME.text), fixed: true });
        k.drawRect({ pos: k.vec2(pbx + pbw / 2 + 2, pby + 9), width: 5, height: pbh - 18, radius: 1, color: k.rgb(...THEME.text), fixed: true });
      }
    }
    // LS-7: single-player first-run overlay (touch-aware hints), drawn over everything.
    function drawSpOnboarding() {
      if (!onboard) return;
      onboardT += k.dt();
      const W = k.width(), H = k.height(), cx = W / 2;
      k.drawRect({ pos: k.vec2(0, 0), width: W, height: H, color: k.rgb(...THEME.bg), opacity: 0.88, fixed: true });
      k.drawText({ text: "HOW TO PLAY", pos: k.vec2(cx, H * 0.18), size: 40, font: "gameFont", anchor: "center", color: k.rgb(...THEME.amber), fixed: true });
      const lines = TOUCH ? [
        "MOVE — drag the left side of the screen",
        "THROW A SPIRIT CHAIN — tap the THROW button to catch wild monsters",
        "IN A FIGHT — choose Fight / Catch / Swap / Flee",
        "EXTRACT — reach a glowing portal before the timer runs out",
        "THE STAKES — die and you lose the spirit chains you found this run",
        "PAUSE — tap the pause button (top)",
      ] : [
        "MOVE — WASD or the arrow keys",
        "SPRINT — hold Shift to move faster (drains stamina)",
        "THROW A SPIRIT CHAIN — Space (or Q), aimed with the mouse, to catch wild monsters",
        "IN A FIGHT — choose Fight / Catch / Swap / Flee",
        "EXTRACT — reach a glowing portal before the timer runs out",
        "THE STAKES — die and you lose the spirit chains you found this run",
        "PAUSE — ESC",
      ];
      lines.forEach((ln, i) => k.drawText({ text: ln, pos: k.vec2(cx, H * 0.34 + i * 36), size: 18, font: "gameFont", anchor: "center", width: W - 140, color: k.rgb(...THEME.text), fixed: true }));
      const pulse = 0.55 + 0.45 * Math.sin(k.time() * 4);
      k.drawText({ text: "move or tap to begin", pos: k.vec2(cx, H * 0.82), size: 18, font: "gameFont", anchor: "center", color: k.rgb(...THEME.textBody), opacity: pulse, fixed: true });
    }

    function handleMovement() {
      let dx = 0, dy = 0;
      if (joyVec.x || joyVec.y) { dx = joyVec.x; dy = joyVec.y; } // MB-2: touch joystick overrides keys
      else {
        if (k.isKeyDown("w") || k.isKeyDown("up")) dy = -1;
        if (k.isKeyDown("s") || k.isKeyDown("down")) dy = 1;
        if (k.isKeyDown("a") || k.isKeyDown("left")) dx = -1;
        if (k.isKeyDown("d") || k.isKeyDown("right")) dx = 1;
      }

      playerMoving = !(dx === 0 && dy === 0);
      if (onboard && playerMoving && onboardT > 0.3) dismissOnboard(); // LS-7: moving dismisses the how-to

      // Sprint + stamina (ticks every frame so it regenerates while idle too).
      const sprinting = sprintingNow({ sprint: k.isKeyDown("shift"), moving: playerMoving, stamina, wasSprinting }, GAME);
      stamina = tickStamina(stamina, sprinting, k.dt(), GAME);
      wasSprinting = sprinting;

      if (dx === 0 && dy === 0) return;

      // Unit-normalize so keyboard diagonals AND the analog joystick move at one speed.
      const mag = Math.hypot(dx, dy) || 1;
      dx /= mag; dy /= mag;
      playerDir = { x: dx, y: dy };

      const speedMod = biomeSpeedMultAt(mapData, playerX, playerY); // per-biome terrain speed
      const speed = BASE_SPEED * speedMod * sprintMult(sprinting, GAME) * k.dt();

      const newX = playerX + dx * speed;
      const newY = playerY + dy * speed;

      // PT2-T06 (SP parity with the server): collide the leading body EDGE
      // (center ± PLAYER_RADIUS along the moving axis), not the center, so a wall
      // stops you where your sprite meets it instead of letting the body overlap
      // ~a radius into the wall. Per-axis so you still slide along walls.
      const R = GAME.PLAYER_RADIUS;
      if (isWalkable(newX + Math.sign(dx) * R, playerY)) {
        playerX = newX;
      }
      if (isWalkable(playerX, newY + Math.sign(dy) * R)) {
        playerY = newY;
      }

      // PV-T12 (SP↔MP parity): footstep dust while roaming, throttled (faster when
      // sprinting). Only reached when actually moving (the idle case early-returned above).
      stepAcc += k.dt();
      if (stepAcc >= (sprinting ? 0.24 : 0.34)) {
        stepAcc = 0;
        emit({ x: playerX, y: playerY + 16, n: 3, color: [150, 140, 122], speed: 16, life: 0.4, size: 2.6, spread: Math.PI * 0.9, dir: -Math.PI / 2, gravity: 30, drag: 2 });
      }
    }

    function getTileAt(px, py) {
      const tx = Math.floor(px / EFFECTIVE_TILE);
      const ty = Math.floor(py / EFFECTIVE_TILE);
      if (tx < 0 || tx >= mapSize || ty < 0 || ty >= mapSize) return null;
      return tileMap[tx][ty];
    }

    function isWalkable(px, py) {
      const tx1 = Math.floor(px / EFFECTIVE_TILE);
      const ty1 = Math.floor(py / EFFECTIVE_TILE);
      if (tx1 < 0 || tx1 >= mapSize || ty1 < 0 || ty1 >= mapSize) return false;
      if (!voidMap[tx1][ty1]) return false;
      // Walkable == the renderer's floor definition: a present, non-collidable tile.
      // Require the tile to exist (not just voidMap) so collision can't disagree with
      // render and produce an "invisible wall" on a tile-less cell (BUGFIX_LOG finding).
      const tile = tileMap[tx1][ty1];
      if (!tile || tile.collidable) return false;
      return true;
    }

    function drawTiles() {
      revealAround(); // fog of war: reveal the disc around the player this frame
      // Textured floor + cave void/wall-border — shared renderer (render/tiles.js),
      // identical to the online view (P10-T2 parity; replaces SP's old flat tiles).
      drawFloorTiles(k, mapData, playerX, playerY, tileCache, EFFECTIVE_TILE, isExplored);

      // Monsters sitting on tiles: each visible one's procedural sprite, grounded
      // with a soft shadow (SP keeps wild monsters on the tilemap; amber fallback).
      const halfW = k.width() / 2, halfH = k.height() / 2;
      const startX = Math.max(0, Math.floor((playerX - halfW) / EFFECTIVE_TILE) - 1);
      const endX = Math.min(mapSize - 1, Math.ceil((playerX + halfW) / EFFECTIVE_TILE) + 1);
      const startY = Math.max(0, Math.floor((playerY - halfH) / EFFECTIVE_TILE) - 1);
      const endY = Math.min(mapSize - 1, Math.ceil((playerY + halfH) / EFFECTIVE_TILE) + 1);
      const ptx = Math.floor(playerX / EFFECTIVE_TILE), pty = Math.floor(playerY / EFFECTIVE_TILE);
      const reduceMo = prefersReducedMotion(); // a11y: once per frame, freeze the idle bob

      for (let x = startX; x <= endX; x++) {
        for (let y = startY; y <= endY; y++) {
          const tile = tileMap[x][y];
          if (!tile || !tile.activeMonster) continue;
          if (Math.abs(x - ptx) + Math.abs(y - pty) > RENDER_DISTANCE) continue;
          const centerX = x * EFFECTIVE_TILE + EFFECTIVE_TILE / 2;
          const centerY = y * EFFECTIVE_TILE + EFFECTIVE_TILE / 2;
          const am = tile.activeMonster;
          // Hidden monsters (Q2 ambush, SP parity with the server): ~HIDDEN_MONSTER_PCT
          // start hidden and only appear within REVEAL_RADIUS. Deterministic by id (the
          // same hashString formula the server uses) so a monster is stably hidden/shown
          // — walking onto its tile still triggers the fight (the ambush).
          if (hashString(String(am.id)) % 100 < GAME.HIDDEN_MONSTER_PCT) {
            const rdx = centerX - playerX, rdy = centerY - playerY;
            if (rdx * rdx + rdy * rdy > GAME.REVEAL_RADIUS * GAME.REVEAL_RADIUS) continue;
          }
          const idle = reduceMo ? 0 : Math.sin(k.time() * 2 + (centerX + centerY) * 0.013); // PV-T14: gentle idle bob + breath
          k.drawEllipse({ pos: k.vec2(centerX, centerY + 20), radiusX: 15, radiusY: 5, color: k.rgb(0, 0, 0), opacity: 0.28 });
          try {
            k.drawSprite({ sprite: (am.typeName || "").toLowerCase().replace(/\s+/g, "_"), pos: k.vec2(centerX, centerY + idle * 2), anchor: "center", scale: 0.45 * (1 + idle * 0.03) });
          } catch {
            k.drawCircle({ pos: k.vec2(centerX, centerY), radius: 8, color: k.rgb(220, 180, 80) });
          }
        }
      }
    }

    function drawPlayer() {
      const cs = getEquippedCharacterSkin(); // player-character cosmetic (accent + cloak)
      // Ground + lift the figure off the dark floor: a soft contact shadow and a
      // faint accent halo behind it, so the dark cloak reads clearly in the cave.
      const ac = cs.accent || THEME.teal;
      k.drawCircle({ pos: k.vec2(playerX, playerY - 6), radius: 24, color: k.rgb(ac[0], ac[1], ac[2]), opacity: 0.12 });
      k.drawEllipse({ pos: k.vec2(playerX, playerY + 13), radiusX: 15, radiusY: 5, color: k.rgb(0, 0, 0), opacity: 0.36 });
      drawCharacter(k, { x: playerX, y: playerY - 8, t: k.time(), moving: playerMoving, color: cs.accent, cloak: cs.cloak, dir: playerDir });
    }

    // Faint telegraph line from the player along the current aim, when a chain
    // is equipped, ready, and nothing is in flight.
    function drawAim() {
      if (projectile) return;
      const chainState = getEquippedChainState();
      const def = chainState && getSpiritChain(chainState.chainId);
      if (!def || !canThrow(chainState)) return;
      const aim = aimDir();
      const col = chainColor(def);
      k.drawLine({
        p1: k.vec2(playerX, playerY - 8),
        p2: k.vec2(playerX + aim.x * def.throwRange, playerY - 8 + aim.y * def.throwRange),
        width: 1.5,
        color: k.rgb(col[0], col[1], col[2]),
        opacity: 0.22,
      });
      // A small reticle at the aim's reach end, so the cursor-aim reads clearly.
      k.drawCircle({ pos: k.vec2(playerX + aim.x * def.throwRange, playerY - 8 + aim.y * def.throwRange), radius: 4, fill: false, outline: { width: 1.5, color: k.rgb(col[0], col[1], col[2]) }, opacity: 0.5 });
    }

    function drawProjectile() {
      if (projectile) {
        const def = getSpiritChain(projectile.chainId);
        drawSpiritChainProjectile(k, projectile, chainColor(def), k.time());
      }
      // Landing impact (miss/drop) — ~0.32s, then clears.
      if (impact) {
        const p = (k.time() - impact.t0) / 0.32;
        if (p >= 1) { impact = null; }
        else drawChainImpact(k, { x: impact.x, y: impact.y, color: impact.color, progress: p });
      }
    }

    function drawChests() {
      const chests = mapData.chests;
      if (!chests) return;
      for (const c of chests) drawChest(k, { x: c.x, y: c.y, t: k.time() });
    }

    function drawPortals() {
      for (const portal of portals) {
        const px = portal.x * EFFECTIVE_TILE + EFFECTIVE_TILE / 2;
        const py = portal.y * EFFECTIVE_TILE + EFFECTIVE_TILE / 2;
        // Rift rises from the ground on spawn; `bornAt` is the run clock when it
        // appeared (older saves without it read as fully risen).
        const age = portal.bornAt == null ? 999 : elapsed - portal.bornAt;
        drawPortal(k, { x: px, y: py, t: elapsed, age });
      }
    }

    // Off-screen extraction guidance (SP parity with MP VS-20): a screen-edge arrow
    // toward the nearest portal when it isn't on-screen, so you know which way to run
    // to extract. SP portals are in TILE coords (→ world via EFFECTIVE_TILE); the
    // camera centers (playerX, playerY) on screen. Portal-cyan; auto-hides on-screen.
    function drawPortalCompass() {
      if (!portals.length) return;
      let np = null, best = Infinity;
      for (const p of portals) {
        const wx = p.x * EFFECTIVE_TILE + EFFECTIVE_TILE / 2, wy = p.y * EFFECTIVE_TILE + EFFECTIVE_TILE / 2;
        const d = (wx - playerX) ** 2 + (wy - playerY) ** 2;
        if (d < best) { best = d; np = { x: wx, y: wy }; }
      }
      const W = k.width(), H = k.height(), margin = 54;
      const sx = (np.x - playerX) + W / 2, sy = (np.y - playerY) + H / 2;
      if (sx >= margin && sx <= W - margin && sy >= margin && sy <= H - margin) return; // on-screen → visible
      const ang = Math.atan2(sy - H / 2, sx - W / 2), c = Math.cos(ang), s = Math.sin(ang);
      const hw = W / 2 - margin, hh = H / 2 - margin;
      const scale = Math.min(hw / (Math.abs(c) || 1e-6), hh / (Math.abs(s) || 1e-6));
      const ax = W / 2 + c * scale, ay = H / 2 + s * scale;
      // SP's minimap sits bottom-right (160px + 16 margin); skip the arrow when it
      // would land over it — the minimap already shows portals in that direction.
      if (ax >= W - 176 && ay >= H - 176) return;
      const cyan = k.rgb(...THEME.portal), pulse = 0.6 + 0.4 * Math.sin(k.time() * 4), wid = 3;
      k.drawCircle({ pos: k.vec2(ax, ay), radius: 17, color: k.rgb(8, 12, 20), opacity: 0.7, fixed: true });
      k.drawCircle({ pos: k.vec2(ax, ay), radius: 17, fill: false, outline: { width: 1.5, color: cyan }, opacity: 0.5 + 0.35 * pulse, fixed: true });
      const tip = k.vec2(ax + c * 9, ay + s * 9), b = 8, a1 = ang + Math.PI * 0.78, a2 = ang - Math.PI * 0.78;
      k.drawLine({ p1: k.vec2(ax - c * 7, ay - s * 7), p2: tip, width: wid, color: cyan, fixed: true });
      k.drawLine({ p1: tip, p2: k.vec2(tip.x + Math.cos(a1) * b, tip.y + Math.sin(a1) * b), width: wid, color: cyan, fixed: true });
      k.drawLine({ p1: tip, p2: k.vec2(tip.x + Math.cos(a2) * b, tip.y + Math.sin(a2) * b), width: wid, color: cyan, fixed: true });
      const dist = Math.round(Math.sqrt(best) / EFFECTIVE_TILE);
      k.drawText({ text: `${dist}`, pos: k.vec2(ax - c * 31, ay - s * 31), size: 13, font: "gameFont", anchor: "center", color: cyan, fixed: true });
    }

    function updateCircle() {
      if (elapsed < CIRCLE_START_TIME) return;

      const remaining = RUN_DURATION - elapsed;
      const circleTime = RUN_DURATION - CIRCLE_START_TIME;
      const ratio = Math.max(0, remaining / circleTime);
      circleRadius = ratio * (mapSize / 2) * EFFECTIVE_TILE;

      // Spawn portal periodically. Break if a spawn fails (no walkable tile found)
      // — otherwise the loop spins forever, since portals.length never grows. This
      // mirrors the server's guarded loop (world.js spawnPortal). The failure case
      // gets likelier as circleRadius shrinks late in a run.
      const portalCount = Math.floor((elapsed - CIRCLE_START_TIME) / PORTAL_INTERVAL);
      while (portals.length < portalCount + 1) {
        if (!spawnPortal()) break;
      }
    }

    // Storm/zone damage outside the shrinking safe zone (SP parity with the server
    // — the SP zone used to be purely cosmetic). Chips the lead monster at STORM_DPS;
    // when the whole team is down the run ends as a defeat. Returns true if it ended
    // the run (so the caller skips the rest of this frame's checks).
    function applyStormDamage() {
      if (elapsed < CIRCLE_START_TIME) return false;
      const ddx = playerX - circleCenterX, ddy = playerY - circleCenterY;
      if (ddx * ddx + ddy * ddy <= circleRadius * circleRadius) return false; // inside the zone
      flashHud("OUTSIDE SAFE ZONE — get back!");
      const dmg = GAME.STORM_DPS * k.dt();
      // Accumulate the continuous chip and pop a rising "STORM -N" once ~0.6s of it
      // adds up, so each storm "bite" registers as a felt hit (MP-parity feedback)
      // without a number spamming every frame.
      stormAccum += dmg;
      if (stormAccum >= 1 && (!stormFloat || k.time() - stormFloat.t0 >= 0.6)) {
        stormFloat = { value: Math.round(stormAccum), t0: k.time() };
        stormAccum = 0;
        if (!prefersReducedMotion()) addShake(0.34); // PV-A5: the storm kicks the camera (MP parity)
      }
      if (stormDamageTeam(character.activeMonsters, dmg)) {
        const gains = endRunStakes(false); // storm wipe → forfeit run-found chains
        k.go("runResult", { characterId, result: "defeat", gains });
        return true;
      }
      return false;
    }

    // Ambient storm debris (PV-T13): while you're caught in the storm (outside the
    // shrinking safe zone), spawn a steady trickle of red motes blown across the view
    // on a diagonal wind, so the storm reads as a living hazard, not just a red border.
    // Throttled + budget-capped by the shared fx pool. a11y: skip under reduce-motion.
    function emitStormParticles(dt) {
      if (elapsed < CIRCLE_START_TIME || prefersReducedMotion()) return;
      const ddx = playerX - circleCenterX, ddy = playerY - circleCenterY;
      if (ddx * ddx + ddy * ddy <= circleRadius * circleRadius) return; // only inside the storm
      stormPtAcc += dt;
      if (stormPtAcc < 0.08) return;
      stormPtAcc = 0;
      const R = 360; // roughly the on-screen radius around the player
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2, rr = Math.random() * R;
        emit({ x: playerX + Math.cos(a) * rr, y: playerY + Math.sin(a) * rr, n: 1, color: [205, 85, 75], speed: 95, life: 0.5, size: 2.2, spread: 0.5, dir: Math.PI * 0.18, gravity: 0, drag: 0.6 });
      }
    }

    // Rising "STORM -N" damage number over the player (world-space), fading over
    // ~0.8s — the discrete-bite half of the storm feedback (the red border/atmosphere
    // is the continuous half). MP parity (onlineGame emitText "STORM -N").
    function drawStormFloater() {
      if (!stormFloat) return;
      const age = k.time() - stormFloat.t0;
      if (age >= 0.8) { stormFloat = null; return; }
      k.drawText({ text: `STORM -${stormFloat.value}`, pos: k.vec2(playerX, playerY - 30 - age * 34), size: 15, font: "gameFont", anchor: "center", color: k.rgb(255, 120, 120), opacity: 1 - age / 0.8 });
    }

    // Returns true if a portal was placed, false if no walkable tile was found.
    function spawnPortal() {
      for (let attempt = 0; attempt < 100; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * circleRadius * 0.8;
        const px = Math.floor((circleCenterX + Math.cos(angle) * dist) / EFFECTIVE_TILE);
        const py = Math.floor((circleCenterY + Math.sin(angle) * dist) / EFFECTIVE_TILE);
        if (px >= 0 && px < mapSize && py >= 0 && py < mapSize && voidMap[px][py]) {
          portals.push({ x: px, y: py, bornAt: elapsed });
          return true;
        }
      }
      return false;
    }

    function checkPortalCollision() {
      const ptx = Math.floor(playerX / EFFECTIVE_TILE);
      const pty = Math.floor(playerY / EFFECTIVE_TILE);
      for (const portal of portals) {
        if (portal.x === ptx && portal.y === pty) {
          const gains = endRunStakes(true); // extracted → heal survivors, bank extract gold + run-found chains (saves)
          sfx("extract"); haptic([0, 25, 45, 70]); // MOB-T4: rising buzz + extract chime — SP parity with MP's initAudio "extracted"
          // a11y: reduce-motion skips the white-out flash (and its delay) and goes
          // straight to the result — parity with the MP extract flash's guard.
          if (prefersReducedMotion()) { k.go("runResult", { characterId, result: "victory", gains }); return; }
          // Otherwise play the extraction flash, then transition (the world freezes
          // via the `extracting` guard above so the burst reads before the result).
          extracting = true; extractT = k.time();
          k.wait(0.6, () => k.go("runResult", { characterId, result: "victory", gains }));
          return;
        }
      }

      // Time's up
      if (elapsed >= RUN_DURATION) {
        const gains = endRunStakes(false); // timeout → lose run-found chains
        k.go("runResult", { characterId, result: "timeout", gains }); // VS-13: accurate code (was "defeat")
      }
    }

    // Resolve spirit-chain extraction stakes at run end and persist.
    function endRunStakes(kept) {
      // Count the run-found chains BEFORE finalize clears the flag, so the result
      // screen can report the haul (banked on extract, forfeited otherwise). P8-T3
      // parity: MP's round result shows run deltas; SP showed none.
      const chains = (character.chains || []).filter((c) => c.runFound).length;
      const gold = kept ? grantExtractRewards(character) : 0; // extract → survivors heal + extract gold bonus (shared w/ server — P10-T3)
      // Q10 (confirmed 2026-06-07): a defeat (storm/timeout/abandon) loses the active
      // run team — refill from vault / starters, the SAME shared rule MP applies. SP
      // previously kept the team on death, a parity + spec gap (INV-A2).
      if (!kept) loseRunTeam(character, rollStarters);
      finalizeRunChains(character, kept, getSpiritChain);
      saveCharacter(character);
      return { chains, gold };
    }

    function checkMonsterEncounter() {
      const ptx = Math.floor(playerX / EFFECTIVE_TILE);
      const pty = Math.floor(playerY / EFFECTIVE_TILE);
      if (ptx < 0 || ptx >= mapSize || pty < 0 || pty >= mapSize) return;
      const tile = tileMap[ptx][pty];
      if (tile?.activeMonster) {
        const monster = tile.activeMonster;
        tile.activeMonster = null;
        // Walking into a monster: the monster gets initiative (first turn).
        k.go("fight", { characterId, monster, mapData, playerPos: { x: playerX, y: playerY }, elapsed, portals, initiator: "monster" });
      }
    }

    // DEV-only QA hook (import.meta.env.DEV → stripped from prod builds): press 0
    // to force the nearest wild encounter, so the SP-combat screenshot harness can
    // reach the fight scene deterministically instead of RNG-roaming onto a monster
    // tile. Player gets initiative so the player menu shows immediately.
    if (import.meta.env.DEV) {
      k.onKeyPress("0", () => {
        let best = null, bestD = Infinity;
        for (let x = 0; x < mapSize; x++) {
          for (let y = 0; y < mapSize; y++) {
            const tile = tileMap[x]?.[y];
            if (!tile?.activeMonster) continue;
            const dx = x * EFFECTIVE_TILE + EFFECTIVE_TILE / 2 - playerX;
            const dy = y * EFFECTIVE_TILE + EFFECTIVE_TILE / 2 - playerY;
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; best = tile; }
          }
        }
        if (!best) return;
        const monster = best.activeMonster;
        best.activeMonster = null;
        k.go("fight", { characterId, monster, mapData, playerPos: { x: playerX, y: playerY }, elapsed, portals, initiator: "player" });
      });
    }

    // ── Spirit-chain throwing ──────────────────────────────────────────────
    // The live counters for the player's currently equipped chain.
    function getEquippedChainState() {
      const id = character.equippedChainId;
      return (character.chains || []).find((c) => c.chainId === id) || null;
    }

    function flashHud(msg) {
      flashMsg = msg;
      flashUntil = k.time() + 1.4;
    }

    // Aim direction for a throw: toward the mouse cursor (camera is centred on the
    // player, so world-mouse = player + (screen-mouse − screen-centre)); falls back
    // to the movement facing when the cursor sits on the player or there's no mouse
    // (touch). Used by both the throw and the aim telegraph so they always match.
    function aimDir() {
      const mp = typeof k.mousePos === "function" ? k.mousePos() : null;
      if (mp) {
        const dx = mp.x - k.width() / 2;
        const dy = (mp.y - k.height() / 2) + 8; // player is drawn at y-8
        const d = Math.hypot(dx, dy);
        if (d > 12) return { x: dx / d, y: dy / d };
      }
      const len = Math.hypot(playerDir.x, playerDir.y) || 1;
      return { x: playerDir.x / len, y: playerDir.y / len };
    }

    function tryThrowChain() {
      if (paused || projectile) return; // one chain in flight at a time
      const chainState = getEquippedChainState();
      const def = chainState && getSpiritChain(chainState.chainId);
      if (!def) { flashHud("No chain equipped"); return; }
      if (!canThrow(chainState)) { flashHud("No throws left"); return; }

      const aim = aimDir();
      projectile = {
        x: playerX,
        y: playerY - 8,
        vx: aim.x * def.throwSpeed,
        vy: aim.y * def.throwSpeed,
        dist: 0,
        maxDist: def.throwRange,
        t: 0,
        chainId: def.id,
      };
      playThrowWindup(playerX, playerY - 8, chainColor(def)); // PV-T11: launch beat (SP parity with MP)
      // Decrement the overworld throw counter now (a miss still costs a throw).
      if (chainState.throwCount != null) chainState.throwCount--;
      saveCharacter(character);
    }

    // PV-T11 (SP parity with onlineGame): throw wind-up tell — a chain-colored ring
    // snaps inward onto the tamer the instant a chain is loosed, plus a small spark
    // puff, so the throw has a readable launch beat (the comet trail covers the flight
    // and drawChainImpact the landing). World-space; self-cancels after ~0.2s.
    // a11y: a static ring (no inward collapse) under reduce-motion.
    function playThrowWindup(x, y, c) {
      const t0 = k.time(), reduce = prefersReducedMotion();
      const h = k.onDraw(() => {
        const p = (k.time() - t0) / 0.2;
        if (p >= 1) { h.cancel(); return; }
        const r = reduce ? 18 : 6 + 26 * (1 - p);
        k.drawCircle({ pos: k.vec2(x, y), radius: r, fill: false, outline: { width: 2 + 2 * (1 - p), color: k.rgb(c[0], c[1], c[2]) }, opacity: 0.6 * (1 - p) });
      });
      emit({ x, y, n: 6, color: c, speed: 26, life: 0.3, size: 2.4, spread: Math.PI * 2, drag: 3 }); // chain-colored charge sparks (PV-T12 fx path)
    }

    function updateProjectile(dt) {
      if (!projectile) return;
      const def = getSpiritChain(projectile.chainId);
      const ttl = GAME.SPIRIT_CHAIN.PROJECTILE_TTL_S;
      const speed = def ? def.throwSpeed : Math.hypot(projectile.vx, projectile.vy);
      projectile.x += projectile.vx * dt;
      projectile.y += projectile.vy * dt;
      projectile.dist += speed * dt;
      projectile.t += dt;

      const hit = findMonsterNear(projectile.x, projectile.y, GAME.SPIRIT_CHAIN.HIT_RADIUS);
      if (hit) {
        startCombatFromThrow(hit);
        projectile = null;
        return;
      }
      if (projectile.dist >= projectile.maxDist || projectile.t > ttl || !isWalkable(projectile.x, projectile.y)) {
        // Missed — drop the chain with a brief landing impact so it reads as a miss.
        // The shockwave ring is the lingering tell (drawChainImpact); the spark burst
        // now goes through the shared fx pool (PV-T12) for natural gravity/variation.
        const ic = chainColor(def);
        impact = { x: projectile.x, y: projectile.y, color: ic, t0: k.time() };
        emit({ x: projectile.x, y: projectile.y, n: 7, color: ic, speed: 72, life: 0.38, size: 2.2, spread: Math.PI * 2, gravity: 40, drag: 1.5 });
        projectile = null;
      }
    }

    // Find a tile-bound monster whose center is within `r` world-px of (px,py).
    // Scans the 3×3 tile neighbourhood around the point (cheap).
    function findMonsterNear(px, py, r) {
      const ctx = Math.floor(px / EFFECTIVE_TILE);
      const cty = Math.floor(py / EFFECTIVE_TILE);
      const r2 = r * r;
      for (let tx = ctx - 1; tx <= ctx + 1; tx++) {
        for (let ty = cty - 1; ty <= cty + 1; ty++) {
          if (tx < 0 || tx >= mapSize || ty < 0 || ty >= mapSize) continue;
          const tile = tileMap[tx][ty];
          if (!tile?.activeMonster) continue;
          const cx = tx * EFFECTIVE_TILE + EFFECTIVE_TILE / 2;
          const cy = ty * EFFECTIVE_TILE + EFFECTIVE_TILE / 2;
          const dx = cx - px, dy = cy - py;
          if (dx * dx + dy * dy <= r2) return { tile, monster: tile.activeMonster, tx, ty };
        }
      }
      return null;
    }

    function startCombatFromThrow(hit) {
      const monster = hit.monster;
      const chainId = projectile.chainId;
      hit.tile.activeMonster = null;
      // Hydra Lash (multi): pull the nearest cluster off the map into a queue for
      // a sequential multi-capture; the fight scene chains through them.
      let queue = [];
      const def = getSpiritChain(chainId);
      if (def?.special === "multi") {
        const ET = EFFECTIVE_TILE;
        const origin = { x: hit.tx * ET + ET / 2, y: hit.ty * ET + ET / 2 };
        const span = Math.ceil(GAME.SPIRIT_CHAIN.MULTI_CHAIN_RADIUS / ET) + 1;
        const cands = [];
        for (let tx = hit.tx - span; tx <= hit.tx + span; tx++) {
          for (let ty = hit.ty - span; ty <= hit.ty + span; ty++) {
            if (tx < 0 || tx >= mapSize || ty < 0 || ty >= mapSize) continue;
            const tile = tileMap[tx][ty];
            if (!tile?.activeMonster || tile === hit.tile) continue;
            cands.push({ tile, mon: tile.activeMonster, x: tx * ET + ET / 2, y: ty * ET + ET / 2 });
          }
        }
        const picked = clusterTargets(origin, cands, GAME.SPIRIT_CHAIN.MULTI_CHAIN_RADIUS, GAME.SPIRIT_CHAIN.MULTI_MAX_TARGETS - 1);
        for (const c of picked) { c.tile.activeMonster = null; queue.push(c.mon); }
      }
      // Landing a chain grants the player initiative (first turn).
      k.go("fight", { characterId, monster, mapData, playerPos: { x: playerX, y: playerY }, elapsed, portals, initiator: "player", chainId, queue });
    }

    // Open a loot chest when the player reaches it; loot is run-found (lost on a
    // failed run, kept on extraction — see endRun stakes).
    function checkChest() {
      const chests = mapData.chests;
      if (!chests || !chests.length) return;
      const r = GAME.SPIRIT_CHAIN.PICKUP_RADIUS, r2 = r * r;
      for (let i = 0; i < chests.length; i++) {
        const c = chests[i];
        const dx = c.x - playerX, dy = c.y - playerY;
        if (dx * dx + dy * dy <= r2) {
          emit({ x: c.x, y: c.y, n: 12, color: [245, 210, 90], speed: 55, life: 0.6, size: 2.8, gravity: -30, drag: 1.5 }); // PV-T12 (SP↔MP parity): chest-open gold sparkle
          const names = [];
          for (const chainId of c.loot) {
            const def = getSpiritChain(chainId);
            if (def) { grantChain(character, chainId, def, true); names.push(def.name); }
          }
          const essGain = chestEssence(character);
          character.essence = (character.essence || 0) + essGain;
          saveCharacter(character);
          if (names.length) flashHud(`Found ${names.join(" + ")}     +${essGain} essence`);
          chests.splice(i, 1);
          return;
        }
      }
    }

    function cycleChain(dir) {
      const next = nextChainId(character.chains, character.equippedChainId, dir); // PARITY-3: shared cycle
      if (!next) return;
      character.equippedChainId = next;
      saveCharacter(character);
      const def = getSpiritChain(character.equippedChainId);
      flashHud(def ? def.name : "Chain");
    }

    function drawCircleOverlay() {
      if (elapsed < CIRCLE_START_TIME) return;
      // Storm wall (PV-T13): glowing, pulsing energy barrier at the closing edge.
      // VS-10: standardized to the MP blue scheme (was SP-red) so the same mechanic
      // reads identically across modes.
      // a11y: freeze the storm-wall breathing pulse under reduce-motion (the barrier
      // stays fully visible as a danger landmark) — parity with the MP onlineGame wall.
      const reduce = prefersReducedMotion();
      const pulse = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(k.time() * 3);
      for (let i = 3; i >= 1; i--) {
        k.drawCircle({ pos: k.vec2(circleCenterX, circleCenterY), radius: circleRadius + i * 7, fill: false, outline: { width: 4, color: k.rgb(...THEME.storm) }, opacity: (0.30 - i * 0.07) * pulse });
      }
      k.drawCircle({ pos: k.vec2(circleCenterX, circleCenterY), radius: circleRadius, fill: false, outline: { width: 3, color: k.rgb(...THEME.stormLite) }, opacity: reduce ? 0.7 : 0.55 + 0.25 * Math.sin(k.time() * 3) });
    }

    function drawMinimap() {
      // Convert screen-space coords to world-space for drawing
      const camX = playerX;
      const camY = playerY;
      const mmSize = MM_SIZE;
      // WIN-T2: anchor to the square play window's bottom-right (not the screen edge) so the
      // radar sits on the square; map fills the margins. World coords = camera-relative.
      const pw = playWindowRect(k.width(), k.height());
      const screenRight = camX - k.width() / 2 + pw.right;
      const screenBottom = camY - k.height() / 2 + pw.bottom;
      const mmX = screenRight - mmSize - 16;
      const mmY = screenBottom - mmSize - 16;
      // PT1-T24: zoom-window math is shared with the MP radar — see render/minimap.js.
      // 1× = the whole map fits the box; 2× = a player-centered window clamped to the
      // map. The shim has no clip region, so each element is culled to the window by hand.
      const Z = minimapZoom;
      const ptx = playerX / EFFECTIVE_TILE, pty = playerY / EFFECTIVE_TILE;
      const view = minimapWindow({ mapSize, mmSize, mmX, mmY, zoom: Z, playerTileX: ptx, playerTileY: pty });
      const mmScale = view.scale;
      const mmx = view.projectX;
      const mmy = view.projectY;
      const inWin = view.inWindow;

      k.drawRect({
        pos: k.vec2(mmX, mmY),
        width: mmSize,
        height: mmSize,
        color: k.rgb(...THEME.bg),
        opacity: 0.7,
      });

      const step = 2;
      for (let x = 0; x < mapSize; x += step) {
        for (let y = 0; y < mapSize; y += step) {
          // Cull cells to the window (1× keeps all; >1× tightened by one cell so a rect
          // never spills the box edge) — see render/minimap.js cellVisible.
          if (!view.cellVisible(x, y, step)) continue;
          if (voidMap[x][y] && isExplored(x, y)) { // fog of war: only reveal walked-near terrain
            // PT1-T07: real per-biome colors. The muddy per-tile averages all read
            // "green", so bias the cell toward its biome's representative tint
            // (forest=green, desert=sand, water=blue, …) while keeping a little tile
            // variation for texture — biomes become distinguishable at a glance.
            const t = tileMap[x]?.[y];
            const tcol = t ? [t.colorProfile_full_r, t.colorProfile_full_g, t.colorProfile_full_b] : [44, 74, 70];
            const tint = biomeTintAt(mapData, x, y);
            const col = tint
              ? [Math.round(tint[0] * 0.65 + tcol[0] * 0.35), Math.round(tint[1] * 0.65 + tcol[1] * 0.35), Math.round(tint[2] * 0.65 + tcol[2] * 0.35)]
              : tcol;
            k.drawRect({
              pos: k.vec2(mmx(x), mmy(y)),
              width: Math.max(1, mmScale * step),
              height: Math.max(1, mmScale * step),
              color: k.rgb(col[0], col[1], col[2]),
              opacity: 0.85,
            });
          }
        }
      }

      for (const portal of portals) {
        if (!inWin(portal.x, portal.y)) continue;
        k.drawCircle({
          pos: k.vec2(mmx(portal.x), mmy(portal.y)),
          radius: 3,
          color: k.rgb(80, 180, 255),
        });
      }

      // Chests reveal on the minimap only within a short radius (discovery).
      const cmr2 = GAME.SPIRIT_CHAIN.CHEST_MINIMAP_RADIUS ** 2;
      for (const c of (mapData.chests || [])) {
        const dx = c.x - playerX, dy = c.y - playerY;
        if (dx * dx + dy * dy > cmr2) continue;
        const ctx = c.x / EFFECTIVE_TILE, cty = c.y / EFFECTIVE_TILE;
        if (!inWin(ctx, cty)) continue;
        k.drawCircle({
          pos: k.vec2(mmx(ctx), mmy(cty)),
          radius: 2.5,
          color: k.rgb(...THEME.amber),
        });
      }

      // Storm ring: 1× only — a circle can't be clipped to the box, so at zoom it would
      // overflow. Zoom is for local detail; the storm is a whole-map feature.
      if (elapsed >= CIRCLE_START_TIME && Z === 1) {
        k.drawCircle({
          pos: k.vec2(mmx(mapSize / 2), mmy(mapSize / 2)),
          radius: (circleRadius / EFFECTIVE_TILE) * mmScale,
          fill: false,
          outline: { width: 1, color: k.rgb(...THEME.storm) }, // VS-10: storm zone = blue (matches the wall)
        });
      }

      if (inWin(ptx, pty)) {
        k.drawCircle({
          pos: k.vec2(mmx(ptx), mmy(pty)),
          radius: 3,
          color: k.rgb(...THEME.primary), // VS-2: self = teal, not red (red clashed with the storm)
        });
      }

      k.drawRect({
        pos: k.vec2(mmX, mmY),
        width: mmSize,
        height: mmSize,
        fill: false,
        outline: { width: 1, color: k.rgb(...THEME.line) },
      });

      // PT1-T24: zoom badge so the level is discoverable (only shown when zoomed in).
      if (Z !== 1) {
        k.drawText({
          text: `${Z}x`,
          pos: k.vec2(mmX + 5, mmY + 4),
          size: 11,
          font: "gameFont",
          color: k.rgb(...THEME.text),
        });
      }
    }

    // Team HP HUD (top-left, fixed position, drawn in world space offset by camera)
    function drawTeamHud() {
      const team = character.activeMonsters || [];
      // WIN-T2: anchor to the square play window's top-left (world coords, camera-relative).
      const pw = playWindowRect(k.width(), k.height());
      const hudX = playerX - k.width() / 2 + pw.x + 16;
      const hudY = playerY - k.height() / 2 + pw.y + 16;
      const barW = 80, barH = 6, slotH = 28;

      // Unified dark panel behind the whole team list so the names + HP bars read
      // cleanly over the busy cave floor (the per-row rects alone were too faint).
      if (team.length) {
        k.drawRect({ pos: k.vec2(hudX - 6, hudY - 6), width: barW + 60 + 12,
          height: team.length * slotH + 6, color: k.rgb(...THEME.bgAlt), opacity: 0.6, radius: 8 });
      }

      for (let i = 0; i < team.length; i++) {
        const mon = team[i];
        const mt = getMonsterType(mon.typeName);
        if (!mt) continue;
        const stats = getMonsterStats(mt, mon.level);
        const y = hudY + i * slotH;
        const hpRatio = mon.currentHealth / stats.health;

        k.drawRect({
          pos: k.vec2(hudX, y),
          width: barW + 60,
          height: slotH - 4,
          color: k.rgb(...THEME.bg),
          opacity: 0.5,
          radius: 3,
        });

        // Element-identity dot (parity with the MP team cards — PV-T8/P10),
        // dimmed when the monster is down — so a hurt reserve is identifiable.
        const fainted = mon.currentHealth <= 0;
        const ec = elementColor(mt.element);
        k.drawCircle({ pos: k.vec2(hudX + 6, y + 8), radius: 3.5, color: k.rgb(ec[0], ec[1], ec[2]), opacity: fainted ? 0.3 : 0.95 });
        const name = (mon.name || mon.typeName);
        const label = name.length > 9 ? name.slice(0, 8) + "…" : name;
        k.drawText({
          text: label,
          pos: k.vec2(hudX + 13, y + 3),
          size: 10,
          font: "gameFont",
          color: fainted ? k.rgb(...THEME.danger) : k.rgb(...THEME.textBody),
        });

        // HP bar background
        k.drawRect({
          pos: k.vec2(hudX + 60, y + 5),
          width: barW,
          height: barH,
          color: k.rgb(...THEME.line),
          radius: 2,
        });

        // HP bar fill
        const hpColor = hpRatio < 0.25 ? k.rgb(...THEME.danger)
          : hpRatio < 0.5 ? k.rgb(...THEME.warn)
          : k.rgb(...THEME.success);
        k.drawRect({
          pos: k.vec2(hudX + 60, y + 5),
          width: Math.max(0, barW * hpRatio),
          height: barH,
          color: hpColor,
          radius: 2,
        });
        // Critical-HP urgency pulse (parity with MP): a throbbing bright wash over a
        // near-empty HP fill so a dying monster's bar visibly pulses. reduce-motion safe.
        if (hpRatio > 0 && hpRatio < 0.25 && !prefersReducedMotion()) {
          k.drawRect({
            pos: k.vec2(hudX + 60, y + 5),
            width: Math.max(0, barW * hpRatio),
            height: barH,
            color: k.rgb(255, 255, 255),
            opacity: 0.12 + 0.22 * (0.5 + 0.5 * Math.sin(k.time() * 8)),
            radius: 2,
          });
        }
      }
    }

    // Equipped-chain HUD (bottom-left): icon, name, throws left, durability.
    // Drawn in world space offset by the camera, matching drawTeamHud.
    function drawChainHud() {
      const chainState = getEquippedChainState();
      const def = chainState && getSpiritChain(chainState.chainId);
      // WIN-T2: anchor to the square play window's bottom-left (world coords, camera-relative).
      const pw = playWindowRect(k.width(), k.height());
      const hudX = playerX - k.width() / 2 + pw.x + 16;
      const hudY = playerY - k.height() / 2 + pw.bottom - 64;

      k.drawRect({ pos: k.vec2(hudX, hudY), width: 188, height: 48, color: k.rgb(...THEME.bg), opacity: 0.5, radius: 4 });

      // Sprint stamina bar just above the chain panel.
      const sr = stamina / GAME.SPRINT.STAMINA_MAX;
      k.drawRect({ pos: k.vec2(hudX, hudY - 10), width: 188, height: 5, color: k.rgb(...THEME.line), radius: 2 });
      k.drawRect({ pos: k.vec2(hudX, hudY - 10), width: Math.max(0, 188 * sr), height: 5, color: sr > 0.3 ? k.rgb(...THEME.teal) : k.rgb(...THEME.warn), radius: 2 });

      if (def) {
        const col = chainColor(def);
        drawSpiritChainModel(k, { x: hudX + 22, y: hudY + 24, color: col, t: k.time(), scale: 1 });
        const throws = chainState.throwCount == null ? "∞" : String(chainState.throwCount);
        k.drawText({ text: def.name, pos: k.vec2(hudX + 44, hudY + 6), size: 12, font: "gameFont", color: k.rgb(...THEME.text) });
        k.drawText({ text: `Throws ${throws}   Charges ${chainState.durability}`, pos: k.vec2(hudX + 44, hudY + 26), size: 11, font: "gameFont", color: k.rgb(...THEME.textBody) });
      } else {
        k.drawText({ text: "No chain", pos: k.vec2(hudX + 12, hudY + 18), size: 12, font: "gameFont", color: k.rgb(...THEME.textMut) });
      }

      // Transient feedback line above the chain panel.
      if (k.time() < flashUntil && flashMsg) {
        k.drawText({ text: flashMsg, pos: k.vec2(hudX, hudY - 18), size: 13, font: "gameFont", color: k.rgb(...THEME.amber) });
      }
    }

    // Throw the equipped chain along the current facing; cycle equipped chain.
    // PT1-T06: Space is the primary throw key; Q kept as a legacy alias.
    k.onKeyPress("space", () => { if (!paused) tryThrowChain(); });
    k.onKeyPress("q", () => { if (!paused) tryThrowChain(); });
    k.onKeyPress("[", () => { if (!paused) cycleChain(-1); });
    k.onKeyPress("]", () => { if (!paused) cycleChain(1); });
    k.onKeyPress("m", () => { if (!paused) toggleMinimapZoom(); }); // PT1-T24: cycle minimap zoom

    // Pause menu
    k.onKeyPress("escape", () => {
      if (paused) {
        resumeGame();
      } else {
        showPauseMenu();
      }
    });

    function showPauseMenu() {
      paused = true;
      k.destroyAll("pauseUI");

      k.add([
        k.rect(k.width(), k.height()),
        k.pos(0, 0),
        k.color(...THEME.bgAlt), // theme-tinted scrim (was pure black)
        k.opacity(0.82),         // stronger so the busy floor doesn't bleed through
        k.fixed(),
        k.z(200),
        "pauseUI",
      ]);

      // Themed PAUSED title (no more pure-white literal) + three themed buttons that
      // inherit the design system's shadow / top sheen / hover glow / SFX / haptics
      // via addButton — they used to be flat rects with hardcoded RGB and no feedback.
      addLabel(k, { x: k.width() / 2, y: k.height() / 2 - 80, text: "PAUSED",
        size: 48, color: THEME.text, fixed: true, tag: "pauseUI" });

      addButton(k, {
        x: k.width() / 2, y: k.height() / 2, w: 220, h: 48, text: "Resume", size: 22,
        fill: THEME.primary, textColor: THEME.textInv, fixed: true, tag: "pauseUI",
        onClick: () => resumeGame(),
      });

      // Sound On/Off — parity with the MP pause overlay (a mute toggle reachable
      // without leaving the run). Reads/writes the shared persisted mute (tq_muted).
      const soundBtn = addButton(k, {
        x: k.width() / 2, y: k.height() / 2 + 64, w: 220, h: 48,
        text: isMuted() ? "Sound: Off" : "Sound: On", size: 22,
        fill: THEME.surface, textColor: THEME.text, fixed: true, tag: "pauseUI",
        onClick: () => {
          const m = toggleMuted();
          soundBtn.label.text = m ? "Sound: Off" : "Sound: On";
          if (!m) sfx("click"); // confirm-tick only when turning sound back ON
        },
      });

      addButton(k, {
        x: k.width() / 2, y: k.height() / 2 + 128, w: 220, h: 48, text: "Quit Run", size: 22,
        fill: THEME.danger, textColor: THEME.textInv, fixed: true, tag: "pauseUI",
        onClick: () => {
          paused = false;
          k.destroyAll("pauseUI");
          endRunStakes(false); // abandoning the run forfeits run-found chains
          k.go("lobby", { characterId });
        },
      });
    }

    function resumeGame() {
      paused = false;
      k.destroyAll("pauseUI");
    }

  });
}
