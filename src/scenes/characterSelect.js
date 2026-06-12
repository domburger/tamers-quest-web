import { getCharacters, createCharacter, deleteCharacter, getProfile, clearProfile, getAccountSession, setServerCharacters } from "../storage.js";
import { net } from "../netClient.js"; // shared client — clearSession() on Sign out
import { getMonsterStats as getStatsAtLevel } from "../engine/stats.js";
import { getMonsterType } from "../engine/gamedata.js";
import { THEME, PAL, FONT, FONT_BODY, hpColor, lighten, addMenuBackground, addHeader, addLabel, addButton, addPanel } from "../ui/theme.js";
import { sfx } from "../systems/audio.js"; // click on character-select (raw card, not addButton)
import { safeInsetsDesign } from "../systems/safearea.js"; // MOB: keep edge controls off notches/home bar
import { drawCharacter } from "../render/character.js"; // empty-state tamer: vector, FACES the player (was a back-facing static sprite)
import { slugOf } from "../render/monster.js"; // canonical (null-safe, memoized) sprite-key derivation
import { getEquippedCharacterSkin } from "../render/characterCosmetics.js"; // same account cosmetic the lobby shows
import { prefersReducedMotion } from "../systems/a11y.js"; // freeze the welcome-avatar glow pulse under reduce-motion

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
    // Modal state. While the name-input OR delete-confirm modal is up, the scene's other clickable
    // elements (cards, delete X, nav buttons) sit UNDER the backdrop, but kaboom has no z-input
    // compositor — a plain backdrop doesn't block them (verified: adding area() to it does NOT absorb).
    // So gate every underlying onClick on modalUp() (the overlay-bleed pattern), else a tap beside the
    // dialog navigates into a character / away and silently discards the dialog.
    let inputActive = false, confirmOpen = false;
    const modalUp = () => inputActive || confirmOpen;
    const skin = getEquippedCharacterSkin();
    let showEmptyAvatar = false;
    // Selection model (user-requested): clicking a slot SELECTS it (it doesn't immediately enter);
    // the left-side preview shows the selected character + its stats, and a Confirm button enters
    // the world with it. selectedId defaults to the first slot (re-validated on every render).
    let selectedId = null;
    const selectedChar = () => characters.find((c) => c.id === selectedId) || characters[0] || null;
    const enterSelected = () => { const c = selectedChar(); if (modalUp() || !c) return; sfx("click"); k.go("hub", { characterId: c.id }); };
    k.onDraw(() => {
      // onDraw is immediate-mode — it paints ABOVE every game object, so while a modal (name
      // input / delete confirm) is up the avatar bled through it, garbling the dialog. Suppress
      // the whole avatar layer whenever a modal is active.
      if (modalUp()) return;
      const reduce = prefersReducedMotion();
      const clk = reduce ? 0 : k.time();
      // Soft spirit-glow halo behind the avatar — a gentle teal bloom (with a faint breathing
      // pulse, frozen under reduce-motion) that makes the figure feel alive and on-theme (the
      // spirit/portal motif), the same luminous teal as the title screen's hooded figure.
      const pulse = reduce ? 0.5 : 0.5 + 0.5 * Math.sin(k.time() * 1.6);
      if (showEmptyAvatar) {
        // Empty state: the welcome avatar centered on the SAME glowing podium as the populated
        // hero (consistent character-select language) above the "No tamers yet" caption — the
        // new-player first impression, so it gets the full podium treatment, not a bare panel.
        const ey = 300; // feet/ground point
        k.drawCircle({ pos: k.vec2(cx, ey - 42), radius: 100, color: k.rgb(...THEME.teal), opacity: 0.05 + 0.03 * pulse });
        k.drawCircle({ pos: k.vec2(cx, ey - 42), radius: 64, color: k.rgb(...THEME.teal), opacity: 0.06 + 0.04 * pulse });
        k.drawEllipse({ pos: k.vec2(cx, ey + 11), radiusX: 58, radiusY: 15, color: k.rgb(0, 0, 0), opacity: 0.45 });
        k.drawEllipse({ pos: k.vec2(cx, ey + 9), radiusX: 53, radiusY: 13, color: k.rgb(...THEME.teal), opacity: 0.10 + 0.05 * pulse });
        k.drawEllipse({ pos: k.vec2(cx, ey + 9), radiusX: 53, radiusY: 13, fill: false, outline: { width: 1.5, color: k.rgb(...THEME.teal) }, opacity: 0.55 });
        drawCharacter(k, { x: cx, y: ey, t: clk, dir: { x: 0, y: 1 }, scale: 2.4, color: skin.accent, cloak: skin.cloak, model: skin.model });
        return;
      }
      // Populated state: a HERO tamer standing in the empty left gutter (the centered ≤600px
      // roster leaves a wide side margin on desktop), lit by a spotlight + ground shadow. Turns
      // "a list of slots" into "you, standing with your tamers" — the A-level character-select
      // read. Skipped on narrow/portrait (stacked header, no side room) where it would overlap.
      if (!heroShown) return;
      const hx = heroX;     // centre of the gutter left of the (right-shifted) roster
      const hy = 312;       // feet/ground point (design space) — the selected char's stats panel +
                            // Confirm button stack below the figure, so it sits higher than centre.
      // Backlight bloom behind the figure — the spirit-portal glow. Stacked faint rings (large→small)
      // give a smooth radial falloff (a clean spotlight) rather than the muddy hard-edged disc two
      // circles produced. Breathes gently with the pulse, frozen under reduce-motion.
      for (let i = 7; i >= 1; i--) {
        k.drawCircle({ pos: k.vec2(hx, hy - 72), radius: i * 15, color: k.rgb(...THEME.teal), opacity: 0.012 + 0.004 * pulse });
      }
      // Podium — a glowing disc (contact shadow + soft fill + crisp rim) the figure stands on, like
      // a character-select pedestal. Grounds it instead of floating it in the void.
      k.drawEllipse({ pos: k.vec2(hx, hy + 12), radiusX: 56, radiusY: 15, color: k.rgb(0, 0, 0), opacity: 0.45 });
      k.drawEllipse({ pos: k.vec2(hx, hy + 10), radiusX: 51, radiusY: 13, color: k.rgb(...THEME.teal), opacity: 0.10 + 0.05 * pulse });
      k.drawEllipse({ pos: k.vec2(hx, hy + 10), radiusX: 51, radiusY: 13, fill: false, outline: { width: 1.5, color: k.rgb(...THEME.teal) }, opacity: 0.55 });
      drawCharacter(k, { x: hx, y: hy, t: clk, dir: { x: 0, y: 1 }, scale: 3.0, color: skin.accent, cloak: skin.cloak, model: skin.model });
      // Nameplate = the SELECTED character — the left preview reflects the highlighted slot.
      const sel = selectedChar();
      const heroName = ((sel && sel.name) || (profile && profile.nickname) || "Tamer").slice(0, 18);
      k.drawText({ text: "TAMER", pos: k.vec2(hx, hy + 34), size: 11, font: FONT, anchor: "center", color: k.rgb(...THEME.teal), opacity: 0.85 });
      k.drawText({ text: heroName, pos: k.vec2(hx, hy + 52), size: 20, font: FONT, anchor: "center", color: k.rgb(...THEME.text) });
    });

    // Top-left Back button geometry (reused for the header below + the button itself).
    const backW = 96, backX = 70 + ins.left;
    // Below ~680px the centered title can't clear BOTH top-corner buttons (Back on the left,
    // Log in / Sign out on the right) — it collided with the right one (the old right-nudge
    // only dodged the Back button, before the account button existed). So on narrow screens
    // the title drops to its OWN row below the corner buttons (full width); wide keeps it inline.
    const stackHeader = k.width() < 680;
    const headerY = stackHeader ? 96 : 50;
    addHeader(k, { x: cx, y: headerY, text: "SELECT CHARACTER", size: 34 });

    // FLOW screen 1 identity + a real account control (top-right). Signed-in users get a
    // clear indicator + Sign out; guests get a "Log in" shortcut back to the title (and a
    // note that guest progress isn't saved). Previously there was only a weak "Signed in"
    // label and NO way to sign out at all.
    const profile = getProfile();
    const authed = !!(profile && !profile.isGuest);
    // Identity lines sit just under the header (which moves down when stacked on narrow).
    const idY = headerY + 42;
    if (profile && profile.isGuest) {
      addLabel(k, { x: cx, y: idY, text: `Playing as guest — ${profile.nickname || "Guest"}`, size: 15, color: THEME.textMut });
      // Soft "save your progress" notice as an intentional CHIP (subtle surface pill + a warm accent
      // dot) rather than a loose line of warning text — reads as a designed component, not an error.
      const warnTxt = "Guest progress isn't saved — log in to keep your tamers";
      const pillW = Math.min(k.width() - 40, warnTxt.length * 6.0 + 54);
      const pillY = idY + 24;
      k.add([k.rect(pillW, 26, { radius: 13 }), k.pos(cx, pillY), k.anchor("center"), k.color(...THEME.surface), k.outline(1, k.rgb(...THEME.line)), k.opacity(0.92)]);
      k.add([k.circle(3), k.pos(cx - pillW / 2 + 18, pillY), k.anchor("center"), k.color(...THEME.warn)]);
      addLabel(k, { x: cx + 10, y: pillY, text: warnTxt, size: 12, color: THEME.warn, font: FONT_BODY });
    } else if (authed) {
      // Login indicator: a clickable identity chip (who you're signed in as) that opens the
      // profile page (avatar, player data, match history). Doubles as the indicator + entry point.
      const nm = profile.nickname || "Signed in";
      const chipW = Math.min(k.width() - 120, Math.max(190, nm.length * 11 + 130));
      addButton(k, { x: cx, y: idY + 12, w: chipW, h: 34, text: `${nm}    View profile >`, size: 14,
        fill: THEME.surface, textColor: THEME.teal, onClick: () => { if (modalUp()) return; k.go("profile"); } });
    }
    // Top-right account action (mirrors the top-left Back), respecting a right notch inset.
    const acctX = k.width() - 76 - ins.right;
    if (authed) {
      addButton(k, { x: acctX, y: 40 + ins.top, w: 108, h: 36, text: "Sign out", size: 15,
        fill: THEME.surfaceAlt, textColor: THEME.danger,
        onClick: () => { if (modalUp()) return; try { net.clearSession(); } catch { /* no session */ } clearProfile(); k.go("start"); } });
    } else if (profile && profile.isGuest) {
      addButton(k, { x: acctX, y: 40 + ins.top, w: 108, h: 36, text: "Log in", size: 15,
        fill: THEME.surface, textColor: THEME.teal, onClick: () => { if (modalUp()) return; k.go("start"); } });
    }

    let characters = getCharacters();
    // First-card CENTRE. Pushed down enough that a FULL roster (yOffset→0) keeps its "YOUR TAMERS"
    // caption + pips (which sit ~30px above the first card) clear of the header/identity/guest-notice
    // stack above — a tall 5-slot list used to ride up and collide with the notice chip. Few-card
    // lists are centred anyway, so this only lowers the dense case (which is what we want).
    const listY = stackHeader ? 282 : 214;
    const cardW = Math.min(600, k.width() - 72);
    // Split layout: on wide desktop, once the player HAS tamers, the hero figure stands in the left
    // gutter and the roster shifts RIGHT of centre — hero owns the left third, the card list the
    // right two-thirds — instead of a dead-centre card with an empty right gutter. Recomputed in
    // renderList (a server sync can flip empty↔populated): the EMPTY state and narrow/portrait both
    // stay centred (rosterCx === cx, no hero), so the New-Character CTA never drifts off-centre.
    let heroShown = false, rosterCx = cx, heroX = 0;
    function layoutFor(count) {
      heroShown = !stackHeader && count > 0 && (k.width() - cardW) / 2 >= 232;
      rosterCx = heroShown ? Math.round((3 * k.width() - cardW) / 4) : cx;
      heroX = heroShown ? Math.round((rosterCx - cardW / 2) / 2) : 0; // centre of the gutter left of the roster
    }
    // On narrow screens the right-side team-preview strip (4×56px) collided with the left-side
    // name/level text, so reflow: stack the strip BELOW the identity on a taller card.
    const narrowCard = cardW < 500;
    const maxSlots = 5;
    const fullH = narrowCard ? 150 : 100;
    // Card height / step / compact are sized to the slot count in renderList (recomputed there
    // because a server sync can change the count) — see fitCards().
    let cardH = fullH, step = fullH + 12, compact = false;
    // Fit ALL slots in the band from the list top to the New Character button. Design height is a
    // FIXED 720, so the tall narrow cards (150px, strip stacked below) ran off the bottom + under
    // the button with 4–5 characters on a phone, stranding slots off-screen. Keep the full card
    // (with the team-thumb strip) while it fits; else shrink to a compact name+level row (no strip)
    // so every slot stays on-screen + selectable.
    function fitCards(n) {
      const nSlots = Math.max(1, Math.min(maxSlots, n || 1));
      const btnTop = k.height() - 64 - ins.bottom - 25; // New Character button top edge
      const avail = btnTop - listY;                     // first card CENTRE → button top
      if ((nSlots - 1) * (fullH + 12) + fullH / 2 <= avail) { cardH = fullH; step = fullH + 12; }
      else {
        const gap = 10; // solve (n-1)(cardH+gap) + cardH/2 = avail for cardH
        cardH = Math.max(54, Math.min(fullH, (avail - (nSlots - 1) * gap) / (nSlots - 0.5)));
        step = cardH + gap;
      }
      compact = cardH < (narrowCard ? 132 : 82); // too short for the stacked team strip
    }

    // Tagged label so destroyAll("charUI") reaps it on re-render (addLabel/addPanel
    // are untagged, so using them inside renderList would leak across re-renders).
    function cl(x, y, text, size, color, anchor = "center") {
      k.add([k.text(text, { size, font: FONT }), k.pos(x, y), k.anchor(anchor), k.color(...color), "charUI"]);
    }

    function renderList() {
      k.destroyAll("charUI");
      characters = getCharacters();
      if (!characters.some((c) => c.id === selectedId)) selectedId = characters[0] ? characters[0].id : null; // keep a valid selection
      fitCards(characters.length); // size cards to the slot count so all stay on-screen
      layoutFor(characters.length); // empty → centred; populated wide → hero left + roster shifted right
      showEmptyAvatar = characters.length === 0; // gate the vector tamer drawn in the scene onDraw

      if (characters.length === 0) {
        // Inviting empty state — the welcome avatar stands on its podium (drawn in the scene onDraw
        // above); the caption sits below it, leading the eye down to the "+ New Character" CTA. No
        // big framing panel: the podium + figure ARE the focal point (matches the populated hero).
        cl(cx, 376, "No tamers yet", 24, THEME.text);
        cl(cx, 404, "Create your first tamer to brave the caves.", 14, THEME.textMut);
      } else {
        // Vertically center the card block in the band between the identity lines and the
        // New Character button, so 1–2 characters sit in the middle of the screen instead of
        // floating at the top above a large void (balanced layout, not a stranded card).
        const btnTop = k.height() - 64 - ins.bottom - 25;
        const yOffset = Math.max(0, (btnTop - listY - (characters.length - 1) * step - cardH / 2) / 2);
        const blockCY = listY + yOffset + (characters.length - 1) * step / 2; // vertical centre of the slot block
        // Portal-stage glow behind the roster — echoes the title screen's central teal bloom so the
        // slots read as a lit stage in the same luminous world, not a barren void. Stacked faint
        // discs approximate a soft radial falloff (no gradient draw in the shim). Behind the cards.
        for (let i = 11; i >= 1; i--) {
          k.add([k.circle(i * 34), k.pos(rosterCx, blockCY), k.anchor("center"), k.color(...THEME.teal), k.opacity(0.01), "charUI"]);
        }
        // Section label + capacity pips above the slots — anchors the list (so a single card no
        // longer floats in a void) and shows roster capacity at a glance: used slots a filled teal
        // dot, free slots a dim hollow one (the "you have N of 5 tamers" read every polished roster
        // gives). Sits clear ABOVE the first card's top edge (cardCenter − cardH/2).
        const capY = listY + yOffset - cardH / 2 - 32;
        cl(rosterCx, capY, "YOUR TAMERS", 13, THEME.teal);
        const pipY = capY + 18;
        for (let i = 0; i < maxSlots; i++) {
          const pxp = rosterCx + (i - (maxSlots - 1) / 2) * 16;
          const filled = i < characters.length;
          k.add([k.circle(filled ? 4 : 3.2), k.pos(pxp, pipY), k.anchor("center"),
            k.color(...(filled ? THEME.teal : THEME.line)), k.opacity(filled ? 1 : 0.7), "charUI"]);
        }
        characters.slice(0, maxSlots).forEach((char, i) => drawCard(char, listY + yOffset + i * step));

        // Left-column PREVIEW (wide only): the selected character's stats under the hero figure
        // (drawn in the scene onDraw), then a Confirm button to enter the world with that character.
        if (heroShown) {
          const sc = selectedChar();
          const sw = 224, shY = 452;
          addPanel(k, { x: heroX, y: shY, w: sw, h: 132, radius: 14, tag: "charUI" });
          const st = sc.stats || {};
          const rows = [
            ["LEVEL", `${sc.level || 1}`],
            ["GOLD", `${sc.gold || 0}`],
            ["MONSTERS", `${(sc.activeMonsters || []).length}`],
            ["CAUGHT", `${st.caught || 0}`],
            ["RUNS", `${st.runs || 0}`],
          ];
          rows.forEach((r, i) => {
            const ry = shY - 50 + i * 25;
            k.add([k.text(r[0], { size: 11, font: FONT_BODY }), k.pos(heroX - sw / 2 + 18, ry), k.anchor("left"), k.color(...THEME.textMut), "charUI"]);
            k.add([k.text(r[1], { size: 14, font: FONT }), k.pos(heroX + sw / 2 - 18, ry), k.anchor("right"), k.color(...THEME.text), "charUI"]);
          });
          // Hairline between the current-state stats (Level/Gold/Monsters) and the lifetime record
          // (Caught/Runs) — gives the profile panel clear structure instead of one flat list.
          k.add([k.rect(sw - 36, 1, { radius: 0.5 }), k.pos(heroX, shY - 50 + 2.5 * 25), k.anchor("center"), k.color(...THEME.line), k.opacity(0.7), "charUI"]);
          addButton(k, { x: heroX, y: 564, w: sw, h: 48, text: "Enter the Caves", size: 17, tag: "charUI",
            fill: THEME.primary, textColor: THEME.textInv, onClick: enterSelected });
        }
      }
      drawBottomActions(); // re-render the bottom action row (tracks the server-synced slot count)
    }

    // Bottom action row — re-rendered with the list (a server sync can change the slot count).
    //  • Wide (hero shown): Confirm lives in the left preview column, so here we only place the
    //    secondary "+ New Character" under the roster.
    //  • Narrow with tamers: Confirm (primary) + New Character (secondary) side by side.
    //  • Empty: just the New Character CTA (the primary action), centred.
    function drawBottomActions() {
      k.destroyAll("newBtn");
      const chars = getCharacters();
      const full = chars.length >= maxSlots;
      const btnY = k.height() - 64 - ins.bottom;
      const placeNew = (x, w, primary) => addButton(k, { x, y: btnY, w, h: 50, tag: "newBtn",
        text: full ? "All slots full" : "+ New Character", size: 19,
        fill: full ? THEME.surfaceAlt : (primary ? THEME.primary : THEME.surfaceAlt),
        textColor: full ? THEME.textMut : (primary ? THEME.textInv : THEME.text),
        disabled: full, onClick: () => { if (modalUp()) return; showNameInput(); } });

      if (heroShown) {
        placeNew(rosterCx, 260, false); // Confirm is in the left column; New Character is secondary here
      } else if (chars.length > 0) {
        const gap = 14, bw = Math.min(238, (Math.min(560, k.width() - 48) - gap) / 2);
        addButton(k, { x: cx - bw / 2 - gap / 2, y: btnY, w: bw, h: 50, text: "Enter the Caves", size: 17,
          tag: "newBtn", fill: THEME.primary, textColor: THEME.textInv, onClick: enterSelected });
        placeNew(cx + bw / 2 + gap / 2, bw, false);
      } else {
        placeNew(cx, 260, true); // empty state: New Character is the one primary action
      }
    }

    // Phase 2 cloud saves: when logged in, the character list comes from the SERVER (the account's
    // characters), mirrored into the local cache so the lobby join flow (character.serverToken) is
    // unchanged. Re-fetched on load + after create/delete. Guests fall through to the local list.
    // `allowEmpty` is true only for explicit user actions (create/delete) where an empty result is
    // trustworthy (e.g. deleting the last character). On a PASSIVE load/resume sync it's false: a
    // spurious empty 200 (a just-redeployed server whose flush hadn't landed, or a read-after-write
    // race) must NOT wipe a known-good non-empty local mirror — keep the cache, the next sync fixes it.
    async function syncServerCharacters({ allowEmpty = false } = {}) {
      const session = getAccountSession();
      if (!session) return;
      try {
        const r = await fetch("/account/characters", { headers: { "x-account-session": session } });
        if (r.status === 401) {
          // Session expired (e.g. the server was wiped/redeployed). Sign out cleanly → title,
          // rather than stranding the player on an empty list (the stay-logged-in resume path).
          try { net.clearSession(); } catch { /* none */ }
          clearProfile();
          k.go("start");
          return;
        }
        if (r.ok) {
          const incoming = (await r.json()).characters || [];
          if (!allowEmpty && incoming.length === 0 && getCharacters().length > 0) return; // guard a transient empty
          setServerCharacters(incoming);
          renderList();
        }
      } catch { /* offline — keep whatever's cached */ }
    }

    function drawCard(char, y) {
      const monsters = char.activeMonsters || [];
      const left = rosterCx - cardW / 2;
      const isSel = char.id === selectedId; // the highlighted slot (its preview shows on the left)

      // Soft persistent bloom behind the card — ties each slot to the same luminous accent world.
      // The SELECTED slot blooms brighter (an ember spotlight) so it clearly reads as picked.
      k.add([k.rect(cardW + 44, cardH + 38, { radius: 28 }), k.pos(rosterCx, y + 2), k.anchor("center"),
        k.color(...THEME.teal), k.opacity(isSel ? 0.14 : 0.05), "charUI"]);
      // Card hover-glow halo (behind the shadow). Selected rests at a soft glow; others at 0.
      const halo = k.add([k.rect(cardW + 16, cardH + 16, { radius: 20 }), k.pos(rosterCx, y), k.anchor("center"),
        k.color(...THEME.teal), k.opacity(isSel ? 0.12 : 0), "charUI"]);
      // Card body via the SHARED addPanel. The selected slot gets an ember (primary) border instead
      // of the neutral hairline, so the pick is unmistakable. `area:true` keeps it clickable.
      const card = addPanel(k, { x: rosterCx, y, w: cardW, h: cardH, radius: 14, tag: "charUI", area: true,
        fill: isSel ? THEME.surfaceAlt : THEME.surface, border: isSel ? THEME.primary : THEME.line });
      // Teal identity accent down the card's left edge — the title screen's signature colour,
      // and a clear "this is a tamer" marker that warms up the otherwise cold dark panel.
      k.add([k.rect(4, Math.max(20, cardH - 26), { radius: 2 }), k.pos(left + 13, y), k.anchor("center"),
        k.color(...THEME.teal), k.opacity(0.9), "charUI"]);

      // Wide layout: a teal-ringed portrait of the TAMER (the player character) gives each slot a
      // clear focal point — this is YOUR character, so it shows the tamer icon, not a team monster
      // (the team is already shown in the preview strip on the right). Skipped when narrow/compact.
      const portrait = !narrowCard && !compact && monsters.length > 0;
      const textX = portrait ? left + 108 : left + 22;
      if (portrait) {
        const px = left + 60, pr = 31;
        k.add([k.circle(pr + 4), k.pos(px, y), k.anchor("center"), k.color(...THEME.teal), k.opacity(0.22), "charUI"]); // soft glow
        k.add([k.circle(pr + 2), k.pos(px, y), k.anchor("center"), k.color(...THEME.teal), k.opacity(0.55), "charUI"]); // ring
        k.add([k.circle(pr), k.pos(px, y), k.anchor("center"), k.color(...THEME.bgAlt), "charUI"]);                     // frame fill
        // The hooded spirit-tamer icon (generatePlayerSprite — designed to match drawCharacter).
        try { k.add([k.sprite("player"), k.pos(px, y + 4), k.anchor("center"), k.scale(0.34), "charUI"]); } catch { /* sprite not ready */ }
        // Level badge on the portrait's corner — the classic RPG roster read (a numbered disc on
        // the character's avatar). Dark fill + teal rim so it reads as a deliberate stat chip.
        const bx = px + 23, by = y + 22;
        k.add([k.circle(11), k.pos(bx, by), k.anchor("center"), k.color(...THEME.bg), k.outline(2, k.rgb(...THEME.teal)), "charUI"]);
        cl(bx, by + 1, `${char.level}`, 12, THEME.text);
        // Faint vertical rule separating the identity zone (portrait + name) from the team zone —
        // crisp internal structure, the hallmark of a polished list card. Wide two-zone layout only.
        k.add([k.rect(1.5, Math.max(20, cardH - 36), { radius: 1 }), k.pos(left + cardW * 0.52, y), k.anchor("center"), k.color(...THEME.line), k.opacity(0.6), "charUI"]);
      }
      // Click SELECTS the slot (updates the left preview); clicking the already-selected slot
      // CONFIRMS (enters the world) — so a double-click flows straight in, but the explicit Confirm
      // button is always there. Gated on modalUp() (no click-through under a dialog).
      card.onClick(() => {
        if (modalUp()) return; sfx("click");
        if (isSel) { k.go("hub", { characterId: char.id }); }
        else { selectedId = char.id; renderList(); }
      });
      card.onHover(() => k.setCursor("pointer"));
      card.onHoverUpdate(() => { card.color = k.rgb(...lighten(THEME.surfaceAlt, 8)); halo.opacity = isSel ? 0.2 : 0.16; });
      // Restore to the slot's RESTING fill — the selected slot rests lighter (raised/active).
      card.onHoverEnd(() => { card.color = k.rgb(...(isSel ? THEME.surfaceAlt : THEME.surface)); halo.opacity = isSel ? 0.12 : 0; });

      // Identity (left): name + guest tag, then level / team count. On a narrow card the
      // text sits in the TOP band (the team strip moves to a row below); on wide it's
      // vertically centered with the strip on the right.
      const nameY = compact ? y - 11 : narrowCard ? y - 56 : y - 16;
      const lvlY = compact ? y + 11 : narrowCard ? y - 32 : y + 14;
      const statY = narrowCard ? y - 12 : y + 33;
      cl(textX, nameY, char.name, 21, THEME.text, "left");
      // Clamp the tag x so a long name can't shove "guest" into the team-preview
      // strip on the right (watchdog iter-299) — keep it in the left identity column.
      // Tag sits just after the name; clamp it so it can't run off the card. The wide layout
      // also keeps it clear of the right-side strip (cardW*0.4); narrow has the strip below,
      // so the whole name row is free — clamp only to the card's right edge.
      // Warm amber tag (was cool violet — the last cool accent on the screen; doesn't fit the ember theme).
      if (char.isGuest) cl(Math.min(textX + 4 + char.name.length * 13 + 8, narrowCard ? left + cardW - 52 : left + cardW * 0.42), nameY + 1, "guest", 12, THEME.amber, "left");
      const teamTxt = `${monsters.length} monster${monsters.length === 1 ? "" : "s"}`;
      // When the portrait shows a level badge, the text line drops the redundant "Lv N".
      cl(textX, lvlY, portrait ? teamTxt : `Lv ${char.level}     ${teamTxt}`, 14, THEME.textBody, "left");
      // Per-character lifetime record (P8-T1) — each save now tracks its own stats, so
      // the slot reads as a distinct identity/history, not just a name + level.
      const cs = char.stats || {};
      if (!compact && (cs.runs || cs.extractions || cs.caught)) {
        cl(textX, statY, `Caught ${cs.caught || 0}     Escaped ${cs.extractions || 0}     Runs ${cs.runs || 0}`, 11, THEME.textBody, "left");
      }

      // Delete sits at the right edge, vertically centered. The team strip ends a clear gap to
      // its LEFT (the previous math left a 4px overlap — the "stuff overlaps" the screenshot showed).
      const delX = rosterCx + cardW / 2 - 26;
      // Team-preview thumbnails — small sprites + HP pips so the roster reads at a glance.
      // Wide: a right-side strip ending a full gap before the delete glyph. Narrow: a left-aligned
      // row BELOW the identity text (the right side has no room beside a long name). Skipped in
      // compact mode (short cards squeezed by a full slot list) — the count already conveys size.
      if (!compact) {
        const slot = 56;
        const thumbY = narrowCard ? y + 42 : y - 4;
        const spriteY = narrowCard ? y + 40 : y - 6;
        const barY = narrowCard ? y + 62 : y + 20;
        // Wide: LEFT-align the strip just right of the divider so the team zone reads identically
        // for 1–4 monsters (the old right-align left an awkward gap between the divider and a short
        // team). 4 slots still clear the delete glyph. Narrow: a fixed left inset below the identity.
        const startX = narrowCard ? left + 42 : left + cardW * 0.52 + 32;
        monsters.slice(0, 4).forEach((mon, j) => {
          const mx = startX + j * slot;
          // Framed slot — hairline border + a top sheen so each thumbnail reads as a crafted,
          // beveled slot from the same panel family (was a bare dark square with loose sprites).
          k.add([k.rect(46, 46, { radius: 10 }), k.pos(mx, thumbY), k.anchor("center"), k.color(...THEME.bgAlt), k.outline(1.5, k.rgb(...THEME.line)), "charUI"]);
          k.add([k.rect(38, 7, { radius: 3 }), k.pos(mx, thumbY - 15), k.anchor("center"), k.color(...THEME.surface2), k.opacity(0.4), "charUI"]);
          const spriteName = slugOf(mon.typeName);
          try {
            // 0.13 = 0.26 ÷ MONSTER_SPRITE_RES(2): the monster bitmap is now supersampled 2× (spritegen),
            // so its natural texture size doubled — halve the display scale to keep the same thumbnail size.
            k.add([k.sprite(spriteName), k.pos(mx, spriteY), k.anchor("center"), k.scale(0.13), "charUI"]);
          } catch { /* sprite not ready */ }
          // HP pip
          let maxHp = mon.currentHealth;
          try { maxHp = getStatsAtLevel(getMonsterType(mon.typeName), mon.level).health; } catch {}
          const frac = maxHp > 0 ? Math.max(0, Math.min(1, (mon.currentHealth ?? maxHp) / maxHp)) : 1;
          const barC = hpColor(frac);
          k.add([k.rect(38, 3, { radius: 1.5 }), k.pos(mx - 19, barY), k.anchor("topleft"), k.color(...THEME.line), "charUI"]);
          if (frac > 0) k.add([k.rect(38 * frac, 3, { radius: 1.5 }), k.pos(mx - 19, barY), k.anchor("topleft"), k.color(...barC), "charUI"]);
        });
      }

      // Delete — small + subtle, tucked in the card's top-right corner. A muted-grey glyph by
      // default (no longer a loud magenta X crowding the team strip); the destructive red blooms
      // only on hover via the danger glow. Routed through the shared addButton so it tracks every
      // future button-style change like every other button.
      addButton(k, { x: delX, y, w: 26, h: 26, text: "✕", size: 13, radius: 7,
        fill: THEME.surfaceAlt, textColor: THEME.textMut, glow: THEME.danger,
        tag: "charUI", onClick: () => { if (modalUp()) return; showDeleteConfirm(char); } });
    }

    renderList();
    syncServerCharacters(); // logged in → replace the list with the account's cloud characters

    // Keyboard navigation (the A-level menu affordance the screen was missing): ↑/↓ move the
    // selection through the roster, Enter confirms it (enters the world with the selected tamer).
    // All gated on modalUp() so they never fire under the name-input / delete dialogs (whose own
    // Enter/Escape keep working). No-ops with an empty roster.
    const moveSel = (dir) => {
      if (modalUp() || characters.length < 2) return;
      const cur = Math.max(0, characters.findIndex((c) => c.id === selectedId));
      selectedId = characters[(cur + dir + characters.length) % characters.length].id;
      sfx("hover"); renderList();
    };
    k.onKeyPress("up", () => moveSel(-1));
    k.onKeyPress("down", () => moveSel(1));
    k.onKeyPress("enter", () => { if (!modalUp()) enterSelected(); });

    // Back to title (top-left).
    addButton(k, { x: backX, y: 40 + ins.top, w: backW, h: 36, text: "< Back", size: 16,
      fill: THEME.surfaceAlt, textColor: THEME.text, onClick: () => { if (modalUp()) return; k.go("start"); } });

    // Scene entrance: a brief fade-up from dark (~0.35s) — the polished "scene settles in"
    // transition A-level menus have. Registered LAST so it paints over everything, including the
    // immediate-mode hero/podium. Single tweened overlay (no per-element animation to go janky);
    // once elapsed it draws nothing, so the settled screen is unchanged. introStart is sampled on
    // the FIRST draw (not scene-init) to avoid the k.time() init-basis pitfall, and frozen under
    // reduce-motion (no flash for motion-sensitive players).
    let introStart = null;
    k.onDraw(() => {
      if (prefersReducedMotion()) return;
      if (introStart === null) introStart = k.time();
      const a = 1 - Math.min(1, (k.time() - introStart) / 0.35);
      if (a <= 0) return;
      k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: k.rgb(...THEME.bgAlt), opacity: 0.5 * a, fixed: true });
    });

    function showDeleteConfirm(char) {
      confirmOpen = true;
      k.destroyAll("deleteConfirm");
      k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(0, 0, 0), k.opacity(0.72), "deleteConfirm"]);
      const my = k.height() / 2;
      addPanel(k, { x: cx, y: my, w: Math.min(360, k.width() - 24), h: 200, radius: 16, tag: "deleteConfirm" });
      const delNm = char.name.length > 14 ? char.name.slice(0, 13) + "…" : char.name; // keep the title inside a narrow-phone panel
      addLabel(k, { x: cx, y: my - 56, text: `Delete "${delNm}"?`, size: 22, color: THEME.text, tag: "deleteConfirm" });
      addLabel(k, { x: cx, y: my - 26, text: "This cannot be undone.", size: 14, color: THEME.textMut, font: FONT_BODY, tag: "deleteConfirm" });
      addButton(k, { x: cx - 80, y: my + 36, w: 140, h: 44, text: "Delete", size: 17,
        fill: THEME.danger, textColor: THEME.textInv, tag: "deleteConfirm",
        onClick: async () => {
          confirmOpen = false;
          k.destroyAll("deleteConfirm");
          const session = getAccountSession();
          if (session && char.serverToken) {
            // Logged in: delete the character on the SERVER, then re-sync.
            try { await fetch("/account/characters", { method: "DELETE",
              headers: { "x-account-session": session, "Content-Type": "application/json" },
              body: JSON.stringify({ token: char.serverToken }) }); } catch { /* offline */ }
            await syncServerCharacters({ allowEmpty: true }); // delete-to-empty is a valid result
          } else { deleteCharacter(char.id); renderList(); } // guest: local
        } });
      addButton(k, { x: cx + 80, y: my + 36, w: 140, h: 44, text: "Cancel", size: 17,
        fill: THEME.surfaceAlt, textColor: THEME.text, tag: "deleteConfirm",
        onClick: () => { confirmOpen = false; k.destroyAll("deleteConfirm"); } });
    }

    let inputHandlers = [];

    function showNameInput() {
      if (inputActive) return;
      if (getCharacters().length >= maxSlots) return;
      inputActive = true;
      k.destroyAll("nameInput");

      k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(0, 0, 0), k.opacity(0.72), "nameInput"]);
      addPanel(k, { x: cx, y: k.height() / 2 - 5, w: Math.min(380, k.width() - 24), h: 214, radius: 16, tag: "nameInput" });
      addLabel(k, { x: cx, y: k.height() / 2 - 74, text: "Enter character name:", size: 22, color: THEME.text, tag: "nameInput" });

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

      // Tap-targets so MOBILE has a way to confirm/cancel (no soft-keyboard ESC, and the
      // return key isn't obvious) — mirrors the guest-nickname + delete-confirm dialogs.
      // The DOM <input> sits at screen-center; place the row just below it, inside the panel.
      const by = k.height() / 2 + 60;
      addButton(k, { x: cx - 78, y: by, w: 140, h: 44, text: "Confirm", size: 17,
        fill: THEME.primary, textColor: THEME.textInv, tag: "nameInput", onClick: () => submit() });
      addButton(k, { x: cx + 78, y: by, w: 140, h: 44, text: "Cancel", size: 17,
        fill: THEME.surfaceAlt, textColor: THEME.text, tag: "nameInput", onClick: () => close() });

      inputHandlers.forEach((h) => h.cancel());
      inputHandlers = [k.onKeyPress("escape", () => { if (inputActive) close(); })]; // Esc when canvas has focus
      k.onSceneLeave(() => input.remove()); // never leak the DOM input on navigation
    }

    async function confirmCharacter(name) {
      k.destroyAll("nameInput");
      const session = getAccountSession();
      if (session) {
        // Logged in: create the character on the SERVER (cloud save), then re-sync the list.
        try {
          await fetch("/account/characters", { method: "POST",
            headers: { "x-account-session": session, "Content-Type": "application/json" },
            body: JSON.stringify({ name }) });
        } catch { /* offline — the sync reflects reality */ }
        await syncServerCharacters({ allowEmpty: true }); // user-initiated → trust the server result
        return;
      }
      createCharacter(name); // guest: local only (createCharacter rolls the starter team)
      renderList();
    }
  });
}
