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
} as const;
