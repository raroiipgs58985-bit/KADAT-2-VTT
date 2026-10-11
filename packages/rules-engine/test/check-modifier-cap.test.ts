import { describe, expect, test } from 'vitest';
import {
  createSequenceDice,
  resolveCharacteristic,
  resolveCheck,
  resolveEquipmentCheck,
  resolveSuppression,
} from '../src/index.js';
import { context, deepFreeze, effect, modifier } from './fixtures.js';
import { area, candidate, ctx, dState, equipment, rng } from './d-fixtures.js';

function check(checkContext = context(), baseValue = 40) {
  return resolveCheck(
    { baseValue, finalSuper: 0, context: checkContext },
    createSequenceDice([{ sides: 100, value: 28 }]),
  );
}

describe('S09 author-approved final signed modifier cap', () => {
  test.each([
    [60, 60],
    [-60, -60],
    [61, 60],
    [-61, -60],
    [90, 60],
    [-95, -60],
  ])('raw sum %i gives final modifier %i', (rawModifierSum, finalModifier) => {
    const { result, log } = check(context({ modifiers: [modifier('source', rawModifierSum)] }));
    expect(result).toMatchObject({ rawModifierSum, finalModifier, target: 40 + finalModifier });
    expect(log.checkModifiers).toEqual({ rawModifierSum, finalModifier });
    expect(result.modifiers[0]?.value).toBe(rawModifierSum);
  });

  test('mixed sources are summed before any cap, without separate sign or source caps', () => {
    const { result } = check(
      context({ modifiers: [modifier('bonus', 90), modifier('penalty', -50)] }),
    );
    expect(result).toMatchObject({ rawModifierSum: 40, finalModifier: 40, target: 80 });
  });

  test('canonical cancellation removes a source before the cap', () => {
    const { result } = check(
      context({
        modifiers: [modifier('cancelled', 90), modifier('remaining', -50)],
        overrides: [
          {
            subject: 'modifier',
            id: 'cancelled',
            operation: 'EXCLUDE',
            origin: 'canonical',
            reason: 'Explicit source interaction cancels this bonus',
          },
        ],
      }),
    );
    expect(result).toMatchObject({ rawModifierSum: -50, finalModifier: -50, target: -10 });
    expect(result.modifiers[0]?.included).toBe(false);
  });

  test('failed modifier conditions are excluded before the cap', () => {
    const { result } = check(
      context({
        modifiers: [
          modifier('active', 90),
          { ...modifier('conditional', -50), condition: { requiresTags: ['not-present'] } },
        ],
      }),
    );
    expect(result).toMatchObject({ rawModifierSum: 90, finalModifier: 60, target: 100 });
    expect(result.modifiers[1]).toMatchObject({ included: false, reason: 'context' });
  });

  test('expired check effects are excluded before the cap', () => {
    const expired = {
      ...effect('expired', -50, { target: { kind: 'check' } }),
      duration: {
        unit: 'round' as const,
        appliedRound: 1,
        durationRounds: 1,
        expiresAfterRound: 1,
      },
    };
    const { result } = check(
      context({ roundNumber: 2, modifiers: [modifier('active', 90)], effects: [expired] }),
    );
    expect(result).toMatchObject({ rawModifierSum: 90, finalModifier: 60 });
    expect(result.modifiers[1]).toMatchObject({ included: false, reason: 'duration' });
  });

  test('inactive equipment contributions are excluded before the cap', () => {
    const item = equipment([
      { kind: 'CHECK_MODIFIER', scope: 'suppression', value: 90 },
      { kind: 'CHECK_MODIFIER', scope: 'suppression', value: -50 },
    ]);
    const inactive = { ...item, effects: item.effects.map((e, i) => ({ ...e, active: i === 0 })) };
    const result = resolveEquipmentCheck(
      dState().combat,
      [inactive],
      'СВ',
      ctx(),
      rng(28),
      'suppression',
    );
    expect(result.check).toMatchObject({ rawModifierSum: 90, finalModifier: 60 });
    expect(result.collection.traces[1]).toMatchObject({ included: false, reason: 'inactive' });
  });

  test('explicit equipment stacking is resolved before summing and capping', () => {
    const item = equipment([
      { kind: 'CHECK_MODIFIER', scope: 'suppression', value: 50 },
      { kind: 'CHECK_MODIFIER', scope: 'suppression', value: 40 },
    ]);
    const stacked = {
      ...item,
      effects: item.effects.map((e) => ({
        ...e,
        stacking: { group: 'known-sensor-rule', rule: 'LARGEST' as const },
      })),
    };
    const result = resolveEquipmentCheck(
      dState().combat,
      [stacked],
      'СВ',
      { ...ctx(), modifiers: [modifier('environment', -50)] },
      rng(28),
      'suppression',
    );
    expect(result.check).toMatchObject({ rawModifierSum: 0, finalModifier: 0 });
    expect(result.collection.traces[1]).toMatchObject({ included: false, reason: 'stacking' });
  });

  test('GM numeric MODIFY runs before the cap (author mixed-source example)', () => {
    const { result } = check(
      context({
        modifiers: [
          modifier('aim', 30),
          modifier('equipment', 20),
          modifier('suppression', -50),
          modifier('environment', -40),
        ],
        overrides: [
          {
            subject: 'modifier',
            id: 'environment',
            operation: 'MODIFY',
            value: -20,
            origin: 'gm',
            reason: 'Author example: environment changed to -20',
          },
        ],
      }),
    );
    expect(result).toMatchObject({ rawModifierSum: -20, finalModifier: -20, target: 20 });
  });

  test('GM numeric MODIFY crossing the limit is capped after modification', () => {
    const { result } = check(
      context({
        modifiers: [modifier('bonus', 20)],
        overrides: [
          {
            subject: 'modifier',
            id: 'bonus',
            operation: 'MODIFY',
            value: 90,
            origin: 'gm',
            reason: 'Explicit numerical decision',
          },
        ],
      }),
    );
    expect(result).toMatchObject({ rawModifierSum: 90, finalModifier: 60 });
  });

  test('GM EXCLUDE runs before the cap', () => {
    const { result } = check(
      context({
        modifiers: [modifier('bonus', 90), modifier('penalty', -40)],
        overrides: [
          {
            subject: 'modifier',
            id: 'bonus',
            operation: 'EXCLUDE',
            origin: 'gm',
            reason: 'Bonus excluded for this check',
          },
        ],
      }),
    );
    expect(result).toMatchObject({ rawModifierSum: -40, finalModifier: -40, target: 0 });
  });

  test('GM INCLUDE runs before the cap', () => {
    const { result } = check(
      context({
        modifiers: [
          { ...modifier('conditional', 90), condition: { requiresTags: ['not-present'] } },
        ],
        overrides: [
          {
            subject: 'modifier',
            id: 'conditional',
            operation: 'INCLUDE',
            origin: 'gm',
            reason: 'Explicitly enabled for this check',
          },
        ],
      }),
    );
    expect(result).toMatchObject({ rawModifierSum: 90, finalModifier: 60 });
  });

  test('the target above 100 still determines ordinary success degrees', () => {
    const { result } = check(context({ modifiers: [modifier('bonus', 90)] }), 80);
    expect(result).toMatchObject({ target: 140, outcome: 'success', baseDegrees: 12 });
  });

  test('base and effective characteristics are not clamped by the modifier rule', () => {
    const c = context({ effects: [effect('strength', 40)], modifiers: [modifier('bonus', 90)] });
    const base = deepFreeze({ baseValue: 90, baseSuper: 4 });
    const characteristic = resolveCharacteristic('СЛ', base, c).result;
    const { result } = resolveCheck(
      { baseValue: characteristic.finalValue, finalSuper: characteristic.finalSuper, context: c },
      createSequenceDice([{ sides: 100, value: 28 }]),
    );
    expect(characteristic).toMatchObject({ baseValue: 90, finalValue: 130, finalSuper: 4 });
    expect(result).toMatchObject({
      baseValue: 130,
      rawModifierSum: 90,
      finalModifier: 60,
      target: 190,
    });
    expect(base).toEqual({ baseValue: 90, baseSuper: 4 });
  });

  test('Combat Log preserves all sources, original/GM values, sums, target and provenance', () => {
    const c = deepFreeze(
      context({
        modifiers: [modifier('aim', 40), modifier('environment', -40)],
        effects: [effect('equipment', 30, { target: { kind: 'check' } })],
        overrides: [
          {
            subject: 'modifier',
            id: 'environment',
            operation: 'MODIFY',
            value: 20,
            origin: 'gm',
            reason: 'GM adjustment recorded with the original source',
          },
        ],
      }),
    );
    const { result, log } = check(c);
    expect(log.checkModifiers).toEqual({ rawModifierSum: 90, finalModifier: 60 });
    expect(log.target).toBe(100);
    expect(log.modifiers).toEqual(result.modifiers);
    expect(log.modifiers.map((m) => m.source.id)).toEqual(['aim', 'environment', 'equipment']);
    expect(log.modifiers.map((m) => m.provenance)).toEqual([
      c.modifiers[0]?.provenance,
      c.modifiers[1]?.provenance,
      c.effects[0]?.provenance,
    ]);
    expect(log.modifiers[1]).toMatchObject({
      originalValue: -40,
      value: 20,
      override: c.overrides[0],
    });
    expect(log.overrides).toEqual(c.overrides);
    expect(c.modifiers[1]?.value).toBe(-40);
  });

  test('area suppression uses the shared cap while retaining its raw source penalty', () => {
    const result = resolveSuppression(dState(80), area(13), [candidate()], rng(50));
    expect(result.targets[0]).toMatchObject({
      modifier: -65,
      check: { rawModifierSum: -65, finalModifier: -60, target: 20, failureDegrees: 4 },
    });
    expect(result.state.suppressed[0]?.durationRounds).toBe(4);
    expect(result.logs.find((l) => l.resolver === 'check')?.checkModifiers).toEqual({
      rawModifierSum: -65,
      finalModifier: -60,
    });
  });
});
