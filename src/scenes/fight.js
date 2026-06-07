import { getMonsterType, getAttacksForMonster, getMonsterStats, getSpiritChain, cleanAttackName } from "../data.js";
import { getCharacter, saveCharacter } from "../storage.js";
import { chooseEnemyAttack, evaluateTurn, evaluateCatch, combatAvailable, CombatUnavailableError } from "../systems/combat.js";
import { drawCaptureAnimation, chainColor } from "../render/spiritchain.js";
import { GAME, finalizeRunChains } from "../engine/schemas.js";
import { grantXp, defeatGold, defeatEssence } from "../engine/progression.js";
import { addCaughtMonster } from "../engine/inventory.js"; // PARITY-3/INV-T1: shared catch placement (team→vault→release), no SP↔MP drift
import { uid } from "../uid.js";
import { THEME, addButton } from "../ui/theme.js";
import { sfx, haptic } from "../systems/audio.js"; // SP-combat SFX + haptics (P8-T6 / MB-12)
import { prefersReducedMotion } from "../systems/a11y.js"; // a11y: skip the attack lunge

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
      // No usable monster → the run ends (a defeat): forfeit run-found chains,
      // matching the server and game.js paths.
      finalizeRunChains(character, false, getSpiritChain);
      saveCharacter(character);
      k.go("runResult", { characterId, result: "defeat" }); // VS-13: accurate code (was "timeout")
      return;
    }

    // Reset enemy to full HP/energy for this fight
    const enemyType = getMonsterType(monster.typeName);
    const enemyStats = getMonsterStats(enemyType, monster.level);
    monster.currentHealth = enemyStats.health;
    monster.currentEnergy = enemyStats.energy;
    monster.status = null;

    // Q8 parity with the server (restoreEnergyPartial): give the team a "breather" —
    // restore a fraction of max energy at the start of each encounter so a depleted
    // team isn't permanently stuck skipping turns. SP previously only reset the
    // enemy's energy, leaving the player's team drained between back-to-back fights.
    for (const m of team) {
      if (m.currentHealth <= 0) continue;
      const me = getMonsterStats(getMonsterType(m.typeName), m.level).energy;
      m.currentEnergy = Math.min(me, (m.currentEnergy || 0) + Math.ceil((me * GAME.ENERGY_RESTORE_PCT) / 100));
    }

    let state = STATE.PLAYER_MENU;
    let narrative = `A wild ${monster.name} (Lv.${monster.level}) appeared!`;
    let pendingAction = null;

    function getActiveMonster() { return team[activeIdx]; }
    function getActiveType() { return getMonsterType(getActiveMonster().typeName); }
    function getActiveStats() { return getMonsterStats(getActiveType(), getActiveMonster().level); }

    // XP / leveling comes from the shared engine module (P10-T4) so SP and the
    // server can't drift — see the `grantXp` import above.

    // ─── Background ─── atmospheric arena backdrop (caveDeep rect as fallback).
    // Cover-scale the 1280×720 backdrop to the (now responsive) design size so it
    // fills any aspect ratio with no dark gaps at the edges (matches the menu fix).
    k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(...THEME.caveDeep)]);
    try {
      const cover = Math.max(k.width() / 1280, k.height() / 720);
      k.add([k.sprite("combat_background"), k.pos(k.width() / 2, k.height() / 2), k.anchor("center"), k.scale(cover)]);
    } catch {}

    // ─── Battle arena (sprites face each other) ───
    // Player monster (left side)
    const playerSpriteTag = "playerMonSprite";
    let playerSprite = null; // ref for the hit-flash (re-set on swap)
    function updatePlayerSprite() {
      k.destroyAll(playerSpriteTag);
      const pm = getActiveMonster();
      const spriteName = pm.typeName.toLowerCase().replace(/\s+/g, "_");
      try {
        playerSprite = k.add([
          k.sprite(spriteName),
          k.pos(k.width() * 0.25, 170),
          k.anchor("center"),
          k.scale(2),
          playerSpriteTag,
        ]);
      } catch {
        playerSprite = null;
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
    let enemySprite = null; // ref for the hit-flash
    try {
      enemySprite = k.add([
        k.sprite(enemySpriteName),
        k.pos(k.width() * 0.75, 170),
        k.anchor("center"),
        k.scale(2),
      ]);
    } catch {}

    // Attack lunge: the striker jabs toward its opponent then settles back (a quick
    // out-and-back over ~0.28s), driven each frame off a start-time. Uses the retained
    // sprite's pos setter (now supersample-correct). Re-set to base each frame so a
    // swapped-in player sprite animates from the right spot. a11y: no lunge under
    // reduce-motion (the hit flash + floater still convey the hit).
    const PBASE = k.width() * 0.25, EBASE = k.width() * 0.75, LUNGE_Y = 170, LUNGE_D = 0.28, LUNGE_PX = 42;
    let pLungeT = -1, eLungeT = -1;
    const lungeOff = (t0, dir) => {
      if (t0 < 0) return 0;
      const lp = (k.time() - t0) / LUNGE_D;
      if (lp >= 1) return 0;
      const amt = lp < 0.35 ? lp / 0.35 : 1 - (lp - 0.35) / 0.65; // ramp out, ease back
      return dir * LUNGE_PX * amt;
    };
    k.onUpdate(() => {
      if (playerSprite) playerSprite.pos = k.vec2(PBASE + lungeOff(pLungeT, 1), LUNGE_Y);
      if (enemySprite) enemySprite.pos = k.vec2(EBASE + lungeOff(eLungeT, -1), LUNGE_Y);
    });
    const lunge = (who) => { if (prefersReducedMotion()) return; if (who === "player") pLungeT = k.time(); else eLungeT = k.time(); };

    // Hit flash: briefly tint a struck combatant's sprite red, then restore, so a
    // landed attack reads with a punch of feedback (alongside the damage floater).
    function flashHit(obj) {
      if (!obj) return;
      try {
        obj.color = k.rgb(255, 110, 100);
        k.wait(0.14, () => { try { obj.color = k.rgb(255, 255, 255); } catch {} });
      } catch {}
    }

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

    // Animated HP-bar drain: the fill eases toward its target width each frame
    // instead of snapping, so taking damage reads as the bar draining down.
    let pHpTargetW = hpBarW, eHpTargetW = hpBarW, pHpCurW = hpBarW, eHpCurW = hpBarW;
    k.onUpdate(() => {
      const e = Math.min(1, k.dt() * 9);
      pHpCurW += (pHpTargetW - pHpCurW) * e;
      eHpCurW += (eHpTargetW - eHpCurW) * e;
      playerHpFill.width = pHpCurW;
      enemyHpFill.width = eHpCurW;
    });

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

    // VS-9: delegate to the themed addButton so SP-combat buttons get the same
    // shadow/sheen/glow/outline/SFX/haptic as the rest of the game (was a bespoke
    // flat rect). `color` is a THEME.* array; `tag: btnTag` lets clearButtons()
    // wipe every layer between menu states; `disabled` greys unaffordable moves.
    function makeBtn(label, x, y, w, h, color, onClick, enabled = true, textColor) {
      return addButton(k, { x, y, w, h, text: label, size: 16, radius: 10,
        fill: color, textColor, onClick, disabled: !enabled, tag: btnTag });
    }

    // ─── State rendering ───
    function updateBars() {
      const pm = getActiveMonster();
      const ps = getActiveStats();
      const pt = getActiveType();

      playerNameLabel.text = `${pm.name || pm.typeName}  Lv.${pm.level}`;
      pHpTargetW = Math.max(0, (pm.currentHealth / ps.health) * hpBarW); // eased in onUpdate
      playerHpText.text = `${pm.currentHealth} / ${ps.health}`;
      playerEnFill.width = Math.max(0, (pm.currentEnergy / ps.energy) * hpBarW);
      playerStatusLabel.text = pm.status ? `[${pm.status}]` : "";

      if (pm.currentHealth / ps.health < 0.25) playerHpFill.color = k.rgb(...THEME.danger);
      else if (pm.currentHealth / ps.health < 0.5) playerHpFill.color = k.rgb(...THEME.warn);
      else playerHpFill.color = k.rgb(...THEME.success);

      eHpTargetW = Math.max(0, (monster.currentHealth / enemyStats.health) * hpBarW); // eased in onUpdate
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
      makeBtn("Fight", cx - 110, btnY, btnW, btnH, THEME.success, () => showAttackSelect());
      makeBtn("Catch", cx + 110, btnY, btnW, btnH, THEME.primary, () => doCatch());
      // Row 2
      makeBtn("Swap", cx - 110, btnY + btnH + btnGap, btnW, btnH, THEME.warn, () => showSwapSelect());
      makeBtn("Skip", cx + 110, btnY + btnH + btnGap, btnW, btnH, THEME.surfaceAlt, () => doSkip(), true, THEME.text);
      // Row 3
      makeBtn("Flee", cx, btnY + (btnH + btnGap) * 2, btnW, btnH, THEME.danger, () => doFlee());
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
        const label = `${cleanAttackName(atk.name)} (${atk.energyCost}E)`; // CN-7: strip embedded description
        makeBtn(label, x, y, btnW, btnH, THEME.success, () => doAttack(atk), canAfford);
      });

      makeBtn("Back", cx, btnY + (btnH + btnGap) * 2, 140, btnH, THEME.surfaceAlt, () => showPlayerMenu());
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
        makeBtn(label, cx, y, 350, btnH, THEME.primary, () => doSwap(team.indexOf(m)));
      });

      makeBtn("Back", cx, btnY + (btnH + btnGap) * Math.min(alive.length, 3), 140, btnH, THEME.surfaceAlt, () => showPlayerMenu());
    }

    function showResolving() {
      state = STATE.RESOLVING;
      clearButtons();
      narrativeLabel.text = "Resolving...";
    }

    // FGT-T1: combat is AI-only and the judge runs server-side. With no connection
    // to it we DON'T fall back to a silent deterministic fight — we surface a clear
    // message and let the player retreat (the wild monster stays on the map to retry).
    function showCombatUnavailable() {
      state = STATE.RESOLVING; // lock out combat inputs
      clearButtons();
      narrative = "Combat needs a connection to the AI judge. Check your connection and try again.";
      narrativeLabel.text = narrative;
      const cx = k.width() / 2;
      makeBtn("Retreat", cx, btnY + btnH, btnW, btnH, THEME.warn, () => {
        restoreQueueToMap(); // leave any clustered monsters on the map
        saveCharacter(character);
        k.go("game", { characterId, mapData, resumePos: playerPos, resumeElapsed: elapsed, resumePortals: portals });
      });
    }

    // ─── Actions ───
    async function doAttack(attack) {
      showResolving();
      const enemyAtk = chooseEnemyAttack(monster);
      const turnOpts = { initiator: firstTurn ? engineInitiator : null };
      try {
        const result = await evaluateTurn(getActiveMonster(), attack, monster, enemyAtk, turnOpts);
        firstTurn = false; // only consume initiative once the turn actually resolved
        sfx("hit"); haptic(15); // MB-12: feel the hit
        applyTurnResult(result);
      } catch (e) {
        if (e instanceof CombatUnavailableError) showCombatUnavailable();
        else { console.error("[fight] turn error", e); showCombatUnavailable(); }
      }
    }

    async function doSkip() {
      showResolving();
      const enemyAtk = chooseEnemyAttack(monster);
      const turnOpts = { initiator: firstTurn ? engineInitiator : null };
      try {
        const result = await evaluateTurn(getActiveMonster(), null, monster, enemyAtk, turnOpts);
        firstTurn = false;
        applyTurnResult(result);
      } catch (e) {
        if (e instanceof CombatUnavailableError) showCombatUnavailable();
        else { console.error("[fight] turn error", e); showCombatUnavailable(); }
      }
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
      spawnDmgFloater(k.width() * 0.25, pm.currentHealth - result.playerHealth, [255, 90, 90]); // VS-22: damage taken during the catch attempt
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

        // Add to team or vault. CB-9: stabilize to a usable fraction of max HP/energy
        // instead of the near-death combat HP (a 3/300 catch was useless mid-run).
        const caught = {
          id: uid(),
          typeName: monster.typeName,
          name: monster.typeName,
          level: monster.level,
          xp: 0,
          currentHealth: Math.max(1, Math.round(enemyStats.health * GAME.CATCH_HEAL_FRACTION)),
          currentEnergy: Math.round(enemyStats.energy * GAME.CATCH_HEAL_FRACTION),
          status: null,
        };

        // PARITY-3 (INV-T1): place the catch via the shared engine rule — team if
        // room (< TEAM_SIZE), else vault if under capacity (base + Deep Vault), else
        // released — so SP and MP can't drift on the vault cap (server world.js:
        // endCombat wires the same addCaughtMonster). The catch-success narrative +
        // label are already set above (385-386); only annotate the team-full cases.
        const placed = addCaughtMonster(character, caught);
        if (placed !== "team") {
          narrative += placed === "vault" ? " Sent to vault (team full)." : " Your vault is full — it was released.";
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

    // VS-22 (SP parity): a floating "-N" that rises + fades over 0.8s when a combatant
    // takes damage, so the hit's magnitude is readable (not just the HP-bar drop).
    // amber over the enemy (0.75w) / red over you (0.25w); mirrors the MP version.
    function spawnDmgFloater(x, dmg, col, heal = false, power = 0) {
      if (!(dmg > 0)) return;
      const t0 = k.time();
      const size = 18 + power * 16; // big hits → big numbers, so crits visibly pop
      const handle = k.onDraw(() => {
        const age = k.time() - t0;
        if (age >= 0.8) { handle.cancel(); return; }
        k.drawText({ text: `${heal ? "+" : "-"}${Math.round(dmg)}`, pos: k.vec2(x, 235 - age * 34), size, font: "gameFont", anchor: "center", color: k.rgb(col[0], col[1], col[2]), opacity: 1 - age / 0.8 });
      });
    }

    // Impact burst: a quick expanding ring (+ a brighter inner ring) at a struck
    // combatant, ~0.3s — gives a landed hit a punch of force alongside the sprite
    // flash and the damage floater. Same self-cancelling onDraw idiom as the others.
    function playHitFx(x, col, power = 0) {
      const t0 = k.time();
      const maxR = 40 + power * 48; // bigger burst for bigger hits (crits read as force)
      const handle = k.onDraw(() => {
        const p = (k.time() - t0) / 0.3;
        if (p >= 1) { handle.cancel(); return; }
        const r = 10 + p * maxR;
        k.drawCircle({ pos: k.vec2(x, 170), radius: r, fill: false, outline: { width: Math.max(1, (3 + power * 2) * (1 - p)), color: k.rgb(col[0], col[1], col[2]) }, opacity: 0.85 * (1 - p) });
        k.drawCircle({ pos: k.vec2(x, 170), radius: r * 0.55, fill: false, outline: { width: Math.max(1, 2 * (1 - p)), color: k.rgb(255, 255, 255) }, opacity: 0.5 * (1 - p) });
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
      // Hit flash + impact burst on whoever took damage this turn (juice alongside
      // the damage floaters). `power` = fraction of max HP lost, so a big hit / crit
      // gets a bigger burst + bigger damage number automatically (no log parsing).
      const enemyDmg = monster.currentHealth - result.enemyHealth;
      const playerDmg = pm.currentHealth - result.playerHealth;
      const enemyPow = Math.min(1, enemyDmg / Math.max(1, enemyStats.health));
      const playerPow = Math.min(1, playerDmg / Math.max(1, getActiveStats().health));
      if (enemyDmg > 0) { flashHit(enemySprite); playHitFx(k.width() * 0.75, [255, 220, 120], enemyPow); lunge("player"); }
      if (playerDmg > 0) { flashHit(playerSprite); playHitFx(k.width() * 0.25, [255, 120, 110], playerPow); lunge("enemy"); }
      spawnDmgFloater(k.width() * 0.75, enemyDmg, [255, 210, 90], false, enemyPow); // VS-22: enemy took damage
      spawnDmgFloater(k.width() * 0.25, playerDmg, [255, 90, 90], false, playerPow); // VS-22: you took damage
      spawnDmgFloater(k.width() * 0.75, result.enemyHealth - monster.currentHealth, [120, 230, 150], true); // VS-22: enemy healed (+N)
      spawnDmgFloater(k.width() * 0.25, result.playerHealth - pm.currentHealth, [120, 230, 150], true); // VS-22: you healed (+N)
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
      const goldGain = defeatGold(character, monster.level);
      const essGain = defeatEssence(character);
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
      makeBtn(label, cx, btnY + btnH, btnW, btnH, THEME.success, () => {
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
    // FGT-T1: gate the fight on the AI judge being reachable. Until we know, show a
    // "connecting" state (no actionable menu) so a turn can't be attempted offline;
    // then either open the menu (available) or the needs-connection panel.
    updateBars();
    let disposed = false;
    k.onSceneLeave(() => { disposed = true; }); // guard the async callback against teardown
    state = STATE.RESOLVING;
    clearButtons();
    narrativeLabel.text = "Connecting to the combat judge…";
    combatAvailable().then((ok) => {
      if (disposed) return;
      if (ok) {
        narrative = `A wild ${monster.name} (Lv.${monster.level}) appeared!`;
        narrativeLabel.text = narrative;
        showPlayerMenu();
      } else {
        showCombatUnavailable();
      }
    });

    k.onKeyPress("escape", () => {
      if (state === STATE.ATTACK_SELECT || state === STATE.SWAP_SELECT) {
        showPlayerMenu();
      }
    });
  });
}
