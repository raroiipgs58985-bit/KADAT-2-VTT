import { describe, it, expect, vi } from 'vitest';
import type { DamageInput, FieldResponse, ResolutionOverride } from '@kadat/contracts';
import { resolveProtectionDamage, damageInputFromPrimitiveIntent } from '../src/index.js';
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
import { effect } from './fixtures.js';

function change(overrides: readonly ResolutionOverride[]) {
  return context({ overrides });
}
function gm(id: string, operation: 'INCLUDE' | 'EXCLUDE'): ResolutionOverride {
  return {
    id,
    subject: 'modifier',
    operation,
    origin: 'gm',
    reason: 'One-resolution protection decision',
  };
}

describe('field polymorphism and transaction safety', () => {
  it('pass-through preserves incoming damage', () => {
    const r = resolve(request({ state: state({ fields: [field({ type: 'PASS_THROUGH' })] }) }));
    expect(r.result.field.fieldAdjustedDamage).toBe(18);
    expect(r.result.finalDamage).toBe(10);
  });
  it.each(['WEAPON_BB', 'IGNORE_WEAPON_BB'] as const)(
    'armor-like field declares %s interaction',
    (penetrationMode) => {
      const r = resolve(
        request({
          state: state({
            sources: {},
            fields: [
              field({
                type: 'ARMOR_LIKE_PROTECTION',
                protection: armor('field-armor', 8, { kind: 'field', penetrationMode }).definition,
              }),
            ],
          }),
        }),
      ).result;
      expect(r.effectiveArmor).toBe(penetrationMode === 'WEAPON_BB' ? 2 : 8);
      expect(r.protection!.contributions[0]!.candidate.definition.kind).toBe('field');
    },
  );
  it('redirect returns typed pending intent without placement/resources', () => {
    const runtime = deepFreeze(
      state({
        fields: [
          field({
            type: 'REDIRECT_OR_RELOCATE',
            intent: { kind: 'explicit-relocation', source, provenance },
          }),
        ],
      }),
    );
    const r = resolve(request({ state: runtime }));
    expect(r.result.status).toBe('PENDING_FIELD');
    expect(r.result.field.entries[0]!.response).toMatchObject({
      type: 'REDIRECT_OR_RELOCATE',
      intent: { kind: 'explicit-relocation' },
    });
    expect(r.result.protection).toBeNull();
    expect(r.state).toBe(runtime);
    expect(r.result.mutations).toEqual([]);
  });
  it.each(['PASS_THROUGH', 'UNRESOLVED'] as const)(
    'typed custom field %s does not invent catalog behavior',
    (continuation) => {
      const runtime = state({
        fields: [
          field({
            type: 'CUSTOM',
            effect: { kind: 'fixture-custom', payload: { declared: true }, provenance },
            continuation,
          }),
        ],
      });
      const r = resolve(request({ state: runtime }));
      expect(r.result.status).toBe(continuation === 'PASS_THROUGH' ? 'RESOLVED' : 'PENDING_FIELD');
      if (continuation === 'UNRESOLVED') expect(r.state).toBe(runtime);
    },
  );
  it('cancellation stops later fields and cover degradation', () => {
    const c = cover();
    const runtime = state({
      covers: {
        cover: {
          ...c,
          definition: {
            ...c.definition,
            degradation: { type: 'EXPLICIT_OB_LOSS', value: 2, provenance },
          },
        },
      },
      fields: [
        field({ type: 'CANCEL_HIT' }, 'first'),
        field({ type: 'REDUCE_DAMAGE', reduction: 999 }, 'later'),
      ],
    });
    const r = resolve(request({ state: deepFreeze(runtime) }));
    expect(r.result.field.entries).toHaveLength(1);
    expect(r.state.fields[1]!.remainingUses).toBe(3);
    expect(r.state.covers.cover).toBe(runtime.covers.cover);
    expect(r.result.coverIntents).toEqual([]);
  });
  it('unavailable field resource rejects atomically', () => {
    const runtime = deepFreeze(
        state({ fields: [{ ...field({ type: 'PASS_THROUGH' }), remainingUses: 0 }] }),
      ),
      before = JSON.stringify(runtime);
    expect(() => resolve(request({ state: runtime }))).toThrow(/Insufficient field/);
    expect(JSON.stringify(runtime)).toBe(before);
  });
  it('malformed later physical input cannot commit field use', () => {
    const runtime = deepFreeze(
        state({
          sources: { bad: armor('bad', -2) },
          fields: [field({ type: 'REDUCE_DAMAGE', reduction: 1 })],
        }),
      ),
      before = JSON.stringify(runtime);
    expect(() => resolve(request({ state: runtime }))).toThrow(/OB/);
    expect(JSON.stringify(runtime)).toBe(before);
  });
  it('GM excludes field for one resolution', () => {
    const runtime = deepFreeze(state({ fields: [field({ type: 'CANCEL_HIT' })] }));
    const r = resolve(request({ state: runtime, context: change([gm('field:field', 'EXCLUDE')]) }));
    expect(r.result.status).toBe('RESOLVED');
    expect(r.state.fields[0]!.remainingUses).toBe(3);
    expect(r.logs.at(-1)!.overrides[0]!.operation).toBe('EXCLUDE');
  });
  it('GM modifies field reduction without changing definition', () => {
    const runtime = deepFreeze(state({ fields: [field({ type: 'REDUCE_DAMAGE', reduction: 5 })] }));
    const r = resolve(
      request({
        state: runtime,
        context: change([
          { ...gm('field:reduction:field', 'INCLUDE'), operation: 'MODIFY', value: 2 },
        ]),
      }),
    );
    expect(r.result.field.fieldAdjustedDamage).toBe(16);
    expect(runtime.fields[0]!.definition.response).toMatchObject({ reduction: 5 });
    expect(r.result.field.entries[0]!.numericTrace!.override!.operation).toBe('MODIFY');
  });
  it('invalid final VN cannot commit field or cover mutation', () => {
    const runtime = deepFreeze(
      state({ sources: {}, covers: { cover: cover() }, fields: [field({ type: 'PASS_THROUGH' })] }),
    );
    expect(() =>
      resolve(request({ state: runtime, endurance: { baseValue: -1, baseSuper: 0 } })),
    ).toThrow(/characteristic/);
    expect(runtime.fields[0]!.remainingUses).toBe(3);
    expect(runtime.covers.cover!.currentOB).toBe(6);
  });
});

