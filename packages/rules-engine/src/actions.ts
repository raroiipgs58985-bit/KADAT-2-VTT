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
  };
  const cost = costs[request.type];
  if (cost === undefined) throw new Error('Action requires its dedicated resolver');
  const reactionCost = request.type === 'run' || request.type === 'sprint' ? 1 : 0;
  const action = definition(request.type, cost, reactionCost);
  const own =
    state.session.phase === 'turn-active' &&
    state.session.activeActor?.actorId === request.actor.actorId;
  const window: ActionWindow = request.type === 'wait' || own ? 'own-turn' : 'wait';
  validateResources(state, request, action, context, window);
  // Non-random actions never consume the supplied RNG.
  void source;
  const distance =
    request.type === 'free-move'
      ? Math.min(5, Math.ceil(actor.movement / 2))
      : request.type === 'half-move'
        ? actor.movement
        : request.type === 'full-move'
          ? actor.movement * 2
          : request.type === 'run'
            ? actor.movement * 6
            : request.type === 'sprint'
              ? actor.movement * 12
              : 0;
  const fatigueAdded = request.type === 'sprint' ? 2 : 0;
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

export function clearMalfunction(
  state: CombatActionState,
  request: ActionRequest & { readonly weaponId: string },
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
  const action = definition('clear-malfunction', 2);
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
  const next = {
    ...spent.state,
    weapons: { ...state.weapons, [weapon.id]: { ...weapon, jammed: !cleared } },
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
