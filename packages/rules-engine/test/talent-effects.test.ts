import { describe, expect, test } from 'vitest';
import {
  criticalBonus,
  meltaRangeBonus,
  talentAttackModifiers,
  talentDamage,
  unfamiliarWeaponPenalty,
} from '../src/index.js';

describe('Combat talents (rulings 121–124)', () => {
  const base = { nrBonus: 5, nsBonus: 3, degrees: 3 } as const;
  test('damage talents round halves up', () => {
    expect(
      talentDamage({ ...base, talents: ['Сокрушительный удар'], kind: 'melee', family: 'other' })
        .damage,
    ).toEqual([{ talent: 'Сокрушительный удар', value: 3 }]);
    expect(
      talentDamage({ ...base, talents: ['Мастер Болт-оружия'], kind: 'ranged', family: 'bolt' }),
    ).toEqual({
      damage: [{ talent: 'Мастер Болт-оружия', value: 2 }],
      penetration: [{ talent: 'Мастер Болт-оружия', value: 2 }],
    });
    expect(
      talentDamage({ ...base, talents: ['Мастер Лаз-оружия'], kind: 'ranged', family: 'las' })
        .damage[0]?.value,
    ).toBe(2);
    expect(
      talentDamage({ ...base, talents: ['Мастер Болт-оружия'], kind: 'ranged', family: 'las' })
        .damage,
    ).toEqual([]);
  });
  test('called-attack reductions stop at 0; «Знаток Болт-оружия» +5', () => {
    const both = ['Меткий выстрел', 'Снайпер', 'Знаток Болт-оружия'];
    expect(
      talentAttackModifiers({ talents: both, kind: 'ranged', family: 'bolt', calledPenalty: -15 }),
    ).toEqual([
      { talent: 'Меткий выстрел', value: 10 },
      { talent: 'Снайпер', value: 5 },
      { talent: 'Знаток Болт-оружия', value: 5 },
    ]);
    expect(
      talentAttackModifiers({
        talents: ['Верный удар', 'Точный удар'],
        kind: 'melee',
        family: 'other',
        calledPenalty: 0,
      }),
    ).toEqual([]);
  });
  test('critical die, unfamiliar weapon, melta range', () => {
    expect(criticalBonus(['Калечащий удар'], 'melee')).toBe(2);
    expect(criticalBonus(['Калечащий удар'], 'ranged')).toBe(0);
    expect(unfamiliarWeaponPenalty(['Универсальный солдат'], -30)).toBe(-20);
    expect(meltaRangeBonus(['Знаток Мельта-оружия'], 45)).toBe(90);
  });
});
