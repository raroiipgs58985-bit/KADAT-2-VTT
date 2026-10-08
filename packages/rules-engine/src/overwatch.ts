import type {
  ActionRequest,
  ActionResolution,
  CombatActionState,
  DiceSource,
  DiceRoll,
  OverwatchOrderingDecision,
  OverwatchSkippedAttack,
  OverwatchState,
  RangedAttackRequest,
  ResolutionContext,
} from '@kadat/contracts';
import { endTurn } from './combat.js';
import { clearTransient, emptyActionContext, updateActor } from './action-state.js';
import { scopedContext, ruleModifier } from './action-context.js';
import { actionLog, definition, spendResources, validateResources } from './action-resources.js';
import { resolveCharacteristic } from './characteristics.js';
import { resolveCheck } from './checks.js';
import { prepareRangedAttack, resolveRangedAttack, type OverwatchEvent } from './ranged.js';
import { validateAmmunition } from './weapons.js';
import { uniqueIds } from './validation.js';
import { rollDie } from './dice.js';
import { sessionLog } from './log.js';

export interface OverwatchActivationRequest extends ActionRequest {
  readonly type: 'overwatch';
  readonly sector: OverwatchState['sector'];
  readonly trigger: OverwatchState['trigger'];
  readonly selectedAttackType: 'ranged-attack' | 'called-attack';
  readonly weaponId: string;
  readonly mode: OverwatchState['mode'];
  readonly shotsRequested: number;
}

export function activateOverwatch(
  state: CombatActionState,
  request: OverwatchActivationRequest,
): ActionResolution<OverwatchState> {
  if (request.type !== 'overwatch' || request.selectedAttackType !== 'ranged-attack')
    throw new Error('Overwatch cannot select Called Attack');
  if (
    !request.sector.id.trim() ||
    request.sector.widthDegrees !== 90 ||
    !Number.isFinite(request.sector.headingDegrees) ||
    request.sector.headingDegrees < 0 ||
    request.sector.headingDegrees >= 360 ||
    !request.trigger.id.trim()
  )
    throw new Error('Invalid Overwatch sector/trigger');
  const actor = state.actors[request.actor.actorId];
  const weapon = state.weapons[request.weaponId];
  const container = weapon?.loadedContainerId
    ? state.containers[weapon.loadedContainerId]
    : undefined;
  if (
    !actor ||
    !weapon ||
    !container ||
    weapon.owner.actorId !== request.actor.actorId ||
    !weapon.readied ||
    weapon.jammed ||
    weapon.thermal
  )
    throw new Error('Invalid Overwatch weapon/ammo');
  validateAmmunition(weapon, container, request.mode, request.shotsRequested);
  const context = scopedContext(state, request.actor, request.context, [], ['action:overwatch']);
  const action = definition('overwatch', 1);
  validateResources(state, request, action, context, 'own-turn');
  const overwatch: OverwatchState = {
    actionId: request.id,
    sector: { ...request.sector },
    trigger: { ...request.trigger, requiresTags: [...request.trigger.requiresTags] },
    weaponId: request.weaponId,
    mode: request.mode,
    shotsRequested: request.shotsRequested,
    activatedRound: state.session.roundNumber,
    activatedTurn: state.session.turnsStarted,
    expires: 'fired-or-next-own-turn',
    reactionCost: 1,
    provenance: action.provenance,
  };
  const spent = spendResources(state, request, action, context, 'own-turn');
  const next = updateActor(spent.state, { ...clearTransient(actor, ['wait']), overwatch });
  const ended = endTurn(next.session);
  const execution = {
    ...spent.execution,
    selectedWeaponId: weapon.id,
    selectedFireMode: request.mode,
    mutations: [
      ...spent.execution.mutations,
      {
        type: 'overwatch-activate',
        actor: request.actor,
        path: `actors.${request.actor.actorId}.overwatch`,
        before: actor.overwatch ?? null,
        after: overwatch,
      },
    ],
  };
  return {
    state: { ...next, session: ended.result },
    execution,
    result: overwatch,
    logs: [actionLog(state, execution), ended.log],
  };
}

