import type {
  ActorReference,
  DiceSource,
  ResolutionContext,
  WoundFacts,
  WoundRuntimeState,
} from '@kadat/contracts';
import { removeWoundCondition, planWoundCondition } from './wound-conditions.js';
import { resolveWoundCheck } from './wound-checks.js';
import { planBleedingPulse } from './wound-bleeding.js';
import {
  validateWoundRuntime,
  validateWoundFacts,
  woundContext,
  woundDice,
} from './wound-state.js';
import { resolutionLog } from './log.js';

/** Invoke once after the accepted beginActionTurn; missing context commits none of this hook. */
export function resolveWoundTurnStart(
  state: WoundRuntimeState,
  actor: ActorReference,
  supplied: ResolutionContext,
  facts: WoundFacts | undefined,
  source: DiceSource,
  resumeDice: readonly import('@kadat/contracts').DiceRoll[] = [],
) {
  validateWoundRuntime(state);
  validateWoundFacts(facts);
  const turn = state.combat.session.turn;
  if (state.combat.session.phase !== 'turn-active' || turn?.actor.actorId !== actor.actorId)
    throw new Error('Wound turn hook requires the actor active own turn');
  const wound = state.actors[actor.actorId];
  if (!wound || wound.life.status === 'DEAD') throw new Error('Invalid wound turn actor');
  const id = `wound-turn:${state.combat.session.id}:${turn.turnNumber}:${actor.actorId}`;
  if (state.processedPulseIds.includes(id)) throw new Error('Wound turn already processed');
  const context = woundContext(state, actor, supplied),
    tape = woundDice(source, resumeDice);
  // Preflight activity before consuming injury-test dice or clearing transient conditions.
  if (
    wound.bleeding.some((b) => b.active && !(facts?.activityBySource?.[b.id] ?? facts?.activity))
  ) {
    const pulse = planBleedingPulse(
      state,
      actor,
      wound.bleeding.filter((b) => b.active),
      context,
      facts,
      tape.source,
    );
    return {
      state,
      status: 'CONTEXT_REQUIRED' as const,
      pendingIntents: pulse.pending,
      nestedDice: tape.rolls,
      logs: [
        resolutionLog('wound-turn-start', context, {
          woundTurnStart: {
            actor,
            status: 'CONTEXT_REQUIRED',
            pendingIntents: pulse.pending,
            ...(facts ? { facts } : {}),
          },
        }),
      ],
    };
  }
  let next = state;
  const logs: ReturnType<typeof resolutionLog>[] = [];
  for (const condition of wound.conditions)
    if (condition.expires === 'next-own-turn' && condition.appliedTurn < turn.turnNumber)
      next = removeWoundCondition(next, actor, condition.id, 'source-resolved');
  for (const injury of wound.injuries) {
    for (const trigger of injury.triggers.filter(
      (t) => t.kind === 'turn-start-VN' && !t.consumed,
    )) {
      const checked = resolveWoundCheck(next, 'ВН', context, tape.source, {
        id: `turn:${injury.id}:VN`,
        value: 0,
        provenance: trigger.provenance,
      });
      logs.push(checked.characteristicLog, checked.log);
      if (checked.result.outcome !== 'success') {
        const conditionId = `${id}:${injury.id}:stunned`;
        const isArm = injury.consequence.zone === 'ARM';
        next = planWoundCondition(
          next,
          actor,
          conditionId,
          'Stunned',
          trigger.provenance,
          isArm ? { unit: 'round', amount: 1 } : undefined,
        ).state;
        if (!isArm) {
          const a = next.actors[actor.actorId]!;
          next = {
            ...next,
            actors: {
              ...next.actors,
              [actor.actorId]: {
                ...a,
                conditions: a.conditions.map((c) =>
                  c.id === conditionId ? { ...c, expires: 'next-own-turn' as const } : c,
                ),
              },
            },
          };
        }
      }
    }
  }
  const pulse = planBleedingPulse(
    next,
    actor,
    wound.bleeding.filter((b) => b.active),
    context,
    facts,
    tape.source,
  );
  if (pulse.pending.length)
    return {
      state,
      status: 'CONTEXT_REQUIRED' as const,
      pendingIntents: pulse.pending,
      nestedDice: tape.rolls,
      logs,
    };
  tape.assertComplete();
  next = { ...pulse.state, processedPulseIds: [...state.processedPulseIds, id] };
  validateWoundRuntime(next);
  const mutations = [
    { type: 'wound-turn-start', actor, path: 'wounds+combat', before: state, after: next },
  ];
  return {
    state: next,
    status: 'RESOLVED' as const,
    pendingIntents: [],
    nestedDice: tape.rolls,
    logs: [
      ...logs,
      ...pulse.logs,
      resolutionLog('wound-turn-start', context, {
        combatSessionId: state.combat.session.id,
        dice: tape.rolls,
        mutations,
        woundTurnStart: {
          actor,
          status: 'RESOLVED',
          pendingIntents: [],
          ...(facts ? { facts } : {}),
        },
      }),
    ],
  };
}
