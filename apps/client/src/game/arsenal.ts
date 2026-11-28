import dataset from '../../../../packages/canonical-data/dataset/arsenal.json';
import type {
  ArsenalArmour,
  ArsenalDataset,
  ArsenalWeapon,
} from '../../../../packages/canonical-data/src/arsenal';

/** Bows of the «ХТХ и примитив» sheet: arrows go on for the Free Action (ruling 164). */
export const isBow = (w: { sheet: string; name: string; weaponClass: string } | null | undefined) =>
  !!w && w.sheet === 'ХТХ и примитив' && /лук/i.test(w.name) && ['П', 'ОС'].includes(w.weaponClass);
/**
 * Bows and crossbows have no rate, magazine or reload columns in the sheet (ruling 164): single
 * shot, one arrow or bolt; a bow reloads for the Free Action, a crossbow for 1 ОД.
 */
function primitiveDefaults(w: ArsenalWeapon): ArsenalWeapon {
  if (w.sheet !== 'ХТХ и примитив' || !['П', 'ОС'].includes(w.weaponClass) || w.rof) return w;
  const bow = isBow(w);
  return {
    ...w,
    rof: { single: 1, short: null, long: null },
    magazine: 1,
    reload: { od: 1, text: bow ? 'СД (решение 164)' : '1 ОД (решение 164)' },
  };
}
/** «Тяжёлый лазерный бур» = лазпушка: magazine 5 and reload 2 ОД of the lascannon (ruling 168). */
function drillDefaults(w: ArsenalWeapon): ArsenalWeapon {
  if (w.name.trim() !== 'Тяжёлый лазерный бур' || w.magazine !== null) return w;
  return { ...w, magazine: 5, reload: { od: 2, text: '2 ОД (как лазпушка, решение 168)' } };
}
/** Validated Arsenal dataset (packages/canonical-data, ADR 0005). Read-only in the game. */
export const arsenal: ArsenalDataset = (() => {
  const raw = dataset as unknown as ArsenalDataset;
  return { ...raw, weapons: raw.weapons.map((w) => drillDefaults(primitiveDefaults(w))) };
})();
const norm = (s: string) =>
  s.replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');

export const weaponById = (id: string): ArsenalWeapon | undefined =>
  arsenal.weapons.find((w) => w.id === id);
/**
 * Ammunition a launcher whose profile «зависит от боеприпаса» can fire (ruling 167):
 * 40 mm grenade launchers — the hand grenades of «Взрывчатка»; 90 mm rocket launchers — the
 * «(90 мм)» rockets of «Стаб и РПУ». Others — none yet (mortars and vehicle launchers later).
 */
export function ammoOptions(w: ArsenalWeapon | null | undefined): ArsenalWeapon[] {
  if (!w?.ammoDependent) return [];
  if (/40\s*мм/.test(w.name))
    return arsenal.weapons.filter(
      (x) => x.sheet === 'Взрывчатка' && x.weaponClass === 'Метательное',
    );
  // Infantry mortars (ruling 171): the mines of «Взрывчатка» of the same calibre.
  const mortar = /миномёт/i.test(w.name) ? /(82|120)\s*мм/.exec(w.name) : null;
  if (mortar)
    return arsenal.weapons.filter(
      (x) =>
        x.sheet === 'Взрывчатка' &&
        x.weaponClass === 'СТ' &&
        new RegExp(`\\(${mortar[1]}\\s*мм\\)`).test(x.name),
    );
  if (/90\s*мм/.test(w.name) && w.sheet === 'Стаб и РПУ' && /гранатомёт/i.test(w.name))
    return arsenal.weapons.filter(
      (x) =>
        x.sheet === 'Стаб и РПУ' &&
        x.weaponClass === 'ТО' &&
        /\(90\s*мм\)/.test(x.name) &&
        !x.ammoDependent,
    );
  return [];
}
/**
 * The launcher loaded with the ammunition (ruling 167): range, rate, magazine and reload of the
 * launcher; damage, ББ («-» — 0) and properties of the ammunition.
 */
