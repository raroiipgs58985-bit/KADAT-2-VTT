import type {
  ActionResolution,
  CombatActionState,
  DiceSource,
  MeleeAttackRequest,
  MeleeAttackResult,
  MeleeEffectIntent,
  MeleeHitRecord,
  ParryRequest,
  ResolutionContext,
  EffectInstance,
} from '@kadat/contracts';
import { spendResources, validateResources } from './action-resources.js';
import type { ActionWindow } from './action-resources.js';
import { meleeDefinition, finishMelee } from './melee-actions.js';
import {
  meleeBases,
  meleeTechniques,
  composeMeleeProfile,
  meleeProvenance,
  meleeSource,
} from './melee-profile.js';
import { requireMelee, updateMeleeActor } from './melee-state.js';
import {
  meleeCharacteristic,
  meleeContext,
  meleeModifier,
  meleeWeaponEffects,
  requireHeldWeapon,
} from './melee-context.js';
import {
  prepareMeleeDodge,
  resolveMeleeDodge,
  prepareParry,
  resolveParry,
} from './melee-reactions.js';
import { calledModifiers, firstHitLocation } from './hit-locations.js';
import { resolveCheck } from './checks.js';
import { rollDie } from './dice.js';
import { isMalfunction } from './weapon-properties.js';
import { resolutionLog, sessionLog } from './log.js';
import { clearTransient, updateActor } from './action-state.js';
import { opposedMeleeCheck } from './melee-opposed.js';

function temporaryDefense(
  state: CombatActionState,
  request: MeleeAttackRequest,
): CombatActionState {
  if (!['cautious', 'reckless'].includes(request.base)) return state;
  const actor = state.actors[request.actor.actorId]!;
  const definitions: EffectInstance[] = (
    request.base === 'cautious' ? ['dodge', 'parry'] : ['dodge']
  ).map((kind) => ({
    id: `${request.id}:temporary:${kind}`,
    source: meleeSource,
    targetActor: request.actor,
    provenance: meleeProvenance(`${request.base}:until-next-own-turn`),
    definition: {
      id: `${request.base}:${kind}`,
      target:
        request.base === 'cautious'
          ? { kind: 'check' }
          : { kind: 'permission', permission: 'dodge' },
      operation: request.base === 'cautious' ? 'add' : 'restrict',
      value: request.base === 'cautious' ? 10 : 1,
      stage: 'temporary',
      condition: { requiresTags: [`action:${kind}`] },
      stackingGroup: `${request.base}:${kind}`,
      stackingRule: 'independent',
      tags: [request.base],
      provenance: meleeProvenance(`${request.base}:until-next-own-turn`),
    },
  }));
  const sameDefinition = (effect: EffectInstance) =>
    effect.source.id === meleeSource.id &&
    definitions.some((definition) => definition.definition.id === effect.definition.id);
  const replacedIds = actor.effects.filter(sameDefinition).map((effect) => effect.id);
  const next = updateActor(state, {
    ...actor,
    effects: [...actor.effects.filter((effect) => !sameDefinition(effect)), ...definitions],
  });
  return {
    ...next,
    melee: {
      ...requireMelee(next),
      temporary: [
        ...requireMelee(next).temporary.filter(
          (entry) => !entry.effectIds.every((id) => replacedIds.includes(id)),
        ),
        { actor: request.actor, effectIds: definitions.map((x) => x.id), expires: 'next-own-turn' },
      ],
    },
  };
}

