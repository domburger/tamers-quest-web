// Pure monster stat math — shared by client and server.
// stat(level) = floor(base + scaling1 * level ^ scaling2)

export function calcStat(base, scaling1, scaling2, level) {
  return Math.floor(base + scaling1 * Math.pow(level, scaling2));
}

export function getMonsterStats(monsterType, level) {
  return {
    health: calcStat(monsterType.baseHealth, monsterType.healthScaling1, monsterType.healthScaling2, level),
    strength: calcStat(monsterType.baseStrength, monsterType.strengthScaling1, monsterType.strengthScaling2, level),
    defense: calcStat(monsterType.baseDefense, monsterType.defenseScaling1, monsterType.defenseScaling2, level),
    speed: calcStat(monsterType.baseSpeed, monsterType.speedScaling1, monsterType.speedScaling2, level),
    power: calcStat(monsterType.basePower, monsterType.powerScaling1, monsterType.powerScaling2, level),
    energy: calcStat(monsterType.baseEnergy, monsterType.energyScaling1, monsterType.energyScaling2, level),
    luck: calcStat(monsterType.baseLuck, monsterType.luckScaling1, monsterType.luckScaling2, level),
  };
}
