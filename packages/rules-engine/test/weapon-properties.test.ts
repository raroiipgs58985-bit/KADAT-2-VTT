import { describe, expect, test } from 'vitest';
import {
  meltingLoss,
  toxicProperty,
  gravitonDice,
  fireProperty,
  cripplingWounds,
  adjustDamageDice,
  afterHitTests,
  ammoForAttack,
  concussion,
  destroyerDice,
  stormHits,
  armourAfterProperties,
  attackTestModifiers,
  createSequenceDice,
  damageBonus,
  enduranceBonusAfterProperties,
  impliedTraits,
  instantDeath,
  isMalfunction,
  malfunctionThreshold,
  overheats,
  parryOptions,
  rangesBeyondOptimal,
  strengthRequirement,
  type WeaponTrait,
} from '../src/index.js';

const t = (name: string, value?: number): WeaponTrait =>
  value === undefined ? { name } : { name, value };
const d10 = (value: number) => ({ sides: 10, value });

describe('Malfunctions — «Свойства оружия» 42, 44, 62; ruling 69', () => {
  test('default 96+, Надежное only 100, Ненадежное 81+ (ranged and melee alike)', () => {
    expect(malfunctionThreshold([])).toBe(96);
    expect(malfunctionThreshold([t('Надежное')])).toBe(100);
    expect(malfunctionThreshold([t('Ненадежное')])).toBe(81);
    expect(isMalfunction([t('Надежное')], 99)).toBe(false);
    expect(isMalfunction([t('Надежное')], 100)).toBe(true);
    expect(isMalfunction([t('Ненадежное')], 81)).toBe(true);
    expect(isMalfunction([], 95)).toBe(false);
    expect(() => malfunctionThreshold([t('Надежное'), t('Ненадежное')])).toThrow();
  });
  test('Перегрев on 91+', () => {
    expect(overheats([t('Перегрев')], 91)).toBe(true);
    expect(overheats([t('Перегрев')], 90)).toBe(false);
    expect(overheats([], 99)).toBe(false);
  });
});

describe('Ammunition — Заряд, Шторм', () => {
  test('Заряд (Х) takes Х per shot; Шторм multiplies consumption, default ×2', () => {
    expect(ammoForAttack([], 5)).toBe(5);
    expect(ammoForAttack([t('Заряд', 2)], 3)).toBe(6);
    expect(ammoForAttack([t('Шторм')], 5)).toBe(10);
    expect(ammoForAttack([t('Шторм', 3)], 5)).toBe(15);
    expect(() => ammoForAttack([t('Заряд')], 1)).toThrow(/значение/);
  });
});

describe('Attack test modifiers', () => {
  test('Точное +10 when aimed (НС and НР); Меткое +10 for aimed single shots', () => {
    const ranged = { kind: 'ranged' as const, aimed: true, mode: 'single' as const };
    expect(attackTestModifiers([t('Точное')], ranged).map((m) => m.value)).toEqual([10]);
    expect(attackTestModifiers([t('Меткое')], ranged).map((m) => m.value)).toEqual([10]);
    expect(attackTestModifiers([t('Меткое')], { ...ranged, mode: 'short-burst' })).toEqual([]);
    expect(attackTestModifiers([t('Точное')], { ...ranged, aimed: false })).toEqual([]);
    expect(attackTestModifiers([t('Точное')], { kind: 'melee', aimed: true })[0]?.value).toBe(10);
  });
  test('Неточное: aiming gives no property bonus', () => {
    expect(
      attackTestModifiers([t('Точное'), t('Неточное')], { kind: 'ranged', aimed: true }),
    ).toEqual([]);
  });
  test('Удобное +5 НР, Оборонительное −10 when striking with it', () => {
    expect(
      attackTestModifiers([t('Удобное'), t('Оборонительное', 4)], {
        kind: 'melee',
        aimed: false,
      }).map((m) => m.value),
    ).toEqual([5, -10]);
  });
  test('Дисперсия −10 per optimal range beyond the optimal', () => {
    expect(rangesBeyondOptimal(30, 30)).toBe(0);
    expect(rangesBeyondOptimal(31, 30)).toBe(1);
    expect(rangesBeyondOptimal(90, 30)).toBe(2);
    const m = attackTestModifiers([t('Дисперсия')], {
      kind: 'ranged',
      aimed: false,
      distance: 70,
      optimalRange: 30,
    });
    expect(m[0]?.value).toBe(-20);
  });
});

