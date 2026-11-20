import { expect, it } from 'vitest';
import { attack, getEngine, resumeAttack } from './engine';
import { createBattle } from './model';
import { demoBattle, resolvedDemoBattle, exportReplay, importReplay } from './replay';
import { fixedDice } from './dice';
import { rulings } from './rulings';
it('AC-LC01: completes and replays two real attacks (Kelus hit, Pak miss) without an armor-order assumption', () => {
  const b = resolvedDemoBattle();
  expect(getEngine(b).pending).toBeUndefined();
  expect(getEngine(b).committed).toEqual(['demo-kelus', 'demo-pak']);
  expect(b.hp).toEqual({ 'kelus-drakar': 26, pak: 31 });
  expect(b.ammo.hotshot).toBe(249);
  const replayed = importReplay(exportReplay(b));
  expect(getEngine(replayed)).toEqual(getEngine(b));
});
it.skipIf(rulings.chainTiming === null)(
  'AC-LC02: both damaging attacks resolve completely under the approved armor timing',
  () => {
    const b = demoBattle();
    expect(getEngine(b).pending).toBeUndefined();
    expect(b.hp).toEqual({ 'kelus-drakar': 16, pak: 31 });
    expect(b.ammo.hotshot).toBe(249);
  },
);
it('replays the whole fixed scenario, including placements and accepted Core consequences', () => {
  const b = demoBattle(),
    serialized = JSON.stringify(exportReplay(b)),
    replayed = importReplay(JSON.parse(serialized));
  expect(b.hp.pak).toBe(31);
  expect(exportReplay(b).steps[0]!.type).toBe('placement');
  expect(b.ammo.hotshot).toBe(249);
  expect(b.hp['kelus-drakar']).toBe(rulings.chainTiming === null ? 26 : 16);
  expect(replayed.hp).toEqual(b.hp);
  expect(replayed.positions).toEqual(b.positions);
  expect(replayed.ammo).toEqual(b.ammo);
  expect(getEngine(replayed)).toEqual(getEngine(b));
});
it('reproduces an attack that was resumed with additional fixed dice', () => {
  const b = createBattle();
  attack(
    b,
    {
      id: 'saved',
      actor: 'kelus-drakar',
      target: 'pak',
      weapon: 'hotshot',
      targetActivity: 'REST',
      defense: 'DECLINE',
    },
    fixedDice('100:45'),
  );
  resumeAttack(b, fixedDice('10:2,100:20'));
  const replayed = importReplay(exportReplay(b));
  expect(replayed.hp.pak).toBe(31);
  expect(replayed.ammo.hotshot).toBe(249);
  expect(getEngine(replayed).pending).toBeUndefined();
});
it('rejects a mismatched author ruling instead of silently migrating a replay', () => {
  const r = structuredClone(exportReplay(createBattle())) as unknown as {
    rulings: { laserMasterRounding: string };
  };
  r.rulings.laserMasterRounding = 'ceil';
  expect(() => importReplay(r)).toThrow('Решения автора');
});
it('rejects altered dice prefixes and unknown replay commands', () => {
  const b = createBattle();
  attack(
    b,
    {
      id: 'saved',
      actor: 'kelus-drakar',
      target: 'pak',
      weapon: 'hotshot',
      targetActivity: 'REST',
      defense: 'DECLINE',
    },
    fixedDice('100:45'),
  );
  resumeAttack(b, fixedDice('10:2,100:20'));
  const r = exportReplay(b),
    step = r.steps.at(-1)!;
  if (step.type === 'attack') step.rolls[0] = { sides: step.rolls[0]!.sides, value: 44 };
  expect(() => importReplay(r)).toThrow('Saved dice prefix');
  expect(() =>
    importReplay({ ...exportReplay(createBattle()), steps: [{ type: 'unknown' }] }),
  ).toThrow('Неизвестная команда');
});
