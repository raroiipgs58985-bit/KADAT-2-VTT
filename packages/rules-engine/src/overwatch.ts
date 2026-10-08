import type {
  ActionRequest,
  ActionResolution,
  CombatActionState,
  DiceSource,
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
  const tiedActors: string[][] = [];
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
        if (unresolved.length > 1)
          tiedActors.push(unresolved.map((entry) => entry.request.actor.actorId));
      }
    }
    ordered.push(...group.map((entry) => entry.request));
  }
  return { ordered, tiedActors, logs };
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
  if (ordered.tiedActors.length > 0) {
    return {
      status: 'pending-opposed-tie' as const,
      state,
      attacks: [],
      logs: ordered.logs,
      tiedActors: ordered.tiedActors,
      timeline: [],
    };
  }
  let next = state;
  const attacks = [] as ReturnType<typeof resolveRangedAttack>[];
  const logs = [...ordered.logs];
  for (const request of ordered.ordered) {
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
    tiedActors: [],
    timeline: [
      ...attacks.map((attack) => ({ type: 'overwatch' as const, actionId: attack.execution.id })),
      { type: 'enemy-action-ready' as const, actionId: event.actionId },
    ],
  };
}
