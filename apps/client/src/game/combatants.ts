import type {
  Characteristics,
  CombatActorRuntime,
  MeleeActorState,
  MeleeWeaponInstance,
  WeaponInstance,
  AmmoContainerInstance,
  FireMode,
} from '@kadat/contracts';
import { hasTrait, impliedTraits, meltaRangeBonus } from '@kadat/rules-engine';
import { isLoadedLauncher, weaponTraits } from './arsenal';
import type { ArsenalWeapon } from '../../../../packages/canonical-data/src/arsenal';
import { battleWeapons, combatant, actorIds, type ActorId, type Battle } from './model';
import { currentSkr, type CharacterDocument } from './character';
import { canonicalTalents } from './talents';

/**
 * Builds the rules-engine runtime of every participant from its character (step 4): the
 * characteristics, СКР, and the Arsenal weapons as engine weapon instances with their
 * properties. Nothing is added that the character or the Arsenal does not say.
 */
export const release = 'kadat-arsenal-and-profiles';
export const engineSource = { kind: 'canonical-data', id: 'Арсенал Кадата + персонажи' };
export const engineProvenance = {
  source: engineSource,
  reason: 'Character from the library and Arsenal records (author rulings 47–53, 74–76)',
};
const ref = (actorId: string) => ({ actorId });

export function characteristicsOf(c: CharacterDocument): Characteristics {
  return Object.fromEntries(
    Object.entries(c.characteristics).map(([k, v]) => [
      k,
      { baseValue: v.value, baseSuper: v.super },
    ]),
  ) as Characteristics;
}
/** Characteristic bonus with the Super-characteristic (ruling 74: бСЛ + СверхСЛ). */
export const bonusOf = (c: CharacterDocument, key: keyof CharacterDocument['characteristics']) =>
  Math.floor(c.characteristics[key].value / 10) + c.characteristics[key].super;

export function actorRuntime(b: Battle, id: ActorId): CombatActorRuntime {
  const c = combatant(b, id).character;
  return {
    actor: ref(id),
    characteristics: characteristicsOf(c),
    movement: currentSkr(c),
    fatigue: 0,
    posture: 'standing',
    effects: [],
    talents: canonicalTalents(c.talents),
  } as CombatActorRuntime;
}

const MELEE_CLASSES = ['ББ'];
const RANGED_CLASSES = ['П', 'ОС', 'ТО', 'СТ'];
export type WeaponKind = 'ranged' | 'melee';

/** «10хБС», «БС*5»: the multiplier of the Strength bonus in a range formula, or null. */
export function strengthRangeMultiplier(w: ArsenalWeapon): number | null {
  if (!w.range.formula) return null;
  const t = w.range.text.replace(/\s/g, '');
  const m = /^(\d+)[хxХX*]БС$/.exec(t) ?? /^БС[хxХX*](\d+)$/.exec(t);
  return m ? Number(m[1]) : null;
}
/** Thrown weapons: the range is a multiple of бСЛ (ruling 154). */
export function thrownMultiplier(w: ArsenalWeapon): number | null {
  return w.weaponClass === 'Метательное' ? strengthRangeMultiplier(w) : null;
}
export const isThrown = (w: ArsenalWeapon | null) => !!w && w.weaponClass === 'Метательное';
/** Maximum throw distance of a battle weapon in metres: multiplier × бСЛ of the owner (ruling 154). */
export function throwRange(b: Battle, weaponId: string): number | null {
  const w = battleWeapons(b).find((x) => x.id === weaponId);
  const k = w?.arsenal ? thrownMultiplier(w.arsenal) : null;
  return w && k !== null ? k * bonusOf(combatant(b, w.owner).character, 'СЛ') : null;
}
/** Why an Arsenal weapon cannot be used by the combat engine yet; null — usable. */
export function weaponProblem(w: ArsenalWeapon | null): string | null {
  if (!w) return 'Оружия нет в Арсенале (решение 76: в бою только оружие Арсенала)';
  if (isThrown(w)) {
    if (thrownMultiplier(w) === null) return 'Дальность броска не прочитана';
    // No damage in the Arsenal («-»): only the properties act; ББ «-» is 0 (ruling 155).
    if (w.damage && ![5, 10].includes(w.damage.sides)) return 'Урон не в к5/к10';
    return null;
  }
  if (w.ammoDependent) return 'Урон зависит от боеприпаса — выберите боеприпас в редакторе';
  // No damage in the Arsenal («-», nets): only the properties act; ББ «-» is 0 (ruling 155).
  const propertiesOnly =
    !w.damage &&
    RANGED_CLASSES.includes(w.weaponClass) &&
    (w.weaponClass !== 'СТ' || isLoadedLauncher(w));
  if (!w.damage && !propertiesOnly) return 'В Арсенале нет урона';
  if (w.damage && ![5, 10].includes(w.damage.sides)) return 'Урон не в к5/к10';
  if (w.penetration === null && !propertiesOnly && MELEE_CLASSES.includes(w.weaponClass))
    return 'В Арсенале нет ББ';
  if (MELEE_CLASSES.includes(w.weaponClass)) {
    if (w.range.meters === null) return 'Дистанция удара не прочитана';
    return null;
  }
  if (!RANGED_CLASSES.includes(w.weaponClass))
    return `Класс «${w.weaponClass}» в бою пока не поддержан`;
  // Bows: «БС*10» — the range is a multiple of the owner's бСЛ (ruling 164).
  if (w.range.meters === null && strengthRangeMultiplier(w) === null)
    return 'Дистанция не прочитана (формула от бСЛ)';
  if (!w.rof || (!w.rof.single && !w.rof.short && !w.rof.long))
    return 'Режимы стрельбы не прочитаны';
  if (w.magazine === null) return 'Нет магазина в Арсенале';
  return null;
}
export const weaponKind = (w: ArsenalWeapon): WeaponKind =>
  MELEE_CLASSES.includes(w.weaponClass) ? 'melee' : 'ranged';

