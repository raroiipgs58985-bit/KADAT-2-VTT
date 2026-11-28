import type {
  ActionResolution,
  CombatActionState,
  DiceSource,
  GrappleAction,
  GrappleActionRequest,
  GrappleActionResult,
  GrappleRelation,
  MeleeEffectIntent,
  OpposedResult,
  ResolutionContext,
} from '@kadat/contracts';
import { meleeDefinition, finishMelee, grappleAdvantageContext } from './melee-actions.js';
import { meleeCharacteristic, meleeModifier } from './melee-context.js';
import { meleeSource, meleeProvenance } from './melee-profile.js';
import { requireMelee } from './melee-state.js';
import { spendResources, validateResources } from './action-resources.js';
import { opposedMeleeCheck } from './melee-opposed.js';
import { resolveCheck } from './checks.js';
import { resolveModifiers } from './context.js';
import { updateActor } from './action-state.js';
import { resolutionLog } from './log.js';

const actions: Readonly<
  Record<GrappleAction, { cost: number; role: 'controller' | 'victim'; opposed: boolean }>
> = {
  'grapple-continue': { cost: 1, role: 'controller', opposed: false },
  'grapple-damage': { cost: 2, role: 'controller', opposed: true },
  'grapple-throw': { cost: 2, role: 'controller', opposed: true },
  'grapple-push': { cost: 2, role: 'controller', opposed: true },
  'grapple-prepare': { cost: 1, role: 'controller', opposed: false },
  'grapple-stand': { cost: 2, role: 'controller', opposed: true },
  'grapple-use': { cost: 1, role: 'controller', opposed: false },
  'grapple-release': { cost: 0, role: 'controller', opposed: false },
  'grapple-escape': { cost: 1, role: 'victim', opposed: true },
  'grapple-slip': { cost: 1, role: 'victim', opposed: false },
  'grapple-reverse': { cost: 2, role: 'victim', opposed: true },
};
interface CommitContext {
  readonly state: CombatActionState;
  readonly request: GrappleActionRequest;
  readonly relation: GrappleRelation;
  readonly context: ResolutionContext;
  readonly degrees: number;
}
interface CommitResult {
  readonly state: CombatActionState;
  readonly relation: GrappleRelation | null;
  readonly intents: readonly MeleeEffectIntent[];
  readonly distance: number;
  readonly followupId: string | null;
}
function unchanged(c: CommitContext): CommitResult {
  return { state: c.state, relation: c.relation, intents: [], distance: 0, followupId: null };
}
function victimProne(c: CommitContext) {
  return updateActor(c.state, { ...c.state.actors[c.relation.victim.actorId]!, posture: 'prone' });
}
const handlers: Readonly<Record<GrappleAction, (c: CommitContext) => CommitResult>> = {
  'grapple-continue': unchanged,
  'grapple-damage': (c) => {
    const strength = meleeCharacteristic(c.state, c.relation.controller, 'СЛ', c.context).result;
    const victim = c.state.actors[c.relation.victim.actorId]!;
    return {
      ...unchanged(c),
      state: updateActor(c.state, { ...victim, fatigue: victim.fatigue + 1 }),
      intents: [
        {
          type: 'PrimitiveDamageIntent',
          actor: c.relation.controller,
          target: c.relation.victim,
          source: meleeSource,
          provenance: [meleeProvenance('grapple-damage')],
          damage: {
            source: meleeSource,
            expression: { count: 1, sides: 5, modifier: strength.finalBonus - 3 },
          },
          location: 'Torso',
        },
      ],
    };
  },
  'grapple-throw': (c) => ({
    ...unchanged(c),
    state: victimProne(c),
    relation: c.request.maintain === false ? null : { ...c.relation, thrownAdvantage: true },
  }),
  'grapple-push': (c) => ({
    ...unchanged(c),
    distance: Math.min(1 + c.degrees, c.state.actors[c.relation.controller.actorId]!.movement / 2),
  }),
  'grapple-prepare': (c) => ({
    ...unchanged(c),
    relation: { ...c.relation, preparedItem: c.request.item! },
  }),
  'grapple-stand': (c) => {
    let next = c.state;
    for (const ref of [c.relation.controller, c.relation.victim])
      next = updateActor(next, { ...next.actors[ref.actorId]!, posture: 'standing' });
    return { ...unchanged(c), state: next, relation: { ...c.relation, thrownAdvantage: false } };
  },
  'grapple-use': (c) => ({
    ...unchanged(c),
    intents: [
      {
        type: 'PreparedItemUseIntent',
        actor: c.relation.controller,
        target: c.relation.victim,
        source: c.relation.preparedItem!.source,
        provenance: [meleeProvenance('grapple-use-item')],
        item: c.relation.preparedItem!.source,
      },
    ],
  }),
  'grapple-release': (c) => ({ ...unchanged(c), relation: null }),
  'grapple-escape': (c) => ({
    ...unchanged(c),
    relation: null,
    state: {
      ...c.state,
      session: {
        ...c.state.session,
        turn: c.state.session.turn
          ? {
              ...c.state.session.turn,
              flags: [...c.state.session.turn.flags, 'grapple-escape:no-attack'],
            }
          : null,
      },
    },
  }),
  'grapple-slip': (c) => handlers['grapple-escape'](c),
  'grapple-reverse': (c) => {
    const followupId = `${c.request.id}:grapple-followup`;
    return {
      ...unchanged(c),
      relation: {
        ...c.relation,
        controller: c.relation.victim,
        victim: c.relation.controller,
        thrownAdvantage: false,
      },
      followupId,
      state: {
        ...c.state,
        melee: {
          ...requireMelee(c.state),
          followups: [
            ...requireMelee(c.state).followups,
            {
              id: followupId,
              actor: c.request.actor,
              relationId: c.relation.id,
              spent: false,
              provenance: meleeProvenance('reverse-control-one-immediate-action'),
            },
          ],
        },
      },
    };
  },
};

