import { describe, expect, it } from 'vitest';
import {
  characterProblems,
  currentSkr,
  emptyCharacter,
  parseProfileArmour,
  parseProfileCharacteristic,
  parseProfileMovement,
  parseProfileSkill,
  splitProfileList,
} from './character';
import { characterFromProfile, parseCharacterFile, serializeCharacter } from './character-file';

describe('Profile text as written in the sheets', () => {
  it('characteristics «42 (4)» and «40 (4+1Сверх)»', () => {
    expect(parseProfileCharacteristic('42 (4)')).toEqual({ value: 42, super: 0 });
    expect(parseProfileCharacteristic('40 (4+1Сверх)')).toEqual({ value: 40, super: 1 });
    expect(parseProfileCharacteristic('сорок')).toBeNull();
  });
  it('armour «9/9/8/8» by zones, or one number for all', () => {
    expect(parseProfileArmour('9/9/8/8')).toEqual({ head: 9, torso: 9, arms: 8, legs: 8 });
    expect(parseProfileArmour('3')).toEqual({ head: 3, torso: 3, arms: 3, legs: 3 });
    expect(parseProfileArmour('9/9')).toBeNull();
  });
  it('lists split on top-level commas; skills keep their bonus (ruling 49)', () => {
    expect(splitProfileList('Атлетика, Знание (Война|Империум), Уклонение+10.')).toEqual([
      'Атлетика',
      'Знание (Война|Империум)',
      'Уклонение+10',
    ]);
    expect(parseProfileSkill('Уклонение+10')).toEqual({ name: 'Уклонение', bonus: 10 });
    expect(parseProfileSkill('Атлетика')).toEqual({ name: 'Атлетика', bonus: 0 });
  });
  it('movement rows: five numbers — СКР is the second; four — the first', () => {
    expect(parseProfileMovement('2/4/8/12/24 - Базовый\n3/5/10/15/30 - Броня')).toEqual([
      { label: 'Базовый', skr: 4 },
      { label: 'Броня', skr: 5 },
    ]);
    expect(parseProfileMovement('4/8/12/24')).toEqual([{ label: 'Базовый', skr: 4 }]);
    expect(parseProfileMovement('См.Прим')).toBeNull();
  });
});

describe('Characters from the test profiles', () => {
  it('Kelus: characteristics, 32 wounds, armour, Размер 0, СКР options 4 and 5 (ruling 3)', () => {
    const k = characterFromProfile('kelus-drakar');
    expect(characterProblems(k)).toEqual([]);
    expect(k.characteristics.СЛ).toEqual({ value: 40, super: 1 });
    expect(k.wounds).toBe(32);
    expect(k.armour).toEqual({ head: 9, torso: 9, arms: 8, legs: 8 });
    expect(k.size).toBe(0);
    expect(k.movement.options.map((o) => [o.label, o.skr])).toContainEqual(['Броня', 5]);
    expect(currentSkr(k)).toBe(4);
    expect(k.skills).toContainEqual({ name: 'Уклонение', bonus: 10 });
    expect(k.talents).toContain('Стальная челюсть');
  });
  it('Pak: 33 wounds, СКР 4, talent «Спринт»', () => {
    const p = characterFromProfile('pak');
    expect(characterProblems(p)).toEqual([]);
    expect(p.wounds).toBe(33);
    expect(currentSkr(p)).toBe(4);
    expect(p.talents).toContain('Спринт');
  });
});

describe('Character file', () => {
  it('save → open gives the same character and the same bytes', () => {
    const k = characterFromProfile('kelus-drakar');
    const text = serializeCharacter(k);
    const opened = parseCharacterFile(text);
    expect(opened).toEqual(k);
    expect(serializeCharacter(opened)).toBe(text);
  });
  it('refuses foreign, damaged or invalid files with a reason', () => {
    expect(() => parseCharacterFile('{')).toThrow(/не является JSON/);
    expect(() => parseCharacterFile('{"documentType":"kadat-map"}')).toThrow(/не файл персонажа/);
    const bad = JSON.parse(serializeCharacter(emptyCharacter('x')));
    bad.character.wounds = 0;
    expect(() => parseCharacterFile(JSON.stringify(bad))).toThrow(/Раны: от 1 до 999/);
    bad.character.wounds = 5;
    bad.character.extra = 1;
    expect(() => parseCharacterFile(JSON.stringify(bad))).toThrow(/Лишние поля/);
  });
  it('an invalid character is not saved', () => {
    expect(() => serializeCharacter({ ...emptyCharacter('x'), name: ' ' })).toThrow(/Нужно имя/);
  });
});
