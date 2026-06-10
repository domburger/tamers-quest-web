import { net } from "../netClient.js";
import { getSpiritChains } from "../engine/gamedata.js";
import { upgradeTargetFor, upgradeCost } from "../engine/schemas.js";
import { chainColor } from "../render/spiritchain.js";
import { THEME, FONT, addMenuBackground, drawButton, drawPanel, drawHeader, inRect } from "../ui/theme.js";
import { sfx } from "../systems/audio.js"; // buy/craft confirm chime (immediate-mode scene: no addButton sound)

// Online Spirit Shop (P-chains): spend gold earned in runs on spirit chains.
// Server-authoritative — the client sends "buyChain" and the server validates
// (idle-only, gold check), grants the chain, and echoes a "shop" message that
// syncs gold + inventory. Mirrors the single-player shop (scenes/shop.js) using
// the dark-flat design system + the immediate-mode draw/hit-test idiom (roster.js).
export default function onlineShopScene(k) {
  k.scene("onlineShop", (args = {}) => {
    const col = (t) => k.rgb(...t);
    const chains = getSpiritChains();
    const SPECIAL_TAG = { endless: "∞ throws", guaranteed: "sure catch", multi: "multi-catch" }; // concise special meaning (parity with SP shop / roster)

    const HEADER = 56;
    const ROW_H = 48, GAP = 8, LIST_TOP = HEADER + 24;
    const listW = () => Math.min(560, k.width() - 40);
    const listX0 = () => (k.width() - listW()) / 2;
    const rowRect = (i) => [listX0(), LIST_TOP + i * (ROW_H + GAP), listW(), ROW_H];
    const buyRect = (i) => { const [x, y, w] = rowRect(i); return [x + w - 104, y + 8, 92, ROW_H - 16]; };
    const upRect = (i) => { const [x, y, w] = rowRect(i); return [x + w - 204, y + 8, 92, ROW_H - 16]; };
    const backRect = () => [k.width() - 96, 12, 82, 44]; // MOB-A2: ≥44px touch target (was 34; top-right corner, clears content)

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
        if (y > k.height()) continue;
        drawPanel(k, { rect: [x, y, w, h] }); // standardized card (shadow + fill + hairline + sheen)
        const c = chainColor(def);
        k.drawCircle({ pos: k.vec2(x + 24, y + h / 2), radius: 9, color: k.rgb(c[0], c[1], c[2]) });
        // Clamp text width to the space left of the Buy/Upgrade buttons so a long
        // chain name + tier + " special" can't bleed across the action buttons on
        // narrow viewports (audit HIGH: was unclamped, overlapping at ~360px).
        const owns = owned(def.id);
        const hasUp = !!upgradeFor(def);
        const textMaxW = Math.max(60, w - 42 - (hasUp ? 220 : 120));
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

      // Header: title + gold + back.
      k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: HEADER, color: col(THEME.bg), fixed: true });
      k.drawRect({ pos: k.vec2(0, HEADER - 1), width: k.width(), height: 1, color: col(THEME.line), fixed: true });
      drawHeader(k, { title: "SPIRIT SHOP", ruleW: 150 }); // standardized title + teal accent rule
      // Color-code the two currencies to their game-identity hues (gold = amber,
      // essence = teal) so they're distinguishable at a glance, not both gold.
      k.drawText({ text: `${net.state.gold || 0} gold`, pos: k.vec2(k.width() / 2 - 14, 20), size: 15, font: FONT, anchor: "right", color: col(THEME.amber), fixed: true });
      k.drawText({ text: `${net.state.essence || 0} essence`, pos: k.vec2(k.width() / 2 + 14, 20), size: 15, font: FONT, anchor: "left", color: col(THEME.teal), fixed: true });
      // PT2-T14: one-line purpose so a new player knows what chains are for.
      k.drawText({ text: "Throw a chain to catch wild monsters — higher tiers catch rarer prey.", pos: k.vec2(k.width() / 2, 66), size: 12, font: FONT, anchor: "center", width: k.width() - 40, color: col(THEME.textMut), fixed: true });
      const back = backRect();
      drawButton(k, { rect: back, text: "Back", size: 16, fill: THEME.surfaceAlt, textColor: THEME.text, hover: inRect(mp, back), fixed: true });

      if (toastT > 0) {
        toastT -= k.dt();
        const tw = Math.min(k.width() - 40, 13 * toast.length + 36);
        drawPanel(k, { rect: [k.width() / 2 - tw / 2, k.height() - 51, tw, 30], radius: 8, fixed: true });
        k.drawText({ text: toast, pos: k.vec2(k.width() / 2, k.height() - 36), size: 13, font: FONT, anchor: "center", color: col(THEME.text), fixed: true });
      }
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

    const goBack = () => k.go("lobby", { characterId: args.characterId });
    k.onKeyPress("escape", goBack);

    // Tap handling (mouse + touch): back button, or a row's Buy button.
    const onTap = (p) => {
      if (inRect(p, backRect())) { goBack(); return; }
      for (let i = 0; i < chains.length; i++) {
        const def = chains[i];
        if (upgradeFor(def) && inRect(p, upRect(i))) {
          if ((net.state.essence || 0) < upgradeCost(def.tier)) { showToast("Not enough essence."); return; }
          sfx("click"); net.craftChain(def.id);
          return;
        }
        if (inRect(p, buyRect(i))) {
          if (!canAfford(def)) { showToast("Not enough gold."); return; }
          sfx("click"); net.buyChain(def.id);
          return;
        }
      }
    };
    k.onMouseRelease(() => onTap(k.mousePos()));
    k.onTouchEnd((p) => onTap(p));

    k.onSceneLeave(() => { offShop && offShop(); });
  });
}
