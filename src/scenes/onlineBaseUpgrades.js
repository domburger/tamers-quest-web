import { net } from "../netClient.js";
import { UPGRADE_DEFS, upgradeLevel, nextUpgradeCost } from "../engine/upgrades.js";
import { THEME, FONT, addMenuBackground } from "../ui/theme.js";
import { sfx } from "../systems/audio.js"; // buy confirm chime (immediate-mode scene: no addButton sound)

// Online Base Upgrades (CN-1) — the MP counterpart of scenes/baseUpgrades.js. The
// server-authoritative `buyUpgrade` handler (world.js) and `net.buyUpgrade` were
// already done + tested; the only missing piece was this client UI, so online
// players had no way to spend run-earned gold on permanent account upgrades.
// Immediate-mode draw + hit-test (the roster.js / onlineShop.js idiom): the server
// echoes an "upgrades" message which net.js folds into state.gold/upgrades, so the
// next onDraw reflects the purchase automatically (no manual re-render).
export default function onlineBaseUpgradesScene(k) {
  k.scene("onlineBaseUpgrades", () => {
    const col = (t) => k.rgb(...t);
    const defs = UPGRADE_DEFS;

    const HEADER = 56;
    const ROW_H = 76, GAP = 12, LIST_TOP = HEADER + 26;
    const listW = () => Math.min(620, k.width() - 40);
    const listX0 = () => (k.width() - listW()) / 2;
    const rowRect = (i) => [listX0(), LIST_TOP + i * (ROW_H + GAP), listW(), ROW_H];
    const buyRect = (i) => { const [x, y, w] = rowRect(i); return [x + w - 144, y + (ROW_H - 46) / 2, 128, 46]; };
    const backRect = () => [k.width() - 96, 12, 82, 34];
    const inRect = (p, [x, y, w, h]) => p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;

    let toast = "", toastT = 0;
    const showToast = (s) => { toast = s; toastT = 2.0; };
    const costOf = (def) => nextUpgradeCost(net.state, def); // null = maxed
    const canAfford = (def) => { const c = costOf(def); return c != null && (net.state.gold || 0) >= c; };
    // Concrete per-level effect (mirrors SP baseUpgrades): fraction → percent, whole → flat.
    const fmtEffect = (def, lvl) => (lvl <= 0 ? "none" : def.per < 1 ? `+${Math.round(def.per * lvl * 100)}%` : `+${Math.round(def.per * lvl)}`);

    addMenuBackground(k, { fixed: true, z: -10 });

    k.onDraw(() => {
      for (let i = 0; i < defs.length; i++) {
        const def = defs[i];
        const [x, y, w, h] = rowRect(i);
        if (y > k.height()) continue;
        k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius: 10, color: col(THEME.surface), outline: { width: 2, color: col(THEME.line) } });
        // Top sheen — raised-surface feel (addPanel parity for immediate-mode rows).
        k.drawRect({ pos: k.vec2(x + 6, y + 3), width: w - 12, height: 14, radius: 7, color: col(THEME.surface2), opacity: 0.45 });
        const lvl = upgradeLevel(net.state, def.id);
        // Clamp the name width too (desc already had a clamp) so a long upgrade name
        // can't bleed across the right-side Buy button on narrow viewports.
        const textMaxW = Math.max(60, w - 180);
        k.drawText({ text: def.name, pos: k.vec2(x + 18, y + 12), size: 16, font: FONT, color: col(THEME.text), width: textMaxW });
        k.drawText({ text: def.desc, pos: k.vec2(x + 18, y + 34), size: 12, font: FONT, width: textMaxW, color: col(THEME.textMut) });
        const effLine = lvl >= def.maxLevel
          ? `Level ${lvl} / ${def.maxLevel}     now ${fmtEffect(def, lvl)} (max)`
          : `Level ${lvl} / ${def.maxLevel}     now ${fmtEffect(def, lvl)}  →  ${fmtEffect(def, lvl + 1)}`;
        k.drawText({ text: effLine, pos: k.vec2(x + 18, y + h - 18), size: 12, font: FONT, color: col(THEME.textMut), width: w - 170 });

        const cost = costOf(def);
        const maxed = cost == null;
        const afford = canAfford(def);
        const [bx, by, bw, bh] = buyRect(i);
        k.drawRect({ pos: k.vec2(bx, by), width: bw, height: bh, radius: 8, color: col(maxed ? THEME.surfaceAlt : afford ? THEME.primary : THEME.surfaceAlt), opacity: maxed || afford ? 1 : 0.6 });
        k.drawText({ text: maxed ? "MAX" : `Buy   ${cost}g`, pos: k.vec2(bx + bw / 2, by + bh / 2), size: 14, font: FONT, anchor: "center", color: col(maxed || !afford ? THEME.textMut : THEME.textInv) });
      }

      // Header: title + gold + back.
      k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: HEADER, color: col(THEME.bg), fixed: true });
      k.drawRect({ pos: k.vec2(0, HEADER - 1), width: k.width(), height: 1, color: col(THEME.line), fixed: true });
      k.drawText({ text: "BASE UPGRADES", pos: k.vec2(20, 18), size: 22, font: FONT, color: col(THEME.text), fixed: true });
      // Teal accent rule under the title — mirrors addHeader's signature so the
      // immediate-mode page reads as part of the polished family (parity with
      // bestiary, onlineShop).
      k.drawRect({ pos: k.vec2(20, 44), width: 170, height: 6, radius: 3, color: col(THEME.teal), opacity: 0.16, fixed: true });
      k.drawRect({ pos: k.vec2(25, 46), width: 160, height: 2, radius: 1, color: col(THEME.teal), opacity: 0.9, fixed: true });
      k.drawText({ text: `${net.state.gold || 0} gold`, pos: k.vec2(k.width() / 2, 20), size: 15, font: FONT, anchor: "center", color: col(THEME.amber || THEME.text), fixed: true });
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

    // Server echo: net.js already synced gold + upgrade levels; just report outcome.
    const offUp = net.on("upgrades", (m) => {
      if (m.locked) showToast("Upgrades are buy-able only between runs.");
      else if (m.ok) showToast("Upgraded!");
      else if (m.reason === "gold") showToast("Not enough gold.");
      else if (m.reason === "maxed") showToast("Already maxed.");
      else showToast("Couldn't buy that upgrade.");
    });

    const goBack = () => k.go("onlineLobby");
    k.onKeyPress("escape", goBack);

    const onTap = (p) => {
      if (inRect(p, backRect())) { goBack(); return; }
      for (let i = 0; i < defs.length; i++) {
        const def = defs[i];
        if (inRect(p, buyRect(i))) {
          if (costOf(def) == null) { showToast("Already maxed."); return; }
          if (!canAfford(def)) { showToast("Not enough gold."); return; }
          sfx("click"); net.buyUpgrade(def.id);
          return;
        }
      }
    };
    k.onMouseRelease(() => onTap(k.mousePos()));
    k.onTouchEnd((p) => onTap(p));

    k.onSceneLeave(() => { offUp && offUp(); });
  });
}
