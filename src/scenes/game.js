import { findSpawnPoint, biomeSpeedMultAt } from "../engine/mapgen.js";
import { getCharacter, saveCharacter } from "../storage.js";
import { getMonsterType, getMonsterStats, getSpiritChain, getSpiritChains } from "../data.js";
import { drawTiles as drawFloorTiles, makeTileCache } from "../render/tiles.js";
import { GAME, grantChain, finalizeRunChains } from "../engine/schemas.js";
import { healTeam } from "../engine/progression.js";
import { canThrow, rollChainDrop, clusterTargets } from "../engine/spiritchains.js";
import { sprintingNow, tickStamina, sprintMult } from "../engine/movement.js";
import { drawCharacter } from "../render/character.js";
import { drawAtmosphere } from "../render/atmosphere.js";
import { drawSpiritChainModel, drawSpiritChainProjectile, drawChest, drawChainImpact, chainColor } from "../render/spiritchain.js";

const TILE_SIZE = GAME.TILE_SIZE;
const TILE_OVERLAP = GAME.TILE_OVERLAP;
const EFFECTIVE_TILE = GAME.EFFECTIVE_TILE; // tileCoord * this = world px
const RENDER_DISTANCE = 20;
const BASE_SPEED = GAME.BASE_SPEED;
const RUN_DURATION = GAME.ROUND_DURATION_S; // 10 minutes
const CIRCLE_START_TIME = GAME.CIRCLE_START_S; // 5 minutes
const PORTAL_INTERVAL = GAME.PORTAL_INTERVAL_S;

