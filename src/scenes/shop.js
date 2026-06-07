import { getCharacter, saveCharacter } from "../storage.js";
import { getSpiritChains } from "../data.js";
import { buyChain } from "../engine/schemas.js";
import { chainColor } from "../render/spiritchain.js";
import { THEME, FONT, addButton, addLabel, addPanel, addMenuBackground } from "../ui/theme.js";

// Spirit Shop (between runs): spend gold earned in runs on spirit chains.
// Buying a chain banks it permanently (not run-found). Server-authoritative
// equivalent lives in world.js ("buyChain"); this is the single-player hub.
export default function shopScene(k) {
  k.scene("shop", ({ characterId }) => {
    const character = getCharacter(characterId);
    if (!character) { k.go("characterSelect"); return; }

    const cx = k.width() / 2;
    addMenuBackground(k);
    addLabel(k, { x: cx, y: 40, text: "SPIRIT SHOP", size: 32, color: THEME.text });

    const goldLabel = addLabel(k, { x: cx, y: 78, text: "", size: 20, color: THEME.light || THEME.text });
    const refreshGold = () => { goldLabel.text = `Gold: ${character.gold || 0}`; };
    refreshGold();

    // One row per chain: icon dot, name+tier, price, owned tag, Buy button.
    const chains = getSpiritChains();
    const rowH = 46, gap = 8, listTop = 116;
    const panelW = Math.min(560, k.width() - 48);

    chains.forEach((def, i) => {
      const y = listTop + i * (rowH + gap) + rowH / 2;
      addPanel(k, { x: cx, y, w: panelW, h: rowH, radius: 10, fill: THEME.surface });
      const left = cx - panelW / 2 + 18;
      const col = chainColor(def);
      k.add([k.circle(8), k.pos(left, y), k.anchor("center"), k.color(...col)]);
      addLabel(k, { x: left + 22, y, anchor: "left", size: 15,
        text: `${def.name}   T${def.tier}${def.special ? "  special" : ""}`, color: THEME.text });
      addLabel(k, { x: cx + panelW / 2 - 150, y, anchor: "right", size: 14,
        text: `${def.price}g`, color: THEME.textMut });

      const owned = (character.chains || []).some((c) => c.chainId === def.id);
      const buyBtn = addButton(k, { x: cx + panelW / 2 - 64, y, w: 110, h: rowH - 12, size: 15,
        text: owned ? "Refill" : "Buy",
        fill: THEME.primary, textColor: THEME.textInv,
        onClick: () => {
          if (buyChain(character, def)) {
            saveCharacter(character);
            refreshGold();
            flash(`Bought ${def.name}`);
          } else {
            flash("Not enough gold");
          }
        } });
      buyBtn.label.text = owned ? "Refill" : "Buy";
    });

    const msg = addLabel(k, { x: cx, y: k.height() - 86, text: "", size: 15, color: THEME.textMut });
    let msgT = null;
    function flash(t) { msg.text = t; if (msgT) clearTimeout(msgT); msgT = setTimeout(() => { msg.text = ""; }, 1500); }

    addButton(k, { x: cx, y: k.height() - 44, w: 220, h: 48, text: "Back",
      fill: THEME.surface, textColor: THEME.text, onClick: () => k.go("lobby", { characterId }) });
    k.onKeyPress("escape", () => k.go("lobby", { characterId })); // VS-15: Escape = Back (menu-nav consistency)
  });
}
