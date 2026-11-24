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
import { effectiveMovement } from './actions.js';
import {
  aimGivesBonus,
  ammoForAttack,
  attackTestModifiers,
  isMalfunction,
  stormHits,
} from './weapon-properties.js';

const isBasic = (weaponClass: string) => ['ОС', 'BASIC'].includes(weaponClass);
const isHeavy = (weaponClass: string) => ['ТО', 'HEAVY'].includes(weaponClass);
/**
 * Talent «Бугрящиеся бицепсы» («Профили персонажей», «Таланты (обновлены)», стр. 55): fires a
 * heavy weapon «с рук» without penalties — as if it stood on a support.
 */
export const HEAVY_FROM_HANDS_TALENT = 'Бугрящиеся бицепсы';
/** The follow-up shot of the same attack action (second weapon or next wide-arc target). */
const followupOf = (request: RangedAttackRequest) =>
  request.wideArc?.primaryId ?? request.dualWield?.primaryId;
const advanceModifier = { 'half-move': 0, 'full-move': -10, charge: -20 } as const;
const advanceMultiplier = { 'half-move': 1, 'full-move': 2, charge: 3 } as const;

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

/** Wide arc: the rate of fire counts 2 lower for hits; ammo spent stays the same. */
function hitCap(request: RangedAttackRequest): number {
  return request.wideArc ? Math.max(0, request.shotsRequested - 2) : request.shotsRequested;
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
  const followup = followupOf(request);
  if (followup) {
    if (!state.session.turn?.flags.includes(`attack:${followup}`))
      throw new Error('Follow-up shot requires its primary attack in this turn');
    if (request.tacticalAdvance) throw new Error('Tactical advance cannot be a follow-up shot');
  }
  if (request.wideArc && request.dualWield)
    throw new Error('Wide arc and two weapons do not combine');
  // A wide-arc follow-up reuses the burst already paid for: ammo is spent once.
  const effective = validateAmmunition(
    weapon,
    request.wideArc?.primaryId
      ? { ...container, currentRounds: container.currentRounds + request.shotsRequested }
      : container,
    request.mode,
    request.shotsRequested,
  );
  const traits = weapon.template.traits ?? [];
  const ammoNeeded = request.wideArc?.primaryId ? 0 : ammoForAttack(traits, request.shotsRequested);
  if (ammoNeeded > container.currentRounds) throw new Error('Insufficient ammunition');
  const weaponClass = effective.profile.weaponClass;
  const fromHands = (actor.talents ?? []).includes(HEAVY_FROM_HANDS_TALENT);
  const supported = !!weapon.braced || fromHands;
  if (isHeavy(weaponClass) && !supported && request.mode !== 'single')
    throw new Error('Unbraced heavy weapon cannot fire bursts');
  if (request.wideArc) {
    if (request.mode === 'single') throw new Error('Wide arc requires a burst');
    const maxShots = effective.profile.modes.find((m) => m.mode === request.mode)?.maxShots ?? 0;
    if (maxShots <= 3 && effective.profile.classification !== 'energy-beam')
      throw new Error('Wide arc requires a rate of fire above 3');
  }
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
  const familyModifier = effective.profile.modeModifiers?.[request.mode];
  const modeModifier =
    familyModifier !== undefined
      ? familyModifier
      : request.mode === 'single'
        ? 10
        : request.mode === 'full-auto' && effective.profile.classification === 'kinetic'
          ? -10
          : 0;
  const dualTalent = (actor.talents ?? []).includes('Парное оружие (Стрелковое)');
  const modifiers = [
    ...request.context.modifiers,
    ruleModifier('ranged:range', range.modifier),
    ruleModifier('ranged:mode', modeModifier),
    ...(request.oneHanded && isBasic(weaponClass) ? [ruleModifier('ranged:one-handed', -20)] : []),
    ...(isHeavy(weaponClass) && !supported ? [ruleModifier('ranged:unbraced-heavy', -30)] : []),
    ...(request.tacticalAdvance
      ? [
          ruleModifier(
            'ranged:tactical-advance',
            advanceModifier[request.tacticalAdvance.movementMode],
          ),
        ]
      : []),
    ...(request.dualWield && !dualTalent
      ? [
          ruleModifier(
            'ranged:two-weapons',
            (actor.talents ?? []).includes('Амбидекстрия') ? -20 : -30,
          ),
        ]
      : []),
    ...(actor.aim && aimGivesBonus(traits) ? [ruleModifier('ranged:aim', actor.aim.modifier)] : []),
    ...attackTestModifiers(traits, {
      kind: 'ranged',
      aimed: Boolean(actor.aim),
      mode: request.mode,
      distance: request.distance,
      optimalRange: effective.profile.optimalRange,
    }).map((m) => ruleModifier(`property:${m.property}`, m.value)),
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
  if (request.tacticalAdvance && (called || event)) throw new Error('Invalid tactical advance');
  const speed = effectiveMovement(actor);
  if (
    request.tacticalAdvance &&
    speed.crawling &&
    request.tacticalAdvance.movementMode === 'charge'
  )
    throw new Error('Charge is unavailable while crawling');
  const movementDistance = request.tacticalAdvance
    ? speed.value * advanceMultiplier[request.tacticalAdvance.movementMode]
    : undefined;
  const action = followup
    ? definition(request.type, 0, 0, false)
    : definition(
        request.type,
        event ? 0 : request.tacticalAdvance ? 2 : called ? 2 : 1,
        event ? 1 : 0,
        true,
      );
  validateResources(state, request, action, context, window);
  const characteristic = resolveCharacteristic('НС', actor.characteristics.НС, context);
  const dodgeRequest: ActionRequest | null = request.dodge
    ? {
        id: request.dodge.id,
        type: 'dodge',
        actor: request.target,
        target: request.actor,
        context: request.wideArc
          ? {
              ...request.dodge.context,
              modifiers: [
                ...request.dodge.context.modifiers,
                ruleModifier('ranged:wide-arc-dodge', -20),
              ],
            }
          : request.dodge.context,
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
    movementDistance,
    traits,
    ammoNeeded,
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
  // Default 96+; «Надежное» 100, «Ненадежное» 81+ (ruling 69).
  const malfunction = isMalfunction(prepared.traits, check.result.rawRoll);
  const baseHits =
    check.result.outcome !== 'success' || malfunction
      ? 0
      : request.mode === 'single'
        ? 1
        : request.mode === 'short-burst'
          ? Math.min(hitCap(request), 1 + Math.floor(check.result.totalDegrees / 2))
          : Math.min(hitCap(request), check.result.totalDegrees);
  // «Шторм (Х)»: +Х hits per degree, never above the declared rate (rulings 66, 70).
  const hitsGenerated = stormHits(prepared.traits, {
    mode: request.mode,
    baseHits,
    degrees: check.result.totalDegrees,
    declaredShots: hitCap(request),
  });
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
  const ammoSpent = prepared.ammoNeeded;
  const nextWeapon = {
    ...prepared.weapon,
    jammed: malfunction,
    // Moving during a tactical advance takes a heavy weapon off its support (ruling 41).
    ...(request.tacticalAdvance ? { braced: false } : {}),
  };
  const nextContainer = {
    ...prepared.container,
    currentRounds: prepared.container.currentRounds - ammoSpent,
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
    ammoSpent,
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
    ...(prepared.movementDistance !== undefined
      ? { movementDistance: prepared.movementDistance }
      : {}),
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
