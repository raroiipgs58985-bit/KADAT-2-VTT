import { expect, test, vi } from 'vitest';
import type {
  CombatActionState,
  OverwatchOrderingOverride,
  ResolutionContext,
} from '@kadat/contracts';
import {
  activateOverwatch,
  beginActionTurn,
  emptyActionContext,
  orderOverwatchInterrupts,
  resolveOverwatchInterrupts,
  type OverwatchActivationRequest,
} from '../src/index.js';
import { deepFreeze } from './fixtures.js';
import {
  action,
  attack,
  b1State,
  dice,
  expectUnchangedOnError,
  fixtureProvenance,
} from './b1-fixtures.js';

const event = {
  actionId: 'enemy-action',
  actor: { actorId: 'C' },
  tags: ['shoot'],
  sectorIds: ['sector'],
};

function activation(actorId: string): OverwatchActivationRequest {
  return {
    ...action(`activate:${actorId}`, 'overwatch', actorId),
    type: 'overwatch',
    selectedAttackType: 'ranged-attack',
    weaponId: `gun:${actorId}`,
    mode: 'single',
    shotsRequested: 1,
    sector: { id: 'sector', headingDegrees: 0, widthDegrees: 90 },
    trigger: { id: 'shoot-trigger', requiresTags: ['shoot'] },
  };
}

function pair(lvA = 50, lvB = 50): CombatActionState {
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
      B: {
        ...initial.actors.B!,
        characteristics: {
          ...initial.actors.B!.characteristics,
          ЛВ: { baseValue: lvB, baseSuper: 0 },
        },
      },
    },
  };
  state = beginActionTurn(activateOverwatch(state, activation('A')).state).state;
  state = beginActionTurn(activateOverwatch(state, activation('B')).state).state;
  return deepFreeze(state);
}

function requests() {
  return [
    attack('ow:A', { target: { actorId: 'C' } }),
    attack('ow:B', {
      actor: { actorId: 'B' },
      target: { actorId: 'C' },
      weaponId: 'gun:B',
      context: emptyActionContext({ actorId: 'B' }),
    }),
  ];
}

function gm(winnerActorId: string): OverwatchOrderingOverride {
  return deepFreeze({
    id: 'gm-choice',
    participatingActorIds: ['A', 'B'],
    winnerActorId,
    reason: 'GM orders this interruption',
    provenance: {
      source: { kind: 'gm', id: 'fixture-GM' },
      reason: 'Explicit one-resolution ordering choice',
    },
  });
}

function contexts(
  override: OverwatchOrderingOverride,
): Readonly<Record<string, ResolutionContext>> {
  return deepFreeze({
    A: { ...emptyActionContext({ actorId: 'A' }), overwatchOrderingOverrides: [override] },
  });
}

test('higher LV A50/B40: A first without opposed or random ordering dice', () => {
  const result = resolveOverwatchInterrupts(
    pair(50, 40),
    event,
    requests(),
    dice({ sides: 100, value: 41 }, { sides: 100, value: 41 }),
  );
  expect(result.attacks.map((attack) => attack.execution.actor.actorId)).toEqual(['A', 'B']);
  expect(result.orderingDecisions).toEqual([]);
});

test('equal LV with opposed A winner: A first without a random tie-break', () => {
  const result = resolveOverwatchInterrupts(
    pair(),
    event,
    requests(),
    dice(
      { sides: 100, value: 20 },
      { sides: 100, value: 40 },
      { sides: 100, value: 41 },
      { sides: 100, value: 41 },
    ),
  );
  expect(result.attacks.map((attack) => attack.execution.actor.actorId)).toEqual(['A', 'B']);
  expect(result.orderingDecisions).toEqual([]);
});

