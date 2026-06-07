import { getCharacter } from "../storage.js";
import { THEME, FONT, addButton, addLabel, addPanel, addMenuBackground, addHeader } from "../ui/theme.js";
import { getMonsterType } from "../engine/gamedata.js";
import { getMonsterStats } from "../engine/stats.js";

export default function lobbyScene(k) {
  k.scene("lobby", ({ characterId }) => {
    const character = getCharacter(characterId);
    if (!character) {
      k.go("characterSelect");
      return;
    }

    const cx = k.width() / 2;

    // Atmospheric backdrop (cover-scaled to fill any aspect ratio)
    addMenuBackground(k);

    // Header
    addHeader(k, { x: cx, y: 44, text: "TAMER'S QUEST", size: 36 });
    addLabel(k, { x: cx, y: 86, text: `${character.name}     Lv ${character.level}`, size: 20, color: THEME.textMut });
    // Currencies color-coded to their game-identity hues (gold = amber, essence =
    // teal) so they read at a glance — matches the Spirit Shop's currency display.
    addLabel(k, { x: cx - 12, y: 110, anchor: "right", text: `${character.gold || 0} gold`, size: 15, color: THEME.amber });
    addLabel(k, { x: cx + 12, y: 110, anchor: "left", text: `${character.essence || 0} essence`, size: 15, color: THEME.teal });

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
        action: () => k.go("bestiary", { backScene: "lobby", backArgs: { characterId }, characterId }) },
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
        k.add([k.sprite(spriteName), k.pos(x, teamY - 6), k.anchor("center"), k.scale(0.4)]);
      } catch {
        k.add([k.rect(48, 48, { radius: 10 }), k.pos(x, teamY - 6), k.anchor("center"), k.color(...THEME.surfaceAlt)]);
      }
      // GP-9: team HP bar — SP monsters keep HP between runs (healed only on
      // extract), so an injured/fainted team is otherwise invisible before you
      // commit to a run. Mirrors the MP roster card's bar + colour thresholds.
      const mt = getMonsterType(mon.typeName);
      let maxHp = mon.currentHealth;
      try { maxHp = getMonsterStats(mt, mon.level).health; } catch {}
      const frac = maxHp > 0 ? Math.max(0, Math.min(1, (mon.currentHealth ?? maxHp) / maxHp)) : 1;
      const barC = frac > 0.5 ? THEME.success : frac > 0.25 ? THEME.warn : THEME.danger;
      const barW = 56;
      k.add([k.rect(barW, 4, { radius: 2 }), k.pos(x - barW / 2, teamY + 16), k.anchor("topleft"), k.color(...THEME.line)]);
      if (frac > 0) k.add([k.rect(barW * frac, 4, { radius: 2 }), k.pos(x - barW / 2, teamY + 16), k.anchor("topleft"), k.color(...barC)]);
      addLabel(k, { x, y: teamY + 30, text: `Lv.${mon.level}`, size: 12, color: THEME.textMut });
    });
  });
}
