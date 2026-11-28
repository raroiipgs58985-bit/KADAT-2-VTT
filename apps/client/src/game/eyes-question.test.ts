import { describe, expect, it } from 'vitest';
import { createBattle } from './model';
import { attack, placeActor, resumeAttack, startCombat, takeWeapon, turnInfo } from './engine';
import { fixedDice } from './dice';

// A wound to the eyes whose consequence depends on the eye count before the injury: the GM
// is asked for it (a fact, not a rule) instead of the fight stopping with no way on.
const strike = {
  id: 'eye',
  actor: 'kelus-drakar',
  target: 'pak',
  weapon: 'kelus-drakar:1',
  targetActivity: 'REST' as const,
  defense: 'DECLINE' as const,
};
const fight = () => {
  const b = createBattle();
  placeActor(b, 'pak', 6.5, 10.5);
  takeWeapon(b, { id: 'sword', actor: 'kelus-drakar', weapon: 'kelus-drakar:1' });
  startCombat(b, fixedDice('10:9,10:2'));
  return b;
};
/** Answers every GM question on the way; stops at the eye-count question if it comes. */
function toEyes(dice: string) {
  const b = fight();
  attack(b, strike, fixedDice('100:20'));
  const answers: Record<string, number> = {};
  for (let i = 0; i < 6; i++) {
    const q = turnInfo(b).pending?.question;
    if (!q) return null;
    if (q.key.startsWith('eyes:')) return b;
    answers[q.key] = q.key.startsWith('armour:') ? 0 : (q.options?.[0]?.value ?? 0);
    try {
      resumeAttack(b, fixedDice(dice), { [q.key]: answers[q.key]! });
    } catch {
      return null;
    }
  }
  return null;
}

describe('eye count before the injury', () => {
  it('is asked from the GM; the answer goes on with the same dice', () => {
    // Damage 1 + 4 with ОБ 0 into the head table reaches «Head 7» (injured eye, eye check).
    const used = '10:1,10:4,10:1,100:50,10:5,10:5,10:5,10:5,10:5,10:5';
    const found = toEyes(used);
    expect(found, 'the damage reaches an eye-count consequence').not.toBeNull();
    const b = found!;
    const q = turnInfo(b).pending!.question!;
    expect(q.text).toMatch(/сколько глаз/);
    resumeAttack(b, fixedDice(used), { [q.key]: 2 });
    expect(turnInfo(b).pending?.question?.key ?? null).not.toBe(q.key);
  });
});
