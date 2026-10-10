import { expect, it } from 'vitest';
import {
  suppressionEventFromRanged,
  resolveSuppression,
  resolveRangedAttack,
  collectEquipmentEffects,
  equipmentEffectId,
  resolveEquipmentCheck,
  resolveEquipmentSize,
  resolveEquipmentCombatAction,
  finishEquipmentTurn,
  resolveCharacteristic,
  resolveProtectionDamage,
  beginActionTurn,
  finishActionTurn,
  beginActionRound,
  beginSuppressionEquipmentTurn,
  planWoundCondition,
  equipmentConditionAllowed,
  createSuppressionEquipmentState,
} from '../src/index.js';
import {
  dState,
  single,
  area,
  candidate,
  equipment,
  rng,
  ctx,
  provenance,
  source,
} from './d-fixtures.js';
import { action, attack, dice } from './b1-fixtures.js';
import { deepFreeze } from './fixtures.js';
import { field, request as damageRequest } from './c1-fixtures.js';
import { state as woundState } from './c2-fixtures.js';
import { onBTurn } from './b2-fixtures.js';
import type { EquipmentInstance, SuppressionEvent } from '@kadat/contracts';

it('accepted full-auto result feeds suppression by shots rather than hits', () => {
  const s = dState(80);
  const a = resolveRangedAttack(
    s.combat,
    attack('auto', { mode: 'full-auto', shotsRequested: 6 }),
    rng(28),
  );
  const event = suppressionEventFromRanged({
    attackId: 'auto',
    sourceActor: { actorId: 'A' },
    primaryTarget: { actorId: 'B' },
    weapon: source,
    weaponClass: 'BASIC',
    result: a.result,
    provenance,
  });
  expect(event).toMatchObject({ kind: 'BURST', shotsForSuppression: 6 });
  const r = resolveSuppression({ ...s, combat: a.state }, event, [candidate()], rng(50));
  expect(r.state.combat.containers['mag:A']?.currentRounds).toBe(24);
  expect(r.targets[0]?.modifier).toBe(-6);
  expect(r.targets[0]?.check?.target).toBe(74);
});
it('accepted single shot success degrees and ammo are immutable', () => {
  const s = dState();
  const a = deepFreeze(resolveRangedAttack(s.combat, attack(), rng(21)));
  const before = JSON.stringify(a);
  const event = suppressionEventFromRanged({
    attackId: 'shot',
    sourceActor: { actorId: 'A' },
    primaryTarget: { actorId: 'B' },
    weapon: source,
    weaponClass: 'BASIC',
    result: a.result,
    provenance,
  });
  const r = resolveSuppression({ ...s, combat: a.state }, event, [candidate()], rng(56));
  expect(r.targets[0]?.modifier).toBe(-15);
  expect(r.state.combat.containers['mag:A']?.currentRounds).toBe(29);
  expect(JSON.stringify(a)).toBe(before);
});
it('malfunction preserves accepted actual fired quantity without spending again', () => {
  const s = dState();
  const a = resolveRangedAttack(
    s.combat,
    attack('jam', { mode: 'full-auto', shotsRequested: 6 }),
    rng(98),
  );
  const event = suppressionEventFromRanged({
    attackId: 'jam',
    sourceActor: { actorId: 'A' },
    primaryTarget: { actorId: 'B' },
    weapon: source,
    weaponClass: 'BASIC',
    result: a.result,
    provenance,
  });
  const r = resolveSuppression({ ...s, combat: a.state }, event, [candidate()], rng(56));
  expect(r.targets[0]?.modifier).toBe(-a.result.shotsFired);
  expect(r.state.combat.containers['mag:A']?.currentRounds).toBe(
    a.state.containers['mag:A']?.currentRounds,
  );
});
it('adapter rejects inconsistent ammo/shot accepted result', () => {
  const s = dState();
  const a = resolveRangedAttack(s.combat, attack(), rng(41));
  expect(() =>
    suppressionEventFromRanged({
      attackId: 'bad',
      sourceActor: { actorId: 'A' },
      primaryTarget: { actorId: 'B' },
      weapon: source,
      weaponClass: 'BASIC',
      result: { ...a.result, ammoSpent: 2 },
      provenance,
    }),
  ).toThrow('firing quantity');
});
it('area selects maximum radius across three properties and inclusive edge', () => {
  const event: SuppressionEvent = {
    ...area(),
    radii: [
      { property: 'EXPLOSION', meters: 3, provenance },
      { property: 'MV', meters: 6, provenance },
      { property: 'LV', meters: 4, provenance },
    ],
  };
  const r = resolveSuppression(
    dState(),
    event,
    [candidate('B', 'NO', 16), candidate('C', 'NO', 16.01)],
    rng(20),
  );
  expect(r.targets.map((t) => t.status)).toEqual(['PASSED', 'NOT_AFFECTED']);
  expect(r.targets[0]?.modifier).toBe(-30);
});
it('single targets only the primary actor regardless of proximity', () =>
  expect(resolveSuppression(dState(), single(), [candidate('C')], rng()).targets[0]?.status).toBe(
    'NOT_AFFECTED',
  ));
