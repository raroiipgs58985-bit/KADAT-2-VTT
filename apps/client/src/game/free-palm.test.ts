import { describe, expect, it } from 'vitest';
import { createBattle } from './model';
import { emptyCharacter } from './character';
import { matchWeaponByName, weaponTraits } from './arsenal';
import { freePalm, startCombat, takeWeapon, weaponInHand } from './engine';
import { fixedDice } from './dice';

// Ruling 181: «Свободная ладонь» — a wrist weapon takes no hand, something else can be held.
describe('«Свободная ладонь»', () => {
  it('a wrist blade stays on when another weapon is taken', () => {
    const wrist = matchWeaponByName('Цепной клинок (запястье)')!;
    const sword = matchWeaponByName('Цепной меч')!;
    expect(weaponTraits(wrist).unread).not.toContain('Свободная ладонь');
    const b = createBattle([
      {
        character: {
          ...emptyCharacter('w', 'Боец'),
          weapons: [
            { name: sword.name, ref: sword.id },
            { name: wrist.name, ref: wrist.id },
          ],
        },
        side: 'a',
        at: { x: 5.5, y: 10.5 },
        id: 'w',
      },
      { character: emptyCharacter('t', 'Противник'), side: 'b', at: { x: 9.5, y: 10.5 }, id: 't' },
    ]);
    expect(freePalm(b, 'w:1')).toBe(true);
    expect(freePalm(b, 'w:0')).toBe(false);
    takeWeapon(b, { id: 'take', actor: 'w', weapon: 'w:0' });
    startCombat(b, fixedDice('10:9,10:2'));
    expect(weaponInHand(b, 'w:0')).toBe(true);
    expect(weaponInHand(b, 'w:1')).toBe(true);
  });
});
