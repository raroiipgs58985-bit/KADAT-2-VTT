import { describe, it, expect, vi } from 'vitest';
import {
  resolvePostDamage,
  resolveBleedingPulse,
  resolveWoundAwareAction,
  resolveRangedAttack,
  resolveParry,
  resolveWoundCheck,
  resolveWoundRoundEnd,
  resolveStabilization,
  resolveWoundTurnStart,
  consequenceCatalog,
  lookupConsequence,
  bloodThresholds,
  beginActionTurn,
  finishActionTurn,
  beginActionRound,
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
import { onBTurn, action } from './b2-fixtures.js';
import { attack, advanceToNextOwnTurn } from './b1-fixtures.js';
const actor = { actorId: 'B' };

describe('C-2 canonical range coverage', () => {
  it.each(consequenceCatalog.map((row) => [row.id, row] as const))(
    '%s covers exact bounds and canonical text',
    (_id, row) => {
      expect(lookupConsequence(row.zone, row.minimum)).toBe(row);
      expect(lookupConsequence(row.zone, row.maximum ?? 10000)).toBe(row);
      expect(row.text).not.toBe('');
      expect(row.provenance.source.id).toContain('Механика к100.xlsx / Раны и лечение');
      expect(Object.isFrozen(row)).toBe(true);
      const location =
        row.zone === 'HEAD'
          ? 'Head'
          : row.zone === 'ARM'
            ? 'Right Arm'
            : row.zone === 'LEG'
              ? 'Right Leg'
              : 'Torso';
      const initial = deepFreeze(request({ damage: damage(row.minimum, location) }));
      const resolved = resolvePostDamage(initial, { roll: (sides) => (sides === 100 ? 5 : sides) });
      expect(resolved.result.consequence).toBe(row);
      expect(resolved.result.status).toBe('RESOLVED');
      expect(resolved.result.injuriesCreated[0]!.canonicalText).toBe(row.text);
      expect(resolved.result.damageTakenAfter).toBe(7 + row.minimum);
    },
  );
});
describe('C-2 accepted resolver integration', () => {
  it('Blood quarter projects ranged NS for one attack, retaining ammo/resource behavior and base data', () => {
    const blood = resolveBleedingPulse(
      { id: 'blood', actor, state: withBleeding(['HEAVY']), context: ctx(), facts },
      rng(),
    ).state;
    const s = deepFreeze({ ...blood, combat: onBTurn(blood.combat) });
    const req = attack('half-shot', {
      actor,
      target: { actorId: 'A' },
      weaponId: 'gun:B',
      context: ctx(),
    });
    const r = resolveWoundAwareAction(s, 'НС', ctx(), (combat, c) =>
      resolveRangedAttack(combat, { ...req, context: c }, rng({ sides: 100, value: 31 })),
    );
    expect(r.resolution.result.check).toMatchObject({
      baseValue: 20,
      target: 30,
      outcome: 'failure',
    });
    expect(r.state.combat.containers['mag:B']!.currentRounds).toBe(29);
    expect(s.combat.containers['mag:B']!.currentRounds).toBe(30);
    expect(r.state.combat.actors.B!.characteristics.НС!.baseValue).toBe(40);
    expect(
      r.state.combat.actors.B!.effects.some((e) => e.id.startsWith('wound-check-projection:')),
    ).toBe(false);
    expect(r.projection.halvingSources).toHaveLength(1);
  });
  it('Fatigue check halving feeds accepted Parry, without duplicating Parry rules', () => {
    const initial = state(),
      s = deepFreeze({
        ...initial,
        combat: {
          ...initial.combat,
          actors: { ...initial.combat.actors, B: { ...initial.combat.actors.B!, fatigue: 5 } },
        },
      });
    const r = resolveWoundAwareAction(s, 'НР', ctx(), (combat, c) =>
      resolveParry(
        combat,
        {
          ...action('fatigue-parry', 'parry', 'B'),
          context: c,
          target: { actorId: 'A' },
          pool: 'normal',
          weaponId: 'blade:B',
          triggeringResolutionId: 'incoming',
          incomingOrigin: 'NORMAL',
        },
        1,
        rng({ sides: 100, value: 20 }),
      ),
    );
    expect(r.resolution.result.check).toMatchObject({ baseValue: 25, target: 25, totalDegrees: 1 });
    expect(r.resolution.result.counterattack).toBeNull();
    expect(
      r.state.combat.session.initiativeOrder.find((e) => e.actor.actorId === 'B')!.reactions
        .remaining,
    ).toBe(0);
    expect(r.state.combat.actors.B!.characteristics.НР!.baseValue).toBe(50);
  });
  it('non-halving injury penalties compose through the same Check Engine context', () => {
    const hit = resolvePostDamage(request({ damage: damage(5) }), rng());
    const r = resolveWoundCheck(hit.state, 'ЛВ', ctx(), rng({ sides: 100, value: 41 }));
    expect(r.result).toMatchObject({ baseValue: 50, target: 40, outcome: 'failure' });
    expect(r.result.modifiers.some((m) => m.value === -10)).toBe(true);
  });
  it.each([
    ['REST', 30],
    ['PHYSICAL_ACTION', 10],
    ['HOLDING_WOUND', 60],
  ] as const)('bleeding resistance %s has target %i', (activity, target) => {
    const r = resolveBleedingPulse(
      {
        id: 'pulse',
        actor,
        state: withBleeding(['LIGHT']),
        context: ctx(),
        facts: { ...facts, activity },
      },
      rng({ sides: 100, value: 90 }),
    );
    expect(r.result.entries[0]!.check!.target).toBe(target);
    expect(r.result.entries[0]!.projection!.authoritative.baseValue).toBe(40);
  });
  it('pending critical hit resumes with the original consequence die, never a new critical roll', () => {
    const { facts: omitted, ...req } = request({ damage: damage(0, 'Right Arm', true) });
    void omitted;
    const pending = resolvePostDamage(req, rng({ sides: 10, value: 3 }));
    expect(pending.result.status).toBe('CONTEXT_REQUIRED');
    const roll = vi.fn(() => 90);
    const resolved = resolvePostDamage(
      { ...req, facts, resumeDice: pending.result.nestedDice },
      { roll },
    );
    expect(resolved.result.criticalConsequenceDie?.value).toBe(3);
    expect(roll).toHaveBeenCalledExactlyOnceWith(100);
    expect(resolved.result.damageTakenAfter).toBe(7);
  });
  it('Blood has zero floor and exact rational comparisons', () => {
    const r = resolveBleedingPulse(
      {
        id: 'pulse',
        actor,
        state: withBleeding(['HEAVY'], state(30)),
        context: ctx(),
        facts: { ...facts, activity: 'PHYSICAL_ACTION' },
      },
      rng({ sides: 5, value: 5 }),
    );
    expect(r.result.bloodAfter).toMatchObject({ maxBlood: 7, bloodLost: 8, currentBlood: 0 });
    expect(
      bloodThresholds({ maxBlood: 7, reserveBonus: 3, bloodLost: 5, currentBlood: 2 })
        .threeQuarters,
    ).toBe(false);
    expect(
      bloodThresholds({ maxBlood: 7, reserveBonus: 3, bloodLost: 6, currentBlood: 1 })
        .threeQuarters,
    ).toBe(true);
  });
  it('repeated source-linked Head8 deafness creates permanent hearing injury once', () => {
    const a = resolvePostDamage(
      request({ damage: damage(8, 'Head') }),
      rng({ sides: 100, value: 5 }),
    );
    const b = resolvePostDamage(
      request({ state: a.state, damage: damage(8, 'Head', false, 'repeat') }),
      rng({ sides: 100, value: 5 }),
    );
    expect(b.result.injuriesCreated[0]!.features).toContainEqual({
      type: 'permanent-hearing-loss',
    });
    expect(b.state.actors.B!.injuries[0]!.triggers[0]!.consumed).toBe(true);
    expect(a.state.actors.B!.injuries[0]!.triggers[0]!.consumed).toBe(false);
  });
  it.each([
    ['Left Leg', 'Right Leg'],
    ['Right Leg', 'Left Leg'],
  ] as const)('same-limb escalation preserves %s side and excludes %s', (same, other) => {
    const a = resolvePostDamage(request({ damage: damage(17, same) }), rng());
    const b = resolvePostDamage(
      request({ state: a.state, damage: damage(1, other, false, 'other') }),
      rng(),
    );
    expect(b.result.escalatedBy).toEqual([]);
    const c = resolvePostDamage(
      request({ state: b.state, damage: damage(1, same, false, 'same') }),
      rng(),
    );
    expect(c.result.lifeAfter.status).toBe('AGONY');
    expect(c.result.injuriesCreated[0]!.location).toBe(same);
  });
});

describe('C-2 Agony and stabilization', () => {
  it('Agony expires only at end of eighth whole initiative-chain round', () => {
    let s = resolvePostDamage(request({ damage: damage(20, 'Left Leg') }), rng()).state;
    for (let round = 1; round <= 8; round++) {
      let combat = s.combat;
      if (combat.session.phase === 'turn-active') combat = finishActionTurn(combat).state;
      while (combat.session.phase !== 'round-ended')
        combat = finishActionTurn(beginActionTurn(combat).state).state;
      const r = resolveWoundRoundEnd({ ...s, combat });
      expect(r.state.actors.B!.life.status).toBe(round === 8 ? 'DEAD' : 'AGONY');
      s = r.state;
      if (round < 8) s = { ...s, combat: beginActionTurn(beginActionRound(s.combat).state).state };
    }
  });
  it('application Round2 counts as first Agony round', () => {
    const initial = state(),
      s = {
        ...initial,
        combat: { ...initial.combat, session: { ...initial.combat.session, roundNumber: 2 } },
      };
    const r = resolvePostDamage(request({ state: s, damage: damage(20, 'Left Arm') }), rng());
    expect(r.result.lifeAfter).toMatchObject({
      startedRound: 2,
      expiresAfterRound: 9,
      durationRounds: 8,
    });
  });
  it('Medica -30 with med kit stabilizes for successDegrees hours and preserves follow-up intent', () => {
    const s = resolvePostDamage(request({ damage: damage(20, 'Left Arm') }), rng()).state;
    const r = resolveStabilization(
      deepFreeze(s),
      {
        id: 'medica',
        actor: { actorId: 'A' },
        target: actor,
        medKit: { kind: 'item', id: 'kit' },
        medica: { baseValue: 80, finalSuper: 0, provenance },
        context: ctx({ actor: { actorId: 'A' }, targetActor: actor }),
      },
      rng({ sides: 100, value: 29 }),
    );
    expect(r.result.check).toMatchObject({ target: 50, totalDegrees: 3 });
    expect(r.result.durationHours).toBe(3);
    expect(r.state.actors.B!.life.status).toBe('STABILIZED');
    expect(r.state.combat.session.conditions.some((c) => c.type === 'Agony')).toBe(false);
    expect(
      r.state.actors.B!.intents.some(
        (i) => i.type === 'StabilizedFollowupIntent' && i.duration?.unit === 'hour',
      ),
    ).toBe(true);
    expect(r.logs.at(-1)!.stabilization?.request.medKit?.id).toBe('kit');
  });
  it('failed stabilization keeps Agony and cannot replay the same action id', () => {
    const s = resolvePostDamage(request({ damage: damage(20, 'Right Arm') }), rng()).state;
    const req = {
      id: 'medica',
      actor: { actorId: 'A' },
      target: actor,
      medKit: { kind: 'item', id: 'kit' },
      medica: { baseValue: 80, finalSuper: 0, provenance },
      context: ctx({ actor: { actorId: 'A' }, targetActor: actor }),
    };
    const r = resolveStabilization(s, req, rng({ sides: 100, value: 90 }));
    expect(r.state.actors.B!.life.status).toBe('AGONY');
    expect(() => resolveStabilization(r.state, req, rng())).toThrow(/Repeated/);
  });
});

describe('C-2 subsequent own-turn injury/bleeding hooks', () => {
  it('Arm5 turn-start VN fail adds canonical one-round Stunned', () => {
    const hit = resolvePostDamage(request({ damage: damage(5, 'Right Arm') }), rng());
    const s = deepFreeze({ ...hit.state, combat: onBTurn(hit.state.combat) });
    const r = resolveWoundTurnStart(s, actor, ctx(), facts, rng({ sides: 100, value: 90 }));
    expect(
      r.state.combat.session.conditions.find((c) => c.type === 'Stunned')!.durationRounds,
    ).toBe(1);
    expect(() => resolveWoundTurnStart(r.state, actor, ctx(), facts, rng())).toThrow(/already/);
  });
  it('Arm5 successful VN does not stun and treatment trigger remains source-linked', () => {
    const hit = resolvePostDamage(request({ damage: damage(5, 'Right Arm') }), rng());
    const r = resolveWoundTurnStart(
      { ...hit.state, combat: onBTurn(hit.state.combat) },
      actor,
      ctx(),
      facts,
      rng({ sides: 100, value: 5 }),
    );
    expect(r.state.combat.session.conditions.some((c) => c.type === 'Stunned')).toBe(false);
    expect(r.state.actors.B!.injuries[0]!.triggers[0]!.consumed).toBe(false);
  });
  it('Leg5 Stunned expires on next own-turn start and is not added indefinitely', () => {
    const hit = resolvePostDamage(request({ damage: damage(5, 'Left Leg') }), rng());
    const first = resolveWoundTurnStart(
      { ...hit.state, combat: onBTurn(hit.state.combat) },
      actor,
      ctx(),
      facts,
      rng({ sides: 100, value: 90 }),
    );
    expect(first.state.actors.B!.conditions.filter((c) => c.type === 'Stunned')).toHaveLength(1);
    const second = resolveWoundTurnStart(
      { ...first.state, combat: onBTurn(advanceToNextOwnTurn(first.state.combat)) },
      actor,
      ctx(),
      facts,
      rng({ sides: 100, value: 5 }),
    );
    expect(second.state.actors.B!.conditions.filter((c) => c.type === 'Stunned')).toHaveLength(0);
  });
  it('missing activity rolls back both turn injury trigger and bleeding', () => {
    const arm = resolvePostDamage(request({ damage: damage(5, 'Right Arm') }), rng());
    const s = deepFreeze({
      ...withBleeding(['HEAVY'], arm.state),
      actors: {
        B: {
          ...withBleeding(['HEAVY'], arm.state).actors.B!,
          injuries: [
            ...arm.state.actors.B!.injuries,
            ...withBleeding(['HEAVY'], arm.state).actors.B!.injuries,
          ],
        },
      },
      combat: onBTurn(arm.state.combat),
    });
    const roll = vi.fn(() => 90);
    const r = resolveWoundTurnStart(s, actor, ctx(), undefined, { roll });
    expect(r.status).toBe('CONTEXT_REQUIRED');
    expect(r.state).toBe(s);
    expect(roll).not.toHaveBeenCalled();
  });
});

describe('C-2 consequence branches and source restrictions', () => {
  it.each([
    ['Head', 14, 5, 'Stunned'],
    ['Head', 14, 90, 'Helpless'],
  ] as const)(
    '%s14 VN %i produces %s without mixing success/failure branches',
    (location, amount, roll, expected) => {
      const r = resolvePostDamage(
        request({ damage: damage(amount, location) }),
        rng({ sides: 100, value: roll }, { sides: 10, value: 4 }),
      );
      expect(r.state.combat.session.conditions.some((c) => c.type === expected)).toBe(true);
      expect(r.result.injuriesCreated[0]!.features).toContainEqual({
        type: 'teeth-amputation',
        count: 4,
      });
      expect(r.result.secondaryCheckProjections).toHaveLength(1);
    },
  );
  it.each([
    [1, 'Left'],
    [2, 'Right'],
  ] as const)('clavicle injected d2=%i preserves %s side and drop intent', (value, side) => {
    const r = resolvePostDamage(
      request({ damage: damage(7) }),
      rng({ sides: 2, value }, { sides: 100, value: 5 }),
    );
    expect(r.result.injuriesCreated[0]!.features).toContainEqual({ type: 'clavicle-side', side });
    expect(
      r.result.pendingIntents.find((i) => i.type === 'DropHeldItemIntent')!.details!.side,
    ).toBe(side);
    expect(r.result.nestedDice[0]).toEqual({ sides: 2, value });
  });
  it('finger d5 preserves thumb index and exact source Injury', () => {
    const r = resolvePostDamage(
      request({ damage: damage(6, 'Left Arm') }),
      rng({ sides: 5, value: 1 }, { sides: 100, value: 5 }),
    );
    expect(r.result.injuriesCreated[0]!.features).toContainEqual({
      type: 'finger-index',
      count: 1,
    });
    expect(r.result.injuriesCreated[0]!.side).toBe('Left');
  });
  it.each([
    [5, 0],
    [8, 3],
  ] as const)('finger count d10=%i results in %i lost fingers', (value, count) => {
    const r = resolvePostDamage(
      request({ damage: damage(9, 'Right Arm') }),
      rng({ sides: 10, value }),
    );
    expect(r.result.status).toBe('RESOLVED');
    const feature = r.result.injuriesCreated[0]!.features.find(
      (f) => f.type === 'fingers-amputation',
    );
    if (count === 0) expect(feature).toBeUndefined();
    else expect(feature?.count).toBe(count);
  });
  it('long Fatigue preserves days and rest prohibition without inventing a counter amount', () => {
    const r = resolvePostDamage(
      request({ damage: damage(12, 'Head') }),
      rng({ sides: 10, value: 7 }, { sides: 100, value: 5 }),
    );
    expect(r.state.combat.actors.B!.fatigue).toBe(0);
    expect(
      r.state.actors.B!.conditions.find((c) => c.type === 'PersistentFatigue')!.duration,
    ).toEqual({ unit: 'day', amount: 7 });
    expect(r.result.pendingIntents.some((i) => i.details?.restHelps === false)).toBe(true);
  });
  it('unusable limb restriction blocks only actions declared to use that limb, atomically', () => {
    const hit = resolvePostDamage(request({ damage: damage(5, 'Right Arm') }), rng());
    const s = deepFreeze({ ...hit.state, combat: onBTurn(hit.state.combat) });
    const req = attack('injured', {
      actor,
      target: { actorId: 'A' },
      weaponId: 'gun:B',
      context: ctx({ tags: ['uses-limb:Right Arm'] }),
    });
    const roll = vi.fn(() => 20);
    expect(() =>
      resolveWoundAwareAction(s, 'НС', req.context, (combat, c) =>
        resolveRangedAttack(combat, { ...req, context: c }, { roll }),
      ),
    ).toThrow(/prohibited/);
    expect(roll).not.toHaveBeenCalled();
    expect(s.combat.containers['mag:B']!.currentRounds).toBe(30);
    const allowed = resolveWoundAwareAction(
      s,
      'НС',
      ctx({ tags: ['uses-limb:Left Arm'] }),
      (combat, c) =>
        resolveRangedAttack(combat, { ...req, context: c }, rng({ sides: 100, value: 20 })),
    );
    expect(allowed.resolution.result.check.outcome).toBe('success');
  });
  it('Blood-induced Stunned is enforced by accepted Action validation, no partial ammo spend', () => {
    const blood = resolveBleedingPulse(
      {
        id: 'heavy',
        actor,
        state: withBleeding(['HEAVY']),
        context: ctx(),
        facts: { ...facts, activity: 'PHYSICAL_ACTION' },
      },
      rng({ sides: 5, value: 1 }),
    ).state;
    const s = deepFreeze({ ...blood, combat: onBTurn(blood.combat) });
    expect(() =>
      resolveWoundAwareAction(s, 'НС', ctx(), (combat, c) =>
        resolveRangedAttack(
          combat,
          attack('blocked', { actor, target: { actorId: 'A' }, weaponId: 'gun:B', context: c }),
          rng(),
        ),
      ),
    ).toThrow(/prohibited/);
    expect(s.combat.containers['mag:B']!.currentRounds).toBe(30);
  });
});

describe('C-2 Head13 direct author normalization', () => {
  it('original Serious text resolves as ordinary Heavy with source/normalization provenance', () => {
    const initial = deepFreeze(request({ damage: damage(13, 'Head') }));
    const r = resolvePostDamage(initial, rng());
    expect(r.result.status).toBe('RESOLVED');
    expect(r.result.consequence!.text).toContain('Кровотечение (Серьёзное)');
    expect(r.result.bleedingSourcesCreated).toHaveLength(1);
    const bleed = r.result.bleedingSourcesCreated[0]!;
    expect(bleed.severity).toBe('HEAVY');
    expect(bleed.normalization).toMatchObject({
      source: { kind: 'author-ruling' },
      record: 'Head 13 — Потеря глаза',
    });
    expect(bleed.consequence).toBe(lookupConsequence('HEAD', 13));
    expect(r.result.immediateBloodResolution[0]).toMatchObject({
      activity: 'REST',
      bloodLoss: 3,
      check: null,
      extraDie: null,
    });
    expect(r.result.bloodAfter.bloodLost).toBe(3);
    expect(r.result.damageTakenAfter).toBe(20);
    expect(r.result.injuriesCreated[0]!.features).toContainEqual({ type: 'eye-amputation' });
    expect(r.logs.at(-1)!.postDamage!.bleedingSourcesCreated[0]!.normalization).toBe(
      bleed.normalization,
    );
    expect(initial.state.actors.B!.blood.bloodLost).toBe(0);
    expect(r.result.pendingIntents.some((i) => i.reason.includes('not mapped'))).toBe(false);
  });
  it('normalized Heavy physical activity uses accepted 3+d5 and later turn pulses', () => {
    const r = resolvePostDamage(
      request({ damage: damage(13, 'Head'), facts: { ...facts, activity: 'PHYSICAL_ACTION' } }),
      rng({ sides: 5, value: 4 }),
    );
    expect(r.result.status).toBe('RESOLVED');
    expect(r.result.immediateBloodResolution[0]!.bloodLoss).toBe(7);
    expect(r.result.nestedDice).toEqual([{ sides: 5, value: 4 }]);
    const pulse = resolveBleedingPulse(
      { id: 'head13-next', actor, state: r.state, context: ctx(), facts },
      rng(),
    );
    expect(pulse.result.entries[0]!.source.severity).toBe('HEAVY');
    expect(pulse.result.entries[0]!.bloodLoss).toBe(3);
    expect(pulse.result.bloodAfter.bloodLost).toBe(10);
  });
  it('one-eye Head13 applies Blind, retaining the original title/text and normalized Heavy', () => {
    const r = resolvePostDamage(
      request({ damage: damage(13, 'Head'), facts: { ...facts, eyeCountBefore: 1 } }),
      rng(),
    );
    expect(r.state.actors.B!.conditions.some((c) => c.type === 'Blind')).toBe(true);
    expect(r.result.bleedingSourcesCreated[0]!.severity).toBe('HEAVY');
    expect(r.result.consequence!.title).toBe('Потеря глаза');
  });
  it('missing pre-injury eye count preserves complete transaction rollback', () => {
    const initial = deepFreeze(state());
    const r = resolvePostDamage(
      request({
        state: initial,
        damage: damage(13, 'Head'),
        facts: { provenance, activity: 'REST' },
      }),
      rng(),
    );
    expect(r.result.status).toBe('CONTEXT_REQUIRED');
    expect(r.state).toBe(initial);
    expect(r.result.mutations).toEqual([]);
  });
});

describe('C-2 one-resolution projection with selected source effects', () => {
  it.each([false, true])(
    'weapon characteristic effects remain immutable and apply exactly once (Blood halving %s)',
    (halve) => {
      const initial = state();
      const base = halve
        ? resolveBleedingPulse(
            { id: 'blood', actor, state: withBleeding(['HEAVY'], initial), context: ctx(), facts },
            rng(),
          ).state
        : initial;
      const combat = onBTurn(base.combat),
        weapon = combat.weapons['gun:B']!;
      const definition = {
        id: 'weapon-ns',
        target: {
          kind: 'characteristic' as const,
          characteristic: 'НС' as const,
          field: 'value' as const,
        },
        operation: 'add' as const,
        value: 10,
        stage: 'equipment' as const,
        stackingGroup: 'weapon-ns',
        stackingRule: 'largest' as const,
        tags: [],
        provenance,
      };
      const s = deepFreeze({
        ...base,
        combat: {
          ...combat,
          weapons: {
            ...combat.weapons,
            'gun:B': { ...weapon, template: { ...weapon.template, effects: [definition] } },
          },
        },
      });
      // Caller explicitly collects the selected weapon effects; the accepted resolver also collects them internally.
      const selected = {
        id: 'weapon:gun:B:weapon-ns',
        definition,
        targetActor: actor,
        source: { kind: 'weapon-instance', id: 'gun:B' },
        provenance,
      };
      const context = ctx({ effects: [selected] });
      const r = resolveWoundAwareAction(s, 'НС', context, (c, scoped) =>
        resolveRangedAttack(
          c,
          attack('weapon-effect', {
            actor,
            target: { actorId: 'A' },
            weaponId: 'gun:B',
            context: scoped,
          }),
          rng({ sides: 100, value: 31 }),
        ),
      );
      expect(r.resolution.result.check).toMatchObject({
        baseValue: halve ? 25 : 50,
        target: halve ? 35 : 60,
      });
      expect(r.state.combat.weapons['gun:B']!.template).toBe(s.combat.weapons['gun:B']!.template);
      expect(r.state.combat.weapons['gun:B']!.template.effects).toEqual([definition]);
      expect(r.state.combat.actors.B!.characteristics.НС!.baseValue).toBe(40);
      expect(r.projectionLog.woundCheck.resolvedValue).toBe(50);
      expect(s.combat.containers['mag:B']!.currentRounds).toBe(30);
      expect(r.state.combat.containers['mag:B']!.currentRounds).toBe(29);
    },
  );
});

it('C-2 Parry projection includes selected melee weapon effects once and restores immutable definitions', () => {
  const initial = state(),
    weapon = initial.combat.melee!.weapons['blade:B']!;
  const definition = {
    id: 'weapon-nr',
    target: {
      kind: 'characteristic' as const,
      characteristic: 'НР' as const,
      field: 'value' as const,
    },
    operation: 'add' as const,
    value: 20,
    stage: 'equipment' as const,
    stackingGroup: 'weapon-nr',
    stackingRule: 'largest' as const,
    tags: [],
    provenance,
  };
  const s = deepFreeze({
    ...initial,
    combat: {
      ...initial.combat,
      actors: { ...initial.combat.actors, B: { ...initial.combat.actors.B!, fatigue: 7 } },
      melee: {
        ...initial.combat.melee!,
        weapons: {
          ...initial.combat.melee!.weapons,
          'blade:B': { ...weapon, template: { ...weapon.template, effects: [definition] } },
        },
      },
    },
  });
  const context = ctx({
    effects: [
      {
        id: 'melee-weapon:blade:B:0:weapon-nr',
        definition,
        targetActor: actor,
        source: weapon.template.profile.source,
        provenance,
      },
    ],
  });
  const r = resolveWoundAwareAction(s, 'НР', context, (combat, c) =>
    resolveParry(
      combat,
      {
        ...action('weapon-parry', 'parry', 'B'),
        context: c,
        target: { actorId: 'A' },
        pool: 'normal',
        weaponId: 'blade:B',
        triggeringResolutionId: 'incoming',
        incomingOrigin: 'NORMAL',
      },
      1,
      rng({ sides: 100, value: 20 }),
    ),
  );
  expect(r.resolution.result.check).toMatchObject({ baseValue: 35, target: 35, totalDegrees: 2 });
  expect(r.resolution.result.counterattack).toBeNull();
  expect(r.state.combat.melee!.weapons['blade:B']!.template).toBe(
    s.combat.melee!.weapons['blade:B']!.template,
  );
  expect(r.state.combat.actors.B!.characteristics.НР!.baseValue).toBe(50);
});

it('Blood reserve refresh uses current bVN and quarter halving follows the exact current fraction', () => {
  const first = resolveBleedingPulse(
    { id: 'first', actor, state: withBleeding(['HEAVY']), context: ctx(), facts },
    rng(),
  ).state;
  expect(first.combat.actors.B!.effects.some((e) => e.id === 'blood:B:quarter')).toBe(true);
  const current = deepFreeze({
    ...first,
    combat: {
      ...first.combat,
      actors: {
        ...first.combat.actors,
        B: {
          ...first.combat.actors.B!,
          characteristics: {
            ...first.combat.actors.B!.characteristics,
            ВН: { baseValue: 100, baseSuper: 0 },
          },
        },
      },
    },
    actors: {
      B: {
        ...first.actors.B!,
        bleeding: first.actors.B!.bleeding.map((b) => ({ ...b, active: false })),
      },
    },
  });
  const second = resolveBleedingPulse(
    { id: 'refresh', actor, state: current, context: ctx(), facts },
    rng(),
  );
  expect(second.result.bloodAfter).toMatchObject({
    maxBlood: 14,
    reserveBonus: 10,
    bloodLost: 3,
    currentBlood: 11,
  });
  expect(second.state.combat.actors.B!.effects.some((e) => e.id === 'blood:B:quarter')).toBe(false);
  expect(first.actors.B!.blood).toMatchObject({ maxBlood: 8, bloodLost: 3 });
});
