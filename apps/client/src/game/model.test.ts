import { expect, it } from 'vitest';
import { createBattle, fixture, move, selectActor, weapons } from './model';
it('restores real profiles, health and author-approved full ammunition', () => {
  const b = createBattle();
  expect(b.hp).toEqual({ 'kelus-drakar': 26, pak: 33 });
  expect(b.ammo.hotshot).toBe(250);
  expect(b.ammo.bracer).toBe(10);
  expect(b.ammo.flamer).toBe(9);
  expect(fixture.actors[1]!.characteristics.НР.value).toBe(50);
  expect(weapons[2]!.raw).toContain('1к10+10');
});
it('moves continuously, manually selects turns and logs without mutating profiles', () => {
  const original = JSON.stringify(fixture),
    b = createBattle();
  move(b, 'pak', 6.125, 9.875);
  selectActor(b, 'pak');
  expect(b.positions.pak).toEqual({ x: 6.125, y: 9.875 });
  expect(b.log.at(-1)?.type).toBe('manual-turn');
  expect(JSON.stringify(fixture)).toBe(original);
});
it('rejects invalid coordinates atomically and restores initial state', () => {
  const b = createBattle(),
    before = JSON.stringify(b);
  expect(() => move(b, 'pak', NaN, 7)).toThrow();
  expect(JSON.stringify(b)).toBe(before);
  b.hp.pak = 1;
  expect(createBattle().hp.pak).toBe(33);
});