export function prepareMeleeAttack(state: CombatActionState, request: MeleeAttackRequest) {
  const melee = requireMelee(state),
    actor = melee.actors[request.actor.actorId];
  if (
    request.type !== 'melee-attack' ||
    !actor ||
    !(request.base in meleeBases) ||
    !(request.technique in meleeTechniques)
  )
    throw new Error('Invalid melee composition');
  const weapon = requireHeldWeapon(state, request.actor, request.weaponId);
  const composition = composeMeleeProfile(weapon, actor.grip, request.technique);
  if (
    request.targets.length === 0 ||
    (request.technique !== 'wide-sweep' && request.targets.length !== 1)
  )
    throw new Error('Technique target count invalid');
  if (
    request.base === 'called' &&
    (!request.calledLocation ||
      !(request.calledLocation in calledModifiers) ||
      request.technique !== 'normal')
  )
    throw new Error('Called melee is a single normal strike');
  if (request.base !== 'called' && request.calledLocation)
    throw new Error('Selected location requires Called base');
  const ids = request.targets.map((x) => x.actor.actorId);
  if (
    new Set(ids).size !== ids.length ||
    ids.includes(request.actor.actorId) ||
    ids.some((id) => !melee.actors[id])
  )
    throw new Error('Invalid melee targets');
  const movement = request.movementDistance ?? 0;
  if (
    !Number.isFinite(movement) ||
    movement < 0 ||
    (request.base === 'charge'
      ? movement > state.actors[request.actor.actorId]!.movement * 3
      : movement !== 0)
  )
    throw new Error('Invalid Charge distance');
  if (actor.stance === 'palisade' && request.base === 'charge')
    throw new Error('Palisade forbids Charge');
  for (const target of request.targets) {
    if (
      !Number.isFinite(target.distance) ||
      target.distance < 0 ||
      target.distance > composition.profile.reach
    )
      throw new Error('Target outside effective melee reach');
    if (target.avoidance && !['dodge', 'parry'].includes(target.avoidance.type))
      throw new Error('Only one eligible Avoidance choice');
  }
  if (
    request.technique === 'grapple' &&
    melee.grapples.some((relation) =>
      [relation.controller.actorId, relation.victim.actorId].some((id) =>
        [request.actor.actorId, ...ids].includes(id),
      ),
    )
  )
    throw new Error('Participant already Grappled');
  const defenseIds = request.targets.flatMap((target) =>
    target.avoidance ? [target.avoidance.id] : [],
  );
  if (new Set([request.id, ...defenseIds]).size !== 1 + defenseIds.length)
    throw new Error('Repeated action/defense ID');
  let window: ActionWindow = 'own-turn',
    cost = meleeBases[request.base].od,
    baseModifier = meleeBases[request.base].nr;
  let opportunity = null;
  if (request.origin === 'COUNTERATTACK') {
    opportunity = melee.counterattacks.find((x) => x.id === request.opportunityId);
    if (
      !opportunity ||
      opportunity.spent ||
      opportunity.actor.actorId !== request.actor.actorId ||
      opportunity.target.actorId !== ids[0] ||
      request.technique !== 'normal' ||
      !['free', 'called'].includes(request.base) ||
      request.targets.some((x) => x.avoidance) ||
      (request.base === 'called' && !opportunity.calledAllowed)
    )
      throw new Error('Invalid Counterattack opportunity');
    window = 'triggered';
    cost = 0;
    baseModifier = 0;
  } else if (request.origin === 'OPPORTUNITY' || request.origin === 'PALISADE_TRIGGER') {
    const trigger = request.trigger;
    if (
      !trigger ||
      !trigger.id.trim() ||
      trigger.attacker.actorId !== ids[0] ||
      request.base !== 'free' ||
      request.technique !== 'normal'
    )
      throw new Error('Invalid Free Attack trigger');
    if (
      request.origin === 'OPPORTUNITY' &&
      (trigger.type !== 'leaves-melee' ||
        !trigger.engaged ||
        trigger.target.actorId !== request.actor.actorId)
    )
      throw new Error('Free Attack requires engaged enemy leaving');
    if (request.origin === 'PALISADE_TRIGGER') {
      if (
        trigger.type !== 'palisade' ||
        actor.stance !== 'palisade' ||
        actor.palisadeSpent ||
        !['glaive', 'spear', 'bayonet'].includes(composition.profile.family) ||
        !Number.isFinite(trigger.incomingReach) ||
        trigger.incomingReach! < 0 ||
        trigger.incomingReach! >= composition.profile.reach ||
        (trigger.target.actorId !== request.actor.actorId && !trigger.allyInBaseContact)
      )
        throw new Error('Palisade trigger unavailable');
    }
    window = 'triggered';
    cost = 0;
  } else if (request.origin === 'NORMAL') {
    if (request.base === 'free') throw new Error('Free Attack requires a trigger');
    if (
      state.actors[request.actor.actorId]?.wait &&
      state.session.activeActor?.actorId !== request.actor.actorId
    )
      window = 'wait';
    if (actor.stance === 'defensive') {
      const shield = Object.values(melee.weapons).some(
        (x) =>
          x.owner.actorId === request.actor.actorId &&
          x.id !== weapon.id &&
          x.held &&
          x.readied &&
          !x.dropped &&
          x.template.profile.family === 'shield',
      );
      if (!shield || request.base === 'charge')
        throw new Error('Defensive stance prohibits ordinary melee attack');
      cost = 2;
    }
  } else throw new Error('Unsupported melee action origin');
  const followup = request.dualWield?.primaryId;
  if (followup) {
    if (window !== 'own-turn' || !state.session.turn?.flags.includes(`attack:${followup}`))
      throw new Error('Follow-up blow requires its primary attack in this turn');
    if (request.base === 'charge') throw new Error('Charge cannot be a follow-up blow');
    cost = 0;
  }
  const canonicalAction = meleeDefinition('melee-attack', cost, !followup);
  const action = {
    ...canonicalAction,
    prerequisites: [
      ...canonicalAction.prerequisites,
      'eligible-melee-profile',
      'effective-reach',
      'explicit-action-origin',
    ],
    restrictions: [
      ...canonicalAction.restrictions,
      ...(request.origin === 'COUNTERATTACK'
        ? ['no-dodge', 'no-parry', 'no-recursive-counterattack']
        : []),
    ],
  };
  const aim = state.actors[request.actor.actorId]!.aim;
  const modifiers = [
    ...(aim && request.technique !== 'knockdown'
      ? [{ id: 'melee:aim', value: aim.modifier, source: aim.source, provenance: aim.provenance }]
      : []),
    meleeModifier('melee:base', baseModifier),
    meleeModifier('melee:technique', meleeTechniques[request.technique].nr),
    meleeModifier('melee:grip', composition.nrModifier),
    ...(request.dualWield &&
    !(state.actors[request.actor.actorId]!.talents ?? []).includes('Парное оружие (Рукопашное)')
      ? [meleeModifier('melee:two-weapons', -30)]
      : []),
    ...(opportunity ? [meleeModifier('melee:counterattack', opportunity.modifier)] : []),
    ...(request.calledLocation
      ? [meleeModifier('melee:called', calledModifiers[request.calledLocation])]
      : []),
  ];
  const baseContext = meleeContext(
    state,
    request.actor,
    request.context,
    modifiers,
    meleeWeaponEffects(weapon),
    ['action:melee-attack', `origin:${request.origin}`],
  );
  validateResources(state, request, action, baseContext, window);
  const prepared = request.targets.map((target) => {
    const defender = melee.actors[target.actor.actorId]!;
    const targetModifiers = [
      ...(defender.stance === 'defensive' ? [meleeModifier('melee:defensive-target', -20)] : []),
      ...(melee.grapples.some(
        (x) =>
          x.controller.actorId === target.actor.actorId ||
          x.victim.actorId === target.actor.actorId,
      )
        ? [meleeModifier('melee:grapple-target', 20)]
        : []),
      ...(state.actors[target.actor.actorId]?.posture === 'prone'
        ? [meleeModifier('melee:prone-target', 10)]
        : []),
    ];
    const supplied = target.context ?? request.context;
    // Build separately, rather than feeding already-materialized effects back into the context.
    const context = meleeContext(
      state,
      request.actor,
      { ...supplied, targetActor: target.actor },
      [...modifiers, ...targetModifiers],
      meleeWeaponEffects(weapon),
      ['action:melee-attack', `origin:${request.origin}`],
    );
    const characteristic = meleeCharacteristic(state, request.actor, 'НР', context);
    validateResources(state, request, action, context, window);
    const feint = melee.feints.find(
      (x) =>
        x.attacker.actorId === request.actor.actorId && x.target.actorId === target.actor.actorId,
    );
    let avoidance:
      | ParryRequest
      | {
          id: string;
          type: 'dodge';
          actor: typeof target.actor;
          target: typeof request.actor;
          context: ResolutionContext;
        }
      | null = null;
    if (target.avoidance) {
      if (feint || request.origin === 'COUNTERATTACK' || request.technique === 'knockdown')
        throw new Error('Avoidance is not permitted for this resolution');
      const a = target.avoidance;
      const defense: ResolutionContext = {
        ...a.context,
        modifiers: [
          ...a.context.modifiers,
          meleeModifier('melee:technique-defense', meleeTechniques[request.technique][a.type]),
        ],
        tags: [...a.context.tags, `action:${a.type}`, 'melee:avoidance'],
      };
      avoidance =
        a.type === 'parry'
          ? {
              id: a.id,
              type: 'parry',
              actor: target.actor,
              target: request.actor,
              context: defense,
              pool: a.pool,
              incomingOrigin: request.origin,
              triggeringResolutionId: a.id,
              ...(a.weaponId ? { weaponId: a.weaponId } : {}),
            }
          : {
              id: a.id,
              type: 'dodge',
              actor: target.actor,
              target: request.actor,
              context: defense,
            };
      if (avoidance.type === 'parry') prepareParry(state, avoidance);
      else prepareMeleeDodge(state, avoidance, a.pool);
    }
    return { target, context, characteristic, avoidance };
  });
  return { actor, weapon, composition, action, window, context: baseContext, prepared };
}

