import { expect, it } from 'vitest';
import { attack, getEngine, resumeAttack, startCombat, type AttackCommand } from './engine';
import { createBattle } from './model';
import { exportReplay, importReplay } from './replay';
import { fixedDice } from './dice';

const shot = (id: string): AttackCommand => ({
  id,
  actor: 'kelus-drakar',
  target: 'pak',
  weapon: 'kelus-drakar:0',
  targetActivity: 'REST',
  defense: 'DECLINE',
});
const started = () => {
  const b = createBattle();
  startCombat(b, fixedDice('10:9,10:2'));
  return b;
};

it('replays a fight with an Arsenal weapon to the same state', () => {
  const b = started();
  attack(b, shot('a'), fixedDice('100:45,10:2,100:20'));
  const replayed = importReplay(JSON.parse(JSON.stringify(exportReplay(b))));
  expect(replayed.hp).toEqual(b.hp);
  expect(replayed.ammo).toEqual(b.ammo);
  expect(getEngine(replayed)).toEqual(getEngine(b));
});
it('reproduces an attack resumed after a GM answer with the saved dice', () => {
  const b = started();
  attack(b, shot('a'), fixedDice('100:45'));
  expect(getEngine(b).pending).toBeDefined();
  resumeAttack(b, fixedDice('10:2,100:20'));
  const replayed = importReplay(exportReplay(b));
  expect(replayed.hp).toEqual(b.hp);
  expect(getEngine(replayed).pending).toBeUndefined();
});
it('refuses an attack before the fight has started', () => {
  const b = createBattle();
  expect(() => attack(b, shot('early'), fixedDice('100:45'))).toThrow(/не начат/);
});
it('rejects a mismatched author ruling instead of silently migrating a replay', () => {
  const r = structuredClone(exportReplay(createBattle())) as unknown as {
    rulings: { laserMasterRounding: string };
  };
  r.rulings.laserMasterRounding = 'ceil';
  expect(() => importReplay(r)).toThrow('Решения автора');
});
it('rejects altered dice prefixes and unknown replay commands', () => {
  const b = started();
  attack(b, shot('a'), fixedDice('100:45'));
  resumeAttack(b, fixedDice('10:2,100:20'));
  const r = exportReplay(b),
    step = r.steps.at(-1)!;
  if (step.type === 'attack') step.rolls[0] = { sides: step.rolls[0]!.sides, value: 44 };
  expect(() => importReplay(r)).toThrow();
  expect(() =>
    importReplay({ ...exportReplay(createBattle()), steps: [{ type: 'unknown' }] } as never),
  ).toThrow('Неизвестная команда');
});
