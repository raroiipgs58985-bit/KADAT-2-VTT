import type {
  ActionDefinition,
  ActionExecution,
  ActionRequest,
  CombatActionState,
  ResolutionContext,
} from '@kadat/contracts';
import { resolveEffects, resolveModifiers } from './context.js';
import { resolutionLog } from './log.js';
import { clearTransient, updateActor, validateActionState } from './action-state.js';
import { integer } from './validation.js';
import { ruleSource, ruleProvenance } from './action-context.js';
import { validateMeleeRuntimeAction } from './melee-state.js';

export type ActionWindow =
  'own-turn' | 'wait' | 'reaction' | 'overwatch' | 'triggered' | 'grapple-followup';

export function definition(
  type: ActionDefinition['type'],
  odCost: number,
  reactionCost = 0,
  attack = false,
): ActionDefinition {
  return {
    type,
    odCost,
    reactionCost,
    free: odCost === 0 && reactionCost === 0,
    attack,
    prerequisites: ['participant', 'valid-window', 'sufficient-resources'],
    restrictions: ['active-effect-permissions', ...(attack ? ['attack-limit'] : [])],
    source: ruleSource,
    provenance: { ...ruleProvenance, record: type },
  };
}

export function reactionCount(state: CombatActionState, actorId: string): number {
  const entry = state.session.initiativeOrder.find(
    (candidate) => candidate.actor.actorId === actorId,
  );
  if (!entry) throw new Error('Unknown participant');
  return entry.reactions.remaining;
}

export function validateResources(
  state: CombatActionState,
  request: ActionRequest,
  action: ActionDefinition,
  context: ResolutionContext,
  window: ActionWindow,
): void {
  validateActionState(state);
  validateMeleeRuntimeAction(state, request, action);
  if (!request.id.trim() || state.completedActionIds.includes(request.id))
    throw new Error('Empty or repeated action ID');
  const runtime = state.actors[request.actor.actorId];
  if (!runtime) throw new Error('Unknown actor');
  const own =
    state.session.phase === 'turn-active' &&
    state.session.activeActor?.actorId === request.actor.actorId;
  if (window === 'own-turn' && !own) throw new Error('Action requires active own turn');
  if ((window === 'wait' || window === 'overwatch' || window === 'reaction') && own)
    throw new Error('Interrupt is outside own turn');
  if (window === 'wait' && !runtime.wait) throw new Error('No retained Wait OD');
  if (window === 'overwatch' && !runtime.overwatch)
    throw new Error('Overwatch expired or unavailable');
  const availableOd =
    window === 'wait'
      ? (runtime.wait?.retainedOd ?? 0)
      : window === 'own-turn'
        ? (state.session.turn?.od ?? 0)
        : 0;
  if (availableOd < action.odCost) throw new Error('Insufficient OD');
  if (reactionCount(state, request.actor.actorId) < action.reactionCost)
    throw new Error('Unavailable Reaction');
  const traces = resolveEffects(context);
  resolveModifiers(context); // Context validation also precedes RNG or resource commitment.
  const permissions = context.effects.filter(
    (effect, index) =>
      effect.targetActor.actorId === request.actor.actorId && traces[index]?.included,
  );
  if (
    permissions.some(
      (effect) =>
        effect.definition.target.kind === 'permission' &&
        effect.definition.operation === 'restrict' &&
        effect.definition.target.permission === 'action' &&
        (traces.find((trace) => trace.id === effect.id)?.value ?? 0) > 0,
    )
  )
    throw new Error('Action prohibited by effect');
  if (
    action.reactionCost > 0 &&
    permissions.some(
      (effect) =>
        effect.definition.target.kind === 'permission' &&
        effect.definition.operation === 'restrict' &&
        effect.definition.target.permission === 'reaction' &&
        (traces.find((trace) => trace.id === effect.id)?.value ?? 0) > 0,
    )
  )
    throw new Error('Reaction prohibited by effect');
  if (action.attack && window === 'wait' && !runtime.wait?.mayAttack)
    throw new Error('Wait cannot attack after an earlier attack');
  if (action.attack && window === 'own-turn') {
    const attacks =
      state.session.turn?.flags.filter((flag) => flag.startsWith('attack:')).length ?? 0;
    const grants = permissions.reduce(
      (total, effect) =>
        effect.definition.target.kind === 'permission' &&
        effect.definition.target.permission === 'attack' &&
        effect.definition.operation === 'grant'
          ? total + (traces.find((trace) => trace.id === effect.id)?.value ?? 0)
          : total,
      0,
    );
    integer(grants, 'additional attack grants', 0);
    if (attacks >= 1 + grants) throw new Error('Second attack requires an explicit effect');
  }
}