export function withAmmo(
  launcher: ArsenalWeapon | undefined,
  ammoId: string | null | undefined,
): ArsenalWeapon | undefined {
  if (!launcher || !ammoId) return launcher;
  const ammo = ammoOptions(launcher).find((x) => x.id === ammoId);
  if (!ammo) return launcher;
  const loaded: ArsenalWeapon = {
    ...launcher,
    damage: ammo.damage,
    damageText: ammo.damageText,
    penetration: ammo.penetration ?? 0,
    properties: [...launcher.properties.filter((p) => p.property !== null), ...ammo.properties],
    ammoDependent: false,
  };
  LOADED.add(loaded);
  return loaded;
}
const LOADED = new WeakSet<ArsenalWeapon>();
/** A launcher loaded with its ammunition by `withAmmo` (ruling 167). */
export const isLoadedLauncher = (w: ArsenalWeapon) => LOADED.has(w);
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
  const hay = (x: T) => norm(`${x.name} ${x.sheet} ${x.group ?? ''}`);
  const exact = items.filter((x) => words.every((w) => hay(x).includes(w)));
  if (exact.length) return exact.slice(0, limit);
  // Nothing found: forgive one wrong, missing or extra letter in a word of 4+ letters.
  return items
    .filter((x) => {
      const tokens = hay(x)
        .split(/[\s()\-,.]+/)
        .filter(Boolean);
      return words.every((w) =>
        w.length >= 4
          ? tokens.some(
              (t) => t.includes(w) || oneEditAway(w, t.slice(0, w.length + 1)) || oneEditAway(w, t),
            )
          : tokens.some((t) => t.includes(w)),
      );
    })
    .slice(0, limit);
}
/** True when `a` becomes `b` by changing, adding or removing at most one letter. */
export function oneEditAway(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0,
    j = 0,
    edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
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
  readonly dice?: { readonly count: number; readonly sides: number };
  readonly duration?: number;
  readonly text?: string;
}
/** Properties rated by a word: «Плавящее (ББ)», «Плавящее (У)». */
const WORD_RATED: Record<string, readonly string[]> = { Плавящее: ['ББ', 'У'] };
/** Sealed or void armour stops toxins completely (ruling 98). */
export function sealedArmour(items: readonly { ref: string | null }[]): boolean {
  return items.some((i) =>
    (i.ref ? armourById(i.ref) : undefined)?.properties.some((p) =>
      /^(закрыт|пустотн)/i.test(p.name ?? p.raw),
    ),
  );
}
/** Armour that stops rad damage through unpierced armour (ruling 102). */
export function radProtectedArmour(items: readonly { ref: string | null }[]): boolean {
  return items.some((i) =>
    (i.ref ? armourById(i.ref) : undefined)?.properties.some((p) =>
      /^(рад-защит|пустотн|серво-брон)/i.test(p.name ?? p.raw),
    ),
  );
}
/** Properties whose rating may be dice with a duration: «Огненное (2к10/3)». */
const DICE_RATED = new Set(['Огненное', 'След']);
/** Radii in metres may be fractional: «Взрыв (0.5)» — half a cell (ruling 151). */
const DECIMAL_RATED = new Set(['Взрыв', 'Локальный взрыв', 'ЭМИ']);
/**
 * Properties of an Arsenal weapon for the rules engine. A rating that is a whole number
 * becomes `value`; anything else («3+», «2к10/3», «см прим») is not read and is listed for the
 * GM, like optional properties («(опц)», switched on for a free action) and unknown names.
 */
/**
 * «Оборонительное (Х)» of a shield (ruling 180): ОБ by zones head / arms / torso / legs
 * («-/6/6/-»), one number or «все Х» — every zone. Null when the text is not read.
 */
