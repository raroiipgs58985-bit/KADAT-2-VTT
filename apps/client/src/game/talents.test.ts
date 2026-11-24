import { describe, expect, it } from 'vitest';
import { canonicalTalents } from './talents';
import { profilesLists, talentInSheets } from './profiles-lists';

describe('Talent names', () => {
  it('generator typos map to the names of the sheet «Таланты»', () => {
    const fixed = canonicalTalents([
      'Сокуршительный удар',
      'Верныйудар',
      'Охотники на танки',
      'На предле возможного',
      'Просто царапина',
      'Бугрящиеся мышцы',
    ]);
    const sheet = new Set(profilesLists.talents.map((t) => t.name));
    for (const name of fixed) expect(sheet.has(name), name).toBe(true);
  });

  it('old generator names map to the talent sheets; unknown names are flagged', () => {
    const mapped = canonicalTalents([
      'Сопротивление (Яды)',
      'Ношение Серво-брони',
      'Стальная челюсть',
      'Параноик',
      'Параноя',
      'Враг (Арбитры)',
      'Быстрая атака',
      'Стрельба на бегу',
      'Крепкий',
      'Полевой хирургеон',
      'Технический трюк',
    ]);
    expect(mapped).toContain('Сопротивляемость (Яды)');
    for (const name of mapped) expect(talentInSheets(name), name).toBe(true);
    for (const name of ['Залечь', 'Орлиный глаз', 'Расклин', 'удар'])
      expect(talentInSheets(name), name).toBe(false);
  });
});