export function resolveMeleeAttack(
  state: CombatActionState,
  request: MeleeAttackRequest,
  source: DiceSource,
): ActionResolution<MeleeAttackResult> {
  const prepared = prepareMeleeAttack(state, request);
  if (request.technique === 'knockdown')
    throw new Error('Use resolveKnockdown for opposed Athletics technique');
  const raw = rollDie(100, source);
  const paid = spendResources(state, request, prepared.action, prepared.context, prepared.window);
  const spent = { ...paid, execution: { ...paid.execution, selectedWeaponId: request.weaponId } };
  let next = spent.state;
  const logs = [];
  const results: MeleeAttackResult['targets'][number][] = [];
  for (const entry of prepared.prepared) {
    const check = resolveCheck(
      {
        baseValue: entry.characteristic.result.finalValue,
        finalSuper: entry.characteristic.result.finalSuper,
        context: entry.context,
      },
      { roll: () => raw.value },
    );
    logs.push(entry.characteristic.log, {
      ...check.log,
      resolver: 'melee-target-check',
      dice: [],
      baseValues: { ...check.log.baseValues, sharedAttackRawRoll: raw.value },
    });
    let avoidance: MeleeAttackResult['targets'][number]['avoidance'] = null;
    if (check.result.outcome === 'success' && entry.avoidance) {
      const defense =
        entry.avoidance.type === 'parry'
          ? resolveParry(next, entry.avoidance, 1, source)
          : resolveMeleeDodge(next, entry.avoidance, entry.target.avoidance!.pool, source);
      next = defense.state;
      avoidance = defense.result;
      logs.push(...defense.logs);
    }
    const survived =
      check.result.outcome === 'success' && (!avoidance || avoidance.survivingHits === 1);
    const intents: MeleeEffectIntent[] = [];
    let hit: MeleeHitRecord | null = null;
    if (survived) {
      if (request.technique === 'stun')
        intents.push({
          type: 'StunDurationIntent',
          context: entry.context,
          actor: request.actor,
          target: entry.target.actor,
          source: prepared.composition.profile.damage.source,
          provenance: prepared.composition.provenance,
          damage: prepared.composition.profile.damage,
          damageTransforms: prepared.composition.damageTransforms,
          durationTransform: { multiplier: 0.5, rounding: 'ceil' },
        });
      if (request.technique === 'grapple') {
        const melee = requireMelee(next);
        if (
          melee.grapples.some((x) =>
            [x.controller.actorId, x.victim.actorId].some((id) =>
              [request.actor.actorId, entry.target.actor.actorId].includes(id),
            ),
          )
        )
          throw new Error('Participant already Grappled');
        next = {
          ...next,
          melee: {
            ...melee,
            grapples: [
              ...melee.grapples,
              {
                id: `${request.id}:grapple`,
                controller: request.actor,
                victim: entry.target.actor,
                thrownAdvantage: false,
                provenance: meleeProvenance('grapple-entry'),
              },
            ],
          },
        };
      }
      if (meleeTechniques[request.technique].normalDamage)
        hit = {
          id: `${request.id}:hit:${entry.target.actor.actorId}`,
          attackId: request.id,
          attacker: request.actor,
          target: entry.target.actor,
          weaponId: request.weaponId,
          profile: prepared.composition.profile.source,
          origin: request.origin,
          base: request.base,
          technique: request.technique,
          stance: prepared.actor.stance,
          grip: prepared.actor.grip,
          rawAttackRoll: raw.value,
          check: check.result,
          called: request.base === 'called',
          location: request.calledLocation ?? firstHitLocation(raw.value),
          reach: prepared.composition.profile.reach,
          distance: entry.target.distance,
          unresolvedDamage: prepared.composition.profile.damage,
          penetration: prepared.composition.profile.penetration,
          damageTransforms: prepared.composition.damageTransforms,
          effectIntents: intents,
          context: entry.context,
          provenance: prepared.composition.provenance,
        };
    }
    results.push({
      actor: entry.target.actor,
      check: check.result,
      chosenAvoidance: entry.avoidance?.type ?? null,
      avoidance,
      hit,
      intents,
    });
  }
  // Dropped on 96+; «Надежное» only 100, «Ненадежное» 81+ (ruling 69).
  const dropped = isMalfunction(prepared.weapon.template.traits ?? [], raw.value);
  if (dropped)
    next = {
      ...next,
      melee: {
        ...requireMelee(next),
        weapons: {
          ...requireMelee(next).weapons,
          [request.weaponId]: { ...prepared.weapon, held: false, readied: false, dropped: true },
        },
      },
    };
  if (request.origin === 'COUNTERATTACK')
    next = {
      ...next,
      melee: {
        ...requireMelee(next),
        counterattacks: requireMelee(next).counterattacks.map((x) =>
          x.id === request.opportunityId ? { ...x, spent: true } : x,
        ),
      },
    };
  if (request.origin === 'PALISADE_TRIGGER')
    next = updateMeleeActor(next, request.actor.actorId, {
      ...requireMelee(next).actors[request.actor.actorId]!,
      palisadeSpent: true,
    });
  next = {
    ...next,
    melee: {
      ...requireMelee(next),
      feints: requireMelee(next).feints.filter(
        (x) =>
          !(
            x.attacker.actorId === request.actor.actorId &&
            request.targets.some((t) => t.actor.actorId === x.target.actorId)
          ),
      ),
    },
  };
  next = temporaryDefense(next, request);
  if (next.actors[request.actor.actorId]!.aim)
    next = updateActor(next, clearTransient(next.actors[request.actor.actorId]!, ['aim']));
  const result: MeleeAttackResult = {
    sharedRawRoll: raw.value,
    composition: prepared.composition,
    origin: request.origin,
    base: request.base,
    stance: prepared.actor.stance,
    dropped,
    request,
    targets: results,
  };
  const resolved = finishMelee(state, { ...spent, result, logs }, next);
  return {
    ...resolved,
    logs: [
      ...resolved.logs,
      resolutionLog('melee-attack', prepared.context, {
        combatSessionId: state.session.id,
        dice: [raw],
        melee: result,
        ...(request.origin === 'PALISADE_TRIGGER' && request.trigger
          ? { beforeActionId: request.trigger.id }
          : {}),
        action: resolved.execution,
        mutations: resolved.execution.mutations,
      }),
    ],
  };
}

