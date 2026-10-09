import { describe, it, expect } from 'vitest';
import type { CombatActionState, MeleeAttackRequest, ParryRequest } from '@kadat/contracts';
import {
  resolveMeleeAttack,
  resolveParry,
  resolveMeleeDodge,
  resolveKnockdown,
  composeMeleeProfile,
  changeMeleeStanceGrip,
  resolveCombatAction,
  emptyActionContext,
  resolvePalisadeInterrupts,
} from '../src/index.js';
import {
  meleeAttack,
  meleeState,
  editMelee,
  setWeapon,
  meleeWeapon,
  action,
  rolls,
  fixtureSource,
  fixtureProvenance,
  onBTurn,
} from './b2-fixtures.js';
import { deepFreeze } from './fixtures.js';
import { advanceToNextOwnTurn } from './b1-fixtures.js';
function defense(type: 'parry' | 'dodge', actorId = 'B', pool: 'normal' | 'melee-only' = 'normal') {
  return {
    id: `defense:${actorId}`,
    type,
    context: emptyActionContext({ actorId }),
    weaponId: `blade:${actorId}`,
    pool,
  };
}
function parryRequest(changes: Partial<ParryRequest> = {}): ParryRequest {
  return {
    ...action('parry', 'parry', 'B'),
    type: 'parry',
    target: { actorId: 'A' },
    weaponId: 'blade:B',
    pool: 'normal',
    incomingOrigin: 'NORMAL',
    triggeringResolutionId: 'incoming',
    ...changes,
  };
}
function rejection(state: CombatActionState, request: MeleeAttackRequest, match?: RegExp) {
  const frozen = deepFreeze(state),
    before = JSON.stringify(state);
  expect(() => resolveMeleeAttack(frozen, request, rolls(31, 31, 31, 31))).toThrow(match);
  expect(JSON.stringify(state)).toBe(before);
}
describe('B2 acceptance melee', () => {
  it('AC-M01 Simple NR50 +10 raw31 =3 degrees Right Arm unresolved hit', () => {
    const state = deepFreeze(meleeState()),
      before = JSON.stringify(state);
    const r = resolveMeleeAttack(state, meleeAttack(), rolls(31));
    expect(r.result.targets[0]!.check).toMatchObject({
      target: 60,
      rawRoll: 31,
      totalDegrees: 3,
      outcome: 'success',
    });
    expect(r.result.targets[0]!.hit).toMatchObject({ location: 'Right Arm', origin: 'NORMAL' });
    expect(r.execution.odAfter).toBe(1);
    expect(JSON.stringify(state)).toBe(before);
  });
  it('AC-M02 Parry55 roll31 grants one undefendable Counterattack NR+0', () => {
    const state = meleeState(55);
    const p = resolveParry(state, parryRequest(), 1, rolls(31));
    expect(p.result).toMatchObject({
      cancelledHits: 1,
      survivingHits: 0,
      check: { totalDegrees: 3 },
      counterattack: { modifier: 0 },
    });
    const req = meleeAttack({
      ...action('counter', 'melee-attack', 'B'),
      origin: 'COUNTERATTACK',
      base: 'free',
      weaponId: 'blade:B',
      opportunityId: p.result.counterattack!.id,
      targets: [{ actor: { actorId: 'A' }, distance: 1 }],
    });
    const counter = resolveMeleeAttack(p.state, req, rolls(31));
    expect(counter.result.targets[0]!.check.target).toBe(55);
    expect(counter.execution.odBefore).toBe(0);
    expect(counter.state.session.turn?.od).toBe(2);
    expect(counter.state.melee!.counterattacks[0]!.spent).toBe(true);
    rejection(counter.state, { ...req, id: 'again' }, /opportunity/);
    rejection(p.state, {
      ...req,
      targets: [{ actor: { actorId: 'A' }, distance: 1, avoidance: defense('parry', 'A') }],
    });
    expect(() =>
      resolveParry(state, parryRequest({ incomingOrigin: 'COUNTERATTACK' }), 1, rolls()),
    ).toThrow(/cannot be Parried/);
  });
  it('AC-M03 Close Grip 2-degree Parry Counterattack +20 below normal threshold', () => {
    const state = editMelee(meleeState(), 'B', { grip: 'close' });
    const p = resolveParry(state, parryRequest(), 1, rolls(35));
    expect(p.result.check.totalDegrees).toBe(2);
    expect(p.result.counterattack?.modifier).toBe(20);
    const c = resolveMeleeAttack(
      p.state,
      meleeAttack({
        ...action('counter', 'melee-attack', 'B'),
        origin: 'COUNTERATTACK',
        base: 'free',
        weaponId: 'blade:B',
        opportunityId: p.result.counterattack!.id,
        targets: [{ actor: { actorId: 'A' }, distance: 1 }],
      }),
      rolls(31),
    );
    expect(c.result.targets[0]!.check.target).toBe(70);
  });
  it('AC-M04 Cautious -10 +10 Avoidance until next OWN turn, source unchanged', () => {
    const original = deepFreeze(meleeState());
    const r = resolveMeleeAttack(original, meleeAttack({ base: 'cautious' }), rolls(31));
    expect(r.result.targets[0]!.check.target).toBe(40);
    const active = r.state.actors.A!.effects;
    expect(active).toHaveLength(2);
    const p = resolveParry(
      onBTurn(r.state),
      parryRequest({
        ...action('A-parry', 'parry'),
        target: { actorId: 'B' },
        weaponId: 'blade:A',
      }),
      1,
      rolls(31),
    );
    expect(p.result.check.target).toBe(60);
    const d = resolveMeleeDodge(
      onBTurn(r.state),
      { ...action('A-dodge', 'dodge'), target: { actorId: 'B' } },
      'normal',
      rolls(31),
    );
    expect(d.result.check.target).toBe(60);
    const next = advanceToNextOwnTurn(r.state);
    expect(next.actors.A!.effects).toHaveLength(0);
    expect(original.actors.A!.characteristics.ЛВ.baseValue).toBe(50);
    expect(original.actors.A!.effects).toHaveLength(0);
  });
  it('AC-M05 Reckless +30 denies Dodge but permits Parry until next own turn', () => {
    const r = resolveMeleeAttack(meleeState(), meleeAttack({ base: 'reckless' }), rolls(31));
    expect(r.result.targets[0]!.check.target).toBe(80);
    expect(() =>
      resolveMeleeDodge(onBTurn(r.state), action('D', 'dodge'), 'normal', rolls()),
    ).toThrow(/Dodge prohibited/);
    expect(
      resolveParry(
        onBTurn(r.state),
        parryRequest({ ...action('P', 'parry'), weaponId: 'blade:A', target: { actorId: 'B' } }),
        1,
        rolls(31),
      ).result.check.target,
    ).toBe(50);
    expect(advanceToNextOwnTurn(r.state).actors.A!.effects).toHaveLength(0);
  });
  it('AC-M06 Charge 2OD movement SKR*3 ends in melee NR+20', () => {
    const r = resolveMeleeAttack(
      meleeState(),
      meleeAttack({ base: 'charge', movementDistance: 24 }),
      rolls(31),
    );
    expect(r.execution.odAfter).toBe(0);
    expect(r.result.targets[0]!.check.target).toBe(70);
    rejection(meleeState(), meleeAttack({ base: 'charge', movementDistance: 24.01 }), /Charge/);
    rejection(
      meleeState(),
      meleeAttack({ base: 'charge', targets: [{ actor: { actorId: 'B' }, distance: 4 }] }),
      /reach/,
    );
  });
  it('AC-M07 Defensive -20 extra melee-only reaction does not consume normal pool', () => {
    const state = editMelee(meleeState(), 'B', { stance: 'defensive' });
    const r = resolveMeleeAttack(
      state,
      meleeAttack({
        targets: [
          { actor: { actorId: 'B' }, distance: 1, avoidance: defense('dodge', 'B', 'melee-only') },
        ],
      }),
      rolls(31, 31),
    );
    expect(r.result.targets[0]!.check.target).toBe(40);
    expect(r.state.session.initiativeOrder[1]!.reactions.remaining).toBe(1);
    expect(r.state.melee!.actors.B!.meleeOnlyReactionRemaining).toBe(0);
    expect(r.logs.some((x) => x.action?.reactionScope === 'melee-only')).toBe(true);
    rejection(editMelee(meleeState(), 'A', { stance: 'defensive' }), meleeAttack(), /Defensive/);
  });
  it('AC-M07 Defensive shield exception costs2OD, Charge forbidden, Counterattack Called allowed', () => {
    let state = editMelee(meleeState(), 'A', { stance: 'defensive' });
    state = setWeapon(state, 'shield:A', {
      ...meleeWeapon('A', { family: 'shield' }),
      id: 'shield:A',
    });
    const r = resolveMeleeAttack(state, meleeAttack(), rolls(31));
    expect(r.execution.odAfter).toBe(0);
    rejection(state, meleeAttack({ base: 'charge' }), /Defensive/);
    const p = resolveParry(
      editMelee(meleeState(55), 'B', { stance: 'defensive' }),
      parryRequest(),
      1,
      rolls(31),
    );
    const c = resolveMeleeAttack(
      p.state,
      meleeAttack({
        ...action('counter', 'melee-attack', 'B'),
        origin: 'COUNTERATTACK',
        base: 'called',
        calledLocation: 'Head',
        weaponId: 'blade:B',
        opportunityId: p.result.counterattack!.id,
        targets: [{ actor: { actorId: 'A' }, distance: 1 }],
      }),
      rolls(21),
    );
    expect(c.result.targets[0]!.check.target).toBe(35);
    expect(c.result.targets[0]!.hit?.location).toBe('Head');
    expect(c.state.session.turn?.od).toBe(2);
  });
  it.each(['glaive', 'spear', 'bayonet'])(
    'AC-M08 Palisade %s preemptive single trigger and reset',
    (family) => {
      let state = setWeapon(meleeState(), 'blade:A', meleeWeapon('A', { family }));
      state = editMelee(state, 'A', { stance: 'palisade' });
      const req = meleeAttack({
        id: 'pal',
        origin: 'PALISADE_TRIGGER',
        base: 'free',
        trigger: {
          id: 'incoming',
          type: 'palisade',
          attacker: { actorId: 'B' },
          target: { actorId: 'A' },
          incomingReach: 1,
        },
      });
      const r = resolvePalisadeInterrupts(state, [req], rolls(31), (next) => {
        expect(next.melee!.actors.A!.palisadeSpent).toBe(true);
        return {
          ...resolveMeleeAttack(
            next,
            meleeAttack({
              ...action('enemy', 'melee-attack', 'B'),
              weaponId: 'blade:B',
              targets: [{ actor: { actorId: 'A' }, distance: 1 }],
              origin: 'OPPORTUNITY',
              base: 'free',
              trigger: {
                id: 'leaving',
                type: 'leaves-melee',
                attacker: { actorId: 'A' },
                target: { actorId: 'B' },
                engaged: true,
              },
            }),
            rolls(31),
          ),
        };
      });
      expect(r.interrupts[0]!.execution.odAfter).toBe(0);
      expect(r.triggering.state.session.turn?.od).toBe(2);
      rejection(r.triggering.state, { ...req, id: 'pal2' }, /Palisade/);
      rejection(state, meleeAttack({ base: 'charge' }));
      expect(() => resolveCombatAction(state, action('run', 'run'), rolls())).toThrow(/Palisade/);
      expect(advanceToNextOwnTurn(r.triggering.state).melee!.actors.A!.palisadeSpent).toBe(false);
    },
  );
  it('AC-M09 one-handed two-handed remove die / one-die fallback', () => {
    const profile = composeMeleeProfile(
      meleeWeapon('A', { handedness: 'two-handed' }),
      'one-handed',
      'normal',
    );
    expect(profile.nrModifier).toBe(-5);
    expect(profile.profile.reach).toBe(4);
    expect(profile.damageTransforms[0]).toMatchObject({ type: 'remove-die', value: 1 });
    const one = meleeWeapon('A', {
      handedness: 'two-handed',
      damage: { source: fixtureSource, expression: { count: 1, sides: 10, modifier: 0 } },
    });
    expect(composeMeleeProfile(one, 'one-handed', 'normal').damageTransforms[0]).toMatchObject({
      type: 'add',
      value: -4,
    });
  });
  it.each(['normal', 'stun', 'knockdown'] as const)(
    'AC-M09 two-handed on one-handed %s correct total modifier',
    (technique) => {
      const p = composeMeleeProfile(meleeWeapon('A'), 'two-handed', technique);
      expect(p.nrModifier).toBe(technique === 'normal' ? 5 : 10);
      expect(p.damageTransforms[0]).toMatchObject({ type: 'add', value: 3 });
    },
  );
  it('AC-M09 Close reach clamp, Accurate retained without invented semantics', () => {
    const p = composeMeleeProfile(meleeWeapon('A', { reach: 1 }), 'close', 'normal');
    expect(p.profile.reach).toBe(0);
    expect(p.profile.properties).toContainEqual({
      kind: 'canonical-property-reference',
      id: 'Точное / Accurate',
    });
  });
  it.each(['axe', 'hook', 'hammer'])('AC-M09 Fist %s reach1 damage-2', (family) => {
    const p = composeMeleeProfile(meleeWeapon('A', { family }), 'fist', 'normal');
    expect(p.profile.reach).toBe(1);
    expect(p.damageTransforms[0]?.value).toBe(-2);
  });
  it('AC-M09 Mordhau explicit canonical mace substitute used two-handed', () => {
    const weapon = {
      ...meleeWeapon('A'),
      mordhauProfile: meleeWeapon('A', { family: 'mace' }).template.profile,
    };
    const p = composeMeleeProfile(weapon, 'mordhau', 'normal');
    expect(p.nrModifier).toBe(-5);
    expect(p.profile.family).toBe('mace');
    expect(p.profile.properties.some((x) => x.id.includes('two-handed'))).toBe(true);
    expect(p.profile.damage).toBe(weapon.mordhauProfile.damage);
  });
  it.each(['dodge', 'parry'] as const)('AC-M10 Lunge reach+1 %s contextual modifier', (type) => {
    const r = resolveMeleeAttack(
      meleeState(),
      meleeAttack({
        technique: 'lunge',
        targets: [{ actor: { actorId: 'B' }, distance: 4, avoidance: defense(type) }],
      }),
      rolls(31, 41),
    );
    expect(r.result.composition.profile.reach).toBe(4);
    expect(r.result.targets[0]!.avoidance?.check.target).toBe(type === 'dodge' ? 60 : 40);
  });
  it('AC-M11 Stun suppresses damage, complete provenance typed half-ceil intent', () => {
    const r = resolveMeleeAttack(meleeState(), meleeAttack({ technique: 'stun' }), rolls(31));
    const t = r.result.targets[0]!;
    expect(t.check.target).toBe(40);
    expect(t.hit).toBeNull();
    expect(t.intents[0]).toMatchObject({
      type: 'StunDurationIntent',
      durationTransform: { multiplier: 0.5, rounding: 'ceil' },
      damage: { expression: { count: 2, sides: 10, modifier: 3 } },
    });
    expect(t.intents[0]!.provenance.length).toBeGreaterThan(0);
  });
  it('AC-M12 Knockdown Athletics win 5 degrees prone Fatigue and1d5+bSL intent', () => {
    const r = resolveKnockdown(
      meleeState(),
      meleeAttack({ technique: 'knockdown' }),
      emptyActionContext({ actorId: 'B' }),
      rolls(6, 70),
    );
    expect(r.result.opposed.attackerCheck.totalDegrees).toBe(5);
    expect(r.state.actors.B).toMatchObject({ posture: 'prone', fatigue: 1 });
    expect(r.result.intents[0]!.damage?.expression).toEqual({ count: 1, sides: 5, modifier: 5 });
  });
  it('AC-M20 melee96-100 drops weapon only once canonical template unchanged', () => {
    for (let value = 96; value <= 100; value++) {
      const state = deepFreeze(meleeState());
      const r = resolveMeleeAttack(state, meleeAttack(), rolls(value));
      expect(r.state.melee!.weapons['blade:A']).toMatchObject({
        held: false,
        readied: false,
        dropped: true,
      });
      expect(r.state.melee!.weapons['blade:A']!.template).toBe(
        state.melee!.weapons['blade:A']!.template,
      );
      expect(r.result.targets[0]!.check.rawRoll).toBe(value);
    }
  });
  it('Free Attack explicit opportunity costs no ordinary attack slot', () => {
    const r = resolveMeleeAttack(
      meleeState(),
      meleeAttack({
        origin: 'OPPORTUNITY',
        base: 'free',
        trigger: {
          id: 'leave',
          type: 'leaves-melee',
          attacker: { actorId: 'B' },
          target: { actorId: 'A' },
          engaged: true,
        },
      }),
      rolls(31),
    );
    expect(r.result.targets[0]!.check.target).toBe(50);
    expect(r.state.session.turn!.flags).toEqual([]);
    expect(r.state.session.turn!.od).toBe(2);
  });
  it('stance and grip simultaneously change free with canonical profile validation', () => {
    const s = setWeapon(meleeState(), 'blade:A', meleeWeapon('A', { family: 'spear' }));
    const r = changeMeleeStanceGrip(s, {
      ...action('change', 'change-stance-grip'),
      type: 'change-stance-grip',
      stance: 'palisade',
      grip: 'two-handed',
    });
    expect(r.result).toEqual({ stance: 'palisade', grip: 'two-handed' });
    expect(r.execution.odAfter).toBe(2);
  });
  it('Called single strike no Simple+10, body location override and cost2', () => {
    const r = resolveMeleeAttack(
      meleeState(),
      meleeAttack({ base: 'called', calledLocation: 'Torso' }),
      rolls(31),
    );
    expect(r.result.targets[0]!.check.target).toBe(40);
    expect(r.result.targets[0]!.hit?.location).toBe('Torso');
    expect(r.execution.odAfter).toBe(0);
  });
});