describe('Parry — Гибкое, Громоздкое, balance', () => {
  test('Гибкое cannot be parried', () => {
    expect(parryOptions({ parrying: [], attacking: [t('Гибкое')], strengthBonus: 4 }).allowed).toBe(
      false,
    );
  });
  test('Громоздкое (Х) parries only with бСЛ above Х', () => {
    expect(
      parryOptions({ parrying: [t('Громоздкое', 4)], attacking: [], strengthBonus: 4 }).allowed,
    ).toBe(false);
    expect(
      parryOptions({ parrying: [t('Громоздкое', 4)], attacking: [], strengthBonus: 5 }).allowed,
    ).toBe(true);
  });
  test('Сбалансированное +10, Несбалансированное −10, Удобное +5, Оборонительное +15', () => {
    const v = (traits: WeaponTrait[]) =>
      parryOptions({ parrying: traits, attacking: [], strengthBonus: 3 }).modifiers.map(
        (m) => m.value,
      );
    expect(v([t('Сбалансированное')])).toEqual([10]);
    expect(v([t('Несбалансированное')])).toEqual([-10]);
    expect(v([t('Удобное'), t('Оборонительное', 3)])).toEqual([5, 15]);
  });
  test('Сила (Х): missing бСЛ halves damage and gives +10 per point to defence', () => {
    expect(strengthRequirement([t('Сила', 6)], 4)).toEqual({
      met: false,
      halveDamage: true,
      defenceBonus: 20,
    });
    expect(strengthRequirement([t('Сила', 6)], 6).met).toBe(true);
    expect(strengthRequirement([], 1).met).toBe(true);
  });
});

describe('Damage dice — Разрывное, Проверенное', () => {
  test('Разрывное re-rolls one lowest die once; the new value sets bleeding', () => {
    const r = adjustDamageDice([t('Разрывное')], [d10(7), d10(2)], createSequenceDice([d10(9)]));
    expect(r.rolls.map((x) => x.value)).toEqual([7, 9]);
    expect(r.tearing).toEqual({ index: 1, before: 2, after: 9, bleeding: 'heavy' });
    const low = adjustDamageDice([t('Разрывное')], [d10(3)], createSequenceDice([d10(1)]));
    expect(low.rolls[0]?.value).toBe(1);
    expect(low.tearing?.bleeding).toBe('light');
  });
  test('Проверенное (2): a rolled 1 counts as 2 (ruling 54)', () => {
    const r = adjustDamageDice([t('Проверенное', 2)], [d10(1), d10(5)], createSequenceDice([]));
    expect(r.rolls.map((x) => x.value)).toEqual([2, 5]);
  });
});

describe('Damage bonuses', () => {
  const base = { kind: 'ranged' as const, degrees: 0, strengthBonus: 4 };
  test('Точное: +1к10 per second degree, max 3к10, always (ruling 67)', () => {
    expect(damageBonus([t('Точное')], { ...base, degrees: 1 }).extraD10).toBe(0);
    expect(damageBonus([t('Точное')], { ...base, degrees: 4 }).extraD10).toBe(2);
    expect(damageBonus([t('Точное')], { ...base, degrees: 9 }).extraD10).toBe(3);
  });
  test('Бритвенно острое: ББ ×2 at 3+ degrees', () => {
    expect(
      damageBonus([t('Бритвенно острое')], { ...base, degrees: 2 }).penetrationMultiplier,
    ).toBe(1);
    expect(
      damageBonus([t('Бритвенно острое')], { ...base, degrees: 3 }).penetrationMultiplier,
    ).toBe(2);
  });
  test('Мельта: at half the optimal range or closer ББ ×2, +2к10', () => {
    const at = (distance: number) =>
      damageBonus([t('Мельта')], { ...base, distance, optimalRange: 20 });
    expect(at(10)).toMatchObject({ penetrationMultiplier: 2, extraD10: 2 });
    expect(at(11)).toMatchObject({ penetrationMultiplier: 1, extraD10: 0 });
  });
  test('Когти: primitive +1 per odd degree (max 4), otherwise +2 per odd degree', () => {
    const melee = { ...base, kind: 'melee' as const };
    expect(damageBonus([t('Когти'), t('Примитивное')], { ...melee, degrees: 9 }).flat).toBe(4);
    expect(damageBonus([t('Когти'), t('Примитивное')], { ...melee, degrees: 3 }).flat).toBe(2);
    expect(damageBonus([t('Когти')], { ...melee, degrees: 3 }).flat).toBe(4);
  });
  test('Моно ББ +3 in melee; бСЛх2 adds бСЛ once more', () => {
    expect(damageBonus([t('Моно')], { ...base, kind: 'melee' }).penetrationAdd).toBe(3);
    expect(damageBonus([t('бСЛх2')], base).flat).toBe(4);
  });
  test('Дисперсия −1к10 per range beyond optimal; Гальваническое +1к10 per 20 wounds', () => {
    expect(
      damageBonus([t('Дисперсия')], { ...base, distance: 61, optimalRange: 30 }).minusD10,
    ).toBe(2);
    expect(
      damageBonus([t('Гальваническое')], { ...base, targetWounds: 75, weaponClass: 'ОС' }).extraD10,
    ).toBe(3);
    expect(
      damageBonus([t('Гальваническое')], { ...base, targetWounds: 75, weaponClass: 'ТО' }).extraD10,
    ).toBe(3);
    expect(
      damageBonus([t('Гальваническое')], { ...base, targetWounds: 120, weaponClass: 'ТО' })
        .extraD10,
    ).toBe(5);
  });
});

