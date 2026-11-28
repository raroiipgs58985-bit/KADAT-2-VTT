/**
 * Import of the «Арсенал Кадата» workbook snapshot into a validated dataset (ADR 0002:
 * source files → import/validation → canonical dataset). Pure: no file system, no Excel.
 * Values are taken as written; what cannot be read is reported, never guessed.
 */
import {
  AUTHOR,
  CELL_CORRECTIONS,
  EXTRA_PROPERTIES,
  normaliseArmourText,
  PROPERTY_ALIASES,
  ATTACHMENT_ALIASES,
  ARMOUR_TRAIT_ALIASES,
} from './corrections.js';

export type Cell = string | number;
export interface ArsenalSnapshot {
  readonly source: {
    readonly file: string;
    readonly sha256: string;
    readonly extracted: string;
    readonly method: string;
    readonly sheets: readonly string[];
  };
  readonly sheets: Readonly<Record<string, readonly (readonly Cell[])[]>>;
}
export interface SourceRef {
  readonly sheet: string;
  /** 1-based row in the sheet. */
  readonly row: number;
}
export interface PropertyRef {
  readonly raw: string;
  readonly name: string;
  readonly param: string | null;
  /** Name of the matching entry of «Свойства оружия», or null when not found there. */
  readonly property: string | null;
  /** Name of the matching attachment of «Дополнения к оружию», when it is one. */
  readonly attachment: string | null;
  /** Name of the matching armour trait of «Броня» (Силовое поле on shields …), when it is one. */
  readonly armourTrait: string | null;
  /** Marked «(опц)»: an optional property (see «Опционально»). */
  readonly optional: boolean;
}
export interface DamageSpec {
  readonly count: number;
  readonly sides: number;
  readonly modifier: number;
  /** Damage type letter as written (У, Р, Э, В …); null when the sheet gives none. */
  readonly type: string | null;
}
export const WEAPON_CLASSES = ['П', 'ОС', 'ТО', 'СТ', 'ББ', 'Метательное', 'Бомба'] as const;
export type WeaponClass = (typeof WEAPON_CLASSES)[number];
export interface ArsenalWeapon {
  readonly id: string;
  readonly name: string;
  readonly sheet: string;
  readonly group: string | null;
  readonly weaponClass: WeaponClass;
  /** Text in brackets after the class: calibre («9мм») or grip («1р»). */
  readonly classNote: string | null;
  /** Metres, or a formula as written (thrown: «10хБС», «БС*5» — by the Strength bonus). */
  readonly range: {
    readonly meters: number | null;
    readonly text: string;
    readonly formula: boolean;
  };
  /** Rate of fire «1/3/10»: single / short burst / long burst; null for melee. */
  readonly rof: {
    readonly single: number | null;
    readonly short: number | null;
    readonly long: number | null;
  } | null;
  readonly damage: DamageSpec | null;
  readonly damageText: string;
  readonly penetration: number | null;
  /**
   * «1 (3)» (war hammers): the second ББ — a blow with the spike, with «Калечащее (2)»
   * (author ruling 166). Absent when the sheet gives one number.
   */
  readonly penetrationAlt?: number;
  readonly magazine: number | null;
  readonly reload: { readonly od: number | null; readonly text: string } | null;
  readonly properties: readonly PropertyRef[];
  /** «Урон, ББ и свойства зависят от боеприпаса»: the profile comes from the ammunition. */
  readonly ammoDependent: boolean;
  readonly mass: { readonly kg: number | null; readonly text: string };
  readonly rarity: number | null;
  /** Family fire-mode modifiers from the sheet header (author ruling 52). */
  readonly modeModifiers: {
    readonly single: number;
    readonly 'short-burst': number;
    readonly 'full-auto': number;
  } | null;
  readonly source: SourceRef;
}
export interface ArsenalArmour {
  readonly id: string;
  readonly name: string;
  readonly sheet: string;
  readonly group: string | null;
  /** ОБ head / torso / arms / legs; null for a zone the item does not cover. */
  readonly armour: {
    readonly head: number | null;
    readonly torso: number | null;
    readonly arms: number | null;
    readonly legs: number | null;
  } | null;
  readonly armourText: string;
  /** Second layer written after the main one (power armour): the undersuit (decision 56). */
  readonly underlayer: {
    readonly head: number | null;
    readonly torso: number | null;
    readonly arms: number | null;
    readonly legs: number | null;
  } | null;
  readonly maxAgility: string | null;
  readonly autosenses: string | null;
  readonly properties: readonly PropertyRef[];
  readonly mass: { readonly kg: number | null; readonly text: string };
  readonly rarity: string | null;
  readonly source: SourceRef;
}
export interface ArsenalField {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly properties: string;
  readonly rarity: string | null;
  readonly mass: { readonly kg: number | null; readonly text: string };
  readonly source: SourceRef;
}
export interface ArsenalProperty {
  readonly name: string;
  readonly hasParam: boolean;
  readonly abbreviation: string | null;
  readonly description: string;
  readonly effect: string;
  readonly source: SourceRef | { readonly author: string };
}
/** «Дополнения к оружию»: attachments and modifications (Оптика, ЛЦУ, Глушитель …). */
export interface ArsenalAttachment {
  readonly name: string;
  readonly group: string | null;
  readonly weaponType: string;
  readonly description: string;
  readonly effect: string;
  readonly source: SourceRef;
}
/** «Свойства брони» at the end of the «Броня» sheet (Флак, Керамит, Поддоспешник …). */
export interface ArsenalArmourTrait {
  readonly name: string;
  readonly hasParam: boolean;
  readonly description: string;
  readonly source: SourceRef;
}
export interface ImportIssue extends SourceRef {
  readonly message: string;
}
export interface ArsenalDataset {
  readonly format: 'kadat-arsenal';
  readonly version: 1;
  readonly source: ArsenalSnapshot['source'];
  readonly properties: readonly ArsenalProperty[];
  readonly weapons: readonly ArsenalWeapon[];
  readonly armour: readonly ArsenalArmour[];
  readonly fields: readonly ArsenalField[];
  readonly attachments: readonly ArsenalAttachment[];
  readonly armourTraits: readonly ArsenalArmourTrait[];
  readonly issues: readonly ImportIssue[];
  /** Author corrections applied on import (src/corrections.ts). */
  readonly corrections: readonly string[];
}

