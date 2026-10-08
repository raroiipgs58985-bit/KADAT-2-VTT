import { expect, test } from 'vitest';
import {
  applyStunned,
  resolveCombatAction,
  resolveRangedAttack,
  clearMalfunction,
  finishActionTurn,
  effectiveRangedProfile,
  resolveDodge,
} from '../src/index.js';
import { deepFreeze, modifier } from './fixtures.js';
import {
  action,
  attack,
  b1State,
  dice,
  extraEffect,
  expectUnchangedOnError,
  fixtureProvenance,
  fixtureSource,
  advanceToNextOwnTurn,
} from './b1-fixtures.js';

test('AC-004: paid Quick Aim + Single NS40 → target60 roll41, 2 degrees, Right Arm and one round spent', () => {
  const initial = deepFreeze(b1State());
  const aimed = resolveCombatAction(initial, action('aim', 'quick-aim'), dice()).state;
  const resolved = resolveRangedAttack(
    deepFreeze(aimed),
    attack(),
    dice({ sides: 100, value: 41 }),
  );
  expect(resolved.result.check).toMatchObject({
    baseValue: 40,
    target: 60,
    rawRoll: 41,
    totalDegrees: 2,
    outcome: 'success',
  });
  expect(resolved.result).toMatchObject({
    hitsGenerated: 1,
    shotsFired: 1,
    ammoSpent: 1,
    reversedRoll: 14,
  });
  expect(resolved.result.hits[0]).toMatchObject({
    location: 'Right Arm',
    sourceAttackRoll: 41,
    mode: 'single',
  });
  expect(resolved.state.session.turn?.od).toBe(0);
  expect(resolved.state.containers['mag:A']?.currentRounds).toBe(29);
  expect(resolved.state.actors.A?.aim).toBeUndefined();
  expect(initial.containers['mag:A']?.currentRounds).toBe(30);
});

test('AC-005: Short Burst 3 rounds, target50 roll29 → 2 hits and 3 ammo', () => {
  const result = resolveRangedAttack(
    b1State(50),
    attack('short', { mode: 'short-burst', shotsRequested: 3 }),
    dice({ sides: 100, value: 29 }, { sides: 2, value: 1 }),
  );
  expect(result.result).toMatchObject({ shotsFired: 3, ammoSpent: 3, hitsGenerated: 2 });
  expect(result.result.check).toMatchObject({ target: 50, totalDegrees: 3 });
  expect(result.result.hits).toHaveLength(2);
});

test('AC-006: Full Auto 6, target70 roll28 → 5 hits; Dodge LV50 roll29 → 3 cancelled, 2 survive', () => {
  const request = attack('auto', {
    mode: 'full-auto',
    shotsRequested: 6,
    dodge: { id: 'dodge', context: action('dodge', 'dodge', 'B').context },
  });
  const state = b1State(80);
  const result = resolveRangedAttack(
    state,
    request,
    dice({ sides: 100, value: 28 }, { sides: 100, value: 29 }, { sides: 2, value: 2 }),
  );
  expect(result.result.check).toMatchObject({ target: 70, rawRoll: 28, totalDegrees: 5 });
  expect(result.result).toMatchObject({
    hitsGenerated: 5,
    shotsFired: 6,
    ammoSpent: 6,
    cancelledHits: 3,
    survivingHits: 2,
  });
  expect(result.result.dodge).toMatchObject({
    dodgeDegrees: 3,
    cancelledHits: 3,
    survivingHits: 2,
  });
  expect(result.state.containers['mag:A']?.currentRounds).toBe(24);
  expect(result.state.session.initiativeOrder[1]?.reactions.remaining).toBe(0);
  expect(result.result.hits).toHaveLength(2);
  expect(result.logs.at(-1)?.ranged).toEqual(result.result);
  expect(result.logs.at(-1)?.dice).toEqual([
    { sides: 100, value: 28 },
    { sides: 100, value: 29 },
    { sides: 2, value: 2 },
  ]);
  expect(result.result.hits[1]?.secondarySide).toMatchObject({
    side: 'Right',
    roll: { sides: 2, value: 2 },
  });
});

