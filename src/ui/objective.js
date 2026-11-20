export function objectiveText({ circleStarted, portalsOpen, outsideZone } = {}) {
  if (outsideZone) return "Get back inside the safe zone, or reach a portal to extract!";
  if (portalsOpen) return "Objective: reach a glowing portal to EXTRACT and bank your loot";
  if (circleStarted) return "The storm is closing in. A portal will open soon. Get ready to extract";
  return "Objective: catch monsters and loot chests, then extract before the storm closes";
}