describe('Armour and endurance', () => {
  test('Лэнс ignores a share rounded down (ruling 68): pistol ОБ 7 → 5', () => {
    expect(
      armourAfterProperties([t('Лэнс')], { armour: 7, penetration: 0, weaponClass: 'П' }),
    ).toBe(5);
    expect(
      armourAfterProperties([t('Лэнс')], { armour: 7, penetration: 0, weaponClass: 'ОС' }),
    ).toBe(4);
    expect(
      armourAfterProperties([t('Лэнс')], { armour: 8, penetration: 0, weaponClass: 'СТ' }),
    ).toBe(2);
    expect(
      armourAfterProperties([t('Лэнс')], { armour: 9, penetration: 2, weaponClass: 'ОС' }),
    ).toBe(3);
  });
  test('Примитивное doubles non-primitive ОБ, then ББ; Моно removes it', () => {
    expect(armourAfterProperties([t('Примитивное')], { armour: 4, penetration: 1 })).toBe(7);
    expect(
      armourAfterProperties([t('Примитивное')], {
        armour: 4,
        penetration: 1,
        primitiveArmour: true,
      }),
    ).toBe(3);
    expect(
      armourAfterProperties([t('Примитивное'), t('Моно')], { armour: 4, penetration: 1 }),
    ).toBe(3);
  });
  test('Разящее (Х) ignores Х Super-ВН', () => {
    expect(enduranceBonusAfterProperties([t('Разящее', 1)], 5, 2)).toBe(4);
    expect(enduranceBonusAfterProperties([t('Разящее', 3)], 5, 1)).toBe(4);
    expect(enduranceBonusAfterProperties([], 5, 2)).toBe(5);
  });
  test('Мгновенная смерть at damage ≥ 2 × бВН', () => {
    expect(instantDeath([t('Мгновенная смерть')], 8, 4)).toBe(true);
    expect(instantDeath([t('Мгновенная смерть')], 7, 4)).toBe(false);
    expect(instantDeath([], 20, 4)).toBe(false);
  });
});

describe('Tests after a hit', () => {
  test('Оглушающее, Ослепляющее, Опутывающее always; Шоковое only after unabsorbed damage', () => {
    expect(afterHitTests([t('Оглушающее', 2)], 0)[0]).toMatchObject({
      characteristic: 'ВН',
      modifier: -20,
      onFailure: 'stunned',
    });
    expect(afterHitTests([t('Ослепляющее', 1)], 0)[0]?.onFailure).toBe('blinded');
    expect(afterHitTests([t('Опутывающее', 1)], 0)[0]).toMatchObject({
      characteristic: 'ЛВ',
      modifier: -10,
    });
    expect(afterHitTests([t('Шоковое')], 0)).toEqual([]);
    expect(afterHitTests([t('Шоковое')], 3)[0]?.modifier).toBe(-0);
    expect(afterHitTests([t('Шоковое', 2)], 3)[0]?.modifier).toBe(-20);
  });
});

