import type { ResolutionModifier } from '@kadat/contracts';
import { ruleModifier } from './action-context.js';

/**
 * Ready-made combat conditions for the GM to tick instead of typing a modifier.
 * Ranged: «Бой» J61–K66 «Модификаторы стрельбы»; melee: «Бой» F85–H90 «Модификаторы
 * Ближнего боя». A suppressed shooter's −20 НС and a prone melee target's +10 are applied
 * by the engine itself (suppression and melee attack), so they are not listed again.
 */
export interface CombatCondition {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly cell: string;
}
export const RANGED_CONDITIONS: readonly CombatCondition[] = Object.freeze([
  { id: 'fatigue', label: 'Усталость', value: -10, cell: 'Бой J61–K61' },
  { id: 'dim-light', label: 'Слабое освещение', value: -10, cell: 'Бой J62–K62' },
  { id: 'smoke', label: 'Туман, дым, смог', value: -20, cell: 'Бой J63–K63' },
  {
    id: 'target-running-prone-engaged',
    label: 'Цель бежит, лежит или в ближнем бою с другими',
    value: -20,
    cell: 'Бой J64–K64',
  },
  { id: 'darkness', label: 'Полная темнота', value: -30, cell: 'Бой J65–K65' },
]);
export const MELEE_CONDITIONS: readonly CombatCondition[] = Object.freeze([
  { id: 'fatigue', label: 'Усталость', value: -10, cell: 'Бой F85–H85' },
  { id: 'dim-light', label: 'Слабое освещение', value: -10, cell: 'Бой F86–H86' },
  { id: 'smoke', label: 'Туман, дым, смог', value: -20, cell: 'Бой F87–H87' },
  {
    id: 'target-running-outnumbered',
    label: 'Цель бежит или численное превосходство над целью',
    value: 10,
    cell: 'Бой F88–H88',
  },
  { id: 'darkness', label: 'Полная темнота', value: -30, cell: 'Бой F90–H90' },
]);

/** Modifiers for the ticked conditions, to add to the attack's context. */
export function conditionModifiers(
  kind: 'ranged' | 'melee',
  ids: readonly string[],
): readonly ResolutionModifier[] {
  const catalog = kind === 'ranged' ? RANGED_CONDITIONS : MELEE_CONDITIONS;
  return ids.map((id) => {
    const condition = catalog.find((c) => c.id === id);
    if (!condition) throw new Error(`Unknown ${kind} condition: ${id}`);
    return ruleModifier(`condition:${kind}:${id}`, condition.value);
  });
}
