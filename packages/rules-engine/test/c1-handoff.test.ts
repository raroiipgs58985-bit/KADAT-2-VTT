import { describe, it, expect, vi } from 'vitest';
import type { CombatActionState, DamageInput, EffectInstance } from '@kadat/contracts';
import {
  resolveRangedAttack,
  resolveMeleeAttack,
  resolveCombatHitDamage,
  damageInputFromHit,
  damageInputFromPrimitiveIntent,
  resolveProtectionDamage,
  createSequenceDice,
} from '../src/index.js';
import { b1State, attack } from './b1-fixtures.js';
import { meleeState, meleeAttack } from './b2-fixtures.js';
import { effect } from './fixtures.js';
import {
  armor,
  context,
  deepFreeze,
  input,
  provenance,
  request,
  resolve,
  source,
  state,
} from './c1-fixtures.js';
function withVN(combat: CombatActionState): CombatActionState {
  return {
    ...combat,
    actors: {
      ...combat.actors,
      B: {
        ...combat.actors.B!,
        characteristics: {
          ...combat.actors.B!.characteristics,
          ВН: { baseValue: 40, baseSuper: 0 },
        },
      },
    },
  };
}
function dice(sides: number, ...values: number[]) {
  return createSequenceDice(values.map((value) => ({ sides, value })));
}
function vnEffect(id: string, value: number, field: 'value' | 'super' = 'value'): EffectInstance {
  return {
    ...effect(id, value, {
      target: { kind: 'characteristic', characteristic: 'ВН', field },
      stackingGroup: 'fixture-vn:' + field,
    }),
    targetActor: { actorId: 'B' },
  };
}

