import {
  CHARACTERISTICS,
  emptyCharacter,
  splitProfileList,
  type CharacterDocument,
} from './character';
import { matchArmourByName, matchWeaponByName, withArmourFromItems } from './arsenal';

/**
 * A character handed over by the character generator (apps/generator, «В KADAT VTT»). The
 * generator writes its dossier as is into the browser storage of the same address; the VTT
 * turns it into a combat sheet here.
 */
export interface GeneratorCharacter {
  readonly format: 'kadat-generator-character';
  readonly version: 1;
  readonly exportedAt: string;
  readonly name: string;
  readonly gender: string | null;
  readonly race: { readonly id: string | null; readonly name: string; readonly traits: string[] };
  readonly world: { readonly id: string | null; readonly name: string };
  readonly specialty: { readonly id: string | null; readonly name: string };
  readonly stats: Readonly<Record<string, number>>;
  readonly skills: readonly { readonly name: string; readonly bonus: number }[];
  readonly talents: readonly string[];
  readonly wounds: number;
  readonly equipment: readonly string[];
  readonly traits: readonly string[];
  readonly rules: readonly string[];
}
export const GENERATOR_OUTBOX = 'kadat.generator-outbox.v1';

export function isGeneratorCharacter(v: unknown): v is GeneratorCharacter {
  const c = v as GeneratorCharacter;
  return (
    !!c &&
    c.format === 'kadat-generator-character' &&
    c.version === 1 &&
    typeof c.name === 'string' &&
    typeof c.wounds === 'number' &&
    !!c.stats &&
    Array.isArray(c.skills) &&
    Array.isArray(c.talents) &&
    Array.isArray(c.equipment) &&
    !!c.race &&
    Array.isArray(c.race.traits)
  );
}

/** «СверхСЛ (+2)» in the traits → Super 2 for СЛ. */
function supers(traits: readonly string[]): Partial<Record<string, number>> {
  const out: Partial<Record<string, number>> = {};
  for (const t of traits) {
    const m = /Сверх\s*([А-ЯЁ]{2})\s*\(\s*\+?(\d+)\s*\)/.exec(t);
    if (m) out[m[1]!] = (out[m[1]!] ?? 0) + Number(m[2]);
  }
  return out;
}

/**
 * Combat sheet from a generator character. СКР = бЛВ + Размер, or 0,5 m when that is
 * zero or less («Общая механика» A25). Equipment whose name equals one Arsenal record becomes a
 * weapon or an armour item; the rest is kept in the notes. Armour ОБ is left at 0 for the GM
 * («Взять ОБ из брони» in the editor).
 */
export function characterFromGenerator(g: GeneratorCharacter, id: string): CharacterDocument {
  const base = emptyCharacter(id, g.name.trim() || 'Персонаж генератора');
  const allTraits = [...g.race.traits, ...g.traits];
  const sup = supers(allTraits);
  const characteristics = Object.fromEntries(
    CHARACTERISTICS.map((k) => [
      k,
      { value: Math.max(0, Math.round(g.stats[k] ?? 0)), super: sup[k] ?? 0 },
    ]),
  ) as CharacterDocument['characteristics'];
  const sizeMatch = allTraits
    .map((t) => /Размер\s*\((-?\d+)\)/.exec(t))
    .find((m): m is RegExpExecArray => m !== null);
  const size = sizeMatch ? Number(sizeMatch[1]) : 0;
  const skr = Math.floor(characteristics.ЛВ.value / 10) + size;
  const weapons: { name: string; ref: string | null }[] = [];
  const armourItems: { name: string; ref: string | null }[] = [];
  const unmatched: string[] = [];
  for (const item of g.equipment.flatMap((e) => splitProfileList(e))) {
    const w = matchWeaponByName(item);
    const a = w ? null : matchArmourByName(item);
    if (w) weapons.push({ name: w.name, ref: w.id });
    else if (a) armourItems.push({ name: a.name, ref: a.id });
    else unmatched.push(item);
  }
  const skills = g.skills
    .map((s) => ({ name: s.name.trim(), bonus: Math.max(0, Math.min(60, s.bonus | 0)) }))
    .filter((s, i, all) => s.name && all.findIndex((x) => x.name === s.name) === i);
  return withArmourFromItems({
    ...base,
    description: `Из генератора: ${g.race.name}, ${g.world.name}, ${g.specialty.name}.`,
    characteristics,
    wounds: Math.max(1, Math.round(g.wounds)),
    size: Math.max(-4, Math.min(6, size)),
    movement: { options: [{ label: 'бЛВ + Размер', skr: skr > 0 ? skr : 0.5 }], current: 0 },
    skills,
    talents: [...new Set(g.talents.map((t) => t.trim()).filter(Boolean))],
    weapons,
    armourItems,
    traits: allTraits.join('\n'),
    notes: [
      `Снаряжение по генератору: ${g.equipment.join(', ') || '—'}`,
      unmatched.length ? `Не найдено в Арсенале однозначно: ${unmatched.join(', ')}` : '',
      g.rules.length ? `Особые правила специальности: ${g.rules.join('; ')}` : '',
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 4000),
  });
}

/** Characters waiting in the generator outbox of this browser (newest first). */
export function readGeneratorOutbox(): GeneratorCharacter[] {
  try {
    const list = JSON.parse(localStorage.getItem(GENERATOR_OUTBOX) ?? '[]') as unknown;
    return Array.isArray(list) ? list.filter(isGeneratorCharacter) : [];
  } catch {
    return [];
  }
}
export function removeFromGeneratorOutbox(name: string) {
  try {
    const list = readGeneratorOutbox().filter((c) => c.name !== name);
    localStorage.setItem(GENERATOR_OUTBOX, JSON.stringify(list));
  } catch {
    /* the outbox is a convenience; nothing to do */
  }
}
