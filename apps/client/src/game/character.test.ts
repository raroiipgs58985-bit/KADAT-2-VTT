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
import {
  armourFromItems,
  arsenal,
  matchArmourByName,
  searchArsenal,
  weaponSummary,
} from './arsenal';

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

describe('Characters and the Arsenal (step 3)', () => {
  it('profile equipment that equals one Arsenal record becomes a weapon with its reference', () => {
    const k = characterFromProfile('kelus-drakar');
    expect(k.weapons).toEqual([
      { name: 'Хот-шот лазган', ref: 'Лаз:Хот-шот лазган' },
      { name: 'Цепной меч', ref: 'ХТХ и примитив:Цепной меч' },
    ]);
    expect(k.notes).toMatch(/Не найдено в Арсенале однозначно: Тычковый кинжал/);
  });
  it('a version 1 file opens and gets an empty armour list', () => {
    const v2 = JSON.parse(serializeCharacter(characterFromProfile('pak')));
    const { armourItems: _drop, undersuit: _u, ...rest } = v2.character;
    void _drop;
    void _u;
    const v1 = { ...v2, schemaVersion: 1, character: { ...rest, schemaVersion: 1 } };
    const opened = parseCharacterFile(JSON.stringify(v1));
    expect(opened.schemaVersion).toBe(2);
    expect(opened.armourItems).toEqual([]);
  });
  it('search finds by words; summaries read the profile', () => {
    const hits = searchArsenal(arsenal.weapons, 'хот лазган');
    expect(hits.map((w) => w.name)).toContain('Хот-шот лазган');
    expect(weaponSummary(hits.find((w) => w.name === 'Хот-шот лазган')!)).toBe(
      'ОС · 100 м · 1/3/- · 1к10+4 Э · ББ 6 · маг. 60',
    );
  });
  it('ОБ from armour items only when no zone is covered twice', () => {
    const flak = matchArmourByName('Флак-форма')!;
    const helmet = matchArmourByName('Стальной шлем')!;
    expect(armourFromItems([{ ref: flak.id }]).armour).toEqual({
      head: 2,
      torso: 2,
      arms: 2,
      legs: 2,
    });
    // Two items on one zone are not worn (decision 63).
    const both = armourFromItems([{ ref: flak.id }, { ref: helmet.id }]);
    expect(both.armour).toBeNull();
    expect(both.reason).toMatch(/не надевают/);
  });
});

describe('Armour layers (decisions 56, 63)', () => {
  it('a plate on an undersuit: plates give ОБ, the undersuit counts for the joints', () => {
    const plate = arsenal.armour.find((a) => a.properties.some((p) => p.name === 'Плита'))!;
    const suit = arsenal.armour.find(
      (a) => a.properties.some((p) => p.name === 'Поддоспешник') && a.armour!.torso !== null,
    )!;
    const r = armourFromItems([{ ref: suit.id }, { ref: plate.id }]);
    expect(r.reason).toBeNull();
    expect(r.armour!.torso).toBe(plate.armour!.torso ?? suit.armour!.torso);
    if (plate.armour!.torso !== null) expect(r.undersuit!.torso).toBe(suit.armour!.torso);
  });
  it('power armour carries its own undersuit layer', () => {
    const t = arsenal.armour.find((a) => a.name === 'Терминаторский доспех Индоминус')!;
    expect(armourFromItems([{ ref: t.id }]).undersuit).toEqual({
      head: 5,
      torso: 6,
      arms: 5,
      legs: 5,
    });
  });
});

