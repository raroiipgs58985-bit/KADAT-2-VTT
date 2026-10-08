import type {
  ActionRequest,
  CombatActionState,
  CombatActorRuntime,
  EffectInstance,
  RangedAttackRequest,
  RangedWeaponProfile,
  WeaponInstance,
} from '@kadat/contracts';
import {
  beginActionRound,
  beginActionTurn,
  finishActionTurn,
  createActionState,
  createCombatSession,
  createSequenceDice,
  emptyActionContext,
} from '../src/index.js';
import { deepFreeze, effect } from './fixtures.js';

// These are deliberately synthetic fixtures, not imported canonical catalog entries.
export const fixtureSource = { kind: 'test-fixture', id: 'B1 synthetic data' };
export const fixtureProvenance = {
  source: fixtureSource,
  reason: 'Deterministic test input; not KADAT canon',
};

export function weapon(
  actorId: string,
  overrides: Partial<RangedWeaponProfile> = {},
): WeaponInstance {
  const profile: RangedWeaponProfile = {
    weaponClass: 'fixture-ranged',
    optimalRange: 100,
    classification: 'kinetic',
    modes: [
      { mode: 'single', maxShots: 1 },
      { mode: 'short-burst', maxShots: 3 },
      { mode: 'full-auto', maxShots: 12 },
    ],
    damage: { source: fixtureSource, expression: { count: 1, sides: 10, modifier: 0 } },
    penetration: { source: fixtureSource, value: 0 },
    compatibleAmmoTypes: ['fixture-ammo'],
    compatibleContainerTypes: ['fixture-magazine'],
    capacityReference: fixtureSource,
    reload: { odCost: 1, source: fixtureSource },
    malfunction: 'generic-jam',
    ...overrides,
  };
  return {
    id: `gun:${actorId}`,
    owner: { actorId },
    readied: true,
    template: {
      id: `template:${actorId}`,
      canonical: {
        releaseId: 'fixture-release',
        templateId: `template:${actorId}`,
        templateVersion: 'fixture-v1',
      },
      profile,
      effects: [],
      properties: [],
      provenance: fixtureProvenance,
    },
    modifications: [],
    loadedContainerId: `mag:${actorId}`,
    jammed: false,
  };
}

export function b1State(ns = 40, lv = 50): CombatActionState {
  const ids = ['A', 'B', 'C'];
  const session = createCombatSession(
    'B1-combat',
    'fixture-release',
    ids.map((actorId) => ({
      actor: { actorId },
      agilityBonus: 0,
      reactions: { capacity: 1, remaining: 1 },
    })),
    createSequenceDice([10, 6, 3].map((value) => ({ sides: 10, value }))),
  ).result;
  const actors = Object.fromEntries(
    ids.map((actorId): [string, CombatActorRuntime] => [
      actorId,
      {
        actor: { actorId },
        characteristics: {
          НС: { baseValue: ns, baseSuper: 0 },
          ЛВ: { baseValue: lv, baseSuper: 0 },
        },
        movement: 8,
        fatigue: 0,
        posture: 'standing',
        effects: [],
      },
    ]),
  );
  const weapons = Object.fromEntries(ids.map((id) => [`gun:${id}`, weapon(id)]));
  const containers = Object.fromEntries(
    ids.map((actorId) => [
      `mag:${actorId}`,
      {
        id: `mag:${actorId}`,
        type: 'fixture-magazine',
        compatibleWeaponTemplateIds: [`template:${actorId}`],
        capacity: 30,
        currentRounds: 30,
        ammo: { source: fixtureSource, type: 'fixture-ammo', effects: [] },
        state: 'ready' as const,
        provenance: fixtureProvenance,
      },
    ]),
  );
  return beginActionTurn(createActionState(session, actors, weapons, containers)).state;
}

export function action(id: string, type: ActionRequest['type'], actorId = 'A'): ActionRequest {
  return { id, type, actor: { actorId }, context: emptyActionContext({ actorId }) };
}

export function advanceToNextOwnTurn(initial: CombatActionState): CombatActionState {
  let state = initial;
  if (state.session.phase === 'turn-active') state = finishActionTurn(state).state;
  while (state.session.phase !== 'round-ended')
    state = finishActionTurn(beginActionTurn(state).state).state;
  return beginActionTurn(beginActionRound(state).state).state;
}

export function attack(
  id = 'shot',
  changes: Partial<RangedAttackRequest> = {},
): RangedAttackRequest {
  return {
    ...action(id, 'ranged-attack'),
    type: 'ranged-attack',
    target: { actorId: 'B' },
    weaponId: 'gun:A',
    mode: 'single',
    shotsRequested: 1,
    distance: 100,
    dodgeable: true,
    ...changes,
  };
}

export function dice(...rolls: readonly { readonly sides: number; readonly value: number }[]) {
  return createSequenceDice(rolls);
}

export function extraEffect(
  id: string,
  value: number,
  changes: Partial<EffectInstance['definition']> = {},
  actorId = 'A',
): EffectInstance {
  return { ...effect(id, value, changes), targetActor: { actorId } };
}

export function expectUnchangedOnError(
  state: CombatActionState,
  operation: (state: CombatActionState) => unknown,
) {
  const frozen = deepFreeze(state);
  const before = JSON.stringify(frozen);
  let failed = false;
  let caught: unknown;
  try {
    operation(frozen);
  } catch (error) {
    failed = true;
    caught = error;
  }
  if (JSON.stringify(frozen) !== before) throw new Error('Original combat snapshot mutated');
  if (failed) throw caught;
}