describe('accepted hit / intent boundaries', () => {
  it('real ranged HitRecord flows to damage without changing shot/weapon/actor data', () => {
    const shot = resolveRangedAttack(withVN(b1State()), attack(), dice(100, 41));
    const accepted = deepFreeze(shot.state),
      hit = deepFreeze(shot.result.hits[0]!);
    const before = JSON.stringify(accepted);
    const r = resolveCombatHitDamage(
      accepted,
      state({ sources: { arm: armor('arm', 4, { zones: ['Arms'] }) } }),
      hit,
      dice(10, 8),
    );
    expect(r.result.input.weapon!.instanceId).toBe('gun:A');
    expect(r.result.input.weapon!.source).toEqual(hit.weaponTemplate);
    expect(r.result.input.location).toBe('Right Arm');
    expect(r.result.rawDamage).toBe(8);
    expect(r.result.bVN).toBe(4);
    expect(r.result.finalDamage).toBe(0);
    expect(r.logs.at(-1)!.combatSessionId).toBe(accepted.session.id);
    expect(r.result.context.roundNumber).toBe(1);
    expect(JSON.stringify(accepted)).toBe(before);
    expect(accepted.containers['mag:A']!.currentRounds).toBe(29);
  });
  it('real melee Wide Sweep HitRecord applies recorded half-damage, not template changes', () => {
    const melee = resolveMeleeAttack(
      withVN(meleeState()),
      meleeAttack({ technique: 'wide-sweep' }),
      dice(100, 31),
    );
    const accepted = deepFreeze(melee.state),
      hit = deepFreeze(melee.result.targets[0]!.hit!);
    const before = JSON.stringify(accepted);
    const r = resolveCombatHitDamage(accepted, state({ sources: {} }), hit, dice(10, 2, 4));
    expect(r.result.damageRoll.rawDamage).toBe(9);
    expect(r.result.rawDamage).toBe(5);
    expect(r.result.finalDamage).toBe(1);
    expect(r.result.canonicalExpression.expression).toEqual({ count: 2, sides: 10, modifier: 3 });
    expect(r.result.input.weapon!.instanceId).toBe('blade:A');
    expect(JSON.stringify(accepted)).toBe(before);
    expect(accepted.melee!.weapons['blade:A']!.template.profile.damage.expression.count).toBe(2);
  });
  it('current runtime VN effects and Super resolved using accepted resolver', () => {
    const shot = resolveRangedAttack(withVN(b1State()), attack(), dice(100, 41));
    const effects = [
      vnEffect('vn-small', 10),
      vnEffect('vn-large', 20),
      vnEffect('super', 2, 'super'),
    ];
    const runtime = deepFreeze({
      ...shot.state,
      actors: { ...shot.state.actors, B: { ...shot.state.actors.B!, effects } },
    });
    const r = resolveCombatHitDamage(
      runtime,
      state({ sources: {} }),
      shot.result.hits[0]!,
      dice(10, 10),
    );
    expect(r.result.endurance).toMatchObject({
      baseValue: 40,
      finalValue: 60,
      finalSuper: 2,
      normalBonus: 6,
      finalBonus: 8,
    });
    expect(r.result.bVN).toBe(8);
    expect(r.result.finalDamage).toBe(2);
    expect(runtime.actors.B!.characteristics.ВН!.baseValue).toBe(40);
    expect(r.logs[0]!.modifiers.find((t) => t.id === 'vn-small')!.reason).toBe('stacking');
  });
  it('one-resolution GM effect exclusion affects current VN only', () => {
    const ctx = context({
      effects: [vnEffect('vn', 20)],
      overrides: [
        {
          id: 'vn',
          subject: 'effect',
          operation: 'EXCLUDE',
          origin: 'gm',
          reason: 'GM damage resolution exclusion',
        },
      ],
    });
    const r = resolve(request({ context: deepFreeze(ctx) }));
    expect(r.result.bVN).toBe(4);
    expect(r.logs[0]!.modifiers[0]!.override).toEqual(ctx.overrides[0]);
    expect(ctx.effects[0]!.definition.value).toBe(20);
  });
  it('missing current VN is not guessed from another characteristic', () => {
    const shot = resolveRangedAttack(b1State(), attack(), dice(100, 41));
    expect(() =>
      resolveCombatHitDamage(shot.state, state(), shot.result.hits[0]!, dice(10, 8)),
    ).toThrow(/Current target VN/);
  });
  it('primitive damage intent resolves individual d5 with its flat bonus', () => {
    const data = damageInputFromPrimitiveIntent(
      {
        type: 'PrimitiveDamageIntent',
        actor: { actorId: 'A' },
        target: { actorId: 'B' },
        source,
        provenance: [provenance],
        damage: { source, expression: { count: 1, sides: 5, modifier: 2 } },
        location: 'Torso',
      },
      { hitId: 'primitive', attackId: 'grapple', penetration: { source, value: 0 } },
      context(),
    );
    const r = resolveProtectionDamage(
      request({ input: data, state: state({ sources: {} }) }),
      dice(5, 4),
    );
    expect(r.result.rawDamage).toBe(6);
    expect(r.result.finalDamage).toBe(2);
  });
  it('grip die removal happens before rolling; original profile retained', () => {
    const data = input({
      profile: { source, expression: { count: 2, sides: 10, modifier: 3 } },
      transformations: [{ id: 'grip', type: 'remove-die', value: 1, provenance }],
    });
    const rng = { roll: vi.fn(() => 6) };
    const r = resolveProtectionDamage(request({ input: deepFreeze(data) }), rng);
    expect(r.result.damageRoll.rolls).toHaveLength(1);
    expect(r.result.rawDamage).toBe(9);
    expect(r.result.canonicalExpression.expression.count).toBe(2);
    expect(r.result.transformations[0]).toMatchObject({ before: 2, after: 1 });
    expect(rng.roll).toHaveBeenCalledTimes(1);
  });
  it('explicit grip flat changes precede Wide Sweep rounding in input order', () => {
    const r = resolve(
      request({
        input: input({
          profile: { source, expression: { count: 1, sides: 10, modifier: 0 } },
          transformations: [
            { id: 'grip', type: 'add', value: 3, provenance },
            { id: 'sweep', type: 'multiply', value: 0.5, rounding: 'ceil', provenance },
          ],
        }),
      }),
      6,
    );
    expect(r.result.transformations.map((t) => [t.before, t.after])).toEqual([
      [6, 9],
      [9, 5],
    ]);
    expect(r.result.rawDamage).toBe(5);
  });
  it('negative flat damage remains traceable and final damage floors at zero', () => {
    const r = resolve(
      request({
        input: input({ profile: { source, expression: { count: 1, sides: 10, modifier: -4 } } }),
      }),
      1,
    );
    expect(r.result.damageRoll.rawDamage).toBe(-3);
    expect(r.result.finalDamage).toBe(0);
    expect(r.result.noDamage).toBe(true);
  });
  it('no critical consequence RNG is consumed, even with two maxima', () => {
    const rng = { roll: vi.fn(() => 10) };
    const r = resolveProtectionDamage(
      request({
        input: input({ profile: { source, expression: { count: 2, sides: 10, modifier: 0 } } }),
      }),
      rng,
    );
    expect(rng.roll).toHaveBeenCalledTimes(2);
    expect(r.result.criticalConsequence.diceCount).toBe(1);
    expect(r.result.criticalConsequence.maximumDiceIndices).toEqual([0, 1]);
  });
  it('foreign target context is invalid before damage roll', () => {
    const rng = { roll: vi.fn(() => 10) };
    expect(() =>
      resolveProtectionDamage(
        request({ context: context({ targetActor: { actorId: 'C' } }) }),
        rng,
      ),
    ).toThrow(/mismatch/);
    expect(rng.roll).not.toHaveBeenCalled();
  });
  it('converting immutable hit does not alter accepted attack result', () => {
    const shot = deepFreeze(resolveRangedAttack(b1State(), attack(), dice(100, 41)));
    const before = JSON.stringify(shot);
    const data = damageInputFromHit(shot.result.hits[0]!);
    expect(data.hitId).toBe(shot.result.hits[0]!.id);
    expect(data.profile).toBe(shot.result.hits[0]!.unresolvedDamage);
    expect(JSON.stringify(shot)).toBe(before);
  });
  it('invalid die transform order is rejected without guessed reordering', () => {
    const data: DamageInput = input({
      profile: { source, expression: { count: 2, sides: 10, modifier: 0 } },
      transformations: [
        { id: 'sweep', type: 'multiply', value: 0.5, rounding: 'ceil', provenance },
        { id: 'grip', type: 'remove-die', value: 1, provenance },
      ],
    });
    expect(() => resolve(request({ input: data }))).toThrow(/selection must precede/);
  });
});

it('field cancellation of accepted hit does not require missing VN data', () => {
  const shot = resolveRangedAttack(b1State(), attack(), dice(100, 41));
  const f = {
    id: 'cancel',
    owner: { actorId: 'B' },
    active: true,
    remainingUses: 1,
    definition: {
      id: 'cancel-template',
      source,
      provenance,
      zones: ['Right Arm'] as const,
      tags: [],
      response: { type: 'CANCEL_HIT' } as const,
      useCost: 1,
    },
  };
  const r = resolveCombatHitDamage(
    deepFreeze(shot.state),
    state({ fields: [f] }),
    shot.result.hits[0]!,
    dice(10, 8),
  );
  expect(r.result.status).toBe('CANCELLED');
  expect(r.result.finalDamage).toBe(0);
  expect(r.result.endurance).toBeNull();
  expect(r.result.protection).toBeNull();
});