export function fireModes(w: ArsenalWeapon): { mode: FireMode; maxShots: number }[] {
  const out: { mode: FireMode; maxShots: number }[] = [];
  if (w.rof?.single) out.push({ mode: 'single', maxShots: 1 });
  if (w.rof?.short) out.push({ mode: 'short-burst', maxShots: w.rof.short });
  if (w.rof?.long) out.push({ mode: 'full-auto', maxShots: w.rof.long });
  return out;
}

function rangedInstance(
  id: string,
  owner: ActorId,
  w: ArsenalWeapon,
  /** Thrown weapons: 10 × бСЛ of the owner (ruling 154). */
  rangeOverride?: number,
): WeaponInstance {
  const source = { kind: 'arsenal', id: `${w.sheet}, стр. ${w.source.row}: ${w.name}` };
  return {
    id,
    owner: ref(owner),
    readied: true,
    modifications: [],
    jammed: false,
    loadedContainerId: `${id}:mag`,
    template: {
      id: `${id}:profile`,
      canonical: { releaseId: release, templateId: w.id, templateVersion: 'arsenal' },
      provenance: { source, reason: 'Arsenal record' },
      properties: [],
      effects: [],
      traits: impliedTraits(weaponTraits(w).traits),
      profile: {
        weaponClass: w.weaponClass,
        optimalRange: rangeOverride ?? w.range.meters!,
        classification: w.damage?.type === 'Э' ? 'energy-beam' : 'kinetic',
        modes: fireModes(w),
        ...(w.modeModifiers ? { modeModifiers: w.modeModifiers } : {}),
        damage: {
          source,
          // No damage («-», ruling 155): the core still needs a die; the polygon rolls none
          // (engine `damageExpression`).
          expression: w.damage
            ? { count: w.damage.count, sides: w.damage.sides, modifier: w.damage.modifier }
            : { count: 1, sides: 10, modifier: 0 },
        },
        penetration: { source, value: w.penetration ?? 0 },
        compatibleAmmoTypes: ['arsenal-ammo'],
        compatibleContainerTypes: ['arsenal-magazine'],
        capacityReference: source,
        reload: { source, odCost: w.reload?.od ?? 1 },
        malfunction: 'generic-jam',
      },
    },
  };
}
function magazine(id: string, w: ArsenalWeapon, rounds: number): AmmoContainerInstance {
  return {
    id: `${id}:mag`,
    type: 'arsenal-magazine',
    compatibleWeaponTemplateIds: [`${id}:profile`],
    capacity: w.magazine!,
    currentRounds: rounds,
    ammo: { source: engineSource, type: 'arsenal-ammo', effects: [] },
    state: 'ready',
    provenance: engineProvenance,
  };
}
function meleeInstance(id: string, owner: ActorId, w: ArsenalWeapon): MeleeWeaponInstance {
  const source = { kind: 'arsenal', id: `${w.sheet}, стр. ${w.source.row}: ${w.name}` };
  const twoHanded = /2р/.test(w.classNote ?? '');
  return {
    id,
    owner: ref(owner),
    held: true,
    readied: true,
    dropped: false,
    modifications: [],
    template: {
      id: `${id}:profile`,
      canonical: { releaseId: release, templateId: w.id, templateVersion: 'arsenal' },
      provenance: { source, reason: 'Arsenal record' },
      effects: [],
      traits: impliedTraits(weaponTraits(w).traits),
      profile: {
        source,
        family: 'arsenal',
        handedness: twoHanded ? 'two-handed' : 'one-handed',
        validGrips: [twoHanded ? 'two-handed' : 'one-handed'],
        reach: w.range.meters!,
        damage: {
          source,
          expression: {
            count: w.damage!.count,
            sides: w.damage!.sides,
            modifier: w.damage!.modifier,
          },
        },
        penetration: { source, value: w.penetration! },
        parryEligible: true,
        properties: [],
      },
    },
  };
}
/** Placeholder for a participant without a melee weapon; the engine never strikes with it. */
function bareHands(owner: ActorId): MeleeWeaponInstance {
  const source = { kind: 'canonical', id: 'Механика / Бой: Кулаки 1к5−3 У' };
  return {
    id: `${owner}:hands`,
    owner: ref(owner),
    held: false,
    readied: false,
    dropped: false,
    modifications: [],
    template: {
      id: `${owner}:hands:profile`,
      canonical: { releaseId: release, templateId: 'hands', templateVersion: 'mechanics' },
      provenance: { source, reason: 'No melee weapon: unarmed attacks are not supported yet' },
      effects: [],
      profile: {
        source,
        family: 'natural',
        handedness: 'one-handed',
        validGrips: ['one-handed'],
        reach: 1,
        damage: { source, expression: { count: 1, sides: 5, modifier: -3 } },
        penetration: { source, value: 0 },
        parryEligible: false,
        properties: [],
      },
    },
  };
}

