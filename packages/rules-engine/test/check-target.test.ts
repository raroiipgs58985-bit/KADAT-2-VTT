import { describe, expect, test } from 'vitest';
import { checkTarget, createSequenceDice, resolveCheck } from '../src/index.js';
import { context, deepFreeze, modifier } from './fixtures.js';

// ADR 0007: the attack preview reads the target number through `checkTarget`; it must equal the
// target of `resolveCheck` for the same request, never roll and never change the request.
describe('checkTarget — target number without a roll', () => {
  const cases = [
    ['no modifiers', context(), 40],
    ['mixed sources', context({ modifiers: [modifier('a', 20), modifier('b', -30)] }), 45],
    ['cap +60', context({ modifiers: [modifier('big', 90)] }), 30],
    ['cap −60', context({ modifiers: [modifier('small', -95)] }), 70],
    [
      'failed condition excluded',
      context({
        modifiers: [
          modifier('on', 10),
          { ...modifier('off', -50), condition: { requiresTags: ['absent'] } },
        ],
      }),
      50,
    ],
  ] as const;

  test.each(cases)('%s: same target and modifiers as resolveCheck', (_name, ctx, baseValue) => {
    const request = deepFreeze({ baseValue, finalSuper: 2, context: ctx });
    const preview = checkTarget(request);
    const resolved = resolveCheck(request, createSequenceDice([{ sides: 100, value: 50 }])).result;
    expect(preview.target).toBe(resolved.target);
    expect(preview.finalModifier).toBe(resolved.finalModifier);
    expect(preview.rawModifierSum).toBe(resolved.rawModifierSum);
    expect(preview.modifiers).toEqual(resolved.modifiers);
  });

  test('uses no dice and leaves the request unchanged', () => {
    const request = deepFreeze({
      baseValue: 40,
      finalSuper: 0,
      context: context({ modifiers: [modifier('x', 10)] }),
    });
    const before = JSON.stringify(request);
    expect(checkTarget(request).target).toBe(50);
    expect(checkTarget(request).target).toBe(50);
    expect(JSON.stringify(request)).toBe(before);
  });
});
