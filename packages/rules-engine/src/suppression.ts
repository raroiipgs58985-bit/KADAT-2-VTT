import type {
  SuppressionEquipmentState,
  SuppressionEvent,
  SuppressionCandidate,
  SuppressionTargetResult,
  SuppressionResolution,
  Suppressed,
  DiceSource,
  ResolutionContext,
  CombatLogEntry,
  WoundRuntimeState,
} from '@kadat/contracts';
import { scopedContext } from './action-context.js';
import { validateActionState } from './action-state.js';
import { collectEquipmentEffects } from './equipment-effects.js';
import { resolveCharacteristic } from './characteristics.js';
import { resolveCheck } from './checks.js';
import { resolveWoundCheck } from './wound-checks.js';
import { suppressionTargetAffected, suppressionTrigger } from './suppression-triggers.js';
import { remainingRounds } from './conditions.js';
import { resolutionLog } from './log.js';
import { integer, uniqueIds } from './validation.js';

export const suppressionSource = {
  kind: 'canonical-block',
  id: 'Механика к100.xlsx / Бой / A10:A15',
};
export const suppressionProvenance = {
  source: suppressionSource,
  reason: 'Phase D normalized canonical suppression block',
};
export function createSuppressionEquipmentState(
  combat: SuppressionEquipmentState['combat'],
  equipment: SuppressionEquipmentState['equipment'] = [],
): SuppressionEquipmentState {
  validateActionState(combat);
  return { combat, equipment, suppressed: [], processedEventIds: [] };
}
/** Talent «Стальные нервы»: a failed suppression test is rerolled once. */
export const STEEL_NERVE_TALENT = 'Стальные нервы';
/** Talent «Бесстрашие»: immune to suppression. */
export const FEARLESS_TALENT = 'Бесстрашие';
export function suppressionSWCheck(
  state: SuppressionEquipmentState,
  context: ResolutionContext,
  source: DiceSource,
  wounds?: WoundRuntimeState,
) {
  const first = suppressionSWCheckOnce(state, context, source, wounds);
  const talents = state.combat.actors[context.actor.actorId]?.talents ?? [];
  if (first.result.outcome === 'success' || !talents.includes(STEEL_NERVE_TALENT)) return first;
  const second = suppressionSWCheckOnce(state, context, source, wounds);
  return {
    result: second.result,
    // Both tests stay in the log: the failed one and the reroll.
    logs: [...first.logs, ...second.logs],
    rerolledBy: STEEL_NERVE_TALENT,
  };
}
function suppressionSWCheckOnce(
  state: SuppressionEquipmentState,
  context: ResolutionContext,
  source: DiceSource,
  wounds?: WoundRuntimeState,
) {
  const characteristic = state.combat.actors[context.actor.actorId]?.characteristics.СВ;
  if (!characteristic) throw new Error('Missing target SW data');
  if (wounds) {
    if (wounds.combat !== state.combat) throw new Error('Wound/combat snapshot mismatch');
    const r = resolveWoundCheck(wounds, 'СВ', context, source);
    return { result: r.result, logs: [r.characteristicLog, r.log] };
  }
  const resolved = resolveCharacteristic('СВ', characteristic, context);
  const r = resolveCheck(
    { baseValue: resolved.result.finalValue, finalSuper: resolved.result.finalSuper, context },
    source,
  );
  return { result: r.result, logs: [resolved.log, r.log] };
}
function suppressedCondition(
  state: SuppressionEquipmentState,
  event: SuppressionEvent,
  candidate: SuppressionCandidate,
  duration: number,
): Suppressed {
  integer(duration, 'suppression duration', 1);
  const appliedRound = state.combat.session.roundNumber;
  const id = `suppressed:${event.attackId}:${candidate.actor.actorId}`;
  return {
    id,
    type: 'Suppressed',
    actor: candidate.actor,
    sources: [event.weapon, suppressionSource],
    provenance: [event.provenance, suppressionProvenance],
    stackingRule: 'REJECT',
    unit: 'round',
    appliedRound,
    durationRounds: duration,
    expiresAfterRound: appliedRound + duration - 1,
    attackId: event.attackId,
    originalFailureDegrees: duration,
    firstAffectedTurn: null,
    lastRemovalTurn: null,
    effects: [
      {
        id: `${id}:NS`,
        source: suppressionSource,
        targetActor: candidate.actor,
        provenance: event.provenance,
        duration: {
          unit: 'round',
          appliedRound,
          durationRounds: duration,
          expiresAfterRound: appliedRound + duration - 1,
        },
        definition: {
          id: 'Suppressed:NS',
          target: { kind: 'check' },
          operation: 'add',
          value: -20,
          stage: 'temporary',
          stackingGroup: 'Suppressed:NS',
          stackingRule: 'independent',
          tags: ['Suppressed'],
          condition: { requiresTags: ['ranged', `suppressed:turn:${id}`] },
          provenance: suppressionProvenance,
        },
      },
    ],
  };
}
/** Build every target plan before committing anything. Pending results return the exact input snapshot. */
export function resolveSuppression(
  state: SuppressionEquipmentState,
  event: SuppressionEvent,
  candidates: readonly SuppressionCandidate[],
  source: DiceSource,
  wounds?: WoundRuntimeState,
): SuppressionResolution {
  validateActionState(state.combat);
  if (state.combat.session.phase === 'round-ended')
    throw new Error('Suppression cannot apply to ended round');
  uniqueIds(state.processedEventIds, 'suppression processed events');
  if (state.processedEventIds.includes(event.attackId))
    throw new Error('Suppression event already resolved');
  uniqueIds(
    candidates.map((c) => c.actor.actorId),
    'suppression candidates',
  );
  uniqueIds(
    state.suppressed.map((c) => c.id),
    'suppressed IDs',
  );
  const trigger = suppressionTrigger(event),
    targets: SuppressionTargetResult[] = [],
    logs: CombatLogEntry[] = [];
  for (const c of candidates) {
    const empty: SuppressionTargetResult = {
      actor: c.actor,
      status: 'NOT_AFFECTED',
      penaltyBasis: null,
      modifier: null,
      check: null,
      condition: null,
      response: null,
      equipment: [],
      pending: [],
    };
    if (
      !suppressionTargetAffected(event, c) ||
      (state.combat.actors[c.actor.actorId]?.talents ?? []).includes(FEARLESS_TALENT)
    ) {
      targets.push(empty);
      continue;
    }
    const context = scopedContext(state.combat, c.actor, c.context, [], ['check:suppression']);
    const equipment = collectEquipmentEffects(state.equipment, context);
    logs.push(equipment.log);
    const base = {
      ...empty,
      penaltyBasis: trigger.penaltyBasis,
      modifier: trigger.modifier,
      equipment: equipment.traces,
    };
    if (equipment.status === 'PENDING') {
      targets.push({ ...base, status: 'PENDING', pending: equipment.pending });
      continue;
    }
    if (
      equipment.capabilities.some(
        (t) =>
          t.effect.payload.kind === 'SUPPRESSION_IMMUNITY' ||
          (t.effect.payload.kind === 'CHECK_IMMUNITY' && t.effect.payload.scope === 'suppression'),
      )
    ) {
      targets.push({ ...base, status: 'IMMUNE' });
      continue;
    }
    if (trigger.roundingPending) {
      targets.push({
        ...base,
        status: 'PENDING',
        pending: [
          {
            type: 'SuppressionModifierRoundingPending',
            actor: c.actor,
            source: event,
            provenance: event.provenance,
          },
        ],
      });
      continue;
    }
    const checkedContext = {
      ...equipment.context,
      modifiers: [
        ...equipment.context.modifiers,
        {
          id: 'suppression:source-penalty',
          value: trigger.modifier,
          source: suppressionSource,
          provenance: event.provenance,
        },
      ],
    };
    const checked = suppressionSWCheck(state, checkedContext, source, wounds);
    logs.push(...checked.logs);
    const checkedBase = { ...base, check: checked.result };
    if (checked.result.outcome === 'success') {
      targets.push({ ...checkedBase, status: 'PASSED' });
      continue;
    }
    if (
      state.suppressed.some(
        (prior) =>
          prior.actor.actorId === c.actor.actorId &&
          remainingRounds(prior, state.combat.session.roundNumber) > 0,
      ) ||
      state.combat.session.conditions.some(
        (prior) =>
          prior.type === 'Suppressed' &&
          prior.actor.actorId === c.actor.actorId &&
          remainingRounds(prior, state.combat.session.roundNumber) > 0,
      )
    ) {
      targets.push({
        ...checkedBase,
        status: 'PENDING',
        pending: [
          {
            type: 'SuppressionStackingPending',
            actor: c.actor,
            source: event,
            provenance: event.provenance,
          },
        ],
      });
      continue;
    }
    if (c.nearestCoverWithinSpeed === 'UNKNOWN') {
      targets.push({
        ...checkedBase,
        status: 'PENDING',
        pending: [
          {
            type: 'CoverAvailabilityContextRequired',
            actor: c.actor,
            source: event,
            provenance: c.provenance,
          },
        ],
      });
      continue;
    }
    if (
      !Number.isSafeInteger(checked.result.failureDegrees) ||
      checked.result.failureDegrees! <= 0
    ) {
      targets.push({
        ...checkedBase,
        status: 'PENDING',
        pending: [
          {
            type: 'SuppressionDurationPending',
            actor: c.actor,
            source: event,
            provenance: event.provenance,
          },
        ],
      });
      continue;
    }
    const condition = suppressedCondition(state, event, c, checked.result.failureDegrees!);
    const movement = equipment.capabilities.reduce(
      (speed, t) =>
        speed +
        (t.contribution?.kind === 'MOVEMENT_MODIFIER' && t.contribution.field === 'speed'
          ? t.contribution.value
          : 0),
      state.combat.actors[c.actor.actorId]!.movement,
    );
    if (!Number.isFinite(movement) || movement <= 0)
      throw new Error('Invalid current suppression-response speed');
    const response =
      c.nearestCoverWithinSpeed === 'YES'
        ? {
            type: 'SeekNearestCoverIntent' as const,
            actor: c.actor,
            maxDistance: movement,
            provenance: c.provenance,
          }
        : { type: 'DropProneIntent' as const, actor: c.actor, provenance: c.provenance };
    targets.push({ ...checkedBase, status: 'SUPPRESSED', condition, response });
  }
  const pending = targets.some((t) => t.status === 'PENDING');
  const conditions = targets.flatMap((t) => (t.condition ? [t.condition] : []));
  uniqueIds(
    [...state.combat.session.conditions, ...conditions].map((c) => c.id),
    'session condition IDs',
  );
  for (const target of targets)
    logs.push(
      resolutionLog(
        'suppression',
        {
          actor: target.actor,
          tags: [],
          effects: [],
          modifiers: [],
          overrides: candidates.find((c) => c.actor.actorId === target.actor.actorId)!.context
            .overrides,
          roundNumber: state.combat.session.roundNumber,
          turnNumber: state.combat.session.turnsStarted,
        },
        {
          combatSessionId: state.combat.session.id,
          suppression: { event, target },
          mutations:
            !pending && target.condition
              ? [
                  {
                    type: 'condition-add',
                    actor: target.actor,
                    path: `session.conditions.${target.condition.id}`,
                    before: null,
                    after: target.condition,
                  },
                ]
              : [],
        },
      ),
    );
  return {
    state: pending
      ? state
      : {
          ...state,
          combat: {
            ...state.combat,
            session: {
              ...state.combat.session,
              conditions: [...state.combat.session.conditions, ...conditions],
            },
          },
          suppressed: [...state.suppressed, ...conditions],
          processedEventIds: [...state.processedEventIds, event.attackId],
        },
    status: pending ? 'PENDING' : 'RESOLVED',
    event,
    targets,
    logs,
  };
}
