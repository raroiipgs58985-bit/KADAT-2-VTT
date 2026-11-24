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
  setMovementOption,
  startCombat,
  turnInfo,
  weaponSupport,
  braceWeapon,
  nextTurn,
  weaponBraced,
  heavyFromHands,
  resumeAttack,
  turnAction,
  weaponState,
  takeWeapon,
  dropWeapon,
  weaponInHand,
  reloadCost,
  readyCost,
  pickUpWeapon,
  pickUpCost,
  weaponDropped,
  weaponHanging,
  entanglement,
  counterattacks,
  disarm,
  corrodedZones,
  extractWeapon,
  placeLoose,
  pendingLoose,
  takeDisarmed,
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
  const talented = (talent: string) => {
    const b = createBattle();
    const c = b.roster.pak!.character;
    b.roster.pak = { ...b.roster.pak!, character: { ...c, talents: [...c.talents, talent] } };
    return b;
  };
  it('«Молниеносные рефлексы»: two rolls, the higher counts', () => {
    const b = talented('Молниеносные рефлексы');
    startCombat(b, fixedDice('10:2,10:3,10:9'));
    expect(turnInfo(b).initiative.pak).toBe(13);
  });
  it('«Шаг в сторону»: two avoidances a round', () => {
    const b = talented('Шаг в сторону');
    startCombat(b, fixedDice('10:2,10:9'));
    expect(turnInfo(b).reactions.pak).toBe(2);
  });
  it('«Боевое чутьё»: бВС instead of бЛВ', () => {
    const b = talented('Боевое чутьё');
    const c = b.roster.pak!.character;
    startCombat(b, fixedDice('10:2,10:9'));
    expect(turnInfo(b).initiative.pak).toBe(
      9 + Math.floor(c.characteristics.ВС.value / 10) + c.characteristics.ВС.super,
    );
  });
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
  it('Цепной меч: бСЛ + Сверх (ruling 74), ½ бСЛ rounded up (ruling 77), armour loses ББ first', () => {
    const b = started((x) => {
      placeActor(x, 'pak', 6.5, 10.5);
      takeWeapon(x, { id: 'sword', actor: 'kelus-drakar', weapon: 'kelus-drakar:1' });
    });
    const r = attack(
      b,
      shot({ id: 'cut', weapon: 'kelus-drakar:1' }),
      fixedDice('100:35,10:3,10:7,10:3,10:7'),
    );
    expect(r.status).toBe('RESOLVED');
    const hit = (
      r as { result: { hits: { total: number; armour: number; finalDamage: number }[] } }
    ).result.hits[0]!;
    // d10 3 → Разрывное (from Цепное) re-roll 7; +5 +бСЛ 5 +⌈5/2⌉ 3 = 20; torso 7 − 2 = 5.
    expect(hit).toMatchObject({ total: 20, armour: 5, finalDamage: 13 });
    expect(getEngine(b).armorLoss).toEqual({ 'pak:torso': 2 });
    expect(actorStatus(b, 'pak').wounds).toBe(20);
  });
  it('a burst fires exactly the weapon rate (ruling 78): short burst 3 = 3 shots × Заряд 7', () => {
    const b = started();
    const r = attack(
      b,
      shot({ id: 'burst', mode: 'short-burst', shots: 1, answers: { 'cover:pak': 0 } }),
      fixedDice('100:90,100:10'),
    );
    expect((r as { result: { attack: { shotsFired: number } } }).result.attack.shotsFired).toBe(3);
    expect(b.ammo['kelus-drakar:0']).toBe(60 - 21);
  });
  it('a single shot is one shot', () => {
    const b = started();
    const r = attack(b, shot({ id: 'one', mode: 'single' }), fixedDice('100:90'));
    expect((r as { result: { attack: { shotsFired: number } } }).result.attack.shotsFired).toBe(1);
    expect(b.ammo['kelus-drakar:0']).toBe(53);
  });
  it('a hit to the eyes asks the GM for the ОБ (ruling 75)', () => {
    const b = started((x) => {
      placeActor(x, 'pak', 6.5, 10.5);
      takeWeapon(x, { id: 'sword', actor: 'kelus-drakar', weapon: 'kelus-drakar:1' });
    });
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

describe('Heavy weapon on a support («Бой» A55)', () => {
  it('fires single shots only until braced; bracing costs 1 ОД; moving takes it off', async () => {
    const { matchWeaponByName } = await import('./arsenal');
    const stubber = matchWeaponByName('Тяжелый стаббер')!;
    const gunner = {
      ...emptyCharacter('gunner', 'Пулемётчик'),
      weapons: [{ name: stubber.name, ref: stubber.id }],
    };
    const b = createBattle([
      { character: gunner, side: 'a', at: { x: 5.5, y: 10.5 }, id: 'gunner' },
      { character: characterFromProfile('pak'), side: 'b', at: { x: 15.5, y: 10.5 }, id: 'pak' },
    ]);
    startCombat(b, fixedDice('10:9,10:2'));
    const burst = (id: string) =>
      shot({
        id,
        actor: 'gunner',
        weapon: 'gunner:0',
        mode: 'short-burst',
        answers: { 'cover:pak': 0 },
      });
    expect(() => attack(b, burst('b1'), fixedDice('100:90'))).toThrow(/Unbraced/);
    expect(String((b.log.at(-1)!.detail as { reason: string }).reason)).toMatch(/без опоры/);
    expect(weaponBraced(b, 'gunner:0')).toBe(false);
    braceWeapon(b, { id: 'brace', actor: 'gunner', weapon: 'gunner:0' });
    expect(weaponBraced(b, 'gunner:0')).toBe(true);
    expect(turnInfo(b).od).toBe(1);
    const r = attack(b, burst('b2'), fixedDice('100:90,100:10'));
    expect((r as { result: { attack: { shotsFired: number } } }).result.attack.shotsFired).toBe(
      stubber.rof!.short!,
    );
    nextTurn(b, fixedDice(''));
    nextTurn(b, fixedDice(''));
    moveActor(b, { id: 'step', actor: 'gunner', mode: 'half-move', to: { x: 6.5, y: 10.5 } });
    expect(weaponBraced(b, 'gunner:0')).toBe(false);
  });
});

describe('Talent «Бугрящиеся бицепсы»', () => {
  it('fires heavy bursts from the hands without bracing and without −30', async () => {
    const { matchWeaponByName } = await import('./arsenal');
    const stubber = matchWeaponByName('Тяжелый стаббер')!;
    const gunner = {
      ...emptyCharacter('gunner', 'Оператор'),
      talents: ['Бугрящиеся бицепсы'],
      weapons: [{ name: stubber.name, ref: stubber.id }],
    };
    const b = createBattle([
      { character: gunner, side: 'a', at: { x: 5.5, y: 10.5 }, id: 'gunner' },
      { character: characterFromProfile('pak'), side: 'b', at: { x: 15.5, y: 10.5 }, id: 'pak' },
    ]);
    startCombat(b, fixedDice('10:9,10:2'));
    expect(heavyFromHands(b, 'gunner')).toBe(true);
    const r = attack(
      b,
      shot({
        id: 'hands',
        actor: 'gunner',
        weapon: 'gunner:0',
        mode: 'short-burst',
        answers: { 'cover:pak': 0 },
      }),
      fixedDice('100:90,100:10'),
    );
    const res = (
      r as { result: { attack: { shotsFired: number; check: { modifiers: { id: string }[] } } } }
    ).result.attack;
    expect(res.shotsFired).toBe(stubber.rof!.short!);
    expect(res.check.modifiers.some((m) => m.id === 'ranged:unbraced-heavy')).toBe(false);
  });
});

describe('Old talent names (ruling 80)', () => {
  it('Келус «Бугрящиеся мышцы» counts as «Бугрящиеся бицепсы»', () => {
    const b = createBattle();
    expect(b.roster['kelus-drakar']!.character.talents).toContain('Бугрящиеся мышцы');
    expect(heavyFromHands(b, 'kelus-drakar')).toBe(true);
    startCombat(b, fixedDice('10:9,10:2'));
    expect(getEngine(b).wounds.combat.actors['kelus-drakar']!.talents).toContain(
      'Бугрящиеся бицепсы',
    );
  });
});

describe('GM view: what every die was rolled for', () => {
  it('labels the attack test, hit side, damage and wound consequences', () => {
    const b = createBattle();
    startCombat(b, fixedDice('10:9,10:2'));
    attack(
      b,
      shot({ id: 'gm', mode: 'short-burst', answers: { 'cover:pak': 0 } }),
      fixedDice('100:15,2:2,100:10,10:8,2:1,100:66,10:8,2:2,100:31,10:1'),
    );
    const d = b.log.at(-1)!.detail as { rollPurposes: string[] };
    expect(d.rollPurposes).toEqual([
      'тест попадания',
      'сторона попадания',
      'тест подавления (СВ)',
      'урон',
      'сторона (последствие ранения)',
      'тест последствия ранения',
      'урон',
      'сторона (последствие ранения)',
      'тест последствия ранения',
      'урон',
    ]);
  });
});

describe('Reactions of the target', () => {
  it('Dodge (ЛВ + «Уклонение») cancels hits by its degrees', () => {
    const b = createBattle();
    startCombat(b, fixedDice('10:9,10:2'));
    const r = attack(
      b,
      shot({ id: 'dodge', mode: 'short-burst', defense: 'DODGE', answers: { 'cover:pak': 0 } }),
      fixedDice('100:15,100:10,100:10'),
    );
    const res = (r as { result: { reaction: { cancelledHits: number }; hits: unknown[] } }).result;
    expect(res.reaction.cancelledHits).toBe(3);
    expect(res.hits).toEqual([]);
    expect(actorStatus(b, 'pak').wounds).toBe(33);
    expect(turnInfo(b).reactions.pak).toBe(0);
  });
  it('Parry needs a melee weapon in hand of the target', () => {
    const b = started((x) => {
      placeActor(x, 'pak', 6.5, 10.5);
      takeWeapon(x, { id: 'sword', actor: 'kelus-drakar', weapon: 'kelus-drakar:1' });
    });
    expect(() =>
      attack(b, shot({ id: 'p', weapon: 'kelus-drakar:1', defense: 'PARRY' }), fixedDice('100:35')),
    ).toThrow(/Парировать нечем/);
  });
  it('Parry with a chain sword (НР + «Парирование», Сбалансированное +10)', async () => {
    const { matchWeaponByName } = await import('./arsenal');
    const sword = matchWeaponByName('Цепной меч')!;
    const duelist = {
      ...emptyCharacter('duelist', 'Дуэлянт'),
      talents: ['Владение оружием (Цепное)'],
      weapons: [{ name: sword.name, ref: sword.id }],
    };
    const b = createBattle([
      { character: duelist, side: 'a', at: { x: 5.5, y: 10.5 }, id: 'duelist' },
      {
        character: characterFromProfile('kelus-drakar'),
        side: 'b',
        at: { x: 6.5, y: 10.5 },
        id: 'kelus-drakar',
      },
    ]);
    takeWeapon(b, { id: 'sword', actor: 'kelus-drakar', weapon: 'kelus-drakar:1' });
    startCombat(b, fixedDice('10:9,10:2'));
    // Келус has «Парирование» +10: НР 40 + 10 + Сбалансированное 10 = 60.
    const r = attack(
      b,
      shot({
        id: 'cut',
        actor: 'duelist',
        target: 'kelus-drakar',
        weapon: 'duelist:0',
        defense: 'PARRY',
      }),
      fixedDice('100:20,100:30'),
    );
    const res = (
      r as {
        result: {
          reaction: { check: { target: number; outcome: string }; cancelledHits: number };
          hits: unknown[];
        };
      }
    ).result;
    expect(res.reaction.check.target).toBe(60);
    expect(res.reaction.cancelledHits).toBe(1);
    expect(res.hits).toEqual([]);
    // The other way round the duelist has no «Парирование»: the GM is asked for the penalty.
    nextTurn(b, fixedDice(''));
    const back = attack(
      b,
      shot({ id: 'back', target: 'duelist', weapon: 'kelus-drakar:1', defense: 'PARRY' }),
      fixedDice('100:20'),
    );
    expect(back.status).toBe('CONTEXT_REQUIRED');
    expect(turnInfo(b).pending?.question?.key).toBe('untrained:Парирование');
    // The question comes before any die: the attack test is rolled after the answer.
    const done = resumeAttack(b, fixedDice('100:20,100:15'), { 'untrained:Парирование': -20 });
    const parry = (done as { result: { reaction: { check: { target: number } } } }).result.reaction;
    // НР 30 − 20 + 10 = 20.
    expect(parry.check.target).toBe(20);
  });
});

describe('Counterattack after a parry', () => {
  const duel = async (kelusTalents: string[] = []) => {
    const { matchWeaponByName } = await import('./arsenal');
    const sword = matchWeaponByName('Цепной меч')!;
    const duelist = {
      ...emptyCharacter('duelist', 'Дуэлянт'),
      talents: ['Владение оружием (Цепное)'],
      weapons: [{ name: sword.name, ref: sword.id }],
    };
    const kelus = characterFromProfile('kelus-drakar');
    const b = createBattle([
      { character: duelist, side: 'a', at: { x: 5.5, y: 10.5 }, id: 'duelist' },
      {
        character: { ...kelus, talents: [...kelus.talents, ...kelusTalents] },
        side: 'b',
        at: { x: 6.5, y: 10.5 },
        id: 'kelus-drakar',
      },
    ]);
    takeWeapon(b, { id: 'sword', actor: 'kelus-drakar', weapon: 'kelus-drakar:1' });
    startCombat(b, fixedDice('10:9,10:2'));
    // Parry 55 against 60: success with fewer than 3 degrees.
    attack(
      b,
      shot({
        id: 'cut',
        actor: 'duelist',
        target: 'kelus-drakar',
        weapon: 'duelist:0',
        defense: 'PARRY',
      }),
      fixedDice('100:20,100:55'),
    );
    return b;
  };
  it('the counterattack is offered only right after the parry', async () => {
    const b = await duel(['Контратака']);
    expect(counterattacks(b)).toHaveLength(1);
    turnAction(b, { id: 'aim', actor: 'duelist', type: 'quick-aim' });
    expect(counterattacks(b)).toEqual([]);
  });
  it('a parry with 1–2 degrees gives no counterattack without the talent', async () => {
    expect(counterattacks(await duel())).toEqual([]);
  });
  it('«Контратака»: 1 degree is enough; the free blow goes out of turn at the attacker', async () => {
    const b = await duel(['Контратака']);
    const [c] = counterattacks(b);
    expect(c).toMatchObject({ actor: 'kelus-drakar', target: 'duelist', weapon: 'kelus-drakar:1' });
    expect(turnInfo(b).active).toBe('duelist');
    const r = attack(
      b,
      shot({
        id: 'counter',
        actor: 'kelus-drakar',
        target: 'duelist',
        weapon: c!.weapon!,
        counter: c!.id,
      }),
      // 35 — a torso hit; then damage and the duelist's checks.
      { roll: (sides: number) => (sides === 100 ? 35 : 5) },
    );
    expect(r.status).toBe('RESOLVED');
    expect(counterattacks(b)).toEqual([]);
    expect(turnInfo(b).active).toBe('duelist');
  });
});

describe('Two weapons (rulings 105, 106)', () => {
  const gunslinger = async (talents: string[] = [], second = 'Стаб-пистолет') => {
    const { matchWeaponByName } = await import('./arsenal');
    const a = matchWeaponByName('Лазпистолет')!;
    const c = matchWeaponByName(second)!;
    const pistolero = {
      ...emptyCharacter('gun', 'Стрелок'),
      characteristics: { ...emptyCharacter('x').characteristics, НС: { value: 50, super: 0 } },
      talents: ['Владение оружием (Лаз)', 'Владение оружием (Стаб)', ...talents],
      weapons: [
        { name: a.name, ref: a.id },
        { name: c.name, ref: c.id },
      ],
    };
    const b = createBattle([
      { character: pistolero, side: 'a', at: { x: 5.5, y: 10.5 }, id: 'gun' },
      { character: characterFromProfile('pak'), side: 'b', at: { x: 12.5, y: 10.5 }, id: 'pak' },
    ]);
    return b;
  };
  const modsOf = (r: unknown) =>
    (r as { result: { attack: { check: { modifiers: { id: string; value: number }[] } } } }).result
      .attack.check.modifiers;
  const fire = (b: Battle) =>
    attack(
      b,
      shot({
        id: 'pair',
        actor: 'gun',
        weapon: 'gun:0',
        second: 'gun:1',
        answers: { 'cover:pak': 0, 'second:cover:pak': 0 },
      }),
      { roll: (sides: number) => (sides === 100 ? 95 : 5) },
    );
  it('the second pistol goes into the other hand; both shoot for one action with −30 each', async () => {
    const b = await gunslinger();
    takeWeapon(b, { id: 't2', actor: 'gun', weapon: 'gun:1', keep: 'gun:0' });
    expect(weaponInHand(b, 'gun:0')).toBe(true);
    expect(weaponInHand(b, 'gun:1')).toBe(true);
    startCombat(b, fixedDice('10:9,10:2'));
    const r = fire(b);
    expect(r.status).toBe('RESOLVED');
    expect(modsOf(r).find((m) => m.id === 'ranged:two-weapons')?.value).toBe(-30);
    const second = (
      r as {
        result: { second: { attack: { check: { modifiers: { id: string; value: number }[] } } } };
      }
    ).result.second;
    expect(second.attack.check.modifiers.find((m) => m.id === 'ranged:two-weapons')?.value).toBe(
      -30,
    );
  });
  it('«Амбидекстрия»: −20; «Парное оружие (НС)»: no penalty', async () => {
    for (const [talent, value] of [
      ['Амбидекстрия', -20],
      ['Парное оружие (НС)', undefined],
    ] as const) {
      const b = await gunslinger([talent]);
      takeWeapon(b, { id: 't2', actor: 'gun', weapon: 'gun:1', keep: 'gun:0' });
      startCombat(b, fixedDice('10:9,10:2'));
      expect(modsOf(fire(b)).find((m) => m.id === 'ranged:two-weapons')?.value).toBe(value);
    }
  });
  it('«Меткий выстрел»: the called-attack penalty is 10 lower (ruling 122)', async () => {
    const b = await gunslinger(['Меткий выстрел']);
    startCombat(b, fixedDice('10:9,10:2'));
    const r = attack(
      b,
      shot({ id: 'aimed', actor: 'gun', weapon: 'gun:0', calledLocation: 'Torso' }),
      { roll: (sides: number) => (sides === 100 ? 95 : 5) },
    );
    expect(modsOf(r).find((m) => m.id === 'aimed:talent:Меткий выстрел')?.value).toBe(10);
  });
  it('«Знаток Мельта-оружия»: optimal range + НС × 2 m (ruling 124)', async () => {
    const { matchWeaponByName } = await import('./arsenal');
    const melta = matchWeaponByName('Мельтган')!;
    const b = createBattle([
      {
        character: {
          ...emptyCharacter('m', 'Мельтист'),
          characteristics: { ...emptyCharacter('x').characteristics, НС: { value: 45, super: 0 } },
          talents: ['Знаток Мельта-оружия'],
          weapons: [{ name: melta.name, ref: melta.id }],
        },
        side: 'a',
        at: { x: 5.5, y: 10.5 },
        id: 'm',
      },
      { character: characterFromProfile('pak'), side: 'b', at: { x: 12.5, y: 10.5 }, id: 'pak' },
    ]);
    expect(getEngine(b).wounds.combat.weapons['m:0']!.template.profile.optimalRange).toBe(
      melta.range.meters! + 90,
    );
  });
  it('«Двойной выстрел»: the first shot hit — the second gets +20 (ruling 127)', async () => {
    const b = await gunslinger(['Двойной выстрел']);
    takeWeapon(b, { id: 't2', actor: 'gun', weapon: 'gun:1', keep: 'gun:0' });
    startCombat(b, fixedDice('10:9,10:2'));
    const seq = [35];
    let n = 0;
    const r = attack(
      b,
      shot({
        id: 'pair',
        actor: 'gun',
        weapon: 'gun:0',
        second: 'gun:1',
        defense: 'DECLINE',
        answers: { 'cover:pak': 0, 'second:cover:pak': 0 },
      }),
      { roll: (sides: number) => (sides === 100 ? (seq[n++] ?? 95) : 5) },
    );
    const second = (
      r as {
        result: { second: { attack: { check: { modifiers: { id: string; value: number }[] } } } };
      }
    ).result.second;
    expect(
      second.attack.check.modifiers.find((m) => m.id === 'pair:2:talent:Двойной выстрел')?.value,
    ).toBe(20);
  });
  it('«Знаток Лаз-оружия»: the dodge gets −5 × degrees of the hit, at most −30', async () => {
    const b = await gunslinger(['Знаток Лаз-оружия']);
    startCombat(b, fixedDice('10:9,10:2'));
    const r = attack(
      b,
      shot({
        id: 'las',
        actor: 'gun',
        weapon: 'gun:0',
        defense: 'DODGE',
        answers: { 'cover:pak': 0 },
      }),
      // Attack 05, dodge 50, later checks 99.
      ((seq: number[]) => {
        let n = 0;
        return { roll: (sides: number) => (sides === 100 ? (seq[n++] ?? 99) : 5) };
      })([5, 50]),
    );
    const res = (
      r as {
        result: {
          attack: { check: { totalDegrees: number } };
          reaction: { check: { modifiers: { id: string; value: number }[] } };
        };
      }
    ).result;
    const deg = res.attack.check.totalDegrees;
    expect(res.reaction.check.modifiers.find((m) => m.id === 'las:las-expert')?.value).toBe(
      -Math.min(30, 5 * deg),
    );
  });
  it('a two-handed weapon cannot be one of two weapons', async () => {
    const b = await gunslinger([], 'Лазган');
    expect(() =>
      takeWeapon(b, { id: 't2', actor: 'gun', weapon: 'gun:1', keep: 'gun:0' }),
    ).not.toThrow();
    const h = await gunslinger([], 'Тяжелый болтер');
    expect(() => takeWeapon(h, { id: 't2', actor: 'gun', weapon: 'gun:1', keep: 'gun:0' })).toThrow(
      /Двуручное/,
    );
  });
});

describe('«Разоружение» (rulings 107, 108)', () => {
  const setup = async (talents = ['Разоружение'], nr = 30) => {
    const { matchWeaponByName } = await import('./arsenal');
    const sword = matchWeaponByName('Цепной меч')!;
    const duelist = {
      ...emptyCharacter('duelist', 'Дуэлянт'),
      talents: ['Владение оружием (Цепное)', ...talents],
      characteristics: { ...emptyCharacter('x').characteristics, НР: { value: nr, super: 0 } },
      weapons: [{ name: sword.name, ref: sword.id }],
    };
    const b = createBattle([
      { character: duelist, side: 'a', at: { x: 5.5, y: 10.5 }, id: 'duelist' },
      {
        character: characterFromProfile('kelus-drakar'),
        side: 'b',
        at: { x: 6.5, y: 10.5 },
        id: 'kelus-drakar',
      },
    ]);
    takeWeapon(b, { id: 'sword', actor: 'kelus-drakar', weapon: 'kelus-drakar:1' });
    startCombat(b, fixedDice('10:9,10:2'));
    return b;
  };
  it('5+ degrees and a free hand: the attacker takes the weapon; it can be knocked back (ruling 114)', async () => {
    // НР 80: a roll of 01 gives 5+ degrees.
    const b = await setup(['Разоружение'], 80);
    const r = disarm(
      b,
      { id: 'd5', actor: 'duelist', target: 'kelus-drakar', weapon: 'kelus-drakar:1' },
      fixedDice('100:1,100:99,10:3'),
    );
    expect(r.degrees).toBeGreaterThanOrEqual(5);
    expect(pendingLoose(b)?.taker).toBe('duelist');
    takeDisarmed(b);
    expect(b.taken?.['kelus-drakar:1']).toBe('duelist');
    expect(weaponInHand(b, 'kelus-drakar:1')).toBe(true);
    expect(weaponInHand(b, 'duelist:0')).toBe(true);
    const replayed = importReplay(JSON.parse(JSON.stringify(exportReplay(b))));
    expect(replayed.taken?.['kelus-drakar:1']).toBe('duelist');
  });
  it('needs the talent', async () => {
    const b = await setup([]);
    expect(() =>
      disarm(b, { id: 'd', actor: 'duelist', target: 'kelus-drakar', weapon: 'kelus-drakar:1' }),
    ).toThrow();
  });
  it('a won opposed НР knocks the weapon out; it lies on the map and is picked up next to it', async () => {
    const b = await setup();
    // Attacker 05, defender 99; the weapon flies 4 m.
    const r = disarm(
      b,
      { id: 'd', actor: 'duelist', target: 'kelus-drakar', weapon: 'kelus-drakar:1' },
      fixedDice('100:5,100:99,10:4'),
    );
    expect(r).toMatchObject({ disarmed: true, distance: 4 });
    expect(weaponInHand(b, 'kelus-drakar:1')).toBe(false);
    expect(turnInfo(b).od).toBe(1);
    expect(() => placeLoose(b, { x: 12.5, y: 10.5 })).toThrow(/не дальше 4 м/);
    placeLoose(b, { x: 9.5, y: 10.5 });
    expect(b.loose?.['kelus-drakar:1']).toEqual({ x: 9.5, y: 10.5 });
    nextTurn(b, fixedDice(''));
    expect(() =>
      pickUpWeapon(b, { id: 'far', actor: 'kelus-drakar', weapon: 'kelus-drakar:1' }),
    ).toThrow(/подойдите/);
    // Next to it the weapon is picked up and leaves the map.
    const c = await setup();
    disarm(
      c,
      { id: 'd', actor: 'duelist', target: 'kelus-drakar', weapon: 'kelus-drakar:1' },
      fixedDice('100:5,100:99,10:1'),
    );
    placeLoose(c, { x: 7.5, y: 10.5 });
    nextTurn(c, fixedDice(''));
    pickUpWeapon(c, { id: 'near', actor: 'kelus-drakar', weapon: 'kelus-drakar:1' });
    expect(weaponInHand(c, 'kelus-drakar:1')).toBe(true);
    expect(c.loose?.['kelus-drakar:1']).toBeUndefined();
    const replayed = importReplay(JSON.parse(JSON.stringify(exportReplay(b))));
    expect(replayed.loose?.['kelus-drakar:1']).toEqual({ x: 9.5, y: 10.5 });
  });
});

describe('Turn actions', () => {
  it('quick aim (1 ОД) adds +10 to the next shot of the turn', () => {
    const b = started();
    turnAction(b, { id: 'aim', actor: 'kelus-drakar', type: 'quick-aim' });
    expect(turnInfo(b).od).toBe(1);
    const r = attack(b, shot({ id: 'aimed' }), fixedDice('100:90'));
    const check = (
      r as { result: { attack: { check: { modifiers: { id: string; value: number }[] } } } }
    ).result.attack.check;
    expect(check.modifiers.find((m) => m.id === 'ranged:aim')?.value).toBe(10);
  });
  it('reload refills the magazine; «Быстрая перезарядка» of Келус makes it 1 ОД (ruling 81)', () => {
    const b = started();
    attack(b, shot({ id: 's1' }), fixedDice('100:90'));
    expect(b.ammo['kelus-drakar:0']).toBe(53);
    expect(reloadCost(b, 'kelus-drakar', 'kelus-drakar:0')).toBe('1 ОД');
    turnAction(b, {
      id: 'reload-1',
      actor: 'kelus-drakar',
      type: 'reload',
      weapon: 'kelus-drakar:0',
    });
    expect(b.ammo['kelus-drakar:0']).toBe(60);
    expect(turnInfo(b).od).toBe(0);
  });
  it('without the talent a 2-ОД reload started with 1 ОД left continues next turn', async () => {
    const { matchWeaponByName } = await import('./arsenal');
    const gun = matchWeaponByName('Хот-шот лазган')!;
    const trooper = {
      ...emptyCharacter('trooper', 'Боец'),
      weapons: [{ name: gun.name, ref: gun.id }],
    };
    const b = createBattle([
      { character: trooper, side: 'a', at: { x: 5.5, y: 10.5 }, id: 'trooper' },
      { character: characterFromProfile('pak'), side: 'b', at: { x: 15.5, y: 10.5 }, id: 'pak' },
    ]);
    startCombat(b, fixedDice('10:9,10:2'));
    attack(b, shot({ id: 's1', actor: 'trooper', weapon: 'trooper:0' }), fixedDice('100:90'));
    turnAction(b, { id: 'reload-a', actor: 'trooper', type: 'reload', weapon: 'trooper:0' });
    expect(weaponState(b, 'trooper:0').reloading).toBe('1 из 2 ОД');
    expect(b.ammo['trooper:0']).toBe(53);
    nextTurn(b, fixedDice(''));
    nextTurn(b, fixedDice(''));
    turnAction(b, { id: 'reload-b', actor: 'trooper', type: 'reload', weapon: 'trooper:0' });
    expect(b.ammo['trooper:0']).toBe(60);
    expect(weaponState(b, 'trooper:0').reloading).toBeNull();
  });
  it('a weapon not in hand cannot attack; «Быстрое выхватывание» of Келус takes it for СД', () => {
    const b = started((x) => placeActor(x, 'pak', 6.5, 10.5));
    expect(weaponInHand(b, 'kelus-drakar:0')).toBe(true);
    expect(weaponInHand(b, 'kelus-drakar:1')).toBe(false);
    expect(() =>
      attack(b, shot({ id: 'no-sword', weapon: 'kelus-drakar:1' }), fixedDice('100:35')),
    ).toThrow();
    expect(readyCost(b, 'kelus-drakar')).toBe('СД');
    takeWeapon(b, { id: 'swap', actor: 'kelus-drakar', weapon: 'kelus-drakar:1' });
    expect(turnInfo(b).od).toBe(2);
    expect(weaponInHand(b, 'kelus-drakar:1')).toBe(true);
    expect(weaponInHand(b, 'kelus-drakar:0')).toBe(false);
    // The single Free Action of the turn is spent: dropping now is refused.
    expect(() =>
      dropWeapon(b, { id: 'drop', actor: 'kelus-drakar', weapon: 'kelus-drakar:1' }),
    ).toThrow(/Free Action/);
  });
  it('without the talent changing weapons costs 1 ОД; dropping is a Free Action (ruling 81)', async () => {
    const { matchWeaponByName } = await import('./arsenal');
    const gun = matchWeaponByName('Хот-шот лазган')!;
    const sword = matchWeaponByName('Цепной меч')!;
    const trooper = {
      ...emptyCharacter('trooper', 'Боец'),
      weapons: [
        { name: gun.name, ref: gun.id },
        { name: sword.name, ref: sword.id },
      ],
    };
    const b = createBattle([
      { character: trooper, side: 'a', at: { x: 5.5, y: 10.5 }, id: 'trooper' },
      { character: characterFromProfile('pak'), side: 'b', at: { x: 15.5, y: 10.5 }, id: 'pak' },
    ]);
    startCombat(b, fixedDice('10:9,10:2'));
    expect(readyCost(b, 'trooper')).toBe('1 ОД');
    takeWeapon(b, { id: 'swap', actor: 'trooper', weapon: 'trooper:1' });
    expect(turnInfo(b).od).toBe(1);
    dropWeapon(b, { id: 'drop', actor: 'trooper', weapon: 'trooper:1' });
    expect(turnInfo(b).od).toBe(1);
    expect(weaponInHand(b, 'trooper:1')).toBe(false);
    const replayed = importReplay(JSON.parse(JSON.stringify(exportReplay(b))));
    expect(weaponInHand(replayed, 'trooper:1')).toBe(false);
  });
  it('a jam (96+) is cleared with 2 ОД and an НС test', () => {
    const b = started();
    attack(b, shot({ id: 'jam' }), fixedDice('100:97'));
    expect(weaponState(b, 'kelus-drakar:0').jammed).toBe(true);
    nextTurn(b, fixedDice(''));
    nextTurn(b, fixedDice(''));
    turnAction(
      b,
      { id: 'clear', actor: 'kelus-drakar', type: 'clear-malfunction', weapon: 'kelus-drakar:0' },
      fixedDice('100:20'),
    );
    expect(weaponState(b, 'kelus-drakar:0').jammed).toBe(false);
    const replayed = importReplay(JSON.parse(JSON.stringify(exportReplay(b))));
    expect(weaponState(replayed, 'kelus-drakar:0').jammed).toBe(false);
  });
});

describe('«Избирательная атака» (2 ОД, «Бой» A52)', () => {
  it('a called shot hits the chosen location with its modifier', () => {
    const b = started();
    const r = attack(
      b,
      shot({ id: 'called', calledLocation: 'Head', mode: 'short-burst' }),
      fixedDice('100:30,10:5,100:50'),
    );
    const res = (
      r as {
        result: {
          attack: { shotsFired: number; check: { modifiers: { id: string; value: number }[] } };
          hits: { location: string }[];
        };
      }
    ).result;
    expect(res.attack.shotsFired).toBe(1);
    expect(res.attack.check.modifiers.find((m) => m.id === 'ranged:called')?.value).toBe(-20);
    expect(res.hits[0]?.location).toBe('Head');
    expect(turnInfo(b).od).toBe(0);
  });
  it('a called blow in melee', () => {
    const b = started((x) => {
      placeActor(x, 'pak', 6.5, 10.5);
      takeWeapon(x, { id: 'sword', actor: 'kelus-drakar', weapon: 'kelus-drakar:1' });
    });
    const r = attack(b, shot({ id: 'leg', weapon: 'kelus-drakar:1', calledLocation: 'Left Leg' }), {
      roll: (sides: number) => (sides === 100 ? 20 : 5),
    });
    expect(r.status).toBe('RESOLVED');
    const res = (r as { result: { hits: { location: string }[] } }).result;
    expect(res.hits[0]?.location).toBe('Left Leg');
  });
});

describe('Picking a weapon up (ruling 82)', () => {
  const trooperBattle = async (sling: boolean) => {
    const { matchWeaponByName } = await import('./arsenal');
    const gun = matchWeaponByName('Хот-шот лазган')!;
    const trooper = {
      ...emptyCharacter('trooper', 'Боец'),
      weapons: [{ name: gun.name, ref: gun.id, ...(sling ? { sling: true } : {}) }],
    };
    const b = createBattle([
      { character: trooper, side: 'a', at: { x: 5.5, y: 10.5 }, id: 'trooper' },
      { character: characterFromProfile('pak'), side: 'b', at: { x: 15.5, y: 10.5 }, id: 'pak' },
    ]);
    startCombat(b, fixedDice('10:9,10:2'));
    return b;
  };
  it('dropped on the floor: picking up costs 1 ОД after the Free Action went on dropping', async () => {
    const b = await trooperBattle(false);
    dropWeapon(b, { id: 'drop', actor: 'trooper', weapon: 'trooper:0' });
    expect(weaponDropped(b, 'trooper:0')).toBe(true);
    expect(pickUpCost(b)).toBe('1 ОД');
    expect(() => takeWeapon(b, { id: 'take', actor: 'trooper', weapon: 'trooper:0' })).toThrow();
    pickUpWeapon(b, { id: 'up', actor: 'trooper', weapon: 'trooper:0' });
    expect(weaponInHand(b, 'trooper:0')).toBe(true);
    expect(turnInfo(b).od).toBe(1);
  });
  it('on a sling the weapon hangs; next turn it is taken back for the Free Action', async () => {
    const b = await trooperBattle(true);
    dropWeapon(b, { id: 'let-go', actor: 'trooper', weapon: 'trooper:0' });
    expect(weaponHanging(b, 'trooper:0')).toBe(true);
    expect(weaponDropped(b, 'trooper:0')).toBe(false);
    nextTurn(b, fixedDice(''));
    nextTurn(b, fixedDice(''));
    expect(pickUpCost(b)).toBe('СД');
    pickUpWeapon(b, { id: 'back', actor: 'trooper', weapon: 'trooper:0' });
    expect(weaponInHand(b, 'trooper:0')).toBe(true);
    expect(turnInfo(b).od).toBe(2);
    const replayed = importReplay(JSON.parse(JSON.stringify(exportReplay(b))));
    expect(weaponInHand(replayed, 'trooper:0')).toBe(true);
  });
});

describe('Suppression («Бой» A12–A15)', () => {
  it('a single shot with 3+ degrees suppresses the target; next turn it has 1 ОД', () => {
    const b = started();
    // Attack roll 01 gives 3+ degrees; every later d100 (the СВ test) is 99 — a failure.
    const r = attack(b, shot({ id: 'sup', answers: { 'cover:pak': 0 } }), {
      roll: (sides: number) => (sides === 100 ? (supRolls++ === 0 ? 1 : 99) : 5),
    });
    expect(r.status).toBe('RESOLVED');
    const sup = (r as { result: { suppression: { targets: { status: string }[] } } }).result
      .suppression;
    expect(sup.targets[0]?.status).toBe('SUPPRESSED');
    nextTurn(b, fixedDice(''));
    expect(turnInfo(b).active).toBe('pak');
    expect(turnInfo(b).od).toBe(1);
  });
  const withTalent = (talent: string) =>
    started((b) => {
      const c = b.roster.pak!.character;
      b.roster.pak = { ...b.roster.pak!, character: { ...c, talents: [...c.talents, talent] } };
    });
  it('«Стальные нервы»: a failed suppression test is rerolled once', () => {
    const b = withTalent('Стальные нервы');
    let n = 0;
    // Attack 01; the СВ test fails (99), the reroll passes (01).
    const r = attack(b, shot({ id: 'nerve', answers: { 'cover:pak': 0 } }), {
      roll: (sides: number) => (sides === 100 ? ([1, 99, 1][n++] ?? 99) : 5),
    });
    const sup = (r as { result: { suppression: { targets: { status: string }[] } } }).result
      .suppression;
    expect(sup.targets[0]?.status).toBe('PASSED');
  });
  it('«Бесстрашие»: immune to suppression', () => {
    const b = withTalent('Бесстрашие');
    const r = attack(b, shot({ id: 'fear', answers: { 'cover:pak': 0 } }), {
      roll: (sides: number) => (sides === 100 ? 1 : 5),
    });
    const sup = (r as { result: { suppression: { targets: { status: string }[] } } }).result
      .suppression;
    expect(sup.targets.every((t) => t.status === 'NOT_AFFECTED')).toBe(true);
  });
});
let supRolls = 0;

describe('The target decides its reaction after being hit', () => {
  it('a hit asks the target; the attack roll is kept and the dodge follows', () => {
    const b = started();
    const cmd = { ...shot({ id: 'ask', mode: 'single' as const }) };
    delete (cmd as { defense?: unknown }).defense;
    const first = attack(b, cmd, fixedDice('100:15'));
    expect(first.status).toBe('CONTEXT_REQUIRED');
    const q = turnInfo(b).pending?.question;
    expect(q?.key).toBe('reaction');
    expect(q?.options?.map((o) => o.label)).toEqual(['Без реакции', 'Уклонение']);
    // Dodge 10 succeeds: the shot is cancelled, the attack roll stays 15.
    const r = resumeAttack(b, fixedDice('100:10,100:10'), { reaction: 1, 'cover:pak': 0 });
    const res = (
      r as {
        result: { attack: { check: { rawRoll: number } }; reaction: { cancelledHits: number } };
      }
    ).result;
    expect(res.attack.check.rawRoll).toBe(15);
    expect(res.reaction.cancelledHits).toBe(1);
  });
  it('a miss asks nothing', () => {
    const b = started();
    const cmd = { ...shot({ id: 'miss' }) };
    delete (cmd as { defense?: unknown }).defense;
    expect(attack(b, cmd, fixedDice('100:95')).status).toBe('RESOLVED');
  });
});

describe('Wounds down to 0 (ruling 83)', () => {
  it('the target falls into Agony for 2 × бВН rounds; wounds show 0', () => {
    const b = started();
    const hp = b.hp.pak!;
    const st = getEngine(b);
    // Put Пак one wound from 0, then any damaging shot ends in Agony.
    st.wounds = {
      ...st.wounds,
      actors: {
        ...st.wounds.actors,
        pak: { ...st.wounds.actors.pak!, damageTaken: hp - 1 },
      },
    };
    attack(b, shot({ id: 'last' }), { roll: (sides: number) => (sides === 100 ? 45 : 5) });
    expect(b.hp.pak).toBe(0);
    expect(actorStatus(b, 'pak').life).toBe('AGONY');
  });
});

describe('«Владение оружием» (ruling 84)', () => {
  it('reads kinds from the talent and the Arsenal sheet; without it −30', async () => {
    const { proficientKinds, weaponKindName } = await import('./proficiency');
    const { matchWeaponByName } = await import('./arsenal');
    expect([
      ...proficientKinds(['Владение оружием (Стаб, Лаз, Примитив, Плазма, Болт, Цепное)']),
    ]).toEqual(expect.arrayContaining(['стаб', 'лаз', 'примитив', 'плазма', 'болт', 'цепное']));
    expect(weaponKindName(matchWeaponByName('Хот-шот лазган')!)).toBe('Лаз');
    expect(weaponKindName(matchWeaponByName('Цепной меч')!)).toBe('Цепное');
    const gun = matchWeaponByName('Хот-шот лазган')!;
    const rookie = {
      ...emptyCharacter('rookie', 'Новобранец'),
      weapons: [{ name: gun.name, ref: gun.id }],
    };
    const b = createBattle([
      { character: rookie, side: 'a', at: { x: 5.5, y: 10.5 }, id: 'rookie' },
      { character: characterFromProfile('pak'), side: 'b', at: { x: 15.5, y: 10.5 }, id: 'pak' },
    ]);
    startCombat(b, fixedDice('10:9,10:2'));
    const r = attack(
      b,
      shot({ id: 'p', actor: 'rookie', weapon: 'rookie:0' }),
      fixedDice('100:95'),
    );
    const mods = (
      r as { result: { attack: { check: { modifiers: { id: string; value: number }[] } } } }
    ).result.attack.check.modifiers;
    expect(mods.find((m) => m.id === 'p:no-proficiency')?.value).toBe(-30);
  });
});

describe('Exotic (xenos) weapons', () => {
  it('need «Владение экзотическим оружием» of that type', async () => {
    const { arsenal } = await import('./arsenal');
    const { hasExoticProficiency, isExotic } = await import('./proficiency');
    const xeno = arsenal.weapons.find((w) => w.sheet === 'Тау')!;
    expect(isExotic(xeno)).toBe(true);
    expect(hasExoticProficiency(['Владение оружием (Лаз)'], xeno)).toBe(false);
    expect(hasExoticProficiency([`Владение экзотическим оружием (${xeno.name})`], xeno)).toBe(true);
  });
});

describe('States after a hit (weapon properties)', () => {
  it('«Оглушающее»: a failed ВН test stuns for the degrees of failure; attacks on it get +20', async () => {
    const { arsenal } = await import('./arsenal');
    const mace = arsenal.weapons.find((w) => w.name === 'Булава')!;
    const thug = {
      ...emptyCharacter('thug', 'Громила'),
      talents: ['Владение оружием (Примитив)'],
      weapons: [{ name: mace.name, ref: mace.id }],
    };
    const b = createBattle([
      { character: thug, side: 'a', at: { x: 5.5, y: 10.5 }, id: 'thug' },
      { character: characterFromProfile('pak'), side: 'b', at: { x: 6.5, y: 10.5 }, id: 'pak' },
    ]);
    startCombat(b, fixedDice('10:9,10:2'));
    // Hit, then every other d100 (the ВН test) fails with 99.
    let n = 0;
    const r = attack(b, shot({ id: 'bonk', actor: 'thug', weapon: 'thug:0' }), {
      roll: (sides: number) => (sides === 100 ? (n++ === 0 ? 35 : 99) : 5),
    });
    const hits = (r as { result: { hits: { effects: { property: string; passed: boolean }[] }[] } })
      .result.hits;
    expect(hits[0]?.effects[0]).toMatchObject({ property: 'Оглушающее', passed: false });
    expect(actorStatus(b, 'pak').conditions).toContain('Stunned');
  });
});

describe('Talents against the hit (ruling 126)', () => {
  it('«Железная челюсть»: a ВН+0 test saves from «Оглушающее»', async () => {
    const { arsenal } = await import('./arsenal');
    const mace = arsenal.weapons.find((w) => w.name === 'Булава')!;
    const thug = {
      ...emptyCharacter('thug', 'Громила'),
      talents: ['Владение оружием (Примитив)'],
      weapons: [{ name: mace.name, ref: mace.id }],
    };
    const pak = characterFromProfile('pak');
    const b = createBattle([
      { character: thug, side: 'a', at: { x: 5.5, y: 10.5 }, id: 'thug' },
      {
        character: { ...pak, talents: [...pak.talents, 'Железная челюсть'] },
        side: 'b',
        at: { x: 6.5, y: 10.5 },
        id: 'pak',
      },
    ]);
    startCombat(b, fixedDice('10:9,10:2'));
    // Hit 35, the ВН test against «Оглушающее» fails (99), «Железная челюсть» passes (01).
    const seq = [35, 99, 1];
    let n = 0;
    const r = attack(b, shot({ id: 'bonk', actor: 'thug', weapon: 'thug:0' }), {
      roll: (sides: number) => (sides === 100 ? (seq[n++] ?? 1) : 5),
    });
    const hits = (r as { result: { hits: { effects: { property: string; passed: boolean }[] }[] } })
      .result.hits;
    expect(hits[0]?.effects[0]).toMatchObject({ property: 'Оглушающее', passed: true });
    expect(actorStatus(b, 'pak').conditions).not.toContain('Stunned');
  });
  it('«Мастер Стаб-оружия»: stub weapons get «Проверенное (½ бНС)»', async () => {
    const { matchWeaponByName } = await import('./arsenal');
    const gun = matchWeaponByName('Стаб-пистолет')!;
    const shooter = (talents: string[]) => ({
      ...emptyCharacter('s', 'Стрелок'),
      characteristics: { ...emptyCharacter('x').characteristics, НС: { value: 50, super: 0 } },
      talents: ['Владение оружием (Стаб)', ...talents],
      weapons: [{ name: gun.name, ref: gun.id }],
    });
    const total = (talents: string[]) => {
      const b = createBattle([
        { character: shooter(talents), side: 'a', at: { x: 5.5, y: 10.5 }, id: 's' },
        {
          character: characterFromProfile('pak'),
          side: 'b',
          at: { x: 9.5, y: 10.5 },
          id: 'pak',
        },
      ]);
      startCombat(b, fixedDice('10:9,10:2'));
      let n = 0;
      const r = attack(
        b,
        shot({ id: 'p', actor: 's', weapon: 's:0', answers: { 'cover:pak': 0 } }),
        {
          roll: (sides: number) => (sides === 100 ? (n++ === 0 ? 35 : 99) : 1),
        },
      );
      return (r as { result: { hits: { total: number }[] } }).result.hits[0]!.total;
    };
    // Damage dice show 1; with «Проверенное (3)» (бНС 5 → 3) each die counts as 3.
    expect(total(['Мастер Стаб-оружия']) - total([])).toBe(2 * gun.damage!.count);
  });
});

describe('More weapon properties in the fight', () => {
  const melee = async (
    weaponName: string,
    roll100: (n: number) => number,
    target = characterFromProfile('pak'),
    talents: string[] = [],
  ) => {
    const { matchWeaponByName } = await import('./arsenal');
    const w = matchWeaponByName(weaponName)!;
    const brute = {
      ...emptyCharacter('brute', 'Боец'),
      characteristics: {
        ...emptyCharacter('x').characteristics,
        НР: { value: 60, super: 0 },
        СЛ: { value: 60, super: 0 },
      },
      talents,
      weapons: [{ name: w.name, ref: w.id }],
    };
    const b = createBattle([
      { character: brute, side: 'a', at: { x: 5.5, y: 10.5 }, id: 'brute' },
      { character: target, side: 'b', at: { x: 6.5, y: 10.5 }, id: 'pak' },
    ]);
    startCombat(b, fixedDice('10:9,10:2'));
    let n = 0;
    const r = attack(
      b,
      shot({
        id: 'hit',
        actor: 'brute',
        weapon: 'brute:0',
        answers: { 'proficiency:brute:0': 1, 'impale:hit:hit:pak': 0 },
      }),
      { roll: (sides: number) => (sides === 100 ? roll100(n++) : 5) },
    );
    return { b, r };
  };
  it('«Контузия (4)»: −40 for 2 rounds', async () => {
    const tank = {
      ...emptyCharacter('tank', 'Танк'),
      wounds: 300,
      armour: { head: 60, torso: 60, arms: 60, legs: 60 },
    };
    const { b, r } = await melee('Сотрясающий молот Сатурна', (n) => (n === 0 ? 35 : 99), tank);
    expect(r.status).toBe('RESOLVED');
    expect(actorStatus(b, 'pak').conditions).toContain('Concussed');
  });
  it('«Мгновенная смерть»: damage ≥ 2 × бВН kills on the spot', async () => {
    const { b, r } = await melee('Дизрапторный кулак Сатурна', (n) => (n === 0 ? 35 : 99));
    expect(r.status).toBe('RESOLVED');
    expect(actorStatus(b, 'pak').life).toBe('DEAD');
  });
  const soft = () => ({
    ...emptyCharacter('soft', 'Мишень'),
    wounds: 300,
    armour: { head: 0, torso: 0, arms: 0, legs: 0 },
  });
  type Hits = { result: { hits: { effects: { property: string; state?: string }[] }[] } };
  it('«Деструктор (1)»: damage above ОБ — a separate wound of 1к10 (ruling 88)', async () => {
    const { b, r } = await melee('Пневмо-копье', (n) => (n === 0 ? 35 : 99), soft());
    expect(r.status).toBe('RESOLVED');
    const effects = (r as Hits).result.hits[0]!.effects;
    expect(effects.find((e) => e.property === 'Деструктор')?.state).toMatch(/отдельное ранение 5/);
    expect(b.log.some((e) => e.type === 'attack')).toBe(true);
  });
  it('«Калечащее (2)»: −2 wounds as soon as the target spends its 2nd ОД (ruling 89)', async () => {
    // Later d100 (secondary checks of the consequence) pass with 1.
    const { b, r } = await melee('Клевец', (n) => (n === 0 ? 35 : 1), soft());
    expect(r.status).toBe('RESOLVED');
    expect((r as Hits).result.hits[0]!.effects.map((e) => e.property)).toContain('Калечащее');
    // Light bleeding pulses at the start of the turn (the core rolls for it).
    nextTurn(b, { roll: (sides: number) => (sides === 100 ? 50 : 1) });
    expect(getEngine(b).pendingTurn).toBeUndefined();
    const before = b.hp.pak!;
    turnAction(b, { id: 'aim1', actor: 'pak', type: 'quick-aim' });
    expect(b.hp.pak).toBe(before);
    turnAction(b, { id: 'aim2', actor: 'pak', type: 'quick-aim' });
    expect(b.hp.pak).toBe(before - 2);
    expect(b.log.some((e) => e.type === 'crippling')).toBe(true);
  });
  it('«Огненное»: failed ЛВ — fire damage minus бВН, then «Горение» at the turn start (rulings 87, 90–93)', async () => {
    const { matchWeaponByName } = await import('./arsenal');
    const w = matchWeaponByName('Мельтган')!;
    const gunner = {
      ...emptyCharacter('gunner', 'Стрелок'),
      characteristics: { ...emptyCharacter('x').characteristics, НС: { value: 60, super: 0 } },
      talents: ['Владение оружием (Мельта)'],
      weapons: [{ name: w.name, ref: w.id }],
    };
    const b = createBattle([
      { character: gunner, side: 'a', at: { x: 5.5, y: 10.5 }, id: 'gunner' },
      // Heavy armour stops the melta itself; the fire ignores armour.
      {
        character: { ...soft(), armour: { head: 200, torso: 200, arms: 200, legs: 200 } },
        side: 'b',
        at: { x: 8.5, y: 10.5 },
        id: 'pak',
      },
    ]);
    startCombat(b, fixedDice('10:9,10:2'));
    let n = 0;
    const r = attack(
      b,
      shot({
        id: 'burn',
        actor: 'gunner',
        weapon: 'gunner:0',
        answers: { 'burning-ob:pak': 2, 'proficiency:gunner:0': 1, 'cover:pak': 0 },
      }),
      // The hit (35), then the ЛВ test against the fire fails (99).
      { roll: (sides: number) => (sides === 100 ? (n++ === 0 ? 35 : 99) : 5) },
    );
    expect(r.status).toBe('RESOLVED');
    const fire = (r as Hits).result.hits[0]!.effects.find((e) => e.property === 'Огненное');
    // 3к10 of fire = 15 minus бВН 3 → −12 wounds.
    expect(fire?.state).toBe('огонь: −12 ран, горит');
    expect(actorStatus(b, 'pak').conditions).toContain('Burning');
    const before = b.hp.pak!;
    // Burning: 2к10 = 10, − ½ ОБ 2 − бВН 3 → −5; +1к5 = 5 Fatigue; СВ 0 < 40 → the test fails (99).
    nextTurn(b, { roll: (sides: number) => (sides === 100 ? 99 : 5) });
    expect(b.hp.pak).toBe(before - 5);
    expect(turnInfo(b).od).toBe(0);
    expect(actorStatus(b, 'pak').fatigue).toBe(5);
    expect(actorStatus(b, 'pak').conditions).not.toContain('Burning');
  });
  it('«Плавящее (ББ)»: the armour loses ББ before the hit, the rest goes to the damage (ruling 94)', async () => {
    const { b, r } = await melee('Силовой молот', (n) => (n === 0 ? 35 : 1), {
      ...soft(),
      armour: { head: 2, torso: 2, arms: 2, legs: 2 },
    });
    expect(r.status).toBe('RESOLVED');
    const hit = (r as { result: { hits: { notes: string[] }[] } }).result.hits[0]!;
    expect(hit.notes.some((n) => /^Плавящее: броня −2 ОБ, остаток \+\d+ к урону$/.test(n))).toBe(
      true,
    );
    expect(actorStatus(b, 'pak').armorLoss).toEqual({ 'pak:torso': 2 });
  });
  it('«Токсичное (2/2)»: ВН −2к10 at each of the next 2 turns (rulings 95, 98)', async () => {
    const { b, r } = await melee('Клинок Гекатарии', (n) => (n === 0 ? 35 : 1), soft());
    expect(r.status).toBe('RESOLVED');
    expect((r as Hits).result.hits[0]!.effects.find((e) => e.property === 'Токсичное')?.state).toBe(
      'отравлен: ВН −2к10 каждый ход',
    );
    const vn = () => getEngine(b).wounds.combat.actors.pak!.characteristics.ВН!.baseValue;
    const start = vn();
    nextTurn(b, { roll: (sides: number) => (sides === 100 ? 1 : 5) });
    expect(vn()).toBe(Math.max(0, start - 10));
    expect(actorStatus(b, 'pak').conditions).toContain('Poisoned');
  });
  it('«Токсичное»: sealed or void armour stops the toxin (ruling 98)', async () => {
    const { r } = await melee('Клинок Гекатарии', (n) => (n === 0 ? 35 : 1), {
      ...soft(),
      armourItems: [{ name: 'Флак шлем (закрытый)', ref: 'Броня:Флак шлем (закрытый)' }],
    });
    expect(r.status).toBe('RESOLVED');
    expect((r as Hits).result.hits[0]!.effects.map((e) => e.property)).not.toContain('Токсичное');
  });
  const shoot = async (weaponName: string, target: ReturnType<typeof soft>) => {
    const { matchWeaponByName } = await import('./arsenal');
    const w = matchWeaponByName(weaponName)!;
    const gunner = {
      ...emptyCharacter('gunner', 'Стрелок'),
      characteristics: { ...emptyCharacter('x').characteristics, НС: { value: 60, super: 0 } },
      weapons: [{ name: w.name, ref: w.id }],
    };
    const b = createBattle([
      { character: gunner, side: 'a', at: { x: 5.5, y: 10.5 }, id: 'gunner' },
      { character: target, side: 'b', at: { x: 8.5, y: 10.5 }, id: 'pak' },
    ]);
    startCombat(b, fixedDice('10:9,10:2'));
    let n = 0;
    const r = attack(
      b,
      shot({
        id: 'rad',
        actor: 'gunner',
        weapon: 'gunner:0',
        answers: { 'proficiency:gunner:0': 1, 'cover:pak': 0 },
      }),
      { roll: (sides: number) => (sides === 100 ? (n++ === 0 ? 35 : 1) : 5) },
    );
    return { b, r };
  };
  it('«Рад»: pierced armour — 2к10 rad damage minus бВН (rulings 101, 103)', async () => {
    const { b, r } = await shoot('Рад-пистолет', soft());
    expect(r.status).toBe('RESOLVED');
    expect((r as Hits).result.hits[0]!.effects.find((e) => e.property === 'Рад')?.state).toBe(
      'рад-урон 2к10 (5+5) → −7 ран; накоплено 10',
    );
    expect(actorStatus(b, 'pak').conditions).toContain('Irradiated');
  });
  it('«Рад»: unpierced armour — ВН halved; rad-protected or void armour stops it (ruling 102)', async () => {
    const heavy = { ...soft(), armour: { head: 200, torso: 200, arms: 200, legs: 200 } };
    const { b, r } = await shoot('Рад-пистолет', heavy);
    expect((r as Hits).result.hits[0]!.effects.find((e) => e.property === 'Рад')?.state).toMatch(
      /ВН \/2 до конца боя/,
    );
    const vn = getEngine(b).wounds.combat.actors.pak!.characteristics.ВН!.baseValue;
    expect(vn).toBe(Math.floor(soft().characteristics.ВН.value / 2));
    const { r: r2 } = await shoot('Рад-пистолет', {
      ...heavy,
      armourItems: [{ name: 'Флак шлем (закрытый)', ref: 'Броня:Флак шлем (закрытый)' }],
    });
    expect((r2 as Hits).result.hits[0]!.effects.find((e) => e.property === 'Рад')?.state).toMatch(
      /ВН \/2/,
    );
    const { r: r3 } = await shoot('Рад-пистолет', {
      ...heavy,
      armourItems: [{ name: 'Пустотная броня', ref: 'Броня:Пустотная броня' }],
    });
    expect((r3 as Hits).result.hits[0]!.effects.find((e) => e.property === 'Рад')?.state).toBe(
      'броня защищает от радиации',
    );
  });
  it('«Коррозийное»: the zone armour loses Хк10 at the hit and every turn; cleaning stops it (rulings 115–117)', async () => {
    const { matchWeaponByName } = await import('./arsenal');
    const w = matchWeaponByName('Электрокоррозийный хлыст')!;
    const brute = {
      ...emptyCharacter('brute', 'Боец'),
      characteristics: { ...emptyCharacter('x').characteristics, НР: { value: 60, super: 0 } },
      weapons: [{ name: w.name, ref: w.id }],
    };
    const b = createBattle([
      { character: brute, side: 'a', at: { x: 5.5, y: 10.5 }, id: 'brute' },
      {
        character: { ...soft(), armour: { head: 40, torso: 40, arms: 40, legs: 40 } },
        side: 'b',
        at: { x: 6.5, y: 10.5 },
        id: 'pak',
      },
    ]);
    startCombat(b, fixedDice('10:9,10:2'));
    let n = 0;
    const r = attack(
      b,
      shot({
        id: 'acid',
        actor: 'brute',
        weapon: 'brute:0',
        answers: { 'proficiency:brute:0': 1, 'corrosive:brute:0': 1 },
      }),
      { roll: (sides: number) => (sides === 100 ? (n++ === 0 ? 35 : 1) : 5) },
    );
    expect(r.status).toBe('RESOLVED');
    expect(
      (r as Hits).result.hits[0]!.effects.find((e) => e.property === 'Коррозийное')?.state,
    ).toBe('броня (торс) −5 ОБ, разъедает каждый ход');
    expect(corrodedZones(b, 'pak')).toEqual(['torso']);
    nextTurn(b, { roll: (sides: number) => (sides === 100 ? 1 : 5) });
    expect(actorStatus(b, 'pak').armorLoss['pak:torso']).toBe(10);
    turnAction(b, { id: 'clean', actor: 'pak', type: 'clean-armour', zone: 'torso' });
    expect(corrodedZones(b, 'pak')).toEqual([]);
    expect(turnInfo(b).od).toBe(0);
  });
  it('«Коррозийное» on armour already at 0 ОБ: a separate wound like «Деструктор»', async () => {
    const { b, r } = await melee('Электрокоррозийный хлыст', (n) => (n === 0 ? 35 : 1), soft());
    // Х is not in the Arsenal: the GM is asked.
    expect(r.status).toBe('CONTEXT_REQUIRED');
    expect(turnInfo(b).pending?.question?.key).toBe('corrosive:brute:0');
    const done = resumeAttack(
      b,
      { roll: (sides: number) => (sides === 100 ? 1 : 5) },
      {
        'corrosive:brute:0': 1,
      },
    );
    expect(
      (done as Hits).result.hits[0]!.effects.find((e) => e.property === 'Коррозийное')?.state,
    ).toMatch(/^броня \(торс\) разъедена: \d+ ран$/);
  });
  it('«Проникающее»: the GM leaves the weapon in the wound; anyone next to it pulls it out (rulings 118–120)', async () => {
    const { matchWeaponByName } = await import('./arsenal');
    const w = matchWeaponByName('Копье')!;
    const brute = {
      ...emptyCharacter('brute', 'Боец'),
      characteristics: { ...emptyCharacter('x').characteristics, НР: { value: 60, super: 0 } },
      weapons: [{ name: w.name, ref: w.id }],
    };
    const b = createBattle([
      { character: brute, side: 'a', at: { x: 5.5, y: 10.5 }, id: 'brute' },
      { character: soft(), side: 'b', at: { x: 6.5, y: 10.5 }, id: 'pak' },
    ]);
    startCombat(b, fixedDice('10:9,10:2'));
    let n = 0;
    const r = attack(
      b,
      shot({
        id: 'stab',
        actor: 'brute',
        weapon: 'brute:0',
        answers: { 'proficiency:brute:0': 1, 'impale:stab:hit:pak': 1 },
      }),
      { roll: (sides: number) => (sides === 100 ? (n++ === 0 ? 35 : 1) : 5) },
    );
    expect(r.status).toBe('RESOLVED');
    expect(
      (r as Hits).result.hits[0]!.effects.find((e) => e.property === 'Проникающее')?.state,
    ).toBe('оружие в ране (торс): −1 СКР');
    expect(weaponInHand(b, 'brute:0')).toBe(false);
    const skr = getEngine(b).wounds.combat.actors.pak!.movement;
    nextTurn(b, { roll: (sides: number) => (sides === 100 ? 1 : 5) });
    const before = b.hp.pak!;
    const sl = Math.floor(soft().characteristics.СЛ.value / 10);
    const half = Math.floor(Math.floor(soft().characteristics.ВН.value / 10) / 2);
    extractWeapon(b, { id: 'pull', actor: 'pak', weapon: 'brute:0' }, fixedDice('5:3'));
    expect(b.hp.pak).toBe(before - Math.max(0, 3 + sl - half));
    expect(getEngine(b).wounds.combat.actors.pak!.movement).toBe(skr + 1);
    expect(b.taken?.['brute:0']).toBe('pak');
    expect(weaponInHand(b, 'brute:0')).toBe(true);
  });
  it('«Сокрушительный удар» adds ½ бНР (up) to melee damage (ruling 121)', async () => {
    const notes = async (talents: string[]) => {
      const { r } = await melee('Пневмо-копье', (n) => (n === 0 ? 35 : 99), soft(), talents);
      return (r as { result: { hits: { notes: string[] }[] } }).result.hits[0]!.notes;
    };
    expect((await notes([])).some((n) => n.startsWith('Сокрушительный удар'))).toBe(false);
    // НР 60 → бНР 6 → +3.
    expect(await notes(['Сокрушительный удар'])).toContain('Сокрушительный удар: +3');
  });
  it('«Мастер клинков»: a failed melee attack is rerolled once a round (ruling 128)', async () => {
    const seq = [99, 35];
    const { r } = await melee('Пневмо-копье', (n) => seq[n] ?? 99, soft(), ['Мастер клинков']);
    expect(r.status).toBe('RESOLVED');
    expect((r as { result: { hits: unknown[] } }).result.hits).toHaveLength(1);
    const { r: plain } = await melee('Пневмо-копье', (n) => seq[n] ?? 99, soft());
    expect((plain as { result: { hits: unknown[] } }).result.hits).toHaveLength(0);
  });
  it('«Стремительная атака»: +1 hit per 2nd degree; needs the talent (ruling 130)', async () => {
    const { matchWeaponByName } = await import('./arsenal');
    const w = matchWeaponByName('Цепной меч')!;
    const fighter = (talents: string[]) => ({
      ...emptyCharacter('f', 'Боец'),
      characteristics: { ...emptyCharacter('x').characteristics, НР: { value: 60, super: 0 } },
      talents: ['Владение оружием (Цепное)', ...talents],
      weapons: [{ name: w.name, ref: w.id }],
    });
    const run = (talents: string[]) => {
      const b = createBattle([
        { character: fighter(talents), side: 'a', at: { x: 5.5, y: 10.5 }, id: 'f' },
        {
          character: { ...soft(), armour: { head: 90, torso: 90, arms: 90, legs: 90 } },
          side: 'b',
          at: { x: 6.5, y: 10.5 },
          id: 'pak',
        },
      ]);
      startCombat(b, fixedDice('10:9,10:2'));
      let n = 0;
      return attack(b, shot({ id: 'sw', actor: 'f', weapon: 'f:0', meleeBase: 'swift' }), {
        roll: (sides: number) => (sides === 100 ? (n++ === 0 ? 5 : 99) : n % 2 ? 1 : 2),
      });
    };
    expect(() => run([])).toThrow();
    const r = run(['Стремительная атака']);
    const res = (
      r as { result: { attack: { totalDegrees: number }; hits: { location: string }[] } }
    ).result;
    expect(res.hits).toHaveLength(1 + Math.floor(res.attack.totalDegrees / 2));
  });
  it('«Вырваться»: 2 ОД, СЛ test with −10 × Х frees the entangled (ruling 86)', async () => {
    const { b } = await melee('Пневмо-копье', (n) => (n === 0 ? 35 : 99), soft());
    // Entangle the target directly as «Опутывающее (1)» would.
    const state = getEngine(b);
    const session = state.wounds.combat.session;
    state.wounds = {
      ...state.wounds,
      combat: {
        ...state.wounds.combat,
        session: {
          ...session,
          conditions: [
            ...session.conditions,
            {
              id: 'net',
              type: 'Helpless',
              actor: { actorId: 'pak' },
              sources: [],
              provenance: [],
              stackingRule: 'REJECT',
              unit: 'round',
              appliedRound: session.roundNumber,
              durationRounds: 99,
              expiresAfterRound: session.roundNumber + 98,
              effects: [],
              breakFree: -10,
            } as never,
          ],
        },
      },
    };
    nextTurn(b, fixedDice(''));
    expect(entanglement(b, 'pak')).toEqual({ id: 'net', modifier: -10 });
    turnAction(
      b,
      { id: 'bf1', actor: 'pak', type: 'break-free', characteristic: 'СЛ' },
      fixedDice('100:99'),
    );
    expect(entanglement(b, 'pak')).not.toBeNull();
    expect(turnInfo(b).od).toBe(0);
    nextTurn(b, fixedDice(''));
    nextTurn(b, fixedDice(''));
    turnAction(
      b,
      { id: 'bf2', actor: 'pak', type: 'break-free', characteristic: 'СЛ' },
      fixedDice('100:1'),
    );
    expect(entanglement(b, 'pak')).toBeNull();
  });
});
