// Hub left-gutter INFO + INVENTORY rail. Surfaces the player's identity + wallet and their loadout at a
// glance: active TEAM (with HP), equipped CHAINS, and ITEMS. UI v3 (2026-11): no stacked boxes — the gutter
// itself is the surface, so the rail is an avatar + name header, then eyebrow-labelled sections separated by
// hairlines, with glass tiles only where there is art (team portraits). Screen-space (fixed). Self-
// contained: reads the live server profile (net.state) when joined, else the local character slot.
import { THEME, FONT, FONT_BOLD, WHITE, drawEyebrow, drawHairline, drawGlass, drawChip, drawMeter, hpColor, drawCurrency } from "../ui/theme.js";
import { net } from "../netClient.js";
import { getMonsterType, getSpiritChain } from "../engine/gamedata.js";
import { drawMonsterIcon } from "./monster.js"; // shows a generated monster's REAL html-model (not the generic baked sprite) in the team rail
import { tierColor } from "./chainCosmetics.js"; // SC-tier: equipped-chain dots are tier-coloured (shared tier cue)
import { getMonsterMaxHp } from "../engine/stats.js";

const trunc = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : (s || ""));
const maxHpOf = (m) => { try { return getMonsterMaxHp(getMonsterType(m.typeName), m.level); } catch { return m.maxHealth || m.currentHealth || 1; } }; // max HP only — getMonsterMaxHp computes the single Health stat, not all 7 (per team monster, per frame in the hub)

// Fit a string to `w` px at `size` using real metrics when the renderer offers them.
function fit(k, s, w, size, font = FONT) {
  const str = s || "";
  const mw = typeof k.measureText === "function" ? (t) => k.measureText(t, size, font) : (t) => t.length * size * 0.56;
  if (mw(str) <= w) return str;
  let lo = 0, hi = str.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (mw(str.slice(0, mid) + "…") <= w) lo = mid; else hi = mid - 1; }
  return lo <= 0 ? "" : str.slice(0, lo).trimEnd() + "…";
}

