import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CombatActionState,
  ProtectionRuntimeState,
  WoundRuntimeState,
} from '@kadat/contracts';
import {
  applyStunned,
  beginActionRound,
  beginActionTurn,
  beginSuppressionEquipmentTurn,
  consequenceCatalog,
  createSuppressionEquipmentState,
  createWoundRuntime,
  finishActionTurn,
  resolveBleedingPulse,
  resolveCombatHitDamage,
  resolveCheck,
  resolveEquipmentRangedAttack,
  resolveMeleeAttack,
  resolvePostDamage,
  resolveSuppression,
  suppressionEventFromRanged,
  resolveRangedAttack,
} from '../src/index.js';
import { attack, action, dice, fixtureSource, fixtureProvenance } from './b1-fixtures.js';
import { meleeAttack } from './b2-fixtures.js';
import { armor, cover, field, state as protectionState } from './c1-fixtures.js';
import { ctx as woundContext, damage, facts, state as woundState } from './c2-fixtures.js';
import { candidate, ctx, equipment, rng, single } from './d-fixtures.js';
import { context, deepFreeze, effect, modifier } from './fixtures.js';

// Test-only caller composition: no new public orchestration or gameplay rules.
function profile(
  initial: WoundRuntimeState,
  count = 1,
  flat = 0,
  penetration = 0,
): WoundRuntimeState {
  const gun = initial.combat.weapons['gun:A']!;
  return {
    ...initial,
    combat: {
      ...initial.combat,
      weapons: {
        ...initial.combat.weapons,
        [gun.id]: {
          ...gun,
          template: {
            ...gun.template,
            profile: {
              ...gun.template.profile,
              damage: { source: fixtureSource, expression: { count, sides: 10, modifier: flat } },
              penetration: { source: fixtureSource, value: penetration },
            },
          },
        },
      },
    },
  };
}

function afterAttack(initial: WoundRuntimeState, combat: CombatActionState): WoundRuntimeState {
  return { ...initial, combat };
}

function emptyProtection(): ProtectionRuntimeState {
  return protectionState({ sources: {} });
}

beforeEach(() => {
  vi.spyOn(Math, 'random').mockImplementation(() => {
    throw new Error('Final integration must use injected RNG');
  });
});
afterEach(() => vi.restoreAllMocks());

