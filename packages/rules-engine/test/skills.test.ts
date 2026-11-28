import { describe, expect, test } from 'vitest';
import { skillCheckValue } from '../src/index.js';

describe('Skill value in a combat test — author ruling 49', () => {
  test('a skill at +0 uses the characteristic unchanged', () => {
    expect(skillCheckValue(40, { name: 'Атлетика', bonus: 0 })).toEqual({
      value: 40,
      modifier: 0,
      trained: true,
    });
  });
  test('a skill bonus (+10, +15) is added', () => {
    expect(skillCheckValue(40, { name: 'Уклонение', bonus: 10 }).value).toBe(50);
    expect(skillCheckValue(40, { name: 'Уклонение', bonus: 15 }).value).toBe(55);
  });
  test('without the skill the GM chooses the penalty; nothing is assumed', () => {
    expect(() => skillCheckValue(40, null)).toThrow(/GM must choose/);
    expect(skillCheckValue(40, null, -20)).toMatchObject({ value: 20, trained: false });
    expect(skillCheckValue(40, null, -30).value).toBe(10);
    expect(() => skillCheckValue(40, null, 10)).toThrow(/zero or negative/);
  });
});
