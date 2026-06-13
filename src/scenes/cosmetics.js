import { THEME, FONT, addMenuBackground, drawButton, drawPanel, drawHeader, drawScrollbar, drawToast, drawCurrency, fmtCurrency, inRect } from "../ui/theme.js";
import { safeInsetsDesign } from "../systems/safearea.js"; // MOB: Back off the notch
import { CHAIN_SKINS, RARITY_COLOR, drawChainSkin, getEquippedSkinId, setEquippedSkinId } from "../render/chainCosmetics.js";
import { CHARACTER_SKINS, getEquippedCharacterSkinId, setEquippedCharacterSkinId } from "../render/characterCosmetics.js";
import { drawCharacter } from "../render/character.js";
import { prefersReducedMotion } from "../systems/a11y.js"; // a11y: freeze store-preview animation under Reduce Motion
import { isSkinOwned, acquireLabel, buySkin, skinAcquire } from "../engine/cosmetics.js"; // CN-9 ownership/economy
import { net } from "../netClient.js";
import { getCharacter, saveCharacter } from "../storage.js";
import { sfx, haptic } from "../systems/audio.js"; // equip confirm chime + tactile buzz (cards are immediate-mode, not addButton)

// Cosmetics store — two tabs: Spirit Chains (chain-ring skins) and Player
// Character (accent + cloak skins). Visual only; equip is per-client. Drawn in
// onDraw so the animated chains / character layer cleanly over the cards.
export default function cosmeticsScene(k) {
  k.scene("cosmetics", (args = {}) => {
    const backScene = args.backScene || "start";
    const backArgs = args.backArgs || {};
    const T = (n) => k.rgb(...THEME[n]);
    const HEADER = 64, CARD_W = 230, CARD_H = 210, GAP = 18;
    const TAB_Y = HEADER + 8, TAB_H = 34;
    // TQ-140: a prominent wallet pill. Wide screens fit it in the top row (left of Back); narrow
    // screens have no room there (title + Back fill the top row), so they get a dedicated wallet row
    // under the tabs — WALLET_ROW adds that height, and the content/scroll geometry shifts down by it.
    const WALLET_ROW = () => (k.width() < 480 ? 36 : 0);
    const headerBot = () => HEADER + TAB_H + 16 + WALLET_ROW(); // bottom of the fixed header band

    let tab = "chains"; // "chains" | "character"
    const list = () => (tab === "chains" ? CHAIN_SKINS : CHARACTER_SKINS);
    // Scroll state so tall lists / narrow viewports can reach every card (audit MED:
    // 7-8 skins × 230px cards overflow on phones; was non-scrolling).
    let scrollY = 0;
    const contentH = () => Math.ceil(list().length / cols()) * (CARD_H + GAP) + GAP;
    const viewportH = () => k.height() - (headerBot() + 8);
    const maxScroll = () => Math.max(0, contentH() - viewportH());
    const clampScroll = () => { scrollY = Math.min(maxScroll(), Math.max(0, scrollY)); };

    // CN-9 economy context. SP: the character (gold/essence + owned set, persisted
    // to localStorage). MP: the connected session's wallet; online purchases need a
    // server handler (follow-up) — until then earned skins show as locked online.
    const character = backArgs.characterId ? getCharacter(backArgs.characterId) : null;
    const key = () => (tab === "chains" ? "chain" : "char");
    const ownedList = () => {
      if (character) return (character.cosmetics && character.cosmetics[key()]) || [];
      return (net.state && net.state.ownedCosmetics && net.state.ownedCosmetics[key()]) || [];
    };
    const wallet = () => (character
      ? { gold: character.gold || 0, essence: character.essence || 0 }
      : { gold: (net.state && net.state.gold) || 0, essence: (net.state && net.state.essence) || 0 });
    let toast = "", toastT = 0;
    const showToast = (s) => { toast = s; toastT = 2.0; };
    // Track the last cosmetic-reply we've turned into a toast, so the update loop can
    // react to a new server result exactly once (CN-9 MP buy is async).
    let lastSeenCosmeticAt = (net.state && net.state.lastCosmetic && net.state.lastCosmetic.at) || 0;
    // Buy a skin. SP: deduct/grant/persist locally, returns true (caller equips now).
    // MP: fire a server-authoritative purchase (the reply lands async — the update
    // loop toasts the outcome; the now-owned card can then be tapped to equip).
    const tryBuy = (s) => {
      if (!character) {
        net.buyCosmetic(key(), s.id); // CN-9: server validates price + grants ownership
        showToast("Purchasing…");
        return false;
      }
      const r = buySkin(s, wallet(), ownedList());
      if (!r.ok) { showToast(r.reason === "essence" ? "Not enough essence." : r.reason === "gold" ? "Not enough gold." : "Can't buy that."); return false; }
      character.gold = r.gold; character.essence = r.essence;
      character.cosmetics = character.cosmetics || {};
      character.cosmetics[key()] = r.owned;
      saveCharacter(character);
      showToast("Purchased!");
      return true;
    };

    // TQ-100: on wide screens reserve a left panel for a big LIVE character preview; the card grid
    // fills the width that's left. Narrow/portrait keeps the original full-width grid (no room for it),
    // so mobile is unchanged. cols()/gridX0() key off the grid's available width so cardPos + cardAt
    // (hit-testing) stay consistent with the reserved gutter.
    const PREVIEW_W = 250;
    const previewShown = () => k.width() >= 900;
    const gridLeft = () => (previewShown() ? PREVIEW_W + 24 : 0);
    const gridAvailW = () => k.width() - gridLeft();
    const cols = () => Math.max(1, Math.min(list().length, Math.floor((gridAvailW() - GAP) / (CARD_W + GAP))));
    const gridX0 = () => gridLeft() + (gridAvailW() - (cols() * CARD_W + (cols() - 1) * GAP)) / 2;
    const gridY0 = () => headerBot() + 8;
    const cardPos = (i) => { const c = cols(); return [gridX0() + (i % c) * (CARD_W + GAP), gridY0() + Math.floor(i / c) * (CARD_H + GAP) - scrollY]; };
    const ins = safeInsetsDesign(k); // MOB: Back off the notch/rounded corner
    const backRect = () => [k.width() - 96 - ins.right, 16 + ins.top, 78, 36];
    // TQ-141: wallet-pill geometry, shared by the draw + the Buy-Essence "+" hit-test so the button
    // stays flush with the pill on both the wide (top-right) and narrow (own row) layouts.
    const walletPillRect = () => {
      const w = wallet();
      const items = [{ kind: "gold", value: w.gold }, { kind: "essence", value: w.essence }].filter((it) => it.value != null);
      const SZ = 16, PIP = 5, CGAP = 18, chW = SZ * 0.6, padX = 14, pillH = 34;
      const contentW = items.reduce((s, it) => s + PIP * 2 + 6 + fmtCurrency(it.value).length * chW, 0) + CGAP * Math.max(0, items.length - 1);
      const pillW = contentW + padX * 2;
      const narrow = k.width() < 480;
      const rightEdge = narrow ? (k.width() - 20 - ins.right) : (backRect()[0] - 12);
      const cy = narrow ? (HEADER + TAB_H + 16 + WALLET_ROW() / 2) : (16 + ins.top + 18);
      return [rightEdge - pillW, cy - pillH / 2, pillW, pillH];
    };
    // A round "+" just left of the wallet pill → opens the Essence store (/pricing). TQ-141.
    const buyEssenceRect = () => { const [px, py, , ph] = walletPillRect(); return [px - ph - 8, py, ph, ph]; };

    // Tab buttons (left-aligned under the header). Tab width is responsive so BOTH tabs fit
    // on narrow screens (the fixed 186px ones ran the "Player Character" tab off the right edge).
    const TABS = [["chains", "Spirit Chains"], ["character", "Player Character"]];
    const tabW = () => Math.min(186, (k.width() - 50) / 2);
    const tabRect = (i) => [20 + i * (tabW() + 10), TAB_Y, tabW(), TAB_H];

    addMenuBackground(k, { fixed: true, z: -10 });

    // `badge` (optional): "Equipped" (teal) or "Owned" (muted) corner label, so a
    // purchased-but-unequipped earned skin is distinguishable from a free one (CN-9).
    function drawChainCard(s, x, y, now, i, isEq, badge) {
      const rc = RARITY_COLOR[s.rarity] || THEME.neutral;
      // Card background via the SHARED drawPanel (shadow + sheen + specular rim) so grid cards
      // read as the same raised surface as panels/buttons — was a hand-rolled rect + flat sheen
      // (a tier flatter, no shadow/rim). Keep the 1px rarity hairline (2px equipped) via borderW.
      drawPanel(k, { rect: [x, y, CARD_W, CARD_H], radius: 14,
        fill: isEq ? THEME.surface2 : THEME.surface, border: isEq ? THEME.teal : rc, borderW: isEq ? 2 : 1 });
      // Soft accent glow behind the chain ring (mirrors drawCharacterCard's halo),
      // tinted by the chain's own ring color so each skin reads at a glance instead
      // of as a row of dark cards.
      const ac = (s.ring) || (s.color) || THEME.teal;
      [[44, 0.09], [30, 0.14], [18, 0.20]].forEach(([r, o]) =>
        k.drawCircle({ pos: k.vec2(x + CARD_W / 2, y + 84), radius: r, color: k.rgb(ac[0], ac[1], ac[2]), opacity: o }));
      drawChainSkin(k, { x: x + CARD_W / 2, y: y + 84, r: 44, t: now + i, skin: s });
      k.drawText({ text: s.name, pos: k.vec2(x + CARD_W / 2, y + CARD_H - 54), size: 16, font: FONT, anchor: "center", color: T("text") });
      k.drawText({ text: s.rarity, pos: k.vec2(x + CARD_W / 2, y + CARD_H - 32), size: 12, font: FONT, anchor: "center", color: k.rgb(rc[0], rc[1], rc[2]) });
      if (badge) k.drawText({ text: badge, pos: k.vec2(x + CARD_W / 2, y + 16), size: 11, font: FONT, anchor: "center", color: badge === "Equipped" ? T("teal") : T("textMut") });
    }

    function drawCharacterCard(s, x, y, now, i, isEq, badge) {
      const rc = RARITY_COLOR[s.rarity] || THEME.neutral;
      // Card background via the SHARED drawPanel (shadow + sheen + specular rim) — raised-surface
      // parity with panels/buttons (was a hand-rolled rect + flat sheen). 1px rarity hairline (2px
      // equipped) preserved via borderW.
      drawPanel(k, { rect: [x, y, CARD_W, CARD_H], radius: 14,
        fill: isEq ? THEME.surface2 : THEME.surface, border: isEq ? THEME.teal : rc, borderW: isEq ? 2 : 1 });
      // CN-12b: soft accent glow behind the preview (mirrors the lobby turntable) —
      // fills the card's upper space and tints each skin by its accent, so the
      // roster reads at a glance instead of seven near-identical dark figures.
      const ac = s.accent || THEME.teal;
      const gy = y + 106;
      [[50, 0.09], [35, 0.14], [22, 0.20]].forEach(([r, o]) =>
        k.drawCircle({ pos: k.vec2(x + CARD_W / 2, gy), radius: r, color: k.rgb(ac[0], ac[1], ac[2]), opacity: o }));
      // Live character preview (facing the camera so the accent eyes/rim read).
      drawCharacter(k, { x: x + CARD_W / 2, y: y + 118, t: now + i, moving: false, color: s.accent, cloak: s.cloak, model: s.model, dir: { x: 0, y: 1 } });
      k.drawText({ text: s.name, pos: k.vec2(x + CARD_W / 2, y + CARD_H - 54), size: 16, font: FONT, anchor: "center", color: T("text") });
      k.drawText({ text: s.rarity, pos: k.vec2(x + CARD_W / 2, y + CARD_H - 32), size: 12, font: FONT, anchor: "center", color: k.rgb(rc[0], rc[1], rc[2]) });
      if (badge) k.drawText({ text: badge, pos: k.vec2(x + CARD_W / 2, y + 16), size: 11, font: FONT, anchor: "center", color: badge === "Equipped" ? T("teal") : T("textMut") });
    }

    // CN-9: un-owned earned skins get a dim veil + a price/lock pill so the store
    // reads as a real shop. Owned/free cards are untouched.
    function drawLock(s, x, y) {
      k.drawRect({ pos: k.vec2(x, y), width: CARD_W, height: CARD_H, radius: 14, color: T("bg"), opacity: 0.5 });
      const locked = skinAcquire(s).kind === "unlock";
      k.drawRect({ pos: k.vec2(x + CARD_W / 2, y + 24), width: 96, height: 26, radius: 13, anchor: "center", color: T("surface2"), outline: { width: 1.5, color: locked ? T("textMut") : T("amber") } });
      k.drawText({ text: acquireLabel(s), pos: k.vec2(x + CARD_W / 2, y + 24), size: 13, font: FONT, anchor: "center", color: locked ? T("textMut") : T("amber") });
    }

    // TQ-100: big LIVE character preview in the reserved left panel. Shows the player character with
    // the EQUIPPED character + chain skins, but swaps in whichever card you're HOVERING (for the active
    // tab) so you see a skin before committing. Facing the player (dir {0,1}) like the lobby/charselect.
    function drawBigPreview(now, hov) {
      if (!previewShown()) return;
      const x0 = 12, top = gridY0(), pw = PREVIEW_W, ph = k.height() - top - 16;
      drawPanel(k, { rect: [x0, top, pw, ph], radius: 14, fill: THEME.surface, border: THEME.line, borderW: 1 });
      const cx = x0 + pw / 2;
      const eqCharId = getEquippedCharacterSkinId(), eqChainId = getEquippedSkinId();
      const eqChar = CHARACTER_SKINS.find((s) => s.id === eqCharId) || CHARACTER_SKINS[0];
      const eqChain = CHAIN_SKINS.find((s) => s.id === eqChainId) || CHAIN_SKINS[0];
      const charSkin = (tab === "character" && hov) ? hov : eqChar;
      const chainSkin = (tab === "chains" && hov) ? hov : eqChain;
      const fy = top + Math.min(ph * 0.56, 360); // feet/ground point — keep the figure in the panel's upper half
      // Backlight bloom + glowing podium (same language as the character-select hero).
      const ac = charSkin.accent || THEME.teal;
      for (let i = 7; i >= 1; i--) k.drawCircle({ pos: k.vec2(cx, fy - 70), radius: i * 13, color: k.rgb(ac[0], ac[1], ac[2]), opacity: 0.016 });
      k.drawEllipse({ pos: k.vec2(cx, fy + 10), radiusX: 52, radiusY: 14, color: k.rgb(0, 0, 0), opacity: 0.4 });
      k.drawEllipse({ pos: k.vec2(cx, fy + 8), radiusX: 48, radiusY: 12, fill: false, outline: { width: 1.5, color: T("teal") }, opacity: 0.5 });
      drawCharacter(k, { x: cx, y: fy, t: now, moving: false, dir: { x: 0, y: 1 }, scale: 2.8, color: charSkin.accent, cloak: charSkin.cloak, model: charSkin.model, skin: chainSkin });
      k.drawText({ text: "Preview", pos: k.vec2(cx, top + 18), size: 12, font: FONT, anchor: "center", color: T("teal") });
      const previewed = tab === "character" ? charSkin : chainSkin;
      k.drawText({ text: previewed.name || "", pos: k.vec2(cx, fy + 46), size: 17, font: FONT, anchor: "center", color: T("text"), width: pw - 24 });
      const isEqPrev = tab === "character" ? (charSkin.id === eqCharId) : (chainSkin.id === eqChainId);
      k.drawText({ text: isEqPrev ? "Equipped" : "Tap a card to equip", pos: k.vec2(cx, fy + 70), size: 12, font: FONT, anchor: "center", color: isEqPrev ? T("teal") : T("textMut") });
    }

    k.onDraw(() => {
      const now = prefersReducedMotion() ? 0 : k.time(); // a11y: freeze preview pulse/spin/bob under Reduce Motion
      const items = list();
      const equipped = tab === "chains" ? getEquippedSkinId() : getEquippedCharacterSkinId();
      const owned = ownedList();
      // Cursor hover affordance — mirrors bestiary/roster's hover-glow pattern so
      // desktop users get feedback when a card is targeted (audit MED: cosmetics
      // had no hover indicator; tap-only).
      const hovIdx = cardAt(k.mousePos());
      for (let i = 0; i < items.length; i++) {
        const s = items[i];
        const [x, y] = cardPos(i);
        const isEq = s.id === equipped;
        const isOwn = isSkinOwned(s, owned);
        // Soft teal halo behind the hovered card.
        if (i === hovIdx) {
          k.drawRect({ pos: k.vec2(x - 4, y - 4), width: CARD_W + 8, height: CARD_H + 8, radius: 18, color: T("teal"), opacity: 0.22 });
        }
        const badge = isEq ? "Equipped" : (isOwn && skinAcquire(s).kind !== "free" ? "Owned" : null);
        if (tab === "chains") drawChainCard(s, x, y, now, i, isEq, badge);
        else drawCharacterCard(s, x, y, now, i, isEq, badge);
        if (!isOwn) drawLock(s, x, y);
      }
      // TQ-100: big live preview in the reserved left gutter (wide screens), tracking the hovered card.
      drawBigPreview(now, hovIdx >= 0 ? items[hovIdx] : null);

      // Header + tab bar + back.
      const hmp = k.mousePos(); // pointer for header button hover glow
      k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: headerBot(), color: T("bg"), fixed: true });
      drawHeader(k, { title: "Cosmetics", ruleW: 140 }); // standardized title + teal accent rule
      // TQ-140: a prominent WALLET PILL (was a tiny size-13/14 readout tucked at the top). Gold
      // (earned) + essence (premium/paid) — the only two currencies (TQ-132). A rounded panel chip with the shared
      // currency component (TQ-98) at size 16 so it's clearly legible. Placed top-right (left of
      // Back) on wide; in its own dedicated row under the tabs on narrow (where the top row is full).
      const w = wallet();
      const walletItems = [{ kind: "gold", value: w.gold }, { kind: "essence", value: w.essence }].filter((it) => it.value != null);
      {
        const SZ = 16, PIP = 5, CGAP = 18, padX = 14;
        const [px, py, pillW, pillH] = walletPillRect();
        const cy = py + pillH / 2;
        drawPanel(k, { rect: [px, py, pillW, pillH], radius: pillH / 2, fill: THEME.surfaceAlt, border: THEME.line, borderW: 1, fixed: true });
        drawCurrency(k, { x: px + padX, y: cy, anchor: "left", size: SZ, pip: PIP, gap: CGAP, items: walletItems });
        // TQ-141: a "+" next to the wallet opens the Essence store (/pricing) so players can top up
        // premium currency where they spend it. New tab (same pattern as the hub "Get Essence" entry).
        const ber = buyEssenceRect();
        drawButton(k, { rect: ber, text: "+", size: 22, radius: ber[3] / 2, fill: THEME.primary, textColor: THEME.textInv, outline: THEME.primary, hover: inRect(hmp, ber), fixed: true });
      }
      for (let i = 0; i < TABS.length; i++) {
        const [id, label] = TABS[i];
        const r = tabRect(i);
        const on = tab === id;
        // Standardized tab: selected = primary fill + dark ink (the title CTA look); others neutral.
        drawButton(k, { rect: r, text: label, size: 14, fill: on ? THEME.primary : THEME.surfaceAlt,
          textColor: on ? THEME.textInv : THEME.text, outline: on ? THEME.primary : THEME.line,
          hover: inRect(hmp, r), fixed: true });
      }
      k.drawRect({ pos: k.vec2(0, headerBot() - 1), width: k.width(), height: 1, color: T("line"), fixed: true });
      const br = backRect();
      drawButton(k, { rect: br, text: "Back", size: 16, fill: THEME.surfaceAlt, textColor: THEME.text, outline: THEME.line, hover: inRect(hmp, br), fixed: true });

      // Scrollbar indicator (mirrors bestiary): only shown when content exceeds the
      // viewport, so on landscape with everything visible it draws nothing.
      const ms = maxScroll();
      if (ms > 0) {
        const trackTop = headerBot();
        drawScrollbar(k, { top: trackTop, trackH: k.height() - trackTop, contentH: contentH(), scrollY, maxScroll: ms });
      }

      // CN-9 MP buy result: when a new server cosmetic reply arrives, toast the
      // outcome (the card re-renders as owned from net.state.ownedCosmetics; tap it
      // again to equip). One-shot per reply via the timestamp.
      const lc = net.state && net.state.lastCosmetic;
      if (lc && lc.at && lc.at !== lastSeenCosmeticAt) {
        lastSeenCosmeticAt = lc.at;
        showToast(lc.ok ? "Purchased!"
          : lc.reason === "essence" ? "Not enough Essence."
          : lc.reason === "gold" ? "Not enough gold." : "Can't buy that.");
      }

      if (toastT > 0) { toastT -= k.dt(); drawToast(k, { text: toast, t: toastT }); }
    });

    const cardAt = (p) => {
      if (p.y < gridY0()) return -1; // ignore taps in the header/tab band — cards scrolled UNDER it are hidden but still hit-testable
      const items = list();
      for (let i = 0; i < items.length; i++) {
        const [x, y] = cardPos(i);
        if (p.x >= x && p.x <= x + CARD_W && p.y >= y && p.y <= y + CARD_H) return i;
      }
      return -1;
    };
    const onTap = (p) => {
      if (inRect(p, backRect())) { sfx("click"); k.go(backScene, backArgs); return; }
      // TQ-141: "+" → open the Essence store (/pricing) in a new tab so the run/session is kept.
      if (inRect(p, buyEssenceRect())) { sfx("click"); try { window.open("/pricing", "_blank", "noopener"); } catch { /* popup blocked — no-op */ } return; }
      for (let i = 0; i < TABS.length; i++) {
        if (inRect(p, tabRect(i))) { if (tab !== TABS[i][0]) sfx("click"); tab = TABS[i][0]; scrollY = 0; return; } // reset scroll on tab switch (click on change)
      }
      const i = cardAt(p);
      if (i < 0) return;
      const s = list()[i];
      // CN-9: equip if owned; otherwise try to buy (earned skins). Unlock-type
      // skins aren't purchasable — report how to get them.
      const wasOwned = isSkinOwned(s, ownedList());
      if (!wasOwned) {
        if (skinAcquire(s).kind === "unlock") { showToast(skinAcquire(s).note || "Locked."); return; }
        if (!tryBuy(s)) return; // buy failed (poor / online) — toast already shown
      }
      if (tab === "chains") setEquippedSkinId(s.id);
      else setEquippedCharacterSkinId(s.id);
      haptic(8); sfx("click"); // confirm the equip/buy (tactile + audible; was silent)
      if (wasOwned) showToast(`Equipped ${s.name}`); // pure equip; the buy path keeps its "Bought" toast
    };
    // Touch-drag detection (tap vs scroll) — only treat as a tap if barely moved,
    // so a flick-to-scroll on mobile doesn't accidentally equip/buy a card.
    let dragging = false, lastY = 0, moved = 0, pressedAt = null;
    const press = (p) => { dragging = true; lastY = p.y; moved = 0; pressedAt = p; };
    const drag = (p) => { if (!dragging) return; const dy = p.y - lastY; scrollY -= dy; moved += Math.abs(dy); lastY = p.y; clampScroll(); };
    const release = (p) => { if (!dragging) return; dragging = false; if (moved < 6 && pressedAt) onTap(pressedAt); pressedAt = null; };
    k.onMousePress(() => press(k.mousePos()));
    k.onMouseMove(() => drag(k.mousePos()));
    k.onMouseRelease(() => release(k.mousePos()));
    k.onTouchStart((p) => press(p));
    k.onTouchMove((p) => drag(p));
    k.onTouchEnd((p) => release(p));
    // Wheel scroll (desktop), Arrow keys (keyboard) — mirrors the bestiary pattern.
    if (typeof k.onScroll === "function") k.onScroll((d) => { scrollY += d.y; clampScroll(); });
    k.onKeyDown("down", () => { scrollY += 700 * k.dt(); clampScroll(); });
    k.onKeyDown("up", () => { scrollY -= 700 * k.dt(); clampScroll(); });
    k.onKeyPress("escape", () => k.go(backScene, backArgs));
  });
}