/** Called only after all resolution/validation has succeeded; input objects stay untouched. */
export function spendResources(
  state: CombatActionState,
  request: ActionRequest,
  action: ActionDefinition,
  context: ResolutionContext,
  window: ActionWindow,
): { readonly state: CombatActionState; readonly execution: ActionExecution } {
  validateResources(state, request, action, context, window);
  const actorId = request.actor.actorId;
  const actor = state.actors[actorId];
  if (!actor) throw new Error('Unknown actor');
  const own = state.session.activeActor?.actorId === actorId;
  const odBefore =
    window === 'wait'
      ? (actor.wait?.retainedOd ?? 0)
      : window === 'own-turn'
        ? (state.session.turn?.od ?? 0)
        : 0;
  const reactionBefore = reactionCount(state, actorId);
  const reactionAfter = reactionBefore - action.reactionCost;
  const order = state.session.initiativeOrder.map((entry) =>
    entry.actor.actorId === actorId
      ? { ...entry, reactions: { ...entry.reactions, remaining: reactionAfter } }
      : entry,
  );
  const turn = state.session.turn
    ? {
        ...state.session.turn,
        ...(own
          ? { reactions: { ...state.session.turn.reactions, remaining: reactionAfter } }
          : {}),
        ...(window === 'own-turn'
          ? {
              od: odBefore - action.odCost,
              flags: action.attack
                ? [...state.session.turn.flags, `attack:${request.id}`]
                : state.session.turn.flags,
            }
          : {}),
      }
    : null;
  let next: CombatActionState = {
    ...state,
    session: { ...state.session, initiativeOrder: order, turn },
    completedActionIds: [...state.completedActionIds, request.id],
  };
  if (window === 'wait' && actor.wait) {
    const remaining = actor.wait.retainedOd - action.odCost;
    next = updateActor(
      next,
      remaining === 0
        ? clearTransient(actor, ['wait'])
        : { ...actor, wait: { ...actor.wait, retainedOd: remaining } },
    );
  }
  const mutations = [
    ...(window === 'own-turn' || window === 'wait'
      ? [
          {
            type: 'OD-spend',
            actor: request.actor,
            path: window === 'wait' ? `actors.${actorId}.wait.retainedOd` : 'session.turn.od',
            before: odBefore,
            after: odBefore - action.odCost,
          },
        ]
      : []),
    {
      type: 'reaction-spend',
      actor: request.actor,
      path: `session.initiativeOrder.${actorId}.reactions`,
      before: reactionBefore,
      after: reactionAfter,
    },
    ...(window === 'own-turn' && action.attack
      ? [
          {
            type: 'attack-flag',
            actor: request.actor,
            path: 'session.turn.flags',
            before: state.session.turn?.flags,
            after: turn?.flags,
          },
        ]
      : []),
  ];
  const execution: ActionExecution = {
    id: request.id,
    definition: action,
    actor: request.actor,
    ...(request.target ? { target: request.target } : {}),
    context,
    odBefore,
    odAfter: odBefore - action.odCost,
    reactionBefore,
    reactionAfter,
    mutations,
  };
  return { state: next, execution };
}

export function actionLog(state: CombatActionState, execution: ActionExecution) {
  return resolutionLog(execution.definition.type, execution.context, {
    combatSessionId: state.session.id,
    action: execution,
    mutations: execution.mutations,
  });
}
