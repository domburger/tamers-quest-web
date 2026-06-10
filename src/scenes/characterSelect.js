import { getCharacters, createCharacter, deleteCharacter, getProfile } from "../storage.js";
import { getMonsterStats as getStatsAtLevel } from "../engine/stats.js";
import { getMonsterType } from "../engine/gamedata.js";
import { THEME, PAL, FONT, FONT_BODY, addMenuBackground, addHeader, addLabel, addButton, addPanel } from "../ui/theme.js";
import { sfx } from "../systems/audio.js"; // click on character-select (raw card, not addButton)
import { safeInsetsDesign } from "../systems/safearea.js"; // MOB: keep edge controls off notches/home bar
import { drawCharacter } from "../render/character.js"; // empty-state tamer: vector, FACES the player (was a back-facing static sprite)
import { getEquippedCharacterSkin } from "../render/characterCosmetics.js"; // same account cosmetic the lobby shows

// Screen 2 of the flow (FLOW spec): pick one of your characters → lobby (PT1-T02
// visual upgrade, coordinated with the unified lobby PT1-T04/T05). Themed cards
// with a team-preview strip so each slot reads at a glance, matching the lobby.
export default function characterSelectScene(k) {
  k.scene("characterSelect", () => {
    addMenuBackground(k);
    const cx = k.width() / 2;
    const ins = safeInsetsDesign(k); // notch/home-bar margins (design units) for edge controls

    // Empty-state tamer (drawn below). The SAME vector character as the lobby — crisp at any size
    // and FACING the player (dir {0,1}); the old k.sprite("player") here showed the back of the
    // hood, cut off. One scene-level onDraw gated on the flag so it's not re-registered each
    // renderList() (immediate-mode draws can't carry the "charUI" tag that destroyAll reaps).
    const skin = getEquippedCharacterSkin();
    let showEmptyAvatar = false;
    k.onDraw(() => {
      // onDraw is immediate-mode — it paints ABOVE every game object, so while the "Enter
      // character name" modal is up (opened from the same empty state) the avatar bled
      // through it, garbling the caption. Suppress it whenever that modal is active.
      if (!showEmptyAvatar || inputActive) return;
      // feet/ground point — the figure draws UPWARD from here, so it sits in the panel's upper
      // half, clear of the "No tamers yet" caption below (y 360+).
      drawCharacter(k, { x: cx, y: 300, t: k.time(), dir: { x: 0, y: 1 }, scale: 2.1, color: skin.accent, cloak: skin.cloak });
    });

    // Top-left Back button geometry (reused for the header below + the button itself).
    const backW = 96, backX = 70 + ins.left;
    // Narrow portrait: the centered title shrinks to its size-12 floor (~115px wide for
    // "SELECT CHARACTER"), which is wider than the reserved corner clearance — so its left
    // edge slid UNDER the Back button (worse with a notch inset). Nudge the title (and its
    // rule) right just enough to clear the button; wide layouts keep it at true centre.
    const headerX = k.width() < 560 ? Math.max(cx, backX + backW / 2 + 64) : cx;
    addHeader(k, { x: headerX, y: 50, text: "SELECT CHARACTER", size: 34 });

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
      showEmptyAvatar = characters.length === 0; // gate the vector tamer drawn in the scene onDraw

      if (characters.length === 0) {
        // Inviting empty state — the player avatar (vector, drawn in the scene onDraw above) + a
        // welcome line fill what was an empty void when no tamers exist yet.
        addPanel(k, { x: cx, y: 312, w: cardW, h: 236, radius: 18, tag: "charUI" });
        cl(cx, 372, "No tamers yet", 22, THEME.text);
        cl(cx, 402, "Create your first tamer to enter the caves.", 14, THEME.textMut);
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
      cl(left + 22, y + 14, `Lv ${char.level}     ${monsters.length} monster${monsters.length === 1 ? "" : "s"}`, 14, THEME.textMut, "left");
      // Per-character lifetime record (P8-T1) — each save now tracks its own stats, so
      // the slot reads as a distinct identity/history, not just a name + level.
      const cs = char.stats || {};
      if (cs.runs || cs.extractions || cs.caught) {
        cl(left + 22, y + 33, `Caught ${cs.caught || 0}     Escaped ${cs.extractions || 0}     Runs ${cs.runs || 0}`, 11, THEME.textBody, "left");
      }

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
    addButton(k, { x: cx, y: k.height() - 64 - ins.bottom, w: 260, h: 50,
      text: full ? "All slots full" : "+ New Character", size: 19,
      fill: full ? THEME.surfaceAlt : THEME.success, textColor: full ? THEME.textMut : THEME.textInv,
      disabled: full, onClick: () => showNameInput() });

    // Back to title (top-left).
    addButton(k, { x: backX, y: 40 + ins.top, w: backW, h: 36, text: "< Back", size: 16,
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
      // createCharacter now rolls the starter team itself (shared rollStarters) —
      // no inline duplicate of the roll here anymore.
      createCharacter(name);
      k.destroyAll("nameInput");
      renderList();
    }
  });
}
