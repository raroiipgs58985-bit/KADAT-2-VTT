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

/**
 * ОБ by zone from the chosen armour items — only when no two items cover the same zone. How
 * layers covering one zone combine is an open author question: nothing is summed or picked.
 */
export function armourFromItems(items: readonly { ref: string | null }[]): {
  armour: { head: number; torso: number; arms: number; legs: number } | null;
  reason: string | null;
} {
  const found = items.map((i) => (i.ref ? armourById(i.ref) : undefined));
  if (!found.length) return { armour: null, reason: null };
  if (found.some((a) => !a?.armour))
    return { armour: null, reason: 'Есть предметы без ОБ из Арсенала' };
  const zones = ['head', 'torso', 'arms', 'legs'] as const;
  const out = { head: 0, torso: 0, arms: 0, legs: 0 };
  for (const z of zones) {
    const covering = found.filter((a) => a!.armour![z] !== null);
    if (covering.length > 1)
      return {
        armour: null,
        reason:
          'Несколько предметов закрывают одну зону: правило совмещения слоёв ждёт решения автора — впишите ОБ вручную',
      };
    out[z] = covering[0]?.armour![z] ?? 0;
  }
  return { armour: out, reason: null };
}
