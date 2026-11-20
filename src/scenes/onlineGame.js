import { net } from "../netClient.js";
import { GAME } from "../engine/schemas.js";
import { generateMap, biomeTintAt, biomeNameAt, stepBody } from "../engine/mapgen.js";
import { takeAcked, reconcileStep } from "../engine/reconcile.js";
import { sprintMult, sprintingNow, tickStamina } from "../engine/movement.js";
import { getSpiritChain, cleanAttackName } from "../data.js";
import { getMonsterType } from "../engine/gamedata.js";
import { nextChainId } from "../engine/inventory.js";
import { markDiscovered, markEncountered } from "../engine/discovered.js";
import { objectiveText } from "../ui/objective.js";
import { drawBiomeChip } from "../ui/biomeHud.js";
import { drawCharacter } from "../render/character.js";
import { getSkin, getEquippedSkin, getEquippedSkinId, drawChainGlyph, tierColor } from "../render/chainCosmetics.js";
import { getEquippedCharacterSkin, getEquippedCharacterSkinId, getCharacterSkin } from "../render/characterCosmetics.js";
import { drawSpiritChainProjectile, drawChest, chainColor } from "../render/spiritchain.js";
import { drawBattleStage, BATTLE_INTRO_DURATION } from "../render/battleStage.js";
import { drawMonster, drawMonsterIcon } from "../render/monster.js";
import { createHtmlMonsterOverlay } from "../render/htmlMonsterOverlay.js";
import { drawMonsterDetail } from "../ui/monsterDetail.js";
import { ATTACK_DURATION } from "../systems/monsterAnim.js";
import { drawTiles, makeTileCache } from "../render/tiles.js";
import { emit, emitText, updateFx, drawFx, drawFxScreen, clearFx } from "../render/fx.js";
import { drawPlayWindow, playWindowRect } from "../render/playWindow.js";
import { addShake, updateShake, shakeOffset, clearShake } from "../render/shake.js";
import { drawPortal, drawExtractFlash } from "../render/portal.js";
import { minimapWindow, minimapSize, nextMinimapZoom } from "../render/minimap.js";
import { hudLayout } from "../render/hudLayout.js";
import { drawHubPanel } from "../render/hubPanel.js";
import { getCharacter } from "../storage.js";
import { initAudio, toggleMuted, isMuted, sfx, haptic } from "../systems/audio.js";
import { gamepadMove, gamepadPressed, gamepadConnected, BTN } from "../systems/gamepad.js";
import { getBindings } from "../systems/keybinds.js";
import { safeInsetsDesign } from "../systems/safearea.js";
import { touchPrimary, drawJoystick, drawTouchButton, drawThrowPad, JOY_R as JOY_RADIUS } from "../systems/inputMode.js";
import { prefersReducedMotion } from "../systems/a11y.js";
import { THEME, FONT_BOLD, hpColor, drawButton, drawOrnamentRule, inRect, drawGlass, drawEyebrow, drawHairline, drawChip } from "../ui/theme.js";
import { drawIcon } from "../ui/icons.js";
import { drawIconTab, WHITE } from "../ui/theme.js";
import { drawGlassSheet } from "../ui/stationPopup.js";

const UI = {
  text:  THEME.text,
  body:  THEME.textBody,
  mut:   THEME.textMut,
  panel: THEME.bgAlt,
  track: THEME.surface2,
  line:  THEME.line,
  amber: THEME.amber, danger: THEME.danger, primary: THEME.primary,
};

