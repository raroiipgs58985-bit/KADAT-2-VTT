import type {
  EquipmentCombatEffect,
  EquipmentInstance,
  EquipmentPayload,
  SuppressionCandidate,
  SuppressionEquipmentState,
  SuppressionEvent,
} from '@kadat/contracts';
import { b1State, fixtureProvenance, fixtureSource } from './b1-fixtures.js';
import {
  createSuppressionEquipmentState,
  emptyActionContext,
  createSequenceDice,
} from '../src/index.js';

export { fixtureProvenance as provenance, fixtureSource as source };
export function dState(sw = 50): SuppressionEquipmentState {
  const combat = b1State();
  return createSuppressionEquipmentState({
    ...combat,
    actors: Object.fromEntries(
      Object.entries(combat.actors).map(([id, a]) => [
        id,
        {
          ...a,
          characteristics: {
            ...a.characteristics,
            СВ: { baseValue: sw, baseSuper: 0 },
            СЛ: { baseValue: 50, baseSuper: 0 },
          },
        },
      ]),
    ),
  });
}
export function single(
  degrees = 3,
  id = 'source-shot',
): Extract<SuppressionEvent, { kind: 'SINGLE' }> {
  return {
    attackId: id,
    sourceActor: { actorId: 'A' },
    primaryTarget: { actorId: 'B' },
    weapon: fixtureSource,
    provenance: fixtureProvenance,
    kind: 'SINGLE',
    successful: true,
    successDegrees: degrees,
  };
}
export function burst(
  shots = 6,
  weaponClass: 'PISTOL' | 'BASIC' | 'HEAVY' = 'BASIC',
): Extract<SuppressionEvent, { kind: 'BURST' }> {
  return {
    ...single(),
    kind: 'BURST',
    shotsForSuppression: shots,
    quantitySource: 'RESOLVED_SHOTS',
    weaponClass,
  };
}
export function area(radius = 6): Extract<SuppressionEvent, { kind: 'AREA' }> {
  return {
    ...single(),
    kind: 'AREA',
    radii: [{ property: 'EXPLOSION', meters: radius, provenance: fixtureProvenance }],
  };
}
export function candidate(
  actorId = 'B',
  cover: 'YES' | 'NO' | 'UNKNOWN' = 'NO',
  distance = 0,
): SuppressionCandidate {
  return {
    actor: { actorId },
    distanceFromPrimaryTarget: distance,
    nearestCoverWithinSpeed: cover,
    context: emptyActionContext({ actorId }),
    provenance: fixtureProvenance,
  };
}
export function equipment(
  payloads: readonly EquipmentPayload[],
  actorId = 'B',
  changes: Partial<EquipmentInstance> = {},
): EquipmentInstance {
  const id = `equipment:${actorId}`;
  return {
    id,
    wearer: { actorId },
    equipped: true,
    powerState: 'POWERED',
    disabledSystemIds: [],
    provenance: fixtureProvenance,
    effects: payloads.map((payload, index): EquipmentCombatEffect => ({
      id: `effect:${index}`,
      sourceItemId: id,
      sourceSystemId: `subsystem:${index}`,
      active: true,
      requiresPower: true,
      requiredTags: [],
      targetScope: 'wearer',
      payload,
      provenance: fixtureProvenance,
    })),
    ...changes,
  };
}
export function rng(...values: number[]) {
  return createSequenceDice(values.map((value) => ({ sides: 100, value })));
}
export function ctx(actorId = 'B', tags: readonly string[] = []) {
  return { ...emptyActionContext({ actorId }), tags };
}
