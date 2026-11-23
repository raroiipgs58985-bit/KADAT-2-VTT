import dataset from '../../../../packages/canonical-data/dataset/arsenal.json';
import type {
  ArsenalArmour,
  ArsenalDataset,
  ArsenalWeapon,
} from '../../../../packages/canonical-data/src/arsenal';

/** Validated Arsenal dataset (packages/canonical-data, ADR 0005). Read-only in the game. */
export const arsenal = dataset as unknown as ArsenalDataset;
const norm = (s: string) =>
  s.replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');

export const weaponById = (id: string): ArsenalWeapon | undefined =>
  arsenal.weapons.find((w) => w.id === id);
export const armourById = (id: string): ArsenalArmour | undefined =>
  arsenal.armour.find((a) => a.id === id);

/** Search by words in the name, sheet or group; at most `limit` results. */
export function searchArsenal<T extends { name: string; sheet: string; group: string | null }>(
  items: readonly T[],
  query: string,
  limit = 30,
): T[] {
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  return items
    .filter((x) => {
      const hay = norm(`${x.name} ${x.sheet} ${x.group ?? ''}`);
      return words.every((w) => hay.includes(w));
    })
    .slice(0, limit);
}

/** The Arsenal weapon whose name equals `name` exactly (ignoring case, spaces, ё); null if
 * there is none or more than one — nothing is guessed. */
export function matchWeaponByName(name: string): ArsenalWeapon | null {
  const hits = arsenal.weapons.filter((w) => norm(w.name) === norm(name));
  return hits.length === 1 ? hits[0]! : null;
}
export function matchArmourByName(name: string): ArsenalArmour | null {
  const hits = arsenal.armour.filter((a) => norm(a.name) === norm(name));
  return hits.length === 1 ? hits[0]! : null;
}

const fmtZones = (z: ArsenalArmour['armour']) =>
  z ? [z.head, z.torso, z.arms, z.legs].map((v) => (v === null ? '–' : v)).join('/') : '—';
/** One line for lists: «ОС · 100 м · 1/3/- · 1к10+4 Э · ББ 6 · маг. 60». */
export function weaponSummary(w: ArsenalWeapon): string {
  const rof = w.rof ? [w.rof.single, w.rof.short, w.rof.long].map((v) => v ?? '-').join('/') : null;
  return [
    w.weaponClass + (w.classNote ? ` (${w.classNote})` : ''),
    w.range.text ? `${w.range.text} м` : null,
    rof,
    w.damageText || (w.ammoDependent ? 'урон от боеприпаса' : null),
    w.penetration !== null ? `ББ ${w.penetration}` : null,
    w.magazine !== null ? `маг. ${w.magazine}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
export function armourSummary(a: ArsenalArmour): string {
  return [
    `ОБ ${fmtZones(a.armour)}`,
    a.underlayer ? `поддоспешник ${fmtZones(a.underlayer)}` : null,
    a.properties.length ? a.properties.map((p) => p.raw).join(', ') : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

type Zones = { head: number; torso: number; arms: number; legs: number };
const hasTrait = (a: ArsenalArmour, trait: string) =>
  a.properties.some((p) => p.name.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е') === trait);
/**
 * ОБ by zone from the chosen armour items. Two items are not worn on one zone (author, decision
 * 63) — except «Плита» on a «Поддоспешник» («Броня», «Свойства брони»): the plates give the zone
 * ОБ, the undersuit counts for hits to the joints. Anything else covering a zone twice is refused.
 */
export function armourFromItems(items: readonly { ref: string | null }[]): {
  armour: Zones | null;
  undersuit: {
    head: number | null;
    torso: number | null;
    arms: number | null;
    legs: number | null;
  } | null;
  reason: string | null;
} {
  const found = items.map((i) => (i.ref ? armourById(i.ref) : undefined));
  if (!found.length) return { armour: null, undersuit: null, reason: null };
  if (found.some((a) => !a?.armour))
    return { armour: null, undersuit: null, reason: 'Есть предметы без ОБ из Арсенала' };
  const zones = ['head', 'torso', 'arms', 'legs'] as const;
  const out: Zones = { head: 0, torso: 0, arms: 0, legs: 0 };
  const under: {
    head: number | null;
    torso: number | null;
    arms: number | null;
    legs: number | null;
  } = { head: null, torso: null, arms: null, legs: null };
  for (const z of zones) {
    const covering = found.filter((a) => a!.armour![z] !== null) as ArsenalArmour[];
    if (covering.length > 2)
      return { armour: null, undersuit: null, reason: 'На одну зону надето больше двух предметов' };
    if (covering.length === 2) {
      const suit = covering.find((a) => hasTrait(a, 'поддоспешник'));
      const plate = covering.find((a) => a !== suit && hasTrait(a, 'плита'));
      if (!suit || !plate)
        return {
          armour: null,
          undersuit: null,
          reason: `Два предмета на одну зону (${covering.map((a) => a.name).join(', ')}) не надевают; слоями носят только «Плиту» на «Поддоспешнике»`,
        };
      out[z] = plate.armour![z]!;
      under[z] = suit.armour![z]!;
    } else out[z] = covering[0]?.armour![z] ?? 0;
    // A single item may carry its own undersuit layer (power armour, decision 56).
    if (covering.length === 1 && covering[0]!.underlayer) under[z] = covering[0]!.underlayer[z];
  }
  const anyUnder = zones.some((z) => under[z] !== null);
  return { armour: out, undersuit: anyUnder ? under : null, reason: null };
}

/** An Arsenal property as the rules engine reads it (`WeaponTraitReference`). */
export interface WeaponTrait {
  readonly name: string;
  readonly value?: number;
}
/**
 * Properties of an Arsenal weapon for the rules engine. A rating that is a whole number
 * becomes `value`; anything else («3+», «2к10/3», «см прим») is not read and is listed for the
 * GM, like optional properties («(опц)», switched on for a free action) and unknown names.
 */
export function weaponTraits(w: ArsenalWeapon): {
  traits: WeaponTrait[];
  optional: WeaponTrait[];
  unread: string[];
} {
  const traits: WeaponTrait[] = [];
  const optional: WeaponTrait[] = [];
  const unread: string[] = [];
  for (const p of w.properties) {
    if (!p.property) {
      if (!p.attachment && !p.armourTrait) unread.push(p.raw);
      continue;
    }
    let trait: WeaponTrait | null = { name: p.property };
    if (p.param !== null) {
      const v = p.param.trim();
      trait = /^\d+$/.test(v) ? { name: p.property, value: Number(v) } : null;
    }
    if (!trait) unread.push(p.raw);
    else (p.optional ? optional : traits).push(trait);
  }
  return { traits, optional, unread };
}
