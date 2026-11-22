import { describe, expect, test } from 'vitest';
import { halveCharacteristic, resolveCharacteristic, resolveEffects } from '../src/index.js';
import { actor, context, deepFreeze, effect } from './fixtures.js';

describe('characteristic resolution', () => {
  test.each([
    [5, 3],
    [7, 4],
    [6, 3],
    [0, 0],
  ])('halving %i rounds upward to %i', (value, expected) => {
    expect(halveCharacteristic(value)).toBe(expected);
  });

  test('same-kind effects select the largest across stages, preserve all sources, and keep base unchanged', () => {
    const state = deepFreeze({ baseValue: 50, baseSuper: 4 });
    const ctx = deepFreeze(
      context({
        effects: [
          effect('permanent', 5, { stage: 'permanent', stackingGroup: 'same-kind' }),
          effect('implant', 10, { stage: 'implant', stackingGroup: 'same-kind' }),
          effect('equipment', 3, { stage: 'equipment' }),
          effect('temporary', 2),
        ],
      }),
    );
    const { result, log } = resolveCharacteristic('СЛ', state, ctx);
    expect(result).toMatchObject({ finalValue: 65, finalSuper: 4, normalBonus: 6, finalBonus: 10 });
    expect(log.modifiers).toHaveLength(4);
    expect(log.modifiers.find((entry) => entry.id === 'permanent')).toMatchObject({
      included: false,
      reason: 'stacking',
    });
    expect(state).toEqual({ baseValue: 50, baseSuper: 4 });
    expect(ctx.effects[0]?.definition.value).toBe(5);
  });

  test('base → permanent → implants → equipment → temporary', () => {
    const ctx = context({
      effects: [
        effect('temporary', 2, { stage: 'temporary' }),
        effect('equipment', 3, { stage: 'equipment' }),
        effect('implant', 10, { stage: 'implant' }),
        effect('permanent', 60, { stage: 'permanent', operation: 'set' }),
      ],
    });
    expect(
      resolveCharacteristic('СЛ', { baseValue: 50, baseSuper: 0 }, ctx).result.finalValue,
    ).toBe(75);
  });

  test('Super effects use their own target and highest same-kind modifier', () => {
    const target = {
      kind: 'characteristic' as const,
      characteristic: 'СЛ' as const,
      field: 'super' as const,
    };
    const ctx = context({
      effects: [
        effect('super-a', 2, { target, stackingGroup: 'super' }),
        effect('super-b', 4, { target, stackingGroup: 'super' }),
        effect('value', 60),
      ],
    });
    expect(resolveCharacteristic('СЛ', { baseValue: 50, baseSuper: 1 }, ctx).result).toMatchObject({
      finalValue: 110,
      finalSuper: 5,
      normalBonus: 11,
      finalBonus: 16,
      superSuccessDegrees: 2, // «+1 ст. за каждую 2-ку»: Сверх 5 → 2 (author ruling 18)
    });
  });

  test('other characteristics and other actors do not leak into the result', () => {
    const other = { ...effect('other-actor', 90), targetActor: { actorId: 'other' } };
    const ctx = context({
      effects: [
        other,
        effect('other-stat', 90, {
          target: { kind: 'characteristic', characteristic: 'ВН', field: 'value' },
        }),
      ],
    });
    expect(
      resolveCharacteristic('СЛ', { baseValue: 50, baseSuper: 0 }, ctx).result.finalValue,
    ).toBe(50);
  });

  test('effect GM overrides are local and logged', () => {
    const original = deepFreeze(effect('one', 10));
    const ctx = context({
      effects: [original],
      overrides: [
        { subject: 'effect', id: 'one', operation: 'MODIFY', value: 20, reason: 'GM decision' },
      ],
    });
    const result = resolveCharacteristic('СЛ', { baseValue: 50, baseSuper: 0 }, ctx);
    expect(result.result.finalValue).toBe(70);
    expect(result.log.modifiers[0]).toMatchObject({
      originalValue: 10,
      value: 20,
      override: { operation: 'MODIFY' },
    });
    expect(original.definition.value).toBe(10);
  });

  test('context and round-duration applicability are evaluated independently of stacking', () => {
    const timed = {
      ...effect('timed', 10),
      duration: {
        unit: 'round' as const,
        appliedRound: 2,
        durationRounds: 2,
        expiresAfterRound: 3,
      },
    };
    const tagged = effect('tagged', 5, { condition: { requiresTags: ['melee'] } });
    expect(
      resolveEffects(context({ effects: [timed, tagged], roundNumber: 2, tags: ['melee'] })).map(
        (entry) => entry.included,
      ),
    ).toEqual([true, true]);
    expect(
      resolveEffects(context({ effects: [timed, tagged], roundNumber: 4 })).map(
        (entry) => entry.included,
      ),
    ).toEqual([false, false]);
    expect(() => resolveEffects(context({ effects: [timed] }))).toThrow('requires a context round');
  });

  test('invalid base/Super and conflicting same-kind operations are rejected', () => {
    expect(() => resolveCharacteristic('СЛ', { baseValue: -1, baseSuper: 0 }, context())).toThrow();
    expect(() =>
      resolveCharacteristic('СЛ', { baseValue: 50, baseSuper: -1 }, context()),
    ).toThrow();
    const ctx = context({
      effects: [
        effect('one', 10, { stackingGroup: 'same' }),
        effect('two', 20, { stackingGroup: 'same', operation: 'set' }),
      ],
    });
    expect(() => resolveCharacteristic('СЛ', { baseValue: 50, baseSuper: 0 }, ctx)).toThrow(
      'conflicting operations',
    );
  });

  test('unknown override, invalid duration and duplicate IDs fail instead of guessing', () => {
    expect(() =>
      resolveEffects(context({ effects: [effect('same', 1), effect('same', 2)] })),
    ).toThrow('duplicate');
    const invalid = {
      ...effect('one', 1),
      duration: {
        unit: 'round' as const,
        appliedRound: 2,
        durationRounds: 2,
        expiresAfterRound: 4,
      },
    };
    expect(() => resolveEffects(context({ actor, effects: [invalid], roundNumber: 2 }))).toThrow(
      'Inconsistent',
    );
  });
});