/**
 * Engine weapons of the battle. Every weapon is in hand and ready at the start of the fight
 * (the polygon does not track drawing weapons yet).
 */
export function engineWeapons(b: Battle) {
  const ranged: Record<string, WeaponInstance> = {};
  const containers: Record<string, AmmoContainerInstance> = {};
  const melee: Record<string, MeleeWeaponInstance> = {};
  const meleeActors: Record<string, MeleeActorState> = {};
  for (const w of battleWeapons(b)) {
    if (!w.arsenal || weaponProblem(w.arsenal)) continue;
    if (weaponKind(w.arsenal) === 'ranged') {
      const thrown = strengthRangeMultiplier(w.arsenal);
      const instance = rangedInstance(
        w.id,
        w.owner,
        w.arsenal,
        thrown !== null ? thrown * bonusOf(combatant(b, w.owner).character, 'СЛ') : undefined,
      );
      // «Знаток Мельта-оружия»: optimal range + НС × 2 m (ruling 124).
      const owner = combatant(b, w.owner).character;
      const extra = hasTrait(instance.template.traits ?? [], 'Мельта')
        ? meltaRangeBonus(canonicalTalents(owner.talents), owner.characteristics.НС.value)
        : 0;
      ranged[w.id] = extra
        ? {
            ...instance,
            template: {
              ...instance.template,
              profile: {
                ...instance.template.profile,
                optimalRange: instance.template.profile.optimalRange + extra,
              },
            },
          }
        : instance;
      // Thrown items: the «magazine» is how many are carried (ruling 154).
      containers[`${w.id}:mag`] = isThrown(w.arsenal)
        ? { ...magazine(w.id, w.arsenal, b.ammo[w.id] ?? w.count), capacity: Math.max(1, w.count) }
        : magazine(w.id, w.arsenal, b.ammo[w.id] ?? w.arsenal.magazine!);
    } else melee[w.id] = meleeInstance(w.id, w.owner, w.arsenal);
  }
  for (const id of actorIds(b)) {
    const c = combatant(b, id).character;
    let weaponId = Object.values(melee).find((m) => m.owner.actorId === id)?.id;
    if (!weaponId) {
      const hands = bareHands(id);
      melee[hands.id] = hands;
      weaponId = hands.id;
    }
    const skill = (name: string, key: 'СЛ' | 'ЛВ') => {
      const s = c.skills.find((x) => x.name.toLowerCase() === name.toLowerCase());
      return s ? c.characteristics[key].value + s.bonus : null;
    };
    meleeActors[id] = {
      weaponId,
      stance: 'standard',
      grip: melee[weaponId]!.template.profile.validGrips[0]!,
      sizeCategory: Math.max(0, c.size),
      skills: {
        athletics: {
          baseValue: skill('Атлетика', 'СЛ') ?? c.characteristics.СЛ.value,
          finalSuper: c.characteristics.СЛ.super,
          provenance: engineProvenance,
        },
        acrobatics: {
          baseValue: skill('Акробатика', 'ЛВ') ?? 0,
          finalSuper: c.characteristics.ЛВ.super,
          provenance: engineProvenance,
        },
      },
      meleeOnlyReactionRemaining: 0,
      palisadeSpent: false,
    };
  }
  return { ranged, containers, melee, meleeActors };
}

/** The chosen fire mode if the weapon has it, otherwise its first mode (null — not ranged). */
export function modeFor(w: ArsenalWeapon | null, mode: FireMode): FireMode | null {
  if (!w || weaponProblem(w) || weaponKind(w) !== 'ranged') return null;
  const modes = fireModes(w);
  return (modes.find((m) => m.mode === mode) ?? modes[0])?.mode ?? null;
}
