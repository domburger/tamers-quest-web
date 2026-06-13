import { getProfile, getCharacters, getAccountSession, getAccountNickname, clearProfile } from "../storage.js";
import { net } from "../netClient.js"; // clearSession() on Sign out
import { THEME, FONT, FONT_BODY, addMenuBackground, addHeader, addLabel, addButton, addPanel } from "../ui/theme.js";
import { safeInsetsDesign } from "../systems/safearea.js";

// Account page (user 2026-06-10): the account/security home reached from the top-right
// account dropdown. Distinct from the PROFILE page (avatar + stats + match history) — this
// is about the ACCOUNT itself: how you signed in (linked providers), email on file, the
// character count, manage-characters + sign-out. Username editing lives on the profile page.
export default function accountScene(k) {
  k.scene("account", (args = {}) => {
    addMenuBackground(k);
    const cx = k.width() / 2;
    const ins = safeInsetsDesign(k);
    const backScene = args.backScene || "characterSelect";
    const backArgs = args.backArgs;
    const profile = getProfile();
    const authed = !!(profile && !profile.isGuest);
    const session = getAccountSession();

    addHeader(k, { x: cx, y: 50 + ins.top, text: "ACCOUNT", size: 34 });
    addButton(k, { x: 70 + ins.left, y: 40 + ins.top, w: 96, h: 36, text: "< Back", size: 16,
      fill: THEME.surfaceAlt, textColor: THEME.text, onClick: () => k.go(backScene, backArgs) });
    if (authed) {
      addButton(k, { x: k.width() - 76 - ins.right, y: 40 + ins.top, w: 108, h: 36, text: "Sign out", size: 15,
        fill: THEME.surfaceAlt, textColor: THEME.danger,
        onClick: () => { try { net.clearSession(); } catch { /* none */ } clearProfile(); k.go("start"); } });
    }

    // Guests can't have an account — invite them to log in.
    if (!authed) {
      const colW = Math.min(440, k.width() - 64);
      addPanel(k, { x: cx, y: 240, w: colW, h: 150, radius: 16 });
      addLabel(k, { x: cx, y: 206, text: "No account", size: 22, color: THEME.text });
      addLabel(k, { x: cx, y: 240, text: "You're playing as a guest — progress isn't saved.\nLog in to keep your tamers across devices.",
        size: 14, color: THEME.textMut, font: FONT_BODY, width: colW - 40, align: "center" });
      addButton(k, { x: cx, y: 290, w: 200, h: 44, text: "Log in", size: 17,
        fill: THEME.primary, textColor: THEME.textInv, onClick: () => k.go("start") });
      return;
    }

    // Delete-account confirm is a RE-RENDERED state (not a floating overlay): this scene has no
    // modal/z gating, so an overlay would bleed clicks through to the buttons beneath it. Toggling
    // `confirming` and re-rendering keeps everything in the single acUI layer. (TQ-11)
    let confirming = false, delErr = "";

    function render(data) {
      k.destroyAll("acUI");
      const colW = Math.min(520, k.width() - 64);
      const left = cx - colW / 2;
      const label = (x, y, text, size, color, font = FONT, anchor = "center") =>
        k.add([k.text(text, { size, font }), k.pos(x, y), k.anchor(anchor), k.color(...color), "acUI"]);

      // ── Identity panel: who you are + email status ──
      addPanel(k, { x: cx, y: 150, w: colW, h: 96, radius: 16, tag: "acUI" });
      label(left + 20, 122, "SIGNED IN AS", 13, THEME.teal, FONT, "left");
      // Cap the displayed name so a long account nickname (up to 24 chars) can't overflow the panel
      // and collide with the right-anchored email-status on a narrow screen (the panel shrinks to
      // width-64). No-op for short names / wide layouts (≈25 chars fit at the full 520px width).
      const maxName = Math.max(8, Math.floor((colW - 165) / 14)); // leave room for L/R margins + status pill
      const dispName = data.name && data.name.length > maxName ? data.name.slice(0, maxName - 1) + "…" : data.name || "Tamer";
      label(left + 20, 152, dispName, 26, THEME.text, FONT, "left");
      label(left + colW - 20, 152, data.hasEmail ? "Email on file" : "No email on file",
        13, THEME.textMut, FONT_BODY, "right");

      // ── Linked sign-in methods ──
      const methods = [
        { key: "google", name: "Google" },
        { key: "discord", name: "Discord" },
        { key: "password", name: "Email & password" },
      ];
      const ph = methods.length * 44 + 44;
      addPanel(k, { x: cx, y: 248 + ph / 2, w: colW, h: ph, radius: 16, tag: "acUI" });
      label(left + 20, 268, "SIGN-IN METHODS", 13, THEME.teal, FONT, "left");
      methods.forEach((m, i) => {
        const y = 300 + i * 44;
        const linked = !!(data.providers && data.providers[m.key]);
        label(left + 20, y, m.name, 17, linked ? THEME.text : THEME.textMut, FONT, "left");
        label(left + colW - 20, y, linked ? "Linked" : "Not linked",
          14, linked ? THEME.success : THEME.textMut, FONT, "right");
      });

      // ── Actions ──
      const aTop = 248 + ph + 28;
      const nChars = (data.characters || []).length;
      addButton(k, { x: cx, y: aTop, w: 300, h: 46, text: `Manage characters  (${nChars}/5)`, size: 16,
        fill: THEME.surface, textColor: THEME.text, tag: "acUI", onClick: () => k.go("characterSelect") });
      addButton(k, { x: cx, y: aTop + 56, w: 300, h: 46, text: "View profile & stats", size: 16,
        fill: THEME.surface, textColor: THEME.teal, tag: "acUI",
        onClick: () => k.go("profile", { backScene: "account", backArgs: args }) });

      // ── Danger zone: permanently delete the account (right to be forgotten, TQ-11) ──
      const dTop = aTop + 124;
      if (!confirming) {
        addButton(k, { x: cx, y: dTop, w: 300, h: 44, text: "Delete account", size: 15,
          fill: THEME.surfaceAlt, textColor: THEME.danger, tag: "acUI",
          onClick: () => { confirming = true; delErr = ""; render(data); } });
      } else {
        const cw = Math.min(440, k.width() - 64);
        addPanel(k, { x: cx, y: dTop + 36, w: cw, h: 150, radius: 14, tag: "acUI" });
        label(cx, dTop - 6, "Delete account permanently?", 18, THEME.danger);
        addLabel(k, { x: cx, y: dTop + 22, text: "This erases your account, all tamers and their match history. This can't be undone.",
          size: 13, color: THEME.textMut, font: FONT_BODY, width: cw - 40, align: "center", tag: "acUI" });
        if (delErr) label(cx, dTop + 52, delErr, 13, THEME.warn, FONT_BODY);
        const doDelete = async () => {
          if (!session) return;
          delErr = "Deleting…"; render(data);
          try {
            const r = await fetch("/account/delete", { method: "POST", headers: { "x-account-session": session } });
            if (r.ok) { try { net.clearSession(); } catch { /* none */ } clearProfile(); k.go("start"); return; }
            delErr = "Couldn't delete — please try again.";
          } catch { delErr = "Network error — please try again."; }
          render(data);
        };
        addButton(k, { x: cx - 86, y: dTop + 78, w: 156, h: 42, text: "Delete forever", size: 15,
          fill: THEME.danger, textColor: THEME.textInv, tag: "acUI", onClick: doDelete });
        addButton(k, { x: cx + 90, y: dTop + 78, w: 128, h: 42, text: "Cancel", size: 15,
          fill: THEME.surfaceAlt, textColor: THEME.text, tag: "acUI", onClick: () => { confirming = false; delErr = ""; render(data); } });
      }
    }

    // Optimistic local render, then refresh from the server.
    render({
      name: getAccountNickname() || (profile && profile.nickname) || "Tamer",
      providers: null, hasEmail: false, characters: getCharacters(),
    });
    if (session) {
      fetch("/account/me", { headers: { "x-account-session": session } })
        .then((r) => (r.status === 401 ? null : r.ok ? r.json() : null))
        .then((d) => { if (d && d.account) render({
          name: d.account.nickname || "Tamer",
          providers: d.account.providers || null,
          hasEmail: !!d.account.hasEmail,
          characters: d.account.characters || [],
        }); })
        .catch(() => { /* offline — keep the local render */ });
    }
  });
}
