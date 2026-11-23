/**
 * Character for combat (author rulings 47–51): only what the fight needs. A ready character
 * is saved to a file and taken into new sessions without re-creating it.
 */
export const CHARACTER_SCHEMA_VERSION = 2;
export const CHARACTER_FILE_TYPE = 'kadat-character';
export const CHARACTERISTICS = ['НС', 'НР', 'СЛ', 'ВН', 'ЛВ', 'ИН', 'СВ', 'ВС', 'ОЩ'] as const;
export type CharacteristicKey = (typeof CHARACTERISTICS)[number];
export const ARMOUR_ZONES = ['head', 'torso', 'arms', 'legs'] as const;
export type ArmourZone = (typeof ARMOUR_ZONES)[number];
export const armourZoneName: Record<ArmourZone, string> = {
  head: 'Голова',
  torso: 'Торс',
  arms: 'Руки',
  legs: 'Ноги',
};

export interface CharacterDocument {
  readonly schemaVersion: typeof CHARACTER_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly kind: 'character' | 'npc';
  readonly description: string;
  /** Value and Super-characteristic (e.g. «40 (4+1Сверх)» → value 40, super 1). */
  readonly characteristics: Readonly<
    Record<CharacteristicKey, { readonly value: number; readonly super: number }>
  >;
  /** Maximum wounds («Раны»). */
  readonly wounds: number;
  /** Canonical «Размер» (−4…6); the token area follows it (ruling 12). */
  readonly size: number;
  /**
   * СКР options from the profile (e.g. «Базовый» 4, «Броня» 5); the player picks one and the GM
   * or the player may switch it during play (ruling 3).
   */
  readonly movement: {
    readonly options: readonly { readonly label: string; readonly skr: number }[];
    readonly current: number;
  };
  /** ОБ per zone as written in the profile («ОБ 9/9/8/8»). */
  readonly armour: Readonly<Record<ArmourZone, number>>;
  /** ОБ of the undersuit by zone, used for hits to the joints («Поддоспешник»); null — none. */
  readonly undersuit: Readonly<Record<ArmourZone, number | null>>;
  /** Skills with their bonus (ruling 49): +0, +10, +15 … */
  readonly skills: readonly { readonly name: string; readonly bonus: number }[];
  readonly talents: readonly string[];
  /** Weapons from the Arsenal (ruling 48): `ref` is the Arsenal record once it is loaded. */
  readonly weapons: readonly {
    readonly name: string;
    readonly ref: string | null;
    /** Carried on a sling or chain: let go, it hangs instead of falling (rulings 81–82). */
    readonly sling?: boolean;
  }[];
  /** Armour items from the Arsenal (v2); `armour` above holds the ОБ used in combat. */
  readonly armourItems: readonly { readonly name: string; readonly ref: string | null }[];
  /** «Особенности», implants and other combat-relevant text kept as written. */
  readonly traits: string;
  readonly notes: string;
}

export const CHARACTER_LIMITS = {
  maxName: 80,
  maxText: 4000,
  maxListItems: 80,
  maxItemText: 200,
  characteristic: [0, 200] as const,
  super: [0, 20] as const,
  wounds: [1, 999] as const,
  size: [-4, 6] as const,
  skr: [0.5, 60] as const,
  armour: [0, 99] as const,
  skillBonus: [0, 60] as const,
} as const;

export function emptyCharacter(id: string, name = 'Новый персонаж'): CharacterDocument {
  return {
    schemaVersion: CHARACTER_SCHEMA_VERSION,
    id,
    name,
    kind: 'character',
    description: '',
    characteristics: Object.fromEntries(
      CHARACTERISTICS.map((c) => [c, { value: 30, super: 0 }]),
    ) as CharacterDocument['characteristics'],
    wounds: 10,
    size: 0,
    movement: { options: [{ label: 'Базовый', skr: 3 }], current: 0 },
    armour: { head: 0, torso: 0, arms: 0, legs: 0 },
    undersuit: { head: null, torso: null, arms: null, legs: null },
    skills: [],
    talents: [],
    weapons: [],
    armourItems: [],
    traits: '',
    notes: '',
  };
}

const inRange = (v: unknown, [lo, hi]: readonly [number, number], integer = true) =>
  typeof v === 'number' &&
  Number.isFinite(v) &&
  (!integer || Number.isInteger(v)) &&
  v >= lo &&
  v <= hi;
const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;

