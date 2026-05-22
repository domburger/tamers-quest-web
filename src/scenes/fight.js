import { getMonsterType, getAttacksForMonster, getMonsterStats } from "../data.js";
import { getCharacter, saveCharacter } from "../storage.js";
import { chooseEnemyAttack, evaluateTurn, evaluateCatch, getApiKey, setApiKey } from "../systems/combat.js";

const STATE = {
  PLAYER_MENU: 0,
  ATTACK_SELECT: 1,
  SWAP_SELECT: 2,
  RESOLVING: 3,
  FIGHT_WON: 4,
  FIGHT_LOST: 5,
  PLAYER_FLED: 6,
  MONSTER_CAUGHT: 7,
  API_KEY_PROMPT: 8,
};

export default function fightScene(k) {
  k.scene("fight", ({ characterId, monster, mapData, playerPos, elapsed, portals }) => {
    const character = getCharacter(characterId);
    if (!character) { k.go("characterSelect"); return; }

    const team = character.activeMonsters || [];
    let activeIdx = team.findIndex((m) => m.currentHealth > 0);
    if (activeIdx < 0) { k.go("runResult", { characterId, result: "timeout" }); return; }

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

    // ─── Background ───
    k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(12, 8, 20)]);

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
          k.color(40, 50, 70),
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
      k.color(200, 230, 255),
    ]);

    const playerStatusLabel = k.add([
      k.text("", { size: 13, font: "gameFont" }),
      k.pos(k.width() * 0.25 + 100, 250),
      k.anchor("left"),
      k.color(255, 200, 100),
    ]);

    const hpBarW = 200, barH = 12;
    const pBarX = k.width() * 0.25 - hpBarW / 2;
    k.add([k.rect(hpBarW, barH, { radius: 3 }), k.pos(pBarX, 270), k.color(40, 20, 20)]);
    const playerHpFill = k.add([k.rect(hpBarW, barH, { radius: 3 }), k.pos(pBarX, 270), k.color(50, 200, 80)]);
    const playerHpText = k.add([
      k.text("", { size: 10, font: "gameFont" }),
      k.pos(k.width() * 0.25, 272),
      k.anchor("center"),
      k.color(255, 255, 255),
    ]);

    k.add([k.rect(hpBarW, 6, { radius: 2 }), k.pos(pBarX, 286), k.color(20, 20, 40)]);
    const playerEnFill = k.add([k.rect(hpBarW, 6, { radius: 2 }), k.pos(pBarX, 286), k.color(60, 120, 220)]);

    // Enemy info (right)
    const enemyNameLabel = k.add([
      k.text(`${monster.name}  Lv.${monster.level}`, { size: 16, font: "gameFont" }),
      k.pos(k.width() * 0.75, 250),
      k.anchor("center"),
      k.color(220, 220, 240),
    ]);

    const enemyStatusLabel = k.add([
      k.text("", { size: 13, font: "gameFont" }),
      k.pos(k.width() * 0.75 + 100, 250),
      k.anchor("left"),
      k.color(255, 200, 100),
    ]);

    const enemyBarX = k.width() * 0.75 - hpBarW / 2;
    k.add([k.rect(hpBarW, barH, { radius: 3 }), k.pos(enemyBarX, 270), k.color(40, 20, 20)]);
    const enemyHpFill = k.add([k.rect(hpBarW, barH, { radius: 3 }), k.pos(enemyBarX, 270), k.color(50, 200, 80)]);
    const enemyHpText = k.add([
      k.text("", { size: 10, font: "gameFont" }),
      k.pos(k.width() * 0.75, 272),
      k.anchor("center"),
      k.color(255, 255, 255),
    ]);

    k.add([k.rect(hpBarW, 6, { radius: 2 }), k.pos(enemyBarX, 286), k.color(20, 20, 40)]);
    const enemyEnFill = k.add([k.rect(hpBarW, 6, { radius: 2 }), k.pos(enemyBarX, 286), k.color(60, 120, 220)]);

    // "VS" divider
    k.add([
      k.text("VS", { size: 28, font: "gameFont" }),
      k.pos(k.width() / 2, 170),
      k.anchor("center"),
      k.color(180, 60, 60),
      k.opacity(0.6),
    ]);

    // ─── Narrative box ───
    k.add([
      k.rect(k.width() - 80, 60, { radius: 6 }),
      k.pos(40, 305),
      k.color(20, 18, 30),
      k.outline(1, k.Color.fromHex("#333355")),
    ]);
    const narrativeLabel = k.add([
      k.text(narrative, { size: 14, font: "gameFont", width: k.width() - 120 }),
      k.pos(60, 318),
      k.color(200, 200, 220),
    ]);

    // ─── Button area ───
    const btnTag = "fightBtn";
    const btnY = 390;
    const btnW = 200, btnH = 40, btnGap = 10;

    function clearButtons() { k.destroyAll(btnTag); }

    function makeBtn(label, x, y, w, h, color, onClick, enabled = true) {
      const bg = k.add([
        k.rect(w, h, { radius: 6 }),
        k.pos(x, y),
        k.anchor("center"),
        k.color(enabled ? color : k.rgb(50, 50, 50)),
        k.area(),
        btnTag,
      ]);
      const txt = k.add([
        k.text(label, { size: 16, font: "gameFont" }),
        k.pos(x, y),
        k.anchor("center"),
        k.color(enabled ? k.rgb(255, 255, 255) : k.rgb(100, 100, 100)),
        btnTag,
      ]);
      if (enabled) {
        bg.onClick(onClick);
        bg.onHoverUpdate(() => { bg.color = k.rgb(color.r + 30, color.g + 30, color.b + 30); });
        bg.onHoverEnd(() => { bg.color = color; });
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

      if (pm.currentHealth / ps.health < 0.25) playerHpFill.color = k.rgb(220, 50, 50);
      else if (pm.currentHealth / ps.health < 0.5) playerHpFill.color = k.rgb(220, 180, 50);
      else playerHpFill.color = k.rgb(50, 200, 80);

      enemyHpFill.width = Math.max(0, (monster.currentHealth / enemyStats.health) * hpBarW);
      enemyHpText.text = `${monster.currentHealth} / ${enemyStats.health}`;
      enemyEnFill.width = Math.max(0, (monster.currentEnergy / enemyStats.energy) * hpBarW);
      enemyStatusLabel.text = monster.status ? `[${monster.status}]` : "";

      if (monster.currentHealth / enemyStats.health < 0.25) enemyHpFill.color = k.rgb(220, 50, 50);
      else if (monster.currentHealth / enemyStats.health < 0.5) enemyHpFill.color = k.rgb(220, 180, 50);
      else enemyHpFill.color = k.rgb(50, 200, 80);
    }

    function showPlayerMenu() {
      state = STATE.PLAYER_MENU;
      clearButtons();
      const cx = k.width() / 2;
      const col1 = cx - btnW / 2 - btnGap / 2 - btnW / 2;
      const col2 = cx + btnW / 2 + btnGap / 2 - btnW / 2 + btnW;

      // Row 1
      makeBtn("Fight", cx - 110, btnY, btnW, btnH, k.rgb(60, 100, 60), () => showAttackSelect());
      makeBtn("Catch", cx + 110, btnY, btnW, btnH, k.rgb(60, 60, 120), () => doCatch());
      // Row 2
      makeBtn("Swap", cx - 110, btnY + btnH + btnGap, btnW, btnH, k.rgb(80, 80, 50), () => showSwapSelect());
      makeBtn("Skip", cx + 110, btnY + btnH + btnGap, btnW, btnH, k.rgb(70, 70, 70), () => doSkip());
      // Row 3
      makeBtn("Flee", cx, btnY + (btnH + btnGap) * 2, btnW, btnH, k.rgb(120, 50, 50), () => doFlee());
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
        makeBtn(label, x, y, btnW, btnH, k.rgb(60, 90, 60), () => doAttack(atk), canAfford);
      });

      makeBtn("Back", cx, btnY + (btnH + btnGap) * 2, 140, btnH, k.rgb(80, 50, 50), () => showPlayerMenu());
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
        makeBtn(label, cx, y, 350, btnH, k.rgb(50, 70, 90), () => doSwap(team.indexOf(m)));
      });

      makeBtn("Back", cx, btnY + (btnH + btnGap) * Math.min(alive.length, 3), 140, btnH, k.rgb(80, 50, 50), () => showPlayerMenu());
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
      const result = await evaluateTurn(getApiKey(), getActiveMonster(), attack, monster, enemyAtk);
      applyTurnResult(result);
    }

    async function doSkip() {
      showResolving();
      const enemyAtk = chooseEnemyAttack(monster);
      const apiKey = getApiKey();
      const result = await evaluateTurn(apiKey, getActiveMonster(), null, monster, enemyAtk);
      applyTurnResult(result);
    }

    async function doCatch() {
      showResolving();
      const enemyAtk = chooseEnemyAttack(monster);
      const apiKey = getApiKey();
      const result = await evaluateCatch(apiKey, getActiveMonster(), monster, enemyAtk);

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

        // Add to team or vault
        const caught = {
          id: Date.now(),
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
        const xpGain = 30 + monster.level * 15;
        pm.xp = (pm.xp || 0) + xpGain;
        const mt = getMonsterType(pm.typeName);
        if (pm.xp >= 100) {
          pm.xp -= 100;
          pm.level++;
          const newStats = getMonsterStats(mt, pm.level);
          pm.currentHealth = newStats.health;
          pm.currentEnergy = newStats.energy;
        }

        saveCharacter(character);
        showEndButtons("Continue");
      } else if (pm.currentHealth <= 0) {
        handlePlayerMonsterFainted();
      } else {
        showPlayerMenu();
      }
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
      showEndButtons("Continue");
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
      narrative += " Enemy defeated!";
      narrativeLabel.text = narrative;

      // XP reward
      const pm = getActiveMonster();
      const xpGain = 20 + monster.level * 10;
      pm.xp = (pm.xp || 0) + xpGain;
      if (pm.xp >= 100) {
        pm.xp -= 100;
        pm.level++;
        const mt = getMonsterType(pm.typeName);
        const newStats = getMonsterStats(mt, pm.level);
        pm.currentHealth = newStats.health;
        pm.currentEnergy = newStats.energy;
        narrative += ` ${pm.name || pm.typeName} leveled up!`;
        narrativeLabel.text = narrative;
      }

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
      makeBtn(label, cx, btnY + btnH, btnW, btnH, k.rgb(50, 100, 80), () => {
        saveCharacter(character);
        if (state === STATE.FIGHT_LOST) {
          k.go("runResult", { characterId, result: "defeat" });
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