describe('Phase E deterministic cross-phase integration', () => {
  it('FI-01 ranged → location → field/armor/BB/bVN → Injury/Condition/Blood and structured log', () => {
    const initial = deepFreeze(profile(woundState(), 1, 1, 1));
    const before = JSON.stringify(initial);
    const f = field({ type: 'REDUCE_DAMAGE', reduction: 1 });
    const protection = deepFreeze(
      protectionState({
        sources: { helmet: armor('helmet', 2, { zones: ['Head'] }) },
        fields: [{ ...f, definition: { ...f.definition, zones: ['Head'] } }],
      }),
    );
    const shot = resolveRangedAttack(
      initial.combat,
      attack('fi-01', { type: 'called-attack', calledLocation: 'Head' }),
      rng(19),
    );
    expect(shot.result.hits).toHaveLength(1);
    const hit = shot.result.hits[0]!;
    const pd = resolveCombatHitDamage(shot.state, protection, hit, dice({ sides: 10, value: 9 }));
    expect(pd.result).toMatchObject({
      input: { location: 'Head' },
      rawDamage: 10,
      effectiveArmor: 1,
      bVN: 4,
      finalDamage: 4,
    });
    expect(pd.result.field.entries[0]).toMatchObject({ damageBefore: 10, damageAfter: 9 });
    const post = resolvePostDamage(
      {
        state: afterAttack(initial, shot.state),
        damage: pd.result,
        context: woundContext(),
        facts,
      },
      rng(90),
    );
    expect(post.result).toMatchObject({
      status: 'RESOLVED',
      damageTakenBefore: 7,
      damageTakenAfter: 11,
      consequenceSeverity: 4,
      consequence: { zone: 'HEAD', minimum: 4 },
    });
    expect(post.result.injuriesCreated).toHaveLength(1);
    expect(post.result.conditionsCreatedOrUpdated).toContainEqual(
      expect.objectContaining({ type: 'Stunned', appliedRound: 1, expiresAfterRound: 1 }),
    );
    expect(post.result.bleedingSourcesCreated).toHaveLength(1);
    expect(post.result.bloodAfter.bloodLost).toBe(1);
    const logs = [...shot.logs, ...pd.logs, ...post.logs];
    expect(logs.find((l) => l.resolver === 'check')).toMatchObject({
      target: 30,
      checkModifiers: { rawModifierSum: -10, finalModifier: -10 },
      dice: [{ sides: 100, value: 19 }],
    });
    expect(logs.find((l) => l.ranged)?.ranged).toEqual(shot.result);
    expect(hit).toMatchObject({ attackId: 'fi-01', weaponInstanceId: 'gun:A', location: 'Head' });
    expect(pd.result.input.hitId).toBe(hit.id);
    expect(pd.logs.at(-1)?.damageResolution).toEqual(pd.result);
    expect(pd.result.damageRoll.rolls).toEqual([{ sides: 10, value: 9 }]);
    expect(post.logs[0]?.postDamage).toEqual(post.result);
    expect(post.result.injuriesCreated[0]?.sourceHitId).toBe(hit.id);
    expect(post.result.injuriesCreated[0]?.provenance).toContain(
      post.result.consequence?.provenance,
    );
    expect(post.logs[0]?.mutations.length).toBeGreaterThan(0);
    expect(shot.state.containers['mag:A']?.currentRounds).toBe(29);
    expect(pd.state.fields[0]?.remainingUses).toBe(2);
    expect(protection.fields[0]?.remainingUses).toBe(3);
    expect(JSON.stringify(initial)).toBe(before);
    expect(Object.isFrozen(consequenceCatalog)).toBe(true);
    expect(Object.isFrozen(post.result.consequence)).toBe(true);
  });

  it('FI-02 full-auto + Dodge → two independent location/damage/protection/consequence resolutions', () => {
    const initial = woundState();
    const combat = deepFreeze({
      ...initial.combat,
      actors: {
        ...initial.combat.actors,
        A: {
          ...initial.combat.actors.A!,
          characteristics: {
            ...initial.combat.actors.A!.characteristics,
            НС: { baseValue: 80, baseSuper: 0 },
          },
        },
      },
    });
    const shot = resolveRangedAttack(
      combat,
      attack('fi-02', {
        mode: 'full-auto',
        shotsRequested: 6,
        dodge: { id: 'fi-02-dodge', context: action('fi-02-dodge', 'dodge', 'B').context },
      }),
      dice({ sides: 100, value: 28 }, { sides: 100, value: 29 }, { sides: 2, value: 1 }),
    );
    expect(shot.result).toMatchObject({
      hitsGenerated: 5,
      cancelledHits: 3,
      survivingHits: 2,
      ammoSpent: 6,
    });
    expect(shot.result.hits.map((h) => h.location)).toEqual(['Right Leg', 'Left Leg']);
    let wounds = afterAttack(initial, shot.state);
    let protection = deepFreeze(
      protectionState({
        sources: {
          right: armor('right', 2, { zones: ['Right Leg'] }),
          left: armor('left', 1, { zones: ['Left Leg'] }),
        },
      }),
    );
    const damages: number[] = [],
      rows: string[] = [],
      hitIds: string[] = [];
    for (const [index, hit] of shot.result.hits.entries()) {
      const pd = resolveCombatHitDamage(
        wounds.combat,
        protection,
        hit,
        dice({ sides: 10, value: index === 0 ? 7 : 9 }),
      );
      const post = resolvePostDamage(
        { state: wounds, damage: pd.result, context: woundContext(), facts },
        rng(90),
      );
      expect(post.result.status).toBe('RESOLVED');
      expect(post.logs[0]?.postDamage?.hitId).toBe(hit.id);
      expect(pd.logs.at(-1)?.damageResolution?.input.location).toBe(hit.location);
      damages.push(pd.result.finalDamage!);
      rows.push(post.result.consequence!.id);
      hitIds.push(hit.id);
      wounds = post.state;
      protection = pd.state;
    }
    expect(damages).toEqual([1, 4]);
    expect(new Set(rows).size).toBe(2);
    expect(new Set(hitIds).size).toBe(2);
    expect(wounds.actors.B?.damageTaken).toBe(12);
    expect(wounds.actors.B?.injuries).toHaveLength(2);
    expect(protection.resolvedHitIds).toEqual(hitIds);
    expect(wounds.combat.containers['mag:A']?.currentRounds).toBe(24);
    expect(wounds.combat.session.initiativeOrder[1]?.reactions.remaining).toBe(0);
    expect(combat.containers['mag:A']?.currentRounds).toBe(30);
  });

  it('FI-03 two damage maxima → one C-1 marker → exactly one C-2 consequence d10', () => {
    const initial = deepFreeze(profile(woundState(), 2));
    const shot = resolveRangedAttack(
      initial.combat,
      attack('fi-03', { type: 'called-attack', calledLocation: 'Torso' }),
      rng(19),
    );
    const pd = resolveCombatHitDamage(
      shot.state,
      protectionState({ sources: { armor: armor('armor', 11) } }),
      shot.result.hits[0]!,
      dice({ sides: 10, value: 10 }, { sides: 10, value: 10 }),
    );
    expect(pd.result).toMatchObject({
      rawDamage: 20,
      finalDamage: 5,
      critical: true,
      criticalConsequenceDiceCount: 1,
    });
    expect(pd.result.criticalConsequence.maximumDiceIndices).toEqual([0, 1]);
    const roll = vi.fn(() => 3);
    const post = resolvePostDamage(
      {
        state: afterAttack(initial, shot.state),
        damage: pd.result,
        context: woundContext(),
        facts,
      },
      { roll },
    );
    expect(roll).toHaveBeenCalledExactlyOnceWith(10);
    expect(post.result).toMatchObject({
      status: 'RESOLVED',
      damageTakenAfter: 12,
      consequenceSeverity: 8,
      criticalConsequenceDie: { sides: 10, value: 3 },
    });
    expect(post.logs[0]?.dice).toEqual([{ sides: 10, value: 3 }]);
    expect(post.logs[0]?.postDamage?.damage.damageRoll.rolls).toEqual([
      { sides: 10, value: 10 },
      { sides: 10, value: 10 },
    ]);
  });

  it('FI-04 real melee → Parry → one undefendable Counterattack → C-1/C-2', () => {
    const base = woundState();
    const combat = deepFreeze({
      ...base.combat,
      actors: Object.fromEntries(
        Object.entries(base.combat.actors).map(([id, a]) => [
          id,
          {
            ...a,
            characteristics: {
              ...a.characteristics,
              НР: { baseValue: 55, baseSuper: 0 },
              ВН: { baseValue: 40, baseSuper: 0 },
            },
          },
        ]),
      ),
    });
    const initial = createWoundRuntime(combat, {
      A: { maxWounds: 15, damageTaken: 0 },
      B: { maxWounds: 15, damageTaken: 7 },
    });
    const incoming = resolveMeleeAttack(
      combat,
      meleeAttack({
        targets: [
          {
            actor: { actorId: 'B' },
            distance: 1,
            avoidance: {
              id: 'fi-04-parry',
              type: 'parry',
              context: ctx(),
              weaponId: 'blade:B',
              pool: 'normal',
            },
          },
        ],
      }),
      rng(31, 31),
    );
    const defense = incoming.result.targets[0]!.avoidance!;
    expect(defense).toMatchObject({
      cancelledHits: 1,
      survivingHits: 0,
      check: { target: 55, totalDegrees: 3 },
    });
    expect(incoming.state.melee?.counterattacks).toHaveLength(1);
    if (!('counterattack' in defense)) throw new Error('Expected the accepted Parry result');
    const opportunity = defense.counterattack!;
    const request = meleeAttack({
      ...action('fi-04-counter', 'melee-attack', 'B'),
      type: 'melee-attack',
      origin: 'COUNTERATTACK',
      base: 'free',
      weaponId: 'blade:B',
      opportunityId: opportunity.id,
      targets: [{ actor: { actorId: 'A' }, distance: 1 }],
    });
    for (const type of ['dodge', 'parry'] as const) {
      expect(() =>
        resolveMeleeAttack(
          deepFreeze(incoming.state),
          {
            ...request,
            targets: [
              {
                actor: { actorId: 'A' },
                distance: 1,
                avoidance: {
                  id: 'illegal-defense',
                  type,
                  context: ctx('A'),
                  weaponId: 'blade:A',
                  pool: 'normal',
                },
              },
            ],
          },
          rng(),
        ),
      ).toThrow();
    }
    const counter = resolveMeleeAttack(incoming.state, request, rng(31));
    expect(counter.result.targets[0]?.hit).toMatchObject({
      origin: 'COUNTERATTACK',
      attacker: { actorId: 'B' },
      target: { actorId: 'A' },
    });
    expect(counter.state.melee?.counterattacks).toHaveLength(1);
    expect(counter.state.melee?.counterattacks[0]?.spent).toBe(true);
    expect(() =>
      resolveMeleeAttack(counter.state, { ...request, id: 'second-counter' }, rng()),
    ).toThrow(/opportunity/);
    const pd = resolveCombatHitDamage(
      counter.state,
      emptyProtection(),
      counter.result.targets[0]!.hit!,
      dice({ sides: 10, value: 4 }, { sides: 10, value: 4 }),
    );
    const post = resolvePostDamage(
      {
        state: afterAttack(initial, counter.state),
        damage: pd.result,
        context: woundContext({ actor: { actorId: 'A' }, targetActor: { actorId: 'B' } }),
        facts,
      },
      rng(5),
    );
    expect(pd.result.finalDamage).toBe(7);
    expect(post.result).toMatchObject({
      status: 'RESOLVED',
      target: { actorId: 'A' },
      damageTakenBefore: 0,
      damageTakenAfter: 7,
    });
    expect(post.result.injuriesCreated).toHaveLength(1);
    expect(counter.logs.some((l) => l.melee?.origin === 'COUNTERATTACK')).toBe(true);
    expect(post.logs[0]?.postDamage?.attackId).toBe('fi-04-counter');
  });

  // FI-05 maps the existing exact before-enemy-action Overwatch proof; see E report.

  it('FI-06 real shot → GM cover exclusion → protection/damage/wound, templates intact', () => {
    const initial = deepFreeze(profile(woundState(), 1, 5));
    const shot = resolveRangedAttack(
      initial.combat,
      attack('fi-06', { type: 'called-attack', calledLocation: 'Torso' }),
      rng(19),
    );
    const protection = deepFreeze(
      protectionState({ sources: { armor: armor('armor', 4) }, covers: { cover: cover() } }),
    );
    const gm = {
      subject: 'modifier' as const,
      id: 'protection:cover',
      operation: 'EXCLUDE' as const,
      origin: 'gm' as const,
      reason: 'Explicit special round excludes cover for this hit',
    };
    const pd = resolveCombatHitDamage(
      shot.state,
      protection,
      shot.result.hits[0]!,
      dice({ sides: 10, value: 8 }),
      { ...shot.result.hits[0]!.context, overrides: [gm] },
    );
    expect(pd.result).toMatchObject({ rawDamage: 13, effectiveArmor: 4, finalDamage: 5 });
    expect(pd.result.protection?.selectedIds).toEqual(['armor']);
    expect(
      pd.result.protection?.contributions.find((c) => c.candidate.instanceId === 'cover'),
    ).toMatchObject({ included: false, reason: 'override', trace: { override: gm } });
    expect(pd.logs.at(-1)?.overrides).toContainEqual(gm);
    const post = resolvePostDamage(
      {
        state: afterAttack(initial, shot.state),
        damage: pd.result,
        context: woundContext(),
        facts,
      },
      rng(),
    );
    expect(post.result).toMatchObject({
      status: 'RESOLVED',
      damageTakenAfter: 12,
      consequenceSeverity: 5,
    });
    expect(post.logs[0]?.postDamage?.damage.context.overrides).toContainEqual(gm);
    expect(protection.covers.cover?.currentOB).toBe(6);
    expect(protection.sources.armor?.definition.ob).toBe(4);
    expect(initial.combat.weapons['gun:A']?.template.profile.damage.expression.modifier).toBe(5);
  });

  it('FI-07 two resolved injuries → distinct bleeding sources → aggregate Blood thresholds', () => {
    const initial = deepFreeze(woundState());
    const first = resolvePostDamage(
      {
        state: initial,
        damage: damage(3, 'Right Arm', false, 'fi-07-arm'),
        context: woundContext(),
        facts,
      },
      rng(90),
    );
    const second = resolvePostDamage(
      {
        state: first.state,
        damage: damage(6, 'Right Leg', false, 'fi-07-leg'),
        context: woundContext(),
        facts,
      },
      rng(90),
    );
    expect(second.state.actors.B?.injuries).toHaveLength(2);
    expect(second.state.actors.B?.bleeding.map((b) => b.severity)).toEqual(['LIGHT', 'MEDIUM']);
    expect(second.state.actors.B?.blood.bloodLost).toBe(3);
    const pulse = resolveBleedingPulse(
      {
        id: 'fi-07-pulse',
        actor: { actorId: 'B' },
        state: deepFreeze(second.state),
        context: woundContext(),
        facts,
      },
      rng(90, 90),
    );
    expect(pulse.result.entries.map((e) => e.bloodLoss)).toEqual([1, 2]);
    expect(new Set(pulse.result.entries.map((e) => e.source.injuryId)).size).toBe(2);
    expect(pulse.result.bloodAfter).toMatchObject({ maxBlood: 8, bloodLost: 6, currentBlood: 2 });
    expect(pulse.result.thresholdsCrossed).toEqual(['half', 'threeQuarters']);
    expect(pulse.state.actors.B?.conditions.map((c) => c.type)).toContain('Unconscious');
    expect(pulse.logs.at(-1)?.bleedingPulse).toEqual(pulse.result);
    expect(pulse.result.mutations).toHaveLength(1);
    expect(initial.actors.B?.blood.bloodLost).toBe(0);
    expect(second.state.actors.B?.blood.bloodLost).toBe(3);
  });

  it('FI-08 Stunned additive duration and Suppressed removal/expiry coexist across full rounds', () => {
    const base = woundState();
    let s = resolveSuppression(
      createSuppressionEquipmentState(base.combat),
      single(),
      [candidate()],
      rng(35),
    ).state;
    expect(s.suppressed[0]?.durationRounds).toBe(2);
    for (const [id, durationRounds] of [
      ['stun-a', 2],
      ['stun-b', 1],
    ] as const) {
      s = {
        ...s,
        combat: {
          ...s.combat,
          session: applyStunned(s.combat.session, {
            id,
            actor: { actorId: 'C' },
            source: fixtureSource,
            provenance: fixtureProvenance,
            durationRounds,
          }).result,
        },
      };
    }
    expect(
      s.combat.session.conditions.map((c) => [c.type, c.durationRounds, c.stackingRule]),
    ).toEqual([
      ['Suppressed', 2, 'REJECT'],
      ['Stunned', 3, 'ADD_DURATION'],
    ]);
    for (let round = 1; round <= 3; round++) {
      if (round > 1) s = { ...s, combat: beginActionTurn(beginActionRound(s.combat).state).state };
      s = { ...s, combat: finishActionTurn(s.combat).state };
      const b = beginSuppressionEquipmentTurn(s, ctx(), round === 2 ? rng(90) : rng());
      s = b.state;
      expect(s.combat.session.turn?.od).toBe(round <= 2 ? 1 : 2);
      if (round === 1)
        expect(b.logs.some((l) => l.suppressionLifecycle?.operation === 'REMOVAL_CHECK')).toBe(
          false,
        );
      if (round === 2)
        expect(
          b.logs.find((l) => l.suppressionLifecycle?.operation === 'REMOVAL_CHECK')
            ?.suppressionLifecycle?.check,
        ).toMatchObject({ target: 40, outcome: 'failure' });
      s = { ...s, combat: finishActionTurn(s.combat).state };
      s = beginSuppressionEquipmentTurn(s, ctx('C'), rng()).state;
      s = { ...s, combat: finishActionTurn(s.combat).state };
      expect(s.combat.session.phase).toBe('round-ended');
      expect(s.combat.session.conditions.map((c) => c.type)).toEqual(
        round === 1 ? ['Suppressed', 'Stunned'] : round === 2 ? ['Stunned'] : [],
      );
    }
  });

  it.each([false, true])(
    'FI-09 resolved shot → suppression equipment interaction, immune=%s',
    (immune) => {
      const initial = deepFreeze(woundState());
      const shot = resolveRangedAttack(initial.combat, attack('fi-09'), rng(21));
      const event = suppressionEventFromRanged({
        attackId: 'fi-09',
        sourceActor: { actorId: 'A' },
        primaryTarget: { actorId: 'B' },
        weapon: fixtureSource,
        weaponClass: 'BASIC',
        result: shot.result,
        provenance: fixtureProvenance,
      });
      const item = deepFreeze(
        equipment(
          immune
            ? [{ kind: 'SUPPRESSION_IMMUNITY' }]
            : [{ kind: 'CHECK_MODIFIER', scope: 'suppression', value: 10 }],
        ),
      );
      const roll = vi.fn(() => 36);
      const r = resolveSuppression(
        createSuppressionEquipmentState(shot.state, [item]),
        event,
        [candidate()],
        { roll },
        afterAttack(initial, shot.state),
      );
      expect(r.status).toBe('RESOLVED');
      expect(r.targets[0]?.status).toBe(immune ? 'IMMUNE' : 'SUPPRESSED');
      expect(roll).toHaveBeenCalledTimes(immune ? 0 : 1);
      if (!immune)
        expect(r.targets[0]?.check).toMatchObject({
          baseValue: 40,
          rawModifierSum: -5,
          finalModifier: -5,
          target: 35,
        });
      expect(r.logs.find((l) => l.equipment)?.equipment?.traces[0]?.effect.sourceItemId).toBe(
        item.id,
      );
      expect(r.logs.find((l) => l.suppression)?.suppression?.event.attackId).toBe('fi-09');
      expect(r.state.combat.containers['mag:A']?.currentRounds).toBe(29);
    },
  );

  it.each(['POWERED', 'UNPOWERED', 'INACTIVE'] as const)(
    'FI-10 equipment ADD/CAP in a real attack: %s',
    (mode) => {
      const initial = deepFreeze(woundState());
      const baseItem = equipment(
        [
          { kind: 'CHARACTERISTIC_ADD', characteristic: 'НС', value: 30 },
          { kind: 'CHARACTERISTIC_CAP', characteristic: 'НС', value: 60 },
        ],
        'A',
      );
      const item = deepFreeze({
        ...baseItem,
        powerState: mode === 'UNPOWERED' ? ('UNPOWERED' as const) : ('POWERED' as const),
        effects: baseItem.effects.map((e) => ({ ...e, active: mode !== 'INACTIVE' })),
      });
      const r = resolveEquipmentRangedAttack(initial.combat, [item], attack('fi-10'), rng(41));
      expect(r.status).toBe('RESOLVED');
      expect(r.resolution?.result.check).toMatchObject({
        baseValue: mode === 'POWERED' ? 60 : 40,
        target: mode === 'POWERED' ? 70 : 50,
      });
      expect(r.resolution?.result.ammoSpent).toBe(1);
      expect(r.resolution?.logs[0]?.equipment?.traces).toHaveLength(2);
      expect(initial.combat.actors.A?.characteristics.НС?.baseValue).toBe(40);
      expect(item.effects[0]?.payload).toMatchObject({ value: 30 });
    },
  );

  it('FI-11 real combat: known stacking, conditions and GM decisions precede cap, target >100', () => {
    const base = woundState();
    const combat = deepFreeze({
      ...base.combat,
      actors: {
        ...base.combat.actors,
        A: {
          ...base.combat.actors.A!,
          characteristics: {
            ...base.combat.actors.A!.characteristics,
            НС: { baseValue: 80, baseSuper: 0 },
          },
        },
      },
    });
    const item = equipment(
      [
        { kind: 'CHECK_MODIFIER', scope: 'ranged', value: 50 },
        { kind: 'CHECK_MODIFIER', scope: 'ranged', value: 40 },
      ],
      'A',
    );
    const stacked = deepFreeze({
      ...item,
      effects: item.effects.map((e) => ({
        ...e,
        stacking: { group: 'explicit-ranged-rule', rule: 'LARGEST' as const },
      })),
    });
    const context = {
      ...attack().context,
      modifiers: [
        modifier('environment', -40),
        modifier('cancelled', 100),
        { ...modifier('conditional', -50), condition: { requiresTags: ['not-present'] } },
      ],
      overrides: [
        {
          subject: 'modifier' as const,
          id: 'environment',
          operation: 'MODIFY' as const,
          value: 20,
          origin: 'gm' as const,
          reason: 'Final integration explicit environment value',
        },
        {
          subject: 'modifier' as const,
          id: 'cancelled',
          operation: 'EXCLUDE' as const,
          origin: 'gm' as const,
          reason: 'Final integration excludes this source',
        },
      ],
    };
    const r = resolveEquipmentRangedAttack(
      combat,
      [stacked],
      attack('fi-11', { context }),
      rng(90),
    );
    expect(r.resolution?.result.check).toMatchObject({
      baseValue: 80,
      rawModifierSum: 80,
      finalModifier: 60,
      target: 140,
      rawRoll: 90,
      outcome: 'success',
      totalDegrees: 6,
    });
    expect(r.collection.traces[1]).toMatchObject({ included: false, reason: 'stacking' });
    const log = r.resolution?.logs.find((l) => l.resolver === 'check');
    expect(log).toMatchObject({
      checkModifiers: { rawModifierSum: 80, finalModifier: 60 },
      target: 140,
    });
    expect(log?.overrides).toEqual(expect.arrayContaining(context.overrides));
    expect(log?.modifiers.find((m) => m.id === 'conditional')?.included).toBe(false);
    expect(log?.modifiers.find((m) => m.id === 'cancelled')?.included).toBe(false);
    expect(combat.actors.A?.characteristics.НС?.baseValue).toBe(80);
  });

  it('FI-12 unresolved equipment stops at accepted pre-action boundary with all resources intact', () => {
    const initial = deepFreeze(woundState());
    const before = JSON.stringify(initial);
    const baseItem = equipment([{ kind: 'CHECK_MODIFIER', scope: 'ranged', value: 10 }], 'A');
    const item = deepFreeze({
      ...baseItem,
      effects: baseItem.effects.map((e) => ({ ...e, requiresPower: 'UNKNOWN' as const })),
    });
    const roll = vi.fn(() => 41);
    const r = resolveEquipmentRangedAttack(initial.combat, [item], attack('fi-12'), { roll });
    expect(r.status).toBe('PENDING');
    expect(r.state).toBe(initial.combat);
    expect(r.resolution).toBeNull();
    expect(r.collection.pending[0]?.type).toBe('PowerDependencyMappingPending');
    expect(r.collection.log.mutations).toEqual([]);
    expect(roll).not.toHaveBeenCalled();
    expect(r.state.session.turn?.od).toBe(2);
    expect(r.state.session.initiativeOrder[1]?.reactions.remaining).toBe(1);
    expect(r.state.containers['mag:A']?.currentRounds).toBe(30);
    expect(initial.actors.B).toMatchObject({
      damageTaken: 7,
      injuries: [],
      bleeding: [],
      blood: { bloodLost: 0 },
      conditions: [],
    });
    expect(r.state.session.conditions).toEqual([]);
    expect(JSON.stringify(initial)).toBe(before);
    expect(item.effects[0]?.requiresPower).toBe('UNKNOWN');
  });

  it('FI-12 missing round-effect context rejects before RNG or source mutation', () => {
    const checkContext = deepFreeze(
      context({
        effects: [
          {
            ...effect('timed-check', 20, { target: { kind: 'check' } }),
            duration: { unit: 'round', appliedRound: 1, durationRounds: 1, expiresAfterRound: 1 },
          },
        ],
      }),
    );
    const before = JSON.stringify(checkContext);
    const roll = vi.fn(() => 41);
    expect(() =>
      resolveCheck({ baseValue: 40, finalSuper: 0, context: checkContext }, { roll }),
    ).toThrow('requires a context round');
    expect(roll).not.toHaveBeenCalled();
    expect(JSON.stringify(checkContext)).toBe(before);
  });
});
