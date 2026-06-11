import { net } from "../netClient.js";
import { UPGRADE_DEFS, upgradeLevel, nextUpgradeCost } from "../engine/upgrades.js";
import { THEME, FONT, addMenuBackground, drawButton, drawPanel, drawHeader, drawToast, inRect } from "../ui/theme.js";
import { safeInsetsDesign } from "../systems/safearea.js"; // MOB: keep Back off the notch (parity with cosmetics/bestiary)
import { touchPrimary } from "../systems/inputMode.js"; // shared mobile detection (gate desktop hover-lift)
import { sfx, haptic } from "../systems/audio.js"; // buy confirm chime + tactile buzz (immediate-mode scene: no addButton feedback)

// Online Base Upgrades (CN-1) — the MP counterpart of scenes/baseUpgrades.js. The
// server-authoritative `buyUpgrade` handler (world.js) and `net.buyUpgrade` were
// already done + tested; the only missing piece was this client UI, so online
// players had no way to spend run-earned gold on permanent account upgrades.
// Immediate-mode draw + hit-test (the roster.js / onlineShop.js idiom): the server
// echoes an "upgrades" message which net.js folds into state.gold/upgrades, so the
// next onDraw reflects the purchase automatically (no manual re-render).
export default function onlineBaseUpgradesScene(k) {
  k.scene("onlineBaseUpgrades", (args = {}) => {
    const col = (t) => k.rgb(...t);
    const TOUCH = touchPrimary(k); // mobile-only: suppress hover-lift on phones/tablets (a touch-laptop keeps mouse hover)
    const defs = UPGRADE_DEFS;
    const ins = safeInsetsDesign(k); // MOB: inset the top-right Back off the notch/rounded corner

    const HEADER = 56;
    const GAP = 12;
    const listW = () => Math.min(620, k.width() - 40);
    const listX0 = () => (k.width() - listW()) / 2;
    // Narrow (mobile portrait): the card can't fit the name/desc/effect text AND the wide Buy
    // button side-by-side (desc got clamped to ~140px and wrapped over the button). So rows grow
    // taller, the text spans full width, and the Buy button drops to a row below. The header
    // also drops the gold below its bar (title + Back fill the top row there).
    const narrow = () => listW() < 430;
    // The gold total drops below the header bar when the screen is narrow OR the value is too
    // long to clear the (wide) left-aligned title in the centered top row — big balances used
    // to overlap "BASE UPGRADES" at mid widths. ~8.5px/char at size 15; title eats ~215px.
    const currencyBelow = () => narrow() || (String(net.state.gold || 0).length + 5) * 8.5 > k.width() - 430;
    const ROW_H = () => (narrow() ? 124 : 76);
    const LIST_TOP = () => HEADER + (currencyBelow() ? 44 : 26);
    const rowRect = (i) => [listX0(), LIST_TOP() + i * (ROW_H() + GAP), listW(), ROW_H()];
    const buyRect = (i) => { const [x, y, w, h] = rowRect(i); return narrow() ? [x + w - 144, y + h - 46, 128, 40] : [x + w - 144, y + (h - 46) / 2, 128, 46]; };
    const backRect = () => [k.width() - 96 - ins.right, 12 + ins.top, 82, 34];

    let toast = "", toastT = 0;
    const showToast = (s) => { toast = s; toastT = 2.0; };
    const costOf = (def) => nextUpgradeCost(net.state, def); // null = maxed
    const canAfford = (def) => { const c = costOf(def); return c != null && (net.state.gold || 0) >= c; };
    // Concrete per-level effect (mirrors SP baseUpgrades): fraction → percent, whole → flat.
    const fmtEffect = (def, lvl) => (lvl <= 0 ? "none" : def.per < 1 ? `+${Math.round(def.per * lvl * 100)}%` : `+${Math.round(def.per * lvl)}`);

    addMenuBackground(k, { fixed: true, z: -10 });

    k.onDraw(() => {
      const mp = k.mousePos(); // pointer for immediate-mode hover glow on the Buy buttons
      for (let i = 0; i < defs.length; i++) {
        const def = defs[i];
        const [x, y, w, h] = rowRect(i);
        if (y > k.height()) continue;
        drawPanel(k, { rect: [x, y, w, h], hover: !TOUCH && y >= LIST_TOP() && inRect(mp, [x, y, w, h]) }); // standardized card + desktop hover-lift
        const lvl = upgradeLevel(net.state, def.id);
        // Clamp the name width too (desc already had a clamp) so a long upgrade name
        // can't bleed across the right-side Buy button on narrow viewports.
        // Narrow: buttons are on their own row below, so the text spans (nearly) the full width.
        const textMaxW = narrow() ? w - 36 : Math.max(60, w - 180);
        k.drawText({ text: def.name, pos: k.vec2(x + 18, y + 12), size: 16, font: FONT, color: col(THEME.text), width: textMaxW });
        k.drawText({ text: def.desc, pos: k.vec2(x + 18, y + 34), size: 12, font: FONT, width: textMaxW, color: col(THEME.textMut) });
        const effLine = lvl >= def.maxLevel
          ? `Level ${lvl} / ${def.maxLevel}     now ${fmtEffect(def, lvl)} (max)`
          : `Level ${lvl} / ${def.maxLevel}     now ${fmtEffect(def, lvl)}  →  ${fmtEffect(def, lvl + 1)}`;
        // Narrow: effect line sits just below the desc (the button row is at the card bottom);
        // wide keeps it pinned to the bottom-left, beside the right-aligned button.
        k.drawText({ text: effLine, pos: k.vec2(x + 18, narrow() ? y + 62 : y + h - 18), size: 12, font: FONT, color: col(THEME.textMut), width: narrow() ? w - 36 : w - 170 });

        const cost = costOf(def);
        const maxed = cost == null;
        const afford = canAfford(def);
        const buy = buyRect(i);
        drawButton(k, { rect: buy, text: maxed ? "MAX" : `Buy   ${cost}g`, size: 14, fill: THEME.primary, disabled: maxed || !afford, hover: inRect(mp, buy) });
      }

      // Header: title + gold + back.
      k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: HEADER, color: col(THEME.bg), fixed: true });
      k.drawRect({ pos: k.vec2(0, HEADER - 1), width: k.width(), height: 1, color: col(THEME.line), fixed: true });
      drawHeader(k, { title: "BASE UPGRADES", ruleW: 170 }); // standardized title + teal accent rule
      // On narrow the gold drops below the header bar (title + Back fill the top row there).
      k.drawText({ text: `${net.state.gold || 0} gold`, pos: k.vec2(k.width() / 2, currencyBelow() ? HEADER + 18 : 20), size: 15, font: FONT, anchor: "center", color: col(THEME.amber || THEME.text), fixed: true });
      const back = backRect();
      drawButton(k, { rect: back, text: "Back", size: 16, fill: THEME.surfaceAlt, textColor: THEME.text, hover: inRect(mp, back), fixed: true });

      if (toastT > 0) { toastT -= k.dt(); drawToast(k, { text: toast, t: toastT }); }
    });

    // Server echo: net.js already synced gold + upgrade levels; just report outcome.
    const offUp = net.on("upgrades", (m) => {
      if (m.locked) showToast("Upgrades are buy-able only between runs.");
      else if (m.ok) showToast("Upgraded!");
      else if (m.reason === "gold") showToast("Not enough gold.");
      else if (m.reason === "maxed") showToast("Already maxed.");
      else showToast("Couldn't buy that upgrade.");
    });

    const goBack = () => k.go(args.backScene || "lobby", args.backArgs || { characterId: args.characterId });
    k.onKeyPress("escape", goBack);

    const onTap = (p) => {
      if (inRect(p, backRect())) { sfx("click"); goBack(); return; }
      for (let i = 0; i < defs.length; i++) {
        const def = defs[i];
        if (inRect(p, buyRect(i))) {
          if (costOf(def) == null) { showToast("Already maxed."); return; }
          if (!canAfford(def)) { showToast("Not enough gold."); return; }
          haptic(8); sfx("click"); net.buyUpgrade(def.id);
          return;
        }
      }
    };
    k.onMouseRelease(() => onTap(k.mousePos()));
    k.onTouchEnd((p) => onTap(p));

    k.onSceneLeave(() => { offUp && offUp(); });
  });
}
