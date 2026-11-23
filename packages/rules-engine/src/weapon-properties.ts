import type { DiceRoll, DiceSource } from '@kadat/contracts';
import { rollDie } from './dice.js';

/**
 * Weapon properties of the Arsenal («Свойства оружия», author ruling 50). Every function here
 * is pure: it reads the property list of a weapon and returns numbers or decisions; the caller
 * applies them. Names are the canonical names of the sheet; `value` is the rating «(Х)».
 * Only the properties whose text is unambiguous (or decided by the author) are implemented.
 */
export interface WeaponTrait {
  readonly name: string;
  readonly value?: number;
}

/** Where each property is written: «Свойства оружия», row; or an author ruling. */
export const PROPERTY_SOURCES: Readonly<Record<string, string>> = {
  Батарея: 'Свойства оружия, стр. 2',
  'Бритвенно острое': 'Свойства оружия, стр. 3',
  Гальваническое: 'Свойства оружия, стр. 10',
  Гибкое: 'Свойства оружия, стр. 11',
  Громоздкое: 'Свойства оружия, стр. 14',
  Дисперсия: 'Свойства оружия, стр. 15',
  Деструктор: 'Свойства оружия, стр. 16',
  Заряд: 'Свойства оружия, стр. 23',
  Когти: 'Свойства оружия, стр. 30',
  Лэнс: 'Свойства оружия, стр. 32; решение 68',
  'Мгновенная смерть': 'Свойства оружия, стр. 35',
  Мельта: 'Свойства оружия, стр. 36',
  Меткое: 'Свойства оружия, стр. 37',
  Моно: 'Свойства оружия, стр. 39',
  Надежное: 'Свойства оружия, стр. 42; решение 69',
  Ненадежное: 'Свойства оружия, стр. 44; решение 69',
  Неточное: 'Свойства оружия, стр. 45',
  Несбалансированное: 'Свойства оружия, стр. 46',
  Оборонительное: 'Свойства оружия, стр. 49',
  Оглушающее: 'Свойства оружия, стр. 50',
  Опутывающее: 'Свойства оружия, стр. 52',
  Примитивное: 'Свойства оружия, стр. 59',
  Перегрев: 'Свойства оружия, стр. 62',
  Разрывное: 'Свойства оружия, стр. 68',
  Разящее: 'Свойства оружия, стр. 69',
  Сбалансированное: 'Свойства оружия, стр. 72',
  Сила: 'Свойства оружия, стр. 74',
  Шоковое: 'Свойства оружия, стр. 90',
  Шторм: 'Свойства оружия, стр. 91',
  Точное: 'Свойства оружия, стр. 83; решение 67',
  Удобное: 'Свойства оружия, стр. 85',
  Проверенное: 'решение 54',
  бСЛх2: 'решение 61',
  Ослепляющее: 'решение 54',
};

export const findTrait = (traits: readonly WeaponTrait[], name: string) =>
  traits.find((t) => t.name === name);
export const hasTrait = (traits: readonly WeaponTrait[], name: string) =>
  findTrait(traits, name) !== undefined;
const rating = (traits: readonly WeaponTrait[], name: string, fallback?: number) => {
  const t = findTrait(traits, name);
  if (!t) return undefined;
  const v = t.value ?? fallback;
  if (v === undefined) throw new Error(`Свойство «${name}» требует значение (Х)`);
  if (!Number.isInteger(v) || v < 0) throw new Error(`Неверное значение свойства «${name}»`);
  return v;
};

export interface PropertyModifier {
  readonly property: string;
  readonly value: number;
  readonly source: string;
}
const mod = (property: string, value: number): PropertyModifier => ({
  property,
  value,
  source: PROPERTY_SOURCES[property] ?? 'Свойства оружия',
});

// ── Malfunctions (ruling 69: both ranged and melee) ──────────────────────────────────────

/**
 * Lowest raw d100 result that is a malfunction: a jam when firing, the weapon dropped in melee.
 * Default 96 («Бой»); Надежное — only 100; Ненадежное — 81+.
 */
