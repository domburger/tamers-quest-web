import { net } from "../netClient.js";
import { getMonsterType } from "../engine/gamedata.js";
import { getMonsterStats } from "../engine/stats.js";
import { THEME, FONT, elementColor } from "../ui/theme.js";

// Team & vault management (P8-T2) — the between-rounds meta-loop. Shows the active
// team (≤4) and the vault (everything caught + looted), and lets the player choose
// which monsters they bring into the next run. Tap a team monster to store it; tap
// a vault monster to field it. Changes are sent to the server (setRoster), which
// validates (idle-only, ≥1 active) and echoes the authoritative roster back.
// Styled with the shared "Crisp daylight flat" design system (src/ui/theme.js).
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

    const HEADER = 56;
    const CARD_W = 150, CARD_H = 120, GAP = 14;
    const ACTIVE_TOP = HEADER + 34;
    const ACTIVE_BOTTOM = ACTIVE_TOP + CARD_H;
    const VAULT_LABEL_Y = ACTIVE_BOTTOM + 20;
    const VAULT_TOP = VAULT_LABEL_Y + 26;

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
      const [m] = vault.splice(idx, 1);
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

    // Background.
    k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(col(THEME.bg)), k.fixed(), k.z(-10)]);

    function drawCard(x, y, m, { slotLabel = null } = {}) {
      const mt = getMonsterType(m.typeName);
      const ec = elementColor(mt?.element);
      k.drawRect({ pos: k.vec2(x, y), width: CARD_W, height: CARD_H, radius: 12, color: col(THEME.surface), outline: { width: 2, color: col(ec) } });
      try { k.drawSprite({ sprite: slug(m.typeName), pos: k.vec2(x + CARD_W / 2, y + 44), anchor: "center", scale: 0.62 }); } catch {}
      k.drawText({ text: m.name || m.typeName, pos: k.vec2(x + CARD_W / 2, y + 78), size: 13, font: FONT, anchor: "center", width: CARD_W - 12, color: col(THEME.text) });
      k.drawText({ text: `Lv.${m.level}  ·  ${mt?.element || "?"}`, pos: k.vec2(x + CARD_W / 2, y + 96), size: 11, font: FONT, anchor: "center", color: col(THEME.textMut) });
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
      // Active team row (4 slots; empty slots are placeholders).
      const ax0 = activeX0();
      for (let i = 0; i < TEAM_MAX; i++) {
        const x = ax0 + i * (CARD_W + GAP);
        if (i < active.length) drawCard(x, ACTIVE_TOP, active[i], { slotLabel: `${i + 1}` });
        else {
          k.drawRect({ pos: k.vec2(x, ACTIVE_TOP), width: CARD_W, height: CARD_H, radius: 12, color: col(THEME.surfaceAlt), outline: { width: 2, color: col(THEME.line) } });
          k.drawText({ text: "empty", pos: k.vec2(x + CARD_W / 2, ACTIVE_TOP + CARD_H / 2), size: 12, font: FONT, anchor: "center", color: col(THEME.textMut) });
        }
      }

      // Vault grid (scrolls under the header + active row).
      const c = cols();
      const vx0 = vaultX0();
      const top = VAULT_TOP - scrollY;
      for (let i = 0; i < vault.length; i++) {
        const y = top + Math.floor(i / c) * (CARD_H + GAP);
        if (y + CARD_H < VAULT_TOP || y > k.height()) continue; // cull
        const x = vx0 + (i % c) * (CARD_W + GAP);
        drawCard(x, y, vault[i]);
      }

      // Mask above the vault region so cards scroll *under* the labels/header.
      k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: VAULT_TOP, color: col(THEME.bg), fixed: true });

      // Section labels.
      k.drawText({ text: `ACTIVE TEAM   ${active.length}/${TEAM_MAX}`, pos: k.vec2(20, HEADER + 10), size: 14, font: FONT, color: col(THEME.text), fixed: true });
      k.drawText({ text: `VAULT   ${vault.length}`, pos: k.vec2(20, VAULT_LABEL_Y), size: 14, font: FONT, color: col(THEME.text), fixed: true });
      k.drawText({ text: vault.length ? "tap a vault monster to field it · tap a team monster to store it" : "Catch or loot monsters to fill your vault.", pos: k.vec2(k.width() - 20, VAULT_LABEL_Y + 2), size: 11, font: FONT, anchor: "topright", color: col(THEME.textMut), fixed: true });

      // Header bar + title + back button.
      k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: HEADER, color: col(THEME.bg), fixed: true });
      k.drawRect({ pos: k.vec2(0, HEADER - 1), width: k.width(), height: 1, color: col(THEME.line), fixed: true });
      k.drawText({ text: "TEAM & VAULT", pos: k.vec2(20, 18), size: 22, font: FONT, color: col(THEME.text), fixed: true });
      const [bx, by, bw, bh] = backRect();
      k.drawRect({ pos: k.vec2(bx, by), width: bw, height: bh, radius: 10, color: col(THEME.surfaceAlt), outline: { width: 2, color: col(THEME.line) }, fixed: true });
      k.drawText({ text: "Back", pos: k.vec2(bx + bw / 2, by + bh / 2), size: 16, font: FONT, anchor: "center", color: col(THEME.text), fixed: true });

      // Scrollbar for the vault.
      const ms = maxScroll();
      if (ms > 0) {
        const trackH = k.height() - VAULT_TOP;
        const thumbH = Math.max(30, (trackH * trackH) / contentH());
        const thumbY = VAULT_TOP + (scrollY / ms) * (trackH - thumbH);
        k.drawRect({ pos: k.vec2(k.width() - 7, thumbY), width: 5, height: thumbH, radius: 3, color: col(THEME.neutral), fixed: true });
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