export function shieldZones(
  text: string,
): { head: number; arms: number; torso: number; legs: number } | null {
  const v = text.trim().toLowerCase();
  const all = /^(?:все\s*)?(\d+)$/.exec(v);
  if (all) {
    const n = Number(all[1]);
    return { head: n, arms: n, torso: n, legs: n };
  }
  const parts = v.split('/');
  if (parts.length !== 4 || !parts.every((x) => x === '-' || /^\d+$/.test(x))) return null;
  const n = parts.map((x) => (x === '-' ? 0 : Number(x)));
  return { head: n[0]!, arms: n[1]!, torso: n[2]!, legs: n[3]! };
}
/** Properties without a combat rule (ruling 181). */
const NO_RULE = new Set(['Окно', 'Прочное']);
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
      // «Свободная ладонь» (ruling 181) is read by the hands logic, «Окно» and «Прочное» carry
      // no rule (ruling 181): they are not «unread».
      if (p.raw === 'Свободная ладонь') traits.push({ name: 'Свободная ладонь' });
      else if (!p.attachment && !p.armourTrait && !NO_RULE.has(p.raw)) unread.push(p.raw);
      continue;
    }
    let trait: WeaponTrait | null = { name: p.property };
    if (p.param !== null) {
      const v = p.param.trim();
      // «2к10/3» — dice and duration; «2к10+5» (След) — dice plus a number kept in `value`.
      const dice = DICE_RATED.has(p.property)
        ? /^(\d+)к(\d+)(?:\+(\d+))?(?:\/(\d+))?$/.exec(v)
        : null;
      const split = p.property === 'Токсичное' ? /^(\d+)\/(\d+)$/.exec(v) : null;
      // «Сила (4+)» is the same as «Сила (4)» (ruling 179); «Оборонительное (-/6/6/-)» keeps
      // the ОБ by zones as text (ruling 180, read by `shieldArmour`).
      const strength = p.property === 'Сила' ? /^(\d+)\+$/.exec(v) : null;
      // «Дуга (Х/Y)» (ruling 182): the die value Х and the arc length Y in metres.
      const arc = p.property === 'Дуга' ? /^(\d+)\/(\d+)$/.exec(v) : null;
      trait = strength
        ? { name: p.property, value: Number(strength[1]) }
        : arc
          ? { name: p.property, value: Number(arc[1]), text: arc[2]! }
          : p.property === 'Оборонительное' && shieldZones(v)
            ? { name: p.property, text: v }
            : WORD_RATED[p.property]?.includes(v)
              ? { name: p.property, text: v }
              : split
                ? { name: p.property, value: Number(split[1]), duration: Number(split[2]) }
                : /^\d+$/.test(v)
                  ? { name: p.property, value: Number(v) }
                  : DECIMAL_RATED.has(p.property) && /^\d+[.,]\d+$/.test(v)
                    ? { name: p.property, value: Number(v.replace(',', '.')) }
                    : dice
                      ? {
                          name: p.property,
                          dice: { count: Number(dice[1]), sides: Number(dice[2]) },
                          ...(dice[3] ? { value: Number(dice[3]) } : {}),
                          ...(dice[4] ? { duration: Number(dice[4]) } : {}),
                        }
                      : null;
    }
    if (!trait) unread.push(p.raw);
    else (p.optional ? optional : traits).push(trait);
  }
  return { traits, optional, unread };
}

/**
 * The character with ОБ and undersuit taken from its Arsenal armour items. With no items, or
 * items whose ОБ cannot be combined (see `armourFromItems`), the ОБ stay as they are.
 */
export function withArmourFromItems<
  T extends {
    armourItems: readonly { ref: string | null }[];
    armour: Zones;
    undersuit: {
      head: number | null;
      torso: number | null;
      arms: number | null;
      legs: number | null;
    };
  },
>(c: T): T {
  const fill = armourFromItems(c.armourItems);
  if (!fill.armour) return c;
  return {
    ...c,
    armour: fill.armour,
    undersuit: fill.undersuit ?? { head: null, torso: null, arms: null, legs: null },
  };
}
