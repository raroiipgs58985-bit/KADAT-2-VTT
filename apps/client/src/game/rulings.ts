/** Latest direct author decisions; never inferred from an RPG default. */
export const rulings = {
  laserMasterRounding: 'floor',
  provenMinimum: 5,
  automaticLocation: 'Torso',
  hotshotBlockUnit: 'shots',
  hotshotBlockCapacity: 250,
  pakDamageIncludesStrengthAndChain: true,
  chainArmorLoss: 'effective-penetration',
  /** «Цепное»: ОБ снимается сразу, урон этого удара — по уменьшенной броне (решение 16). */
  chainTiming: 'before' as 'before' | 'after' | null,
  /**
   * Бег/Спринт. Механика / Бой: Бег СКР×6, Спринт СКР×12 (as the accepted Core does).
   * Общая механика / Движение в режиме боя lists ½ / ×1 / ×2 / Натиск ×3 / Бег ×6, so profile
   * cells such as 4/8/12/24 read as Полу / Полное / Натиск / Бег and agree. The earlier
   * reading of a conflict was mistaken. Confirmed by the author (ruling 1).
   */
  runSprintDistances: 'mechanics' as 'mechanics' | 'profiles' | null,
  /**
   * «2 ОД + СД»: whether more than one Свободное движение is allowed per turn. The accepted
   * Core now allows one Free Action per turn (ruling 24), which covers this.
   */
  freeMovesPerTurn: 1 as number | 'unlimited' | null,
} as const;
