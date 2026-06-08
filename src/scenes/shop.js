import { getCharacter, saveCharacter } from "../storage.js";
import { getSpiritChains } from "../data.js";
import { buyChain } from "../engine/schemas.js";
import { chainColor } from "../render/spiritchain.js";
import { THEME, FONT, addButton, addLabel, addPanel, addMenuBackground, addHeader } from "../ui/theme.js";

// Spirit Shop (between runs): spend gold earned in runs on spirit chains.
// Buying a chain banks it permanently (not run-found). Server-authoritative
// equivalent lives in world.js ("buyChain"); this is the single-player hub.
export default function shopScene(k) {
  k.scene("shop", ({ characterId }) => {
    const character = getCharacter(characterId);
    if (!character) { k.go("characterSelect"); return; }

    const cx = k.width() / 2;
    addMenuBackground(k);
    addHeader(k, { x: cx, y: 38, text: "SPIRIT SHOP", size: 34 });

    const goldLabel = addLabel(k, { x: cx, y: 78, text: "", size: 20, color: THEME.amber || THEME.text });
    const refreshGold = () => { goldLabel.text = `Gold: ${character.gold || 0}`; };
    refreshGold();
    // PT2-T14: one-line purpose so a new player knows what chains are for.
    addLabel(k, { x: cx, y: 98, size: 12, color: THEME.textMut,
      text: "Throw a chain to catch wild monsters — higher tiers catch rarer prey." });

    // One row per chain: icon dot, name+tier, price, owned tag, Buy button.
    // Concise special tags so a buyer knows what the special DOES (was a generic
    // "special" that didn't say what you were paying for); mirrors the roster blurbs.
    const SPECIAL_TAG = { endless: "∞ throws", guaranteed: "sure catch", multi: "multi-catch" };
    const chains = getSpiritChains();
    const rowH = 46, gap = 8, listTop = 116;
    const panelW = Math.min(560, k.width() - 48);

    chains.forEach((def, i) => {
      const y = listTop + i * (rowH + gap) + rowH / 2;
      addPanel(k, { x: cx, y, w: panelW, h: rowH, radius: 10, fill: THEME.surface });
      const left = cx - panelW / 2 + 18;
      const col = chainColor(def);
      k.add([k.circle(8), k.pos(left, y), k.anchor("center"), k.color(...col)]);
      // Clamp the name width so a long chain name can't grow rightward into the
      // right-side price/Buy column on narrow viewports.
      const nameMaxW = Math.max(80, panelW - 220);
      addLabel(k, { x: left + 22, y, anchor: "left", size: 15, width: nameMaxW,
        text: `${def.name}   T${def.tier}${def.special ? "  " + (SPECIAL_TAG[def.special] || "special") : ""}`, color: THEME.text });
      addLabel(k, { x: cx + panelW / 2 - 150, y, anchor: "right", size: 14,
        text: `${def.price}g     R≤${def.maxRarity}`, color: THEME.textMut }); // PT2-T14: show catch power

      const owned = (character.chains || []).some((c) => c.chainId === def.id);
      // Grey when unaffordable so affordability reads at a glance (matches Base Upgrades /
      // the online shop). Applies to BOTH "Buy" and "Refill": buyChain charges def.price
      // for an owned chain too (a refill tops up throws/charges at full price), so the
      // earlier "Refill cost isn't def.price" assumption was wrong. Still tappable → flashes.
      const cantAfford = (character.gold || 0) < def.price;
      const buyBtn = addButton(k, { x: cx + panelW / 2 - 64, y, w: 110, h: rowH - 12, size: 15,
        text: owned ? "Refill" : "Buy",
        fill: cantAfford ? THEME.surfaceAlt : THEME.primary, textColor: cantAfford ? THEME.textMut : THEME.textInv,
        onClick: () => {
          if (buyChain(character, def)) {
            saveCharacter(character);
            refreshGold();
            flash(`${owned ? "Refilled" : "Bought"} ${def.name}`);
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
