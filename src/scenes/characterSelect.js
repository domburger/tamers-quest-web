import { getCharacters, createCharacter, deleteCharacter, getProfile, clearProfile, getAccountSession, setServerCharacters } from "../storage.js";
import { net } from "../netClient.js";
import { getMonsterStats as getStatsAtLevel } from "../engine/stats.js";
import { getMonsterType } from "../engine/gamedata.js";
import { THEME, PAL, FONT, FONT_BODY, FONT_BOLD, hpColor, addMenuBackground, addHeader, addLabel, addButton, addPanel } from "../ui/theme.js";
import { drawIcon, iconSpriteKey } from "../ui/icons.js";
import { sfx } from "../systems/audio.js";
import { gamepadConnected, gamepadPressed, gamepadMove, BTN } from "../systems/gamepad.js";
import { safeInsetsDesign } from "../systems/safearea.js";
import { drawCharacter } from "../render/character.js";
import { slugOf, drawMonsterIcon } from "../render/monster.js";
import { getEquippedCharacterSkin } from "../render/characterCosmetics.js";
import { prefersReducedMotion } from "../systems/a11y.js";

export default function characterSelectScene(k) {
  k.scene("characterSelect", () => {
    addMenuBackground(k);
    const cx = k.width() / 2;
    const ins = safeInsetsDesign(k);

    // No input z-order: gate every onClick under a modal on modalUp() (backdrops don't absorb).
    let inputActive = false, confirmOpen = false;
    const modalUp = () => inputActive || confirmOpen;
    const skin = getEquippedCharacterSkin();
    let showEmptyAvatar = false;
    const slotPortraits = [];
    const teamThumbs = [];
    let selectedId = null;
    const selectedChar = () => characters.find((c) => c.id === selectedId) || characters[0] || null;
    const enterSelected = () => { const c = selectedChar(); if (modalUp() || !c) return; sfx("click"); k.go("hub", { characterId: c.id }); };
    k.onDraw(() => {
      // onDraw paints above all objects: skip it while a modal is up.
      if (modalUp()) return;
      const reduce = prefersReducedMotion();
      const clk = reduce ? 0 : k.time();
      const pulse = reduce ? 0.5 : 0.5 + 0.5 * Math.sin(k.time() * 1.6);
      if (showEmptyAvatar) {
        const ey = 300;
        k.drawCircle({ pos: k.vec2(cx, ey - 42), radius: 100, color: k.rgb(...THEME.teal), opacity: 0.05 + 0.03 * pulse });
        k.drawCircle({ pos: k.vec2(cx, ey - 42), radius: 64, color: k.rgb(...THEME.teal), opacity: 0.06 + 0.04 * pulse });
        k.drawEllipse({ pos: k.vec2(cx, ey + 11), radiusX: 58, radiusY: 15, color: k.rgb(0, 0, 0), opacity: 0.45 });
        k.drawEllipse({ pos: k.vec2(cx, ey + 9), radiusX: 53, radiusY: 13, color: k.rgb(...THEME.teal), opacity: 0.10 + 0.05 * pulse });
        k.drawEllipse({ pos: k.vec2(cx, ey + 9), radiusX: 53, radiusY: 13, fill: false, outline: { width: 1.5, color: k.rgb(...THEME.teal) }, opacity: 0.55 });
        drawCharacter(k, { x: cx, y: ey, t: clk, dir: { x: 0, y: 1 }, scale: 2.4, color: skin.accent, cloak: skin.cloak, model: skin.model });
        return;
      }
      for (const sp of slotPortraits) {
        drawCharacter(k, { x: sp.px, y: sp.y + 3, t: clk, dir: { x: 0, y: 1 }, scale: 0.9, color: skin.accent, cloak: skin.cloak, model: skin.model });
        const bx = sp.px + 23, by = sp.y + 22;
        k.drawCircle({ pos: k.vec2(bx, by), radius: 11, color: k.rgb(...THEME.teal) });
        k.drawCircle({ pos: k.vec2(bx, by), radius: 9, color: k.rgb(...THEME.bg) });
        k.drawText({ text: `${sp.level}`, pos: k.vec2(bx, by + 1), size: 12, font: FONT, anchor: "center", color: k.rgb(...THEME.text) });
      }
      for (const th of teamThumbs) {
        drawMonsterIcon(k, { sprite: slugOf(th.mon.typeName), typeName: th.mon.typeName, cx: th.cx, cy: th.cy, scale: 0.16, topY: th.topY });
      }
      if (!heroShown) return;
      const hx = heroX;
      const hy = 312;
      for (let i = 7; i >= 1; i--) {
        k.drawCircle({ pos: k.vec2(hx, hy - 72), radius: i * 15, color: k.rgb(...THEME.teal), opacity: 0.012 + 0.004 * pulse });
      }
      k.drawEllipse({ pos: k.vec2(hx, hy + 12), radiusX: 56, radiusY: 15, color: k.rgb(0, 0, 0), opacity: 0.45 });
      k.drawEllipse({ pos: k.vec2(hx, hy + 10), radiusX: 51, radiusY: 13, color: k.rgb(...THEME.teal), opacity: 0.10 + 0.05 * pulse });
      k.drawEllipse({ pos: k.vec2(hx, hy + 10), radiusX: 51, radiusY: 13, fill: false, outline: { width: 1.5, color: k.rgb(...THEME.teal) }, opacity: 0.55 });
      drawCharacter(k, { x: hx, y: hy, t: clk, dir: { x: 0, y: 1 }, scale: 3.0, color: skin.accent, cloak: skin.cloak, model: skin.model });
      const sel = selectedChar();
      const heroName = ((sel && sel.name) || (profile && profile.nickname) || "Tamer").slice(0, 18);
      k.drawText({ text: "Tamer", pos: k.vec2(hx, hy + 34), size: 11, font: FONT, anchor: "center", color: k.rgb(...THEME.teal), opacity: 0.85 });
      k.drawText({ text: heroName, pos: k.vec2(hx, hy + 52), size: 20, font: FONT, anchor: "center", color: k.rgb(...THEME.text) });
    });

    const backW = 96, backX = 70 + ins.left;
    const stackHeader = k.width() < 680;
    const headerY = stackHeader ? 96 : 50;
    addHeader(k, { x: cx, y: headerY, text: "Select Character", size: 34 });
    let captionPos = null;
    k.onDraw(() => {
      if (!stackHeader) {
        const tw = typeof k.measureText === "function" ? k.measureText("Select Character", 34, FONT_BOLD) : 270;
        drawIcon(k, "person", { x: cx - tw / 2 - 26, y: headerY + 2, size: 28, color: THEME.primary });
      }
      if (captionPos) { const cw = typeof k.measureText === "function" ? k.measureText("Your Tamers", 13, FONT) : 80; drawIcon(k, "person", { x: captionPos.x - cw / 2 - 12, y: captionPos.y, size: 14, color: THEME.primary }); }
    });

    const profile = getProfile();
    const authed = !!(profile && !profile.isGuest);
    const idY = headerY + 42;
    if (profile && profile.isGuest) {
      addLabel(k, { x: cx, y: idY, text: `Playing as guest — ${profile.nickname || "Guest"}`, size: 15, color: THEME.textMut });
      const narrowChip = k.width() < 560;
      const warnTxt = narrowChip ? "Guest progress isn't saved" : "Guest progress isn't saved — log in to keep your tamers";
      const PAD = 16, DOT_R = 3, DOT_GAP = 13, CHW = 0.58;
      const textStart = PAD + DOT_R * 2 + DOT_GAP;
      const pillW = Math.min(k.width() - 40, textStart + warnTxt.length * 12 * CHW + PAD);
      const pillY = idY + 24, pillLeft = cx - pillW / 2;
      k.add([k.rect(pillW, 26, { radius: 13 }), k.pos(cx, pillY), k.anchor("center"), k.color(...THEME.surface), k.outline(1, k.rgb(...THEME.line)), k.opacity(0.92)]);
      k.add([k.circle(DOT_R), k.pos(pillLeft + PAD + DOT_R, pillY), k.anchor("center"), k.color(...THEME.warn)]);
      addLabel(k, { x: pillLeft + textStart, y: pillY - 6, text: warnTxt, size: 12, color: THEME.warn, font: FONT_BODY, anchor: "left" });
    } else if (authed) {
      const nm = profile.nickname || "Signed in";
      const chipW = Math.min(k.width() - 120, Math.max(190, nm.length * 11 + 130));
      addButton(k, { x: cx, y: idY + 12, w: chipW, h: 34, text: `${nm}    View profile`, size: 14, icon: "person",
        fill: THEME.surface, textColor: THEME.teal, onClick: () => { if (modalUp()) return; k.go("profile"); } });
    }
    const acctX = k.width() - 76 - ins.right;
    if (authed) {
      addButton(k, { x: acctX, y: 40 + ins.top, w: 108, h: 36, text: "Sign out", size: 15,
        fill: THEME.surfaceAlt, textColor: THEME.danger,
        onClick: () => { if (modalUp()) return; try { net.clearSession(); } catch {} clearProfile(); k.go("start"); } });
    } else if (profile && profile.isGuest) {
      addButton(k, { x: acctX, y: 40 + ins.top, w: 108, h: 36, text: "Log in", size: 15,
        fill: THEME.surface, textColor: THEME.teal, onClick: () => { if (modalUp()) return; k.go("start"); } });
    }

    let characters = getCharacters();
    const listY = stackHeader ? 282 : 214;
    const cardW = Math.min(600, k.width() - 72);
    let heroShown = false, rosterCx = cx, heroX = 0;
    function layoutFor(count) {
      heroShown = !stackHeader && count > 0 && (k.width() - cardW) / 2 >= 232;
      rosterCx = heroShown ? Math.round((3 * k.width() - cardW) / 4) : cx;
      heroX = heroShown ? Math.round((rosterCx - cardW / 2) / 2) : 0;
    }
    const narrowCard = cardW < 500;
    const maxSlots = 5;
    const fullH = narrowCard ? 150 : 100;
    let cardH = fullH, step = fullH + 12, compact = false;
    function fitCards(n) {
      const nSlots = Math.max(1, Math.min(maxSlots, n || 1));
      const btnTop = k.height() - 64 - ins.bottom - 25;
      const avail = btnTop - listY;
      if ((nSlots - 1) * (fullH + 12) + fullH / 2 <= avail) { cardH = fullH; step = fullH + 12; }
      else {
        const gap = 10;
        cardH = Math.max(54, Math.min(fullH, (avail - (nSlots - 1) * gap) / (nSlots - 0.5)));
        step = cardH + gap;
      }
      compact = cardH < (narrowCard ? 132 : 82);
    }

    // Must be tagged: untagged addLabel/addPanel leak across destroyAll re-renders.
    function cl(x, y, text, size, color, anchor = "center") {
      k.add([k.text(text, { size, font: FONT }), k.pos(x, y), k.anchor(anchor), k.color(...color), "charUI"]);
    }

    function renderList() {
      k.destroyAll("charUI");
      slotPortraits.length = 0;
      teamThumbs.length = 0;
      characters = getCharacters();
      if (!characters.some((c) => c.id === selectedId)) selectedId = characters[0] ? characters[0].id : null;
      fitCards(characters.length);
      layoutFor(characters.length);
      showEmptyAvatar = characters.length === 0;

      if (characters.length === 0) {
        cl(cx, 376, "No tamers yet", 24, THEME.text);
        cl(cx, 404, "Create your first tamer to brave the caves.", 14, THEME.textMut);
      } else {
        const btnTop = k.height() - 64 - ins.bottom - 25;
        const yOffset = Math.max(0, (btnTop - listY - (characters.length - 1) * step - cardH / 2) / 2);
        const blockCY = listY + yOffset + (characters.length - 1) * step / 2;
        for (let i = 11; i >= 1; i--) {
          k.add([k.circle(i * 34), k.pos(rosterCx, blockCY), k.anchor("center"), k.color(...THEME.teal), k.opacity(0.01), "charUI"]);
        }
        const capY = listY + yOffset - cardH / 2 - 32;
        cl(rosterCx, capY, "Your Tamers", 13, THEME.primary);
        captionPos = { x: rosterCx, y: capY };
        const pipY = capY + 18;
        for (let i = 0; i < maxSlots; i++) {
          const pxp = rosterCx + (i - (maxSlots - 1) / 2) * 16;
          const filled = i < characters.length;
          k.add([k.circle(filled ? 4 : 3.2), k.pos(pxp, pipY), k.anchor("center"),
            k.color(...(filled ? THEME.primary : THEME.line)), k.opacity(filled ? 1 : 0.7), "charUI"]);
        }
        characters.slice(0, maxSlots).forEach((char, i) => drawCard(char, listY + yOffset + i * step));

        if (heroShown) {
          const sc = selectedChar();
          const sw = 224, shY = 452;
          addPanel(k, { x: heroX, y: shY, w: sw, h: 132, radius: 14, tag: "charUI" });
          const st = sc.stats || {};
          const rows = [
            ["Level", `${sc.level || 1}`],
            ["Gold", `${sc.gold || 0}`],
            ["Monsters", `${(sc.activeMonsters || []).length}`],
            ["Caught", `${st.caught || 0}`],
            ["Runs", `${st.runs || 0}`],
          ];
          const valRight = heroX + sw / 2 - 18;
          const ROW = 24, cy0 = shY - 2 * ROW - 2;
          rows.forEach((r, i) => {
            const cy = cy0 + i * ROW + (i >= 3 ? 4 : 0);
            const ry = cy - 7;
            k.add([k.text(r[0], { size: 12, font: FONT_BODY }), k.pos(heroX - sw / 2 + 18, cy - 6), k.anchor("left"), k.color(...THEME.textMut), "charUI"]);
            const isGold = r[0] === "Gold";
            k.add([k.text(r[1], { size: 14, font: FONT }), k.pos(isGold ? valRight - 16 : valRight, ry), k.anchor("right"), k.color(...THEME.text), "charUI"]);
            if (isGold) {
              // Shim draws non-center-anchored text from its top edge (textBaseline top).
              const cxc = valRight - 6, cyc = ry + 7, rC = 6;
              k.add([k.circle(rC), k.pos(cxc, cyc), k.anchor("center"), k.color(...THEME.amber.map((c) => c * 0.55)), "charUI"]);
              k.add([k.circle(rC - 1.4), k.pos(cxc, cyc), k.anchor("center"), k.color(...THEME.amber), "charUI"]);
              k.add([k.circle(1.5), k.pos(cxc - rC * 0.32, cyc - rC * 0.34), k.anchor("center"), k.color(...THEME.amber.map((c) => c + (255 - c) * 0.5)), "charUI"]);
            }
          });
          k.add([k.rect(sw - 36, 1, { radius: 0.5 }), k.pos(heroX, cy0 + 2.5 * ROW + 2), k.anchor("center"), k.color(...THEME.line), k.opacity(0.7), "charUI"]);
          addButton(k, { x: heroX, y: 564, w: sw, h: 48, text: "Enter the Caves", size: 17, tag: "charUI",
            fill: THEME.primary, textColor: THEME.textInv, onClick: enterSelected });
        }
      }
      drawBottomActions();
    }

    function drawBottomActions() {
      k.destroyAll("newBtn");
      const chars = getCharacters();
      const full = chars.length >= maxSlots;
      const btnY = k.height() - 64 - ins.bottom;
      const placeNew = (x, w, primary) => addButton(k, { x, y: btnY, w, h: 50, tag: "newBtn",
        text: full ? "All slots full" : "New Character", size: 19, icon: full ? "lock" : "plus",
        fill: full ? THEME.surfaceAlt : (primary ? THEME.primary : THEME.surfaceAlt),
        textColor: full ? THEME.textMut : (primary ? THEME.textInv : THEME.text),
        disabled: full, onClick: () => { if (modalUp()) return; showNameInput(); } });

      if (heroShown) {
        placeNew(rosterCx, 260, false);
      } else if (chars.length > 0) {
        const gap = 14, bw = Math.min(238, (Math.min(560, k.width() - 48) - gap) / 2);
        addButton(k, { x: cx - bw / 2 - gap / 2, y: btnY, w: bw, h: 50, text: "Enter the Caves", size: 17,
          tag: "newBtn", fill: THEME.primary, textColor: THEME.textInv, onClick: enterSelected });
        placeNew(cx + bw / 2 + gap / 2, bw, false);
      } else {
        placeNew(cx, 260, true);
      }
    }

    // Passive sync must ignore an empty list: a transient empty 200 would wipe the cache.
    async function syncServerCharacters({ allowEmpty = false } = {}) {
      const session = getAccountSession();
      if (!session) return;
      try {
        const r = await fetch("/account/characters", { headers: { "x-account-session": session } });
        if (r.status === 401) {
          try { net.clearSession(); } catch {}
          clearProfile();
          k.go("start");
          return;
        }
        if (r.ok) {
          const incoming = (await r.json()).characters || [];
          if (!allowEmpty && incoming.length === 0 && getCharacters().length > 0) return;
          setServerCharacters(incoming);
          renderList();
        }
      } catch {}
    }

    function drawCard(char, y) {
      const monsters = char.activeMonsters || [];
      const left = rosterCx - cardW / 2;
      const isSel = char.id === selectedId;

      k.add([k.rect(cardW + 36, cardH + 30, { radius: 26 }), k.pos(rosterCx, y + 4), k.anchor("center"),
        k.color(...THEME.primary), k.opacity(isSel ? 0.1 : 0), "charUI"]);
      const halo = k.add([k.rect(cardW + 12, cardH + 12, { radius: 20 }), k.pos(rosterCx, y), k.anchor("center"),
        k.color(...THEME.primary), k.opacity(isSel ? 0.1 : 0), "charUI"]);
      const card = addPanel(k, { x: rosterCx, y, w: cardW, h: cardH, radius: 14, tag: "charUI", area: true,
        fill: isSel ? THEME.surfaceAlt : THEME.surface, border: isSel ? THEME.primary : THEME.line });
      k.add([k.rect(4, Math.max(20, cardH - 26), { radius: 2 }), k.pos(left + 13, y), k.anchor("center"),
        k.color(...THEME.primary), k.opacity(isSel ? 0.95 : 0.35), "charUI"]);

      const portrait = !narrowCard && !compact && monsters.length > 0;
      const textX = portrait ? left + 108 : left + 22;
      if (portrait) {
        const px = left + 60, pr = 31;
        k.add([k.circle(pr + 4), k.pos(px, y), k.anchor("center"), k.color(...THEME.primary), k.opacity(0.22), "charUI"]);
        k.add([k.circle(pr + 2), k.pos(px, y), k.anchor("center"), k.color(...THEME.primary), k.opacity(isSel ? 0.8 : 0.45), "charUI"]);
        k.add([k.circle(pr), k.pos(px, y), k.anchor("center"), k.color(...THEME.bgAlt), "charUI"]);
        slotPortraits.push({ px, y, level: char.level });
        const dividerX = ((left + cardW * 0.42) + (left + cardW * 0.52 + 32 - 23)) / 2;
        k.add([k.rect(1.5, Math.max(20, cardH - 36), { radius: 1 }), k.pos(dividerX, y), k.anchor("center"), k.color(...THEME.line), k.opacity(0.6), "charUI"]);
      }
      card.onClick(() => {
        if (modalUp()) return; sfx("click");
        if (isSel) { k.go("hub", { characterId: char.id }); }
        else { selectedId = char.id; renderList(); }
      });
      card.onHover(() => k.setCursor("pointer"));
      card.onHoverUpdate(() => { halo.opacity = isSel ? 0.18 : 0.12; });
      card.onHoverEnd(() => { halo.opacity = isSel ? 0.1 : 0; });

      const nameY = compact ? y - 11 : narrowCard ? y - 56 : y - 16;
      const lvlY = compact ? y + 11 : narrowCard ? y - 32 : y + 14;
      const statY = narrowCard ? y - 12 : y + 33;
      cl(textX, nameY, char.name, compact ? 20 : 23, THEME.text, "left");
      if (char.isGuest) cl(Math.min(textX + 4 + char.name.length * 13 + 8, narrowCard ? left + cardW - 52 : left + cardW * 0.42), nameY + 1, "guest", 12, THEME.amber, "left");
      const teamTxt = `${monsters.length} monster${monsters.length === 1 ? "" : "s"}`;
      cl(textX, lvlY, portrait ? teamTxt : `Lv ${char.level}     ${teamTxt}`, 14, THEME.textBody, "left");
      const cs = char.stats || {};
      if (!compact && (cs.runs || cs.extractions || cs.caught)) {
        cl(textX, statY, `Caught ${cs.caught || 0}     Escaped ${cs.extractions || 0}     Runs ${cs.runs || 0}`, 11, THEME.textBody, "left");
      }

      const delX = rosterCx + cardW / 2 - 26;
      if (!compact) {
        const slot = 56;
        const thumbY = narrowCard ? y + 42 : y - 4;
        const spriteY = narrowCard ? y + 40 : y - 6;
        const barY = narrowCard ? y + 62 : y + 20;
        const startX = narrowCard ? left + 42 : left + cardW * 0.52 + 32;
        monsters.slice(0, 4).forEach((mon, j) => {
          const mx = startX + j * slot;
          k.add([k.rect(46, 46, { radius: 10 }), k.pos(mx, thumbY), k.anchor("center"), k.color(...THEME.bgAlt), k.outline(1.5, k.rgb(...THEME.line)), "charUI"]);
          k.add([k.rect(38, 7, { radius: 3 }), k.pos(mx, thumbY - 15), k.anchor("center"), k.color(...THEME.surface2), k.opacity(0.4), "charUI"]);
          teamThumbs.push({ cx: mx, cy: spriteY, topY: thumbY - 22, mon });
          let maxHp = mon.currentHealth;
          try { maxHp = getStatsAtLevel(getMonsterType(mon.typeName), mon.level).health; } catch {}
          const frac = maxHp > 0 ? Math.max(0, Math.min(1, (mon.currentHealth ?? maxHp) / maxHp)) : 1;
          const barC = hpColor(frac);
          k.add([k.rect(38, 3, { radius: 1.5 }), k.pos(mx - 19, barY), k.anchor("topleft"), k.color(...THEME.line), "charUI"]);
          if (frac > 0) k.add([k.rect(38 * frac, 3, { radius: 1.5 }), k.pos(mx - 19, barY), k.anchor("topleft"), k.color(...barC), "charUI"]);
        });
      }

      addButton(k, { x: delX, y, w: 28, h: 28, text: "", size: 13, radius: 9,
        fill: THEME.surfaceAlt, textColor: THEME.textMut, glow: THEME.danger,
        tag: "charUI", onClick: () => { if (modalUp()) return; showDeleteConfirm(char); } });
      const delIcon = iconSpriteKey(k, "close", { size: 14, color: THEME.textMut });
      if (delIcon) k.add([k.sprite(delIcon), k.pos(delX, y), k.anchor("center"), k.scale(0.5), "charUI"]);
    }

    renderList();
    syncServerCharacters();

    const moveSel = (dir) => {
      if (modalUp() || characters.length < 2) return;
      const cur = Math.max(0, characters.findIndex((c) => c.id === selectedId));
      selectedId = characters[(cur + dir + characters.length) % characters.length].id;
      sfx("hover"); renderList();
    };
    k.onKeyPress("up", () => moveSel(-1));
    k.onKeyPress("down", () => moveSel(1));
    k.onKeyPress("enter", () => { if (!modalUp()) enterSelected(); });
    let padStickNeutral = true;
    k.onUpdate(() => {
      if (!gamepadConnected()) return;
      const p = gamepadPressed();
      if (p.has(12) || p.has(14)) moveSel(-1);
      if (p.has(13) || p.has(15)) moveSel(1);
      if (p.has(BTN.A) && !modalUp()) enterSelected();
      if (p.has(BTN.B) && !modalUp()) k.go("start");
      const sy = gamepadMove().y;
      if (padStickNeutral && Math.abs(sy) > 0.5) { moveSel(sy < 0 ? -1 : 1); padStickNeutral = false; }
      else if (Math.abs(sy) < 0.3) padStickNeutral = true;
    });

    addButton(k, { x: backX, y: 40 + ins.top, w: backW, h: 36, text: "Back", size: 16, icon: "chevronL",
      fill: THEME.surfaceAlt, textColor: THEME.text, onClick: () => { if (modalUp()) return; k.go("start"); } });

    // Register last so it paints over every other draw.
    let introStart = null;
    k.onDraw(() => {
      if (prefersReducedMotion()) return;
      if (introStart === null) introStart = k.time();
      const a = 1 - Math.min(1, (k.time() - introStart) / 0.35);
      if (a <= 0) return;
      k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: k.rgb(...THEME.bgAlt), opacity: 0.5 * a, fixed: true });
    });

    function showDeleteConfirm(char) {
      confirmOpen = true;
      k.destroyAll("deleteConfirm");
      k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(0, 0, 0), k.opacity(0.55), "deleteConfirm"]);
      const my = k.height() / 2;
      addPanel(k, { x: cx, y: my, w: Math.min(360, k.width() - 24), h: 200, radius: 16, tag: "deleteConfirm" });
      const delNm = char.name.length > 14 ? char.name.slice(0, 13) + "…" : char.name;
      addLabel(k, { x: cx, y: my - 56, text: `Delete "${delNm}"?`, size: 22, color: THEME.text, tag: "deleteConfirm" });
      addLabel(k, { x: cx, y: my - 26, text: "This cannot be undone.", size: 14, color: THEME.textMut, font: FONT_BODY, tag: "deleteConfirm" });
      addButton(k, { x: cx - 80, y: my + 36, w: 140, h: 44, text: "Delete", size: 17,
        fill: THEME.danger, textColor: THEME.textInv, tag: "deleteConfirm",
        onClick: async () => {
          confirmOpen = false;
          k.destroyAll("deleteConfirm");
          const session = getAccountSession();
          if (session && char.serverToken) {
            try { await fetch("/account/characters", { method: "DELETE",
              headers: { "x-account-session": session, "Content-Type": "application/json" },
              body: JSON.stringify({ token: char.serverToken }) }); } catch {}
            await syncServerCharacters({ allowEmpty: true });
          } else { deleteCharacter(char.id); renderList(); }
        } });
      addButton(k, { x: cx + 80, y: my + 36, w: 140, h: 44, text: "Cancel", size: 17,
        fill: THEME.surfaceAlt, textColor: THEME.text, tag: "deleteConfirm",
        onClick: () => { confirmOpen = false; k.destroyAll("deleteConfirm"); } });
    }

    let inputHandlers = [];

    function showNameInput() {
      if (inputActive) return;
      if (getCharacters().length >= maxSlots) return;
      inputActive = true;
      k.destroyAll("nameInput");

      k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(0, 0, 0), k.opacity(0.55), "nameInput"]);
      addPanel(k, { x: cx, y: k.height() / 2 - 5, w: Math.min(380, k.width() - 24), h: 214, radius: 16, tag: "nameInput" });
      addLabel(k, { x: cx, y: k.height() / 2 - 74, text: "Enter character name:", size: 22, color: THEME.text, tag: "nameInput" });

      // Real DOM input: iOS opens the soft keyboard only on an in-gesture focus.
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Character name";
      input.maxLength = 20;
      Object.assign(input.style, {
        position: "fixed", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
        zIndex: "1000", width: "min(70vw, 320px)", padding: "12px 14px", fontSize: "20px",
        textAlign: "center", color: PAL.text, background: PAL.surface,
        border: `2px solid ${PAL.line}`, borderRadius: "8px", outline: "none", fontFamily: "inherit",
      });
      document.body.appendChild(input);
      setTimeout(() => input.focus(), 50);

      const close = () => {
        inputActive = false;
        input.remove();
        inputHandlers.forEach((h) => h.cancel());
        inputHandlers = [];
        k.destroyAll("nameInput");
      };
      const submit = () => { const v = (input.value || "").trim(); if (!v) return; close(); confirmCharacter(v); };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); submit(); }
        else if (e.key === "Escape") { e.preventDefault(); close(); }
      });

      const by = k.height() / 2 + 60;
      addButton(k, { x: cx - 78, y: by, w: 140, h: 44, text: "Confirm", size: 17,
        fill: THEME.primary, textColor: THEME.textInv, tag: "nameInput", onClick: () => submit() });
      addButton(k, { x: cx + 78, y: by, w: 140, h: 44, text: "Cancel", size: 17,
        fill: THEME.surfaceAlt, textColor: THEME.text, tag: "nameInput", onClick: () => close() });

      inputHandlers.forEach((h) => h.cancel());
      inputHandlers = [k.onKeyPress("escape", () => { if (inputActive) close(); })];
      k.onSceneLeave(() => input.remove());
    }

    async function confirmCharacter(name) {
      k.destroyAll("nameInput");
      const session = getAccountSession();
      if (session) {
        try {
          await fetch("/account/characters", { method: "POST",
            headers: { "x-account-session": session, "Content-Type": "application/json" },
            body: JSON.stringify({ name }) });
        } catch {}
        await syncServerCharacters({ allowEmpty: true });
        return;
      }
      createCharacter(name);
      renderList();
    }
  });
}