describe('Wide Sweep direct author ruling', () => {
  it('one shared raw31, independent targets/degrees, cost/slot once, same location', () => {
    const req = meleeAttack({
      technique: 'wide-sweep',
      targets: [
        { actor: { actorId: 'B' }, distance: 1 },
        {
          actor: { actorId: 'C' },
          distance: 1,
          context: {
            ...emptyActionContext({ actorId: 'A' }),
            modifiers: [
              { id: 'targetC', value: -20, source: fixtureSource, provenance: fixtureProvenance },
            ],
          },
        },
      ],
    });
    const r = resolveMeleeAttack(meleeState(), req, rolls(31));
    expect(r.execution.odAfter).toBe(1);
    expect(r.state.session.turn!.flags).toHaveLength(1);
    expect(
      r.result.targets.map((t) => [t.check.rawRoll, t.check.target, t.check.totalDegrees]),
    ).toEqual([
      [31, 60, 3],
      [31, 40, 1],
    ]);
    expect(r.result.targets.every((t) => t.hit?.location === 'Right Arm')).toBe(true);
    expect(r.result.targets[0]!.hit?.damageTransforms).toContainEqual(
      expect.objectContaining({ type: 'multiply', value: 0.5, rounding: 'ceil' }),
    );
    const log = r.logs.find((x) => x.melee);
    expect(log?.dice).toEqual([{ sides: 100, value: 31 }]);
    expect(log?.melee?.targets).toHaveLength(2);
  });
  it('target-specific failure and independent Parry+10/Dodge-10 never both', () => {
    const r = resolveMeleeAttack(
      meleeState(),
      meleeAttack({
        technique: 'wide-sweep',
        targets: [
          { actor: { actorId: 'B' }, distance: 1, avoidance: defense('parry') },
          { actor: { actorId: 'C' }, distance: 1, avoidance: defense('dodge', 'C') },
        ],
      }),
      rolls(31, 45, 45),
    );
    expect(r.result.targets[0]!.avoidance?.check.target).toBe(60);
    expect(r.result.targets[0]!.hit).toBeNull();
    expect(r.result.targets[1]!.avoidance?.check.target).toBe(40);
    expect(r.result.targets[1]!.hit).not.toBeNull();
    expect(r.result.targets.map((x) => x.check.rawRoll)).toEqual([31, 31]);
  });
  it('one raw96 and one drop for entire sweep no defensive rolls or hits', () => {
    const r = resolveMeleeAttack(
      meleeState(),
      meleeAttack({
        technique: 'wide-sweep',
        targets: [
          { actor: { actorId: 'B' }, distance: 1 },
          { actor: { actorId: 'C' }, distance: 1 },
        ],
      }),
      rolls(96),
    );
    expect(r.result.dropped).toBe(true);
    expect(r.state.session.turn!.flags).toHaveLength(1);
    expect(r.result.targets.every((x) => x.hit === null)).toBe(true);
  });
  it('GM override one-resolution effect/grip modifier source immutable', () => {
    const s = deepFreeze(editMelee(meleeState(), 'A', { grip: 'two-handed' }));
    const r = resolveMeleeAttack(
      s,
      meleeAttack({
        context: {
          ...emptyActionContext({ actorId: 'A' }),
          overrides: [
            {
              subject: 'modifier',
              id: 'melee:grip',
              operation: 'MODIFY',
              value: 20,
              reason: 'GM temporary',
              origin: 'gm',
            },
          ],
        },
      }),
      rolls(31),
    );
    expect(r.result.targets[0]!.check.target).toBe(80);
    expect(s.melee!.actors.A!.grip).toBe('two-handed');
    expect(s.melee!.weapons['blade:A']!.template.profile.handedness).toBe('one-handed');
  });
});

