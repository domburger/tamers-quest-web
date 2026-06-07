// The player's current goal as one short HUD line (PT2-T10 / headline demand #9:
// "objective / mission HUD"). Pure + ASCII-only (no decorative glyphs — the UI
// guardrail forbids them) so single-player and the online view show the SAME
// objective for the same run-state. The scenes pass their own state; the text is
// contextual so a new player always knows what to do, early run through extraction.
//
// @param {{circleStarted:boolean, portalsOpen:boolean, outsideZone:boolean}} s
// @returns {string}
export function objectiveText({ circleStarted, portalsOpen, outsideZone } = {}) {
  if (outsideZone) return "Get back inside the safe zone, or reach a portal to extract!";
  if (portalsOpen) return "Objective: reach a glowing portal to EXTRACT and bank your loot";
  if (circleStarted) return "The storm is closing in. A portal will open soon. Get ready to extract";
  return "Objective: catch monsters and loot chests, then extract before the storm closes";
}
