import { getCharacter, saveCharacter } from "../storage.js";
import { getMonsterType, getMonsterStats } from "../data.js";

export default function inventoryScene(k) {
  k.scene("inventory", ({ characterId }) => {
    const character = getCharacter(characterId);
    if (!character) {
      k.go("characterSelect");
      return;
    }

    k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(12, 12, 22)]);

    k.add([
      k.text("Inventory", { size: 38, font: "gameFont" }),
      k.pos(k.width() / 2, 40),
      k.anchor("center"),
      k.color(255, 255, 255),
    ]);

    let selected = null; // { section: "active"|"vault", index: number }
    let vaultScroll = 0;
    const VAULT_VISIBLE = 5;
    const SLOT_H = 80;
    const SLOT_GAP = 8;
    const SLOT_W = 280;

    const activeX = k.width() / 4 - SLOT_W / 2;
    const vaultX = (k.width() * 3) / 4 - SLOT_W / 2;
    const listTop = 140;

    function render() {
      k.destroyAll("invUI");

      const active = character.activeMonsters || [];
      const vault = character.vaultMonsters || [];

      // Section headers
      k.add([
        k.text("Active Team", { size: 22, font: "gameFont" }),
        k.pos(k.width() / 4, 100),
        k.anchor("center"),
        k.color(255, 255, 255),
        "invUI",
      ]);

      k.add([
        k.text("Vault", { size: 22, font: "gameFont" }),
        k.pos((k.width() * 3) / 4, 100),
        k.anchor("center"),
        k.color(255, 255, 255),
        "invUI",
      ]);

      // Active team slots (always 4 — empty slots shown)
      for (let i = 0; i < 4; i++) {
        const y = listTop + i * (SLOT_H + SLOT_GAP);
        const mon = active[i];
        const isSelected = selected && selected.section === "active" && selected.index === i;
        renderSlot(mon, activeX, y, "active", i, isSelected);
      }

      // Vault slots
      if (vault.length === 0) {
        k.add([
          k.text("Vault is empty", { size: 16, font: "gameFont" }),
          k.pos((k.width() * 3) / 4, listTop + 30),
          k.anchor("center"),
          k.color(100, 100, 120),
          "invUI",
        ]);
      } else {
        const visibleVault = vault.slice(vaultScroll, vaultScroll + VAULT_VISIBLE);
        visibleVault.forEach((mon, i) => {
          const globalIdx = vaultScroll + i;
          const y = listTop + i * (SLOT_H + SLOT_GAP);
          const isSelected = selected && selected.section === "vault" && selected.index === globalIdx;
          renderSlot(mon, vaultX, y, "vault", globalIdx, isSelected);
        });

        // Scroll buttons
        if (vaultScroll > 0) {
          const upBtn = k.add([
            k.rect(SLOT_W, 28, { radius: 4 }),
            k.pos(vaultX, listTop - 32),
            k.color(40, 40, 60),
            k.area(),
            "invUI",
          ]);
          k.add([
            k.text("^ Scroll Up", { size: 13, font: "gameFont" }),
            k.pos(vaultX + SLOT_W / 2, listTop - 18),
            k.anchor("center"),
            k.color(255, 255, 255),
            "invUI",
          ]);
          upBtn.onClick(() => { vaultScroll = Math.max(0, vaultScroll - 1); render(); });
        }

        if (vaultScroll + VAULT_VISIBLE < vault.length) {
          const downY = listTop + VAULT_VISIBLE * (SLOT_H + SLOT_GAP);
          const downBtn = k.add([
            k.rect(SLOT_W, 28, { radius: 4 }),
            k.pos(vaultX, downY),
            k.color(40, 40, 60),
            k.area(),
            "invUI",
          ]);
          k.add([
            k.text("v Scroll Down", { size: 13, font: "gameFont" }),
            k.pos(vaultX + SLOT_W / 2, downY + 14),
            k.anchor("center"),
            k.color(255, 255, 255),
            "invUI",
          ]);
          downBtn.onClick(() => { vaultScroll++; render(); });
        }

        // Vault count
        k.add([
          k.text(`${vault.length} / 100`, { size: 13, font: "gameFont" }),
          k.pos((k.width() * 3) / 4, 118),
          k.anchor("center"),
          k.color(80, 80, 100),
          "invUI",
        ]);
      }

      // Hint text
      const hintText = selected
        ? "Click another slot to swap, or click again to deselect."
        : "Click a monster to select it for swapping.";
      k.add([
        k.text(hintText, { size: 14, font: "gameFont" }),
        k.pos(k.width() / 2, k.height() - 40),
        k.anchor("center"),
        k.color(255, 255, 255),
        "invUI",
      ]);
    }

    function renderSlot(mon, x, y, section, index, isSelected) {
      const outlineColor = isSelected
        ? k.Color.fromHex("#ffcc00")
        : k.Color.fromHex("#444444");
      const bgColor = isSelected ? k.rgb(50, 45, 30) : k.rgb(30, 30, 50);

      const slot = k.add([
        k.rect(SLOT_W, SLOT_H, { radius: 8 }),
        k.pos(x, y),
        k.color(bgColor),
        k.outline(isSelected ? 2 : 1, outlineColor),
        k.area(),
        "invUI",
      ]);

      if (!mon) {
        k.add([
          k.text("( empty )", { size: 14, font: "gameFont" }),
          k.pos(x + SLOT_W / 2, y + SLOT_H / 2),
          k.anchor("center"),
          k.color(60, 60, 80),
          "invUI",
        ]);
        slot.onClick(() => handleSlotClick(section, index));
        return;
      }

      const monType = getMonsterType(mon.typeName);
      const stats = monType ? getMonsterStats(monType, mon.level) : null;

      const spriteName = mon.typeName.toLowerCase().replace(/\s+/g, "_");
      try {
        k.add([
          k.sprite(spriteName),
          k.pos(x + 40, y + 40),
          k.anchor("center"),
          k.scale(0.3),
          "invUI",
        ]);
      } catch {
        k.add([
          k.rect(48, 48, { radius: 4 }),
          k.pos(x + 16, y + 16),
          k.color(50, 50, 70),
          "invUI",
        ]);
      }

      k.add([
        k.text(mon.name || mon.typeName, { size: 16, font: "gameFont" }),
        k.pos(x + 75, y + 12),
        k.color(255, 255, 255),
        "invUI",
      ]);

      const element = monType ? monType.element : "?";
      k.add([
        k.text(`Lv.${mon.level}  ${element}`, { size: 13, font: "gameFont" }),
        k.pos(x + 75, y + 34),
        k.color(220, 220, 230),
        "invUI",
      ]);

      if (stats) {
        const hpColor = mon.currentHealth <= 0
          ? k.rgb(180, 60, 60)
          : k.rgb(120, 120, 140);
        k.add([
          k.text(
            `HP:${mon.currentHealth}/${stats.health} STR:${stats.strength} DEF:${stats.defense}`,
            { size: 11, font: "gameFont" }
          ),
          k.pos(x + 75, y + 56),
          k.color(hpColor),
          "invUI",
        ]);
      }

      slot.onClick(() => handleSlotClick(section, index));
    }

    function handleSlotClick(section, index) {
      if (!selected) {
        const list = section === "active" ? character.activeMonsters : character.vaultMonsters;
        if (!list || !list[index]) return;
        selected = { section, index };
        render();
        return;
      }

      // Clicking the same slot — deselect
      if (selected.section === section && selected.index === index) {
        selected = null;
        render();
        return;
      }

      // Swap between two slots
      const srcList = selected.section === "active" ? character.activeMonsters : character.vaultMonsters;
      const dstList = section === "active" ? character.activeMonsters : character.vaultMonsters;
      const srcIdx = selected.index;
      const dstIdx = index;

      if (selected.section === section) {
        // Same section — swap positions
        const temp = srcList[srcIdx];
        srcList[srcIdx] = srcList[dstIdx];
        srcList[dstIdx] = temp;
      } else {
        // Different sections — swap or move
        const srcMon = srcList[srcIdx];
        const dstMon = dstList[dstIdx];

        if (dstMon) {
          // Swap
          srcList[srcIdx] = dstMon;
          dstList[dstIdx] = srcMon;
        } else if (section === "active" && selected.section === "vault") {
          // Move vault → active empty slot
          if (dstIdx < 4) {
            if (!character.activeMonsters[dstIdx]) {
              character.activeMonsters[dstIdx] = srcMon;
              character.vaultMonsters.splice(srcIdx, 1);
            }
          }
        } else if (section === "vault" && selected.section === "active") {
          // Move active → vault (but keep at least 1 active)
          const aliveActive = character.activeMonsters.filter((m, i) => m && i !== srcIdx);
          if (aliveActive.length === 0) {
            selected = null;
            render();
            return;
          }
          if (!character.vaultMonsters) character.vaultMonsters = [];
          character.vaultMonsters.push(srcMon);
          character.activeMonsters[srcIdx] = null;
        }
      }

      // Clean up: remove nulls from active, ensure at least one monster
      character.activeMonsters = character.activeMonsters.filter(Boolean);
      if (character.activeMonsters.length === 0 && character.vaultMonsters?.length > 0) {
        character.activeMonsters.push(character.vaultMonsters.shift());
      }

      saveCharacter(character);
      selected = null;
      render();
    }

    render();

    // Back button
    const backBtn = k.add([
      k.text("< Back", { size: 20, font: "gameFont" }),
      k.pos(30, 30),
      k.anchor("topleft"),
      k.color(255, 255, 255),
      k.area(),
    ]);

    backBtn.onClick(() => {
      k.go("lobby", { characterId });
    });
  });
}
