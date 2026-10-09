import { describe, it, expect, vi } from 'vitest';
import {
  resolvePostDamage,
  resolveBleedingPulse,
  lookupConsequence,
  planWoundCondition,
  bloodThresholds,
  projectWoundCheck,
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
const actor = { actorId: 'B' };
function pulse(
  initial = withBleeding(['LIGHT']),
  dice = rng({ sides: 100, value: 90 }),
  contextFacts = facts,
) {
  return resolveBleedingPulse(
    { id: 'pulse', actor, state: initial, context: ctx(), facts: contextFacts },
    dice,
  );
}

describe('C-2 mandatory acceptance', () => {
  it('AC-CW01 accumulated damage uses this hit finalDamage', () => {
    const r = resolvePostDamage(request(), rng());
    expect(r.result.damageTakenAfter).toBe(12);
    expect(r.result.consequenceSeverity).toBe(5);
  });
  it('AC-CW02 crossing Wounds never substitutes accumulated severity', () => {
    const s = state(),
      actor = s.actors.B!;
    const r = resolvePostDamage(
      request({ state: { ...s, actors: { B: { ...actor, maxWounds: 10 } } } }),
      rng(),
    );
    expect(r.result.woundStateAfter).toBe('Critical Wounded');
    expect(r.result.consequence!.minimum).toBe(5);
    expect(r.result.consequenceSeverity).toBe(5);
  });
  it('AC-CW03 critical die affects severity only', () => {
    const r = resolvePostDamage(
      request({ damage: damage(5, 'Torso', true) }),
      rng({ sides: 10, value: 6 }, { sides: 10, value: 4 }),
    );
    expect(r.result.damageTakenAfter).toBe(12);
    expect(r.result.consequenceSeverity).toBe(11);
    expect(r.result.criticalConsequenceDie).toEqual({ sides: 10, value: 6 });
  });
  it('AC-CW04 exactly one critical consequence d10; count >1 rejected', () => {
    const roll = vi.fn(() => 2);
    const req = request({ damage: damage(0, 'Head', true) });
    const r = resolvePostDamage(req, { roll });
    expect(r.result.consequenceSeverity).toBe(2);
    expect(roll).toHaveBeenCalledExactlyOnceWith(10);
    expect(() =>
      resolvePostDamage(
        { ...req, damage: { ...req.damage, criticalConsequenceDiceCount: 2 as 1 } },
        rng(),
      ),
    ).toThrow(/invariant/);
  });
  it('AC-CW05 noncritical zero creates no consequence/injury/bleeding', () => {
    const r = resolvePostDamage(request({ damage: damage(0) }), rng());
    expect(r.result.damageTakenAfter).toBe(7);
    expect(r.result.consequence).toBeNull();
    expect(r.result.injuriesCreated).toEqual([]);
    expect(r.result.bleedingSourcesCreated).toEqual([]);
  });
  it('AC-CW06 critical zero still resolves severity from d10', () => {
    const r = resolvePostDamage(
      request({ damage: damage(0, 'Right Arm', true) }),
      rng({ sides: 10, value: 7 }, { sides: 100, value: 5 }),
    );
    expect(r.result.consequenceSeverity).toBe(7);
    expect(r.result.damageTakenAfter).toBe(7);
    expect(r.result.injuriesCreated).toHaveLength(1);
  });
  it('AC-CW07 Head15 boundary', () => {
    expect(lookupConsequence('HEAD', 15)!.title).toBe('Расколотый череп');
  });
  it('AC-CW08 Arm12 range', () => {
    expect(lookupConsequence('ARM', 12)!).toMatchObject({
      range: '11-12',
      title: 'Рассечённая кисть',
    });
  });
  it('AC-CW09 Torso18 range', () => {
    expect(lookupConsequence('TORSO', 18)!).toMatchObject({
      range: '17-19',
      title: 'Сломанный позвоночник',
    });
  });
  it('AC-CW10 Leg20 range', () => {
    expect(lookupConsequence('LEG', 20)!).toMatchObject({
      range: '20+',
      title: 'Жестокое расчленение',
    });
  });
  it('AC-CW11 multiple injuries in same zone coexist', () => {
    const first = resolvePostDamage(request(), rng());
    const second = resolvePostDamage(
      request({ state: first.state, damage: damage(5, 'Torso', false, 'cw-hit2') }),
      rng(),
    );
    expect(second.state.actors.B!.injuries.map((i) => i.id)).toEqual([
      'cw-hit:injury',
      'cw-hit2:injury',
    ]);
    expect(first.state.actors.B!.injuries).toHaveLength(1);
  });
  it('AC-CW12 Light successful VN loses0; failed VN loses1', () => {
    expect(
      pulse(withBleeding(['LIGHT']), rng({ sides: 100, value: 10 })).result.bloodAfter.bloodLost,
    ).toBe(0);
    expect(pulse().result.bloodAfter.bloodLost).toBe(1);
  });
  it('AC-CW13 Medium failed VN loses2', () => {
    expect(pulse(withBleeding(['MEDIUM'])).result.bloodAfter.bloodLost).toBe(2);
  });
  it('AC-CW14 Heavy REST loses3 without resistance roll', () => {
    expect(pulse(withBleeding(['HEAVY']), rng()).result.bloodAfter.bloodLost).toBe(3);
  });
  it('AC-CW15 Heavy PHYSICAL_ACTION d5=4 loses7', () => {
    const r = pulse(withBleeding(['HEAVY']), rng({ sides: 5, value: 4 }), {
      ...facts,
      activity: 'PHYSICAL_ACTION',
    });
    expect(r.result.bloodAfter.bloodLost).toBe(7);
    expect(r.result.entries[0]!.extraDie).toEqual({ sides: 5, value: 4 });
  });
  it('AC-CW16 separate source blood losses sum', () => {
    const r = pulse(
      withBleeding(['LIGHT', 'MEDIUM']),
      rng({ sides: 100, value: 90 }, { sides: 100, value: 90 }),
    );
    expect(r.result.entries.map((e) => e.bloodLoss)).toEqual([1, 2]);
    expect(r.result.bloodAfter.bloodLost).toBe(3);
    expect(r.state.actors.B!.bleeding).toHaveLength(2);
  });
  it('AC-CW17 two Lights do not merge into Medium', () => {
    const r = pulse(
      withBleeding(['LIGHT', 'LIGHT']),
      rng({ sides: 100, value: 90 }, { sides: 100, value: 90 }),
    );
    expect(r.state.actors.B!.bleeding.map((b) => b.severity)).toEqual(['LIGHT', 'LIGHT']);
    expect(r.result.bloodAfter.bloodLost).toBe(2);
  });
  it('AC-CW18 missing activity is typed context-required with no Blood change', () => {
    const initial = deepFreeze(withBleeding(['HEAVY']));
    const r = resolveBleedingPulse({ id: 'missing', actor, state: initial, context: ctx() }, rng());
    expect(r.result.status).toBe('CONTEXT_REQUIRED');
    expect(r.result.pendingIntents[0]!.type).toBe('BleedingActivityContextRequired');
    expect(r.state).toBe(initial);
    expect(r.result.mutations).toEqual([]);
  });
  it('AC-CW19 reserve7 loss2 crosses quarter and halves checks, not base', () => {
    const initial = withBleeding(['LIGHT'], state(30));
    const s = {
      ...initial,
      actors: {
        B: {
          ...initial.actors.B!,
          blood: { ...initial.actors.B!.blood, bloodLost: 1, currentBlood: 6 },
        },
      },
    };
    const r = pulse(deepFreeze(s));
    expect(r.result.thresholdsCrossed).toEqual(['quarter']);
    expect(r.result.bloodAfter.maxBlood).toBe(7);
    const projected = projectWoundCheck(r.state, 'ВН', ctx());
    expect(projected.projection.checkValue).toBe(15);
    expect(r.state.combat.actors.B!.characteristics.ВН!.baseValue).toBe(30);
  });
  it('AC-CW20 reserve7 loss4 adds indefinite blood-replacement Stunned', () => {
    const initial = withBleeding(['HEAVY'], state(30)),
      s = {
        ...initial,
        actors: {
          B: {
            ...initial.actors.B!,
            blood: { ...initial.actors.B!.blood, bloodLost: 1, currentBlood: 6 },
          },
        },
      };
    const r = pulse(s, rng());
    const c = r.state.actors.B!.conditions.find((c) => c.id === 'blood:B:half')!;
    expect(c.type).toBe('Stunned');
    expect(c.duration).toBeNull();
    expect(c.removal).toBe('blood-replacement');
    expect(c.effects.map((e) => e.definition.operation)).toEqual(['restrict', 'restrict']);
  });
  it('AC-CW21 reserve7 loss6 applies Unconscious plus bVN-minute death', () => {
    const initial = withBleeding(['HEAVY'], state(30)),
      s = {
        ...initial,
        actors: {
          B: {
            ...initial.actors.B!,
            blood: { ...initial.actors.B!.blood, bloodLost: 3, currentBlood: 4 },
          },
        },
      };
    const r = pulse(s, rng());
    expect(r.result.bloodAfter.bloodLost).toBe(6);
    expect(bloodThresholds(r.result.bloodAfter).threeQuarters).toBe(true);
    expect(r.state.actors.B!.conditions.some((c) => c.type === 'Unconscious')).toBe(true);
    expect(r.state.actors.B!.intents.find((i) => i.type === 'TimedDeathIntent')!.duration).toEqual({
      unit: 'minute',
      amount: 3,
    });
  });
  it('AC-CW22 limb Death uses Agony8, application round first', () => {
    const r = resolvePostDamage(request({ damage: damage(20, 'Right Arm') }), rng());
    expect(r.state.actors.B!.life).toMatchObject({
      status: 'AGONY',
      durationRounds: 8,
      startedRound: 1,
      expiresAfterRound: 8,
    });
  });
  it('AC-CW23 destroyed Head is immediate Death without Agony', () => {
    const r = resolvePostDamage(request({ damage: damage(15, 'Head') }), rng());
    expect(r.result.lifeAfter.status).toBe('DEAD');
    expect(r.state.combat.session.conditions.some((c) => c.type === 'Agony')).toBe(false);
  });
  it('AC-CW24 destroyed Torso is immediate Death without Agony', () => {
    const r = resolvePostDamage(request({ damage: damage(20, 'Torso') }), rng());
    expect(r.result.lifeAfter.status).toBe('DEAD');
    expect(r.state.combat.session.conditions.some((c) => c.type === 'Agony')).toBe(false);
  });
  it('AC-CW25 remaining Stunned2 + consequenceStunned3 =5', () => {
    const a = planWoundCondition(state(), actor, 'existing', 'Stunned', provenance, {
      unit: 'round',
      amount: 2,
    });
    const b = planWoundCondition(a.state, actor, 'consequence', 'Stunned', provenance, {
      unit: 'round',
      amount: 3,
    });
    expect(b.state.combat.session.conditions.filter((c) => c.type === 'Stunned')).toHaveLength(1);
    expect(b.state.combat.session.conditions[0]!.durationRounds).toBe(5);
  });
  it('AC-CW26 literal raw gain -3 applies0 and never removes existing Fatigue', () => {
    const initial = state(),
      s = {
        ...initial,
        combat: {
          ...initial.combat,
          actors: { ...initial.combat.actors, B: { ...initial.combat.actors.B!, fatigue: 5 } },
        },
      };
    const r = resolvePostDamage(
      request({ state: s, damage: damage(11) }),
      rng({ sides: 10, value: 1 }),
    );
    expect(r.result.fatigue[0]).toMatchObject({
      bVN: 4,
      rawFatigueGain: -3,
      appliedFatigueGain: 0,
      fatigueBefore: 5,
      fatigueAfter: 5,
      roll: { value: 1 },
    });
    expect(r.state.combat.actors.B!.fatigue).toBe(5);
  });
  it('AC-CW27 same concrete limb escalates17-19 to20+, other limb does not', () => {
    const first = resolvePostDamage(request({ damage: damage(17, 'Right Arm') }), rng());
    expect(first.result.consequence!.range).toBe('17-19');
    const other = resolvePostDamage(
      request({ state: first.state, damage: damage(1, 'Left Arm', false, 'other') }),
      rng(),
    );
    expect(other.result.consequence!.range).toBe('1');
    const same = resolvePostDamage(
      request({ state: other.state, damage: damage(1, 'Right Arm', false, 'same') }),
      rng(),
    );
    expect(same.result.consequence!.range).toBe('20+');
    expect(same.result.lifeAfter.status).toBe('AGONY');
    expect(same.result.escalatedBy).toEqual(['cw-hit:injury']);
  });
  it('AC-CW28 full provenance/log retains hit/row/dice/Injury/bleed/Blood', () => {
    const r = resolvePostDamage(
      request({ damage: damage(3, 'Right Arm') }),
      rng({ sides: 100, value: 90 }),
    );
    const log = r.logs.at(-1)!;
    expect(log.postDamage).toBe(r.result);
    expect(log.postDamage!.hitId).toBe('cw-hit');
    expect(log.postDamage!.consequence!.provenance.record).toContain('A54:F70');
    expect(log.dice).toEqual([{ sides: 100, value: 90 }]);
    expect(log.postDamage!.injuriesCreated[0]!.bleedingSourceIds).toEqual([
      'cw-hit:injury:bleed:0',
    ]);
    expect(log.postDamage!.bloodAfter.bloodLost).toBe(1);
    expect(log.mutations).not.toEqual([]);
  });
  it('AC-CW29 missing required immediate context rolls back entire hit', () => {
    const initial = deepFreeze(state());
    const req = request({ state: initial, damage: damage(3, 'Right Arm') });
    const { facts: unused, ...noFacts } = req;
    void unused;
    const r = resolvePostDamage(noFacts, rng());
    expect(r.result.status).toBe('CONTEXT_REQUIRED');
    expect(r.state).toBe(initial);
    expect(r.state.actors.B!.damageTaken).toBe(7);
    expect(r.state.actors.B!.injuries).toEqual([]);
    expect(r.state.actors.B!.blood.bloodLost).toBe(0);
    expect(r.result.mutations).toEqual([]);
  });
  it('AC-CW30 C-1/Actor/Weapon/Armor/catalog data stays immutable', () => {
    const initial = deepFreeze(state()),
      req = deepFreeze(request({ state: initial })),
      snapshot = JSON.stringify(req),
      row = lookupConsequence('TORSO', 5)!;
    const rowBefore = JSON.stringify(row);
    const r = resolvePostDamage(req, rng());
    expect(JSON.stringify(req)).toBe(snapshot);
    expect(JSON.stringify(row)).toBe(rowBefore);
    expect(r.result.damage).toBe(req.damage);
    expect(r.state.combat.actors.B!.characteristics).toBe(initial.combat.actors.B!.characteristics);
    expect(r.state.combat.melee!.weapons['blade:B']!.template).toBe(
      initial.combat.melee!.weapons['blade:B']!.template,
    );
  });
});
