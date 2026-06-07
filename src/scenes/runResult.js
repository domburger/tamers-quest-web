import { getCharacter } from "../storage.js";
import { THEME, addButton, addLabel } from "../ui/theme.js";

// Run-result screen — a PURE PRESENTATION scene (VS-13). The run's stakes are
// already resolved upstream before we arrive here:
//   • extract  → game.js endRunStakes(true): heals the team + banks run-found chains
//   • timeout / team defeated → fight.js / game.js finalizeRunChains(false): forfeits
//     the run-found chains but KEEPS the team (the documented extraction-stakes
//     design — see public/wiki.html #chains).
// So this scene must NOT mutate state; it only reports the outcome and routes back
// to the lobby. It now recognises every SP exit code (victory / timeout / defeat)
// plus the MP-style ones (extracted / died) defensively.
//
// ⚠️ Previously this scene re-healed on victory (redundant) and — on ANY non-victory
// code — WIPED the entire team and granted 4 random starters, which flatly
// contradicted the stakes design (a mere timeout nuked a player's leveled team).
// That stale pre-stakes logic was removed. (@feature: this aligns SP failure with
// the keep-team / lose-run-chains design; flagged in IMPLEMENTATION_PLAN VS-13.)
export default function runResultScene(k) {
  k.scene("runResult", ({ characterId, result }) => {
    const character = getCharacter(characterId);
    if (!character) {
      k.go("characterSelect");
      return;
    }

    k.add([k.sprite("menu_background"), k.pos(k.width() / 2, k.height() / 2), k.anchor("center")]);

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
      : "You didn't make it out. The spirit chains you found this run are lost, but your team survives — heal them by extracting next run.";

    addLabel(k, { x: k.width() / 2, y: k.height() / 2 - 70, text: OUTCOME.title, size: 48,
      color: OUTCOME.color });

    addLabel(k, { x: k.width() / 2, y: k.height() / 2 + 4, text: subtitle, size: 18,
      width: 640, color: THEME.textMut });

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
