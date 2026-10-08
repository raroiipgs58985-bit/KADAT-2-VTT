import type {
  AmmoContainerInstance,
  EffectiveRangedProfile,
  EffectDefinition,
  EffectInstance,
  FireMode,
  SourceReference,
  WeaponInstance,
} from '@kadat/contracts';
import { integer, uniqueIds } from './validation.js';

export function effectiveRangedProfile(
  weapon: WeaponInstance,
  container?: AmmoContainerInstance,
): EffectiveRangedProfile {
  const contributions = [
    ...(weapon.pattern ? [weapon.pattern] : []),
    ...weapon.modifications,
    ...(container?.ammo.contribution ? [container.ammo.contribution] : []),
  ];
  const instantiate = (
    definitions: readonly EffectDefinition[],
    scope: string,
    origin: SourceReference,
  ): readonly EffectInstance[] =>
    definitions.map((definition) => ({
      id: `${scope}:${definition.id}`,
      definition,
      targetActor: weapon.owner,
      source: origin,
      provenance: definition.provenance,
    }));
  const profile = contributions.reduce(
    (base, contribution) => ({ ...base, ...contribution.profile }),
    { ...weapon.template.profile },
  );
  if (!Number.isFinite(profile.optimalRange) || profile.optimalRange <= 0)
    throw new Error('Invalid optimal range');
  if (!['kinetic', 'energy-beam'].includes(profile.classification))
    throw new Error('Invalid ranged classification');
  uniqueIds(
    profile.modes.map((entry) => entry.mode),
    'fire modes',
  );
  if (profile.modes.length === 0) throw new Error('Weapon has no fire modes');
  for (const entry of profile.modes) {
    if (!['single', 'short-burst', 'full-auto'].includes(entry.mode))
      throw new Error('Invalid fire mode');
    integer(entry.maxShots, 'rate of fire', 1);
    if (entry.mode === 'single' && entry.maxShots !== 1)
      throw new Error('Single mode fires exactly one shot');
  }
  integer(profile.penetration.value, 'penetration reference value', 0);
  integer(profile.damage.expression.count, 'damage dice count', 1);
  integer(profile.damage.expression.modifier, 'damage modifier');
  if (![5, 10].includes(profile.damage.expression.sides))
    throw new Error('Canonical damage dice require d5/d10');
  return {
    profile,
    effects: [
      ...instantiate(weapon.template.effects, `weapon:${weapon.id}`, {
        kind: 'weapon-instance',
        id: weapon.id,
        canonical: weapon.template.canonical,
      }),
      ...contributions.flatMap((contribution, index) =>
        instantiate(
          contribution.effects,
          `weapon:${weapon.id}:contribution:${index}`,
          contribution.source,
        ),
      ),
      ...(container
        ? instantiate(container.ammo.effects, `ammo:${container.id}`, container.ammo.source)
        : []),
    ],
    provenance: [
      weapon.template.provenance,
      ...contributions.map((contribution) => contribution.provenance),
      ...(container ? [container.provenance] : []),
    ],
  };
}

export function validateAmmunition(
  weapon: WeaponInstance,
  container: AmmoContainerInstance,
  mode: FireMode,
  requested: number,
): EffectiveRangedProfile {
  integer(requested, 'shotsRequested', 1);
  integer(container.capacity, 'container capacity', 1);
  integer(container.currentRounds, 'container rounds', 0);
  if (container.currentRounds > container.capacity)
    throw new Error('Rounds exceed container capacity');
  if (weapon.loadedContainerId !== container.id || container.state !== 'ready')
    throw new Error('Container is not loaded/ready');
  const effective = effectiveRangedProfile(weapon, container);
  if (
    !container.compatibleWeaponTemplateIds.includes(weapon.template.id) ||
    !effective.profile.compatibleAmmoTypes.includes(container.ammo.type) ||
    !effective.profile.compatibleContainerTypes.includes(container.type)
  )
    throw new Error('Incompatible ammunition/container');
  const selected = effective.profile.modes.find((entry) => entry.mode === mode);
  if (!selected) throw new Error('Invalid or unsupported fire mode');
  if (requested > selected.maxShots || (mode === 'single' && requested !== 1))
    throw new Error('Invalid shotsRequested for mode');
  if (requested > container.currentRounds) throw new Error('Insufficient ammunition');
  return effective;
}
