import { expect, it, vi } from 'vitest';
import type { SuppressionEvent, EquipmentInstance, SuppressionCandidate } from '@kadat/contracts';
import {
  resolveSuppression,
  suppressionTrigger,
  collectEquipmentEffects,
  equipmentEffectId,
  resolveEquipmentCombatAction,
  resolveEquipmentRangedAttack,
  beginSuppressionEquipmentTurn,
  resolveSuppressionTurnStart,
  finishActionTurn,
  characteristicCapPayload,
  resolveCharacteristic,
  finishEquipmentTurn,
} from '../src/index.js';
import { dState, single, burst, area, candidate, equipment, rng, ctx } from './d-fixtures.js';
import { action, attack } from './b1-fixtures.js';
import { deepFreeze } from './fixtures.js';

it.each([
  ['missing source attack id', { ...single(), attackId: '' }],
  ['negative degrees', { ...single(), successDegrees: -1 }],
  ['negative shots', { ...burst(), shotsForSuppression: -1 }],
  ['fractional shots', { ...burst(), shotsForSuppression: 1.5 }],
  ['unsupported weapon class', { ...burst(), weaponClass: 'UNKNOWN' }],
  ['quantity derived from hits', { ...burst(), quantitySource: 'HITS' }],
  [
    'negative radius',
    { ...area(), radii: [{ property: 'EXPLOSION', meters: -1, provenance: area().provenance }] },
  ],
  ['missing area radii', { ...area(), radii: [] }],
  ['unknown trigger type', { ...single(), kind: 'OTHER' }],
] as const)('rejects %s without mutation', (_name, malformed) => {
  const state = deepFreeze(dState()),
    before = JSON.stringify(state);
  expect(() =>
    resolveSuppression(state, malformed as SuppressionEvent, [candidate()], rng()),
  ).toThrow();
  expect(JSON.stringify(state)).toBe(before);
});
it('missing affected target SW fails before committing', () => {
  const s = dState();
  const b = s.combat.actors.B!;
  const malformed = {
    ...s,
    combat: {
      ...s.combat,
      actors: {
        ...s.combat.actors,
        B: { ...b, characteristics: { НС: b.characteristics.НС, ЛВ: b.characteristics.ЛВ } },
      },
    },
  };
  expect(() => resolveSuppression(deepFreeze(malformed), single(), [candidate()], rng())).toThrow(
    'Missing target SW',
  );
});
it.each([-1, NaN, Infinity])('rejects malformed target distance %s', (distance) =>
  expect(() =>
    resolveSuppression(dState(), burst(), [candidate('B', 'NO', distance)], rng()),
  ).toThrow(),
);
it('out-of-radius target cannot be suppressed', () =>
  expect(
    resolveSuppression(dState(), burst(), [candidate('B', 'NO', 10.1)], rng()).targets[0]?.status,
  ).toBe('NOT_AFFECTED'));
it('rejects duplicate candidate ids before RNG', () =>
  expect(() => resolveSuppression(dState(), burst(), [candidate(), candidate()], rng())).toThrow(
    'duplicate',
  ));
it('invalid cover enum is rejected', () =>
  expect(() =>
    resolveSuppression(
      dState(),
      single(),
      [{ ...candidate(), nearestCoverWithinSpeed: 'MAYBE' } as unknown as SuppressionCandidate],
      rng(),
    ),
  ).toThrow());
it('processed event cannot be replayed or spend ammo twice', () => {
  const r = resolveSuppression(dState(), single(), [candidate()], rng(56));
  expect(() => resolveSuppression(r.state, single(), [candidate()], rng())).toThrow(
    'already resolved',
  );
});
it('first affected turn cannot get an early removal check', () => {
  const s = resolveSuppression(dState(), single(), [candidate()], rng(56)).state;
  const first = beginSuppressionEquipmentTurn(
    { ...s, combat: finishActionTurn(s.combat).state },
    ctx(),
    rng(),
  ).state;
  expect(() => resolveSuppressionTurnStart(first, { actorId: 'B' }, ctx(), rng(1))).toThrow(
    'already processed',
  );
});
it('cannot run lifecycle for a different active actor', () =>
  expect(() => resolveSuppressionTurnStart(dState(), { actorId: 'B' }, ctx(), rng())).toThrow(
    'own turn',
  ));