describe('B2 shared hooks regression', () => {
  it('accepted Quick Aim composes with NR and is consumed without source mutation', () => {
    const aimed = resolveCombatAction(meleeState(), action('aim', 'quick-aim'), rolls());
    const r = resolveMeleeAttack(deepFreeze(aimed.state), meleeAttack(), rolls(31));
    expect(r.result.targets[0]!.check.target).toBe(70);
    expect(r.state.actors.A!.aim).toBeUndefined();
    expect(aimed.state.actors.A!.aim?.modifier).toBe(10);
  });
  it('Careful Aim only ignores canonically tagged penalties, preserves source/provenance', () => {
    const aim = resolveCombatAction(meleeState(), action('aim', 'careful-aim'), rolls());
    const s = advanceToNextOwnTurn(aim.state); // Aim persists under accepted B1 lifecycle.
    const original = deepFreeze(s);
    const speed = {
      id: 'speed',
      value: -20,
      tags: ['careful-aim:target-speed'],
      source: fixtureSource,
      provenance: fixtureProvenance,
    };
    const other = { ...speed, id: 'other', tags: [], value: -10 };
    const r = resolveMeleeAttack(
      original,
      meleeAttack({
        context: { ...emptyActionContext({ actorId: 'A' }), modifiers: [speed, other] },
      }),
      rolls(31),
    );
    expect(r.result.targets[0]!.check.target).toBe(70);
    expect(r.result.targets[0]!.check.modifiers.find((m) => m.id === 'speed')).toMatchObject({
      included: false,
      originalValue: -20,
      override: { operation: 'EXCLUDE' },
    });
    expect(speed.value).toBe(-20);
  });
  it('effect replacement of melee base uses existing context modifier infrastructure', () => {
    let s = meleeState();
    const definition = {
      id: 'replace-base',
      target: { kind: 'combat-modifier' as const, key: 'melee:base' },
      operation: 'set' as const,
      value: 25,
      stage: 'equipment' as const,
      stackingGroup: 'base',
      stackingRule: 'independent' as const,
      tags: [],
      provenance: fixtureProvenance,
    };
    const w = s.melee!.weapons['blade:A']!;
    s = setWeapon(s, w.id, { ...w, template: { ...w.template, effects: [definition] } });
    const r = resolveMeleeAttack(deepFreeze(s), meleeAttack(), rolls(31));
    expect(r.result.targets[0]!.check.target).toBe(75);
    expect(r.result.targets[0]!.check.modifiers.find((m) => m.id === 'melee:base')?.included).toBe(
      false,
    );
    expect(w.template.effects).toEqual([]);
  });
  it('GM Parry grip override is one-resolution and available before defense validation', () => {
    const avoidance = {
      ...defense('parry'),
      context: {
        ...emptyActionContext({ actorId: 'B' }),
        overrides: [
          {
            subject: 'modifier' as const,
            id: 'melee:grip',
            operation: 'MODIFY' as const,
            value: 10,
            reason: 'one Parry',
            origin: 'gm' as const,
          },
        ],
      },
    };
    const r = resolveMeleeAttack(
      meleeState(),
      meleeAttack({ targets: [{ actor: { actorId: 'B' }, distance: 1, avoidance }] }),
      rolls(31, 41),
    );
    expect(r.result.targets[0]!.avoidance?.check.target).toBe(60);
  });
  it('additional effects can grant one Counterattack below3 degrees, never several', () => {
    const s = meleeState();
    const effect = (id: string) => ({
      id,
      source: fixtureSource,
      targetActor: { actorId: 'B' },
      provenance: fixtureProvenance,
      definition: {
        id,
        target: { kind: 'permission' as const, permission: 'counterattack' as const },
        operation: 'grant' as const,
        value: 1,
        stage: 'temporary' as const,
        stackingGroup: id,
        stackingRule: 'independent' as const,
        tags: [],
        provenance: fixtureProvenance,
      },
    });
    const state = {
      ...s,
      actors: { ...s.actors, B: { ...s.actors.B!, effects: [effect('one'), effect('two')] } },
    };
    const r = resolveParry(state, parryRequest(), 1, rolls(45));
    expect(r.result.check.totalDegrees).toBe(1);
    expect(r.state.melee!.counterattacks).toHaveLength(1);
    expect(r.result.counterattack!.provenance).toHaveLength(3);
  });
  it('Palisade successive requests revalidate before spending and skip spent trigger', () => {
    const s = editMelee(
      setWeapon(meleeState(), 'blade:A', meleeWeapon('A', { family: 'spear' })),
      'A',
      { stance: 'palisade' },
    );
    const req = meleeAttack({
      id: 'pal1',
      base: 'free',
      origin: 'PALISADE_TRIGGER',
      trigger: {
        id: 'enemy',
        type: 'palisade',
        attacker: { actorId: 'B' },
        target: { actorId: 'A' },
        incomingReach: 1,
      },
    });
    const r = resolvePalisadeInterrupts(s, [req, { ...req, id: 'pal2' }], rolls(31), (next) =>
      resolveCombatAction(next, action('enemy-ready', 'prone'), rolls()),
    );
    expect(r.interrupts).toHaveLength(1);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]!.actionId).toBe('pal2');
    expect(r.logs.some((log) => log.palisadeSkipped)).toBe(true);
    expect(r.triggering.state.completedActionIds).not.toContain('pal2');
  });
});