it('no kill prerequisite on a successful single suppression trigger', () =>
  expect(
    resolveSuppression(dState(), single(), [candidate()], rng(56)).state.suppressed,
  ).toHaveLength(1));
it('forced cover intent uses equipment-adjusted current SKR', () => {
  const s = {
    ...dState(),
    equipment: [equipment([{ kind: 'MOVEMENT_MODIFIER', field: 'speed', value: 2 }])],
  };
  const r = resolveSuppression(s, single(), [candidate('B', 'YES')], rng(56));
  expect(r.targets[0]?.response).toMatchObject({ maxDistance: 10 });
  expect(r.state.combat.actors.B?.movement).toBe(8);
});
it('NS penalty does not apply to Dodge/other checks or out-of-turn attack', () => {
  const s = resolveSuppression(dState(), single(), [candidate()], rng(56)).state;
  const effects = s.combat.session.conditions[0]!.effects;
  const check = resolveEquipmentCheck(s.combat, [], 'ЛВ', { ...ctx(), effects }, rng(29), 'dodge');
  expect(check.check?.target).toBe(50);
});
it('Super-characteristic contribution is preserved on suppression SW checks', () => {
  const s = dState(),
    b = s.combat.actors.B!;
  const r = resolveSuppression(
    {
      ...s,
      combat: {
        ...s.combat,
        actors: {
          ...s.combat.actors,
          B: {
            ...b,
            characteristics: { ...b.characteristics, СВ: { baseValue: 50, baseSuper: 4 } },
          },
        },
      },
    },
    single(),
    [candidate()],
    rng(28),
  );
  expect(r.targets[0]?.check).toMatchObject({ baseDegrees: 1, superDegrees: 2, totalDegrees: 3 });
});
it('optional C-2 check projection preserves Fatigue halving for SW', () => {
  const wounds = woundState();
  const b = wounds.combat.actors.B!;
  const combat = { ...wounds.combat, actors: { ...wounds.combat.actors, B: { ...b, fatigue: 4 } } };
  const s = createSuppressionEquipmentState(combat);
  const r = resolveSuppression(s, single(), [candidate()], rng(28), { ...wounds, combat });
  expect(r.targets[0]?.check?.baseValue).toBe(20);
  expect(r.targets[0]?.check?.target).toBe(5);
});
it('C-2 snapshot mismatch cannot be silently used for SW', () =>
  expect(() => resolveSuppression(dState(), single(), [candidate()], rng(), woundState())).toThrow(
    'snapshot mismatch',
  ));
