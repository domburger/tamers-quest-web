import { net } from "../netClient.js";
import { GAME } from "../engine/schemas.js";
import { generateMap, biomeTintAt, biomeNameAt, isWalkable, edgeClearX, edgeClearY } from "../engine/mapgen.js";
import { sprintMult, sprintingNow, tickStamina } from "../engine/movement.js"; // shared speed + sprint-gate rule + stamina integrator for client-side prediction (#10, TQ-382)
import { getSpiritChain, cleanAttackName } from "../data.js";
import { getMonsterType } from "../engine/gamedata.js"; // team-card element lookup (PV-T8)
import { nextChainId } from "../engine/inventory.js"; // PARITY-3: shared chain-cycle (SP↔MP)
import { markDiscovered, markEncountered } from "../engine/discovered.js"; // PV-T15 first-catch milestone + wild-encounter tracking (bestiary "seen" state)
import { objectiveText } from "../ui/objective.js"; // PT2-T10: persistent objective HUD (SP↔MP shared)
import { drawBiomeChip } from "../ui/biomeHud.js"; // PT1-T18: current-biome + speed HUD chip (shared SP↔MP)
import { drawCharacter } from "../render/character.js";
import { getSkin, getEquippedSkin, getEquippedSkinId, drawChainGlyph, tierColor } from "../render/chainCosmetics.js"; // CN-12: per-player skins; TQ-143: chain glyph with tier-coloured centre dot; SC-tier: tierColor for the active-slot tier readout
import { getEquippedCharacterSkin, getEquippedCharacterSkinId, getCharacterSkin } from "../render/characterCosmetics.js"; // self's character skin in MP (accent + cloak + model); resolve rivals' model from their charId
import { drawSpiritChainProjectile, drawChest, chainColor } from "../render/spiritchain.js";
import { drawBattleStage, BATTLE_INTRO_DURATION } from "../render/battleStage.js"; // Pokémon-style battle screen + spirit-chain throw → spawn cinematic
import { drawMonster, drawMonsterIcon } from "../render/monster.js"; // drawMonster: standardized walk/attack on the baked sprite; drawMonsterIcon: TQ-397 combat-row portrait that also rasterizes generated (html-model) monsters
import { createHtmlMonsterOverlay } from "../render/htmlMonsterOverlay.js"; // TQ-262: live-DOM render path for monsters carrying an html model (dormant until any do)
import { drawMonsterDetail } from "../ui/monsterDetail.js"; // TQ-125: shared monster-detail popup (epic TQ-87)
import { ATTACK_DURATION } from "../systems/monsterAnim.js"; // length of the one-shot combat attack lunge
import { drawTiles, makeTileCache } from "../render/tiles.js";
import { emit, emitText, updateFx, drawFx, drawFxScreen, clearFx } from "../render/fx.js";
import { drawPlayWindow, playWindowRect } from "../render/playWindow.js"; // square play-window frame + geometry (user design 2026-06-08)
import { addShake, updateShake, shakeOffset, clearShake } from "../render/shake.js"; // PV-A5 screen shake
import { drawPortal, drawExtractFlash } from "../render/portal.js";
import { minimapWindow, minimapSize, nextMinimapZoom } from "../render/minimap.js"; // PT1-T24: shared zoom-window math + size rule + zoom-level cycle (SP↔MP)
import { hudLayout } from "../render/hudLayout.js"; // HUD-OUT: place HUD clusters in the gutters OUTSIDE the square (SP↔MP shared)
import { drawHubPanel } from "../render/hubPanel.js"; // task: show the lobby's identity+inventory panel in the cave too (left gutter)
import { getCharacter } from "../storage.js"; // local character slot → identity (name/level) for the cave lobby panel
import { initAudio, toggleMuted, isMuted, sfx, haptic } from "../systems/audio.js";
import { gamepadMove, gamepadPressed, BTN } from "../systems/gamepad.js";
import { getBindings } from "../systems/keybinds.js"; // TQ-458: remappable keyboard controls (defaults reproduce the old hard-coded keys)
import { safeInsetsDesign } from "../systems/safearea.js"; // MB-4: keep touch HUD off the notch/home-bar (shared design-unit helper)
import { touchPrimary, drawJoystick, drawTouchButton, JOY_R as JOY_RADIUS } from "../systems/inputMode.js"; // mobile-only on-screen controls + standardized renderers
import { prefersReducedMotion } from "../systems/a11y.js"; // a11y: freeze decorative monster bob
import { accentColor, THEME, hpColor, drawButton, drawPillFill, inRect } from "../ui/theme.js";

// HUD chrome routed through the design system (PV-A1). Only neutral *chrome*
// (plain HUD/overlay text, panel + scrim fills, frame outlines) is themed here —
// procedural art (minimap blips, storm rings, FX, sprites, shadows), semantic
// accents (gold titles, win/lose, danger alerts, damage numbers, bar fills) and
// the self-contained touch/pause widgets keep their own intentional colors.
const UI = {
  text:  THEME.text,     // primary HUD / overlay text (was ad-hoc white)
  body:  THEME.textBody,  // secondary HUD text
  mut:   THEME.textMut,   // dim section labels
  panel: THEME.bgAlt,     // HUD panel + overlay scrim fill (near-black violet)
  track: THEME.surface2,  // recessed bar track
  line:  THEME.line,       // panel / frame outline
  amber: THEME.amber, danger: THEME.danger, primary: THEME.primary,
};

