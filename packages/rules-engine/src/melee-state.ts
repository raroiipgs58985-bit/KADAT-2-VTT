import type {
  ActionDefinition,
  ActionRequest,
  CombatActionState,
  MeleeActorState,
  MeleeRuntimeState,
  MeleeWeaponInstance,
} from '@kadat/contracts';
import { integer } from './validation.js';

export function requireMelee(state: CombatActionState): MeleeRuntimeState {
  if (!state.melee) throw new Error('Melee runtime not initialized');
  return state.melee;
}

export function initializeMeleeState(
  state: CombatActionState,
  actors: Readonly<Record<string, MeleeActorState>>,
  weapons: Readonly<Record<string, MeleeWeaponInstance>>,
): CombatActionState {
  if (state.melee) throw new Error('Melee runtime already initialized');
  for (const [id, actor] of Object.entries(actors)) {
    if (
      !state.actors[id] ||
      !state.session.initiativeOrder.some((entry) => entry.actor.actorId === id)
    )
      throw new Error('Unknown melee participant');
    integer(actor.sizeCategory, 'size category', 0);
    integer(actor.meleeOnlyReactionRemaining, 'melee-only Reaction', 0);
    if (actor.meleeOnlyReactionRemaining > 1) throw new Error('Only one defensive extra Reaction');
    if (!['standard', 'defensive', 'palisade'].includes(actor.stance))
      throw new Error('Invalid stance');
    const weapon = weapons[actor.weaponId];
    if (!weapon || weapon.owner.actorId !== id) throw new Error('Missing/mismatched melee weapon');
  }
  return {
    ...state,
    melee: {
      actors: { ...actors },
      weapons: { ...weapons },
      grapples: [],
      counterattacks: [],
      feints: [],
      temporary: [],
      followups: [],
    },
  };
}

export function validateMeleeRuntimeAction(
  state: CombatActionState,
  request: ActionRequest,
  action: ActionDefinition,
): void {
  if (!state.melee) return;
  const relation = state.melee.grapples.find((entry) =>
    [entry.controller.actorId, entry.victim.actorId].includes(request.actor.actorId),
  );
  if (
    relation &&
    (!request.type.startsWith('grapple-') ||
      action.reactionCost > 0 ||
      ['dodge', 'parry'].includes(request.type))
  )
    throw new Error('Grappled participants cannot use Reactions or non-Grapple actions');
  if (state.melee.actors[request.actor.actorId]?.stance === 'palisade' && request.type === 'run')
    throw new Error('Palisade prohibits Run');
  if (
    action.attack &&
    state.session.activeActor?.actorId === request.actor.actorId &&
    state.session.turn?.flags.includes('grapple-escape:no-attack')
  )
    throw new Error('Escape/Slip follow-up cannot attack');
}

export function refreshMeleeTurn(state: CombatActionState, actorId: string): CombatActionState {
  const melee = state.melee;
  const actor = melee?.actors[actorId];
  if (!melee || !actor) return state;
  const expiring = melee.temporary.filter((entry) => entry.actor.actorId === actorId);
  const ids = expiring.flatMap((entry) => entry.effectIds);
  const runtime = state.actors[actorId];
  if (!runtime) throw new Error('Unknown melee actor');
  return {
    ...state,
    actors: {
      ...state.actors,
      [actorId]: {
        ...runtime,
        effects: runtime.effects.filter((effect) => !ids.includes(effect.id)),
      },
    },
    melee: {
      ...melee,
      actors: {
        ...melee.actors,
        [actorId]: { ...actor, meleeOnlyReactionRemaining: 1, palisadeSpent: false },
      },
      temporary: melee.temporary.filter((entry) => entry.actor.actorId !== actorId),
    },
  };
}

export function updateMeleeActor(
  state: CombatActionState,
  actorId: string,
  actor: MeleeActorState,
): CombatActionState {
  const melee = requireMelee(state);
  return { ...state, melee: { ...melee, actors: { ...melee.actors, [actorId]: actor } } };
}
