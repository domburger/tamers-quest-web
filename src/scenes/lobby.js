import { getCharacter } from "../storage.js";
import { THEME, FONT, addButton, addLabel, addPanel } from "../ui/theme.js";

export default function lobbyScene(k) {
  k.scene("lobby", ({ characterId }) => {
    const character = getCharacter(characterId);
    if (!character) {
      k.go("characterSelect");
      return;
    }

    const cx = k.width() / 2;

    // Flat light backdrop
    k.add([k.sprite("menu_background"), k.pos(k.width() / 2, k.height() / 2), k.anchor("center")]);

    // Header
    addLabel(k, { x: cx, y: 48, text: "TAMERS QUEST", size: 36, color: THEME.text });
    addLabel(k, { x: cx, y: 92, text: `${character.name}     Lv ${character.level}     ${character.gold || 0}g     ${character.essence || 0} essence`,
      size: 20, color: THEME.textMut });

    const hasMonsters = character.activeMonsters && character.activeMonsters.length > 0;

    const buttons = [
      { label: "Start Run", fill: hasMonsters ? THEME.success : THEME.surfaceAlt,
        textColor: hasMonsters ? THEME.textInv : THEME.textMut,
        action: () => { if (hasMonsters) k.go("loading", { characterId }); } },
      { label: "Inventory", fill: THEME.primary, textColor: THEME.textInv,
        action: () => k.go("inventory", { characterId }) },
      { label: "Spirit Shop", fill: THEME.surface, textColor: THEME.text,
        action: () => k.go("shop", { characterId }) },
      { label: "Base Upgrades", fill: THEME.surface, textColor: THEME.text,
        action: () => k.go("baseUpgrades", { characterId }) },
      { label: "Bestiary", fill: THEME.surface, textColor: THEME.text,
        action: () => k.go("bestiary") },
      { label: "Cosmetics", fill: THEME.surface, textColor: THEME.text,
        action: () => k.go("cosmetics", { backScene: "lobby", backArgs: { characterId } }) },
      { label: "Settings", fill: THEME.surface, textColor: THEME.text,
        action: () => k.go("settings", { characterId }) },
      { label: "Back", fill: THEME.surface, textColor: THEME.danger,
        action: () => k.go("characterSelect") },
    ];

    // Fit the (now longer) button list between the header and the team strip.
    const btnW = 300, btnH = 44, btnGap = 10;
    const startY = 128 + btnH / 2;
    buttons.forEach((b, i) => {
      addButton(k, { x: cx, y: startY + i * (btnH + btnGap), w: btnW, h: btnH,
        text: b.label, fill: b.fill, textColor: b.textColor, onClick: b.action });
    });

    // Monster team preview — a flat card strip along the bottom.
    const monsters = character.activeMonsters || [];
    const teamY = k.height() - 112;
    addLabel(k, { x: cx, y: teamY - 44, text: "YOUR TEAM", size: 15, color: THEME.textMut });

    const slot = 96;
    const teamStartX = cx - (Math.max(1, monsters.length) * slot) / 2 + slot / 2;
    monsters.forEach((mon, i) => {
      const x = teamStartX + i * slot;
      addPanel(k, { x, y: teamY, w: 80, h: 80, radius: 14, fill: THEME.surface });
      const spriteName = mon.typeName.toLowerCase().replace(/\s+/g, "_");
      try {
        k.add([k.sprite(spriteName), k.pos(x, teamY - 4), k.anchor("center"), k.scale(0.4)]);
      } catch {
        k.add([k.rect(48, 48, { radius: 10 }), k.pos(x, teamY - 4), k.anchor("center"), k.color(...THEME.surfaceAlt)]);
      }
      addLabel(k, { x, y: teamY + 30, text: `Lv.${mon.level}`, size: 12, color: THEME.textMut });
    });
  });
}