describe('source selection / overrides / cover / special locations', () => {
  it('GM selects ambiguous pair explicitly; persistent compatibility unchanged', () => {
    const runtime = deepFreeze(state({ sources: { a: armor('a', 3), b: armor('b', 5) } }));
    const r = resolve(
      request({
        state: runtime,
        context: change([gm('protection:a', 'INCLUDE'), gm('protection:b', 'INCLUDE')]),
      }),
    );
    expect(r.result.status).toBe('RESOLVED');
    expect(r.result.protection!.armorOB).toBe(8);
    expect(runtime.sources.a!.definition.compatibleWithTemplateIds).toEqual([]);
  });
  it('one-way compatibility does not imply mutual stacking', () => {
    const r = resolve(
      request({
        state: state({
          sources: {
            a: armor('a', 3, { compatibleWithTemplateIds: ['template:b'] }),
            b: armor('b', 5),
          },
        }),
      }),
    );
    expect(r.result.status).toBe('PENDING_PROTECTION');
  });
  it('GM MODIFY one source remains an unresolved incompatible pair', () => {
    const r = resolve(
      request({
        state: state({ sources: { a: armor('a', 3), b: armor('b', 5) } }),
        context: change([{ ...gm('protection:a', 'INCLUDE'), operation: 'MODIFY', value: 4 }]),
      }),
    );
    expect(r.result.status).toBe('PENDING_PROTECTION');
    expect(r.state.resolvedHitIds).toEqual([]);
  });
  it('GM numeric contribution is one-resolution only', () => {
    const runtime = deepFreeze(state());
    const r = resolve(
      request({
        state: runtime,
        context: change([{ ...gm('protection:armor', 'INCLUDE'), operation: 'MODIFY', value: 4 }]),
      }),
    );
    expect(r.result.protection!.armorOB).toBe(4);
    expect(runtime.sources.armor!.definition.ob).toBe(10);
    expect(resolve(request({ state: runtime })).result.protection!.armorOB).toBe(10);
  });
  it('GM includes a discovered inactive source', () => {
    const a = armor(),
      runtime = state({ sources: { armor: { ...a, active: false } } });
    const r = resolve(
      request({ state: runtime, context: change([gm('protection:armor', 'INCLUDE')]) }),
    );
    expect(r.result.protection!.armorOB).toBe(10);
    expect(runtime.sources.armor!.active).toBe(false);
  });
  it('resuming pending uses validated original roll, commits field only once', () => {
    const runtime = deepFreeze(
      state({
        sources: { a: armor('a', 3), b: armor('b', 5) },
        fields: [field({ type: 'PASS_THROUGH' })],
      }),
    );
    const first = resolve(request({ state: runtime }), 8);
    const rng = {
      roll: vi.fn(() => {
        throw new Error('Must reuse original dice');
      }),
    };
    const second = resolveProtectionDamage(
      request({
        state: first.state,
        preRolled: first.result.damageRoll,
        context: change([gm('protection:b', 'EXCLUDE')]),
      }),
      rng,
    );
    expect(second.result.status).toBe('RESOLVED');
    expect(second.result.damageRoll).toBe(first.result.damageRoll);
    expect(second.state.fields[0]!.remainingUses).toBe(2);
    expect(rng.roll).not.toHaveBeenCalled();
  });
  it('cover uses current runtime OB and covered zones', () => {
    const c = cover(),
      runtime = state({
        sources: {},
        covers: { cover: { ...c, currentOB: 3, coveredZones: ['Right Arm'] } },
      });
    const r = resolve(request({ state: runtime, input: input({ location: 'Right Arm' }) }));
    expect(r.result.protection!.armorOB).toBe(3);
    expect(r.result.coverIntents[0]).toMatchObject({
      type: 'CoverDegradationIntent',
      location: 'Right Arm',
      incomingDamage: 18,
      damageTags: ['kinetic'],
    });
    expect(c.definition.ob).toBe(6);
    expect(r.state.covers.cover!.currentOB).toBe(3);
  });
  it('uncovered location emits no cover degradation intent', () => {
    const r = resolve(
      request({
        input: input({ location: 'Left Leg' }),
        state: state({ sources: {}, covers: { cover: cover() } }),
      }),
    );
    expect(r.result.protection!.armorOB).toBe(0);
    expect(r.result.coverIntents).toEqual([]);
  });
  it('explicit cover degradation floors OB at zero, not template', () => {
    const c = cover();
    const r = resolve(
      request({
        state: state({
          sources: {},
          covers: {
            cover: {
              ...c,
              definition: {
                ...c.definition,
                degradation: { type: 'EXPLICIT_OB_LOSS', value: 20, provenance },
              },
            },
          },
        }),
      }),
    );
    expect(r.state.covers.cover!.currentOB).toBe(0);
    expect(r.state.covers.cover!.definition.ob).toBe(6);
  });
  it('cover-ignore effect uses accepted ResolutionContext, leaves template intact', () => {
    const e = {
      ...effect('ignore-cover', 0, {
        target: { kind: 'combat-modifier', key: 'protection:cover' },
        operation: 'set',
      }),
      targetActor: { actorId: 'B' },
    };
    const runtime = deepFreeze(state({ covers: { cover: cover() } }));
    const r = resolve(request({ state: runtime, context: context({ effects: [e] }) }));
    expect(r.result.status).toBe('RESOLVED');
    expect(r.result.protection!.selectedIds).toEqual(['armor']);
    expect(r.result.coverIntents).toEqual([]);
    expect(r.logs.at(-1)!.modifiers.some((t) => t.id === 'ignore-cover' && t.included)).toBe(true);
    expect(runtime.covers.cover!.definition.ob).toBe(6);
  });
  it('negative protection effect is a modifier, not negative canonical OB', () => {
    const e = {
      ...effect('reduce-armor', -3, {
        target: { kind: 'combat-modifier', key: 'protection:armor' },
      }),
      targetActor: { actorId: 'B' },
    };
    const r = resolve(request({ context: context({ effects: [e] }) }));
    expect(r.result.protection!.armorOB).toBe(7);
  });
  it.each(['Left Arm', 'Right Arm', 'Left Leg', 'Right Leg'] as const)(
    'coarse source zones expand for %s without rewriting source',
    (location) => {
      const a = deepFreeze(armor('a', 4, { zones: ['Arms', 'Legs'] }));
      const r = resolve(request({ input: input({ location }), state: state({ sources: { a } }) }));
      expect(r.result.protection!.armorOB).toBe(4);
      expect(a.definition.zones).toEqual(['Arms', 'Legs']);
    },
  );
  it('normal BB applied once to compatible normal bundle; immune OB remains', () => {
    const a = armor('a', 3, { compatibleWithTemplateIds: ['template:b', 'template:c'] }),
      b = armor('b', 5, { compatibleWithTemplateIds: ['template:a', 'template:c'] }),
      c = armor('c', 4, {
        penetrationMode: 'IGNORE_WEAPON_BB',
        compatibleWithTemplateIds: ['template:a', 'template:b'],
      });
    const r = resolve(request({ state: state({ sources: { a, b, c } }) }));
    expect(r.result.protection!.armorOB).toBe(12);
    expect(r.result.effectiveArmor).toBe(6);
  });
  it.each(['Eyes', 'Armor Joints'] as const)(
    'unknown %s adjustment is pending, not ordinary OB',
    (location) => {
      const runtime = deepFreeze(
        state({
          sources: {
            a: armor('a', 10, {
              zones: [location],
              specialLocations: {
                [location]: {
                  type: 'UNRESOLVED',
                  rule: source,
                  reason: 'Canonical catalog details not supplied',
                },
              },
            }),
          },
        }),
      );
      const r = resolve(request({ input: input({ location }), state: runtime }));
      expect(r.result.status).toBe('PENDING_PROTECTION');
      expect(r.result.protection!.unresolvedAdjustments[0]!.sourceId).toBe('a');
      expect(r.result.finalDamage).toBeNull();
      expect(r.state).toBe(runtime);
    },
  );
  it('explicit eye OB is used, with source provenance', () => {
    const r = resolve(
      request({
        input: input({ location: 'Eyes' }),
        state: state({
          sources: {
            a: armor('a', 10, {
              zones: ['Eyes'],
              specialLocations: { Eyes: { type: 'EXPLICIT_OB', ob: 2, provenance } },
            }),
          },
        }),
      }),
    );
    expect(r.result.protection!.armorOB).toBe(2);
    expect(r.result.protection!.contributions[0]!.candidate.specialAdjustment).toMatchObject({
      provenance,
    });
  });
  it('GM supplies unknown joint value for one resolution', () => {
    const a = armor('a', 10, {
      zones: ['Armor Joints'],
      specialLocations: {
        'Armor Joints': { type: 'UNRESOLVED', rule: source, reason: 'Awaiting catalog' },
      },
    });
    const r = resolve(
      request({
        input: input({ location: 'Armor Joints' }),
        state: state({ sources: { a } }),
        context: change([{ ...gm('protection:a', 'INCLUDE'), operation: 'MODIFY', value: 3 }]),
      }),
    );
    expect(r.result.status).toBe('RESOLVED');
    expect(r.result.protection!.armorOB).toBe(3);
    expect(a.definition.specialLocations!['Armor Joints']!.type).toBe('UNRESOLVED');
  });
});

