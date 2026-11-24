import type {
  ActionResolution,
  AvoidancePool,
  CombatActionState,
  DiceSource,
  ParryRequest,
  ParryResult,
  ActionRequest,
  CounterattackOpportunity,
} from '@kadat/contracts';
import { resolveCheck } from './checks.js';
import { prepareDodge, resolveDodge } from './dodge.js';
import { definition, spendResources, validateResources, actionLog } from './action-resources.js';
import { resolveEffects } from './context.js';
import { composeMeleeProfile, meleeProvenance, meleeSource } from './melee-profile.js';
import {
  meleeCharacteristic,
  meleeContext,
  meleeWeaponEffects,
  requireHeldWeapon,
  meleeModifier,
} from './melee-context.js';
import { requireMelee, updateMeleeActor } from './melee-state.js';
import { integer } from './validation.js';

/** Talent «Контратака»: a counterattack after a parry with 1 degree of success. */
export const COUNTERATTACK_TALENT = 'Контратака';

function scopedReactionState(
  state: CombatActionState,
  actorId: string,
  pool: AvoidancePool,
): CombatActionState {
  if (pool === 'normal') return state;
  if (pool !== 'melee-only') throw new Error('Invalid Avoidance pool');
  const actor = requireMelee(state).actors[actorId];
  if (!actor || actor.stance !== 'defensive' || actor.meleeOnlyReactionRemaining !== 1)
    throw new Error('Unavailable melee-only Avoidance Reaction');
  return {
    ...state,
    session: {
      ...state.session,
      initiativeOrder: state.session.initiativeOrder.map((entry) =>
        entry.actor.actorId === actorId
          ? { ...entry, reactions: { capacity: 1, remaining: 1 } }
          : entry,
      ),
    },
  };
}

function restoreScopedReaction<T>(
  original: CombatActionState,
  result: ActionResolution<T>,
  actorId: string,
  pool: AvoidancePool,
): ActionResolution<T> {
  if (pool === 'normal') return result;
  const originalEntry = original.session.initiativeOrder.find(
    (entry) => entry.actor.actorId === actorId,
  );
  const actor = requireMelee(result.state).actors[actorId];
  if (!originalEntry || !actor) throw new Error('Unknown Reaction actor');
  const state = updateMeleeActor(
    {
      ...result.state,
      session: {
        ...result.state.session,
        initiativeOrder: result.state.session.initiativeOrder.map((entry) =>
          entry.actor.actorId === actorId
            ? { ...entry, reactions: originalEntry.reactions }
            : entry,
        ),
      },
    },
    actorId,
    { ...actor, meleeOnlyReactionRemaining: 0 },
  );
  const mutations = result.execution.mutations.map((mutation) =>
    mutation.type === 'reaction-spend'
      ? { ...mutation, path: `melee.actors.${actorId}.meleeOnlyReactionRemaining` }
      : mutation,
  );
  const execution = { ...result.execution, reactionScope: 'melee-only' as const, mutations };
  return {
    ...result,
    state,
    execution,
    logs: result.logs.map((log) =>
      log.action?.id === execution.id ? { ...log, action: execution, mutations } : log,
    ),
  };
}

export function resolveMeleeDodge(
  state: CombatActionState,
  request: ActionRequest,
  pool: AvoidancePool,
  source: DiceSource,
) {
  return resolveMeleeDodgeHits(state, request, pool, 1, source);
}
/** Dodge against several melee hits at once (swift / lightning attacks, ruling 130). */
export function resolveMeleeDodgeHits(
  state: CombatActionState,
  request: ActionRequest,
  pool: AvoidancePool,
  hits: number,
  source: DiceSource,
) {
  const prepared = prepareMeleeDodge(state, request, pool);
  return restoreScopedReaction(
    state,
    resolveDodge(
      scopedReactionState(state, request.actor.actorId, pool),
      { ...request, context: prepared.context },
      hits,
      true,
      source,
    ),
    request.actor.actorId,
    pool,
  );
}

export function prepareMeleeDodge(
  state: CombatActionState,
  request: ActionRequest,
  pool: AvoidancePool,
) {
  const context = meleeContext(
    state,
    request.actor,
    request.context,
    [],
    [],
    ['action:dodge', 'melee:avoidance'],
  );
  return prepareDodge(
    scopedReactionState(state, request.actor.actorId, pool),
    { ...request, context },
    true,
  );
}