test('negative target critical-success rescue produces exactly ONE Full Auto hit', () => {
  const result = resolveRangedAttack(
    b1State(20),
    attack('rescue', { mode: 'full-auto', shotsRequested: 6, distance: 500 }),
    dice({ sides: 100, value: 3 }),
  );
  expect(result.result.check).toMatchObject({
    target: -20,
    criticalBand: 'success',
    outcome: 'success',
    baseDegrees: 1,
    superDegrees: 0,
    totalDegrees: 1,
  });
  expect(result.result).toMatchObject({ hitsGenerated: 1, ammoSpent: 6 });
  expect(result.result.hits[0]?.location).toBe('Left Arm');
});

test('energy-beam Full Auto uses +0 rather than kinetic -10', () => {
  const state = b1State(50);
  const gun = state.weapons['gun:A']!;
  const changed = {
    ...state,
    weapons: {
      ...state.weapons,
      [gun.id]: {
        ...gun,
        template: {
          ...gun.template,
          profile: { ...gun.template.profile, classification: 'energy-beam' as const },
        },
      },
    },
  };
  const result = resolveRangedAttack(
    changed,
    attack('beam', { mode: 'full-auto', shotsRequested: 1 }),
    dice({ sides: 100, value: 40 }),
  );
  expect(result.result.check.target).toBe(50);
  expect(result.result.modeModifier).toBe(0);
});

test.each([96, 97, 98, 99, 100])(
  'raw %i generates generic malfunction/jam with retained roll',
  (roll) => {
    const result = resolveRangedAttack(
      b1State(150),
      attack('jam'),
      dice({ sides: 100, value: roll }),
    );
    expect(result.result).toMatchObject({
      malfunction: true,
      jammed: true,
      hitsGenerated: 0,
      survivingHits: 0,
    });
    expect(result.result.check.rawRoll).toBe(roll);
    expect(result.state.weapons['gun:A']?.jammed).toBe(true);
    expect(result.execution.mutations).toContainEqual(
      expect.objectContaining({ type: 'jam-state', before: false, after: true }),
    );
  },
);

test.each([41, 90])(
  'Clear Malfunction costs 2 OD; success clears / failure retains jam (roll %i)',
  (roll) => {
    const state = b1State(50);
    const jammed = {
      ...state,
      weapons: { ...state.weapons, 'gun:A': { ...state.weapons['gun:A']!, jammed: true } },
    };
    const result = clearMalfunction(
      deepFreeze(jammed),
      { ...action('clear', 'clear-malfunction'), weaponId: 'gun:A' },
      dice({ sides: 100, value: roll }),
    );
    expect(result.result.target).toBe(50);
    expect(result.state.session.turn?.od).toBe(0);
    expect(result.state.weapons['gun:A']?.jammed).toBe(roll > 50);
  },
);

test.each([
  ['Eyes', -50],
  ['Head', -20],
  ['Right Arm', -20],
  ['Left Arm', -20],
  ['Torso', -10],
  ['Right Leg', -15],
  ['Left Leg', -15],
  ['Armor Joints', -40],
] as const)('Called Single %s modifier %i is a separate source', (calledLocation, value) => {
  const result = resolveRangedAttack(
    b1State(100),
    attack('called', { type: 'called-attack', calledLocation }),
    dice({ sides: 100, value: 41 }),
  );
  expect(result.result.check.modifiers).toContainEqual(
    expect.objectContaining({ id: 'ranged:called', value, included: true }),
  );
  expect(result.result.hits[0]?.location).toBe(calledLocation);
  expect(result.state.session.turn?.od).toBe(0);
});