test.each([
  [1, 'A', 'B'],
  [2, 'B', 'A'],
] as const)(
  'complete tie injected d2=%i selects %s before %s and logs provenance',
  (face, winner, second) => {
    const result = resolveOverwatchInterrupts(
      pair(),
      event,
      requests(),
      dice(
        { sides: 100, value: 40 },
        { sides: 100, value: 40 },
        { sides: 2, value: face },
        { sides: 100, value: 41 },
        { sides: 100, value: 41 },
      ),
    );
    expect(result.attacks.map((attack) => attack.execution.actor.actorId)).toEqual([
      winner,
      second,
    ]);
    const decision = result.orderingDecisions[0];
    expect(decision).toMatchObject({
      completeTie: true,
      orderingResolution: 'RANDOM_TIEBREAK',
      winnerActorId: winner,
      participants: [
        { actorId: 'A', lv: 50, opposed: { rawRoll: 40, totalDegrees: 2 } },
        { actorId: 'B', lv: 50, opposed: { rawRoll: 40, totalDegrees: 2 } },
      ],
      random: {
        rolls: [{ sides: 2, value: face }],
        provenance: { source: { kind: 'injected-rng' } },
      },
    });
    const log = result.logs.find((log) => log.resolver === 'overwatch-ordering');
    expect(log?.overwatchOrdering).toEqual(decision);
    expect(log?.dice).toEqual([{ sides: 2, value: face }]);
    expect(log?.mutations).toEqual([]);
  },
);

test.each(['A', 'B'])(
  'complete tie GM selects %s; RNG would select the other actor but is never used for ordering',
  (winner) => {
    const override = gm(winner);
    const sequence = dice(
      { sides: 100, value: 40 },
      { sides: 100, value: 40 },
      { sides: 100, value: 41 },
      { sides: 100, value: 41 },
    );
    const source = {
      roll: vi.fn((sides: number) =>
        sides === 2 ? (winner === 'A' ? 2 : 1) : sequence.roll(sides),
      ),
    };
    const result = resolveOverwatchInterrupts(
      pair(),
      event,
      requests(),
      source,
      contexts(override),
    );
    expect(result.attacks[0]?.execution.actor.actorId).toBe(winner);
    expect(source.roll.mock.calls.map(([sides]) => sides)).toEqual([100, 100, 100, 100]);
    expect(result.orderingDecisions[0]).toMatchObject({
      orderingResolution: 'GM_OVERRIDE',
      winnerActorId: winner,
      override,
    });
    expect(result.orderingDecisions[0]?.random).toBeUndefined();
    expect(
      result.logs.find((log) => log.resolver === 'overwatch-ordering')?.overwatchOrdering?.override
        ?.provenance.source.id,
    ).toBe('fixture-GM');
  },
);

test('ordering is resource-free, including inside every injected roll', () => {
  const state = pair();
  const before = JSON.stringify(state);
  const sequence = dice(
    { sides: 100, value: 40 },
    { sides: 100, value: 40 },
    { sides: 2, value: 1 },
  );
  const source = {
    roll(sides: number) {
      expect(JSON.stringify(state)).toBe(before);
      return sequence.roll(sides);
    },
  };
  const result = orderOverwatchInterrupts(state, event, requests(), source);
  expect(result.ordered[0]?.actor.actorId).toBe('A');
  expect(result.logs.every((log) => log.mutations.length === 0)).toBe(true);
  expect(JSON.stringify(state)).toBe(before);
  expect(state.completedActionIds).toEqual(['activate:A', 'activate:B']);
});

test('unavailable ordering RNG never consumes any Overwatch attack resources', () => {
  expect(() =>
    expectUnchangedOnError(pair(), (state) =>
      resolveOverwatchInterrupts(
        state,
        event,
        requests(),
        dice({ sides: 100, value: 40 }, { sides: 100, value: 40 }),
      ),
    ),
  ).toThrow('Expected injected d2');
});

