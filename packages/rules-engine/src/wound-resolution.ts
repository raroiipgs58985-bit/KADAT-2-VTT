import type {
  CalledLocation,
  ConsequenceZone,
  DiceSource,
  InjuryRecord,
  PostDamageRequest,
  PostDamageResolution,
  PostDamageResolutionResult,
  WoundIntent,
} from '@kadat/contracts';
import { lookupConsequence } from './consequence-catalog.js';
import { planConsequence } from './consequence-plan.js';
import { planBleedingPulse } from './wound-bleeding.js';
import { rollDie } from './dice.js';
import { resolutionLog } from './log.js';
import {
  classifyWounds,
  currentWoundBonuses,
  validateWoundRuntime,
  validateWoundFacts,
  woundContext,
  woundDice,
  woundIntent,
  woundProvenance,
} from './wound-state.js';
import { integer } from './validation.js';

export function consequenceZoneFor(
  location: CalledLocation,
  explicit?: ConsequenceZone,
): ConsequenceZone | null {
  const zone =
    location === 'Head'
      ? 'HEAD'
      : location === 'Torso'
        ? 'TORSO'
        : location === 'Left Arm' || location === 'Right Arm'
          ? 'ARM'
          : location === 'Left Leg' || location === 'Right Leg'
            ? 'LEG'
            : null;
  if (zone && explicit && zone !== explicit)
    throw new Error('Cannot override explicit canonical body zone');
  if (
    ![
      'Head',
      'Torso',
      'Left Arm',
      'Right Arm',
      'Left Leg',
      'Right Leg',
      'Eyes',
      'Armor Joints',
    ].includes(location)
  )
    throw new Error('Invalid wound hit location');
  if (explicit && !['HEAD', 'ARM', 'TORSO', 'LEG'].includes(explicit))
    throw new Error('Unsupported consequence zone');
  return zone ?? explicit ?? null;
}
export function resolvePostDamage(
  request: PostDamageRequest,
  source: DiceSource,
): PostDamageResolution {
  const { damage, state } = request;
  validateWoundRuntime(state);
  if (!damage?.input || damage.status !== 'RESOLVED')
    throw new Error('C-2 requires a resolved, surviving C-1 DamageResolutionResult');
  integer(damage.finalDamage!, 'C-1 finalDamage', 0);
  if (typeof damage.critical !== 'boolean') throw new Error('Missing critical flag');
  integer(damage.criticalConsequenceDiceCount, 'critical consequence count', 0);
  if (
    damage.criticalConsequenceDiceCount > 1 ||
    damage.criticalConsequenceDiceCount !== (damage.critical ? 1 : 0) ||
    !damage.criticalConsequence?.unresolved ||
    damage.criticalConsequence.diceCount !== damage.criticalConsequenceDiceCount
  )
    throw new Error('Critical marker invariant violation');
  const { input } = damage,
    actor = input.target,
    before = state.actors[actor.actorId];
  if (!before) throw new Error('Missing wound actor');
  if (before.life.status === 'DEAD') throw new Error('Cannot wound terminal dead actor');
  if (!input.hitId?.trim() || !input.attackId?.trim() || !input.attacker.actorId?.trim())
    throw new Error('Incomplete C-1 runtime identities');
  if (state.processedHitIds.includes(input.hitId)) throw new Error('Repeated post-damage hit');
  validateWoundFacts(request.facts);
  const context = woundContext(state, actor, request.context),
    zone = consequenceZoneFor(input.location, request.facts?.consequenceZone),
    tape = woundDice(source, request.resumeDice);
  const die = damage.criticalConsequenceDiceCount === 1 ? rollDie(10, tape.source) : null;
  const severity = damage.finalDamage! + (die?.value ?? 0);
  integer(severity, 'consequence severity', 0);
  const damageTakenAfter = before.damageTaken + damage.finalDamage!;
  integer(damageTakenAfter, 'damageTaken after', 0);
  const escalating =
    damage.finalDamage! > 0
      ? before.injuries.filter((i) =>
          i.triggers.some(
            (t) => t.kind === 'same-limb-damage' && !t.consumed && t.location === input.location,
          ),
        )
      : [];
  const selectedSeverity = escalating.length ? Math.max(20, severity) : severity;
  const row = zone ? lookupConsequence(zone, selectedSeverity) : null;
  let next = state,
    blocked = !zone;
  const pending: WoundIntent[] = zone
    ? []
    : [
        woundIntent(
          `${input.hitId}:zone-required`,
          'BodyZoneMappingRequired',
          actor,
          woundProvenance('C-2 location boundary'),
          'Unsupported special location requires explicit coarse consequence mapping',
          { location: input.location },
        ),
      ];
  const bloodBefore = before.blood;
  let planned: ReturnType<typeof planConsequence> | null = null,
    pulse: ReturnType<typeof planBleedingPulse> | null = null;
  if (zone) {
    next = {
      ...state,
      actors: { ...state.actors, [actor.actorId]: { ...before, damageTaken: damageTakenAfter } },
    };
    if (row) {
      const injuryId = `${input.hitId}:injury`;
      if (before.injuries.some((i) => i.id === injuryId)) throw new Error('Duplicate Injury ID');
      const { bVN } = currentWoundBonuses(next, actor, context);
      planned = planConsequence(
        next,
        actor,
        row,
        input.location,
        injuryId,
        bVN,
        context,
        request.facts,
        tape.source,
      );
      next = planned.state;
      blocked ||= planned.blocked;
      pending.push(...planned.pending);
      const runtime = next.combat.actors[actor.actorId]!,
        beforeEffects = new Set(state.combat.actors[actor.actorId]!.effects.map((e) => e.id));
      const injury: InjuryRecord = {
        id: injuryId,
        actor,
        sourceAttackId: input.attackId,
        sourceHitId: input.hitId,
        consequence: row,
        location: input.location,
        side: input.location.startsWith('Left')
          ? 'Left'
          : input.location.startsWith('Right')
            ? 'Right'
            : null,
        finalDamage: damage.finalDamage!,
        severity: selectedSeverity,
        title: row.title,
        createdRound: state.combat.session.roundNumber,
        createdTurn: state.combat.session.turn?.turnNumber ?? state.combat.session.turnsStarted,
        features: planned.features,
        bleedingSourceIds: planned.bleeding,
        persistentEffects: runtime.effects.filter((e) => !beforeEffects.has(e.id)),
        triggers: planned.triggers,
        canonicalText: row.text,
        provenance: [
          ...input.provenance,
          row.provenance,
          ...escalating.flatMap((i) => i.provenance),
        ],
      };
      const a = next.actors[actor.actorId]!;
      next = {
        ...next,
        actors: {
          ...next.actors,
          [actor.actorId]: {
            ...a,
            injuries: [
              ...a.injuries.map((i) =>
                escalating.some((old) => old.id === i.id)
                  ? {
                      ...i,
                      triggers: i.triggers.map((t) =>
                        t.kind === 'same-limb-damage' && t.location === input.location
                          ? { ...t, consumed: true }
                          : t,
                      ),
                    }
                  : i,
              ),
              injury,
            ],
          },
        },
      };
      if (!blocked && planned.bleeding.length) {
        const ids = new Set(planned.bleeding);
        pulse = planBleedingPulse(
          next,
          actor,
          next.actors[actor.actorId]!.bleeding.filter((b) => ids.has(b.id)),
          context,
          request.facts,
          tape.source,
        );
        pending.push(...pulse.pending);
        blocked ||= pulse.pending.length > 0;
        next = pulse.state;
      }
    }
  }
  if (!blocked) {
    tape.assertComplete();
    next = { ...next, processedHitIds: [...state.processedHitIds, input.hitId] };
    validateWoundRuntime(next);
  } else next = state;
  const after = next.actors[actor.actorId]!;
  const previousConditions = new Map(
    [...state.combat.session.conditions, ...before.conditions].map((c) => [c.id, c]),
  );
  const conditions = [
    ...next.combat.session.conditions.filter((c) => c.actor.actorId === actor.actorId),
    ...after.conditions,
  ].filter((c) => previousConditions.get(c.id) !== c);
  const originalEffects = new Set(
    [
      ...state.combat.actors[actor.actorId]!.effects,
      ...state.combat.session.conditions.flatMap((c) => c.effects),
    ].map((e) => e.id),
  );
  const effects = [
    ...next.combat.actors[actor.actorId]!.effects,
    ...next.combat.session.conditions
      .filter((c) => c.actor.actorId === actor.actorId)
      .flatMap((c) => c.effects),
  ].filter((e) => !originalEffects.has(e.id));
  const mutations = blocked
    ? []
    : [
        { type: 'post-damage-wounds', actor, path: `wounds.${actor.actorId}`, before, after },
        {
          type: 'post-damage-combat-state',
          actor,
          path: `combat.actors.${actor.actorId}`,
          before: state.combat.actors[actor.actorId]!,
          after: next.combat.actors[actor.actorId]!,
        },
        {
          type: 'post-damage-conditions',
          actor,
          path: 'combat.conditions',
          before: state.combat.session.conditions,
          after: next.combat.session.conditions,
        },
      ];
  const result: PostDamageResolutionResult = {
    damage,
    status: blocked ? 'CONTEXT_REQUIRED' : 'RESOLVED',
    attackId: input.attackId,
    hitId: input.hitId,
    attacker: input.attacker,
    target: actor,
    location: input.location,
    finalDamageOfThisHit: damage.finalDamage!,
    damageTakenBefore: before.damageTaken,
    damageTakenAfter: after.damageTaken,
    maxWounds: before.maxWounds,
    woundStateBefore: classifyWounds(before.maxWounds, before.damageTaken),
    woundStateAfter: classifyWounds(after.maxWounds, after.damageTaken),
    critical: damage.critical,
    criticalConsequenceDie: die,
    consequenceSeverity: severity,
    consequence: row,
    escalatedBy: escalating.map((i) => i.id),
    injuriesCreated: blocked
      ? []
      : after.injuries.filter((i) => !before.injuries.some((old) => old.id === i.id)),
    conditionsCreatedOrUpdated: conditions,
    effectsCreated: effects,
    secondaryChecks: planned?.checks ?? [],
    secondaryCheckProjections: planned?.projections ?? [],
    nestedDice: tape.rolls,
    pendingIntents: pending,
    fatigue: planned?.fatigue ?? [],
    bleedingSourcesCreated: blocked
      ? []
      : after.bleeding.filter((b) => !before.bleeding.some((old) => old.id === b.id)),
    immediateBloodResolution: blocked ? [] : (pulse?.entries ?? []),
    bloodBefore,
    bloodAfter: after.blood,
    bloodThresholdsCrossed: blocked ? [] : (pulse?.crossed ?? []),
    lifeBefore: before.life,
    lifeAfter: after.life,
    mutations,
    context,
    ...(request.facts ? { facts: request.facts } : {}),
  };
  return {
    result,
    state: next,
    logs: [
      resolutionLog('post-damage', context, {
        combatSessionId: state.combat.session.id,
        actors: [input.attacker, actor],
        dice: tape.rolls,
        postDamage: result,
        mutations,
      }),
    ],
  };
}