it('application round counts as first suppression round and expiry is global round-end', () => {
  const s = resolveSuppression(dState(), single(), [candidate()], rng(36)).state; // one failure degree
  let combat = s.combat;
  for (let i = 0; i < 3; i++) {
    combat = finishActionTurn(combat).state;
    if (combat.session.phase !== 'round-ended') combat = beginActionTurn(combat).state;
  }
  expect(combat.session.conditions).toHaveLength(0);
  const turn = beginSuppressionEquipmentTurn(
    { ...s, combat: beginActionRound(combat).state },
    ctx('A'),
    rng(),
  );
  expect(turn.state.suppressed).toHaveLength(0);
  expect(turn.state.combat.session.turn?.od).toBe(2);
});
it('first affected turn may occur after application round, without early check', () => {
  let combat = dState().combat;
  combat = finishActionTurn(beginActionTurn(finishActionTurn(combat).state).state).state;
  combat = beginActionTurn(combat).state; // C active, B already acted
  let s = resolveSuppression({ ...dState(), combat }, single(), [candidate()], rng(56)).state;
  combat = finishActionTurn(s.combat).state;
  combat = beginActionRound(combat).state;
  combat = finishActionTurn(beginActionTurn(combat).state).state;
  s = beginSuppressionEquipmentTurn({ ...s, combat }, ctx(), rng()).state;
  expect(s.suppressed[0]?.firstAffectedTurn).toBe(s.combat.session.turn?.turnNumber);
  expect(s.combat.session.turn?.od).toBe(1);
});
it.each(['POWERED', 'UNPOWERED', 'DISABLED', 'EMP_DISABLED', 'SYSTEM_DISABLED'] as const)(
  'explicit power-state filtering: %s',
  (powerState) => {
    const item = equipment([{ kind: 'CHARACTERISTIC_ADD', characteristic: 'СЛ', value: 20 }], 'B', {
      powerState,
    });
    expect(collectEquipmentEffects([item], ctx()).traces[0]?.included).toBe(
      powerState === 'POWERED',
    );
  },
);
it.each(['UNPOWERED', 'EMP_DISABLED', 'SYSTEM_DISABLED'] as const)(
  'non-power-dependent physical contribution survives %s',
  (powerState) => {
    const item = equipment([{ kind: 'CHARACTERISTIC_ADD', characteristic: 'СЛ', value: 10 }], 'B', {
      powerState,
    });
    const c = collectEquipmentEffects(
      [{ ...item, effects: item.effects.map((e) => ({ ...e, requiresPower: false })) }],
      ctx(),
    );
    expect(c.traces[0]?.included).toBe(true);
  },
);
it('disabled specific subsystem leaves another powered subsystem active', () => {
  const item = equipment(
    [
      { kind: 'SENSORY_MODE', mode: 'NIGHT_VISION' },
      { kind: 'SENSORY_MODE', mode: 'THERMAL_VISION' },
    ],
    'B',
    { disabledSystemIds: ['subsystem:0'] },
  );
  expect(collectEquipmentEffects([item], ctx()).traces.map((t) => t.included)).toEqual([
    false,
    true,
  ]);
});
it('unequipped or another wearer source cannot contribute', () => {
  const item = equipment([{ kind: 'SUPPRESSION_IMMUNITY' }]);
  expect(collectEquipmentEffects([{ ...item, equipped: false }], ctx()).capabilities).toHaveLength(
    0,
  );
  expect(collectEquipmentEffects([item], ctx('A')).capabilities).toHaveLength(0);
});
it('required-state tags gate contributions without item-name interpretation', () => {
  const item = equipment([{ kind: 'CHARACTERISTIC_ADD', characteristic: 'СЛ', value: 10 }]);
  const equipped = {
    ...item,
    effects: item.effects.map((e) => ({ ...e, requiredTags: ['mode:braced'] })),
  };
  expect(collectEquipmentEffects([equipped], ctx()).traces[0]?.included).toBe(false);
  expect(collectEquipmentEffects([equipped], ctx('B', ['mode:braced'])).traces[0]?.included).toBe(
    true,
  );
});
it('explicit sensory SUM is permitted and preserves both sources', () => {
  const item = equipment([
    { kind: 'SENSORY_CHECK_MODIFIER', scope: 'visual', value: 10 },
    { kind: 'SENSORY_CHECK_MODIFIER', scope: 'visual', value: 5 },
  ]);
  const c = {
    ...item,
    effects: item.effects.map((e) => ({
      ...e,
      stacking: { group: 'sensors', rule: 'SUM' as const },
    })),
  };
  const r = resolveEquipmentCheck(dState().combat, [c], 'СВ', ctx(), rng(28), 'visual');
  expect(r.check?.target).toBe(65);
  expect(r.check?.modifiers.filter((m) => m.included)).toHaveLength(2);
});
it('explicit sensory LARGEST selects only one source, records other trace', () => {
  const item = equipment([
    { kind: 'SENSORY_CHECK_MODIFIER', scope: 'visual', value: 10 },
    { kind: 'SENSORY_CHECK_MODIFIER', scope: 'visual', value: 5 },
  ]);
  const c = {
    ...item,
    effects: item.effects.map((e) => ({
      ...e,
      stacking: { group: 'sensors', rule: 'LARGEST' as const },
    })),
  };
  expect(
    resolveEquipmentCheck(dState().combat, [c], 'СВ', ctx(), rng(28), 'visual').check?.target,
  ).toBe(60);
});
it('GM excludes one ambiguous sensor source for a single check', () => {
  const item = deepFreeze(
    equipment([
      { kind: 'SENSORY_CHECK_MODIFIER', scope: 'visual', value: 10 },
      { kind: 'SENSORY_CHECK_MODIFIER', scope: 'visual', value: 10 },
    ]),
  );
  const before = JSON.stringify(item);
  const context = {
    ...ctx(),
    overrides: [
      {
        subject: 'effect' as const,
        id: equipmentEffectId(item.effects[1]!),
        operation: 'EXCLUDE' as const,
        reason: 'GM chooses this sensor',
      },
    ],
  };
  const r = resolveEquipmentCheck(dState().combat, [item], 'СВ', context, rng(28), 'visual');
  expect(r.check?.target).toBe(60);
  expect(JSON.stringify(item)).toBe(before);
  expect(collectEquipmentEffects([item], ctx('B', ['check:visual'])).status).toBe('PENDING');
});
it('GM modifies one equipment source transiently and logs raw/corrected values', () => {
  const item = deepFreeze(equipment([{ kind: 'CHECK_MODIFIER', scope: 'suppression', value: 10 }]));
  const c = {
    ...candidate(),
    context: {
      ...ctx(),
      overrides: [
        {
          subject: 'effect' as const,
          id: equipmentEffectId(item.effects[0]!),
          operation: 'MODIFY' as const,
          value: 5,
          reason: 'GM resolution',
        },
      ],
    },
  };
  const r = resolveSuppression({ ...dState(), equipment: [item] }, single(), [c], rng(28));
  expect(r.targets[0]?.check?.target).toBe(40);
  expect(
    r.targets[0]?.check?.modifiers.find((m) => m.id === equipmentEffectId(item.effects[0]!)),
  ).toMatchObject({ originalValue: 10, value: 5, reason: 'override' });
  expect(item.effects[0]?.payload).toMatchObject({ value: 10 });
});
it('GM INCLUDE resolves a conditional sensory source for one context only', () => {
  const item = equipment([{ kind: 'SENSORY_CHECK_MODIFIER', scope: 'visual', value: 10 }]);
  const context = {
    ...ctx(),
    overrides: [
      {
        subject: 'effect' as const,
        id: equipmentEffectId(item.effects[0]!),
        operation: 'INCLUDE' as const,
        reason: 'one resolution include',
      },
    ],
  };
  const c = collectEquipmentEffects([item], context);
  expect(c.traces[0]?.reason).toBe('override');
  expect(collectEquipmentEffects([item], ctx()).traces[0]?.included).toBe(false);
});
it('equipment caps preserve Super and recompute derived bonus', () => {
  const item = equipment([{ kind: 'CHARACTERISTIC_CAP', characteristic: 'ЛВ', value: 50 }]);
  expect(
    resolveCharacteristic(
      'ЛВ',
      { baseValue: 63, baseSuper: 4 },
      collectEquipmentEffects([item], ctx()).context,
    ).result,
  ).toMatchObject({ finalValue: 50, normalBonus: 5, finalBonus: 9, finalSuper: 4 });
});
it('equipment movement modifies distance without storing a new base SKR', () => {
  const s = deepFreeze(dState().combat),
    item = equipment([{ kind: 'MOVEMENT_MODIFIER', field: 'speed', value: 2 }], 'A');
  const r = resolveEquipmentCombatAction(s, [item], action('half', 'half-move'), rng());
  expect(r.resolution?.result).toMatchObject({ distance: 10 });
  expect(r.state.actors.A?.movement).toBe(8);
  expect(r.state.session.turn?.od).toBe(1);
});
it('explicit movement OD modifier feeds accepted action spending once', () => {
  const s = dState().combat,
    item = equipment(
      [{ kind: 'MOVEMENT_MODIFIER', field: 'od', action: 'half-move', value: 1 }],
      'A',
    );
  const r = resolveEquipmentCombatAction(s, [item], action('half', 'half-move'), rng());
  expect(r.resolution?.execution.definition.odCost).toBe(2);
  expect(r.state.session.turn?.od).toBe(0);
});
it('action-specific movement OD modifier does not affect another movement', () => {
  const item = equipment(
    [{ kind: 'MOVEMENT_MODIFIER', field: 'od', action: 'half-move', value: 1 }],
    'A',
  );
  expect(
    resolveEquipmentCombatAction(dState().combat, [item], action('stand', 'stand'), rng()).state
      .session.turn?.od,
  ).toBe(1);
});
it('explicit size contribution is derived and source-linked', () => {
  const item = equipment([{ kind: 'SIZE_MODIFIER', value: 1 }]);
  const c = collectEquipmentEffects([item], ctx());
  expect(resolveEquipmentSize(2, c)).toBe(3);
  expect(c.log.equipment?.traces[0]?.contribution).toMatchObject({
    kind: 'SIZE_MODIFIER',
    value: 1,
  });
});
it('typed special movement permission is exposed without flight simulation', () => {
  const item = equipment([{ kind: 'ACTION_PERMISSION', action: 'movement:special' }]);
  expect(collectEquipmentEffects([item], ctx()).capabilities[0]?.contribution).toEqual({
    kind: 'ACTION_PERMISSION',
    action: 'movement:special',
  });
});
it('condition immunity is explicit and not a generic numeric bonus', () => {
  const c = collectEquipmentEffects(
    [equipment([{ kind: 'CONDITION_IMMUNITY', condition: 'Dazzling' }])],
    ctx(),
  );
  expect(equipmentConditionAllowed(c, 'Dazzling')).toBe(false);
  expect(equipmentConditionAllowed(c, 'Stunned')).toBe(true);
});
it('explicit check immunity bypasses RNG only for its scope', () => {
  const item = equipment([{ kind: 'CHECK_IMMUNITY', scope: 'visual' }]);
  expect(resolveEquipmentCheck(dState().combat, [item], 'СВ', ctx(), rng(), 'visual').status).toBe(
    'IMMUNE',
  );
  expect(
    resolveEquipmentCheck(dState().combat, [item], 'СВ', ctx(), rng(28), 'hearing').status,
  ).toBe('RESOLVED');
});
it('equipment exposes the existing C-1 field source without a new protection pipeline', () => {
  const canonicalField = deepFreeze(field({ type: 'CANCEL_HIT' }));
  const c = collectEquipmentEffects(
    [equipment([{ kind: 'FIELD_SOURCE', field: canonicalField }])],
    ctx(),
  );
  const request = damageRequest();
  const r = resolveProtectionDamage(
    { ...request, state: { ...request.state, fields: c.fields } },
    dice({ sides: 10, value: 10 }),
  );
  expect(r.result.status).toBe('CANCELLED');
  expect(canonicalField.remainingUses).toBe(3);
});
it('special protection ordering remains typed pending', () => {
  const c = collectEquipmentEffects(
    [
      equipment([
        {
          kind: 'PROTECTION_ADJUSTMENT_INTENT',
          adjustment: { type: 'UNRESOLVED', rule: source, reason: 'order not defined' },
        },
      ]),
    ],
    ctx(),
  );
  expect(c.pending[0]?.type).toBe('ProtectionOrderingPending');
  expect(c.fields).toHaveLength(0);
});
it('explicit protection adjustment is handed off as data, not silently applied', () => {
  const c = collectEquipmentEffects(
    [
      equipment([
        {
          kind: 'PROTECTION_ADJUSTMENT_INTENT',
          adjustment: { type: 'EXPLICIT_OB', ob: 3, provenance },
        },
      ]),
    ],
    ctx(),
  );
  expect(c.status).toBe('RESOLVED');
  expect(c.protectionIntents[0]?.contribution).toMatchObject({ adjustment: { ob: 3 } });
});
it('bio-monitor removes timed wound Stunned, preserves other wounds and sources', () => {
  let w = woundState();
  w = planWoundCondition(w, { actorId: 'B' }, 'wound-stunned', 'Stunned', provenance, {
    unit: 'minute',
    amount: 2,
  }).state;
  const combat = onBTurn(w.combat);
  w = { ...w, combat };
  const r = finishEquipmentTurn(
    combat,
    [
      equipment([
        { kind: 'CONDITION_REMOVAL_TRIGGER', timing: 'END_OWN_TURN', condition: 'Stunned' },
      ]),
    ],
    ctx(),
    deepFreeze(w),
  );
  expect(r.wounds?.actors.B?.conditions).toHaveLength(0);
  expect(r.wounds?.combat.actors.B?.effects).toHaveLength(0);
  expect(w.actors.B?.conditions).toHaveLength(1);
});
it('bio-monitor preserves explicit C-2 blood-replacement requirement', () => {
  let w = woundState();
  w = planWoundCondition(
    w,
    { actorId: 'B' },
    'blood-Stunned',
    'Stunned',
    provenance,
    undefined,
    'blood-replacement',
  ).state;
  const combat = onBTurn(w.combat);
  w = { ...w, combat };
  const r = finishEquipmentTurn(
    combat,
    [
      equipment([
        { kind: 'CONDITION_REMOVAL_TRIGGER', timing: 'END_OWN_TURN', condition: 'Stunned' },
      ]),
    ],
    ctx(),
    w,
  );
  expect(r.protectedConditionIds).toEqual(['blood-Stunned']);
  expect(r.wounds?.actors.B?.conditions[0]?.id).toBe('blood-Stunned');
});
it('pending power dependency at end turn rolls back even turn transition', () => {
  const s = dState().combat,
    item = equipment(
      [{ kind: 'CONDITION_REMOVAL_TRIGGER', timing: 'END_OWN_TURN', condition: 'Stunned' }],
      'A',
    );
  const r = finishEquipmentTurn(
    s,
    [{ ...item, effects: item.effects.map((e) => ({ ...e, requiresPower: 'UNKNOWN' as const })) }],
    ctx('A'),
  );
  expect(r.status).toBe('PENDING');
  expect(r.state).toBe(s);
});
it('pending equipment at eligible suppression removal rolls back turn start', () => {
  let s = resolveSuppression(dState(), single(), [candidate()], rng(56)).state;
  s = beginSuppressionEquipmentTurn(
    { ...s, combat: finishActionTurn(s.combat).state },
    ctx(),
    rng(),
  ).state;
  let combat = finishActionTurn(s.combat).state;
  combat = finishActionTurn(beginActionTurn(combat).state).state;
  combat = beginActionRound(combat).state;
  combat = finishActionTurn(beginActionTurn(combat).state).state;
  const item = equipment([{ kind: 'CHECK_MODIFIER', scope: 'suppression', value: 10 }]);
  const input = {
    ...s,
    combat,
    equipment: [
      { ...item, effects: item.effects.map((e) => ({ ...e, requiresPower: 'UNKNOWN' as const })) },
    ],
  };
  expect(beginSuppressionEquipmentTurn(input, ctx(), rng()).state).toBe(input);
});
it('multiple explicitly compatible movement sources preserve separate log sources', () => {
  const item = equipment(
    [
      { kind: 'MOVEMENT_MODIFIER', field: 'od', value: 1 },
      { kind: 'MOVEMENT_MODIFIER', field: 'od', value: -1 },
    ],
    'A',
  );
  const compatible: EquipmentInstance = {
    ...item,
    effects: item.effects.map((e) => ({ ...e, stacking: { group: 'movement', rule: 'SUM' } })),
  };
  const r = resolveEquipmentCombatAction(
    dState().combat,
    [compatible],
    action('half', 'half-move'),
    rng(),
  );
  expect(r.resolution?.execution.definition.odCost).toBe(1);
  expect(r.resolution?.execution.context.modifiers).toHaveLength(2);
});
it('suppression applied during the target current turn does not penalize that same turn', () => {
  const s = dState();
  const combat = beginActionTurn(finishActionTurn(s.combat).state).state;
  const suppressed = resolveSuppression({ ...s, combat }, single(), [candidate()], rng(56)).state;
  const r = resolveRangedAttack(
    suppressed.combat,
    attack('current-turn', {
      actor: { actorId: 'B' },
      target: { actorId: 'A' },
      context: ctx(),
      weaponId: 'gun:B',
    }),
    rng(41),
  );
  expect(r.result.check.target).toBe(50);
  expect(suppressed.suppressed[0]?.firstAffectedTurn).toBeNull();
});
it('explicit LARGEST after GM MODIFY preserves the decision without duplicate overrides', () => {
  const item = equipment([
    { kind: 'SENSORY_CHECK_MODIFIER', scope: 'visual', value: 10 },
    { kind: 'SENSORY_CHECK_MODIFIER', scope: 'visual', value: 20 },
  ]);
  const selected = {
    ...item,
    effects: item.effects.map((e) => ({
      ...e,
      stacking: { group: 'sensor', rule: 'LARGEST' as const },
    })),
  };
  const c = {
    ...ctx(),
    overrides: [
      {
        subject: 'effect' as const,
        id: equipmentEffectId(item.effects[1]!),
        operation: 'MODIFY' as const,
        value: 5,
        reason: 'GM numeric adjustment',
      },
    ],
  };
  const r = resolveEquipmentCheck(dState().combat, [selected], 'СВ', c, rng(28), 'visual');
  expect(r.check?.target).toBe(60);
  expect(r.collection.log.overrides.some((o) => o.operation === 'MODIFY' && o.value === 5)).toBe(
    true,
  );
  expect(r.collection.traces[1]?.reason).toBe('stacking');
});
it('immunity gained after suppression never rolls SW or invents retroactive removal', () => {
  const s = resolveSuppression(dState(), single(), [candidate()], rng(56)).state;
  const input = {
    ...s,
    combat: finishActionTurn(s.combat).state,
    equipment: [equipment([{ kind: 'SUPPRESSION_IMMUNITY' }])],
  };
  const r = beginSuppressionEquipmentTurn(input, ctx(), rng());
  expect(r.status).toBe('PENDING');
  expect(r.state).toBe(input);
  expect(r.pending[0]?.type).toBe('SuppressionImmunityRemovalPending');
  expect(
    r.logs.some(
      (l) => l.suppressionLifecycle?.pending?.type === 'SuppressionImmunityRemovalPending',
    ),
  ).toBe(true);
  expect(r.state.suppressed).toHaveLength(1);
});
