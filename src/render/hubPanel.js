import { THEME, FONT, FONT_BOLD, WHITE, lighten, drawEyebrow, drawHairline, drawGlass, drawChip, drawMeter, hpColor, drawCurrency } from "../ui/theme.js";
import { drawIcon } from "../ui/icons.js";
import { drawCharacter } from "./character.js";
import { getEquippedCharacterSkin } from "./characterCosmetics.js";
import { net } from "../netClient.js";
import { getMonsterType, getSpiritChain } from "../engine/gamedata.js";
import { drawMonsterIcon } from "./monster.js";
import { tierColor } from "./chainCosmetics.js";
import { getMonsterMaxHp } from "../engine/stats.js";

const maxHpOf = (m) => { try { return getMonsterMaxHp(getMonsterType(m.typeName), m.level); } catch { return m.maxHealth || m.currentHealth || 1; } };

function fit(k, s, w, size, font = FONT) {
  const str = s || "";
  const mw = typeof k.measureText === "function" ? (t) => k.measureText(t, size, font) : (t) => t.length * size * 0.56;
  if (mw(str) <= w) return str;
  let lo = 0, hi = str.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (mw(str.slice(0, mid) + "…") <= w) lo = mid; else hi = mid - 1; }
  return lo <= 0 ? "" : str.slice(0, lo).trimEnd() + "…";
}

