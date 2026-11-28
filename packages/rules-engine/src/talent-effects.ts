/**
 * Combat talents of «Таланты (обновлены)» that change attack tests and damage (author
 * rulings 121–124). Pure functions: the caller supplies the talents, the weapon family and the
 * numbers; nothing is read from the UI or a network.
 */
export type WeaponFamily = 'bolt' | 'las' | 'plasma' | 'melta' | 'other';
export interface TalentNote {
  readonly talent: string;
  readonly value: number;
}
const halfUp = (n: number) => Math.ceil(n / 2);

/**
 * Damage and penetration from talents:
 * «Сокрушительный удар» melee +½ бНР; «Сокрушительный выстрел» ranged +½ бНС;
 * «Мастер Болт-оружия» damage and ББ +½ бНС; «Мастер Лаз-оружия» damage +½ degrees of НС;
 * «Мастер Плазменного оружия» damage and ББ +2. Halves round up (ruling 121).
 */
export function talentDamage(input: {
  readonly talents: readonly string[];
  readonly kind: 'ranged' | 'melee';
  readonly family: WeaponFamily;
  readonly nrBonus: number;
  readonly nsBonus: number;
  readonly degrees: number;
}) {
  const has = (t: string) => input.talents.includes(t);
  const damage: TalentNote[] = [];
  const penetration: TalentNote[] = [];
  if (input.kind === 'melee' && has('Сокрушительный удар'))
    damage.push({ talent: 'Сокрушительный удар', value: halfUp(input.nrBonus) });
  if (input.kind === 'ranged') {
    if (has('Сокрушительный выстрел'))
      damage.push({ talent: 'Сокрушительный выстрел', value: halfUp(input.nsBonus) });
    if (input.family === 'bolt' && has('Мастер Болт-оружия')) {
      damage.push({ talent: 'Мастер Болт-оружия', value: halfUp(input.nsBonus) });
      penetration.push({ talent: 'Мастер Болт-оружия', value: halfUp(input.nsBonus) });
    }
    if (input.family === 'las' && has('Мастер Лаз-оружия'))
      damage.push({ talent: 'Мастер Лаз-оружия', value: halfUp(Math.max(0, input.degrees)) });
    if (input.family === 'plasma' && has('Мастер Плазменного оружия')) {
      damage.push({ talent: 'Мастер Плазменного оружия', value: 2 });
      penetration.push({ talent: 'Мастер Плазменного оружия', value: 2 });
    }
  }
  return {
    damage: damage.filter((n) => n.value !== 0),
    penetration: penetration.filter((n) => n.value !== 0),
  };
}

/**
 * Attack test modifiers from talents: «Меткий выстрел», «Снайпер» (ranged) and «Верный удар»,
 * «Точный удар» (melee) — each −10 to the called-attack penalty, never above 0 (ruling 122);
 * «Знаток Болт-оружия» +5 НС with bolt weapons.
 */
export function talentAttackModifiers(input: {
  readonly talents: readonly string[];
  readonly kind: 'ranged' | 'melee';
  readonly family: WeaponFamily;
  /** The called-attack penalty (negative), 0 — an ordinary attack. */
  readonly calledPenalty: number;
}): TalentNote[] {
  const has = (t: string) => input.talents.includes(t);
  const out: TalentNote[] = [];
  if (input.calledPenalty < 0) {
    let room = -input.calledPenalty;
    const reducers =
      input.kind === 'ranged' ? ['Меткий выстрел', 'Снайпер'] : ['Верный удар', 'Точный удар'];
    for (const t of reducers)
      if (has(t) && room > 0) {
        const v = Math.min(10, room);
        out.push({ talent: t, value: v });
        room -= v;
      }
  }
  if (input.kind === 'ranged' && input.family === 'bolt' && has('Знаток Болт-оружия'))
    out.push({ talent: 'Знаток Болт-оружия', value: 5 });
  return out;
}

/** «Калечащий удар / выстрел»: +2 to the critical consequence die (ruling 123). */
export function criticalBonus(talents: readonly string[], kind: 'ranged' | 'melee'): number {
  return talents.includes(kind === 'melee' ? 'Калечащий удар' : 'Калечащий выстрел') ? 2 : 0;
}

/** «Универсальный солдат»: the penalty for an unfamiliar weapon is 10 lower (−30 → −20). */
export function unfamiliarWeaponPenalty(talents: readonly string[], base: number): number {
  return talents.includes('Универсальный солдат') ? Math.min(0, base + 10) : base;
}

/** «Знаток Мельта-оружия»: the optimal range of melta weapons is НС × 2 m longer (ruling 124). */
export function meltaRangeBonus(talents: readonly string[], ns: number): number {
  return talents.includes('Знаток Мельта-оружия') ? ns * 2 : 0;
}