export function resolveKnockdown(
  state: CombatActionState,
  request: MeleeAttackRequest,
  opponentContext: ResolutionContext,
  source: DiceSource,
) {
  if (request.technique !== 'knockdown') throw new Error('Not a Knockdown technique');
  const prepared = prepareMeleeAttack(state, request),
    target = request.targets[0]!.actor;
  // This technique uses Athletics rather than an additional NR attack roll.
  const context = meleeContext(state, request.actor, request.context, [], [], ['melee:knockdown']);
  const opposed = opposedMeleeCheck(
    state,
    request.actor,
    target,
    'athletics',
    context,
    meleeContext(state, target, opponentContext),
    source,
  );
  const paid = spendResources(state, request, prepared.action, prepared.context, prepared.window);
  const spent = { ...paid, execution: { ...paid.execution, selectedWeaponId: request.weaponId } };
  let next = spent.state;
  const intents: MeleeEffectIntent[] = [];
  if (opposed.result.winner?.actorId === request.actor.actorId) {
    const strong = opposed.result.attackerCheck.totalDegrees >= 5;
    next = updateActor(next, {
      ...next.actors[target.actorId]!,
      posture: 'prone',
      fatigue: next.actors[target.actorId]!.fatigue + (strong ? 1 : 0),
    });
    if (strong) {
      const strength = meleeCharacteristic(state, request.actor, 'СЛ', context).result;
      intents.push({
        type: 'PrimitiveDamageIntent',
        actor: request.actor,
        target,
        source: meleeSource,
        provenance: [meleeProvenance('knockdown-5-degrees')],
        damage: {
          source: meleeSource,
          expression: { count: 1, sides: 5, modifier: strength.finalBonus },
        },
        location: 'Torso',
      });
    }
  }
  return finishMelee(
    state,
    {
      ...spent,
      result: { opposed: opposed.result, composition: prepared.composition, intents },
      logs: [
        ...opposed.logs,
        resolutionLog('knockdown', context, { opposed: opposed.result, meleeIntents: intents }),
      ],
    },
    temporaryDefense(
      {
        ...next,
        melee: {
          ...requireMelee(next),
          feints: requireMelee(next).feints.filter(
            (feint) =>
              !(
                feint.attacker.actorId === request.actor.actorId &&
                feint.target.actorId === target.actorId
              ),
          ),
        },
      },
      request,
    ),
  );
}

