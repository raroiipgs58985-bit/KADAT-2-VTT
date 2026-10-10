import type {
  ActorReference,
  CombatLogEntry,
  DiceSource,
  ResolutionContext,
  SuppressionEquipmentState,
  WoundRuntimeState,
} from '@kadat/contracts';
import { beginActionTurn } from './action-state.js';
import { collectEquipmentEffects, equipmentEffectId } from './equipment-effects.js';
import { remainingRounds } from './conditions.js';
import { scopedContext } from './action-context.js';
import { sessionLog } from './log.js';
import { suppressionSWCheck } from './suppression.js';

/** Called once after the accepted turn start. First affected turn is tracked, not inferred from round. */
export function resolveSuppressionTurnStart(
  state: SuppressionEquipmentState,
  actor: ActorReference,
  context: ResolutionContext,
  source: DiceSource,
  wounds?: WoundRuntimeState,
) {
  if (context.actor.actorId !== actor.actorId)
    throw new Error('Suppression lifecycle context actor mismatch');
  const session = state.combat.session;
  if (
    session.phase !== 'turn-active' ||
    session.activeActor?.actorId !== actor.actorId ||
    !session.turn
  )
    throw new Error('Suppression lifecycle requires active own turn');
  const turn = session.turn.turnNumber;
  const active = state.suppressed.filter(
    (c) => c.actor.actorId === actor.actorId && remainingRounds(c, session.roundNumber) > 0,
  );
  if (active.length > 1) throw new Error('Unresolved overlapping suppression');
  const condition = active[0],
    logs: CombatLogEntry[] = [];
  if (!condition) {
    for (const expired of state.suppressed.filter(
      (c) => remainingRounds(c, session.roundNumber) === 0,
    ))
      logs.push(
        sessionLog('suppression-expiration', session, {
          suppressionLifecycle: {
            actor: expired.actor,
            conditionId: expired.id,
            operation: 'EXPIRED',
            check: null,
          },
        }),
      );
    return {
      status: 'RESOLVED' as const,
      state: {
        ...state,
        suppressed: state.suppressed.filter((c) => remainingRounds(c, session.roundNumber) > 0),
      },
      logs,
      pending: [],
    };
  }
  if (condition.lastRemovalTurn === turn || condition.firstAffectedTurn === turn)
    throw new Error('Suppression turn already processed');
  const collected = collectEquipmentEffects(
    state.equipment,
    scopedContext(state.combat, actor, context, [], ['check:suppression']),
  );
  logs.push(collected.log);
  if (collected.status === 'PENDING')
    return { status: 'PENDING' as const, state, logs, pending: collected.pending };
  const immunity = collected.capabilities.filter(
    (t) =>
      t.effect.payload.kind === 'SUPPRESSION_IMMUNITY' ||
      (t.effect.payload.kind === 'CHECK_IMMUNITY' && t.effect.payload.scope === 'suppression'),
  );
  if (immunity.length) {
    // Ignore tests, but do not invent retroactive removal of an already active condition.
    const pending: import('@kadat/contracts').SuppressionImmunityRemovalPending = {
      type: 'SuppressionImmunityRemovalPending',
      actor,
      conditionId: condition.id,
      effectIds: immunity.map((t) => equipmentEffectId(t.effect)),
      provenance: [...condition.provenance, ...immunity.map((t) => t.effect.provenance)],
    };
    logs.push(
      sessionLog('suppression-immunity-removal-pending', session, {
        suppressionLifecycle: {
          actor,
          conditionId: condition.id,
          operation: 'PENDING',
          check: null,
          pending,
        },
      }),
    );
    return { status: 'PENDING' as const, state, logs, pending: [pending] };
  }
  let updated = condition,
    removed = false;
  if (condition.firstAffectedTurn === null) {
    updated = { ...condition, firstAffectedTurn: turn };
    logs.push(
      sessionLog('suppression-first-turn', session, {
        suppressionLifecycle: {
          actor,
          conditionId: condition.id,
          operation: 'FIRST_TURN',
          check: null,
        },
      }),
    );
  } else {
    // Removal remains the explicit SW+0 rule, without the original attack penalty or OD cost.
    const checked = suppressionSWCheck(state, collected.context, source, wounds);
    logs.push(...checked.logs);
    removed = checked.result.outcome === 'success';
    updated = { ...condition, lastRemovalTurn: turn };
    logs.push(
      sessionLog('suppression-removal', session, {
        suppressionLifecycle: {
          actor,
          conditionId: condition.id,
          operation: 'REMOVAL_CHECK',
          check: checked.result,
        },
        mutations: removed
          ? [
              {
                type: 'condition-remove',
                actor,
                path: `session.conditions.${condition.id}`,
                before: condition,
                after: null,
              },
            ]
          : [],
      }),
    );
  }
  const od = removed ? session.turn.od : Math.min(1, session.turn.od);
  logs.push(
    sessionLog('suppression-turn-budget', session, {
      mutations: [
        {
          type: 'suppressed-OD-cap',
          actor,
          path: 'session.turn.od',
          before: session.turn.od,
          after: od,
        },
      ],
    }),
  );
  const replace = (c: typeof condition) => (c.id === condition.id ? updated : c);
  const next = {
    ...state,
    suppressed: state.suppressed.filter((c) => c.id !== condition.id || !removed).map(replace),
    combat: {
      ...state.combat,
      session: {
        ...session,
        turn: { ...session.turn, od },
        conditions: session.conditions
          .filter((c) => c.id !== condition.id || !removed)
          .map((c) => (c.id === condition.id ? updated : c)),
      },
    },
  };
  return { status: 'RESOLVED' as const, state: next, logs, pending: [] };
}
/** Transactional facade: unresolved equipment leaves even the turn-start transition uncommitted. */
export function beginSuppressionEquipmentTurn(
  state: SuppressionEquipmentState,
  context: ResolutionContext,
  source: DiceSource,
  wounds?: WoundRuntimeState,
) {
  const begun = beginActionTurn(state.combat);
  const actor = begun.state.session.activeActor!;
  const next = { ...state, combat: begun.state };
  const resolved = resolveSuppressionTurnStart(
    next,
    actor,
    context,
    source,
    wounds ? { ...wounds, combat: next.combat } : undefined,
  );
  return {
    ...resolved,
    state: resolved.status === 'PENDING' ? state : resolved.state,
    logs: resolved.status === 'PENDING' ? resolved.logs : [...begun.logs, ...resolved.logs],
  };
}
