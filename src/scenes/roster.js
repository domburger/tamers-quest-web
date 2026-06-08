import { net } from "../netClient.js";
import { getMonsterType, getSpiritChain } from "../engine/gamedata.js";
import { getMonsterStats } from "../engine/stats.js";
import { THEME, PAL, FONT, elementColor, addMenuBackground } from "../ui/theme.js";
import { sortMonsters, nextSortMode, SORT_LABELS, filterMonsters, elementFilterOptions, ELEMENT_ALL, sortChainsByTier, searchMonsters } from "../engine/rosterSort.js";
import { vaultCapacity } from "../engine/upgrades.js";
import { GAME } from "../engine/schemas.js";
import { chainCatchSummary } from "../engine/spiritchains.js"; // INV-T3: "can my chain catch this" readout
import { resolveRosterDrag } from "../engine/inventory.js"; // INV-T8: pure drag-resolution (store/field/swap/reorder)

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
    let searchQ = ""; // INV-T6: free-text vault search (name / type / element substring)
    let searchInput = null; // DOM <input> overlay while typing a search
    let inspect = null; // INV-T3: open monster-detail panel — { mon, source:"active"|"vault", slot }
    let releaseArm = false; // INV-T7: the inspect Release button is armed (awaiting a confirm tap)
    let lastReleaseAt = net.state.lastRelease?.at || 0; // last release outcome surfaced as a toast
    // INV-T8 drag-and-drop: hold-to-grab so quick taps/flicks stay tap/scroll (zero
    // regression). A press records a candidate; a stationary hold of HOLD_S arms an
    // item-drag (a ghost card follows the pointer); release resolves the drop via the
    // shared resolveRosterDrag. Moving before the hold → it's a scroll, never a grab.
    let pressing = false, pressT = 0, scrolling = false; // press lifecycle / scroll-vs-drag flags
    let grabCand = null; // { kind:"active"|"vault", mon, index } under the press, eligible to grab
    let grabbing = false; // true once the hold arms an item-drag
    let ghost = { x: 0, y: 0 }; // dragged-card follow position (screen space)
    const HOLD_S = 0.18; // press-and-hold time to arm a drag

    const HEADER = 56;
    const CARD_W = 150, CARD_H = 120, GAP = 14;
    const ACTIVE_TOP = HEADER + 34;
    const ACTIVE_BOTTOM = ACTIVE_TOP + CARD_H;
    const VAULT_LABEL_Y = ACTIVE_BOTTOM + 20;
    const VAULT_TOP = VAULT_LABEL_Y + 26;

    // INV-T6: the sorted view of the vault used for BOTH drawing and hit-testing,
    // so a tapped card maps to the right monster. Reference-stable, so we can find
    // the source-array index by identity (see fieldFromVault).
    // Compose element-filter → sort → free-text search; search runs last so it
    // keeps the sorted order, and (like the others) returns the same objects so
    // index→source identity mapping for hit-testing still holds.
    const viewVault = () => searchMonsters(sortMonsters(filterMonsters(vault, filterEl, getMonsterType), sortMode, getMonsterType), searchQ, getMonsterType);
    const TOOLBAR_X = 148, TOOLBAR_GAP = 8;
    const toolbarBtnW = () => Math.min(150, Math.max(80, Math.floor((k.width() - TOOLBAR_X - 20 - TOOLBAR_GAP * 2) / 3)));
    const sortBtnRect = () => [TOOLBAR_X, VAULT_LABEL_Y - 3, toolbarBtnW(), 24];
    const filterBtnRect = () => [TOOLBAR_X + toolbarBtnW() + TOOLBAR_GAP, VAULT_LABEL_Y - 3, toolbarBtnW(), 24];
    const searchBtnRect = () => [TOOLBAR_X + (toolbarBtnW() + TOOLBAR_GAP) * 2, VAULT_LABEL_Y - 3, toolbarBtnW(), 24];

    // INV-T3 inspect panel rects (tap a monster → full stats + Field/Store).
    const INSP_W = Math.min(540, k.width() - 24), INSP_H = Math.min(360, k.height() - 24);
    const inspRect = () => [(k.width() - INSP_W) / 2, (k.height() - INSP_H) / 2, INSP_W, INSP_H];
    // INV-T7: a 3-button action row — Field/Store · Release · Close.
    const inspBtnW = () => Math.floor((INSP_W - 60) / 3);
    const inspActionRect = () => { const [x, y, , h] = inspRect(); const bw = inspBtnW(); return [x + 15, y + h - 56, bw, 44]; };
    const inspReleaseRect = () => { const [x, y, , h] = inspRect(); const bw = inspBtnW(); return [x + 15 + bw + 15, y + h - 56, bw, 44]; };
    const inspCloseRect = () => { const [x, y, , h] = inspRect(); const bw = inspBtnW(); return [x + 15 + (bw + 15) * 2, y + h - 56, bw, 44]; };

    const cols = () => Math.max(1, Math.floor((k.width() - GAP) / (CARD_W + GAP)));
    // Scroll bounds must reflect the DRAWN list (the filtered/sorted view), not the
    // full vault — otherwise an active element filter (fewer cards) leaves maxScroll
    // sized for the whole vault, letting you scroll past the visible cards into blank space.
    const vaultRows = () => Math.ceil(viewVault().length / cols());
    const contentH = () => vaultRows() * (CARD_H + GAP) + GAP;
    const maxScroll = () => Math.max(0, contentH() - (k.height() - VAULT_TOP));
    const clampScroll = () => { scrollY = Math.min(maxScroll(), Math.max(0, scrollY)); };
    const backRect = () => [k.width() - 96, 12, 82, 44]; // MOB-A2: ≥44px touch target (was 34; top-right corner, clears content)
    const inRect = (p, [x, y, w, h]) => p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;

    const activeCardW = () => Math.min(CARD_W, Math.floor((k.width() - 24 - (TEAM_MAX - 1) * GAP) / TEAM_MAX));
    const activeX0 = () => {
      const cw = activeCardW();
      const gridW = TEAM_MAX * cw + (TEAM_MAX - 1) * GAP;
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
      const cw = activeCardW();
      const relX = p.x - activeX0();
      if (relX < 0) return -1;
      const c = Math.floor(relX / (cw + GAP));
      if (c < 0 || c >= TEAM_MAX) return -1;
      if (relX - c * (cw + GAP) > cw) return -1; // in the gap
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
      // Bound against the DRAWN list (the filtered/sorted view), not the full vault:
      // the grid renders viewVault() and callers index viewVault()[idx], so an idx in
      // [viewVault().length, vault.length) (a tap on an empty cell while a filter is
      // active) must be -1, not a stale index → undefined monster (INV-T3 inspect
      // opened {mon: undefined} → drawInspect crash; fieldFromVault was already guarded).
      return idx >= 0 && idx < viewVault().length ? idx : -1;
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
      // INV-A1 parity fix: refuse storing into a full vault. Without this the optimistic
      // store overflows the vault and the server's setRoster→applyRoster silently
      // truncates it (dropping a monster) — SP already guards this (INV-T2).
      if (vault.length >= vaultCapacity(net.state, GAME.VAULT_SIZE)) { showToast("Vault is full. Release or upgrade Deep Vault first."); return; }
      const [m] = active.splice(slot, 1);
      vault.unshift(m);
      sync();
    }

    // ── INV-T8 drag-and-drop helpers ─────────────────────────────────────────
    // What's grabbable under a point (monsters tab only): a team monster or a vault card.
    function grabbableAt(p) {
      if (tab !== "monsters") return null;
      const slot = activeSlotAt(p);
      if (slot >= 0 && slot < active.length) return { kind: "active", mon: active[slot], index: slot };
      const vi = vaultCardAt(p);
      if (vi >= 0) { const m = viewVault()[vi]; if (m) return { kind: "vault", mon: m }; }
      return null;
    }
    // Where a drop lands: an active slot (field/swap/reorder) or the vault (store).
    function dropTargetAt(p) {
      const slot = activeSlotAt(p);
      if (slot >= 0) return { kind: "active", index: slot };
      if (p.y >= ACTIVE_TOP && p.y <= ACTIVE_BOTTOM) return { kind: "active", index: Math.min(active.length, TEAM_MAX - 1) }; // forgiving: anywhere on the team band
      if (p.y > VAULT_TOP) return { kind: "vault" };
      return null;
    }
    // Rebuild local active/vault from the new active-id order, then sync to the server
    // (which re-validates idle + ≥1 active and echoes the authoritative roster back).
    function applyDragResult(newIds) {
      const pool = [...active, ...vault];
      const byId = new Map(pool.map((m) => [m.id, m]));
      const seen = new Set(newIds);
      active = newIds.map((id) => byId.get(id)).filter(Boolean);
      vault = pool.filter((m) => !seen.has(m.id));
      clampScroll();
      sync();
      showToast("Team updated");
    }
    function dropGrab(p) {
      const target = dropTargetAt(p);
      if (!target || !grabCand) return;
      const draggedId = grabCand.mon.id;
      // Guards mirror storeFromActive/fieldFromVault so an optimistic drop can't make a
      // state the server will reject (full vault, last monster, full team).
      if (target.kind === "vault") {
        if (grabCand.kind !== "active") return; // vault → vault: nothing to do
        if (active.length <= 1) { showToast("You need at least one monster on your team."); return; }
        if (vault.length >= vaultCapacity(net.state, GAME.VAULT_SIZE)) { showToast("Vault is full. Release or upgrade Deep Vault first."); return; }
      }
      if (target.kind === "active" && grabCand.kind === "vault" && target.index >= active.length && active.length >= TEAM_MAX) {
        showToast("Team is full (4). Store one first."); return;
      }
      const newIds = resolveRosterDrag(active.map((m) => m.id), draggedId, target);
      if (newIds) applyDragResult(newIds);
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
      const cc = def.color || THEME.neutral; // tokenized fallback (was raw [150,150,160])
      k.drawRect({ pos: k.vec2(x, y), width: CHAIN_W, height: CHAIN_H, radius: 12, color: col(equipped ? THEME.surface2 : THEME.surface), outline: { width: equipped ? 3 : 2, color: col(equipped ? THEME.primary : cc) } });
      // Top sheen — gives the card the raised-surface feel that addPanel grants
      // retained-mode panels (audit HIGH for MP scenes: cards looked a tier flatter).
      k.drawRect({ pos: k.vec2(x + 6, y + 4), width: CHAIN_W - 12, height: 14, radius: 7, color: col(THEME.surface2), opacity: 0.45 });
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
    addMenuBackground(k, { fixed: true, z: -10 });

    function drawCard(x, y, m, { slotLabel = null, hover = false, cardW: cw = CARD_W } = {}) {
      const mt = getMonsterType(m.typeName);
      const ec = elementColor(mt?.element);
      if (hover) k.drawRect({ pos: k.vec2(x - 4, y - 4), width: cw + 8, height: CARD_H + 8, radius: 14, color: col(ec), opacity: 0.22 });
      k.drawRect({ pos: k.vec2(x, y), width: cw, height: CARD_H, radius: 12, color: hover ? col(THEME.surface2) : col(THEME.surface), outline: { width: hover ? 3 : 2, color: col(ec) } });
      // Top sheen — addPanel parity (audit HIGH for MP cards looking flatter than SP).
      k.drawRect({ pos: k.vec2(x + 6, y + 4), width: cw - 12, height: 14, radius: 7, color: col(THEME.surface2), opacity: 0.45 });
      try { k.drawSprite({ sprite: slug(m.typeName), pos: k.vec2(x + cw / 2, y + 44), anchor: "center", scale: 0.62 }); } catch {}
      k.drawText({ text: m.name || m.typeName, pos: k.vec2(x + cw / 2, y + 78), size: 13, font: FONT, anchor: "center", width: cw - 12, color: col(THEME.text) });
      k.drawText({ text: `Lv.${m.level}     ${mt?.element || "?"}`, pos: k.vec2(x + cw / 2, y + 96), size: 11, font: FONT, anchor: "center", color: col(THEME.textMut) });
      let maxHp = m.currentHealth;
      try { maxHp = getMonsterStats(mt, m.level).health; } catch {}
      const frac = maxHp > 0 ? Math.max(0, Math.min(1, (m.currentHealth ?? maxHp) / maxHp)) : 1;
      const barC = frac > 0.5 ? THEME.success : frac > 0.25 ? THEME.warn : THEME.danger;
      k.drawRect({ pos: k.vec2(x + 12, y + CARD_H - 12), width: cw - 24, height: 5, radius: 2, color: col(THEME.line) });
      k.drawRect({ pos: k.vec2(x + 12, y + CARD_H - 12), width: (cw - 24) * frac, height: 5, radius: 2, color: col(barC) });
      if (slotLabel) k.drawText({ text: slotLabel, pos: k.vec2(x + 8, y + 6), size: 11, font: FONT, color: col(THEME.textMut) });
    }

    // INV-T3: full-detail panel for one monster + the field/store action — so a
    // player can read a monster's stats before deciding to bench/field it.
    function drawInspect() {
      if (!inspect) return;
      const m = inspect.mon, mt = getMonsterType(m.typeName);
      const ec = mt ? elementColor(mt.element) : THEME.textMut;
      const [x, y, w, h] = inspRect();
      k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: col(THEME.bgAlt), opacity: 0.55, fixed: true });
      k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius: 16, color: col(THEME.surface), outline: { width: 3, color: col(ec) } });
      // Top sheen on the inspect modal — the biggest visual surface in this scene
      // gains the addPanel signature too (audit HIGH).
      k.drawRect({ pos: k.vec2(x + 8, y + 6), width: w - 16, height: 22, radius: 11, color: col(THEME.surface2), opacity: 0.5 });
      // Left: sprite + identity + HP + XP-to-next + description (INV-T3 detail).
      const lx = x + 30;
      try { k.drawSprite({ sprite: slug(m.typeName), pos: k.vec2(lx + 64, y + 82), anchor: "center", scale: 1.05 }); } catch { /* sprite not ready */ }
      k.drawText({ text: m.name || m.typeName, pos: k.vec2(lx, y + 146), size: 20, font: FONT, width: 210, color: col(THEME.text) });
      // Element / rarity / level — rarity helps a team decision (INV-T3). ASCII-only
      // separators (the no-decorative-glyphs guardrail forbids a middot here).
      k.drawText({ text: `${mt?.element || "?"}${mt?.rarity ? `   ${mt.rarity}` : ""}     Lv.${m.level}`, pos: k.vec2(lx, y + 176), size: 14, font: FONT, color: col(ec) });
      let stats = {}; try { stats = getMonsterStats(mt, m.level); } catch { /* unknown type */ }
      const maxHp = stats.health || Math.round(m.currentHealth) || 1;
      k.drawText({ text: `HP ${Math.round(m.currentHealth ?? maxHp)} / ${maxHp}`, pos: k.vec2(lx, y + 198), size: 14, font: FONT, color: col(THEME.textBody) });
      // XP-to-next: m.xp is progress within the current level (resets each level-up).
      const xpCur = Math.max(0, Math.min(GAME.XP_PER_LEVEL, m.xp || 0));
      const xpFrac = GAME.XP_PER_LEVEL > 0 ? xpCur / GAME.XP_PER_LEVEL : 0;
      k.drawText({ text: `XP ${xpCur} / ${GAME.XP_PER_LEVEL}   (${GAME.XP_PER_LEVEL - xpCur} to Lv.${m.level + 1})`, pos: k.vec2(lx, y + 220), size: 12, font: FONT, color: col(THEME.textMut) });
      k.drawRect({ pos: k.vec2(lx, y + 238), width: 230, height: 5, radius: 2, color: col(THEME.line) });
      k.drawRect({ pos: k.vec2(lx, y + 238), width: 230 * xpFrac, height: 5, radius: 2, color: col(THEME.primary) });
      // Flavor description (wrapped) — context for "what is this monster".
      if (mt?.description) k.drawText({ text: mt.description, pos: k.vec2(lx, y + 256), size: 12, font: FONT, width: 232, lineSpacing: 2, color: col(THEME.textMut) });
      // Right: stat block at the current level.
      const rx = x + 290;
      k.drawText({ text: "STATS", pos: k.vec2(rx, y + 24), size: 13, font: FONT, color: col(THEME.primary) });
      ["health", "strength", "defense", "speed", "power", "energy", "luck"].forEach((st, i) => {
        const sy = y + 50 + i * 24;
        k.drawText({ text: st, pos: k.vec2(rx, sy), size: 13, font: FONT, color: col(THEME.textMut) });
        k.drawText({ text: `${stats[st] ?? "?"}`, pos: k.vec2(x + w - 28, sy), size: 13, font: FONT, anchor: "right", color: col(THEME.text) });
      });
      // Catch-feasibility vs the equipped chain (INV-T3): chains gate by rarity, so
      // this tells the player whether their chain could take a monster like this one.
      const eqChain = net.state.equippedChainId ? getSpiritChain(net.state.equippedChainId) : null;
      const cs = chainCatchSummary(eqChain, mt?.rarity ?? 1);
      k.drawText({ text: `${eqChain?.name ? eqChain.name + ": " : ""}${cs.text}`, pos: k.vec2(rx, y + 222), size: 12, font: FONT, width: w - 290 - 24, color: col(cs.ok ? THEME.success : THEME.warn) });
      // Actions: Field/Store · Release · Close.
      const [ax, ay, aw, ah] = inspActionRect();
      k.drawRect({ pos: k.vec2(ax, ay), width: aw, height: ah, radius: 10, color: col(THEME.primary) });
      k.drawText({ text: inspect.source === "active" ? "Store" : "Field", pos: k.vec2(ax + aw / 2, ay + ah / 2), size: 16, font: FONT, anchor: "center", color: col(THEME.textInv) });
      // INV-T7: Release (destructive → two-step). Hidden when it's the player's only
      // monster (the server would refuse anyway). Armed state turns it into a
      // danger-colored "Confirm release" with a hint of what you get back.
      if (active.length + vault.length > 1) {
        const [rbx, rby, rbw, rbh] = inspReleaseRect();
        k.drawRect({ pos: k.vec2(rbx, rby), width: rbw, height: rbh, radius: 10, color: col(releaseArm ? THEME.danger : THEME.surfaceAlt), outline: { width: 1, color: col(THEME.danger) } });
        k.drawText({ text: releaseArm ? "Confirm release" : "Release", pos: k.vec2(rbx + rbw / 2, rby + rbh / 2), size: releaseArm ? 14 : 16, font: FONT, anchor: "center", color: col(releaseArm ? THEME.textInv : THEME.danger) });
        if (releaseArm) k.drawText({ text: "frees this monster for essence + gold", pos: k.vec2(x + w / 2, ay - 14), size: 12, font: FONT, anchor: "center", color: col(THEME.warn) });
      }
      const [cbx, cby, cbw, cbh] = inspCloseRect();
      k.drawRect({ pos: k.vec2(cbx, cby), width: cbw, height: cbh, radius: 10, color: col(THEME.surfaceAlt), outline: { width: 1, color: col(THEME.line) } });
      k.drawText({ text: "Close", pos: k.vec2(cbx + cbw / 2, cby + cbh / 2), size: 16, font: FONT, anchor: "center", color: col(THEME.text) });
    }

    k.onDraw(() => {
      // INV-T8: arm an item-drag once the press has been held (stationary) for HOLD_S.
      // If the pointer moved first (scrolling) it never arms → flicks stay scrolls.
      if (pressing && !scrolling && !grabbing && grabCand && moved < 6 && k.time() - pressT >= HOLD_S) grabbing = true;
      // INV-T7: surface a release outcome from the server (the roster reply stashes it
      // on net.state.lastRelease) as a toast, and re-sync the local team/vault copies
      // from the now-authoritative state on a successful release.
      const lr = net.state.lastRelease;
      if (lr && lr.at && lr.at !== lastReleaseAt) {
        lastReleaseAt = lr.at;
        if (lr.ok && lr.reward) {
          active = [...(net.state.team || [])];
          vault = [...(net.state.vault || [])];
          clampScroll();
          showToast(`Released   +${lr.reward.gold}g  +${lr.reward.essence} essence`);
        } else if (lr.locked) {
          showToast("Can't release during a run.");
        } else if (lr.reason === "last-monster") {
          showToast("You need at least one monster.");
        } else {
          showToast("Couldn't release that monster.");
        }
      }
      if (tab === "monsters") {
        // Desktop hover focus (none on touch — the pointer would rest on a card).
        const mp = k.mousePos();
        const canHover = !(typeof k.isTouchscreen === "function" && k.isTouchscreen());
        const hovVault = canHover ? vaultCardAt(mp) : -1;
        const hovActive = canHover ? activeSlotAt(mp) : -1;
        // Vault grid (scrolls up under the top band + the active row).
        const c = cols();
        const vx0 = vaultX0();
        const top = VAULT_TOP - scrollY;
        const view = viewVault(); // sorted order (INV-T6) — same order the hit-test uses
        for (let i = 0; i < view.length; i++) {
          const y = top + Math.floor(i / c) * (CARD_H + GAP);
          if (y + CARD_H < VAULT_TOP || y > k.height()) continue; // cull
          const x = vx0 + (i % c) * (CARD_W + GAP);
          drawCard(x, y, view[i], { hover: i === hovVault });
        }

        // Mask the top band so vault cards scroll *under* it. BUGFIX (@visual): this
        // must be drawn BEFORE the active-team row — the row sits inside this band
        // (y≈90..210 < VAULT_TOP), so the old order (row → mask) painted the mask
        // over the team and it looked empty. Now the team draws on top of the mask.
        k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: VAULT_TOP, color: col(THEME.bg), fixed: true });

        // Active team row (4 slots; empty slots are placeholders) — on top of the mask.
        const ax0 = activeX0();
        const acw = activeCardW();
        for (let i = 0; i < TEAM_MAX; i++) {
          const x = ax0 + i * (acw + GAP);
          if (i < active.length) drawCard(x, ACTIVE_TOP, active[i], { slotLabel: `${i + 1}`, hover: i === hovActive, cardW: acw });
          else {
            k.drawRect({ pos: k.vec2(x, ACTIVE_TOP), width: acw, height: CARD_H, radius: 12, color: col(THEME.surfaceAlt), outline: { width: 2, color: col(THEME.line) } });
            k.drawText({ text: "empty", pos: k.vec2(x + acw / 2, ACTIVE_TOP + CARD_H / 2), size: 12, font: FONT, anchor: "center", color: col(THEME.textMut) });
          }
        }

        // Section labels.
        k.drawText({ text: `ACTIVE TEAM   ${active.length}/${TEAM_MAX}`, pos: k.vec2(20, HEADER + 10), size: 14, font: FONT, color: col(THEME.text), fixed: true });
        // CN-15: vault fill meter — captures silently fail when the vault is full,
        // so show N / cap and warn (warn near full, danger at full).
        const vcap = vaultCapacity(net.state, GAME.VAULT_SIZE);
        const vfull = vault.length >= vcap, vnear = vault.length >= vcap * 0.9;
        k.drawText({ text: `VAULT   ${vault.length} / ${vcap}${vfull ? "   FULL" : ""}`, pos: k.vec2(20, VAULT_LABEL_Y), size: 14, font: FONT, color: col(vfull ? THEME.danger : vnear ? THEME.warn : THEME.text), fixed: true });
        // INV-T6 sort + filter controls (only worth showing once there's >1 to manage).
        if (vault.length > 1) {
          const [sx, sy, sw, sh] = sortBtnRect();
          k.drawRect({ pos: k.vec2(sx, sy), width: sw, height: sh, radius: 7, color: col(THEME.surfaceAlt), outline: { width: 1, color: col(THEME.line) }, fixed: true });
          k.drawText({ text: `Sort: ${SORT_LABELS[sortMode]}`, pos: k.vec2(sx + sw / 2, sy + sh / 2), size: 12, font: FONT, anchor: "center", color: col(THEME.textBody), fixed: true });
          const [fx, fy, fw, fh] = filterBtnRect();
          const on = filterEl !== ELEMENT_ALL;
          k.drawRect({ pos: k.vec2(fx, fy), width: fw, height: fh, radius: 7, color: col(on ? THEME.surface2 : THEME.surfaceAlt), outline: { width: 1, color: col(on ? THEME.primary : THEME.line) }, fixed: true });
          k.drawText({ text: `Filter: ${filterEl === ELEMENT_ALL ? "All" : filterEl}`, pos: k.vec2(fx + fw / 2, fy + fh / 2), size: 12, font: FONT, anchor: "center", color: col(on ? THEME.text : THEME.textBody), fixed: true });
          // INV-T6 free-text search (name / type / element). Active when a query is set.
          const [qx, qy, qw, qh] = searchBtnRect();
          const qOn = !!searchQ;
          k.drawRect({ pos: k.vec2(qx, qy), width: qw, height: qh, radius: 7, color: col(qOn ? THEME.surface2 : THEME.surfaceAlt), outline: { width: 1, color: col(qOn ? THEME.primary : THEME.line) }, fixed: true });
          const qLabel = qOn ? `Search: ${searchQ}` : "Search…";
          k.drawText({ text: qLabel, pos: k.vec2(qx + 10, qy + qh / 2), size: 12, font: FONT, anchor: "left", color: col(qOn ? THEME.text : THEME.textBody), fixed: true });
          if (qOn) k.drawText({ text: "x", pos: k.vec2(qx + qw - 10, qy + qh / 2), size: 14, font: FONT, anchor: "right", color: col(THEME.textMut), fixed: true });
        }
        k.drawText({ text: vault.length ? "tap a monster to inspect, field or store it" : "Catch or loot monsters to fill your vault.", pos: k.vec2(k.width() - 20, VAULT_LABEL_Y + 2), size: 11, font: FONT, anchor: "topright", color: col(THEME.textMut), fixed: true });

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

      drawInspect(); // INV-T3 detail panel (over the grid, under the toast)

      // INV-T8: while item-dragging, highlight the active-team band (the primary drop
      // zone) and draw a ghost of the grabbed monster following the pointer.
      if (grabbing && grabCand) {
        k.drawRect({ pos: k.vec2(activeX0() - 6, ACTIVE_TOP - 6), width: TEAM_MAX * (activeCardW() + GAP) - GAP + 12, height: CARD_H + 12, radius: 14, color: col(THEME.primary), opacity: 0.12, fixed: true });
        const gw = activeCardW();
        k.drawRect({ pos: k.vec2(ghost.x - gw / 2, ghost.y - CARD_H / 2), width: gw, height: CARD_H, radius: 12, color: col(THEME.surface2), opacity: 0.9, outline: { width: 3, color: col(THEME.primary) }, fixed: true });
        try { k.drawSprite({ sprite: slug(grabCand.mon.typeName), pos: k.vec2(ghost.x, ghost.y - 8), anchor: "center", scale: 0.58, opacity: 0.95, fixed: true }); } catch {}
        k.drawText({ text: grabCand.mon.name || grabCand.mon.typeName, pos: k.vec2(ghost.x, ghost.y + CARD_H / 2 - 16), size: 12, font: FONT, anchor: "center", width: gw - 10, color: col(THEME.text), fixed: true });
      }

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
      inspect = null; // stale ref after reconcile
      if (!elementFilterOptions(vault, getMonsterType).includes(filterEl)) filterEl = ELEMENT_ALL; // drop a now-empty filter
      clampScroll();
    });
    net.getRoster(); // refresh on entry

    const goBack = () => k.go("onlineLobby");
    if (typeof k.onScroll === "function") k.onScroll((d) => { scrollY += d.y; clampScroll(); });
    k.onKeyPress("escape", () => { if (inspect) inspect = null; else goBack(); });
    k.onKeyDown("down", () => { scrollY += 700 * k.dt(); clampScroll(); });
    k.onKeyDown("up", () => { scrollY -= 700 * k.dt(); clampScroll(); });

    const press = (p) => {
      if (inspect) return; // panel is modal
      dragging = true; lastY = p.y; moved = 0;
      pressing = true; pressT = k.time(); scrolling = false; grabbing = false; grabCand = grabbableAt(p); ghost = { x: p.x, y: p.y }; // INV-T8
    };
    const drag = (p) => {
      if (inspect || !dragging) return;
      if (grabbing) { ghost = { x: p.x, y: p.y }; return; } // INV-T8 item-drag: move the ghost, never scroll
      const dy = p.y - lastY; moved += Math.abs(dy); lastY = p.y;
      if (moved >= 6) scrolling = true; // moved before the hold armed → a scroll, not a grab
      if (p.y > VAULT_TOP) { scrollY -= dy; clampScroll(); }
    };
    const release = (p) => {
      // INV-T8: if an item-drag was active, resolve the drop and stop (don't fall through
      // to tap/scroll handling). Otherwise clear drag state and proceed as before.
      pressing = false;
      if (grabbing) { dropGrab(p); grabbing = false; grabCand = null; scrolling = false; dragging = false; return; }
      grabbing = false; grabCand = null; scrolling = false;
      // INV-T3: an open inspect panel is modal — its buttons act; any other tap closes it.
      if (inspect) {
        // INV-T7: Release arms on the first tap (panel stays open) and fires on the
        // second; the server validates idle + keep-≥1-active and replies with the refund.
        if (active.length + vault.length > 1 && inRect(p, inspReleaseRect())) {
          if (!releaseArm) { releaseArm = true; return; }
          net.release(inspect.mon.id);
          inspect = null; releaseArm = false; return;
        }
        if (inRect(p, inspActionRect())) {
          if (inspect.source === "active") storeFromActive(inspect.slot);
          else { const vi = viewVault().indexOf(inspect.mon); if (vi >= 0) fieldFromVault(vi); }
        }
        inspect = null; releaseArm = false; return;
      }
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
      if (vault.length > 1 && inRect(p, searchBtnRect())) { // INV-T6 free-text search
        const [qx, , qw] = searchBtnRect();
        if (searchQ && p.x >= qx + qw - 28) { searchQ = ""; scrollY = 0; clampScroll(); closeSearchInput(); } // tap the "x" to clear
        else openSearchInput();
        return;
      }
      // INV-T3: tapping a monster opens its detail panel (Field/Store lives inside).
      const slot = activeSlotAt(p);
      if (slot >= 0 && slot < active.length) { inspect = { mon: active[slot], source: "active", slot }; releaseArm = false; return; }
      const vi = vaultCardAt(p);
      if (vi >= 0) { inspect = { mon: viewVault()[vi], source: "vault" }; releaseArm = false; return; }
    };
    k.onMousePress(() => press(k.mousePos()));
    k.onMouseMove(() => drag(k.mousePos()));
    k.onMouseRelease(() => release(k.mousePos()));
    k.onTouchStart((p) => press(p));
    k.onTouchMove((p) => drag(p));
    k.onTouchEnd((p) => release(p));

    // INV-T6 free-text search input: a real DOM <input> (so the mobile keyboard
    // opens), styled to match the theme and filtering the vault live as you type.
    // Mirrors the nickname/character-name field pattern.
    function openSearchInput() {
      if (searchInput) { searchInput.focus(); return; }
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Search by name / type / element";
      input.value = searchQ;
      input.maxLength = 24;
      Object.assign(input.style, {
        position: "fixed", left: "50%", top: "13%", transform: "translateX(-50%)",
        zIndex: "1000", width: "min(72vw, 340px)", padding: "10px 12px", fontSize: "16px",
        textAlign: "center", color: PAL.text, background: PAL.surface,
        border: `2px solid ${PAL.primary}`, borderRadius: "8px", outline: "none", fontFamily: "inherit",
      });
      document.body.appendChild(input);
      searchInput = input;
      setTimeout(() => input.focus(), 50); // desktop convenience; mobile opens on the tap gesture
      const apply = () => { searchQ = (input.value || "").trim(); scrollY = 0; clampScroll(); };
      input.addEventListener("input", apply);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); apply(); closeSearchInput(); } });
      input.addEventListener("blur", () => { apply(); closeSearchInput(); }); // tap away to dismiss
    }
    function closeSearchInput() {
      if (!searchInput) return;
      searchInput.remove();
      searchInput = null;
    }

    k.onSceneLeave(() => { offRoster && offRoster(); closeSearchInput(); }); // never leak the DOM input
  });
}
