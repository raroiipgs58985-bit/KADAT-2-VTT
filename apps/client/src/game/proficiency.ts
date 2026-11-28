import type { ArsenalWeapon } from '../../../../packages/canonical-data/src/arsenal';

/**
 * «Владение оружием» (ruling 84): without the weapon's kind the attack gets −30. The kind is
 * read from the Arsenal sheet and group; kinds the sheet cannot tell are left to the GM (null).
 */
export const PROFICIENCY_PENALTY = -30;
const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').trim();

/** Arsenal sheets of xenos weapons: exotic, each type needs its own «Владение экзотическим оружием». */
export const EXOTIC_SHEETS = ['Аэльдари', 'Друкхари', 'Тау', 'Оружие Механикус'];
export const isExotic = (w: ArsenalWeapon) => EXOTIC_SHEETS.includes(w.sheet);

export function weaponKindName(w: ArsenalWeapon): string | null {
  const g = norm(w.group ?? '');
  if (isExotic(w)) return w.name;
  switch (w.sheet) {
    case 'Лаз':
      return 'Лаз';
    case 'Болт':
      return 'Болт';
    case 'Плазма':
      return 'Плазма';
    case 'Стаб и РПУ':
      if (!g) return 'Стаб';
      if (/гранатом|миномет|реактивн|ракет|снаряд/.test(g)) return 'Пусковое';
      return null;
    case 'Термическое оружие':
      if (g.startsWith('огнемет')) return 'Зажигательное';
      if (g.startsWith('мельт')) return 'Мельта';
      return null;
    case 'ХТХ и примитив':
      if (g.startsWith('цепное')) return 'Цепное';
      if (g.startsWith('силовое')) return 'Силовое';
      if (g.startsWith('шоковое')) return 'Шоковое';
      if (g.startsWith('встречаемые') || g.startsWith('примитивное')) return 'Примитив';
      return null;
    default:
      return null;
  }
}
const SYNONYMS: Record<string, string[]> = {
  зажигательное: ['зажигательное', 'огнемет', 'огнеметы', 'огнеметное'],
  пусковое: ['пусковое', 'рпу', 'пусковые'],
  примитив: ['примитив', 'примитивное'],
};
/** Kinds the character is proficient with, from «Владение оружием (Лаз, Стаб|Болт …)». */
export function proficientKinds(talents: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const t of talents) {
    const m = /^Владение (?:экзотическим )?оружием\s*\((.+)\)\s*$/i.exec(t.trim());
    if (!m) continue;
    for (const part of m[1]!.split(/[,|/]/)) {
      const k = norm(part);
      if (!k) continue;
      out.add(k);
      for (const [base, alts] of Object.entries(SYNONYMS)) if (alts.includes(k)) out.add(base);
    }
  }
  return out;
}
export const hasProficiency = (talents: readonly string[], kind: string) =>
  proficientKinds(talents).has(norm(kind));

/**
 * Exotic (xenos) weapon: only «Владение экзотическим оружием (тип)» naming this weapon or its
 * group counts (the talent covers one type, not all — «Таланты (обновлены)» стр. 29).
 */
export function hasExoticProficiency(talents: readonly string[], w: ArsenalWeapon): boolean {
  const name = norm(w.name);
  const group = norm(w.group ?? '');
  return talents.some((t) => {
    const m = /^Владение экзотическим оружием\s*\((.+)\)\s*$/i.exec(t.trim());
    if (!m) return false;
    return m[1]!
      .split(/[,|/]/)
      .map(norm)
      .some((k) => !!k && (name.includes(k) || k.includes(name) || (!!group && group.includes(k))));
  });
}
