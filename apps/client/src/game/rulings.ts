/** Latest direct author decisions; never inferred from an RPG default. */
export const rulings = {
  laserMasterRounding: 'floor',
  provenMinimum: 5,
  automaticLocation: 'Torso',
  hotshotBlockUnit: 'shots',
  hotshotBlockCapacity: 250,
  pakDamageIncludesStrengthAndChain: true,
  chainArmorLoss: 'effective-penetration',
  chainTiming: null as 'before' | 'after' | null,
  /**
   * Бег/Спринт. Механика / Бой: Бег СКР×6, Спринт СКР×12 (as the accepted Core does).
   * Общая механика / Движение в режиме боя lists ½ / ×1 / ×2 / Натиск ×3 / Бег ×6, so profile
   * cells such as 4/8/12/24 read as Полу / Полное / Натиск / Бег and agree. The earlier
   * reading of a conflict was mistaken; both modes stay off until the author confirms.
   */
  runSprintDistances: null as 'mechanics' | 'profiles' | null,
  /**
   * «2 ОД + СД»: whether more than one Свободное движение is allowed per turn. The accepted
   * Core does not count free moves; the client blocks a repeat until the author decides.
   */
  freeMovesPerTurn: null as number | 'unlimited' | null,
} as const;
