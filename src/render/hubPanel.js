// Hub left-gutter INFO + INVENTORY panel. Replaces the bare "VILLAGE / name / Lv / gold /
// essence" text with a polished, standardized stack and surfaces the player's loadout at a
// glance: identity + currency, active TEAM (with HP), equipped CHAINS, and ITEMS. Built from the
// shared theme.js helpers (drawPanel → shadow+sheen+rim, hpColor) so it reads as the same raised-
// surface family as every other panel. Screen-space (fixed). Self-contained: reads the live server
// profile (net.state) when joined, else the local character slot — so hub.js wiring stays tiny.
import { THEME, FONT, drawPanel, hpColor, drawCurrency } from "../ui/theme.js";
import { net } from "../netClient.js";
import { getMonsterType, getSpiritChain } from "../engine/gamedata.js";
import { tierColor } from "./chainCosmetics.js"; // SC-tier: equipped-chain dots are tier-coloured (shared tier cue)
import { getMonsterMaxHp } from "../engine/stats.js";

const trunc = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : (s || ""));
const maxHpOf = (m) => { try { return getMonsterMaxHp(getMonsterType(m.typeName), m.level); } catch { return m.maxHealth || m.currentHealth || 1; } }; // max HP only — getMonsterMaxHp computes the single Health stat, not all 7 (per team monster, per frame in the hub)

