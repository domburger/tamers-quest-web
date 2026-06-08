import { getCharacters, createCharacter, deleteCharacter, saveCharacter, getProfile } from "../storage.js";
import { getMonsterTypes, getMonsterStats } from "../data.js";
import { getMonsterStats as getStatsAtLevel } from "../engine/stats.js";
import { getMonsterType } from "../engine/gamedata.js";
import { uid } from "../uid.js";
import { THEME, PAL, FONT, FONT_BODY, addMenuBackground, addHeader, addLabel, addButton, addPanel } from "../ui/theme.js";
import { sfx } from "../systems/audio.js"; // click on character-select (raw card, not addButton)

// Screen 2 of the flow (FLOW spec): pick one of your characters → lobby (PT1-T02
// visual upgrade, coordinated with the unified lobby PT1-T04/T05). Themed cards
// with a team-preview strip so each slot reads at a glance, matching the lobby.
export default function characterSelectScene(k) {
  k.scene("characterSelect", () => {
    addMenuBackground(k);
    const cx = k.width() / 2;

    addHeader(k, { x: cx, y: 50, text: "SELECT CHARACTER", size: 34 });

    // FLOW screen 1 identity: show the guest tag + nickname when the title routed
    // here via "Play as guest" (profile.isGuest). Characters created now inherit it.
    const profile = getProfile();
    if (profile && profile.isGuest) {
      addLabel(k, { x: cx, y: 86, text: `Playing as guest — ${profile.nickname || "Guest"}`, size: 15, color: THEME.textMut });
    } else if (profile) {
      // AUTH (#10): signed-in account — mirror the guest tag so a successful login is
      // confirmed in the UI (OAuth returns no nickname → just "Signed in"). The login
      // buttons now wire to the live backends (AUTH-T1); this closes the identity gap
      // where logged-in users saw no confirmation. FLOW-identity parity.
      addLabel(k, { x: cx, y: 86, text: profile.nickname ? `Signed in as ${profile.nickname}` : "Signed in", size: 15, color: THEME.textMut });
    }

    let characters = getCharacters();
    const listY = 138;
    const cardH = 92;
    const cardW = Math.min(580, k.width() - 80);
    const step = cardH + 12;
    const maxSlots = 5;

    // Tagged label so destroyAll("charUI") reaps it on re-render (addLabel/addPanel
    // are untagged, so using them inside renderList would leak across re-renders).
    function cl(x, y, text, size, color, anchor = "center") {
      k.add([k.text(text, { size, font: FONT }), k.pos(x, y), k.anchor(anchor), k.color(...color), "charUI"]);
    }

    function renderList() {
      k.destroyAll("charUI");
      characters = getCharacters();

      if (characters.length === 0) {
        // Inviting empty state — the player avatar + a welcome line fill what was
        // an empty void when no tamers exist yet.
        addPanel(k, { x: cx, y: 312, w: cardW, h: 236, radius: 18, tag: "charUI" });
        try {
          k.add([k.sprite("player"), k.pos(cx, 262), k.anchor("center"), k.scale(2.4), "charUI"]);
        } catch { /* sprite not ready */ }
        cl(cx, 360, "No tamers yet", 22, THEME.text);
        cl(cx, 390, "Create your first tamer to enter the caves.", 14, THEME.textMut);
        return;
      }

      characters.slice(0, maxSlots).forEach((char, i) => drawCard(char, listY + i * step));
    }

    function drawCard(char, y) {
      const monsters = char.activeMonsters || [];
      const left = cx - cardW / 2;

      // Card shadow + body (interactive: the whole card is the "enter" hit target).
      k.add([k.rect(cardW, cardH, { radius: 14 }), k.pos(cx, y + 4), k.anchor("center"),
        k.color(0, 0, 0), k.opacity(0.35), "charUI"]);
      const card = k.add([k.rect(cardW, cardH, { radius: 14 }), k.pos(cx, y), k.anchor("center"),
        k.color(...THEME.surface), k.outline(2, k.rgb(...THEME.line)), k.area(), "charUI"]);
      card.onClick(() => { sfx("click"); k.go("lobby", { characterId: char.id }); });
      card.onHover(() => k.setCursor("pointer"));
      card.onHoverUpdate(() => { card.color = k.rgb(...THEME.surfaceAlt); });
      card.onHoverEnd(() => { card.color = k.rgb(...THEME.surface); });

      // Identity (left): name + guest tag, then level / team count.
      cl(left + 22, y - 16, char.name, 21, THEME.text, "left");
      // Clamp the tag x so a long name can't shove "guest" into the team-preview
      // strip on the right (watchdog iter-299) — keep it in the left identity column.
      if (char.isGuest) cl(Math.min(left + 24 + char.name.length * 11, left + cardW * 0.4), y - 15, "guest", 12, THEME.violet, "left");
      cl(left + 22, y + 16, `Lv ${char.level}     ${monsters.length} monster${monsters.length === 1 ? "" : "s"}`, 14, THEME.textMut, "left");

      // Team-preview thumbnails (right side) — small sprites + HP pips so the
      // roster reads at a glance, mirroring the lobby's team strip.
      const slot = 56;
      const delX = cx + cardW / 2 - 32;
      const stripRight = delX - 34;
      const startX = stripRight - (Math.max(0, Math.min(4, monsters.length) - 1)) * slot;
      monsters.slice(0, 4).forEach((mon, j) => {
        const mx = startX + j * slot;
        k.add([k.rect(46, 46, { radius: 10 }), k.pos(mx, y - 4), k.anchor("center"), k.color(...THEME.bgAlt), "charUI"]);
        const spriteName = mon.typeName.toLowerCase().replace(/\s+/g, "_");
        try {
          k.add([k.sprite(spriteName), k.pos(mx, y - 6), k.anchor("center"), k.scale(0.26), "charUI"]);
        } catch { /* sprite not ready */ }
        // HP pip
        let maxHp = mon.currentHealth;
        try { maxHp = getStatsAtLevel(getMonsterType(mon.typeName), mon.level).health; } catch {}
        const frac = maxHp > 0 ? Math.max(0, Math.min(1, (mon.currentHealth ?? maxHp) / maxHp)) : 1;
        const barC = frac > 0.5 ? THEME.success : frac > 0.25 ? THEME.warn : THEME.danger;
        k.add([k.rect(38, 3, { radius: 1.5 }), k.pos(mx - 19, y + 20), k.anchor("topleft"), k.color(...THEME.line), "charUI"]);
        if (frac > 0) k.add([k.rect(38 * frac, 3, { radius: 1.5 }), k.pos(mx - 19, y + 20), k.anchor("topleft"), k.color(...barC), "charUI"]);
      });

      // Delete (far right) — a small danger button.
      const del = k.add([k.rect(30, 30, { radius: 8 }), k.pos(delX, y), k.anchor("center"),
        k.color(...THEME.surfaceAlt), k.area(), "charUI"]);
      const delGlyph = k.add([k.text("X", { size: 15, font: FONT }), k.pos(delX, y), k.anchor("center"), k.color(...THEME.danger), "charUI"]);
      del.onHover(() => k.setCursor("pointer"));
      // On hover the button bg fills with danger red — flip the X to white so it
      // doesn't blend into the same-colour fill (watchdog iter-299).
      del.onHoverUpdate(() => { del.color = k.rgb(...THEME.danger); delGlyph.color = k.rgb(...THEME.textInv); });
      del.onHoverEnd(() => { del.color = k.rgb(...THEME.surfaceAlt); delGlyph.color = k.rgb(...THEME.danger); });
      del.onClick(() => showDeleteConfirm(char));
    }

    renderList();

    // + New Character (themed CTA) — note when slots are full.
    const full = getCharacters().length >= maxSlots;
    addButton(k, { x: cx, y: k.height() - 64, w: 260, h: 50,
      text: full ? "All slots full" : "+ New Character", size: 19,
      fill: full ? THEME.surfaceAlt : THEME.success, textColor: full ? THEME.textMut : THEME.textInv,
      disabled: full, onClick: () => showNameInput() });

    // Back to title (top-left).
    addButton(k, { x: 70, y: 40, w: 96, h: 36, text: "< Back", size: 16,
      fill: THEME.surface, textColor: THEME.textMut, onClick: () => k.go("start") });

    function showDeleteConfirm(char) {
      k.destroyAll("deleteConfirm");
      k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(0, 0, 0), k.opacity(0.72), "deleteConfirm"]);
      const my = k.height() / 2;
      addPanel(k, { x: cx, y: my, w: 360, h: 200, radius: 16, tag: "deleteConfirm" });
      addLabel(k, { x: cx, y: my - 56, text: `Delete "${char.name}"?`, size: 22, color: THEME.text, tag: "deleteConfirm" });
      addLabel(k, { x: cx, y: my - 26, text: "This cannot be undone.", size: 14, color: THEME.textMut, font: FONT_BODY, tag: "deleteConfirm" });
      addButton(k, { x: cx - 80, y: my + 36, w: 140, h: 44, text: "Delete", size: 17,
        fill: THEME.danger, textColor: THEME.textInv, tag: "deleteConfirm",
        onClick: () => { deleteCharacter(char.id); k.destroyAll("deleteConfirm"); renderList(); } });
      addButton(k, { x: cx + 80, y: my + 36, w: 140, h: 44, text: "Cancel", size: 17,
        fill: THEME.surface, textColor: THEME.text, tag: "deleteConfirm",
        onClick: () => k.destroyAll("deleteConfirm") });
    }

    let inputActive = false;
    let inputHandlers = [];

    function showNameInput() {
      if (inputActive) return;
      if (getCharacters().length >= maxSlots) return;
      inputActive = true;
      k.destroyAll("nameInput");

      k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(0, 0, 0), k.opacity(0.72), "nameInput"]);
      addPanel(k, { x: cx, y: k.height() / 2 - 5, w: 380, h: 190, radius: 16, tag: "nameInput" });
      addLabel(k, { x: cx, y: k.height() / 2 - 60, text: "Enter character name:", size: 22, color: THEME.text, tag: "nameInput" });
      addLabel(k, { x: cx, y: k.height() / 2 + 50, text: "ENTER to confirm, ESC to cancel", size: 13, color: THEME.textMut, font: FONT_BODY, tag: "nameInput" });

      // PT1-T03: a REAL DOM <input> (not a canvas onCharInput capture) so the MOBILE
      // soft keyboard opens — tapping the visible field focuses it natively (iOS only
      // opens the keyboard on an in-gesture focus); auto-focus covers desktop. Mirrors
      // the lobby nickname field.
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Character name";
      input.maxLength = 20;
      Object.assign(input.style, {
        position: "fixed", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
        zIndex: "1000", width: "min(70vw, 320px)", padding: "12px 14px", fontSize: "20px",
        textAlign: "center", color: PAL.text, background: PAL.surface,
        border: `2px solid ${PAL.line}`, borderRadius: "8px", outline: "none", fontFamily: "inherit",
      });
      document.body.appendChild(input);
      setTimeout(() => input.focus(), 50); // desktop convenience; on iOS the user taps it

      const close = () => {
        inputActive = false;
        input.remove();
        inputHandlers.forEach((h) => h.cancel());
        inputHandlers = [];
        k.destroyAll("nameInput");
      };
      const submit = () => { const v = (input.value || "").trim(); if (!v) return; close(); confirmCharacter(v); };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); submit(); }
        else if (e.key === "Escape") { e.preventDefault(); close(); }
      });

      inputHandlers.forEach((h) => h.cancel());
      inputHandlers = [k.onKeyPress("escape", () => { if (inputActive) close(); })]; // Esc when canvas has focus
      k.onSceneLeave(() => input.remove()); // never leak the DOM input on navigation
    }

    function confirmCharacter(name) {
      const allMonsters = getMonsterTypes();
      const shuffled = [...allMonsters].sort(() => Math.random() - 0.5);
      const starters = [];
      for (let i = 0; i < Math.min(4, shuffled.length); i++) {
        const mt = shuffled[i];
        const stats = getMonsterStats(mt, 1);
        starters.push({
          id: uid(),
          typeName: mt.typeName,
          name: mt.typeName,
          level: 1,
          xp: 0,
          currentHealth: stats.health,
          currentEnergy: stats.energy,
          status: null,
        });
      }
      const char = createCharacter(name);
      char.activeMonsters = starters;
      saveCharacter(char);
      k.destroyAll("nameInput");
      renderList();
    }
  });
}
