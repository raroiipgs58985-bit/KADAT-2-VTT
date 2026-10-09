import type {
  EffectiveMeleeProfile,
  MeleeBase,
  MeleeGrip,
  MeleeTechnique,
  MeleeWeaponInstance,
  MeleeProfile,
  Provenance,
  SourceReference,
} from '@kadat/contracts';
import { integer } from './validation.js';

export const meleeSource: SourceReference = Object.freeze({
  kind: 'specification',
  id: 'Infantry Combat Core v0.1 B2 Melee + direct user rulings',
});
export function meleeProvenance(record: string): Provenance {
  return { source: meleeSource, record, reason: 'Author/user-approved B-2 rule' };
}

export const meleeBases: Readonly<Record<MeleeBase, Readonly<{ od: number; nr: number }>>> =
  Object.freeze({
    simple: Object.freeze({ od: 1, nr: 10 }),
    cautious: Object.freeze({ od: 1, nr: -10 }),
    reckless: Object.freeze({ od: 1, nr: 30 }),
    charge: Object.freeze({ od: 2, nr: 20 }),
    free: Object.freeze({ od: 0, nr: 0 }),
    called: Object.freeze({ od: 2, nr: 0 }),
  });

export const meleeTechniques: Readonly<
  Record<
    MeleeTechnique,
    Readonly<{ nr: number; parry: number; dodge: number; reach: number; normalDamage: boolean }>
  >
> = Object.freeze({
  normal: Object.freeze({ nr: 0, parry: 0, dodge: 0, reach: 0, normalDamage: true }),
  'wide-sweep': Object.freeze({ nr: 0, parry: 10, dodge: -10, reach: 0, normalDamage: true }),
  stun: Object.freeze({ nr: -20, parry: 0, dodge: 0, reach: 0, normalDamage: false }),
  knockdown: Object.freeze({ nr: 0, parry: 0, dodge: 0, reach: 0, normalDamage: false }),
  grapple: Object.freeze({ nr: 0, parry: -30, dodge: 0, reach: 0, normalDamage: false }),
  lunge: Object.freeze({ nr: 0, parry: -10, dodge: 10, reach: 1, normalDamage: true }),
});

export function validateMeleeProfile(profile: MeleeProfile): void {
  if (!Number.isFinite(profile.reach) || profile.reach < 0) throw new Error('Invalid melee reach');
  if (!['one-handed', 'two-handed'].includes(profile.handedness))
    throw new Error('Invalid handedness');
  integer(profile.damage.expression.count, 'melee damage dice', 1);
  integer(profile.damage.expression.modifier, 'melee damage modifier');
  integer(profile.penetration.value, 'melee penetration reference', 0);
  if (![5, 10].includes(profile.damage.expression.sides))
    throw new Error('Canonical melee damage requires d5/d10');
}

export function composeMeleeProfile(
  weapon: MeleeWeaponInstance,
  grip: MeleeGrip,
  technique: MeleeTechnique,
): EffectiveMeleeProfile {
  const contributions = [...(weapon.pattern ? [weapon.pattern] : []), ...weapon.modifications];
  let profile = contributions.reduce((value, entry) => ({ ...value, ...entry.profile }), {
    ...weapon.template.profile,
  });
  validateMeleeProfile(profile);
  if (!profile.validGrips.includes(grip) || !(technique in meleeTechniques))
    throw new Error('Invalid grip/technique');
  const provenance = [
    weapon.template.provenance,
    ...contributions.map((entry) => entry.provenance),
    meleeProvenance(`grip:${grip}`),
    meleeProvenance(`technique:${technique}`),
  ];
  const transforms: EffectiveMeleeProfile['damageTransforms'][number][] = [];
  let nrModifier = 0;
  if (grip === 'one-handed' && profile.handedness === 'two-handed') {
    nrModifier = -5;
    profile = { ...profile, reach: profile.reach + 1 };
    transforms.push({
      type: profile.damage.expression.count > 1 ? 'remove-die' : 'add',
      value: profile.damage.expression.count > 1 ? 1 : -4,
      provenance: meleeProvenance('1H-on-2H'),
    });
  }
  if (grip === 'two-handed' && profile.handedness === 'one-handed') {
    nrModifier = technique === 'stun' || technique === 'knockdown' ? 10 : 5;
    transforms.push({ type: 'add', value: 3, provenance: meleeProvenance('2H-on-1H') });
  }
  if (grip === 'close') {
    profile = {
      ...profile,
      reach: Math.max(0, profile.reach - 2),
      properties: [
        ...profile.properties,
        { kind: 'canonical-property-reference', id: 'Точное / Accurate' },
      ],
    };
  }
  if (grip === 'fist') {
    if (!['axe', 'hook', 'hammer'].includes(profile.family))
      throw new Error('Fist grip requires axe/hook/hammer family');
    profile = {
      ...profile,
      reach: 1,
      properties: [...profile.properties, { kind: 'combat-profile-tag', id: 'counts-as-fist' }],
    };
    transforms.push({ type: 'add', value: -2, provenance: meleeProvenance('fist-grip') });
  }
  if (grip === 'mordhau') {
    if (
      profile.family !== 'sword' ||
      !weapon.mordhauProfile ||
      weapon.mordhauProfile.family !== 'mace' ||
      weapon.mordhauProfile.handedness !== 'one-handed'
    )
      throw new Error('Mordhau requires an explicit one-handed mace profile for a sword');
    validateMeleeProfile(weapon.mordhauProfile);
    profile = {
      ...weapon.mordhauProfile,
      properties: [
        ...weapon.mordhauProfile.properties,
        { kind: 'combat-profile-tag', id: 'Mordhau: substituted profile used two-handed' },
      ],
    };
    nrModifier = -5;
    provenance.push({
      source: profile.source,
      reason: 'Mordhau literal one-handed mace substitution; used two-handed',
    });
  }
  profile = { ...profile, reach: profile.reach + meleeTechniques[technique].reach };
  if (technique === 'wide-sweep')
    transforms.push({
      type: 'multiply',
      value: 0.5,
      rounding: 'ceil',
      provenance: meleeProvenance('wide-sweep-half-damage'),
    });
  return { profile, grip, technique, nrModifier, damageTransforms: transforms, provenance };
}
