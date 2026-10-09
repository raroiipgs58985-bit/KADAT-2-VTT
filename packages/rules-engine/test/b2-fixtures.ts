import type {
  CombatActionState,
  ActionRequest,
  MeleeActorState,
  MeleeAttackRequest,
  MeleeProfile,
  MeleeWeaponInstance,
  GrappleActionRequest,
  GrappleAction,
} from '@kadat/contracts';
import {
  initializeMeleeState,
  emptyActionContext,
  beginActionTurn,
  finishActionTurn,
} from '../src/index.js';
import {
  b1State,
  action as baseAction,
  fixtureSource,
  fixtureProvenance,
  dice,
} from './b1-fixtures.js';
export { dice, fixtureSource, fixtureProvenance };
export function action<T extends ActionRequest['type']>(
  id: string,
  type: T,
  actorId = 'A',
): ActionRequest & { readonly type: T } {
  return { ...baseAction(id, type, actorId), type };
}
export function meleeWeapon(id: string, changes: Partial<MeleeProfile> = {}): MeleeWeaponInstance {
  return {
    id: `blade:${id}`,
    owner: { actorId: id },
    held: true,
    readied: true,
    dropped: false,
    modifications: [],
    template: {
      id: `blade-template:${id}`,
      canonical: {
        releaseId: 'fixture-release',
        templateId: `blade-template:${id}`,
        templateVersion: 'v1',
      },
      provenance: fixtureProvenance,
      effects: [],
      profile: {
        source: fixtureSource,
        family: 'sword',
        handedness: 'one-handed',
        validGrips: ['one-handed', 'two-handed', 'close', 'fist', 'mordhau'],
        reach: 3,
        damage: { source: fixtureSource, expression: { count: 2, sides: 10, modifier: 3 } },
        penetration: { source: fixtureSource, value: 0 },
        parryEligible: true,
        properties: [],
        ...changes,
      },
    },
  };
}
export function meleeState(nr = 50): CombatActionState {
  const base = b1State();
  const actors = Object.fromEntries(
    Object.entries(base.actors).map(([id, actor]) => [
      id,
      {
        ...actor,
        characteristics: {
          ...actor.characteristics,
          НР: { baseValue: nr, baseSuper: 0 },
          СЛ: { baseValue: 50, baseSuper: 0 },
        },
      },
    ]),
  );
  const meleeActors: Record<string, MeleeActorState> = Object.fromEntries(
    ['A', 'B', 'C'].map((id) => [
      id,
      {
        weaponId: `blade:${id}`,
        stance: 'standard',
        grip: 'one-handed',
        sizeCategory: 1,
        skills: {
          athletics: { baseValue: 50, finalSuper: 0, provenance: fixtureProvenance },
          acrobatics: { baseValue: 50, finalSuper: 0, provenance: fixtureProvenance },
        },
        meleeOnlyReactionRemaining: 1,
        palisadeSpent: false,
      },
    ]),
  );
  return initializeMeleeState(
    { ...base, actors },
    meleeActors,
    Object.fromEntries(['A', 'B', 'C'].map((id) => [`blade:${id}`, meleeWeapon(id)])),
  );
}
export function meleeAttack(changes: Partial<MeleeAttackRequest> = {}): MeleeAttackRequest {
  return {
    ...action('melee', 'melee-attack'),
    type: 'melee-attack',
    origin: 'NORMAL',
    base: 'simple',
    technique: 'normal',
    weaponId: 'blade:A',
    targets: [{ actor: { actorId: 'B' }, distance: 1 }],
    ...changes,
  };
}
export function editMelee(
  state: CombatActionState,
  id: string,
  changes: Partial<MeleeActorState>,
): CombatActionState {
  return {
    ...state,
    melee: {
      ...state.melee!,
      actors: { ...state.melee!.actors, [id]: { ...state.melee!.actors[id]!, ...changes } },
    },
  };
}
export function setWeapon(
  state: CombatActionState,
  id: string,
  weapon: MeleeWeaponInstance,
): CombatActionState {
  return {
    ...state,
    melee: { ...state.melee!, weapons: { ...state.melee!.weapons, [id]: weapon } },
  };
}
export function onBTurn(state: CombatActionState): CombatActionState {
  return beginActionTurn(finishActionTurn(state).state).state;
}
export function grappleState(): CombatActionState {
  const state = meleeState();
  return {
    ...state,
    melee: {
      ...state.melee!,
      grapples: [
        {
          id: 'grapple',
          controller: { actorId: 'A' },
          victim: { actorId: 'B' },
          thrownAdvantage: false,
          provenance: fixtureProvenance,
        },
      ],
    },
  };
}
export function grappleRequest(
  type: GrappleAction,
  actorId = 'A',
  changes: Partial<GrappleActionRequest> = {},
): GrappleActionRequest {
  return {
    ...action(type, type, actorId),
    type,
    relationId: 'grapple',
    opponentContext: emptyActionContext({ actorId: actorId === 'A' ? 'B' : 'A' }),
    ...changes,
  };
}
export function rolls(...values: number[]) {
  return dice(...values.map((value) => ({ sides: 100, value })));
}
