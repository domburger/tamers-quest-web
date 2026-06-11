import { net } from "../netClient.js";
import { getSpiritChains } from "../engine/gamedata.js";
import { upgradeTargetFor, upgradeCost } from "../engine/schemas.js";
import { chainColor } from "../render/spiritchain.js";
import { THEME, FONT, addMenuBackground, drawButton, drawPanel, drawHeader, drawScrollbar, drawToast, inRect } from "../ui/theme.js";
import { sfx, haptic } from "../systems/audio.js"; // buy/craft confirm chime + tactile buzz (immediate-mode scene: no addButton feedback)
import { safeInsetsDesign } from "../systems/safearea.js"; // MOB: keep Back off the notch (parity with cosmetics/bestiary/base-upgrades)

// Online Spirit Shop (P-chains): spend gold earned in runs on spirit chains.
// Server-authoritative — the client sends "buyChain" and the server validates
// (idle-only, gold check), grants the chain, and echoes a "shop" message that
// syncs gold + inventory. Mirrors the single-player shop (scenes/shop.js) using
// the dark-flat design system + the immediate-mode draw/hit-test idiom (roster.js).
export default function onlineShopScene(k) {
  k.scene("onlineShop", (args = {}) => {
    const col = (t) => k.rgb(...t);
    const TOUCH = typeof k.isTouchscreen === "function" ? k.isTouchscreen() : false; // desktop-only row hover (no stuck-glow after a tap on touch)
    const chains = getSpiritChains();
    const SPECIAL_TAG = { endless: "∞ throws", guaranteed: "sure catch", multi: "multi-catch" }; // concise special meaning (parity with SP shop / roster)

    const HEADER = 56;
    const GAP = 8;
    const listW = () => Math.min(560, k.width() - 40);
    const listX0 = () => (k.width() - listW()) / 2;
    // Narrow (mobile portrait): a card can't fit the name/price text AND two action buttons
    // side-by-side (the text got clamped to ~60px and wrapped over the buttons). So rows grow
    // taller and the Up/Buy buttons drop to a row UNDER the full-width text. The header also
    // can't fit title + currency + Back on one row, so the currency/subtitle drop below the
    // bar and the list starts lower.
    const narrow = () => listW() < 430;
    // The currency row drops below the header bar when the screen is narrow OR the totals are
    // too long to fit between the title and the Back button in the top row — big balances
    // (5–7 digits) used to overlap the left-aligned title at mid widths. ~8.5px/char at size 15.
    const currencyBelow = () => narrow() || (String(net.state.gold || 0).length + String(net.state.essence || 0).length + 13) * 8.5 + 24 > k.width() - 300;
    const ROW_H = () => (narrow() ? 80 : 48);
    const LIST_TOP = () => HEADER + (currencyBelow() ? 72 : 24);
    // Scroll state: 8 chains in narrow (tall-row) mode overflow the fixed 720-tall
    // portrait viewport, so the bottom chains were culled and UNREACHABLE — you
    // couldn't buy/refill/upgrade them. Make the list scrollable, mirroring the
    // bestiary/cosmetics/roster pattern.
    let scrollY = 0;
    const listBottom = () => LIST_TOP() + chains.length * (ROW_H() + GAP);
    const maxScroll = () => Math.max(0, listBottom() - k.height() + 12);
    const clampScroll = () => { scrollY = Math.min(maxScroll(), Math.max(0, scrollY)); };
    const rowRect = (i) => [listX0(), LIST_TOP() + i * (ROW_H() + GAP) - scrollY, listW(), ROW_H()];
    const buyRect = (i) => { const [x, y, w, h] = rowRect(i); return narrow() ? [x + w - 100, y + h - 32, 88, 26] : [x + w - 104, y + 8, 92, h - 16]; };
    const upRect = (i) => { const [x, y, w, h] = rowRect(i); return narrow() ? [x + w - 196, y + h - 32, 88, 26] : [x + w - 204, y + 8, 92, h - 16]; };
    const ins = safeInsetsDesign(k); // MOB: inset the top-right Back off the notch/rounded corner
    const backRect = () => [k.width() - 96 - ins.right, 12 + ins.top, 82, 44]; // MOB-A2: ≥44px touch target; off the notch

    let toast = "", toastT = 0;
    const showToast = (s) => { toast = s; toastT = 2.0; };
    const owned = (id) => (net.state.chains || []).some((c) => c.chainId === id);
    const canAfford = (def) => (net.state.gold || 0) >= (def.price || 0);
    // Upgrade target for a chain you own (Spirit Essence craft), or null.
    const upgradeFor = (def) => (owned(def.id) ? upgradeTargetFor(def, chains) : null);

    addMenuBackground(k, { fixed: true, z: -10 });

    k.onDraw(() => {
      const mp = k.mousePos(); // pointer for immediate-mode hover glow on the action buttons
      // Rows
      for (let i = 0; i < chains.length; i++) {
        const def = chains[i];
        const [x, y, w, h] = rowRect(i);
        if (y + h < LIST_TOP() || y > k.height()) continue; // cull rows scrolled out of view
        drawPanel(k, { rect: [x, y, w, h], hover: !TOUCH && y >= LIST_TOP() && inRect(mp, [x, y, w, h]) }); // standardized card + desktop hover-lift
        const c = chainColor(def);
        k.drawCircle({ pos: k.vec2(x + 24, y + h / 2), radius: 9, color: k.rgb(c[0], c[1], c[2]) });
        // Clamp text width to the space left of the Buy/Upgrade buttons so a long
        // chain name + tier + " special" can't bleed across the action buttons on
        // narrow viewports (audit HIGH: was unclamped, overlapping at ~360px).
        const owns = owned(def.id);
        const hasUp = !!upgradeFor(def);
        // Narrow: buttons are on their own row below, so the text spans the full card width.
        const textMaxW = narrow() ? w - 52 : Math.max(60, w - 42 - (hasUp ? 220 : 120));
        k.drawText({ text: `${def.name}   T${def.tier}${def.special ? "  " + (SPECIAL_TAG[def.special] || "special") : ""}`, pos: k.vec2(x + 42, y + 10), size: 15, font: FONT, color: col(THEME.text), width: textMaxW });
        k.drawText({ text: `${def.price}g   catches up to R${def.maxRarity}${owns ? "   owned" : ""}`, pos: k.vec2(x + 42, y + 28), size: 12, font: FONT, color: col(THEME.textMut), width: textMaxW }); // PT2-T14: show catch power so the chain's value is clear

        // Buy / Refill button
        const buy = buyRect(i);
        const affordable = canAfford(def);
        drawButton(k, { rect: buy, text: owns ? "Refill" : "Buy", size: 14, fill: THEME.primary, disabled: !affordable, hover: inRect(mp, buy) });

        // Upgrade (craft with essence) — only on a chain you own that has a next tier.
        const up = upgradeFor(def);
        if (up) {
          const cost = upgradeCost(def.tier);
          const canUp = (net.state.essence || 0) >= cost;
          const ur = upRect(i);
          drawButton(k, { rect: ur, text: `Up ${cost}e`, size: 13, fill: THEME.violet, disabled: !canUp, hover: inRect(mp, ur) });
        }
      }

      // Header: title + gold + back. Mask up to LIST_TOP (not just HEADER) so rows
      // scroll cleanly UNDER the header + currency/subtitle band instead of showing
      // through behind it.
      k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: LIST_TOP(), color: col(THEME.bg), fixed: true });
      k.drawRect({ pos: k.vec2(0, HEADER - 1), width: k.width(), height: 1, color: col(THEME.line), fixed: true });
      drawHeader(k, { title: "SPIRIT SHOP", ruleW: 150 }); // standardized title + teal accent rule
      // Color-code the two currencies to their game-identity hues (gold = amber,
      // essence = teal) so they're distinguishable at a glance, not both gold.
      // On narrow the currency drops below the header bar (title + Back fill the top row there).
      const curY = currencyBelow() ? HEADER + 18 : 20;
      k.drawText({ text: `${net.state.gold || 0} gold`, pos: k.vec2(k.width() / 2 - 14, curY), size: 15, font: FONT, anchor: "right", color: col(THEME.amber), fixed: true });
      k.drawText({ text: `${net.state.essence || 0} essence`, pos: k.vec2(k.width() / 2 + 14, curY), size: 15, font: FONT, anchor: "left", color: col(THEME.teal), fixed: true });
      // PT2-T14: one-line purpose so a new player knows what chains are for.
      k.drawText({ text: "Throw a chain to catch wild monsters — higher tiers catch rarer prey.", pos: k.vec2(k.width() / 2, currencyBelow() ? HEADER + 42 : 66), size: 12, font: FONT, anchor: "center", width: k.width() - 40, color: col(THEME.textMut), fixed: true });
      const back = backRect();
      drawButton(k, { rect: back, text: "Back", size: 16, fill: THEME.surfaceAlt, textColor: THEME.text, hover: inRect(mp, back), fixed: true });

      // Scrollbar — only when the list overflows (e.g. narrow portrait phones).
      const ms = maxScroll();
      if (ms > 0) {
        const trackTop = LIST_TOP();
        drawScrollbar(k, { top: trackTop, trackH: k.height() - trackTop, contentH: listBottom() - LIST_TOP(), scrollY, maxScroll: ms });
      }

      if (toastT > 0) { toastT -= k.dt(); drawToast(k, { text: toast, t: toastT }); }
    });

    // Server echo (buy + craft): refresh gold/essence/inventory and report.
    const offShop = net.on("shop", (m) => {
      if (m.locked) showToast("Locked during a run.");
      else if (m.ok) showToast("Done!");
      else if (m.reason === "essence") showToast("Not enough essence.");
      else if (m.reason === "maxed") showToast("Already max tier.");
      else if (m.reason === "owned") showToast("You don't own that chain.");
      else showToast("Not enough gold.");
    });

    const goBack = () => k.go(args.backScene || "lobby", args.backArgs || { characterId: args.characterId });
    k.onKeyPress("escape", goBack);

    // Tap handling (mouse + touch): back button, or a row's Buy button.
    const onTap = (p) => {
      if (inRect(p, backRect())) { sfx("click"); goBack(); return; }
      if (p.y < LIST_TOP()) return; // taps in the header/currency band never hit a scrolled-under row
      for (let i = 0; i < chains.length; i++) {
        const def = chains[i];
        if (upgradeFor(def) && inRect(p, upRect(i))) {
          if ((net.state.essence || 0) < upgradeCost(def.tier)) { showToast("Not enough essence."); return; }
          haptic(8); sfx("click"); net.craftChain(def.id);
          return;
        }
        if (inRect(p, buyRect(i))) {
          if (!canAfford(def)) { showToast("Not enough gold."); return; }
          haptic(8); sfx("click"); net.buyChain(def.id);
          return;
        }
      }
    };
    // Tap vs scroll: a barely-moved press is a tap (buy/upgrade); a drag scrolls the
    // list (so a flick on a phone doesn't accidentally trigger a purchase).
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
    if (typeof k.onScroll === "function") k.onScroll((d) => { scrollY += d.y; clampScroll(); });
    k.onKeyDown("down", () => { scrollY += 700 * k.dt(); clampScroll(); });
    k.onKeyDown("up", () => { scrollY -= 700 * k.dt(); clampScroll(); });

    k.onSceneLeave(() => { offShop && offShop(); });
  });
}