test('second attack rejected unless an explicit Effect grants an additional slot', () => {
  const first = resolveRangedAttack(b1State(80), attack('first'), dice({ sides: 100, value: 41 }));
  expect(() =>
    expectUnchangedOnError(first.state, (state) =>
      resolveRangedAttack(state, attack('second'), dice()),
    ),
  ).toThrow('Second attack');
  const grant = extraEffect('additional-attack', 1, {
    target: { kind: 'permission', permission: 'attack' },
    operation: 'grant',
  });
  const actor = first.state.actors.A!;
  const state = {
    ...first.state,
    actors: { ...first.state.actors, A: { ...actor, effects: [grant] } },
  };
  expect(
    resolveRangedAttack(state, attack('second-with-grant'), dice({ sides: 100, value: 41 })).state
      .session.turn?.od,
  ).toBe(0);
});

test('weapon-specific set effect replaces only the generic mode modifier through ResolutionContext', () => {
  const initial = b1State(50);
  const gun = initial.weapons['gun:A']!;
  const replacement = extraEffect('specific-mode', 0, {
    target: { kind: 'combat-modifier', key: 'ranged:mode' },
    operation: 'set',
    condition: { requiresTags: ['mode:single'] },
  });
  const state = deepFreeze({
    ...initial,
    weapons: {
      ...initial.weapons,
      [gun.id]: { ...gun, template: { ...gun.template, effects: [replacement.definition] } },
    },
  });
  const result = resolveRangedAttack(state, attack(), dice({ sides: 100, value: 41 }));
  expect(result.result.check.target).toBe(50);
  expect(result.result.check.modifiers).toContainEqual(
    expect.objectContaining({ id: 'ranged:mode', originalValue: 10, included: false }),
  );
  expect(result.result.check.modifiers).toContainEqual(
    expect.objectContaining({
      id: `effect:weapon:${gun.id}:specific-mode`,
      value: 0,
      included: true,
    }),
  );
  expect(state.weapons[gun.id]?.template.effects[0]?.value).toBe(0);
  expect(state.weapons[gun.id]?.template.effects[0]).not.toHaveProperty('targetActor');
  expect(result.execution.context.effects[0]?.targetActor).toEqual({ actorId: 'A' });
});

test('profile composition is transient, with pattern/modification/ammo provenance intact', () => {
  const state = b1State();
  const gun = state.weapons['gun:A']!;
  const changed = {
    ...gun,
    pattern: {
      source: fixtureSource,
      provenance: fixtureProvenance,
      profile: { optimalRange: 120 },
      effects: [],
    },
    modifications: [
      {
        source: fixtureSource,
        provenance: fixtureProvenance,
        profile: { optimalRange: 150 },
        effects: [],
      },
    ],
  };
  const container = {
    ...state.containers['mag:A']!,
    ammo: {
      ...state.containers['mag:A']!.ammo,
      contribution: {
        source: fixtureSource,
        provenance: fixtureProvenance,
        profile: { optimalRange: 200 },
        effects: [],
      },
    },
  };
  const effective = effectiveRangedProfile(deepFreeze(changed), deepFreeze(container));
  expect(effective.profile.optimalRange).toBe(200);
  expect(effective.provenance).toHaveLength(5);
  expect(gun.template.profile.optimalRange).toBe(100);
});

test.each(['INCLUDE', 'EXCLUDE', 'MODIFY'] as const)(
  'one-resolution GM %s keeps Actor/weapon/effect source data intact',
  (operation) => {
    const state = deepFreeze(b1State(40));
    const context = {
      ...attack().context,
      overrides: [
        operation === 'MODIFY'
          ? {
              subject: 'modifier' as const,
              id: 'ranged:mode',
              operation,
              value: 20,
              reason: 'GM check',
            }
          : { subject: 'modifier' as const, id: 'ranged:mode', operation, reason: 'GM check' },
      ],
    };
    const result = resolveRangedAttack(
      state,
      attack('gm', { context }),
      dice({ sides: 100, value: 41 }),
    );
    expect(result.result.check.target).toBe(
      operation === 'EXCLUDE' ? 40 : operation === 'MODIFY' ? 60 : 50,
    );
    expect(result.logs.at(-1)?.overrides).toEqual(context.overrides);
    expect(state.containers['mag:A']?.currentRounds).toBe(30);
    expect(state.actors.A?.characteristics.НС.baseValue).toBe(40);
    expect(state.weapons['gun:A']?.jammed).toBe(false);
  },
);

