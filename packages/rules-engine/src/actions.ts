import type {
  ActionRequest,
  ActionResolution,
  CombatActionState,
  DiceSource,
  MovementResult,
} from '@kadat/contracts';
import { endTurn } from './combat.js';
import { resolveCharacteristic } from './characteristics.js';
import { resolveCheck } from './checks.js';
import { scopedContext, ruleSource, ruleProvenance } from './action-context.js';
import { clearTransient, updateActor } from './action-state.js';
import {
  actionLog,
  definition,
  spendResources,
  validateResources,
  type ActionWindow,
} from './action-resources.js';
import { integer } from './validation.js';
import { resolveModifiers } from './context.js';
import { clearBraces } from './weapon-actions.js';

export function resolveCombatAction(
  state: CombatActionState,
  request: ActionRequest,
  source: DiceSource,
): ActionResolution<
  MovementResult | { readonly check?: ReturnType<typeof resolveCheck>['result'] }
> {
  const actor = state.actors[request.actor.actorId];
  if (!actor) throw new Error('Unknown actor');
  const context = scopedContext(
    state,
    request.actor,
    request.context,
    [],
    [`action:${request.type}`],
  );
  const costs: Partial<Record<ActionRequest['type'], number>> = {
    'free-move': 0,
    'half-move': 1,
    'full-move': 2,
    run: 2,
    sprint: 2,
    prone: 0,
    kneel: 0,
    stand: 1,
    'quick-aim': 1,
    'careful-aim': 2,
    wait: 1,
    'free-action': 0,
  };
  const cost = costs[request.type];
  if (cost === undefined) throw new Error('Action requires its dedicated resolver');
  const reactionCost = request.type === 'run' || request.type === 'sprint' ? 1 : 0;
  const movementTypes = [
    'free-move',
    'half-move',
    'full-move',
    'run',
    'sprint',
    'prone',
    'kneel',
    'stand',
  ];
  const equipmentOd = movementTypes.includes(request.type)
    ? resolveModifiers(context)
        .filter((m) => m.id.startsWith('equipment:movement-od:') && m.included)
        .reduce((n, m) => n + m.value, 0)
    : 0;
  integer(cost + equipmentOd, 'equipment-adjusted action cost', 0);
  // «Первоклассный стрелок»: an aim as the turn's Free Action (ruling 134).
  const freeAim =
    (request.type === 'quick-aim' || request.type === 'careful-aim') &&
    (request as { readonly freeAim?: boolean }).freeAim === true;
  const action = freeAim
    ? definition('free-action', 0, 0)
    : definition(request.type, cost + equipmentOd, reactionCost);
  const own =
    state.session.phase === 'turn-active' &&
    state.session.activeActor?.actorId === request.actor.actorId;
  const window: ActionWindow = request.type === 'wait' || own ? 'own-turn' : 'wait';
  validateResources(state, request, action, context, window);
  // Non-random actions never consume the supplied RNG.
  void source;
  const speed = effectiveMovement(actor);
  if (speed.crawling && (request.type === 'run' || request.type === 'sprint'))
    throw new Error('Run and Sprint are unavailable while crawling');
  const skr = speed.value;
  const distance =
    request.type === 'free-move'
      ? Math.min(5, Math.ceil(skr / 2))
      : request.type === 'half-move'
        ? skr
        : request.type === 'full-move'
          ? skr * 2
          : request.type === 'run'
            ? skr * 6
            : request.type === 'sprint'
              ? skr * 12
              : 0;
  // «Бой» A46: Sprint +2 Fatigue; talent «Спринт» — 1 (author ruling 26).
  const fatigueAdded =
    request.type === 'sprint' ? ((actor.talents ?? []).includes('Спринт') ? 1 : 2) : 0;
  integer(actor.fatigue + fatigueAdded, 'resulting fatigue', 0);
  if (!Number.isFinite(distance)) throw new RangeError('Invalid movement result');
  const posture =
    request.type === 'prone'
      ? 'prone'
      : request.type === 'kneel'
        ? 'kneeling'
        : request.type === 'stand'
          ? 'standing'
          : actor.posture;
  const spent = spendResources(state, request, action, context, window);
  const spentActor = spent.state.actors[request.actor.actorId];
  if (!spentActor) throw new Error('Missing actor after resource resolution');
  let next = updateActor(spent.state, {
    ...spentActor,
    posture,
    fatigue: actor.fatigue + fatigueAdded,
  });
  if (['free-move', 'half-move', 'full-move', 'run', 'sprint'].includes(request.type))
    next = clearBraces(next, request.actor.actorId);
  const logs = [actionLog(state, spent.execution)];
  if (request.type === 'quick-aim' || request.type === 'careful-aim') {
    next = updateActor(next, {
      ...spentActor,
      aim: {
        type: request.type === 'quick-aim' ? 'quick' : 'careful',
        modifier: request.type === 'quick-aim' ? 10 : 20,
        characteristics: ['НС', 'НР'],
        source: ruleSource,
        provenance: { ...ruleProvenance, record: request.type },
        activatedRound: state.session.roundNumber,
        activatedTurn: state.session.turnsStarted,
      },
    });
  }
  if (request.type === 'wait') {
    const mayAttack = !(
      state.session.turn?.flags.some((flag) => flag.startsWith('attack:')) ?? false
    );
    next = updateActor(next, {
      ...clearTransient(actor, ['overwatch']),
      wait: {
        retainedOd: 1,
        mayAttack,
        activatedRound: state.session.roundNumber,
        activatedTurn: state.session.turnsStarted,
        source: ruleSource,
      },
    });
    const ended = endTurn(next.session);
    next = { ...next, session: ended.result };
    logs.push(ended.log);
  }
  const mutation = {
    type: request.type,
    actor: request.actor,
    path: `actors.${request.actor.actorId}`,
    before: actor,
    after: next.actors[request.actor.actorId],
  };
  const execution = { ...spent.execution, mutations: [...spent.execution.mutations, mutation] };
  logs[0] = actionLog(state, execution);
  return { state: next, execution, result: { distance, fatigueAdded, posture }, logs };
}

