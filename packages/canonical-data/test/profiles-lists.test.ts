import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importProfilesLists, type ProfilesListsSnapshot } from '../src/profiles-lists.js';

const snapshot = JSON.parse(
  readFileSync(new URL('../sources/profiles-lists-2026-11-23.json', import.meta.url), 'utf8'),
) as ProfilesListsSnapshot;
const lists = importProfilesLists(snapshot);

describe('Skill and talent names from «Профили персонажей»', () => {
  it('reads the skill headings with their characteristic and row', () => {
    expect(lists.skills[0]).toEqual({ name: 'Акробатика', characteristic: 'Ловкость', row: 4 });
    expect(lists.skills.find((s) => s.name === 'Уклонение')?.characteristic).toBe('Ловкость');
    expect(lists.skills.find((s) => s.name.startsWith('Технология'))?.characteristic).toBe(
      'Интеллект',
    );
    // Rows like «"+30"» of the modifier tables are not skills; professions are left out.
    expect(lists.skills.every((s) => !s.name.startsWith('"') && s.row <= 300)).toBe(true);
  });
  it('reads talents of three tiers, with requirements and the «†» mark', () => {
    expect(lists.talents.find((t) => t.name === 'Боевое чутьё')).toMatchObject({
      tier: 1,
      requirements: 'ВС 30',
    });
    expect(lists.talents.find((t) => t.name === 'Парное оружие')?.marked).toBe(true);
    expect(new Set(lists.talents.map((t) => t.tier))).toEqual(new Set([1, 2, 3]));
  });
  it('the committed dataset equals a fresh import of the snapshot', () => {
    const dataset = JSON.parse(
      readFileSync(new URL('../dataset/profiles-lists.json', import.meta.url), 'utf8'),
    );
    expect(dataset).toEqual(JSON.parse(JSON.stringify(lists)));
  });
});
