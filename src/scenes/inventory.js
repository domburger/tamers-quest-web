import { getCharacter, saveCharacter } from "../storage.js";
import { getMonsterType, getMonsterStats, getSpiritChain, getSpiritChains } from "../data.js";
import { craftUpgrade, upgradeTargetFor, upgradeCost, GAME } from "../engine/schemas.js";
import { vaultCapacity } from "../engine/upgrades.js"; // LS-17: Deep-Vault-aware vault capacity
import { equipChain, releaseMonster } from "../engine/inventory.js"; // PARITY-3: shared chain-equip + release rules (SP↔MP)
import { chainCatchSummary } from "../engine/spiritchains.js"; // INV-T3: "can my chain catch this" readout
import { chainColor } from "../render/spiritchain.js";
import { THEME, elementColor, addMenuBackground, addHeader, addButton } from "../ui/theme.js";

export default function inventoryScene(k) {
  k.scene("inventory", ({ characterId }) => {
    const character = getCharacter(characterId);
    if (!character) {
      k.go("characterSelect");
      return;
    }

    addMenuBackground(k);

    addHeader(k, { x: k.width() / 2, y: 36, text: "INVENTORY", size: 34 });

    let selected = null; // { section: "active"|"vault", index: number }
    let tab = "monsters"; // "monsters" | "chains"
    let vaultScroll = 0;
    let vaultWarn = false; // INV-T2: flash the count when a move-to-vault is refused (vault full)
    let pendingRelease = false; // INV-T7: a release awaiting confirm (destructive → two-step)
    let releaseMsg = ""; // INV-T7: transient outcome line ("Released X  +Ng +M essence")
    const VAULT_VISIBLE = 5;
    const SLOT_H = 80;
    const SLOT_GAP = 8;
    const SLOT_W = Math.min(280, Math.floor((k.width() - 40) / 2));

    const activeX = k.width() / 4 - SLOT_W / 2;
    const vaultX = (k.width() * 3) / 4 - SLOT_W / 2;
    const listTop = 140;

    function render() {
      k.destroyAll("invUI");
      drawTabs();
      if (tab === "chains") { renderChains(); return; }
      renderMonsters();
    }

    // Tab switcher (Monsters | Chains) at the top.
    function drawTabs() { // PV-A1: chrome routed through THEME (mirrors MP roster.js)
      const tabs = [["monsters", "Monsters"], ["chains", "Spirit Chains"]];
      const tw = 160, th = 34, gap = 10;
      const startX = k.width() / 2 - (tabs.length * tw + (tabs.length - 1) * gap) / 2;
      tabs.forEach(([id, label], i) => {
        const x = startX + i * (tw + gap);
        const on = tab === id;
        const bg = k.add([
          k.rect(tw, th, { radius: 8 }), k.pos(x, 78), k.color(...(on ? THEME.surface2 : THEME.surfaceAlt)),
          k.outline(2, k.rgb(...(on ? THEME.primary : THEME.line))), k.area(), "invUI",
        ]);
        k.add([k.text(label, { size: 15, font: "gameFont" }), k.pos(x + tw / 2, 78 + th / 2), k.anchor("center"), k.color(...(on ? THEME.text : THEME.textBody)), "invUI"]);
        bg.onClick(() => { if (tab !== id) { tab = id; selected = null; render(); } });
      });
    }

    function renderMonsters() {
      const active = character.activeMonsters || [];
      const vault = character.vaultMonsters || [];

      // Section headers
      k.add([
        k.text("Active Team", { size: 22, font: "gameFont" }),
        k.pos(k.width() / 4, 100),
        k.anchor("center"),
        k.color(...THEME.text),
        "invUI",
      ]);

      k.add([
        k.text("Vault", { size: 22, font: "gameFont" }),
        k.pos((k.width() * 3) / 4, 100),
        k.anchor("center"),
        k.color(...THEME.text),
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
        // New-player guidance: an empty vault otherwise gives no hint how to fill it.
        k.add([
          k.text("Catch monsters with spirit chains\nto store extras here.", { size: 13, font: "gameFont", align: "center", width: SLOT_W + 60 }),
          k.pos((k.width() * 3) / 4, listTop + 56),
          k.anchor("center"),
          k.color(...THEME.textMut),
          "invUI",
        ]);
        k.add([
          k.text("Vault is empty", { size: 16, font: "gameFont" }),
          k.pos((k.width() * 3) / 4, listTop + 30),
          k.anchor("center"),
          k.color(...THEME.textMut),
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

        // Scroll buttons — real themed buttons (hover glow + sheen + consistent
        // radius) instead of the flat radius-4 rects they used to be.
        if (vaultScroll > 0) {
          addButton(k, { x: vaultX + SLOT_W / 2, y: listTop - 32 + 14, w: SLOT_W, h: 28,
            text: "^ Scroll Up", size: 13, radius: 8, fill: THEME.surfaceAlt, textColor: THEME.text,
            tag: "invUI", onClick: () => { vaultScroll = Math.max(0, vaultScroll - 1); render(); } });
        }

        if (vaultScroll + VAULT_VISIBLE < vault.length) {
          const downY = listTop + VAULT_VISIBLE * (SLOT_H + SLOT_GAP);
          addButton(k, { x: vaultX + SLOT_W / 2, y: downY + 14, w: SLOT_W, h: 28,
            text: "v Scroll Down", size: 13, radius: 8, fill: THEME.surfaceAlt, textColor: THEME.text,
            tag: "invUI", onClick: () => { vaultScroll++; render(); } });
        }

        // Vault count (INV-T2: turns warn-colored + "FULL" when a move is refused)
        const vaultCap = vaultCapacity(character, GAME.VAULT_SIZE);
        k.add([
          k.text(`${vault.length} / ${vaultCap}${vaultWarn ? "  VAULT FULL" : ""}`, { size: 13, font: "gameFont" }),
          k.pos((k.width() * 3) / 4, 118),
          k.anchor("center"),
          k.color(...(vaultWarn ? THEME.warn : THEME.textMut)),
          "invUI",
        ]);
      }

      // INV-T3: full-detail panel for the selected monster (centre column).
      const sel = selectedMonster();
      if (sel) drawDetail(sel);

      // INV-T7: release the selected monster (two-step confirm — it's destructive).
      if (sel) {
        const cy = k.height() - 78;
        if (!pendingRelease) {
          addButton(k, {
            x: k.width() / 2, y: cy, w: 200, h: 40, text: "Release", size: 16,
            fill: THEME.surfaceAlt, textColor: THEME.danger, tag: "invUI",
            onClick: () => { pendingRelease = true; releaseMsg = ""; render(); },
          });
        } else {
          k.add([
            k.text(`Release ${sel.name || sel.typeName} for essence + gold?`, { size: 14, font: "gameFont" }),
            k.pos(k.width() / 2, cy - 26), k.anchor("center"), k.color(...THEME.warn), "invUI",
          ]);
          addButton(k, {
            x: k.width() / 2 - 108, y: cy, w: 196, h: 40, text: "Confirm release", size: 15,
            fill: THEME.danger, textColor: THEME.textInv, tag: "invUI", onClick: confirmRelease,
          });
          addButton(k, {
            x: k.width() / 2 + 108, y: cy, w: 196, h: 40, text: "Cancel", size: 15,
            fill: THEME.surfaceAlt, textColor: THEME.text, tag: "invUI",
            onClick: () => { pendingRelease = false; render(); },
          });
        }
      }

      // Hint text (or the transient release outcome).
      const hintText = releaseMsg
        ? releaseMsg
        : selected
          ? "Click another slot to swap, or click again to deselect."
          : "Click a monster to select it for swapping.";
      k.add([
        k.text(hintText, { size: 14, font: "gameFont" }),
        k.pos(k.width() / 2, k.height() - 40),
        k.anchor("center"),
        k.color(...(releaseMsg ? THEME.success : THEME.textMut)),
        "invUI",
      ]);
    }

    // The actual monster object behind the current selection (null on an empty slot).
    function selectedMonster() {
      if (!selected) return null;
      const list = selected.section === "active" ? character.activeMonsters : character.vaultMonsters;
      return (list && list[selected.index]) || null;
    }

    function confirmRelease() {
      const mon = selectedMonster();
      pendingRelease = false;
      if (!mon) { render(); return; }
      const r = releaseMonster(character, mon.id);
      if (r.ok) {
        saveCharacter(character);
        releaseMsg = `Released ${mon.name || mon.typeName}  +${r.reward.gold}g  +${r.reward.essence} essence`;
        selected = null;
        vaultScroll = 0; // the list shrank; avoid scrolling past the end
      } else {
        releaseMsg = r.reason === "last-monster"
          ? "You can't release your last monster."
          : "Couldn't release that monster.";
      }
      render();
    }

    function renderSlot(mon, x, y, section, index, isSelected) {
      const monType = mon ? getMonsterType(mon.typeName) : null;
      // Element-colored accent (consistency with the MP roster / bestiary); the
      // selected card gets the teal primary + a thicker outline to stand out.
      const accent = isSelected ? THEME.primary : (monType ? elementColor(monType.element) : THEME.line);
      const bgColor = isSelected ? THEME.surface2 : THEME.surface;

      const slot = k.add([
        k.rect(SLOT_W, SLOT_H, { radius: 8 }),
        k.pos(x, y),
        k.color(...bgColor),
        k.outline(isSelected ? 3 : 2, k.rgb(...accent)),
        k.area(),
        "invUI",
      ]);
      // Top sheen — addPanel parity (matches the cosmetics/roster/MP-card sweep).
      k.add([k.rect(SLOT_W - 12, 12, { radius: 6 }), k.pos(x + 6, y + 3),
        k.color(...THEME.surface2), k.opacity(0.45), "invUI"]);

      if (!mon) {
        k.add([
          k.text("( empty )", { size: 14, font: "gameFont" }),
          k.pos(x + SLOT_W / 2, y + SLOT_H / 2),
          k.anchor("center"),
          k.color(...THEME.textMut),
          "invUI",
        ]);
        slot.onClick(() => handleSlotClick(section, index));
        return;
      }

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
          k.color(...THEME.surfaceAlt),
          "invUI",
        ]);
      }

      k.add([
        k.text(mon.name || mon.typeName, { size: 16, font: "gameFont" }),
        k.pos(x + 75, y + 12),
        k.color(...THEME.text),
        "invUI",
      ]);

      const element = monType ? monType.element : "?";
      k.add([
        k.text(`Lv.${mon.level}  ${element}`, { size: 13, font: "gameFont" }),
        k.pos(x + 75, y + 34),
        k.color(...THEME.textBody),
        "invUI",
      ]);

      if (stats) {
        const frac = stats.health > 0 ? Math.max(0, Math.min(1, mon.currentHealth / stats.health)) : 1;
        const barC = mon.currentHealth <= 0 ? THEME.danger
          : frac > 0.5 ? THEME.success : frac > 0.25 ? THEME.warn : THEME.danger;
        k.add([
          k.text(
            `HP:${mon.currentHealth}/${stats.health}  STR:${stats.strength}  DEF:${stats.defense}`,
            { size: 11, font: "gameFont" }
          ),
          k.pos(x + 75, y + 52),
          k.color(...THEME.textMut),
          "invUI",
        ]);
        // HP bar — at-a-glance, matching the MP roster + SP lobby thresholds.
        const barW = SLOT_W - 90;
        k.add([k.rect(barW, 5, { radius: 2 }), k.pos(x + 75, y + 70), k.color(...THEME.line), "invUI"]);
        if (frac > 0) k.add([k.rect(barW * frac, 5, { radius: 2 }), k.pos(x + 75, y + 70), k.color(...barC), "invUI"]);
      }

      slot.onClick(() => handleSlotClick(section, index));
    }

    // INV-T3: centre-column detail panel for the selected monster — full stats,
    // element/rarity/level, HP, XP-to-next + bar, and the flavor description, so a
    // player can read a monster before fielding/storing/releasing it (SP parity with
    // the MP roster inspect). Drawn between the two slot columns; tagged "invUI".
    function drawDetail(mon) {
      const mt = getMonsterType(mon.typeName);
      const ec = mt ? elementColor(mt.element) : THEME.textMut;
      const dw = 300, dx = k.width() / 2 - dw / 2, dy = 140;
      const dh = Math.min(470, k.height() - 110 - dy);
      k.add([k.rect(dw, dh, { radius: 14 }), k.pos(dx, dy), k.color(...THEME.surface), k.outline(2, k.rgb(...ec)), "invUI"]);
      // Top sheen on the detail panel — addPanel parity.
      k.add([k.rect(dw - 16, 18, { radius: 9 }), k.pos(dx + 8, dy + 5),
        k.color(...THEME.surface2), k.opacity(0.5), "invUI"]);
      const cx = dx + 20, midX = dx + dw / 2;
      const sn = mon.typeName.toLowerCase().replace(/\s+/g, "_");
      try { k.add([k.sprite(sn), k.pos(midX, dy + 56), k.anchor("center"), k.scale(0.7), "invUI"]); } catch { /* sprite not ready */ }
      k.add([k.text(mon.name || mon.typeName, { size: 18, font: "gameFont", width: dw - 40 }), k.pos(midX, dy + 104), k.anchor("center"), k.color(...THEME.text), "invUI"]);
      k.add([k.text(`${mt?.element || "?"}${mt?.rarity ? `   ${mt.rarity}` : ""}     Lv.${mon.level}`, { size: 13, font: "gameFont" }), k.pos(midX, dy + 128), k.anchor("center"), k.color(...ec), "invUI"]);
      const stats = mt ? getMonsterStats(mt, mon.level) : {};
      const maxHp = stats.health || Math.round(mon.currentHealth) || 1;
      k.add([k.text(`HP ${Math.round(mon.currentHealth ?? maxHp)} / ${maxHp}`, { size: 13, font: "gameFont" }), k.pos(midX, dy + 150), k.anchor("center"), k.color(...THEME.textBody), "invUI"]);
      // XP-to-next (m.xp is per-level progress vs GAME.XP_PER_LEVEL).
      const xpCur = Math.max(0, Math.min(GAME.XP_PER_LEVEL, mon.xp || 0));
      const xpFrac = GAME.XP_PER_LEVEL > 0 ? xpCur / GAME.XP_PER_LEVEL : 0;
      k.add([k.text(`XP ${xpCur} / ${GAME.XP_PER_LEVEL}   (${GAME.XP_PER_LEVEL - xpCur} to Lv.${mon.level + 1})`, { size: 11, font: "gameFont" }), k.pos(midX, dy + 172), k.anchor("center"), k.color(...THEME.textMut), "invUI"]);
      const barW = dw - 60;
      k.add([k.rect(barW, 5, { radius: 2 }), k.pos(cx + 10, dy + 190), k.color(...THEME.line), "invUI"]);
      if (xpFrac > 0) k.add([k.rect(barW * xpFrac, 5, { radius: 2 }), k.pos(cx + 10, dy + 190), k.color(...THEME.primary), "invUI"]);
      // Catch-feasibility against the equipped chain (INV-T3): chains gate by rarity,
      // so this tells the player whether their chain can take a monster like this one.
      const chain = character.equippedChainId ? getSpiritChain(character.equippedChainId) : null;
      const cs = chainCatchSummary(chain, mt?.rarity ?? 1);
      k.add([k.text(`${chain?.name ? chain.name + ": " : ""}${cs.text}`, { size: 11, font: "gameFont", width: dw - 40 }), k.pos(cx, dy + 204), k.color(...(cs.ok ? THEME.success : THEME.warn)), "invUI"]);
      // Full stat block.
      const statY = dy + 226;
      k.add([k.text("STATS", { size: 12, font: "gameFont" }), k.pos(cx, statY), k.color(...THEME.primary), "invUI"]);
      ["health", "strength", "defense", "speed", "power", "energy", "luck"].forEach((st, i) => {
        const sy = statY + 20 + i * 19;
        k.add([k.text(st, { size: 12, font: "gameFont" }), k.pos(cx, sy), k.color(...THEME.textMut), "invUI"]);
        k.add([k.text(`${stats[st] ?? "?"}`, { size: 12, font: "gameFont" }), k.pos(dx + dw - 24, sy), k.anchor("topright"), k.color(...THEME.text), "invUI"]);
      });
      // Flavor description (wrapped), if the type carries one — only when there's
      // room below the stats inside the panel (audit MED: on short viewports dh
      // shrinks but the content didn't, so the description drew outside the box).
      const descY = statY + 20 + 7 * 19 + 6;
      if (mt?.description && descY < dy + dh - 30) {
        k.add([k.text(mt.description, { size: 11, font: "gameFont", width: dw - 40 }), k.pos(cx, descY), k.color(...THEME.textMut), "invUI"]);
      }
    }

    function handleSlotClick(section, index) {
      vaultWarn = false; // clear a prior "vault full" warning on the next interaction
      pendingRelease = false; // any slot interaction cancels a pending release
      releaseMsg = ""; // and clears the last outcome line
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
          // INV-T2 (SP/MP parity): respect the Deep-Vault-aware cap. MP's clampRoster
          // truncates overflow, but dropping a monster the player just moved is a bad
          // interactive UX — refuse the move and flash "VAULT FULL" instead.
          if (character.vaultMonsters.length >= vaultCapacity(character, GAME.VAULT_SIZE)) {
            vaultWarn = true;
            selected = null;
            render();
            return;
          }
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

    // Spirit Chains tab: owned chains with throws/durability + equip-on-click.
    function renderChains() {
      const chains = character.chains || [];
      const defs = getSpiritChains();
      // Essence balance (crafting currency).
      k.add([k.text(`Spirit Essence: ${character.essence || 0}`, { size: 15, font: "gameFont" }), k.pos(k.width() / 2, 122), k.anchor("center"), k.color(...THEME.text), "invUI"]);
      if (chains.length === 0) {
        k.add([
          k.text("No spirit chains. Find chests in a run or visit the Spirit Shop.", { size: 16, font: "gameFont", width: k.width() - 120 }),
          k.pos(k.width() / 2, 190), k.anchor("center"), k.color(...THEME.textMut), "invUI",
        ]);
      }
      const rowW = Math.min(480, k.width() - 60), rowH = 56, gap = 10, top = 146;
      const x0 = k.width() / 2 - rowW / 2;
      chains.forEach((cs, i) => {
        const def = getSpiritChain(cs.chainId);
        if (!def) return;
        const y = top + i * (rowH + gap);
        const equipped = character.equippedChainId === cs.chainId;
        k.add([
          k.rect(rowW, rowH, { radius: 8 }), k.pos(x0, y), k.color(...(equipped ? THEME.surface2 : THEME.surface)),
          k.outline(2, k.rgb(...(equipped ? THEME.primary : THEME.line))), "invUI",
        ]);
        // Top sheen — addPanel parity (matches the sweep across cosmetics/roster).
        k.add([k.rect(rowW - 12, 12, { radius: 6 }), k.pos(x0 + 6, y + 3),
          k.color(...THEME.surface2), k.opacity(0.45), "invUI"]);
        const c = chainColor(def);
        k.add([k.circle(10), k.pos(x0 + 24, y + rowH / 2), k.anchor("center"), k.color(...c), "invUI"]);
        k.add([k.text(`${def.name}   T${def.tier}${def.special ? "  special" : ""}`, { size: 14, font: "gameFont" }), k.pos(x0 + 44, y + 9), k.color(...THEME.text), "invUI"]);
        const throws = cs.throwCount == null ? "∞" : String(cs.throwCount);
        k.add([k.text(`Throws ${throws}   Charges ${cs.durability}`, { size: 11, font: "gameFont" }), k.pos(x0 + 44, y + 31), k.color(...THEME.textBody), "invUI"]);

        // Equip button.
        const ebW = 78, ebH = 30, ebX = x0 + rowW - ebW - 10, ebY = y + (rowH - ebH) / 2;
        const eBtn = k.add([k.rect(ebW, ebH, { radius: 6 }), k.pos(ebX, ebY), k.color(...(equipped ? THEME.surfaceAlt : THEME.primary)), k.area(), "invUI"]);
        k.add([k.text(equipped ? "Equipped" : "Equip", { size: 12, font: "gameFont" }), k.pos(ebX + ebW / 2, ebY + ebH / 2), k.anchor("center"), k.color(...(equipped ? THEME.textMut : THEME.textInv)), "invUI"]);
        if (!equipped) eBtn.onClick(() => { if (equipChain(character, cs.chainId)) { saveCharacter(character); render(); } });

        // Upgrade button (craft): only for base tiers with a next tier.
        const target = upgradeTargetFor(def, defs);
        if (target) {
          const cost = upgradeCost(def.tier);
          const can = (character.essence || 0) >= cost;
          const ubW = 96, ubH = 30, ubX = ebX - ubW - 8, ubY = ebY;
          const uBtn = k.add([k.rect(ubW, ubH, { radius: 6 }), k.pos(ubX, ubY), k.color(...(can ? THEME.violet : THEME.surfaceAlt)), k.area(), "invUI"]);
          k.add([k.text(`Up ${cost}e`, { size: 12, font: "gameFont" }), k.pos(ubX + ubW / 2, ubY + ubH / 2), k.anchor("center"), k.color(...(can ? THEME.textInv : THEME.textMut)), "invUI"]);
          uBtn.onClick(() => {
            const r = craftUpgrade(character, cs.chainId, defs);
            if (r.ok) saveCharacter(character);
            render();
          });
        }
      });
    }

    render();

    // Back button — a real themed button (chrome + hover glow + SFX) matching the
    // nav buttons elsewhere, instead of the bare-text link this used to be.
    addButton(k, { x: 92, y: 44, w: 124, h: 40, text: "< Back", size: 18,
      fill: THEME.surface, textColor: THEME.text, onClick: () => k.go("lobby", { characterId }) });
    k.onKeyPress("escape", () => k.go("lobby", { characterId })); // VS-15: Escape = Back (menu-nav consistency)
  });
}