it('active condition overlap returns typed pending, preserving original source', () => {
  const s = resolveSuppression(dState(), single(), [candidate()], rng(56)).state;
  const r = resolveSuppression(deepFreeze(s), single(3, 'new-source'), [candidate()], rng(80));
  expect(r.state).toBe(s);
  expect(r.targets[0]?.pending[0]?.type).toBe('SuppressionStackingPending');
  expect(r.targets[0]?.pending[0]).toMatchObject({ source: { attackId: 'new-source' } });
});
it('unpowered suppression immunity does not apply', () => {
  const s = {
    ...dState(),
    equipment: [equipment([{ kind: 'SUPPRESSION_IMMUNITY' }], 'B', { powerState: 'UNPOWERED' })],
  };
  expect(resolveSuppression(s, single(), [candidate()], rng(56)).targets[0]?.status).toBe(
    'SUPPRESSED',
  );
});
it('ordinary powered armor name does not imply immunity', () => {
  const s = { ...dState(), equipment: [equipment([], 'B', { id: 'Servo Power Armor' })] };
  expect(resolveSuppression(s, single(), [candidate()], rng(56)).targets[0]?.check?.rawRoll).toBe(
    56,
  );
});
it('unknown power mapping pending leaves conditions unchanged', () => {
  const item = equipment([{ kind: 'CHECK_MODIFIER', scope: 'suppression', value: 10 }]);
  const s = deepFreeze({
    ...dState(),
    equipment: [
      { ...item, effects: item.effects.map((e) => ({ ...e, requiresPower: 'UNKNOWN' as const })) },
    ],
  });
  const r = resolveSuppression(s, single(), [candidate()], rng());
  expect(r.state).toBe(s);
  expect(r.targets[0]?.pending[0]?.type).toBe('PowerDependencyMappingPending');
});
it('pending autosenses expose no executable summed effects', () => {
  const c = collectEquipmentEffects(
    [
      equipment([
        { kind: 'SENSORY_CHECK_MODIFIER', scope: 'visual', value: 10 },
        { kind: 'SENSORY_CHECK_MODIFIER', scope: 'visual', value: 10 },
      ]),
    ],
    ctx('B', ['check:visual']),
  );
  expect(c.status).toBe('PENDING');
  expect(c.effects).toHaveLength(0);
  expect(c.context.effects).toHaveLength(0);
});
it('absent and dash caps are absent, never zero', () => {
  expect(characteristicCapPayload('ЛВ', '-')).toBeNull();
  expect(characteristicCapPayload('ЛВ', undefined)).toBeNull();
  expect(characteristicCapPayload('ЛВ', 0)).toEqual({
    kind: 'CHARACTERISTIC_CAP',
    characteristic: 'ЛВ',
    value: 0,
  });
});
it('numeric cap rejects malformed nonnumeric data', () =>
  expect(() => characteristicCapPayload('ЛВ', '50' as unknown as number)).toThrow());
it('conflicting cap values require selection, not minimum guessing', () => {
  const c = collectEquipmentEffects(
    [
      equipment([
        { kind: 'CHARACTERISTIC_CAP', characteristic: 'ЛВ', value: 50 },
        { kind: 'CHARACTERISTIC_CAP', characteristic: 'ЛВ', value: 40 },
      ]),
    ],
    ctx(),
  );
  expect(c.status).toBe('PENDING');
  expect(c.pending[0]?.type).toBe('EquipmentStackingPending');
});
it('GM cannot silently reactivate a physically unpowered source', () => {
  const item = equipment([{ kind: 'CHARACTERISTIC_ADD', characteristic: 'СЛ', value: 20 }], 'B', {
    powerState: 'UNPOWERED',
  });
  expect(() =>
    collectEquipmentEffects([item], {
      ...ctx(),
      overrides: [
        {
          subject: 'effect',
          id: equipmentEffectId(item.effects[0]!),
          operation: 'INCLUDE',
          reason: 'force inactive',
        },
      ],
    }),
  ).toThrow('Unknown override');
});
it('unresolved equipment blocks action without spending', () => {
  const state = deepFreeze(dState().combat),
    item = equipment([{ kind: 'CHARACTERISTIC_ADD', characteristic: 'СЛ', value: 20 }], 'A');
  const r = resolveEquipmentCombatAction(
    state,
    [{ ...item, effects: item.effects.map((e) => ({ ...e, requiresPower: 'UNKNOWN' as const })) }],
    action('movement', 'half-move'),
    rng(),
  );
  expect(r.status).toBe('PENDING');
  expect(r.state).toBe(state);
});
it('one-handed heavy operation without explicit permission fails', () =>
  expect(() =>
    resolveEquipmentRangedAttack(deepFreeze(dState().combat), [], attack(), rng(), {
      weaponClass: 'HEAVY',
      hands: 1,
    }),
  ).toThrow('explicit permission'));
