import { expect, test } from 'vitest';
import type { FireMode } from '@kadat/contracts';
import {
  resolveRangedAttack,
  resolveCombatAction,
  resolveDodge,
  beginActionTurn,
  clearMalfunction,
} from '../src/index.js';
import {
  action,
  attack,
  b1State,
  dice,
  expectUnchangedOnError,
  extraEffect,
} from './b1-fixtures.js';

test('insufficient OD rejects attack before RNG/resource mutation', () => {
  const state = resolveCombatAction(b1State(), action('full-move', 'full-move'), dice()).state;
  expect(() =>
    expectUnchangedOnError(state, (input) => resolveRangedAttack(input, attack(), dice())),
  ).toThrow('Insufficient OD');
});

test.each(['run', 'sprint'] as const)(
  '%s without Reaction does not spend OD or add fatigue',
  (type) => {
    const state = b1State();
    const changed = {
      ...state,
      session: {
        ...state.session,
        turn: { ...state.session.turn!, reactions: { capacity: 1, remaining: 0 } },
        initiativeOrder: state.session.initiativeOrder.map((entry, index) =>
          index === 0 ? { ...entry, reactions: { capacity: 1, remaining: 0 } } : entry,
        ),
      },
    };
    expect(() =>
      expectUnchangedOnError(changed, (input) =>
        resolveCombatAction(input, action(type, type), dice()),
      ),
    ).toThrow('Unavailable Reaction');
  },
);

test('invalid fire mode fails', () => {
  expect(() =>
    expectUnchangedOnError(b1State(), (state) =>
      resolveRangedAttack(state, attack('invalid-mode', { mode: 'invalid' as FireMode }), dice()),
    ),
  ).toThrow('fire mode');
});

test('jammed weapon cannot fire', () => {
  const initial = b1State();
  const state = {
    ...initial,
    weapons: { ...initial.weapons, 'gun:A': { ...initial.weapons['gun:A']!, jammed: true } },
  };
  expect(() =>
    expectUnchangedOnError(state, (input) => resolveRangedAttack(input, attack(), dice())),
  ).toThrow('Jammed');
});

test('insufficient ammunition rejects the whole volley without hidden truncation/spending', () => {
  const initial = b1State();
  const state = {
    ...initial,
    containers: {
      ...initial.containers,
      'mag:A': { ...initial.containers['mag:A']!, currentRounds: 2 },
    },
  };
  expect(() =>
    expectUnchangedOnError(state, (input) =>
      resolveRangedAttack(
        input,
        attack('no-ammo', { mode: 'short-burst', shotsRequested: 3 }),
        dice(),
      ),
    ),
  ).toThrow('Insufficient ammunition');
});

test.each([0, -1, 1.5, NaN, Infinity, 13])(
  'invalid shotsRequested %s cannot consume resources',
  (shotsRequested) => {
    expect(() =>
      expectUnchangedOnError(b1State(), (input) =>
        resolveRangedAttack(
          input,
          attack('bad-shots', { mode: 'full-auto', shotsRequested }),
          dice(),
        ),
      ),
    ).toThrow('shotsRequested');
  },
);

test.each(['short-burst', 'full-auto'] as const)('Called %s combination rejected', (mode) => {
  expect(() =>
    expectUnchangedOnError(b1State(), (input) =>
      resolveRangedAttack(
        input,
        attack('bad-called', { type: 'called-attack', calledLocation: 'Head', mode }),
        dice(),
      ),
    ),
  ).toThrow('Called Attack');
});

test('Dodge without Reaction cannot consume the attacker ammo/OD either', () => {
  const initial = b1State();
  const state = {
    ...initial,
    session: {
      ...initial.session,
      initiativeOrder: initial.session.initiativeOrder.map((entry, index) =>
        index === 1 ? { ...entry, reactions: { capacity: 1, remaining: 0 } } : entry,
      ),
    },
  };
  expect(() =>
    expectUnchangedOnError(state, (input) =>
      resolveRangedAttack(
        input,
        attack('invalid-dodge', {
          dodge: { id: 'dodge', context: action('dodge', 'dodge', 'B').context },
        }),
        dice(),
      ),
    ),
  ).toThrow('Unavailable Reaction');
});

test('non-dodgeable action and an explicit Dodge prohibition are rejected', () => {
  expect(() =>
    expectUnchangedOnError(b1State(), (state) =>
      resolveDodge(state, action('dodge', 'dodge', 'B'), 1, false, dice()),
    ),
  ).toThrow('not dodgeable');
  const state = b1State();
  const restriction = extraEffect(
    'no-dodge',
    1,
    { target: { kind: 'permission', permission: 'dodge' }, operation: 'restrict' },
    'B',
  );
  const changed = {
    ...state,
    actors: { ...state.actors, B: { ...state.actors.B!, effects: [restriction] } },
  };
  expect(() =>
    expectUnchangedOnError(changed, (input) =>
      resolveDodge(input, action('dodge', 'dodge', 'B'), 1, true, dice()),
    ),
  ).toThrow('prohibited');
});

test.each([0.1, -1, NaN, Infinity])(
  'invalid ranged distance %s leaves snapshot intact',
  (distance) => {
    expect(() =>
      expectUnchangedOnError(b1State(), (state) =>
        resolveRangedAttack(state, attack('range-invalid', { distance }), dice()),
      ),
    ).toThrow('Invalid range');
  },
);

test('replayed action ID, wrong actor context and invalid turn transition fail', () => {
  const once = resolveCombatAction(b1State(), action('once', 'prone'), dice()).state;
  expect(() =>
    expectUnchangedOnError(once, (state) =>
      resolveCombatAction(state, action('once', 'stand'), dice()),
    ),
  ).toThrow('repeated action');
  expect(() =>
    expectUnchangedOnError(b1State(), (state) =>
      resolveRangedAttack(
        state,
        attack('wrong', { context: action('wrong', 'ranged-attack', 'B').context }),
        dice(),
      ),
    ),
  ).toThrow('Context actor mismatch');
  expect(() => expectUnchangedOnError(b1State(), (state) => beginActionTurn(state))).toThrow(
    'Cannot start',
  );
});

test('unknown/unauthored item malfunction handling is not guessed', () => {
  const state = b1State();
  const gun = state.weapons['gun:A']!;
  const changed = {
    ...state,
    weapons: {
      ...state.weapons,
      [gun.id]: {
        ...gun,
        template: {
          ...gun.template,
          profile: { ...gun.template.profile, malfunction: 'external-property' as const },
        },
      },
    },
  };
  expect(() =>
    expectUnchangedOnError(changed, (input) => resolveRangedAttack(input, attack(), dice())),
  ).toThrow('authored property');
});

test('Clear Malfunction requires an appropriate actual jam state', () => {
  expect(() =>
    expectUnchangedOnError(b1State(), (state) =>
      clearMalfunction(
        state,
        { ...action('clear', 'clear-malfunction'), weaponId: 'gun:A' },
        dice(),
      ),
    ),
  ).toThrow('jammed state');
});
