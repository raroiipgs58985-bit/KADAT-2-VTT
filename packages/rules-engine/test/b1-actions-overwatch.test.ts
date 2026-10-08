import { expect, test } from 'vitest';
import type { CombatActionState } from '@kadat/contracts';
import {
  activateOverwatch,
  beginActionRound,
  beginActionTurn,
  finishActionTurn,
  resolveCombatAction,
  resolveOverwatchInterrupts,
  resolveRangedAttack,
  type OverwatchActivationRequest,
} from '../src/index.js';
import { deepFreeze } from './fixtures.js';
import { action, attack, b1State, dice, expectUnchangedOnError } from './b1-fixtures.js';

function activation(actorId = 'A'): OverwatchActivationRequest {
  return {
    ...action(`activate:${actorId}`, 'overwatch', actorId),
    type: 'overwatch',
    selectedAttackType: 'ranged-attack',
    weaponId: `gun:${actorId}`,
    mode: 'single',
    shotsRequested: 1,
    sector: { id: 'sector', headingDegrees: 45, widthDegrees: 90 },
    trigger: { id: 'enemy-action', requiresTags: ['shoot'] },
  };
}

const event = {
  actionId: 'enemy-shot',
  actor: { actorId: 'B' },
  tags: ['shoot'],
  sectorIds: ['sector'],
};

function nextOwnTurn(initial: CombatActionState): CombatActionState {
  let state = initial;
  if (state.session.phase === 'turn-active') state = finishActionTurn(state).state;
  while (state.session.phase !== 'round-ended') {
    state = finishActionTurn(beginActionTurn(state).state).state;
  }
  return beginActionTurn(beginActionRound(state).state).state;
}

function twoOverwatchActors(lvA = 50, lvC = 50): CombatActionState {
  const initial = b1State();
  let state: CombatActionState = {
    ...initial,
    actors: {
      ...initial.actors,
      A: {
        ...initial.actors.A!,
        characteristics: {
          ...initial.actors.A!.characteristics,
          ЛВ: { baseValue: lvA, baseSuper: 0 },
        },
      },
      C: {
        ...initial.actors.C!,
        characteristics: {
          ...initial.actors.C!.characteristics,
          ЛВ: { baseValue: lvC, baseSuper: 0 },
        },
      },
    },
  };
  state = activateOverwatch(state, activation('A')).state;
  state = beginActionTurn(state).state;
  state = resolveCombatAction(state, action('wait:B', 'wait', 'B'), dice()).state;
  state = beginActionTurn(state).state;
  return activateOverwatch(state, activation('C')).state;
}

test.each([
  ['free-move', 0, 0, 4, 0],
  ['half-move', 1, 0, 8, 0],
  ['full-move', 2, 0, 16, 0],
  ['run', 2, 1, 48, 0],
  ['sprint', 2, 1, 96, 2],
] as const)(
  'movement %s cost %i/%i distance %i fatigue %i',
  (type, od, reaction, distance, fatigueAdded) => {
    const result = resolveCombatAction(deepFreeze(b1State()), action(type, type), dice());
    expect(result.result).toMatchObject({ distance, fatigueAdded });
    expect(result.state.session.turn?.od).toBe(2 - od);
    expect(result.state.session.initiativeOrder[0]?.reactions.remaining).toBe(1 - reaction);
    expect(result.state.actors.A?.fatigue).toBe(fatigueAdded);
    expect(result.execution.definition.free).toBe(type === 'free-move');
    expect(result.logs[0]?.mutations).toContainEqual(expect.objectContaining({ type }));
  },
);

test('free movement max 5m and global half-value rounding upward', () => {
  for (const [movement, expected] of [
    [20, 5],
    [5, 3],
  ]) {
    const state = b1State();
    const changed = {
      ...state,
      actors: { ...state.actors, A: { ...state.actors.A!, movement: movement! } },
    };
    expect(resolveCombatAction(changed, action('free', 'free-move'), dice()).result).toMatchObject({
      distance: expected,
    });
  }
});

test.each([
  ['prone', 'prone', 2],
  ['kneel', 'kneeling', 2],
  ['stand', 'standing', 1],
] as const)('posture %s is %s with %i OD left', (type, posture, od) => {
  const result = resolveCombatAction(b1State(), action(type, type), dice());
  expect(result.state.actors.A?.posture).toBe(posture);
  expect(result.state.session.turn?.od).toBe(od);
});

