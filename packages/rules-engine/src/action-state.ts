import type {
  ActorReference,
  CombatActionState,
  CombatActorRuntime,
  CombatLogEntry,
  CombatSession,
  ResolutionContext,
} from '@kadat/contracts';
import { startTurn, endTurn, startNextRound, validateSession } from './combat.js';
import { sessionLog } from './log.js';
import { integer, uniqueIds } from './validation.js';
import { refreshMeleeTurn } from './melee-state.js';

export function validateActionState(state: CombatActionState): void {
  validateSession(state.session);
  uniqueIds(state.completedActionIds, 'completed action IDs');
  for (const entry of state.session.initiativeOrder) {
    const actor = state.actors[entry.actor.actorId];
    if (!actor || actor.actor.actorId !== entry.actor.actorId)
      throw new Error('Missing/mismatched combat actor');
    integer(actor.fatigue, 'fatigue', 0);
    if (!Number.isFinite(actor.movement) || actor.movement <= 0)
      throw new Error('Invalid movement value');
  }
  if (state.session.turn) {
    integer(state.session.turn.od, 'remaining OD', 0);
    const entry = state.session.initiativeOrder[state.session.cursor];
    if (
      entry?.reactions.remaining !== state.session.turn.reactions.remaining ||
      entry?.reactions.capacity !== state.session.turn.reactions.capacity
    )
      throw new Error('Inconsistent turn Reaction pool');
  }
}

export function createActionState(
  session: CombatSession,
  actors: CombatActionState['actors'],
  weapons: CombatActionState['weapons'],
  containers: CombatActionState['containers'],
): CombatActionState {
  const state: CombatActionState = {
    session,
    actors: { ...actors },
    weapons: { ...weapons },
    containers: { ...containers },
    completedActionIds: [],
  };
  validateActionState(state);
  return state;
}

export function clearTransient(
  actor: CombatActorRuntime,
  keys: readonly ('aim' | 'wait' | 'overwatch')[],
): CombatActorRuntime {
  return {
    actor: actor.actor,
    characteristics: actor.characteristics,
    movement: actor.movement,
    fatigue: actor.fatigue,
    posture: actor.posture,
    effects: actor.effects,
    ...(actor.aim && !keys.includes('aim') ? { aim: actor.aim } : {}),
    ...(actor.wait && !keys.includes('wait') ? { wait: actor.wait } : {}),
    ...(actor.overwatch && !keys.includes('overwatch') ? { overwatch: actor.overwatch } : {}),
  };
}

export function updateActor(
  state: CombatActionState,
  actor: CombatActorRuntime,
): CombatActionState {
  return { ...state, actors: { ...state.actors, [actor.actor.actorId]: actor } };
}

export function emptyActionContext(actor: ActorReference): ResolutionContext {
  return { actor, tags: [], effects: [], modifiers: [], overrides: [] };
}

export function beginActionTurn(state: CombatActionState): {
  readonly state: CombatActionState;
  readonly logs: readonly CombatLogEntry[];
} {
  validateActionState(state);
  const started = startTurn(state.session);
  const actorId = started.result.activeActor?.actorId;
  if (!actorId) throw new Error('Missing active actor');
  const actor = state.actors[actorId];
  if (!actor) throw new Error('Unknown active actor');
  const next = refreshMeleeTurn(
    updateActor(
      { ...state, session: started.result },
      clearTransient(actor, ['wait', 'overwatch']),
    ),
    actorId,
  );
  const expiration = sessionLog('action-expiration', started.result, {
    combatSessionId: state.session.id,
    mutations: [
      ...(state.melee
        ? [
            {
              type: 'melee-turn-refresh',
              actor: actor.actor,
              path: `melee.actors.${actorId}`,
              before: state.melee.actors[actorId],
              after: next.melee?.actors[actorId],
            },
            {
              type: 'melee-temporary-expiration',
              actor: actor.actor,
              path: `actors.${actorId}.effects`,
              before: actor.effects,
              after: next.actors[actorId]?.effects,
            },
          ]
        : []),
      ...(actor.wait
        ? [
            {
              type: 'wait-expire',
              actor: actor.actor,
              path: `actors.${actorId}.wait`,
              before: actor.wait,
              after: null,
            },
          ]
        : []),
      ...(actor.overwatch
        ? [
            {
              type: 'overwatch-expire',
              actor: actor.actor,
              path: `actors.${actorId}.overwatch`,
              before: actor.overwatch,
              after: null,
            },
          ]
        : []),
    ],
  });
  return { state: next, logs: [started.log, expiration] };
}

export function finishActionTurn(state: CombatActionState): {
  readonly state: CombatActionState;
  readonly logs: readonly CombatLogEntry[];
} {
  validateActionState(state);
  if (
    state.melee?.followups.some(
      (entry) => !entry.spent && entry.actor.actorId === state.session.activeActor?.actorId,
    )
  )
    throw new Error('Resolve the immediate Grapple follow-up before ending the turn');
  const ended = endTurn(state.session);
  return { state: { ...state, session: ended.result }, logs: [ended.log] };
}

export function beginActionRound(state: CombatActionState): {
  readonly state: CombatActionState;
  readonly logs: readonly CombatLogEntry[];
} {
  validateActionState(state);
  const next = startNextRound(state.session);
  return { state: { ...state, session: next.result }, logs: [next.log] };
}
