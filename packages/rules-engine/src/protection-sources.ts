import type {
  DamageInput,
  ProtectionCandidate,
  ProtectionInstance,
  ProtectionRuntimeState,
} from '@kadat/contracts';
import { coversLocation } from './field-protection.js';
import { integer, uniqueIds } from './validation.js';

/** Scene cover supplies current OB/zones; worn definitions remain untouched. */
export function collectProtectionSources(
  input: DamageInput,
  state: ProtectionRuntimeState,
  fieldSources: readonly ProtectionInstance[] = [],
): readonly ProtectionCandidate[] {
  const sources: {
    instance: ProtectionInstance;
    ob: number;
    zones: ProtectionInstance['definition']['zones'];
  }[] = [
    ...Object.entries(state.sources).map(([id, instance]) => {
      if (id !== instance.id) throw new Error('Protection state key mismatch');
      return { instance, ob: instance.definition.ob, zones: instance.definition.zones };
    }),
    ...Object.entries(state.covers).map(([id, cover]) => {
      if (id !== cover.id || cover.definition.kind !== 'cover')
        throw new Error('Cover state key/kind mismatch');
      integer(cover.definition.ob, 'canonical cover OB', 0);
      return {
        instance: { id: cover.id, definition: cover.definition, active: cover.active },
        ob: cover.currentOB,
        zones: cover.coveredZones,
      };
    }),
    ...fieldSources.map((instance) => ({
      instance,
      ob: instance.definition.ob,
      zones: instance.definition.zones,
    })),
  ];
  uniqueIds(
    sources.map((s) => s.instance.id),
    'protection instance IDs',
  );
  return sources.map(({ instance, ob, zones }) => {
    const definition = instance.definition;
    integer(ob, 'protection OB', 0);
    integer(definition.ob, 'canonical protection OB', 0);
    if (!['WEAPON_BB', 'IGNORE_WEAPON_BB'].includes(definition.penetrationMode))
      throw new Error('Protection requires an explicit penetration mode');
    const reason = !instance.active
      ? 'disabled'
      : instance.owner && instance.owner.actorId !== input.target.actorId
        ? 'owner'
        : !coversLocation(zones, input.location)
          ? 'location'
          : 'applicable';
    const specialAdjustment =
      input.location === 'Eyes' || input.location === 'Armor Joints'
        ? (definition.specialLocations?.[input.location] ?? null)
        : null;
    if (specialAdjustment?.type === 'EXPLICIT_OB')
      integer(specialAdjustment.ob, 'special-location OB', 0);
    return {
      instanceId: instance.id,
      definition,
      baseOB: specialAdjustment?.type === 'EXPLICIT_OB' ? specialAdjustment.ob : ob,
      zones,
      applicable: reason === 'applicable',
      applicabilityReason: reason,
      specialAdjustment,
    };
  });
}
