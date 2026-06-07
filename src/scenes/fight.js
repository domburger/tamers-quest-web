import { getMonsterType, getAttacksForMonster, getMonsterStats, getSpiritChain } from "../data.js";
import { getCharacter, saveCharacter } from "../storage.js";
import { chooseEnemyAttack, evaluateTurn, evaluateCatch } from "../systems/combat.js";
import { drawCaptureAnimation, chainColor } from "../render/spiritchain.js";
import { GAME, goldForDefeat, finalizeRunChains } from "../engine/schemas.js";
import { goldMult, essenceMult } from "../engine/upgrades.js";
import { grantXp } from "../engine/progression.js";
import { uid } from "../uid.js";
import { THEME } from "../ui/theme.js";
import { sfx, haptic } from "../systems/audio.js"; // SP-combat SFX + haptics (P8-T6 / MB-12)

const STATE = {
  PLAYER_MENU: 0,
  ATTACK_SELECT: 1,
  SWAP_SELECT: 2,
  RESOLVING: 3,
  FIGHT_WON: 4,
  FIGHT_LOST: 5,
  PLAYER_FLED: 6,
  MONSTER_CAUGHT: 7,
};

export default function fightScene(k) {
  k.scene("fight", ({ characterId, monster, mapData, playerPos, elapsed, portals, initiator, chainId, queue = [] }) => {
    const character = getCharacter(characterId);
    if (!character) { k.go("characterSelect"); return; }

    // Initiative (from a thrown chain or a walk-into) applies to the FIRST turn
    // only, then reverts to speed order.
    let firstTurn = true;
    const turnInitiator = initiator === "player" || initiator === "enemy" ? initiator : "monster";
    // Translate the scene's "monster" initiator to the engine's "enemy".
    const engineInitiator = turnInitiator === "monster" ? "enemy" : turnInitiator;
    // The chain used to engage (its tier modifies capture); falls back to the
    // player's equipped chain so the in-fight Catch button always has a chain.
    function getChainDef() {
      const id = chainId || character.equippedChainId;
      return id ? getSpiritChain(id) : null;
    }

    const team = character.activeMonsters || [];
    let activeIdx = team.findIndex((m) => m.currentHealth > 0);
    if (activeIdx < 0) {
      // No usable monster → the run ends (defeat-like): forfeit run-found chains,
      // matching the server and game.js timeout path.
      finalizeRunChains(character, false, getSpiritChain);
      saveCharacter(character);
      k.go("runResult", { characterId, result: "timeout" });
      return;
    }

    // Reset enemy to full HP/energy for this fight
    const enemyType = getMonsterType(monster.typeName);
    const enemyStats = getMonsterStats(enemyType, monster.level);
    monster.currentHealth = enemyStats.health;
    monster.currentEnergy = enemyStats.energy;
    monster.status = null;

    let state = STATE.PLAYER_MENU;
    let narrative = `A wild ${monster.name} (Lv.${monster.level}) appeared!`;
    let pendingAction = null;

    function getActiveMonster() { return team[activeIdx]; }
    function getActiveType() { return getMonsterType(getActiveMonster().typeName); }
    function getActiveStats() { return getMonsterStats(getActiveType(), getActiveMonster().level); }

    // XP / leveling comes from the shared engine module (P10-T4) so SP and the
    // server can't drift — see the `grantXp` import above.

    // ─── Background ─── atmospheric arena backdrop (caveDeep rect as fallback).
    k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(...THEME.caveDeep)]);
    try { k.add([k.sprite("combat_background"), k.pos(k.width() / 2, k.height() / 2), k.anchor("center")]); } catch {}

    // ─── Battle arena (sprites face each other) ───
    // Player monster (left side)
    const playerSpriteTag = "playerMonSprite";
    function updatePlayerSprite() {
      k.destroyAll(playerSpriteTag);
      const pm = getActiveMonster();
      const spriteName = pm.typeName.toLowerCase().replace(/\s+/g, "_");
      try {
        k.add([
          k.sprite(spriteName),
          k.pos(k.width() * 0.25, 170),
          k.anchor("center"),
          k.scale(2),
          playerSpriteTag,
        ]);
      } catch {
        k.add([
          k.rect(80, 80, { radius: 8 }),
          k.pos(k.width() * 0.25, 170),
          k.anchor("center"),
          k.color(...THEME.surfaceAlt),
          playerSpriteTag,
        ]);
      }
    }
    updatePlayerSprite();

    // Enemy monster (right side)
    const enemySpriteName = monster.typeName.toLowerCase().replace(/\s+/g, "_");
    try {
      k.add([
        k.sprite(enemySpriteName),
        k.pos(k.width() * 0.75, 170),
        k.anchor("center"),
        k.scale(2),
      ]);
    } catch {}

    // ─── Info panels ───
    // Player info (left)
    const playerNameLabel = k.add([
      k.text("", { size: 16, font: "gameFont" }),
      k.pos(k.width() * 0.25, 250),
      k.anchor("center"),
      k.color(...THEME.text),
    ]);

    const playerStatusLabel = k.add([
      k.text("", { size: 13, font: "gameFont" }),
      k.pos(k.width() * 0.25 + 100, 250),
      k.anchor("left"),
      k.color(...THEME.warn),
    ]);

    const hpBarW = 200, barH = 12;
    const pBarX = k.width() * 0.25 - hpBarW / 2;
    k.add([k.rect(hpBarW, barH, { radius: 6 }), k.pos(pBarX, 270), k.color(...THEME.surfaceAlt)]);
    const playerHpFill = k.add([k.rect(hpBarW, barH, { radius: 6 }), k.pos(pBarX, 270), k.color(...THEME.success)]);
    const playerHpText = k.add([
      k.text("", { size: 10, font: "gameFont" }),
      k.pos(k.width() * 0.25, 272),
      k.anchor("center"),
      k.color(...THEME.textInv),
    ]);

    k.add([k.rect(hpBarW, 6, { radius: 3 }), k.pos(pBarX, 286), k.color(...THEME.surfaceAlt)]);
    const playerEnFill = k.add([k.rect(hpBarW, 6, { radius: 3 }), k.pos(pBarX, 286), k.color(...THEME.primary)]);

    // Enemy info (right)
    const enemyNameLabel = k.add([
      k.text(`${monster.name}  Lv.${monster.level}`, { size: 16, font: "gameFont" }),
      k.pos(k.width() * 0.75, 250),
      k.anchor("center"),
      k.color(...THEME.text),
    ]);

    const enemyStatusLabel = k.add([
      k.text("", { size: 13, font: "gameFont" }),
      k.pos(k.width() * 0.75 + 100, 250),
      k.anchor("left"),
      k.color(...THEME.warn),
    ]);

    const enemyBarX = k.width() * 0.75 - hpBarW / 2;
    k.add([k.rect(hpBarW, barH, { radius: 6 }), k.pos(enemyBarX, 270), k.color(...THEME.surfaceAlt)]);
    const enemyHpFill = k.add([k.rect(hpBarW, barH, { radius: 6 }), k.pos(enemyBarX, 270), k.color(...THEME.success)]);
    const enemyHpText = k.add([
      k.text("", { size: 10, font: "gameFont" }),
      k.pos(k.width() * 0.75, 272),
      k.anchor("center"),
      k.color(...THEME.textInv),
    ]);

    k.add([k.rect(hpBarW, 6, { radius: 3 }), k.pos(enemyBarX, 286), k.color(...THEME.surfaceAlt)]);
    const enemyEnFill = k.add([k.rect(hpBarW, 6, { radius: 3 }), k.pos(enemyBarX, 286), k.color(...THEME.primary)]);

    // "VS" divider
    k.add([
      k.text("VS", { size: 28, font: "gameFont" }),
      k.pos(k.width() / 2, 170),
      k.anchor("center"),
      k.color(...THEME.danger),
      k.opacity(0.7),
    ]);

    // ─── Narrative box ───
    k.add([
      k.rect(k.width() - 80, 60, { radius: 12 }),
      k.pos(40, 305),
      k.color(...THEME.surface),
      k.outline(2, k.rgb(...THEME.line)),
    ]);
    const narrativeLabel = k.add([
      k.text(narrative, { size: 14, font: "gameFont", width: k.width() - 120 }),
      k.pos(60, 318),
      k.color(...THEME.text),
    ]);

    // ─── Button area ───
    const btnTag = "fightBtn";
    const btnY = 390;
    const btnW = 200, btnH = 40, btnGap = 10;

    function clearButtons() { k.destroyAll(btnTag); }

    function makeBtn(label, x, y, w, h, color, onClick, enabled = true) {
      const base = enabled ? color : k.rgb(...THEME.surfaceAlt);
      const bg = k.add([
        k.rect(w, h, { radius: 10 }),
        k.pos(x, y),
        k.anchor("center"),
        k.color(base),
        k.area(),
        btnTag,
      ]);
      k.add([
        k.text(label, { size: 16, font: "gameFont" }),
        k.pos(x, y),
        k.anchor("center"),
        k.color(enabled ? k.rgb(...THEME.textInv) : k.rgb(...THEME.textMut)),
        btnTag,
      ]);
      if (enabled) {
        bg.onClick(() => { sfx("click"); haptic(8); onClick(); });
        bg.onHover(() => { k.setCursor("pointer"); sfx("hover"); });
        bg.onHoverUpdate(() => { bg.color = base.lighten(18); });
        bg.onHoverEnd(() => { bg.color = base; k.setCursor("default"); });
      }
      return bg;
    }

    // ─── State rendering ───
    function updateBars() {
      const pm = getActiveMonster();
      const ps = getActiveStats();
      const pt = getActiveType();

      playerNameLabel.text = `${pm.name || pm.typeName}  Lv.${pm.level}`;
      playerHpFill.width = Math.max(0, (pm.currentHealth / ps.health) * hpBarW);
      playerHpText.text = `${pm.currentHealth} / ${ps.health}`;
      playerEnFill.width = Math.max(0, (pm.currentEnergy / ps.energy) * hpBarW);
      playerStatusLabel.text = pm.status ? `[${pm.status}]` : "";

      if (pm.currentHealth / ps.health < 0.25) playerHpFill.color = k.rgb(...THEME.danger);
      else if (pm.currentHealth / ps.health < 0.5) playerHpFill.color = k.rgb(...THEME.warn);
      else playerHpFill.color = k.rgb(...THEME.success);

      enemyHpFill.width = Math.max(0, (monster.currentHealth / enemyStats.health) * hpBarW);
      enemyHpText.text = `${monster.currentHealth} / ${enemyStats.health}`;
      enemyEnFill.width = Math.max(0, (monster.currentEnergy / enemyStats.energy) * hpBarW);
      enemyStatusLabel.text = monster.status ? `[${monster.status}]` : "";

      if (monster.currentHealth / enemyStats.health < 0.25) enemyHpFill.color = k.rgb(...THEME.danger);
      else if (monster.currentHealth / enemyStats.health < 0.5) enemyHpFill.color = k.rgb(...THEME.warn);
      else enemyHpFill.color = k.rgb(...THEME.success);
    }

    function showPlayerMenu() {
      state = STATE.PLAYER_MENU;
      clearButtons();
      const cx = k.width() / 2;
      const col1 = cx - btnW / 2 - btnGap / 2 - btnW / 2;
      const col2 = cx + btnW / 2 + btnGap / 2 - btnW / 2 + btnW;

      // Row 1
      makeBtn("Fight", cx - 110, btnY, btnW, btnH, k.rgb(...THEME.success), () => showAttackSelect());
      makeBtn("Catch", cx + 110, btnY, btnW, btnH, k.rgb(...THEME.primary), () => doCatch());
      // Row 2
      makeBtn("Swap", cx - 110, btnY + btnH + btnGap, btnW, btnH, k.rgb(...THEME.warn), () => showSwapSelect());
      makeBtn("Skip", cx + 110, btnY + btnH + btnGap, btnW, btnH, k.rgb(...THEME.surfaceAlt), () => doSkip());
      // Row 3
      makeBtn("Flee", cx, btnY + (btnH + btnGap) * 2, btnW, btnH, k.rgb(...THEME.danger), () => doFlee());
    }

    function showAttackSelect() {
      state = STATE.ATTACK_SELECT;
      clearButtons();
      const pm = getActiveMonster();
      const mt = getActiveType();
      const attacks = getAttacksForMonster(mt);
      const cx = k.width() / 2;

      attacks.forEach((atk, i) => {
        const canAfford = pm.currentEnergy >= atk.energyCost;
        const row = Math.floor(i / 2);
        const col = i % 2;
        const x = cx + (col === 0 ? -110 : 110);
        const y = btnY + row * (btnH + btnGap);
        const label = `${atk.name} (${atk.energyCost}E)`;
        makeBtn(label, x, y, btnW, btnH, k.rgb(...THEME.success), () => doAttack(atk), canAfford);
      });

      makeBtn("Back", cx, btnY + (btnH + btnGap) * 2, 140, btnH, k.rgb(...THEME.surfaceAlt), () => showPlayerMenu());
    }

    function showSwapSelect() {
      state = STATE.SWAP_SELECT;
      clearButtons();
      const cx = k.width() / 2;
      const alive = team.filter((m, i) => m.currentHealth > 0 && i !== activeIdx);

      if (alive.length === 0) {
        narrative = "No other monsters to swap to!";
        narrativeLabel.text = narrative;
        showPlayerMenu();
        return;
      }

      alive.forEach((m, i) => {
        const mt = getMonsterType(m.typeName);
        const stats = getMonsterStats(mt, m.level);
        const label = `${m.name || m.typeName} Lv.${m.level} (${m.currentHealth}/${stats.health})`;
        const y = btnY + i * (btnH + btnGap);
        makeBtn(label, cx, y, 350, btnH, k.rgb(...THEME.primary), () => doSwap(team.indexOf(m)));
      });

      makeBtn("Back", cx, btnY + (btnH + btnGap) * Math.min(alive.length, 3), 140, btnH, k.rgb(...THEME.surfaceAlt), () => showPlayerMenu());
    }

    function showResolving() {
      state = STATE.RESOLVING;
      clearButtons();
      narrativeLabel.text = "Resolving...";
    }

    // ─── Actions ───
    async function doAttack(attack) {
      showResolving();
      const enemyAtk = chooseEnemyAttack(monster);
      const turnOpts = { initiator: firstTurn ? engineInitiator : null };
      firstTurn = false;
      const result = await evaluateTurn(getActiveMonster(), attack, monster, enemyAtk, turnOpts);
      sfx("hit"); haptic(15); // MB-12: feel the hit
      applyTurnResult(result);
    }

    async function doSkip() {
      showResolving();
      const enemyAtk = chooseEnemyAttack(monster);
      const turnOpts = { initiator: firstTurn ? engineInitiator : null };
      firstTurn = false;
      const result = await evaluateTurn(getActiveMonster(), null, monster, enemyAtk, turnOpts);
      applyTurnResult(result);
    }

    async function doCatch() {
      showResolving();
      const enemyAtk = chooseEnemyAttack(monster);
      const def = getChainDef();
      // A first-turn, player-initiated catch (thrown chain) skips the enemy's
      // retaliation; otherwise the enemy attacks during the attempt as before.
      const skipEnemyAttack = firstTurn && turnInitiator === "player";
      firstTurn = false;
      const catchOpts = def
        ? {
            captureMultiplier: def.captureMultiplier,
            maxRarity: def.maxRarity,
            enemyRarity: enemyType?.rarity ?? 0,
            guaranteed: def.special === "guaranteed",
            skipEnemyAttack,
          }
        : { skipEnemyAttack };
      const result = await evaluateCatch(getActiveMonster(), monster, enemyAtk, catchOpts);

      const pm = getActiveMonster();
      pm.currentHealth = result.playerHealth;
      pm.currentEnergy = result.playerEnergy;
      pm.status = result.playerStatus;
      narrative = result.narrative;
      narrativeLabel.text = narrative;
      updateBars();

      if (result.caught) {
        state = STATE.MONSTER_CAUGHT;
        clearButtons();
        sfx("catch"); haptic([0, 30, 40, 60]); // MB-12: catch-success buzz
        consumeChainCharge(def);
        playCaptureFx(def);

        // Add to team or vault
        const caught = {
          id: uid(),
          typeName: monster.typeName,
          name: monster.typeName,
          level: monster.level,
          xp: 0,
          currentHealth: monster.currentHealth,
          currentEnergy: monster.currentEnergy,
          status: null,
        };

        if (team.length < 4) {
          character.activeMonsters.push(caught);
        } else {
          if (!character.vaultMonsters) character.vaultMonsters = [];
          character.vaultMonsters.push(caught);
          narrative += " Sent to vault (team full).";
          narrativeLabel.text = narrative;
        }

        // XP reward
        grantXp(pm, 30 + monster.level * 15);

        saveCharacter(character);
        showEndButtons("Continue");
      } else if (pm.currentHealth <= 0) {
        handlePlayerMonsterFainted();
      } else {
        showPlayerMenu();
      }
    }

    // Spend one capture charge (durability) on the chain used; remove the chain
    // when depleted and re-point the equipped id at a remaining chain.
    function consumeChainCharge(def) {
      if (!def) return;
      const chains = character.chains || [];
      const cs = chains.find((c) => c.chainId === def.id);
      if (!cs) return;
      cs.durability -= 1;
      if (cs.durability <= 0) {
        const idx = chains.indexOf(cs);
        chains.splice(idx, 1);
        if (character.equippedChainId === def.id) {
          character.equippedChainId = chains[0]?.chainId || null;
        }
      }
    }

    // Brief capture flash over the enemy sprite (~0.6s), drawn procedurally.
    function playCaptureFx(def) {
      const fxStart = k.time();
      const col = chainColor(def);
      const handle = k.onDraw(() => {
        const p = (k.time() - fxStart) / 0.6;
        if (p >= 1) { handle.cancel(); return; }
        drawCaptureAnimation(k, { x: k.width() * 0.75, y: 170, color: col, progress: p });
      });
    }

    function doFlee() {
      state = STATE.PLAYER_FLED;
      narrative = "You fled from battle!";
      narrativeLabel.text = narrative;
      clearButtons();
      // Clear monster from tile
      if (mapData) {
        const tx = monster.tileX, ty = monster.tileY;
        if (tx !== undefined && mapData.tileMap[tx]?.[ty]) {
          mapData.tileMap[tx][ty].activeMonster = null;
        }
      }
      restoreQueueToMap(); // fleeing abandons a multi/area cluster
      showEndButtons("Continue");
    }

    // Return any un-fought multi/area monsters to their map tiles (on flee).
    function restoreQueueToMap() {
      if (!mapData || !queue.length) return;
      for (const m of queue) {
        if (m.tileX !== undefined && mapData.tileMap[m.tileX]?.[m.tileY]) {
          mapData.tileMap[m.tileX][m.tileY].activeMonster = m;
        }
      }
      queue = [];
    }

    function doSwap(newIdx) {
      activeIdx = newIdx;
      const pm = getActiveMonster();
      narrative = `Go, ${pm.name || pm.typeName}!`;
      narrativeLabel.text = narrative;
      updatePlayerSprite();
      updateBars();
      showPlayerMenu();
    }

    // ─── Result handling ───
    function applyTurnResult(result) {
      const pm = getActiveMonster();
      pm.currentHealth = result.playerHealth;
      pm.currentEnergy = result.playerEnergy;
      pm.status = result.playerStatus;

      monster.currentHealth = result.enemyHealth;
      monster.currentEnergy = result.enemyEnergy;
      monster.status = result.enemyStatus;

      narrative = result.narrative;
      narrativeLabel.text = narrative;
      updateBars();

      if (monster.currentHealth <= 0) {
        handleEnemyDefeated();
      } else if (pm.currentHealth <= 0) {
        handlePlayerMonsterFainted();
      } else {
        showPlayerMenu();
      }
    }

    function handleEnemyDefeated() {
      state = STATE.FIGHT_WON;
      clearButtons();
      sfx("win");
      narrative += " Enemy defeated!";
      narrativeLabel.text = narrative;

      // XP + gold reward
      const pm = getActiveMonster();
      if (grantXp(pm, 20 + monster.level * 10)) {
        sfx("levelup");
        narrative += ` ${pm.name || pm.typeName} leveled up!`;
        narrativeLabel.text = narrative;
      }
      const goldGain = Math.round(goldForDefeat(monster.level) * goldMult(character));
      const essGain = Math.round(GAME.CRAFT.ESSENCE_PER_DEFEAT * essenceMult(character));
      character.gold = (character.gold || 0) + goldGain;
      character.essence = (character.essence || 0) + essGain;
      narrative += ` +${goldGain} gold, +${essGain} essence.`;
      narrativeLabel.text = narrative;

      // Clear monster from tile
      if (mapData) {
        const tx = monster.tileX, ty = monster.tileY;
        if (tx !== undefined && mapData.tileMap[tx]?.[ty]) {
          mapData.tileMap[tx][ty].activeMonster = null;
        }
      }

      saveCharacter(character);
      showEndButtons("Continue");
    }

    function handlePlayerMonsterFainted() {
      const pm = getActiveMonster();
      narrative += ` ${pm.name || pm.typeName} fainted!`;

      // Find next alive monster
      const nextAlive = team.findIndex((m, i) => i !== activeIdx && m.currentHealth > 0);
      if (nextAlive < 0) {
        state = STATE.FIGHT_LOST;
        sfx("lose");
        narrative += " All monsters fainted!";
        narrativeLabel.text = narrative;
        clearButtons();
        saveCharacter(character);
        showEndButtons("Continue");
      } else {
        activeIdx = nextAlive;
        const next = getActiveMonster();
        narrative += ` ${next.name || next.typeName} steps in!`;
        narrativeLabel.text = narrative;
        updatePlayerSprite();
        updateBars();
        showPlayerMenu();
      }
    }

    function showEndButtons(label) {
      const cx = k.width() / 2;
      makeBtn(label, cx, btnY + btnH, btnW, btnH, k.rgb(...THEME.success), () => {
        saveCharacter(character);
        if (state === STATE.FIGHT_LOST) {
          // Death ends the run: run-found chains are forfeited (banked ones stay),
          // mirroring the server's death branch and game.js's timeout path.
          finalizeRunChains(character, false, getSpiritChain);
          saveCharacter(character);
          k.go("runResult", { characterId, result: "defeat" });
        } else if ((state === STATE.FIGHT_WON || state === STATE.MONSTER_CAUGHT) && queue.length) {
          // Multi/area capture: chain straight into the next clustered monster,
          // keeping initiative and the same chain.
          k.go("fight", { characterId, monster: queue[0], mapData, playerPos, elapsed, portals, initiator: "player", chainId, queue: queue.slice(1) });
        } else {
          k.go("game", { characterId, mapData, resumePos: playerPos, resumeElapsed: elapsed, resumePortals: portals });
        }
      });
    }

    // ─── Init ───
    updateBars();
    showPlayerMenu();

    k.onKeyPress("escape", () => {
      if (state === STATE.ATTACK_SELECT || state === STATE.SWAP_SELECT) {
        showPlayerMenu();
      }
    });
  });
}