export function malfunctionThreshold(traits: readonly WeaponTrait[]): number {
  const reliable = hasTrait(traits, 'Надежное');
  const unreliable = hasTrait(traits, 'Ненадежное');
  if (reliable && unreliable) throw new Error('Надежное и Ненадежное не сочетаются');
  return reliable ? 100 : unreliable ? 81 : 96;
}
export const isMalfunction = (traits: readonly WeaponTrait[], rawRoll: number) =>
  rawRoll >= malfunctionThreshold(traits);

/**
 * «Перегрев»: on a НС roll of 91+ the weapon does not fire and hits the hand holding it
 * with its own damage profile at ББ 0; it needs one round to cool down.
 */
export const overheats = (traits: readonly WeaponTrait[], rawRoll: number) =>
  hasTrait(traits, 'Перегрев') && rawRoll >= 91;

// ── Ammunition ───────────────────────────────────────────────────────────────────────────

/**
 * Rounds taken from the magazine by one attack: «Заряд (Х)» — Х per shot; «Шторм (Х)» — the
 * consumption is Х times higher (Х defaults to 2).
 */
export function ammoForAttack(traits: readonly WeaponTrait[], shots: number): number {
  if (!Number.isInteger(shots) || shots < 1) throw new Error('Invalid shots');
  const perShot = rating(traits, 'Заряд') ?? 1;
  const storm = rating(traits, 'Шторм', 2) ?? 1;
  return shots * perShot * storm;
}

// ── Test modifiers ───────────────────────────────────────────────────────────────────────

export interface AttackTestInput {
  readonly kind: 'ranged' | 'melee';
  /** The attacker aimed (any aim action) before this attack. */
  readonly aimed: boolean;
  readonly mode?: 'single' | 'short-burst' | 'full-auto';
  /** Distance and the weapon's optimal range, metres (ranged only). */
  readonly distance?: number;
  readonly optimalRange?: number;
}

/**
 * Number of whole optimal ranges beyond the optimal one («за каждую дистанцию выше
 * оптимальной»): up to ×1 → 0, up to ×2 → 1, up to ×3 → 2 …
 */
export function rangesBeyondOptimal(distance: number, optimalRange: number): number {
  if (!(optimalRange > 0) || !(distance >= 0)) throw new Error('Invalid range');
  return Math.max(0, Math.ceil(distance / optimalRange) - 1);
}

/** Modifiers the weapon's properties give to the attack test (НС / НР). */
export function attackTestModifiers(
  traits: readonly WeaponTrait[],
  input: AttackTestInput,
): PropertyModifier[] {
  const out: PropertyModifier[] = [];
  const aimCounts = input.aimed && !hasTrait(traits, 'Неточное');
  if (aimCounts && hasTrait(traits, 'Точное')) out.push(mod('Точное', 10));
  if (aimCounts && input.kind === 'ranged' && input.mode === 'single' && hasTrait(traits, 'Меткое'))
    out.push(mod('Меткое', 10));
  if (input.kind === 'melee' && hasTrait(traits, 'Удобное')) out.push(mod('Удобное', 5));
  if (input.kind === 'melee' && findTrait(traits, 'Оборонительное'))
    out.push(mod('Оборонительное', -10));
  if (
    input.kind === 'ranged' &&
    hasTrait(traits, 'Дисперсия') &&
    input.distance !== undefined &&
    input.optimalRange !== undefined
  ) {
    const beyond = rangesBeyondOptimal(input.distance, input.optimalRange);
    if (beyond) out.push(mod('Дисперсия', -10 * beyond));
  }
  return out;
}

/** «Неточное»: aiming gives no bonus with this weapon. */
export const aimGivesBonus = (traits: readonly WeaponTrait[]) => !hasTrait(traits, 'Неточное');

/** «Несбалансированное»: no more than one attack per round. */
export const maxAttacksPerRound = (traits: readonly WeaponTrait[]) =>
  hasTrait(traits, 'Несбалансированное') ? 1 : null;

/** «Громоздкое (Х)»: no swift attacks with this weapon. */
export const swiftAttackAllowed = (traits: readonly WeaponTrait[]) =>
  !findTrait(traits, 'Громоздкое');

