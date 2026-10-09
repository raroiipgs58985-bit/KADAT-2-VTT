import type {
  CoverDegradationIntent,
  DamageResolution,
  DamageResolutionRequest,
  DamageResolutionResult,
  DiceSource,
  ProtectionBundle,
  StateMutation,
} from '@kadat/contracts';
import { resolveCharacteristic } from './characteristics.js';
import { rollAndTransformDamage } from './damage-transformations.js';
import { resolveFieldProtection } from './field-protection.js';
import { resolutionLog } from './log.js';
import { collectProtectionSources } from './protection-sources.js';
import { resolveProtectionBundle, resolvePenetration } from './protection-bundle.js';
import { protectionContext } from './protection-context.js';
import { integer, uniqueIds } from './validation.js';

const locations = [
  'Eyes',
  'Head',
  'Right Arm',
  'Left Arm',
  'Torso',
  'Right Leg',
  'Left Leg',
  'Armor Joints',
];
export function resolveFinalDamage(incoming: number, effectiveArmor: number, bVN: number) {
  integer(incoming, 'incoming damage');
  integer(effectiveArmor, 'effective armor', 0);
  integer(bVN, 'bVN', 0);
  const calculatedDamage = incoming - effectiveArmor - bVN;
  integer(calculatedDamage, 'calculated damage');
  return { calculatedDamage, finalDamage: Math.max(0, calculatedDamage) };
}
/** Atomic resolution: pending decisions return the original protection runtime state. */
export function resolveProtectionDamage(
  request: DamageResolutionRequest,
  source: DiceSource,
): DamageResolution {
  const { input, state } = request,
    context = request.context ?? input.context;
  if (
    !input.hitId.trim() ||
    !input.attackId.trim() ||
    !input.attacker.actorId.trim() ||
    !input.target.actorId.trim()
  )
    throw new Error('Damage input requires runtime identities');
  if (!locations.includes(input.location)) throw new Error('Missing/invalid hit location');
  if (
    context.actor.actorId !== input.attacker.actorId ||
    context.targetActor?.actorId !== input.target.actorId
  )
    throw new Error('Damage context actor/target mismatch');
  integer(input.penetration.value, 'weapon BB', 0);
  uniqueIds(state.resolvedHitIds, 'resolved hit IDs');
  if (state.resolvedHitIds.includes(input.hitId)) throw new Error('Hit damage already resolved');
  uniqueIds(
    context.overrides.map((o) => `${o.subject}:${o.id}`),
    'protection override subjects',
  );
  for (const override of context.overrides) {
    if (!override.reason.trim()) throw new Error('Protection override requires a reason');
    if (override.operation === 'MODIFY') integer(override.value, 'protection override value');
  }
  const transformed = rollAndTransformDamage(input, source, context, request.preRolled);
  const field = resolveFieldProtection(input, state, transformed.rawDamage, context);
  let protection: ProtectionBundle | null = null;
  if (!field.cancelled && !field.requiresExternalResolution)
    protection = resolveProtectionBundle(
      collectProtectionSources(input, state, field.armorSources),
      context,
      input.target.actorId,
    );
  if (protection) {
    const knownModifiers = [
      ...context.modifiers.map((m) => m.id),
      ...protection.contributions.map((c) => c.trace.id),
      ...state.fields.flatMap((f) => [
        `field:${f.id}`,
        ...(f.definition.response.type === 'REDUCE_DAMAGE' ? [`field:reduction:${f.id}`] : []),
      ]),
    ];
    for (const override of context.overrides) {
      const known =
        override.subject === 'effect' ? context.effects.map((e) => e.id) : knownModifiers;
      if (!known.includes(override.id))
        throw new Error(`Unknown protection override subject: ${override.id}`);
    }
  }
  const pending = field.requiresExternalResolution
    ? 'PENDING_FIELD'
    : protection && (protection.incompatiblePairs.length || protection.unresolvedAdjustments.length)
      ? 'PENDING_PROTECTION'
      : null;
  const status: DamageResolutionResult['status'] =
    pending ?? (field.cancelled ? 'CANCELLED' : 'RESOLVED');
  const completed = !pending;
  let endurance: DamageResolutionResult['endurance'] = null,
    bVN: number | null = null,
    effectiveArmor: number | null = null,
    calculatedDamage: number | null = null,
    finalDamage: number | null = field.cancelled ? 0 : null;
  const logs: DamageResolution['logs'][number][] = [];
  if (status === 'RESOLVED') {
    if (!request.endurance) throw new Error('Current target VN is required for damage resolution');
    effectiveArmor = resolvePenetration(protection!, input.penetration.value);
    const enduranceResolution = resolveCharacteristic(
      'ВН',
      request.endurance,
      protectionContext({ ...context, actor: input.target, targetActor: input.attacker }),
    );
    endurance = enduranceResolution.result;
    bVN = endurance.finalBonus;
    logs.push(enduranceResolution.log);
    ({ calculatedDamage, finalDamage } = resolveFinalDamage(
      field.fieldAdjustedDamage,
      effectiveArmor,
      bVN,
    ));
  }
  const covers = { ...state.covers },
    coverIntents: CoverDegradationIntent[] = [],
    mutations: StateMutation[] = [];
  if (status === 'RESOLVED')
    for (const id of protection!.selectedIds) {
      const cover = state.covers[id];
      if (!cover) continue;
      const degradation = cover.definition.degradation;
      if (degradation.type === 'UNRESOLVED')
        coverIntents.push({
          type: 'CoverDegradationIntent',
          sourceId: id,
          material: cover.definition.material,
          hitId: input.hitId,
          location: input.location,
          damageTags: input.tags,
          incomingDamage: field.fieldAdjustedDamage,
          reason: degradation.reason,
          provenance: cover.definition.provenance,
        });
      else if (degradation.type === 'EXPLICIT_OB_LOSS') {
        integer(degradation.value, 'explicit cover degradation', 0);
        covers[id] = { ...cover, currentOB: Math.max(0, cover.currentOB - degradation.value) };
        if (covers[id]!.currentOB !== cover.currentOB)
          mutations.push({
            type: 'cover-OB',
            path: `covers.${id}.currentOB`,
            before: cover.currentOB,
            after: covers[id]!.currentOB,
          });
      } else throw new Error('Unknown cover degradation rule');
    }
  if (completed) {
    field.proposedFields.forEach((f, i) => {
      const before = state.fields[i]!;
      if (f.remainingUses !== before.remainingUses)
        mutations.push({
          type: 'field-resource',
          actor: f.owner,
          path: `fields.${f.id}.remainingUses`,
          before: before.remainingUses,
          after: f.remainingUses,
        });
    });
    mutations.push({
      type: 'damage-hit-resolved',
      path: 'resolvedHitIds',
      before: state.resolvedHitIds,
      after: [...state.resolvedHitIds, input.hitId],
    });
  }
  const result: DamageResolutionResult = {
    status,
    input,
    damageRoll: transformed.roll,
    canonicalExpression: input.profile,
    transformations: transformed.traces,
    rawDamage: transformed.rawDamage,
    critical: transformed.roll.critical,
    criticalConsequenceDiceCount: transformed.criticalConsequence.diceCount,
    criticalConsequence: transformed.criticalConsequence,
    field,
    protection,
    weaponBB: input.penetration.value,
    effectiveArmor,
    endurance,
    bVN,
    calculatedDamage,
    finalDamage,
    noDamage: finalDamage === null ? null : finalDamage === 0,
    coverIntents,
    context,
    mutations,
  };
  logs.push(
    resolutionLog('protection-damage', context, {
      ...(request.combatSessionId ? { combatSessionId: request.combatSessionId } : {}),
      damageResolution: result,
      damage: transformed.roll,
      dice: transformed.roll.rolls,
      baseValues: {
        rawDamage: result.rawDamage,
        weaponBB: result.weaponBB,
        ...(effectiveArmor !== null ? { effectiveArmor } : {}),
        ...(bVN !== null ? { bVN } : {}),
        ...(finalDamage !== null ? { finalDamage } : {}),
      },
      modifiers: [
        ...field.entries.flatMap((e) => [
          e.activation,
          ...(e.numericTrace ? [e.numericTrace] : []),
        ]),
        ...(protection?.contributions.map((c) => c.trace) ?? []),
        ...(protection?.effectTraces ?? []),
      ],
      mutations,
    }),
  );
  return {
    result,
    state: completed
      ? {
          ...state,
          fields: field.proposedFields,
          covers,
          resolvedHitIds: [...state.resolvedHitIds, input.hitId],
        }
      : state,
    logs,
  };
}
