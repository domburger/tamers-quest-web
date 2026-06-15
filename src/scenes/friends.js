import { getProfile, getAccountSession } from "../storage.js";
import { THEME, PAL, FONT, FONT_BODY, addMenuBackground, addHeader, addLabel, addButton, addPanel } from "../ui/theme.js";
import { safeInsetsDesign } from "../systems/safearea.js";

// Friends page (TQ-75): the social home reached from the account page. Lists your friends with live
// presence (online / in run / offline), incoming requests (accept/decline), and an add-by-code flow
// (your friend code is your account id, shown up top). Talks to the /account/friends endpoints
// (TQ-73 + presence TQ-74) with the account session header. Guests have no account → invited to log
// in. The single "frUI" tag is re-rendered on every change (this scene has no z-compositor, so we
// avoid floating overlays except the centered add-friend modal, mirroring the account page).
const STATUS_COLOR = { "in-run": THEME.warn, online: THEME.teal, offline: THEME.textMut };
const STATUS_TEXT = { "in-run": "in run", online: "online", offline: "offline" };
// TQ-204: cap variable-length nicknames so they can't overrun same-row elements (the recurring
// screen-anchored-text overflow pattern — see the kill-feed / rivals fixes).
const trunc = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : (s || ""));

export default function friendsScene(k) {
  k.scene("friends", (args = {}) => {
    addMenuBackground(k);
    const cx = k.width() / 2;
    const ins = safeInsetsDesign(k);
    const backScene = args.backScene || "account";
    const backArgs = args.backArgs;
    const profile = getProfile();
    const session = getAccountSession();
    const authed = !!(profile && !profile.isGuest) && !!session;

    addHeader(k, { x: cx, y: 50 + ins.top, text: "Friends", size: 34 }); // TQ-200: title-case (no-caps; matches the identity/menu header convention)
    addButton(k, { x: 70 + ins.left, y: 40 + ins.top, w: 96, h: 36, text: "< Back", size: 16,
      fill: THEME.surfaceAlt, textColor: THEME.text, onClick: () => { if (!modalUp) k.go(backScene, backArgs); } });

    let modalUp = false;

    // Guests / not-signed-in: friends need an account.
    if (!authed) {
      const colW = Math.min(440, k.width() - 64);
      // TQ-318: the body sentence wraps to 3 lines on narrow/portrait (width colW-40), so the
      // fixed-y Log-in button used to overlap the wrapped text ("…see who's online"). Top-anchor
      // the body, reserve worst-case wrap space, then place the button below + grow the panel.
      const narrow = k.width() < 560;
      const panelTop = 168, bodyY = panelTop + 60, bodyLines = narrow ? 3 : 2;
      const btnY = bodyY + bodyLines * 19 + 28;
      const panelH = (btnY + 40) - panelTop;
      addPanel(k, { x: cx, y: panelTop + panelH / 2, w: colW, h: panelH, radius: 16 });
      addLabel(k, { x: cx, y: panelTop + 30, text: "No account", size: 22, color: THEME.text });
      addLabel(k, { x: cx, y: bodyY, anchor: "top", text: "Friends are tied to your account. Log in to add friends and see who's online.",
        size: 14, color: THEME.textMut, font: FONT_BODY, width: colW - 40, align: "center" });
      addButton(k, { x: cx, y: btnY, w: 200, h: 44, text: "Log in", size: 17,
        fill: THEME.primary, textColor: THEME.textInv, onClick: () => k.go("start") });
      return;
    }

    let data = { friends: [], incoming: [], outgoing: [] };
    let myId = args.myId || "";
    let msg = "";
    const headers = { "Content-Type": "application/json", "x-account-session": session };

    const act = async (method, path, id) => {
      try {
        const opts = { method, headers };
        if (id) opts.body = JSON.stringify({ id });
        const r = await fetch(path, opts);
        return { ok: r.ok, status: r.status, j: await r.json().catch(() => ({})) };
      } catch { return { ok: false, status: 0, j: {} }; }
    };
    const refresh = async () => {
      const r = await act("GET", "/account/friends");
      if (r.ok && r.j) { data = { friends: r.j.friends || [], incoming: r.j.incoming || [], outgoing: r.j.outgoing || [] }; render(); }
    };

    const REQ_ERR = {
      not_found: "No tamer with that code.", blocked: "Can't send them a request.",
      already_friends: "You're already friends.", already_pending: "Request already sent.",
      limit_reached: "Friend / request limit reached.", self: "That's your own code.", invalid_id: "Enter a friend code.",
    };
    const sendRequest = async (id) => {
      if (!id) { msg = REQ_ERR.invalid_id; render(); return; }
      msg = "Sending…"; render();
      const r = await act("POST", "/account/friends/request", id);
      if (r.ok) { msg = r.j.status === "friends" ? "You're now friends!" : "Request sent."; await refresh(); return; }
      msg = REQ_ERR[r.j && r.j.error] || "Couldn't send the request."; render();
    };

    function render() {
      k.destroyAll("frUI");
      const colW = Math.min(560, k.width() - 48);
      const left = cx - colW / 2;
      const label = (x, y, text, size, color, font = FONT, anchor = "left") =>
        k.add([k.text(text, { size, font }), k.pos(x, y), k.anchor(anchor), k.color(...color), "frUI"]);

      // ── Friend code + add ──
      addPanel(k, { x: cx, y: 132, w: colW, h: 72, radius: 14, tag: "frUI" });
      label(left + 20, 114, "YOUR FRIEND CODE", 12, THEME.teal);
      label(left + 20, 140, myId || "…", 15, THEME.text, FONT_BODY);
      addButton(k, { x: left + colW - 70, y: 132, w: 116, h: 40, text: "Add friend", size: 15,
        fill: THEME.primary, textColor: THEME.textInv, tag: "frUI", onClick: openAddModal });
      if (msg) label(cx, 180, msg, 13, THEME.text, FONT_BODY, "center");

      let y = 212;
      const section = (title, n) => { label(left + 8, y, n ? `${title} (${n})` : title, 14, THEME.teal); y += 26; };
      const row = (item, buttons) => {
        addPanel(k, { x: cx, y: y + 18, w: colW, h: 40, radius: 10, tag: "frUI" });
        // Bound the nickname to the room left of the status label (left+174) or, when there's no
        // status, left of the right-edge action buttons — so it can't overlap either (TQ-204).
        const btnW = buttons.reduce((s, b) => s + b.w + 8, 0);
        const nameRight = item.status ? (left + 174 - 8) : (left + colW - 16 - btnW - 8);
        const nameChars = Math.max(4, Math.floor((nameRight - (left + 18)) / 8.6));
        label(left + 18, y + 18, trunc(item.nickname || "Tamer", nameChars), 16, THEME.text, FONT, "left");
        if (item.status) label(left + 174, y + 18, STATUS_TEXT[item.status] || item.status, 12, STATUS_COLOR[item.status] || THEME.textMut, FONT_BODY, "left");
        let edge = left + colW - 16;
        for (const b of buttons) { addButton(k, { x: edge - b.w / 2, y: y + 18, w: b.w, h: 30, text: b.text, size: 12, fill: b.fill, textColor: b.color, tag: "frUI", onClick: b.onClick }); edge -= b.w + 8; }
        y += 48;
      };

      if (data.incoming.length) {
        section("REQUESTS", data.incoming.length);
        for (const it of data.incoming.slice(0, 8)) row(it, [
          { text: "Accept", w: 78, fill: THEME.primary, color: THEME.textInv, onClick: async () => { await act("POST", "/account/friends/accept", it.id); await refresh(); } },
          { text: "Decline", w: 80, fill: THEME.surfaceAlt, color: THEME.text, onClick: async () => { await act("POST", "/account/friends/decline", it.id); await refresh(); } },
        ]);
      }

      section("FRIENDS", data.friends.length);
      if (!data.friends.length) { label(left + 18, y, "No friends yet — share your code above.", 13, THEME.textMut, FONT_BODY); y += 30; }
      for (const it of data.friends.slice(0, 12)) row(it, [
        { text: "Remove", w: 80, fill: THEME.surfaceAlt, color: THEME.danger, onClick: async () => { await act("DELETE", "/account/friends", it.id); await refresh(); } },
        { text: "Block", w: 64, fill: THEME.surfaceAlt, color: THEME.textMut, onClick: async () => { await act("POST", "/account/friends/block", it.id); await refresh(); } },
      ]);

      if (data.outgoing.length) {
        section("PENDING", data.outgoing.length);
        for (const it of data.outgoing.slice(0, 8)) {
          addPanel(k, { x: cx, y: y + 18, w: colW, h: 40, radius: 10, tag: "frUI" });
          // Reserve the right edge for the "pending" label so a long nickname can't run under it (TQ-204).
          const nameChars = Math.max(4, Math.floor(((left + colW - 18 - 58) - (left + 18)) / 8.6));
          label(left + 18, y + 18, trunc(it.nickname || "Tamer", nameChars), 16, THEME.text, FONT, "left");
          label(left + colW - 18, y + 18, "pending", 12, THEME.textMut, FONT_BODY, "right");
          y += 48;
        }
      }
    }

    // Add-friend DOM modal (real <input> for the mobile keyboard), mirroring the account password modal.
    function openAddModal() {
      if (modalUp) return;
      modalUp = true;
      k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(0, 0, 0), k.opacity(0.72), "frModal"]);
      addPanel(k, { x: cx, y: k.height() / 2 - 5, w: Math.min(380, k.width() - 24), h: 210, radius: 16, tag: "frModal" });
      addLabel(k, { x: cx, y: k.height() / 2 - 74, text: "Add a friend", size: 22, color: THEME.text, tag: "frModal" });
      addLabel(k, { x: cx, y: k.height() / 2 - 46, text: "Paste a friend's code (their account id).", size: 12, color: THEME.textMut, font: FONT_BODY, tag: "frModal" });
      const inp = document.createElement("input");
      inp.type = "text"; inp.placeholder = "Friend code"; inp.maxLength = 40; inp.autocomplete = "off";
      Object.assign(inp.style, { position: "fixed", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
        zIndex: "1000", width: "min(70vw, 300px)", padding: "10px 12px", fontSize: "17px", color: PAL.text,
        background: PAL.surface, border: `2px solid ${PAL.line}`, borderRadius: "8px", outline: "none", fontFamily: "inherit" });
      document.body.appendChild(inp);
      setTimeout(() => { try { inp.focus(); } catch {} }, 50);
      const close = () => { modalUp = false; inp.remove(); k.destroyAll("frModal"); };
      const submit = () => { const v = (inp.value || "").trim(); close(); sendRequest(v); };
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } else if (e.key === "Escape") { e.preventDefault(); close(); } });
      const by = k.height() / 2 + 64;
      addButton(k, { x: cx - 78, y: by, w: 140, h: 42, text: "Send", size: 16, fill: THEME.primary, textColor: THEME.textInv, tag: "frModal", onClick: submit });
      addButton(k, { x: cx + 78, y: by, w: 140, h: 42, text: "Cancel", size: 16, fill: THEME.surfaceAlt, textColor: THEME.text, tag: "frModal", onClick: close });
      k.onSceneLeave(() => { try { inp.remove(); } catch {} });
    }

    render();
    // Load my friend code (account id) + the friends list from the server.
    fetch("/account/me", { headers: { "x-account-session": session } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && d.account && d.account.id) { myId = d.account.id; render(); } }).catch(() => {});
    refresh();
  });
}
