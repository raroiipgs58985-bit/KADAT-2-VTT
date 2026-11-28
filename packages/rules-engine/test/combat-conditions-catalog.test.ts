import { describe, expect, test } from 'vitest';
import { conditionModifiers, resolveRangedAttack } from '../src/index.js';
import { attack, b1State, dice } from './b1-fixtures.js';

describe('Combat conditions — «Бой» J61–K66 and F85–H90', () => {
  test('ranged: smoke −20 and darkness −30 reach the shot', () => {
    const modifiers = conditionModifiers('ranged', ['smoke', 'darkness']);
    const r = resolveRangedAttack(
      b1State(),
      attack('s', { context: { ...attack().context, modifiers } }),
      dice({ sides: 100, value: 50 }),
    );
    const ids = r.result.check.modifiers.map((m) => [m.id, m.value]);
    expect(ids).toContainEqual(['condition:ranged:smoke', -20]);
    expect(ids).toContainEqual(['condition:ranged:darkness', -30]);
  });
  test('melee: a running or outnumbered target +10', () => {
    expect(conditionModifiers('melee', ['target-running-outnumbered'])[0]!.value).toBe(10);
  });
  test('unknown condition is refused', () => {
    expect(() => conditionModifiers('ranged', ['rain'])).toThrow(/Unknown ranged condition/);
  });
});
