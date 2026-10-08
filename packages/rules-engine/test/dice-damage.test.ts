import { describe, expect, test } from 'vitest';
import { createSequenceDice, resolveDamageRoll, rollDice, rollDie } from '../src/index.js';
import { context } from './fixtures.js';

describe('injectable dice and raw damage', () => {
  test('independent deterministic d100/d10/d5 inputs', () => {
    const source = createSequenceDice([
      { sides: 100, value: 28 },
      { sides: 10, value: 6 },
      { sides: 5, value: 5 },
    ]);
    expect([
      rollDie(100, source).value,
      rollDie(10, source).value,
      rollDie(5, source).value,
    ]).toEqual([28, 6, 5]);
    expect(() => rollDie(5, source)).toThrow('Expected injected');
  });

  test('2d10+3 [8,6] retains both dice and raw damage 17', () => {
    const { result, log } = resolveDamageRoll(
      { count: 2, sides: 10, modifier: 3 },
      createSequenceDice([
        { sides: 10, value: 8 },
        { sides: 10, value: 6 },
      ]),
      context(),
    );
    expect(result).toMatchObject({
      diceTotal: 14,
      modifier: 3,
      rawDamage: 17,
      critical: false,
      criticalTriggerCountForConsequence: 0,
    });
    expect(result.rolls.map((roll) => roll.value)).toEqual([8, 6]);
    expect(log.damage).toEqual(result);
  });

  test('AC-010: 2d10 [10,10] retains damage 20 but exactly one trigger, without a consequence die', () => {
    const dice = createSequenceDice([
      { sides: 10, value: 10 },
      { sides: 10, value: 10 },
    ]);
    const { result } = resolveDamageRoll({ count: 2, sides: 10, modifier: 0 }, dice, context());
    expect(result).toMatchObject({
      diceTotal: 20,
      rawDamage: 20,
      critical: true,
      criticalTriggerCountForConsequence: 1,
    });
    expect(result.rolls).toHaveLength(2);
  });

  test.each([5, 10])('d%i maximum triggers a critical', (sides) => {
    expect(
      resolveDamageRoll(
        { count: 1, sides, modifier: 0 },
        createSequenceDice([{ sides, value: sides }]),
        context(),
      ).result.critical,
    ).toBe(true);
  });

  test('general NdM abstraction does not expand canonical weapon damage dice', () => {
    expect(
      rollDice({ count: 1, sides: 6, modifier: 2 }, createSequenceDice([{ sides: 6, value: 3 }]))
        .total,
    ).toBe(5);
    expect(() =>
      resolveDamageRoll({ count: 1, sides: 6, modifier: 0 }, createSequenceDice([]), context()),
    ).toThrow('only d5/d10');
  });

  test.each([0, -1, 11, 1.5, NaN, Infinity])('invalid injected d10 face %s fails', (value) => {
    expect(() => rollDie(10, { roll: () => value })).toThrow();
  });

  test('wrong die, exhausted sequence and invalid expression fail explicitly', () => {
    expect(() => rollDie(10, createSequenceDice([{ sides: 5, value: 5 }]))).toThrow(
      'Expected injected',
    );
    expect(() => rollDie(10, createSequenceDice([]))).toThrow('Expected injected');
    expect(() => rollDice({ count: 0, sides: 10, modifier: 0 }, createSequenceDice([]))).toThrow();
    expect(() => rollDice({ count: 1, sides: 1, modifier: 0 }, createSequenceDice([]))).toThrow();
    expect(() =>
      rollDice({ count: 1, sides: 10, modifier: 0.5 }, createSequenceDice([])),
    ).toThrow();
  });
});