test('Careful Aim ignores only explicitly marked canonical sources and keeps their values in the trace', () => {
  const aimed = resolveCombatAction(b1State(80), action('careful', 'careful-aim'), dice()).state;
  // The next own turn may spend the prepared aim; no cancellation policy is invented.
  const state = advanceToNextOwnTurn(aimed);
  const speed = { ...modifier('target-speed', -20), tags: ['careful-aim:target-speed'] };
  const smoke = modifier('smoke', -10);
  const result = resolveRangedAttack(
    state,
    attack('careful-shot', { context: { ...attack().context, modifiers: [speed, smoke] } }),
    dice({ sides: 100, value: 41 }),
  );
  expect(result.result.check.target).toBe(100);
  expect(result.result.check.modifiers).toContainEqual(
    expect.objectContaining({ id: 'target-speed', originalValue: -20, included: false }),
  );
  expect(result.result.check.modifiers).toContainEqual(
    expect.objectContaining({ id: 'smoke', originalValue: -10, included: true }),
  );
  expect(speed.value).toBe(-20);
});

test('Stunned source Effect restrictions prevent actions and Dodge without consuming state', () => {
  const state = b1State(80);
  const session = applyStunned(state.session, {
    id: 'stun',
    actor: { actorId: 'B' },
    source: fixtureSource,
    provenance: fixtureProvenance,
    durationRounds: 2,
  }).result;
  const stunned = { ...state, session };
  expect(() =>
    expectUnchangedOnError(stunned, (input) =>
      resolveRangedAttack(
        input,
        attack('stun-shot', {
          dodge: { id: 'no-dodge', context: action('no-dodge', 'dodge', 'B').context },
        }),
        dice(),
      ),
    ),
  ).toThrow('prohibited');
});

test('Dodge failure spends Reaction but cancels zero; original attack remains unchanged', () => {
  const state = b1State();
  const result = resolveDodge(
    deepFreeze(state),
    action('failed-dodge', 'dodge', 'B'),
    5,
    true,
    dice({ sides: 100, value: 90 }),
  );
  expect(result.result).toMatchObject({
    generatedHits: 5,
    dodgeDegrees: 0,
    cancelledHits: 0,
    survivingHits: 5,
  });
  expect(result.state.session.initiativeOrder[1]?.reactions.remaining).toBe(0);
  expect(state.session.initiativeOrder[1]?.reactions.remaining).toBe(1);
});

test('attack after own turn ended is rejected without retained Wait', () => {
  const ended = finishActionTurn(b1State()).state;
  expect(() =>
    expectUnchangedOnError(ended, (state) => resolveRangedAttack(state, attack(), dice())),
  ).toThrow('No retained Wait');
});

test.each([false, true])(
  'Careful Aim preserves penalty Effect provenance; explicit GM INCLUDE = %s',
  (include) => {
    const penalty = extraEffect('height', -20, {
      target: { kind: 'check' },
      operation: 'add',
      tags: ['careful-aim:height'],
    });
    const initial = b1State(50);
    const withEffect = {
      ...initial,
      actors: { ...initial.actors, A: { ...initial.actors.A!, effects: [penalty] } },
    };
    const aimed = resolveCombatAction(withEffect, action('careful', 'careful-aim'), dice()).state;
    const state = deepFreeze(advanceToNextOwnTurn(aimed));
    const context = {
      ...attack().context,
      overrides: include
        ? [
            {
              subject: 'effect' as const,
              id: penalty.id,
              operation: 'INCLUDE' as const,
              reason: 'GM keeps this penalty',
            },
          ]
        : [],
    };
    const result = resolveRangedAttack(
      state,
      attack('careful-effect', { context }),
      dice({ sides: 100, value: 41 }),
    );
    expect(result.result.check.target).toBe(include ? 60 : 80);
    expect(result.result.check.modifiers).toContainEqual(
      expect.objectContaining({ id: penalty.id, originalValue: -20, included: include }),
    );
    expect(penalty.definition.value).toBe(-20);
    expect(result.result.aim?.characteristics).toEqual(['НС', 'НР']);
  },
);

