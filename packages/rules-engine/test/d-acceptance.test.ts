import { describe, expect, it, vi } from 'vitest';
import {
  suppressionTrigger,
  suppressionTargetAffected,
  resolveSuppression,
  collectEquipmentEffects,
  resolveCharacteristic,
  beginSuppressionEquipmentTurn,
  finishActionTurn,
  beginActionTurn,
  beginActionRound,
  resolveEquipmentRangedAttack,
  finishEquipmentTurn,
  applyStunned,
  resolveRangedAttack,
} from '../src/index.js';
import {
  dState,
  single,
  burst,
  area,
  candidate,
  equipment,
  rng,
  ctx,
  provenance,
  source,
} from './d-fixtures.js';
import { attack } from './b1-fixtures.js';
import { deepFreeze } from './fixtures.js';
import type { SuppressionEquipmentState } from '@kadat/contracts';

function suppressed() {
  return resolveSuppression(dState(), single(), [candidate()], rng(56)).state;
} // target35, roll56 =>3 failures.
function onBTurn(s = suppressed()) {
  return beginSuppressionEquipmentTurn(
    { ...s, combat: finishActionTurn(s.combat).state },
    ctx(),
    rng(),
  ).state;
}
function laterBTurn(s: SuppressionEquipmentState, roll: number) {
  let combat = finishActionTurn(s.combat).state;
  combat = finishActionTurn(beginActionTurn(combat).state).state;
  combat = beginActionRound(combat).state;
  combat = finishActionTurn(beginActionTurn(combat).state).state;
  return beginSuppressionEquipmentTurn({ ...s, combat }, ctx(), rng(roll));
}
describe('Phase D canonical acceptance', () => {
  it('AC-SE01 single below threshold does not roll', () => {
    const dice = {
      roll: vi.fn(() => {
        throw new Error('unexpected roll');
      }),
    };
    const r = resolveSuppression(dState(), single(2), [candidate()], dice);
    expect(r.targets[0]?.status).toBe('NOT_AFFECTED');
    expect(dice.roll).not.toHaveBeenCalled();
  });
  it('AC-SE02 three degrees => SW -15', () =>
    expect(suppressionTrigger(single(3)).modifier).toBe(-15));
  it('AC-SE03 five degrees => SW -25', () =>
    expect(suppressionTrigger(single(5)).modifier).toBe(-25));
  it('AC-SE04 burst inclusive 10m boundary', () =>
    expect(
      [9.9, 10, 10.1].map((d) => suppressionTargetAffected(burst(), candidate('B', 'NO', d))),
    ).toEqual([true, true, false]));
  it('AC-SE05 BASIC six shots, not hits', () =>
    expect(suppressionTrigger(burst(6))).toMatchObject({ penaltyBasis: 6, modifier: -6 }));
  it('AC-SE06 HEAVY four shots => eight', () =>
    expect(suppressionTrigger(burst(4, 'HEAVY')).penaltyBasis).toBe(8));
  it('AC-SE07 PISTOL four shots => two', () =>
    expect(suppressionTrigger(burst(4, 'PISTOL')).penaltyBasis).toBe(2));
  it('AC-SE08 odd PISTOL pending and unchanged', () => {
    const s = deepFreeze(dState());
    const r = resolveSuppression(s, burst(3, 'PISTOL'), [candidate()], rng());
    expect(r.state).toBe(s);
    expect(r.targets[0]?.pending[0]?.type).toBe('SuppressionModifierRoundingPending');
  });
  it('AC-SE09 area radius max +10', () => expect(suppressionTrigger(area()).radius).toBe(16));
  it('AC-SE10 area SW -5*radius', () => expect(suppressionTrigger(area()).modifier).toBe(-30));
  it('AC-SE11 three failure degrees => three rounds', () =>
    expect(suppressed().suppressed[0]).toMatchObject({
      durationRounds: 3,
      appliedRound: 1,
      expiresAfterRound: 3,
    }));
  it('AC-SE12 known cover generates distance intent', () => {
    const s = dState();
    const b = s.combat.actors.B!;
    const input = {
      ...s,
      combat: { ...s.combat, actors: { ...s.combat.actors, B: { ...b, movement: 6 } } },
    };
    expect(
      resolveSuppression(input, single(), [candidate('B', 'YES')], rng(56)).targets[0]?.response,
    ).toMatchObject({ type: 'SeekNearestCoverIntent', maxDistance: 6 });
  });
  it('AC-SE13 no cover => prone intent, no automatic movement', () => {
    const r = resolveSuppression(dState(), single(), [candidate()], rng(56));
    expect(r.targets[0]?.response?.type).toBe('DropProneIntent');
    expect(r.state.combat.actors.B?.posture).toBe('standing');
  });
  it('AC-SE14 unknown cover rolls back', () => {
    const s = dState(),
      r = resolveSuppression(s, single(), [candidate('B', 'UNKNOWN')], rng(56));
    expect(r.state).toBe(s);
    expect(r.targets[0]?.pending[0]?.type).toBe('CoverAvailabilityContextRequired');
  });
  it('AC-SE15 next-turn OD1, next actor still OD2', () => {
    const s = onBTurn();
    expect(s.combat.session.turn?.od).toBe(1);
    expect(beginActionTurn(finishActionTurn(s.combat).state).state.session.turn?.od).toBe(2);
  });
  it('AC-SE16 next-turn NS -20 via existing ranged resolver', () => {
    const s = onBTurn();
    const r = resolveRangedAttack(
      s.combat,
      attack('B-shot', {
        actor: { actorId: 'B' },
        target: { actorId: 'A' },
        context: ctx(),
        weaponId: 'gun:B',
      }),
      rng(41),
    );
    expect(r.result.check.target).toBe(30);
    expect(s.combat.actors.B?.characteristics.НС.baseValue).toBe(40);
    expect(
      r.result.check.modifiers.some((m) => m.value === -20 && m.source.id.includes('Механика')),
    ).toBe(true);
  });
  it('AC-SE17 first affected turn no early removal roll', () => {
    const r = beginSuppressionEquipmentTurn(
      { ...suppressed(), combat: finishActionTurn(suppressed().combat).state },
      ctx(),
      rng(),
    );
    expect(r.logs.find((l) => l.suppressionLifecycle)?.suppressionLifecycle?.operation).toBe(
      'FIRST_TURN',
    );
    expect(r.state.suppressed).toHaveLength(1);
  });
  it('AC-SE18 later SW+0 success removes condition', () => {
    const r = laterBTurn(onBTurn(), 29);
    expect(r.state.suppressed).toHaveLength(0);
    expect(
      r.logs.find((l) => l.suppressionLifecycle?.operation === 'REMOVAL_CHECK')
        ?.suppressionLifecycle?.check?.target,
    ).toBe(50);
  });
  it('AC-SE19 failed later removal keeps normal expiry', () =>
    expect(laterBTurn(onBTurn(), 80).state.suppressed[0]?.expiresAfterRound).toBe(3));
  it('AC-SE20 explicit active suppression immunity no roll', () => {
    const s = { ...dState(), equipment: [equipment([{ kind: 'SUPPRESSION_IMMUNITY' }])] };
    const r = resolveSuppression(s, single(), [candidate()], rng());
    expect(r.targets[0]?.status).toBe('IMMUNE');
    expect(r.state.suppressed).toHaveLength(0);
  });
  it('AC-SE21 equipment +10 enters suppression check with provenance', () => {
    const s = {
      ...dState(),
      equipment: [equipment([{ kind: 'CHECK_MODIFIER', scope: 'suppression', value: 10 }])],
    };
    const r = resolveSuppression(s, single(), [candidate()], rng(40));
    expect(r.targets[0]?.check?.target).toBe(45);
    expect(
      r.targets[0]?.check?.modifiers.some((m) => m.value === 10 && m.provenance === provenance),
    ).toBe(true);
  });
  it('AC-SE22 SL+20 effective only; inactive removes it', () => {
    const item = equipment([{ kind: 'CHARACTERISTIC_ADD', characteristic: 'СЛ', value: 20 }]);
    const base = { baseValue: 50, baseSuper: 0 };
    expect(
      resolveCharacteristic('СЛ', base, collectEquipmentEffects([item], ctx()).context).result
        .finalValue,
    ).toBe(70);
    expect(
      resolveCharacteristic(
        'СЛ',
        base,
        collectEquipmentEffects([{ ...item, powerState: 'UNPOWERED' }], ctx()).context,
      ).result.finalValue,
    ).toBe(50);
    expect(base.baseValue).toBe(50);
  });
  it('AC-SE23 explicit cap applies after characteristic resolution', () => {
    const item = equipment([{ kind: 'CHARACTERISTIC_CAP', characteristic: 'ЛВ', value: 50 }]);
    expect(
      resolveCharacteristic(
        'ЛВ',
        { baseValue: 63, baseSuper: 0 },
        collectEquipmentEffects([item], ctx()).context,
      ).result.finalValue,
    ).toBe(50);
  });
  it('AC-SE24 absent cap is no effect', () =>
    expect(
      resolveCharacteristic(
        'ЛВ',
        { baseValue: 63, baseSuper: 0 },
        collectEquipmentEffects([equipment([])], ctx()).context,
      ).result.finalValue,
    ).toBe(63));
  it('AC-SE25 separate typed autosenses capabilities', () => {
    const c = collectEquipmentEffects(
      [
        equipment([
          { kind: 'SENSORY_MODE', mode: 'NIGHT_VISION' },
          { kind: 'SENSORY_MODE', mode: 'THERMAL_VISION' },
          { kind: 'SENSORY_MODE', mode: 'AUSPEX' },
          { kind: 'SENSORY_MODE', mode: 'LOUD_SOUND_PROTECTION' },
          { kind: 'CONDITION_IMMUNITY', condition: 'Dazzling' },
          { kind: 'SENSORY_CHECK_MODIFIER', scope: 'visual', value: 10 },
          { kind: 'SENSORY_CHECK_MODIFIER', scope: 'hearing', value: 10 },
        ]),
      ],
      ctx('B', ['check:visual', 'check:hearing']),
    );
    expect(c.status).toBe('RESOLVED');
    expect(c.capabilities).toHaveLength(5);
    expect(c.effects.filter((e) => e.definition.target.kind === 'check')).toHaveLength(2);
  });
  it('AC-SE26 numeric autosense relations unknown => pending', () => {
    const a = equipment([{ kind: 'SENSORY_CHECK_MODIFIER', scope: 'visual', value: 10 }]);
    const b = {
      ...a,
      id: 'second',
      effects: a.effects.map((e) => ({ ...e, sourceItemId: 'second' })),
    };
    const c = collectEquipmentEffects([a, b], ctx('B', ['check:visual']));
    expect(c.status).toBe('PENDING');
    expect(c.pending[0]?.type).toBe('EquipmentStackingPending');
  });
  it('AC-SE27 explicit heavy one-hand stabilization permission', () => {
    const s = dState(),
      item = equipment(
        [
          { kind: 'RECOIL_OR_STABILIZATION_EFFECT', capability: 'HEAVY_ONE_HANDED' },
          { kind: 'RECOIL_OR_STABILIZATION_EFFECT', capability: 'AUTO_STABILIZATION' },
        ],
        'A',
      );
    const r = resolveEquipmentRangedAttack(deepFreeze(s.combat), [item], attack(), rng(41), {
      weaponClass: 'HEAVY',
      hands: 1,
    });
    expect(r.status).toBe('RESOLVED');
    expect(r.state.weapons['gun:A']?.template).toBe(s.combat.weapons['gun:A']?.template);
  });
  it('AC-SE28 bio-monitor removes Stunned at own turn end', () => {
    const s = dState().combat;
    const stunned = applyStunned(s.session, {
      id: 'stunned',
      actor: { actorId: 'A' },
      source,
      provenance,
      durationRounds: 2,
    }).result;
    const r = finishEquipmentTurn(
      { ...s, session: stunned },
      [
        equipment(
          [{ kind: 'CONDITION_REMOVAL_TRIGGER', timing: 'END_OWN_TURN', condition: 'Stunned' }],
          'A',
        ),
      ],
      ctx('A'),
    );
    expect(r.state.session.conditions).toHaveLength(0);
    expect(
      r.logs.some((l) => l.mutations.some((m) => m.type === 'bio-monitor-Stunned-removal')),
    ).toBe(true);
  });
  it('AC-SE29 bio-monitor leaves Stupor', () => {
    const s = dState().combat;
    const stunned = applyStunned(s.session, {
      id: 'stupor',
      actor: { actorId: 'A' },
      source,
      provenance,
      durationRounds: 2,
    }).result;
    const r = finishEquipmentTurn(
      {
        ...s,
        session: {
          ...stunned,
          conditions: stunned.conditions.map((c) => ({ ...c, type: 'Stupor' })),
        },
      },
      [
        equipment(
          [{ kind: 'CONDITION_REMOVAL_TRIGGER', timing: 'END_OWN_TURN', condition: 'Stunned' }],
          'A',
        ),
      ],
      ctx('A'),
    );
    expect(r.state.session.conditions[0]?.type).toBe('Stupor');
  });
  it('AC-SE30 powered/unpowered filters explicitly dependent effects', () => {
    const item = equipment([{ kind: 'CHARACTERISTIC_ADD', characteristic: 'СЛ', value: 20 }]);
    expect(collectEquipmentEffects([item], ctx()).traces[0]?.included).toBe(true);
    expect(
      collectEquipmentEffects([{ ...item, powerState: 'UNPOWERED' }], ctx()).traces[0]?.included,
    ).toBe(false);
  });
  it('AC-SE31 suppression structured provenance reconstructs decision', () => {
    const r = resolveSuppression(dState(), single(), [candidate()], rng(56));
    expect(r.logs.find((l) => l.suppression)?.suppression).toMatchObject({
      event: { attackId: 'source-shot', successDegrees: 3 },
      target: {
        modifier: -15,
        check: { rawRoll: 56, failureDegrees: 3 },
        condition: { durationRounds: 3 },
        response: { type: 'DropProneIntent' },
      },
    });
  });
  it('AC-SE32 equipment log preserves item/system/state/payload', () => {
    const c = collectEquipmentEffects(
      [equipment([{ kind: 'CHARACTERISTIC_ADD', characteristic: 'СЛ', value: 20 }])],
      ctx(),
    );
    expect(c.log.equipment?.traces[0]).toMatchObject({
      powerState: 'POWERED',
      effect: { sourceItemId: 'equipment:B', sourceSystemId: 'subsystem:0' },
      contribution: { characteristic: 'СЛ', value: 20 },
    });
  });
  it('AC-SE33 multi-target required context atomically rolls back all', () => {
    const s = deepFreeze(dState());
    const r = resolveSuppression(
      s,
      burst(),
      [candidate('B'), candidate('C', 'UNKNOWN')],
      rng(80, 80),
    );
    expect(r.state).toBe(s);
    expect(r.logs.flatMap((l) => l.mutations)).toHaveLength(0);
  });
  it('AC-SE34 templates and canonical source definitions stay immutable', () => {
    const s = deepFreeze(dState()),
      items = deepFreeze([
        equipment([{ kind: 'CHARACTERISTIC_ADD', characteristic: 'СЛ', value: 20 }]),
      ]),
      before = JSON.stringify({ s, items });
    collectEquipmentEffects(items, ctx());
    resolveSuppression(s, single(), [candidate()], rng(56));
    expect(JSON.stringify({ s, items })).toBe(before);
  });
});
