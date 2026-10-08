import { describe, expect, test } from 'vitest';
import { createSequenceDice, resolveCharacteristic, resolveCheck } from '../src/index.js';
import { context, deepFreeze, effect, modifier } from './fixtures.js';

function d100(value: number) {
  return createSequenceDice([{ sides: 100, value }]);
}

describe('deterministic d100 acceptance', () => {
  test('AC-001: target 70, roll 28 gives 5 degrees', () => {
    const { result, log } = resolveCheck(
      { baseValue: 70, finalSuper: 0, context: context() },
      d100(28),
    );
    expect(result).toMatchObject({
      rawRoll: 28,
      target: 70,
      outcome: 'success',
      baseDegrees: 5,
      superDegrees: 0,
      totalDegrees: 5,
    });
    expect(result.failureDegrees).toBeUndefined();
    expect(log).toMatchObject({
      resolver: 'check',
      target: 70,
      dice: [{ sides: 100, value: 28 }],
      degrees: { base: 5, super: 0, total: 5 },
    });
  });

  test('AC-002: characteristic 50, Super 4, roll 44', () => {
    const characteristic = resolveCharacteristic(
      'СЛ',
      { baseValue: 50, baseSuper: 4 },
      context(),
    ).result;
    expect(characteristic).toMatchObject({ normalBonus: 5, finalBonus: 9, superSuccessDegrees: 2 });
    const { result } = resolveCheck(
      {
        baseValue: characteristic.finalValue,
        finalSuper: characteristic.finalSuper,
        context: context(),
      },
      d100(44),
    );
    expect(result).toMatchObject({
      outcome: 'success',
      baseDegrees: 1,
      superDegrees: 2,
      totalDegrees: 3,
    });
  });

  test('degrees use the full target above 100', () => {
    const { result } = resolveCheck(
      { baseValue: 150, finalSuper: 0, context: context() },
      d100(28),
    );
    expect(result).toMatchObject({
      target: 150,
      outcome: 'success',
      baseDegrees: 13,
      totalDegrees: 13,
    });
  });

  test.each([96, 97, 98, 99, 100])('roll %i is critical failure even at target 150', (roll) => {
    const { result } = resolveCheck(
      { baseValue: 150, finalSuper: 4, context: context() },
      d100(roll),
    );
    expect(result).toMatchObject({
      criticalBand: 'failure',
      outcome: 'failure',
      baseDegrees: 0,
      superDegrees: 0,
      totalDegrees: 0,
    });
  });

  test.each([1, 2, 3, 4, 5])('roll %i is critical success', (roll) => {
    expect(
      resolveCheck({ baseValue: 50, finalSuper: 0, context: context() }, d100(roll)).result,
    ).toMatchObject({ criticalBand: 'success', outcome: 'success' });
  });

  test('ordinary success/failure boundaries and symmetric failure degrees', () => {
    expect(
      resolveCheck({ baseValue: 70, finalSuper: 0, context: context() }, d100(70)).result,
    ).toMatchObject({ outcome: 'success', baseDegrees: 1, criticalBand: 'none' });
    expect(
      resolveCheck({ baseValue: 70, finalSuper: 4, context: context() }, d100(81)).result,
    ).toMatchObject({ outcome: 'failure', failureDegrees: 2, superDegrees: 0, totalDegrees: 0 });
    expect(
      resolveCheck({ baseValue: 70, finalSuper: 0, context: context() }, d100(95)).result
        .criticalBand,
    ).toBe('none');
    expect(
      resolveCheck({ baseValue: 70, finalSuper: 0, context: context() }, d100(6)).result
        .criticalBand,
    ).toBe('none');
  });

  test('bonuses and penalties retain separate provenance', () => {
    const modifiers = [modifier('bonus', 20), modifier('penalty', -10)];
    const { result, log } = resolveCheck(
      { baseValue: 60, finalSuper: 0, context: context({ modifiers }) },
      d100(28),
    );
    expect(result.target).toBe(70);
    expect(result.modifiers.map((entry) => entry.source.id)).toEqual(['bonus', 'penalty']);
    expect(log.baseValues.baseValue).toBe(60);
    expect(log.modifiers.every((entry) => entry.provenance.reason.length > 0)).toBe(true);
  });

  test('GM EXCLUDE/MODIFY apply once without changing frozen sources', () => {
    const original = deepFreeze(
      context({ modifiers: [modifier('bonus', 20), modifier('penalty', -10)] }),
    );
    const overridden = context({
      ...original,
      overrides: [
        {
          subject: 'modifier',
          id: 'bonus',
          operation: 'EXCLUDE',
          reason: 'GM excludes bonus for this check',
        },
        {
          subject: 'modifier',
          id: 'penalty',
          operation: 'MODIFY',
          value: -5,
          reason: 'GM changes penalty for this check',
        },
      ],
    });
    const changed = resolveCheck({ baseValue: 60, finalSuper: 0, context: overridden }, d100(28));
    expect(changed.result.target).toBe(55);
    expect(changed.log.overrides).toEqual(overridden.overrides);
    expect(changed.result.modifiers).toMatchObject([
      { originalValue: 20, value: 20, included: false, reason: 'override' },
      { originalValue: -10, value: -5, included: true, reason: 'override' },
    ]);
    expect(
      resolveCheck({ baseValue: 60, finalSuper: 0, context: original }, d100(28)).result.target,
    ).toBe(70);
    expect(original.modifiers.map((entry) => entry.value)).toEqual([20, -10]);
  });

  test('GM INCLUDE can enable a potential modifier whose context normally excludes it', () => {
    const conditional = { ...modifier('conditional', 10), condition: { requiresTags: ['needed'] } };
    expect(
      resolveCheck(
        { baseValue: 50, finalSuper: 0, context: context({ modifiers: [conditional] }) },
        d100(28),
      ).result.target,
    ).toBe(50);
    const ctx = context({
      modifiers: [conditional],
      overrides: [
        { subject: 'modifier', id: 'conditional', operation: 'INCLUDE', reason: 'GM ruling' },
      ],
    });
    expect(
      resolveCheck({ baseValue: 50, finalSuper: 0, context: ctx }, d100(28)).result.target,
    ).toBe(60);
  });

  test('characteristic largest-only stacking does not apply to check Effects', () => {
    const effects = [
      effect('first', 10, {
        target: { kind: 'check' },
        stackingGroup: 'same',
        stackingRule: 'sum',
      }),
      effect('second', 20, {
        target: { kind: 'check' },
        stackingGroup: 'same',
        stackingRule: 'sum',
      }),
    ];
    expect(
      resolveCheck({ baseValue: 50, finalSuper: 0, context: context({ effects }) }, d100(28)).result
        .target,
    ).toBe(80);
  });

  test('unrelated Effects are not check modifiers', () => {
    expect(
      resolveCheck(
        { baseValue: 50, finalSuper: 0, context: context({ effects: [effect('stat', 20)] }) },
        d100(28),
      ).result.target,
    ).toBe(50);
  });

  test('duplicate and unknown overrides are rejected before consuming dice', () => {
    const unknown = context({
      overrides: [{ subject: 'modifier', id: 'missing', operation: 'EXCLUDE', reason: 'test' }],
    });
    expect(() =>
      resolveCheck({ baseValue: 50, finalSuper: 0, context: unknown }, d100(28)),
    ).toThrow('Unknown override');
    const duplicate = context({
      modifiers: [modifier('one', 10)],
      overrides: [
        { subject: 'modifier', id: 'one', operation: 'INCLUDE', reason: 'one' },
        { subject: 'modifier', id: 'one', operation: 'EXCLUDE', reason: 'two' },
      ],
    });
    expect(() =>
      resolveCheck({ baseValue: 50, finalSuper: 0, context: duplicate }, d100(28)),
    ).toThrow('duplicate');
  });

  test.each([NaN, Infinity, 1.5, -1])('invalid base %s is rejected', (baseValue) => {
    expect(() =>
      resolveCheck({ baseValue, finalSuper: 0, context: context() }, d100(28)),
    ).toThrow();
  });
});
