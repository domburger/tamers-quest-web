import { THEME, FONT, addMenuBackground, drawButton, drawHeader, inRect } from "../ui/theme.js";
import { safeInsetsDesign } from "../systems/safearea.js"; // MOB: Back off the notch
import { CHAIN_SKINS, RARITY_COLOR, drawChainSkin, getEquippedSkinId, setEquippedSkinId } from "../render/chainCosmetics.js";
import { CHARACTER_SKINS, getEquippedCharacterSkinId, setEquippedCharacterSkinId } from "../render/characterCosmetics.js";
import { drawCharacter } from "../render/character.js";
import { prefersReducedMotion } from "../systems/a11y.js"; // a11y: freeze store-preview animation under Reduce Motion
import { isSkinOwned, acquireLabel, buySkin, skinAcquire } from "../engine/cosmetics.js"; // CN-9 ownership/economy
import { net } from "../netClient.js";
import { getCharacter, saveCharacter } from "../storage.js";
import { sfx } from "../systems/audio.js"; // equip confirm chime (cards are immediate-mode, not addButton)

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

    let tab = "chains"; // "chains" | "character"
    const list = () => (tab === "chains" ? CHAIN_SKINS : CHARACTER_SKINS);
    // Scroll state so tall lists / narrow viewports can reach every card (audit MED:
    // 7-8 skins × 230px cards overflow on phones; was non-scrolling).
    let scrollY = 0;
    const contentH = () => Math.ceil(list().length / cols()) * (CARD_H + GAP) + GAP;
    const viewportH = () => k.height() - (HEADER + TAB_H + 24);
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

    const cols = () => Math.max(1, Math.min(list().length, Math.floor((k.width() - GAP) / (CARD_W + GAP))));
    const gridX0 = () => (k.width() - (cols() * CARD_W + (cols() - 1) * GAP)) / 2;
    const gridY0 = () => HEADER + TAB_H + 24;
    const cardPos = (i) => { const c = cols(); return [gridX0() + (i % c) * (CARD_W + GAP), gridY0() + Math.floor(i / c) * (CARD_H + GAP) - scrollY]; };
    const ins = safeInsetsDesign(k); // MOB: Back off the notch/rounded corner
    const backRect = () => [k.width() - 96 - ins.right, 16 + ins.top, 78, 36];

    // Tab buttons (left-aligned under the header). Tab width is responsive so BOTH tabs fit
    // on narrow screens (the fixed 186px ones ran the "Player Character" tab off the right edge).
    const TABS = [["chains", "Spirit Chains"], ["character", "Player Character"]];
    const tabW = () => Math.min(186, (k.width() - 50) / 2);
    const tabRect = (i) => [20 + i * (tabW() + 10), TAB_Y, tabW(), TAB_H];

    addMenuBackground(k, { fixed: true, z: -10 });

    // `badge` (optional): "EQUIPPED" (teal) or "OWNED" (muted) corner label, so a
    // purchased-but-unequipped earned skin is distinguishable from a free one (CN-9).
    function drawChainCard(s, x, y, now, i, isEq, badge) {
      const rc = RARITY_COLOR[s.rarity] || THEME.neutral;
      k.drawRect({ pos: k.vec2(x, y), width: CARD_W, height: CARD_H, radius: 14,
        color: isEq ? T("surface2") : T("surface"), outline: { width: isEq ? 2 : 1, color: isEq ? T("teal") : k.rgb(rc[0], rc[1], rc[2]) } });
      // Top sheen — gives the card the "raised surface" feel that addPanel grants
      // retained-mode panels (audit: MP cards looked a tier flatter than SP ones).
      k.drawRect({ pos: k.vec2(x + 6, y + 4), width: CARD_W - 12, height: 18, radius: 9, color: T("surface2"), opacity: 0.45 });
      // Soft accent glow behind the chain ring (mirrors drawCharacterCard's halo),
      // tinted by the chain's own ring color so each skin reads at a glance instead
      // of as a row of dark cards.
      const ac = (s.ring) || (s.color) || THEME.teal;
      [[44, 0.09], [30, 0.14], [18, 0.20]].forEach(([r, o]) =>
        k.drawCircle({ pos: k.vec2(x + CARD_W / 2, y + 84), radius: r, color: k.rgb(ac[0], ac[1], ac[2]), opacity: o }));
      drawChainSkin(k, { x: x + CARD_W / 2, y: y + 84, r: 44, t: now + i, skin: s });
      k.drawText({ text: s.name, pos: k.vec2(x + CARD_W / 2, y + CARD_H - 54), size: 16, font: FONT, anchor: "center", color: T("text") });
      k.drawText({ text: s.rarity, pos: k.vec2(x + CARD_W / 2, y + CARD_H - 32), size: 12, font: FONT, anchor: "center", color: k.rgb(rc[0], rc[1], rc[2]) });
      if (badge) k.drawText({ text: badge, pos: k.vec2(x + CARD_W / 2, y + 16), size: 11, font: FONT, anchor: "center", color: badge === "EQUIPPED" ? T("teal") : T("textMut") });
    }

    function drawCharacterCard(s, x, y, now, i, isEq, badge) {
      const rc = RARITY_COLOR[s.rarity] || THEME.neutral;
      k.drawRect({ pos: k.vec2(x, y), width: CARD_W, height: CARD_H, radius: 14,
        color: isEq ? T("surface2") : T("surface"), outline: { width: isEq ? 2 : 1, color: isEq ? T("teal") : k.rgb(rc[0], rc[1], rc[2]) } });
      // Top sheen — addPanel parity (audit: MP cards looked flatter than SP).
      k.drawRect({ pos: k.vec2(x + 6, y + 4), width: CARD_W - 12, height: 18, radius: 9, color: T("surface2"), opacity: 0.45 });
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
      if (badge) k.drawText({ text: badge, pos: k.vec2(x + CARD_W / 2, y + 16), size: 11, font: FONT, anchor: "center", color: badge === "EQUIPPED" ? T("teal") : T("textMut") });
    }

    // CN-9: un-owned earned skins get a dim veil + a price/lock pill so the store
    // reads as a real shop. Owned/free cards are untouched.
    function drawLock(s, x, y) {
      k.drawRect({ pos: k.vec2(x, y), width: CARD_W, height: CARD_H, radius: 14, color: T("bg"), opacity: 0.5 });
      const locked = skinAcquire(s).kind === "unlock";
      k.drawRect({ pos: k.vec2(x + CARD_W / 2, y + 24), width: 96, height: 26, radius: 13, anchor: "center", color: T("surface2"), outline: { width: 1.5, color: locked ? T("textMut") : T("amber") } });
      k.drawText({ text: acquireLabel(s), pos: k.vec2(x + CARD_W / 2, y + 24), size: 13, font: FONT, anchor: "center", color: locked ? T("textMut") : T("amber") });
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
        const badge = isEq ? "EQUIPPED" : (isOwn && skinAcquire(s).kind !== "free" ? "OWNED" : null);
        if (tab === "chains") drawChainCard(s, x, y, now, i, isEq, badge);
        else drawCharacterCard(s, x, y, now, i, isEq, badge);
        if (!isOwn) drawLock(s, x, y);
      }

      // Header + tab bar + back.
      const hmp = k.mousePos(); // pointer for header button hover glow
      k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: HEADER + TAB_H + 16, color: T("bg"), fixed: true });
      drawHeader(k, { title: "COSMETICS", ruleW: 140 }); // standardized title + teal accent rule
      // Wallet (color-coded gold amber / essence teal) so prices read in context. On narrow
      // the centred currency collided with the left title + right Back button, so it drops to
      // a left-aligned row just under the title (still within the header band, above the tabs).
      const w = wallet();
      if (k.width() < 480) {
        // y=58 clears the title's underline rule (≈y44-50) above and the tab row (y72) below.
        k.drawText({ text: `${w.gold} gold`, pos: k.vec2(20, 58), size: 13, font: FONT, anchor: "left", color: T("amber"), fixed: true });
        k.drawText({ text: `${w.essence} essence`, pos: k.vec2(132, 58), size: 13, font: FONT, anchor: "left", color: T("teal"), fixed: true });
      } else {
        k.drawText({ text: `${w.gold} gold`, pos: k.vec2(k.width() / 2 - 12, 22), size: 14, font: FONT, anchor: "right", color: T("amber"), fixed: true });
        k.drawText({ text: `${w.essence} essence`, pos: k.vec2(k.width() / 2 + 12, 22), size: 14, font: FONT, anchor: "left", color: T("teal"), fixed: true });
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
      k.drawRect({ pos: k.vec2(0, HEADER + TAB_H + 15), width: k.width(), height: 1, color: T("line"), fixed: true });
      const br = backRect();
      drawButton(k, { rect: br, text: "Back", size: 16, fill: THEME.surface, textColor: THEME.text, outline: THEME.line, hover: inRect(hmp, br), fixed: true });

      // Scrollbar indicator (mirrors bestiary): only shown when content exceeds the
      // viewport, so on landscape with everything visible it draws nothing.
      const ms = maxScroll();
      if (ms > 0) {
        const trackTop = HEADER + TAB_H + 16, trackH = k.height() - trackTop;
        const thumbH = Math.max(30, (trackH * trackH) / contentH());
        const thumbY = trackTop + (scrollY / ms) * (trackH - thumbH);
        k.drawRect({ pos: k.vec2(k.width() - 7, thumbY), width: 5, height: thumbH, radius: 3, color: T("textMut"), fixed: true });
      }

      // CN-9 MP buy result: when a new server cosmetic reply arrives, toast the
      // outcome (the card re-renders as owned from net.state.ownedCosmetics; tap it
      // again to equip). One-shot per reply via the timestamp.
      const lc = net.state && net.state.lastCosmetic;
      if (lc && lc.at && lc.at !== lastSeenCosmeticAt) {
        lastSeenCosmeticAt = lc.at;
        showToast(lc.ok ? "Purchased!"
          : lc.reason === "essence" ? "Not enough essence."
          : lc.reason === "gold" ? "Not enough gold." : "Can't buy that.");
      }

      if (toastT > 0) {
        toastT -= k.dt();
        const tw = Math.min(k.width() - 40, 13 * toast.length + 36);
        k.drawRect({ pos: k.vec2(k.width() / 2, k.height() - 36), width: tw, height: 30, radius: 8, anchor: "center", color: T("surface"), outline: { width: 1, color: T("line") }, fixed: true });
        k.drawText({ text: toast, pos: k.vec2(k.width() / 2, k.height() - 36), size: 13, font: FONT, anchor: "center", color: T("text"), fixed: true });
      }
    });

    const cardAt = (p) => {
      const items = list();
      for (let i = 0; i < items.length; i++) {
        const [x, y] = cardPos(i);
        if (p.x >= x && p.x <= x + CARD_W && p.y >= y && p.y <= y + CARD_H) return i;
      }
      return -1;
    };
    const onTap = (p) => {
      if (inRect(p, backRect())) { k.go(backScene, backArgs); return; }
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
      sfx("click"); // confirm the equip (was silent — only the card highlight changed)
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
