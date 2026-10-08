import type {
  ActionRequest,
  ActionResolution,
  CombatActionState,
  DiceSource,
  HitRecord,
  RangedAttackRequest,
  RangedAttackResult,
  ResolutionContext,
} from '@kadat/contracts';
import { scopedContext, materializeCombatModifiers, ruleModifier } from './action-context.js';
import { clearTransient, updateActor } from './action-state.js';
import {
  definition,
  validateResources,
  spendResources,
  actionLog,
  type ActionWindow,
} from './action-resources.js';
import { resolveCharacteristic } from './characteristics.js';
import { resolveCheck } from './checks.js';
import { prepareDodge, resolveDodge } from './dodge.js';
import { calledModifiers, resolveHitLocations, reverseAttackRoll } from './hit-locations.js';
import { resolveRange } from './range.js';
import { validateAmmunition } from './weapons.js';

export interface OverwatchEvent {
  readonly actionId: string;
  readonly actor: { readonly actorId: string };
  readonly tags: readonly string[];
  /** Scene supplies membership; no geometry/pathfinding is inferred here. */
  readonly sectorIds: readonly string[];
}

export function validateOverwatchTrigger(
  state: CombatActionState,
  request: RangedAttackRequest,
  event: OverwatchEvent,
): void {
  const overwatch = state.actors[request.actor.actorId]?.overwatch;
  if (!overwatch) throw new Error('Overwatch expired or unavailable');
  if (!event.actionId.trim() || state.completedActionIds.includes(event.actionId))
    throw new Error('Triggering action already completed or invalid');
  if (
    event.actor.actorId === request.actor.actorId ||
    event.actor.actorId !== request.target.actorId
  )
    throw new Error('Invalid Overwatch triggering actor');
  if (
    !event.sectorIds.includes(overwatch.sector.id) ||
    !overwatch.trigger.requiresTags.every((tag) => event.tags.includes(tag))
  )
    throw new Error('Overwatch trigger/sector does not match');
  if (
    request.type === 'called-attack' ||
    request.calledLocation ||
    request.weaponId !== overwatch.weaponId ||
    request.mode !== overwatch.mode ||
    request.shotsRequested !== overwatch.shotsRequested
  )
    throw new Error('Overwatch selected attack mismatch');
}

