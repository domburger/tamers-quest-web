import { net } from "../netClient.js";
import { getSpiritChains } from "../engine/gamedata.js";
import { upgradeTargetFor, upgradeCost } from "../engine/schemas.js";
import { chainColor } from "../render/spiritchain.js";
import { THEME, FONT, addMenuBackground } from "../ui/theme.js";

// Online Spirit Shop (P-chains): spend gold earned in runs on spirit chains.
// Server-authoritative — the client sends "buyChain" and the server validates
// (idle-only, gold check), grants the chain, and echoes a "shop" message that
// syncs gold + inventory. Mirrors the single-player shop (scenes/shop.js) using
// the dark-flat design system + the immediate-mode draw/hit-test idiom (roster.js).
export default function onlineShopScene(k) {
  k.scene("onlineShop", () => {
    const col = (t) => k.rgb(...t);
    const chains = getSpiritChains();

    const HEADER = 56;
    const ROW_H = 48, GAP = 8, LIST_TOP = HEADER + 24;
    const listW = () => Math.min(560, k.width() - 40);
    const listX0 = () => (k.width() - listW()) / 2;
    const rowRect = (i) => [listX0(), LIST_TOP + i * (ROW_H + GAP), listW(), ROW_H];
    const buyRect = (i) => { const [x, y, w] = rowRect(i); return [x + w - 104, y + 8, 92, ROW_H - 16]; };
    const upRect = (i) => { const [x, y, w] = rowRect(i); return [x + w - 204, y + 8, 92, ROW_H - 16]; };
    const backRect = () => [k.width() - 96, 12, 82, 34];
    const inRect = (p, [x, y, w, h]) => p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;

    let toast = "", toastT = 0;
    const showToast = (s) => { toast = s; toastT = 2.0; };
    const owned = (id) => (net.state.chains || []).some((c) => c.chainId === id);
    const canAfford = (def) => (net.state.gold || 0) >= (def.price || 0);
    // Upgrade target for a chain you own (Spirit Essence craft), or null.
    const upgradeFor = (def) => (owned(def.id) ? upgradeTargetFor(def, chains) : null);

    addMenuBackground(k, { fixed: true, z: -10 });

    k.onDraw(() => {
      // Rows
      for (let i = 0; i < chains.length; i++) {
        const def = chains[i];
        const [x, y, w, h] = rowRect(i);
        if (y > k.height()) continue;
        k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius: 10, color: col(THEME.surface), outline: { width: 2, color: col(THEME.line) } });
        const c = chainColor(def);
        k.drawCircle({ pos: k.vec2(x + 24, y + h / 2), radius: 9, color: k.rgb(c[0], c[1], c[2]) });
        k.drawText({ text: `${def.name}   T${def.tier}${def.special ? "  special" : ""}`, pos: k.vec2(x + 42, y + 10), size: 15, font: FONT, color: col(THEME.text) });
        const owns = owned(def.id);
        k.drawText({ text: `${def.price}g   catches up to R${def.maxRarity}${owns ? "   owned" : ""}`, pos: k.vec2(x + 42, y + 28), size: 12, font: FONT, color: col(THEME.textMut) }); // PT2-T14: show catch power so the chain's value is clear

        // Buy / Refill button
        const [bx, by, bw, bh] = buyRect(i);
        const affordable = canAfford(def);
        k.drawRect({ pos: k.vec2(bx, by), width: bw, height: bh, radius: 8, color: col(affordable ? THEME.primary : THEME.surfaceAlt), opacity: affordable ? 1 : 0.6 });
        k.drawText({ text: owns ? "Refill" : "Buy", pos: k.vec2(bx + bw / 2, by + bh / 2), size: 14, font: FONT, anchor: "center", color: col(affordable ? THEME.textInv : THEME.textMut) });

        // Upgrade (craft with essence) — only on a chain you own that has a next tier.
        const up = upgradeFor(def);
        if (up) {
          const cost = upgradeCost(def.tier);
          const canUp = (net.state.essence || 0) >= cost;
          const [ux, uy, uw, uh] = upRect(i);
          k.drawRect({ pos: k.vec2(ux, uy), width: uw, height: uh, radius: 8, color: col(canUp ? [110, 80, 150] : THEME.surfaceAlt), opacity: canUp ? 1 : 0.6 });
          k.drawText({ text: `Up ${cost}e`, pos: k.vec2(ux + uw / 2, uy + uh / 2), size: 13, font: FONT, anchor: "center", color: col(canUp ? THEME.textInv : THEME.textMut) });
        }
      }

      // Header: title + gold + back.
      k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: HEADER, color: col(THEME.bg), fixed: true });
      k.drawRect({ pos: k.vec2(0, HEADER - 1), width: k.width(), height: 1, color: col(THEME.line), fixed: true });
      k.drawText({ text: "SPIRIT SHOP", pos: k.vec2(20, 18), size: 22, font: FONT, color: col(THEME.text), fixed: true });
      // Color-code the two currencies to their game-identity hues (gold = amber,
      // essence = teal) so they're distinguishable at a glance, not both gold.
      k.drawText({ text: `${net.state.gold || 0} gold`, pos: k.vec2(k.width() / 2 - 14, 20), size: 15, font: FONT, anchor: "right", color: col(THEME.amber), fixed: true });
      k.drawText({ text: `${net.state.essence || 0} essence`, pos: k.vec2(k.width() / 2 + 14, 20), size: 15, font: FONT, anchor: "left", color: col(THEME.teal), fixed: true });
      // PT2-T14: one-line purpose so a new player knows what chains are for.
      k.drawText({ text: "Throw a chain to catch wild monsters — higher tiers catch rarer prey.", pos: k.vec2(k.width() / 2, 66), size: 12, font: FONT, anchor: "center", width: k.width() - 40, color: col(THEME.textMut), fixed: true });
      const [bx, by, bw, bh] = backRect();
      k.drawRect({ pos: k.vec2(bx, by), width: bw, height: bh, radius: 10, color: col(THEME.surfaceAlt), outline: { width: 2, color: col(THEME.line) }, fixed: true });
      k.drawText({ text: "Back", pos: k.vec2(bx + bw / 2, by + bh / 2), size: 16, font: FONT, anchor: "center", color: col(THEME.text), fixed: true });

      if (toastT > 0) {
        toastT -= k.dt();
        const tw = Math.min(k.width() - 40, 13 * toast.length + 36);
        k.drawRect({ pos: k.vec2(k.width() / 2, k.height() - 36), width: tw, height: 30, radius: 8, anchor: "center", color: col(THEME.surface), outline: { width: 1, color: col(THEME.line) }, fixed: true });
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

    const goBack = () => k.go("onlineLobby");
    k.onKeyPress("escape", goBack);

    // Tap handling (mouse + touch): back button, or a row's Buy button.
    const onTap = (p) => {
      if (inRect(p, backRect())) { goBack(); return; }
      for (let i = 0; i < chains.length; i++) {
        const def = chains[i];
        if (upgradeFor(def) && inRect(p, upRect(i))) {
          if ((net.state.essence || 0) < upgradeCost(def.tier)) { showToast("Not enough essence."); return; }
          net.craftChain(def.id);
          return;
        }
        if (inRect(p, buyRect(i))) {
          if (!canAfford(def)) { showToast("Not enough gold."); return; }
          net.buyChain(def.id);
          return;
        }
      }
    };
    k.onMouseRelease(() => onTap(k.mousePos()));
    k.onTouchEnd((p) => onTap(p));

    k.onSceneLeave(() => { offShop && offShop(); });
  });
}