// Draw the rail anchored at (x, y) with content width `w`, fitting within `maxH` vertical room (the identity
// header always draws; inventory sections are added only while they fit — so a short portrait top-gutter
// shows just identity, a tall landscape left-gutter shows the lot). Returns the bottom y. `character` is the
// local slot (identity + offline fallback). `teamHitOut` (optional): when an array is passed, each drawn TEAM
// row's screen-space rect + monster is pushed into it ({ rect:[x,y,w,h], mon }) so the caller can hit-test
// taps/clicks and open a detail view (TQ-17). Purely additive — omitting it changes nothing.
// packed-rgb -> KColor cache: drawHubPanel runs every frame in the lobby and reuses the same THEME colours
// dozens of times per draw, so memoize instead of allocating a fresh k.rgb per call.
const _colCache = new Map();
export function drawHubPanel(k, { x, y, w, maxH = 9999, character, title = "VILLAGE", teamHitOut }) {
  const col = (t) => {
    const key = ((t[0] | 0) << 16) | ((t[1] | 0) << 8) | (t[2] | 0);
    let v = _colCache.get(key);
    if (v === undefined) { v = k.rgb(t[0], t[1], t[2]); _colCache.set(key, v); }
    return v;
  };
  const bottomLimit = y + maxH;
  if (teamHitOut) teamHitOut.length = 0; // rebuilt each frame; positions track the live layout
  const joined = !!net.state.playerId;
  const team = (joined ? net.state.team : character.activeMonsters) || [];
  const items = (joined ? net.state.items : character.items) || [];
  const ownedChains = (joined ? net.state.chains : character.chains) || [];
  const equippedIds = (joined ? net.state.equippedChainIds : character.equippedChainIds)
    || (character.equippedChainId ? [character.equippedChainId] : []);
  const gold = joined ? net.state.gold : character.gold;
  const essence = joined ? net.state.essence : character.essence; // TQ-132 premium currency (undefined offline → chip skipped)

  const PAD = 4, GAP = 14;
  const innerW = w - PAD * 2;
  let cy = y;

  // A section: eyebrow label (+ optional count on the right) over `bodyH` of content; a hairline above it.
  let full = false; // once a section doesn't fit, STOP — keeps the visible set in priority order
  const section = (label, bodyH, draw, count) => {
    if (full) return;
    const h = 22 + bodyH;
    if (cy + h > bottomLimit) { full = true; return; } // out of gutter room — stop here (off the world)
    drawHairline(k, { x: x + PAD, y: cy, w: innerW, opacity: 0.1, fixed: true });
    cy += GAP;
    drawEyebrow(k, { x: x + PAD, y: cy, text: label, size: 10, color: THEME.textMut, spacing: 2, fixed: true });
    if (count != null) k.drawText({ text: String(count), pos: k.vec2(x + w - PAD, cy - 1), anchor: "topright", size: 11, font: FONT_BOLD, color: col(THEME.textMut), fixed: true });
    draw(cy + 20);
    cy += 20 + bodyH + 2;
  };
  const dim = (txt, top) => k.drawText({ text: txt, pos: k.vec2(x + PAD, top + 2), anchor: "left", size: 11, font: FONT, color: col(THEME.textMut), width: innerW, fixed: true });

  // ── Identity: avatar disc + name + level chip, then the wallet ─────────────────────────────────
  {
    const AV = 20, ax = x + PAD + AV, ay = cy + AV;
    k.drawCircle({ pos: k.vec2(ax, ay), radius: AV, color: col(THEME.primary), opacity: 0.18, fixed: true });
    k.drawCircle({ pos: k.vec2(ax, ay), radius: AV - 1, color: col(THEME.primary), fill: false, outline: { width: 1.5, color: col(THEME.primary) }, opacity: 0.7, fixed: true });
    const initial = (character.name || "?").trim().charAt(0).toUpperCase() || "?";
    k.drawText({ text: initial, pos: k.vec2(ax, ay + 1), anchor: "center", size: 18, font: FONT_BOLD, color: col(THEME.text), fixed: true });
    const tx = ax + AV + 10, tw = x + w - PAD - tx;
    k.drawText({ text: fit(k, character.name, tw, 15, FONT_BOLD), pos: k.vec2(tx, cy + 4), anchor: "left", size: 15, font: FONT_BOLD, color: col(THEME.text), fixed: true });
    let chipX = tx;
    const lvR = drawChip(k, { x: chipX, y: cy + 24, text: `Lv ${character.level}`, color: THEME.textBody, size: 9, h: 16, padX: 6, fixed: true });
    chipX = lvR[0] + lvR[2] + 5;
    if (character.isGuest && chipX + 40 <= x + w - PAD) drawChip(k, { x: chipX, y: cy + 24, text: "guest", color: THEME.amber, size: 9, h: 16, padX: 6, fixed: true });
    cy += AV * 2 + 10;
    // Wallet row — amber gold (earned) + violet essence (premium), left-aligned with the avatar.
    drawCurrency(k, { x: x + PAD + 2, y: cy + 8, size: 13, gap: 14, items: [{ kind: "gold", value: gold }, { kind: "essence", value: essence }] });
    cy += 24;
  }

  // ── Active TEAM (with HP) ────────────────────────────────────────────────────
  {
    const shown = team.slice(0, 4);
    const rowH = 40, TILE = 32;
    const bodyH = shown.length ? shown.length * rowH : 18;
    section("Team", bodyH, (top) => {
      if (!shown.length) { dim("No monsters yet", top); return; }
      shown.forEach((m, i) => {
        const ry = top + i * rowH;
        if (teamHitOut) teamHitOut.push({ rect: [x, ry, w, rowH], mon: m }); // clickable region = the full row (TQ-17)
        const mx = maxHpOf(m), cur = m.currentHealth ?? mx, frac = mx > 0 ? Math.max(0, Math.min(1, cur / mx)) : 1;
        const ty = ry + (rowH - TILE) / 2 - 2;
        drawGlass(k, { rect: [x + PAD, ty, TILE, TILE], radius: 9, fill: 0.06, line: 0.1, fixed: true });
        // drawMonsterIcon prefers the monster's authored html-model (its real look) over the generic
        // baked procedural sprite, so the rail shows the same creature as the world/combat.
        drawMonsterIcon(k, { typeName: m.typeName, cx: x + PAD + TILE / 2, cy: ty + TILE / 2, scale: (TILE - 6) / 256, topY: ty, fixed: true });
        const tx = x + PAD + TILE + 9, tw = x + w - PAD - tx;
        const lv = `Lv ${m.level}`;
        const lvW = typeof k.measureText === "function" ? k.measureText(lv, 10, FONT_BOLD) : 26;
        k.drawText({ text: fit(k, m.name || m.typeName, tw - lvW - 8, 12, FONT_BOLD), pos: k.vec2(tx, ry + 5), anchor: "left", size: 12, font: FONT_BOLD, color: col(THEME.text), fixed: true });
        k.drawText({ text: lv, pos: k.vec2(x + w - PAD, ry + 6), anchor: "topright", size: 10, font: FONT_BOLD, color: col(THEME.textMut), fixed: true });
        drawMeter(k, { rect: [tx, ry + 24, tw, 4], frac, color: hpColor(frac), fixed: true });
      });
    }, `${team.length}/4`);
  }

  // ── Equipped CHAINS ──────────────────────────────────────────────────────────
  // SC-tier: each slot's dot is TIER-COLOURED (the shared tier cue), and the ACTIVE slot — the chain
  // available in combat — is ringed so the loadout's active tier reads at a glance.
  {
    const activeId = joined ? net.state.equippedChainId : character.equippedChainId;
    const slots = equippedIds.map((id) => ({ id, def: getSpiritChain(id) })).filter((s) => s.def);
    const rowH = 18;
    const bodyH = slots.length ? slots.length * rowH : 18;
    section("Chains", bodyH, (top) => {
      if (!slots.length) { dim("No chain equipped", top); return; }
      slots.slice(0, 3).forEach(({ id, def }, i) => {
        const ry = top + i * rowH + rowH / 2 - 2; // row vertical centre — the dot (drawCircle centres on ry)
        const active = id === activeId;
        const tc = tierColor(def.tier);
        k.drawCircle({ pos: k.vec2(x + PAD + 5, ry), radius: active ? 4 : 3, color: col(tc), fixed: true }); // tier-coloured slot dot (active enlarged)
        if (active) k.drawCircle({ pos: k.vec2(x + PAD + 5, ry), radius: 7, fill: false, outline: { width: 1, color: col(WHITE) }, opacity: 0.7, fixed: true }); // ring the active slot
        // anchor "left-center" = left-aligned + MIDDLE baseline, so the name centres on ry like the dot.
        k.drawText({ text: fit(k, def.name, innerW - 46, 11), pos: k.vec2(x + PAD + 17, ry), anchor: "left-center", size: 11, font: active ? FONT_BOLD : FONT, color: col(active ? THEME.text : THEME.textBody), fixed: true });
        k.drawText({ text: `T${def.tier || 1}`, pos: k.vec2(x + w - PAD, ry), anchor: "right-center", size: 10, font: FONT_BOLD, color: col(tc), fixed: true }); // tier tag
      });
    }, ownedChains.length ? `${equippedIds.length}/${ownedChains.length}` : null);
  }

  // ── ITEMS (deduped with counts) ──────────────────────────────────────────────
  {
    const counts = new Map();
    for (const it of items) { const n = it.name || it.id || "Item"; counts.set(n, (counts.get(n) || 0) + 1); }
    const list = [...counts.entries()];
    const rowH = 18;
    const bodyH = list.length ? Math.min(4, list.length) * rowH : 18;
    section("Items", bodyH, (top) => {
      if (!list.length) { dim("No items", top); return; }
      list.slice(0, 4).forEach(([nm, n], i) => {
        const ry = top + i * rowH + rowH / 2 - 2; // row vertical centre — matches CHAINS so the sections align
        k.drawText({ text: fit(k, nm, innerW - 30, 11), pos: k.vec2(x + PAD, ry), anchor: "left-center", size: 11, font: FONT, color: col(THEME.textBody), fixed: true });
        if (n > 1) k.drawText({ text: `x${n}`, pos: k.vec2(x + w - PAD, ry), anchor: "right-center", size: 10, font: FONT_BOLD, color: col(THEME.textMut), fixed: true });
      });
    }, items.length || null);
  }

  void title; // the eyebrow title is no longer drawn (the rail IS the identity block); kept for the caller contract
  return cy;
}