test('Wait spends 1 OD, ends turn and permits one retained-OD attack before next own turn', () => {
  const waited = resolveCombatAction(b1State(80), action('wait', 'wait'), dice());
  expect(waited.execution).toMatchObject({ odBefore: 2, odAfter: 1 });
  expect(waited.state.session.phase).toBe('between-turns');
  expect(waited.state.actors.A?.wait).toMatchObject({ retainedOd: 1, mayAttack: true });
  const fired = resolveRangedAttack(
    waited.state,
    attack('wait-shot'),
    dice({ sides: 100, value: 41 }),
  );
  expect(fired.execution).toMatchObject({
    odBefore: 1,
    odAfter: 0,
    reactionBefore: 1,
    reactionAfter: 1,
  });
  expect(fired.state.actors.A?.wait).toBeUndefined();
  expect(() => resolveRangedAttack(fired.state, attack('wait-again'), dice())).toThrow(
    'No retained Wait',
  );
});

test('Wait after an earlier attack cannot spend retained OD on another attack', () => {
  const fired = resolveRangedAttack(
    b1State(80),
    attack('first'),
    dice({ sides: 100, value: 41 }),
  ).state;
  const waited = resolveCombatAction(fired, action('wait-after-attack', 'wait'), dice()).state;
  expect(waited.actors.A?.wait).toMatchObject({ retainedOd: 1, mayAttack: false });
  expect(() =>
    expectUnchangedOnError(waited, (state) =>
      resolveRangedAttack(state, attack('forbidden-wait-shot'), dice()),
    ),
  ).toThrow('Wait cannot attack');
});

test('Wait expires precisely at next own turn start', () => {
  const waited = resolveCombatAction(b1State(), action('wait', 'wait'), dice()).state;
  const next = nextOwnTurn(waited);
  expect(next.actors.A?.wait).toBeUndefined();
  expect(next.session.activeActor?.actorId).toBe('A');
  expect(next.session.turn?.od).toBe(2);
});

test('retained Wait OD can pay Half Movement without resurrecting the Wait resource', () => {
  const waited = resolveCombatAction(b1State(), action('wait', 'wait'), dice()).state;
  const moved = resolveCombatAction(waited, action('wait-move', 'half-move'), dice());
  expect(moved.result).toMatchObject({ distance: 8 });
  expect(moved.execution).toMatchObject({ odBefore: 1, odAfter: 0 });
  expect(moved.state.actors.A?.wait).toBeUndefined();
  expect(() => resolveCombatAction(moved.state, action('again', 'half-move'), dice())).toThrow(
    'No retained Wait',
  );
});

test('Overwatch activation costs 1 OD, ends turn, then consumes Reaction before enemy action', () => {
  const active = activateOverwatch(deepFreeze(b1State()), activation());
  expect(active.execution).toMatchObject({
    odBefore: 2,
    odAfter: 1,
    reactionBefore: 1,
    reactionAfter: 1,
  });
  expect(active.state.session.phase).toBe('between-turns');
  const enemyTurn = beginActionTurn(active.state).state;
  const interrupted = resolveOverwatchInterrupts(
    enemyTurn,
    event,
    [attack('overwatch-shot')],
    dice({ sides: 100, value: 41 }),
  );
  expect(interrupted.status).toBe('resolved');
  expect(interrupted.timeline).toEqual([
    { type: 'overwatch', actionId: 'overwatch-shot' },
    { type: 'enemy-action-ready', actionId: 'enemy-shot' },
  ]);
  expect(interrupted.attacks).toHaveLength(1);
  expect(interrupted.attacks[0]?.execution).toMatchObject({
    odBefore: 0,
    odAfter: 0,
    reactionBefore: 1,
    reactionAfter: 0,
  });
  expect(interrupted.logs.at(-1)?.beforeActionId).toBe('enemy-shot');
  expect(
    interrupted.attacks[0]?.execution.mutations.some((mutation) => mutation.type === 'OD-spend'),
  ).toBe(false);
  expect(interrupted.state.session.turn?.od).toBe(2);
  expect(interrupted.state.actors.A?.overwatch).toBeUndefined();
  const enemy = resolveRangedAttack(
    interrupted.state,
    attack('enemy-shot', {
      actor: { actorId: 'B' },
      target: { actorId: 'A' },
      weaponId: 'gun:B',
      context: action('enemy-shot', 'ranged-attack', 'B').context,
    }),
    dice({ sides: 100, value: 41 }),
  );
  expect(enemy.state.completedActionIds).toEqual(['activate:A', 'overwatch-shot', 'enemy-shot']);
});

