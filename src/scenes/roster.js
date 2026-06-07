import { net } from "../netClient.js";
import { getMonsterType, getSpiritChain } from "../engine/gamedata.js";
import { getMonsterStats } from "../engine/stats.js";
import { THEME, FONT, elementColor } from "../ui/theme.js";
import { sortMonsters, nextSortMode, SORT_LABELS, filterMonsters, elementFilterOptions, ELEMENT_ALL, sortChainsByTier } from "../engine/rosterSort.js";

// Team & vault management (P8-T2) — the between-rounds meta-loop. Shows the active
// team (≤4) and the vault (everything caught + looted), and lets the player choose
// which monsters they bring into the next run. Tap a team monster to store it; tap
// a vault monster to field it. Changes are sent to the server (setRoster), which
// validates (idle-only, ≥1 active) and echoes the authoritative roster back.
// Styled with the shared dark-flat design system (src/ui/theme.js).
export default function rosterScene(k) {
  k.scene("roster", () => {
    const slug = (n) => String(n || "").toLowerCase().replace(/\s+/g, "_");
    const col = (t) => k.rgb(...t); // [r,g,b] -> Kaboom Color
    const TEAM_MAX = 4;

    // Local working copy; reconciled from the server's authoritative "roster" echo.
    let active = [...(net.state.team || [])];
    let vault = [...(net.state.vault || [])];
    let scrollY = 0;
    let dragging = false, lastY = 0, moved = 0;
    let toast = "", toastT = 0;
    let tab = "monsters"; // "monsters" (team & vault) | "chains" (spirit-chain inventory)
    let sortMode = "recent"; // INV-T6: vault sort (recent/level/rarity/element)
    let filterEl = ELEMENT_ALL; // INV-T6: vault element filter ("all" or an element)

    const HEADER = 56;
    const CARD_W = 150, CARD_H = 120, GAP = 14;
    const ACTIVE_TOP = HEADER + 34;
    const ACTIVE_BOTTOM = ACTIVE_TOP + CARD_H;
    const VAULT_LABEL_Y = ACTIVE_BOTTOM + 20;
    const VAULT_TOP = VAULT_LABEL_Y + 26;

    // INV-T6: the sorted view of the vault used for BOTH drawing and hit-testing,
    // so a tapped card maps to the right monster. Reference-stable, so we can find
    // the source-array index by identity (see fieldFromVault).
    const viewVault = () => sortMonsters(filterMonsters(vault, filterEl, getMonsterType), sortMode, getMonsterType);
    const sortBtnRect = () => [148, VAULT_LABEL_Y - 3, 132, 24];
    const filterBtnRect = () => [288, VAULT_LABEL_Y - 3, 132, 24];

    const cols = () => Math.max(1, Math.floor((k.width() - GAP) / (CARD_W + GAP)));
    const vaultRows = () => Math.ceil(vault.length / cols());
    const contentH = () => vaultRows() * (CARD_H + GAP) + GAP;
    const maxScroll = () => Math.max(0, contentH() - (k.height() - VAULT_TOP));
    const clampScroll = () => { scrollY = Math.min(maxScroll(), Math.max(0, scrollY)); };
    const backRect = () => [k.width() - 96, 12, 82, 34];
    const inRect = (p, [x, y, w, h]) => p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;

    const activeX0 = () => {
      const gridW = TEAM_MAX * CARD_W + (TEAM_MAX - 1) * GAP;
      return (k.width() - gridW) / 2;
    };
    const vaultX0 = () => {
      const c = cols();
      const gridW = c * CARD_W + (c - 1) * GAP;
      return (k.width() - gridW) / 2;
    };

    // Which active slot (0..3) is under a point, or -1.
    const activeSlotAt = (p) => {
      if (p.y < ACTIVE_TOP || p.y > ACTIVE_BOTTOM) return -1;
      const relX = p.x - activeX0();
      if (relX < 0) return -1;
      const c = Math.floor(relX / (CARD_W + GAP));
      if (c < 0 || c >= TEAM_MAX) return -1;
      if (relX - c * (CARD_W + GAP) > CARD_W) return -1; // in the gap
      return c;
    };
    // Which vault index is under a point, or -1.
    const vaultCardAt = (p) => {
      if (p.y < VAULT_TOP) return -1;
      const c = cols();
      const relX = p.x - vaultX0(), relY = p.y - (VAULT_TOP - scrollY);
      if (relX < 0 || relY < 0) return -1;
      const cc = Math.floor(relX / (CARD_W + GAP)), row = Math.floor(relY / (CARD_H + GAP));
      if (cc < 0 || cc >= c) return -1;
      if (relX - cc * (CARD_W + GAP) > CARD_W || relY - row * (CARD_H + GAP) > CARD_H) return -1;
      const idx = row * c + cc;
      return idx >= 0 && idx < vault.length ? idx : -1;
    };

    const showToast = (s) => { toast = s; toastT = 2.2; };
    const sync = () => net.setRoster(active.map((m) => m.id));

    function fieldFromVault(idx) {
      if (active.length >= TEAM_MAX) { showToast("Team is full (4). Store one first."); return; }
      const m = viewVault()[idx]; // idx is into the sorted view
      const real = m ? vault.indexOf(m) : -1; // map back to the source array by identity
      if (real < 0) return;
      vault.splice(real, 1);
      active.push(m);
      sync();
    }
    function storeFromActive(slot) {
      if (slot >= active.length) return;
      if (active.length <= 1) { showToast("You need at least one monster on your team."); return; }
      const [m] = active.splice(slot, 1);
      vault.unshift(m);
      sync();
    }

    // ── Spirit-chain inventory (the "Chains" tab) ────────────────────────────
    // Tab bar lives in the header; tap a chain card to equip it (the equipped
    // chain is what Q/throw + in-fight catch use). The server owns equippedChainId
    // (validates ownership, no echo), so we update it optimistically here.
    const tabRects = () => {
      const w = 116, h = 30, y = 13;
      return [["monsters", "Monsters", [20, y, w, h]], ["chains", "Spirit Chains", [20 + w + 8, y, w + 22, h]]];
    };
    const ownedChains = () => (net.state.chains || [])
      .map((cs) => ({ cs, def: getSpiritChain(cs.chainId) })).filter((c) => c.def);
    // INV-T6: chains shown highest-tier first. Used for render AND hit-test AND
    // equip so a tapped card maps to the right chain (same pattern as viewVault).
    const viewChains = () => sortChainsByTier(ownedChains());
    const CHAIN_W = 250, CHAIN_H = 92, CHAIN_GAP = 14;
    const chainTop = HEADER + 40;
    const chainCols = () => Math.max(1, Math.floor((k.width() - CHAIN_GAP) / (CHAIN_W + CHAIN_GAP)));
    const chainX0 = () => { const c = chainCols(); return (k.width() - (c * CHAIN_W + (c - 1) * CHAIN_GAP)) / 2; };
    const chainCardAt = (p) => {
      const list = viewChains();
      const c = chainCols(), relX = p.x - chainX0(), relY = p.y - chainTop;
      if (relX < 0 || relY < 0) return -1;
      const cc = Math.floor(relX / (CHAIN_W + CHAIN_GAP)), row = Math.floor(relY / (CHAIN_H + CHAIN_GAP));
      if (cc < 0 || cc >= c) return -1;
      if (relX - cc * (CHAIN_W + CHAIN_GAP) > CHAIN_W || relY - row * (CHAIN_H + CHAIN_GAP) > CHAIN_H) return -1;
      const idx = row * c + cc;
      return idx >= 0 && idx < list.length ? idx : -1;
    };
    const SPECIAL_LABEL = { endless: "∞ throws — never depletes", guaranteed: "guaranteed catch ≤25% HP", multi: "captures nearby monsters" };
    function drawChainCard(x, y, cs, def, equipped) {
      const cc = def.color || [150, 150, 160];
      k.drawRect({ pos: k.vec2(x, y), width: CHAIN_W, height: CHAIN_H, radius: 12, color: col(equipped ? THEME.surface2 : THEME.surface), outline: { width: equipped ? 3 : 2, color: col(equipped ? THEME.primary : cc) } });
      k.drawCircle({ pos: k.vec2(x + 24, y + 26), radius: 11, color: k.rgb(cc[0], cc[1], cc[2]) });
      k.drawText({ text: def.name, pos: k.vec2(x + 44, y + 14), size: 15, font: FONT, color: col(THEME.text) });
      k.drawText({ text: `Tier ${def.tier}     catches up to rarity ${def.maxRarity}`, pos: k.vec2(x + 44, y + 34), size: 11, font: FONT, color: col(THEME.textMut) });
      const throws = cs.throwCount == null ? "∞" : String(cs.throwCount);
      k.drawText({ text: `Throws ${throws}       Charges ${cs.durability}`, pos: k.vec2(x + 14, y + 58), size: 12, font: FONT, color: col(THEME.textBody) });
      if (def.special && SPECIAL_LABEL[def.special]) k.drawText({ text: SPECIAL_LABEL[def.special], pos: k.vec2(x + 14, y + 77), size: 10, font: FONT, color: col(THEME.violet) });
      if (equipped) k.drawText({ text: "EQUIPPED", pos: k.vec2(x + CHAIN_W - 12, y + 14), size: 11, font: FONT, anchor: "topright", color: col(THEME.primary) });
    }
    function equipChain(idx) {
      const c = viewChains()[idx];
      if (!c) return;
      if (net.state.equippedChainId === c.cs.chainId) { showToast(`${c.def.name} already equipped`); return; }
      net.setEquippedChain(c.cs.chainId);
      net.state.equippedChainId = c.cs.chainId; // optimistic (server validates owned; no echo in the lobby)
      showToast(`Equipped ${c.def.name}`);
    }

    // Background.
    k.add([k.sprite("menu_background"), k.pos(k.width() / 2, k.height() / 2), k.anchor("center"), k.fixed(), k.z(-10)]);

    function drawCard(x, y, m, { slotLabel = null } = {}) {
      const mt = getMonsterType(m.typeName);
      const ec = elementColor(mt?.element);
      k.drawRect({ pos: k.vec2(x, y), width: CARD_W, height: CARD_H, radius: 12, color: col(THEME.surface), outline: { width: 2, color: col(ec) } });
      try { k.drawSprite({ sprite: slug(m.typeName), pos: k.vec2(x + CARD_W / 2, y + 44), anchor: "center", scale: 0.62 }); } catch {}
      k.drawText({ text: m.name || m.typeName, pos: k.vec2(x + CARD_W / 2, y + 78), size: 13, font: FONT, anchor: "center", width: CARD_W - 12, color: col(THEME.text) });
      k.drawText({ text: `Lv.${m.level}     ${mt?.element || "?"}`, pos: k.vec2(x + CARD_W / 2, y + 96), size: 11, font: FONT, anchor: "center", color: col(THEME.textMut) });
      // HP bar (monsters keep HP between runs; healed only on extract).
      let maxHp = m.currentHealth;
      try { maxHp = getMonsterStats(mt, m.level).health; } catch {}
      const frac = maxHp > 0 ? Math.max(0, Math.min(1, (m.currentHealth ?? maxHp) / maxHp)) : 1;
      const barC = frac > 0.5 ? THEME.success : frac > 0.25 ? THEME.warn : THEME.danger;
      k.drawRect({ pos: k.vec2(x + 12, y + CARD_H - 12), width: CARD_W - 24, height: 5, radius: 2, color: col(THEME.line) });
      k.drawRect({ pos: k.vec2(x + 12, y + CARD_H - 12), width: (CARD_W - 24) * frac, height: 5, radius: 2, color: col(barC) });
      if (slotLabel) k.drawText({ text: slotLabel, pos: k.vec2(x + 8, y + 6), size: 11, font: FONT, color: col(THEME.textMut) });
    }

    k.onDraw(() => {
      if (tab === "monsters") {
        // Vault grid (scrolls up under the top band + the active row).
        const c = cols();
        const vx0 = vaultX0();
        const top = VAULT_TOP - scrollY;
        const view = viewVault(); // sorted order (INV-T6) — same order the hit-test uses
        for (let i = 0; i < view.length; i++) {
          const y = top + Math.floor(i / c) * (CARD_H + GAP);
          if (y + CARD_H < VAULT_TOP || y > k.height()) continue; // cull
          const x = vx0 + (i % c) * (CARD_W + GAP);
          drawCard(x, y, view[i]);
        }

        // Mask the top band so vault cards scroll *under* it. BUGFIX (@visual): this
        // must be drawn BEFORE the active-team row — the row sits inside this band
        // (y≈90..210 < VAULT_TOP), so the old order (row → mask) painted the mask
        // over the team and it looked empty. Now the team draws on top of the mask.
        k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: VAULT_TOP, color: col(THEME.bg), fixed: true });

        // Active team row (4 slots; empty slots are placeholders) — on top of the mask.
        const ax0 = activeX0();
        for (let i = 0; i < TEAM_MAX; i++) {
          const x = ax0 + i * (CARD_W + GAP);
          if (i < active.length) drawCard(x, ACTIVE_TOP, active[i], { slotLabel: `${i + 1}` });
          else {
            k.drawRect({ pos: k.vec2(x, ACTIVE_TOP), width: CARD_W, height: CARD_H, radius: 12, color: col(THEME.surfaceAlt), outline: { width: 2, color: col(THEME.line) } });
            k.drawText({ text: "empty", pos: k.vec2(x + CARD_W / 2, ACTIVE_TOP + CARD_H / 2), size: 12, font: FONT, anchor: "center", color: col(THEME.textMut) });
          }
        }

        // Section labels.
        k.drawText({ text: `ACTIVE TEAM   ${active.length}/${TEAM_MAX}`, pos: k.vec2(20, HEADER + 10), size: 14, font: FONT, color: col(THEME.text), fixed: true });
        k.drawText({ text: `VAULT   ${vault.length}`, pos: k.vec2(20, VAULT_LABEL_Y), size: 14, font: FONT, color: col(THEME.text), fixed: true });
        // INV-T6 sort + filter controls (only worth showing once there's >1 to manage).
        if (vault.length > 1) {
          const [sx, sy, sw, sh] = sortBtnRect();
          k.drawRect({ pos: k.vec2(sx, sy), width: sw, height: sh, radius: 7, color: col(THEME.surfaceAlt), outline: { width: 1, color: col(THEME.line) }, fixed: true });
          k.drawText({ text: `Sort: ${SORT_LABELS[sortMode]}`, pos: k.vec2(sx + sw / 2, sy + sh / 2), size: 12, font: FONT, anchor: "center", color: col(THEME.textBody), fixed: true });
          const [fx, fy, fw, fh] = filterBtnRect();
          const on = filterEl !== ELEMENT_ALL;
          k.drawRect({ pos: k.vec2(fx, fy), width: fw, height: fh, radius: 7, color: col(on ? THEME.surface2 : THEME.surfaceAlt), outline: { width: 1, color: col(on ? THEME.primary : THEME.line) }, fixed: true });
          k.drawText({ text: `Filter: ${filterEl === ELEMENT_ALL ? "All" : filterEl}`, pos: k.vec2(fx + fw / 2, fy + fh / 2), size: 12, font: FONT, anchor: "center", color: col(on ? THEME.text : THEME.textBody), fixed: true });
        }
        k.drawText({ text: vault.length ? "tap a vault monster to field it, tap a team monster to store it" : "Catch or loot monsters to fill your vault.", pos: k.vec2(k.width() - 20, VAULT_LABEL_Y + 2), size: 11, font: FONT, anchor: "topright", color: col(THEME.textMut), fixed: true });

        // Scrollbar for the vault.
        const ms = maxScroll();
        if (ms > 0) {
          const trackH = k.height() - VAULT_TOP;
          const thumbH = Math.max(30, (trackH * trackH) / contentH());
          const thumbY = VAULT_TOP + (scrollY / ms) * (trackH - thumbH);
          k.drawRect({ pos: k.vec2(k.width() - 7, thumbY), width: 5, height: thumbH, radius: 3, color: col(THEME.neutral), fixed: true });
        }
      } else {
        // Spirit-chain inventory: a card per owned chain; tap to equip.
        const list = viewChains();
        const cc = chainCols(), cx0 = chainX0();
        for (let i = 0; i < list.length; i++) {
          const x = cx0 + (i % cc) * (CHAIN_W + CHAIN_GAP);
          const y = chainTop + Math.floor(i / cc) * (CHAIN_H + CHAIN_GAP);
          drawChainCard(x, y, list[i].cs, list[i].def, list[i].cs.chainId === net.state.equippedChainId);
        }
        k.drawText({ text: list.length ? `SPIRIT CHAINS   ${list.length}     tap to equip` : "No chains yet — find them in chests or buy them in the Spirit Shop.", pos: k.vec2(20, HEADER + 14), size: 14, font: FONT, color: col(list.length ? THEME.text : THEME.textMut), fixed: true });
      }

      // Header bar + tabs + back button (shared; drawn last to mask scroll).
      k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: HEADER, color: col(THEME.bg), fixed: true });
      k.drawRect({ pos: k.vec2(0, HEADER - 1), width: k.width(), height: 1, color: col(THEME.line), fixed: true });
      for (const [id, label, [tx, ty, tw, th]] of tabRects()) {
        const on = tab === id;
        k.drawRect({ pos: k.vec2(tx, ty), width: tw, height: th, radius: 8, color: col(on ? THEME.primary : THEME.surfaceAlt), outline: { width: 2, color: col(on ? THEME.primary : THEME.line) }, fixed: true });
        k.drawText({ text: label, pos: k.vec2(tx + tw / 2, ty + th / 2), size: 14, font: FONT, anchor: "center", color: col(on ? THEME.textInv : THEME.text), fixed: true });
      }
      const [bx, by, bw, bh] = backRect();
      k.drawRect({ pos: k.vec2(bx, by), width: bw, height: bh, radius: 10, color: col(THEME.surfaceAlt), outline: { width: 2, color: col(THEME.line) }, fixed: true });
      k.drawText({ text: "Back", pos: k.vec2(bx + bw / 2, by + bh / 2), size: 16, font: FONT, anchor: "center", color: col(THEME.text), fixed: true });

      // Transient toast (e.g. "team is full").
      if (toastT > 0) {
        toastT -= k.dt();
        const tw = Math.min(k.width() - 40, 13 * toast.length + 36);
        k.drawRect({ pos: k.vec2(k.width() / 2, k.height() - 38), width: tw, height: 30, radius: 8, anchor: "center", color: col(THEME.surface), outline: { width: 1, color: col(THEME.line) }, fixed: true });
        k.drawText({ text: toast, pos: k.vec2(k.width() / 2, k.height() - 38), size: 13, font: FONT, anchor: "center", color: col(THEME.text), fixed: true });
      }
    });

    // Server reconciliation: the authoritative roster overwrites our local copy.
    const offRoster = net.on("roster", () => {
      active = [...(net.state.team || [])];
      vault = [...(net.state.vault || [])];
      if (!elementFilterOptions(vault, getMonsterType).includes(filterEl)) filterEl = ELEMENT_ALL; // drop a now-empty filter
      clampScroll();
    });
    net.getRoster(); // refresh on entry

    const goBack = () => k.go("onlineLobby");
    if (typeof k.onScroll === "function") k.onScroll((d) => { scrollY += d.y; clampScroll(); });
    k.onKeyPress("escape", goBack);
    k.onKeyDown("down", () => { scrollY += 700 * k.dt(); clampScroll(); });
    k.onKeyDown("up", () => { scrollY -= 700 * k.dt(); clampScroll(); });

    const press = (p) => { dragging = true; lastY = p.y; moved = 0; };
    const drag = (p) => { if (!dragging) return; const dy = p.y - lastY; if (p.y > VAULT_TOP) scrollY -= dy; moved += Math.abs(dy); lastY = p.y; clampScroll(); };
    const release = (p) => {
      const wasDrag = dragging && moved >= 6;
      dragging = false;
      if (wasDrag) return; // a scroll, not a tap
      if (inRect(p, backRect())) { goBack(); return; }
      for (const [id, , r] of tabRects()) if (inRect(p, r)) { tab = id; return; } // switch tab
      if (tab === "chains") {
        const ci = chainCardAt(p);
        if (ci >= 0) equipChain(ci);
        return;
      }
      if (vault.length > 1 && inRect(p, sortBtnRect())) { sortMode = nextSortMode(sortMode); scrollY = 0; clampScroll(); return; } // INV-T6 cycle sort
      if (vault.length > 1 && inRect(p, filterBtnRect())) { // INV-T6 cycle element filter
        const opts = elementFilterOptions(vault, getMonsterType);
        filterEl = opts[(opts.indexOf(filterEl) + 1) % opts.length]; // wraps; stale → "all"
        scrollY = 0; clampScroll(); return;
      }
      const slot = activeSlotAt(p);
      if (slot >= 0) { storeFromActive(slot); return; }
      const vi = vaultCardAt(p);
      if (vi >= 0) { fieldFromVault(vi); return; }
    };
    k.onMousePress(() => press(k.mousePos()));
    k.onMouseMove(() => drag(k.mousePos()));
    k.onMouseRelease(() => release(k.mousePos()));
    k.onTouchStart((p) => press(p));
    k.onTouchMove((p) => drag(p));
    k.onTouchEnd((p) => release(p));

    k.onSceneLeave(() => { offRoster && offRoster(); });
  });
}