export function prepareRangedAttack(
  state: CombatActionState,
  request: RangedAttackRequest,
  event?: OverwatchEvent,
) {
  if (!['ranged-attack', 'called-attack'].includes(request.type))
    throw new Error('Invalid ranged action type');
  const actor = state.actors[request.actor.actorId];
  const target = state.actors[request.target.actorId];
  const weapon = state.weapons[request.weaponId];
  if (
    !actor ||
    !target ||
    !weapon ||
    weapon.owner.actorId !== request.actor.actorId ||
    !weapon.readied
  )
    throw new Error('Invalid actor/target/selected weapon');
  if (weapon.jammed) throw new Error('Jammed weapon cannot fire');
  if (weapon.thermal) throw new Error('Thermal state requires authored item handling');
  const container = weapon.loadedContainerId
    ? state.containers[weapon.loadedContainerId]
    : undefined;
  if (!container) throw new Error('No loaded ammunition container');
  const effective = validateAmmunition(weapon, container, request.mode, request.shotsRequested);
  if (effective.profile.malfunction !== 'generic-jam')
    throw new Error('Item-specific malfunction requires authored property handling');
  const called = request.type === 'called-attack';
  if (
    called &&
    (request.mode !== 'single' ||
      !request.calledLocation ||
      !(request.calledLocation in calledModifiers))
  )
    throw new Error('Invalid Called Attack mode/location');
  if (!called && request.calledLocation)
    throw new Error('Ordinary attack cannot select a location');
  const range = resolveRange(request.distance, effective.profile.optimalRange);
  const modeModifier =
    request.mode === 'single'
      ? 10
      : request.mode === 'full-auto' && effective.profile.classification === 'kinetic'
        ? -10
        : 0;
  const modifiers = [
    ...request.context.modifiers,
    ruleModifier('ranged:range', range.modifier),
    ruleModifier('ranged:mode', modeModifier),
    ...(actor.aim ? [ruleModifier('ranged:aim', actor.aim.modifier)] : []),
    ...(called && request.calledLocation
      ? [ruleModifier('ranged:called', calledModifiers[request.calledLocation])]
      : []),
  ];
  const overrides = [...request.context.overrides];
  if (actor.aim?.type === 'careful') {
    for (const modifier of modifiers) {
      if (
        modifier.value < 0 &&
        modifier.tags?.some((tag) =>
          [
            'careful-aim:target-speed',
            'careful-aim:height',
            'careful-aim:running',
            'careful-aim:charge',
          ].includes(tag),
        ) &&
        !overrides.some(
          (override) => override.subject === 'modifier' && override.id === modifier.id,
        )
      ) {
        overrides.push({
          subject: 'modifier',
          id: modifier.id,
          operation: 'EXCLUDE',
          origin: 'canonical',
          reason: 'Careful Aim: explicitly permitted penalty source',
        });
      }
    }
  }
  const supplied: ResolutionContext = {
    ...request.context,
    targetActor: request.target,
    modifiers,
    overrides,
  };
  const collected = scopedContext(state, request.actor, supplied, effective.effects, [
    `action:${request.type}`,
    `mode:${request.mode}`,
    'ranged',
  ]);
  const effectExclusions =
    actor.aim?.type === 'careful'
      ? collected.effects
          .filter(
            (effect) =>
              effect.definition.target.kind === 'check' &&
              effect.definition.value < 0 &&
              effect.definition.tags.some((tag) =>
                [
                  'careful-aim:target-speed',
                  'careful-aim:height',
                  'careful-aim:running',
                  'careful-aim:charge',
                ].includes(tag),
              ) &&
              !collected.overrides.some(
                (override) => override.subject === 'effect' && override.id === effect.id,
              ),
          )
          .map((effect) => ({
            subject: 'effect' as const,
            id: effect.id,
            operation: 'EXCLUDE' as const,
            origin: 'canonical' as const,
            reason: 'Careful Aim: explicitly permitted penalty effect',
          }))
      : [];
  const context = materializeCombatModifiers({
    ...collected,
    overrides: [...collected.overrides, ...effectExclusions],
  });
  const own =
    state.session.phase === 'turn-active' &&
    state.session.activeActor?.actorId === request.actor.actorId;
  const window: ActionWindow = event ? 'overwatch' : own ? 'own-turn' : 'wait';
  if (event) validateOverwatchTrigger(state, request, event);
  const action = definition(request.type, event ? 0 : called ? 2 : 1, event ? 1 : 0, true);
  validateResources(state, request, action, context, window);
  const characteristic = resolveCharacteristic('НС', actor.characteristics.НС, context);
  const dodgeRequest: ActionRequest | null = request.dodge
    ? {
        id: request.dodge.id,
        type: 'dodge',
        actor: request.target,
        target: request.actor,
        context: request.dodge.context,
      }
    : null;
  if (dodgeRequest) {
    if (dodgeRequest.id === request.id) throw new Error('Attack and Dodge action IDs must differ');
    prepareDodge(state, dodgeRequest, request.dodgeable);
  }
  return {
    actor,
    weapon,
    container,
    effective,
    range,
    modeModifier,
    context,
    window,
    action,
    characteristic,
    dodgeRequest,
  };
}