/** Every problem that makes the character unusable in combat; empty when it is valid. */
export function characterProblems(c: CharacterDocument): string[] {
  const p: string[] = [];
  const L = CHARACTER_LIMITS;
  if (!text(c.id, L.maxItemText) || !c.id.trim()) p.push('Нет идентификатора');
  if (!text(c.name, L.maxName) || !c.name.trim()) p.push('Нужно имя');
  if (c.kind !== 'character' && c.kind !== 'npc') p.push('Неизвестный вид: персонаж или НПС');
  if (!text(c.description, L.maxText)) p.push('Описание слишком длинное');
  for (const k of CHARACTERISTICS) {
    const v = c.characteristics?.[k];
    if (!v || !inRange(v.value, L.characteristic) || !inRange(v.super, L.super))
      p.push(`Характеристика ${k}: значение 0–200, Сверх 0–20`);
  }
  if (!inRange(c.wounds, L.wounds)) p.push('Раны: от 1 до 999');
  if (!inRange(c.size, L.size)) p.push('Размер: от −4 до 6');
  const m = c.movement;
  if (
    !m ||
    !Array.isArray(m.options) ||
    m.options.length < 1 ||
    m.options.length > 8 ||
    m.options.some((o) => !text(o.label, L.maxItemText) || !inRange(o.skr, L.skr, false)) ||
    !Number.isInteger(m.current) ||
    m.current < 0 ||
    m.current >= m.options.length
  )
    p.push('Движение: от 1 до 8 вариантов СКР (0,5–60), выбран один из них');
  for (const z of ARMOUR_ZONES) {
    if (!inRange(c.armour?.[z], L.armour)) p.push(`ОБ (${armourZoneName[z]}): от 0 до 99`);
    const u = c.undersuit?.[z];
    if (u !== null && !inRange(u, L.armour))
      p.push(`ОБ поддоспешника (${armourZoneName[z]}): пусто или от 0 до 99`);
  }
  if (!Array.isArray(c.skills) || c.skills.length > L.maxListItems) p.push('Слишком много навыков');
  else {
    for (const s of c.skills)
      if (!text(s.name, L.maxItemText) || !s.name.trim() || !inRange(s.bonus, L.skillBonus))
        p.push(`Навык «${String(s.name)}»: название и бонус от +0 до +60`);
    const names = c.skills.map((s) => s.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) p.push('Навыки повторяются');
  }
  if (
    !Array.isArray(c.talents) ||
    c.talents.length > L.maxListItems ||
    c.talents.some((t) => !text(t, L.maxItemText) || !t.trim())
  )
    p.push('Таланты: до 80 строк по 200 символов');
  if (
    !Array.isArray(c.weapons) ||
    c.weapons.length > L.maxListItems ||
    c.weapons.some(
      (w) =>
        !text(w.name, L.maxItemText) ||
        !w.name.trim() ||
        !(w.ref === null || text(w.ref, L.maxItemText)) ||
        !(w.sling === undefined || typeof w.sling === 'boolean'),
    )
  )
    p.push('Оружие: до 80 записей');
  if (
    !Array.isArray(c.armourItems) ||
    c.armourItems.length > L.maxListItems ||
    c.armourItems.some(
      (w) =>
        !text(w.name, L.maxItemText) ||
        !w.name.trim() ||
        !(w.ref === null || text(w.ref, L.maxItemText)),
    )
  )
    p.push('Броня: до 80 предметов');
  if (!text(c.traits, L.maxText)) p.push('Особенности слишком длинные');
  if (!text(c.notes, L.maxText)) p.push('Заметки слишком длинные');
  return p;
}

/** Current СКР by the chosen movement option. */
export const currentSkr = (c: CharacterDocument) => c.movement.options[c.movement.current]!.skr;

/**
 * Reads a profile characteristic as written in the sheets: «42 (4)», «40 (4+1Сверх)».
 * Returns null when the text does not have that form (nothing is guessed).
 */
export function parseProfileCharacteristic(raw: string): { value: number; super: number } | null {
  const m = /^\s*(\d+)\s*(?:\(\s*\d+\s*(?:\+\s*(\d+)\s*Сверх)?\s*\))?\s*$/i.exec(raw);
  if (!m) return null;
  return { value: Number(m[1]), super: m[2] ? Number(m[2]) : 0 };
}
/** Reads «ОБ 9/9/8/8» (голова/торс/руки/ноги) or a single number for every zone. */
export function parseProfileArmour(raw: string): Record<ArmourZone, number> | null {
  const parts = raw.split('/').map((s) => s.trim());
  if (parts.length === 1 && /^\d+$/.test(parts[0]!)) {
    const v = Number(parts[0]);
    return { head: v, torso: v, arms: v, legs: v };
  }
  if (parts.length !== 4 || parts.some((x) => !/^\d+$/.test(x))) return null;
  const [head, torso, arms, legs] = parts.map(Number) as [number, number, number, number];
  return { head, torso, arms, legs };
}

/** Splits a profile list on top-level commas (commas inside brackets stay). */
export function splitProfileList(raw: string): string[] {
  const out: string[] = [];
  let depth = 0,
    cur = '';
  for (const ch of raw.replace(/[«»]/g, '')) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim().replace(/\.$/, ''));
  return out;
}
/** «Уклонение+10» → bonus 10; «Атлетика» → +0 (ruling 49: a listed skill without bonus is +0). */
export function parseProfileSkill(item: string): { name: string; bonus: number } {
  const m = /^(.*?)\s*\+\s*(\d+)$/.exec(item);
  return m ? { name: m[1]!.trim(), bonus: Number(m[2]) } : { name: item.trim(), bonus: 0 };
}
/**
 * СКР options from the «Движение» profile text. Rows of five numbers read
 * Свободное/Полу/Полное/Натиск/Бег — СКР is the second; rows of four read
 * Полу/Полное/Натиск/Бег — СКР is the first («Общая механика» A25). A trailing «— label»
 * names the row. Returns null when no row has one of these forms.
 */
export function parseProfileMovement(raw: string): { label: string; skr: number }[] | null {
  const rows = raw
    .split(/\n+/)
    .map((r) => r.trim())
    .filter(Boolean);
  const out: { label: string; skr: number }[] = [];
  for (const row of rows) {
    const m = /^([\d.,/\s]+?)\s*(?:[-—–]\s*(.+))?$/.exec(row);
    if (!m) continue;
    const nums = m[1]!
      .split('/')
      .map((x) => Number(x.trim().replace(',', '.')))
      .filter((x) => Number.isFinite(x));
    const skr = nums.length === 5 ? nums[1] : nums.length === 4 ? nums[0] : undefined;
    if (skr === undefined) continue;
    out.push({
      label: (m[2] ?? (out.length ? `Вариант ${out.length + 1}` : 'Базовый')).trim(),
      skr,
    });
  }
  return out.length ? out : null;
}
