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
   * Бег/Спринт: Механика / Бой gives СКР×6 / СКР×12 (as the accepted Core does), while the
   * personal profile movement cells read as ×3 / ×6 (Пак 4/8/12/24). Unresolved: null.
   */
  runSprintDistances: null as 'mechanics' | 'profiles' | null,
  /**
   * «2 ОД + СД»: whether more than one Свободное движение is allowed per turn. The accepted
   * Core does not count free moves; the client blocks a repeat until the author decides.
   */
  freeMovesPerTurn: null as number | 'unlimited' | null,
} as const;
