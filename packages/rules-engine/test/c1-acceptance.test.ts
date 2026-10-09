import { describe, it, expect } from 'vitest';
import { createSequenceDice } from '../src/index.js';
import {
  armor,
  context,
  cover,
  deepFreeze,
  field,
  input,
  provenance,
  request,
  resolve,
  source,
  state,
} from './c1-fixtures.js';

describe('C-1 deterministic acceptance', () => {
  it('AC-PD01 ordinary armor/BB/bVN', () => {
    const r = resolve().result;
    expect(r.rawDamage).toBe(18);
    expect(r.effectiveArmor).toBe(4);
    expect(r.bVN).toBe(4);
    expect(r.finalDamage).toBe(10);
  });
  it('AC-PD02 excess BB never becomes bonus damage', () => {
    const r = resolve(
      request({
        input: input({
          profile: { source, expression: { count: 1, sides: 10, modifier: 0 } },
          penetration: { source, value: 9 },
        }),
        state: state({ sources: { armor: armor('armor', 6) } }),
      }),
    ).result;
    expect(r.effectiveArmor).toBe(0);
    expect(r.finalDamage).toBe(6);
  });
  it('AC-PD03 final damage floor', () => {
    const r = resolve(
      request({
        input: input({
          profile: { source, expression: { count: 1, sides: 10, modifier: 0 } },
          penetration: { source, value: 2 },
        }),
      }),
      7,
    ).result;
    expect(r.calculatedDamage).toBe(-5);
    expect(r.finalDamage).toBe(0);
    expect(r.noDamage).toBe(true);
  });
  it('AC-PD04 individual dice/flat modifier retained', () => {
    const r = resolve(
      request({
        input: input({ profile: { source, expression: { count: 2, sides: 10, modifier: 3 } } }),
      }),
      8,
      6,
    ).result;
    expect(r.damageRoll.rolls.map((d) => d.value)).toEqual([8, 6]);
    expect(r.damageRoll.diceTotal).toBe(14);
    expect(r.damageRoll.modifier).toBe(3);
    expect(r.rawDamage).toBe(17);
    expect(r.critical).toBe(false);
  });
  it('AC-PD05 one maximum is one unresolved consequence marker', () => {
    const r = resolve(
      request({
        input: input({ profile: { source, expression: { count: 2, sides: 10, modifier: 0 } } }),
      }),
      10,
      4,
    ).result;
    expect(r.rawDamage).toBe(14);
    expect(r.critical).toBe(true);
    expect(r.criticalConsequenceDiceCount).toBe(1);
    expect(r.criticalConsequence.maximumDiceIndices).toEqual([0]);
  });
  it('AC-PD06 two maxima still mean exactly one future consequence die', () => {
    const r = resolve(
      request({
        input: input({ profile: { source, expression: { count: 2, sides: 10, modifier: 0 } } }),
      }),
      10,
      10,
    ).result;
    expect(r.rawDamage).toBe(20);
    expect(r.criticalConsequenceDiceCount).toBe(1);
    expect(r.criticalConsequence.maximumDiceIndices).toEqual([0, 1]);
    expect(r.criticalConsequence.unresolved).toBe(true);
  });
  it('AC-PD07 d5 maximum triggers critical', async () => {
    const { resolveProtectionDamage } = await import('../src/index.js');
    const r = resolveProtectionDamage(
      request({
        input: input({ profile: { source, expression: { count: 1, sides: 5, modifier: 0 } } }),
      }),
      createSequenceDice([{ sides: 5, value: 5 }]),
    ).result;
    expect(r.critical).toBe(true);
    expect(r.criticalConsequenceDiceCount).toBe(1);
  });
  it('AC-PD08 CANCEL_HIT stops before armor and VN', () => {
    const runtime = state({
      fields: [field({ type: 'CANCEL_HIT' })],
      sources: new Proxy(
        {},
        {
          ownKeys() {
            throw new Error('Armor stage must not run');
          },
        },
      ),
    });
    const r = resolve(request({ state: runtime, endurance: { baseValue: -1, baseSuper: -1 } }));
    expect(r.result.status).toBe('CANCELLED');
    expect(r.result.finalDamage).toBe(0);
    expect(r.result.protection).toBeNull();
    expect(r.result.bVN).toBeNull();
    expect(r.state.fields[0]!.remainingUses).toBe(2);
  });
  it('AC-PD09 field reduction precedes armor and bVN', () => {
    const r = resolve(
      request({
        input: input({
          profile: { source, expression: { count: 2, sides: 10, modifier: 0 } },
          penetration: { source, value: 3 },
        }),
        state: state({
          sources: { armor: armor('armor', 8) },
          fields: [field({ type: 'REDUCE_DAMAGE', reduction: 5 })],
        }),
      }),
      10,
      10,
    ).result;
    expect(r.field.fieldAdjustedDamage).toBe(15);
    expect(r.effectiveArmor).toBe(5);
    expect(r.finalDamage).toBe(6);
  });
  it('AC-PD10 explicit BB-immune protection fixture', () => {
    const r = resolve(
      request({
        input: input({
          profile: { source, expression: { count: 1, sides: 10, modifier: 5 } },
          penetration: { source, value: 10 },
        }),
        state: state({
          sources: { immune: armor('immune', 6, { penetrationMode: 'IGNORE_WEAPON_BB' }) },
        }),
      }),
    ).result;
    expect(r.effectiveArmor).toBe(6);
    expect(r.finalDamage).toBe(5);
  });
  it('AC-PD11 explicitly compatible layers retain individual sources', () => {
    const r = resolve(
      request({
        state: state({
          sources: {
            a: armor('a', 3, { compatibleWithTemplateIds: ['template:b'] }),
            b: armor('b', 5, { compatibleWithTemplateIds: ['template:a'] }),
          },
        }),
      }),
    ).result;
    expect(r.status).toBe('RESOLVED');
    expect(r.protection!.armorOB).toBe(8);
    expect(r.protection!.selectedIds).toEqual(['a', 'b']);
  });
  it('AC-PD12 ambiguous layers do not stack/commit resources', () => {
    const runtime = deepFreeze(
      state({
        sources: { a: armor('a', 3), b: armor('b', 5) },
        fields: [field({ type: 'PASS_THROUGH' })],
      }),
    );
    const r = resolve(request({ state: runtime }));
    expect(r.result.status).toBe('PENDING_PROTECTION');
    expect(r.result.finalDamage).toBeNull();
    expect(r.result.protection!.incompatiblePairs).toEqual([['a', 'b']]);
    expect(r.result.protection!.armorOB).toBe(0);
    expect(r.result.protection!.selectedIds).toEqual([]);
    expect(r.state).toBe(runtime);
    expect(r.result.mutations).toEqual([]);
  });
  it('AC-PD13 one-resolution GM protection exclusion with provenance', () => {
    const runtime = deepFreeze(
      state({ sources: { armor: armor('armor', 8) }, covers: { cover: cover() } }),
    );
    const ctx = context({
      overrides: [
        {
          subject: 'modifier',
          id: 'protection:cover',
          operation: 'EXCLUDE',
          origin: 'gm',
          reason: 'Special round ignores this cover',
        },
      ],
    });
    const r = resolve(request({ state: runtime, context: ctx }));
    expect(r.result.protection!.selectedIds).toEqual(['armor']);
    expect(r.result.protection!.contributions[1]!.trace.override).toEqual(ctx.overrides[0]);
    expect(r.logs.at(-1)!.overrides).toEqual(ctx.overrides);
    expect(runtime.covers.cover!.currentOB).toBe(6);
  });
  it('AC-PD14 location filtering keeps excluded source provenance', () => {
    const r = resolve(request({ input: input({ location: 'Right Arm' }) })).result;
    expect(r.protection!.armorOB).toBe(0);
    expect(r.protection!.contributions[0]!.reason).toBe('location');
    expect(r.protection!.contributions[0]!.candidate.definition.source).toEqual(source);
  });
  it('AC-PD15 Wide Sweep 9/2 rounds UP before protection', () => {
    const r = resolve(
      request({
        input: input({
          profile: { source, expression: { count: 1, sides: 10, modifier: 0 } },
          transformations: [
            { id: 'wide-sweep', type: 'multiply', value: 0.5, rounding: 'ceil', provenance },
          ],
        }),
        state: state({ sources: {} }),
        endurance: { baseValue: 0, baseSuper: 0 },
      }),
      9,
    ).result;
    expect(r.damageRoll.rawDamage).toBe(9);
    expect(r.rawDamage).toBe(5);
    expect(r.finalDamage).toBe(5);
    expect(r.transformations[0]!.after).toBe(5);
  });
  it('AC-PD16 templates/source/runtime immutable; only declared cover/field updates', () => {
    const c = cover();
    const runtime = deepFreeze(
      state({
        sources: {},
        covers: {
          cover: {
            ...c,
            definition: {
              ...c.definition,
              degradation: { type: 'EXPLICIT_OB_LOSS', value: 2, provenance },
            },
          },
        },
        fields: [field({ type: 'PASS_THROUGH' })],
      }),
    );
    const req = deepFreeze(request({ state: runtime })),
      before = JSON.stringify(req);
    const r = resolve(req);
    expect(JSON.stringify(req)).toBe(before);
    expect(r.state.covers.cover!.currentOB).toBe(4);
    expect(r.state.fields[0]!.remainingUses).toBe(2);
    expect(r.state.covers.cover!.definition).toBe(runtime.covers.cover!.definition);
    expect(r.result.mutations.map((m) => m.type)).toEqual([
      'cover-OB',
      'field-resource',
      'damage-hit-resolved',
    ]);
    expect(r.logs.at(-1)!.damageResolution).toBe(r.result);
  });
});