it('equipment restriction Run rejects without OD/Reaction mutation', () => {
  const s = deepFreeze(dState().combat);
  expect(() =>
    resolveEquipmentCombatAction(
      s,
      [equipment([{ kind: 'ACTION_RESTRICTION', action: 'run' }], 'A')],
      action('run', 'run'),
      rng(),
    ),
  ).toThrow('restricted');
  expect(s.session.turn?.od).toBe(2);
  expect(s.session.turn?.reactions.remaining).toBe(1);
});
it('equipment cannot make negative action cost', () =>
  expect(() =>
    resolveEquipmentCombatAction(
      dState().combat,
      [
        equipment(
          [{ kind: 'MOVEMENT_MODIFIER', field: 'od', action: 'half-move', value: -2 }],
          'A',
        ),
      ],
      action('half', 'half-move'),
      rng(),
    ),
  ).toThrow('action cost'));
it('equipment cannot make movement nonpositive', () =>
  expect(() =>
    resolveEquipmentCombatAction(
      dState().combat,
      [equipment([{ kind: 'MOVEMENT_MODIFIER', field: 'speed', value: -10 }], 'A')],
      action('half', 'half-move'),
      rng(),
    ),
  ).toThrow('movement'));
it('disabled bio-monitor must not remove Stunned', () => {
  const s = dState().combat;
  const monitor = equipment(
    [{ kind: 'CONDITION_REMOVAL_TRIGGER', timing: 'END_OWN_TURN', condition: 'Stunned' }],
    'A',
    { powerState: 'UNPOWERED' },
  );
  expect(
    finishEquipmentTurn(s, [monitor], ctx('A')).logs.some(
      (l) => l.resolver === 'equipment-end-turn',
    ),
  ).toBe(false);
});
it('hidden global RNG is never used', () => {
  const random = vi.spyOn(Math, 'random').mockImplementation(() => {
    throw new Error('global RNG');
  });
  try {
    expect(resolveSuppression(dState(), single(), [candidate()], rng(56)).status).toBe('RESOLVED');
  } finally {
    random.mockRestore();
  }
});
it('critical high-target failure with unresolved nonpositive degrees stays pending', () => {
  const s = dState(150);
  const r = resolveSuppression(s, single(), [candidate()], rng(96));
  expect(r.state).toBe(s);
  expect(r.targets[0]?.pending[0]?.type).toBe('SuppressionDurationPending');
});
it('explicit cape effect never mutates original characteristic storage', () => {
  const base = deepFreeze({ baseValue: 63, baseSuper: 0 });
  const c = collectEquipmentEffects(
    [equipment([{ kind: 'CHARACTERISTIC_CAP', characteristic: 'ЛВ', value: 50 }])],
    ctx(),
  );
  expect(resolveCharacteristic('ЛВ', base, c.context).result.finalValue).toBe(50);
  expect(base.baseValue).toBe(63);
});
it('empty equipment/source IDs rejected', () => {
  const item = equipment([]);
  expect(() => collectEquipmentEffects([{ ...item, id: '' }], ctx())).toThrow();
});
it('invalid equipment power enum rejected', () =>
  expect(() =>
    collectEquipmentEffects(
      [{ ...equipment([]), powerState: 'MAYBE' } as unknown as EquipmentInstance],
      ctx(),
    ),
  ).toThrow('power state'));
it('missing explicit power dependency rejected', () => {
  const item = equipment([{ kind: 'CHARACTERISTIC_ADD', characteristic: 'СЛ', value: 20 }]);
  expect(() =>
    collectEquipmentEffects(
      [
        {
          ...item,
          effects: item.effects.map((e) => ({ ...e, requiresPower: undefined })),
        } as unknown as EquipmentInstance,
      ],
      ctx(),
    ),
  ).toThrow('power dependency');
});
it('typed sensory capability cannot be numeric GM modified', () => {
  const item = equipment([{ kind: 'SENSORY_MODE', mode: 'NIGHT_VISION' }]);
  expect(() =>
    collectEquipmentEffects([item], {
      ...ctx(),
      overrides: [
        {
          subject: 'effect',
          id: equipmentEffectId(item.effects[0]!),
          operation: 'MODIFY',
          value: 5,
          reason: 'invalid',
        },
      ],
    }),
  ).toThrow('capability');
});
it('malformed area source lacks provenance => rejected', () =>
  expect(() =>
    suppressionTrigger({
      ...area(),
      radii: [
        {
          property: 'LV',
          meters: 2,
          provenance: { source: { kind: 'missing', id: '' }, reason: '' },
        },
      ],
    }),
  ).toThrow());
