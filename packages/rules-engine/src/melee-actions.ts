import type {
  ActionRequest,
  ActionResolution,
  CombatActionState,
  DiceSource,
  MeleeGrip,
  MeleeStance,
  OpposedResult,
  ResolutionContext,
  SourceReference,
} from '@kadat/contracts';
import { definition, spendResources, validateResources, actionLog } from './action-resources.js';
import { meleeContext, meleeModifier, requireHeldWeapon } from './melee-context.js';
import { composeMeleeProfile, meleeSource, meleeProvenance } from './melee-profile.js';
import { requireMelee, updateMeleeActor } from './melee-state.js';
import { opposedMeleeCheck } from './melee-opposed.js';
import { updateActor } from './action-state.js';

export function meleeDefinition(type: ActionRequest['type'], cost: number, attack = false) {
  return {
    ...definition(type, cost, 0, attack),
    source: meleeSource,
    provenance: meleeProvenance(type),
  };
}

/** Captures committed runtime deltas, while all source records stay immutable. */
export function finishMelee<T>(
  original: CombatActionState,
  resolved: ActionResolution<T>,
  next: CombatActionState,
): ActionResolution<T> {
  const mutations = [
    ...resolved.execution.mutations,
    ...(original.melee !== next.melee
      ? [{ type: 'melee-state', path: 'melee', before: original.melee, after: next.melee }]
      : []),
    ...(original.actors !== next.actors
      ? [{ type: 'actor-runtime', path: 'actors', before: original.actors, after: next.actors }]
      : []),
    ...(original.session.turn?.flags !== next.session.turn?.flags
      ? [
          {
            type: 'turn-flags',
            path: 'session.turn.flags',
            before: original.session.turn?.flags,
            after: next.session.turn?.flags,
          },
        ]
      : []),
  ];
  const execution = { ...resolved.execution, mutations };
  return {
    ...resolved,
    state: next,
    execution,
    logs: [...resolved.logs, actionLog(original, execution)],
  };
}

export interface ChangeMeleeRequest extends ActionRequest {
  readonly type: 'change-stance-grip';
  readonly stance?: MeleeStance;
  readonly grip?: MeleeGrip;
}
export function changeMeleeStanceGrip(
  state: CombatActionState,
  request: ChangeMeleeRequest,
): ActionResolution<{ stance: MeleeStance; grip: MeleeGrip }> {
  const actor = requireMelee(state).actors[request.actor.actorId];
  if (!actor || (!request.stance && !request.grip)) throw new Error('Missing stance/grip change');
  const weapon = requireHeldWeapon(state, request.actor, actor.weaponId);
  const stance = request.stance ?? actor.stance;
  const grip = request.grip ?? actor.grip;
  if (!['standard', 'defensive', 'palisade'].includes(stance)) throw new Error('Invalid stance');
  const profile = composeMeleeProfile(weapon, grip, 'normal');
  if (stance === 'palisade' && !['glaive', 'spear', 'bayonet'].includes(profile.profile.family))
    throw new Error('Ineligible Palisade profile');
  const context = meleeContext(state, request.actor, request.context);
  const spent = spendResources(
    state,
    request,
    meleeDefinition(request.type, 0),
    context,
    'own-turn',
  );
  const next = updateMeleeActor(spent.state, request.actor.actorId, { ...actor, stance, grip });
  return finishMelee(state, { ...spent, result: { stance, grip }, logs: [] }, next);
}

export interface MeleeOpposedActionRequest extends ActionRequest {
  readonly type: 'feint' | 'pressure';
  readonly target: NonNullable<ActionRequest['target']>;
  readonly opponentContext: ResolutionContext;
}
export function resolveMeleeOpposedAction(
  state: CombatActionState,
  request: MeleeOpposedActionRequest,
  source: DiceSource,
): ActionResolution<{ opposed: OpposedResult; distance: number }> {
  const melee = requireMelee(state);
  const context = meleeContext(state, request.actor, request.context);
  const other = meleeContext(state, request.target, request.opponentContext);
  const action = meleeDefinition(request.type, 1);
  validateResources(state, request, action, context, 'own-turn');
  const opposed = opposedMeleeCheck(
    state,
    request.actor,
    request.target,
    'НР',
    context,
    other,
    source,
  );
  const spent = spendResources(state, request, action, context, 'own-turn');
  let next = spent.state;
  const won = opposed.result.winner?.actorId === request.actor.actorId;
  const distance =
    won && request.type === 'pressure'
      ? Math.min(
          opposed.result.attackerCheck.totalDegrees,
          state.actors[request.target.actorId]!.movement,
        )
      : 0;
  if (won && request.type === 'feint')
    next = {
      ...next,
      melee: {
        ...melee,
        feints: [
          ...melee.feints.filter(
            (x) =>
              !(
                x.attacker.actorId === request.actor.actorId &&
                x.target.actorId === request.target.actorId
              ),
          ),
          {
            id: request.id,
            attacker: request.actor,
            target: request.target,
            provenance: meleeProvenance('feint-next-melee'),
          },
        ],
      },
    };
  const result = { opposed: opposed.result, distance };
  return finishMelee(
    state,
    {
      ...spent,
      result,
      logs: [
        ...opposed.logs,
        {
          ...actionLog(state, spent.execution),
          opposed: opposed.result,
          opponentContext: other,
          ...(request.type === 'pressure'
            ? { meleeMovement: { actorIds: [request.target.actorId], distance } }
            : {}),
        },
      ],
    },
    next,
  );
}

