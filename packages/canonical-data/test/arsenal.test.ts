import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  importArsenal,
  parseDamage,
  parseFamilyModes,
  parseMass,
  parseRange,
  parseRof,
  splitProperties,
  type ArsenalDataset,
  type ArsenalSnapshot,
} from '../src/arsenal.js';

const snapshot = JSON.parse(
  readFileSync(new URL('../sources/arsenal-2026-11-23.json', import.meta.url), 'utf8'),
) as ArsenalSnapshot;
const committed = JSON.parse(
  readFileSync(new URL('../dataset/arsenal.json', import.meta.url), 'utf8'),
) as ArsenalDataset;

describe('Cell readers', () => {
  it('damage, rate of fire, range, mass, properties as written', () => {
    expect(parseDamage('1к10+4 Э')).toEqual({ count: 1, sides: 10, modifier: 4, type: 'Э' });
    expect(parseDamage('1к5-3 У')).toEqual({ count: 1, sides: 5, modifier: -3, type: 'У' });
    expect(parseDamage('1к10+12')).toEqual({ count: 1, sides: 10, modifier: 12, type: null });
    expect(parseDamage('-')).toBeNull();
    expect(parseRof('1/3/10')).toEqual({ single: 1, short: 3, long: 10 });
    expect(parseRof('-/5/10')).toEqual({ single: null, short: 5, long: 10 });
    expect(parseRange('30 км')).toBe(30000);
    expect(parseRange('0-1')).toBe(1);
    expect(parseRange('10хБС')).toBeNull();
    expect(parseMass('1,5')).toBe(1.5);
    expect(parseMass('2 т')).toBe(2000);
    expect(splitProperties('Взрыв (0.5), Разрывное, Отдача (4)')).toEqual([
      'Взрыв (0.5)',
      'Разрывное',
      'Отдача (4)',
    ]);
    expect(splitProperties('нет')).toEqual([]);
  });
  it('las family modes from the sheet header (ruling 52)', () => {
    expect(
      parseFamilyModes('Особенности: Одиночный выстрел +10, Короткая очередь +5, Длинная +0 к НС'),
    ).toEqual({ single: 10, 'short-burst': 5, 'full-auto': 0 });
  });
});

describe('Arsenal dataset', () => {
  const data = importArsenal(snapshot);
  it('is reproducible: rebuilding from the snapshot gives the committed dataset', () => {
    expect(JSON.parse(JSON.stringify(data))).toEqual(committed);
  });
  it('pattern tables are not weapons (ruling 183): «Агриппина», «Хакс-Ортлак» are skipped', () => {
    const names = data.weapons.map((w) => w.name);
    expect(names).not.toContain('Агриппина');
    expect(names).not.toContain('Хакс-Ортлак');
    expect(names).toContain('Крак (90 мм)');
  });
  it('the hot-shot lasgun matches «Лаз» row 11', () => {
    const w = data.weapons.find((x) => x.name === 'Хот-шот лазган')!;
    expect(w).toMatchObject({
      weaponClass: 'ОС',
      range: { meters: 100 },
      rof: { single: 1, short: 3, long: null },
      damage: { count: 1, sides: 10, modifier: 4, type: 'Э' },
      penetration: 6,
      magazine: 60,
      reload: { od: 2 },
      modeModifiers: { single: 10, 'short-burst': 5, 'full-auto': 0 },
      source: { sheet: 'Лаз', row: 11 },
    });
    expect(w.properties.map((p) => [p.name, p.param])).toContainEqual(['Заряд', '7']);
  });
  it('only las weapons carry family fire-mode modifiers', () => {
    expect(data.weapons.filter((w) => w.modeModifiers).every((w) => w.sheet === 'Лаз')).toBe(true);
  });
  it('armour by zones, a helmet covers only the head', () => {
    const helmet = data.armour.find((a) => a.name === 'Стальной шлем')!;
    expect(helmet.armour).toEqual({ head: 4, torso: null, arms: null, legs: null });
    expect(data.armour.find((a) => a.name.startsWith('Флак-форма'))!.armour).toEqual({
      head: 2,
      torso: 2,
      arms: 2,
      legs: 2,
    });
  });
  it('properties resolve by name or abbreviation, ignoring ё/е', () => {
    const lasgun = data.weapons.find((x) => x.name === 'Лазган')!;
    expect(lasgun.properties.map((p) => p.property)).toEqual(['Регулировка мощности', 'Надежное']);
  });
});

describe('Author corrections of 23.11.2026 (decisions 54–58)', () => {
  const data = importArsenal(snapshot);
  it('properties missing from the sheet are added with the author as source', () => {
    for (const n of ['Проверенное', 'Навесное', 'Ослепляющее'])
      expect(data.properties.find((p) => p.name === n)?.source).toEqual({
        author: 'Решение автора 23.11.2026',
      });
    const w = data.weapons.find((x) => x.name === 'Хот-шот лазган')!;
    expect(w.properties.find((p) => p.name === 'Проверенное')?.property).toBe('Проверенное');
  });
  it('misspelt property names resolve to the correct ones', () => {
    const all = data.weapons.flatMap((w) => w.properties);
    expect(all.some((p) => p.name === 'Калечашее')).toBe(false);
    expect(
      all.filter((p) => p.raw.startsWith('Калечашее')).every((p) => p.property === 'Калечащее'),
    ).toBe(true);
  });
  it('«(опц)» marks an optional property', () => {
    const p = data.weapons.flatMap((w) => w.properties).find((x) => x.raw.includes('(опц)'))!;
    expect(p).toMatchObject({ name: 'Калечащее', optional: true, property: 'Калечащее' });
  });
  it('a cap «3-/-/-» covers only the head; power armour has an undersuit layer', () => {
    expect(data.armour.find((a) => a.name === 'Флак фуражка')!.armour).toEqual({
      head: 3,
      torso: null,
      arms: null,
      legs: null,
    });
    const t = data.armour.find((a) => a.name === 'Терминаторский доспех Индоминус')!;
    expect(t.armour).toEqual({ head: 20, torso: 20, arms: 20, legs: 20 });
    expect(t.underlayer).toEqual({ head: 5, torso: 6, arms: 5, legs: 5 });
  });
  it('the Power scythe range is restored to «1-3»', () => {
    expect(data.weapons.find((w) => w.name === 'Силовая коса')!.range).toEqual({
      meters: 3,
      text: '1-3',
      formula: false,
    });
    expect(data.issues.some((i) => /стала датой/.test(i.message))).toBe(false);
  });
});

describe('Author decisions 60–61', () => {
  const data = importArsenal(snapshot);
  const refs = data.weapons.flatMap((w) => w.properties);
  it('variant spellings resolve to one property', () => {
    expect(refs.find((p) => p.name === 'Деструктор' && p.raw.startsWith('Дес'))?.property).toBe(
      'Деструктор',
    );
    expect(refs.find((p) => p.raw.startsWith('Кон'))?.property).toBe('Контузия');
  });
  it('«СП» on a shield is the power field armour trait; «бСЛх2» is described', () => {
    expect(refs.find((p) => p.raw.startsWith('СП ('))?.armourTrait).toBe('Силовое поле');
    expect(refs.find((p) => p.raw === 'бСЛх2')?.property).toBe('бСЛх2');
  });
});
