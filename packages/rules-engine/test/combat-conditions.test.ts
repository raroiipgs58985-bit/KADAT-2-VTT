import { describe, expect, test, vi } from 'vitest';
import type { ConditionInstance } from '@kadat/contracts';
import {
  applyStunned,
  createCombatSession,
  createSequenceDice,
  endTurn,
  expireConditions,
  isRestricted,
  rebuildInitiative,
  remainingRounds,
  resolveCharacteristic,
  startNextRound,
  startTurn,
} from '../src/index.js';
import {
  actor,
  context,
  deepFreeze,
  effect,
  finishRound,
  participants,
  provenance,
  session,
  source,
} from './fixtures.js';

describe('CombatSession, rounds and Stunned', () => {
  test('AC-003: full 10/6/3/1 initiative chain, round ends only after Alyosha', () => {
    let state = deepFreeze(session());
    expect(state.initiativeOrder.map((entry) => entry.initiative)).toEqual([10, 6, 3, 1]);
    for (const [index, actorId] of ['Kelus', 'Servitor', 'Apricot', 'Alyosha'].entries()) {
      const started = startTurn(state);
      state = started.result;
      expect(state.activeActor?.actorId).toBe(actorId);
      expect(state.turn).toMatchObject({
        od: 2,
        reactions: { remaining: 1, capacity: 1 },
        flags: [],
      });
      expect(started.log).toMatchObject({
        resolver: 'turn-start',
        roundNumber: 1,
        turnNumber: index + 1,
      });
      const ended = endTurn(deepFreeze(state));
      state = ended.result;
      expect(state.phase).toBe(index === 3 ? 'round-ended' : 'between-turns');
      expect(ended.log.resolver).toBe(index === 3 ? 'round-end' : 'turn-end');
      expect(state.roundNumber).toBe(1);
    }
    const next = startNextRound(state);
    expect(next.result).toMatchObject({
      roundNumber: 2,
      phase: 'ready',
      cursor: 0,
      activeActor: null,
    });
    expect(startTurn(next.result).result.activeActor?.actorId).toBe('Kelus');
  });

  test('initiative uses injected 1d10 + resolved agility bonus including Super', () => {
    const agility = resolveCharacteristic('ЛВ', { baseValue: 50, baseSuper: 4 }, context()).result;
    const combat = createCombatSession(
      'id',
      'release',
      [{ actor, agilityBonus: agility.finalBonus, reactions: { capacity: 1, remaining: 1 } }],
      createSequenceDice([{ sides: 10, value: 6 }]),
    );
    expect(combat.result.initiativeOrder[0]).toMatchObject({
      initiative: 15,
      roll: { value: 6 },
      agilityBonus: 9,
    });
    expect(combat.log.baseValues.Kelus).toBe(9);
  });

  test('Stunned(2) in round 2: active in 2 and 3, removed only after the last turn of round 3', () => {
    let state = startNextRound(finishRound(session())).result;
    const applied = applyStunned(state, {
      id: 'stunned',
      actor,
      source,
      provenance,
      durationRounds: 2,
    });
    state = applied.result;
    const condition = state.conditions[0]!;
    expect(condition).toMatchObject({ appliedRound: 2, durationRounds: 2, expiresAfterRound: 3 });
    expect(remainingRounds(condition, 2)).toBe(2);
    expect(applied.log.mutations[0]?.type).toBe('condition-add');
    expect(isRestricted(state.conditions, actor, 'action', context({ roundNumber: 2 }))).toBe(true);
    expect(isRestricted(state.conditions, actor, 'reaction', context({ roundNumber: 2 }))).toBe(
      true,
    );
    state = startNextRound(finishRound(state)).result;
    expect(state.conditions).toHaveLength(1);
    expect(remainingRounds(state.conditions[0]!, 3)).toBe(1);
    for (let index = 0; index < 3; index += 1) {
      state = endTurn(startTurn(state).result).result;
      expect(state.conditions).toHaveLength(1);
    }
    const ended = endTurn(startTurn(state).result);
    expect(ended.result.phase).toBe('round-ended');
    expect(ended.result.conditions).toEqual([]);
    expect(ended.log.mutations).toContainEqual(
      expect.objectContaining({ type: 'condition-remove', path: 'conditions.stunned' }),
    );
    state = startNextRound(ended.result).result;
    expect(state.roundNumber).toBe(4);
    expect(isRestricted(state.conditions, actor, 'action', context({ roundNumber: 4 }))).toBe(
      false,
    );
  });

  test('remaining 2 + new Stunned(3) = 5; all sources retained without mutating the first instance', () => {
    let state = startNextRound(finishRound(session())).result;
    state = applyStunned(state, {
      id: 'first',
      actor,
      source,
      provenance,
      durationRounds: 3,
    }).result;
    state = startNextRound(finishRound(state)).result;
    const original = deepFreeze(state);
    expect(remainingRounds(original.conditions[0]!, 3)).toBe(2);
    const stacked = applyStunned(original, {
      id: 'second',
      actor,
      source: { kind: 'test-source', id: 'second' },
      provenance,
      durationRounds: 3,
    });
    expect(stacked.result.conditions).toHaveLength(1);
    expect(remainingRounds(stacked.result.conditions[0]!, 3)).toBe(5);
    expect(stacked.result.conditions[0]).toMatchObject({
      id: 'first',
      appliedRound: 2,
      durationRounds: 6,
      expiresAfterRound: 7,
    });
    expect(stacked.result.conditions[0]?.sources).toHaveLength(2);
    expect(stacked.log.mutations[0]?.type).toBe('condition-stack');
    expect(remainingRounds(original.conditions[0]!, 3)).toBe(2);
  });

  test('duration 1 expires at the end of its application round', () => {
    const state = applyStunned(session(), {
      id: 'one',
      actor,
      source,
      provenance,
      durationRounds: 1,
    }).result;
    expect(finishRound(state).conditions).toEqual([]);
  });

  test('restrictions and caller-provided bonus remain Effect data', () => {
    const bonus = effect('canonical-attack-bonus', 123, {
      // Synthetic test data, deliberately not a canonical numeric bonus.
      target: { kind: 'combat-modifier', key: 'attacks-against-Stunned' },
      stackingRule: 'independent',
    });
    const applied = applyStunned(session(), {
      id: 'data',
      actor,
      source,
      provenance,
      durationRounds: 2,
      additionalEffects: [bonus],
    });
    expect(applied.result.conditions[0]?.effects).toContainEqual(bonus);
    const overridden = context({
      roundNumber: 1,
      overrides: [
        {
          subject: 'effect',
          id: 'data:action',
          operation: 'EXCLUDE',
          reason: 'One-resolution GM override',
        },
      ],
    });
    expect(isRestricted(applied.result.conditions, actor, 'action', overridden)).toBe(false);
    expect(
      isRestricted(applied.result.conditions, actor, 'reaction', context({ roundNumber: 1 })),
    ).toBe(true);
    expect(
      isRestricted(
        applied.result.conditions,
        { actorId: 'other' },
        'action',
        context({ roundNumber: 1 }),
      ),
    ).toBe(false);
  });

  test('generic expiration does not impose Stunned stacking on other condition kinds', () => {
    const condition: ConditionInstance = {
      id: 'generic',
      type: 'test-only',
      actor,
      sources: [source],
      provenance: [provenance],
      effects: [],
      unit: 'round',
      appliedRound: 2,
      durationRounds: 3,
      expiresAfterRound: 4,
      stackingRule: 'REJECT',
    };
    expect(remainingRounds(condition, 1)).toBe(0);
    expect(expireConditions([condition], 3).remaining).toEqual([condition]);
    expect(expireConditions([condition], 4).removed).toEqual([condition]);
    expect(condition.stackingRule).toBe('REJECT');
  });

  test('new participant rerolls every initiative entry and rebuilds at a boundary', () => {
    const original = deepFreeze(session());
    const joined = [
      ...participants(),
      { actor: { actorId: 'Newcomer' }, agilityBonus: 0, reactions: { capacity: 1, remaining: 1 } },
    ];
    const rebuilt = rebuildInitiative(
      original,
      joined,
      createSequenceDice([1, 2, 3, 4, 10].map((value) => ({ sides: 10, value }))),
    );
    expect(rebuilt.result.initiativeOrder.map((entry) => entry.actor.actorId)).toEqual([
      'Newcomer',
      'Alyosha',
      'Apricot',
      'Servitor',
      'Kelus',
    ]);
    expect(rebuilt.log.dice).toHaveLength(5);
    expect(original.initiativeOrder[0]?.initiative).toBe(10);
    expect(startTurn(rebuilt.result).result.activeActor?.actorId).toBe('Newcomer');
  });

  test('equal initiative: the tied reroll 1к10, still tied reroll again (author ruling 23)', () => {
    // All four roll 5. Tie rolls: Kelus 3, Servitor 8, Apricot 3, Alyosha 1;
    // Kelus and Apricot tie again on 3 and reroll: Kelus 2, Apricot 9.
    const tied = createCombatSession(
      'id',
      'release',
      participants(),
      createSequenceDice([5, 5, 5, 5, 3, 8, 3, 1, 2, 9].map((value) => ({ sides: 10, value }))),
    );
    expect(tied.result.initiativeOrder.map((entry) => entry.actor.actorId)).toEqual([
      'Servitor',
      'Apricot',
      'Kelus',
      'Alyosha',
    ]);
    expect(tied.result.initiativeOrder[1]!.tieRolls!.map((r) => r.value)).toEqual([3, 9]);
  });

  test('no tie — no extra die is consumed', () => {
    const roll = vi.fn();
    const dice = createSequenceDice([10, 6, 3, 1].map((value) => ({ sides: 10, value })));
    const order = createCombatSession('id', 'release', participants(), {
      roll: (sides) => {
        roll();
        return dice.roll(sides);
      },
    });
    expect(roll).toHaveBeenCalledTimes(4);
    expect(order.result.initiativeOrder.every((e) => e.tieRolls === undefined)).toBe(true);
  });

  test('invalid round/turn transitions are rejected', () => {
    const ready = session();
    expect(() => endTurn(ready)).toThrow('No active turn');
    expect(() => startNextRound(ready)).toThrow('has not ended');
    const active = startTurn(ready).result;
    expect(() => startTurn(active)).toThrow('Cannot start');
    expect(() => rebuildInitiative(active, participants(), createSequenceDice([]))).toThrow(
      'round boundary',
    );
    expect(() => startTurn(finishRound(ready))).toThrow('Cannot start');
    expect(() => startTurn({ ...ready, cursor: 99 })).toThrow('out of bounds');
    expect(() => endTurn({ ...active, activeActor: { actorId: 'wrong' } })).toThrow('Inconsistent');
    expect(() => startNextRound({ ...ready, phase: 'round-ended' })).toThrow(
      'before the last actor',
    );
  });

  test('empty/duplicate participants and invalid reaction pool cannot initialize combat', () => {
    expect(() => createCombatSession('id', 'release', [], createSequenceDice([]))).toThrow(
      'requires participants',
    );
    expect(() =>
      createCombatSession(
        'id',
        'release',
        [participants()[0]!, participants()[0]!],
        createSequenceDice([]),
      ),
    ).toThrow('duplicate');
    expect(() =>
      createCombatSession(
        'id',
        'release',
        [{ actor, agilityBonus: 0, reactions: { capacity: 1, remaining: 2 } }],
        createSequenceDice([]),
      ),
    ).toThrow('exceeds capacity');
    expect(() =>
      rebuildInitiative(session(), participants().slice(1), createSequenceDice([])),
    ).toThrow('remove participants');
  });

  test('invalid conditions fail explicitly', () => {
    const application = { id: 'invalid', actor, source, provenance, durationRounds: 0 };
    expect(() => applyStunned(session(), application)).toThrow('Stunned duration');
    expect(() =>
      applyStunned(finishRound(session()), { ...application, durationRounds: 2 }),
    ).toThrow('ended round');
    expect(() =>
      applyStunned(session(), { ...application, actor: { actorId: 'missing' }, durationRounds: 2 }),
    ).toThrow('not a participant');
    expect(() => isRestricted([], actor, 'action', context())).toThrow('current round');
  });
});
