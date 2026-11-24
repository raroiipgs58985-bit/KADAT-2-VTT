/**
 * Old talent names still written in some profiles, mapped to the names of the current sheet
 * «Таланты (обновлены)» (author ruling 80). The engine only knows the current names.
 */
export const TALENT_ALIASES: Readonly<Record<string, string>> = {
  'Бугрящиеся мышцы': 'Бугрящиеся бицепсы',
  // Typos of the generator catalogs (author decision, 2026-11-24).
  'Сокуршительный удар': 'Сокрушительный удар',
  Верныйудар: 'Верный удар',
  'Охотники на танки': 'Охотник на танки',
  'На предле возможного': 'На пределе возможного',
  'Просто царапина': 'Это просто царапина',
  // Old names of the generator → names of the talent sheets (author decision 2026-11-24:
  // the spreadsheets are the primary source).
  'Ношение Серво-брони': 'Ношение брони (Серво-броня/Экзо-броня)',
  'Стальная челюсть': 'Железная челюсть',
  Параноик: 'Паранойя',
  Параноя: 'Паранойя',
};
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase().replace(/ё/g, 'е');
const aliasByNorm = new Map(Object.entries(TALENT_ALIASES).map(([k, v]) => [norm(k), v]));
export const canonicalTalent = (name: string) => {
  const alias = aliasByNorm.get(norm(name));
  if (alias) return alias;
  // «Сопротивление (Яды)» → «Сопротивляемость (Яды)» (sheet name, specialised talent «†»).
  const resist = /^сопротивление\s*(\(.+\))$/i.exec(name.trim());
  return resist ? `Сопротивляемость ${resist[1]}` : name.trim();
};
/**
 * «Парное оружие» is taken separately for НС and НР (ruling 106): «(НС)», «(Стрельба)» →
 * «Парное оружие (Стрелковое)»; «(НР)», «(Рукопашная)» → «Парное оружие (Рукопашное)»; both
 * may be named at once. Without a specification the name stays and the GM is asked.
 */
function dualWeaponTalents(name: string): string[] {
  const m = /^парное оружие\s*\((.+)\)$/.exec(norm(name));
  if (!m) return [name];
  const spec = m[1]!;
  const out: string[] = [];
  if (/нс|стрел/.test(spec)) out.push('Парное оружие (Стрелковое)');
  if (/нр|рукопаш/.test(spec)) out.push('Парное оружие (Рукопашное)');
  return out.length ? out : [name];
}
export const canonicalTalents = (names: readonly string[]) => [
  ...new Set(names.map(canonicalTalent).flatMap(dualWeaponTalents)),
];