// Draw the panel stack anchored at (x, y) with content width `w`, fitting within `maxH` vertical
// room (the identity panel always draws; inventory sections are added only while they fit — so a
// short portrait top-gutter shows just identity, a tall landscape left-gutter shows the lot).
// Returns the bottom y. `character` is the local slot (identity + offline fallback).
// `teamHitOut` (optional): when an array is passed, each drawn TEAM row's screen-space rect +
// monster is pushed into it ({ rect:[x,y,w,h], mon }) so the caller can hit-test taps/clicks and
// open a detail view (TQ-17). Purely additive — omitting it changes nothing.
export function drawHubPanel(k, { x, y, w, maxH = 9999, character, title = "VILLAGE", teamHitOut }) {
  const col = (t) => k.rgb(...t);
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

  const PAD = 10, GAP = 8, accent = THEME.teal;
  let cy = y;

  // A section: titled drawPanel with `bodyH` of content room. Draws the panel + the title row, then
  // calls draw(top) with the y where body content starts. Advances cy past it. `count` → "title  n".
  let full = false; // once a section doesn't fit, STOP — keeps the visible set in priority order
  const section = (title, bodyH, draw, count) => {
    if (full) return;
    const h = 22 + bodyH + PAD;
    if (cy + h > bottomLimit) { full = true; return; } // out of gutter room — stop here (off the world)
    drawPanel(k, { rect: [x, cy, w, h], radius: 12, fill: THEME.surface, border: THEME.line, borderW: 1, fixed: true });
    k.drawText({ text: title, pos: k.vec2(x + PAD, cy + 9), anchor: "left", size: 10, font: FONT, color: col(accent), opacity: 0.95, fixed: true });
    if (count != null) k.drawText({ text: String(count), pos: k.vec2(x + w - PAD, cy + 9), anchor: "right", size: 10, font: FONT, color: col(THEME.textMut), fixed: true });
    // hairline under the title
    k.drawRect({ pos: k.vec2(x + PAD, cy + 20), width: w - PAD * 2, height: 1, color: col(THEME.line), opacity: 0.8, fixed: true });
    draw(cy + 26);
    cy += h + GAP;
  };
  const dim = (txt, top) => k.drawText({ text: txt, pos: k.vec2(x + PAD, top + 8), anchor: "left", size: 10, font: FONT, color: col(THEME.textMut), width: w - PAD * 2, fixed: true });

  // ── Identity + currency ─────────────────────────────────────────────────────
  {
    const h = 88;
    drawPanel(k, { rect: [x, cy, w, h], radius: 12, fill: THEME.surface, border: THEME.line, borderW: 1, fixed: true });
    k.drawText({ text: title, pos: k.vec2(x + PAD, cy + 9), anchor: "left", size: 10, font: FONT, color: col(accent), opacity: 0.95, fixed: true });
    const suffix = character.isGuest ? "  (guest)" : "";
    const maxChars = Math.max(3, Math.floor((w - PAD * 2) / 8.4) - suffix.length);
    k.drawText({ text: `${trunc(character.name, maxChars)}${suffix}`, pos: k.vec2(x + PAD, cy + 26), anchor: "left", size: 15, font: FONT, color: col(THEME.text), fixed: true });
    k.drawText({ text: `Lv ${character.level}`, pos: k.vec2(x + PAD, cy + 44), anchor: "left", size: 11, font: FONT, color: col(THEME.textMut), fixed: true });
    // currency row — shared chips: amber gold (earned) + violet essence (premium)
    drawCurrency(k, {
      x: x + PAD + 4, y: cy + 66, size: 13, gap: 12,
      items: [{ kind: "gold", value: gold }, { kind: "essence", value: essence }],
    });
    cy += h + GAP;
  }

  // ── Active TEAM (with HP) ────────────────────────────────────────────────────
  {
    const shown = team.slice(0, 4);
    const rowH = 38, TILE = 30; // taller rows + a square preview tile (was a 26px row with an oversized sprite)
    const bodyH = shown.length ? shown.length * rowH : 16;
    section(`TEAM`, bodyH, (top) => {
      if (!shown.length) { dim("No monsters — enter the Cave", top); return; }
      shown.forEach((m, i) => {
        const ry = top + i * rowH;
        if (teamHitOut) teamHitOut.push({ rect: [x, ry, w, rowH], mon: m }); // clickable region = the full row (TQ-17)
        const mx = maxHpOf(m), cur = m.currentHealth ?? mx, frac = mx > 0 ? Math.max(0, Math.min(1, cur / mx)) : 1;
        // Square preview tile; the sprite is sized to FIT it via width/height (setDisplaySize) so it
        // can never overflow the tile / spill onto the next row (the old `scale:0.34` did exactly that).
        const ty = ry + (rowH - TILE) / 2;
        k.drawRect({ pos: k.vec2(x + PAD, ty), width: TILE, height: TILE, radius: 8, color: col(THEME.bgAlt), outline: { width: 1, color: col(THEME.line) }, fixed: true });
        try { k.drawSprite({ sprite: (m.typeName || "").toLowerCase().replace(/\s+/g, "_"), pos: k.vec2(x + PAD + TILE / 2, ty + TILE / 2), anchor: "center", width: TILE - 6, height: TILE - 6, fixed: true }); }
        catch { k.drawCircle({ pos: k.vec2(x + PAD + TILE / 2, ty + TILE / 2), radius: 9, color: col(accent), opacity: 0.6, fixed: true }); }
        const tx = x + PAD + TILE + 9;
        k.drawText({ text: trunc(m.name || m.typeName, Math.max(6, Math.floor((w - (tx - x) - 42) / 6.4))), pos: k.vec2(tx, ry + 6), anchor: "left", size: 12, font: FONT, color: col(THEME.text), fixed: true });
        k.drawText({ text: `Lv${m.level}`, pos: k.vec2(x + w - PAD, ry + 6), anchor: "right", size: 10, font: FONT, color: col(THEME.textMut), fixed: true });
        // HP bar under the name
        const bw = w - (tx - x) - PAD;
        k.drawRect({ pos: k.vec2(tx, ry + 25), width: bw, height: 5, radius: 2.5, color: col(THEME.line), fixed: true });
        if (frac > 0) k.drawRect({ pos: k.vec2(tx, ry + 25), width: Math.max(3, bw * frac), height: 5, radius: 2.5, color: col(hpColor(frac)), fixed: true });
      });
    }, `${team.length}/4`);
  }

  // ── Equipped CHAINS ──────────────────────────────────────────────────────────
  // SC-tier: each slot's dot is TIER-COLOURED (the shared tier cue), and the ACTIVE slot — the chain
  // available in combat — is ringed + tagged "T{n}" so the loadout's active tier reads at a glance.
  {
    const activeId = joined ? net.state.equippedChainId : character.equippedChainId;
    const slots = equippedIds.map((id) => ({ id, def: getSpiritChain(id) })).filter((s) => s.def);
    const rowH = 16;
    const bodyH = slots.length ? slots.length * rowH : 16;
    section("CHAINS", bodyH, (top) => {
      if (!slots.length) { dim("No chain equipped", top); return; }
      slots.slice(0, 3).forEach(({ id, def }, i) => {
        const ry = top + i * rowH + rowH / 2; // row vertical centre — the dot (drawCircle centres on ry)
        const active = id === activeId;
        const tc = tierColor(def.tier);
        k.drawCircle({ pos: k.vec2(x + PAD + 4, ry), radius: active ? 4 : 3, color: col(tc), fixed: true }); // tier-coloured slot dot (active enlarged)
        if (active) k.drawCircle({ pos: k.vec2(x + PAD + 4, ry), radius: 6, fill: false, outline: { width: 1, color: col(THEME.text) }, opacity: 0.85, fixed: true }); // ring the active slot
        // anchor "left-center" = left-aligned + MIDDLE baseline, so the name centres on ry like the dot.
        // ("left" is TOP-baseline in the shim, which dropped the text below the bullet — the bug here.)
        k.drawText({ text: trunc(def.name, Math.floor((w - PAD * 2 - 30) / 6)), pos: k.vec2(x + PAD + 14, ry), anchor: "left-center", size: 11, font: FONT, color: col(active ? THEME.text : THEME.textBody), fixed: true });
        k.drawText({ text: `T${def.tier || 1}`, pos: k.vec2(x + w - PAD, ry), anchor: "right-center", size: 10, font: FONT, color: col(tc), fixed: true }); // tier tag
      });
    }, ownedChains.length ? `${equippedIds.length}/${ownedChains.length}` : null);
  }

  // ── ITEMS (deduped with counts) ──────────────────────────────────────────────
  {
    const counts = new Map();
    for (const it of items) { const n = it.name || it.id || "Item"; counts.set(n, (counts.get(n) || 0) + 1); }
    const list = [...counts.entries()];
    const rowH = 16;
    const bodyH = list.length ? Math.min(4, list.length) * rowH : 16;
    section("ITEMS", bodyH, (top) => {
      if (!list.length) { dim("No items", top); return; }
      list.slice(0, 4).forEach(([nm, n], i) => {
        const ry = top + i * rowH + rowH / 2; // row vertical centre — matches CHAINS so the sections align
        k.drawText({ text: trunc(nm, Math.floor((w - PAD * 2 - 28) / 6)), pos: k.vec2(x + PAD, ry), anchor: "left-center", size: 11, font: FONT, color: col(THEME.textBody), fixed: true });
        if (n > 1) k.drawText({ text: `x${n}`, pos: k.vec2(x + w - PAD, ry), anchor: "right-center", size: 10, font: FONT, color: col(THEME.textMut), fixed: true });
      });
    }, items.length || null);
  }

  return cy;
}