const WEAPON_SHEETS = [
  'ХТХ и примитив',
  'Инструменты (оружие)',
  'Взрывчатка',
  'Стаб и РПУ',
  'Лаз',
  'Болт',
  'Термическое оружие',
  'Плазма',
  'Оружие Механикус',
  'Друкхари',
  'Аэльдари',
  'Тау',
];
const ARMOUR_SHEETS = ['Броня', 'Серво-костюмы', 'Силовая броня '];

const str = (c: Cell | undefined) => (c === undefined ? '' : String(c)).trim();
const norm = (s: string) =>
  s.replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
/** «1,5», «2 т», «0.5» → kilograms; anything else → null. */
export function parseMass(text: string): number | null {
  const m = /^(\d+(?:[.,]\d+)?)\s*(т|кг)?$/i.exec(text.trim());
  if (!m) return null;
  const v = Number(m[1]!.replace(',', '.'));
  return m[2]?.toLowerCase() === 'т' ? v * 1000 : v;
}
/** «100», «30 км», «0-1» (reach: the upper value) → metres; else null. */
export function parseRange(text: string): number | null {
  const t = text.trim().replace(',', '.');
  let m = /^(\d+(?:\.\d+)?)\s*(км|м)?$/i.exec(t);
  if (m) return Number(m[1]) * (m[2]?.toLowerCase() === 'км' ? 1000 : 1);
  m = /^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*(м)?$/.exec(t);
  return m ? Number(m[2]) : null;
}
/** «1/3/10», «-/5/10», «1/-/-» → numbers or null per mode; null when not of that form. */
export function parseRof(text: string): ArsenalWeapon['rof'] {
  const parts = text
    .trim()
    .split('/')
    .map((s) => s.trim());
  if (parts.length !== 3) return null;
  const v = parts.map((p) => (p === '-' || p === '' ? null : /^\d+$/.test(p) ? Number(p) : NaN));
  if (v.some((x) => Number.isNaN(x))) return null;
  return { single: v[0] ?? null, short: v[1] ?? null, long: v[2] ?? null };
}
/** «1к10+3 Э», «2к10+10 Э», «1к5-3 У», «1к10+12» → dice; null otherwise. */
export function parseDamage(text: string): DamageSpec | null {
  // No \b: it is ASCII-only in JavaScript and fails after a Cyrillic letter.
  const m = /^(\d+)\s*к\s*(\d+)\s*(?:([+-])\s*(\d+))?\s*(?:([А-ЯЁA-Z])(?=$|[\s,.(]))?/i.exec(
    text.trim(),
  );
  if (!m) return null;
  return {
    count: Number(m[1]),
    sides: Number(m[2]),
    modifier: m[3] ? Number(`${m[3]}${m[4]}`) : 0,
    type: m[5] ? m[5].toUpperCase() : null,
  };
}
/** «2 ОД», «2 ОД (одной ракеты)», «вне боя» → OD or null with the text kept. */
export function parseReload(text: string): { od: number | null; text: string } {
  const m = /^(\d+)\s*ОД/i.exec(text.trim());
  return { od: m ? Number(m[1]) : null, text: text.trim() };
}
/** Splits a property list on top-level commas: «Взрыв (0.5), Разрывное» → two items. */
export function splitProperties(text: string): string[] {
  const t = text.trim();
  if (!t || /^нет\.?$/i.test(t) || t === '-') return [];
  const out: string[] = [];
  let depth = 0,
    cur = '';
  for (const ch of t) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if ((ch === ',' || ch === ';') && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.map((s) => s.replace(/\.$/, '').trim()).filter(Boolean);
}
/** «Разящее (2)» → name «Разящее», param «2». */
export function parsePropertyItem(raw: string): { name: string; param: string | null } {
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(raw);
  return m ? { name: m[1]!.trim(), param: m[2]!.trim() } : { name: raw.trim(), param: null };
}

/** «Батарея (Х)» → { name «Батарея», hasParam }. */
function propertyEntries(rows: readonly (readonly Cell[])[], sheet: string): ArsenalProperty[] {
  const out: ArsenalProperty[] = [];
  rows.forEach((r, i) => {
    if (i === 0) return; // header «Название черты / Сокращение / Описание / Эффекты»
    const rawName = str(r[0]);
    if (!rawName) return;
    const parsed = parsePropertyItem(rawName.replace(/\s+/g, ' '));
    const abbr = str(r[1]);
    out.push({
      name: parsed.name,
      hasParam: parsed.param !== null,
      abbreviation: abbr && abbr !== '-' ? parsePropertyItem(abbr).name : null,
      description: str(r[2]),
      effect: str(r[3]),
      source: { sheet, row: i + 1 },
    });
  });
  return out;
}

function attachmentEntries(rows: readonly (readonly Cell[])[], sheet: string): ArsenalAttachment[] {
  const out: ArsenalAttachment[] = [];
  let group: string | null = null,
    started = false;
  rows.forEach((r, i) => {
    if (norm(str(r[0])) === 'мод') {
      started = true;
      return;
    }
    if (!started) return;
    if (onlyFirst(r)) {
      group = str(r[0]);
      return;
    }
    const name = str(r[0]) || (out.at(-1)?.name ?? '');
    if (!name || !str(r[1])) return;
    out.push({
      name,
      group,
      weaponType: str(r[1]),
      description: str(r[2]),
      effect: str(r[5]),
      source: { sheet, row: i + 1 },
    });
  });
  return out;
}

function armourTraitEntries(
  rows: readonly (readonly Cell[])[],
  sheet: string,
): ArsenalArmourTrait[] {
  const start = rows.findIndex((r) => norm(str(r[0])) === 'свойства брони');
  if (start < 0) return [];
  const out: ArsenalArmourTrait[] = [];
  rows.slice(start + 1).forEach((r, k) => {
    const raw = str(r[0]);
    if (!raw || !str(r[1])) return;
    const parsed = parsePropertyItem(raw.replace(/\.$/, ''));
    out.push({
      name: parsed.name,
      hasParam: parsed.param !== null,
      description: str(r[1]),
      source: { sheet, row: start + k + 2 },
    });
  });
  return out;
}

function makeResolver(
  properties: readonly ArsenalProperty[],
  attachments: readonly ArsenalAttachment[] = [],
  armourTraits: readonly ArsenalArmourTrait[] = [],
) {
  const traitByName = new Map<string, string>();
  for (const t of armourTraits) traitByName.set(norm(t.name), t.name);
  for (const [short, full] of Object.entries(ARMOUR_TRAIT_ALIASES))
    if (traitByName.has(norm(full))) traitByName.set(norm(short), full);
  const attachmentByName = new Map<string, string>();
  for (const a of attachments) attachmentByName.set(norm(a.name), a.name);
  for (const [short, full] of Object.entries(ATTACHMENT_ALIASES))
    if (attachmentByName.has(norm(full))) attachmentByName.set(norm(short), full);
  const byName = new Map<string, string>();
  for (const p of properties) {
    byName.set(norm(p.name), p.name);
    if (p.abbreviation) byName.set(norm(p.abbreviation), p.name);
  }
  const aliases = new Map(Object.entries(PROPERTY_ALIASES).map(([k, v]) => [norm(k), v]));
  return (raw: string): PropertyRef => {
    const optional = /\(\s*опц\.?\s*\)\s*$/i.test(raw);
    const parsed = parsePropertyItem(optional ? raw.replace(/\(\s*опц\.?\s*\)\s*$/i, '') : raw);
    const name = aliases.get(norm(parsed.name)) ?? parsed.name;
    return {
      raw,
      name,
      param: parsed.param,
      property: byName.get(norm(name)) ?? null,
      attachment: attachmentByName.get(norm(name)) ?? null,
      armourTrait: traitByName.get(norm(name)) ?? null,
      optional,
    };
  };
}

interface Columns {
  [key: string]: number | undefined;
}
function headerColumns(row: readonly Cell[]): Columns | null {
  const cells = row.map((c) => norm(str(c)));
  if (!cells.some((c) => c === 'название' || c.startsWith('название '))) return null;
  const find = (...keys: string[]) => {
    const i = cells.findIndex((c) => keys.some((k) => c.startsWith(k)));
    return i < 0 ? undefined : i;
  };
  return {
    name: find('название'),
    class: find('класс'),
    range: find('дистанция'),
    rof: find('темп'),
    damage: find('урон'),
    pen: find('бронебойн'),
    mag: find('магазин'),
    reload: find('презаряд', 'перезаряд'),
    props: find('свойства', 'черты'),
    mass: find('масса'),
    rarity: find('редкость'),
    armour: find('очки брони'),
    maxAg: find('макс лвк'),
    senses: find('бонус авточувств'),
    description: find('описание'),
  };
}
const at = (r: readonly Cell[], i: number | undefined) => (i === undefined ? '' : str(r[i]));
const onlyFirst = (r: readonly Cell[]) =>
  str(r[0]) !== '' && r.slice(1).every((c) => str(c) === '');

/** Las family: «Особенности: Одиночный выстрел +10, Короткая очередь +5, Длинная +0 к НС». */
export function parseFamilyModes(text: string): ArsenalWeapon['modeModifiers'] {
  const m =
    /Одиночный выстрел\s*([+-]\d+)\s*,\s*Короткая очередь\s*([+-]\d+)\s*,\s*Длинная\s*([+-]\d+)/i.exec(
      text,
    );
  return m
    ? { single: Number(m[1]), 'short-burst': Number(m[2]), 'full-auto': Number(m[3]) }
    : null;
}

export function importArsenal(original: ArsenalSnapshot): ArsenalDataset {
  const issues: ImportIssue[] = [];
  const corrections: string[] = [];
  const sheets: Record<string, Cell[][]> = Object.fromEntries(
    Object.entries(original.sheets).map(([k, rows]) => [k, rows.map((r) => [...r])]),
  );
  for (const c of CELL_CORRECTIONS) {
    const row = sheets[c.sheet]?.[c.row - 1];
    if (!row) continue;
    while (row.length < c.column) row.push('');
    row[c.column - 1] = c.value;
    corrections.push(`${c.sheet}, строка ${c.row}: ${c.reason}`);
  }
  const snapshot = { ...original, sheets };
  const sheet = (name: string) => {
    const rows = snapshot.sheets[name];
    if (!rows) {
      issues.push({ sheet: name, row: 0, message: 'Лист отсутствует в снимке' });
      return [];
    }
    return rows;
  };
  const properties = [
    ...propertyEntries(sheet('Свойства оружия'), 'Свойства оружия'),
    ...EXTRA_PROPERTIES.map((p) => ({ ...p, abbreviation: null, source: { author: AUTHOR } })),
  ];
  corrections.push(
    `Добавлены свойства: ${EXTRA_PROPERTIES.map((p) => p.name).join(', ')}`,
    `Исправлены опечатки: ${Object.entries(PROPERTY_ALIASES)
      .map(([a, b]) => `${a} → ${b}`)
      .join(', ')}`,
  );
  const attachments = attachmentEntries(sheet('Дополнения к оружию'), 'Дополнения к оружию');
  const armourTraits = armourTraitEntries(sheet('Броня'), 'Броня');
  const resolve = makeResolver(properties, attachments, armourTraits);
  const ids = new Set<string>();
  const idFor = (sheetName: string, name: string, row: number) => {
    const base = `${sheetName.trim()}:${name}`;
    const id = ids.has(base) ? `${base}#${row}` : base;
    ids.add(id);
    return id;
  };
  const AMMO_NOTE = /Урон,\s*ББ и свойства зависят от боеприпаса\.?/i;
  const props = (text: string, src: SourceRef, check = true) =>
    splitProperties(text.replace(AMMO_NOTE, '')).map((raw) => {
      const ref = resolve(raw);
      if (check && !ref.property && !ref.attachment && !ref.armourTrait)
        issues.push({
          ...src,
          message: `Свойство «${raw}» не найдено ни в «Свойствах оружия», ни в «Дополнениях к оружию»`,
        });
      return ref;
    });

  const weapons: ArsenalWeapon[] = [];
  for (const name of WEAPON_SHEETS) {
    const rows = sheet(name);
    const family =
      rows
        .slice(0, 3)
        .map((r) => parseFamilyModes(str(r[0])))
        .find(Boolean) ?? null;
    let cols: Columns | null = null,
      group: string | null = null,
      skipped = 0,
      inPatterns = false;
    rows.forEach((r, i) => {
      const src = { sheet: name, row: i + 1 };
      const header = headerColumns(r);
      if (header) {
        cols = header.class !== undefined ? header : null;
        group = null;
        return;
      }
      // A «Паттерны …» table (ruling 183: patterns change a base weapon, they are not weapons):
      // its rows, and the gun mounts beside them, are skipped up to the next empty row.
      if (/^паттерн/i.test(str(r[0]))) {
        inPatterns = true;
        return;
      }
      if (inPatterns) {
        if (r.every((c) => str(c) === '')) inPatterns = false;
        else skipped++;
        return;
      }
      if (!cols || r.every((c) => str(c) === '')) return;
      if (onlyFirst(r)) {
        group = str(r[0]).slice(0, 120);
        return;
      }
      const c: Columns = cols;
      const classText = at(r, c.class);
      const m = /^([^\s(]+)\s*(?:\((.*)\))?/.exec(classText);
      const weaponClass = WEAPON_CLASSES.find((k) => k === m?.[1]);
      const title = at(r, c.name);
      if (!weaponClass || !title) {
        skipped++;
        return;
      }
      const rangeText = at(r, c.range),
        damageText = at(r, c.damage),
        rofText = at(r, c.rof);
      const weapon: ArsenalWeapon = {
        id: idFor(name, title, i + 1),
        name: title,
        sheet: name,
        group,
        weaponClass,
        classNote: m?.[2]?.trim() || null,
        range: {
          meters: parseRange(rangeText),
          text: rangeText,
          formula: /БС/i.test(rangeText),
        },
        rof: c.rof === undefined ? null : parseRof(rofText),
        damage: parseDamage(damageText),
        damageText,
        ...(() => {
          const pen = at(r, c.pen);
          const two = /^(\d+)\s*\((\d+)\)$/.exec(pen);
          return two
            ? { penetration: Number(two[1]), penetrationAlt: Number(two[2]) }
            : { penetration: /^\d+$/.test(pen) ? Number(pen) : null };
        })(),
        magazine: /^\d+$/.test(at(r, c.mag)) ? Number(at(r, c.mag)) : null,
        reload: c.reload === undefined ? null : parseReload(at(r, c.reload)),
        properties: props(at(r, c.props), src),
        ammoDependent: AMMO_NOTE.test(at(r, c.props)),
        mass: { kg: parseMass(at(r, c.mass)), text: at(r, c.mass) },
        rarity: /^-?\d+$/.test(at(r, c.rarity)) ? Number(at(r, c.rarity)) : null,
        modeModifiers: family,
        source: src,
      };
      const none = (t: string) => t === '' || t === '-';
      if (/^\d{4}-\d{2}-\d{2}/.test(rangeText))
        issues.push({
          ...src,
          message: `Дистанция стала датой «${rangeText}» (Excel превратил значение в дату) — нужно исправить в таблице`,
        });
      else if (!none(rangeText) && weapon.range.meters === null && !weapon.range.formula)
        issues.push({ ...src, message: `Дистанция «${rangeText}» не прочитана` });
      if (!none(damageText) && !weapon.damage && !weapon.ammoDependent)
        issues.push({ ...src, message: `Урон «${damageText}» не прочитан` });
      if (c.rof !== undefined && !none(rofText) && !/^ближний бой$/i.test(rofText) && !weapon.rof)
        issues.push({ ...src, message: `Темп огня «${rofText}» не прочитан` });
      weapons.push(weapon);
    });
    if (skipped)
      issues.push({
        sheet: name,
        row: 0,
        message: `Пропущено строк, не похожих на оружие (паттерны, боеприпасы, пояснения): ${skipped}`,
      });
  }

  const armour: ArsenalArmour[] = [];
  for (const name of ARMOUR_SHEETS) {
    const rows = sheet(name);
    let cols: Columns | null = null,
      group: string | null = null;
    rows.forEach((r, i) => {
      const src = { sheet: name, row: i + 1 };
      const header = headerColumns(r);
      if (header) {
        cols = header.armour !== undefined ? header : null;
        group = null;
        return;
      }
      if (!cols || r.every((c) => str(c) === '')) return;
      if (onlyFirst(r)) {
        group = str(r[0]).slice(0, 120);
        return;
      }
      const c: Columns = cols;
      const title = at(r, c.name),
        text = at(r, c.armour);
      const zonesOf = (t: string) => {
        const zones = t.split('/').map((s) => s.trim());
        return zones.length === 4 && zones.every((z) => z === '' || z === '-' || /^\d+$/.test(z))
          ? zones.map((z) => (/^\d+$/.test(z) ? Number(z) : null))
          : null;
      };
      const normalised = text.includes('/') && text.length <= 30 ? normaliseArmourText(text) : null;
      const parsed = normalised ? zonesOf(normalised.main) : null;
      const under = normalised?.under ? zonesOf(normalised.under) : null;
      if (!title || !parsed) {
        // Rows of other tables inside the sheet (critical effects …) have no «a/b/c/d» value.
        if (title && text.includes('/') && text.length <= 30)
          issues.push({
            ...src,
            message: `ОБ «${text}» не прочитаны (проверьте запись в таблице)`,
          });
        return;
      }
      armour.push({
        id: idFor(name, title, i + 1),
        name: title,
        sheet: name,
        group,
        armour: { head: parsed[0]!, torso: parsed[1]!, arms: parsed[2]!, legs: parsed[3]! },
        armourText: text,
        underlayer: under
          ? { head: under[0]!, torso: under[1]!, arms: under[2]!, legs: under[3]! }
          : null,
        maxAgility: at(r, c.maxAg) || null,
        autosenses: at(r, c.senses) || null,
        // Armour traits (Флак, Керамит, Жёсткий …) are not weapon properties: kept as written.
        properties: props(at(r, c.props), src, false),
        mass: { kg: parseMass(at(r, c.mass)), text: at(r, c.mass) },
        rarity: at(r, c.rarity) || null,
        source: src,
      });
    });
  }

  const fields: ArsenalField[] = [];
  {
    const name = 'Силовые поля';
    const rows = sheet(name);
    const cols = rows[0] ? headerColumns(rows[0]) : null;
    rows.forEach((r, i) => {
      if (i === 0 || !cols || onlyFirst(r) || !at(r, cols.name)) return;
      fields.push({
        id: idFor(name, at(r, cols.name), i + 1),
        name: at(r, cols.name),
        description: at(r, cols.description),
        properties: at(r, cols.props),
        rarity: at(r, cols.rarity) || null,
        mass: { kg: parseMass(at(r, cols.mass)), text: at(r, cols.mass) },
        source: { sheet: name, row: i + 1 },
      });
    });
  }

  return {
    format: 'kadat-arsenal',
    version: 1,
    source: snapshot.source,
    properties,
    weapons,
    armour,
    fields,
    attachments,
    armourTraits,
    issues,
    corrections,
  };
}