export interface ParryInput {
  /** Properties of the weapon used to parry. */
  readonly parrying: readonly WeaponTrait[];
  /** Properties of the attacking weapon. */
  readonly attacking: readonly WeaponTrait[];
  /** Strength bonus of the parrying character. */
  readonly strengthBonus: number;
}
export interface ParryOptions {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly modifiers: readonly PropertyModifier[];
}
/**
 * Whether a parry is possible and its modifiers: «Гибкое» attacks cannot be parried (a dodge
 * still can); «Громоздкое (Х)» parries only with бСЛ above Х; Сбалансированное +10,
 * Несбалансированное −10, Удобное +5, Оборонительное +15.
 */
export function parryOptions(input: ParryInput): ParryOptions {
  if (hasTrait(input.attacking, 'Гибкое'))
    return { allowed: false, reason: 'Гибкое оружие нельзя парировать', modifiers: [] };
  const unwieldy = rating(input.parrying, 'Громоздкое');
  if (unwieldy !== undefined && !(input.strengthBonus > unwieldy))
    return {
      allowed: false,
      reason: `Громоздкое (${unwieldy}): парировать можно при бСЛ выше ${unwieldy}`,
      modifiers: [],
    };
  const modifiers: PropertyModifier[] = [];
  if (hasTrait(input.parrying, 'Сбалансированное')) modifiers.push(mod('Сбалансированное', 10));
  if (hasTrait(input.parrying, 'Несбалансированное'))
    modifiers.push(mod('Несбалансированное', -10));
  if (hasTrait(input.parrying, 'Удобное')) modifiers.push(mod('Удобное', 5));
  if (findTrait(input.parrying, 'Оборонительное')) modifiers.push(mod('Оборонительное', 15));
  return { allowed: true, modifiers };
}

/**
 * «Сила (Х)»: with бСЛ below Х the weapon's damage is halved and dodge or parry against it
 * gets +10 for every missing point of бСЛ.
 */
export function strengthRequirement(traits: readonly WeaponTrait[], strengthBonus: number) {
  const need = rating(traits, 'Сила');
  const missing = need === undefined ? 0 : Math.max(0, need - strengthBonus);
  return { met: missing === 0, halveDamage: missing > 0, defenceBonus: missing * 10 };
}

// ── Damage dice ──────────────────────────────────────────────────────────────────────────

export interface DamageDiceResult {
  readonly rolls: readonly DiceRoll[];
  /** «Разрывное»: the die that was re-rolled and its new value, which sets bleeding. */
  readonly tearing?: {
    readonly index: number;
    readonly before: number;
    readonly after: number;
    readonly bleeding: 'light' | 'medium' | 'heavy';
  };
}
/**
 * Applies the properties that act on the rolled damage dice: «Разрывное» re-rolls one lowest
 * die once (the new value stands and sets the bleeding: 1–4 light, 5–8 medium, 9–10 heavy);
 * «Проверенное (Х)» — no die counts less than Х (ruling 54).
 */
export function adjustDamageDice(
  traits: readonly WeaponTrait[],
  rolls: readonly DiceRoll[],
  source: DiceSource,
): DamageDiceResult {
  let out = rolls.map((r) => ({ ...r }));
  let tearing: DamageDiceResult['tearing'];
  if (hasTrait(traits, 'Разрывное') && out.length) {
    const lowest = Math.min(...out.map((r) => r.value));
    const index = out.findIndex((r) => r.value === lowest);
    const again = rollDie(out[index]!.sides, source);
    const v = again.value;
    tearing = {
      index,
      before: lowest,
      after: v,
      bleeding: v <= 4 ? 'light' : v <= 8 ? 'medium' : 'heavy',
    };
    out = out.map((r, i) => (i === index ? again : r));
  }
  const proven = rating(traits, 'Проверенное');
  if (proven !== undefined)
    out = out.map((r) => (r.value < proven ? { ...r, value: Math.min(proven, r.sides) } : r));
  return { rolls: out, ...(tearing ? { tearing } : {}) };
}

