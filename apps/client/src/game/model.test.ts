import { expect, it } from 'vitest';
import { battleWeapons, createBattle, move, selectActor } from './model';
it('a new battle starts the profile characters at full wounds with full Arsenal magazines', () => {
  const b = createBattle();
  expect(b.hp).toEqual({ 'kelus-drakar': 32, pak: 33 });
  expect(battleWeapons(b, 'kelus-drakar').map((w) => w.name)).toEqual([
    'Хот-шот лазган',
    'Цепной меч',
  ]);
  expect(b.ammo['kelus-drakar:0']).toBe(60);
  expect(b.ammo['kelus-drakar:1']).toBeNull();
});
it('places on cell centres, manually selects turns and logs without mutating characters', () => {
  const b = createBattle();
  const original = JSON.stringify(b.roster);
  move(b, 'pak', 6.5, 9.5);
  selectActor(b, 'pak');
  expect(b.positions.pak).toEqual({ x: 6.5, y: 9.5 });
  expect(b.log.at(-1)?.type).toBe('manual-turn');
  expect(JSON.stringify(b.roster)).toBe(original);
});
it('rejects off-grid, overlapping and out-of-map placement atomically', () => {
  const b = createBattle(),
    before = JSON.stringify(b);
  expect(() => move(b, 'pak', 6.125, 9.875)).toThrow(/не привязана к клеткам/);
  expect(() => move(b, 'pak', 5.5, 10.5)).toThrow(/заняты другим персонажем/);
  expect(() => move(b, 'pak', 20.5, 10.5)).toThrow(/границы карты/);
  expect(JSON.stringify(b)).toBe(before);
});
it('rejects invalid coordinates atomically and restores initial state', () => {
  const b = createBattle(),
    before = JSON.stringify(b);
  expect(() => move(b, 'pak', NaN, 7)).toThrow();
  expect(JSON.stringify(b)).toBe(before);
  b.hp.pak = 1;
  expect(createBattle().hp.pak).toBe(33);
});
