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
it('places on cell centres, manually selects turns and logs without mutating profiles', () => {
  const original = JSON.stringify(fixture),
    b = createBattle();
  move(b, 'pak', 6.5, 9.5);
  selectActor(b, 'pak');
  expect(b.positions.pak).toEqual({ x: 6.5, y: 9.5 });
  expect(b.log.at(-1)?.type).toBe('manual-turn');
  expect(JSON.stringify(fixture)).toBe(original);
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