export interface DamageBonusInput {
  readonly kind: 'ranged' | 'melee';
  /** Degrees of success of the attack test. */
  readonly degrees: number;
  readonly strengthBonus: number;
  readonly distance?: number;
  readonly optimalRange?: number;
  /** Starting wounds of the target (for «Гальваническое»). */
  readonly targetWounds?: number;
  readonly weaponClass?: string;
}
export interface DamageBonus {
  /** Extra d10 rolled and added to damage. */
  readonly extraD10: number;
  /** d10 rolled and subtracted from damage («Дисперсия»). */
  readonly minusD10: number;
  readonly flat: number;
  readonly penetrationMultiplier: number;
  readonly penetrationAdd: number;
  readonly notes: readonly string[];
}
const isPistol = (c?: string) => c === 'П';
const isBasicOrHeavy = (c?: string) => c === 'ОС' || c === 'ТО';

/** Extra damage dice, flat bonuses and ББ changes from the properties. */
export function damageBonus(traits: readonly WeaponTrait[], input: DamageBonusInput): DamageBonus {
  let extraD10 = 0,
    minusD10 = 0,
    flat = 0,
    penetrationMultiplier = 1,
    penetrationAdd = 0;
  const notes: string[] = [];
  const d = Math.max(0, input.degrees);
  const ranged = input.distance !== undefined && input.optimalRange !== undefined;
  if (hasTrait(traits, 'Точное')) {
    const n = Math.min(3, Math.floor(d / 2));
    if (n) {
      extraD10 += n;
      notes.push(`Точное: +${n}к10`);
    }
  }
  if (hasTrait(traits, 'Когти') && input.kind === 'melee') {
    const odd = Math.ceil(d / 2);
    const primitive = hasTrait(traits, 'Примитивное') && !hasTrait(traits, 'Моно');
    const bonus = primitive ? Math.min(4, odd) : odd * 2;
    if (bonus) {
      flat += bonus;
      notes.push(`Когти: +${bonus}`);
    }
  }
  if (hasTrait(traits, 'Бритвенно острое') && d >= 3) {
    penetrationMultiplier *= 2;
    notes.push('Бритвенно острое: ББ ×2');
  }
  if (hasTrait(traits, 'Мельта') && ranged && input.distance! <= input.optimalRange! / 2) {
    penetrationMultiplier *= 2;
    extraD10 += 2;
    notes.push('Мельта: ББ ×2, +2к10');
  }
  if (hasTrait(traits, 'Моно') && input.kind === 'melee') {
    penetrationAdd += 3;
    notes.push('Моно: ББ +3');
  }
  if (hasTrait(traits, 'Дисперсия') && ranged) {
    const beyond = rangesBeyondOptimal(input.distance!, input.optimalRange!);
    if (beyond) {
      minusD10 += beyond;
      notes.push(`Дисперсия: −${beyond}к10`);
    }
  }
  if (hasTrait(traits, 'Гальваническое') && input.targetWounds !== undefined) {
    const cap = input.weaponClass === 'ТО' ? 5 : 3;
    const n = Math.min(cap, Math.floor(input.targetWounds / 20));
    if (n) {
      extraD10 += n;
      notes.push(`Гальваническое: +${n}к10 Э`);
    }
  }
  if (hasTrait(traits, 'бСЛх2')) {
    flat += input.strengthBonus;
    notes.push('бСЛх2: +бСЛ');
  }
  return { extraD10, minusD10, flat, penetrationMultiplier, penetrationAdd, notes };
}

// ── Armour and endurance ─────────────────────────────────────────────────────────────────

export interface ArmourInput {
  readonly armour: number;
  readonly penetration: number;
  readonly weaponClass?: string;
  /** The armour itself is primitive. */
  readonly primitiveArmour?: boolean;
}
/**
 * Armour left after the properties and ББ: «Лэнс» ignores a share of ОБ rounded down
 * (ruling 68: П 1/3, ОС/ТО 1/2, СТ 3/4); «Примитивное» (without «Моно») doubles non-primitive
 * ОБ and ББ is subtracted after that. Never below 0.
 */
