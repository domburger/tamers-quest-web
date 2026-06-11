import { getCharacters, createCharacter, deleteCharacter, getProfile, clearProfile, getAccountSession, setServerCharacters } from "../storage.js";
import { net } from "../netClient.js"; // shared client — clearSession() on Sign out
import { getMonsterStats as getStatsAtLevel } from "../engine/stats.js";
import { getMonsterType } from "../engine/gamedata.js";
import { THEME, PAL, FONT, FONT_BODY, hpColor, addMenuBackground, addHeader, addLabel, addButton, addPanel } from "../ui/theme.js";
import { sfx } from "../systems/audio.js"; // click on character-select (raw card, not addButton)
import { safeInsetsDesign } from "../systems/safearea.js"; // MOB: keep edge controls off notches/home bar
import { drawCharacter } from "../render/character.js"; // empty-state tamer: vector, FACES the player (was a back-facing static sprite)
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
      const hx = heroX;               // centre of the gutter left of the (right-shifted) roster
      const hy = k.height() * 0.605;  // feet/ground point — figure draws upward from here
      // Backlight bloom behind the figure — the spirit-portal glow. Larger so the hero holds its own
      // visual weight against the prominent roster card (the split read no longer feels right-heavy).
      k.drawCircle({ pos: k.vec2(hx, hy - 78), radius: 112, color: k.rgb(...THEME.teal), opacity: 0.045 + 0.03 * pulse });
      k.drawCircle({ pos: k.vec2(hx, hy - 78), radius: 70, color: k.rgb(...THEME.teal), opacity: 0.055 + 0.04 * pulse });
      // Podium — a glowing teal disc (contact shadow + soft fill + crisp rim) the hero stands on,
      // like a character-select pedestal. Grounds the figure instead of floating it in the void.
      k.drawEllipse({ pos: k.vec2(hx, hy + 12), radiusX: 60, radiusY: 16, color: k.rgb(0, 0, 0), opacity: 0.45 });
      k.drawEllipse({ pos: k.vec2(hx, hy + 10), radiusX: 55, radiusY: 14, color: k.rgb(...THEME.teal), opacity: 0.10 + 0.05 * pulse });
      k.drawEllipse({ pos: k.vec2(hx, hy + 10), radiusX: 55, radiusY: 14, fill: false, outline: { width: 1.5, color: k.rgb(...THEME.teal) }, opacity: 0.55 });
      drawCharacter(k, { x: hx, y: hy, t: clk, dir: { x: 0, y: 1 }, scale: 3.35, color: skin.accent, cloak: skin.cloak, model: skin.model });
      // Player nameplate below the podium — ties the figure to "you" (the account/guest behind
      // the roster), so the screen reads as the player presenting their tamers.
      const heroName = ((profile && profile.nickname) || "Tamer").slice(0, 18);
      k.drawText({ text: "TAMER", pos: k.vec2(hx, hy + 36), size: 11, font: FONT, anchor: "center", color: k.rgb(...THEME.teal), opacity: 0.8 });
      k.drawText({ text: heroName, pos: k.vec2(hx, hy + 53), size: 19, font: FONT, anchor: "center", color: k.rgb(...THEME.text) });
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
      addLabel(k, { x: cx, y: idY + 20, text: "Guest progress isn't saved — log in to keep your tamers.", size: 12, color: THEME.warn });
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
    // Start the list BELOW the two identity lines (idY, idY+20) so the first card doesn't
    // cover them — more headroom on narrow where the header is stacked + the card is taller.
    const listY = stackHeader ? 240 : 164;
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
        // Section caption above the slots — anchors the list (so a single card no longer floats
        // in a void) and labels the slot budget. Teal small-caps, the title screen's accent.
        // Sit it clear ABOVE the first card's top edge (cardCenter − cardH/2), not inside it.
        cl(rosterCx, listY + yOffset - cardH / 2 - 20, `YOUR TAMERS  ·  ${characters.length} OF ${maxSlots}`, 13, THEME.teal);
        characters.slice(0, maxSlots).forEach((char, i) => drawCard(char, listY + yOffset + i * step));
      }
      drawNewBtn(); // re-render the CTA so it tracks the (possibly server-synced) slot count
    }

    // "+ New Character" CTA — tagged so it re-renders with the list (after a server sync the slot
    // count can change). Disabled + relabelled when all slots are full.
    function drawNewBtn() {
      k.destroyAll("newBtn");
      const full = getCharacters().length >= maxSlots;
      // The primary CTA stays screen-centred at the bottom (not shifted with the roster): it's the
      // single global action, and a centred anchor balances the split hero(left)+roster(right) above.
      addButton(k, { x: cx, y: k.height() - 64 - ins.bottom, w: 260, h: 50,
        text: full ? "All slots full" : "+ New Character", size: 19,
        // Teal (the title screen's "Play as guest" primary) — was an off-palette flat green.
        fill: full ? THEME.surfaceAlt : THEME.primary, textColor: full ? THEME.textMut : THEME.textInv,
        tag: "newBtn", disabled: full, onClick: () => { if (modalUp()) return; showNameInput(); } });
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

      // Soft persistent teal bloom behind the card — ties each slot to the title screen's
      // luminous teal world (the portal glow) so it reads as part of the same UI, not a flat
      // dark slab. Brightens further on hover via the halo below.
      k.add([k.rect(cardW + 44, cardH + 38, { radius: 28 }), k.pos(rosterCx, y + 2), k.anchor("center"),
        k.color(...THEME.teal), k.opacity(0.05), "charUI"]);
      // Card hover-glow halo (behind the shadow) — kept card-specific (addPanel has no halo).
      const halo = k.add([k.rect(cardW + 16, cardH + 16, { radius: 20 }), k.pos(rosterCx, y), k.anchor("center"),
        k.color(...THEME.teal), k.opacity(0), "charUI"]);
      // Card body via the SHARED addPanel (shadow + body + sheen + specular rim) so the slot reads
      // as the same raised surface as every panel/card — was a hand-rolled shadow+body+sheen that
      // missed the rim. `area:true` keeps it clickable; the hover halo + body tint stay card-specific.
      const card = addPanel(k, { x: rosterCx, y, w: cardW, h: cardH, radius: 14, tag: "charUI", area: true });
      // Teal identity accent down the card's left edge — the title screen's signature colour,
      // and a clear "this is a tamer" marker that warms up the otherwise cold dark panel.
      k.add([k.rect(4, Math.max(20, cardH - 26), { radius: 2 }), k.pos(left + 13, y), k.anchor("center"),
        k.color(...THEME.teal), k.opacity(0.9), "charUI"]);

      // Wide layout: a teal-ringed portrait of the lead monster gives each slot a clear focal
      // point (was a flat text-only slab) — the single biggest "premium" lift on the card.
      // Skipped when narrow/compact (the stacked/short layouts have no room for it).
      const portrait = !narrowCard && !compact && monsters.length > 0;
      const textX = portrait ? left + 108 : left + 22;
      if (portrait) {
        const px = left + 60, pr = 31;
        k.add([k.circle(pr + 4), k.pos(px, y), k.anchor("center"), k.color(...THEME.teal), k.opacity(0.22), "charUI"]); // soft glow
        k.add([k.circle(pr + 2), k.pos(px, y), k.anchor("center"), k.color(...THEME.teal), k.opacity(0.55), "charUI"]); // ring
        k.add([k.circle(pr), k.pos(px, y), k.anchor("center"), k.color(...THEME.bgAlt), "charUI"]);                     // frame fill
        try { k.add([k.sprite(monsters[0].typeName.toLowerCase().replace(/\s+/g, "_")), k.pos(px, y - 1), k.anchor("center"), k.scale(0.17), "charUI"]); } catch { /* sprite not ready */ }
      }
      card.onClick(() => { if (modalUp()) return; sfx("click"); k.go("hub", { characterId: char.id }); }); // FLOW: walkable camp HUB is the lobby (gated: no click-through under a modal)
      card.onHover(() => k.setCursor("pointer"));
      card.onHoverUpdate(() => { card.color = k.rgb(...THEME.surfaceAlt); halo.opacity = 0.16; });
      card.onHoverEnd(() => { card.color = k.rgb(...THEME.surface); halo.opacity = 0; });

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
      if (char.isGuest) cl(Math.min(textX + 4 + char.name.length * 13 + 8, narrowCard ? left + cardW - 52 : left + cardW * 0.42), nameY + 1, "guest", 12, THEME.violet, "left");
      cl(textX, lvlY, `Lv ${char.level}     ${monsters.length} monster${monsters.length === 1 ? "" : "s"}`, 14, THEME.textBody, "left");
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
        const stripRight = delX - 48; // thumb (±23) clears the delete glyph (±13) with a ~12px gap
        const thumbY = narrowCard ? y + 42 : y - 4;
        const spriteY = narrowCard ? y + 40 : y - 6;
        const barY = narrowCard ? y + 62 : y + 20;
        const startX = narrowCard
          ? left + 42
          : stripRight - (Math.max(0, Math.min(4, monsters.length) - 1)) * slot;
        monsters.slice(0, 4).forEach((mon, j) => {
          const mx = startX + j * slot;
          // Framed slot — hairline border + a top sheen so each thumbnail reads as a crafted,
          // beveled slot from the same panel family (was a bare dark square with loose sprites).
          k.add([k.rect(46, 46, { radius: 10 }), k.pos(mx, thumbY), k.anchor("center"), k.color(...THEME.bgAlt), k.outline(1.5, k.rgb(...THEME.line)), "charUI"]);
          k.add([k.rect(38, 7, { radius: 3 }), k.pos(mx, thumbY - 15), k.anchor("center"), k.color(...THEME.surface2), k.opacity(0.4), "charUI"]);
          const spriteName = mon.typeName.toLowerCase().replace(/\s+/g, "_");
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