describe('Rulings 70–73', () => {
  test('Шторм: +Х hits per degree over the mode hits, capped by the declared rate', () => {
    const storm = [t('Шторм', 2)];
    expect(
      stormHits(storm, { mode: 'full-auto', baseHits: 3, degrees: 3, declaredShots: 10 }),
    ).toBe(9);
    expect(
      stormHits(storm, { mode: 'full-auto', baseHits: 4, degrees: 4, declaredShots: 10 }),
    ).toBe(10);
    expect(
      stormHits(storm, { mode: 'short-burst', baseHits: 2, degrees: 3, declaredShots: 5 }),
    ).toBe(5);
    expect(stormHits(storm, { mode: 'single', baseHits: 1, degrees: 3, declaredShots: 1 })).toBe(1);
    expect(
      stormHits(storm, { mode: 'full-auto', baseHits: 0, degrees: 0, declaredShots: 10 }),
    ).toBe(0);
    expect(
      stormHits([t('Шторм')], { mode: 'full-auto', baseHits: 2, degrees: 2, declaredShots: 10 }),
    ).toBe(6);
  });
  test('Деструктор: damage above armour, even if бВН absorbs the rest', () => {
    expect(destroyerDice([t('Деструктор', 2)], 8, 7)).toBe(2);
    expect(destroyerDice([t('Деструктор', 2)], 7, 7)).toBe(0);
    expect(destroyerDice([], 20, 0)).toBe(0);
  });
  test('Когти: at most 4 odd degrees also for non-primitive claws (max +8)', () => {
    expect(damageBonus([t('Когти')], { kind: 'melee', degrees: 9, strengthBonus: 3 }).flat).toBe(8);
  });
  test('Контузия (3): −30 for 2 rounds (½Х up)', () => {
    expect(concussion([t('Контузия', 3)])).toMatchObject({ modifier: -30, rounds: 2 });
    expect(concussion([t('Контузия', 1)])?.rounds).toBe(1);
    expect(concussion([])).toBeNull();
  });
});

describe('Implied properties', () => {
  test('Цепное includes Бритвенно острое and Разрывное (row 88), without duplicates', () => {
    expect(impliedTraits([t('Цепное')]).map((x) => x.name)).toEqual([
      'Цепное',
      'Бритвенно острое',
      'Разрывное',
    ]);
    expect(
      impliedTraits([t('Цепное'), t('Разрывное')]).filter((x) => x.name === 'Разрывное'),
    ).toHaveLength(1);
    expect(impliedTraits([t('Моно')])).toEqual([t('Моно')]);
  });
});

describe('Properties of rulings 87–98', () => {
  test('«Плавящее»: ББ or damage + ББ', () => {
    expect(meltingLoss([{ name: 'Плавящее', text: 'ББ' }], 8, 20)).toBe(8);
    expect(meltingLoss([{ name: 'Плавящее', text: 'У' }], 8, 20)).toBe(28);
    expect(meltingLoss([], 8, 20)).toBeNull();
  });
  test('«Токсичное»: Х/Y, no Y — till the end of the fight', () => {
    expect(toxicProperty([{ name: 'Токсичное', value: 2, duration: 2 }])).toEqual({
      dice: 2,
      rounds: 2,
      superModifier: -10,
    });
    expect(toxicProperty([{ name: 'Токсичное', value: 3 }])?.rounds).toBeNull();
  });
  test('«Гравитонное»: к10 per odd degree of failure', () => {
    const g = [{ name: 'Гравитонное' }];
    expect([1, 2, 3, 4, 5].map((d) => gravitonDice(g, d))).toEqual([1, 1, 2, 2, 3]);
    expect(gravitonDice([], 3)).toBe(0);
  });
  test('«Огненное»: 2к10 and 1 round by default', () => {
    expect(fireProperty([{ name: 'Огненное' }])).toEqual({
      damage: { count: 2, sides: 10, modifier: 0 },
      rounds: 1,
    });
    expect(
      fireProperty([{ name: 'Огненное', dice: { count: 3, sides: 10 }, duration: 3 }])?.rounds,
    ).toBe(3);
  });
  test('«Калечащее»: Х', () => {
    expect(cripplingWounds([{ name: 'Калечащее', value: 2 }])).toBe(2);
    expect(cripplingWounds([])).toBeNull();
  });
});