test('Overwatch expires without firing at start of next own turn', () => {
  const active = activateOverwatch(b1State(), activation()).state;
  const expired = nextOwnTurn(active);
  expect(expired.actors.A?.overwatch).toBeUndefined();
  expect(() =>
    expectUnchangedOnError(expired, (state) =>
      resolveOverwatchInterrupts(state, event, [attack('expired-shot')], dice()),
    ),
  ).toThrow('expired');
});

test('Overwatch cannot fire when Reaction is unavailable', () => {
  const activated = activateOverwatch(b1State(), activation()).state;
  const state = {
    ...activated,
    session: {
      ...activated.session,
      initiativeOrder: activated.session.initiativeOrder.map((entry) =>
        entry.actor.actorId === 'A'
          ? { ...entry, reactions: { capacity: 1, remaining: 0 } }
          : entry,
      ),
    },
  };
  expect(() =>
    expectUnchangedOnError(state, (input) =>
      resolveOverwatchInterrupts(input, event, [attack('no-reaction')], dice()),
    ),
  ).toThrow('Unavailable Reaction');
});

test('Called selection for Overwatch is rejected transactionally', () => {
  expect(() =>
    expectUnchangedOnError(b1State(), (state) =>
      activateOverwatch(state, { ...activation(), selectedAttackType: 'called-attack' }),
    ),
  ).toThrow('Called');
});

test('simultaneous Overwatch: higher resolved LV fires first without extra dice', () => {
  const result = resolveOverwatchInterrupts(
    twoOverwatchActors(40, 80),
    event,
    [
      attack('ow:A'),
      attack('ow:C', {
        actor: { actorId: 'C' },
        weaponId: 'gun:C',
        context: action('ow:C', 'ranged-attack', 'C').context,
      }),
    ],
    dice({ sides: 100, value: 41 }, { sides: 100, value: 41 }),
  );
  expect(result.attacks.map((shot) => shot.execution.actor.actorId)).toEqual(['C', 'A']);
});

test('simultaneous equal LV uses opposed Check Engine; higher degrees first', () => {
  const result = resolveOverwatchInterrupts(
    twoOverwatchActors(),
    event,
    [
      attack('ow:A'),
      attack('ow:C', {
        actor: { actorId: 'C' },
        weaponId: 'gun:C',
        context: action('ow:C', 'ranged-attack', 'C').context,
      }),
    ],
    dice(
      { sides: 100, value: 40 },
      { sides: 100, value: 20 },
      { sides: 100, value: 41 },
      { sides: 100, value: 41 },
    ),
  );
  expect(result.status).toBe('resolved');
  expect(result.attacks.map((shot) => shot.execution.actor.actorId)).toEqual(['C', 'A']);
  expect(
    result.logs.filter((log) => log.resolver === 'check').map((log) => log.degrees?.total),
  ).toEqual([2, 4, 1, 1]);
});

test('equal opposed results stay pending without inventing another tie-break', () => {
  const state = deepFreeze(twoOverwatchActors());
  const result = resolveOverwatchInterrupts(
    state,
    event,
    [
      attack('ow:A'),
      attack('ow:C', {
        actor: { actorId: 'C' },
        weaponId: 'gun:C',
        context: action('ow:C', 'ranged-attack', 'C').context,
      }),
    ],
    dice({ sides: 100, value: 40 }, { sides: 100, value: 40 }),
  );
  expect(result.status).toBe('pending-opposed-tie');
  expect(result.state).toBe(state);
  expect(result.attacks).toEqual([]);
  expect(result.tiedActors).toEqual([['A', 'C']]);
});

test('Overwatch trigger must match the sector and chosen condition', () => {
  const state = activateOverwatch(b1State(), activation()).state;
  expect(() =>
    resolveOverwatchInterrupts(state, { ...event, sectorIds: [] }, [attack('outside')], dice()),
  ).toThrow('does not match');
  expect(() =>
    resolveOverwatchInterrupts(state, { ...event, tags: [] }, [attack('no-trigger')], dice()),
  ).toThrow('does not match');
});
