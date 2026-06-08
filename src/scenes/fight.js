import { getMonsterType, getAttacksForMonster, getMonsterStats, getSpiritChain, cleanAttackName } from "../data.js";
import { getCharacter, saveCharacter, rollStarters } from "../storage.js";
import { chooseEnemyAttack, evaluateTurn, evaluateCatch, combatAvailable, CombatUnavailableError } from "../systems/combat.js";
import { drawCaptureAnimation, drawCaptureFail, drawChainBreak, chainColor } from "../render/spiritchain.js";
import { emit, updateFx, drawFxScreen, clearFx } from "../render/fx.js"; // PV-T12: combat hit-sparks via the shared screen-space fx pool
import { addShake, updateShake, shakeOffset, clearShake } from "../render/shake.js"; // PV-A5: SP combat hit shake (parity with MP; the Settings toggle gates it centrally)
import { GAME, finalizeRunChains } from "../engine/schemas.js";
import { grantXp, defeatGold, defeatEssence } from "../engine/progression.js";
import { addCaughtMonster, loseRunTeam } from "../engine/inventory.js"; // PARITY-3/INV-T1: shared catch placement + Q10 death stake (no SP↔MP drift)
import { markDiscovered } from "../engine/discovered.js"; // PV-T15: first-catch milestone (persisted, shared SP↔MP)
import { uid } from "../uid.js";
import { THEME, addButton, addPanel, elementColor } from "../ui/theme.js";
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
      // No usable monster → the run ends (a defeat): forfeit run-found chains AND lose
      // the active run team (Q10), matching the server and game.js paths.
      const lost = (character.chains || []).filter((c) => c.runFound).length; // P8-T3: report forfeited run-found chains
      loseRunTeam(character, rollStarters); // Q10 death stake (shared SP↔MP rule)
      finalizeRunChains(character, false, getSpiritChain);
      saveCharacter(character);
      k.go("runResult", { characterId, result: "defeat", gains: { chains: lost, gold: 0 } }); // VS-13: accurate code (was "timeout")
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
    let resolving = false; // true only during the live AI-judge wait → animates "Resolving…" (PV-A5 parity with MP's spinner)

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
    clearFx(); // PV-T12: the fx pool is global — drop any particles a prior scene left behind
    clearShake(); // PV-A5: reset screen-shake trauma on (re)entry (global state, like fx)

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
    let hitPauseUntil = 0; // PV-A5 hit-pause: a brief KO freeze-frame (the anim + HP-tween loops honor it)
    const lungeOff = (t0, dir) => {
      if (t0 < 0) return 0;
      const lp = (k.time() - t0) / LUNGE_D;
      if (lp >= 1) return 0;
      const amt = lp < 0.35 ? lp / 0.35 : 1 - (lp - 0.35) / 0.65; // ramp out, ease back
      return dir * LUNGE_PX * amt;
    };
    k.onUpdate(() => {
      if (k.time() < hitPauseUntil) return; // PV-A5 hit-pause: freeze the arena (sprites + fx + shake) on a KO
      updateFx(k.dt()); // PV-T12: advance combat hit-spark particles
      updateShake(k.dt()); // PV-A5: decay screen-shake trauma
      // Gentle idle bob so the arena feels alive between turns (different phase per
      // side); the lunge adds a horizontal jab on top. Frozen under reduce-motion.
      const t = k.time(), bobOn = prefersReducedMotion() ? 0 : 1;
      const pBob = bobOn * Math.sin(t * 2.0) * 3, eBob = bobOn * Math.sin(t * 2.0 + 1.1) * 3;
      // PV-A5: SP combat is a FIXED arena (no world camera), so jolt the fighters on a
      // hit rather than the camera — a camPos shake would expose the backdrop edges.
      const sh = shakeOffset();
      if (playerSprite) playerSprite.pos = k.vec2(PBASE + lungeOff(pLungeT, 1) + sh.x, LUNGE_Y + pBob + sh.y);
      if (enemySprite) enemySprite.pos = k.vec2(EBASE + lungeOff(eLungeT, -1) + sh.x, LUNGE_Y + eBob + sh.y);
    });
    k.onDraw(() => drawFxScreen(k)); // PV-T12: hit-sparks over the combatants (screen-space pool)
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
    // Bars scale to the column (a quarter of the viewport), capped at 200px — keeps
    // them on-screen and avoids overlapping the centred VS divider on narrow widths
    // (was a fixed 200px that ran off the left edge below ~400px viewport).
    const colW = k.width() / 4;
    const hpBarW = Math.min(200, Math.max(80, Math.floor(colW * 0.9))), barH = 12;
    // Player info (left)
    const playerNameLabel = k.add([
      k.text("", { size: 16, font: "gameFont" }),
      k.pos(k.width() * 0.25, 250),
      k.anchor("center"),
      k.color(...THEME.text),
    ]);

    const pBarX = k.width() * 0.25 - hpBarW / 2;
    // Status label tracks the bar's right edge (was a fixed +100 offset that drifted
    // off the bar and toward the centre when hpBarW shrank).
    const playerStatusLabel = k.add([
      k.text("", { size: 13, font: "gameFont" }),
      k.pos(pBarX + hpBarW + 8, 250),
      k.anchor("left"),
      k.color(...THEME.warn),
    ]);
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

    const enemyBarX = k.width() * 0.75 - hpBarW / 2;
    const enemyStatusLabel = k.add([
      k.text("", { size: 13, font: "gameFont" }),
      k.pos(enemyBarX + hpBarW + 8, 250),
      k.anchor("left"),
      k.color(...THEME.warn),
    ]);
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
      if (k.time() < hitPauseUntil) return; // PV-A5 hit-pause: hold the HP bar too during the KO freeze
      const e = Math.min(1, k.dt() * 9);
      pHpCurW += (pHpTargetW - pHpCurW) * e;
      eHpCurW += (eHpTargetW - eHpCurW) * e;
      playerHpFill.width = pHpCurW;
      enemyHpFill.width = eHpCurW;
      // Critical-HP pulse (parity with the MP/overworld HUD): a near-empty HP bar throbs
      // brighter so a near-dead combatant is unmissable. Only while critical (≤25%); when
      // it recovers, the next updateBars() restores the normal colour. reduce-motion safe.
      if (!prefersReducedMotion()) {
        const c = k.rgb(255, 90 + Math.round(90 * (0.5 + 0.5 * Math.sin(k.time() * 8))), 90 + Math.round(90 * (0.5 + 0.5 * Math.sin(k.time() * 8))));
        if (pHpTargetW > 0 && pHpTargetW / hpBarW <= 0.25) playerHpFill.color = c;
        if (eHpTargetW > 0 && eHpTargetW / hpBarW <= 0.25) enemyHpFill.color = c;
      }
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
    // A real panel (shadow + fill + border + top sheen) for parity with every other
    // framed surface in the game — was a flat rect + outline. The text still sits
    // top-left inside it so longer narratives wrap from the same anchor as before.
    addPanel(k, { x: k.width() / 2, y: 335, w: k.width() - 80, h: 60, radius: 12 });
    const narrativeLabel = k.add([
      k.text(narrative, { size: 14, font: "gameFont", width: k.width() - 120 }),
      k.pos(60, 318),
      k.color(...THEME.text),
    ]);

    // Animate the "Resolving" ellipsis while waiting on the AI judge (~1-2s) so the
    // turn reads as in-progress, not frozen — parity with MP's resolving spinner. Static
    // under reduce-motion. ASCII dots only (UI-glyph guardrail). Gated to the live wait.
    k.onUpdate(() => {
      if (!resolving || state !== STATE.RESOLVING) return;
      if (prefersReducedMotion()) { narrativeLabel.text = "Resolving..."; return; }
      narrativeLabel.text = "Resolving" + ".".repeat(1 + Math.floor((k.time() * 2.5) % 3));
    });

    // ─── Button area ───
    const btnTag = "fightBtn";
    const btnY = 390;
    const btnW = 200, btnH = 48, btnGap = 10; // MOB-A2: ≥44px touch targets (was 40; MP combat uses 54). Fits all sub-menus (≤4 rows from btnY=390).

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
      resolving = true; // the per-frame animator (below) cycles the ellipsis while we wait on the judge
      clearButtons();
      narrativeLabel.text = "Resolving...";
    }

    // FGT-T1: combat is AI-only and the judge runs server-side. With no connection
    // to it we DON'T fall back to a silent deterministic fight — we surface a clear
    // message and let the player retreat (the wild monster stays on the map to retry).
    function showCombatUnavailable() {
      state = STATE.RESOLVING; // lock out combat inputs
      resolving = false; // static message, not the animated wait
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
      // Cast tell on the attacker the instant the move launches (before it resolves),
      // tinted by the active monster's element (PV-T6 cast FX).
      playCastFx(k.width() * 0.25, elementColor(getMonsterType(getActiveMonster().typeName)?.element));
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
        // Tally catches for the run-end summary. mapData persists across game↔fight
        // round-trips, so this accumulates over the whole run (runResult reports it).
        if (mapData) mapData.runCaught = (mapData.runCaught || 0) + 1;
        clearButtons();
        sfx("catch"); haptic([0, 30, 40, 60]); // MB-12: catch-success buzz
        const chainBroke = consumeChainCharge(def);
        playCaptureFx(def);
        if (chainBroke) playChainBreakFx(def);

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
        // PV-T15: first-catch milestone — a species the player has never tamed before.
        // markDiscovered records it in the persistent tq_discovered set and returns true
        // only the first time, so the milestone fires once per species across all runs
        // (and the bestiary remembers it even after the monster leaves the collection) —
        // the same source of truth the MP path now uses.
        const firstCatch = markDiscovered(monster.typeName);
        const placed = addCaughtMonster(character, caught);
        if (placed !== "team") {
          narrative += placed === "vault" ? " Sent to vault (team full)." : " Your vault is full — it was released.";
        }
        // Tell the player why the chain just disappeared (last charge spent).
        if (chainBroke) narrative += ` Your ${def?.name || "Spirit Chain"} shattered — out of charges.`;
        // PV-T15: celebrate a brand-new species — banner + milestone chime + gold burst.
        if (firstCatch) { narrative = "NEW SPECIES!  " + narrative; sfx("levelup"); emit({ x: k.width() / 2, y: 100, n: 24, color: [255, 214, 110], speed: 150, life: 1.1, size: 3, spread: Math.PI * 2, gravity: 120, drag: 0.6, fixed: true }); playNewSpeciesBanner(); }
        narrativeLabel.text = narrative;

        // XP reward (tallied on mapData for the run-end summary — MP-parity)
        const catchXp = 30 + monster.level * 15;
        if (mapData) mapData.runXp = (mapData.runXp || 0) + catchXp;
        if (grantXp(pm, catchXp)) {
          if (mapData) mapData.runLevelUps = (mapData.runLevelUps || 0) + 1;
          // Celebrate the level-up like the win path does (was silently tallied on catch).
          narrative += ` ${pm.name || pm.typeName} leveled up!`;
          narrativeLabel.text = narrative;
          if (!firstCatch) sfx("levelup"); // firstCatch already chimed — don't double it
          emit({ x: k.width() * 0.25, y: 140, n: 12, color: [255, 220, 120], speed: 90, life: 0.8, size: 3, gravity: -30, drag: 1.2, fixed: true });
        }

        saveCharacter(character);
        showEndButtons("Continue");
      } else if (pm.currentHealth <= 0) {
        handlePlayerMonsterFainted();
      } else {
        // Catch failed and you're still standing — the monster breaks free.
        playCaptureFailFx(def);
        showPlayerMenu();
      }
    }

    // Spend one capture charge (durability) on the chain used; remove the chain
    // when depleted and re-point the equipped id at a remaining chain. Returns
    // true when this spend used the chain's LAST charge (so the caller can play
    // the shatter FX / tell the player why it vanished).
    function consumeChainCharge(def) {
      if (!def) return false;
      const chains = character.chains || [];
      const cs = chains.find((c) => c.chainId === def.id);
      if (!cs) return false;
      cs.durability -= 1;
      if (cs.durability <= 0) {
        const idx = chains.indexOf(cs);
        chains.splice(idx, 1);
        if (character.equippedChainId === def.id) {
          character.equippedChainId = chains[0]?.chainId || null;
        }
        return true;
      }
      return false;
    }

    // Brief capture flash over the enemy sprite (~0.6s), drawn procedurally.
    function playCaptureFx(def) {
      const fxStart = k.time();
      const col = chainColor(def);
      // SP↔MP parity: a celebratory teal sparkle burst (the taming payoff) rising from
      // the captured monster, matching the MP combat catch sparkle — via the screen-fx
      // pool already wired here for hit-sparks (auto reduce-motion suppression).
      emit({ x: k.width() * 0.75, y: 170, n: 16, color: [120, 230, 200], speed: 120, life: 0.6, size: 2.6, spread: Math.PI * 2, gravity: -40, drag: 1.2, fixed: true });
      const handle = k.onDraw(() => {
        const p = (k.time() - fxStart) / 0.6;
        if (p >= 1) { handle.cancel(); return; }
        drawCaptureAnimation(k, { x: k.width() * 0.75, y: 170, color: col, progress: p });
      });
    }

    // Break-free flash when a catch FAILS (~0.5s): the chain snaps outward so a
    // failed attempt reads distinctly from a success (PV-11), instead of the
    // monster just silently shrugging it off with only a narrative line.
    function playCaptureFailFx(def) {
      const fxStart = k.time();
      const col = chainColor(def);
      const handle = k.onDraw(() => {
        const p = (k.time() - fxStart) / 0.5;
        if (p >= 1) { handle.cancel(); return; }
        drawCaptureFail(k, { x: k.width() * 0.75, y: 170, color: col, progress: p });
      });
    }

    // Shatter flash when a chain spends its LAST charge (~0.6s): broken links
    // fall away so the chain vanishing reads as "out of charges", not a glitch.
    function playChainBreakFx(def) {
      const fxStart = k.time();
      const col = chainColor(def);
      const handle = k.onDraw(() => {
        const p = (k.time() - fxStart) / 0.6;
        if (p >= 1) { handle.cancel(); return; }
        drawChainBreak(k, { x: k.width() * 0.75, y: 170, color: col, progress: p });
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
      // PV-T12: a burst of element-tinted sparks flung from the impact (screen-space
      // fx pool), raining down under gravity — crits throw more. Complements the
      // existing shockwave ring below with actual flying debris.
      emit({ x, y: 170, n: 8 + Math.round(power * 8), color: col, speed: 90 + power * 70, life: 0.42, size: 2.4, spread: Math.PI * 2, gravity: 130, drag: 1.2, fixed: true });
      const maxR = 40 + power * 48; // bigger burst for bigger hits (crits read as force)
      const handle = k.onDraw(() => {
        const p = (k.time() - t0) / 0.3;
        if (p >= 1) { handle.cancel(); return; }
        const r = 10 + p * maxR;
        k.drawCircle({ pos: k.vec2(x, 170), radius: r, fill: false, outline: { width: Math.max(1, (3 + power * 2) * (1 - p)), color: k.rgb(col[0], col[1], col[2]) }, opacity: 0.85 * (1 - p) });
        k.drawCircle({ pos: k.vec2(x, 170), radius: r * 0.55, fill: false, outline: { width: Math.max(1, 2 * (1 - p)), color: k.rgb(255, 255, 255) }, opacity: 0.5 * (1 - p) });
      });
    }

    // Cast charge: an element-tinted ring that collapses inward onto the attacker the
    // instant it launches an attack — the "cast" beat, before the lunge + impact land.
    // Completes the hit/cast/catch FX trio (PV-T6). a11y: a brief static glow ring
    // instead of the inward collapse under reduce-motion.
    function playCastFx(x, col) {
      const t0 = k.time(), reduce = prefersReducedMotion();
      const handle = k.onDraw(() => {
        const p = (k.time() - t0) / 0.22;
        if (p >= 1) { handle.cancel(); return; }
        const r = reduce ? 26 : 8 + 38 * (1 - p); // collapse inward toward the caster
        k.drawCircle({ pos: k.vec2(x, 170), radius: r, fill: false, outline: { width: 2 + 2 * (1 - p), color: k.rgb(col[0], col[1], col[2]) }, opacity: 0.7 * (1 - p) });
        k.drawCircle({ pos: k.vec2(x, 170), radius: r * 0.5, color: k.rgb(col[0], col[1], col[2]), opacity: 0.18 * (1 - p) });
      });
    }

    // PV-T15: a brief "NEW SPECIES!" banner on a first-ever catch — holds ~1.6s then
    // fades. Self-cancelling onDraw idiom (like the other FX helpers); pure text so it's
    // reduce-motion-safe (no flashing).
    function playNewSpeciesBanner() {
      const t0 = k.time();
      const handle = k.onDraw(() => {
        const age = k.time() - t0;
        if (age > 2.0) { handle.cancel(); return; }
        const a = age < 1.6 ? 1 : Math.max(0, 1 - (age - 1.6) / 0.4);
        k.drawText({ text: "NEW SPECIES!", pos: k.vec2(k.width() / 2, 96), size: 30, font: "gameFont", anchor: "center", color: k.rgb(255, 214, 110), opacity: a });
      });
    }

    function doFlee() {
      state = STATE.PLAYER_FLED;
      narrative = "You fled from battle!";
      narrativeLabel.text = narrative;
      sfx("back"); // flee was the one combat action without audio feedback
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
      // Enemy cast tell (PV-T6 symmetry): when the enemy lands a hit, telegraph its
      // cast on the enemy side, element-tinted — mirrors the player's cast on doAttack
      // so the enemy's attack no longer reads as abrupt next to the player's.
      if (playerDmg > 0) playCastFx(k.width() * 0.75, elementColor(enemyType?.element));
      if (enemyDmg > 0) { flashHit(enemySprite); playHitFx(k.width() * 0.75, [255, 220, 120], enemyPow); lunge("player"); if (!prefersReducedMotion()) addShake(Math.min(0.6, 0.12 + enemyPow * 0.45)); } // PV-A5: damage-scaled jolt (matches MP magnitudes)
      if (playerDmg > 0) { flashHit(playerSprite); playHitFx(k.width() * 0.25, [255, 120, 110], playerPow); lunge("enemy"); if (!prefersReducedMotion()) addShake(Math.min(0.9, 0.2 + playerPow * 0.7)); } // PV-A5: taking a hit kicks harder (matches MP)
      // PV-A5 hit-pause: a ~150ms KO freeze-frame on the finishing blow — time stops as a
      // combatant drops, punctuating the kill before the win/faint sequence plays.
      if (!prefersReducedMotion() && (result.enemyHealth <= 0 || result.playerHealth <= 0)) hitPauseUntil = k.time() + 0.15;
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

      // XP + gold reward (XP tallied on mapData for the run-end summary — MP-parity)
      const pm = getActiveMonster();
      const winXp = 20 + monster.level * 10;
      if (mapData) mapData.runXp = (mapData.runXp || 0) + winXp;
      if (grantXp(pm, winXp)) {
        if (mapData) mapData.runLevelUps = (mapData.runLevelUps || 0) + 1;
        sfx("levelup");
        narrative += ` ${pm.name || pm.typeName} leveled up!`;
        narrativeLabel.text = narrative;
        emit({ x: k.width() * 0.25, y: 140, n: 12, color: [255, 220, 120], speed: 90, life: 0.8, size: 3, gravity: -30, drag: 1.2, fixed: true }); // gold level-up burst (parity with the catch path)
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
          // Death ends the run: run-found chains are forfeited (banked ones stay) AND
          // the active run team is lost (Q10), mirroring the server's death branch and
          // game.js's timeout path.
          const lost = (character.chains || []).filter((c) => c.runFound).length; // P8-T3: report forfeited run-found chains
          loseRunTeam(character, rollStarters); // Q10 death stake (shared SP↔MP rule)
          finalizeRunChains(character, false, getSpiritChain);
          saveCharacter(character);
          k.go("runResult", { characterId, result: "defeat", gains: { chains: lost, gold: 0 } });
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
