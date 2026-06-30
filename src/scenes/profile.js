import { getProfile, getCharacters, getAccountSession, getAccountNickname, clearProfile, setProfileNickname } from "../storage.js";
import { net } from "../netClient.js"; // clearSession() on Sign out
import { THEME, PAL, FONT, FONT_BODY, addMenuBackground, addHeader, addLabel, addButton, addPanel } from "../ui/theme.js";
import { safeInsetsDesign } from "../systems/safearea.js";
import { drawCharacter } from "../render/character.js"; // the SAME vector tamer the lobby/charselect draw — the player's avatar
import { xpForLevel } from "../engine/progression.js"; // TQ-186: XP needed for the next account level
import { slugOf, drawMonsterIcon } from "../render/monster.js"; // slugOf: canonical sprite key; drawMonsterIcon: TQ-396 immediate-mode icon that also rasterizes generated (html-model) monsters
import { getEquippedCharacterSkin } from "../render/characterCosmetics.js";
import { prefersReducedMotion } from "../systems/a11y.js"; // a11y: freeze the avatar bob under Reduce Motion

// Profile page (user request 2026-06-10): the login indicator's detail view — avatar, username
// (editable), lifetime player data, and per-run match history. Reachable from the character-select
// identity chip. Data comes from the server (/account/me) for logged-in accounts; guests fall back
// to their local (session-only) character so the page still renders something meaningful.
export default function profileScene(k) {
  k.scene("profile", (args = {}) => {
    addMenuBackground(k);
    const cx = k.width() / 2;
    const backScene = args.backScene || "characterSelect"; // lobby dropdown passes "lobby"; chip passes nothing
    const backArgs = args.backArgs;
    const ins = safeInsetsDesign(k);
    const skin = getEquippedCharacterSkin();
    const profile = getProfile();
    const authed = !!(profile && !profile.isGuest);
    const session = getAccountSession();

    // The avatar is the SAME immediate-mode vector tamer the lobby draws. One scene onDraw,
    // gated on a position (set once data is ready) + suppressed while the rename modal is up.
    let avatar = null; // { x, y, scale }
    const teamThumbs = []; // TQ-396: team monster thumbnails, painted immediate-mode in the onDraw so html-model (generated) monsters rasterize instead of falling back to a blank/emblem
    let modalUp = false;
    let statsView = "all"; // per-tamer stats selector (TQ-53): "all" (aggregate) or a character id
    k.onDraw(() => {
      if (modalUp) return;
      if (avatar) drawCharacter(k, { x: avatar.x, y: avatar.y, t: prefersReducedMotion() ? 0 : k.time(), dir: { x: 0, y: 1 }, scale: avatar.scale, color: skin.accent, cloak: skin.cloak, model: skin.model });
      // TQ-396: team thumbnails over their retained frames — drawMonsterIcon rasterizes a generated
      // monster's html model (or uses its baked sprite), so the team shows real art, not blank/emblem.
      for (const th of teamThumbs) drawMonsterIcon(k, { sprite: slugOf(th.mon.typeName), typeName: th.mon.typeName, cx: th.cx, cy: th.cy, scale: th.scale, topY: th.topY });
    });

    // Header + nav (mirrors the other menu scenes).
    addHeader(k, { x: cx, y: 50 + ins.top, text: "Profile", size: 34 });
    // The rename modal is a dimmed overlay, but kaboom has no z-input compositor — a backdrop rect
    // doesn't block the buttons beneath it (the overlay-bleed pattern). Hand-gate these top-nav
    // buttons on modalUp so you can't Back / Sign-out THROUGH the open rename modal (and lose it).
    addButton(k, { x: 70 + ins.left, y: 40 + ins.top, w: 96, h: 36, text: "< Back", size: 16,
      fill: THEME.surfaceAlt, textColor: THEME.text, onClick: () => { if (modalUp) return; k.go(backScene, backArgs); } });
    if (authed) {
      addButton(k, { x: k.width() - 76 - ins.right, y: 40 + ins.top, w: 108, h: 36, text: "Sign out", size: 15,
        fill: THEME.surfaceAlt, textColor: THEME.danger,
        onClick: () => { if (modalUp) return; try { net.clearSession(); } catch { /* none */ } clearProfile(); k.go("start"); } });
    }

    // ── Data shaping ──
    // Raw lifetime counters + two DERIVED cells (escape rate, total XP) so the row reads as
    // performance, not just tallies. Derived cells pull from computed values (see render), not
    // data.totals — escape rate = extractions/runs, total XP = sum of match-history xpGained
    // (history is server-capped at 20 runs, so this is "recent runs" XP, the only per-run source).
    const STAT_CELLS = [
      { key: "runs", label: "Runs", color: THEME.text },
      { key: "extractions", label: "Escaped", color: THEME.success },
      { key: "escapeRate", label: "Escape %", color: THEME.success, derived: true },
      { key: "deaths", label: "Deaths", color: THEME.danger },
      { key: "caught", label: "Caught", color: THEME.teal },
      { key: "pvpWins", label: "PvP wins", color: THEME.violet },
      { key: "xp", label: "Total XP", color: THEME.amber, derived: true },
    ];
    const sumStats = (chars) => {
      const t = {};
      for (const c of chars) for (const k2 of Object.keys(c.stats || {})) t[k2] = (t[k2] || 0) + (c.stats[k2] || 0);
      return t;
    };
    const mergeHistory = (chars) =>
      chars.flatMap((c) => (c.matchHistory || []).map((h) => ({ ...h, who: c.name })))
        .sort((a, b) => (b.at || 0) - (a.at || 0));

    function localData() {
      // Guest / offline: the local character cache (session-only). No server match history.
      const chars = getCharacters();
      return {
        name: getAccountNickname() || (profile && profile.nickname) || "Tamer",
        isGuest: !authed,
        characters: chars,
        totals: sumStats(chars),
        history: [],
      };
    }
    function serverData(account) {
      const chars = account.characters || [];
      return {
        name: account.nickname || "Tamer",
        isGuest: false,
        providers: account.providers || null,
        characters: chars,
        totals: sumStats(chars),
        history: mergeHistory(chars),
      };
    }

    // ── Relative time for match-history rows (client-side; Date is fine here) ──
    function ago(at) {
      if (!at) return "";
      const s = Math.max(0, Math.round((Date.now() - at) / 1000));
      if (s < 60) return "just now";
      const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
      const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
      return `${Math.round(h / 24)}d ago`;
    }

    // ── Render (idempotent; called for the optimistic local pass, then the server refresh) ──
    function render(data) {
      k.destroyAll("pfUI");
      teamThumbs.length = 0; // TQ-396: rebuilt below; the onDraw repaints them (html-model aware)
      const colW = Math.min(560, k.width() - 64);
      const left = cx - colW / 2;

      // Identity panel: sign-in method badge + avatar + username + (rename). The avatar is an
      // immediate-mode draw (it paints ABOVE game objects), so the username must sit well BELOW
      // the figure's feet (~66px, matching the character-select empty state) — a tighter gap let
      // the opaque figure and its hanging spirit-chain paint right over the centered name.
      addPanel(k, { x: cx, y: 202, w: colW, h: 254, radius: 16, tag: "pfUI" });
      if (data.providers) {
        const badges = [
          data.providers.google && "Google",
          data.providers.discord && "Discord",
          data.providers.password && "Email",
        ].filter(Boolean);
        if (badges.length) pfLabel(cx, 95, `Signed in with ${badges.join(", ")}`, 12, THEME.textMut, FONT_BODY);
      }
      // TQ-103: stack avatar → name → (rename/guest-notice) with clear gaps so nothing overlaps. The
      // avatar is immediate-mode (paints ABOVE the panel), so the figure (head ~34px above the feet, the
      // ground shadow ~25px below, the held chain ring ~20px to the side at this scale) is sized + placed
      // to sit ENTIRELY in the panel's top third, leaving the name well below its shadow and the button
      // well below the name. Scale dropped 1.5→1.3 so the figure + chain stay inside the avatar zone.
      avatar = { x: cx, y: 206, scale: 1.3 }; // feet point — the vector tamer draws upward into the panel
      // TQ-205: cap the size-26 name to the panel width so a long nickname (rename allows up to 24
      // chars) can't clip the screen edges on narrow portrait — matches account.js's name handling.
      const pfName = data.name || "Tamer";
      const pfNameMax = Math.max(6, Math.floor((colW - 40) / 15));
      pfLabel(cx, 266, pfName.length > pfNameMax ? pfName.slice(0, pfNameMax - 1) + "…" : pfName, 26, THEME.text);
      if (data.isGuest) {
        pfLabel(cx, 302, "Playing as guest — progress isn't saved", 13, THEME.warn, FONT_BODY);
      } else if (session) {
        addButton(k, { x: cx, y: 302, w: 150, h: 30, text: "Edit username", size: 13,
          fill: THEME.surfaceAlt, textColor: THEME.teal, tag: "pfUI", onClick: () => openRename(data) });
      }

      // Player-data panel: lifetime totals as a row of stat cells. For a multi-tamer account a small
      // selector (All + one chip per tamer) switches the row between the aggregate and a single
      // tamer's numbers (TQ-53); single-tamer accounts render exactly as before (no selector).
      const chars = data.characters || [];
      const nChars = chars.length;
      let viewChar = null;
      if (statsView !== "all") { viewChar = chars.find((c) => c.id === statsView) || null; if (!viewChar) statsView = "all"; }
      const totals = viewChar ? sumStats([viewChar]) : data.totals;
      const histForXp = viewChar ? (viewChar.matchHistory || []) : (data.history || []);

      // Selector chips sit in the gap between the identity panel and the stat panel — only when
      // there's more than one tamer, so single-character profiles are untouched.
      if (nChars > 1) {
        const chips = [{ id: "all", label: "All" }, ...chars.map((c) => ({ id: c.id, label: c.name || "Tamer" }))];
        const gap = 6, chipW = (colW - gap * (chips.length - 1)) / chips.length;
        const maxChars = Math.max(3, Math.floor(chipW / 7));
        chips.forEach((ch, i) => {
          const sel = statsView === ch.id;
          const lbl = ch.label.length > maxChars ? ch.label.slice(0, maxChars - 1) + "…" : ch.label;
          addButton(k, { x: left + 18 + (chipW + gap) * i + chipW / 2, y: 344, w: chipW, h: 24, text: lbl, size: 12,
            fill: sel ? THEME.teal : THEME.surfaceAlt, textColor: sel ? THEME.textInv : THEME.textMut,
            tag: "pfUI", onClick: () => { statsView = ch.id; render(data); } });
        });
      }

      addPanel(k, { x: cx, y: 402, w: colW, h: 92, radius: 14, tag: "pfUI" });
      const vn = (viewChar && viewChar.name) || "Tamer";
      const pdTitle = viewChar ? `Player Data — ${vn.length > 16 ? vn.slice(0, 15) + "…" : vn}`
        : (nChars > 1 ? `Player Data (${nChars} tamers)` : "Player Data");
      pfLabel(left + 18, 370, pdTitle, 13, THEME.teal, FONT, "left");
      // TQ-186: account prestige level + carry-over XP toward the next level (xpForLevel curve), for
      // the tamer in view (selected chip / the one you arrived as / the only tamer). Earned from play,
      // server-authoritative, non-pay-to-win — shown right of the panel title.
      const lvlChar = viewChar || chars.find((c) => c.id === (backArgs && backArgs.characterId)) || chars[0] || null;
      if (lvlChar) {
        const lv = Math.max(1, lvlChar.level || 1), need = xpForLevel(lv), have = Math.max(0, Math.min(need, lvlChar.xp || 0));
        pfLabel(left + colW - 18, 370, `Lv ${lv}    ${have}/${need} XP`, 13, THEME.amber, FONT, "right");
      }
      // Derived values: escape rate ("—" when no runs, no divide-by-zero) + compact total XP.
      const runs = totals.runs || 0, escaped = totals.extractions || 0;
      const totalXp = histForXp.reduce((s, h) => s + (h.xp || 0), 0);
      const derived = {
        escapeRate: runs > 0 ? `${Math.round((escaped / runs) * 100)}%` : "—",
        xp: totalXp >= 1000 ? `${(totalXp / 1000).toFixed(totalXp >= 10000 ? 0 : 1)}k` : String(totalXp),
      };
      const cellW = (colW - 36) / STAT_CELLS.length;
      // Scale the value + label to the cell so a 4-digit total or "PvP wins" can't overflow into the
      // neighbour on a narrow phone (cellW shrinks with the now-7 cells). No-op when wide.
      const vSize = Math.min(26, Math.round(cellW * 0.44)), lSize = Math.min(11, Math.round(cellW * 0.19));
      STAT_CELLS.forEach((cell, i) => {
        const x = left + 18 + cellW * (i + 0.5);
        const val = cell.derived ? derived[cell.key] : String(totals[cell.key] || 0);
        pfLabel(x, 402, val, vSize, cell.color);
        pfLabel(x, 430, cell.label, lSize, THEME.textMut, FONT_BODY);
      });

      // ── Team panel: the active tamer's current monsters as mini portraits (TQ-52). Sprites are the
      // boot-loaded procedural ones (slugOf key, matching main.js); try/catch so an unloaded sprite
      // never throws. Pick the tamer we arrived from (hub passes characterId in backArgs), else the
      // first character. Works for guest (local cache) + logged-in (server) data identically.
      const activeCharId = backArgs && backArgs.characterId;
      const activeChar = (data.characters || []).find((c) => c.id === activeCharId) || (data.characters || [])[0] || null;
      const team = (activeChar && activeChar.activeMonsters) || [];
      const teamTop = 458, teamH = 92;
      addPanel(k, { x: cx, y: teamTop + teamH / 2, w: colW, h: teamH, radius: 14, tag: "pfUI" });
      pfLabel(left + 18, teamTop + 16, "Team", 13, THEME.teal, FONT, "left");
      if (!team.length) {
        pfLabel(cx, teamTop + teamH / 2 + 6, activeChar ? "No monsters yet — visit the Vault to build a team." : "No tamer selected.", 13, THEME.textMut, FONT_BODY);
      } else {
        const shown = team.slice(0, 6);
        const slotW = (colW - 36) / shown.length;
        const pscale = Math.max(0.12, Math.min(0.2, slotW / 240)); // TQ-104: cap a touch smaller (was 0.24) so the portrait clears its name/level label
        const maxChars = Math.max(3, Math.floor(slotW / 6.2) - 4); // reserve room for the " L{level}" suffix appended after truncation
        shown.forEach((m, i) => {
          const x = left + 18 + slotW * (i + 0.5);
          // TQ-104: raise the sprite to teamTop+44 and drop the label to teamTop+80 so the name/level
          // sits clearly BELOW the portrait (the ~58px sprite at the old +50 / +76 ran into the label).
          teamThumbs.push({ cx: x, cy: teamTop + 44, topY: teamTop + 16, scale: pscale, mon: m }); // TQ-396: painted by the onDraw via drawMonsterIcon (html-model aware)
          const nm = m.name || m.typeName || "?";
          const label = `${nm.length > maxChars ? nm.slice(0, maxChars - 1) + "…" : nm} L${m.level || 1}`;
          pfLabel(x, teamTop + 80, label, 10, THEME.textBody, FONT_BODY);
        });
        if (team.length > 6) pfLabel(left + colW - 18, teamTop + 16, `+${team.length - 6}`, 11, THEME.textMut, FONT_BODY, "right");
      }

      // Match-history panel: recent runs (server log). Rows adapt to the height left below.
      const histTop = teamTop + teamH + 10;
      const histBottom = k.height() - 24 - ins.bottom;
      const histH = Math.max(80, histBottom - histTop);
      addPanel(k, { x: cx, y: histTop + histH / 2, w: colW, h: histH, radius: 14, tag: "pfUI" });
      pfLabel(left + 18, histTop + 20, "Match History", 13, THEME.teal, FONT, "left");
      const rowsFit = Math.max(1, Math.floor((histH - 44) / 30));
      const rows = data.history.slice(0, rowsFit);
      if (!rows.length) {
        const empty = data.isGuest ? "Log in to track your runs across devices." : "No runs yet — enter the caves to build your history.";
        pfLabel(cx, histTop + histH / 2 + 6, empty, 14, THEME.textMut, FONT_BODY);
      } else {
        rows.forEach((h, i) => drawHistoryRow(h, left + 18, histTop + 44 + i * 30, colW - 36));
      }
    }

    function drawHistoryRow(h, x, y, w) {
      const win = h.result === "extracted";
      k.add([k.circle(4), k.pos(x + 4, y), k.anchor("center"), k.color(...(win ? THEME.success : THEME.danger)), "pfUI"]);
      pfLabel(x + 16, y, win ? "Extracted" : "Defeated", 14, win ? THEME.success : THEME.danger, FONT, "left");
      // gains summary + relative time (right-aligned)
      const bits = [];
      if (h.caught) bits.push(`Caught ${h.caught}`);
      if (h.xp) bits.push(`+${h.xp} XP`);
      if (h.survivedS) bits.push(`${h.survivedS}s`);
      pfLabel(x + w - 86, y, bits.join("  ") || "—", 12, THEME.textBody, FONT_BODY, "right");
      pfLabel(x + w, y, ago(h.at), 12, THEME.textMut, FONT_BODY, "right");
    }

    // Tagged label helper so destroyAll("pfUI") reaps everything on re-render.
    function pfLabel(x, y, text, size, color, font = FONT, anchor = "center") {
      k.add([k.text(text, { size, font }), k.pos(x, y), k.anchor(anchor), k.color(...color), "pfUI"]);
    }

    // ── Rename modal (logged-in): DOM <input> so the mobile keyboard opens (mirrors charselect) ──
    let renameEl = null;
    function openRename(data) {
      if (modalUp) return;
      modalUp = true;
      k.destroyAll("pfModal");
      k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(0, 0, 0), k.opacity(0.72), "pfModal"]);
      addPanel(k, { x: cx, y: k.height() / 2 - 5, w: Math.min(380, k.width() - 24), h: 214, radius: 16, tag: "pfModal" });
      addLabel(k, { x: cx, y: k.height() / 2 - 74, text: "Edit username", size: 22, color: THEME.text, tag: "pfModal" });
      const errLabel = addLabel(k, { x: cx, y: k.height() / 2 - 44, text: "This is how other tamers see you.", size: 13, color: THEME.textMut, font: FONT_BODY, tag: "pfModal" });

      const input = document.createElement("input");
      input.type = "text"; input.maxLength = 24; input.value = data.name || ""; input.placeholder = "Username";
      Object.assign(input.style, {
        position: "fixed", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
        zIndex: "1000", width: "min(70vw, 320px)", padding: "12px 14px", fontSize: "20px",
        textAlign: "center", color: PAL.text, background: PAL.surface,
        border: `2px solid ${PAL.line}`, borderRadius: "8px", outline: "none", fontFamily: "inherit",
      });
      document.body.appendChild(input);
      renameEl = input;
      setTimeout(() => { try { input.focus(); input.select(); } catch {} }, 50);

      const close = () => {
        modalUp = false;
        if (renameEl) { renameEl.remove(); renameEl = null; }
        k.destroyAll("pfModal");
      };
      const submit = async () => {
        const name = (input.value || "").trim();
        if (!name) { input.focus(); return; }
        errLabel.text = "Saving…";
        try {
          const r = await fetch("/account/username", { method: "POST",
            headers: { "Content-Type": "application/json", "x-account-session": session },
            body: JSON.stringify({ name }) });
          if (r.ok) {
            const nn = (await r.json().catch(() => ({}))).nickname || name;
            setProfileNickname(nn);
            data.name = nn;
            close();
            render(data); // reflect the new name immediately
          } else {
            errLabel.text = "Couldn't save that name — try again.";
          }
        } catch { errLabel.text = "Network error — try again."; }
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); submit(); }
        else if (e.key === "Escape") { e.preventDefault(); close(); }
      });
      const by = k.height() / 2 + 60;
      addButton(k, { x: cx - 78, y: by, w: 140, h: 44, text: "Save", size: 17,
        fill: THEME.primary, textColor: THEME.textInv, tag: "pfModal", onClick: submit });
      addButton(k, { x: cx + 78, y: by, w: 140, h: 44, text: "Cancel", size: 17,
        fill: THEME.surfaceAlt, textColor: THEME.text, tag: "pfModal", onClick: close });
      k.onSceneLeave(() => { if (renameEl) renameEl.remove(); });
    }

    // Optimistic local render, then refresh from the server for a logged-in account.
    render(localData());
    if (authed && session) {
      fetch("/account/me", { headers: { "x-account-session": session } })
        .then((r) => (r.status === 401 ? null : r.ok ? r.json() : null))
        .then((d) => { if (d && d.account) render(serverData(d.account)); })
        .catch(() => { /* offline — keep the local render */ });
    }
  });
}