/**
 * Current СКР for movement: wound penalties (`combat-modifier: movement`) are subtracted first;
 * a result of 0 or less counts as 0.5 m («Общая механика» A25). Prone or with a useless leg the
 * character crawls: the same movement actions from СКР / 2, without Run and Sprint («Раны и
 * лечение» A9, A14; author rulings 4 and 15). Halving is applied once.
 */
export function effectiveMovement(actor: CombatActionState['actors'][string]): {
  readonly value: number;
  readonly penalty: number;
  readonly crawling: boolean;
} {
  const own = actor.effects.filter((e) => e.targetActor.actorId === actor.actor.actorId);
  const penalty = own
    .filter(
      (e) =>
        e.definition.target.kind === 'combat-modifier' && e.definition.target.key === 'movement',
    )
    .reduce((total, e) => total + e.definition.value, 0);
  const uselessLeg = own.some(
    (e) =>
      e.definition.target.kind === 'permission' &&
      e.definition.operation === 'restrict' &&
      (e.definition.condition?.requiresTags ?? []).some((t) => /^uses-limb:.*Leg$/.test(t)),
  );
  const crawling = actor.posture === 'prone' || uselessLeg;
  let value = actor.movement + penalty;
  if (value <= 0) value = 0.5;
  if (crawling) value = Math.max(0.5, value / 2);
  return { value, penalty, crawling };
}

export function clearMalfunction(
  state: CombatActionState,
  request: ActionRequest & {
    readonly weaponId: string;
    /** «Знаток Стаб-/Болт-оружия»: clearing costs 1 round instead of the magazine (ruling 133). */
    readonly oneRound?: boolean;
  },
  source: DiceSource,
) {
  if (request.type !== 'clear-malfunction')
    throw new Error('Invalid clear-malfunction action type');
  const actor = state.actors[request.actor.actorId];
  const weapon = state.weapons[request.weaponId];
  if (!actor || !weapon || weapon.owner.actorId !== request.actor.actorId || !weapon.jammed)
    throw new Error('Weapon is not in an appropriate jammed state');
  if (weapon.template.profile.malfunction !== 'generic-jam')
    throw new Error('Specific malfunction behavior requires authored data');
  const context = scopedContext(
    state,
    request.actor,
    request.context,
    [],
    ['action:clear-malfunction'],
  );
  // Talent «Ритуал освобождения (Тех-трюк)»: clearing a jam takes 1 ОД.
  const ritual = (state.actors[request.actor.actorId]?.talents ?? []).includes(
    'Ритуал освобождения (Тех-трюк)',
  );
  const action = definition('clear-malfunction', ritual ? 1 : 2);
  validateResources(state, request, action, context, 'own-turn');
  const characteristic = resolveCharacteristic('НС', actor.characteristics.НС, context);
  const check = resolveCheck(
    {
      baseValue: characteristic.result.finalValue,
      finalSuper: characteristic.result.finalSuper,
      context,
    },
    source,
  );
  const spent = spendResources(state, request, action, context, 'own-turn');
  const cleared = check.result.outcome === 'success';
  // Ruling 133: a cleared jam empties the magazine; with the talent only one round is lost.
  const container = weapon.loadedContainerId
    ? spent.state.containers[weapon.loadedContainerId]
    : undefined;
  const next = {
    ...spent.state,
    weapons: { ...state.weapons, [weapon.id]: { ...weapon, jammed: !cleared } },
    ...(cleared && container
      ? {
          containers: {
            ...spent.state.containers,
            [container.id]: {
              ...container,
              currentRounds: request.oneRound ? Math.max(0, container.currentRounds - 1) : 0,
            },
          },
        }
      : {}),
  };
  const mutation = {
    type: 'jam-clear',
    path: `weapons.${weapon.id}.jammed`,
    before: weapon.jammed,
    after: !cleared,
  };
  const execution = {
    ...spent.execution,
    selectedWeaponId: weapon.id,
    mutations: [...spent.execution.mutations, mutation],
  };
  return {
    state: next,
    execution,
    result: check.result,
    logs: [characteristic.log, check.log, actionLog(state, execution)],
  };
}
