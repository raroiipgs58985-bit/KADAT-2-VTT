import { it, describe, expect } from 'vitest';
import type { GrappleAction, CombatActionState } from '@kadat/contracts';
import {
  resolveGrappleAction,
  resolveMeleeAttack,
  resolveCombatAction,
  emptyActionContext,
  resolveMeleeOpposedAction,
  resolveBreakthrough,
  resolveMeleeDodge,
} from '../src/index.js';
import {
  meleeState,
  meleeAttack,
  grappleState,
  grappleRequest,
  editMelee,
  action,
  rolls,
  onBTurn,
  fixtureSource,
} from './b2-fixtures.js';
import { deepFreeze } from './fixtures.js';
import { advanceToNextOwnTurn } from './b1-fixtures.js';
function posture(
  state: CombatActionState,
  id: string,
  value: 'standing' | 'prone',
): CombatActionState {
  return { ...state, actors: { ...state.actors, [id]: { ...state.actors[id]!, posture: value } } };
}
describe('B2 Grapple acceptance', () => {
  it('AC-M13 entry after failed Dodge; no Reactions/non-Grapple; external attack+20', () => {
    const initial = deepFreeze(meleeState());
    const r = resolveMeleeAttack(
      initial,
      meleeAttack({
        technique: 'grapple',
        targets: [
          {
            actor: { actorId: 'B' },
            distance: 1,
            avoidance: {
              id: 'dodgeB',
              type: 'dodge',
              context: emptyActionContext({ actorId: 'B' }),
              pool: 'normal',
            },
          },
        ],
      }),
      rolls(31, 70),
    );
    expect(r.state.melee!.grapples[0]).toMatchObject({
      controller: { actorId: 'A' },
      victim: { actorId: 'B' },
    });
    expect(r.result.targets[0]!.hit).toBeNull();
    expect(() =>
      resolveCombatAction(r.state, action('walk', 'half-move'), rolls(31, 31, 31, 31)),
    ).toThrow(/Grapple/);
    expect(() =>
      resolveMeleeDodge(r.state, action('dodge', 'dodge', 'B'), 'normal', rolls(31, 31, 31, 31)),
    ).toThrow(/Grapple/);
    const external = resolveMeleeAttack(
      r.state,
      meleeAttack({
        ...action('external', 'melee-attack', 'C'),
        weaponId: 'blade:C',
        origin: 'OPPORTUNITY',
        base: 'free',
        targets: [{ actor: { actorId: 'A' }, distance: 1 }],
        trigger: {
          id: 'leave',
          type: 'leaves-melee',
          attacker: { actorId: 'A' },
          target: { actorId: 'C' },
          engaged: true,
        },
      }),
      rolls(31),
    );
    expect(external.result.targets[0]!.check.target).toBe(70);
  });
  it('AC-M13 failed attack or successful Parry does not create relation', () => {
    expect(
      resolveMeleeAttack(meleeState(), meleeAttack({ technique: 'grapple' }), rolls(80)).state
        .melee!.grapples,
    ).toEqual([]);
    const r = resolveMeleeAttack(
      meleeState(),
      meleeAttack({
        technique: 'grapple',
        targets: [
          {
            actor: { actorId: 'B' },
            distance: 1,
            avoidance: {
              id: 'p',
              type: 'parry',
              weaponId: 'blade:B',
              pool: 'normal',
              context: emptyActionContext({ actorId: 'B' }),
            },
          },
        ],
      }),
      rolls(31, 10),
    );
    expect(r.result.targets[0]!.avoidance?.check.target).toBe(20);
    expect(r.state.melee!.grapples).toEqual([]);
  });
  it('AC-M14 size2 adds2 degrees only result, not characteristic', () => {
    const original = deepFreeze(editMelee(grappleState(), 'A', { sizeCategory: 3 }));
    const r = resolveGrappleAction(original, grappleRequest('grapple-damage'), rolls(31, 31));
    expect(r.result.opposed).toMatchObject({
      attackerCheck: { totalDegrees: 2 },
      defenderCheck: { totalDegrees: 2 },
      sizeDegrees: { attacker: 2, defender: 0 },
      winner: { actorId: 'A' },
    });
    expect(original.actors.A!.characteristics.СЛ!.baseValue).toBe(50);
  });
  it.each([
    'grapple-continue',
    'grapple-damage',
    'grapple-throw',
    'grapple-push',
    'grapple-prepare',
    'grapple-stand',
    'grapple-use',
  ] as const)('AC-M15 controller %s correct cost/persistence/intents', (type) => {
    let s = grappleState();
    if (type === 'grapple-stand') s = posture(posture(s, 'A', 'prone'), 'B', 'prone');
    if (type === 'grapple-use')
      s = {
        ...s,
        melee: {
          ...s.melee!,
          grapples: [
            {
              ...s.melee!.grapples[0]!,
              preparedItem: { source: fixtureSource, owner: { actorId: 'A' } },
            },
          ],
        },
      };
    const r = resolveGrappleAction(
      deepFreeze(s),
      grappleRequest(
        type,
        'A',
        type === 'grapple-prepare'
          ? { item: { source: fixtureSource, owner: { actorId: 'A' } } }
          : {},
      ),
      rolls(20, 70),
    );
    expect(r.execution.odAfter).toBe(
      ['grapple-continue', 'grapple-prepare', 'grapple-use'].includes(type) ? 1 : 0,
    );
    expect(r.result.relation).not.toBeNull();
    if (type === 'grapple-damage') {
      expect(r.result.intents[0]).toMatchObject({
        type: 'PrimitiveDamageIntent',
        location: 'Torso',
        damage: { expression: { count: 1, sides: 5, modifier: 2 } },
      });
      expect(r.state.actors.B!.fatigue).toBe(1);
    }
    if (type === 'grapple-throw') {
      expect(r.state.actors.B!.posture).toBe('prone');
      expect(r.result.relation?.thrownAdvantage).toBe(true);
    }
    if (type === 'grapple-push') expect(r.result.distance).toBe(4);
    if (type === 'grapple-prepare')
      expect(r.result.relation?.preparedItem?.owner.actorId).toBe('A');
    if (type === 'grapple-stand') {
      expect(r.state.actors.A!.posture).toBe('standing');
      expect(r.state.actors.B!.posture).toBe('standing');
    }
    if (type === 'grapple-use') expect(r.result.intents[0]?.type).toBe('PreparedItemUseIntent');
  });
  it('AC-M15 victim wins Deal Damage => no intent/fatigue but relation remains', () => {
    const r = resolveGrappleAction(grappleState(), grappleRequest('grapple-damage'), rolls(70, 20));
    expect(r.result.intents).toEqual([]);
    expect(r.state.actors.B!.fatigue).toBe(0);
    expect(r.result.relation).not.toBeNull();
  });
  it('AC-M15 Throw release OR maintain+10 subsequent grapple, resets while standing', () => {
    const release = resolveGrappleAction(
      grappleState(),
      grappleRequest('grapple-throw', 'A', { maintain: false }),
      rolls(20, 70),
    );
    expect(release.result.relation).toBeNull();
    const thrown = resolveGrappleAction(
      grappleState(),
      grappleRequest('grapple-throw'),
      rolls(20, 70),
    );
    const next = advanceToNextOwnTurn(thrown.state);
    const follow = resolveGrappleAction(
      next,
      grappleRequest('grapple-damage', 'A', { id: 'after-throw' }),
      rolls(31, 70),
    );
    expect(follow.result.opposed!.attackerCheck.target).toBe(60);
  });
  it('AC-M15 Push accompanies victim; free release ends relation', () => {
    const push = resolveGrappleAction(
      grappleState(),
      grappleRequest('grapple-push'),
      rolls(20, 70),
    );
    expect(push.result.distance).toBe(4);
    expect(push.result.relation?.id).toBe('grapple');
    const release = resolveGrappleAction(
      push.state,
      grappleRequest('grapple-release'),
      rolls(31, 31, 31, 31),
    );
    expect(release.result.relation).toBeNull();
    expect(release.execution.odAfter).toBe(0);
  });
  it('AC-M15 Prepare victim item requires GM one-resolution INCLUDE recorded', () => {
    const s = deepFreeze(grappleState()),
      req = grappleRequest('grapple-prepare', 'A', {
        item: { source: fixtureSource, owner: { actorId: 'B' } },
      });
    expect(() => resolveGrappleAction(s, req, rolls(31, 31, 31, 31))).toThrow(/GM/);
    const r = resolveGrappleAction(
      s,
      {
        ...req,
        context: {
          ...req.context,
          overrides: [
            {
              subject: 'modifier',
              id: 'grapple:take-victim-item',
              operation: 'INCLUDE',
              origin: 'gm',
              reason: 'explicit GM item permission',
            },
          ],
        },
      },
      rolls(31, 31, 31, 31),
    );
    expect(r.result.relation?.preparedItem?.owner.actorId).toBe('B');
    expect(r.logs.some((x) => x.overrides.some((o) => o.origin === 'gm'))).toBe(true);
    expect(s.melee!.grapples[0]!.preparedItem).toBeUndefined();
  });
  it.each(['grapple-escape', 'grapple-slip'] as const)(
    'AC-M16 %s leaves1OD nonattack allowed attack prohibited',
    (type) => {
      const s = onBTurn(grappleState());
      const r = resolveGrappleAction(s, grappleRequest(type, 'B'), rolls(20, 70));
      expect(r.state.melee!.grapples).toEqual([]);
      expect(r.execution.odAfter).toBe(1);
      expect(() =>
        resolveMeleeAttack(
          r.state,
          meleeAttack({
            ...action('Battack', 'melee-attack', 'B'),
            weaponId: 'blade:B',
            targets: [{ actor: { actorId: 'A' }, distance: 1 }],
          }),
          rolls(31, 31, 31, 31),
        ),
      ).toThrow(/cannot attack/);
      const move = resolveCombatAction(
        r.state,
        action('Bmove', 'half-move', 'B'),
        rolls(31, 31, 31, 31),
      );
      expect(move.execution.odAfter).toBe(0);
    },
  );
  it('AC-M16 Reverse2OD swaps roles grants ONE controller action without remaining OD', () => {
    const r = resolveGrappleAction(
      onBTurn(grappleState()),
      grappleRequest('grapple-reverse', 'B'),
      rolls(20, 70),
    );
    expect(r.execution.odAfter).toBe(0);
    expect(r.result.relation).toMatchObject({
      controller: { actorId: 'B' },
      victim: { actorId: 'A' },
    });
    expect(r.result.followupId).not.toBeNull();
    const f = resolveGrappleAction(
      r.state,
      grappleRequest('grapple-damage', 'B', { id: 'granted', followupId: r.result.followupId! }),
      rolls(20, 70),
    );
    expect(f.execution.odAfter).toBe(0);
    expect(f.result.intents).toHaveLength(1);
    expect(f.state.melee!.followups[0]!.spent).toBe(true);
    expect(f.logs.some((x) => x.resolver === 'grapple-rule-granted-followup')).toBe(true);
    expect(() =>
      resolveGrappleAction(
        f.state,
        grappleRequest('grapple-damage', 'B', {
          id: 'second-grant',
          followupId: r.result.followupId!,
        }),
        rolls(31, 31, 31, 31),
      ),
    ).toThrow(/follow-up/);
  });
  it('AC-M16 failed Escape/Slip retains Grapple; no extra grant', () => {
    for (const type of ['grapple-escape', 'grapple-slip'] as const) {
      const r = resolveGrappleAction(
        onBTurn(grappleState()),
        grappleRequest(type, 'B'),
        rolls(70, 20),
      );
      expect(r.result.relation).not.toBeNull();
      expect(r.result.followupId).toBeNull();
    }
  });
});
describe('B2 opposed actions acceptance', () => {
  it('AC-M17 Feint win excludes next defense consumes on attack, no permanent mutation', () => {
    const r = resolveMeleeOpposedAction(
      meleeState(),
      {
        ...action('feint', 'feint'),
        type: 'feint',
        target: { actorId: 'B' },
        opponentContext: emptyActionContext({ actorId: 'B' }),
      },
      rolls(20, 70),
    );
    expect(r.state.melee!.feints).toHaveLength(1);
    expect(() =>
      resolveMeleeAttack(
        r.state,
        meleeAttack({
          targets: [
            {
              actor: { actorId: 'B' },
              distance: 1,
              avoidance: {
                id: 'd',
                type: 'dodge',
                context: emptyActionContext({ actorId: 'B' }),
                pool: 'normal',
              },
            },
          ],
        }),
        rolls(31, 31, 31, 31),
      ),
    ).toThrow(/Avoidance/);
    const attack = resolveMeleeAttack(r.state, meleeAttack(), rolls(31));
    expect(attack.state.melee!.feints).toEqual([]);
    expect(attack.state.actors.B!.effects).toEqual([]);
  });
  it('AC-M17 Feint has no invented expiry; miss consumes; different attacker does not', () => {
    const r = resolveMeleeOpposedAction(
      meleeState(),
      {
        ...action('feint', 'feint'),
        type: 'feint',
        target: { actorId: 'B' },
        opponentContext: emptyActionContext({ actorId: 'B' }),
      },
      rolls(20, 70),
    );
    const next = advanceToNextOwnTurn(r.state);
    expect(next.melee!.feints).toHaveLength(1);
    expect(resolveMeleeAttack(next, meleeAttack(), rolls(70)).state.melee!.feints).toEqual([]);
  });
  it('AC-M18 Pressure4degrees targetSKR3 =>3m intent', () => {
    let s = meleeState();
    s = { ...s, actors: { ...s.actors, B: { ...s.actors.B!, movement: 3 } } };
    const r = resolveMeleeOpposedAction(
      s,
      {
        ...action('pressure', 'pressure'),
        type: 'pressure',
        target: { actorId: 'B' },
        opponentContext: emptyActionContext({ actorId: 'B' }),
      },
      rolls(11, 70),
    );
    expect(r.result.opposed.attackerCheck.totalDegrees).toBe(4);
    expect(r.result.distance).toBe(3);
    expect(r.execution.odAfter).toBe(1);
  });
  it('AC-M19 Breakthrough ordered opponents first prone then stop, no later RNG', () => {
    const r = resolveBreakthrough(
      meleeState(),
      {
        ...action('break', 'breakthrough'),
        type: 'breakthrough',
        movementMode: 'run',
        distance: 30,
        pathSource: fixtureSource,
        opponents: [
          { actor: { actorId: 'B' }, context: emptyActionContext({ actorId: 'B' }), distance: 2 },
          { actor: { actorId: 'C' }, context: emptyActionContext({ actorId: 'C' }), distance: 5 },
        ],
      },
      rolls(20, 70, 70, 20),
    );
    expect(r.result.stoppedBefore).toBe('C');
    expect(r.state.actors.B!.posture).toBe('prone');
    expect(r.state.actors.C!.posture).toBe('standing');
    expect(r.execution.odAfter).toBe(0);
    expect(r.result.opposed).toHaveLength(2);
  });
  it('AC-M19 stop on first opponent without consuming dice for later path', () => {
    const r = resolveBreakthrough(
      meleeState(),
      {
        ...action('break', 'breakthrough'),
        type: 'breakthrough',
        movementMode: 'charge',
        distance: 20,
        pathSource: fixtureSource,
        opponents: [
          { actor: { actorId: 'B' }, context: emptyActionContext({ actorId: 'B' }), distance: 2 },
          { actor: { actorId: 'C' }, context: emptyActionContext({ actorId: 'C' }), distance: 5 },
        ],
      },
      rolls(70, 20),
    );
    expect(r.result.opposed).toHaveLength(1);
    expect(r.result.stoppedBefore).toBe('B');
  });
});
describe('B2 Grapple transaction negatives', () => {
  const cases: readonly [string, GrappleAction, string][] = [
    ['outsider', 'grapple-damage', 'C'],
    ['victim uses controller', 'grapple-damage', 'B'],
    ['controller uses victim', 'grapple-escape', 'A'],
  ];
  it.each(cases)('%s rejected without mutation', (_name, type, actorId) => {
    const s = deepFreeze(grappleState()),
      before = JSON.stringify(s);
    expect(() =>
      resolveGrappleAction(s, grappleRequest(type, actorId), rolls(31, 31, 31, 31)),
    ).toThrow();
    expect(JSON.stringify(s)).toBe(before);
  });
  it('standing action requires BOTH prone, item use requires prepared, insufficient OD', () => {
    const s = deepFreeze(grappleState());
    expect(() =>
      resolveGrappleAction(s, grappleRequest('grapple-stand'), rolls(31, 31, 31, 31)),
    ).toThrow(/both/i);
    expect(() =>
      resolveGrappleAction(s, grappleRequest('grapple-use'), rolls(31, 31, 31, 31)),
    ).toThrow(/prepared/);
    const one = resolveGrappleAction(s, grappleRequest('grapple-continue'), rolls(31, 31, 31, 31));
    expect(() =>
      resolveGrappleAction(one.state, grappleRequest('grapple-damage'), rolls(31, 31, 31, 31)),
    ).toThrow(/OD/);
  });
  it('invalid Reverse follow-up id/role/action cannot mutate relation', () => {
    const s = deepFreeze(grappleState());
    expect(() =>
      resolveGrappleAction(
        s,
        grappleRequest('grapple-damage', 'A', { followupId: 'missing' }),
        rolls(31, 31, 31, 31),
      ),
    ).toThrow(/follow-up/);
  });
});