/** Entire attack/reaction transaction returns a new snapshot or throws without changing input. */
export function resolveRangedAttack(
  state: CombatActionState,
  request: RangedAttackRequest,
  source: DiceSource,
  event?: OverwatchEvent,
): ActionResolution<RangedAttackResult> {
  const prepared = prepareRangedAttack(state, request, event);
  const check = resolveCheck(
    {
      baseValue: prepared.characteristic.result.finalValue,
      finalSuper: prepared.characteristic.result.finalSuper,
      context: prepared.context,
    },
    source,
  );
  const malfunction = check.result.rawRoll >= 96;
  const hitsGenerated =
    check.result.outcome !== 'success' || malfunction
      ? 0
      : request.mode === 'single'
        ? 1
        : request.mode === 'short-burst'
          ? Math.min(request.shotsRequested, 1 + Math.floor(check.result.totalDegrees / 2))
          : Math.min(request.shotsRequested, check.result.totalDegrees);
  const spent = spendResources(state, request, prepared.action, prepared.context, prepared.window);
  let next = spent.state;
  const logs = [prepared.characteristic.log, check.log];
  const dodge =
    prepared.dodgeRequest && hitsGenerated > 0
      ? resolveDodge(next, prepared.dodgeRequest, hitsGenerated, request.dodgeable, source)
      : null;
  if (dodge) {
    next = dodge.state;
    logs.push(...dodge.logs);
  }
  const cancelledHits = dodge?.result.cancelledHits ?? 0;
  const survivingHits = hitsGenerated - cancelledHits;
  const locations = resolveHitLocations(
    check.result.rawRoll,
    survivingHits,
    source,
    request.calledLocation,
  );
  const hits: readonly HitRecord[] = locations.map((location) => ({
    ...location,
    id: `${request.id}:hit:${location.ordinal}`,
    attackId: request.id,
    attacker: request.actor,
    target: request.target,
    weaponInstanceId: prepared.weapon.id,
    weaponTemplate: {
      kind: 'weapon-template',
      id: prepared.weapon.template.id,
      canonical: prepared.weapon.template.canonical,
    },
    ammo: prepared.container.ammo.source,
    sourceAttackRoll: check.result.rawRoll,
    degrees: {
      baseDegrees: check.result.baseDegrees,
      superDegrees: check.result.superDegrees,
      totalDegrees: check.result.totalDegrees,
    },
    mode: request.mode,
    called: request.type === 'called-attack',
    unresolvedDamage: prepared.effective.profile.damage,
    unresolvedPenetration: prepared.effective.profile.penetration,
    context: prepared.context,
    provenance: prepared.effective.provenance,
  }));
  const nextWeapon = { ...prepared.weapon, jammed: malfunction };
  const nextContainer = {
    ...prepared.container,
    currentRounds: prepared.container.currentRounds - request.shotsRequested,
  };
  next = {
    ...next,
    weapons: { ...next.weapons, [nextWeapon.id]: nextWeapon },
    containers: { ...next.containers, [nextContainer.id]: nextContainer },
  };
  const currentActor = next.actors[request.actor.actorId];
  if (!currentActor) throw new Error('Missing attacker runtime');
  next = updateActor(next, clearTransient(currentActor, event ? ['aim', 'overwatch'] : ['aim']));
  const mutations = [
    ...spent.execution.mutations,
    {
      type: 'ammo-spend',
      path: `containers.${nextContainer.id}.currentRounds`,
      before: prepared.container.currentRounds,
      after: nextContainer.currentRounds,
    },
    {
      type: 'jam-state',
      path: `weapons.${nextWeapon.id}.jammed`,
      before: prepared.weapon.jammed,
      after: nextWeapon.jammed,
    },
    {
      type: 'attacker-transient-state',
      path: `actors.${request.actor.actorId}`,
      before: prepared.actor,
      after: next.actors[request.actor.actorId],
    },
    ...(dodge ? dodge.execution.mutations : []),
  ];
  const execution = {
    ...spent.execution,
    mutations,
    selectedWeaponId: prepared.weapon.id,
    selectedFireMode: request.mode,
  };
  const result: RangedAttackResult = {
    weaponInstanceId: prepared.weapon.id,
    ammoContainerId: prepared.container.id,
    ammo: prepared.container.ammo.source,
    check: check.result,
    range: prepared.range,
    mode: request.mode,
    modeModifier: prepared.modeModifier,
    aim: prepared.actor.aim ?? null,
    shotsRequested: request.shotsRequested,
    shotsFired: request.shotsRequested,
    ammoSpent: request.shotsRequested,
    malfunction,
    jammed: nextWeapon.jammed,
    hitsGenerated,
    dodge: dodge?.result ?? null,
    cancelledHits,
    survivingHits,
    firstLocation: locations[0]?.location ?? null,
    reversedRoll:
      request.type !== 'called-attack' && survivingHits > 0
        ? reverseAttackRoll(check.result.rawRoll)
        : null,
    hits,
  };
  logs.push({
    ...actionLog(state, execution),
    resolver: 'ranged-attack',
    ranged: result,
    dice: [
      ...check.log.dice,
      ...(dodge ? [{ sides: 100, value: dodge.result.check.rawRoll }] : []),
      ...locations.flatMap((location) =>
        location.secondarySide ? [location.secondarySide.roll] : [],
      ),
    ],
    modifiers: check.result.modifiers,
    target: check.result.target,
    ...(check.log.degrees ? { degrees: check.log.degrees } : {}),
    ...(event ? { beforeActionId: event.actionId } : {}),
  });
  return { state: next, execution, result, logs };
}
