import { describe, it, expect, vi } from 'vitest';
import type {
  CalledLocation,
  ConsequenceRow,
  DamageResolutionResult,
  WoundRuntimeState,
} from '@kadat/contracts';
import {
  resolvePostDamage,
  resolveBleedingPulse,
  lookupConsequence,
  consequenceCatalog,
  resolveFatigueGain,
  resolveWoundAwareAction,
  resolveRangedAttack,
  resolveStabilization,
  resolveWoundRoundEnd,
  removeWoundCondition,
} from '../src/index.js';
import {
  ctx,
  damage,
  deepFreeze,
  facts,
  provenance,
  request,
  rng,
  state,
  withBleeding,
} from './c2-fixtures.js';
import { attack } from './b1-fixtures.js';
const actor = { actorId: 'B' };
function rejectDamage(input: DamageResolutionResult) {
  const initial = deepFreeze(state()),
    before = JSON.stringify(initial);
  expect(() => resolvePostDamage(request({ state: initial, damage: input }), rng())).toThrow();
  expect(JSON.stringify(initial)).toBe(before);
}
function pulse(initial: WoundRuntimeState, dice = rng()) {
  return resolveBleedingPulse({ id: 'pulse', actor, state: initial, context: ctx(), facts }, dice);
}

describe('C-2 transaction/invariant negatives', () => {
  it('missing C-1 fields rejected without runtime mutation', () => {
    rejectDamage({} as DamageResolutionResult);
  });
  it('pending C-1 input rejected; protection is never resumed by C-2', () => {
    rejectDamage({ ...damage(), status: 'PENDING_PROTECTION', finalDamage: null });
  });
  it('cancelled/non-surviving C-1 hit is outside the C-2 input boundary', () => {
    rejectDamage({ ...damage(), status: 'CANCELLED', finalDamage: 0 });
  });
  it.each([-1, -0.5, NaN])('invalid finalDamage %s', (value) => {
    rejectDamage({ ...damage(), finalDamage: value });
  });
  it.each([-1, 2, 1.5])('invalid critical marker count %s', (count) => {
    rejectDamage({ ...damage(), criticalConsequenceDiceCount: count as 1 });
  });
  it('critical boolean/count mismatch is an invariant violation', () => {
    rejectDamage({ ...damage(), critical: true });
  });
  it.each([0, 11, 1.5])('invalid critical d10 %s rolls back', (value) => {
    const initial = deepFreeze(state()),
      snapshot = JSON.stringify(initial);
    expect(() =>
      resolvePostDamage(request({ state: initial, damage: damage(0, 'Head', true) }), {
        roll: () => value,
      }),
    ).toThrow();
    expect(JSON.stringify(initial)).toBe(snapshot);
  });
  it('invalid body location rejected', () => {
    const d = damage();
    rejectDamage({ ...d, input: { ...d.input, location: 'Tail' as CalledLocation } });
  });
  it('unsupported special zone needs explicit mapping, with no partial state', () => {
    const initial = deepFreeze(state());
    const r = resolvePostDamage(request({ state: initial, damage: damage(5, 'Eyes') }), rng());
    expect(r.result.status).toBe('CONTEXT_REQUIRED');
    expect(r.result.pendingIntents[0]!.type).toBe('BodyZoneMappingRequired');
    expect(r.state).toBe(initial);
  });
  it('context cannot remap an explicit Arm consequence to Torso', () => {
    const req = request({
      damage: damage(5, 'Right Arm'),
      facts: { ...facts, consequenceZone: 'TORSO' },
    });
    expect(() => resolvePostDamage(req, rng())).toThrow(/override explicit canonical/);
  });
  it('catalog gap rejected', () => {
    const rows = consequenceCatalog.filter((r) => r.id !== 'HEAD:4');
    expect(() => lookupConsequence('HEAD', 4, rows)).toThrow(/gap/);
  });
  it('catalog overlap rejected', () => {
    const rows = consequenceCatalog.map((r) => (r.id === 'HEAD:4' ? { ...r, minimum: 3 } : r));
    expect(() => lookupConsequence('HEAD', 4, rows)).toThrow(/gap\/overlap/);
  });
  it('missing terminal range rejected', () => {
    const rows = consequenceCatalog.filter((r) => r.id !== 'LEG:20+');
    expect(() => lookupConsequence('LEG', 21, rows)).toThrow(/terminal/);
  });
  it('invalid catalog zone rejected', () => {
    expect(() => lookupConsequence('WING' as ConsequenceRow['zone'], 2)).toThrow(/Unsupported/);
  });
  it('duplicate Injury id fails before commit', () => {
    const first = resolvePostDamage(request(), rng());
    const old = first.state.actors.B!;
    const corrupt = {
      ...first.state,
      actors: { B: { ...old, injuries: [...old.injuries, old.injuries[0]!] } },
    };
    const before = JSON.stringify(corrupt);
    expect(() =>
      resolvePostDamage(
        request({ state: corrupt, damage: damage(1, 'Right Arm', false, 'next') }),
        rng(),
      ),
    ).toThrow(/Injury IDs/);
    expect(JSON.stringify(corrupt)).toBe(before);
  });
  it('proposed Injury ID colliding with historical record is rejected', () => {
    const first = resolvePostDamage(request(), rng());
    const replay = { ...first.state, processedHitIds: [] };
    expect(() => resolvePostDamage(request({ state: replay }), rng())).toThrow(/Duplicate Injury/);
  });
  it('invalid bleeding severity rejected before Blood mutation', () => {
    const initial = withBleeding(['LIGHT']),
      b = initial.actors.B!;
    const corrupt = {
      ...initial,
      actors: { B: { ...b, bleeding: [{ ...b.bleeding[0]!, severity: 'EXTREME' as 'LIGHT' }] } },
    };
    const before = JSON.stringify(corrupt);
    expect(() => pulse(corrupt)).toThrow(/severity/);
    expect(JSON.stringify(corrupt)).toBe(before);
  });
  it.each([0, 6, 1.5])('invalid heavy d5 %s leaves Blood untouched', (value) => {
    const initial = deepFreeze(withBleeding(['HEAVY']));
    expect(() =>
      resolveBleedingPulse(
        {
          id: 'pulse',
          actor,
          state: initial,
          context: ctx(),
          facts: { ...facts, activity: 'PHYSICAL_ACTION' },
        },
        { roll: () => value },
      ),
    ).toThrow();
    expect(initial.actors.B!.blood.bloodLost).toBe(0);
  });
  it.each([
    { bloodLost: -1, currentBlood: 9 },
    { bloodLost: 0, currentBlood: -1 },
    { bloodLost: 0, currentBlood: 999 },
  ])('corrupt Blood %j rejected', (changes) => {
    const initial = withBleeding(['LIGHT']),
      b = initial.actors.B!;
    expect(() =>
      pulse({ ...initial, actors: { B: { ...b, blood: { ...b.blood, ...changes } } } }),
    ).toThrow();
  });
  it('invalid activity rejected without RNG/resource changes', () => {
    const initial = deepFreeze(withBleeding(['HEAVY'])),
      roll = vi.fn(() => 4);
    expect(() =>
      resolveBleedingPulse(
        {
          id: 'pulse',
          actor,
          state: initial,
          context: ctx(),
          facts: { ...facts, activity: 'SPRINT' as 'REST' },
        },
        { roll },
      ),
    ).toThrow(/activity/);
    expect(roll).not.toHaveBeenCalled();
    expect(initial.actors.B!.blood.currentBlood).toBe(8);
  });
  it('one missing source context prevents earlier source rolls/Blood', () => {
    const initial = deepFreeze(withBleeding(['LIGHT', 'HEAVY'])),
      roll = vi.fn(() => 90);
    const r = resolveBleedingPulse(
      {
        id: 'pulse',
        actor,
        state: initial,
        context: ctx(),
        facts: { provenance, activityBySource: { 'fixture-bleed:0': 'REST' } },
      },
      { roll },
    );
    expect(r.result.status).toBe('CONTEXT_REQUIRED');
    expect(r.state).toBe(initial);
    expect(roll).not.toHaveBeenCalled();
  });
  it('repeated post-damage hit rejected without another critical roll', () => {
    const r = resolvePostDamage(
      request({ damage: damage(0, 'Head', true) }),
      rng({ sides: 10, value: 2 }),
    );
    const roll = vi.fn(() => 3);
    expect(() =>
      resolvePostDamage(request({ state: r.state, damage: damage(0, 'Head', true) }), { roll }),
    ).toThrow(/Repeated/);
    expect(roll).not.toHaveBeenCalled();
  });
  it('repeated bleeding pulse id cannot double charge Blood', () => {
    const first = pulse(withBleeding(['HEAVY']));
    expect(() => pulse(first.state)).toThrow(/repeated/);
    expect(first.state.actors.B!.blood.bloodLost).toBe(3);
  });
  it('normalized Head13 still rolls back if immediate bleeding activity is missing', () => {
    const initial = deepFreeze(state());
    const r = resolvePostDamage(
      request({
        state: initial,
        damage: damage(13, 'Head'),
        facts: { provenance, eyeCountBefore: 2 },
      }),
      rng(),
    );
    expect(r.result.status).toBe('CONTEXT_REQUIRED');
    expect(r.result.pendingIntents.some((i) => i.type === 'BleedingActivityContextRequired')).toBe(
      true,
    );
    expect(r.state).toBe(initial);
  });
  it('negative fingers count is not clamped or turned into negative amputation', () => {
    const initial = deepFreeze(state());
    const r = resolvePostDamage(
      request({ state: initial, damage: damage(9, 'Right Arm') }),
      rng({ sides: 10, value: 1 }),
    );
    expect(r.result.status).toBe('CONTEXT_REQUIRED');
    expect(r.result.pendingIntents.some((i) => i.details?.rawCount === -4)).toBe(true);
    expect(r.state).toBe(initial);
  });
  it('unprovided eye feature does not invent blindness state', () => {
    const initial = deepFreeze(state());
    const r = resolvePostDamage(
      {
        ...request({ state: initial, damage: damage(7, 'Head') }),
        facts: { provenance, activity: 'REST' },
      },
      rng(),
    );
    expect(r.result.status).toBe('CONTEXT_REQUIRED');
    expect(r.state).toBe(initial);
  });
  it('minute/hour conditions are not silently rounds', () => {
    const r = resolvePostDamage(request({ damage: damage(15, 'Right Arm') }), rng());
    expect(r.state.actors.B!.conditions.find((c) => c.type === 'Stunned')!.duration).toEqual({
      unit: 'hour',
      amount: 1,
    });
    expect(r.state.combat.session.conditions.some((c) => c.type === 'Stunned')).toBe(false);
    expect(
      r.state.actors.B!.intents.some(
        (i) => i.type === 'TimedConditionIntent' && i.duration?.unit === 'hour',
      ),
    ).toBe(true);
  });
  it('blood-loss Stunned cannot be removed with drugs or Willpower', () => {
    const r = pulse(withBleeding(['HEAVY']), rng());
    const second = resolveBleedingPulse(
      { id: 'next', actor, state: r.state, context: ctx(), facts },
      rng(),
    );
    expect(() =>
      removeWoundCondition(second.state, actor, 'blood:B:half', 'ordinary-drug'),
    ).toThrow(/blood replacement/);
    expect(() => removeWoundCondition(second.state, actor, 'blood:B:half', 'willpower')).toThrow(
      /blood replacement/,
    );
  });
  it('no Math.random exists in C-2 resolvers', () => {
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Forbidden implicit RNG');
    });
    try {
      resolvePostDamage(request(), rng());
      pulse(withBleeding(['HEAVY']), rng());
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
  it('Agony of 0 rounds (бВН 0) is death at once — author ruling 33', () => {
    const initial = deepFreeze(state(0));
    const r = resolvePostDamage(
      request({ state: initial, damage: damage(20, 'Right Arm') }),
      rng(),
    );
    expect(r.result.status).not.toBe('CONTEXT_REQUIRED');
    expect(r.state.actors.B!.life.status).toBe('DEAD');
  });
  it('Agony cannot expire before a complete initiative-chain round', () => {
    const r = resolvePostDamage(request({ damage: damage(20, 'Right Arm') }), rng());
    expect(() => resolveWoundRoundEnd(r.state)).toThrow(/completed global round/);
  });
  it('med kit is mandatory and rejection consumes no RNG', () => {
    const initial = resolvePostDamage(request({ damage: damage(20, 'Right Arm') }), rng()).state;
    const roll = vi.fn(() => 1);
    expect(() =>
      resolveStabilization(
        initial,
        {
          id: 'medica',
          actor: { actorId: 'A' },
          target: actor,
          medKit: null,
          medica: { baseValue: 80, finalSuper: 0, provenance },
          context: ctx({ actor: { actorId: 'A' }, targetActor: actor }),
        },
        { roll },
      ),
    ).toThrow(/med kit/);
    expect(roll).not.toHaveBeenCalled();
  });
  it('GM cannot override canonical bleeding activity penalty', () => {
    const initial = withBleeding(['LIGHT']);
    expect(() =>
      resolveBleedingPulse(
        {
          id: 'pulse',
          actor,
          state: initial,
          facts,
          context: ctx({
            overrides: [
              {
                subject: 'modifier',
                id: 'bleeding:fixture-bleed:0:activity',
                operation: 'EXCLUDE',
                reason: 'ignore canonical penalty',
              },
            ],
          }),
        },
        rng(),
      ),
    ).toThrow();
  });
});

describe('Fatigue author ruling / frozen recovery boundary', () => {
  it.each([
    { roll: 1, raw: -3, applied: 0, after: 5 },
    { roll: 4, raw: 0, applied: 0, after: 5 },
    { roll: 8, raw: 4, applied: 4, after: 9 },
  ])('gain d10=$roll preserves raw=$raw applied=$applied', (test) => {
    const r = resolveFatigueGain(5, 4, rng({ sides: 10, value: test.roll }), provenance);
    expect(r).toMatchObject({
      rawFatigueGain: test.raw,
      appliedFatigueGain: test.applied,
      fatigueAfter: test.after,
      bVN: 4,
      roll: { value: test.roll },
    });
  });
  it('fatigue threshold strictly greater creates timed Unconscious and source-linked recovery intent', () => {
    const initial = state(),
      s = {
        ...initial,
        combat: {
          ...initial.combat,
          actors: { ...initial.combat.actors, B: { ...initial.combat.actors.B!, fatigue: 8 } },
        },
      };
    const r = resolvePostDamage(
      request({ state: s, damage: damage(11) }),
      rng({ sides: 10, value: 8 }, { sides: 10, value: 10 }),
    );
    expect(r.state.combat.actors.B!.fatigue).toBe(12);
    expect(r.state.actors.B!.conditions.find((c) => c.type === 'Unconscious')!.duration).toEqual({
      unit: 'minute',
      amount: 6,
    });
    expect(
      r.state.actors.B!.intents.find((i) => i.type === 'FatigueRecoveryIntent')!.details,
    ).toMatchObject({ bVN: 4, perHours: 1 });
  });
  it('1к10 − бСВ ≤ 0 minutes: no unconsciousness — author ruling 33', () => {
    const initial = state(40, 90),
      s = {
        ...initial,
        combat: {
          ...initial.combat,
          actors: { ...initial.combat.actors, B: { ...initial.combat.actors.B!, fatigue: 13 } },
        },
      };
    const r = resolvePostDamage(
      request({ state: deepFreeze(s), damage: damage(11) }),
      rng({ sides: 10, value: 10 }, { sides: 10, value: 1 }),
    );
    expect(r.result.status).not.toBe('CONTEXT_REQUIRED');
    expect(r.state.actors.B!.conditions.some((c) => c.id.includes('unconscious'))).toBe(false);
  });
  it('a rejected wound-aware ranged action leaves sources and resources unchanged', () => {
    const bleeding = resolveBleedingPulse(
      { id: 'blood', actor, state: withBleeding(['HEAVY']), context: ctx(), facts },
      rng(),
    );
    const frozen = deepFreeze(bleeding.state);
    const req = attack('wound-shot', {
      actor: { actorId: 'B' },
      context: ctx(),
      weaponId: 'gun:B',
      target: { actorId: 'A' },
    });
    const context = { ...req.context, targetActor: { actorId: 'A' } };
    // B is outside own turn; move initiative through the accepted turn functions in the companion integration suite.
    expect(() =>
      resolveWoundAwareAction(frozen, 'НС', context, (combat, c) =>
        resolveRangedAttack(combat, { ...req, context: c }, rng({ sides: 100, value: 31 })),
      ),
    ).toThrow(/Wait|own turn|active own|window/);
    expect(frozen.combat.actors.B!.characteristics.НС!.baseValue).toBe(40);
  });
});
