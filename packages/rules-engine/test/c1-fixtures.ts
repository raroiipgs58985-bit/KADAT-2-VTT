import type {
  DamageInput,
  DamageResolutionRequest,
  FieldInstance,
  FieldResponse,
  ProtectionDefinition,
  ProtectionInstance,
  ProtectionRuntimeState,
  CoverInstance,
  ResolutionContext,
} from '@kadat/contracts';
import { createSequenceDice, resolveProtectionDamage } from '../src/index.js';
export { deepFreeze } from './fixtures.js';
export const source = { kind: 'test-fixture', id: 'C1 synthetic protection/damage' };
export const provenance = {
  source,
  reason: 'Explicit synthetic numeric input, not a canonical catalog entry',
};
export function context(changes: Partial<ResolutionContext> = {}): ResolutionContext {
  return {
    actor: { actorId: 'A' },
    targetActor: { actorId: 'B' },
    canonicalReleaseId: 'fixture-release',
    roundNumber: 2,
    turnNumber: 4,
    tags: [],
    effects: [],
    modifiers: [],
    overrides: [],
    ...changes,
  };
}
export function input(changes: Partial<DamageInput> = {}): DamageInput {
  return {
    hitId: 'hit:1',
    attackId: 'attack:1',
    attacker: { actorId: 'A' },
    target: { actorId: 'B' },
    location: 'Torso',
    profile: { source, expression: { count: 1, sides: 10, modifier: 8 } },
    penetration: { source, value: 6 },
    transformations: [],
    tags: ['kinetic'],
    context: context(),
    provenance: [provenance],
    ...changes,
  };
}
export function armor(
  id = 'armor',
  ob = 10,
  changes: Partial<ProtectionDefinition> = {},
): ProtectionInstance {
  return {
    id,
    owner: { actorId: 'B' },
    active: true,
    definition: {
      id: `template:${id}`,
      source,
      provenance,
      kind: 'worn-armor',
      ob,
      zones: ['Torso'],
      tags: [],
      penetrationMode: 'WEAPON_BB',
      compatibleWithTemplateIds: [],
      ...changes,
    },
  };
}
export function cover(id = 'cover', ob = 6): CoverInstance {
  return {
    id,
    active: true,
    currentOB: ob,
    coveredZones: ['Torso'],
    definition: {
      ...armor(id, ob).definition,
      kind: 'cover',
      material: source,
      degradation: { type: 'UNRESOLVED', reason: 'No material-specific rule supplied' },
    },
  };
}
export function field(response: FieldResponse, id = 'field'): FieldInstance {
  return {
    id,
    owner: { actorId: 'B' },
    active: true,
    remainingUses: 3,
    definition: {
      id: `template:${id}`,
      source,
      provenance,
      zones: ['Torso'],
      tags: [],
      response,
      useCost: 1,
    },
  };
}
export function state(changes: Partial<ProtectionRuntimeState> = {}): ProtectionRuntimeState {
  return { sources: { armor: armor() }, covers: {}, fields: [], resolvedHitIds: [], ...changes };
}
export function request(changes: Partial<DamageResolutionRequest> = {}): DamageResolutionRequest {
  return { input: input(), state: state(), endurance: { baseValue: 40, baseSuper: 0 }, ...changes };
}
export function dice(...values: number[]) {
  return createSequenceDice(values.map((value) => ({ sides: 10, value })));
}
export function resolve(req: DamageResolutionRequest = request(), ...values: number[]) {
  return resolveProtectionDamage(req, dice(...(values.length ? values : [10])));
}