export function orderOverwatchInterrupts(
  state: CombatActionState,
  event: OverwatchEvent,
  requests: readonly RangedAttackRequest[],
  source: DiceSource,
  orderingContexts: Readonly<Record<string, ResolutionContext>> = {},
) {
  uniqueIds(
    requests.map((request) => request.actor.actorId),
    'Overwatch actors',
  );
  uniqueIds(
    requests.map((request) => request.id),
    'Overwatch attack IDs',
  );
  const entries = requests.map((request) => {
    prepareRangedAttack(state, request, event); // All candidates validated before any attack is committed.
    const runtime = state.actors[request.actor.actorId];
    if (!runtime) throw new Error('Missing Overwatch actor');
    const supplied = orderingContexts[request.actor.actorId] ?? emptyActionContext(request.actor);
    const context = scopedContext(
      state,
      request.actor,
      {
        ...supplied,
        modifiers: [...supplied.modifiers, ruleModifier('overwatch:opposed', 0)],
      },
      [],
      ['overwatch:ordering'],
    );
    const characteristic = resolveCharacteristic('ЛВ', runtime.characteristics.ЛВ, context);
    return {
      request,
      context,
      characteristic,
      opposed: null as ReturnType<typeof resolveCheck> | null,
    };
  });
  const logs = entries.map((entry) => entry.characteristic.log);
  const decisions: OverwatchOrderingDecision[] = [];
  const overrides = entries.flatMap((entry) => entry.context.overwatchOrderingOverrides ?? []);
  uniqueIds(
    overrides.map((override) => override.id),
    'Overwatch ordering override IDs',
  );
  for (const override of overrides) {
    uniqueIds(override.participatingActorIds, 'Overwatch ordering override actors');
    if (
      override.participatingActorIds.length < 2 ||
      !override.participatingActorIds.includes(override.winnerActorId) ||
      !override.participatingActorIds.every((id) =>
        entries.some((entry) => entry.request.actor.actorId === id),
      ) ||
      !override.reason.trim() ||
      !override.provenance.source.id.trim()
    )
      throw new Error('Invalid Overwatch ordering override');
  }
  const usedOverrides = new Set<string>();
  const values = [...new Set(entries.map((entry) => entry.characteristic.result.finalValue))].sort(
    (a, b) => b - a,
  );
  const ordered: RangedAttackRequest[] = [];
  for (const value of values) {
    const group = entries.filter((entry) => entry.characteristic.result.finalValue === value);
    if (group.length > 1) {
      for (const entry of group) {
        entry.opposed = resolveCheck(
          {
            baseValue: value,
            finalSuper: entry.characteristic.result.finalSuper,
            context: entry.context,
          },
          source,
        );
        logs.push(entry.opposed.log);
      }
      group.sort(
        (a, b) => (b.opposed?.result.totalDegrees ?? 0) - (a.opposed?.result.totalDegrees ?? 0),
      );
      const results = [...new Set(group.map((entry) => entry.opposed?.result.totalDegrees))];
      for (const result of results) {
        const unresolved = group.filter((entry) => entry.opposed?.result.totalDegrees === result);
        if (unresolved.length > 1) {
          const ids = unresolved.map((entry) => entry.request.actor.actorId);
          const matching = overrides.filter(
            (override) =>
              override.participatingActorIds.length === ids.length &&
              ids.every((id) => override.participatingActorIds.includes(id)),
          );
          if (matching.length > 1) throw new Error('Conflicting Overwatch ordering overrides');
          const override = matching[0];
          const remaining = [...unresolved];
          const resolved: typeof unresolved = [];
          const rolls: DiceRoll[] = [];
          if (override) {
            usedOverrides.add(override.id);
            const index = remaining.findIndex(
              (entry) => entry.request.actor.actorId === override.winnerActorId,
            );
            const winner = remaining.splice(index, 1)[0];
            if (!winner) throw new Error('Invalid Overwatch ordering winner');
            resolved.push(winner);
          }
          while (remaining.length > 1) {
            // For a pair: injected d2 = 1 selects the first candidate, 2 the second (50/50).
            const roll = rollDie(remaining.length, source);
            rolls.push(roll);
            const winner = remaining.splice(roll.value - 1, 1)[0];
            if (!winner) throw new Error('Missing Overwatch ordering candidate');
            resolved.push(winner);
          }
          resolved.push(...remaining);
          const first = resolved[0];
          if (!first) throw new Error('Missing Overwatch ordering winner');
          const decision: OverwatchOrderingDecision = {
            participants: unresolved.map((entry) => {
              if (!entry.opposed) throw new Error('Missing opposed LV result');
              return {
                actorId: entry.request.actor.actorId,
                lv: value,
                opposed: entry.opposed.result,
              };
            }),
            completeTie: true,
            orderingResolution: override ? 'GM_OVERRIDE' : 'RANDOM_TIEBREAK',
            winnerActorId: first.request.actor.actorId,
            orderedActorIds: resolved.map((entry) => entry.request.actor.actorId),
            provenance: {
              source: { kind: 'user-ruling', id: 'Phase 2.2B-1.1 Overwatch tie-break' },
              reason: 'Complete opposed LV tie: GM choice before injected random fallback',
            },
            ...(rolls.length
              ? {
                  random: {
                    rolls,
                    provenance: {
                      source: { kind: 'injected-rng', id: 'Overwatch ordering DiceSource' },
                      reason: 'Uniform selection from the remaining tied actors',
                    },
                  },
                }
              : {}),
            ...(override ? { override } : {}),
          };
          decisions.push(decision);
          logs.push(
            sessionLog('overwatch-ordering', state.session, {
              combatSessionId: state.session.id,
              actors: ids.map((actorId) => ({ actorId })),
              beforeActionId: event.actionId,
              dice: rolls,
              overwatchOrdering: decision,
            }),
          );
          const start = group.indexOf(unresolved[0]!);
          group.splice(start, unresolved.length, ...resolved);
        }
      }
    }
    ordered.push(...group.map((entry) => entry.request));
  }
  if (overrides.some((override) => !usedOverrides.has(override.id)))
    throw new Error('Ordering override requires a complete opposed LV tie');
  return { ordered, tiedActors: [], decisions, logs };
}

