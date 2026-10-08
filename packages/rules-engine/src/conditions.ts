import type {
  ActorReference,
  CombatSession,
  ConditionInstance,
  EffectInstance,
  LoggedResult,
  Provenance,
  ResolutionContext,
  SourceReference,
  Stunned,
} from '@kadat/contracts';
import { resolveEffects, validateDuration } from './context.js';
import { sessionLog } from './log.js';
import { integer, uniqueIds } from './validation.js';

export function remainingRounds(condition: ConditionInstance, roundNumber: number): number {
  validateDuration(condition);
  integer(roundNumber, 'current round', 1);
  if (roundNumber < condition.appliedRound) return 0;
  return Math.max(0, condition.expiresAfterRound - roundNumber + 1);
}

/** Called at round END, not at its start. Works independently of condition type. */
export function expireConditions(
  conditions: readonly ConditionInstance[],
  roundNumber: number,
): {
  readonly remaining: readonly ConditionInstance[];
  readonly removed: readonly ConditionInstance[];
} {
  integer(roundNumber, 'ending round', 1);
  uniqueIds(
    conditions.map((condition) => condition.id),
    'condition IDs',
  );
  for (const condition of conditions) validateDuration(condition);
  return {
    remaining: conditions.filter((condition) => condition.expiresAfterRound > roundNumber),
    removed: conditions.filter((condition) => condition.expiresAfterRound <= roundNumber),
  };
}

export interface StunnedApplication {
  readonly id: string;
  readonly actor: ActorReference;
  readonly source: SourceReference;
  readonly provenance: Provenance;
  readonly durationRounds: number;
  /** Canonical combat bonuses are caller-supplied data; this kernel invents no number. */
  readonly additionalEffects?: readonly EffectInstance[];
}

function restriction(
  id: string,
  permission: 'action' | 'reaction',
  application: StunnedApplication,
): EffectInstance {
  return {
    id: `${id}:${permission}`,
    source: application.source,
    targetActor: application.actor,
    provenance: application.provenance,
    definition: {
      id: `Stunned:${permission}`,
      target: { kind: 'permission', permission },
      operation: 'restrict',
      value: 1,
      stage: 'temporary',
      stackingGroup: `Stunned:${permission}`,
      stackingRule: 'independent',
      tags: ['Stunned'],
      provenance: application.provenance,
    },
  };
}

export function applyStunned(
  session: CombatSession,
  application: StunnedApplication,
): LoggedResult<CombatSession> {
  integer(session.roundNumber, 'application round', 1);
  integer(application.durationRounds, 'Stunned duration', 1);
  if (!application.id.trim()) throw new Error('Condition ID is required');
  if (session.phase === 'round-ended')
    throw new Error('Cannot apply a condition to an ended round');
  if (!session.initiativeOrder.some((entry) => entry.actor.actorId === application.actor.actorId)) {
    throw new Error('Condition target is not a participant');
  }
  uniqueIds(
    session.conditions.map((condition) => condition.id),
    'condition IDs',
  );
  const existing = session.conditions.filter(
    (condition) =>
      condition.type === 'Stunned' && condition.actor.actorId === application.actor.actorId,
  );
  if (existing.length > 1) throw new Error('Multiple unmerged Stunned conditions');
  const prior = existing[0];
  if (
    prior &&
    (prior.stackingRule !== 'ADD_DURATION' || remainingRounds(prior, session.roundNumber) === 0)
  ) {
    throw new Error('Invalid Stunned state to stack');
  }
  if (
    session.conditions.some((condition) => condition.id === application.id && condition !== prior)
  )
    throw new Error('Condition ID collision');
  const id = prior?.id ?? application.id;
  const appliedRound = prior?.appliedRound ?? session.roundNumber;
  const durationRounds = (prior?.durationRounds ?? 0) + application.durationRounds;
  const expiresAfterRound = appliedRound + durationRounds - 1;
  integer(expiresAfterRound, 'Stunned expiry', 1);
  const additionalEffects = application.additionalEffects ?? [];
  if (
    additionalEffects.some((effect) => effect.targetActor.actorId !== application.actor.actorId)
  ) {
    throw new Error('Stunned effect targets another actor');
  }
  const effects = prior
    ? [...prior.effects, ...additionalEffects]
    : [
        restriction(id, 'action', application),
        restriction(id, 'reaction', application),
        ...additionalEffects,
      ];
  uniqueIds(
    effects.map((effect) => effect.id),
    'condition effect IDs',
  );
  const condition: Stunned = {
    id,
    type: 'Stunned',
    actor: { ...application.actor },
    sources: [...(prior?.sources ?? []), application.source],
    provenance: [...(prior?.provenance ?? []), application.provenance],
    stackingRule: 'ADD_DURATION',
    unit: 'round',
    appliedRound,
    durationRounds,
    expiresAfterRound,
    effects,
  };
  const result: CombatSession = {
    ...session,
    conditions: [...session.conditions.filter((entry) => entry !== prior), condition],
  };
  return {
    result,
    log: sessionLog('condition', session, {
      actors: [application.actor],
      baseValues: {
        addedDuration: application.durationRounds,
        remainingDuration: remainingRounds(condition, session.roundNumber),
      },
      mutations: [
        {
          type: prior ? 'condition-stack' : 'condition-add',
          actor: application.actor,
          path: `conditions.${id}`,
          before: prior ?? null,
          after: condition,
        },
      ],
    }),
  };
}

/** A query over active condition Effect data; no hardcoded Actor boolean. */
export function isRestricted(
  conditions: readonly ConditionInstance[],
  actor: ActorReference,
  permission: 'action' | 'reaction',
  context: ResolutionContext,
): boolean {
  const roundNumber = context.roundNumber;
  if (roundNumber === undefined) throw new Error('Condition restrictions require a current round');
  const effects = conditions
    .filter(
      (condition) =>
        condition.actor.actorId === actor.actorId && remainingRounds(condition, roundNumber) > 0,
    )
    .flatMap((condition) => condition.effects);
  const resolvedContext: ResolutionContext = {
    ...context,
    effects: [...context.effects, ...effects],
  };
  const traces = resolveEffects(resolvedContext);
  return resolvedContext.effects.some((effect, index) => {
    const target = effect.definition.target;
    return (
      effect.targetActor.actorId === actor.actorId &&
      target.kind === 'permission' &&
      target.permission === permission &&
      effect.definition.operation === 'restrict' &&
      traces[index]?.included &&
      traces[index].value > 0
    );
  });
}