test.each(['INCLUDE', 'EXCLUDE', 'MODIFY'] as const)(
  'range GM %s is local to one resolution',
  (operation) => {
    const initial = deepFreeze(b1State(50));
    const context = {
      ...attack().context,
      overrides: [
        operation === 'MODIFY'
          ? {
              subject: 'modifier' as const,
              id: 'ranged:range',
              operation,
              value: 5,
              reason: 'One shot ruling',
            }
          : {
              subject: 'modifier' as const,
              id: 'ranged:range',
              operation,
              reason: 'One shot ruling',
            },
      ],
    };
    const result = resolveRangedAttack(
      initial,
      attack('range-gm', { distance: 300, context }),
      dice({ sides: 100, value: 41 }),
    );
    expect(result.result.check.target).toBe(
      operation === 'EXCLUDE' ? 60 : operation === 'MODIFY' ? 65 : 50,
    );
    expect(result.result.range.modifier).toBe(-10);
    expect(initial.weapons['gun:A']!.template.profile.optimalRange).toBe(100);
    expect(attack().context.overrides).toEqual([]);
  },
);

test('a missed burst still spends fired rounds; an unneeded Dodge consumes no Reaction or extra RNG', () => {
  const state = deepFreeze(b1State(50));
  const result = resolveRangedAttack(
    state,
    attack('miss', {
      mode: 'short-burst',
      shotsRequested: 3,
      dodge: { id: 'unused-dodge', context: action('unused-dodge', 'dodge', 'B').context },
    }),
    dice({ sides: 100, value: 90 }),
  );
  expect(result.result).toMatchObject({
    hitsGenerated: 0,
    shotsFired: 3,
    ammoSpent: 3,
    dodge: null,
    hits: [],
  });
  expect(result.state.session.initiativeOrder[1]?.reactions.remaining).toBe(1);
  expect(result.state.completedActionIds).toEqual(['miss']);
});

test('12-hit Full Auto keeps the cyclic sequence, individual fair side rolls and unresolved references in log', () => {
  const state = deepFreeze(b1State(140));
  const result = resolveRangedAttack(
    state,
    attack('twelve', { mode: 'full-auto', shotsRequested: 12 }),
    dice({ sides: 100, value: 10 }, ...[1, 2, 1, 2, 1].map((value) => ({ sides: 2, value }))),
  );
  expect(result.result.hitsGenerated).toBe(12);
  expect(result.result.hits.map((hit) => hit.location)).toEqual([
    'Eyes',
    'Head',
    'Left Arm',
    'Torso',
    'Right Arm',
    'Torso',
    'Head',
    'Left Arm',
    'Torso',
    'Right Arm',
    'Torso',
    'Head',
  ]);
  expect(result.result.hits[11]?.sequenceGroup).toBe(result.result.hits[1]?.sequenceGroup);
  expect(result.logs.at(-1)?.ranged?.hits).toEqual(result.result.hits);
  expect(result.logs.at(-1)?.dice).toHaveLength(5);
  for (const hit of result.result.hits) {
    expect(hit.unresolvedDamage).toEqual(state.weapons['gun:A']!.template.profile.damage);
    expect(hit.unresolvedPenetration).toEqual(state.weapons['gun:A']!.template.profile.penetration);
  }
});

test('failure of a later injected die returns no partial action/ammunition mutation', () => {
  expect(() =>
    expectUnchangedOnError(b1State(80), (state) =>
      resolveRangedAttack(
        state,
        attack('rng-exhausted', { mode: 'short-burst', shotsRequested: 3 }),
        dice({ sides: 100, value: 29 }),
      ),
    ),
  ).toThrow();
});

test('Dodge cannot spend the outside-turn Reaction during its own active turn', () => {
  expect(() =>
    expectUnchangedOnError(b1State(), (state) =>
      resolveDodge(state, action('own-dodge', 'dodge'), 1, true, dice()),
    ),
  ).toThrow('outside own turn');
});
