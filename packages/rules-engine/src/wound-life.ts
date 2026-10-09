import type {
  ActorReference,
  Provenance,
  WoundRuntimeState,
  DiceSource,
  StabilizationRequest,
} from '@kadat/contracts';
import { planWoundCondition } from './wound-conditions.js';
import { woundIntent, woundProvenance, woundContext, validateWoundRuntime } from './wound-state.js';
import { resolveCheck } from './checks.js';
import { resolutionLog } from './log.js';
import { integer } from './validation.js';
export function planDeath(
  state: WoundRuntimeState,
  actor: ActorReference,
  bVN: number,
  provenance: Provenance,
  destroyed: 'HEAD' | 'TORSO' | null,
) {
  integer(bVN, 'Agony bVN', 0);
  let next = state,
    blocked = false;
  const wound = state.actors[actor.actorId]!,
    round = state.combat.session.roundNumber;
  if (wound.life.status === 'DEAD') return { state, blocked: false };
  if (destroyed) {
    next = planWoundCondition(
      next,
      actor,
      `${actor.actorId}:death:${round}`,
      'Dead',
      provenance,
    ).state;
    next = {
      ...next,
      actors: {
        ...next.actors,
        [actor.actorId]: {
          ...next.actors[actor.actorId]!,
          life: {
            status: 'DEAD',
            source: provenance.source,
            provenance,
            round,
            reason: `Destroyed ${destroyed}`,
          },
        },
      },
    };
  } else if (wound.life.status === 'ALIVE') {
    const durationRounds = 2 * bVN;
    if (durationRounds === 0) {
      blocked = true;
      const intent = woundIntent(
        `${actor.actorId}:zero-agony`,
        'DurationInterpretationRequired',
        actor,
        provenance,
        'Agony formula gives zero rounds; no substitute duration is inferred',
        { duration: { unit: 'round', amount: 0 } },
      );
      next = {
        ...next,
        actors: {
          ...next.actors,
          [actor.actorId]: { ...wound, intents: [...wound.intents, intent] },
        },
      };
    } else {
      integer(round + durationRounds - 1, 'Agony expiry', 1);
      next = planWoundCondition(
        next,
        actor,
        `${actor.actorId}:agony:${round}`,
        'Agony',
        provenance,
        { unit: 'round', amount: durationRounds },
      ).state;
      next = {
        ...next,
        actors: {
          ...next.actors,
          [actor.actorId]: {
            ...next.actors[actor.actorId]!,
            life: {
              status: 'AGONY',
              source: provenance.source,
              provenance,
              startedRound: round,
              durationRounds,
              expiresAfterRound: round + durationRounds - 1,
            },
          },
        },
      };
    }
  }
  return { state: next, blocked };
}
export function resolveWoundRoundEnd(state: WoundRuntimeState) {
  validateWoundRuntime(state);
  if (state.combat.session.phase !== 'round-ended')
    throw new Error('Agony expiry requires a completed global round');
  let next = state;
  for (const wound of Object.values(state.actors))
    if (
      wound.life.status === 'AGONY' &&
      wound.life.expiresAfterRound <= state.combat.session.roundNumber
    ) {
      const { life } = wound;
      next = planWoundCondition(
        next,
        wound.actor,
        `${wound.actor.actorId}:agony-death`,
        'Dead',
        life.provenance,
      ).state;
      next = {
        ...next,
        actors: {
          ...next.actors,
          [wound.actor.actorId]: {
            ...next.actors[wound.actor.actorId]!,
            life: {
              status: 'DEAD',
              source: life.source,
              provenance: life.provenance,
              round: state.combat.session.roundNumber,
              reason: 'Agony ended',
            },
          },
        },
      };
    }
  return {
    state: next,
    log: resolutionLog(
      'wound-round-end',
      {
        actor: { actorId: 'combat-session' },
        roundNumber: state.combat.session.roundNumber,
        tags: [],
        effects: [],
        modifiers: [],
        overrides: [],
      },
      {
        combatSessionId: state.combat.session.id,
        actors: Object.values(state.actors).map((a) => a.actor),
        mutations:
          next === state
            ? []
            : [
                {
                  type: 'wound-life',
                  path: 'wounds.actors',
                  before: state.actors,
                  after: next.actors,
                },
              ],
      },
    ),
  };
}
export function resolveStabilization(
  state: WoundRuntimeState,
  request: StabilizationRequest,
  source: DiceSource,
) {
  validateWoundRuntime(state);
  const target = state.actors[request.target.actorId];
  if (target?.life.status !== 'AGONY') throw new Error('Stabilization requires Agony');
  if (!request.medKit?.id.trim()) throw new Error('Stabilization requires med kit');
  if (!request.id.trim() || state.combat.completedActionIds.includes(request.id))
    throw new Error('Repeated/empty stabilization ID');
  const context = woundContext(state, request.actor, request.context),
    provenance = woundProvenance('Medica -30 with med kit');
  const modifier = {
    id: 'wounds:stabilization',
    value: -30,
    source: provenance.source,
    provenance,
  };
  if (context.overrides.some((o) => o.subject === 'modifier' && o.id === modifier.id))
    throw new Error('Cannot override canonical stabilization modifier');
  const checked = resolveCheck(
    {
      baseValue: request.medica.baseValue,
      finalSuper: request.medica.finalSuper,
      context: { ...context, modifiers: [...context.modifiers, modifier] },
    },
    source,
  );
  const durationHours = checked.result.outcome === 'success' ? checked.result.totalDegrees : null;
  let next: WoundRuntimeState = {
    ...state,
    combat: {
      ...state.combat,
      completedActionIds: [...state.combat.completedActionIds, request.id],
    },
  };
  if (durationHours !== null) {
    const intent = woundIntent(
      `${request.id}:follow-up`,
      'StabilizedFollowupIntent',
      request.target,
      provenance,
      'Post-stabilization behavior requires a later canonical decision',
      { duration: { unit: 'hour', amount: durationHours } },
    );
    next = {
      ...next,
      actors: {
        ...next.actors,
        [request.target.actorId]: {
          ...target,
          life: {
            status: 'STABILIZED',
            source: provenance.source,
            provenance,
            durationHours,
            priorAgony: target.life,
          },
          intents: [...target.intents, intent],
        },
      },
      combat: {
        ...next.combat,
        session: {
          ...next.combat.session,
          conditions: next.combat.session.conditions.filter(
            (c) => c.type !== 'Agony' || c.actor.actorId !== request.target.actorId,
          ),
        },
      },
    };
  }
  return {
    state: next,
    result: { check: checked.result, durationHours },
    logs: [
      checked.log,
      resolutionLog('stabilization', context, {
        stabilization: { request, check: checked.result, durationHours },
        mutations:
          next === state
            ? []
            : [
                {
                  type: 'stabilization',
                  actor: request.target,
                  path: `wounds.${request.target.actorId}.life`,
                  before: target.life,
                  after: next.actors[request.target.actorId]!.life,
                },
              ],
      }),
    ],
  };
}
