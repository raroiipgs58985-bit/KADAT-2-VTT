/**
 * Author corrections to the Arsenal snapshot (chat, 23.11.2026; ВОПРОСЫ-ПО-ПРАВИЛАМ.md 54–58).
 * The Google tables are read-only for the program: corrections live here with their reason
 * and are applied during import; the source snapshot stays untouched.
 */
import type { Cell } from './arsenal.js';

export const AUTHOR = 'Решение автора 23.11.2026';

/** Misspelt property names in the tables → the correct names (decision 55). */
export const PROPERTY_ALIASES: Readonly<Record<string, string>> = {
  Калечашее: 'Калечащее',
  Разщее: 'Разящее',
  Ослепляещее: 'Ослепляющее',
  'Частичтное Опутывание': 'Частичное опутывание',
  'Частичтное опутывание': 'Частичное опутывание',
};

/** Properties used in the Arsenal but missing from «Свойства оружия» (decision 54). */
export const EXTRA_PROPERTIES: readonly {
  readonly name: string;
  readonly hasParam: boolean;
  readonly description: string;
  readonly effect: string;
}[] = [
  {
    name: 'Проверенное',
    hasParam: true,
    description: 'Надёжный, выверенный урон.',
    effect:
      'Каждый куб урона не может дать меньше Х: при Проверенное (2) и 1к10 выпавшая 1 считается 2.',
  },
  {
    name: 'Навесное',
    hasParam: false,
    description: 'Стрельба по навесной траектории.',
    effect: 'Может стрелять через препятствия по навесной траектории.',
  },
  {
    name: 'Ослепляющее',
    hasParam: true,
    description: 'По аналогии с «Оглушающее», но вместо пропуска ходов цель ослеплена.',
    effect:
      'Как «Оглушающее (Х)»: при попадании проверка ВН − Х×10; при провале цель ослеплена (не видит) на число ходов, равное провалам.',
  },
];

/** Cells of the snapshot corrected by the author: sheet, 1-based row and column, value. */
export const CELL_CORRECTIONS: readonly {
  readonly sheet: string;
  readonly row: number;
  readonly column: number;
  readonly value: Cell;
  readonly reason: string;
}[] = [
  {
    sheet: 'ХТХ и примитив',
    row: 85,
    column: 3,
    value: '1-3',
    reason: 'Силовая коса: Excel превратил дальность «1-3» в дату (решение 58)',
  },
];

/**
 * Armour written as «3-/-/-» (a cap or helmet: only the head) — the digit and the dash were
 * merged; the same for bracers and other single-zone items (decision 57). Power armour may carry
 * a second set «20/20/20/20 5/6/5/5»: the undersuit layer (decision 56).
 */
export function normaliseArmourText(text: string): { main: string; under: string | null } {
  const [main = '', under = null] = text.trim().split(/\s+/, 2);
  const fix = (t: string) => {
    const parts = t.replace(/(\d)-(?=\/|$)/g, '$1/-').split('/');
    while (parts.length < 4) parts.push('-');
    return parts.slice(0, 4).join('/');
  };
  return { main: fix(main), under: under ? fix(under) : null };
}

/**
 * Short names of attachments used in the property columns → the attachment of «Дополнения к
 * оружию». Proposed by the agent from the obvious spelling; listed for the author to confirm.
 */
export const ATTACHMENT_ALIASES: Readonly<Record<string, string>> = {
  Оптика: 'Оптический прицел',
  Омни: 'Омни-прицел',
  Омниприцел: 'Омни-прицел',
  'Предсказатель движения': 'Предсказатель движений',
};
