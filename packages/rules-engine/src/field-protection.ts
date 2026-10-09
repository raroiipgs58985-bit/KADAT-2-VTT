import type {
  DamageInput,
  FieldStageResult,
  ProtectionRuntimeState,
  ResolutionContext,
  ResolutionModifier,
  ProtectionZone,
} from '@kadat/contracts';
import { resolveModifiers } from './context.js';
import { protectionContext } from './protection-context.js';
import { integer, uniqueIds } from './validation.js';

export function coversLocation(
  zones: readonly ProtectionZone[],
  location: DamageInput['location'],
): boolean {
  return (
    zones.includes(location) ||
    ((location === 'Left Arm' || location === 'Right Arm') && zones.includes('Arms')) ||
    ((location === 'Left Leg' || location === 'Right Leg') && zones.includes('Legs'))
  );
}
/** Caller-selected field order; no inferred force-field catalog or map behavior. */
export function resolveFieldProtection(
  input: DamageInput,
  state: ProtectionRuntimeState,
  damage: number,
  context: ResolutionContext,
): FieldStageResult {
  uniqueIds(
    state.fields.map((f) => f.id),
    'field instance IDs',
  );
  const entries: FieldStageResult['entries'][number][] = [];
  const armorSources: FieldStageResult['armorSources'][number][] = [];
  const proposedFields = [...state.fields];
  let value = damage,
    cancelled = false,
    requiresExternalResolution = false;
  for (const [index, instance] of state.fields.entries()) {
    const definition = instance.definition;
    integer(instance.remainingUses, 'field remaining uses', 0);
    integer(definition.useCost, 'field use cost', 0);
    const applicable =
      instance.active &&
      instance.owner.actorId === input.target.actorId &&
      coversLocation(definition.zones, input.location);
    const activationModifier: ResolutionModifier = {
      id: `field:${instance.id}`,
      value: 1,
      source: definition.source,
      provenance: definition.provenance,
      condition: { requiresTags: [`field-applicable:${instance.id}`] },
    };
    const stage = protectionContext(
      {
        ...context,
        tags: [
          ...context.tags.filter((tag) => !tag.startsWith('field-applicable:')),
          ...(applicable ? [`field-applicable:${instance.id}`] : []),
        ],
      },
      [],
      [activationModifier],
    );
    const activation = resolveModifiers(stage).find((t) => t.id === activationModifier.id)!;
    if (activation.value !== 1)
      throw new Error('Field activation is a selection, not a numeric rating');
    if (!activation.included) {
      entries.push({
        instance,
        activation,
        response: null,
        damageBefore: value,
        damageAfter: value,
      });
      continue;
    }
    if (instance.remainingUses < definition.useCost)
      throw new Error('Insufficient field resources');
    const before = value,
      response = definition.response;
    let numericTrace;
    switch (response.type) {
      case 'PASS_THROUGH':
        break;
      case 'CANCEL_HIT':
        cancelled = true;
        break;
      case 'REDUCE_DAMAGE': {
        integer(response.reduction, 'field reduction', 0);
        const modifier: ResolutionModifier = {
          id: `field:reduction:${instance.id}`,
          value: response.reduction,
          source: definition.source,
          provenance: definition.provenance,
        };
        numericTrace = resolveModifiers(protectionContext(context, [], [modifier])).find(
          (t) => t.id === modifier.id,
        )!;
        integer(numericTrace.value, 'resolved field reduction', 0);
        value -= numericTrace.included ? numericTrace.value : 0;
        integer(value, 'field-adjusted damage');
        break;
      }
      case 'ARMOR_LIKE_PROTECTION':
        armorSources.push({
          id: `field:${instance.id}:armor`,
          definition: response.protection,
          owner: instance.owner,
          active: true,
        });
        break;
      case 'REDIRECT_OR_RELOCATE':
        requiresExternalResolution = true;
        break;
      case 'CUSTOM':
        requiresExternalResolution = response.continuation === 'UNRESOLVED';
        break;
      default:
        throw new Error('Unknown field response');
    }
    proposedFields[index] = {
      ...instance,
      remainingUses: instance.remainingUses - definition.useCost,
    };
    entries.push({
      instance,
      activation,
      response,
      ...(numericTrace ? { numericTrace } : {}),
      damageBefore: before,
      damageAfter: value,
    });
    if (cancelled || requiresExternalResolution) break;
  }
  return {
    entries,
    fieldAdjustedDamage: value,
    cancelled,
    requiresExternalResolution,
    armorSources,
    proposedFields,
  };
}
