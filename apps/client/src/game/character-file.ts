import data from './data/fixture.json';
import {
  ARMOUR_ZONES,
  CHARACTER_FILE_TYPE,
  CHARACTER_SCHEMA_VERSION,
  CHARACTERISTICS,
  characterProblems,
  emptyCharacter,
  parseProfileArmour,
  parseProfileCharacteristic,
  parseProfileMovement,
  parseProfileSkill,
  splitProfileList,
  type CharacterDocument,
} from './character';
import { matchArmourByName, matchWeaponByName } from './arsenal';

/** Character file `*.kadat-character.json` (ruling 51: kept in a file on the computer). */
export class CharacterFileError extends Error {
  override readonly name = 'CharacterFileError';
}
const KEYS = [
  'schemaVersion',
  'id',
  'name',
  'kind',
  'description',
  'characteristics',
  'wounds',
  'size',
  'movement',
  'armour',
  'undersuit',
  'skills',
  'talents',
  'weapons',
  'armourItems',
  'traits',
  'notes',
] as const;
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
function exactKeys(v: Record<string, unknown>, keys: readonly string[], where: string) {
  const extra = Object.keys(v).filter((k) => !keys.includes(k));
  const missing = keys.filter((k) => !(k in v));
  if (extra.length) throw new CharacterFileError(`Лишние поля в ${where}: ${extra.join(', ')}`);
  if (missing.length) throw new CharacterFileError(`Нет полей в ${where}: ${missing.join(', ')}`);
}

/** Canonical text: fixed key order, so the same character always saves the same bytes. */
export function serializeCharacter(c: CharacterDocument): string {
  const problems = characterProblems(c);
  if (problems.length) throw new CharacterFileError(`Персонаж не сохранён: ${problems.join('; ')}`);
  const character = Object.fromEntries(KEYS.map((k) => [k, c[k]]));
  return `${JSON.stringify(
    { documentType: CHARACTER_FILE_TYPE, schemaVersion: CHARACTER_SCHEMA_VERSION, character },
    null,
    2,
  )}\n`;
}

export function parseCharacterFile(text: string): CharacterDocument {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new CharacterFileError('Файл не является JSON — возможно, он повреждён');
  }
  if (!isObject(root) || root.documentType !== CHARACTER_FILE_TYPE)
    throw new CharacterFileError(
      'Это не файл персонажа KADAT (нет documentType: "kadat-character")',
    );
  if (root.schemaVersion !== 1 && root.schemaVersion !== CHARACTER_SCHEMA_VERSION)
    throw new CharacterFileError(
      `Версия файла персонажа ${String(root.schemaVersion)} не поддерживается`,
    );
  exactKeys(root, ['documentType', 'schemaVersion', 'character'], 'файле');
  const raw = root.character;
  if (!isObject(raw)) throw new CharacterFileError('Нет описания персонажа');
  if (raw.schemaVersion !== root.schemaVersion)
    throw new CharacterFileError('Версия в персонаже не совпадает с версией файла');
  // Version 1 had no armour items; early version 2 files have no undersuit: fill defaults.
  const noUndersuit = { head: null, torso: null, arms: null, legs: null };
  const c: Record<string, unknown> =
    root.schemaVersion === 1
      ? (exactKeys(
          raw,
          KEYS.filter((k) => k !== 'armourItems' && k !== 'undersuit'),
          'персонаже',
        ),
        {
          ...raw,
          schemaVersion: CHARACTER_SCHEMA_VERSION,
          armourItems: [],
          undersuit: noUndersuit,
        })
      : 'undersuit' in raw
        ? raw
        : { ...raw, undersuit: noUndersuit };
  exactKeys(c, KEYS, 'персонаже');
  const doc = c as unknown as CharacterDocument;
  const problems = characterProblems(doc);
  if (problems.length) throw new CharacterFileError(`Персонаж повреждён: ${problems.join('; ')}`);
  return structuredClone(doc);
}

type FixtureActor = (typeof data.actors)[number];
const field = (a: FixtureActor, label: string) =>
  a.profile.find((p) => p.label.replace(/:$/, '') === label)?.formattedValue ?? null;
const fieldNote = (a: FixtureActor, label: string) =>
  a.profile.find((p) => p.label.replace(/:$/, '') === label)?.note ?? null;

/**
 * Builds a character from a profile already read from «Профили персонажей» (the test pair
 * Келус and Пак). Values are taken as written; anything that cannot be read stays for the GM.
 */
export function characterFromProfile(actorId: string): CharacterDocument {
  const a = data.actors.find((x) => x.id === actorId);
  if (!a) throw new Error(`Нет профиля ${actorId}`);
  const base = emptyCharacter(`profile-${a.id}`, a.name);
  const characteristics = Object.fromEntries(
    CHARACTERISTICS.map((k) => {
      const c = (a.characteristics as Record<string, { raw: string }>)[k];
      const parsed = c ? parseProfileCharacteristic(c.raw) : null;
      return [k, parsed ?? base.characteristics[k]];
    }),
  ) as CharacterDocument['characteristics'];
  const movementText = field(a, 'Движение') ?? '';
  const movement =
    parseProfileMovement(movementText) ?? parseProfileMovement(fieldNote(a, 'Движение') ?? '');
  const armour = parseProfileArmour(field(a, 'ОБ') ?? '');
  const sizeMatch = /Размер\s*\((-?\d+)\)/.exec(field(a, 'Особенности') ?? '');
  const skills = splitProfileList(field(a, 'Навыки') ?? '').map(parseProfileSkill);
  // Equipment names that equal one Arsenal record exactly become weapons or armour items.
  const equipment = field(a, 'Снаряжение') ?? '';
  const weapons: { name: string; ref: string | null }[] = [];
  const armourItems: { name: string; ref: string | null }[] = [];
  const unmatched: string[] = [];
  for (const item of splitProfileList(equipment.replace(/^[-–]\s*/gm, ''))) {
    const w = matchWeaponByName(item);
    const ar = w ? null : matchArmourByName(item);
    if (w) weapons.push({ name: w.name, ref: w.id });
    else if (ar) armourItems.push({ name: ar.name, ref: ar.id });
    else unmatched.push(item);
  }
  const traits = [field(a, 'Особенности'), field(a, 'Импланты')]
    .filter((x) => x && x !== '_')
    .map((x, i) => `${i ? 'Импланты' : 'Особенности'}: ${x}`)
    .join('\n');
  return {
    ...base,
    description: 'Из профиля «Персонажи Вольного торговца».',
    characteristics,
    wounds: Number(field(a, 'Раны')) || a.max,
    size: sizeMatch ? Number(sizeMatch[1]) : 0,
    movement: { options: movement ?? base.movement.options, current: 0 },
    armour: armour ?? base.armour,
    skills: skills.filter(
      (s, i) => skills.findIndex((x) => x.name.toLowerCase() === s.name.toLowerCase()) === i,
    ),
    talents: splitProfileList(field(a, 'Таланты') ?? ''),
    weapons,
    armourItems,
    traits,
    notes:
      `Снаряжение по профилю: ${equipment || '—'}` +
      (unmatched.length ? `\nНе найдено в Арсенале однозначно: ${unmatched.join(', ')}` : ''),
  };
}
export const PROFILE_CHARACTERS = data.actors.map((a) => ({ id: a.id, name: a.name }));
export { ARMOUR_ZONES };