const _colCache = new Map();
export function drawHubPanel(k, { x, y, w, maxH = 9999, character, title = "VILLAGE", teamHitOut, measureIcons = true }) {
  const col = (t) => {
    const key = ((t[0] | 0) << 16) | ((t[1] | 0) << 8) | (t[2] | 0);
    let v = _colCache.get(key);
    if (v === undefined) { v = k.rgb(t[0], t[1], t[2]); _colCache.set(key, v); }
    return v;
  };
  const bottomLimit = y + maxH;
  if (teamHitOut) teamHitOut.length = 0;
  const joined = !!net.state.playerId;
  const team = (joined ? net.state.team : character.activeMonsters) || [];
  const items = (joined ? net.state.items : character.items) || [];
  const ownedChains = (joined ? net.state.chains : character.chains) || [];
  const equippedIds = (joined ? net.state.equippedChainIds : character.equippedChainIds)
    || (character.equippedChainId ? [character.equippedChainId] : []);
  const gold = joined ? net.state.gold : character.gold;
  const essence = joined ? net.state.essence : character.essence;

  const PAD = 4, GAP = 14;
  const innerW = w - PAD * 2;
  let cy = y;

  let full = false;
  const section = (label, bodyH, draw, count, icon) => {
    if (full) return;
    const h = 24 + bodyH;
    if (cy + h > bottomLimit) { full = true; return; }
    drawHairline(k, { x: x + PAD, y: cy, w: innerW, opacity: 0.1, fixed: true });
    cy += GAP;
    if (icon) drawIcon(k, icon, { x: x + PAD + 7, y: cy + 5, size: 14, color: THEME.primary, fixed: true });
    drawEyebrow(k, { x: x + PAD + (icon ? 20 : 0), y: cy, text: label, size: 10, color: THEME.textMut, spacing: 2, fixed: true });
    if (count != null) k.drawText({ text: String(count), pos: k.vec2(x + w - PAD, cy - 1), anchor: "topright", size: 11, font: FONT_BOLD, color: col(THEME.textMut), fixed: true });
    draw(cy + 22);
    cy += 22 + bodyH + 2;
  };
  const dim = (txt, top) => k.drawText({ text: txt, pos: k.vec2(x + PAD, top + 2), anchor: "left", size: 11, font: FONT, color: col(THEME.textMut), width: innerW, fixed: true });

  {
    const AV = 24, ax = x + PAD + AV, ay = cy + AV;
    k.drawCircle({ pos: k.vec2(ax, ay), radius: AV, color: col(THEME.bg), opacity: 0.6, fixed: true });
    k.drawCircle({ pos: k.vec2(ax, ay), radius: AV, color: col(THEME.primary), opacity: 1, gradient: { stops: [[0, lighten(THEME.primary, 40), 0.55], [0.6, THEME.primary, 0.22], [1, THEME.primary, 0.08]] }, fixed: true });
    k.drawCircle({ pos: k.vec2(ax, ay), radius: AV - 0.5, color: col(THEME.primary), fill: false, outline: { width: 1.5, color: col(THEME.primary) }, opacity: 0.75, fixed: true });
    try {
      const sk = getEquippedCharacterSkin() || {};
      k.pushClip(ax - AV + 1, ay - AV + 1, AV * 2 - 2, AV * 2 - 2);
      drawCharacter(k, { x: ax, y: ay + 2, t: 0, moving: false, dir: { x: 0, y: 1 }, scale: 0.72, color: sk.accent || THEME.primary, cloak: sk.cloak, model: sk.model || "cloak", holdChain: false, fixed: true });
      k.popClip();
    } catch {}
    const tx = ax + AV + 10, tw = x + w - PAD - tx;
    k.drawText({ text: fit(k, character.name, tw, 16, FONT_BOLD), pos: k.vec2(tx, cy + 5), anchor: "left", size: 16, font: FONT_BOLD, color: col(THEME.text), fixed: true });
    let chipX = tx;
    const lvR = drawChip(k, { x: chipX, y: cy + 27, text: `Lv ${character.level}`, color: THEME.textBody, size: 9, h: 17, padX: 7, fixed: true });
    chipX = lvR[0] + lvR[2] + 5;
    if (character.isGuest && chipX + 44 <= x + w - PAD) drawChip(k, { x: chipX, y: cy + 27, text: "guest", color: THEME.amber, size: 9, h: 17, padX: 7, fixed: true });
    cy += AV * 2 + 12;
    drawCurrency(k, { x: x + PAD + 2, y: cy + 8, size: 14, gap: 16, pip: 5, animKey: "rail-wallet", items: [{ kind: "gold", value: gold }, { kind: "essence", value: essence }] });
    cy += 26;
  }

  {
    const shown = team.slice(0, 4);
    const rowH = 44, TILE = 36;
    const bodyH = shown.length ? shown.length * rowH : 18;
    section("Team", bodyH, (top) => {
      if (!shown.length) { dim("No monsters yet", top); return; }
      shown.forEach((m, i) => {
        const ry = top + i * rowH;
        if (teamHitOut) teamHitOut.push({ rect: [x, ry, w, rowH], mon: m });
        const mx = maxHpOf(m), cur = m.currentHealth ?? mx, frac = mx > 0 ? Math.max(0, Math.min(1, cur / mx)) : 1;
        const ty = ry + (rowH - TILE) / 2 - 2;
        drawGlass(k, { rect: [x + PAD, ty, TILE, TILE], radius: 11, fill: 0.07, line: 0.12, tint: 0.35, fixed: true });
        drawMonsterIcon(k, { typeName: m.typeName, cx: x + PAD + TILE / 2, cy: ty + TILE / 2, scale: (TILE - 6) / 256, topY: ty, fixed: true, measure: measureIcons });
        const tx = x + PAD + TILE + 9, tw = x + w - PAD - tx;
        const lv = `Lv ${m.level}`;
        const lvW = typeof k.measureText === "function" ? k.measureText(lv, 10, FONT_BOLD) : 26;
        k.drawText({ text: fit(k, m.name || m.typeName, tw - lvW - 8, 13, FONT_BOLD), pos: k.vec2(tx, ry + 6), anchor: "left", size: 13, font: FONT_BOLD, color: col(THEME.text), fixed: true });
        k.drawText({ text: lv, pos: k.vec2(x + w - PAD, ry + 7), anchor: "topright", size: 10, font: FONT_BOLD, color: col(THEME.textMut), fixed: true });
        drawMeter(k, { rect: [tx, ry + 27, tw, 5], frac, color: hpColor(frac), fixed: true });
      });
    }, `${team.length}/4`, "person");
  }

  {
    const activeId = joined ? net.state.equippedChainId : character.equippedChainId;
    const slots = equippedIds.map((id) => ({ id, def: getSpiritChain(id) })).filter((s) => s.def);
    const rowH = 20;
    const bodyH = slots.length ? slots.length * rowH : 18;
    section("Chains", bodyH, (top) => {
      if (!slots.length) { dim("No chain equipped", top); return; }
      slots.slice(0, 3).forEach(({ id, def }, i) => {
        const ry = top + i * rowH + rowH / 2 - 2;
        const active = id === activeId;
        const tc = tierColor(def.tier);
        k.drawCircle({ pos: k.vec2(x + PAD + 5, ry), radius: active ? 4 : 3, color: col(tc), fixed: true });
        if (active) k.drawCircle({ pos: k.vec2(x + PAD + 5, ry), radius: 7, fill: false, outline: { width: 1, color: col(WHITE) }, opacity: 0.7, fixed: true });
        k.drawText({ text: fit(k, def.name, innerW - 46, 11), pos: k.vec2(x + PAD + 17, ry), anchor: "left-center", size: 11, font: active ? FONT_BOLD : FONT, color: col(active ? THEME.text : THEME.textBody), fixed: true });
        k.drawText({ text: `T${def.tier || 1}`, pos: k.vec2(x + w - PAD, ry), anchor: "right-center", size: 10, font: FONT_BOLD, color: col(tc), fixed: true });
      });
    }, ownedChains.length ? `${equippedIds.length}/${ownedChains.length}` : null, "chain");
  }

  {
    const counts = new Map();
    for (const it of items) { const n = it.name || it.id || "Item"; counts.set(n, (counts.get(n) || 0) + 1); }
    const list = [...counts.entries()];
    const rowH = 20;
    const bodyH = list.length ? Math.min(4, list.length) * rowH : 18;
    section("Items", bodyH, (top) => {
      if (!list.length) { dim("No items", top); return; }
      list.slice(0, 4).forEach(([nm, n], i) => {
        const ry = top + i * rowH + rowH / 2 - 2;
        k.drawText({ text: fit(k, nm, innerW - 30, 11), pos: k.vec2(x + PAD, ry), anchor: "left-center", size: 11, font: FONT, color: col(THEME.textBody), fixed: true });
        if (n > 1) k.drawText({ text: `x${n}`, pos: k.vec2(x + w - PAD, ry), anchor: "right-center", size: 10, font: FONT_BOLD, color: col(THEME.textMut), fixed: true });
      });
    }, items.length || null, "bag");
  }

  void title;
  return cy;
}