/** Preemptive attacks are resolved first; each later action revalidates the returned state. */
export function resolvePalisadeInterrupts(
  state: CombatActionState,
  interrupts: readonly MeleeAttackRequest[],
  source: DiceSource,
  triggeringAction: (state: CombatActionState) => ActionResolution<unknown>,
) {
  let next = state;
  const resolutions: ActionResolution<MeleeAttackResult>[] = [];
  const skipped: { actionId: string; actor: MeleeAttackRequest['actor']; reason: string }[] = [];
  const logs = [];
  for (const request of interrupts) {
    if (request.origin !== 'PALISADE_TRIGGER') throw new Error('Not a Palisade interrupt');
    prepareMeleeAttack(state, request);
  }
  for (const request of interrupts) {
    if (request.origin !== 'PALISADE_TRIGGER') throw new Error('Not a Palisade interrupt');
    try {
      prepareMeleeAttack(next, request);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const record = { actionId: request.id, actor: request.actor, reason: error.message };
      skipped.push(record);
      logs.push(
        sessionLog('palisade-skipped', next.session, {
          combatSessionId: next.session.id,
          palisadeSkipped: record,
          ...(request.trigger ? { beforeActionId: request.trigger.id } : {}),
        }),
      );
      continue;
    }
    const resolved = resolveMeleeAttack(next, request, source);
    resolutions.push(resolved);
    logs.push(...resolved.logs);
    next = resolved.state;
  }
  // Caller invokes the triggering resolver on current state, never on the original snapshot.
  return { interrupts: resolutions, skipped, logs, triggering: triggeringAction(next) };
}