/** The triggering action stays uncommitted until all interruptions have resolved. */
export function resolveOverwatchInterrupts(
  state: CombatActionState,
  event: OverwatchEvent,
  requests: readonly RangedAttackRequest[],
  source: DiceSource,
  orderingContexts: Readonly<Record<string, ResolutionContext>> = {},
) {
  const ordered = orderOverwatchInterrupts(state, event, requests, source, orderingContexts);
  let next = state;
  const attacks = [] as ReturnType<typeof resolveRangedAttack>[];
  const logs = [...ordered.logs];
  const skippedAttacks: OverwatchSkippedAttack[] = [];
  for (const request of ordered.ordered) {
    // Earlier attacks can change resource/condition legality. Never commit a now-invalid request.
    try {
      prepareRangedAttack(next, request, event);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const skipped = { actionId: request.id, actor: request.actor, reason: error.message };
      skippedAttacks.push(skipped);
      logs.push(
        sessionLog('overwatch-skipped', next.session, {
          combatSessionId: next.session.id,
          beforeActionId: event.actionId,
          overwatchSkipped: skipped,
        }),
      );
      continue;
    }
    const attack = resolveRangedAttack(next, request, source, event);
    next = attack.state;
    attacks.push(attack);
    logs.push(...attack.logs);
  }
  return {
    status: 'resolved' as const,
    state: next,
    attacks,
    logs,
    orderingDecisions: ordered.decisions,
    skippedAttacks,
    tiedActors: [],
    timeline: [
      ...attacks.map((attack) => ({ type: 'overwatch' as const, actionId: attack.execution.id })),
      { type: 'enemy-action-ready' as const, actionId: event.actionId },
    ],
  };
}
