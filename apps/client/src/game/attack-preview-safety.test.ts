import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBattle, type Battle } from './model';
import {
  attack,
  getEngine,
  previewAttack,
  rollPurpose,
  startCombat,
  type AttackCommand,
} from './engine';
import { fixedDice } from './dice';
import { describeEngineError, engineReason } from './errors';

// Stage 2 audit of the attack preview (ADR 0007): probes restored after exceptions, no global
// state leaking into the next real attack, no access to any random source, repeatable calls.

const shot = (patch: Partial<AttackCommand> = {}): AttackCommand => ({
  id: 'shot',
  actor: 'kelus-drakar',
  target: 'pak',
  weapon: 'kelus-drakar:0',
  targetActivity: 'REST',
  defense: 'DECLINE',
  ...patch,
});
const kelusFirst = () => {
  const b = createBattle();
  startCombat(b, fixedDice('10:9,10:2'));
  return b;
};
const pakFirst = () => {
  const b = createBattle();
  startCombat(b, fixedDice('10:2,10:9'));
  return b;
};
const state = (b: Battle) => JSON.stringify({ b, engine: getEngine(b) });

afterEach(() => vi.restoreAllMocks());

describe('previewAttack safety', () => {
  it('a preview failing inside the core leaves no probe behind', () => {
    const b = pakFirst();
    // Fists at 10 m: the core's own melee preparation throws inside the probe.
    const fists = shot({ id: 'f', actor: 'pak', target: 'kelus-drakar', weapon: 'pak:hands' });
    const failed = previewAttack(b, fists);
    expect(failed).toMatchObject({
      status: 'unavailable',
      reason: 'Цель дальше досягаемости оружия ближнего боя',
    });
    expect(failed.status === 'unavailable' && failed.diagnostic).toMatch(
      /Target outside effective melee reach/,
    );
    // A leaked probe would abort this real attack with the preview stop instead of rejecting it.
    expect(() => attack(b, fists, fixedDice('100:50'))).toThrow(
      /Target outside effective melee reach/,
    );
  });

  it('a preview failing in the client (unknown weapon) restores everything too', () => {
    const b = kelusFirst();
    const before = state(b);
    expect(previewAttack(b, shot({ weapon: 'nope' })).status).toBe('unavailable');
    expect(state(b)).toBe(before);
    expect(attack(b, shot(), fixedDice('100:90')).status).toBe('RESOLVED');
  });

  it('the next real attack is identical with or without previews before it', () => {
    const clean = kelusFirst();
    const probed = kelusFirst();
    for (let i = 0; i < 3; i++) {
      previewAttack(probed, shot());
      previewAttack(probed, shot({ mode: 'short-burst' }));
      previewAttack(probed, shot({ weapon: 'nope' }));
      previewAttack(probed, shot({ modifier: 20 }));
    }
    const dice = () => fixedDice('100:45,10:2,100:20');
    const a = attack(clean, shot(), dice());
    const c = attack(probed, shot(), dice());
    expect(c).toEqual(a);
    expect(state(probed)).toBe(state(clean));
    // The roll phase global is the attack's own, not left over from a preview.
    expect(rollPurpose('attack', 100)).toBe(rollPurpose('attack', 100));
  });

  it('never consults a random source', () => {
    const random = vi.spyOn(Math, 'random');
    const crypto = vi.spyOn(globalThis.crypto, 'getRandomValues');
    const b = kelusFirst();
    for (let i = 0; i < 4; i++) previewAttack(b, shot({ modifier: i * 10 }));
    previewAttack(b, shot({ mode: 'short-burst' }));
    expect(random).not.toHaveBeenCalled();
    expect(crypto).not.toHaveBeenCalled();
  });

  it('consecutive calls with different commands each match a fresh battle', () => {
    const b = kelusFirst();
    const commands = [
      shot(),
      shot({ modifier: 10 }),
      shot({ mode: 'short-burst' }),
      shot(),
      shot({ modifier: -20 }),
    ];
    for (const c of commands) expect(previewAttack(b, c)).toEqual(previewAttack(kelusFirst(), c));
  });
});

describe('localized engine errors keep the core message', () => {
  it('known core message → Russian text, original kept', () => {
    expect(describeEngineError(new Error('Insufficient OD for action'))).toEqual({
      text: 'Недостаточно ОД в этом ходу',
      diagnostic: 'Insufficient OD for action',
    });
  });
  it('Russian client message passes through', () => {
    expect(describeEngineError(new Error('Сейчас ход другого персонажа'))).toEqual({
      text: 'Сейчас ход другого персонажа',
    });
  });
  it('unknown English message → Russian text with the original as diagnostic', () => {
    const r = describeEngineError(new Error('Some new core invariant'));
    expect(r.text).toMatch(/[А-Яа-я]/);
    expect(r.diagnostic).toBe('Some new core invariant');
  });
  it('a rejected command logs the Russian reason and the core diagnostic', () => {
    const b = pakFirst();
    const fists = shot({ id: 'f', actor: 'pak', target: 'kelus-drakar', weapon: 'pak:hands' });
    expect(() => attack(b, fists, fixedDice('100:50'))).toThrow();
    const last = b.log.at(-1)!;
    expect(last.type).toBe('rejected');
    expect(last.detail).toMatchObject(
      engineReason(new Error('Target outside effective melee reach')),
    );
  });
});