export default function onlineGameScene(k) {
  k.scene("onlineGame", (args = {}) => {
    let map = args.map || null;
    function exitAfterRun() {
      if (args.characterId) { k.go(args.backScene || "hub", { characterId: args.characterId }); return; }
      net.close(); k.go("start");
    }
    initAudio(net);
    net.setSkin(getEquippedSkinId());
    net.setCharSkin(getEquippedCharacterSkinId());
    if (!map && net.state.seed != null) {
      generateMap(null, net.state.seed, net.state.roundBiomes, net.state.roundComp).then((m) => { map = m; }).catch(() => {}); // Same generateMap inputs as server/world.js, or client and server maps diverge
    }
    let regionGen = 0;
    const offRegion = net.on("roundStart", (m) => {
      if (!m || !m.travelled) return;
      const gen = ++regionGen;
      map = null;
      generateMap(null, net.state.seed, net.state.roundBiomes, net.state.roundComp).then((nm) => {
        if (gen !== regionGen) return;
        map = nm; onRegionArrived();
      }).catch(() => {});
    });
    k.onSceneLeave(() => { try { offRegion(); } catch {} });
    let onRegionArrived = () => {};
    const tileCache = makeTileCache();
    k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(...THEME.bg), k.fixed(), k.z(-10)]);

    const explored = new Set();
    const FOG_REVEAL = 6;
    const fogKey = (x, y) => x * 100000 + y;
    const isExplored = (x, y) => explored.has(fogKey(x, y));
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

    const winAspect = () => { const W = k.width(), H = k.height(); return H > W ? Math.max(4 / 3, H / W + 0.01) : 4 / 3; };
    const pwTop = playWindowRect(k.width(), k.height(), { maxAspect: winAspect() });
    const info = k.add([
      k.text("", { size: 12, font: "gameFont" }),
      k.pos(pwTop.x + 12, pwTop.y + 12), k.color(...UI.body), k.fixed(), k.z(100),
    ]);
    const hint = k.add([
      k.text("Move: WASD or drag     Throw: hold Space to charge     Cycle chain: [ ]     Leave: ESC     M mute", { size: 12, font: "gameFont" }),
      k.pos(pwTop.x + 12, pwTop.bottom - 24), k.color(...UI.body), k.fixed(), k.z(100),
    ]);
    let objectiveW = 0;
    const makeObjective = (x, y, w) =>
      k.add([
        k.text("", { size: 13, font: "gameFont", width: w || undefined, align: "center" }),
        k.pos(x, y), k.anchor("center"), k.color(...THEME.teal), k.fixed(), k.z(100),
      ]);
    let objective = makeObjective(pwTop.cx, pwTop.y + 34, 0);
    let objectiveVisible = false;

    function drawObjectiveChip() {
      let txt = objective.text;
      if (!objectiveVisible || !txt) return;
      const h = hudSlots();
      const onSquare = lobbyPanelActive() || h.orientation !== "landscape";
      const narrow = k.width() < 560;
      const tut = /^Tutorial \d\/\d — /.test(txt);
      if (narrow) txt = tut ? txt.replace(/^Tutorial \d\/\d — /, "").split(",")[0].trim() : txt.replace(/^Objective:\s*/i, "").split(/,| — /)[0].trim().replace(/^\w/, (c) => c.toUpperCase());
      const cx = onSquare ? h.square.cx : h.objective.x, cy = onSquare ? h.square.bottom - (narrow ? 16 : 24) : h.objective.y;
      const maxW = Math.max(120, onSquare ? h.square.size - 24 : (h.objective.width || 240));
      const est = txt.length * 6.6 + 44;
      const lines = Math.max(1, Math.ceil((txt.length * 6.6) / Math.max(60, maxW - 44)));
      const w = Math.min(maxW, est), hgt = lines * 16 + 12;
      drawGlass(k, { rect: [cx - w / 2, cy - hgt / 2, w, hgt], radius: Math.min(15, hgt / 2), tint: 0.62, fill: 0.06, line: tut ? 0 : 0.14, fixed: true });
      if (tut) k.drawRect({ pos: k.vec2(cx - w / 2 + 0.5, cy - hgt / 2 + 0.5), width: w - 1, height: hgt - 1, radius: Math.min(15, hgt / 2), color: k.rgb(...THEME.amber), opacity: 0.8, fill: false, outline: { width: 1, color: k.rgb(...THEME.amber) }, fixed: true });
      drawIcon(k, "flag", { x: cx - w / 2 + 16, y: cy, size: 14, color: tut ? THEME.amber : THEME.teal, fixed: true });
      k.drawText({ text: txt, pos: k.vec2(cx + 8, cy), size: 12, font: "gameFont", anchor: "center", width: w - 44, align: "center", color: k.rgb(...UI.text), fixed: true });
    }
    function drawInfoChip() {
      if (info.hidden) return;
      const rivals = net.state.players || [];
      const n = rivals.length;
      const narrowHud = k.width() < 560;
      const names = n ? rivals.slice(0, narrowHud ? 1 : 2).map((p) => trunc(p.name || "?", 10)).join(", ") + (n > (narrowHud ? 1 : 2) ? ` +${n - (narrowHud ? 1 : 2)}` : "") : "";
      const txt = n ? `${n} rival${n === 1 ? "" : "s"}  ${names}` : "No rivals nearby";
      const tw = typeof k.measureText === "function" ? k.measureText(txt, 11, FONT_BOLD) : txt.length * 6.4;
      const conn = !narrowHud && net.state.connected;
      const hs = hudSlots();
      const w = 30 + tw + (conn ? 14 : 0) + 12, h = 22, x = hs.team.x, y = hs.orientation === "landscape" ? hs.team.y - 2 : hs.team.y + 20;
      drawGlass(k, { rect: [x, y, w, h], radius: 11, tint: 0.6, fill: 0.05, line: 0.12, fixed: true });
      drawIcon(k, "multi", { x: x + 15, y: y + h / 2, size: 13, color: n ? THEME.amber : UI.mut, fixed: true });
      k.drawText({ text: txt, pos: k.vec2(x + 28, y + h / 2 - 5.5), size: 11, font: FONT_BOLD, anchor: "left", color: k.rgb(...(n ? UI.text : UI.mut)), fixed: true });
      if (conn) k.drawCircle({ pos: k.vec2(x + w - 11, y + h / 2), radius: 3.5, color: k.rgb(82, 200, 124), fixed: true });
    }
    function drawTimerChip() {
      const h = hudSlots();
      if (!h.timer) return;
      if (net.state.adventure) {
        const w = 132, hgt = 30, x = h.timer.x - w / 2, y = h.timer.y - hgt / 2;
        drawGlass(k, { rect: [x, y, w, hgt], radius: 15, tint: 0.62, fill: 0.06, line: 0.14, fixed: true });
        drawIcon(k, "region", { x: x + 18, y: h.timer.y, size: 15, color: THEME.amber, fixed: true });
        k.drawText({ text: `Region ${net.state.depth || 1}`, pos: k.vec2(h.timer.x + 10, h.timer.y), size: 14, font: "gameFontBold", anchor: "center", color: k.rgb(...THEME.amber), fixed: true });
        return;
      }
      const t = net.state.time || 0;
      const mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, "0");
      const low = t <= 60, mid = t <= 180;
      const col = low ? THEME.danger : mid ? THEME.amber : THEME.text;
      const w = 118, hgt = 32, x = h.timer.x - w / 2, y = h.timer.y - hgt / 2;
      drawGlass(k, { rect: [x, y, w, hgt], radius: 16, tint: 0.62, fill: 0.06, line: low ? 0 : 0.14, fixed: true });
      drawIcon(k, "clock", { x: x + 17, y: h.timer.y, size: 15, color: col, opacity: low ? (0.7 + 0.3 * (0.5 + 0.5 * Math.sin(k.time() * 6))) : 1, fixed: true });
      if (low) k.drawRect({ pos: k.vec2(x + 0.5, y + 0.5), width: w - 1, height: hgt - 1, radius: 15, color: k.rgb(...THEME.danger), opacity: 0.85, fill: false, outline: { width: 1, color: k.rgb(...THEME.danger) }, fixed: true });
      const pulse = low && !prefersReducedMotion() ? 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(k.time() * 6)) : 1;
      k.drawText({ text: `${mm}:${ss}`, pos: k.vec2(h.timer.x + 2, h.timer.y), size: 17, font: "gameFontBold", anchor: "center", color: k.rgb(...col), opacity: pulse, fixed: true });
      k.drawText({ text: "left", pos: k.vec2(h.timer.x + 38, h.timer.y + 1), size: 10, font: "gameFont", anchor: "center", color: k.rgb(...UI.mut), fixed: true });
    }
    function drawFightSummary(c, pw, top) {
      if (!c || !c.outcome || c.outcome === "lost") return;
      const col = (t) => k.rgb(...t);
      const age = Math.max(0, (Date.now() - (c.endedAt || Date.now())) / 1000);
      const ease = Math.min(1, age / 0.35), e = 1 - (1 - ease) * (1 - ease);
      const w = Math.min(420, pw.w - 40), hgt = c.outcome === "won" ? 184 : 150;
      const cx = pw.cx, cy = Math.max(pw.y + hgt / 2 + 16, top - hgt / 2 - 30) + (1 - e) * 14;
      const x = cx - w / 2, y = cy - hgt / 2;
      const caught = c.outcome === "caught", won = c.outcome === "won";
      const accent = caught ? THEME.success : won ? THEME.amber : THEME.textMut;
      const title = caught ? "Caught!" : won ? "Victory!" : "Escaped";
      k.drawRect({ pos: k.vec2(x, y), width: w, height: hgt, radius: 18, color: col(accent), opacity: 0.001, shadow: { blur: 34, color: accent, alpha: 0.32 * e }, fixed: true });
      drawGlassSheet(k, { rect: [x, y, w, hgt], radius: 20, opacity: e, accent });
      const sIcon = caught ? "catch" : won ? "trophy" : "flee";
      const tW = typeof k.measureText === "function" ? k.measureText(title, 26, FONT_BOLD) : title.length * 15;
      drawIcon(k, sIcon, { x: cx - tW / 2 - 20, y: y + 34, size: 26, color: accent, opacity: e, fixed: true });
      k.drawText({ text: title, pos: k.vec2(cx + 14, y + 18), size: 26, font: FONT_BOLD, anchor: "top", color: col(accent), opacity: e, fixed: true });
      drawOrnamentRule(k, { x: cx, y: y + 54, w: Math.min(220, w - 80), color: accent, anchor: "center", fixed: true });
      let ly = y + 70;
      if (won && c.gains) {
        const g = c.gains, leveled = (g.levelTo || 0) > (g.levelFrom || 0);
        const fillP = prefersReducedMotion() ? 1 : Math.max(0, Math.min(1, (age - 0.35) / 0.9));
        const shownXp = Math.round((g.xp || 0) * (prefersReducedMotion() ? 1 : Math.max(0, Math.min(1, (age - 0.3) / 0.8))));
        k.drawText({ text: `${g.monster || "Your monster"}`, pos: k.vec2(x + 24, ly), size: 15, font: FONT_BOLD, anchor: "left", color: col(UI.text), opacity: e, fixed: true });
        const xpStr = `+${shownXp} XP`;
        const xpW = typeof k.measureText === "function" ? k.measureText(xpStr, 15, FONT_BOLD) : xpStr.length * 9;
        drawIcon(k, "xp", { x: x + w - 24 - xpW - 12, y: ly + 8, size: 14, color: THEME.amber, opacity: e, fixed: true });
        k.drawText({ text: xpStr, pos: k.vec2(x + w - 24, ly), size: 15, font: FONT_BOLD, anchor: "topright", color: col(THEME.amber), opacity: e, fixed: true });
        ly += 28;
        const bw = w - 48, bh = 12;
        const endFrac = g.xpNeed > 0 ? Math.max(0, Math.min(1, (g.xpNow || 0) / g.xpNeed)) : 0;
        const startFrac = leveled ? 0 : Math.max(0, Math.min(1, ((g.xpNow || 0) - (g.xp || 0)) / Math.max(1, g.xpNeed || 1)));
        let frac;
        if (!leveled) frac = startFrac + (endFrac - startFrac) * fillP;
        else { const half = 0.55; frac = fillP < half ? startFrac + (1 - startFrac) * (fillP / half) : endFrac * ((fillP - half) / (1 - half)); }
        k.drawRect({ pos: k.vec2(x + 24, ly), width: bw, height: bh, radius: bh / 2, color: col(THEME.bgAlt), opacity: 0.9 * e, fixed: true });
        if (frac > 0) k.drawRect({ pos: k.vec2(x + 24, ly), width: Math.max(bh, bw * frac), height: bh, radius: bh / 2, color: col(THEME.amber), opacity: e, fixed: true,
          gradient: { dir: "v", stops: [[0, [255, 214, 140]], [1, THEME.amber]] } });
        if (frac > 0 && fillP < 1) k.drawCircle({ pos: k.vec2(x + 24 + Math.max(bh, bw * frac), ly + bh / 2), radius: 9, color: col([255, 230, 170]), opacity: 0.5 * e, fixed: true });
        ly += bh + 10;
        k.drawText({ text: `Lv ${g.levelTo}`, pos: k.vec2(x + 24, ly), size: 12, font: FONT_BOLD, anchor: "left", color: col(UI.body), opacity: e, fixed: true });
        k.drawText({ text: `${g.xpNow} / ${g.xpNeed} XP`, pos: k.vec2(x + w - 24, ly), size: 12, font: "gameFont", anchor: "topright", color: col(UI.mut), opacity: e, fixed: true });
        if (leveled && fillP > 0.55) {
          const bp = Math.min(1, (fillP - 0.55) / 0.25), sc = 1 + (1 - bp) * 0.3;
          const pulse = prefersReducedMotion() ? 1 : 0.85 + 0.15 * Math.sin(k.time() * 5);
          const txt = `LEVEL UP   ${g.levelFrom} to ${g.levelTo}`, tw = (typeof k.measureText === "function" ? k.measureText(txt, 13, FONT_BOLD) : txt.length * 8) + 28;
          const bwid = tw * sc, bhgt = 26 * sc, bx = cx - bwid / 2, byy = ly + 22 - (bhgt - 26) / 2;
          k.drawRect({ pos: k.vec2(bx, byy), width: bwid, height: bhgt, radius: bhgt / 2, color: col(THEME.amber), opacity: e * bp * pulse, gradient: { dir: "v", stops: [[0, [255, 214, 140]], [1, THEME.amber]] }, fixed: true });
          k.drawText({ text: txt, pos: k.vec2(cx, byy + bhgt / 2), size: 13 * sc, font: FONT_BOLD, anchor: "center", color: col(THEME.textInv), opacity: e * bp, fixed: true });
        }
      } else if (won) {
        k.drawText({ text: "The wild monster was defeated.", pos: k.vec2(cx, ly), size: 13, font: "gameFont", anchor: "top", color: col(UI.body), opacity: e, fixed: true });
      } else if (caught) {
        const m = c.caught || c.enemy || {};
        const where = c.placement === "vault" ? "sent to your vault" : c.placement === "released" ? "collection full — released" : "joined your team";
        k.drawText({ text: `${m.name || m.typeName || "Monster"}   Lv ${m.level ?? "?"}`, pos: k.vec2(cx, ly), size: 15, font: FONT_BOLD, anchor: "top", color: col(UI.text), opacity: e, fixed: true });
        k.drawText({ text: where, pos: k.vec2(cx, ly + 24), size: 13, font: "gameFont", anchor: "top", color: col(c.placement === "released" ? THEME.warn : UI.body), opacity: e, fixed: true });
      } else {
        k.drawText({ text: "You slipped away from the fight.", pos: k.vec2(cx, ly), size: 13, font: "gameFont", anchor: "top", color: col(UI.body), opacity: e, fixed: true });
      }
      const dPulse = prefersReducedMotion() ? 0.85 : 0.5 + 0.4 * Math.sin(k.time() * 3.5);
      k.drawText({ text: `${TOUCH ? "tap" : "tap / space"} to continue`, pos: k.vec2(cx, y + hgt - 24), size: 12, font: "gameFont", anchor: "top", color: col(UI.mut), opacity: e * dPulse, fixed: true });
    }

    const lerp = (a, b, t) => a + (b - a) * t;
    const INTERP_DELAY = 0.12;
    // Entry count: must span INTERP_DELAY + jitter at the max (60Hz) snapshot rate
    const BUF_MAX = 24;
    const EXTRAP_CAP = 0.10;
    const SNAP_DIST2 = (GAME.BASE_SPEED * 1.7 * 0.5) ** 2;
    const pushSample = (r, t, x, y) => {
      const last = r.buf[r.buf.length - 1];
      if (last) { const dx = x - last.x, dy = y - last.y; if (dx * dx + dy * dy > SNAP_DIST2) r.buf.length = 0; }
      r.buf.push({ t, x, y });
      if (r.buf.length > BUF_MAX) r.buf.shift();
    };
    const sampleBuf = (r, rt) => {
      const b = r.buf, n = b.length;
      if (!n) return;
      if (n === 1 || rt <= b[0].t) { r.x = b[0].x; r.y = b[0].y; r.vx = 0; r.vy = 0; return; }
      const last = b[n - 1];
      if (rt >= last.t) {
        const prev = b[n - 2], seg = Math.max(0.001, last.t - prev.t);
        const vx = (last.x - prev.x) / seg, vy = (last.y - prev.y) / seg, ahead = Math.min(rt - last.t, EXTRAP_CAP);
        r.x = last.x + vx * ahead; r.y = last.y + vy * ahead; r.vx = vx; r.vy = vy; return;
      }
      let i = n - 2;
      while (i > 0 && b[i].t > rt) i--;
      const a = b[i], c = b[i + 1], seg = Math.max(0.001, c.t - a.t), f = (rt - a.t) / seg;
      r.x = a.x + (c.x - a.x) * f; r.y = a.y + (c.y - a.y) * f;
      r.vx = (c.x - a.x) / seg; r.vy = (c.y - a.y) / seg;
    };
    const selfRender = { x: net.state.self.x, y: net.state.self.y };
    onRegionArrived = () => {
      selfRender.x = net.state.self.x; selfRender.y = net.state.self.y;
      explored.clear();
      try { monsterRender.clear(); projRender.clear(); } catch {}
      tutNotice = { text: `Region ${net.state.depth || 1} — a new land unfolds`, at: Date.now() };
    };
    const predHist = [];
    function recordInput(seq, idx, idy) {
      if (typeof seq !== "number") return;
      predHist.push({ seq, x: selfRender.x, y: selfRender.y, dx: idx, dy: idy });
      if (predHist.length > 96) predHist.shift();
    }
    const othersRender = new Map();
    let lastPlayersRef = null;
    let liveGen = 0;
    const monsterRender = new Map();
    let lastMonstersRef = null;
    const projRender = new Map();
    const ents = [];
    const byY = (a, b) => a.y - b.y;
    const htmlEnts = [];
    const combatHtmlEnts = [];
    const htmlOverlay = createHtmlMonsterOverlay(k);
    k.onSceneLeave(() => htmlOverlay.destroy());
    const portalSeen = new Map();
    let selfMoving = false;
    let stepAcc = 0;
    let stormFxAcc = 0;
    let prevLevels = new Map();
    let prevChests = null;
    let prevChainIds = null;
    let prevChainsRef = null;
    const NO_CHAINS = [];
    let selfDir = { x: 0, y: 1 };
    const KB = getBindings();
    const anyDown = (action) => { const ks = KB[action]; for (let i = 0; i < ks.length; i++) if (k.isKeyDown(ks[i])) return true; return false; };
    const bindPress = (action, handler) => { for (const key of KB[action]) k.onKeyPress(key, handler); };
    let onboard = false;
    try { onboard = !localStorage.getItem("tq_onboarded"); } catch {}
    let onboardT = 0;
    const dismissOnboard = () => { if (!onboard) return; onboard = false; try { localStorage.setItem("tq_onboarded", "1"); } catch {} };

    const TUT_KEY = "tq_tutorial";
    const TUT_STEPS = [
      { text: (T) => T ? "Tutorial 1/4 — Drag the joystick to move around" : "Tutorial 1/4 — Move with WASD or the arrow keys", done: (f) => f.moved || f.fought || f.finished || f.extracted },
      { text: () => "Tutorial 2/4 — Walk into a wild monster to start a fight", done: (f) => f.fought || f.finished || f.extracted },
      { text: (T) => T ? "Tutorial 3/4 — Tap an attack to win, or Catch when it is weak" : "Tutorial 3/4 — Press 1-4 to attack, or C to catch when it is weak", done: (f) => f.finished || f.extracted },
      { text: () => "Tutorial 4/4 — When the storm starts, portals open. Reach one to extract", done: (f) => f.extracted },
    ];
    let tutStep = 99;
    try { const v = localStorage.getItem(TUT_KEY); tutStep = v == null ? (onboard ? 0 : 99) : Math.max(0, Math.min(99, Number(v) || 0)); } catch {}
    const tutFlags = { moved: false, fought: false, finished: false, extracted: false };
    let tutSpawn = null, tutNotice = null;
    const tutActive = () => tutStep < TUT_STEPS.length;
    const tutorialText = () => (tutActive() ? TUT_STEPS[tutStep].text(TOUCH) : null);
    function tutorialTick() {
      if (!tutActive()) return;
      const self = net.state.self;
      if (self && !tutSpawn) tutSpawn = { x: self.x, y: self.y };
      if (self && tutSpawn && Math.hypot(self.x - tutSpawn.x, self.y - tutSpawn.y) > 160) tutFlags.moved = true;
      if (net.state.combat) tutFlags.fought = true;
      if (net.state.combat && net.state.combat.outcome) tutFlags.finished = true;
      if (net.state.roundResult && net.state.roundResult.outcome === "extracted") tutFlags.extracted = true;
      while (tutActive() && TUT_STEPS[tutStep].done(tutFlags)) {
        tutStep++;
        try { localStorage.setItem(TUT_KEY, String(tutStep)); } catch {}
        tutNotice = { text: tutActive() ? `Step done!  Next: ${TUT_STEPS[tutStep].text(TOUCH).replace(/^Tutorial \d\/\d — /, "")}` : "Tutorial complete — good hunting, tamer!", at: Date.now() };
      }
    }
    function drawTutorialNotice() { drawTopNotice(tutNotice, () => { tutNotice = null; }, 186); }
    function drawOnboarding() {
      onboardT += k.dt();
      const W = k.width(), H = k.height(), cx = W / 2;
      k.drawRect({ pos: k.vec2(0, 0), width: W, height: H, color: k.rgb(...THEME.bg), opacity: 0.94, fixed: true,
        gradient: { dir: "v", stops: [[0, THEME.surface, 0.95], [0.4, THEME.bg, 0.95], [1, THEME.bgAlt, 0.97]] } });
      const narrowOb = W < 480;
      const obW = Math.min(680, W - 24);
      const obX = cx - obW / 2;
      const lines = TOUCH ? [
        "Move — drag the left side of the screen",
        "Sprint — push the joystick all the way out (drains stamina)",
        "Throw a spirit chain — tap the Throw button to catch wild monsters",
        "In a fight — tap an attack, or Catch / Flee",
        "Rivals — other tamers share this run; beat one to take their team, or lose yours",
        "Extract — reach a glowing portal before the storm closes in",
        "The stakes — die and you lose your team and everything you found this run",
        "Pause / Leave — tap the pause button (top)",
      ] : [
        "Move — WASD or the arrow keys",
        "Sprint — hold Shift to move faster (drains stamina)",
        "Throw a spirit chain — Space (aimed at your mouse) to catch wild monsters",
        "In a fight — 1-4 attack, C catch, F flee",
        "Rivals — other tamers share this run; beat one to take their team, or lose yours",
        "Extract — reach a glowing portal before the storm closes in",
        "The stakes — die and you lose your team and everything you found this run",
        "Leave — ESC",
      ];
      const rows = lines.map((ln) => { const i = ln.indexOf(" — "); return i > 0 ? [ln.slice(0, i), ln.slice(i + 3)] : [ln, ""]; });
      const labW = narrowOb ? 0 : 150, pad = narrowOb ? 14 : 22, bodyW = obW - pad * 2 - labW;
      const sz = narrowOb ? 13 : 15, lh = sz + 5;
      const nl = (txt, w) => Math.max(1, Math.ceil((typeof k.measureText === "function" ? k.measureText(txt, sz, "gameFont") : txt.length * sz * 0.52) / Math.max(40, w)));
      const rowH = (r) => (narrowOb ? lh + nl(r[1], bodyW) * lh + 10 : Math.max(lh, nl(r[1], bodyW) * lh) + 12);
      const listH = rows.reduce((s, r) => s + rowH(r), 0);
      const headH = narrowOb ? 70 : 84, footH = 48;
      const obH = Math.min(H - 24, headH + listH + footH);
      const obY = Math.max(12, (H - obH) / 2);
      drawGlassSheet(k, { rect: [obX, obY, obW, obH], radius: 24, accent: THEME.amber });
      const obTab = drawIconTab(k, { x: obX + pad, y: obY - (narrowOb ? 10 : 14), size: narrowOb ? 44 : 52, icon: "book", accent: THEME.amber, fixed: true });
      drawEyebrow(k, { x: obTab[0] + obTab[2] + 14, y: obY + (narrowOb ? 14 : 20), text: "Your first run", size: 10, color: THEME.amber, fixed: true });
      k.drawText({ text: "How to Play", pos: k.vec2(obTab[0] + obTab[2] + 13, obY + (narrowOb ? 28 : 36)), size: narrowOb ? 24 : 30, font: FONT_BOLD, color: k.rgb(...THEME.text), fixed: true });
      drawHairline(k, { x: obX + pad, y: obY + headH - 10, w: obW - pad * 2, opacity: 0.1, fixed: true });
      k.pushClip(obX, obY + headH - 8, obW, Math.max(0, obH - headH - footH + 8));
      let ly = obY + headH;
      rows.forEach((r, i) => {
        if (i > 0) drawHairline(k, { x: obX + pad, y: ly - 5, w: obW - pad * 2, opacity: 0.06, fixed: true });
        k.drawText({ text: r[0], pos: k.vec2(obX + pad, ly), size: sz, font: FONT_BOLD, color: k.rgb(...THEME.text), fixed: true });
        if (r[1]) k.drawText({ text: r[1], pos: k.vec2(obX + pad + (narrowOb ? 0 : labW), ly + (narrowOb ? lh : 0)), size: sz, font: "gameFont", width: bodyW, color: k.rgb(...THEME.textBody), fixed: true });
        ly += rowH(r);
      });
      k.popClip();
      const pulse = prefersReducedMotion() ? 0.9 : 0.55 + 0.45 * Math.sin(k.time() * 4);
      k.drawText({ text: TOUCH ? "Tap anywhere to begin" : "Move or tap to begin", pos: k.vec2(cx, obY + obH - 26), size: 14, font: FONT_BOLD, anchor: "center", color: k.rgb(...THEME.amber), opacity: pulse, fixed: true });
    }
    let awaiting = false;
    let lastLogLen = 0;
    const logTicker = { line: "", t0: 0 };
    let activeAtkT0 = -1, enemyAtkT0 = -1;
    let combatInspect = null, combatRowRects = null;

    const TOUCH = touchPrimary(k);
    let safeInset = { top: 0, right: 0, bottom: 0, left: 0 };
    const recomputeSafeInset = () => { safeInset = safeInsetsDesign(k); };
    if (TOUCH) recomputeSafeInset();
    const hudSlots = () => hudLayout(k.width(), k.height(), { inset: safeInset, maxAspect: winAspect(), touch: TOUCH });
    const COMBAT_H = 264;

    const lobbyChar = (() => { try { return getCharacter(args.characterId); } catch { return null; } })()
      || { name: net.state.nickname || "Tamer", level: 1, isGuest: false };
    const lobbyPanelActive = () => hudSlots().orientation === "landscape"
      && !net.state.combat && !net.state.roundResult && !onboard && !menuOpen && net.state.connected;
    const THROW_PAD_R = 66;
    const THROW_HINT_R = 42;
    const throwBtnC = () => { const t = hudSlots().throwBtn; return k.vec2(t.x, t.y); };
    const SWAP_R = 40;
    const swapBtnC = () => { const s = hudSlots().swapBtn; return s ? k.vec2(s.x, s.y) : k.vec2(-999, -999); };
    let throwAim = null;
    let throwCharge = 0;
    let kbCharge = null;
    let throwSpinPhase = 0;
    let throwLungeT0 = -9;
    const currentAimDir = () => {
      if (!TOUCH) { const m = k.mousePos(), ax = m.x - k.width() / 2, ay = m.y - k.height() / 2, al = Math.hypot(ax, ay); if (al > 4) return { x: ax / al, y: ay / al }; }
      if (throwAim && throwAim.dragged) return throwAim.dir;
      return selfDir;
    };
    const pauseBtnRect = () => { const p = hudSlots().pause; return [p.x, p.y, p.w, p.h]; };
    let menuOpen = false;
    let menuSel = 0;
    let leaveArm = false;
    let extractFlashT = null;
    let extractSfxDone = false;
    const menuBtns = () => {
      const cx = k.width() / 2, bw = Math.min(300, k.width() - 72), bh = 50, gap = 12, y0 = k.height() / 2 - 46;
      return [
        { rect: [cx - bw / 2, y0, bw, bh], label: "Resume", act: () => { menuOpen = false; leaveArm = false; } },
        { rect: [cx - bw / 2, y0 + (bh + gap), bw, bh], label: `Sound: ${isMuted() ? "Off" : "On"}`, act: () => { toggleMuted(); leaveArm = false; } },
        net.state.adventure
          ? { rect: [cx - bw / 2, y0 + (bh + gap) * 2, bw, bh], label: "Return to village", act: () => { menuOpen = false; leaveArm = false; net.returnHome(); } }
          : { rect: [cx - bw / 2, y0 + (bh + gap) * 2, bw, bh], label: leaveArm ? "Confirm — lose this run" : "Leave round", danger: leaveArm,
            act: () => { if (!leaveArm) { leaveArm = true; return; } menuOpen = false; leaveArm = false; net.leaveRun(); } },
      ];
    };

    function drawBar(x, y, w, h, ratio, col, label, pulseLow = false) {
      const r = Math.max(0, Math.min(1, ratio || 0));
      k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius: h / 2, color: k.rgb(...UI.track), fixed: true });
      if (r > 0) {
        const fw = Math.max(h, w * r);
        k.drawRect({ pos: k.vec2(x, y), width: fw, height: h, radius: h / 2, color: k.rgb(col[0], col[1], col[2]), fixed: true });
        if (pulseLow && r <= 0.25 && !prefersReducedMotion()) {
          k.drawRect({ pos: k.vec2(x, y), width: fw, height: h, radius: h / 2, color: k.rgb(255, 255, 255), opacity: 0.12 + 0.22 * (0.5 + 0.5 * Math.sin(k.time() * 8)), fixed: true });
        }
      }
      if (label) {
        k.drawText({ text: label, pos: k.vec2(x + w - 5, y + h / 2 + 1), size: 11, font: "gameFont", anchor: "right", color: k.rgb(...UI.panel), opacity: 0.75, fixed: true });
        k.drawText({ text: label, pos: k.vec2(x + w - 6, y + h / 2), size: 11, font: "gameFont", anchor: "right", color: k.rgb(...UI.text), fixed: true });
      }
    }
    const prettyStatus = (s) => String(s || "")
      .replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
    function drawCombatant(mon, y, title, m, W, flash = 0, side = null) {
      if (!mon) return;
      const sideCol = side === "enemy" ? UI.danger : UI.primary;
      drawGlass(k, { rect: [m - 8, y - 3, W + 16, 42], radius: 12, tint: 0.3, fill: 0.045, line: 0.08, fixed: true });
      if (side) k.drawRect({ pos: k.vec2(m - 8, y + 3), width: 3, height: 30, radius: 1.5, color: k.rgb(...sideCol), fixed: true });
      const P = 44, fainted = mon.maxHealth && mon.currentHealth <= 0;
      k.drawRect({ pos: k.vec2(m, y + 2), width: 34, height: 34, radius: 10, color: k.rgb(...THEME.bg), opacity: 0.7, fixed: true });
      k.drawRect({ pos: k.vec2(m + 0.5, y + 2.5), width: 33, height: 33, radius: 9.5, color: k.rgb(...sideCol), opacity: fainted ? 0.3 : 0.7, fill: false, outline: { width: 1.5, color: k.rgb(...sideCol) }, fixed: true });
      drawMonsterIcon(k, { typeName: mon.typeName, cx: m + 17, cy: y + 19, scale: 0.125, topY: y + 3, fixed: true, opacity: fainted ? 0.3 : 1, measure: false });
      const bx = m + P;
      const lvTxt = `Lv ${mon.level}`;
      const lvW = (typeof k.measureText === "function" ? k.measureText(lvTxt, 9, FONT_BOLD) : 24) + 14;
      const statusTxt = mon.status ? prettyStatus(mon.status) : "";
      const statusW = statusTxt ? (typeof k.measureText === "function" ? k.measureText(statusTxt, 12, "gameFont") : statusTxt.length * 7) + 10 : 0;
      const nameAvail = W - P - lvW - 8 - statusW;
      const nameMax = Math.max(6, Math.floor(nameAvail / 8));
      const nm = trunc(title, nameMax);
      k.drawText({ text: nm, pos: k.vec2(bx, y), size: 15, font: FONT_BOLD, color: k.rgb(...UI.text), fixed: true });
      const nmW = typeof k.measureText === "function" ? k.measureText(nm, 15, FONT_BOLD) : nm.length * 8.4;
      drawChip(k, { x: bx + nmW + 8, y: y - 1, text: lvTxt, color: THEME.textBody, size: 9, h: 17, padX: 6, fixed: true });
      if (statusTxt) k.drawText({ text: statusTxt, pos: k.vec2(m + W, y + 1), size: 12, font: FONT_BOLD, anchor: "right", color: k.rgb(...UI.amber), fixed: true });
      const hpR = mon.maxHealth ? mon.currentHealth / mon.maxHealth : 0;
      const hpTxt = `${mon.currentHealth}/${mon.maxHealth}`, gutter = Math.min(76, Math.max(46, hpTxt.length * 7.2 + 12));
      const barW = W - P - gutter;
      drawBar(bx, y + 19, barW, 11, hpR, hpColor(hpR), null, true);
      k.drawText({ text: hpTxt, pos: k.vec2(bx + W - P, y + 24), size: 12, font: FONT_BOLD, anchor: "right", color: k.rgb(...(hpR <= 0.25 ? THEME.danger : UI.text)), fixed: true });
      if (mon.maxEnergy) { drawIcon(k, "bolt", { x: bx + 5, y: y + 35.5, size: 9, color: [120, 180, 250], fixed: true }); drawBar(bx + 12, y + 33, barW - 12, 5, mon.currentEnergy / mon.maxEnergy, [90, 160, 240], null); }
      if (flash > 0) k.drawRect({ pos: k.vec2(m - 5, y - 4), width: W + 10, height: 44, radius: 5, color: k.rgb(255, 255, 255), opacity: 0.3 * flash, fixed: true });
    }

    const mmSizeBase = minimapSize(k.width(), k.height());
    let mmCells = null;
    let mmZoom = 1;
    function buildMinimap() {
      if (!map) return;
      const N = 34, step = Math.max(1, Math.floor(map.mapSize / N));
      const cells = [];
      for (let x = 0; x < map.mapSize; x += step) {
        for (let y = 0; y < map.mapSize; y += step) {
          const t = map.tileMap[x]?.[y];
          if (!t) continue;
          const tc = [t.colorProfile_full_r, t.colorProfile_full_g, t.colorProfile_full_b];
          const tint = biomeTintAt(map, x, y);
          const col = tint
            ? [Math.round(tint[0] * 0.65 + tc[0] * 0.35), Math.round(tint[1] * 0.65 + tc[1] * 0.35), Math.round(tint[2] * 0.65 + tc[2] * 0.35)]
            : tc;
          cells.push({ tx: x, ty: y, key: fogKey(x, y), fx: x / map.mapSize, fy: y / map.mapSize, col });
        }
      }
      mmCells = { cells, frac: step / map.mapSize };
    }
    function drawMinimap() {
      if (!map) return;
      if (!mmCells) buildMinimap();
      const E = GAME.EFFECTIVE_TILE;
      const mmSlot = hudSlots().minimap;
      const ox = mmSlot.x, oy = mmSlot.y;
      const mmSize = mmSlot.size || mmSizeBase;
      const view = minimapWindow({ mapSize: map.mapSize, mmSize, mmX: ox, mmY: oy, zoom: mmZoom, playerTileX: selfRender.x / E, playerTileY: selfRender.y / E });
      const Z = view.zoom;
      const mm = (wx, wy) => { const p = view.project(wx / E, wy / E); return k.vec2(p.x, p.y); };
      const inWin = (wx, wy) => view.inWindow(wx / E, wy / E);
      drawGlass(k, { rect: [ox - 6, oy - 6, mmSize + 12, mmSize + 12], radius: 12, tint: 0.6, fill: 0.06, line: 0.14, fixed: true });
      k.drawRect({ pos: k.vec2(ox - 1, oy - 1), width: mmSize + 2, height: mmSize + 2, radius: 4, color: k.rgb(...UI.panel), opacity: 0.9, fixed: true });
      for (let g = 1; g < 4; g++) {
        const gx = ox + (mmSize * g) / 4, gy = oy + (mmSize * g) / 4;
        k.drawLine({ p1: k.vec2(gx, oy + 2), p2: k.vec2(gx, oy + mmSize - 2), width: 1, color: k.rgb(...WHITE), opacity: 0.06, fixed: true });
        k.drawLine({ p1: k.vec2(ox + 2, gy), p2: k.vec2(ox + mmSize - 2, gy), width: 1, color: k.rgb(...WHITE), opacity: 0.06, fixed: true });
      }
      if (mmCells) {
        const step = Math.max(1, Math.round(mmCells.frac * map.mapSize));
        const cw = Math.max(2, step * view.scale + 0.5);
        for (const c of mmCells.cells) {
          if (!explored.has(c.key)) continue;
          if (Z > 1 && !view.cellVisible(c.tx, c.ty, step)) continue;
          const p = view.project(c.tx, c.ty);
          k.drawRect({ pos: k.vec2(p.x, p.y), width: cw, height: cw, color: k.rgb(c.col[0], c.col[1], c.col[2]), opacity: 0.5, fixed: true });
        }
      }
      if (net.state.circle && Z === 1) {
        const c = net.state.circle;
        k.pushClip(ox, oy, mmSize, mmSize);
        try { k.drawCircle({ pos: mm(c.x, c.y), radius: Math.max(2, (c.r / E) * view.scale), fill: false, outline: { width: 1.5, color: k.rgb(...THEME.storm) }, opacity: 0.85, fixed: true }); } finally { k.popClip(); }
      }
      const pulse = prefersReducedMotion() ? 0.9 : 0.6 + 0.4 * Math.sin(k.time() * 4);
      const portalCol = k.rgb(...THEME.portal), monBlipCol = k.rgb(220, 180, 80), chestCol = k.rgb(228, 206, 128), rivalCol = k.rgb(235, 95, 95);
      for (const p of net.state.portals) { if (Z > 1 && !inWin(p.x, p.y)) continue; k.drawCircle({ pos: mm(p.x, p.y), radius: 3.5 * pulse + 1.5, color: portalCol, fixed: true }); }
      for (const mo of net.state.monsters) { if (Z > 1 && !inWin(mo.x, mo.y)) continue; k.drawCircle({ pos: mm(mo.x, mo.y), radius: 1.6, color: monBlipCol, fixed: true }); }
      const cmr2 = GAME.SPIRIT_CHAIN.CHEST_MINIMAP_RADIUS ** 2;
      for (const c of net.state.chests) {
        const dx = c.x - selfRender.x, dy = c.y - selfRender.y;
        if (dx * dx + dy * dy > cmr2) continue;
        if (Z > 1 && !inWin(c.x, c.y)) continue;
        k.drawCircle({ pos: mm(c.x, c.y), radius: 2.2, color: chestCol, fixed: true });
      }
      for (const p of net.state.players) {
        if (Z > 1 && !inWin(p.x, p.y)) continue;
        const mp = mm(p.x, p.y);
        k.drawRect({ pos: k.vec2(mp.x - 1.5, mp.y - 1), width: 3, height: 4, color: rivalCol, fixed: true });
        k.drawCircle({ pos: k.vec2(mp.x, mp.y - 2), radius: 1.6, color: rivalCol, fixed: true });
      }
      const sp = mm(selfRender.x, selfRender.y);
      k.drawCircle({ pos: sp, radius: 3.5, color: k.rgb(90, 170, 255), outline: { width: 1.5, color: k.rgb(255, 255, 255) }, fixed: true });
      if (selfDir && (selfDir.x || selfDir.y)) {
        const dl = Math.hypot(selfDir.x, selfDir.y) || 1, nx = selfDir.x / dl, ny = selfDir.y / dl;
        k.drawLine({ p1: k.vec2(sp.x + nx * 3, sp.y + ny * 3), p2: k.vec2(sp.x + nx * 9, sp.y + ny * 9), width: 2.2, color: k.rgb(255, 255, 255), opacity: 0.95, fixed: true });
      }
      if (Z !== 1) k.drawText({ text: `${Z}x`, pos: k.vec2(ox + 5, oy + 4), size: 11, font: "gameFont", color: k.rgb(...UI.text), opacity: 0.85, fixed: true });
    }

    let TEAM_X = pwTop.x + 12, TEAM_Y0 = pwTop.y + 78;
    const TEAM_ROW_H = 22, TEAM_CARD_W = 134, TEAM_BAR_H = 7, STAMINA_H = 7;
    const teamLen = () => net.state.self?.team?.length || 0;
    const staminaY = () => TEAM_Y0 + teamLen() * TEAM_ROW_H + 6;
    const teamHudBottom = () => staminaY() + STAMINA_H + 8;
    const trunc = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

    function drawTeamHp() {
      const team = net.state.self?.team;
      if (!team || !team.length) return;
      const full = net.state.team || [];
      if (hudSlots().orientation !== "landscape") {
        const ph = team.length * TEAM_ROW_H + 6 + STAMINA_H + 14 + 18;
        drawGlass(k, { rect: [TEAM_X - 10, TEAM_Y0 - 22, TEAM_CARD_W + 20, ph], radius: 14, tint: 0.62, fill: 0.05, line: 0.12, fixed: true });
      }
      drawIcon(k, "person", { x: TEAM_X + 5, y: TEAM_Y0 - 10, size: 11, color: THEME.primary, fixed: true });
      drawEyebrow(k, { x: TEAM_X + 14, y: TEAM_Y0 - 15, text: "Team", size: 9, color: UI.mut, spacing: 1.8, fixed: true });
      team.forEach((mo, i) => {
        const y = TEAM_Y0 + i * TEAM_ROW_H;
        const r = mo.max ? mo.hp / mo.max : 0;
        const fainted = mo.hp <= 0;
        const m = full[i];
        const name = m ? (m.name || m.typeName || "?") : `Monster ${i + 1}`;
        k.drawRect({ pos: k.vec2(TEAM_X - 2, y - 1), width: 18, height: 18, radius: 5, color: k.rgb(...THEME.bg), opacity: 0.6, fixed: true });
        if (m) drawMonsterIcon(k, { typeName: m.typeName, cx: TEAM_X + 7, cy: y + 8, scale: 0.062, topY: y, fixed: true, opacity: fainted ? 0.35 : 1, measure: false });
        k.drawText({ text: trunc(name, 14), pos: k.vec2(TEAM_X + 21, y - 2), size: 10, font: FONT_BOLD, color: k.rgb(...(fainted ? UI.mut : UI.text)), opacity: fainted ? 0.7 : 1, fixed: true });
        k.drawText({ text: String(mo.hp), pos: k.vec2(TEAM_X + TEAM_CARD_W, y - 1), size: 9, font: FONT_BOLD, anchor: "right", color: k.rgb(...(fainted ? UI.mut : r <= 0.25 ? THEME.danger : UI.mut)), fixed: true });
        drawBar(TEAM_X + 21, y + 11, TEAM_CARD_W - 21, TEAM_BAR_H, r, fainted ? [70, 70, 78] : hpColor(r), null, !fainted);
      });
      const sy = staminaY();
      const sr = (net.state.stamina ?? GAME.SPRINT.STAMINA_MAX) / GAME.SPRINT.STAMINA_MAX;
      drawIcon(k, "bolt", { x: TEAM_X + 5, y: sy + 3, size: 10, color: sr > 0.3 ? [120, 200, 230] : [220, 170, 80], fixed: true });
      k.drawText({ text: "Stamina", pos: k.vec2(TEAM_X + 14, sy - 1), size: 9, font: "gameFont", color: k.rgb(...UI.mut), fixed: true });
      drawBar(TEAM_X + 62, sy, TEAM_CARD_W - 62, STAMINA_H, sr, sr > 0.3 ? [120, 200, 230] : [220, 170, 80], null);
    }

    function equippedChain() {
      const id = net.state.equippedChainId;
      const cs = (net.state.chains || []).find((c) => c.chainId === id);
      return cs ? { cs, def: getSpiritChain(cs.chainId) } : null;
    }

    function playThrowWindup(x, y, col) {
      const t0 = k.time(), reduce = prefersReducedMotion();
      const h = k.onDraw(() => {
        const p = (k.time() - t0) / 0.2;
        if (p >= 1) { h.cancel(); return; }
        const r = reduce ? 18 : 6 + 26 * (1 - p);
        k.drawCircle({ pos: k.vec2(x, y), radius: r, fill: false, outline: { width: 2 + 2 * (1 - p), color: k.rgb(col[0], col[1], col[2]) }, opacity: 0.6 * (1 - p) });
      });
      emit({ x, y, n: 6, color: col, speed: 26, life: 0.3, size: 2.4, spread: Math.PI * 2, drag: 3 });
    }

    function chainHudRect() {
      const ids = net.state.equippedChainIds || [];
      const bh = ids.length > 1 ? 56 : 40;
      const hud = hudSlots();
      if (hud.orientation === "portrait") return [hud.chain.x, hud.chain.y, 150, bh];
      return [TEAM_X, teamHudBottom(), 150, bh];
    }
    function drawChainHud() {
      const e = equippedChain();
      const ids = net.state.equippedChainIds || [];
      const [x, y, w, h] = chainHudRect();
      drawGlass(k, { rect: [x, y, w, h], radius: 12, tint: 0.62, fill: 0.05, line: 0.12, fixed: true });
      if (e && e.def) {
        k.drawCircle({ pos: k.vec2(x + 20, y + 20), radius: 15, color: k.rgb(...THEME.bg), opacity: 0.5, fixed: true });
        drawChainGlyph(k, e.def, { x: x + 20, y: y + 20, size: 24, fixed: true });
        const dur = e.cs.durability ?? e.def.durability ?? 1;
        const tierN = e.def.tier || 1;
        drawChip(k, { x: x + w - 6, y: y + 5, text: `T${tierN}`, color: tierColor(tierN), size: 8, h: 15, padX: 5, anchor: "right", fixed: true });
        const nmMax = Math.max(6, Math.floor((w - 38 - 40) / 6.2));
        k.drawText({ text: trunc(e.def.name, nmMax), pos: k.vec2(x + 38, y + 5), size: 11, font: FONT_BOLD, color: k.rgb(...UI.text), fixed: true });
        drawIcon(k, "chain", { x: x + 44, y: y + 27, size: 11, color: UI.body, fixed: true });
        k.drawText({ text: `${dur} charge${dur === 1 ? "" : "s"}   ${TOUCH ? "tap Throw" : "Space"}`, pos: k.vec2(x + 53, y + 22), size: 10, font: "gameFont", color: k.rgb(...UI.body), fixed: true });
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
      drawAtRiskPill(x, y + h + 6);
    }

    function drawAtRiskPill(x, ry) {
      const ar = net.state.atRisk || {};
      const kinds = [["chain", (net.state.chains || []).filter((c) => c.runFound).length], ["catch", ar.catches || 0], ["bag", ar.items || 0]].filter(([, n]) => n > 0);
      if (kinds.length) {
        const pw = 58 + kinds.length * 28;
        drawGlass(k, { rect: [x, ry, pw, 22], radius: 11, tint: 0.62, fill: 0.05, line: 0, fixed: true });
        k.drawRect({ pos: k.vec2(x + 0.5, ry + 0.5), width: pw - 1, height: 21, radius: 10.5, color: k.rgb(...UI.amber), opacity: 0.6, fill: false, outline: { width: 1, color: k.rgb(...UI.amber) }, fixed: true });
        k.drawText({ text: "At risk", pos: k.vec2(x + 10, ry + 5), size: 11, font: FONT_BOLD, color: k.rgb(...UI.amber), fixed: true });
        kinds.forEach(([ic, n], i) => {
          const kx = x + 54 + i * 28;
          drawIcon(k, ic, { x: kx + 6, y: ry + 11, size: 11, color: UI.amber, fixed: true });
          k.drawText({ text: String(n), pos: k.vec2(kx + 14, ry + 5), size: 11, font: FONT_BOLD, color: k.rgb(...UI.text), fixed: true });
        });
      }
    }

    const DANGER_FILL_S = 30; // Mirrors server DANGER_FILL_S (world.js) - change both
    function drawDangerBar(danger, outside) {
      const pw = playWindowRect(k.width(), k.height(), { maxAspect: winAspect() });
      const bw = Math.min(pw.size * 0.62, 380), bh = 8, cardH = 52;
      const bx = pw.cx - bw / 2, by = pw.y + 12;
      const col = danger > 0.6 ? THEME.danger : THEME.amber;
      const pulse = outside && !prefersReducedMotion() ? 0.8 + 0.2 * Math.sin(k.time() * 8) : 0.95;
      drawGlass(k, { rect: [bx - 14, by, bw + 28, cardH], radius: 16, tint: 0.66, fill: 0.05, line: 0, fixed: true });
      k.drawRect({ pos: k.vec2(bx - 13.5, by + 0.5), width: bw + 27, height: cardH - 1, radius: 15.5, color: k.rgb(...col), opacity: 0.75 * pulse, fill: false, outline: { width: 1, color: k.rgb(...col) }, fixed: true });
      const secs = Math.max(1, Math.ceil((1 - danger) * DANGER_FILL_S));
      drawIcon(k, outside ? "skull" : "heart", { x: bx + 4, y: by + 18, size: 16, color: col, opacity: pulse, fixed: true });
      k.drawText({ text: outside ? "Outside the safe zone" : "Recovering", pos: k.vec2(bx + 20, by + 10), size: 13, font: FONT_BOLD, anchor: "left", color: k.rgb(...col), opacity: pulse, fixed: true });
      if (outside) k.drawText({ text: `${secs}s`, pos: k.vec2(bx + bw, by + 10), size: 14, font: FONT_BOLD, anchor: "topright", color: k.rgb(...col), opacity: pulse, fixed: true });
      k.drawRect({ pos: k.vec2(bx, by + 34), width: bw, height: bh, radius: bh / 2, color: k.rgb(255, 255, 255), opacity: 0.1, fixed: true });
      if (danger > 0.001) k.drawRect({ pos: k.vec2(bx, by + 34), width: Math.max(bh, bw * danger), height: bh, radius: bh / 2, color: k.rgb(...col), opacity: pulse, fixed: true });
    }

    function drawDanger() {
      const c = net.state.circle, self = net.state.self;
      if (!c || !self) return;
      const dx = self.x - c.x, dy = self.y - c.y;
      const outside = dx * dx + dy * dy > c.r * c.r;
      const danger = Math.max(0, Math.min(1, self.danger || 0));
      if (danger > 0 || outside) drawDangerBar(danger, outside);
      if (!outside) return;
      const pulse = 0.5 + 0.5 * Math.sin(k.time() * 6);
      const W = k.width(), H = k.height(), t = 8, op = 0.25 + 0.45 * pulse;
      const red = k.rgb(...THEME.danger);
      void t;
      const pwv = playWindowRect(W, H, { maxAspect: winAspect() });
      k.drawRect({ pos: k.vec2(pwv.x, pwv.y), width: pwv.w, height: pwv.size, color: red, opacity: 1, fixed: true,
        gradient: { dir: "radial", cx: 0.5, cy: 0.5, r: Math.max(pwv.w, pwv.size) * 0.72, stops: [[0, THEME.danger, 0], [0.55, THEME.danger, 0], [1, THEME.danger, 0.55 * op]] } });
      const pw = playWindowRect(W, H, { maxAspect: winAspect() }), cy = pw.y + Math.round(pw.size * 0.26);
      const dist = Math.hypot(dx, dy);
      const toSafe = Math.max(0, Math.round((dist - c.r) / GAME.EFFECTIVE_TILE));
      k.drawText({ text: `${toSafe} tiles to safety. Run toward the arrow.`, pos: k.vec2(pw.cx, cy + 26), size: 14, font: FONT_BOLD, anchor: "center", color: red, opacity: 0.8, fixed: true });
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
      const pw = playWindowRect(W, H, { maxAspect: winAspect() });
      const sx = (np.x - selfRender.x) + pw.cx, sy = (np.y - selfRender.y) + pw.cy;
      if (sx >= pw.x + margin && sx <= pw.right - margin && sy >= pw.y + margin && sy <= pw.bottom - margin) return;
      const ang = Math.atan2(sy - pw.cy, sx - pw.cx), c = Math.cos(ang), s = Math.sin(ang);
      const hw = pw.size / 2 - margin, hh = pw.size / 2 - margin;
      const scale = Math.min(hw / (Math.abs(c) || 1e-6), hh / (Math.abs(s) || 1e-6));
      const ax = pw.cx + c * scale, ay = pw.cy + s * scale;
      const cyan = k.rgb(...THEME.portal), pulse = prefersReducedMotion() ? 0.9 : 0.6 + 0.4 * Math.sin(k.time() * 4), wid = 3;
      k.drawCircle({ pos: k.vec2(ax, ay), radius: 19, color: k.rgb(...THEME.bg), opacity: 0.75, fixed: true });
      k.drawCircle({ pos: k.vec2(ax, ay), radius: 19, fill: false, outline: { width: 1.5, color: cyan }, opacity: 0.5 + 0.35 * pulse, fixed: true });
      drawIcon(k, "portal", { x: ax - c * 4, y: ay - s * 4, size: 12, color: THEME.portal, opacity: 0.6, fixed: true });
      const tip = k.vec2(ax + c * 9, ay + s * 9), b = 8, a1 = ang + Math.PI * 0.78, a2 = ang - Math.PI * 0.78;
      k.drawLine({ p1: k.vec2(ax - c * 7, ay - s * 7), p2: tip, width: wid, color: cyan, fixed: true });
      k.drawLine({ p1: tip, p2: k.vec2(tip.x + Math.cos(a1) * b, tip.y + Math.sin(a1) * b), width: wid, color: cyan, fixed: true });
      k.drawLine({ p1: tip, p2: k.vec2(tip.x + Math.cos(a2) * b, tip.y + Math.sin(a2) * b), width: wid, color: cyan, fixed: true });
      const dist = Math.round(Math.sqrt(best) / GAME.EFFECTIVE_TILE);
      k.drawText({ text: `${dist}`, pos: k.vec2(ax - c * 31, ay - s * 31), size: 13, font: "gameFont", anchor: "center", color: cyan, fixed: true });
    }

    function drawTimeWarning() {
      const t = net.state.time || 0;
      if (t <= 0 || t > 60) return;
      const pw = playWindowRect(k.width(), k.height(), { maxAspect: winAspect() }), mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, "0");
      const crit = t <= 30, pulse = crit ? 0.55 + 0.45 * Math.sin(k.time() * 8) : 1;
      const selfD = net.state.self, circ = net.state.circle;
      const dangerShown = !!(circ && selfD && ((selfD.danger || 0) > 0 || ((selfD.x - circ.x) ** 2 + (selfD.y - circ.y) ** 2) > circ.r * circ.r));
      const clockY = pw.y + (dangerShown ? 108 : 64);
      const colA = crit ? THEME.danger : THEME.amber, col = k.rgb(...colA);
      const tStr = `${mm}:${ss}`, tSize = crit ? 34 : 28;
      const tw = (typeof k.measureText === "function" ? k.measureText(tStr, tSize, FONT_BOLD) : tStr.length * tSize * 0.6) + 70;
      drawGlass(k, { rect: [pw.cx - tw / 2, clockY - tSize / 2 - 8, tw, tSize + 16], radius: (tSize + 16) / 2, tint: 0.62, fill: 0.06, line: 0, fixed: true });
      k.drawRect({ pos: k.vec2(pw.cx - tw / 2 + 0.5, clockY - tSize / 2 - 7.5), width: tw - 1, height: tSize + 15, radius: (tSize + 15) / 2, color: col, opacity: 0.7 * pulse, fill: false, outline: { width: 1, color: col }, fixed: true });
      drawIcon(k, "clock", { x: pw.cx - tw / 2 + 24, y: clockY, size: tSize * 0.6, color: colA, opacity: pulse, fixed: true });
      k.drawText({ text: tStr, pos: k.vec2(pw.cx + 12, clockY), size: tSize, font: FONT_BOLD, anchor: "center", color: col, opacity: pulse, fixed: true });
      k.drawText({ text: crit ? "Storm closing. Extract now." : "Extract soon", pos: k.vec2(pw.cx, clockY + (crit ? 36 : 32)), size: crit ? 14 : 12, font: FONT_BOLD, anchor: "center", color: col, opacity: 0.85 * pulse, fixed: true });
    }

    function drawKillFeed() {
      const feed = net.state.killfeed;
      if (!feed || !feed.length) return;
      const now = Date.now(), SHOW = 4000, FADE = 2000;
      const mm = hudSlots().minimap;
      const x = mm.x + mm.size;
      let y = mm.y + mm.size + 14;
      for (const e of feed) {
        const age = now - (e.recvAt || now);
        if (age > SHOW + FADE) continue;
        const op = age < SHOW ? 1 : Math.max(0, 1 - (age - SHOW) / FADE);
        let text, col;
        const kn = trunc(e.killer || "?", 10), vn = trunc(e.victim || "?", 10);
        let icon = "flag";
        if (e.cause === "pvp") { text = `${kn} defeated ${vn}`; col = THEME.danger; icon = "sword"; }
        else if (e.cause === "extracted") { text = `${vn} escaped`; col = THEME.success; icon = "portal"; }
        else if (e.cause === "zone") { text = `${vn} lost to the storm`; col = THEME.danger; icon = "skull"; }
        else if (e.cause === "timeout") { text = `${vn} ran out of time`; col = THEME.textBody; icon = "clock"; }
        else if (e.cause === "disconnect") { text = `${vn} disconnected`; col = THEME.textMut; icon = "flee"; }
        else if (e.cause === "defeat") { text = `${vn} was defeated`; col = THEME.danger; icon = "skull"; }
        else { text = `${vn} is out`; col = THEME.textBody; }
        const tw = (typeof k.measureText === "function" ? k.measureText(text, 11, FONT_BOLD) : text.length * 6.5) + 36;
        drawGlass(k, { rect: [x - tw, y - 4, tw, 20], radius: 10, tint: 0.6 * op, fill: 0.05 * op, line: 0.1 * op, fixed: true });
        drawIcon(k, icon, { x: x - tw + 12, y: y + 6, size: 11, color: col, opacity: op, fixed: true });
        k.drawText({ text, pos: k.vec2(x - 8, y), size: 11, font: FONT_BOLD, anchor: "topright", color: k.rgb(...col), opacity: op, fixed: true });
        y += 24;
      }
    }

    function drawTopNotice(n, clear, yOff = 110) {
      if (!n) return;
      const age = Date.now() - (n.at || 0), SHOW = 3000, FADE = 1200;
      if (age > SHOW + FADE) { clear(); return; }
      const op = age < SHOW ? 1 : Math.max(0, 1 - (age - SHOW) / FADE);
      const pw = playWindowRect(k.width(), k.height(), { maxAspect: winAspect() });
      const cx = pw.cx, y = pw.y + yOff;
      const tw0 = typeof k.measureText === "function" ? k.measureText(n.text, 13, FONT_BOLD) : n.text.length * 7;
      const tw = Math.min(pw.size - 24, tw0 + 54);
      drawGlass(k, { rect: [cx - tw / 2, y - 15, tw, 30], radius: 15, tint: 0.66 * op, fill: 0.06 * op, line: 0, fixed: true });
      k.drawRect({ pos: k.vec2(cx - tw / 2 + 0.5, y - 14.5), width: tw - 1, height: 29, radius: 14.5, color: k.rgb(...UI.amber), opacity: 0.7 * op, fill: false, outline: { width: 1, color: k.rgb(...UI.amber) }, fixed: true });
      drawIcon(k, "info", { x: cx - tw / 2 + 17, y, size: 14, color: UI.amber, opacity: op, fixed: true });
      k.drawText({ text: n.text, pos: k.vec2(cx + 10, y), size: 13, font: FONT_BOLD, anchor: "center", width: tw - 44, color: k.rgb(...UI.amber), opacity: op, fixed: true });
    }
    function drawCombatNotice() { drawTopNotice(net.state.combatNotice, () => { net.state.combatNotice = null; }); }
    function drawLootNotice() { drawTopNotice(net.state.lootNotice, () => { net.state.lootNotice = null; }, 148); }

    const JOY_R = JOY_RADIUS;
    const joyRest = () => { const j = hudSlots().joystick; return k.vec2(j.x, j.y); };
    let joyId = null;
    let joyVec = { x: 0, y: 0 };
    let joyBase = joyRest();
    let thumb = joyBase;

    function joyStart(id, p) {
      if (joyId !== null) return;
      if (id !== "m" && p.x >= k.width() / 2) return;
      joyId = id;
      joyBase = k.vec2(
        Math.max(JOY_R, Math.min(k.width() - JOY_R, p.x)),
        Math.max(JOY_R, Math.min(k.height() - JOY_R, p.y)),
      );
      thumb = joyBase;
      joyMove(id, p);
    }
    function joyMove(id, p) {
      if (id !== joyId) return;
      // k.vec2 / pointer positions are bare {x,y}: no .sub/.len/.scale methods
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
      if (!c || c.outcome || c.waiting) { swapOpen = false; itemsOpen = false; return []; }
      const pw = playWindowRect(k.width(), k.height(), { maxAspect: winAspect() });
      const top = Math.min(k.height(), pw.bottom) - COMBAT_H - safeInset.bottom, m = pw.x + 12, gap = 8, h = 54;
      const iw = pw.w - 24;
      const y = top + 100;
      const subRowH = (n) => {
        const panelBottom = Math.min(k.height(), pw.bottom) - safeInset.bottom;
        return Math.max(28, Math.min(h, (panelBottom - y - 8 - gap * (n - 1)) / n));
      };
      if (swapOpen) {
        const fw = iw;
        const bench = benchList().slice(0, 3);
        const sh = subRowH(bench.length + 1);
        const btns = bench.map((b, i) => ({
          rect: [m, y + i * (sh + gap), fw, sh],
          label: `Swap to ${trunc(b.m.name || b.m.typeName, 16)}  Lv.${b.m.level}  (${b.cur}/${b.max})`,
          action: { kind: "swap", monsterId: b.m.id },
        }));
        btns.push({ rect: [m, y + bench.length * (sh + gap), fw, sh], label: "Back", action: { kind: "closeSwap" } });
        return btns;
      }
      if (itemsOpen) {
        const fw = iw;
        const items = (net.state.items || []).slice(0, 3);
        const sh = subRowH(items.length + 1);
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
        rect: [m + i * (w + gap), y, w, h], label: cleanAttackName(a.name),
        cost: a.energyCost,
        damage: a.damage,
        hotkey: i + 1,
        affordable: (a.energyCost ?? 0) <= energy,
        description: a.description || "",
        action: { kind: "attack", attackName: a.name }, // Server looks attacks up by the FULL name (label is cleaned)
      }));
      const y2 = y + h + gap;
      const row = [];
      if (!c.pvp) row.push({ label: "Catch", action: { kind: "catch" } });
      if (benchList().length > 0) row.push({ label: "Swap", action: { kind: "openSwap" } });
      // PvE only: PvP resolveTurn ignores item actions (turn would be wasted)
      if (!c.pvp && (net.state.items || []).length > 0) row.push({ label: "Items", action: { kind: "openItems" } });
      row.push({ label: "Flee", action: { kind: "flee" } });
      const rw = (iw - gap * (row.length - 1)) / row.length;
      row.forEach((r, i) => btns.push({ rect: [m + i * (rw + gap), y2, rw, h], label: r.label, action: r.action }));
      return btns;
    }
    function hitButtonObj(p) {
      for (const b of combatButtons()) {
        const [x, y, w, h] = b.rect;
        if (p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h) return b;
      }
      return null;
    }
    let atkHold = null;

    let sendAcc = 0, pingAcc = 0, safeAcc = 0, moveSent = false;
    let combatPress = null;
    let swapOpen = false;
    let itemsOpen = false;
    let prevEnemyHp = null, prevActiveHp = null, hitFlashE = -9, hitFlashA = -9, lastCombatId = null, caughtFxDone = false;
    let battleIntroT0 = -9;
    let catchThrowT0 = -9, catchResolveT0 = -9, catchResolveKind = null;
    let newSpeciesT = -9;
    let prevTeamHp = null, stormHitT = -1;
    let predWasSprinting = false;
    let predStamina = null;
    let dmgFloaters = [];
    clearFx();
    clearShake();
    k.onUpdate(() => {
      updateFx(k.dt());
      updateShake(k.dt());
      {
        const h = hudSlots();
        info.pos = k.vec2(h.team.x, (h.orientation === "landscape" ? h.team.y : h.team.y + 34) + (import.meta.env.DEV && h.orientation === "landscape" ? 26 : 0));
        // Shim's text width setter scales, never re-wraps: recreate the label to re-wrap
        const oW = h.objective.width || 0;
        if (Math.abs(oW - objectiveW) > 2) {
          const txt = objective.text, hid = objective.hidden;
          objective.destroy();
          objectiveW = oW;
          objective = makeObjective(h.objective.x, h.objective.y, oW);
          objective.text = txt; objective.hidden = hid;
        }
        objective.pos = lobbyPanelActive() ? k.vec2(h.square.cx, h.square.bottom - 24) : k.vec2(h.objective.x, h.objective.y);
        hint.hidden = TOUCH || h.orientation !== "square";
        hint.pos = k.vec2(h.square.x + 12, h.square.bottom - 24);
        TEAM_X = h.team.x; TEAM_Y0 = h.team.y + (h.orientation === "landscape" ? 66 : 84);
      }
      pingAcc += k.dt();
      if (pingAcc >= 2 && net.state.connected) { net.ping(); pingAcc = 0; }
      if (TOUCH) { safeAcc += k.dt(); if (safeAcc >= 1) { recomputeSafeInset(); safeAcc = 0; } }

      let dx = 0, dy = 0;
      if (anyDown("moveUp")) dy = -1;
      if (anyDown("moveDown")) dy = 1;
      if (anyDown("moveLeft")) dx = -1;
      if (anyDown("moveRight")) dx = 1;
      if (net.state.combat) { joyId = null; joyVec = { x: 0, y: 0 }; thumb = joyRest(); }
      else if (joyVec.x || joyVec.y) { dx = joyVec.x; dy = joyVec.y; }
      let gm = { x: 0, y: 0 };
      if (!net.state.combat) { gm = gamepadMove(); if (gm.x || gm.y) { dx = gm.x; dy = gm.y; } }
      selfMoving = !!(dx || dy);
      if (dx || dy) selfDir = { x: dx, y: dy };
      const CHARGE_T = GAME.SPIRIT_CHAIN.CHARGE_TIME_S;
      if (kbCharge != null) {
        const c = Math.min(1, (k.time() - kbCharge.t0) / CHARGE_T);
        if (anyDown("throw") && canThrowNow()) { throwCharge = c; }
        else { kbCharge = null; throwCharge = 0; throwEquippedChain(null, c); }
      } else if (throwAim) {
        throwCharge = Math.min(1, (k.time() - (throwAim.t0 || k.time())) / CHARGE_T);
      } else {
        throwCharge = 0;
      }
      throwSpinPhase += throwCharge * 9 * k.dt();
      if (onboard && (dx || dy) && onboardT > 0.3) dismissOnboard();
      const sprint = anyDown("sprint") || (joyVec.x * joyVec.x + joyVec.y * joyVec.y) > 0.85
        || (gm.x * gm.x + gm.y * gm.y) > 0.85;
      sendAcc += k.dt();
      const movingInput = !menuOpen && !!(dx || dy);
      if (movingInput && sendAcc >= 0.05) { recordInput(net.move(dx, dy, sprint), dx, dy); sendAcc = 0; moveSent = true; }
      else if (!movingInput && moveSent) { recordInput(net.move(0, 0, false), 0, 0); moveSent = false; }
      stepAcc += k.dt();
      if (selfMoving && !menuOpen && !net.state.combat && stepAcc >= (sprint ? 0.24 : 0.34)) {
        stepAcc = 0;
        emit({ x: selfRender.x, y: selfRender.y + 16, n: 3, color: [150, 140, 122], speed: 16, life: 0.4, size: 2.6, spread: Math.PI * 0.9, dir: -Math.PI / 2, gravity: 30, drag: 2 });
      }

      // Use net.state.team (has id/level); net.state.self.team is index-aligned hp/max only
      const myTeam = net.state.team;
      if (myTeam) for (const mon of myTeam) {
        if (!mon || mon.id == null) continue;
        const pl = prevLevels.get(mon.id);
        if (pl != null && mon.level > pl) { sfx("levelup"); emit({ x: selfRender.x, y: selfRender.y, n: 14, color: [255, 220, 120], speed: 70, life: 0.7, size: 3, gravity: -40, drag: 1.5 }); emitText({ x: selfRender.x, y: selfRender.y - 22, text: `${mon.name || "Monster"} Lv ${mon.level}`, color: [255, 224, 130], size: 13 }); }
        prevLevels.set(mon.id, mon.level);
      }
      const curChests = net.state.chests || [];
      if (prevChests && prevChests !== curChests) {
        const sx = net.state.self.x, sy = net.state.self.y;
        for (const pc of prevChests) {
          if (!curChests.some((c) => c.x === pc.x && c.y === pc.y) && Math.hypot(pc.x - sx, pc.y - sy) < 56) { sfx("chest"); emit({ x: pc.x, y: pc.y, n: 12, color: [245, 210, 90], speed: 55, life: 0.6, size: 2.8, gravity: -30, drag: 1.5 }); emitText({ x: pc.x, y: pc.y - 18, text: "Chest opened!", color: [245, 214, 110], size: 14 }); }
        }
      }
      prevChests = curChests;
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

      {
        const cir = net.state.circle, sf = net.state.self;
        const curTeamHp = (sf?.team || []).reduce((s, mo) => s + Math.max(0, mo.hp || 0), 0);
        const outside = !!(cir && sf && !net.state.combat && !net.state.roundResult &&
          ((sf.x - cir.x) ** 2 + (sf.y - cir.y) ** 2) > cir.r * cir.r);
        if (outside && prevTeamHp != null && curTeamHp < prevTeamHp) {
          stormHitT = k.time();
          haptic(20);
          if (!prefersReducedMotion()) addShake(0.34);
          const dmg = Math.round(prevTeamHp - curTeamHp);
          emit({ x: selfRender.x, y: selfRender.y, n: 10, color: [235, 70, 70], speed: 80, life: 0.5, size: 2.8, gravity: -10, drag: 2 });
          emitText({ x: selfRender.x, y: selfRender.y - 22, text: `Storm -${dmg}`, color: [255, 120, 120], size: 14 });
        }
        prevTeamHp = curTeamHp;
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

      // gamepadPressed() is edge-detected: call exactly once per frame
      const gpEdges = gamepadPressed();
      if (gpEdges.size) {
        if (net.state.roundResult) {
          if (gpEdges.has(BTN.A) || gpEdges.has(BTN.START)) exitAfterRun();
        } else if (menuOpen) {
          const btns = menuBtns();
          if (gpEdges.has(12)) menuSel = (menuSel - 1 + btns.length) % btns.length;
          if (gpEdges.has(13)) menuSel = (menuSel + 1) % btns.length;
          if (gpEdges.has(BTN.A)) btns[Math.max(0, Math.min(btns.length - 1, menuSel))]?.act();
          else if (gpEdges.has(BTN.B) || gpEdges.has(BTN.START)) { menuOpen = false; leaveArm = false; }
        } else if (net.state.combat) {
          if (net.state.combat.outcome) { if (gpEdges.has(BTN.A)) net.clearCombat(); }
          else {
            for (let i = 0; i < 4; i++) if (gpEdges.has(i)) { const a = net.state.combat.attacks?.[i]; if (a) act({ kind: "attack", attackName: a.name }); }
            if (gpEdges.has(BTN.LB)) act({ kind: "catch" });
            if (gpEdges.has(BTN.RB)) act({ kind: "flee" });
          }
        } else if (onboard && onboardT > 0.3) {
          dismissOnboard();
        } else if (gpEdges.has(BTN.START)) {
          menuOpen = true; menuSel = 0; leaveArm = false;
        } else if (gpEdges.has(BTN.A) || gpEdges.has(BTN.RT)) {
          throwEquippedChain();
        }
      }

      // Self prediction must mirror server movement (world.js) exactly, or it rubberbands
      const E = GAME.EFFECTIVE_TILE;
      // Read-only check: the rival loop below owns the lastPlayersRef update
      const staminaSnap = net.state.players !== lastPlayersRef;
      if (predStamina == null || staminaSnap) predStamina = net.state.stamina ?? GAME.SPRINT.STAMINA_MAX;
      const predicting = !net.state.combat && !menuOpen && (dx || dy);
      if (predicting) {
        let pdx = dx, pdy = dy;
        if (pdx !== 0 && pdy !== 0) { pdx *= 0.707; pdy *= 0.707; }
        const predSprint = sprintingNow({ sprint, moving: true, stamina: predStamina, wasSprinting: predWasSprinting }, GAME);
        predWasSprinting = predSprint;
        predStamina = tickStamina(predStamina, predSprint, k.dt(), GAME);
        const step = GAME.BASE_SPEED * sprintMult(predSprint, GAME) * k.dt();
        // Must equal the server's play-area clamp ((mapSize-1)*E in world.js)
        const R = GAME.PLAYER_RADIUS, maxXY = map?.mapSize ? (map.mapSize - 1) * E : 0;
        const st = stepBody(map, selfRender.x, selfRender.y, pdx, pdy, step, R, maxXY);
        selfRender.x = st.x; selfRender.y = st.y;
      } else {
        predWasSprinting = false;
        predStamina = tickStamina(predStamina, false, k.dt(), GAME);
      }
      const ex = net.state.self.x - selfRender.x, ey = net.state.self.y - selfRender.y;
      const err = Math.hypot(ex, ey);
      const lagS = 0.2 + (net.state.rtt || 0) / 1000;
      const leadSpeed = predicting ? GAME.BASE_SPEED * sprintMult(predWasSprinting, GAME) : 0;
      const trustR = Math.max(64, leadSpeed * lagS + 24);
      const snapR = Math.max(220, trustR + 130);
      const hAck = takeAcked(predHist, net.state.ack);
      if (hAck && !net.state.combat) {
        reconcileStep(selfRender, net.state.self, hAck, predHist, k.dt(), GAME.BASE_SPEED * sprintMult(true, GAME));
      }
      else if (err > snapR) { selfRender.x = net.state.self.x; selfRender.y = net.state.self.y; }
      else if (predicting) {
        const dl = Math.hypot(dx, dy) || 1, ux = dx / dl, uy = dy / dl;
        const along = ex * ux + ey * uy, ax = along * ux, ay = along * uy;
        const perpRate = Math.min(1, k.dt() * 22);
        selfRender.x += (ex - ax) * perpRate; selfRender.y += (ey - ay) * perpRate;
        if (Math.abs(along) > trustR) { const rate = Math.min(1, k.dt() * 18); selfRender.x += ax * rate; selfRender.y += ay * rate; }
      }
      else if (err <= trustR) {}
      else { const rate = Math.min(1, k.dt() * 18); selfRender.x += ex * rate; selfRender.y += ey * rate; }
      // Fresh snapshot = new players array ref (net.js replaces it, never mutates)
      const now = k.time();
      const rt = now - INTERP_DELAY;
      const freshSnap = net.state.players !== lastPlayersRef;
      lastPlayersRef = net.state.players;
      const gen = ++liveGen;
      for (const p of net.state.players) {
        let r = othersRender.get(p.id);
        if (!r) { r = { x: p.x, y: p.y, vx: 0, vy: 0, buf: [], moving: false, dir: { x: 0, y: 1 } }; othersRender.set(p.id, r); pushSample(r, now, p.x, p.y); }
        r.live = gen;
        if (freshSnap) pushSample(r, now, p.x, p.y);
        sampleBuf(r, rt);
        r.moving = (r.vx * r.vx + r.vy * r.vy) > 16;
        if (r.moving) { r.dir.x = r.vx; r.dir.y = r.vy; }
      }
      for (const [id, r] of othersRender) if (r.live !== gen) othersRender.delete(id);

      const freshMon = net.state.monsters !== lastMonstersRef;
      lastMonstersRef = net.state.monsters;
      for (const mo of net.state.monsters) {
        let r = monsterRender.get(mo.id);
        if (!r) { r = { x: mo.x, y: mo.y, vx: 0, vy: 0, buf: [], bx: mo.x, by: mo.y, moving: false, dir: { x: 1, y: 0 } }; monsterRender.set(mo.id, r); pushSample(r, now, mo.x, mo.y); }
        r.live = gen;
        if (freshMon) pushSample(r, now, mo.x, mo.y);
        sampleBuf(r, rt);
        r.moving = (r.vx * r.vx + r.vy * r.vy) > 16;
        if (r.moving) { r.dir.x = r.vx; r.dir.y = r.vy; }
      }
      for (const [id, r] of monsterRender) if (r.live !== gen) monsterRender.delete(id);

      for (const pr of net.state.projectiles) {
        let r = projRender.get(pr.id);
        if (!r) { r = { x: pr.x, y: pr.y }; projRender.set(pr.id, r); }
        r.live = gen;
        r.x = lerp(r.x + pr.vx * k.dt(), pr.x, 0.2);
        r.y = lerp(r.y + pr.vy * k.dt(), pr.y, 0.2);
        r.vx = pr.vx; r.vy = pr.vy; r.chainId = pr.chainId;
      }
      for (const [id, r] of projRender) if (r.live !== gen) projRender.delete(id);

      const sh = shakeOffset();
      k.camPos(selfRender.x + sh.x, selfRender.y + sh.y);
      const t = net.state.time || 0;
      const mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, "0");
      const ping = net.state.rtt == null ? "" : `   ${net.state.rtt}ms`;
      const rivals = net.state.players || [];
      const rivalLine = rivals.length
        ? trunc(`Rivals in view (${rivals.length}): ${rivals.slice(0, 3).map((p) => trunc(p.name || "?", 10)).join(", ")}${rivals.length > 3 ? `, +${rivals.length - 3}` : ""}`, 36)
        : "No rivals in view";
      // Never show seed/coords in prod: the seed leaks map knowledge
      const dev = import.meta.env.DEV;
      void mm; void ss;
      const narrowHud = k.width() < 560;
      void rivalLine; void narrowHud;
      info.text = dev ? `\n\nseed ${net.state.seed ?? "?"}   (${Math.round(net.state.self.x)}, ${Math.round(net.state.self.y)})${ping}` : "";

      const circle = net.state.circle, self = net.state.self;
      const outsideZone = !!(circle && self && ((self.x - circle.x) ** 2 + (self.y - circle.y) ** 2) > circle.r * circle.r);
      tutorialTick();
      objective.text = tutorialText() ?? (net.state.adventure
        ? `Adventure — explore and catch; the glowing rift leads to the next region${TOUCH ? "" : "  (ESC to return home)"}`
        : objectiveText({ circleStarted: !!circle, portalsOpen: (net.state.portals || []).length > 0, outsideZone }));
      const disc = !net.state.connected;
      objectiveVisible = !(net.state.combat || net.state.roundResult || onboard || menuOpen || disc);
      objective.hidden = true;

      hint.hidden = hint.hidden || !!(net.state.combat || net.state.roundResult || onboard || menuOpen || disc);
      info.hidden = !!(onboard || net.state.roundResult || menuOpen || disc);

      const cb = net.state.combat;
      if (cb) {
        if (cb.log.length !== lastLogLen || cb.outcome) {
          if (awaiting && combatPress && combatPress.kind === "attack") {
            activeAtkT0 = k.time();
            enemyAtkT0 = cb.outcome ? -1 : k.time() + ATTACK_DURATION * 0.55;
          }
          if (awaiting && combatPress && combatPress.kind === "catch" && catchThrowT0 >= 0) {
            catchResolveKind = cb.outcome === "caught" ? "caught" : "broke";
            catchResolveT0 = k.time();
            if (catchResolveKind === "caught") sfx("catch"); else { sfx("miss"); haptic(20); }
          }
          awaiting = false; lastLogLen = cb.log.length;
        }
      } else { awaiting = false; lastLogLen = 0; activeAtkT0 = -1; enemyAtkT0 = -1; }
    });

    k.onDraw(() => {
      revealAround();
      drawTiles(k, map, net.state.self.x, net.state.self.y, tileCache, GAME.EFFECTIVE_TILE, isExplored);

      if (net.state.circle) {
        const reduce = prefersReducedMotion();
        const c = net.state.circle, pulse = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(k.time() * 3);
        for (let i = 3; i >= 1; i--) {
          k.drawCircle({ pos: k.vec2(c.x, c.y), radius: c.r + i * 7, fill: false, outline: { width: 4, color: k.rgb(...THEME.storm) }, opacity: (0.30 - i * 0.07) * pulse });
        }
        k.drawCircle({ pos: k.vec2(c.x, c.y), radius: c.r, fill: false, outline: { width: 3, color: k.rgb(...THEME.stormLite) }, opacity: reduce ? 0.7 : 0.55 + 0.25 * Math.sin(k.time() * 3) });
      }
      for (const p of net.state.portals) {
        const key = `${p.x},${p.y}`;
        let born = portalSeen.get(key);
        if (born == null) { born = k.time(); portalSeen.set(key, born); }
        drawPortal(k, { x: p.x, y: p.y, t: k.time(), age: k.time() - born });
        if (net.state.adventure) {
          k.drawText({ text: `Onward — Region ${(net.state.depth || 1) + 1}`, pos: k.vec2(p.x, p.y + 46), size: 12, font: "gameFontBold", anchor: "center", color: k.rgb(...THEME.portal), opacity: 0.9 });
        }
      }

      const now = k.time();
      for (const c of net.state.chests) drawChest(k, { x: c.x, y: c.y, t: now });

      ents.length = 0;
      htmlEnts.length = 0;
      const reduceMo = prefersReducedMotion();
      const mSize = 128 * 0.45;
      const shadowCol = k.rgb(0, 0, 0), monTint = [220, 180, 80], rivalBodyCol = [210, 90, 90], nameCol = k.rgb(...UI.text);
      for (const mo of net.state.monsters) {
        const r = monsterRender.get(mo.id) || { x: mo.x, y: mo.y, bx: mo.x, by: mo.y, moving: false, dir: { x: 1, y: 0 } };
        const mtype = getMonsterType(mo.typeName);
        const useDom = !!mtype && htmlOverlay.usesDom(mo.typeName, mtype);
        const facing = r.dir && r.dir.x < 0 ? -1 : 1;
        const moving = !reduceMo && r.moving;
        if (useDom) htmlEnts.push({ id: mo.id, typeName: mo.typeName, type: mtype, x: r.x, y: r.y, designSize: mSize, facing, moving, attacking: false });
        ents.push({ y: r.y, draw: () => {
          k.drawEllipse({ pos: k.vec2(r.x, r.y + 20), radiusX: 15, radiusY: 5, color: shadowCol, opacity: 0.28 });
          if (!useDom) {
            const anim = moving ? "walk" : "idle";
            const t = reduceMo ? 0 : now + (r.bx + r.by) * 0.013;
            drawMonster(k, { typeName: mo.typeName, x: r.x, y: r.y, size: mSize, anim, t, facing, tint: monTint });
          }
        } });
      }
      const chainOutOwners = new Set((net.state.projectiles || []).map((pr) => pr.owner));
      for (const p of net.state.players) {
        const r = othersRender.get(p.id) || p;
        ents.push({ y: r.y, draw: () => {
          drawCharacter(k, { x: r.x, y: r.y, t: now + (p.id ? p.id.length : 0), moving: r.moving, color: rivalBodyCol, dir: r.dir, skin: getSkin(p.skinId), chainTier: p.chainTier ?? null, model: getCharacterSkin(p.charId).model, holdChain: !chainOutOwners.has(p.id) });
          k.drawText({ text: trunc(p.name || "?", 14), pos: k.vec2(r.x, r.y - 40), size: 12, font: "gameFont", anchor: "center", color: nameCol });
        } });
      }
      ents.push({ y: selfRender.y, draw: () => {
        const meCos = getEquippedCharacterSkin();
        const lungeFwd = throwLungeT0 >= 0 ? Math.max(0, 1 - (now - throwLungeT0) / 0.22) : 0;
        let selfThrowPose = null;
        if (throwCharge > 0.02 || lungeFwd > 0.01) { const aim = currentAimDir(); selfThrowPose = { back: throwCharge, fwd: lungeFwd, dx: aim.x, dy: aim.y }; }
        drawCharacter(k, { x: selfRender.x, y: selfRender.y, t: now, moving: selfMoving, color: meCos.accent, cloak: meCos.cloak, model: meCos.model, dir: selfDir, skin: getEquippedSkin(), chainTier: equippedChain()?.def?.tier ?? null, chainSpin: throwSpinPhase, holdChain: !chainOutOwners.has(net.state.playerId), throwPose: selfThrowPose });
        if (throwCharge > 0.02) {
          const ec = equippedChain(), col = ec && ec.def ? chainColor(ec.def) : [120, 220, 255];
          const N = 12, lit = Math.round(throwCharge * N), rad = 30, cyM = selfRender.y - 8;
          for (let i = 0; i < N; i++) {
            const a = -Math.PI / 2 + (i / N) * Math.PI * 2;
            const on = i < lit;
            k.drawCircle({ pos: k.vec2(selfRender.x + Math.cos(a) * rad, cyM + Math.sin(a) * rad), radius: on ? 2.6 : 1.4, color: k.rgb(...(on ? col : [80, 90, 100])), opacity: on ? 0.95 : 0.4 });
          }
          if (throwCharge >= 0.999) k.drawCircle({ pos: k.vec2(selfRender.x, cyM), radius: rad + 4, color: k.rgb(...col), opacity: 0.12 + 0.1 * Math.sin(now * 12) });
        }
        const stam = predStamina ?? net.state.stamina ?? GAME.SPRINT.STAMINA_MAX;
        if (!net.state.combat && stam < GAME.SPRINT.STAMINA_MAX - 0.5) {
          const sr = Math.max(0, Math.min(1, stam / GAME.SPRINT.STAMINA_MAX)), bw = 34;
          k.drawRect({ pos: k.vec2(selfRender.x - bw / 2, selfRender.y + 26), width: bw, height: 4, radius: 2, color: k.rgb(0, 0, 0), opacity: 0.4 });
          k.drawRect({ pos: k.vec2(selfRender.x - bw / 2, selfRender.y + 26), width: bw * sr, height: 4, radius: 2, color: k.rgb(...(sr > 0.3 ? THEME.teal : THEME.amber)) });
        }
      } });
      ents.sort(byY);
      if (!menuOpen && !net.state.roundResult && net.state.connected) {
        for (const e of ents) e.draw();
        drawFx(k);
      }
      if (!menuOpen && !net.state.roundResult && net.state.connected && !net.state.combat) {
        htmlOverlay.sync(htmlEnts, { clipDesign: playWindowRect(k.width(), k.height(), { maxAspect: winAspect() }) });
      } else if (!net.state.combat) {
        htmlOverlay.clear();
      }

      for (const pr of projRender.values()) {
        drawSpiritChainProjectile(k, pr, chainColor(getSpiritChain(pr.chainId)), now);
      }

      if (!net.state.roundResult && !onboard) drawPlayWindow(k, { maxAspect: winAspect() });

      if (TOUCH && !net.state.combat && !net.state.roundResult) {
        const joyActive = joyId !== null;
        drawJoystick(k, { base: joyActive ? joyBase : joyRest(), thumb, active: joyActive, radius: JOY_R });
        const eqc = equippedChain();
        const chainOut = (net.state.projectiles || []).some((pr) => pr.owner === net.state.playerId);
        const hasChain = !!eqc && !chainOut;
        const thrCol = eqc && eqc.def ? chainColor(eqc.def) : THEME.water;
        if (throwAim && throwAim.id != null) {
          drawThrowPad(k, { origin: throwAim.origin, dir: throwAim.dir, dragged: throwAim.dragged, charge: throwCharge, accent: thrCol, enabled: throwAim.enabled !== false, radius: THROW_PAD_R });
        } else if (!onboard) {
          const hp = throwBtnC();
          k.drawCircle({ pos: hp, radius: THROW_HINT_R, fill: false, outline: { width: 2, color: k.rgb(...thrCol) }, opacity: hasChain ? 0.42 : 0.18, fixed: true });
          drawIcon(k, "chain", { x: hp.x, y: hp.y - 18, size: 20, color: thrCol, opacity: hasChain ? 0.72 : 0.32, fixed: true });
          k.drawText({ text: "Throw", pos: k.vec2(hp.x, hp.y + 2), size: 14, font: "gameFont", anchor: "center", color: k.rgb(...thrCol), opacity: hasChain ? 0.72 : 0.32, fixed: true });
          k.drawText({ text: "drag to aim", pos: k.vec2(hp.x, hp.y + 18), size: 9, font: "gameFont", anchor: "center", color: k.rgb(...THEME.textMut), opacity: 0.6, fixed: true });
        }
        if (!onboard && (net.state.equippedChainIds || []).length > 1) {
          const swCol = eqc && eqc.def ? chainColor(eqc.def) : THEME.teal;
          const tier = eqc && eqc.def ? eqc.def.tier : null;
          drawTouchButton(k, { pos: swapBtnC(), radius: SWAP_R, label: "Swap", accent: swCol, enabled: true, sub: tier != null ? `T${tier}` : null, icon: "swap" });
        }
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
        if (!onboard) {
          const [pbx, pby, pbw, pbh] = pauseBtnRect();
          drawGlass(k, { rect: [pbx, pby, pbw, pbh], radius: 12, tint: 0.62, fill: 0.06, line: 0.14, fixed: true });
          k.drawRect({ pos: k.vec2(pbx + pbw / 2 - 7, pby + 10), width: 5, height: pbh - 20, radius: 2, color: k.rgb(...THEME.text), fixed: true });
          k.drawRect({ pos: k.vec2(pbx + pbw / 2 + 2, pby + 10), width: 5, height: pbh - 20, radius: 2, color: k.rgb(...THEME.text), fixed: true });
        }
      }

      if (!net.state.combat && !net.state.roundResult && !onboard && !menuOpen && net.state.connected) drawMinimap();
      const showLobby = lobbyPanelActive();
      if (showLobby) {
        const hud = hudSlots();
        const gx = hud.team.x, gy = hud.team.y + 64;
        const gw = Math.max(150, (hud.gutterW || 256) - 24);
        const footY = TOUCH ? hud.joystick.y - JOY_RADIUS - 10 : hud.biome.y - 18;
        const gmaxH = Math.max(150, footY - gy);
        drawHubPanel(k, { x: gx, y: gy, w: gw, maxH: gmaxH - 34, character: lobbyChar, title: "Your Tamer", measureIcons: false });
        if (!net.state.combat && !net.state.roundResult) drawAtRiskPill(gx, footY - 28);
      }
      if (!net.state.combat && !net.state.roundResult && !onboard && !menuOpen && net.state.connected) {
        if (!showLobby) drawTeamHp();
      }
      if (!showLobby && !net.state.combat && !net.state.roundResult && !onboard && !menuOpen && net.state.connected) drawChainHud();
      if (!net.state.combat && !net.state.roundResult && !onboard && !menuOpen && net.state.connected) { const b = hudSlots().biome; drawBiomeChip(k, { x: b.x, y: b.y, map, wx: selfRender.x, wy: selfRender.y }); }
      if (!net.state.roundResult && !onboard && !menuOpen && net.state.connected) drawTimerChip();
      if (!net.state.roundResult && !onboard && !menuOpen && net.state.connected && !net.state.combat) drawInfoChip();
      drawObjectiveChip();
      if (!net.state.roundResult && !onboard && !menuOpen && net.state.connected) drawKillFeed();
      drawCombatNotice();
      drawLootNotice();
      if (!onboard && !menuOpen && net.state.connected) drawTutorialNotice();
      if (onboard && !net.state.combat && !net.state.roundResult) drawOnboarding();
      if (!net.state.combat && !net.state.roundResult && !menuOpen && !onboard && net.state.connected) drawDanger();
      if (!net.state.roundResult && !onboard && net.state.connected) drawStormHit();
      if (!net.state.combat && !net.state.roundResult && !menuOpen && !onboard && net.state.connected) drawPortalCompass();
      if (!net.state.combat && !net.state.roundResult && !menuOpen && !onboard && net.state.connected) drawTimeWarning();

      const c = net.state.combat;
      if (c) {
        const pw = playWindowRect(k.width(), k.height(), { maxAspect: winAspect() });
        const top = Math.min(k.height(), pw.bottom) - COMBAT_H - safeInset.bottom, H = COMBAT_H + safeInset.bottom, m = pw.x + 12, W = pw.w - 24;
        const tF = k.time();
        if (c.combatId !== lastCombatId) { prevEnemyHp = prevActiveHp = null; caughtFxDone = false; dmgFloaters = []; newSpeciesT = -9; lastCombatId = c.combatId; battleIntroT0 = tF; catchThrowT0 = -9; catchResolveT0 = -9; catchResolveKind = null; combatInspect = null; sfx("throw"); if (c.enemy && !c.pvp) markEncountered(c.enemy.typeName); }
        if (c.enemy && prevEnemyHp != null && c.enemy.currentHealth < prevEnemyHp) { const d = prevEnemyHp - c.enemy.currentHealth, fr = c.enemy.maxHealth ? Math.min(1, d / c.enemy.maxHealth) : 0; hitFlashE = tF; if (!prefersReducedMotion()) addShake(Math.min(0.6, 0.12 + fr * 0.45)); emit({ x: pw.cx, y: top + 26, n: 6 + Math.round(fr * 10), color: [255, 180, 120], speed: 110, life: 0.4, size: 2.5, drag: 2, fixed: true }); dmgFloaters.push({ x: pw.right - 92, y: top + 18, dmg: Math.round(d), col: [255, 210, 90], t0: tF }); }
        if (c.enemy && prevEnemyHp != null && c.enemy.currentHealth > prevEnemyHp) dmgFloaters.push({ x: pw.right - 92, y: top + 18, dmg: Math.round(c.enemy.currentHealth - prevEnemyHp), col: [120, 230, 150], t0: tF, heal: true });
        prevEnemyHp = c.enemy ? c.enemy.currentHealth : null;
        if (c.active && prevActiveHp != null && c.active.currentHealth < prevActiveHp) { const d = prevActiveHp - c.active.currentHealth, fr = c.active.maxHealth ? Math.min(1, d / c.active.maxHealth) : 0; hitFlashA = tF; haptic(15); if (!prefersReducedMotion()) addShake(Math.min(0.9, 0.2 + fr * 0.7)); emit({ x: pw.cx, y: top + 68, n: 6 + Math.round(fr * 10), color: [255, 180, 120], speed: 110, life: 0.4, size: 2.5, drag: 2, fixed: true }); dmgFloaters.push({ x: pw.right - 92, y: top + 60, dmg: Math.round(d), col: [255, 90, 90], t0: tF }); }
        if (c.active && prevActiveHp != null && c.active.currentHealth > prevActiveHp) dmgFloaters.push({ x: pw.right - 92, y: top + 60, dmg: Math.round(c.active.currentHealth - prevActiveHp), col: [120, 230, 150], t0: tF, heal: true });
        prevActiveHp = c.active ? c.active.currentHealth : null;
        const eF = Math.max(0, 1 - (tF - hitFlashE) / 0.3), aF = Math.max(0, 1 - (tF - hitFlashA) / 0.3);
        if (c.outcome === "caught" && !caughtFxDone) {
          caughtFxDone = true; haptic([0, 30, 40, 60]); emit({ x: pw.cx, y: top + 26, n: 22, color: [120, 240, 255], speed: 95, life: 0.85, size: 3, gravity: -25, drag: 1.5, fixed: true });
          if (c.enemy && c.placement !== "released" && markDiscovered(c.enemy.typeName)) { newSpeciesT = tF; sfx("levelup"); emit({ x: pw.cx, y: top + 26, n: 24, color: [255, 214, 110], speed: 150, life: 1.1, size: 3, gravity: 120, drag: 0.6, fixed: true }); }
        }
        k.drawRect({ pos: k.vec2(0, pw.y), width: k.width(), height: Math.max(0, top - pw.y), color: k.rgb(...THEME.bg), fixed: true });
        combatHtmlEnts.length = 0;
        if (c.enemy) {
          const atkPhase = (t0) => (t0 >= 0 && tF >= t0 && tF < t0 + ATTACK_DURATION) ? (tF - t0) / ATTACK_DURATION : 0;
          const _bx = net.state.self?.x ?? 0, _by = net.state.self?.y ?? 0;
          drawBattleStage(k, {
            rect: pw, stageBottom: top, enemy: c.enemy, active: c.active,
            biomeName: map ? biomeNameAt(map, _bx, _by) : null,
            biomeAccent: map ? biomeTintAt(map, Math.floor(_bx / GAME.EFFECTIVE_TILE), Math.floor(_by / GAME.EFFECTIVE_TILE)) : null,
            chainCol: chainColor(getSpiritChain(net.state.equippedChainId)),
            chainTier: getSpiritChain(net.state.equippedChainId)?.tier ?? null,
            charSkin: getEquippedCharacterSkin(),
            time: tF, introElapsed: tF - battleIntroT0, reducedMotion: prefersReducedMotion(),
            activeAttack: prefersReducedMotion() ? 0 : atkPhase(activeAtkT0),
            enemyAttack: prefersReducedMotion() ? 0 : atkPhase(enemyAtkT0),
            htmlSink: combatHtmlEnts,
            catchElapsed: catchThrowT0 >= 0 ? tF - catchThrowT0 : -1,
            catchResolve: catchResolveKind,
            catchResolveElapsed: catchResolveT0 >= 0 ? tF - catchResolveT0 : -1,
          });
        }
        // DOM combatants sit above the canvas: hide them while any canvas modal is up
        if (combatInspect || menuOpen || net.state.roundResult || !net.state.connected) htmlOverlay.clear();
        else htmlOverlay.sync(combatHtmlEnts, { fixed: true });
        k.drawRect({ pos: k.vec2(0, top), width: k.width(), height: H, color: k.rgb(...THEME.bg), opacity: 0.96, fixed: true,
          gradient: { dir: "v", stops: [[0, THEME.surface, 0.97], [0.5, THEME.bg, 0.97], [1, THEME.bgAlt, 0.98]] } });
        k.drawRect({ pos: k.vec2(0, top), width: k.width(), height: 1, color: k.rgb(255, 255, 255), opacity: 0.14, fixed: true });
        // c.enemy/c.active may be missing: guard, or onDraw throws every frame
        const enemyTitle = !c.enemy ? "" : c.pvp ? `${c.opponent || "Rival"}: ${c.enemy.typeName}` : `Wild ${c.enemy.typeName}`;
        drawCombatant(c.enemy, top + 8, enemyTitle, m, W, eF, "enemy");
        drawCombatant(c.active, top + 50, c.active?.name, m, W, aF, "self");
        combatRowRects = { enemy: [m - 8, top + 5, W + 16, 42], active: [m - 8, top + 47, W + 16, 42] };
        const nowC = k.time();
        const inputLocked = !c.outcome && (awaiting || c.waiting);
        const lockDim = inputLocked ? 0.4 : 1;
        const cbtns = combatButtons();
        const textW = (t, s) => (typeof k.measureText === "function" ? k.measureText(t, s, FONT_BOLD) : t.length * s * 0.54);
        const wrapLines = (label, w, s) => {
          const maxW = w - 12;
          let lines = 1, cur = "";
          for (const wd of String(label).split(/\s+/)) {
            const next = cur ? cur + " " + wd : wd;
            if (!cur || textW(next, s) <= maxW) cur = next; else { lines++; cur = wd; }
          }
          return lines;
        };
        const perLineAt = (w, s) => Math.max(4, Math.floor((w - 12) / (s * 0.54)));
        const pillFit = (b) => {
          const [, , w, h] = b.rect;
          for (let s = 14; s > 9; s -= 0.5) {
            const n = wrapLines(b.label, w, s);
            if (n === 1 || (n === 2 && s <= (h - 24) / 2.4)) return s;
          }
          return 9;
        };
        const atkSize = cbtns.filter((b) => b.cost != null).reduce((s, b) => Math.min(s, pillFit(b)), 14);
        for (const b of cbtns) {
          const [x, y, w, h] = b.rect;
          const aff = b.affordable !== false;
          const pressed = combatPress && combatPress.kind === b.action.kind && combatPress.name === (b.action.attackName || b.action.kind) && nowC - combatPress.t < 0.18;
          const isCatch = b.action.kind === "catch";
          const hov = !TOUCH && inRect(k.mousePos(), b.rect);
          if (isCatch) drawButton(k, { rect: b.rect, text: "", fill: THEME.primary, radius: 14, hover: hov, pressed, disabled: !aff, opacity: lockDim, fixed: true });
          else drawGlass(k, { rect: b.rect, radius: 14, tint: 0.35 * lockDim, fill: (pressed ? 0.16 : hov ? 0.11 : 0.06) * (aff ? 1 : 0.5) * lockDim, line: (aff ? (hov || pressed ? 0.24 : 0.14) : 0.08) * lockDim, fixed: true });
          const inkCol = isCatch && aff ? THEME.textInv : UI.text;
          const mnSize = Math.max(10, Math.min(14, 2 * (w - 12) * 14 / (7.5 * Math.max(1, b.label.length))));
          let perLine = Math.max(4, Math.floor((w - 12) / (mnSize * 0.54)));
          let nmSize = b.cost != null && b.label.length > perLine ? Math.max(9, Math.min(mnSize, (h - 28) / 2.6)) : mnSize;
          if (b.cost != null) { nmSize = atkSize; perLine = perLineAt(w, nmSize); }
          const wraps = b.cost != null && wrapLines(b.label, w, nmSize) > 1;
          if (wraps) perLine = Math.max(4, Math.floor((w - 12) / (nmSize * 0.54)));
          const lbl = trunc(b.label, (b.cost != null ? 2 : 3) * perLine);
          const ACTION_ICON = { catch: "catch", swap: "swap", openSwap: "swap", flee: "flee", closeSwap: "chevronL", closeItems: "chevronL", openItems: "bag", items: "bag", useItem: "bag" };
          const aIcon = b.cost == null ? ACTION_ICON[b.action.kind] : null;
          const lblW = aIcon && typeof k.measureText === "function" ? k.measureText(lbl, nmSize, FONT_BOLD) : 0;
          if (aIcon && w > 80) drawIcon(k, aIcon, { x: x + w / 2 - lblW / 2 - 14, y: y + h / 2, size: nmSize + 6, color: inkCol, opacity: (aff ? 1 : 0.55) * lockDim, fixed: true });
          const tdx = aIcon && w > 80 ? 10 : 0;
          if (wraps) k.drawText({ text: lbl, pos: k.vec2(x + w / 2, y + 5), size: nmSize, font: FONT_BOLD, anchor: "top", align: "center", color: k.rgb(...inkCol), width: w - 10, opacity: (aff ? 1 : 0.55) * lockDim, fixed: true });
          else k.drawText({ text: lbl, pos: k.vec2(x + w / 2 + tdx, y + (b.cost != null ? h / 2 - 9 : h / 2)), size: nmSize, font: FONT_BOLD, anchor: "center", color: k.rgb(...inkCol), width: w - 10, opacity: (aff ? 1 : 0.55) * lockDim, fixed: true });
          if (b.cost != null) {
            const fo = (aff ? 0.95 : 0.5) * lockDim, fy = y + h - 10;
            if (aff) k.drawRect({ pos: k.vec2(x + 1, y + 10), width: 3, height: h - 20, radius: 1.5, color: k.rgb(...THEME.primary), opacity: 0.75 * lockDim, fixed: true });
            if (w >= 120) {
              if (b.damage != null) { drawIcon(k, "sword", { x: x + 16, y: fy, size: 11, color: UI.body, opacity: fo, fixed: true }); k.drawText({ text: `${b.damage}`, pos: k.vec2(x + 25, fy), size: 11, font: FONT_BOLD, anchor: "left-center", color: k.rgb(...UI.body), opacity: fo, fixed: true }); }
              const cs = `${b.cost}`, cw = typeof k.measureText === "function" ? k.measureText(cs, 11, FONT_BOLD) : 14;
              drawIcon(k, "bolt", { x: x + w - cw - 24, y: fy, size: 11, color: aff ? THEME.amber : UI.mut, opacity: fo, fixed: true });
              k.drawText({ text: cs, pos: k.vec2(x + w - 12, fy), size: 11, font: FONT_BOLD, anchor: "right-center", color: k.rgb(...(aff ? THEME.amber : UI.mut)), opacity: fo, fixed: true });
            } else {
              const cs = `${b.cost}`, cw = typeof k.measureText === "function" ? k.measureText(cs, 10, FONT_BOLD) : 12;
              if (b.damage != null && w >= 72) {
                drawIcon(k, "sword", { x: x + 12, y: fy, size: 10, color: UI.body, opacity: fo, fixed: true });
                k.drawText({ text: `${b.damage}`, pos: k.vec2(x + 19, fy), size: 10, font: FONT_BOLD, anchor: "left-center", color: k.rgb(...UI.body), opacity: fo, fixed: true });
                drawIcon(k, "bolt", { x: x + w - cw - 17, y: fy, size: 10, color: aff ? THEME.amber : UI.mut, opacity: fo, fixed: true });
                k.drawText({ text: cs, pos: k.vec2(x + w - 9, fy), size: 10, font: FONT_BOLD, anchor: "right-center", color: k.rgb(...(aff ? THEME.amber : UI.mut)), opacity: fo, fixed: true });
              } else {
                drawIcon(k, "bolt", { x: x + w / 2 - cw / 2 - 6, y: fy, size: 11, color: aff ? THEME.amber : UI.mut, opacity: fo, fixed: true });
                k.drawText({ text: cs, pos: k.vec2(x + w / 2 + 6, fy), size: 11, font: FONT_BOLD, anchor: "center", color: k.rgb(...(aff ? THEME.amber : UI.mut)), opacity: fo, fixed: true });
              }
            }
            if (!TOUCH && b.hotkey && w >= 120) {
              k.drawRect({ pos: k.vec2(x + 8, y + 6), width: 16, height: 16, radius: 5, color: k.rgb(255, 255, 255), opacity: 0.1 * lockDim, fixed: true });
              k.drawText({ text: String(b.hotkey), pos: k.vec2(x + 16, y + 14), size: 10, font: FONT_BOLD, anchor: "center", color: k.rgb(...UI.mut), opacity: lockDim, fixed: true });
            }
          }
        }
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
          drawGlass(k, { rect: [tx, ty, tW, tH], radius: 12, tint: 0.86, fill: 0.06, line: 0.16, fixed: true });
          k.drawText({ text: atkTip.desc, pos: k.vec2(tx + 10, ty + 7), size: 11, font: "gameFont", width: tW - 20, lineSpacing: 2, color: k.rgb(...UI.text), fixed: true });
        }
        if (!swapOpen && !itemsOpen) {
          const last = c.log[c.log.length - 1] || (c.pvp ? "A rival challenges you!" : "A wild monster appeared!");
          const line = last;
          const ly = top + COMBAT_H - 28;
          drawGlass(k, { rect: [m - 4, ly - 5, W + 8, 26], radius: 13, tint: 0.35, fill: 0.05, line: 0.1, fixed: true });
          drawIcon(k, "info", { x: m + 10, y: ly + 8, size: 12, color: UI.body, fixed: true });
          const availW = W - 30, lw = typeof k.measureText === "function" ? k.measureText(line, 13, FONT_BOLD) : line.length * 7.2;
          if (line !== logTicker.line) { logTicker.line = line; logTicker.t0 = k.time(); }
          if (lw <= availW || prefersReducedMotion() || typeof k.pushClip !== "function") {
            k.drawText({ text: lw <= availW ? line : trunc(line, Math.max(20, Math.floor((W - 36) / 7.2))), pos: k.vec2(m + 22, ly), size: 13, font: FONT_BOLD, width: W - 30, color: k.rgb(...UI.text), fixed: true });
          } else {
            const over = lw - availW + 8, HOLD0 = 1.2, HOLD1 = 1.5, SPD = 40, period = HOLD0 + over / SPD + HOLD1;
            const tt = (k.time() - logTicker.t0) % period;
            const off = Math.max(0, Math.min(over, (tt - HOLD0) * SPD));
            k.pushClip(m + 20, ly - 4, availW + 2, 22);
            try { k.drawText({ text: line, pos: k.vec2(m + 22 - off, ly), size: 13, font: FONT_BOLD, color: k.rgb(...UI.text), fixed: true }); } finally { k.popClip(); }
          }
        }
        if (c.outcome && !combatInspect && !menuOpen) drawFightSummary(c, pw, top);
        if (inputLocked) {
          const bx = pw.cx, by = top + 158, bw = 232, bh = 44;
          drawGlass(k, { rect: [bx - bw / 2, by - bh / 2, bw, bh], radius: bh / 2, tint: 0.7, fill: 0.07, line: 0.16, fixed: true });
          const sr = 11, sx = bx - 82, sn = 8, head = (k.time() * 1.5) % 1;
          for (let i = 0; i < sn; i++) {
            const a = (i / sn) * Math.PI * 2 - Math.PI / 2;
            let d = i / sn - head; d -= Math.floor(d);
            k.drawCircle({ pos: k.vec2(sx + Math.cos(a) * sr, by + Math.sin(a) * sr), radius: 2.2, color: k.rgb(...THEME.teal), opacity: 0.15 + 0.85 * (1 - d), fixed: true });
          }
          k.drawText({ text: c.waiting ? "Waiting for opponent" : "Resolving the turn", pos: k.vec2(bx + 18, by), size: 15, font: FONT_BOLD, anchor: "center", color: k.rgb(...UI.text), fixed: true });
        }
        const DMG_LIFE = 0.8;
        for (let i = dmgFloaters.length - 1; i >= 0; i--) if (tF - dmgFloaters[i].t0 >= DMG_LIFE) { dmgFloaters[i] = dmgFloaters[dmgFloaters.length - 1]; dmgFloaters.pop(); }
        for (const f of dmgFloaters) {
          if (f.dmg <= 0) continue;
          const age = tF - f.t0, op = 1 - age / DMG_LIFE;
          k.drawText({ text: `${f.heal ? "+" : "-"}${f.dmg}`, pos: k.vec2(f.x, f.y - age * 34), size: 18, font: "gameFont", anchor: "center", color: k.rgb(f.col[0], f.col[1], f.col[2]), opacity: op, fixed: true });
        }
        drawFxScreen(k);
        const nsAge = tF - newSpeciesT;
        if (nsAge >= 0 && nsAge < 2.0) {
          const nsA = nsAge < 1.6 ? 1 : Math.max(0, 1 - (nsAge - 1.6) / 0.4);
          k.drawText({ text: "New species!", pos: k.vec2(pw.cx, top + 120), size: 30, font: "gameFont", anchor: "center", color: k.rgb(255, 214, 110), opacity: nsA, fixed: true });
        }
      }

      if (menuOpen && !net.state.roundResult) {
        k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: k.rgb(0, 0, 0), opacity: 0.45, fixed: true });
        if (k.requestFrost && k.frostReady && !k.frostReady()) k.requestFrost();
        const pmW = Math.min(360, k.width() - 32), pmH = 350, pmX = k.width() / 2 - pmW / 2, pmY = k.height() / 2 - 150;
        drawGlassSheet(k, { rect: [pmX, pmY, pmW, pmH], radius: 24, accent: THEME.amber });
        drawIconTab(k, { x: k.width() / 2 - 26, y: pmY - 26, size: 52, icon: "clock", accent: THEME.amber, fixed: true });
        drawEyebrow(k, { x: k.width() / 2, y: pmY + 38, text: "Round in progress", size: 10, color: THEME.amber, anchor: "center", fixed: true });
        k.drawText({ text: "Paused", pos: k.vec2(k.width() / 2, pmY + 66), size: 32, font: FONT_BOLD, anchor: "center", color: k.rgb(...THEME.text), fixed: true });
        const menuMp = k.mousePos();
        const _menuBtns = menuBtns();
        const gpNav = gamepadConnected();
        for (let mi = 0; mi < _menuBtns.length; mi++) {
          const b = _menuBtns[mi];
          drawButton(k, { rect: b.rect, text: b.label, size: 18, radius: 14, fill: mi === 0 ? THEME.primary : b.danger ? THEME.danger : THEME.surfaceAlt, textColor: mi === 0 || b.danger ? THEME.textInv : UI.text,
            hover: inRect(menuMp, b.rect) || (gpNav && mi === menuSel), fixed: true });
        }
        k.drawText({ text: `${TOUCH ? "Tap Resume" : "ESC"} to resume. The round keeps going.`, pos: k.vec2(k.width() / 2, k.height() / 2 + 168), size: 12, font: "gameFont", anchor: "center", color: k.rgb(...UI.mut), fixed: true });
      }

      const rr = net.state.roundResult;
      if (rr) {
        k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: k.rgb(0, 0, 0), opacity: 0.5, fixed: true });
        const win = rr.outcome === "extracted";
        const title = rr.reason === "returned" ? "Home again" : rr.reason === "fainted" ? "Carried home" : win ? "Extracted!" : "Run Over";
        const accent = win ? THEME.success : THEME.danger;
        const REASON_TEXT = { extracted: "You reached a portal and escaped with your haul.", defeat: "Your team was defeated in battle.", zone: "The storm closed in and took you.", timeout: "The run ran out of time.", disconnect: "You were disconnected from the run.", left: "You left the run. The team you took in is lost.",
          returned: "You made it home with everything you found.", fainted: "Your team fainted and you were carried back to the village — see the Healer." };
        const lostN = rr.outcome === "died" ? (rr.lostCatches || 0) : 0;
        const lostI = rr.outcome === "died" ? (rr.lostItems || 0) : 0;
        const reasonText = REASON_TEXT[rr.reason] || rr.reason || "";
        const reasonNarrow = reasonText + (lostN ? ` ${lostN === 1 ? "The monster" : `The ${lostN} monsters`} you caught this run ${lostN === 1 ? "was" : "were"} lost.` : "")
          + (lostI ? ` ${lostI === 1 ? "The item" : `The ${lostI} items`} you found ${lostI === 1 ? "was" : "were"} lost.` : "");
        const cardX = k.width() / 2, cardW = Math.min(600, k.width() - 32);
        const g = rr.gains;
        const st = net.state.stats || {};
        const runChips = [];
        if (g) {
          if (g.caught) runChips.push(["catch", `Caught ${g.caught}`, lostN ? THEME.textMut : THEME.success]);
          if (lostN) runChips.push(["skull", `Lost ${lostN} catch${lostN === 1 ? "" : "es"}`, THEME.danger]);
          if (lostI) runChips.push(["bag", `Lost ${lostI} item${lostI === 1 ? "" : "s"}`, THEME.danger]);
          if (g.xpGained) runChips.push(["xp", `+${g.xpGained} XP`, THEME.amber]);
          if (g.levelUps) runChips.push(["trophy", `${g.levelUps} level-up${g.levelUps > 1 ? "s" : ""}`, THEME.amber]);
          runChips.push(["clock", `Survived ${Math.floor((g.survivedS || 0) / 60)}:${String((g.survivedS || 0) % 60).padStart(2, "0")}`, THEME.textBody]);
        }
        const lifeTiles = [["trophy", st.extractions || 0, "Extracted", THEME.success], ["skull", st.deaths || 0, "Deaths", THEME.danger], ["catch", st.caught || 0, "Caught", THEME.teal], ["sword", st.pvpWins || 0, "PvP wins", THEME.violet], ["flag", st.runs || 0, "Runs", THEME.textBody]];
        const chipW = (t, sz) => (typeof k.measureText === "function" ? k.measureText(t, sz, FONT_BOLD) : t.length * sz * 0.6) + sz * 3;
        const chipRows = (maxW, sz) => {
          const rows = []; let row = [], w = 0;
          for (const c of runChips) { const cw = chipW(c[1], sz); if (row.length && w + 6 + cw > maxW) { rows.push(row); row = []; w = 0; } row.push([c, cw]); w += (row.length > 1 ? 6 : 0) + cw; }
          if (row.length) rows.push(row);
          return rows;
        };
        const lifeT = `LIFETIME     Extractions ${st.extractions || 0}     Deaths ${st.deaths || 0}     Caught ${st.caught || 0}     PvP wins ${st.pvpWins || 0}     Runs ${st.runs || 0}`;
        const narrowR = k.width() < 480;
        const innerW0 = cardW - 26, nl0 = (txt, sz) => Math.max(1, Math.ceil((txt.length * sz * 0.56) / innerW0));
        const nRows = narrowR ? chipRows(cardW - 26, 10).length : 0;
        const cardH = narrowR ? (34 + 36 + nl0(reasonNarrow, 12) * 17 + 10 + nRows * 28 + 8 + 16 + 54 + 26) : (g ? 284 : 248);
        const cardY = k.height() / 2 + 18;
        k.drawRect({ pos: k.vec2(cardX, cardY), width: cardW, height: cardH, radius: 18, anchor: "center", color: k.rgb(accent[0], accent[1], accent[2]), opacity: 0.001, fixed: true,
          shadow: { blur: 40, color: accent, alpha: 0.35 } });
        if (k.requestFrost && k.frostReady && !k.frostReady()) k.requestFrost();
        drawGlassSheet(k, { rect: [cardX - cardW / 2, cardY - cardH / 2, cardW, cardH], radius: 22, accent });
        drawIconTab(k, { x: cardX - 26, y: cardY - cardH / 2 - 26, size: 52, icon: rr.reason === "returned" ? "village" : rr.reason === "fainted" ? "heart" : win ? "trophy" : "skull", accent, fixed: true });
        if (narrowR) {
          const innerW = cardW - 26, lh = (sz) => sz + 5;
          const nlines = (txt, sz) => Math.max(1, Math.ceil((txt.length * sz * 0.56) / innerW));
          let ty = cardY - cardH / 2 + 34;
          k.drawText({ text: title, pos: k.vec2(cardX, ty), size: 28, font: FONT_BOLD, anchor: "top", color: k.rgb(accent[0], accent[1], accent[2]), fixed: true }); ty += 36;
          k.drawText({ text: reasonNarrow, pos: k.vec2(cardX, ty), size: 12, font: "gameFont", anchor: "top", width: innerW, align: "center", color: k.rgb(...UI.text), fixed: true }); ty += nlines(reasonNarrow, 12) * lh(12) + 10;
          for (const row of chipRows(innerW, 10)) {
            const rw = row.reduce((a, [, cw]) => a + cw, 0) + (row.length - 1) * 6;
            let cxx = cardX - rw / 2;
            for (const [[ic, t, c], cw] of row) {
              drawGlass(k, { rect: [cxx, ty, cw, 22], radius: 11, fill: 0.06, line: 0.12, fixed: true });
              drawIcon(k, ic, { x: cxx + 12, y: ty + 11, size: 11, color: c, fixed: true });
              k.drawText({ text: t, pos: k.vec2(cxx + 21, ty + 11), size: 10, font: FONT_BOLD, anchor: "left-center", color: k.rgb(...c), fixed: true });
              cxx += cw + 6;
            }
            ty += 28;
          }
          ty += 8;
          drawEyebrow(k, { x: cardX, y: ty, text: "Lifetime", size: 8, color: UI.mut, anchor: "center", fixed: true }); ty += 16;
          const tw2 = innerW / lifeTiles.length, tx0 = cardX - innerW / 2;
          lifeTiles.forEach(([ic, v, lbl, c], i) => {
            const x = tx0 + i * tw2;
            drawIcon(k, ic, { x: x + tw2 / 2, y: ty + 7, size: 12, color: c, fixed: true });
            k.drawText({ text: String(v), pos: k.vec2(x + tw2 / 2, ty + 17), size: 17, font: FONT_BOLD, anchor: "top", color: k.rgb(...UI.text), fixed: true });
            k.drawText({ text: lbl, pos: k.vec2(x + tw2 / 2, ty + 38), size: 9, font: "gameFont", anchor: "top", color: k.rgb(...UI.mut), fixed: true });
          });
          void lifeT;
          const dPulseN = prefersReducedMotion() ? 0.85 : 0.5 + 0.4 * Math.sin(k.time() * 3.5);
          k.drawText({ text: "tap to return", pos: k.vec2(cardX, cardY + cardH / 2 - 16), size: 11, font: "gameFont", anchor: "center", color: k.rgb(...UI.mut), opacity: dPulseN, fixed: true });
        } else {
          const topY = cardY - cardH / 2;
          k.drawText({ text: title, pos: k.vec2(cardX, topY + 54), size: 44, font: FONT_BOLD, anchor: "center", color: k.rgb(accent[0], accent[1], accent[2]), fixed: true });
          k.drawText({ text: reasonText, pos: k.vec2(cardX, topY + 100), size: 16, font: "gameFont", anchor: "center", width: cardW - 60, align: "center", color: k.rgb(...UI.text), fixed: true });
          if (g) {
            const chips = runChips;
            const ws = chips.map(([, t]) => (typeof k.measureText === "function" ? k.measureText(t, 11, FONT_BOLD) : t.length * 6.5) + 34);
            let cxx = cardX - (ws.reduce((a, b) => a + b, 0) + (chips.length - 1) * 8) / 2;
            chips.forEach(([ic, t, c], i) => {
              const cw2 = ws[i], cyy = topY + 126;
              drawGlass(k, { rect: [cxx, cyy, cw2, 24], radius: 12, fill: 0.06, line: 0.12, fixed: true });
              drawIcon(k, ic, { x: cxx + 14, y: cyy + 12, size: 13, color: c, fixed: true });
              k.drawText({ text: t, pos: k.vec2(cxx + 26, cyy + 12), size: 11, font: FONT_BOLD, anchor: "left-center", color: k.rgb(...c), fixed: true });
              cxx += cw2 + 8;
            });
          }
          const tiles = lifeTiles;
          const tw2 = Math.min(104, (cardW - 48) / tiles.length), tx0 = cardX - (tw2 * tiles.length) / 2, ty0 = topY + (g ? 182 : 146);
          drawEyebrow(k, { x: cardX, y: ty0 - 16, text: "Lifetime", size: 9, color: UI.mut, anchor: "center", fixed: true });
          tiles.forEach(([ic, v, lbl, c], i) => {
            const x = tx0 + i * tw2;
            drawIcon(k, ic, { x: x + tw2 / 2, y: ty0 + 10, size: 14, color: c, fixed: true });
            k.drawText({ text: String(v), pos: k.vec2(x + tw2 / 2, ty0 + 22), size: 20, font: FONT_BOLD, anchor: "top", color: k.rgb(...UI.text), fixed: true });
            k.drawText({ text: lbl, pos: k.vec2(x + tw2 / 2, ty0 + 48), size: 10, font: "gameFont", anchor: "top", color: k.rgb(...UI.mut), fixed: true });
          });
          void lifeT;
          const dPulse = prefersReducedMotion() ? 0.85 : 0.5 + 0.4 * Math.sin(k.time() * 3.5);
          k.drawText({ text: "tap / space to return", pos: k.vec2(cardX, cardY + cardH / 2 - 18), size: 12, font: "gameFont", anchor: "center", color: k.rgb(...UI.mut), opacity: dPulse, fixed: true });
        }
      }

      if (!net.state.connected) {
        const reconnecting = net.state.reconnecting;
        const reduce = prefersReducedMotion();
        k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: k.rgb(0, 0, 0), opacity: reconnecting ? 0.62 : 0.82, fixed: true });
        const tSize = k.width() < 480 ? 28 : 38;
        const titleOp = reconnecting && !reduce ? 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(now * 3.0)) : 1;
        k.drawText({ text: reconnecting ? "Reconnecting…" : "Connection lost", pos: k.vec2(k.width() / 2, k.height() / 2 - 24), size: tSize, font: "gameFont", anchor: "center", width: k.width() - 24, align: "center", color: reconnecting ? k.rgb(...UI.amber) : k.rgb(...UI.danger), opacity: titleOp, fixed: true });
        k.drawText({ text: reconnecting ? "resuming your run…" : "tap / space to return to the village", pos: k.vec2(k.width() / 2, k.height() / 2 + 28), size: k.width() < 480 ? 15 : 18, font: "gameFont", anchor: "center", width: k.width() - 24, align: "center", color: k.rgb(...UI.text), fixed: true });
        if (reconnecting) {
          const dy = k.height() / 2 + 58;
          for (let d = 0; d < 3; d++) {
            const op = reduce ? 0.6 : 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(now * 4.0 - d * 0.9));
            k.drawCircle({ pos: k.vec2(k.width() / 2 + (d - 1) * 18, dy), radius: 4, color: k.rgb(...UI.amber), opacity: op, fixed: true });
          }
        }
      }

      const rrf = net.state.roundResult;
      if (rrf && rrf.outcome === "extracted" && !extractSfxDone) { extractSfxDone = true; sfx("extract"); haptic([0, 25, 45, 70]); }
      if (rrf && rrf.outcome === "extracted" && extractFlashT == null && !prefersReducedMotion()) extractFlashT = k.time();
      if (extractFlashT != null) {
        const fp = (k.time() - extractFlashT) / 0.6;
        if (fp < 1) drawExtractFlash(k, { x: k.width() / 2, y: k.height() / 2, p: fp });
      }

      if (net.state.combat && combatInspect && !menuOpen) {
        const cm = combatInspect === "enemy" ? net.state.combat.enemy : net.state.combat.active;
        if (cm) {
          const mt = getMonsterType(cm.typeName) || cm;
          drawMonsterDetail(k, mt, { vitals: { currentHealth: cm.currentHealth, maxHealth: cm.maxHealth, currentEnergy: cm.currentEnergy, maxEnergy: cm.maxEnergy } });
        } else combatInspect = null;
      }
    });

    const act = (action) => {
      if (!action) return;
      if (net.state.combat && !net.state.combat.outcome && k.time() - battleIntroT0 < BATTLE_INTRO_DURATION) {
        battleIntroT0 = k.time() - BATTLE_INTRO_DURATION; haptic(6); return;
      }
      if (action.kind === "openSwap") { if (benchList().length) { swapOpen = true; itemsOpen = false; haptic(8); sfx("click"); } return; }
      if (action.kind === "closeSwap") { swapOpen = false; haptic(8); sfx("back"); return; }
      if (action.kind === "openItems") { if ((net.state.items || []).length) { itemsOpen = true; swapOpen = false; haptic(8); sfx("click"); } return; }
      if (action.kind === "closeItems") { itemsOpen = false; haptic(8); sfx("back"); return; }
      if (action.kind === "catch" && net.state.combat?.pvp) return;
      if ((action.kind === "openItems" || action.kind === "item") && net.state.combat?.pvp) return;
      const c = net.state.combat;
      if (c && !c.outcome && !c.waiting && !awaiting) {
        awaiting = true;
        combatPress = { kind: action.kind, name: action.attackName || action.kind, t: k.time() };
        haptic(8); sfx("click");
        if (action.kind === "catch") { catchThrowT0 = k.time(); catchResolveT0 = -9; catchResolveKind = null; sfx("throw"); }
        if (action.kind === "swap") swapOpen = false;
        if (action.kind === "item") itemsOpen = false;
        net.combatAction(action);
      }
    };
    for (const n of [1, 2, 3, 4]) {
      bindPress("attack" + n, () => {
        if (swapOpen) { const b = benchList()[n - 1]; if (b) act({ kind: "swap", monsterId: b.m.id }); return; }
        const a = net.state.combat?.attacks?.[n - 1];
        if (a) act({ kind: "attack", attackName: a.name });
      });
    }
    bindPress("catch", () => act({ kind: "catch" }));
    bindPress("flee", () => act({ kind: "flee" }));
    bindPress("swap", () => { if (net.state.combat && !net.state.combat.outcome) act({ kind: swapOpen ? "closeSwap" : "openSwap" }); });

    const throwEquippedChain = (aimDir = null, charge = 0) => {
      if (net.state.combat || net.state.roundResult) return;
      const e = equippedChain();
      if (!e || !e.cs || (e.cs.durability != null && e.cs.durability <= 0)) return;
      if ((net.state.projectiles || []).some((pr) => pr.owner === net.state.playerId)) return;
      // Send a unit vector: server clamps each axis to [-1,1] before normalising
      let dir = selfDir;
      if (aimDir && (aimDir.x || aimDir.y)) {
        const al = Math.hypot(aimDir.x, aimDir.y) || 1; dir = { x: aimDir.x / al, y: aimDir.y / al };
      } else if (!TOUCH) {
        const m = k.mousePos(), ax = m.x - k.width() / 2, ay = m.y - k.height() / 2, al = Math.hypot(ax, ay);
        if (al > 4) dir = { x: ax / al, y: ay / al };
      }
      const hflip = (dir.x < -0.15) ? -1 : 1;
      playThrowWindup(selfRender.x + 15 * hflip, selfRender.y + 2, e.def ? chainColor(e.def) : [120, 220, 255]); sfx("throw");
      throwLungeT0 = k.time();
      net.throwChain(dir, e.cs.chainId, Math.max(0, Math.min(1, charge || 0)));
    };
    const canThrowNow = () => {
      if (net.state.combat || net.state.roundResult) return false;
      const e = equippedChain();
      if (!e || !e.cs || (e.cs.durability != null && e.cs.durability <= 0)) return false;
      return !(net.state.projectiles || []).some((pr) => pr.owner === net.state.playerId);
    };
    bindPress("throw", () => { if (kbCharge == null && canThrowNow()) kbCharge = { t0: k.time() }; });
    function cycleChain(dir) {
      const slots = (net.state.equippedChainIds || []).map((id) => ({ chainId: id }));
      const next = nextChainId(slots, net.state.equippedChainId, dir);
      if (!next) return;
      net.state.equippedChainId = next;
      net.setEquippedChain(next);
    }
    bindPress("chainPrev", () => { if (!net.state.combat && !net.state.roundResult) cycleChain(-1); });
    bindPress("chainNext", () => { if (!net.state.combat && !net.state.roundResult) cycleChain(1); });
    k.onKeyPress("space", () => {
      if (combatInspect) { combatInspect = null; return; }
      if (net.state.roundResult) { exitAfterRun(); return; }
      if (!net.state.connected && !net.state.reconnecting) { exitAfterRun(); return; }
      const cc = net.state.combat;
      if (cc && cc.outcome) net.clearCombat();
    });

    bindPress("pause", () => { if (combatInspect) { combatInspect = null; return; } if (net.state.roundResult) { exitAfterRun(); } else { menuOpen = !menuOpen; leaveArm = false; } });
    bindPress("mute", () => toggleMuted());

    function pointerDown(id, p) {
      if (menuOpen) { for (const b of menuBtns()) { const [x, y, w, h] = b.rect; if (p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h) { b.act(); return; } } return; }
      if (net.state.roundResult) { exitAfterRun(); return; }
      if (!net.state.connected && !net.state.reconnecting) { exitAfterRun(); return; }
      const cc = net.state.combat;
      if (cc) {
        if (combatInspect) { combatInspect = null; sfx("click"); return; }
        if (cc.outcome) { net.clearCombat(); return; }
        const hitRow = (r) => r && p.x >= r[0] && p.x <= r[0] + r[2] && p.y >= r[1] && p.y <= r[1] + r[3];
        if (combatRowRects) {
          if (cc.enemy && hitRow(combatRowRects.enemy)) { combatInspect = "enemy"; sfx("click"); return; }
          if (cc.active && hitRow(combatRowRects.active)) { combatInspect = "active"; sfx("click"); return; }
        }
        const b = hitButtonObj(p);
        if (b) {
          if (TOUCH && b.action.kind === "attack") { atkHold = { action: b.action, description: b.description || "", rect: b.rect, t0: k.time(), x: p.x, y: p.y }; return; }
          act(b.action);
        }
        return;
      }
      { const mm = hudSlots().minimap; const mox = mm.x, moy = mm.y, ms = mm.size;
        if (p.x >= mox - 4 && p.x <= mox + ms + 4 && p.y >= moy - 4 && p.y <= moy + ms + 4) { mmZoom = nextMinimapZoom(mmZoom); return; } }
      if (TOUCH && !onboard) { const [px, py, pw, ph] = pauseBtnRect(); if (p.x >= px && p.x <= px + pw && p.y >= py && p.y <= py + ph) { menuOpen = true; return; } }
      if (!onboard && (net.state.equippedChainIds || []).length > 1) {
        const [hx, hy, hw, hh] = chainHudRect();
        if (p.x >= hx && p.x <= hx + hw && p.y >= hy && p.y <= hy + hh) { cycleChain(1); haptic(8); return; }
      }
      if (TOUCH && !onboard && (net.state.equippedChainIds || []).length > 1) {
        const sb = swapBtnC();
        if (Math.hypot(p.x - sb.x, p.y - sb.y) <= SWAP_R) { cycleChain(1); haptic(8); sfx("click"); return; }
      }
      if (TOUCH && !onboard && p.x >= k.width() / 2) {
        const e = equippedChain();
        const chainOut = (net.state.projectiles || []).some((pr) => pr.owner === net.state.playerId);
        const throwable = !!e && !!e.cs && !(e.cs.durability != null && e.cs.durability <= 0) && !chainOut;
        throwAim = { id, origin: { x: p.x, y: p.y }, dir: { x: 0, y: 0 }, dragged: false, t0: k.time(), enabled: throwable };
        haptic(throwable ? 6 : 2);
        return;
      }
      // Touch ids drive the stick only when TOUCH, else touch laptops move an invisible stick
      if (id === "m" || (TOUCH && id !== "m")) joyStart(id, p);
    }
    k.onTouchStart((p, t) => pointerDown(t?.identifier ?? 0, p));
    k.onTouchMove((p, t) => {
      const id = t?.identifier ?? 0;
      if (throwAim && id === throwAim.id) {
        const o = throwAim.origin; const dx = p.x - o.x, dy = p.y - o.y, len = Math.hypot(dx, dy);
        if (len > 14) { throwAim.dir = { x: dx / len, y: dy / len }; throwAim.dragged = true; } else { throwAim.dragged = false; }
        return;
      }
      if (atkHold && Math.hypot(p.x - atkHold.x, p.y - atkHold.y) > 12) atkHold = null;
      joyMove(id, p);
    });
    k.onTouchEnd((p, t) => {
      const id = t?.identifier ?? 0;
      if (throwAim && id === throwAim.id) {
        const aim = throwAim; throwAim = null;
        const c = Math.min(1, (k.time() - (aim.t0 || k.time())) / GAME.SPIRIT_CHAIN.CHARGE_TIME_S);
        throwCharge = 0;
        throwEquippedChain(aim.dragged ? aim.dir : null, c);
        return;
      }
      if (atkHold) { if (k.time() - atkHold.t0 < 0.35) act(atkHold.action); atkHold = null; }
      joyEnd(id);
    });
    k.onTouchStart(() => { if (onboard && onboardT > 0.3) dismissOnboard(); });
    k.onMousePress(() => { if (onboard && onboardT > 0.3) dismissOnboard(); });
    if (!TOUCH) {
      // Mouse handlers only when !TOUCH: touch devices synthesize mouse events (double-fire)
      let mDownT = 0, mDownP = null;
      k.onMousePress(() => { mDownT = k.time(); mDownP = k.mousePos(); pointerDown("m", mDownP); });
      k.onMouseMove(() => { if (joyId === "m") joyMove("m", k.mousePos()); });
      k.onMouseRelease(() => {
        const p = k.mousePos();
        const wasTap = joyId === "m" && mDownP && (k.time() - mDownT) < 0.22 && Math.hypot(p.x - mDownP.x, p.y - mDownP.y) < 8;
        joyEnd("m");
        if (wasTap && !net.state.combat && !net.state.roundResult && !onboard && !menuOpen) throwEquippedChain();
        mDownP = null;
      });
    }
  });
}
