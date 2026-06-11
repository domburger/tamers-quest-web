import { getProfile, getCharacters, getAccountSession, getAccountNickname, clearProfile, setProfileNickname } from "../storage.js";
import { net } from "../netClient.js"; // clearSession() on Sign out
import { THEME, PAL, FONT, FONT_BODY, addMenuBackground, addHeader, addLabel, addButton, addPanel } from "../ui/theme.js";
import { safeInsetsDesign } from "../systems/safearea.js";
import { drawCharacter } from "../render/character.js"; // the SAME vector tamer the lobby/charselect draw — the player's avatar
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
    let modalUp = false;
    k.onDraw(() => {
      if (!avatar || modalUp) return;
      drawCharacter(k, { x: avatar.x, y: avatar.y, t: prefersReducedMotion() ? 0 : k.time(), dir: { x: 0, y: 1 }, scale: avatar.scale, color: skin.accent, cloak: skin.cloak, model: skin.model });
    });

    // Header + nav (mirrors the other menu scenes).
    addHeader(k, { x: cx, y: 50 + ins.top, text: "PROFILE", size: 34 });
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
    const STAT_CELLS = [
      { key: "runs", label: "Runs", color: THEME.text },
      { key: "extractions", label: "Escaped", color: THEME.success },
      { key: "deaths", label: "Deaths", color: THEME.danger },
      { key: "caught", label: "Caught", color: THEME.teal },
      { key: "pvpWins", label: "PvP wins", color: THEME.violet },
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
      avatar = { x: cx, y: 222, scale: 1.5 }; // feet point — the vector tamer draws upward into the panel
      pfLabel(cx, 288, data.name || "Tamer", 26, THEME.text);
      if (data.isGuest) {
        pfLabel(cx, 314, "Playing as guest — progress isn't saved", 13, THEME.warn, FONT_BODY);
      } else if (session) {
        addButton(k, { x: cx, y: 314, w: 150, h: 30, text: "Edit username", size: 13,
          fill: THEME.surfaceAlt, textColor: THEME.teal, tag: "pfUI", onClick: () => openRename(data) });
      }

      // Player-data panel: lifetime totals as a row of stat cells.
      const nChars = (data.characters || []).length;
      addPanel(k, { x: cx, y: 402, w: colW, h: 92, radius: 14, tag: "pfUI" });
      pfLabel(left + 18, 370, nChars > 1 ? `PLAYER DATA (${nChars} tamers)` : "PLAYER DATA", 13, THEME.teal, FONT, "left");
      const cellW = (colW - 36) / STAT_CELLS.length;
      // Scale the value + label to the cell so a 4-digit total or "PvP wins" can't overflow into the
      // neighbour on a narrow phone (cellW falls to ~46px at ~330 design-width). No-op when wide.
      const vSize = Math.min(26, Math.round(cellW * 0.44)), lSize = Math.min(12, Math.round(cellW * 0.24));
      STAT_CELLS.forEach((cell, i) => {
        const x = left + 18 + cellW * (i + 0.5);
        pfLabel(x, 402, String(data.totals[cell.key] || 0), vSize, cell.color);
        pfLabel(x, 430, cell.label, lSize, THEME.textMut, FONT_BODY);
      });

      // Match-history panel: recent runs (server log). Rows adapt to the height left below.
      const histTop = 460;
      const histBottom = k.height() - 24 - ins.bottom;
      const histH = Math.max(80, histBottom - histTop);
      addPanel(k, { x: cx, y: histTop + histH / 2, w: colW, h: histH, radius: 14, tag: "pfUI" });
      pfLabel(left + 18, histTop + 20, "MATCH HISTORY", 13, THEME.teal, FONT, "left");
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