export default function gameScene(k) {
  k.scene("game", ({ characterId, mapData, resumePos, resumeElapsed, resumePortals }) => {
    const character = getCharacter(characterId);
    if (!character) { k.go("characterSelect"); return; }

    const { voidMap, tileMap, mapSize } = mapData;

    // Player state — resume or fresh spawn
    let playerX, playerY;
    if (resumePos) {
      playerX = resumePos.x;
      playerY = resumePos.y;
    } else {
      const spawn = findSpawnPoint(voidMap);
      playerX = spawn.x * EFFECTIVE_TILE;
      playerY = spawn.y * EFFECTIVE_TILE;
    }

    // Timer state
    let elapsed = resumeElapsed || 0;
    let portals = resumePortals || [];
    let circleRadius = mapSize * EFFECTIVE_TILE;
    const circleCenterX = (mapSize / 2) * EFFECTIVE_TILE;
    const circleCenterY = (mapSize / 2) * EFFECTIVE_TILE;

    // Textured-floor cache (the shared MP/SP renderer in render/tiles.js loads a
    // sprite per tile *type* on demand) — P10-T2: SP now uses the same textured
    // floor + cave void/wall-border as the online view.
    const tileCache = makeTileCache();

    // Camera
    k.camPos(playerX, playerY);

    let paused = false;
    let playerMoving = false;
    let playerDir = { x: 0, y: 1 };

    // Spirit-chain throw state: at most one projectile in flight.
    let projectile = null; // { x, y, vx, vy, dist, maxDist, t, chainId }
    let impact = null; // { x, y, color, t0 } — brief landing FX where a thrown chain drops
    let flashMsg = "";
    let flashUntil = 0;

    // Sprint stamina (local in single-player).
    let stamina = GAME.SPRINT.STAMINA_MAX;
    let wasSprinting = false;

    // Loot chests against walls (persisted on mapData so they survive game↔fight
    // round-trips, like tile monsters). Generated once per run; each holds 1–2
    // randomized chains, granted run-found (provisional until you extract).
    const rng = { next: Math.random };
    if (!mapData.chests) mapData.chests = generateChests();
    function isWall(x, y) {
      return x < 0 || x >= mapSize || y < 0 || y >= mapSize || !voidMap[x]?.[y] || tileMap[x][y]?.collidable;
    }
    function generateChests() {
      const defs = getSpiritChains();
      const out = [];
      for (let i = 0; i < GAME.SPIRIT_CHAIN.CHESTS_PER_RUN; i++) {
        for (let attempt = 0; attempt < 80; attempt++) {
          const tx = Math.floor(Math.random() * mapSize);
          const ty = Math.floor(Math.random() * mapSize);
          if (isWall(tx, ty)) continue;
          if (!(isWall(tx - 1, ty) || isWall(tx + 1, ty) || isWall(tx, ty - 1) || isWall(tx, ty + 1))) continue;
          const count = Math.random() < 0.35 ? 2 : 1;
          const loot = [];
          for (let n = 0; n < count; n++) { const d = rollChainDrop(defs, rng); if (d) loot.push(d.id); }
          if (loot.length) out.push({ id: `ch${i}`, x: tx * EFFECTIVE_TILE + EFFECTIVE_TILE / 2, y: ty * EFFECTIVE_TILE + EFFECTIVE_TILE / 2, loot });
          break;
        }
      }
      return out;
    }

    // Main update loop
    k.onUpdate(() => {
      if (paused) return;
      elapsed += k.dt();
      handleMovement();
      updateProjectile(k.dt());
      k.camPos(playerX, playerY);
      updateCircle();
      checkPortalCollision();
      checkChest();
      checkMonsterEncounter();
    });

    // HUD elements (fixed to screen)
    const timerLabel = k.add([
      k.text("10:00", { size: 32, font: "gameFont" }),
      k.pos(k.width() / 2, 30),
      k.anchor("center"),
      k.color(255, 255, 255),
      k.fixed(),
      k.z(100),
    ]);

    const portalHint = k.add([
      k.text("", { size: 16, font: "gameFont" }),
      k.pos(k.width() / 2, 60),
      k.anchor("center"),
      k.color(80, 220, 255),
      k.fixed(),
      k.z(100),
    ]);

    // Update HUD in the update loop
    k.onUpdate(() => {
      if (paused) return;
      const remaining = Math.max(0, RUN_DURATION - elapsed);
      const minutes = Math.floor(remaining / 60);
      const seconds = Math.floor(remaining % 60);
      timerLabel.text = `${minutes}:${seconds.toString().padStart(2, "0")}`;

      if (remaining < 60) timerLabel.color = k.rgb(255, 60, 60);
      else if (remaining < 180) timerLabel.color = k.rgb(255, 255, 60);
      else timerLabel.color = k.rgb(255, 255, 255);

      if (elapsed >= CIRCLE_START_TIME && portals.length > 0) {
        portalHint.text = "Portals available! Step on one to escape.";
      } else {
        portalHint.text = "";
      }
    });

    // Rendering
    k.onDraw(() => {
      drawTiles();
      drawChests();
      drawAim();
      drawPlayer();
      drawProjectile();
      drawPortals();
      drawCircleOverlay();
      drawAtmosphere(k, { t: k.time() }); // vignette + spirit-light + motes (over world, under HUD)
      drawMinimap();
      drawTeamHud();
      drawChainHud();
    });

    function handleMovement() {
      let dx = 0, dy = 0;
      if (k.isKeyDown("w") || k.isKeyDown("up")) dy = -1;
      if (k.isKeyDown("s") || k.isKeyDown("down")) dy = 1;
      if (k.isKeyDown("a") || k.isKeyDown("left")) dx = -1;
      if (k.isKeyDown("d") || k.isKeyDown("right")) dx = 1;

      playerMoving = !(dx === 0 && dy === 0);

      // Sprint + stamina (ticks every frame so it regenerates while idle too).
      const sprinting = sprintingNow({ sprint: k.isKeyDown("shift"), moving: playerMoving, stamina, wasSprinting }, GAME);
      stamina = tickStamina(stamina, sprinting, k.dt(), GAME);
      wasSprinting = sprinting;

      if (dx === 0 && dy === 0) return;
      playerDir = { x: dx, y: dy };

      // Normalize diagonal
      if (dx !== 0 && dy !== 0) {
        dx *= 0.707;
        dy *= 0.707;
      }

      const speedMod = biomeSpeedMultAt(mapData, playerX, playerY); // per-biome terrain speed
      const speed = BASE_SPEED * speedMod * sprintMult(sprinting, GAME) * k.dt();

      const newX = playerX + dx * speed;
      const newY = playerY + dy * speed;

      // Check collision for X movement
      if (isWalkable(newX, playerY)) {
        playerX = newX;
      }
      // Check collision for Y movement
      if (isWalkable(playerX, newY)) {
        playerY = newY;
      }
    }

    function getTileAt(px, py) {
      const tx = Math.floor(px / EFFECTIVE_TILE);
      const ty = Math.floor(py / EFFECTIVE_TILE);
      if (tx < 0 || tx >= mapSize || ty < 0 || ty >= mapSize) return null;
      return tileMap[tx][ty];
    }

    function isWalkable(px, py) {
      // Check two points (left edge and center) for collision
      const tx1 = Math.floor(px / EFFECTIVE_TILE);
      const ty1 = Math.floor(py / EFFECTIVE_TILE);
      if (tx1 < 0 || tx1 >= mapSize || ty1 < 0 || ty1 >= mapSize) return false;
      if (!voidMap[tx1][ty1]) return false;
      const tile = tileMap[tx1][ty1];
      if (tile && tile.collidable) return false;
      return true;
    }

    function drawTiles() {
      // Textured floor + cave void/wall-border — shared renderer (render/tiles.js),
      // identical to the online view (P10-T2 parity; replaces SP's old flat tiles).
      drawFloorTiles(k, mapData, playerX, playerY, tileCache, EFFECTIVE_TILE);

      // Monsters sitting on tiles: each visible one's procedural sprite, grounded
      // with a soft shadow (SP keeps wild monsters on the tilemap; amber fallback).
      const halfW = k.width() / 2, halfH = k.height() / 2;
      const startX = Math.max(0, Math.floor((playerX - halfW) / EFFECTIVE_TILE) - 1);
      const endX = Math.min(mapSize - 1, Math.ceil((playerX + halfW) / EFFECTIVE_TILE) + 1);
      const startY = Math.max(0, Math.floor((playerY - halfH) / EFFECTIVE_TILE) - 1);
      const endY = Math.min(mapSize - 1, Math.ceil((playerY + halfH) / EFFECTIVE_TILE) + 1);
      const ptx = Math.floor(playerX / EFFECTIVE_TILE), pty = Math.floor(playerY / EFFECTIVE_TILE);

      for (let x = startX; x <= endX; x++) {
        for (let y = startY; y <= endY; y++) {
          const tile = tileMap[x][y];
          if (!tile || !tile.activeMonster) continue;
          if (Math.abs(x - ptx) + Math.abs(y - pty) > RENDER_DISTANCE) continue;
          const centerX = x * EFFECTIVE_TILE + EFFECTIVE_TILE / 2;
          const centerY = y * EFFECTIVE_TILE + EFFECTIVE_TILE / 2;
          const am = tile.activeMonster;
          k.drawEllipse({ pos: k.vec2(centerX, centerY + 20), radiusX: 15, radiusY: 5, color: k.rgb(0, 0, 0), opacity: 0.28 });
          try {
            k.drawSprite({ sprite: (am.typeName || "").toLowerCase().replace(/\s+/g, "_"), pos: k.vec2(centerX, centerY), anchor: "center", scale: 0.45 });
          } catch {
            k.drawCircle({ pos: k.vec2(centerX, centerY), radius: 8, color: k.rgb(220, 180, 80) });
          }
        }
      }
    }

    function drawPlayer() {
      drawCharacter(k, { x: playerX, y: playerY - 8, t: k.time(), moving: playerMoving, color: [90, 170, 255], dir: playerDir });
    }

    // Faint telegraph line from the player along the current aim, when a chain
    // is equipped, ready, and nothing is in flight.
    function drawAim() {
      if (projectile) return;
      const chainState = getEquippedChainState();
      const def = chainState && getSpiritChain(chainState.chainId);
      if (!def || !canThrow(chainState)) return;
      const len = Math.hypot(playerDir.x, playerDir.y) || 1;
      const ux = playerDir.x / len, uy = playerDir.y / len;
      const col = chainColor(def);
      k.drawLine({
        p1: k.vec2(playerX, playerY - 8),
        p2: k.vec2(playerX + ux * def.throwRange, playerY - 8 + uy * def.throwRange),
        width: 1.5,
        color: k.rgb(col[0], col[1], col[2]),
        opacity: 0.18,
      });
    }

    function drawProjectile() {
      if (projectile) {
        const def = getSpiritChain(projectile.chainId);
        drawSpiritChainProjectile(k, projectile, chainColor(def), k.time());
      }
      // Landing impact (miss/drop) — ~0.32s, then clears.
      if (impact) {
        const p = (k.time() - impact.t0) / 0.32;
        if (p >= 1) { impact = null; }
        else drawChainImpact(k, { x: impact.x, y: impact.y, color: impact.color, progress: p });
      }
    }

    function drawChests() {
      const chests = mapData.chests;
      if (!chests) return;
      for (const c of chests) drawChest(k, { x: c.x, y: c.y, t: k.time() });
    }

    function drawPortals() {
      for (const portal of portals) {
        const px = portal.x * EFFECTIVE_TILE + EFFECTIVE_TILE / 2;
        const py = portal.y * EFFECTIVE_TILE + EFFECTIVE_TILE / 2;

        // Pulsating glow
        const pulse = 0.6 + 0.4 * Math.sin(elapsed * 4);
        k.drawCircle({
          pos: k.vec2(px, py),
          radius: 20 * pulse,
          color: k.rgb(0, 200, 255),
          opacity: 0.3,
        });
        k.drawCircle({
          pos: k.vec2(px, py),
          radius: 10,
          color: k.rgb(80, 220, 255),
          opacity: 0.8,
        });
      }
    }

    function updateCircle() {
      if (elapsed < CIRCLE_START_TIME) return;

      const remaining = RUN_DURATION - elapsed;
      const circleTime = RUN_DURATION - CIRCLE_START_TIME;
      const ratio = Math.max(0, remaining / circleTime);
      circleRadius = ratio * (mapSize / 2) * EFFECTIVE_TILE;

      // Spawn portal periodically. Break if a spawn fails (no walkable tile found)
      // — otherwise the loop spins forever, since portals.length never grows. This
      // mirrors the server's guarded loop (world.js spawnPortal). The failure case
      // gets likelier as circleRadius shrinks late in a run.
      const portalCount = Math.floor((elapsed - CIRCLE_START_TIME) / PORTAL_INTERVAL);
      while (portals.length < portalCount + 1) {
        if (!spawnPortal()) break;
      }
    }

    // Returns true if a portal was placed, false if no walkable tile was found.
    function spawnPortal() {
      for (let attempt = 0; attempt < 100; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * circleRadius * 0.8;
        const px = Math.floor((circleCenterX + Math.cos(angle) * dist) / EFFECTIVE_TILE);
        const py = Math.floor((circleCenterY + Math.sin(angle) * dist) / EFFECTIVE_TILE);
        if (px >= 0 && px < mapSize && py >= 0 && py < mapSize && voidMap[px][py]) {
          portals.push({ x: px, y: py });
          return true;
        }
      }
      return false;
    }

    function checkPortalCollision() {
      const ptx = Math.floor(playerX / EFFECTIVE_TILE);
      const pty = Math.floor(playerY / EFFECTIVE_TILE);
      for (const portal of portals) {
        if (portal.x === ptx && portal.y === pty) {
          character.gold = (character.gold || 0) + GAME.GOLD.PER_EXTRACT; // extract bonus
          endRunStakes(true); // extracted → keep run-found chains (saves)
          k.go("runResult", { characterId, result: "victory" });
          return;
        }
      }

      // Time's up
      if (elapsed >= RUN_DURATION) {
        endRunStakes(false); // timeout → lose run-found chains
        k.go("runResult", { characterId, result: "defeat" });
      }
    }

    // Resolve spirit-chain extraction stakes at run end and persist.
    function endRunStakes(kept) {
      if (kept) healTeam(character.activeMonsters); // extract → survivors heal (P10-T3: parity with MP)
      finalizeRunChains(character, kept, getSpiritChain);
      saveCharacter(character);
    }

    function checkMonsterEncounter() {
      const ptx = Math.floor(playerX / EFFECTIVE_TILE);
      const pty = Math.floor(playerY / EFFECTIVE_TILE);
      if (ptx < 0 || ptx >= mapSize || pty < 0 || pty >= mapSize) return;
      const tile = tileMap[ptx][pty];
      if (tile?.activeMonster) {
        const monster = tile.activeMonster;
        tile.activeMonster = null;
        // Walking into a monster: the monster gets initiative (first turn).
        k.go("fight", { characterId, monster, mapData, playerPos: { x: playerX, y: playerY }, elapsed, portals, initiator: "monster" });
      }
    }

    // ── Spirit-chain throwing ──────────────────────────────────────────────
    // The live counters for the player's currently equipped chain.
    function getEquippedChainState() {
      const id = character.equippedChainId;
      return (character.chains || []).find((c) => c.chainId === id) || null;
    }

    function flashHud(msg) {
      flashMsg = msg;
      flashUntil = k.time() + 1.4;
    }

    function tryThrowChain() {
      if (paused || projectile) return; // one chain in flight at a time
      const chainState = getEquippedChainState();
      const def = chainState && getSpiritChain(chainState.chainId);
      if (!def) { flashHud("No chain equipped"); return; }
      if (!canThrow(chainState)) { flashHud("No throws left"); return; }

      const len = Math.hypot(playerDir.x, playerDir.y) || 1;
      projectile = {
        x: playerX,
        y: playerY - 8,
        vx: (playerDir.x / len) * def.throwSpeed,
        vy: (playerDir.y / len) * def.throwSpeed,
        dist: 0,
        maxDist: def.throwRange,
        t: 0,
        chainId: def.id,
      };
      // Decrement the overworld throw counter now (a miss still costs a throw).
      if (chainState.throwCount != null) chainState.throwCount--;
      saveCharacter(character);
    }

    function updateProjectile(dt) {
      if (!projectile) return;
      const def = getSpiritChain(projectile.chainId);
      const ttl = GAME.SPIRIT_CHAIN.PROJECTILE_TTL_S;
      const speed = def ? def.throwSpeed : Math.hypot(projectile.vx, projectile.vy);
      projectile.x += projectile.vx * dt;
      projectile.y += projectile.vy * dt;
      projectile.dist += speed * dt;
      projectile.t += dt;

      const hit = findMonsterNear(projectile.x, projectile.y, GAME.SPIRIT_CHAIN.HIT_RADIUS);
      if (hit) {
        startCombatFromThrow(hit);
        projectile = null;
        return;
      }
      if (projectile.dist >= projectile.maxDist || projectile.t > ttl || !isWalkable(projectile.x, projectile.y)) {
        // Missed — drop the chain with a brief landing impact so it reads as a miss.
        impact = { x: projectile.x, y: projectile.y, color: chainColor(def), t0: k.time() };
        projectile = null;
      }
    }

    // Find a tile-bound monster whose center is within `r` world-px of (px,py).
    // Scans the 3×3 tile neighbourhood around the point (cheap).
    function findMonsterNear(px, py, r) {
      const ctx = Math.floor(px / EFFECTIVE_TILE);
      const cty = Math.floor(py / EFFECTIVE_TILE);
      const r2 = r * r;
      for (let tx = ctx - 1; tx <= ctx + 1; tx++) {
        for (let ty = cty - 1; ty <= cty + 1; ty++) {
          if (tx < 0 || tx >= mapSize || ty < 0 || ty >= mapSize) continue;
          const tile = tileMap[tx][ty];
          if (!tile?.activeMonster) continue;
          const cx = tx * EFFECTIVE_TILE + EFFECTIVE_TILE / 2;
          const cy = ty * EFFECTIVE_TILE + EFFECTIVE_TILE / 2;
          const dx = cx - px, dy = cy - py;
          if (dx * dx + dy * dy <= r2) return { tile, monster: tile.activeMonster, tx, ty };
        }
      }
      return null;
    }

    function startCombatFromThrow(hit) {
      const monster = hit.monster;
      const chainId = projectile.chainId;
      hit.tile.activeMonster = null;
      // Hydra Lash (multi): pull the nearest cluster off the map into a queue for
      // a sequential multi-capture; the fight scene chains through them.
      let queue = [];
      const def = getSpiritChain(chainId);
      if (def?.special === "multi") {
        const ET = EFFECTIVE_TILE;
        const origin = { x: hit.tx * ET + ET / 2, y: hit.ty * ET + ET / 2 };
        const span = Math.ceil(GAME.SPIRIT_CHAIN.MULTI_CHAIN_RADIUS / ET) + 1;
        const cands = [];
        for (let tx = hit.tx - span; tx <= hit.tx + span; tx++) {
          for (let ty = hit.ty - span; ty <= hit.ty + span; ty++) {
            if (tx < 0 || tx >= mapSize || ty < 0 || ty >= mapSize) continue;
            const tile = tileMap[tx][ty];
            if (!tile?.activeMonster || tile === hit.tile) continue;
            cands.push({ tile, mon: tile.activeMonster, x: tx * ET + ET / 2, y: ty * ET + ET / 2 });
          }
        }
        const picked = clusterTargets(origin, cands, GAME.SPIRIT_CHAIN.MULTI_CHAIN_RADIUS, GAME.SPIRIT_CHAIN.MULTI_MAX_TARGETS - 1);
        for (const c of picked) { c.tile.activeMonster = null; queue.push(c.mon); }
      }
      // Landing a chain grants the player initiative (first turn).
      k.go("fight", { characterId, monster, mapData, playerPos: { x: playerX, y: playerY }, elapsed, portals, initiator: "player", chainId, queue });
    }

    // Open a loot chest when the player reaches it; loot is run-found (lost on a
    // failed run, kept on extraction — see endRun stakes).
    function checkChest() {
      const chests = mapData.chests;
      if (!chests || !chests.length) return;
      const r = GAME.SPIRIT_CHAIN.PICKUP_RADIUS, r2 = r * r;
      for (let i = 0; i < chests.length; i++) {
        const c = chests[i];
        const dx = c.x - playerX, dy = c.y - playerY;
        if (dx * dx + dy * dy <= r2) {
          const names = [];
          for (const chainId of c.loot) {
            const def = getSpiritChain(chainId);
            if (def) { grantChain(character, chainId, def, true); names.push(def.name); }
          }
          character.essence = (character.essence || 0) + GAME.CRAFT.ESSENCE_PER_CHEST;
          saveCharacter(character);
          if (names.length) flashHud(`Found ${names.join(" + ")}  ·  +${GAME.CRAFT.ESSENCE_PER_CHEST} essence`);
          chests.splice(i, 1);
          return;
        }
      }
    }

    function cycleChain(dir) {
      const chains = character.chains || [];
      if (chains.length <= 1) return;
      let idx = chains.findIndex((c) => c.chainId === character.equippedChainId);
      if (idx < 0) idx = 0;
      idx = (idx + dir + chains.length) % chains.length;
      character.equippedChainId = chains[idx].chainId;
      saveCharacter(character);
      const def = getSpiritChain(character.equippedChainId);
      flashHud(def ? def.name : "Chain");
    }

    function drawCircleOverlay() {
      if (elapsed < CIRCLE_START_TIME) return;
      // Draw red circle boundary (in world space)
      k.drawCircle({
        pos: k.vec2(circleCenterX, circleCenterY),
        radius: circleRadius,
        fill: false,
        outline: { width: 3, color: k.rgb(255, 50, 50) },
        opacity: 0.6,
      });
    }

    function drawMinimap() {
      // Convert screen-space coords to world-space for drawing
      const camX = playerX;
      const camY = playerY;
      const mmSize = 160;
      const screenRight = camX + k.width() / 2;
      const screenBottom = camY + k.height() / 2;
      const mmX = screenRight - mmSize - 16;
      const mmY = screenBottom - mmSize - 16;
      const mmScale = mmSize / mapSize;

      k.drawRect({
        pos: k.vec2(mmX, mmY),
        width: mmSize,
        height: mmSize,
        color: k.rgb(0, 0, 0),
        opacity: 0.7,
      });

      for (let x = 0; x < mapSize; x += 2) {
        for (let y = 0; y < mapSize; y += 2) {
          if (voidMap[x][y]) {
            k.drawRect({
              pos: k.vec2(mmX + x * mmScale, mmY + y * mmScale),
              width: Math.max(1, mmScale * 2),
              height: Math.max(1, mmScale * 2),
              color: k.rgb(40, 80, 40),
            });
          }
        }
      }

      for (const portal of portals) {
        k.drawCircle({
          pos: k.vec2(mmX + portal.x * mmScale, mmY + portal.y * mmScale),
          radius: 3,
          color: k.rgb(80, 180, 255),
        });
      }

      // Chests reveal on the minimap only within a short radius (discovery).
      const cmr2 = GAME.SPIRIT_CHAIN.CHEST_MINIMAP_RADIUS ** 2;
      for (const c of (mapData.chests || [])) {
        const dx = c.x - playerX, dy = c.y - playerY;
        if (dx * dx + dy * dy > cmr2) continue;
        k.drawCircle({
          pos: k.vec2(mmX + (c.x / EFFECTIVE_TILE) * mmScale, mmY + (c.y / EFFECTIVE_TILE) * mmScale),
          radius: 2.5,
          color: k.rgb(228, 206, 128),
        });
      }

      if (elapsed >= CIRCLE_START_TIME) {
        k.drawCircle({
          pos: k.vec2(mmX + (mapSize / 2) * mmScale, mmY + (mapSize / 2) * mmScale),
          radius: (circleRadius / EFFECTIVE_TILE) * mmScale,
          fill: false,
          outline: { width: 1, color: k.rgb(255, 50, 50) },
        });
      }

      const pmmX = mmX + (playerX / EFFECTIVE_TILE) * mmScale;
      const pmmY = mmY + (playerY / EFFECTIVE_TILE) * mmScale;
      k.drawCircle({
        pos: k.vec2(pmmX, pmmY),
        radius: 3,
        color: k.rgb(255, 50, 50),
      });

      k.drawRect({
        pos: k.vec2(mmX, mmY),
        width: mmSize,
        height: mmSize,
        fill: false,
        outline: { width: 1, color: k.rgb(100, 100, 100) },
      });
    }

    // Team HP HUD (top-left, fixed position, drawn in world space offset by camera)
    function drawTeamHud() {
      const team = character.activeMonsters || [];
      const hudX = playerX - k.width() / 2 + 16;
      const hudY = playerY - k.height() / 2 + 16;
      const barW = 80, barH = 6, slotH = 28;

      for (let i = 0; i < team.length; i++) {
        const mon = team[i];
        const mt = getMonsterType(mon.typeName);
        if (!mt) continue;
        const stats = getMonsterStats(mt, mon.level);
        const y = hudY + i * slotH;
        const hpRatio = mon.currentHealth / stats.health;

        k.drawRect({
          pos: k.vec2(hudX, y),
          width: barW + 60,
          height: slotH - 4,
          color: k.rgb(0, 0, 0),
          opacity: 0.5,
          radius: 3,
        });

        const name = (mon.name || mon.typeName);
        const label = name.length > 8 ? name.slice(0, 8) : name;
        k.drawText({
          text: label,
          pos: k.vec2(hudX + 4, y + 3),
          size: 10,
          font: "gameFont",
          color: mon.currentHealth > 0 ? k.rgb(200, 200, 210) : k.rgb(120, 60, 60),
        });

        // HP bar background
        k.drawRect({
          pos: k.vec2(hudX + 60, y + 5),
          width: barW,
          height: barH,
          color: k.rgb(40, 20, 20),
          radius: 2,
        });

        // HP bar fill
        const hpColor = hpRatio < 0.25 ? k.rgb(220, 50, 50)
          : hpRatio < 0.5 ? k.rgb(220, 180, 50)
          : k.rgb(50, 180, 80);
        k.drawRect({
          pos: k.vec2(hudX + 60, y + 5),
          width: Math.max(0, barW * hpRatio),
          height: barH,
          color: hpColor,
          radius: 2,
        });
      }
    }

    // Equipped-chain HUD (bottom-left): icon, name, throws left, durability.
    // Drawn in world space offset by the camera, matching drawTeamHud.
    function drawChainHud() {
      const chainState = getEquippedChainState();
      const def = chainState && getSpiritChain(chainState.chainId);
      const hudX = playerX - k.width() / 2 + 16;
      const hudY = playerY + k.height() / 2 - 64;

      k.drawRect({ pos: k.vec2(hudX, hudY), width: 188, height: 48, color: k.rgb(0, 0, 0), opacity: 0.5, radius: 4 });

      // Sprint stamina bar just above the chain panel.
      const sr = stamina / GAME.SPRINT.STAMINA_MAX;
      k.drawRect({ pos: k.vec2(hudX, hudY - 10), width: 188, height: 5, color: k.rgb(30, 32, 42), radius: 2 });
      k.drawRect({ pos: k.vec2(hudX, hudY - 10), width: Math.max(0, 188 * sr), height: 5, color: sr > 0.3 ? k.rgb(120, 200, 230) : k.rgb(220, 170, 80), radius: 2 });

      if (def) {
        const col = chainColor(def);
        drawSpiritChainModel(k, { x: hudX + 22, y: hudY + 24, color: col, t: k.time(), scale: 1 });
        const throws = chainState.throwCount == null ? "∞" : String(chainState.throwCount);
        k.drawText({ text: def.name, pos: k.vec2(hudX + 44, hudY + 6), size: 12, font: "gameFont", color: k.rgb(220, 220, 230) });
        k.drawText({ text: `Throws ${throws}   Charges ${chainState.durability}`, pos: k.vec2(hudX + 44, hudY + 26), size: 11, font: "gameFont", color: k.rgb(170, 180, 200) });
      } else {
        k.drawText({ text: "No chain", pos: k.vec2(hudX + 12, hudY + 18), size: 12, font: "gameFont", color: k.rgb(150, 150, 160) });
      }

      // Transient feedback line above the chain panel.
      if (k.time() < flashUntil && flashMsg) {
        k.drawText({ text: flashMsg, pos: k.vec2(hudX, hudY - 18), size: 13, font: "gameFont", color: k.rgb(255, 230, 140) });
      }
    }

    // Throw the equipped chain along the current facing; cycle equipped chain.
    k.onKeyPress("q", () => { if (!paused) tryThrowChain(); });
    k.onKeyPress("[", () => { if (!paused) cycleChain(-1); });
    k.onKeyPress("]", () => { if (!paused) cycleChain(1); });

    // Pause menu
    k.onKeyPress("escape", () => {
      if (paused) {
        resumeGame();
      } else {
        showPauseMenu();
      }
    });

    function showPauseMenu() {
      paused = true;
      k.destroyAll("pauseUI");

      k.add([
        k.rect(k.width(), k.height()),
        k.pos(0, 0),
        k.color(0, 0, 0),
        k.opacity(0.6),
        k.fixed(),
        k.z(200),
        "pauseUI",
      ]);

      k.add([
        k.text("PAUSED", { size: 48, font: "gameFont" }),
        k.pos(k.width() / 2, k.height() / 2 - 80),
        k.anchor("center"),
        k.color(255, 255, 255),
        k.fixed(),
        k.z(201),
        "pauseUI",
      ]);

      const resumeBtn = k.add([
        k.rect(220, 48, { radius: 8 }),
        k.pos(k.width() / 2, k.height() / 2),
        k.anchor("center"),
        k.color(50, 100, 70),
        k.area(),
        k.fixed(),
        k.z(201),
        "pauseUI",
      ]);
      k.add([
        k.text("Resume", { size: 22, font: "gameFont" }),
        k.pos(k.width() / 2, k.height() / 2),
        k.anchor("center"),
        k.color(220, 255, 220),
        k.fixed(),
        k.z(202),
        "pauseUI",
      ]);
      resumeBtn.onClick(() => resumeGame());

      const quitBtn = k.add([
        k.rect(220, 48, { radius: 8 }),
        k.pos(k.width() / 2, k.height() / 2 + 64),
        k.anchor("center"),
        k.color(120, 50, 50),
        k.area(),
        k.fixed(),
        k.z(201),
        "pauseUI",
      ]);
      k.add([
        k.text("Quit Run", { size: 22, font: "gameFont" }),
        k.pos(k.width() / 2, k.height() / 2 + 64),
        k.anchor("center"),
        k.color(255, 200, 200),
        k.fixed(),
        k.z(202),
        "pauseUI",
      ]);
      quitBtn.onClick(() => {
        paused = false;
        k.destroyAll("pauseUI");
        endRunStakes(false); // abandoning the run forfeits run-found chains
        k.go("lobby", { characterId });
      });
    }

    function resumeGame() {
      paused = false;
      k.destroyAll("pauseUI");
    }

  });
}
