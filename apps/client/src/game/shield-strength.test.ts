import { describe, expect, it } from 'vitest';
import { createBattle } from './model';
import { emptyCharacter } from './character';
import { matchWeaponByName, shieldZones, weaponTraits } from './arsenal';
import {
  dropWeapon,
  getEngine,
  shieldArmour,
  startCombat,
  takeWeapon,
  weaponInHand,
} from './engine';
import { fixedDice } from './dice';

// Rulings 179–180: «Сила (Х)» (also written «Х+») and the shields' «Оборонительное» ОБ by zones.
describe('«Сила (Х)» and «Оборонительное» are read', () => {
  it('«Сила (4+)» is «Сила (4)»; nothing is left unread', () => {
    const w = matchWeaponByName('Двуручный цепной меч')!;
    const t = weaponTraits(w);
    expect(t.traits.find((x) => x.name === 'Сила')?.value).toBe(4);
    expect(t.unread.filter((x) => x.startsWith('Сила'))).toEqual([]);
  });
  it('shield zones: head / arms / torso / legs, one number or «все Х» — every zone', () => {
    expect(shieldZones('-/6/6/-')).toEqual({ head: 0, arms: 6, torso: 6, legs: 0 });
    expect(shieldZones('-/4/4/4')).toEqual({ head: 0, arms: 4, torso: 4, legs: 4 });
    expect(shieldZones('все 6')).toEqual({ head: 6, arms: 6, torso: 6, legs: 6 });
    expect(shieldZones('18')).toEqual({ head: 18, arms: 18, torso: 18, legs: 18 });
    expect(shieldZones('что-то')).toBeNull();
    const shield = matchWeaponByName('Панцирный щит')!;
    expect(weaponTraits(shield).unread.filter((x) => x.startsWith('Оборонительное'))).toEqual([]);
  });
  it('a shield adds its ОБ only while it is in hand', () => {
    const shield = matchWeaponByName('Панцирный щит')!;
    const b = createBattle([
      {
        character: {
          ...emptyCharacter('s', 'Щитоносец'),
          weapons: [{ name: shield.name, ref: shield.id }],
        },
        side: 'a',
        at: { x: 5.5, y: 10.5 },
        id: 's',
      },
      { character: emptyCharacter('t', 'Противник'), side: 'b', at: { x: 9.5, y: 10.5 }, id: 't' },
    ]);
    if (!weaponInHand(b, 's:0')) takeWeapon(b, { id: 'take', actor: 's', weapon: 's:0' });
    startCombat(b, fixedDice('10:9,10:2'));
    expect(shieldArmour(b, getEngine(b), 's')).toEqual({ head: 0, arms: 6, torso: 6, legs: 0 });
    dropWeapon(b, { id: 'drop', actor: 's', weapon: 's:0' });
    expect(shieldArmour(b, getEngine(b), 's')).toEqual({ head: 0, arms: 0, torso: 0, legs: 0 });
  });
});
