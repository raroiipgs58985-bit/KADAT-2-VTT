import type {
  ActorReference,
  BleedingActivity,
  BleedingPulseEntry,
  BleedingPulseRequest,
  BleedingPulseResult,
  BleedingSource,
  DiceSource,
  ResolutionContext,
  WoundFacts,
  WoundRuntimeState,
} from '@kadat/contracts';
import {
  currentWoundBonuses,
  validateWoundRuntime,
  validateWoundFacts,
  woundContext,
  woundDice,
  woundIntent,
} from './wound-state.js';
import { resolveWoundCheck } from './wound-checks.js';
import { planBloodLoss } from './wound-blood.js';
import { rollDie } from './dice.js';
import { resolutionLog } from './log.js';

export function planBleedingPulse(
  state: WoundRuntimeState,
  actor: ActorReference,
  sources: readonly BleedingSource[],
  context: ResolutionContext,
  facts: WoundFacts | undefined,
  source: DiceSource,
) {
  const modes = sources.map((s) => facts?.activityBySource?.[s.id] ?? facts?.activity);
  const pending = sources.flatMap((s, i) =>
    modes[i] === undefined
      ? [
          woundIntent(
            `${s.id}:activity-required`,
            'BleedingActivityContextRequired',
            actor,
            s.provenance,
            'Choose REST / PHYSICAL_ACTION / HOLDING_WOUND for this bleeding source',
            { injuryId: s.injuryId, bleedingId: s.id, location: s.location },
          ),
        ]
      : [],
  );
  if (pending.length)
    return {
      state,
      entries: [] as BleedingPulseEntry[],
      pending,
      crossed: [] as ('quarter' | 'half' | 'threeQuarters')[],
      before: state.actors[actor.actorId]!.blood,
      after: state.actors[actor.actorId]!.blood,
      logs: [] as ReturnType<typeof resolutionLog>[],
    };
  if (modes.some((m) => !['REST', 'PHYSICAL_ACTION', 'HOLDING_WOUND'].includes(m!)))
    throw new Error('Invalid bleeding activity');
  const entries: BleedingPulseEntry[] = [],
    logs: ReturnType<typeof resolutionLog>[] = [];
  for (const [index, s] of sources.entries()) {
    if (!['LIGHT', 'MEDIUM', 'HEAVY'].includes(s.severity))
      throw new Error('Invalid bleeding severity');
    const activity = modes[index] as BleedingActivity;
    if (s.severity === 'HEAVY') {
      const extraDie = activity === 'PHYSICAL_ACTION' ? rollDie(5, source) : null;
      entries.push({
        source: s,
        activity,
        check: null,
        projection: null,
        extraDie,
        bloodLoss: 3 + (extraDie?.value ?? 0),
      });
    } else {
      const value = activity === 'PHYSICAL_ACTION' ? -30 : activity === 'HOLDING_WOUND' ? 20 : -10;
      const modifier = { id: `bleeding:${s.id}:activity`, value, provenance: s.provenance };
      let checked = resolveWoundCheck(state, 'ВН', context, source, modifier);
      logs.push(checked.characteristicLog, checked.log);
      // Talent «Крепкий орешек»: two ВН rolls against bleeding, the better one counts (ruling 128).
      if (
        checked.result.outcome !== 'success' &&
        (state.combat.actors[actor.actorId]?.talents ?? []).includes('Крепкий орешек')
      ) {
        checked = resolveWoundCheck(state, 'ВН', context, source, modifier);
        logs.push(checked.characteristicLog, checked.log);
      }
      entries.push({
        source: s,
        activity,
        check: checked.result,
        projection: checked.projection,
        extraDie: null,
        bloodLoss: checked.result.outcome === 'success' ? 0 : s.severity === 'LIGHT' ? 1 : 2,
      });
    }
  }
  const { bVN } = currentWoundBonuses(state, actor, context),
    loss = entries.reduce((n, e) => n + e.bloodLoss, 0);
  const blood = planBloodLoss(
    state,
    actor,
    loss,
    bVN,
    sources[0]?.provenance ?? {
      source: { kind: 'runtime', id: 'empty-bleed-pulse' },
      reason: 'No active bleeding sources',
    },
  );
  return { ...blood, entries, pending, logs };
}
export function resolveBleedingPulse(request: BleedingPulseRequest, source: DiceSource) {
  const { state, actor } = request;
  validateWoundRuntime(state);
  validateWoundFacts(request.facts);
  const wound = state.actors[actor.actorId];
  if (!wound) throw new Error('Unknown bleeding actor');
  if (wound.life.status === 'DEAD') throw new Error('Cannot pulse terminal dead actor');
  if (!request.id.trim() || state.processedPulseIds.includes(request.id))
    throw new Error('Empty/repeated bleeding pulse ID');
  const context = woundContext(state, actor, request.context),
    tape = woundDice(source, request.resumeDice);
  const pulse = planBleedingPulse(
    state,
    actor,
    wound.bleeding.filter((s) => s.active),
    context,
    request.facts,
    tape.source,
  );
  const blocked = pulse.pending.length > 0;
  const next = blocked
    ? state
    : { ...pulse.state, processedPulseIds: [...state.processedPulseIds, request.id] };
  if (!blocked) {
    tape.assertComplete();
    validateWoundRuntime(next);
  }
  const mutations = blocked
    ? []
    : [
        {
          type: 'blood-pulse',
          actor,
          path: `wounds.${actor.actorId}`,
          before: wound,
          after: next.actors[actor.actorId]!,
        },
      ];
  const result: BleedingPulseResult = {
    status: blocked ? 'CONTEXT_REQUIRED' : 'RESOLVED',
    pulseId: request.id,
    actor,
    entries: pulse.entries,
    bloodBefore: pulse.before,
    bloodAfter: pulse.after,
    thresholdsCrossed: pulse.crossed,
    pendingIntents: pulse.pending,
    nestedDice: tape.rolls,
    mutations,
    context,
    ...(request.facts ? { facts: request.facts } : {}),
  };
  return {
    state: next,
    result,
    logs: [
      ...pulse.logs,
      resolutionLog('bleeding-pulse', context, {
        combatSessionId: state.combat.session.id,
        dice: tape.rolls,
        bleedingPulse: result,
        mutations,
      }),
    ],
  };
}
