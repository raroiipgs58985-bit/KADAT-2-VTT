import type {
  BleedingSeverity,
  CalledLocation,
  DamageResolutionResult,
  InjuryRecord,
  PostDamageRequest,
  ResolutionContext,
  WoundFacts,
  WoundRuntimeState,
} from '@kadat/contracts';
import {
  createWoundRuntime,
  resolveProtectionDamage,
  createSequenceDice,
  lookupConsequence,
} from '../src/index.js';
import { meleeState } from './b2-fixtures.js';
import {
  context as damageContext,
  input as damageInput,
  source,
  provenance,
  state as protectionState,
} from './c1-fixtures.js';
export { deepFreeze } from './fixtures.js';
export { source, provenance };
export function ctx(changes: Partial<ResolutionContext> = {}): ResolutionContext {
  return {
    actor: { actorId: 'B' },
    targetActor: { actorId: 'A' },
    roundNumber: 1,
    turnNumber: 1,
    tags: [],
    effects: [],
    modifiers: [],
    overrides: [],
    ...changes,
  };
}
export const facts: WoundFacts = { provenance, activity: 'REST', eyeCountBefore: 2 };
export function state(vn = 40, sv = 40): WoundRuntimeState {
  const combat = meleeState();
  const runtime = combat.actors.B!;
  const actors = {
    ...combat.actors,
    B: {
      ...runtime,
      characteristics: {
        ...runtime.characteristics,
        ВН: { baseValue: vn, baseSuper: 0 },
        СВ: { baseValue: sv, baseSuper: 0 },
        ОЩ: { baseValue: 40, baseSuper: 0 },
        ВС: { baseValue: 40, baseSuper: 0 },
      },
    },
  };
  return createWoundRuntime({ ...combat, actors }, { B: { maxWounds: 15, damageTaken: 7 } });
}
export function damage(
  value = 5,
  location: CalledLocation = 'Torso',
  critical = false,
  id = 'cw-hit',
): DamageResolutionResult {
  const roll = critical ? 10 : 4;
  return resolveProtectionDamage(
    {
      input: damageInput({
        hitId: id,
        location,
        profile: { source, expression: { count: 1, sides: 10, modifier: value + 4 - roll } },
        penetration: { source, value: 0 },
        context: damageContext(),
      }),
      state: protectionState({ sources: {} }),
      endurance: { baseValue: 40, baseSuper: 0 },
    },
    createSequenceDice([{ sides: 10, value: roll }]),
  ).result;
}
export function request(changes: Partial<PostDamageRequest> = {}): PostDamageRequest {
  return { state: state(), damage: damage(), context: ctx(), facts, ...changes };
}
export function rng(...rolls: { sides: number; value: number }[]) {
  return createSequenceDice(rolls);
}
export function withBleeding(
  severities: readonly BleedingSeverity[],
  initial: WoundRuntimeState = state(),
): WoundRuntimeState {
  const actor = initial.actors.B!;
  const injuries: InjuryRecord[] = severities.map((severity, index) => {
    const row = lookupConsequence(
      severity === 'MEDIUM' ? 'LEG' : 'ARM',
      severity === 'MEDIUM' ? 6 : severity === 'LIGHT' ? 3 : 8,
    )!;
    return {
      id: `fixture-injury:${index}`,
      actor: actor.actor,
      sourceAttackId: 'fixture-attack',
      sourceHitId: `fixture-hit:${index}`,
      consequence: row,
      location: 'Right Arm',
      side: 'Right',
      finalDamage: row.minimum,
      severity: row.minimum,
      title: row.title,
      createdRound: 1,
      createdTurn: 1,
      features: [],
      bleedingSourceIds: [`fixture-bleed:${index}`],
      persistentEffects: [],
      triggers: [],
      canonicalText: row.text,
      provenance: [provenance],
    };
  });
  const bleeding = injuries.map((injury, index) => ({
    id: `fixture-bleed:${index}`,
    injuryId: injury.id,
    consequence: injury.consequence,
    severity: severities[index]!,
    location: injury.location,
    active: true,
    appliedRound: 1,
    appliedTurn: 1,
    provenance,
  }));
  return { ...initial, actors: { ...initial.actors, B: { ...actor, injuries, bleeding } } };
}