export function prepareParry(state: CombatActionState, request: ParryRequest) {
  if (request.type !== 'parry' || request.incomingOrigin === 'COUNTERATTACK')
    throw new Error('Counterattack cannot be Parried');
  const actor = requireMelee(state).actors[request.actor.actorId];
  if (!actor || !request.target || !request.triggeringResolutionId.trim())
    throw new Error('Invalid Parry participants/trigger');
  if (!state.actors[request.target.actorId] || request.target.actorId === request.actor.actorId)
    throw new Error('Invalid Parry opponent');
  if (
    requireMelee(state).counterattacks.some(
      (entry) => entry.triggeringResolutionId === request.triggeringResolutionId,
    )
  )
    throw new Error('Only one Counterattack per triggering resolution');
  const weapon = request.weaponId
    ? requireHeldWeapon(state, request.actor, request.weaponId)
    : null;
  const composed = weapon ? composeMeleeProfile(weapon, actor.grip, 'normal') : null;
  const context = meleeContext(
    state,
    request.actor,
    request.context,
    composed ? [meleeModifier('melee:grip', composed.nrModifier)] : [],
    weapon ? meleeWeaponEffects(weapon) : [],
    ['action:parry', 'melee:avoidance'],
  );
  const traces = resolveEffects(context);
  const permissions = context.effects.filter(
    (effect, index) =>
      traces[index]?.included &&
      traces[index].value > 0 &&
      effect.targetActor.actorId === request.actor.actorId &&
      effect.definition.target.kind === 'permission',
  );
  if (
    permissions.some(
      (effect) =>
        effect.definition.target.kind === 'permission' &&
        effect.definition.target.permission === 'parry' &&
        effect.definition.operation === 'restrict',
    )
  )
    throw new Error('Parry prohibited by effect');
  if (
    !composed?.profile.parryEligible &&
    !permissions.some(
      (effect) =>
        effect.definition.target.kind === 'permission' &&
        effect.definition.target.permission === 'parry' &&
        effect.definition.operation === 'grant',
    )
  )
    throw new Error('Parry requires an eligible weapon/effect');
  const virtual = scopedReactionState(state, request.actor.actorId, request.pool);
  const action = {
    ...definition('parry', 0, 1),
    source: meleeSource,
    provenance: meleeProvenance('parry'),
  };
  validateResources(virtual, request, action, context, 'reaction');
  const characteristic = meleeCharacteristic(state, request.actor, 'НР', context);
  return { context, action, characteristic, virtual, actor, permissions };
}

export function resolveParry(
  state: CombatActionState,
  request: ParryRequest,
  incomingHits: number,
  source: DiceSource,
): ActionResolution<ParryResult> {
  integer(incomingHits, 'incoming melee hits', 1);
  const prepared = prepareParry(state, request);
  const check = resolveCheck(
    {
      baseValue: prepared.characteristic.result.finalValue,
      finalSuper: prepared.characteristic.result.finalSuper,
      context: prepared.context,
    },
    source,
  );
  const success = check.result.outcome === 'success';
  const close = prepared.actor.grip === 'close' && request.weaponId !== undefined;
  const effectGrant = prepared.permissions.filter(
    (effect) =>
      effect.definition.target.kind === 'permission' &&
      effect.definition.target.permission === 'counterattack' &&
      effect.definition.operation === 'grant',
  );
  const prohibited = prepared.permissions.some(
    (effect) =>
      effect.definition.target.kind === 'permission' &&
      effect.definition.target.permission === 'counterattack' &&
      effect.definition.operation === 'restrict',
  );
  // Talent «Контратака»: the counterattack comes already at 1 degree of the parry instead of 3.
  const counterDegrees = (state.actors[request.actor.actorId]?.talents ?? []).includes(
    COUNTERATTACK_TALENT,
  )
    ? 1
    : 3;
  const granted =
    !prohibited &&
    success &&
    (close || check.result.totalDegrees >= counterDegrees || effectGrant.length > 0);
  const melee = requireMelee(state);
  if (
    granted &&
    melee.counterattacks.some(
      (entry) => entry.triggeringResolutionId === request.triggeringResolutionId,
    )
  )
    throw new Error('Only one Counterattack per triggering resolution');
  const opportunity: CounterattackOpportunity | null = granted
    ? {
        id: `${request.triggeringResolutionId}:counter:${request.actor.actorId}`,
        actor: request.actor,
        target: request.target!,
        triggeringResolutionId: request.triggeringResolutionId,
        modifier: close ? check.result.totalDegrees * 10 : 0,
        calledAllowed: prepared.actor.stance === 'defensive',
        spent: false,
        provenance: [
          meleeProvenance(close ? 'close-grip-counterattack' : 'parry-3-degree-counterattack'),
          ...effectGrant.map((effect) => effect.provenance),
        ],
      }
    : null;
  const spent = spendResources(
    prepared.virtual,
    request,
    prepared.action,
    prepared.context,
    'reaction',
  );
  let next = spent.state;
  if (opportunity)
    next = {
      ...next,
      melee: { ...requireMelee(next), counterattacks: [...melee.counterattacks, opportunity] },
    };
  const result: ParryResult = {
    check: check.result,
    cancelledHits: success ? Math.min(incomingHits, check.result.totalDegrees) : 0,
    survivingHits: success ? Math.max(0, incomingHits - check.result.totalDegrees) : incomingHits,
    counterattack: opportunity,
  };
  const mutation = {
    type: 'counterattack-opportunity',
    path: 'melee.counterattacks',
    before: melee.counterattacks,
    after: requireMelee(next).counterattacks,
  };
  const execution = { ...spent.execution, mutations: [...spent.execution.mutations, mutation] };
  return restoreScopedReaction(
    state,
    {
      state: next,
      execution,
      result,
      logs: [prepared.characteristic.log, check.log, actionLog(state, execution)],
    },
    request.actor.actorId,
    request.pool,
  );
}