describe('Arsenal properties for the rules engine', () => {
  it('names and whole-number ratings are read (fractional only for «Взрыв» and «ЭМИ», rulings 151, 186); other ratings go to the GM', async () => {
    const { arsenal, weaponTraits } = await import('./arsenal');
    const mace = arsenal.weapons.find((w) => w.name === 'Булава')!;
    expect(weaponTraits(mace).traits).toEqual([
      { name: 'Примитивное' },
      { name: 'Не защищённое' },
      { name: 'Оглушающее', value: 0 },
    ]);
    const all = arsenal.weapons.map(weaponTraits);
    expect(
      all
        .flatMap((x) => x.traits)
        .every(
          (t) =>
            t.value === undefined ||
            Number.isInteger(t.value) ||
            ['Взрыв', 'Локальный взрыв', 'ЭМИ'].includes(t.name),
        ),
    ).toBe(true);
    expect(all.some((x) => x.unread.length > 0)).toBe(true);
  });
});

describe('Arsenal search on a phone', () => {
  it('forgives one wrong letter when nothing matches exactly', async () => {
    const { arsenal, searchArsenal, oneEditAway } = await import('./arsenal');
    expect(oneEditAway('лазоан', 'лазган')).toBe(true);
    expect(oneEditAway('лазган', 'лазган')).toBe(true);
    expect(oneEditAway('лаз', 'болт')).toBe(false);
    expect(searchArsenal(arsenal.weapons, 'Лазоан').some((w) => w.name === 'Лазган')).toBe(true);
    expect(
      searchArsenal(arsenal.weapons, 'лазган').every((w) =>
        /лазган/i.test(`${w.name} ${w.sheet} ${w.group ?? ''}`),
      ),
    ).toBe(true);
  });
});

describe('Character from the generator', () => {
  const sample = {
    format: 'kadat-generator-character' as const,
    version: 1 as const,
    exportedAt: '2026-11-23T12:00:00Z',
    name: 'Гвардеец',
    gender: null,
    race: { id: 'human', name: 'Человек', traits: ['Размер (0)', 'СверхСЛ (+2)'] },
    world: { id: 'w', name: 'Мир-кузница' },
    specialty: { id: 's', name: 'Гвардеец' },
    stats: { НС: 41, НР: 35, СЛ: 38, ВН: 36, ЛВ: 33, ИН: 30, СВ: 32, ВС: 34, ОЩ: 28 },
    skills: [
      { name: 'Уклонение', bonus: 10 },
      { name: 'Атлетика', bonus: 0 },
    ],
    talents: ['Спринт'],
    wounds: 14,
    equipment: ['Лазган', 'Флак-форма', 'Фляга'],
    traits: [],
    rules: [],
  };
  it('turns the dossier into a combat sheet with Arsenal weapons and armour', async () => {
    const { characterFromGenerator, isGeneratorCharacter } = await import('./generator-import');
    expect(isGeneratorCharacter(sample)).toBe(true);
    const c = characterFromGenerator(sample, 'gen-1');
    expect(c.characteristics.СЛ).toEqual({ value: 38, super: 2 });
    expect(c.characteristics.НС.value).toBe(41);
    expect(c.wounds).toBe(14);
    // «Общая механика» A25: СКР = бЛВ + Размер → 3 + 0.
    expect(c.movement.options[0]!.skr).toBe(3);
    expect(c.skills).toEqual(sample.skills);
    expect(c.talents).toEqual(['Спринт']);
    expect(c.weapons.map((w) => w.name)).toEqual(['Лазган']);
    expect(c.armourItems.map((a) => a.name)).toEqual(['Флак-форма']);
    // ОБ come from the armour item automatically (Флак-форма 2/2/2/2).
    expect(c.armour).toEqual({ head: 2, torso: 2, arms: 2, legs: 2 });
    expect(c.notes).toContain('Фляга');
    expect(characterProblems(c)).toEqual([]);
  });
  it('СКР of 0 or less becomes 0,5 m', async () => {
    const { characterFromGenerator } = await import('./generator-import');
    const tiny = { ...sample, race: { ...sample.race, traits: ['Размер (-4)'] } };
    expect(characterFromGenerator(tiny, 'gen-2').movement.options[0]!.skr).toBe(0.5);
  });
});