describe('B2 final composition boundaries', () => {
  it('Knockdown remains Athletics+0, NR-only grip+10 retained as composition metadata', () => {
    const s = editMelee(meleeState(), 'A', { grip: 'two-handed' });
    const r = resolveKnockdown(
      s,
      meleeAttack({ technique: 'knockdown' }),
      emptyActionContext({ actorId: 'B' }),
      rolls(20, 70),
    );
    expect(r.result.composition.nrModifier).toBe(10);
    expect(r.result.opposed.attackerCheck.target).toBe(50);
  });
  it('Cautious reapplication keeps the authorized +10 rather than duplicating same bonus', () => {
    const extra = {
      id: 'two-attacks',
      source: fixtureSource,
      targetActor: { actorId: 'A' },
      provenance: fixtureProvenance,
      definition: {
        id: 'two-attacks',
        target: { kind: 'permission' as const, permission: 'attack' as const },
        operation: 'grant' as const,
        value: 1,
        stage: 'temporary' as const,
        stackingGroup: 'extra',
        stackingRule: 'independent' as const,
        tags: [],
        provenance: fixtureProvenance,
      },
    };
    const s = meleeState();
    const state = { ...s, actors: { ...s.actors, A: { ...s.actors.A!, effects: [extra] } } };
    const first = resolveMeleeAttack(state, meleeAttack({ base: 'cautious' }), rolls(31));
    const second = resolveMeleeAttack(
      first.state,
      meleeAttack({ id: 'second', base: 'cautious' }),
      rolls(31),
    );
    const p = resolveParry(
      onBTurn(second.state),
      parryRequest({
        ...action('A-parry', 'parry'),
        weaponId: 'blade:A',
        target: { actorId: 'B' },
      }),
      1,
      rolls(31),
    );
    expect(p.result.check.target).toBe(60);
  });
});
it('Avoidance-only equipment effect cannot become an attack modifier', () => {
  const original = meleeState();
  const effect = {
    id: 'defense-only',
    source: fixtureSource,
    targetActor: { actorId: 'A' },
    provenance: fixtureProvenance,
    definition: {
      id: 'defense-only',
      target: { kind: 'combat-modifier' as const, key: 'melee:avoidance' },
      operation: 'add' as const,
      value: 15,
      stage: 'equipment' as const,
      stackingGroup: 'defense-only',
      stackingRule: 'independent' as const,
      tags: [],
      provenance: fixtureProvenance,
    },
  };
  const s = {
    ...original,
    actors: { ...original.actors, A: { ...original.actors.A!, effects: [effect] } },
  };
  const r = resolveMeleeAttack(deepFreeze(s), meleeAttack(), rolls(31));
  expect(r.result.targets[0]!.check.target).toBe(60);
  const p = resolveParry(
    onBTurn(r.state),
    parryRequest({ ...action('A-parry', 'parry'), target: { actorId: 'B' }, weaponId: 'blade:A' }),
    1,
    rolls(31),
  );
  expect(p.result.check.target).toBe(65);
});
it('independent Wide Sweep Parries each retain their own triggering resolution identity', () => {
  const r = resolveMeleeAttack(
    meleeState(55),
    meleeAttack({
      technique: 'wide-sweep',
      targets: [
        { actor: { actorId: 'B' }, distance: 1, avoidance: { ...defense('parry'), id: 'Parry-B' } },
        {
          actor: { actorId: 'C' },
          distance: 1,
          avoidance: { ...defense('parry', 'C'), id: 'Parry-C' },
        },
      ],
    }),
    rolls(31, 31, 31),
  );
  expect(r.state.melee!.counterattacks.map((c) => c.triggeringResolutionId)).toEqual([
    'Parry-B',
    'Parry-C',
  ]);
  expect(r.result.targets.every((t) => t.avoidance?.cancelledHits === 1)).toBe(true);
});
