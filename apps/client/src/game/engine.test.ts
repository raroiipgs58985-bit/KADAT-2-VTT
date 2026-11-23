import { describe, expect, it } from 'vitest';
import { createBattle, maxWounds, type Battle } from './model';
import {
  actorStatus,
  addCombatant,
  attack,
  getEngine,
  moveActor,
  placeActor,
  removeCombatant,
  resumeAttack,
  setMovementOption,
  startCombat,
  turnInfo,
  weaponSupport,
  type AttackCommand,
} from './engine';
import { fixedDice } from './dice';
import { emptyCharacter } from './character';
import { characterFromProfile } from './character-file';
import { exportReplay, importReplay } from './replay';

const shot = (patch: Partial<AttackCommand> = {}): AttackCommand => ({
  id: 'shot',
  actor: 'kelus-drakar',
  target: 'pak',
  weapon: 'kelus-drakar:0',
  targetActivity: 'REST',
  defense: 'DECLINE',
  ...patch,
});
const started = (setup?: (b: Battle) => void) => {
  const b = createBattle();
  setup?.(b);
  startCombat(b, fixedDice('10:9,10:2'));
  return b;
};

describe('Initiative (step 4)', () => {
  it('rolls 1к10 + бЛВ at the start; the higher result acts first', () => {
    const b = createBattle();
    startCombat(b, fixedDice('10:2,10:9'));
    const info = turnInfo(b);
    expect(info.order).toEqual(['pak', 'kelus-drakar']);
    expect(info.initiative).toEqual({ pak: 13, 'kelus-drakar': 6 });
    expect(info.active).toBe('pak');
  });
  it('equal results are re-rolled between the tied participants (ruling 20)', () => {
    const b = createBattle();
    startCombat(b, fixedDice('10:5,10:5,10:3,10:8'));
    expect(turnInfo(b).order).toEqual(['pak', 'kelus-drakar']);
  });
});

describe('Attack with an Arsenal weapon', () => {
  it('Хот-шот лазган: Проверенное (5), ББ 6 against torso ОБ 7, Заряд (7) per shot', () => {
    const b = started();
    moveActor(b, { id: 'm', actor: 'kelus-drakar', mode: 'half-move', to: { x: 9.5, y: 10.5 } });
    const r = attack(b, shot(), fixedDice('100:45,10:2,100:20'));
    expect(r.status).toBe('RESOLVED');
    const hits = (
      r as { result: { hits: { location: string; total: number; finalDamage: number }[] } }
    ).result.hits;
    // d10 2 → 5 (Проверенное) + 4 = 9; ОБ 7 − ББ 6 = 1; бВН 4 → 4.
    expect(hits).toMatchObject([{ location: 'Torso', total: 9, finalDamage: 4 }]);
    expect(actorStatus(b, 'pak').wounds).toBe(29);
    expect(b.ammo['kelus-drakar:0']).toBe(53);
    expect(turnInfo(b).od).toBe(0);
  });
  it('a miss spends the charge and rolls no damage', () => {
    const b = started();
    const r = attack(b, shot(), fixedDice('100:90'));
    expect(r.status).toBe('RESOLVED');
    expect(actorStatus(b, 'pak').wounds).toBe(33);
    expect(b.ammo['kelus-drakar:0']).toBe(53);
  });
  it('rejects a repeated command id without rolling', () => {
    const b = started();
    attack(b, shot(), fixedDice('100:90'));
    expect(() => attack(b, shot(), fixedDice(''))).toThrow(/уже исполнена/);
  });
  it('a weapon not found in the Arsenal cannot attack (ruling 76)', () => {
    const b = started();
    expect(weaponSupport(b, 'pak:0').level).toBe('blocked');
  });
});

describe('Melee and GM questions', () => {
  it('Цепной меч: бСЛ + Сверх (ruling 74), ½ бСЛ asked of the GM, armour loses ББ first', () => {
    const b = started((x) => placeActor(x, 'pak', 6.5, 10.5));
    const first = attack(
      b,
      shot({ id: 'cut', weapon: 'kelus-drakar:1' }),
      fixedDice('100:35,10:3,10:7'),
    );
    expect(first).toMatchObject({ status: 'CONTEXT_REQUIRED' });
    const q = turnInfo(b).pending?.question;
    expect(q?.key).toBe('chain-half-sl');
    expect(q?.options?.map((o) => o.value)).toEqual([2, 3]);
    // The saved dice are reused: nothing is re-rolled after the answer.
    const r = resumeAttack(b, fixedDice('10:3,10:7'), { 'chain-half-sl': 3 });
    expect(r.status).toBe('RESOLVED');
    const hit = (
      r as { result: { hits: { total: number; armour: number; finalDamage: number }[] } }
    ).result.hits[0]!;
    // d10 3 → Разрывное (from Цепное) re-roll 7; +5 +бСЛ 5 +3 = 20; torso 7 − 2 = 5.
    expect(hit).toMatchObject({ total: 20, armour: 5, finalDamage: 13 });
    expect(getEngine(b).armorLoss).toEqual({ 'pak:torso': 2 });
    expect(actorStatus(b, 'pak').wounds).toBe(20);
  });
  it('a hit to the eyes asks the GM for the ОБ (ruling 75)', () => {
    const b = started((x) => placeActor(x, 'pak', 6.5, 10.5));
    attack(b, shot({ id: 'eye', weapon: 'kelus-drakar:1' }), fixedDice('100:20'));
    expect(turnInfo(b).pending?.question?.key).toBe('armour:Eyes');
  });
});

describe('Roster', () => {
  it('adds a library character before the fight; copies get their own ids', () => {
    const b = createBattle();
    const npc = { ...emptyCharacter('npc-guard', 'Страж'), kind: 'npc' as const };
    const a = addCombatant(b, npc, 'b');
    const c = addCombatant(b, npc, 'b');
    expect([a, c]).toEqual(['npc-guard', 'npc-guard-2']);
    expect(b.roster[c]!.character.name).toBe('Страж 2');
    expect(maxWounds(b, a)).toBe(10);
    removeCombatant(b, a);
    expect(b.roster[a]).toBeUndefined();
    startCombat(b, fixedDice('10:9,10:2,10:1'));
    expect(() => addCombatant(b, npc, 'a')).toThrow(/до начала боя/);
  });
  it('switches the СКР option at any time (ruling 3)', () => {
    const b = started();
    setMovementOption(b, 'kelus-drakar', 1);
    expect(getEngine(b).wounds.combat.actors['kelus-drakar']!.movement).toBe(5);
  });
  it('a replay starts from the recorded participants and repeats the fight', () => {
    const b = createBattle([
      {
        character: characterFromProfile('kelus-drakar'),
        side: 'a',
        at: { x: 5.5, y: 10.5 },
        id: 'kelus-drakar',
      },
      { character: characterFromProfile('pak'), side: 'b', at: { x: 15.5, y: 10.5 }, id: 'pak' },
    ]);
    addCombatant(b, emptyCharacter('npc', 'Наёмник'), 'b');
    startCombat(b, fixedDice('10:9,10:2,10:1'));
    attack(b, shot(), fixedDice('100:45,10:2,100:20'));
    const replayed = importReplay(JSON.parse(JSON.stringify(exportReplay(b))));
    expect(replayed.hp).toEqual(b.hp);
    expect(Object.keys(replayed.roster)).toEqual(Object.keys(b.roster));
  });
});