it('AC-M14 Slip Free size bonus is separate from original Acrobatics result', () => {
  const s = onBTurn(editMelee(grappleState(), 'B', { sizeCategory: 3 }));
  const r = resolveGrappleAction(deepFreeze(s), grappleRequest('grapple-slip', 'B'), rolls(31));
  expect(r.result.skillCheck).toMatchObject({
    check: { totalDegrees: 2 },
    sizeDegrees: 2,
    totalDegrees: 4,
  });
  expect(r.logs.find((log) => log.grapple)?.grapple?.skillCheck?.sizeDegrees).toBe(2);
});
it('Reverse immediate grant must resolve before turn-end, without resource mutation', async () => {
  const { finishActionTurn } = await import('../src/index.js');
  const r = resolveGrappleAction(
    onBTurn(grappleState()),
    grappleRequest('grapple-reverse', 'B'),
    rolls(20, 70),
  );
  const s = deepFreeze(r.state),
    before = JSON.stringify(s);
  expect(() => finishActionTurn(s)).toThrow(/immediate/);
  expect(JSON.stringify(s)).toBe(before);
});
it('Feint is consumed by next composed Knockdown even if Athletics fails', async () => {
  const { resolveKnockdown } = await import('../src/index.js');
  const f = resolveMeleeOpposedAction(
    meleeState(),
    {
      ...action('feint', 'feint'),
      type: 'feint',
      target: { actorId: 'B' },
      opponentContext: emptyActionContext({ actorId: 'B' }),
    },
    rolls(20, 70),
  );
  const r = resolveKnockdown(
    f.state,
    meleeAttack({ technique: 'knockdown' }),
    emptyActionContext({ actorId: 'B' }),
    rolls(70, 20),
  );
  expect(r.state.melee!.feints).toEqual([]);
});
