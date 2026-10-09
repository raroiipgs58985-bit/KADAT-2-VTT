import type {
  CanonicalDuration,
  EffectInstance,
  Provenance,
  WoundCondition,
  WoundRuntimeState,
  ActorReference,
  ConditionInstance,
} from '@kadat/contracts';
import { applyStunned } from './conditions.js';
import { woundEffect, woundIntent } from './wound-state.js';
import { integer } from './validation.js';

export function addWoundEffects(
  state: WoundRuntimeState,
  actor: ActorReference,
  effects: readonly EffectInstance[],
): WoundRuntimeState {
  const runtime = state.combat.actors[actor.actorId]!;
  const existing = new Set(runtime.effects.map((e) => e.id));
  if (effects.some((e) => existing.has(e.id))) throw new Error('Wound Effect ID collision');
  return {
    ...state,
    combat: {
      ...state.combat,
      actors: {
        ...state.combat.actors,
        [actor.actorId]: { ...runtime, effects: [...runtime.effects, ...effects] },
      },
    },
  };
}
export function planWoundCondition(
  state: WoundRuntimeState,
  actor: ActorReference,
  id: string,
  type: string,
  provenance: Provenance,
  duration?: CanonicalDuration,
  removal: WoundCondition['removal'] = 'source-resolved',
): {
  state: WoundRuntimeState;
  condition: WoundCondition | ConditionInstance;
  effects: readonly EffectInstance[];
} {
  const session = state.combat.session,
    wound = state.actors[actor.actorId]!;
  if (duration) {
    integer(duration.amount, 'condition duration', 1);
    if (!['round', 'minute', 'hour', 'day'].includes(duration.unit))
      throw new Error('Unsupported canonical duration unit');
  }
  if (duration?.unit === 'round' && type === 'Stunned') {
    const r = applyStunned(session, {
      id,
      actor,
      source: provenance.source,
      provenance,
      durationRounds: duration.amount,
    });
    const condition = r.result.conditions.find(
      (c) => c.type === 'Stunned' && c.actor.actorId === actor.actorId,
    )!;
    return {
      state: { ...state, combat: { ...state.combat, session: r.result } },
      condition,
      effects: condition.effects,
    };
  }
  const restricted = ['Stunned', 'Unconscious', 'Helpless', 'Dead'].includes(type);
  const effects: EffectInstance[] = restricted
    ? (['action', 'reaction'] as const).map((permission) => {
        const effect = woundEffect(
          `${id}:${permission}`,
          actor,
          `condition:${type}`,
          1,
          provenance,
        );
        return {
          ...effect,
          definition: {
            ...effect.definition,
            target: { kind: 'permission', permission },
            operation: 'restrict',
          },
        };
      })
    : [];
  if (wound.conditions.some((c) => c.id === id)) throw new Error('Wound condition ID collision');
  if (duration?.unit === 'round') {
    const condition: ConditionInstance = {
      id,
      type,
      actor,
      sources: [provenance.source],
      provenance: [provenance],
      stackingRule: 'REJECT',
      effects,
      unit: 'round',
      appliedRound: session.roundNumber,
      durationRounds: duration.amount,
      expiresAfterRound: session.roundNumber + duration.amount - 1,
    };
    integer(condition.expiresAfterRound, 'wound condition expiry', 1);
    return {
      state: {
        ...state,
        combat: {
          ...state.combat,
          session: { ...session, conditions: [...session.conditions, condition] },
        },
      },
      condition,
      effects,
    };
  }
  const condition: WoundCondition = {
    id,
    type,
    actor,
    sources: [provenance.source],
    provenance: [provenance],
    effects,
    duration: duration ?? null,
    appliedRound: session.roundNumber,
    appliedTurn: session.turn?.turnNumber ?? session.turnsStarted,
    removal,
  };
  let next = addWoundEffects(state, actor, effects);
  if (type === 'Prone') {
    const runtime = next.combat.actors[actor.actorId]!;
    next = {
      ...next,
      combat: {
        ...next.combat,
        actors: { ...next.combat.actors, [actor.actorId]: { ...runtime, posture: 'prone' } },
      },
    };
  }
  const intent = duration
    ? woundIntent(
        `${id}:timed`,
        'TimedConditionIntent',
        actor,
        provenance,
        'Preserve canonical duration; caller time integration must resolve expiry without converting to rounds',
        { duration, effects },
      )
    : null;
  next = {
    ...next,
    actors: {
      ...next.actors,
      [actor.actorId]: {
        ...next.actors[actor.actorId]!,
        conditions: [...wound.conditions, condition],
        intents: [...wound.intents, ...(intent ? [intent] : [])],
      },
    },
  };
  return { state: next, condition, effects };
}
export function removeWoundCondition(
  state: WoundRuntimeState,
  actor: ActorReference,
  id: string,
  method: 'source-resolved' | 'blood-replacement' | 'ordinary-drug' | 'willpower',
): WoundRuntimeState {
  const wound = state.actors[actor.actorId]!;
  const condition = wound.conditions.find((c) => c.id === id);
  if (!condition) throw new Error('Unknown wound condition');
  if (condition.removal === 'blood-replacement' && method !== 'blood-replacement')
    throw new Error('Blood-loss Stunned requires blood replacement');
  const ids = new Set(condition.effects.map((e) => e.id)),
    runtime = state.combat.actors[actor.actorId]!;
  return {
    ...state,
    actors: {
      ...state.actors,
      [actor.actorId]: {
        ...wound,
        conditions: wound.conditions.filter((c) => c !== condition),
        intents: wound.intents.filter((i) => i.id !== `${id}:timed`),
      },
    },
    combat: {
      ...state.combat,
      actors: {
        ...state.combat.actors,
        [actor.actorId]: { ...runtime, effects: runtime.effects.filter((e) => !ids.has(e.id)) },
      },
    },
  };
}