describe('negative deterministic damage validation', () => {
  it.each([0, -1, 1.5, NaN])('invalid dice count %s', (count) => {
    const req = deepFreeze(
      request({
        input: input({ profile: { source, expression: { count, sides: 10, modifier: 0 } } }),
      }),
    );
    expect(() => resolve(req)).toThrow();
  });
  it('unsupported damage d6', () => {
    expect(() =>
      resolve(
        request({
          input: input({ profile: { source, expression: { count: 1, sides: 6, modifier: 0 } } }),
        }),
      ),
    ).toThrow(/d5\/d10/);
  });
  it.each([0, 11, 1.5])('injected invalid d10 value %s', (value) => {
    expect(() => resolveProtectionDamage(request(), { roll: () => value })).toThrow();
  });
  it('negative BB fails without resource mutation', () => {
    const runtime = deepFreeze(state({ fields: [field({ type: 'PASS_THROUGH' })] }));
    expect(() =>
      resolve(request({ state: runtime, input: input({ penetration: { source, value: -1 } }) })),
    ).toThrow(/BB/);
    expect(runtime.fields[0]!.remainingUses).toBe(3);
  });
  it('negative canonical OB is invalid', () => {
    expect(() => resolve(request({ state: state({ sources: { a: armor('a', -1) } }) }))).toThrow(
      /OB/,
    );
  });
  it('missing/unknown hit location', () => {
    expect(() =>
      resolve(request({ input: input({ location: '' as DamageInput['location'] }) })),
    ).toThrow(/location/);
  });
  it('no global RNG is used; dice source consumed only for damage', () => {
    const implicit = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Implicit RNG forbidden');
    });
    try {
      const rng = { roll: vi.fn(() => 8) };
      const r = resolveProtectionDamage(request(), rng);
      expect(r.result.damageRoll.rolls[0]!.value).toBe(8);
      expect(rng.roll).toHaveBeenCalledExactlyOnceWith(10);
      expect(implicit).not.toHaveBeenCalled();
    } finally {
      implicit.mockRestore();
    }
  });
  it('replaying a completed hit is rejected with no second resource charge', () => {
    const first = resolve(request({ state: state({ fields: [field({ type: 'PASS_THROUGH' })] }) }));
    const runtime = deepFreeze(first.state);
    expect(() => resolve(request({ state: runtime }))).toThrow(/already resolved/);
    expect(runtime.fields[0]!.remainingUses).toBe(2);
  });
  it('tampered critical marker on resumed roll is rejected', () => {
    const first = resolve();
    expect(() =>
      resolve(
        request({
          preRolled: { ...first.result.damageRoll, criticalTriggerCountForConsequence: 0 },
        }),
      ),
    ).toThrow(/Inconsistent/);
  });
  it('tampered raw damage on resumed roll is rejected', () => {
    const first = resolve();
    expect(() =>
      resolve(request({ preRolled: { ...first.result.damageRoll, rawDamage: 999 } })),
    ).toThrow(/Inconsistent/);
  });
  it('negative resolved GM OB is not a valid replacement', () => {
    expect(() =>
      resolve(
        request({
          context: change([
            { ...gm('protection:armor', 'INCLUDE'), operation: 'MODIFY', value: -2 },
          ]),
        }),
      ),
    ).toThrow(/OB/);
  });
  it('remove-die cannot erase the final damage die', () => {
    expect(() =>
      resolve(
        request({
          input: input({
            transformations: [{ id: 'remove', type: 'remove-die', value: 1, provenance }],
          }),
        }),
      ),
    ).toThrow(/remaining damage dice/);
  });
  it('unapproved rounding for fractional damage cannot be guessed', () => {
    expect(() =>
      resolve(
        request({
          input: input({
            transformations: [{ id: 'half', type: 'multiply', value: 0.5, provenance }],
          }),
        }),
      ),
    ).toThrow(/rounding/);
  });
  it('StunDurationIntent cannot become body damage', () => {
    expect(() =>
      damageInputFromPrimitiveIntent(
        {
          type: 'StunDurationIntent',
          actor: { actorId: 'A' },
          target: { actorId: 'B' },
          source,
          provenance: [provenance],
          damage: input().profile,
          location: 'Torso',
        },
        { hitId: 'stun', attackId: 'attack', penetration: input().penetration },
        context(),
      ),
    ).toThrow(/primitive body-damage/);
  });
  it('unknown field response rejects before any commit', () => {
    const runtime = deepFreeze(
      state({ fields: [field({ type: 'UNKNOWN' } as unknown as FieldResponse)] }),
    );
    expect(() => resolve(request({ state: runtime }))).toThrow(/Unknown field/);
    expect(runtime.fields[0]!.remainingUses).toBe(3);
  });
  it('duplicate protection identities are invalid, even across cover/armor', () => {
    expect(() => resolve(request({ state: state({ covers: { armor: cover('armor') } }) }))).toThrow(
      /IDs/,
    );
  });
  it('invalid degradation rejects all proposed field changes', () => {
    const c = cover(),
      runtime = deepFreeze(
        state({
          sources: {},
          covers: {
            cover: {
              ...c,
              definition: {
                ...c.definition,
                degradation: { type: 'EXPLICIT_OB_LOSS', value: -1, provenance },
              },
            },
          },
          fields: [field({ type: 'PASS_THROUGH' })],
        }),
      );
    expect(() => resolve(request({ state: runtime }))).toThrow(/degradation/);
    expect(runtime.fields[0]!.remainingUses).toBe(3);
  });
});

