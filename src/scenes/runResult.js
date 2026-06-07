import { getCharacter } from "../storage.js";
import { THEME, addButton, addLabel, addMenuBackground, addPanel } from "../ui/theme.js";

// Run-result screen — a PURE PRESENTATION scene (VS-13). The run's stakes are
// already resolved upstream before we arrive here:
//   • extract  → game.js endRunStakes(true): heals the team + banks run-found chains
//   • timeout / team defeated → fight.js / game.js endRunStakes(false): forfeits the
//     run-found chains AND loses the active run team (Q10, confirmed 2026-06-07 —
//     shared loseRunTeam, refilled from the vault / fresh starters). The vault is
//     kept (Q9). See public/wiki.html #chains.
// So this scene must NOT mutate state; it only reports the outcome and routes back
// to the lobby. It now recognises every SP exit code (victory / timeout / defeat)
// plus the MP-style ones (extracted / died) defensively.
//
// ⚠️ This scene must not itself touch the team: it once WIPED + re-rolled starters on
// any non-victory code (double-applying, and even on outcomes that shouldn't have).
// The team stake now lives solely in the upstream endRunStakes (Q10), so this stays
// pure presentation; the failure copy below reflects that the run team is lost.
export default function runResultScene(k) {
  k.scene("runResult", ({ characterId, result, gains }) => {
    const character = getCharacter(characterId);
    if (!character) {
      k.go("characterSelect");
      return;
    }

    addMenuBackground(k);

    // Normalise SP (victory/timeout/defeat) + MP-style (extracted/died) codes.
    const OUTCOME = {
      victory:   { title: "You Escaped!", color: THEME.success, success: true },
      extracted: { title: "You Escaped!", color: THEME.success, success: true },
      timeout:   { title: "Out of Time",  color: THEME.warn,    success: false },
      defeat:    { title: "Defeated",      color: THEME.danger,  success: false },
      died:      { title: "Defeated",      color: THEME.danger,  success: false },
    }[result] || { title: "Run Over", color: THEME.textMut, success: false };

    const subtitle = OUTCOME.success
      ? "You made it through the portal — your team is healed and the spirit chains you found this run are banked."
      : "You didn't make it out. The spirit chains you found this run and your run team are lost — but your vault is safe, and a fresh team is ready for next run.";

    // Result card — frames the outcome as a designed screen with an outcome-tinted
    // border (parity with the MP round-result overlay), instead of text floating on
    // the menu backdrop. Added before the labels so they draw on top.
    const panelW = Math.min(720, k.width() - 40);
    addPanel(k, { x: k.width() / 2, y: k.height() / 2 + 6, w: panelW, h: 280, radius: 18,
      fill: THEME.surface, border: OUTCOME.color });

    addLabel(k, { x: k.width() / 2, y: k.height() / 2 - 70, text: OUTCOME.title, size: 48,
      color: OUTCOME.color });

    addLabel(k, { x: k.width() / 2, y: k.height() / 2 + 4, text: subtitle, size: 18,
      width: panelW - 80, color: THEME.textMut });

    // P8-T3 parity: report the run's haul (SP had no per-run summary; MP's round result
    // does). On success, what was banked; on a failed run, what was forfeited.
    if (gains) {
      const parts = OUTCOME.success
        ? [gains.chains ? `Banked ${gains.chains} spirit ${gains.chains === 1 ? "chain" : "chains"}` : "", gains.gold ? `+${gains.gold} gold` : ""].filter(Boolean)
        : (gains.chains > 0 ? [`${gains.chains} spirit ${gains.chains === 1 ? "chain" : "chains"} lost this run`] : []);
      if (parts.length) addLabel(k, { x: k.width() / 2, y: k.height() / 2 + 48, text: parts.join("      "),
        size: 18, color: OUTCOME.success ? THEME.success : THEME.textMut });
    }

    addButton(k, {
      x: k.width() / 2, y: k.height() / 2 + 96, w: 220, h: 50, text: "Continue", size: 22,
      fill: OUTCOME.success ? THEME.success : THEME.primary,
      onClick: () => k.go("lobby", { characterId }),
    });

    k.onKeyPress("enter", () => {
      k.go("lobby", { characterId });
    });
  });
}
