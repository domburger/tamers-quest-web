import { getCharacter, saveCharacter } from "../storage.js";
import { UPGRADE_DEFS, upgradeLevel, nextUpgradeCost, purchaseUpgrade } from "../engine/upgrades.js";
import { THEME, FONT, addButton, addLabel, addPanel, addMenuBackground, addHeader } from "../ui/theme.js";

// Base Upgrades (single-player meta-progression): spend gold on permanent account
// upgrades that carry across every run. Server-authoritative MP equivalent is the
// `buyUpgrade` handler in world.js. Registered via featureScenes.js (no main.js edit).
export default function baseUpgradesScene(k) {
  k.scene("baseUpgrades", ({ characterId, note }) => {
    const character = getCharacter(characterId);
    if (!character) { k.go("characterSelect"); return; }

    const cx = k.width() / 2;
    addMenuBackground(k);
    addHeader(k, { x: cx, y: 38, text: "BASE UPGRADES", size: 34 });
    addLabel(k, { x: cx, y: 78, text: `Gold: ${character.gold || 0}`, size: 20, color: THEME.amber || THEME.text });

    let toast = note || "";
    let toastT = note ? 1.6 : 0;
    const flash = (t) => { toast = t; toastT = 1.6; };

    const rowH = 78, gap = 12, top = 112;
    const panelW = Math.min(620, k.width() - 48);
    // Show what a level actually grants (per-level magnitude from def.per): a fraction
    // renders as a percent (+20%), a whole number as a flat value (+25). So a player can
    // see the concrete bonus + what the next level adds before spending gold.
    const fmtEffect = (def, lvl) => (lvl <= 0 ? "none" : def.per < 1 ? `+${Math.round(def.per * lvl * 100)}%` : `+${Math.round(def.per * lvl)}`);

    UPGRADE_DEFS.forEach((def, i) => {
      const y = top + i * (rowH + gap) + rowH / 2;
      addPanel(k, { x: cx, y, w: panelW, h: rowH, radius: 10, fill: THEME.surface });
      const left = cx - panelW / 2 + 18;
      const lvl = upgradeLevel(character, def.id);
      addLabel(k, { x: left, y: y - 22, anchor: "left", size: 17, text: def.name, color: THEME.text });
      addLabel(k, { x: left, y: y, anchor: "left", size: 12, text: def.desc, color: THEME.textMut, width: panelW - 210 });
      const effLine = lvl >= def.maxLevel
        ? `Level ${lvl} / ${def.maxLevel}     now ${fmtEffect(def, lvl)} (max)`
        : `Level ${lvl} / ${def.maxLevel}     now ${fmtEffect(def, lvl)}  →  ${fmtEffect(def, lvl + 1)}`;
      addLabel(k, { x: left, y: y + 22, anchor: "left", size: 12, text: effLine, color: THEME.textMut, width: panelW - 170 });

      const cost = nextUpgradeCost(character, def);
      const maxed = cost == null;
      // Grey the button when maxed OR unaffordable so cost/affordability reads at a
      // glance (parity with the online shop). Still tappable when unaffordable — the
      // click flashes "Not enough gold" rather than silently doing nothing.
      const afford = !maxed && (character.gold || 0) >= cost;
      addButton(k, {
        x: cx + panelW / 2 - 78, y, w: 132, h: 46, size: 15,
        text: maxed ? "MAX" : `Buy   ${cost}g`,
        fill: afford ? THEME.primary : THEME.surfaceAlt, textColor: afford ? THEME.textInv : THEME.textMut,
        onClick: () => {
          if (maxed) { flash("Already maxed"); return; }
          const r = purchaseUpgrade(character, def);
          if (r.ok) { saveCharacter(character); k.go("baseUpgrades", { characterId, note: `Upgraded ${def.name}!` }); }
          else flash(r.reason === "gold" ? "Not enough gold" : "Can't buy");
        },
      });
    });

    const msg = addLabel(k, { x: cx, y: k.height() - 86, text: toast, size: 15, color: THEME.textMut });
    k.onUpdate(() => { toastT = Math.max(0, toastT - k.dt()); msg.text = toastT > 0 ? toast : ""; });

    addButton(k, { x: cx, y: k.height() - 44, w: 220, h: 48, text: "Back",
      fill: THEME.surface, textColor: THEME.text, onClick: () => k.go("lobby", { characterId }) });
    k.onKeyPress("escape", () => k.go("lobby", { characterId })); // VS-15: Escape = Back (menu-nav consistency)
  });
}