export interface BreakthroughRequest extends ActionRequest {
  readonly type: 'breakthrough';
  readonly movementMode: 'charge' | 'run';
  readonly distance: number;
  readonly opponents: readonly {
    readonly actor: NonNullable<ActionRequest['target']>;
    readonly context: ResolutionContext;
    readonly distance: number;
  }[];
  readonly pathSource: SourceReference;
}
export function resolveBreakthrough(
  state: CombatActionState,
  request: BreakthroughRequest,
  source: DiceSource,
): ActionResolution<{
  distance: number;
  stoppedBefore: string | null;
  opposed: readonly OpposedResult[];
}> {
  const actor = requireMelee(state).actors[request.actor.actorId];
  const movement = state.actors[request.actor.actorId]?.movement;
  if (
    !actor ||
    !movement ||
    !['charge', 'run'].includes(request.movementMode) ||
    actor.stance === 'palisade'
  )
    throw new Error('Invalid/restricted Breakthrough movement');
  const max = movement * (request.movementMode === 'charge' ? 3 : 6);
  if (!Number.isFinite(request.distance) || request.distance < 0 || request.distance > max)
    throw new Error('Invalid Breakthrough distance');
  let previous = -1;
  const ids = new Set<string>();
  for (const opponent of request.opponents) {
    if (
      !requireMelee(state).actors[opponent.actor.actorId] ||
      opponent.actor.actorId === request.actor.actorId ||
      ids.has(opponent.actor.actorId) ||
      !Number.isFinite(opponent.distance) ||
      opponent.distance < previous ||
      opponent.distance > request.distance
    )
      throw new Error('Invalid ordered Breakthrough path');
    previous = opponent.distance;
    ids.add(opponent.actor.actorId);
    meleeContext(state, opponent.actor, opponent.context);
  }
  const context = meleeContext(state, request.actor, request.context);
  const action = meleeDefinition(request.type, 2);
  validateResources(state, request, action, context, 'own-turn');
  const spent = spendResources(state, request, action, context, 'own-turn');
  let next = spent.state,
    stoppedBefore: string | null = null,
    distance = request.distance;
  const checks: OpposedResult[] = [];
  const logs = [];
  for (const opponent of request.opponents) {
    const check = opposedMeleeCheck(
      next,
      request.actor,
      opponent.actor,
      'athletics',
      context,
      meleeContext(next, opponent.actor, opponent.context),
      source,
    );
    checks.push(check.result);
    logs.push(...check.logs, {
      ...actionLog(state, spent.execution),
      opposed: check.result,
      opponentContext: opponent.context,
    });
    if (check.result.winner?.actorId !== request.actor.actorId) {
      stoppedBefore = opponent.actor.actorId;
      distance = opponent.distance;
      break;
    }
    next = updateActor(next, { ...next.actors[opponent.actor.actorId]!, posture: 'prone' });
  }
  return finishMelee(
    state,
    {
      ...spent,
      result: { distance, stoppedBefore, opposed: checks },
      logs: [
        ...logs,
        {
          ...actionLog(state, spent.execution),
          meleeMovement: {
            actorIds: [request.actor.actorId],
            distance,
            stoppedBefore,
            pathSource: request.pathSource,
          },
        },
      ],
    },
    next,
  );
}

export function grappleAdvantageContext(
  state: CombatActionState,
  actor: ActionRequest['actor'],
  context: ResolutionContext,
  controllerId: string,
  victimId: string,
  thrown: boolean,
) {
  const bonus =
    thrown && actor.actorId === controllerId && state.actors[victimId]?.posture === 'prone'
      ? 10
      : 0;
  return meleeContext(
    state,
    actor,
    context,
    bonus ? [meleeModifier('grapple:throw-advantage', bonus)] : [],
  );
}