describe('one-resolution override validation and applicability', () => {
  it('unknown GM subject cannot silently disappear', () => {
    expect(() => resolve(request({ context: change([gm('protection:typo', 'EXCLUDE')]) }))).toThrow(
      /Unknown protection override/,
    );
  });
  it('duplicate GM decision for one subject is invalid', () => {
    expect(() =>
      resolve(
        request({
          context: change([gm('protection:armor', 'INCLUDE'), gm('protection:armor', 'EXCLUDE')]),
        }),
      ),
    ).toThrow(/override subjects/);
  });
  it('blank GM reason is invalid even for a later stage', () => {
    expect(() =>
      resolve(
        request({ context: change([{ ...gm('protection:armor', 'EXCLUDE'), reason: ' ' }]) }),
      ),
    ).toThrow(/reason/);
  });
  it('caller tags cannot accidentally activate an inactive field', () => {
    const runtime = state({ fields: [{ ...field({ type: 'CANCEL_HIT' }), active: false }] });
    const r = resolve(
      request({ state: runtime, context: context({ tags: ['field-applicable:field'] }) }),
    );
    expect(r.result.status).toBe('RESOLVED');
    expect(r.state.fields[0]!.remainingUses).toBe(3);
  });
  it('caller tags cannot turn uncovered armor into coverage', () => {
    const r = resolve(
      request({
        input: input({ location: 'Right Arm' }),
        context: context({ tags: ['protection-applicable:armor'] }),
      }),
    );
    expect(r.result.protection!.armorOB).toBe(0);
    expect(r.result.protection!.contributions[0]!.included).toBe(false);
  });
  it('protection effect override changes contribution and logs original source', () => {
    const e = {
      ...effect('cover-reduction', -3, {
        target: { kind: 'combat-modifier', key: 'protection:cover' },
      }),
      targetActor: { actorId: 'B' },
    };
    const ctx = context({
      effects: [e],
      overrides: [
        {
          id: e.id,
          subject: 'effect',
          operation: 'MODIFY',
          value: -5,
          origin: 'gm',
          reason: 'One hit special reduction',
        },
      ],
    });
    const runtime = deepFreeze(state({ sources: {}, covers: { cover: cover() } }));
    const r = resolve(request({ state: runtime, context: ctx }));
    expect(r.result.protection!.armorOB).toBe(1);
    expect(r.result.protection!.effectTraces[0]!.originalValue).toBe(-3);
    expect(r.logs.at(-1)!.modifiers.find((t) => t.id === e.id)!.override).toEqual(ctx.overrides[0]);
    expect(e.definition.value).toBe(-3);
  });
});