export function resolveGrappleAction(
  state: CombatActionState,
  request: GrappleActionRequest,
  source: DiceSource,
): ActionResolution<GrappleActionResult> {
  const melee = requireMelee(state),
    relation = melee.grapples.find((x) => x.id === request.relationId),
    rule = actions[request.type];
  if (!relation || !rule || relation[rule.role].actorId !== request.actor.actorId)
    throw new Error('Invalid Grapple role/action/relation');
  const opponent = rule.role === 'controller' ? relation.victim : relation.controller;
  const itemGrant =
    request.type === 'grapple-prepare' && request.item?.owner.actorId === relation.victim.actorId
      ? {
          ...meleeModifier('grapple:take-victim-item', 1),
          condition: { requiresTags: ['gm:explicit-item-permission'] },
        }
      : null;
  const context = grappleAdvantageContext(
    state,
    request.actor,
    itemGrant
      ? { ...request.context, modifiers: [...request.context.modifiers, itemGrant] }
      : request.context,
    relation.controller.actorId,
    relation.victim.actorId,
    relation.thrownAdvantage,
  );
  const opponentContext = grappleAdvantageContext(
    state,
    opponent,
    request.opponentContext,
    relation.controller.actorId,
    relation.victim.actorId,
    relation.thrownAdvantage,
  );
  let followup = null;
  if (request.followupId) {
    followup = melee.followups.find((x) => x.id === request.followupId);
    if (
      !followup ||
      followup.spent ||
      followup.actor.actorId !== request.actor.actorId ||
      followup.relationId !== relation.id ||
      rule.role !== 'controller' ||
      request.type === 'grapple-release'
    )
      throw new Error('Invalid/already-spent Grapple follow-up');
  } else if (melee.followups.some((x) => x.actor.actorId === request.actor.actorId && !x.spent))
    throw new Error('Immediate Grapple follow-up must be resolved before another action');
  if (
    request.type === 'grapple-stand' &&
    [relation.controller, relation.victim].some(
      (ref) => state.actors[ref.actorId]?.posture !== 'prone',
    )
  )
    throw new Error('Both Grapple participants must be prone');
  if (request.type === 'grapple-prepare') {
    if (
      !request.item ||
      ![relation.controller.actorId, relation.victim.actorId].includes(request.item.owner.actorId)
    )
      throw new Error('Missing/ineligible prepared item');
    if (request.item.owner.actorId === relation.victim.actorId) {
      const grant = meleeModifier('grapple:take-victim-item', 0);
      const trace = resolveModifiers(context).find((x) => x.id === grant.id);
      if (
        !trace?.included ||
        trace.override?.origin !== 'gm' ||
        trace.override.operation !== 'INCLUDE'
      )
        throw new Error('Taking victim item requires one-resolution GM INCLUDE');
    }
  }
  if (request.type === 'grapple-use' && !relation.preparedItem)
    throw new Error('No prepared Grapple item');
  if (
    request.type === 'grapple-throw' &&
    request.maintain !== undefined &&
    typeof request.maintain !== 'boolean'
  )
    throw new Error('Invalid throw maintain choice');
  const action = meleeDefinition(request.type, followup ? 0 : rule.cost);
  const window = followup ? 'grapple-followup' : 'own-turn';
  validateResources(state, request, action, context, window);
  let opposed: OpposedResult | null = null,
    won = true,
    degrees = 0;
  const logs = [];
  let skillCheck: GrappleActionResult['skillCheck'];
  if (rule.opposed) {
    const check = opposedMeleeCheck(
      state,
      request.actor,
      opponent,
      'СЛ',
      context,
      opponentContext,
      source,
      true,
    );
    opposed = check.result;
    won = opposed.winner?.actorId === request.actor.actorId;
    degrees = won ? (opposed.winnerDegrees ?? 0) : 0;
    logs.push(...check.logs);
  } else if (request.type === 'grapple-slip') {
    const skill = melee.actors[request.actor.actorId]!.skills.acrobatics;
    const check = resolveCheck(
      { baseValue: skill.baseValue, finalSuper: skill.finalSuper, context },
      source,
    );
    won = check.result.outcome === 'success';
    const sizeDegrees = won
      ? Math.max(
          0,
          melee.actors[request.actor.actorId]!.sizeCategory -
            melee.actors[opponent.actorId]!.sizeCategory,
        )
      : 0;
    skillCheck = {
      check: check.result,
      sizeDegrees,
      totalDegrees: check.result.totalDegrees + sizeDegrees,
    };
    logs.push(check.log);
  }
  const spent = spendResources(state, request, action, context, window);
  const commit = { state: spent.state, request, relation, context, degrees };
  const resolved = won ? handlers[request.type](commit) : unchanged(commit);
  let next: CombatActionState = {
    ...resolved.state,
    melee: {
      ...requireMelee(resolved.state),
      grapples: requireMelee(resolved.state).grapples.flatMap((x) =>
        x.id === relation.id ? (resolved.relation ? [resolved.relation] : []) : [x],
      ),
    },
  };
  if (followup)
    next = {
      ...next,
      melee: {
        ...requireMelee(next),
        followups: requireMelee(next).followups.map((x) =>
          x.id === followup.id ? { ...x, spent: true } : x,
        ),
      },
    };
  const result: GrappleActionResult = {
    relation: resolved.relation,
    opposed,
    intents: resolved.intents,
    distance: resolved.distance,
    followupId: resolved.followupId,
    ...(skillCheck ? { skillCheck } : {}),
    ...(request.type === 'grapple-push' && won
      ? {
          movement: {
            actors: [relation.controller, relation.victim],
            distance: resolved.distance,
            ...(request.direction ? { direction: request.direction } : {}),
          },
        }
      : {}),
  };
  const final = finishMelee(state, { ...spent, result, logs }, next);
  return {
    ...final,
    logs: [
      ...final.logs,
      resolutionLog(followup ? 'grapple-rule-granted-followup' : request.type, context, {
        grapple: result,
        action: final.execution,
        mutations: final.execution.mutations,
      }),
    ],
  };
}
