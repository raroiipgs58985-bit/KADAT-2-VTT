/**
 * Old talent names still written in some profiles, mapped to the names of the current sheet
 * «Таланты (обновлены)» (author ruling 80). The engine only knows the current names.
 */
export const TALENT_ALIASES: Readonly<Record<string, string>> = {
  'Бугрящиеся мышцы': 'Бугрящиеся бицепсы',
};
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase().replace(/ё/g, 'е');
const aliasByNorm = new Map(Object.entries(TALENT_ALIASES).map(([k, v]) => [norm(k), v]));
export const canonicalTalent = (name: string) => aliasByNorm.get(norm(name)) ?? name.trim();
export const canonicalTalents = (names: readonly string[]) => [
  ...new Set(names.map(canonicalTalent)),
];
