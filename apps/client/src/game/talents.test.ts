import { describe, expect, it } from 'vitest';
import { canonicalTalents } from './talents';
import { profilesLists } from './profiles-lists';

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
});