test('first attack exhausts a synthetic shared ammo supply; second is skipped without spending its resources', () => {
  const initial = pair();
  // A shared source is synthetic dependency data, not a new canonical weapon/container rule.
  const state: CombatActionState = deepFreeze({
    ...initial,
    weapons: {
      ...initial.weapons,
      'gun:B': { ...initial.weapons['gun:B']!, loadedContainerId: 'mag:A' },
    },
    containers: {
      ...initial.containers,
      'mag:A': {
        ...initial.containers['mag:A']!,
        currentRounds: 1,
        compatibleWeaponTemplateIds: ['template:A', 'template:B'],
        provenance: fixtureProvenance,
      },
    },
  });
  const result = resolveOverwatchInterrupts(
    state,
    event,
    requests(),
    dice(
      { sides: 100, value: 40 },
      { sides: 100, value: 40 },
      { sides: 2, value: 1 },
      { sides: 100, value: 41 },
    ),
  );
  expect(result.attacks.map((attack) => attack.execution.actor.actorId)).toEqual(['A']);
  expect(result.skippedAttacks).toEqual([
    { actionId: 'ow:B', actor: { actorId: 'B' }, reason: 'Insufficient ammunition' },
  ]);
  expect(
    result.state.session.initiativeOrder.find((entry) => entry.actor.actorId === 'A')?.reactions
      .remaining,
  ).toBe(0);
  expect(
    result.state.session.initiativeOrder.find((entry) => entry.actor.actorId === 'B')?.reactions
      .remaining,
  ).toBe(1);
  expect(result.state.containers['mag:A']?.currentRounds).toBe(0);
  expect(result.state.containers['mag:B']).toBe(state.containers['mag:B']);
  expect(result.state.weapons['gun:B']).toBe(state.weapons['gun:B']);
  expect(result.state.actors.B?.overwatch).toBe(state.actors.B?.overwatch);
  expect(result.state.session.turn).toEqual(state.session.turn);
  expect(result.state.completedActionIds).toEqual(['activate:A', 'activate:B', 'ow:A']);
  expect(result.logs.find((log) => log.resolver === 'overwatch-skipped')?.overwatchSkipped).toEqual(
    result.skippedAttacks[0],
  );
});

test('GM ordering leaves Actor/source/Overwatch data and the original opposed results unchanged', () => {
  const state = pair();
  const before = JSON.stringify(state);
  const override = gm('B');
  const supplied = contexts(override);
  const suppliedBefore = JSON.stringify(supplied);
  const random = orderOverwatchInterrupts(
    state,
    event,
    requests(),
    dice({ sides: 100, value: 40 }, { sides: 100, value: 40 }, { sides: 2, value: 1 }),
  );
  const manual = orderOverwatchInterrupts(
    state,
    event,
    requests(),
    dice({ sides: 100, value: 40 }, { sides: 100, value: 40 }),
    supplied,
  );
  expect(manual.decisions[0]?.participants).toEqual(random.decisions[0]?.participants);
  expect(manual.logs.filter((log) => log.resolver === 'check')).toEqual(
    random.logs.filter((log) => log.resolver === 'check'),
  );
  expect(JSON.stringify(state)).toBe(before);
  expect(JSON.stringify(supplied)).toBe(suppliedBefore);
  expect(manual.decisions[0]?.override).toBe(override);
});

test('attack RNG failures propagate instead of being disguised as a legal-validation skip', () => {
  expect(() =>
    expectUnchangedOnError(pair(), (state) =>
      resolveOverwatchInterrupts(
        state,
        event,
        requests(),
        dice({ sides: 100, value: 40 }, { sides: 100, value: 40 }, { sides: 2, value: 1 }),
      ),
    ),
  ).toThrow('Expected injected d100');
});

test.each([
  'unknown-winner',
  'unknown-participant',
  'empty-reason',
  'duplicate-choice',
  'not-tied',
] as const)('invalid GM ordering %s rejects without partial resource mutation', (kind) => {
  let override = gm('A');
  if (kind === 'unknown-winner') override = { ...override, winnerActorId: 'C' };
  if (kind === 'unknown-participant') override = { ...override, participatingActorIds: ['A', 'C'] };
  if (kind === 'empty-reason') override = { ...override, reason: '' };
  const supplied =
    kind === 'duplicate-choice'
      ? {
          A: {
            ...emptyActionContext({ actorId: 'A' }),
            overwatchOrderingOverrides: [override, { ...override, id: 'second-choice' }],
          },
        }
      : contexts(override);
  expect(() =>
    expectUnchangedOnError(pair(50, kind === 'not-tied' ? 40 : 50), (state) =>
      resolveOverwatchInterrupts(
        state,
        event,
        requests(),
        dice({ sides: 100, value: 40 }, { sides: 100, value: 40 }),
        supplied,
      ),
    ),
  ).toThrow(/ordering override|Ordering override/i);
});