export function armourAfterProperties(traits: readonly WeaponTrait[], input: ArmourInput): number {
  let armour = input.armour;
  if (hasTrait(traits, 'Лэнс')) {
    const share = isPistol(input.weaponClass)
      ? 1 / 3
      : isBasicOrHeavy(input.weaponClass)
        ? 1 / 2
        : input.weaponClass === 'СТ'
          ? 3 / 4
          : null;
    if (share === null) throw new Error('Лэнс: доля брони задана только для П, ОС, ТО и СТ');
    armour -= Math.floor(armour * share);
  }
  if (hasTrait(traits, 'Примитивное') && !hasTrait(traits, 'Моно') && !input.primitiveArmour)
    armour *= 2;
  return Math.max(0, armour - input.penetration);
}

/** «Разящее (Х)»: Х points of Super-ВН are ignored when damage is calculated. */
export function enduranceBonusAfterProperties(
  traits: readonly WeaponTrait[],
  bVN: number,
  superVN: number,
): number {
  const x = rating(traits, 'Разящее');
  return x === undefined ? bVN : Math.max(0, bVN - Math.min(x, superVN));
}

/** «Мгновенная смерть»: damage after absorption of at least twice the target's бВН kills it. */
export const instantDeath = (traits: readonly WeaponTrait[], finalDamage: number, bVN: number) =>
  hasTrait(traits, 'Мгновенная смерть') && finalDamage > 0 && finalDamage >= 2 * bVN;

// ── Effects after a hit ──────────────────────────────────────────────────────────────────

export interface AfterHitTest {
  readonly property: string;
  readonly characteristic: 'ВН' | 'ЛВ';
  readonly modifier: number;
  /** What a failed test does; the duration is in rounds equal to the degrees of failure. */
  readonly onFailure: 'stunned' | 'blinded' | 'immobilised';
  readonly durationByFailures: boolean;
}
/**
 * Tests the target makes after a hit. «Оглушающее (Х)»: ВН − 10Х, stunned for the degrees of
 * failure; «Ослепляющее (Х)» — the same, blinded (ruling 54); «Шоковое (Х)» — only after
 * unabsorbed damage, ВН − 10Х (no rating → +0), stunned; «Опутывающее (Х)»: ЛВ − 10Х, a failure
 * immobilises and makes the target helpless.
 */
export function afterHitTests(
  traits: readonly WeaponTrait[],
  unabsorbedDamage: number,
): AfterHitTest[] {
  const out: AfterHitTest[] = [];
  const stun = rating(traits, 'Оглушающее');
  if (stun !== undefined)
    out.push({
      property: 'Оглушающее',
      characteristic: 'ВН',
      modifier: -10 * stun,
      onFailure: 'stunned',
      durationByFailures: true,
    });
  const blind = rating(traits, 'Ослепляющее');
  if (blind !== undefined)
    out.push({
      property: 'Ослепляющее',
      characteristic: 'ВН',
      modifier: -10 * blind,
      onFailure: 'blinded',
      durationByFailures: true,
    });
  const shock = rating(traits, 'Шоковое', 0);
  if (shock !== undefined && unabsorbedDamage > 0)
    out.push({
      property: 'Шоковое',
      characteristic: 'ВН',
      modifier: -10 * shock,
      onFailure: 'stunned',
      durationByFailures: true,
    });
  const snare = rating(traits, 'Опутывающее');
  if (snare !== undefined)
    out.push({
      property: 'Опутывающее',
      characteristic: 'ЛВ',
      modifier: -10 * snare,
      onFailure: 'immobilised',
      durationByFailures: false,
    });
  return out;
}

/**
 * «Деструктор (Х)»: when the hit gets through the armour the target takes Х d10 more that
 * ignore armour. Whether «пробитие» means damage above armour is an author's question; the
 * caller passes the decision.
 */
export const destroyerDice = (traits: readonly WeaponTrait[], penetrated: boolean) =>
  penetrated ? (rating(traits, 'Деструктор') ?? 0) : 0;