// Online round view: the seeded map (regenerated client-side from the server
// seed) drawn as culled, biome-colored tiles, plus server-authoritative players.
// WASD -> server (~20Hz). Single-player game scene is unchanged.
export default function onlineGameScene(k) {
  k.scene("onlineGame", (args = {}) => {
    let map = args.map || null;
    // SP/MP unify: after a run, return to where the run was launched from (the walkable camp HUB
    // passes backScene:"hub"; legacy callers default to "lobby") — KEEP the connection so the hub
    // reuses the session and reads the now-updated authoritative profile. A lost connection or a
    // missing characterId (legacy entry) falls back to the title.
    function exitAfterRun() {
      if (args.characterId && net.state.connected) { k.go(args.backScene || "lobby", { characterId: args.characterId }); return; }
      net.close(); k.go("start");
    }
    initAudio(net); // P8-T6: wire procedural SFX to net events (idempotent)
    net.setSkin(getEquippedSkinId()); // CN-12: tell the server our equipped chain cosmetic so rivals see it
    net.setCharSkin(getEquippedCharacterSkinId()); // tell the server our character body-model skin so rivals render the right figure
    // Defensive: if entered without a prebuilt map, regenerate it from the seed.
    if (!map && net.state.seed != null) {
      generateMap(null, net.state.seed, net.state.roundBiomes, net.state.roundComp).then((m) => { map = m; }).catch(() => {}); // TQ-365/367: same biome set + tile composition as the server
    }
    const tileCache = makeTileCache(); // P-floortile: textured floor, cached per tile type
    k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(...THEME.bg), k.fixed(), k.z(-10)]); // was raw [10,14,18] blue-grey; THEME.bg is the violet base

    // Fog of war (PT1-T08, headline demand) — client-side, mirrors SP `game.js`. The
    // map hides until you walk near it; `explored` holds revealed tile keys for the
    // round, the floor + minimap gate on it. No server change (each client tracks its own).
    const explored = new Set();
    const FOG_REVEAL = 6; // tiles revealed around the player (< the on-screen radius)
    const fogKey = (x, y) => x * 100000 + y;
    const isExplored = (x, y) => explored.has(fogKey(x, y));
    // Perf: the revealed disc only changes when the player crosses a tile boundary, so skip the
    // 169-cell re-add on every frame the player stays in the same tile (the common case while
    // standing still or moving sub-tile). Result is identical — those keys are already in the set.
    let lastFogTx = null, lastFogTy = null;
    function revealAround() {
      const self = net.state.self; if (!self) return;
      const ptx = Math.floor(self.x / GAME.EFFECTIVE_TILE), pty = Math.floor(self.y / GAME.EFFECTIVE_TILE);
      if (ptx === lastFogTx && pty === lastFogTy) return;
      lastFogTx = ptx; lastFogTy = pty;
      const r2 = FOG_REVEAL * FOG_REVEAL;
      for (let dx = -FOG_REVEAL; dx <= FOG_REVEAL; dx++)
        for (let dy = -FOG_REVEAL; dy <= FOG_REVEAL; dy++)
          if (dx * dx + dy * dy <= r2) explored.add(fogKey(ptx + dx, pty + dy));
    }

    // TQ-96 (Dominik's TQ-117 decision ≈ 4:3): the play window is a touch WIDER than square
    // while roaming, but stays SQUARE during combat (the fight UI is laid out for a square).
    // Read the live combat flag at call time so every play-window / HUD site below picks the
    // right aspect per frame (combat starts/ends mid-scene without a re-init).
    // TQ-494/501: the fight screen uses the SAME 4:3 play window as the overworld (was a forced
    // square during combat, which read as a narrower screen than every other view). The combat
    // stage + panel below now lay out across the full 4:3 width (see W / iw = pw.w).
    const winAspect = () => 4 / 3;
    // WIN-T2: anchor the corner/edge HUD labels to the square play window (not the raw
    // canvas) so they sit on the square in every aspect ratio. In landscape pwTop insets
    // them to the square's left edge; objective stays centered on the square.
    const pwTop = playWindowRect(k.width(), k.height(), { maxAspect: winAspect() });
    // HUD-OUT: the shim does NOT restart gameplay scenes on resize (it'd reset the run),
    // so the retained HUD labels are re-anchored to their gutter slots every frame in the
    // onUpdate below (hudSlots) rather than baked once here.
    // Persistent HUD text — tokenized through the UI map declared above (was raw
    // 255,255,255 / 210,210,220 / 150,210,235 — the audit's HIGH item: chrome that
    // had a token but bypassed it).
    const info = k.add([
      k.text("", { size: 14, font: "gameFont" }),
      k.pos(pwTop.x + 12, pwTop.y + 12), k.color(...UI.text), k.fixed(), k.z(100),
    ]);
    const hint = k.add([
      k.text("Move: WASD or drag     Throw chain: Space     Cycle chain: [ ]     Leave: ESC     M mute", { size: 12, font: "gameFont" }),
      k.pos(pwTop.x + 12, pwTop.bottom - 24), k.color(...UI.body), k.fixed(), k.z(100),
    ]);
    // PT2-T10 (#9): a persistent objective line so a new player always knows the
    // goal — from "catch & loot" early to "extract" once the storm closes. The
    // objective strings are long (50–76 chars); in landscape they live in a narrow
    // (~280px) side-gutter slot, so they MUST word-wrap or they clip off-screen left
    // and bleed over the play window. The shim's retained-text `.width` setter SCALES
    // (displayWidth), it doesn't re-wrap, so we bake the wrap width at creation and
    // recreate the label when the slot width changes (orientation / resize) — cheap,
    // and only a handful of times in a run.
    let objectiveW = 0;
    const makeObjective = (x, y, w) =>
      k.add([
        k.text("", { size: 13, font: "gameFont", width: w || undefined, align: "center" }),
        k.pos(x, y), k.anchor("center"), k.color(...THEME.teal), k.fixed(), k.z(100),
      ]);
    let objective = makeObjective(pwTop.cx, pwTop.y + 34, 0);

    // Smooth render positions (interpolate toward authoritative snapshots).
    const lerp = (a, b, t) => a + (b - a) * t;
    // TQ-478 (RT-NET 4/5): render remote entities INTERP_DELAY in the past, interpolated between the two
    // buffered snapshots bracketing that time. This is the classic entity-interpolation jitter buffer —
    // a late/early packet just shortens/lengthens the buffer lead instead of stuttering, and (unlike the
    // old chase-the-latest extrapolation) there's no overshoot-then-snap-back. Past the newest sample we
    // extrapolate from the last segment for at most EXTRAP_CAP, then hold. Rendering remote players in the
    // past is also exactly what server lag-compensation (TQ-479) rewinds to, so this sets combat up to be
    // fair. Velocity for the walk anim/facing is derived from the active segment.
    const INTERP_DELAY = 0.12; // s — render remote entities this far in the past (RT-NET 1/5); window.__tqInterpDelay overrides for QA
    // Samples kept per entity. MUST span INTERP_DELAY + jitter so the jitter buffer never runs dry (which
    // snaps/stutters remote entities). This is an ENTRY count, so its TIME span shrinks as the snapshot rate
    // rises: at the old 15Hz, 8 samples ≈ 0.53s (ample); but TQ-504/506 raised the rate to 60Hz where 8 ≈
    // 0.13s — barely over the 0.12s delay, so any packet jitter starved it. 24 ≈ 0.4s at 60Hz (and more at
    // lower rates) — comfortable headroom across the whole clamped 1..60Hz range. (sampleBuf's bracket search
    // walks back only to rt, so a deeper buffer doesn't cost more per frame.)
    const BUF_MAX = 24;
    const EXTRAP_CAP = 0.10;   // s — max extrapolation past the newest sample before holding
    const SNAP_DIST2 = (GAME.BASE_SPEED * 1.7 * 0.5) ** 2; // jump beyond ~0.5s of sprint between snapshots = teleport/respawn → snap (clear buffer), don't glide across it
    const interpDelay = () => { try { const v = window.__tqInterpDelay; return typeof v === "number" && v >= 0 ? v : INTERP_DELAY; } catch { return INTERP_DELAY; } };
    // Append a fresh authoritative sample (client-clock timestamp) to an entity's jitter buffer; snap on a teleport.
    const pushSample = (r, t, x, y) => {
      const last = r.buf[r.buf.length - 1];
      if (last) { const dx = x - last.x, dy = y - last.y; if (dx * dx + dy * dy > SNAP_DIST2) r.buf.length = 0; }
      r.buf.push({ t, x, y });
      if (r.buf.length > BUF_MAX) r.buf.shift();
    };
    // Set r.x/r.y (+ r.vx/r.vy, for the walk anim) from the buffer at render time rt. No-op with no samples.
    const sampleBuf = (r, rt) => {
      const b = r.buf, n = b.length;
      if (!n) return;
      if (n === 1 || rt <= b[0].t) { r.x = b[0].x; r.y = b[0].y; r.vx = 0; r.vy = 0; return; }
      const last = b[n - 1];
      if (rt >= last.t) { // starved → extrapolate the last segment briefly, then hold
        const prev = b[n - 2], seg = Math.max(0.001, last.t - prev.t);
        const vx = (last.x - prev.x) / seg, vy = (last.y - prev.y) / seg, ahead = Math.min(rt - last.t, EXTRAP_CAP);
        r.x = last.x + vx * ahead; r.y = last.y + vy * ahead; r.vx = vx; r.vy = vy; return;
      }
      let i = n - 2; // find the segment [i,i+1] bracketing rt
      while (i > 0 && b[i].t > rt) i--;
      const a = b[i], c = b[i + 1], seg = Math.max(0.001, c.t - a.t), f = (rt - a.t) / seg;
      r.x = a.x + (c.x - a.x) * f; r.y = a.y + (c.y - a.y) * f;
      r.vx = (c.x - a.x) / seg; r.vy = (c.y - a.y) / seg;
    };
    const selfRender = { x: net.state.self.x, y: net.state.self.y };
    // DEV-only probe: the live PREDICTED position vs the authoritative snapshot, so a headless harness
    // can measure reconciliation rubberbanding (backward jumps) under injected latency. Stripped from prod.
    if (import.meta.env && import.meta.env.DEV) { try { window.__selfRender = () => ({ x: selfRender.x, y: selfRender.y, sx: net.state.self.x, sy: net.state.self.y, rtt: net.state.rtt }); } catch { /* no window */ } }
    const othersRender = new Map(); // id -> { x, y, vx, vy, buf:[{t,x,y}], moving, dir } (TQ-478 interpolation jitter buffer)
    let lastPlayersRef = null; // ref of the last snapshot's players array → detect a fresh snapshot
    let liveGen = 0; // per-frame epoch for mark-and-sweep liveness of the render maps (replaces per-frame Set allocs)
    const monsterRender = new Map(); // id -> { x, y, vx, vy, buf:[{t,x,y}], bx, by, moving, dir } — interpolation jitter buffer (TQ-478) + derives walk anim/facing (same scheme as rivals)
    let lastMonstersRef = null;
    const projRender = new Map(); // projectile id -> { x, y, vx, vy, chainId } (extrapolated)
    const ents = []; // reused per frame for the Y-sorted draw list (cleared, not reallocated) — avoids a fresh array + growth reallocs each frame
    const byY = (a, b) => a.y - b.y; // stable comparator (hoisted out of the per-frame draw so it isn't reallocated)
    // TQ-262: live-DOM monster overlay. Monsters whose TYPE carries a renderable html model render as
    // pooled DOM nodes synced to their on-screen position; everything else keeps the canvas sprite path.
    // Collected per frame here, synced after the actor draw gate. Dormant until a monster ships a model.
    const htmlEnts = [];
    const combatHtmlEnts = []; // TQ-262: the (≤2) combatants that render via the DOM overlay during a fight
    const htmlOverlay = createHtmlMonsterOverlay(k);
    k.onSceneLeave(() => htmlOverlay.destroy()); // remove the overlay div + pooled nodes when leaving the round
    const portalSeen = new Map(); // portal "x,y" -> first-seen time (drives the rise animation)
    let selfMoving = false;
    let stepAcc = 0; // throttle for footstep dust while roaming
    let stormFxAcc = 0; // throttle for ambient storm particles while outside the safe zone (PV-T13)
    let prevLevels = new Map(); // monsterId -> last level, for level-up SFX (state diff)
    let prevChests = null; // last frame's chests, for chest-open SFX (state diff); null = first frame
    let prevChainIds = null; // owned chain ids last frame, for loot-naming floaters (null = first frame)
    let prevChainsRef = null; // last frame's net.state.chains array REF — diff only when the snapshot replaced it
    const NO_CHAINS = []; // shared empty so an absent chains array doesn't churn the ref gate (new [] each frame)
    let selfDir = { x: 0, y: 1 }; // last heading, for character facing
    // TQ-458: snapshot the player's key bindings ONCE at scene start (defaults if unset). Read here
    // — never per frame — so movement stays free of localStorage reads (a11y.js perf lesson); a
    // rebind in settings applies on the next scene load, same as the other model/menu prefs.
    const KB = getBindings();
    const anyDown = (action) => { const ks = KB[action]; for (let i = 0; i < ks.length; i++) if (k.isKeyDown(ks[i])) return true; return false; };
    const bindPress = (action, handler) => { for (const key of KB[action]) k.onKeyPress(key, handler); };
    // P8-T8: first-run onboarding overlay — shown once (localStorage), dismissed by
    // moving or tapping. An overlay in this scene (not a new scene — main.js is @phaser's).
    let onboard = false;
    try { onboard = !localStorage.getItem("tq_onboarded"); } catch {}
    let onboardT = 0;
    const dismissOnboard = () => { if (!onboard) return; onboard = false; try { localStorage.setItem("tq_onboarded", "1"); } catch {} };
    function drawOnboarding() {
      onboardT += k.dt();
      const W = k.width(), H = k.height(), cx = W / 2;
      // Near-opaque: the HUD clusters are hidden during onboarding, but the WORLD entities
      // (rival nameplates, wild monsters, chests) are game objects that still render — at 0.86
      // their bright bits bled through the tutorial. 0.96 keeps a faint sense of the world
      // without the distracting bleed.
      k.drawRect({ pos: k.vec2(0, 0), width: W, height: H, color: k.rgb(...UI.panel), opacity: 0.96, fixed: true });
      k.drawText({ text: "How to Play", pos: k.vec2(cx, H * 0.18), size: 40, font: "gameFont", anchor: "center", color: k.rgb(...UI.amber), fixed: true }); // was raw [245,215,120] — drift from THEME.amber
      // Accent rule under the title — the same header signature every menu/station title uses
      // (soft glow band + crisp hairline), so the first-run screen reads as part of the same family.
      const obRuleY = H * 0.18 + 33;
      k.drawRect({ pos: k.vec2(cx, obRuleY), width: 232, height: 7, radius: 4, anchor: "center", color: k.rgb(...UI.amber), opacity: 0.16, fixed: true });
      k.drawRect({ pos: k.vec2(cx, obRuleY), width: 220, height: 2, radius: 1, anchor: "center", color: k.rgb(...UI.amber), opacity: 0.9, fixed: true });
      // MB-11: hints match the actual controls — touch gestures on touch devices,
      // keys on desktop (showing "WASD/Q/1-4/ESC" to a phone player was confusing).
      const lines = TOUCH ? [
        "Move — drag the left side of the screen",
        "Sprint — push the joystick all the way out (drains stamina)",
        "Throw a spirit chain — tap the Throw button to catch wild monsters",
        "In a fight — tap an attack, or Catch / Flee",
        "Rivals — other tamers share this run; beat one to take their team, or lose yours",
        "Extract — reach a glowing portal before the storm closes in",
        "The stakes — die and you lose the spirit chains you found this run",
        "Pause / Leave — tap the pause button (top)",
      ] : [
        "Move — WASD or drag the left side of the screen",
        "Sprint — hold Shift to move faster (drains stamina)",
        "Throw a spirit chain — Space (aimed at your mouse) to catch wild monsters",
        "In a fight — 1-4 attack    C catch    F flee",
        "Rivals — other tamers share this run; beat one to take their team, or lose yours",
        "Extract — reach a glowing portal before the storm closes in",
        "The stakes — die and you lose the spirit chains you found this run",
        "Leave — ESC",
      ];
      // Narrow phone: the long instruction lines wrap, but the fixed 36px spacing made them
      // overlap into an unreadable jumble. Flow the y by each entry's wrapped line count.
      if (W < 480) {
        const wrapW = W - 28, sz = 14, lh = sz + 6;
        const nlines = (txt) => Math.max(1, Math.ceil((txt.length * sz * 0.52) / wrapW));
        let ly = H * 0.23;
        for (const ln of lines) {
          k.drawText({ text: ln, pos: k.vec2(cx, ly), size: sz, font: "gameFont", anchor: "top", width: wrapW, align: "center", color: k.rgb(...UI.text), fixed: true });
          ly += nlines(ln) * lh + 8;
        }
      } else {
        lines.forEach((ln, i) => k.drawText({ text: ln, pos: k.vec2(cx, H * 0.32 + i * 36), size: 18, font: "gameFont", anchor: "center", width: W - 140, color: k.rgb(...UI.text), fixed: true }));
      }
      const pulse = prefersReducedMotion() ? 0.9 : 0.55 + 0.45 * Math.sin(k.time() * 4); // a11y: static hint under reduce-motion
      k.drawText({ text: "move or tap to begin", pos: k.vec2(cx, H * 0.82), size: 18, font: "gameFont", anchor: "center", color: k.rgb(...UI.text), opacity: pulse, fixed: true });
    }
    let awaiting = false; // true while a combat turn is being resolved (AI ~1-2s)
    let lastLogLen = 0;
    // Combat ATTACK animation (standard idle/walk/attack clip from systems/monsterAnim): k.time()
    // when each side's one-shot lunge began (-1 = not attacking). Set when a player's attack
    // resolves; the active monster lunges, the enemy counter-lunges a beat later.
    let activeAtkT0 = -1, enemyAtkT0 = -1;
    // TQ-125: in-combat monster inspect — tap the enemy / your-monster header row to open the shared
    // monster-detail popup (epic TQ-87). `combatInspect` is "enemy" | "active" | null; `combatRowRects`
    // is set each frame from the drawn header geometry so pointerDown can hit-test the rows.
    let combatInspect = null, combatRowRects = null;

    // ── Onscreen controls (mobile only) ──
    // touchPrimary() is true ONLY when a finger is the primary input (phone/tablet) — NOT on a
    // touchscreen laptop/desktop, which keeps mouse-drag + keyboard and shows no virtual stick.
    const TOUCH = touchPrimary(k);
    // MB-4: keep the touch controls clear of the notch / rounded corners / home-bar.
    // env(safe-area-inset-*) is in CSS px; the canvas is uniformly FIT-scaled (design
    // height = k.height()), so 1 design unit = canvasCssHeight/k.height() CSS px —
    // divide to convert insets into the design space the HUD is laid out in. Cached
    // (DOM reads aren't free) + refreshed on a throttle in onUpdate; computed only on
    // touch devices, so desktop stays all-zero and nothing moves.
    let safeInset = { top: 0, right: 0, bottom: 0, left: 0 };
    const recomputeSafeInset = () => { safeInset = safeInsetsDesign(k); }; // shared helper (design-unit notch/home-bar insets)
    if (TOUCH) recomputeSafeInset();
    // HUD-OUT: the shared gutter layout — every HUD cluster sits OUTSIDE the square. Call
    // per frame (resize/orientation-safe); draw + tap-hit-test read the SAME slots.
    const hudSlots = () => hudLayout(k.width(), k.height(), { inset: safeInset, maxAspect: winAspect() });
    const COMBAT_H = 264; // taller panel: room for larger, touch-friendly action buttons

    // Task: bring the LOBBY's left-side identity + inventory panel (drawHubPanel — character/gold/
    // team/chains/items) into the cave, so your character + resources stay visible during a run. The
    // panel reads team/gold/chains/items from net.state while joined; `character` supplies the local
    // identity (name/level). Shown only in LANDSCAPE (the wide side gutter has room for the tall stack)
    // while roaming — portrait keeps the existing compact clusters, and it's hidden behind the
    // combat/result/onboarding/menu overlays. When it's up, the gutter team+chain mini-clusters are
    // suppressed (the panel already includes them) and the gutter objective is moved onto the square
    // edge (the panel fills the gutter where the objective used to sit).
    const lobbyChar = (() => { try { return getCharacter(args.characterId); } catch { return null; } })()
      || { name: net.state.nickname || "Tamer", level: 1, isGuest: false };
    const lobbyPanelActive = () => hudSlots().orientation === "landscape"
      && !net.state.combat && !net.state.roundResult && !onboard && !menuOpen && net.state.connected;
    const THROW_R = 46; // touch THROW button (right thumb) — mobile spirit-chain throw
    const throwBtnC = () => { const t = hudSlots().throwBtn; return k.vec2(t.x, t.y); }; // HUD-OUT: gutter slot
    const SWAP_R = 30; // touch chain-swap button (TQ-488) — cycles the 3-slot loadout
    const swapBtnC = () => { const s = hudSlots().swapBtn; return s ? k.vec2(s.x, s.y) : k.vec2(-999, -999); };
    // TQ-487: drag the THROW button to aim. While a finger holds the button, this tracks the
    // aim direction (button-center → finger); release throws that way (or along heading if it was a tap).
    let throwAim = null; // { id, dir:{x,y}, dragged:bool } | null
    // MB-11: touch pause button — the pause/leave menu was ESC-only, so touch players had
    // no way to pause or leave a round. The menu itself is already touch-operable (see
    // pointerDown's menuBtns hit-test).
    const pauseBtnRect = () => { const p = hudSlots().pause; return [p.x, p.y, p.w, p.h]; }; // HUD-OUT: gutter slot
    // ESC pause/settings overlay (Resume · Sound · Leave). ESC no longer instantly
    // quits the round (was accidental round-loss). The world keeps running server-side.
    let menuOpen = false;
    let leaveArm = false; // two-step confirm on "Leave round" — abandoning loses the run (SP-parity with 9dc80a8)
    let extractFlashT = null; // extraction climax flash start (PV juice, MP parity with SP)
    let extractSfxDone = false;
    const menuBtns = () => {
      const cx = k.width() / 2, bw = 280, bh = 56, gap = 16, y0 = k.height() / 2 - 64;
      return [
        { rect: [cx - bw / 2, y0, bw, bh], label: "Resume", act: () => { menuOpen = false; leaveArm = false; } },
        { rect: [cx - bw / 2, y0 + (bh + gap), bw, bh], label: `Sound: ${isMuted() ? "Off" : "On"}`, act: () => { toggleMuted(); leaveArm = false; } },
        // Two-step: first tap arms (abandoning a round loses the run), second confirms.
        { rect: [cx - bw / 2, y0 + (bh + gap) * 2, bw, bh], label: leaveArm ? "Confirm — lose this run" : "Leave round", danger: leaveArm,
          act: () => { if (!leaveArm) { leaveArm = true; return; } net.close(); k.go("start"); } },
      ];
    };

    // Shared neutral accent for monster slots + attack pills (theme.accentColor — one source of truth).
    const elemColor = accentColor;
    // hpColor is now the shared theme helper (was a local raw-RGB copy w/ a 0.2 threshold) so
    // the in-round team/HP bars match every menu HP bar — palette + thresholds in one place.
    // Rounded stat bar in fixed/overlay space, with an optional right-aligned label.
    function drawBar(x, y, w, h, ratio, col, label, pulseLow = false) {
      const r = Math.max(0, Math.min(1, ratio || 0));
      k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius: h / 2, color: k.rgb(...UI.track), fixed: true });
      if (r > 0) {
        const fw = Math.max(h, w * r);
        k.drawRect({ pos: k.vec2(x, y), width: fw, height: h, radius: h / 2, color: k.rgb(col[0], col[1], col[2]), fixed: true });
        // Critical-HP urgency: a pulsing bright wash over a near-empty HP fill so it
        // visibly throbs — the red colour alone is easy to miss on a busy frame.
        // Opt-in (HP bars only, not energy/stamina); frozen under reduce-motion.
        if (pulseLow && r <= 0.25 && !prefersReducedMotion()) {
          k.drawRect({ pos: k.vec2(x, y), width: fw, height: h, radius: h / 2, color: k.rgb(255, 255, 255), opacity: 0.12 + 0.22 * (0.5 + 0.5 * Math.sin(k.time() * 8)), fixed: true });
        }
      }
      if (label) {
        // Dark shadow under the number so it stays legible on a bright (full green) fill — white
        // text on the green bar was low-contrast. Fixes every drawBar caller (team HUD + combat).
        k.drawText({ text: label, pos: k.vec2(x + w - 5, y + h / 2 + 1), size: 11, font: "gameFont", anchor: "right", color: k.rgb(...UI.panel), opacity: 0.75, fixed: true });
        k.drawText({ text: label, pos: k.vec2(x + w - 6, y + h / 2), size: 11, font: "gameFont", anchor: "right", color: k.rgb(...UI.text), fixed: true });
      }
    }
    // Prettify a status label for display: camelCase / snake_case → Title Case, so an
    // AI-invented status (e.g. "defenseDown") reads as "Defense Down" while canonical ones
    // (Burn, Stun, …) are unchanged.
    const prettyStatus = (s) => String(s || "")
      .replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
    // One combatant's header (element badge + name + Lv + status) and HP/energy bars.
    // `side`: "enemy" | "self" for the VS-6 orientation accent.
    function drawCombatant(mon, y, title, m, W, flash = 0, side = null) {
      if (!mon) return;
      // VS-6: a colored left-edge strip (enemy = danger red, you = teal) so it's
      // instantly clear which row is the enemy vs your monster.
      if (side) k.drawRect({ pos: k.vec2(m - 8, y - 3), width: 3, height: 42, radius: 1.5, color: side === "enemy" ? k.rgb(...UI.danger) : k.rgb(...UI.primary), fixed: true });
      const el = elemColor();
      // Monster portrait (left column) — gives the MP combat panel the creature identity
      // SP's facing-sprite arena has (the panel was text + bars only). Accent-tinted slot;
      // the rest of the row shifts right of it (P) and the HP/energy bars narrow to match.
      const P = 40, fainted = mon.maxHealth && mon.currentHealth <= 0; // KO'd → gray the portrait (team-HUD parity)
      k.drawRect({ pos: k.vec2(m, y + 2), width: 32, height: 32, radius: 8, color: k.rgb(...UI.track), outline: { width: 1.5, color: k.rgb(el[0], el[1], el[2]) }, opacity: fainted ? 0.5 : 1, fixed: true });
      // TQ-397: drawMonsterIcon (not a raw sprite) so a GENERATED (html-model) monster rasterizes its
      // authored visual here instead of throwing on the missing baked sprite → empty portrait box.
      drawMonsterIcon(k, { typeName: mon.typeName, cx: m + 16, cy: y + 18, scale: 0.12, topY: y + 3, fixed: true, opacity: fainted ? 0.3 : 1 });
      const bx = m + P;
      // Truncate the name to ONE line (was width-wrapped — a long 3-word AI monster name wrapped
      // to a 2nd line that overlapped the HP bar in narrow portrait). Keep "Lv.N" always visible.
      const lvTxt = `  Lv.${mon.level}`;
      const nameMax = Math.max(6, Math.floor((W - P - 90) / 7.5) - lvTxt.length);
      k.drawText({ text: `${trunc(title, nameMax)}${lvTxt}`, pos: k.vec2(bx, y), size: 14, font: "gameFont", color: k.rgb(...UI.text), fixed: true });
      if (mon.status) k.drawText({ text: prettyStatus(mon.status), pos: k.vec2(m + W, y), size: 12, font: "gameFont", anchor: "right", color: k.rgb(...UI.amber), fixed: true });
      const hpR = mon.maxHealth ? mon.currentHealth / mon.maxHealth : 0;
      drawBar(bx, y + 18, W - P, 12, hpR, hpColor(hpR), `${mon.currentHealth}/${mon.maxHealth}`, true);
      if (mon.maxEnergy) drawBar(bx, y + 33, W - P, 5, mon.currentEnergy / mon.maxEnergy, [90, 160, 240], null);
      // Hit-flash: a brief white pulse over the row when this combatant took damage (PV-A5 juice).
      if (flash > 0) k.drawRect({ pos: k.vec2(m - 5, y - 4), width: W + 10, height: 44, radius: 5, color: k.rgb(255, 255, 255), opacity: 0.3 * flash, fixed: true });
    }

    // ── Minimap / radar (P2-T5 readability) ── Always shows the objective: the
    // shrinking safe zone + extraction portals + your position, over a faint
    // downsampled terrain, so you can navigate to extract before the zone closes.
    const mmSize = minimapSize(k.width(), k.height()); // shared SP↔MP rule (render/minimap.js)
    let mmCells = null; // precomputed terrain: [{fx, fy, col}] as 0..1 map fractions
    let mmZoom = 1; // PT1-T24 parity: cycles MINIMAP_ZOOM_LEVELS (1× full map → 2× → 4× player-centered; tap the minimap)
    function buildMinimap() {
      if (!map) return;
      const N = 34, step = Math.max(1, Math.floor(map.mapSize / N));
      const cells = [];
      for (let x = 0; x < map.mapSize; x += step) {
        for (let y = 0; y < map.mapSize; y += step) {
          const t = map.tileMap[x]?.[y];
          if (!t) continue;
          // PT1-T07: bias the radar cell toward its biome's representative tint so
          // biomes read distinctly (was muddy per-tile averages → "all green");
          // keep a little tile variation for texture. Matches the SP minimap.
          const tc = [t.colorProfile_full_r, t.colorProfile_full_g, t.colorProfile_full_b];
          const tint = biomeTintAt(map, x, y);
          const col = tint
            ? [Math.round(tint[0] * 0.65 + tc[0] * 0.35), Math.round(tint[1] * 0.65 + tc[1] * 0.35), Math.round(tint[2] * 0.65 + tc[2] * 0.35)]
            : tc;
          cells.push({ tx: x, ty: y, key: fogKey(x, y), fx: x / map.mapSize, fy: y / map.mapSize, col }); // key precomputed: the per-frame fog gate is then a bare Set.has (no fogKey() recompute per cell)
        }
      }
      mmCells = { cells, frac: step / map.mapSize };
    }
    function drawMinimap() {
      if (!map) return;
      if (!mmCells) buildMinimap();
      const E = GAME.EFFECTIVE_TILE;
      // HUD-OUT: anchor the radar to its GUTTER slot (outside the square). The slot size
      // matches mmSize for real device sizes; the tap hit-test + kill feed read the same
      // slot so they can't drift. Per-frame = resize/orientation-safe.
      const mmSlot = hudSlots().minimap;
      const ox = mmSlot.x, oy = mmSlot.y;
      // PT1-T24 parity: SAME zoom-window math as the SP radar (render/minimap.js,
      // "fix once"). Tile-space module → world-space wrappers for the net entities.
      // At Z=1 the window is the whole map → byte-identical to the old full radar.
      const view = minimapWindow({ mapSize: map.mapSize, mmSize, mmX: ox, mmY: oy, zoom: mmZoom, playerTileX: selfRender.x / E, playerTileY: selfRender.y / E });
      const Z = view.zoom;
      const mm = (wx, wy) => { const p = view.project(wx / E, wy / E); return k.vec2(p.x, p.y); };
      const inWin = (wx, wy) => view.inWindow(wx / E, wy / E);
      k.drawRect({ pos: k.vec2(ox - 4, oy - 4), width: mmSize + 8, height: mmSize + 8, radius: 6, color: k.rgb(...UI.panel), opacity: 0.82, outline: { width: 2, color: k.rgb(...UI.line) }, fixed: true });
      if (mmCells) {
        const step = Math.max(1, Math.round(mmCells.frac * map.mapSize)); // tiles per radar cell
        const cw = Math.max(2, step * view.scale + 0.5);
        for (const c of mmCells.cells) { // fog of war: only reveal walked-near terrain on the radar
          if (!explored.has(c.key)) continue; // precomputed key (== isExplored) — skip the per-cell fogKey() recompute
          if (Z > 1 && !view.cellVisible(c.tx, c.ty, step)) continue; // cull to the box, no spill (cellVisible is unconditionally true at 1×, so skip the call)
          const p = view.project(c.tx, c.ty);
          k.drawRect({ pos: k.vec2(p.x, p.y), width: cw, height: cw, color: k.rgb(c.col[0], c.col[1], c.col[2]), opacity: 0.5, fixed: true });
        }
      }
      // Storm ring: 1× only — a circle can't be clipped to the box, so at zoom it would overflow.
      if (net.state.circle && Z === 1) {
        const c = net.state.circle;
        k.drawCircle({ pos: mm(c.x, c.y), radius: Math.max(2, (c.r / E) * view.scale), fill: false, outline: { width: 1.5, color: k.rgb(120, 180, 255) }, opacity: 0.85, fixed: true });
      }
      const pulse = prefersReducedMotion() ? 0.9 : 0.6 + 0.4 * Math.sin(k.time() * 4); // a11y: static portal blip under reduce-motion
      // Blip colours are constant across all entities of a kind — build them once per
      // frame instead of re-allocating a k.rgb per portal/monster/chest/player below.
      const portalCol = k.rgb(...THEME.portal), monBlipCol = k.rgb(220, 180, 80), chestCol = k.rgb(228, 206, 128), rivalCol = k.rgb(235, 95, 95);
      for (const p of net.state.portals) { if (Z > 1 && !inWin(p.x, p.y)) continue; k.drawCircle({ pos: mm(p.x, p.y), radius: 3.5 * pulse + 1.5, color: portalCol, fixed: true }); }
      for (const mo of net.state.monsters) { if (Z > 1 && !inWin(mo.x, mo.y)) continue; k.drawCircle({ pos: mm(mo.x, mo.y), radius: 1.6, color: monBlipCol, fixed: true }); }
      // Chests reveal on the minimap only when you're close (discovery, not a full loot map).
      const cmr2 = GAME.SPIRIT_CHAIN.CHEST_MINIMAP_RADIUS ** 2;
      for (const c of net.state.chests) {
        const dx = c.x - selfRender.x, dy = c.y - selfRender.y;
        if (dx * dx + dy * dy > cmr2) continue;
        if (Z > 1 && !inWin(c.x, c.y)) continue;
        k.drawCircle({ pos: mm(c.x, c.y), radius: 2.2, color: chestCol, fixed: true });
      }
      // Rivals as a tiny character glyph (head + body) — reads as a *player*, distinct
      // from the round amber monster blobs (radar scale: shapes > mushy mini-sprites).
      for (const p of net.state.players) {
        if (Z > 1 && !inWin(p.x, p.y)) continue;
        const mp = mm(p.x, p.y);
        k.drawRect({ pos: k.vec2(mp.x - 1.5, mp.y - 1), width: 3, height: 4, color: rivalCol, fixed: true });
        k.drawCircle({ pos: k.vec2(mp.x, mp.y - 2), radius: 1.6, color: rivalCol, fixed: true });
      }
      const sp = mm(selfRender.x, selfRender.y);
      k.drawCircle({ pos: sp, radius: 3.5, color: k.rgb(90, 170, 255), outline: { width: 1.5, color: k.rgb(255, 255, 255) }, fixed: true });
      // Heading "nose": a short line in the facing direction so you can read your
      // orientation on the radar at a glance — matters for PvP + extraction routing.
      if (selfDir && (selfDir.x || selfDir.y)) {
        const dl = Math.hypot(selfDir.x, selfDir.y) || 1, nx = selfDir.x / dl, ny = selfDir.y / dl;
        k.drawLine({ p1: k.vec2(sp.x + nx * 3, sp.y + ny * 3), p2: k.vec2(sp.x + nx * 9, sp.y + ny * 9), width: 2.2, color: k.rgb(255, 255, 255), opacity: 0.95, fixed: true });
      }
      // Zoom badge (discoverable; only when zoomed in).
      if (Z !== 1) k.drawText({ text: `${Z}x`, pos: k.vec2(ox + 5, oy + 4), size: 11, font: "gameFont", color: k.rgb(...UI.text), opacity: 0.85, fixed: true });
    }

    // Team HUD layout (top-left). Shared constants so drawTeamHp + drawChainHud
    // can't desync when the row height changes (PV-T8 compact cards).
    // WIN-T2: anchor the left HUD cluster (team cards + stamina + chain HUD all key off
    // TEAM_X/TEAM_Y0) to the square play window's top-left. In landscape pw.x insets it to
    // the square's left edge (pw.y is 0, square is full-height); in portrait it tucks onto
    // the square instead of the canvas edge. Reuses pwTop from the label setup above.
    let TEAM_X = pwTop.x + 12, TEAM_Y0 = pwTop.y + 78; // re-anchored on resize (see onUpdate)
    const TEAM_ROW_H = 22, TEAM_CARD_W = 134, TEAM_BAR_H = 7, STAMINA_H = 7;
    const teamLen = () => net.state.self?.team?.length || 0;
    const staminaY = () => TEAM_Y0 + teamLen() * TEAM_ROW_H + 6;
    const teamHudBottom = () => staminaY() + STAMINA_H + 8; // y where the chain HUD starts
    const trunc = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

    // Team HP HUD (top-left): a compact card per active monster — element-tinted
    // dot + name + live HP bar — so storm/combat damage to a *specific* reserve is
    // identifiable at a glance (was anonymous bars). Names/elements come from the
    // full active-team objects (state.team, from welcome/roster), index-aligned to
    // the in-round hp/max snapshot (state.self.team) — no extra snapshot payload.
    function drawTeamHp() {
      const team = net.state.self?.team;
      if (!team || !team.length) return;
      const full = net.state.team || []; // full active-team (name/typeName/element), index-aligned
      k.drawText({ text: "Team", pos: k.vec2(TEAM_X, TEAM_Y0 - 15), size: 11, font: "gameFont", color: k.rgb(...UI.mut), fixed: true });
      team.forEach((mo, i) => {
        const y = TEAM_Y0 + i * TEAM_ROW_H;
        const r = mo.max ? mo.hp / mo.max : 0;
        const fainted = mo.hp <= 0;
        const m = full[i];
        const ec = m ? elemColor() : UI.mut;
        const name = m ? (m.name || m.typeName || "?") : `Monster ${i + 1}`;
        // element accent dot (dimmed if fainted)
        k.drawCircle({ pos: k.vec2(TEAM_X + 4, y + 4), radius: 4, color: k.rgb(ec[0], ec[1], ec[2]), opacity: fainted ? 0.3 : 0.95, fixed: true });
        // name above the bar
        k.drawText({ text: trunc(name, 16), pos: k.vec2(TEAM_X + 13, y - 1), size: 10, font: "gameFont", color: k.rgb(...(fainted ? UI.mut : UI.text)), opacity: fainted ? 0.7 : 1, fixed: true });
        // live HP bar with the number
        drawBar(TEAM_X + 13, y + 12, TEAM_CARD_W - 13, TEAM_BAR_H, r, fainted ? [70, 70, 78] : hpColor(r), String(mo.hp), !fainted);
      });
      // Stamina bar (sprint) under the team.
      const sy = staminaY();
      const sr = (net.state.stamina ?? GAME.SPRINT.STAMINA_MAX) / GAME.SPRINT.STAMINA_MAX;
      k.drawText({ text: "Stamina", pos: k.vec2(TEAM_X, sy - 1), size: 9, font: "gameFont", color: k.rgb(...UI.mut), fixed: true });
      drawBar(TEAM_X + 56, sy, TEAM_CARD_W - 56, STAMINA_H, sr, sr > 0.3 ? [120, 200, 230] : [220, 170, 80], null);
    }

    // The live instance + definition of the player's equipped spirit chain.
    function equippedChain() {
      const id = net.state.equippedChainId;
      const cs = (net.state.chains || []).find((c) => c.chainId === id);
      return cs ? { cs, def: getSpiritChain(cs.chainId) } : null;
    }

    // PV-T11: throw wind-up tell — a chain-colored ring that snaps inward onto the
    // tamer the instant a chain is loosed, plus a small spark puff, so the throw has
    // a readable launch beat (the comet trail + impact burst already cover the flight
    // and the landing). World-space at the throw origin; self-cancels after ~0.2s.
    // a11y: a static ring (no inward collapse) under reduce-motion.
    function playThrowWindup(x, y, col) {
      const t0 = k.time(), reduce = prefersReducedMotion();
      const h = k.onDraw(() => {
        const p = (k.time() - t0) / 0.2;
        if (p >= 1) { h.cancel(); return; }
        const r = reduce ? 18 : 6 + 26 * (1 - p);
        k.drawCircle({ pos: k.vec2(x, y), radius: r, fill: false, outline: { width: 2 + 2 * (1 - p), color: k.rgb(col[0], col[1], col[2]) }, opacity: 0.6 * (1 - p) });
      });
      emit({ x, y, n: 6, color: col, speed: 26, life: 0.3, size: 2.4, spread: Math.PI * 2, drag: 3 }); // chain-colored charge sparks (PV-T12 fx path)
    }

    // The equipped-chain HUD panel rect (left, under TEAM). Taller when >1 chain is
    // loaded so the slot-swap pips fit. Shared by the draw + the tap-to-swap hit-test.
    function chainHudRect() {
      const ids = net.state.equippedChainIds || [];
      const bh = ids.length > 1 ? 56 : 40;
      // Portrait: the team cluster fills the short top gutter, so teamHudBottom() pushes the
      // chain HUD ~27px into the world. Use the dedicated bottom-gutter slot hudLayout gives.
      const hud = hudSlots();
      if (hud.orientation === "portrait") return [hud.chain.x, hud.chain.y, 150, bh];
      return [TEAM_X, teamHudBottom(), 150, bh];
    }
    // Equipped-chain HUD: active chain (icon, name, capture charges) + the 3-slot
    // loadout pips. Throws are FREE now (boomerang), so only charges are shown.
    function drawChainHud() {
      const e = equippedChain();
      const ids = net.state.equippedChainIds || [];
      const [x, y, w, h] = chainHudRect();
      k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius: 4, color: k.rgb(...UI.panel), opacity: 0.8, fixed: true });
      if (e && e.def) {
        drawChainGlyph(k, e.def, { x: x + 20, y: y + 20, size: 24, fixed: true }); // TQ-143: chain ring + tier-coloured centre dot
        // Fall back to the def's durability if the live counter is missing, so the HUD
        // never shows "? charges" (a merged chain instance can lack durability).
        const dur = e.cs.durability ?? e.def.durability ?? 1;
        // SC-tier: the ACTIVE slot's tier — the chain available in combat — read out explicitly as a
        // tier-coloured "T{n}" chip at the panel's top-right (matches the glyph's centre-dot tier cue),
        // so the player can see at a glance which tier they'll throw with.
        const tierN = e.def.tier || 1;
        k.drawText({ text: `T${tierN}`, pos: k.vec2(x + w - 8, y + 5), size: 11, font: "gameFont", anchor: "topright", color: k.rgb(...tierColor(tierN)), fixed: true });
        k.drawText({ text: e.def.name, pos: k.vec2(x + 38, y + 5), size: 11, font: "gameFont", color: k.rgb(...UI.text), fixed: true });
        k.drawText({ text: `${TOUCH ? "tap Throw" : "Space throw"}   ${dur} charge${dur === 1 ? "" : "s"}`, pos: k.vec2(x + 38, y + 22), size: 10, font: "gameFont", color: k.rgb(...UI.body), fixed: true });
        // CHAIN_SLOTS: a pip per loadout slot, the active one enlarged + ringed; the swap
        // hint reflects the input ([ ] on desktop, tap the panel on touch).
        if (ids.length > 1) {
          for (let i = 0; i < ids.length; i++) {
            const def = getSpiritChain(ids[i]);
            const cc = def ? chainColor(def) : UI.mut;
            const active = ids[i] === net.state.equippedChainId;
            const px = x + 12 + i * 16;
            k.drawCircle({ pos: k.vec2(px, y + 46), radius: active ? 6 : 4, color: k.rgb(cc[0], cc[1], cc[2]), opacity: active ? 1 : 0.5, fixed: true });
            if (active) k.drawCircle({ pos: k.vec2(px, y + 46), radius: 8, fill: false, outline: { width: 1, color: k.rgb(...UI.text) }, opacity: 0.85, fixed: true });
          }
          k.drawText({ text: TOUCH ? "tap to swap" : "[ ] swap", pos: k.vec2(x + w - 8, y + 41), size: 9, font: "gameFont", anchor: "topright", color: k.rgb(...UI.mut), fixed: true });
        }
      } else {
        k.drawText({ text: "No chain", pos: k.vec2(x + 10, y + 14), size: 11, font: "gameFont", color: k.rgb(...UI.mut), fixed: true });
      }
      // Extraction stakes (genre tension, SP parity): run-found chains are banked on
      // extract but lost on death — show the count "at risk" (server now flags runFound
      // in the snapshot's chainsView). Hidden at 0 so there's no early-run clutter.
      const atRisk = (net.state.chains || []).filter((c) => c.runFound).length;
      if (atRisk > 0) {
        const ry = y + h + 6;
        k.drawRect({ pos: k.vec2(x, ry), width: 150, height: 22, radius: 4, color: k.rgb(...UI.panel), opacity: 0.8, fixed: true });
        k.drawText({ text: `${atRisk} chain${atRisk === 1 ? "" : "s"} at risk`, pos: k.vec2(x + 8, ry + 5), size: 11, font: "gameFont", color: k.rgb(...UI.amber), fixed: true });
      }
    }

    // Zone-death DANGER bar (top of the play window): fills toward death while OUTSIDE the safe
    // zone (over ~DANGER_FILL_S), drains back to empty in SAFETY (over ~DANGER_DRAIN_S). Driven by
    // the server-authoritative self.danger (0..1). Amber → red as it fills; pulses while filling.
    const DANGER_FILL_S = 30; // mirrors the server default — for the seconds-to-death readout only
    function drawDangerBar(danger, outside) {
      const pw = playWindowRect(k.width(), k.height(), { maxAspect: winAspect() });
      const bw = Math.min(pw.size * 0.62, 380), bh = 13;
      const bx = pw.cx - bw / 2, by = pw.y + 14;
      const col = danger > 0.6 ? THEME.danger : THEME.amber;
      k.drawRect({ pos: k.vec2(bx, by), width: bw, height: bh, radius: 7, color: k.rgb(14, 8, 8), opacity: 0.85, fixed: true, outline: { width: 1.5, color: k.rgb(...col) } });
      const op = outside ? 0.8 + 0.2 * Math.sin(k.time() * 8) : 0.9;
      if (danger > 0.001) k.drawRect({ pos: k.vec2(bx, by), width: Math.max(3, bw * danger), height: bh, radius: 7, color: k.rgb(...col), opacity: op, fixed: true });
      const secs = Math.max(1, Math.ceil((1 - danger) * DANGER_FILL_S));
      k.drawText({ text: outside ? `Danger — ${secs}s to death` : "Recovering", pos: k.vec2(pw.cx, by + bh + 9), size: 12, font: "gameFont", anchor: "center", color: k.rgb(...col), opacity: 0.92, fixed: true });
    }

    // Danger overlay: the zone-death bar (whenever there's danger to read), plus a pulsing red
    // border + run-to-safety arrow while you're actually OUTSIDE the safe zone. Client-side from the
    // authoritative self position vs the circle + self.danger.
    function drawDanger() {
      const c = net.state.circle, self = net.state.self;
      if (!c || !self) return;
      const dx = self.x - c.x, dy = self.y - c.y;
      const outside = dx * dx + dy * dy > c.r * c.r;
      const danger = Math.max(0, Math.min(1, self.danger || 0));
      if (danger > 0 || outside) drawDangerBar(danger, outside);
      if (!outside) return; // inside the zone — the draining bar is the only cue (no border/arrow)
      const pulse = 0.5 + 0.5 * Math.sin(k.time() * 6);
      const W = k.width(), H = k.height(), t = 8, op = 0.25 + 0.45 * pulse;
      // Storm danger border + labels routed through THEME.danger (SP↔MP parity;
      // was hand-tuned [230,60,60] + [255,120,120] / [255,185,185] off-theme pinks).
      const red = k.rgb(...THEME.danger);
      k.drawRect({ pos: k.vec2(0, 0), width: W, height: t, color: red, opacity: op, fixed: true });
      k.drawRect({ pos: k.vec2(0, H - t), width: W, height: t, color: red, opacity: op, fixed: true });
      k.drawRect({ pos: k.vec2(0, 0), width: t, height: H, color: red, opacity: op, fixed: true });
      k.drawRect({ pos: k.vec2(W - t, 0), width: t, height: H, color: red, opacity: op, fixed: true });
      // Text keys off the square (robust at extreme portrait aspects where H*0.26 would
      // fall above the square); the border + arrow stay canvas/camera-relative.
      const pw = playWindowRect(W, H, { maxAspect: winAspect() }), cy = pw.y + Math.round(pw.size * 0.26);
      k.drawText({ text: "Outside Safe Zone", pos: k.vec2(pw.cx, cy), size: 22, font: "gameFont", anchor: "center", color: red, opacity: 0.7 + 0.3 * pulse, fixed: true });
      // PT2-T08: make the punishment ACTIONABLE — a screen-edge arrow toward the zone
      // centre (the nearest safe direction) + the distance still to cross. Without
      // this the warning says you're in danger but not which way to run.
      const dist = Math.hypot(dx, dy);
      const toSafe = Math.max(0, Math.round((dist - c.r) / GAME.EFFECTIVE_TILE));
      k.drawText({ text: `${toSafe} tiles to safety — run toward the arrow`, pos: k.vec2(pw.cx, cy + 26), size: 14, font: "gameFont", anchor: "center", color: red, opacity: 0.8, fixed: true });
      // Arrow toward the centre, projected to the SQUARE edge (not the screen edge): the world is
      // only visible inside the square, and a screen-edge arrow lands in the gutter, overlapping the
      // team HUD / objective (same footgun the portal compass had).
      const ang = Math.atan2(-dy, -dx), cs = Math.cos(ang), sn = Math.sin(ang);
      const hw = pw.size / 2 - 50, hh = pw.size / 2 - 50;
      const scale = Math.min(hw / (Math.abs(cs) || 1e-6), hh / (Math.abs(sn) || 1e-6));
      const ax = pw.cx + cs * scale, ay = pw.cy + sn * scale;
      const aw = 4, head = 12;
      k.drawCircle({ pos: k.vec2(ax, ay), radius: 20, color: k.rgb(20, 6, 6), opacity: 0.55, fixed: true });
      const tip = k.vec2(ax + cs * 12, ay + sn * 12), a1 = ang + Math.PI * 0.8, a2 = ang - Math.PI * 0.8;
      k.drawLine({ p1: k.vec2(ax - cs * 9, ay - sn * 9), p2: tip, width: aw, color: red, opacity: 0.7 + 0.3 * pulse, fixed: true });
      k.drawLine({ p1: tip, p2: k.vec2(tip.x + Math.cos(a1) * head, tip.y + Math.sin(a1) * head), width: aw, color: red, opacity: 0.7 + 0.3 * pulse, fixed: true });
      k.drawLine({ p1: tip, p2: k.vec2(tip.x + Math.cos(a2) * head, tip.y + Math.sin(a2) * head), width: aw, color: red, opacity: 0.7 + 0.3 * pulse, fixed: true });
    }

    // Storm-damage hit flash (PV-T13): a brief, brighter pulse of the danger border
    // on the frame the storm actually ticks HP, fading over ~0.45s. Independent of
    // drawDanger so it can finish fading even if you've just run back inside the zone.
    // a11y: under reduce-motion keep it (a fade, not a strobe) but cap the peak alpha.
    function drawStormHit() {
      if (stormHitT < 0) return;
      const age = k.time() - stormHitT;
      if (age > 0.45) return;
      const peak = prefersReducedMotion() ? 0.3 : 0.45;
      const a = (1 - age / 0.45) * peak;
      const W = k.width(), H = k.height(), t = 26, red = k.rgb(235, 50, 50);
      k.drawRect({ pos: k.vec2(0, 0), width: W, height: t, color: red, opacity: a, fixed: true });
      k.drawRect({ pos: k.vec2(0, H - t), width: W, height: t, color: red, opacity: a, fixed: true });
      k.drawRect({ pos: k.vec2(0, 0), width: t, height: H, color: red, opacity: a, fixed: true });
      k.drawRect({ pos: k.vec2(W - t, 0), width: t, height: H, color: red, opacity: a, fixed: true });
    }

    // Off-screen extraction guidance: a screen-edge arrow toward the NEAREST portal
    // when it isn't already on-screen, so you know which way to run to extract.
    // Portals otherwise only show on the minimap + once they're in view — easy to
    // miss in a closing round. Portal-cyan (matches the minimap dots) reads as
    // "extraction". Hidden once the rift is on-screen (you can see it).
    function drawPortalCompass() {
      const portals = net.state.portals, self = net.state.self;
      if (!portals || !portals.length || !self) return;
      let np = null, best = Infinity;
      for (const p of portals) {
        const d = (p.x - self.x) ** 2 + (p.y - self.y) ** 2;
        if (d < best) { best = d; np = p; }
      }
      if (!np) return;
      const W = k.width(), H = k.height(), margin = 54;
      // The world is only visible INSIDE the square play window (the gutters are opaque HUD), so
      // the compass must operate on the square — not the full screen. Using screen bounds left a
      // blind spot: the compass vanished while the portal sat off the square in the gutter band.
      const pw = playWindowRect(W, H, { maxAspect: winAspect() });
      // World → screen (the camera centers selfRender on the square, which is canvas-centered).
      const sx = (np.x - selfRender.x) + pw.cx, sy = (np.y - selfRender.y) + pw.cy;
      if (sx >= pw.x + margin && sx <= pw.right - margin && sy >= pw.y + margin && sy <= pw.bottom - margin) return; // visible in the square
      const ang = Math.atan2(sy - pw.cy, sx - pw.cx), c = Math.cos(ang), s = Math.sin(ang);
      const hw = pw.size / 2 - margin, hh = pw.size / 2 - margin;
      const scale = Math.min(hw / (Math.abs(c) || 1e-6), hh / (Math.abs(s) || 1e-6));
      const ax = pw.cx + c * scale, ay = pw.cy + s * scale; // square-edge position toward the portal
      const cyan = k.rgb(...THEME.portal), pulse = prefersReducedMotion() ? 0.9 : 0.6 + 0.4 * Math.sin(k.time() * 4), wid = 3; // a11y: static compass under reduce-motion
      k.drawCircle({ pos: k.vec2(ax, ay), radius: 17, color: k.rgb(8, 12, 20), opacity: 0.7, fixed: true });
      k.drawCircle({ pos: k.vec2(ax, ay), radius: 17, fill: false, outline: { width: 1.5, color: cyan }, opacity: 0.5 + 0.35 * pulse, fixed: true });
      const tip = k.vec2(ax + c * 9, ay + s * 9), b = 8, a1 = ang + Math.PI * 0.78, a2 = ang - Math.PI * 0.78;
      k.drawLine({ p1: k.vec2(ax - c * 7, ay - s * 7), p2: tip, width: wid, color: cyan, fixed: true }); // shaft
      k.drawLine({ p1: tip, p2: k.vec2(tip.x + Math.cos(a1) * b, tip.y + Math.sin(a1) * b), width: wid, color: cyan, fixed: true });
      k.drawLine({ p1: tip, p2: k.vec2(tip.x + Math.cos(a2) * b, tip.y + Math.sin(a2) * b), width: wid, color: cyan, fixed: true });
      const dist = Math.round(Math.sqrt(best) / GAME.EFFECTIVE_TILE); // distance in tiles
      k.drawText({ text: `${dist}`, pos: k.vec2(ax - c * 31, ay - s * 31), size: 13, font: "gameFont", anchor: "center", color: cyan, fixed: true });
    }

    // Final-minute extraction urgency: the round clock is the deadline, but it's
    // otherwise just small text in the top-left info line. In the last 60s show a
    // big centered timer (amber), going red + pulsing in the last 30s, so the
    // pressure to reach a portal is unmissable. `net.state.time` = seconds left.
    function drawTimeWarning() {
      const t = net.state.time || 0;
      if (t <= 0 || t > 60) return;
      // WIN: anchor to the square's top so it stays in the play area in portrait
      // (was canvas-top y=64/92 → floated above the square). Landscape unchanged (pw.y=0).
      const pw = playWindowRect(k.width(), k.height(), { maxAspect: winAspect() }), mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, "0");
      const crit = t <= 30, pulse = crit ? 0.55 + 0.45 * Math.sin(k.time() * 8) : 1;
      const col = crit ? k.rgb(255, 80, 80) : k.rgb(255, 190, 80);
      k.drawText({ text: `${mm}:${ss}`, pos: k.vec2(pw.cx, pw.y + 64), size: crit ? 34 : 28, font: "gameFont", anchor: "center", color: col, opacity: pulse, fixed: true });
      k.drawText({ text: crit ? "Storm closing — extract now" : "extract soon", pos: k.vec2(pw.cx, pw.y + (crit ? 92 : 88)), size: crit ? 14 : 12, font: "gameFont", anchor: "center", color: col, opacity: 0.85 * pulse, fixed: true });
    }

    // Kill feed (P8-T5): recent round events (PvP defeats, eliminations, escapes)
    // right-aligned under the minimap, fading out after a few seconds.
    function drawKillFeed() {
      const feed = net.state.killfeed;
      if (!feed || !feed.length) return;
      const now = Date.now(), SHOW = 4000, FADE = 2000;
      // HUD-OUT: anchor the kill feed just below the radar's GUTTER slot (right-aligned to
      // the radar's right edge), so it follows the minimap into the gutter.
      const mm = hudSlots().minimap;
      const x = mm.x + mm.size;
      let y = mm.y + mm.size + 14;
      for (const e of feed) {
        const age = now - (e.recvAt || now);
        if (age > SHOW + FADE) continue;
        const op = age < SHOW ? 1 : Math.max(0, 1 - (age - SHOW) / FADE);
        let text, col;
        // Truncate names: guest nicks can be 20 chars, and a PvP "X defeated Y" with two long
        // names overflowed the right gutter and bled over the play window (the strip width grows
        // with the string + it's drawn after drawPlayWindow). Cap each name so entries stay short.
        const kn = trunc(e.killer || "?", 10), vn = trunc(e.victim || "?", 10);
        if (e.cause === "pvp") { text = `${kn} defeated ${vn}`; col = [240, 120, 90]; }
        else if (e.cause === "extracted") { text = `${vn} escaped`; col = [120, 220, 150]; }
        else if (e.cause === "zone") { text = `${vn} lost to the storm`; col = [230, 150, 150]; }
        else if (e.cause === "timeout") { text = `${vn} ran out of time`; col = [200, 200, 210]; }
        else if (e.cause === "disconnect") { text = `${vn} disconnected`; col = [180, 180, 190]; }
        else if (e.cause === "defeat") { text = `${vn} was defeated`; col = [240, 120, 90]; } // combat team-wipe (Q10): a real cause now, was hitting the generic fallback
        else { text = `${vn} is out`; col = [200, 200, 210]; }
        // Backing strip + cause tick so the feed stays legible over busy terrain
        // (was bare text). Width is approximated from the string length.
        const tw = text.length * 6.5 + 14;
        k.drawRect({ pos: k.vec2(x - tw, y - 2), width: tw, height: 16, radius: 3, color: k.rgb(...UI.panel), opacity: 0.5 * op, fixed: true });
        k.drawRect({ pos: k.vec2(x + 3, y - 2), width: 2.5, height: 16, radius: 1, color: k.rgb(col[0], col[1], col[2]), opacity: 0.95 * op, fixed: true });
        k.drawText({ text, pos: k.vec2(x - 4, y), size: 12, font: "gameFont", anchor: "topright", color: k.rgb(...col), opacity: op, fixed: true });
        y += 19;
      }
    }

    // Shared transient top-centre toast ({text, at}): auto-fades, clears itself via `clear`.
    // WIN: anchor to the square (top + center) + cap width to the square so the notice sits
    // in the play area in portrait. Landscape unchanged (pw.y=0, pw.cx=W/2).
    function drawTopNotice(n, clear, yOff = 110) {
      if (!n) return;
      const age = Date.now() - (n.at || 0), SHOW = 3000, FADE = 1200;
      if (age > SHOW + FADE) { clear(); return; }
      const op = age < SHOW ? 1 : Math.max(0, 1 - (age - SHOW) / FADE);
      const pw = playWindowRect(k.width(), k.height(), { maxAspect: winAspect() });
      const cx = pw.cx, y = pw.y + yOff, tw = Math.min(pw.size - 24, n.text.length * 7 + 28);
      k.drawRect({ pos: k.vec2(cx - tw / 2, y - 14), width: tw, height: 28, radius: 6, color: k.rgb(...UI.panel), opacity: 0.82 * op, outline: { width: 1, color: k.rgb(...UI.amber) }, fixed: true });
      k.drawText({ text: n.text, pos: k.vec2(cx, y), size: 13, font: "gameFont", anchor: "center", width: tw - 16, color: k.rgb(...UI.amber), opacity: op, fixed: true });
    }
    // FGT-T1: brief top-center toast when the server reports the AI combat judge is
    // offline (so engaging a monster did nothing) — surfaced instead of a silent
    // deterministic fight. Auto-fades; prod always has the judge, so this is rare.
    function drawCombatNotice() { drawTopNotice(net.state.combatNotice, () => { net.state.combatNotice = null; }); }
    // TQ-66: brief top-center toast when a chest's item was left behind because the item bag
    // is full — so a full bag is well-defined to the player, not a silent loot loss. Sits a row
    // below the combat notice (the two are mutually exclusive in practice — you can't open
    // chests mid-combat — but the offset avoids any overlap if they ever coincide).
    function drawLootNotice() { drawTopNotice(net.state.lootNotice, () => { net.state.lootNotice = null; }, 148); }

    const JOY_R = JOY_RADIUS; // shared with the hub via inputMode.js (one feel everywhere)
    const joyRest = () => { const j = hudSlots().joystick; return k.vec2(j.x, j.y); }; // HUD-OUT: gutter slot (left band in landscape, bottom band in portrait)
    let joyId = null;
    let joyVec = { x: 0, y: 0 };
    let joyBase = joyRest(); // floating: the base spawns where the thumb lands
    let thumb = joyBase;

    function joyStart(id, p) {
      if (joyId !== null) return; // MB-3: one finger owns movement; a 2nd touch can't hijack the stick
      // HUD-OUT: movement starts only from the CONTROL GUTTER outside the square (the left
      // band in landscape, the bottom band in portrait) so the play area stays clear and
      // the touch controls sit outside the square (user 2026-06-09).
      const lay = hudSlots(), sq = lay.square;
      const inControlGutter = lay.orientation === "portrait" ? p.y >= sq.bottom
        : lay.orientation === "landscape" ? p.x <= sq.x
        : (p.x <= sq.x || p.y >= sq.bottom); // square fallback: left or bottom edge
      // The gutter restriction is a TOUCH ergonomic (keep the play area clear for aim taps). The DESKTOP
      // MOUSE drives movement from ANYWHERE in the view (hold/drag to walk toward the cursor) — restoring
      // the desktop mouse-move that c485b8b removed (Dominik 2026-06-16: "make it work on desktop").
      if (id !== "m" && !inControlGutter) return;
      joyId = id;
      // Floating joystick: spawn the base under the thumb (clamped to stay on-screen).
      joyBase = k.vec2(
        Math.max(JOY_R, Math.min(k.width() - JOY_R, p.x)),
        Math.max(JOY_R, Math.min(k.height() - JOY_R, p.y)),
      );
      thumb = joyBase;
      joyMove(id, p);
    }
    function joyMove(id, p) {
      if (id !== joyId) return;
      // Plain-arithmetic delta: the canvas2D backend's k.vec2 + pointer positions are bare
      // {x,y} (no Kaboom .sub/.len/.scale/.add) — using those methods threw on every touchmove
      // and broke touch movement entirely (TQ-428).
      let dx = p.x - joyBase.x, dy = p.y - joyBase.y;
      const len = Math.hypot(dx, dy) || 1;
      if (len > JOY_R) { const s = JOY_R / len; dx *= s; dy *= s; }
      thumb = k.vec2(joyBase.x + dx, joyBase.y + dy);
      joyVec = { x: dx / JOY_R, y: dy / JOY_R };
    }
    function joyEnd(id) {
      if (id !== joyId) return;
      joyId = null;
      joyVec = { x: 0, y: 0 };
      thumb = joyBase;
    }

    // Combat action buttons (shared by render + hit-testing).
    // FGT-T4: the living bench (active team minus the in-combat active, hp > 0). Names
    // come from the full active-team objects (state.team); live HP from the index-aligned
    // hp snapshot (state.self.team). The server re-validates by id, so a stale row is safe.
    function benchList() {
      const c = net.state.combat;
      const full = net.state.team || [];
      const hp = net.state.self?.team || [];
      const activeId = c?.active?.id;
      const out = [];
      full.forEach((mo, i) => {
        if (!mo || mo.id == null || mo.id === activeId) return;
        const snap = hp[i] || {};
        const cur = snap.hp != null ? snap.hp : (mo.currentHealth ?? 0);
        const max = snap.max != null ? snap.max : cur;
        if (cur > 0) out.push({ m: mo, cur, max });
      });
      return out;
    }

    function combatButtons() {
      const c = net.state.combat;
      if (!c || c.outcome || c.waiting) { swapOpen = false; itemsOpen = false; return []; } // PvP: no input while awaiting the opponent
      // WIN-T3: lay the combat content out within the square play window (not the full
      // canvas) so the action buttons don't stretch on ultrawide / cramp oddly; centered.
      const pw = playWindowRect(k.width(), k.height(), { maxAspect: winAspect() });
      // WIN-T3 fix: anchor vertically to the square's bottom too (was canvas-bottom),
      // so in portrait the panel rises with the square instead of dropping into the
      // bottom peripheral band. Landscape is unchanged (pw.bottom === k.height()).
      const top = Math.min(k.height(), pw.bottom) - COMBAT_H - safeInset.bottom, m = pw.x + 12, gap = 8, h = 54; // larger, touch-friendly targets (MB-4: above the home-bar)
      const iw = pw.w - 24; // TQ-494: content spans the full 4:3 window width (was pw.size, the square side)
      const y = top + 100; // below the two stat rows
      // Sub-menus (swap/items) stack up to 4 rows (3 entries + Back). The fixed 54px row
      // overflowed the panel — with a full bench the last entry was clipped and "Back" fell
      // entirely off-screen (no way to exit). Fit the row height to the space from y down to
      // the panel bottom so every row, including Back, is on-screen. (panelBottom == top+COMBAT_H.)
      const subRowH = (n) => {
        const panelBottom = Math.min(k.height(), pw.bottom) - safeInset.bottom;
        return Math.max(28, Math.min(h, (panelBottom - y - 8 - gap * (n - 1)) / n));
      };
      // FGT-T4: Swap sub-menu — pick a living bench monster to switch to (free action).
      if (swapOpen) {
        const fw = iw;
        const bench = benchList().slice(0, 3);
        const sh = subRowH(bench.length + 1); // +1 for the Back row
        const btns = bench.map((b, i) => ({
          rect: [m, y + i * (sh + gap), fw, sh],
          label: `Swap to ${trunc(b.m.name || b.m.typeName, 16)}  Lv.${b.m.level}  (${b.cur}/${b.max})`,
          action: { kind: "swap", monsterId: b.m.id },
        }));
        btns.push({ rect: [m, y + bench.length * (sh + gap), fw, sh], label: "Back", action: { kind: "closeSwap" } });
        return btns;
      }
      // #61: Items sub-menu — use a combat item (name + action description) instead of an
      // attack/flee; the judge resolves the description like an attack and the server
      // consumes the item. Shows the first few (the bag is small; combat panel is shallow).
      if (itemsOpen) {
        const fw = iw;
        const items = (net.state.items || []).slice(0, 3);
        const sh = subRowH(items.length + 1); // +1 for the Back row
        const btns = items.map((it, i) => ({
          rect: [m, y + i * (sh + gap), fw, sh],
          label: `${trunc(it.name, 16)} — ${trunc(it.description, 38)}`,
          action: { kind: "item", itemId: it.id },
        }));
        btns.push({ rect: [m, y + items.length * (sh + gap), fw, sh], label: "Back", action: { kind: "closeItems" } });
        return btns;
      }
      const energy = c.active?.currentEnergy ?? 0;
      const atks = (c.attacks || []).slice(0, 4);
      const w = (iw - gap * 3) / 4;
      const btns = atks.map((a, i) => ({
        rect: [m + i * (w + gap), y, w, h], label: cleanAttackName(a.name), // CN-7: display strip
        cost: a.energyCost,
        affordable: (a.energyCost ?? 0) <= energy,
        description: a.description || "", // TQ-71: full move text, shown on hover/long-press
        action: { kind: "attack", attackName: a.name }, // keep the FULL name as the server lookup key
      }));
      // Action row: Catch · Swap · Flee (PvE) / Swap · Flee (PvP). Swap appears only when
      // a living bench monster exists; the row splits evenly to fit 2 or 3 buttons.
      const y2 = y + h + gap;
      const row = [];
      // Catch is always offered (PvE): there is no rarity gate anymore — the AI capture
      // judge weighs the equipped chain's power against how weakened the enemy is.
      if (!c.pvp) row.push({ label: "Catch", action: { kind: "catch" } });
      if (benchList().length > 0) row.push({ label: "Swap", action: { kind: "openSwap" } });
      // Items are PvE-only for now: the AI judge resolves one item user per turn (the
      // "player" POV), so a symmetric simultaneous PvP turn can't honor both sides' items.
      // PvP's resolveTurn ignored item actions, so the button silently wasted the turn —
      // gate it out of duels (like Catch) until the judge supports dual-side items.
      if (!c.pvp && (net.state.items || []).length > 0) row.push({ label: "Items", action: { kind: "openItems" } });
      row.push({ label: "Flee", action: { kind: "flee" } });
      const rw = (iw - gap * (row.length - 1)) / row.length;
      row.forEach((r, i) => btns.push({ rect: [m + i * (rw + gap), y2, rw, h], label: r.label, action: r.action }));
      return btns;
    }
    function hitButton(p) {
      for (const b of combatButtons()) {
        const [x, y, w, h] = b.rect;
        if (p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h) return b.action;
      }
      return null;
    }
    // TQ-71: like hitButton but returns the whole button descriptor (for the touch attack-press
    // long-press preview, which needs the rect + description, not just the action).
    function hitButtonObj(p) {
      for (const b of combatButtons()) {
        const [x, y, w, h] = b.rect;
        if (p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h) return b;
      }
      return null;
    }
    let atkHold = null; // TQ-71: a pending touch press on an attack button — { action, description, rect, t0, x, y }

    let sendAcc = 0, pingAcc = 0, safeAcc = 0;
    let combatPress = null; // { kind, name, t } — brief tap-feedback flash on combat buttons
    let swapOpen = false; // FGT-T4: the combat "Swap" sub-menu (pick a living bench monster) is open
    let itemsOpen = false; // #61: the combat "Items" sub-menu (pick a combat item to use) is open
    let prevEnemyHp = null, prevActiveHp = null, hitFlashE = -9, hitFlashA = -9, lastCombatId = null, caughtFxDone = false; // combat hit-flash + catch sparkle
    let battleIntroT0 = -9; // start time of the battle-screen entry cinematic (transition → chain throw → monster spawn); set on each new combat
    let catchThrowT0 = -9, catchResolveT0 = -9, catchResolveKind = null; // catch cinematic: chain-throw start, verdict start, "caught"|"broke" — drives drawBattleStage's catch animation
    let newSpeciesT = -9; // PV-T15: timestamp of a first-ever catch → "NEW SPECIES!" banner window
    let prevTeamHp = null, stormHitT = -1; // PV-T13: storm/zone-tick damage feedback state (declarations were dropped by an edit → ReferenceError; restored)
    let predWasSprinting = false; // prediction sprint-gate hysteresis (mirrors server rp.wasSprinting) so the client stops predicting sprint at the same stamina floor the server enforces — no rubberband at depletion
    let predStamina = null; // TQ-382: client-predicted stamina (mirrors server rp.stamina via the shared tickStamina), reconciled to net.state.stamina on each snapshot — see the prediction block
    let dmgFloaters = []; // floating damage numbers — { x, y, dmg, col:[r,g,b], t0 }
    clearFx(); // reset the shared particle pool on (re)entry (PV-T12)
    clearShake(); // reset screen-shake trauma on (re)entry (PV-A5)
    k.onUpdate(() => {
      updateFx(k.dt()); // advance world particles (PV-T12)
      updateShake(k.dt()); // decay screen-shake trauma (PV-A5)
      // HUD-OUT: keep the retained HUD labels + the team-cluster anchor in their GUTTER
      // slots every frame (the shim doesn't restart the scene on resize, and safe-area
      // insets / orientation can change mid-round). Cheap; reads the shared hudLayout.
      {
        const h = hudSlots();
        info.pos = k.vec2(h.team.x, h.team.y);
        // Re-wrap the objective to its current gutter slot. The retained text can't have
        // its wrap width updated in place (the shim's width setter scales), so recreate
        // it when the slot width changes — preserving the live text + hidden state.
        const oW = h.objective.width || 0;
        if (Math.abs(oW - objectiveW) > 2) {
          const txt = objective.text, hid = objective.hidden;
          objective.destroy();
          objectiveW = oW;
          objective = makeObjective(h.objective.x, h.objective.y, oW);
          objective.text = txt; objective.hidden = hid;
        }
        // When the cave lobby panel fills the left gutter, move the objective onto the square's
        // bottom inside edge (as in portrait) so the panel doesn't cover it.
        objective.pos = lobbyPanelActive() ? k.vec2(h.square.cx, h.square.bottom - 24) : k.vec2(h.objective.x, h.objective.y);
        // Keyboard-controls hint at the square's bottom-left. Re-anchor EVERY frame for ALL
        // orientations (the visibility is owned by the combat/result/onboard/menu gate below,
        // which keeps it shown while roaming): the old square-only anchor left it frozen at
        // the scene-start x on a landscape→wider resize, so the left-gutter biome chip drifted
        // on top of it. Following the square keeps it clear of the gutter HUD at any size.
        hint.hidden = TOUCH || h.orientation !== "square"; // the WASD/Space/ESC reference is desktop-only — touch players have the on-screen joystick/THROW/pause + the touch onboarding
        hint.pos = k.vec2(h.square.x + 12, h.square.bottom - 24);
        // The info label (anchored at h.team) is always 3 lines of size-14 text
        // (Online / You / rivals ≈ 48px tall); reserve enough room so its "You…" and
        // "No rivals…" lines don't collide with the "TEAM" label + first team row.
        TEAM_X = h.team.x; TEAM_Y0 = h.team.y + 66;
      }
      // Latency probe every 2s while connected (drives the HUD ping readout).
      pingAcc += k.dt();
      if (pingAcc >= 2 && net.state.connected) { net.ping(); pingAcc = 0; }
      // MB-4: refresh safe-area insets on a throttle (cheap; touch only) so a mid-round
      // rotation or mobile URL-bar show/hide re-flows the touch HUD within ~1s.
      if (TOUCH) { safeAcc += k.dt(); if (safeAcc >= 1) { recomputeSafeInset(); safeAcc = 0; } }

      let dx = 0, dy = 0;
      if (anyDown("moveUp")) dy = -1;
      if (anyDown("moveDown")) dy = 1;
      if (anyDown("moveLeft")) dx = -1;
      if (anyDown("moveRight")) dx = 1;
      if (net.state.combat) { joyId = null; joyVec = { x: 0, y: 0 }; thumb = joyRest(); } // no joystick mid-fight (was `JOY`, undefined → crashed combat)
      else if (joyVec.x || joyVec.y) { dx = joyVec.x; dy = joyVec.y; } // joystick overrides keys
      let gm = { x: 0, y: 0 };
      if (!net.state.combat) { gm = gamepadMove(); if (gm.x || gm.y) { dx = gm.x; dy = gm.y; } } // gamepad stick/d-pad (roaming)
      selfMoving = !!(dx || dy);
      if (dx || dy) selfDir = { x: dx, y: dy };
      if (onboard && (dx || dy) && onboardT > 0.3) dismissOnboard(); // P8-T8: move to begin
      // Hold Shift to sprint (server validates against stamina). Send continuously
      // while held (server consumes one intent per tick), ~20Hz. Touch: push the joystick
      // to its edge to sprint (joyVec is the 0..1 push fraction — SP parity, MOB-T1).
      const sprint = anyDown("sprint") || (joyVec.x * joyVec.x + joyVec.y * joyVec.y) > 0.85
        || (gm.x * gm.x + gm.y * gm.y) > 0.85; // gamepad full-stick-push also sprints (input parity)
      sendAcc += k.dt();
      if (!menuOpen && (dx || dy) && sendAcc >= 0.05) { net.move(dx, dy, sprint); sendAcc = 0; }
      // Throttled footstep DUST while actually roaming. Faster cadence when sprinting. Gated off
      // menu/combat so it only puffs in-world. (The walking SFX was removed per user request.)
      stepAcc += k.dt();
      if (selfMoving && !menuOpen && !net.state.combat && stepAcc >= (sprint ? 0.24 : 0.34)) {
        stepAcc = 0;
        emit({ x: selfRender.x, y: selfRender.y + 16, n: 3, color: [150, 140, 122], speed: 16, life: 0.4, size: 2.6, spread: Math.PI * 0.9, dir: -Math.PI / 2, gravity: 30, drag: 2 }); // PV-T12 footstep dust
      }

      // Interaction SFX via state-diffs (no server event needed): level-up = a
      // team monster's level rose; chest-open = a chest right next to you vanished
      // (the <56px gate excludes chests that merely scrolled out of view range).
      // Read net.state.team (the full active-team: id/level/name) — NOT net.state.self.team,
      // which is only the in-round hp/max snapshot (no id/level), so the diff never fired and
      // the level-up burst was dead code (every monster skipped on the id==null guard).
      const myTeam = net.state.team;
      if (myTeam) for (const mon of myTeam) {
        if (!mon || mon.id == null) continue;
        const pl = prevLevels.get(mon.id);
        if (pl != null && mon.level > pl) { sfx("levelup"); emit({ x: selfRender.x, y: selfRender.y, n: 14, color: [255, 220, 120], speed: 70, life: 0.7, size: 3, gravity: -40, drag: 1.5 }); emitText({ x: selfRender.x, y: selfRender.y - 22, text: `${mon.name || "Monster"} Lv ${mon.level}`, color: [255, 224, 130], size: 13 }); } // PV-T12 level-up burst + label (PT2-T07)
        prevLevels.set(mon.id, mon.level);
      }
      const curChests = net.state.chests || [];
      if (prevChests && prevChests !== curChests) { // only diff when the snapshot replaced the array
        const sx = net.state.self.x, sy = net.state.self.y;
        for (const pc of prevChests) {
          if (!curChests.some((c) => c.x === pc.x && c.y === pc.y) && Math.hypot(pc.x - sx, pc.y - sy) < 56) { sfx("chest"); emit({ x: pc.x, y: pc.y, n: 12, color: [245, 210, 90], speed: 55, life: 0.6, size: 2.8, gravity: -30, drag: 1.5 }); emitText({ x: pc.x, y: pc.y - 18, text: "Chest opened!", color: [245, 214, 110], size: 14 }); } // PV-T12 chest-open sparkle + label (PT2-T07)
        }
      }
      prevChests = curChests;
      // Loot naming: when a NEW chain type lands in your inventory mid-round (chest
      // loot), name it with a floater — the chest-open sparkle only said "opened", not
      // WHAT you got. First frame seeds the set (no false floater on entry); a refill of
      // an already-owned chain (same id) is intentionally quiet.
      // Only diff when the snapshot actually REPLACED the chains array (m.you.chains arrived) — between
      // those it's unchanged, so skip the per-frame .map() array + new Set() allocation. Mirrors the
      // chest reference-gate above. First frame seeds the set (prevChainIds null → no false floater).
      const curChains = net.state.chains || NO_CHAINS;
      if (curChains !== prevChainsRef) {
        if (prevChainIds) {
          for (const c of curChains) {
            const id = c.chainId;
            if (!prevChainIds.has(id)) { const def = getSpiritChain(id); if (def) { sfx("pickup"); haptic(12); emitText({ x: selfRender.x, y: selfRender.y - 38, text: `+ ${def.name}`, color: [180, 240, 255], size: 14 }); } }
          }
        }
        const next = new Set();
        for (const c of curChains) next.add(c.chainId);
        prevChainIds = next;
        prevChainsRef = curChains;
      }

      // Storm-damage hit feedback (PV-T13): the continuous danger border tells you
      // you're *in* danger, but nothing marked the *moment* the storm actually drained
      // HP. Detect a team-HP drop while you're outside the safe circle (and not in a
      // duel, so combat damage isn't misattributed) → discrete red flash + burst +
      // haptic + a "STORM -N" floater. State-diff only, no extra snapshot payload.
      {
        const cir = net.state.circle, sf = net.state.self;
        const curTeamHp = (sf?.team || []).reduce((s, mo) => s + Math.max(0, mo.hp || 0), 0);
        const outside = !!(cir && sf && !net.state.combat && !net.state.roundResult &&
          ((sf.x - cir.x) ** 2 + (sf.y - cir.y) ** 2) > cir.r * cir.r);
        if (outside && prevTeamHp != null && curTeamHp < prevTeamHp) {
          stormHitT = k.time();
          haptic(20);
          if (!prefersReducedMotion()) addShake(0.34); // PV-A5: the storm kicks the camera
          const dmg = Math.round(prevTeamHp - curTeamHp);
          emit({ x: selfRender.x, y: selfRender.y, n: 10, color: [235, 70, 70], speed: 80, life: 0.5, size: 2.8, gravity: -10, drag: 2 });
          emitText({ x: selfRender.x, y: selfRender.y - 22, text: `Storm -${dmg}`, color: [255, 120, 120], size: 14 });
        }
        prevTeamHp = curTeamHp;
        // Ambient storm particles: drifting ash/embers around the tamer while in the
        // storm reinforce that you're being battered (pairs with the red border + STORM
        // floater). Throttled so the shared 220-cap fx pool isn't starved; a11y: slower
        // + sparser under reduce-motion.
        if (outside) {
          stormFxAcc += k.dt();
          const reduce = prefersReducedMotion();
          if (stormFxAcc >= (reduce ? 0.3 : 0.1)) {
            stormFxAcc = 0;
            const ang = Math.random() * Math.PI * 2, rad = 30 + Math.random() * 40;
            emit({ x: selfRender.x + Math.cos(ang) * rad, y: selfRender.y + Math.sin(ang) * rad, n: reduce ? 1 : 2, color: [170, 95, 90], speed: reduce ? 8 : 18, life: 0.9, size: 2.2, spread: Math.PI * 2, gravity: -6, drag: 1.2 });
          }
        }
      }

      // Controller actions (gamepad): map buttons to the SAME handlers as keyboard.
      // Edge-detected, so gamepadPressed() must run exactly once per frame. Bindings:
      // A/B/X/Y = attack 1-4 in combat (A = throw chain while roaming), LB = catch,
      // RB = flee. Menus + SP fight not wired yet (follow-up).
      const gpEdges = gamepadPressed();
      if (gpEdges.size && !menuOpen) {
        if (onboard && onboardT > 0.3) dismissOnboard();
        else if (net.state.combat) {
          for (let i = 0; i < 4; i++) if (gpEdges.has(i)) { const a = net.state.combat.attacks?.[i]; if (a) act({ kind: "attack", attackName: a.name }); }
          if (gpEdges.has(BTN.LB)) act({ kind: "catch" });
          if (gpEdges.has(BTN.RB)) act({ kind: "flee" });
        } else if (!net.state.roundResult && (gpEdges.has(BTN.A) || gpEdges.has(BTN.RT))) {
          throwEquippedChain(); // PV-T11: shared throw (wind-up tell + guards)
        }
      }

      // ── Client-side prediction + reconciliation for SELF (#10) ──
      // Integrate the player's OWN input locally each frame so movement responds INSTANTLY
      // instead of waiting a server round-trip (the old code only lerped toward the
      // snapshot → your own character lagged your input by the ping). Uses the SAME rule as
      // the server: BASE_SPEED × sprintMult, diagonals ×0.707, per-axis body-edge collision
      // via the shared isWalkable against the (seeded, identical) client map — so predicting
      // INTO a wall stops AT the wall exactly like the server (no penetrate-then-snap).
      const E = GAME.EFFECTIVE_TILE;
      // TQ-382: predict stamina locally so the sprint gate flips at the SAME stamina the server
      // enforces. The gate previously read net.state.stamina (the last snapshot's value — stale by
      // ping + snapshot interval), so the client kept predicting sprint speed for a few frames after
      // the server had already run dry and slowed to a walk → reconciliation yanked the player back
      // (the "lag when sprinting" rubberband, worst at depletion where the snap is largest). Mirror
      // the server's per-frame rp.stamina via the SHARED tickStamina (parity-guaranteed) and snap to
      // the authoritative value on each fresh snapshot (self-correcting — can't drift). freshSnap is
      // recomputed (not consumed) here; the rival loop below still owns the lastPlayersRef update.
      const staminaSnap = net.state.players !== lastPlayersRef;
      if (predStamina == null || staminaSnap) predStamina = net.state.stamina ?? GAME.SPRINT.STAMINA_MAX;
      const predicting = !net.state.combat && !menuOpen && (dx || dy);
      if (predicting) {
        let pdx = dx, pdy = dy;
        if (pdx !== 0 && pdy !== 0) { pdx *= 0.707; pdy *= 0.707; } // match the server's diagonal handling
        // Gate the predicted sprint by the SAME rule the server applies (sprintingNow: stamina floor
        // + hysteresis) using the locally-PREDICTED stamina (above) rather than the stale snapshot
        // value, then advance it one frame exactly as the server advances rp.stamina — so the gate
        // flips off in lockstep with the server and reconciliation has nothing to yank back.
        const predSprint = sprintingNow({ sprint, moving: true, stamina: predStamina, wasSprinting: predWasSprinting }, GAME);
        predWasSprinting = predSprint;
        predStamina = tickStamina(predStamina, predSprint, k.dt(), GAME); // drain while sprinting / regen otherwise, mirroring world.js:808
        const step = GAME.BASE_SPEED * sprintMult(predSprint, GAME) * k.dt();
        // Match the SERVER's play-area bound exactly ((mapSize-1)*E, world.js) so prediction can't
        // overshoot the authoritative clamp and rubberband at the far edge. (Latent today — the map
        // always carves a non-walkable border ring, so isWalkable stops you first — but keep the two
        // bounds identical so a future walkable-edge mapgen change can't expose a desync.) 0 when the
        // map isn't loaded yet → the clamp falls through to lower-bound only, as before.
        const R = GAME.PLAYER_RADIUS, maxXY = map?.mapSize ? (map.mapSize - 1) * E : 0;
        const clamp = (vv) => maxXY ? Math.min(maxXY, Math.max(0, vv)) : Math.max(0, vv);
        const nx = clamp(selfRender.x + pdx * step), ny = clamp(selfRender.y + pdy * step);
        if (edgeClearX(map, nx + Math.sign(pdx) * R, selfRender.y, R)) selfRender.x = nx; // TQ-499: full leading-edge (slide-safe corner guard), mirrors world.js
        if (edgeClearY(map, selfRender.x, ny + Math.sign(pdy) * R, R)) selfRender.y = ny;
      } else {
        predWasSprinting = false; // not moving → server resets rp.wasSprinting too (sprint must re-earn the MIN_TO_START floor)
        predStamina = tickStamina(predStamina, false, k.dt(), GAME); // idle → regen one frame, mirroring the server
      }
      // Reconcile toward the authoritative snapshot. Trust the local prediction within its LEGITIMATE
      // lead; only correct a divergence BEYOND that lead (a real server clamp / desync); hard-snap a
      // teleport. (TQ-85/TQ-178: trust within the lead whether moving or at rest — no backward drag; the
      // lagging snapshot converges UP to the predicted position since it shares the sim + map.)
      const ex = net.state.self.x - selfRender.x, ey = net.state.self.y - selfRender.y;
      const err = Math.hypot(ex, ey);
      // TQ-444: the authoritative snapshot LAGS the live prediction by ~RTT + the snapshot interval +
      // a tick of server input buffering, so while MOVING the prediction legitimately LEADS it by
      // (predicted speed × that lag). A FIXED 64px trust window was SMALLER than that lead at SPRINT
      // speed (320px/s) under real ping (≈ 320 × (0.2 + RTT) ≈ 80-200px), so a normal sprint was mistaken
      // for divergence and yanked back every frame — the prod "rubberband when moving fast" (reproduced
      // at RTT 336ms: 13 backward jumps, 412px total). SCALE the trust window by the expected lead, with
      // the old 64px as the floor so standing still / walking are unchanged. Self-correcting: the lagging
      // snapshot converges up to the predicted position (same sim + map), so trusting within the lead
      // leaves no drift; only a genuine divergence beyond it (or a teleport) still corrects.
      const lagS = 0.2 + (net.state.rtt || 0) / 1000; // snapshot interval (~0.133) + server input/tick buffer (~0.067) + RTT
      const leadSpeed = predicting ? GAME.BASE_SPEED * sprintMult(predWasSprinting, GAME) : 0;
      const trustR = Math.max(64, leadSpeed * lagS + 24); // expected prediction lead + a small margin; never below the old 64px floor
      const snapR = Math.max(220, trustR + 130);          // keep the hard teleport/respawn/desync snap comfortably above the trust window
      if (err > snapR) { selfRender.x = net.state.self.x; selfRender.y = net.state.self.y; } // teleport / respawn / desync → snap
      else if (err <= trustR) { /* trust local prediction — within the legitimate lead; moving or at rest */ }
      else { const rate = Math.min(1, k.dt() * 18); selfRender.x += ex * rate; selfRender.y += ey * rate; } // genuine divergence beyond the lead → firm, frame-rate-independent pull
      // Rivals: render INTERP_DELAY in the past, interpolated between buffered snapshots (TQ-478 jitter
      // buffer — see the helpers above). A fresh snapshot is detected by the players-array reference
      // changing (net replaces it each tick); each one appends a timestamped sample. moving/facing are
      // derived from the active segment's velocity → drives the walk anim. No extra server payload.
      const now = k.time();
      const rt = now - interpDelay(); // the past time we render remote entities at
      const freshSnap = net.state.players !== lastPlayersRef;
      lastPlayersRef = net.state.players;
      const gen = ++liveGen; // mark-and-sweep epoch shared by the monster/projectile loops below — no per-frame Set + keys() spread
      for (const p of net.state.players) {
        let r = othersRender.get(p.id);
        if (!r) { r = { x: p.x, y: p.y, vx: 0, vy: 0, buf: [], moving: false, dir: { x: 0, y: 1 } }; othersRender.set(p.id, r); pushSample(r, now, p.x, p.y); }
        r.live = gen;
        if (freshSnap) pushSample(r, now, p.x, p.y);
        sampleBuf(r, rt);
        r.moving = (r.vx * r.vx + r.vy * r.vy) > 16; // ~>4px/s → moving (drives walk anim + facing)
        if (r.moving) { r.dir.x = r.vx; r.dir.y = r.vy; } // mutate in place (r.dir always exists) — no per-frame object churn
      }
      for (const [id, r] of othersRender) if (r.live !== gen) othersRender.delete(id);

      // Wild monsters: the SAME interpolation jitter buffer as rivals, so an approaching monster glides
      // smoothly (the server moves only the "approacher" subset; most stay put → one repeated sample →
      // idle). moving/facing are DERIVED from the active segment's velocity → standard walk animation.
      const freshMon = net.state.monsters !== lastMonstersRef;
      lastMonstersRef = net.state.monsters;
      for (const mo of net.state.monsters) {
        let r = monsterRender.get(mo.id);
        if (!r) { r = { x: mo.x, y: mo.y, vx: 0, vy: 0, buf: [], bx: mo.x, by: mo.y, moving: false, dir: { x: 1, y: 0 } }; monsterRender.set(mo.id, r); pushSample(r, now, mo.x, mo.y); }
        r.live = gen;
        if (freshMon) pushSample(r, now, mo.x, mo.y);
        sampleBuf(r, rt);
        r.moving = (r.vx * r.vx + r.vy * r.vy) > 16; // ~>4px/s → walk + facing
        if (r.moving) { r.dir.x = r.vx; r.dir.y = r.vy; } // mutate in place (r.dir always exists) — no per-frame object churn
      }
      for (const [id, r] of monsterRender) if (r.live !== gen) monsterRender.delete(id);

      // Spirit-chain projectiles: a fast chain is read by WHERE IT IS NOW, so it stays on velocity
      // EXTRAPOLATION (not the interp delay used for players/monsters) — a render delay would visibly
      // lag the chain behind its real position and hurt aim/hit reads. Nudges toward the latest truth.
      for (const pr of net.state.projectiles) {
        let r = projRender.get(pr.id);
        if (!r) { r = { x: pr.x, y: pr.y }; projRender.set(pr.id, r); }
        r.live = gen;
        r.x = lerp(r.x + pr.vx * k.dt(), pr.x, 0.2);
        r.y = lerp(r.y + pr.vy * k.dt(), pr.y, 0.2);
        r.vx = pr.vx; r.vy = pr.vy; r.chainId = pr.chainId;
      }
      for (const [id, r] of projRender) if (r.live !== gen) projRender.delete(id);

      const sh = shakeOffset(); // PV-A5: trauma-based camera nudge (zero at rest)
      k.camPos(selfRender.x + sh.x, selfRender.y + sh.y);
      const t = net.state.time || 0;
      const mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, "0");
      const ping = net.state.rtt == null ? "" : `   ${net.state.rtt}ms`;
      // P6-T3 player list: name the rivals currently in view. AoI-filtered, so it
      // respects the "you only see those near you" design (Q13) — no full roster.
      const rivals = net.state.players || [];
      // Names truncated + count-capped + a hard line cap: guest nicks reach 20 chars, so the
      // un-bounded list (info label has no wrap width) sprawled across the whole screen with
      // long/many names. Show up to 3 short names, then "+N"; trunc the whole line as a backstop.
      const rivalLine = rivals.length
        ? trunc(`Rivals in view (${rivals.length}): ${rivals.slice(0, 3).map((p) => trunc(p.name || "?", 10)).join(", ")}${rivals.length > 3 ? `, +${rivals.length - 3}` : ""}`, 36)
        : "No rivals in view";
      // VS-8: keep gameplay info (timer/ping/name/rivals) but hide debug data
      // (map seed + live coords) in production — seed leaks map knowledge.
      const dev = import.meta.env.DEV;
      info.text =
        `Online   ${mm}:${ss} left${ping}${dev ? `   seed ${net.state.seed ?? "?"}` : ""}\n` +
        `You (${net.state.nickname ?? "?"})${dev ? `: (${Math.round(net.state.self.x)}, ${Math.round(net.state.self.y)})` : ""}\n` +
        rivalLine;

      // PT2-T10 objective line: contextual goal, hidden behind overlays.
      const circle = net.state.circle, self = net.state.self;
      const outsideZone = !!(circle && self && ((self.x - circle.x) ** 2 + (self.y - circle.y) ** 2) > circle.r * circle.r);
      objective.text = objectiveText({ circleStarted: !!circle, portalsOpen: (net.state.portals || []).length > 0, outsideZone });
      // Hide the retained HUD labels behind combat / result overlays AND under the
      // onboarding tutorial (they're at z=100 and otherwise bleed through the
      // immediate-mode dim — SP fix landed in d1d4642; this is the MP parity). `disc` adds
      // the connection-lost/reconnecting overlay (it dims the screen too).
      const disc = !net.state.connected;
      objective.hidden = !!(net.state.combat || net.state.roundResult || onboard || menuOpen || disc);

      // Hide the movement hint behind the combat / result overlays + onboarding + pause + disconnect.
      // Preserve the orientation gate set above (hint is square-aspect-only — in portrait/landscape
      // it would collide with the gutter objective / chain HUD), then OR in the overlay conditions.
      hint.hidden = hint.hidden || !!(net.state.combat || net.state.roundResult || onboard || menuOpen || disc);
      // Hide the top-left info on onboarding AND on the end-of-run result screen: the
      // run is over there, so the "N:NN left" timer + "rivals in view" line are stale and
      // clutter the result card (objective + hint are already hidden for the same reason).
      // Kept visible during combat (live status still matters mid-fight).
      info.hidden = !!(onboard || net.state.roundResult || menuOpen || disc);

      // Clear the "Resolving…" indicator once a turn result / end arrives.
      const cb = net.state.combat;
      if (cb) {
        if (cb.log.length !== lastLogLen || cb.outcome) {
          // A turn we initiated with an ATTACK just resolved → play the standard attack lunge on
          // the player's monster, then the enemy's counter-lunge a beat later (exercises the
          // idle/walk/attack clip's ATTACK in combat). Guard on `awaiting` so only player-sent
          // attacks trigger it, and not catch/flee/swap/item.
          if (awaiting && combatPress && combatPress.kind === "attack") {
            activeAtkT0 = k.time();
            enemyAtkT0 = cb.outcome ? -1 : k.time() + ATTACK_DURATION * 0.55; // no counter once the fight's over
          }
          // A catch we initiated just resolved → play the verdict on the held chain: snap-shut (caught) or
          // blow-outward (broke free). The throw arc already started on the press (catchThrowT0).
          if (awaiting && combatPress && combatPress.kind === "catch" && catchThrowT0 >= 0) {
            catchResolveKind = cb.outcome === "caught" ? "caught" : "broke";
            catchResolveT0 = k.time();
            if (catchResolveKind === "caught") sfx("catch"); else { sfx("miss"); haptic(20); } // caught jingle / broke-free thud + buzz
          }
          awaiting = false; lastLogLen = cb.log.length;
        }
      } else { awaiting = false; lastLogLen = 0; activeAtkT0 = -1; enemyAtkT0 = -1; }
    });

    k.onDraw(() => {
      // Seeded map — culled floor, now textured per tile type + rotation
      // (src/render/tiles.js) instead of flat color rects.
      revealAround(); // fog of war: reveal the disc around the player this frame
      drawTiles(k, map, net.state.self.x, net.state.self.y, tileCache, GAME.EFFECTIVE_TILE, isExplored);

      // Safe zone (shrinking) + extraction portals.
      // Storm wall (PV-T13): the closing safe-zone edge reads as a glowing, pulsing
      // energy barrier — an outward glow band fading into the storm + a bright pulsing
      // inner edge — instead of one flat thin outline.
      if (net.state.circle) {
        // a11y: freeze the storm-wall breathing pulse under reduce-motion — the
        // barrier stays fully visible (a critical danger landmark), just steady.
        const reduce = prefersReducedMotion();
        const c = net.state.circle, pulse = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(k.time() * 3);
        for (let i = 3; i >= 1; i--) {
          k.drawCircle({ pos: k.vec2(c.x, c.y), radius: c.r + i * 7, fill: false, outline: { width: 4, color: k.rgb(...THEME.storm) }, opacity: (0.30 - i * 0.07) * pulse });
        }
        k.drawCircle({ pos: k.vec2(c.x, c.y), radius: c.r, fill: false, outline: { width: 3, color: k.rgb(...THEME.stormLite) }, opacity: reduce ? 0.7 : 0.55 + 0.25 * Math.sin(k.time() * 3) });
      }
      for (const p of net.state.portals) {
        // First-seen time (client-side) drives the rise-from-the-ground animation
        // when a portal pops into the snapshot.
        const key = `${p.x},${p.y}`;
        let born = portalSeen.get(key);
        if (born == null) { born = k.time(); portalSeen.set(key, born); }
        drawPortal(k, { x: p.x, y: p.y, t: k.time(), age: k.time() - born });
      }

      const now = k.time();
      // Loot chests sit on the ground — drawn under the entities.
      for (const c of net.state.chests) drawChest(k, { x: c.x, y: c.y, t: now });

      // Y-sorted entities (monsters + other players + you): nearer (lower y) draw
      // on top of farther (higher y) ones, so overlaps read as depth rather than
      // array/draw order (P-natural top-down look).
      ents.length = 0; // reuse the scene-scoped array (declared above) — clear, then repopulate this frame
      htmlEnts.length = 0; // TQ-262: same for the per-frame live-DOM monster list
      const reduceMo = prefersReducedMotion(); // a11y: once per frame, freeze the idle bob
      const mSize = 128 * 0.45;
      // Constant colours/tints used by the per-entity draw closures below — built once
      // per frame instead of re-allocated inside each monster/player closure (which each
      // run once per entity per frame). None are mutated by the draw helpers (verified:
      // drawMonster reads tint[0..2]; drawCharacter spreads color; the draw adapter copies
      // k.rgb channels out immediately).
      const shadowCol = k.rgb(0, 0, 0), monTint = [220, 180, 80], rivalBodyCol = [210, 90, 90], nameCol = k.rgb(...UI.text);
      for (const mo of net.state.monsters) {
        const r = monsterRender.get(mo.id) || { x: mo.x, y: mo.y, bx: mo.x, by: mo.y, moving: false, dir: { x: 1, y: 0 } };
        // TQ-262: if this monster's TYPE carries a renderable html model, it renders via the DOM overlay
        // (collected below + synced after the gate) instead of the canvas sprite — keep its shadow + Lv
        // label on the canvas either way. usesDom is false for all current content (no html models yet).
        const mtype = getMonsterType(mo.typeName);
        const useDom = !!mtype && htmlOverlay.usesDom(mo.typeName, mtype);
        const facing = r.dir && r.dir.x < 0 ? -1 : 1;
        const moving = !reduceMo && r.moving;
        if (useDom) htmlEnts.push({ id: mo.id, typeName: mo.typeName, type: mtype, x: r.x, y: r.y, designSize: mSize, facing, moving, attacking: false });
        ents.push({ y: r.y, draw: () => {
          k.drawEllipse({ pos: k.vec2(r.x, r.y + 20), radiusX: 15, radiusY: 5, color: shadowCol, opacity: 0.28 }); // ground shadow
          // Standardized monster animation (render/monster.js): an APPROACHING monster (server moved
          // it → non-zero interpolated velocity) plays WALK + faces its heading; a stationary one
          // IDLES. Per-monster clock offset from its stable BIRTH position so they don't breathe in
          // unison; a11y freezes the clock.
          if (!useDom) {
            const anim = moving ? "walk" : "idle";
            const t = reduceMo ? 0 : now + (r.bx + r.by) * 0.013;
            drawMonster(k, { typeName: mo.typeName, x: r.x, y: r.y, size: mSize, anim, t, facing, tint: monTint });
          }
          // TQ-362: the over-monster "Lv.N" threat label was removed from the overworld (combat HUD /
          // roster / lobby level displays are intentionally kept).
        } });
      }
      for (const p of net.state.players) {
        const r = othersRender.get(p.id) || p;
        ents.push({ y: r.y, draw: () => {
          drawCharacter(k, { x: r.x, y: r.y, t: now + (p.id ? p.id.length : 0), moving: r.moving, color: rivalBodyCol, dir: r.dir, skin: getSkin(p.skinId), chainTier: p.chainTier ?? null, model: getCharacterSkin(p.charId).model }); // CN-12: rival's own chain skin + body model; SC-tier: rival's equipped chain TIER core (server-synced) shows on their model too (unknown/old id → cloak)
          k.drawText({ text: trunc(p.name || "?", 14), pos: k.vec2(r.x, r.y - 40), size: 12, font: "gameFont", anchor: "center", color: nameCol }); // cap the nick (guest names run to 20) so the floating nameplate can't sprawl / overlap a clustered rival
        } });
      }
      ents.push({ y: selfRender.y, draw: () => {
        const meCos = getEquippedCharacterSkin(); // your character cosmetic (accent + cloak) — mirrors SP; safe for self (camera-centered, no self/rival color-coding to preserve)
        drawCharacter(k, { x: selfRender.x, y: selfRender.y, t: now, moving: selfMoving, color: meCos.accent, cloak: meCos.cloak, model: meCos.model, dir: selfDir, skin: getEquippedSkin(), chainTier: equippedChain()?.def?.tier ?? null }); // SC-tier: held chain core shows YOUR active slot's tier
        // TQ-517: bring the lobby's slim under-player sprint-stamina bar into the round too — world-space,
        // shown only while draining/recovering (hidden at full so it's unobtrusive), teal → amber when low.
        // Mirrors hub.js (TQ-89); uses the locally-predicted stamina for smoothness (the team-cluster HUD
        // bar still shows the authoritative value). Not during combat — you're locked on the battle stage.
        const stam = predStamina ?? net.state.stamina ?? GAME.SPRINT.STAMINA_MAX;
        if (!net.state.combat && stam < GAME.SPRINT.STAMINA_MAX - 0.5) {
          const sr = Math.max(0, Math.min(1, stam / GAME.SPRINT.STAMINA_MAX)), bw = 34;
          k.drawRect({ pos: k.vec2(selfRender.x - bw / 2, selfRender.y + 26), width: bw, height: 4, radius: 2, color: k.rgb(0, 0, 0), opacity: 0.4 });
          k.drawRect({ pos: k.vec2(selfRender.x - bw / 2, selfRender.y + 26), width: bw * sr, height: 4, radius: 2, color: k.rgb(...(sr > 0.3 ? THEME.teal : THEME.amber)) });
        }
        k.drawText({ text: trunc(net.state.nickname || "You", 14), pos: k.vec2(selfRender.x, selfRender.y - 40), size: 12, font: "gameFont", anchor: "center", color: nameCol });
      } });
      ents.sort(byY);
      // While the pause menu, the end-of-run result card, OR the CONNECTION LOST /
      // RECONNECTING overlay is up, skip the LIVE actors (monsters / rivals / you) and
      // particles: they're camera-centered and brightly lit (the glowing spirit chain, a
      // wild monster's "Lv.N" label), so they punched through the dim — the chain behind the
      // pause buttons, a wild monster above the result card, your own avatar + nameplate +
      // chain ring behind CONNECTION LOST. The dimmed tiles/circle/portals stay as a calm
      // backdrop. (overlay-bleed pattern — same gate as the HUD clusters use net.state.connected.)
      if (!menuOpen && !net.state.roundResult && net.state.connected) {
        for (const e of ents) e.draw();
        drawFx(k); // world particles (footstep dust, etc.) — over the floor, under the HUD (PV-T12)
      }
      // TQ-262: drive the live-DOM monster overlay. Sync only while the overworld actors are shown and
      // not in the battle panel; otherwise hide the DOM nodes. Clipped to the play window so nodes never
      // bleed into the HUD gutters. No-op for current content (no monster has an html model yet).
      if (!menuOpen && !net.state.roundResult && net.state.connected && !net.state.combat) {
        htmlOverlay.sync(htmlEnts, { clipDesign: playWindowRect(k.width(), k.height(), { maxAspect: winAspect() }) });
      } else if (!net.state.combat) {
        htmlOverlay.clear(); // menu / result / disconnected — hide overworld nodes (combat owns the overlay itself, below)
      }

      // In-flight spirit chains (in-air — over the entities). (Throw-line indicator removed — on PC you
      // aim with the mouse cursor; on touch the throw goes along your heading.)
      for (const pr of projRender.values()) {
        drawSpiritChainProjectile(k, pr, chainColor(getSpiritChain(pr.chainId)), now);
      }

      // Ambient atmosphere overlay (vignette + spirit-light glow + drifting motes/wisps) removed —
      // the overworld round renders without ambiance/glow while walking around. The storm
      // border/warning still draws on top via drawDanger (functional danger feedback, kept).

      // Square play-window frame (user design 2026-06-08): mark the canonical square
      // play area; the map stays visible outside it (peripheral context that grows with
      // resolution). The HUD, minimap, combat panel and touch widgets all anchor to this
      // square now (WIN-T2/T3 landed) and portrait is enabled (WIN-T4); `dim: 0` keeps the
      // peripheral map fully visible (dim is a tunable). Drawn during combat too: the battle
      // stage only fills the SQUARE, so in portrait the gutter BELOW the panel was showing the
      // frozen world — the bezel covers it (no-op in landscape, where there are no T/B gutters).
      // Still skipped under result/onboarding (those have their own full-screen dim). HUD/stage/
      // panel all draw after this, so they stay on top of the bezel.
      if (!net.state.roundResult && !onboard) drawPlayWindow(k, { maxAspect: winAspect() });

      // Virtual joystick (touch) — left side, hidden during combat / results.
      if (TOUCH && !net.state.combat && !net.state.roundResult) {
        const joyActive = joyId !== null;
        // Standardized stick (shared with the hub): faint discoverable hint at rest, bright ring + knob when active.
        drawJoystick(k, { base: joyActive ? joyBase : joyRest(), thumb, active: joyActive, radius: JOY_R });
        // Touch THROW button (right thumb) — fixes the mobile gap where a chain
        // could only be thrown via the keyboard (Space/Q). Dimmed when no chain is equipped.
        const eqc = equippedChain();
        // TQ-180: return-gated cooldown — gray the Throw button while this player's chain is still
        // out (one in-flight chain at a time), re-enabling when the boomerang returns.
        const chainOut = (net.state.projectiles || []).some((pr) => pr.owner === net.state.playerId);
        const hasChain = !!eqc && !chainOut;
        // Boomerang: throws are free — show the chain's capture charges (the real resource).
        const charges = eqc && eqc.cs ? (eqc.cs.durability ?? eqc.def?.durability ?? null) : null;
        drawTouchButton(k, {
          pos: throwBtnC(), radius: THROW_R, label: "Throw", accent: THEME.water, enabled: hasChain,
          sub: charges != null ? `${charges} charge${charges === 1 ? "" : "s"}` : null,
        });
        // TQ-488: dedicated chain-swap button (only when >1 chain is loaded) — colored by the
        // active chain so the loadout reads at a glance; tap cycles to the next slot.
        if (!onboard && (net.state.equippedChainIds || []).length > 1) {
          const swCol = eqc && eqc.def ? chainColor(eqc.def) : THEME.teal;
          const tier = eqc && eqc.def ? eqc.def.tier : null;
          drawTouchButton(k, { pos: swapBtnC(), radius: SWAP_R, label: "Swap", accent: swCol, enabled: true, sub: tier != null ? `T${tier}` : null });
        }
        // TQ-487: drag-to-aim indicator — an arrow from the player (square centre) showing the
        // throw heading while the THROW button is being dragged.
        if (throwAim && throwAim.dragged) {
          const sq2 = hudSlots().square;
          const col = eqc && eqc.def ? chainColor(eqc.def) : [120, 220, 255];
          const cx = sq2.cx, cy = sq2.cy, L = Math.min(sq2.size * 0.42, 230);
          const tip = k.vec2(cx + throwAim.dir.x * L, cy + throwAim.dir.y * L);
          const ang = Math.atan2(throwAim.dir.y, throwAim.dir.x), head = 16, a1 = ang + Math.PI * 0.82, a2 = ang - Math.PI * 0.82;
          k.drawLine({ p1: k.vec2(cx + throwAim.dir.x * 20, cy + throwAim.dir.y * 20), p2: tip, width: 4, color: k.rgb(...col), opacity: 0.85, fixed: true });
          k.drawLine({ p1: tip, p2: k.vec2(tip.x + Math.cos(a1) * head, tip.y + Math.sin(a1) * head), width: 4, color: k.rgb(...col), opacity: 0.85, fixed: true });
          k.drawLine({ p1: tip, p2: k.vec2(tip.x + Math.cos(a2) * head, tip.y + Math.sin(a2) * head), width: 4, color: k.rgb(...col), opacity: 0.85, fixed: true });
        }
        // MB-11: touch pause button (top-center) — opens the pause/leave menu.
        if (!onboard) {
          const [pbx, pby, pbw, pbh] = pauseBtnRect();
          // #68: route through THEME (was raw RGB) — matches the identical SP pause button
          // (game.js) so the two stay consistent + adapt to palette changes.
          k.drawRect({ pos: k.vec2(pbx, pby), width: pbw, height: pbh, radius: 8, color: k.rgb(...THEME.bg), opacity: 0.6, outline: { width: 1, color: k.rgb(...THEME.line) }, fixed: true });
          k.drawRect({ pos: k.vec2(pbx + pbw / 2 - 7, pby + 9), width: 5, height: pbh - 18, radius: 1, color: k.rgb(...THEME.text), fixed: true });
          k.drawRect({ pos: k.vec2(pbx + pbw / 2 + 2, pby + 9), width: 5, height: pbh - 18, radius: 1, color: k.rgb(...THEME.text), fixed: true });
        }
      }

      // Minimap + team HP + danger warning (hidden behind the round-result overlay).
      // Gated on !onboard too: every sibling HUD cluster (team/chain/biome/objective/info)
      // hides under the first-run tutorial dim, but the minimap was missed and bled through
      // it in the top-right corner — the same first-impression inconsistency.
      // Gated on !combat too (TQ fight-focus): the minimap is a roaming aid; during a fight
      // the screen should be a focused battle stage + bottom panel, with NO side-gutter HUD
      // ("the fight screen still has the old format and inventory menus on the side" — Dominik).
      if (!net.state.combat && !net.state.roundResult && !onboard && !menuOpen && net.state.connected) drawMinimap();
      // (B) The team cluster grows DOWN from the square top; the combat panel rises from
      // the square bottom. In a tight (portrait) viewport — the shim's design height is a
      // fixed 720, so a phone-portrait square is only ~405 tall — the two collide. During
      // combat, draw the cluster only if it clears the panel (landscape has room →
      // unchanged; portrait combat → hidden, the panel + swap menu are the focus).
      // Gated on !onboard too: the team + chain HUD are bright clusters that bled through
      // the onboarding dim in the top-left while the objective/hint/info labels + biome
      // chip were already hidden there — an inconsistency on the first-impression screen.
      // Task: the lobby's identity+inventory panel in the cave's left gutter (landscape, roaming).
      const showLobby = lobbyPanelActive();
      if (showLobby) {
        const hud = hudSlots();
        const gx = hud.team.x, gy = hud.team.y + 64;        // below the info line (timer/name/rivals)
        const gw = Math.max(150, (hud.gutterW || 256) - 24);
        const gmaxH = Math.max(150, hud.biome.y - 18 - gy); // stop above the gutter-foot biome chip
        drawHubPanel(k, { x: gx, y: gy, w: gw, maxH: gmaxH, character: lobbyChar, title: "Your Tamer" });
      }
      // Team HP cluster is a roaming HUD only. Hidden during combat (TQ fight-focus): the
      // combat panel shows the active monster's HP and the Swap menu reaches the bench, so the
      // side-gutter team cluster is the "inventory menu on the side" Dominik asked to remove.
      if (!net.state.combat && !net.state.roundResult && !onboard && !menuOpen && net.state.connected) {
        if (!showLobby) drawTeamHp(); // the lobby panel already shows the team
      }
      if (!showLobby && !net.state.combat && !net.state.roundResult && !onboard && !menuOpen && net.state.connected) drawChainHud();
      if (!net.state.combat && !net.state.roundResult && !onboard && !menuOpen && net.state.connected) { const b = hudSlots().biome; drawBiomeChip(k, { x: b.x, y: b.y, map, wx: selfRender.x, wy: selfRender.y }); } // HUD-OUT: biome chip in the gutter
      if (!net.state.roundResult && !onboard && !menuOpen && net.state.connected) drawKillFeed();
      drawCombatNotice(); // FGT-T1: transient "combat judge offline" toast
      drawLootNotice();   // TQ-66: transient "bag full — item left behind" toast
      if (onboard && !net.state.combat && !net.state.roundResult) drawOnboarding(); // P8-T8 overlay over the HUD
      // Gated on !menuOpen too: the "OUTSIDE SAFE ZONE" danger banner bled through the pause
      // dim and collided with the "PAUSED" title (worst case of the overlay-bleed pattern).
      if (!net.state.combat && !net.state.roundResult && !menuOpen && !onboard && net.state.connected) drawDanger();
      if (!net.state.roundResult && !onboard && net.state.connected) drawStormHit(); // PV-T13: discrete storm-damage flash (fades even after re-entering the zone)
      if (!net.state.combat && !net.state.roundResult && !menuOpen && !onboard && net.state.connected) drawPortalCompass();
      if (!net.state.combat && !net.state.roundResult && !menuOpen && !onboard && net.state.connected) drawTimeWarning();

      // Combat overlay (server locks movement during a fight). Tappable buttons;
      // keyboard 1-4 / C / F still work on desktop.
      const c = net.state.combat;
      if (c) {
        // MB-4: content anchors `safeInset.bottom` above the screen edge (so the
        // buttons/log clear the home-bar); the background fill (height H) still spans
        // down to the very bottom behind it. At zero insets this is the old layout.
        // WIN-T3: content (combatant rows + buttons + floaters) is laid out within the
        // square play window; the dark panel bar stays full-width as a clean backdrop.
        const pw = playWindowRect(k.width(), k.height(), { maxAspect: winAspect() });
        // WIN-T3 fix: vertical anchor follows the square (matches combatButtons()), so
        // the panel + its content rise with the square in portrait. backdrop top+H lands
        // on pw.bottom; landscape unchanged (pw.bottom === k.height()).
        const top = Math.min(k.height(), pw.bottom) - COMBAT_H - safeInset.bottom, H = COMBAT_H + safeInset.bottom, m = pw.x + 12, W = pw.w - 24; // TQ-494: rows span the full 4:3 width (was pw.size)
        // Hit-flash bookkeeping: flash a row when its HP drops; reset per-side trackers
        // on a new combat so a stale value can't false-trigger on the first frame.
        const tF = k.time();
        if (c.combatId !== lastCombatId) { prevEnemyHp = prevActiveHp = null; caughtFxDone = false; dmgFloaters = []; newSpeciesT = -9; lastCombatId = c.combatId; battleIntroT0 = tF; catchThrowT0 = -9; catchResolveT0 = -9; catchResolveKind = null; combatInspect = null; sfx("throw"); if (c.enemy && !c.pvp) markEncountered(c.enemy.typeName); } // TQ-125: drop any open inspect when a new fight starts // bestiary "seen" state (wild only, not PvP) + kick off the entry cinematic (transition → chain throw → spawn)
        if (c.enemy && prevEnemyHp != null && c.enemy.currentHealth < prevEnemyHp) { const d = prevEnemyHp - c.enemy.currentHealth, fr = c.enemy.maxHealth ? Math.min(1, d / c.enemy.maxHealth) : 0; hitFlashE = tF; if (!prefersReducedMotion()) addShake(Math.min(0.6, 0.12 + fr * 0.45)); emit({ x: pw.cx, y: top + 26, n: 6 + Math.round(fr * 10), color: [255, 180, 120], speed: 110, life: 0.4, size: 2.5, drag: 2, fixed: true }); dmgFloaters.push({ x: pw.right - 92, y: top + 18, dmg: Math.round(d), col: [255, 210, 90], t0: tF }); } // hit-sparks + damage-scaled shake/sparks + number (PV-A5: your hit lands)
        if (c.enemy && prevEnemyHp != null && c.enemy.currentHealth > prevEnemyHp) dmgFloaters.push({ x: pw.right - 92, y: top + 18, dmg: Math.round(c.enemy.currentHealth - prevEnemyHp), col: [120, 230, 150], t0: tF, heal: true }); // VS-22: heal +N
        prevEnemyHp = c.enemy ? c.enemy.currentHealth : null;
        if (c.active && prevActiveHp != null && c.active.currentHealth < prevActiveHp) { const d = prevActiveHp - c.active.currentHealth, fr = c.active.maxHealth ? Math.min(1, d / c.active.maxHealth) : 0; hitFlashA = tF; haptic(15); if (!prefersReducedMotion()) addShake(Math.min(0.9, 0.2 + fr * 0.7)); emit({ x: pw.cx, y: top + 68, n: 6 + Math.round(fr * 10), color: [255, 180, 120], speed: 110, life: 0.4, size: 2.5, drag: 2, fixed: true }); dmgFloaters.push({ x: pw.right - 92, y: top + 60, dmg: Math.round(d), col: [255, 90, 90], t0: tF }); } // hit-sparks + haptic + damage-scaled shake/sparks + number (PV-A5: you take a hit)
        if (c.active && prevActiveHp != null && c.active.currentHealth > prevActiveHp) dmgFloaters.push({ x: pw.right - 92, y: top + 60, dmg: Math.round(c.active.currentHealth - prevActiveHp), col: [120, 230, 150], t0: tF, heal: true }); // VS-22: heal +N
        prevActiveHp = c.active ? c.active.currentHealth : null;
        const eF = Math.max(0, 1 - (tF - hitFlashE) / 0.3), aF = Math.max(0, 1 - (tF - hitFlashA) / 0.3);
        // Catch-success sparkle (PV-T12, screen-space) — the taming payoff; burst once at the captured row.
        if (c.outcome === "caught" && !caughtFxDone) {
          caughtFxDone = true; haptic([0, 30, 40, 60]); emit({ x: pw.cx, y: top + 26, n: 22, color: [120, 240, 255], speed: 95, life: 0.85, size: 3, gravity: -25, drag: 1.5, fixed: true }); // MB-12: catch-success buzz
          // PV-T15: first-ever capture of this species (persisted client-side, so it
          // works without the vault the in-round client doesn't carry) → milestone
          // chime + gold burst on top of the teal catch sparkle; banner drawn below.
          // Skip when the catch was RELEASED (collection full): the monster wasn't kept,
          // so it isn't "tamed" — marking the dex / firing NEW SPECIES would contradict
          // the "RELEASED" line and the lifetime "caught" stat (which also skips it).
          if (c.enemy && c.placement !== "released" && markDiscovered(c.enemy.typeName)) { newSpeciesT = tF; sfx("levelup"); emit({ x: pw.cx, y: top + 26, n: 24, color: [255, 214, 110], speed: 150, life: 1.1, size: 3, gravity: 120, drag: 0.6, fixed: true }); }
        }
        // Pokémon-style battle stage (over the frozen world, above the panel) + the
        // entry cinematic: a transition wipe, the enemy already on the field, then the
        // tamer throwing the equipped spirit chain to summon THEIR OWN monster (it bursts
        // out of the chain). The tamer wears the player's equipped character colours.
        combatHtmlEnts.length = 0; // TQ-262: rebuilt by drawBattleStage for combatants with an html model
        if (c.enemy) {
          // 0..1 progress of each side's one-shot attack lunge (0 when not mid-lunge).
          const atkPhase = (t0) => (t0 >= 0 && tF >= t0 && tF < t0 + ATTACK_DURATION) ? (tF - t0) / ATTACK_DURATION : 0;
          // TQ-502: tint the fancy HTML/CSS fight backdrop by the biome the player is fighting in.
          const _bx = net.state.self?.x ?? 0, _by = net.state.self?.y ?? 0;
          drawBattleStage(k, {
            rect: pw, stageBottom: top, enemy: c.enemy, active: c.active,
            biomeName: map ? biomeNameAt(map, _bx, _by) : null,
            biomeAccent: map ? biomeTintAt(map, Math.floor(_bx / GAME.EFFECTIVE_TILE), Math.floor(_by / GAME.EFFECTIVE_TILE)) : null,
            chainCol: chainColor(getSpiritChain(net.state.equippedChainId)),
            chainTier: getSpiritChain(net.state.equippedChainId)?.tier ?? null, // SC-tier: combat tamer's held core = active slot tier (the chain "available in combat")
            charSkin: getEquippedCharacterSkin(),
            time: tF, introElapsed: tF - battleIntroT0, reducedMotion: prefersReducedMotion(),
            activeAttack: prefersReducedMotion() ? 0 : atkPhase(activeAtkT0),
            enemyAttack: prefersReducedMotion() ? 0 : atkPhase(enemyAtkT0),
            htmlSink: combatHtmlEnts,
            // Catch cinematic: chain thrown AT the enemy (catchThrowT0), then the verdict (catchResolveKind).
            catchElapsed: catchThrowT0 >= 0 ? tF - catchThrowT0 : -1,
            catchResolve: catchResolveKind,
            catchResolveElapsed: catchResolveT0 >= 0 ? tF - catchResolveT0 : -1,
          });
        }
        // TQ-262: sync the live-DOM overlay with the combatants (screen-space, no play-window clip). The
        // battle panel draws over the world, so combat owns the overlay here (the overworld branch above
        // skips clearing while in combat). Empty sink (no html-model combatant) → nodes culled.
        // TQ-500: the live-DOM combatants sit ABOVE the canvas, so a canvas-drawn modal (the monster-
        // detail inspect popup, the pause menu, the round-result card, or the disconnect overlay) can't
        // occlude them — they'd bleed OVER it. Hide the DOM combatants while any such modal is up (the
        // inspect popup shows its OWN monster image; the others want the stage hidden anyway).
        if (combatInspect || menuOpen || net.state.roundResult || !net.state.connected) htmlOverlay.clear();
        else htmlOverlay.sync(combatHtmlEnts, { fixed: true });
        k.drawRect({ pos: k.vec2(0, top), width: k.width(), height: H, color: k.rgb(...UI.panel), opacity: 0.94, fixed: true });
        // c.enemy / c.active can be absent if a malformed/skewed combatStart set state.combat
        // without them (net.js:44 guards the same protocol-skew class). drawCombatant no-ops on a
        // null mon, but the TITLE strings deref first — guard them so onDraw can't throw and blank
        // the whole round every frame (mirrors the guarded reads at 1158/1166).
        const enemyTitle = !c.enemy ? "" : c.pvp ? `${c.opponent || "Rival"}: ${c.enemy.typeName}` : `Wild ${c.enemy.typeName}`;
        drawCombatant(c.enemy, top + 8, enemyTitle, m, W, eF, "enemy");
        drawCombatant(c.active, top + 50, c.active?.name, m, W, aF, "self");
        // TQ-125: remember the two header rows' screen rects so a tap can open the shared detail popup.
        combatRowRects = { enemy: [m - 8, top + 5, W + 16, 42], active: [m - 8, top + 47, W + 16, 42] };
        const nowC = k.time();
        // Input is locked while the AI judge resolves the turn (~1-2s) or we await a
        // PvP opponent's move — dim the action buttons so they read as inactive
        // (taps are no-ops here) rather than looking live but doing nothing.
        const inputLocked = !c.outcome && (awaiting || c.waiting);
        const lockDim = inputLocked ? 0.4 : 1;
        for (const b of combatButtons()) {
          const [x, y, w, h] = b.rect;
          const aff = b.affordable !== false;
          const accent = elemColor(); // shared neutral accent (attack pills no longer element-tinted)
          // Subtle accent-tinted dark fill. Base fill uses THEME.surface2 (violet, on-palette) — was
          // [40,55,80] slate that visibly clashed with the rest of the violet UI (audit HIGH).
          const baseRaw = UI.track; // THEME.surface2 = [34, 29, 49]
          const base = [baseRaw[0] + (accent[0] - baseRaw[0]) * 0.22, baseRaw[1] + (accent[1] - baseRaw[1]) * 0.22, baseRaw[2] + (accent[2] - baseRaw[2]) * 0.22];
          // Brief press-flash on the just-tapped button (tap feedback the mobile controls lacked).
          const pressed = combatPress && combatPress.kind === b.action.kind && combatPress.name === (b.action.attackName || b.action.kind) && nowC - combatPress.t < 0.18;
          const fill = pressed ? base.map((v) => Math.min(255, v + 60)) : base;
          // Dimensional-pill body (fill + sheen + shade + rim) drawn by the SHARED theme.drawPillFill
          // — the same recipe drawButton uses — so the combat action pills read as the same button as
          // every menu/station, and any gradient enhancement propagates to both automatically (no more
          // hand-mirror drift). Combat passes its element-tinted fill + accent outline + the affordable/
          // lock dim folded into every layer's opacity; shadeAmt 22 keeps combat's slightly lighter shade.
          drawPillFill(k, { rect: [x, y, w, h], base: fill, fillCol: fill, radius: 14,
            outline: accent, outlineW: pressed ? 3 : 2, fillOp: (aff ? 1 : 0.45) * lockDim,
            sheenOp: (aff ? 0.4 : 0.18) * lockDim, shadeOp: (aff ? 0.32 : 0.12) * lockDim,
            rimOp: (pressed ? 0.72 : 0.5) * (aff ? 1 : 0.45) * lockDim, shadeAmt: 22, fixed: true });
          // Auto-shrink the label so a long attack name ("Riddle of the Sands") fits ~2 lines in
          // a narrow button instead of wrapping to 3-4 lines that overflow + bury the EN cost.
          // Wide (landscape) buttons keep size 14; only cramped ones shrink (min 10).
          const mnSize = Math.max(10, Math.min(14, 2 * (w - 12) * 14 / (7.5 * Math.max(1, b.label.length))));
          // Then cap to a 2-LINE budget at that size: at min font a 27-char name still word-wrapped
          // to 3 lines on a narrow portrait button, and the 3rd line ("Tempest") collided with the
          // EN cost row. Attack buttons (cost shown) get 2 lines; the cost-less Catch/Swap/Flee get 3.
          const perLine = Math.max(4, Math.floor((w - 12) / (mnSize * 0.54)));
          const lbl = trunc(b.label, (b.cost != null ? 2 : 3) * perLine);
          // TQ-356: on a cost button, nudge the name up + the EN row down so a 2-line attack name
          // ("Riddle of the Sands") clears the cost instead of touching it (was h/2-7 name / h-13 EN).
          k.drawText({ text: lbl, pos: k.vec2(x + w / 2, y + (b.cost != null ? h / 2 - 10 : h / 2)), size: mnSize, font: "gameFont", anchor: "center", color: k.rgb(...UI.text), width: w - 10, opacity: (aff ? 1 : 0.55) * lockDim, fixed: true });
          if (b.cost != null) k.drawText({ text: `EN ${b.cost}`, pos: k.vec2(x + w / 2, y + h - 10), size: 11, font: "gameFont", anchor: "center", color: k.rgb(...UI.body), opacity: (aff ? 0.9 : 0.45) * lockDim, fixed: true });
        }
        // TQ-71: full attack description preview — hovered (desktop) or long-pressed (touch). Floating
        // box sized to its text + clamped to the panel, flips below the button when there's no room above.
        let atkTip = null;
        if (!TOUCH) {
          const mp = k.mousePos();
          for (const b of combatButtons()) {
            if (b.action.kind !== "attack" || !b.description) continue;
            const [bx, by, bw, bh] = b.rect;
            if (mp.x >= bx && mp.x <= bx + bw && mp.y >= by && mp.y <= by + bh) { atkTip = { rect: b.rect, desc: b.description }; break; }
          }
        } else if (atkHold && atkHold.description && k.time() - atkHold.t0 >= 0.35) {
          atkTip = { rect: atkHold.rect, desc: atkHold.description };
        }
        if (atkTip) {
          const tW = Math.min(260, W);
          const cpl = Math.max(8, Math.floor((tW - 20) / 6));
          const tH = 14 + Math.max(1, Math.ceil(atkTip.desc.length / cpl)) * 15;
          const tx = Math.max(m, Math.min(atkTip.rect[0], m + W - tW));
          let ty = atkTip.rect[1] - tH - 8;
          if (ty < top + 6) ty = atkTip.rect[1] + atkTip.rect[3] + 8;
          k.drawRect({ pos: k.vec2(tx, ty), width: tW, height: tH, radius: 8, color: k.rgb(...UI.panel), opacity: 0.97, outline: { width: 1, color: k.rgb(...UI.line) }, fixed: true });
          k.drawText({ text: atkTip.desc, pos: k.vec2(tx + 10, ty + 7), size: 11, font: "gameFont", width: tW - 20, lineSpacing: 2, color: k.rgb(...UI.text), fixed: true });
        }
        // The combat log line sits at the panel's bottom edge — but the swap/items sub-menu
        // fills the panel down to that same edge, so its "Back" row overlapped the log text.
        // Hide the log while a sub-menu is open (a focused choice; the log returns on Back).
        if (!swapOpen && !itemsOpen) {
          const last = c.log[c.log.length - 1] || (c.pvp ? "A rival challenges you!" : "A wild monster appeared!");
          // A full team+vault drops the catch (engine/inventory.js). The server still reports
          // outcome "caught", so without this the player is told they caught a monster that
          // actually vanished — say "released, collection full" instead of a bare "CAUGHT!".
          const label = c.outcome === "caught" && c.placement === "released" ? "Caught — collection full, released" : `${c.outcome ? c.outcome.charAt(0).toUpperCase() + c.outcome.slice(1) : ""}!`;
          const line = c.outcome ? `${last}  —  ${label}  (tap / space)` : last;
          // The judge's per-turn outcome is the key feedback each round, but it was a faint 13px line
          // crammed at the panel's bottom edge — easy to miss over the battle stage. Give it a
          // legibility backing strip + a slightly larger size so the outcome text clearly reads.
          const ly = top + COMBAT_H - 27; // sits in the clear band below the action buttons (which end ~top+216)
          k.drawRect({ pos: k.vec2(m - 4, ly - 3), width: W + 8, height: 23, radius: 6, color: k.rgb(...UI.panel), opacity: 0.6, fixed: true });
          k.drawText({ text: line, pos: k.vec2(m, ly), size: 14, font: "gameFont", width: W, color: k.rgb(...UI.text), fixed: true }); // MB-4: content-bottom, not the home-bar-inflated H
        }
        // Core-loop latency feedback: AI-resolved combat takes ~1-2s. A single small
        // "Resolving…" line was easy to miss (combat looked frozen / taps felt dead),
        // so show a prominent animated badge (spinner + label) centered on the dimmed
        // buttons while input is locked — for both the AI turn and the PvP wait.
        if (inputLocked) {
          const bx = pw.cx, by = top + 158, bw = 232, bh = 44;
          k.drawRect({ pos: k.vec2(bx, by), width: bw, height: bh, radius: 12, anchor: "center", color: k.rgb(...UI.panel), opacity: 0.9, outline: { width: 1, color: k.rgb(...UI.line) }, fixed: true });
          const sr = 11, sx = bx - 82, sn = 8, head = (k.time() * 1.5) % 1; // 8-dot rotating spinner
          for (let i = 0; i < sn; i++) {
            const a = (i / sn) * Math.PI * 2 - Math.PI / 2;
            let d = i / sn - head; d -= Math.floor(d); // 0..1 trailing distance behind the head
            k.drawCircle({ pos: k.vec2(sx + Math.cos(a) * sr, by + Math.sin(a) * sr), radius: 2.2, color: k.rgb(150, 200, 255), opacity: 0.15 + 0.85 * (1 - d), fixed: true });
          }
          k.drawText({ text: c.waiting ? "Waiting for opponent…" : "Resolving turn…", pos: k.vec2(bx + 18, by), size: 15, font: "gameFont", anchor: "center", color: k.rgb(...UI.body), fixed: true });
        }
        // Floating damage/heal numbers — make each hit's magnitude readable (was only
        // an HP-bar change). Rise + fade over ~0.8s; -N amber on the enemy / red on
        // you, +N green for heals (CB-2 heal moves).
        const DMG_LIFE = 0.8;
        for (let i = dmgFloaters.length - 1; i >= 0; i--) if (tF - dmgFloaters[i].t0 >= DMG_LIFE) { dmgFloaters[i] = dmgFloaters[dmgFloaters.length - 1]; dmgFloaters.pop(); } // in-place compaction (order-free) — no new array per combat frame
        for (const f of dmgFloaters) {
          if (f.dmg <= 0) continue;
          const age = tF - f.t0, op = 1 - age / DMG_LIFE;
          k.drawText({ text: `${f.heal ? "+" : "-"}${f.dmg}`, pos: k.vec2(f.x, f.y - age * 34), size: 18, font: "gameFont", anchor: "center", color: k.rgb(f.col[0], f.col[1], f.col[2]), opacity: op, fixed: true });
        }
        drawFxScreen(k); // screen-space particles (catch sparkle) over the combat panel (PV-T12)
        // PV-T15: "NEW SPECIES!" milestone banner — holds ~1.6s then fades (~0.4s).
        // Static text (no motion gate needed); mirrors the SP fight-scene banner.
        const nsAge = tF - newSpeciesT;
        if (nsAge >= 0 && nsAge < 2.0) {
          const nsA = nsAge < 1.6 ? 1 : Math.max(0, 1 - (nsAge - 1.6) / 0.4);
          k.drawText({ text: "New species!", pos: k.vec2(pw.cx, top + 120), size: 30, font: "gameFont", anchor: "center", color: k.rgb(255, 214, 110), opacity: nsA, fixed: true });
        }
      }

      // ESC pause/settings overlay (drawn over everything; world keeps running).
      if (menuOpen && !net.state.roundResult) {
        k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: k.rgb(0, 0, 0), opacity: 0.72, fixed: true });
        k.drawText({ text: "Paused", pos: k.vec2(k.width() / 2, k.height() / 2 - 130), size: 44, font: "gameFont", anchor: "center", color: k.rgb(...UI.amber), fixed: true });
        const menuMp = k.mousePos();
        for (const b of menuBtns()) {
          // Routed through the shared drawButton family (was a hand-rolled rect + manual
          // sheen + label with no hover/press feedback) so the pause menu matches every
          // other menu button — shadow + sheen + hover glow. The danger variant (armed
          // "Leave") keeps its red outline + glow via the outline/glow overrides.
          drawButton(k, { rect: b.rect, text: b.label, size: 20, fill: THEME.surfaceAlt, textColor: UI.text,
            outline: b.danger ? UI.danger : UI.line, outlineW: b.danger ? 3 : 2, glow: b.danger ? UI.danger : THEME.teal,
            hover: inRect(menuMp, b.rect), fixed: true });
        }
        // y0 = H/2-64, three 56px buttons + 16 gaps → the 3rd button bottom is H/2+136, so
        // the old +130 sat the hint INSIDE that button (visible against the armed red border).
        // +160 clears it with a small gap.
        k.drawText({ text: `${TOUCH ? "Tap Resume" : "ESC"} to resume — the round keeps going`, pos: k.vec2(k.width() / 2, k.height() / 2 + 160), size: 13, font: "gameFont", anchor: "center", color: k.rgb(...UI.mut), fixed: true });
      }

      // Round result (extracted / died) overlay.
      const rr = net.state.roundResult;
      if (rr) {
        k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: k.rgb(0, 0, 0), opacity: 0.7, fixed: true });
        const win = rr.outcome === "extracted";
        const accent = win ? THEME.success : THEME.danger; // was raw success/danger triples
        // The server sends a RAW reason code (extracted/defeat/zone/timeout/disconnect); map it
        // to a readable sentence so the card doesn't just say "defeat". Unknown codes pass through.
        const REASON_TEXT = { extracted: "You reached a portal and escaped with your haul.", defeat: "Your team was defeated in battle.", zone: "The storm closed in and took you.", timeout: "The run ran out of time.", disconnect: "You were disconnected from the run." };
        const reasonText = REASON_TEXT[rr.reason] || rr.reason || "";
        // Result card — frames the outcome as a designed screen (win/loss-tinted
        // border + top accent bar) instead of text floating on the scrim.
        const cardX = k.width() / 2, cardW = Math.min(600, k.width() - 32);
        // P8-T3: per-run gains summary (caught / XP / level-ups / survival time).
        const g = rr.gains;
        const parts = [];
        if (g) {
          if (g.caught) parts.push(`Caught ${g.caught}`);
          if (g.xpGained) parts.push(`+${g.xpGained} XP`);
          if (g.levelUps) parts.push(`${g.levelUps} level-up${g.levelUps > 1 ? "s" : ""}`);
          parts.push(`survived ${Math.floor((g.survivedS || 0) / 60)}:${String((g.survivedS || 0) % 60).padStart(2, "0")}`);
        }
        const st = net.state.stats || {};
        const lifeT = `LIFETIME     Extractions ${st.extractions || 0}     Deaths ${st.deaths || 0}     Caught ${st.caught || 0}     PvP wins ${st.pvpWins || 0}     Runs ${st.runs || 0}`;
        // Narrow phone: the wide single-line title + stats clipped off the card, so shrink the
        // title and WRAP the body/stat lines, flowing top-down with an adaptive card height.
        const narrowR = k.width() < 480;
        const cardH = narrowR ? (g ? 222 : 172) : 232;
        const cardY = k.height() / 2 + 18;
        k.drawRect({ pos: k.vec2(cardX, cardY), width: cardW, height: cardH, radius: 18, anchor: "center", color: k.rgb(...UI.panel), opacity: 0.95, outline: { width: 2, color: k.rgb(accent[0], accent[1], accent[2]) }, fixed: true });
        // Top sheen (the universal panel signature — this hand-rolled result card was the one
        // in-game panel missing it) so it reads as the same raised surface as every menu/station card.
        k.drawRect({ pos: k.vec2(cardX, cardY - cardH / 2 + 16), width: cardW - 28, height: 12, radius: 8, anchor: "center", color: k.rgb(...THEME.surface2), opacity: 0.4, fixed: true });
        k.drawRect({ pos: k.vec2(cardX, cardY - cardH / 2 + 5), width: cardW - 26, height: 4, radius: 2, anchor: "center", color: k.rgb(accent[0], accent[1], accent[2]), opacity: 0.9, fixed: true });
        if (narrowR) {
          const innerW = cardW - 26, lh = (sz) => sz + 5;
          const nlines = (txt, sz) => Math.max(1, Math.ceil((txt.length * sz * 0.56) / innerW));
          let ty = cardY - cardH / 2 + 14;
          k.drawText({ text: win ? "Extracted!" : "Run Over", pos: k.vec2(cardX, ty), size: 28, font: "gameFont", anchor: "top", color: k.rgb(accent[0], accent[1], accent[2]), fixed: true }); ty += 28 + 10;
          k.drawText({ text: reasonText, pos: k.vec2(cardX, ty), size: 12, font: "gameFont", anchor: "top", width: innerW, align: "center", color: k.rgb(...UI.text), fixed: true }); ty += nlines(reasonText, 12) * lh(12) + 3;
          k.drawText({ text: "tap / space to return", pos: k.vec2(cardX, ty), size: 11, font: "gameFont", anchor: "top", color: k.rgb(...UI.mut), fixed: true }); ty += lh(11) + 8;
          if (g) { const t = "This Run     " + parts.join("     "); k.drawText({ text: t, pos: k.vec2(cardX, ty), size: 12, font: "gameFont", anchor: "top", width: innerW, align: "center", color: k.rgb(...UI.amber), fixed: true }); ty += nlines(t, 12) * lh(12) + 6; }
          k.drawText({ text: lifeT, pos: k.vec2(cardX, ty), size: 12, font: "gameFont", anchor: "top", width: innerW, align: "center", color: k.rgb(...UI.mut), fixed: true });
        } else {
          k.drawText({ text: win ? "Extracted!" : "Run Over", pos: k.vec2(cardX, k.height() / 2 - 30), size: 48, font: "gameFont", anchor: "center", color: k.rgb(accent[0], accent[1], accent[2]), fixed: true });
          // Reason line is the NARRATIVE only; the dismiss affordance moves to its own gentle
          // pulsing line at the card foot (matches the narrow layout + the onboarding hint) so
          // the UI prompt no longer rides on the end of the story sentence.
          k.drawText({ text: reasonText, pos: k.vec2(cardX, k.height() / 2 + 28), size: 18, font: "gameFont", anchor: "center", color: k.rgb(...UI.text), fixed: true });
          if (g) k.drawText({ text: "This Run     " + parts.join("     "), pos: k.vec2(cardX, k.height() / 2 + 60), size: 15, font: "gameFont", anchor: "center", color: k.rgb(...UI.amber), fixed: true });
          // Shrink the lifetime line to fit the card on one line — big totals (5+ digits each)
          // overflowed both card edges. Wrapping isn't an option here (it would collide with the
          // dismiss hint at the foot), so scale the font down to ~10 instead.
          const ltSize = Math.max(10, Math.min(14, Math.floor((cardW - 28) / (lifeT.length * 0.52))));
          k.drawText({ text: lifeT, pos: k.vec2(cardX, k.height() / 2 + 90), size: ltSize, font: "gameFont", anchor: "center", color: k.rgb(...UI.mut), fixed: true });
          const dPulse = prefersReducedMotion() ? 0.85 : 0.5 + 0.4 * Math.sin(k.time() * 3.5); // a11y: static dismiss hint under reduce-motion
          k.drawText({ text: "tap / space to return", pos: k.vec2(cardX, cardY + cardH / 2 - 18), size: 13, font: "gameFont", anchor: "center", color: k.rgb(...UI.mut), opacity: dPulse, fixed: true });
        }
      }

      // Dropped connection: auto-reconnect resumes the round within the server's
      // 120s grace (P6-T1/Q12). Show "Reconnecting…" while retrying; only offer the
      // bail-to-menu once we've given up.
      if (!net.state.connected) {
        const reconnecting = net.state.reconnecting;
        const reduce = prefersReducedMotion();
        k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: k.rgb(0, 0, 0), opacity: reconnecting ? 0.62 : 0.82, fixed: true });
        const tSize = k.width() < 480 ? 28 : 38; // shrink so "Connection lost" doesn't clip on a phone
        // Breathe the title while actively retrying so the screen reads as "working", not frozen
        // (a static "RECONNECTING…" over a dead-still dim looked like a crash during the 120s grace).
        const titleOp = reconnecting && !reduce ? 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(now * 3.0)) : 1;
        k.drawText({ text: reconnecting ? "Reconnecting…" : "Connection lost", pos: k.vec2(k.width() / 2, k.height() / 2 - 24), size: tSize, font: "gameFont", anchor: "center", width: k.width() - 24, align: "center", color: reconnecting ? k.rgb(...UI.amber) : k.rgb(...UI.danger), opacity: titleOp, fixed: true });
        k.drawText({ text: reconnecting ? "resuming your run…" : "tap / space to return to the menu", pos: k.vec2(k.width() / 2, k.height() / 2 + 28), size: k.width() < 480 ? 15 : 18, font: "gameFont", anchor: "center", width: k.width() - 24, align: "center", color: k.rgb(...UI.text), fixed: true });
        // Animated retry indicator — three dots pulsing in a wave (steady under reduce-motion),
        // an unambiguous "still trying" signal so a stalled reconnect never reads as a freeze.
        if (reconnecting) {
          const dy = k.height() / 2 + 58;
          for (let d = 0; d < 3; d++) {
            const op = reduce ? 0.6 : 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(now * 4.0 - d * 0.9));
            k.drawCircle({ pos: k.vec2(k.width() / 2 + (d - 1) * 18, dy), radius: 4, color: k.rgb(...UI.amber), opacity: op, fixed: true });
          }
        }
      }

      // Extraction climax (PV juice — MP parity with SP game.js): a flash burst the
      // moment you escape, over the result card. One-time transient, but a full-
      // screen white-out → skip it under reduce-motion (photosensitivity).
      const rrf = net.state.roundResult;
      if (rrf && rrf.outcome === "extracted" && !extractSfxDone) { extractSfxDone = true; sfx("extract"); haptic([0, 25, 45, 70]); }
      if (rrf && rrf.outcome === "extracted" && extractFlashT == null && !prefersReducedMotion()) extractFlashT = k.time();
      if (extractFlashT != null) {
        const fp = (k.time() - extractFlashT) / 0.6;
        if (fp < 1) drawExtractFlash(k, { x: k.width() / 2, y: k.height() / 2, p: fp });
      }

      // TQ-125: the shared monster-detail popup (epic TQ-87) for the in-combat enemy / your active
      // monster — drawn last so it's over the battle stage + panel. Reads the species TYPE for full
      // details (falls back to the live combat mon if the type isn't in the client pool — getMonsterStats
      // degrades to finite fallbacks, never throws) and overlays the live HP/EN as vitals.
      if (net.state.combat && combatInspect && !menuOpen) {
        const cm = combatInspect === "enemy" ? net.state.combat.enemy : net.state.combat.active;
        if (cm) {
          const mt = getMonsterType(cm.typeName) || cm;
          drawMonsterDetail(k, mt, { vitals: { currentHealth: cm.currentHealth, maxHealth: cm.maxHealth, currentEnergy: cm.currentEnergy, maxEnergy: cm.maxEnergy } });
        } else combatInspect = null;
      }
    });

    // Combat controls (movement is locked server-side during a fight).
    const act = (action) => {
      if (!action) return;
      // While the battle-entry cinematic (transition → chain throw → spawn) is still
      // playing, the first action instead SKIPS it (snaps the monster in) and is
      // swallowed — so the intro never blocks a hurried player, but also can't be
      // accidentally "acted through" before the enemy has appeared.
      if (net.state.combat && !net.state.combat.outcome && k.time() - battleIntroT0 < BATTLE_INTRO_DURATION) {
        battleIntroT0 = k.time() - BATTLE_INTRO_DURATION; haptic(6); return;
      }
      // FGT-T4: open/close the Swap picker locally (no server round-trip).
      if (action.kind === "openSwap") { if (benchList().length) { swapOpen = true; itemsOpen = false; haptic(8); sfx("click"); } return; }
      if (action.kind === "closeSwap") { swapOpen = false; haptic(8); sfx("back"); return; }
      // #61: open/close the Items picker locally (mutually exclusive with Swap).
      if (action.kind === "openItems") { if ((net.state.items || []).length) { itemsOpen = true; swapOpen = false; haptic(8); sfx("click"); } return; }
      if (action.kind === "closeItems") { itemsOpen = false; haptic(8); sfx("back"); return; }
      // Capture is disabled in PvP — you can't catch another player's monster. The
      // action row already hides the Catch button for pvp combats; this also blocks the
      // keyboard (C) and gamepad (LB) catch paths so no input can send it (the server
      // rejects it too, but never offer an action that will be dropped). FGT-T6 / PvP.
      if (action.kind === "catch" && net.state.combat?.pvp) return;
      // Items are PvE-only (see combatButtons): block the open/use paths in PvP so an item
      // can't be sent in a duel where resolveTurn would silently waste the turn.
      if ((action.kind === "openItems" || action.kind === "item") && net.state.combat?.pvp) return;
      const c = net.state.combat;
      if (c && !c.outcome && !c.waiting && !awaiting) {
        awaiting = true;
        combatPress = { kind: action.kind, name: action.attackName || action.kind, t: k.time() }; // tap feedback
        haptic(8); sfx("click"); // MB-12 / P8-T6: tactile + audible combat-action tap (immediate-mode buttons miss theme.addButton's click)
        if (action.kind === "catch") { catchThrowT0 = k.time(); catchResolveT0 = -9; catchResolveKind = null; sfx("throw"); } // kick off the catch cinematic: chain flies at the enemy now; the verdict animation plays when the server replies
        if (action.kind === "swap") swapOpen = false; // leaving the picker on a pick
        if (action.kind === "item") itemsOpen = false; // #61: leaving the items picker on use
        net.combatAction(action);
      }
    };
    for (const n of [1, 2, 3, 4]) {
      bindPress("attack" + n, () => { // TQ-458: keys bound to attack1..4 (default "1".."4")
        if (swapOpen) { const b = benchList()[n - 1]; if (b) act({ kind: "swap", monsterId: b.m.id }); return; } // pick a bench monster
        const a = net.state.combat?.attacks?.[n - 1];
        if (a) act({ kind: "attack", attackName: a.name });
      });
    }
    bindPress("catch", () => act({ kind: "catch" }));
    bindPress("flee", () => act({ kind: "flee" }));
    bindPress("swap", () => { if (net.state.combat && !net.state.combat.outcome) act({ kind: swapOpen ? "closeSwap" : "openSwap" }); }); // FGT-T4: toggle Swap picker

    // Throw the equipped spirit chain along the current heading (engages combat /
    // PvP on hit). Cycle the equipped chain with [ / ]. Only while roaming.
    // PT1-T06: Space is the primary throw key; Q kept as a legacy alias.
    const throwEquippedChain = (aimDir = null) => {
      if (net.state.combat || net.state.roundResult) return;
      const e = equippedChain();
      // Boomerang: overworld throws are FREE — a chain is throwable while it has capture
      // charges (durability) left; a depleted chain is already removed from the inventory.
      // (!e.cs also hardens the e.cs.chainId deref below against a malformed chain entry.)
      if (!e || !e.cs || (e.cs.durability != null && e.cs.durability <= 0)) return;
      // TQ-180: return-gated cooldown — can't throw again until the previous chain has returned. The
      // server enforces it; mirror it here so a blocked press plays no wind-up/whoosh.
      if ((net.state.projectiles || []).some((pr) => pr.owner === net.state.playerId)) return;
      // On PC, AIM AT THE MOUSE: the player renders at the screen centre (camera centres on them), so
      // the throw heading is the cursor relative to centre, normalised to a unit vector (the server
      // clamps each axis to [-1,1] then normalises — a raw long vector would clamp to the wrong angle).
      let dir = selfDir;
      if (aimDir && (aimDir.x || aimDir.y)) {
        // TQ-487: explicit touch drag-aim — fly the chain the way the player dragged the THROW button.
        const al = Math.hypot(aimDir.x, aimDir.y) || 1; dir = { x: aimDir.x / al, y: aimDir.y / al };
      } else if (!TOUCH) {
        const m = k.mousePos(), ax = m.x - k.width() / 2, ay = m.y - k.height() / 2, al = Math.hypot(ax, ay);
        if (al > 4) dir = { x: ax / al, y: ay / al };
      }
      playThrowWindup(selfRender.x, selfRender.y, e.def ? chainColor(e.def) : [120, 220, 255]); sfx("throw"); // PV-T11 wind-up tell + whoosh
      net.throwChain(dir, e.cs.chainId);
    };
    bindPress("throw", throwEquippedChain); // TQ-458: throw (default Space); q/] now cycle chains — see below
    function cycleChain(dir) {
      // CHAIN_SLOTS: hot-swap only among the 3-slot loadout (set in the inventory), not the
      // whole owned inventory. nextChainId expects [{chainId}] items, so wrap the slot ids.
      const slots = (net.state.equippedChainIds || []).map((id) => ({ chainId: id }));
      const next = nextChainId(slots, net.state.equippedChainId, dir);
      if (!next) return;
      net.state.equippedChainId = next; // optimistic; server echoes in snapshot
      net.setEquippedChain(next);
    }
    bindPress("chainPrev", () => { if (!net.state.combat && !net.state.roundResult) cycleChain(-1); }); // TQ-458: default "["
    bindPress("chainNext", () => { if (!net.state.combat && !net.state.roundResult) cycleChain(1); });  // TQ-458: default "q" + "]" (3-slot loadout)
    k.onKeyPress("space", () => {
      if (combatInspect) { combatInspect = null; return; } // TQ-125: close the inspect popup first
      if (net.state.roundResult) { exitAfterRun(); return; }
      if (!net.state.connected && !net.state.reconnecting) { net.close(); k.go("start"); return; }
      const cc = net.state.combat;
      if (cc && cc.outcome) net.clearCombat();
    });

    bindPress("pause", () => { if (combatInspect) { combatInspect = null; return; } if (net.state.roundResult) { exitAfterRun(); } else { menuOpen = !menuOpen; leaveArm = false; } }); // TQ-458 (default Esc); TQ-125: closes the inspect popup first
    bindPress("mute", () => toggleMuted()); // P8-T6: mute toggle (persisted); TQ-458 default "m"

    // Pointer/touch input: during combat, taps hit the action buttons; otherwise
    // the left-side virtual joystick drives movement. Works for touch and mouse.
    function pointerDown(id, p) {
      if (menuOpen) { for (const b of menuBtns()) { const [x, y, w, h] = b.rect; if (p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h) { b.act(); return; } } return; }
      if (net.state.roundResult) { exitAfterRun(); return; }
      if (!net.state.connected && !net.state.reconnecting) { net.close(); k.go("start"); return; }
      const cc = net.state.combat;
      if (cc) {
        // TQ-125: an open monster-detail popup eats the next tap to close (before any combat action).
        if (combatInspect) { combatInspect = null; sfx("click"); return; }
        if (cc.outcome) { net.clearCombat(); return; }
        // TQ-125: tap the enemy / your-monster header row to inspect it in the shared popup.
        const hitRow = (r) => r && p.x >= r[0] && p.x <= r[0] + r[2] && p.y >= r[1] && p.y <= r[1] + r[3];
        if (combatRowRects) {
          if (cc.enemy && hitRow(combatRowRects.enemy)) { combatInspect = "enemy"; sfx("click"); return; }
          if (cc.active && hitRow(combatRowRects.active)) { combatInspect = "active"; sfx("click"); return; }
        }
        const b = hitButtonObj(p);
        if (b) {
          // TQ-71: on touch, defer an ATTACK button to release so a long-press can preview its
          // description instead of committing. All other buttons (and every desktop click) act on press.
          if (TOUCH && b.action.kind === "attack") { atkHold = { action: b.action, description: b.description || "", rect: b.rect, t0: k.time(), x: p.x, y: p.y }; return; }
          act(b.action);
        }
        return;
      }
      // PT1-T24 parity: tap the minimap (top-right) to cycle zoom (1× → 2× → 4×). M is
      // mute in MP, so tap is the cycle (works for mouse + touch).
      { const mm = hudSlots().minimap; const mox = mm.x, moy = mm.y, ms = mm.size; // HUD-OUT: match the gutter-anchored radar draw
        if (p.x >= mox - 4 && p.x <= mox + ms + 4 && p.y >= moy - 4 && p.y <= moy + ms + 4) { mmZoom = nextMinimapZoom(mmZoom); return; } }
      // MB-11: tap the touch pause button → open the pause/leave menu (was ESC-only).
      if (TOUCH && !onboard) { const [px, py, pw, ph] = pauseBtnRect(); if (p.x >= px && p.x <= px + pw && p.y >= py && p.y <= py + ph) { menuOpen = true; return; } }
      // CHAIN_SLOTS: tap the chain HUD panel to hot-swap to the next loadout chain (the
      // touch equivalent of the [ / ] keys). Only when >1 chain is loaded.
      if (!onboard && (net.state.equippedChainIds || []).length > 1) {
        const [hx, hy, hw, hh] = chainHudRect();
        if (p.x >= hx && p.x <= hx + hw && p.y >= hy && p.y <= hy + hh) { cycleChain(1); haptic(8); return; }
      }
      // TQ-488: dedicated touch chain-swap button — cycle the 3-slot loadout (the on-screen
      // equivalent of [ / ]). Only when >1 chain is loaded (the button is drawn under the same gate).
      if (TOUCH && !onboard && (net.state.equippedChainIds || []).length > 1) {
        const sb = swapBtnC();
        if (Math.hypot(p.x - sb.x, p.y - sb.y) <= SWAP_R) { cycleChain(1); haptic(8); sfx("click"); return; }
      }
      // Touch THROW button (mobile): press starts a drag-to-AIM gesture (TQ-487). A drag sets the
      // throw direction (released in onTouchEnd); a plain tap (no drag) throws along the heading.
      if (TOUCH && !onboard) {
        const tb = throwBtnC();
        if (Math.hypot(p.x - tb.x, p.y - tb.y) <= THROW_R) {
          const e = equippedChain();
          const chainOut = (net.state.projectiles || []).some((pr) => pr.owner === net.state.playerId);
          const throwable = !!e && !!e.cs && !(e.cs.durability != null && e.cs.durability <= 0) && !chainOut;
          if (throwable) { throwAim = { id, dir: { x: 0, y: 0 }, dragged: false }; haptic(6); }
          return; // consume the touch (don't fall through to the movement joystick) whether or not throwable
        }
      }
      // The virtual movement joystick is a TOUCH-PRIMARY control only. Desktop mouse is AIM (throw
      // direction) + UI taps — movement is WASD/gamepad. Gate joyStart on TOUCH (not just on the
      // mouse id): on a mouse+touch device (e.g. a touchscreen laptop) touchPrimary is false, so the
      // stick is hidden (it's not drawn — see the TOUCH-gated draw) — but the touch handlers below
      // are always wired, so without this gate a screen touch would still drive the INVISIBLE stick.
      // Touch ids only on a touch-primary device (a screen-touch on a mouse+touch laptop must not drive
      // the invisible stick — 26f2a8e). The DESKTOP MOUSE ("m", wired only when !TOUCH) drives movement
      // too, so a click/hold/drag in the play area walks toward the cursor (restored desktop mouse-move).
      if (id === "m" || (TOUCH && id !== "m")) joyStart(id, p);
    }
    k.onTouchStart((p, t) => pointerDown(t?.identifier ?? 0, p));
    k.onTouchMove((p, t) => {
      const id = t?.identifier ?? 0;
      // TQ-487: while aiming the THROW, the drag sets the throw direction (button-center → finger).
      if (throwAim && id === throwAim.id) {
        const tb = throwBtnC(); const dx = p.x - tb.x, dy = p.y - tb.y, len = Math.hypot(dx, dy);
        if (len > 14) { throwAim.dir = { x: dx / len, y: dy / len }; throwAim.dragged = true; } else { throwAim.dragged = false; }
        return;
      }
      if (atkHold && Math.hypot(p.x - atkHold.x, p.y - atkHold.y) > 12) atkHold = null; // TQ-71: a drag cancels the attack press
      joyMove(id, p);
    });
    k.onTouchEnd((p, t) => {
      const id = t?.identifier ?? 0;
      // TQ-487: release the THROW aim → fly the chain in the dragged direction (or along heading if it was a tap).
      if (throwAim && id === throwAim.id) {
        const aim = throwAim; throwAim = null;
        throwEquippedChain(aim.dragged ? aim.dir : null); // PV-T11: shared throw (wind-up tell + guards)
        return;
      }
      // TQ-71: a short tap on the held attack button COMMITS it; a long-press was a description preview (no commit).
      if (atkHold) { if (k.time() - atkHold.t0 < 0.35) act(atkHold.action); atkHold = null; }
      joyEnd(id);
    });
    // P8-T8: tap / click also dismisses the onboarding overlay (idempotent; in
    // addition to moving). Grace (>0.3s) avoids an instant dismiss at spawn.
    k.onTouchStart(() => { if (onboard && onboardT > 0.3) dismissOnboard(); });
    k.onMousePress(() => { if (onboard && onboardT > 0.3) dismissOnboard(); });
    if (!TOUCH) {
      // Desktop mouse (touch devices use the touch handlers; skip mouse to avoid synthesized double-fires):
      //  • hold / drag → drive movement toward the cursor (joystick, invisible on desktop), and
      //  • a quick CLICK in the play area → throw the equipped chain at the cursor.
      // WASD/gamepad movement + Space-throw still work; UI hits (minimap/chain HUD/menu/combat) are
      // consumed by pointerDown first, so they neither move nor throw. (Restores desktop mouse control
      // the mobile refactor removed — Dominik 2026-06-16.)
      let mDownT = 0, mDownP = null;
      k.onMousePress(() => { mDownT = k.time(); mDownP = k.mousePos(); pointerDown("m", mDownP); });
      k.onMouseMove(() => { if (joyId === "m") joyMove("m", k.mousePos()); });
      k.onMouseRelease(() => {
        const p = k.mousePos();
        // A tap = the press started MOVEMENT (joyId "m" → it wasn't consumed by a UI/combat hit) and was
        // quick with negligible drag. Such a tap throws toward the cursor; a hold/drag was a move.
        const wasTap = joyId === "m" && mDownP && (k.time() - mDownT) < 0.22 && Math.hypot(p.x - mDownP.x, p.y - mDownP.y) < 8;
        joyEnd("m");
        if (wasTap && !net.state.combat && !net.state.roundResult && !onboard && !menuOpen) throwEquippedChain();
        mDownP = null;
      });
    }
  });
}
