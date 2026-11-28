/**
 * Readable names of check modifiers for the attack preview (ADR 0007). Presentation only: the
 * values and their applicability come from the rules engine unchanged.
 */
const NAMES: Record<string, string> = {
  'ranged:range': 'Дистанция',
  'ranged:mode': 'Режим огня',
  'ranged:aim': 'Прицеливание',
  'ranged:called': 'Прицельный выстрел',
  'ranged:one-handed': 'Одной рукой',
  'ranged:two-weapons': 'Два оружия',
  'ranged:unbraced-heavy': 'Тяжёлое без упора',
  'ranged:tactical-advance': 'Тактическое продвижение',
  'ranged:wide-arc-dodge': 'Широкая дуга',
  'ranged:attack': 'Атака',
  'melee:base': 'Тип атаки',
  'melee:aim': 'Прицеливание',
  'melee:called': 'Прицельный удар',
  'melee:counterattack': 'Контратака',
  'melee:defensive-target': 'Цель в защитной стойке',
  'melee:grapple-target': 'Цель в захвате',
  'melee:prone-target': 'Цель лежит',
  'melee:grip': 'Хват',
  'melee:technique': 'Приём',
  'melee:technique-defense': 'Защита от приёма',
  'melee:two-weapons': 'Два оружия',
  'melee:knockdown': 'Сбивание с ног',
  'melee:avoidance': 'Уклонение',
  'suppression:source-penalty': 'Подавление',
  fatigue: 'Усталость',
  gm: 'Модификатор ведущего',
  unarmed: 'Без оружия против вооружённого',
  smoke: 'Дым',
  frenzy: 'Безумный натиск',
  'las-expert': 'Знаток Лаз-оружия',
  'no-proficiency': 'Нет владения оружием',
  'target-stunned': 'Цель оглушена',
  'impaled-arm': 'Пронзённая рука',
  'explicit-test-modifier': 'Модификатор теста',
  'fire-charge': 'Огневой натиск',
  optional: 'Опциональное свойство',
  stun: 'Оглушающий удар',
  knockdown: 'Сбивание с ног',
  'break-free': 'Высвобождение',
};

const CYRILLIC = /[А-Яа-яЁё]/;

/** `id` of a modifier trace and its provenance reason → a short Russian name. */
export function modifierLabel(id: string, reason?: string): string {
  if (reason && CYRILLIC.test(reason)) return reason;
  if (NAMES[id]) return NAMES[id]!;
  const talent = id.match(/:talent:(.+)$/);
  if (talent) return `Талант «${talent[1]}»`;
  // Client modifiers are `${commandId}:${kind}`.
  const tail = id.slice(id.lastIndexOf(':') + 1);
  if (NAMES[tail]) return NAMES[tail]!;
  if (id.startsWith('wound')) return 'Ранения';
  return id;
}
