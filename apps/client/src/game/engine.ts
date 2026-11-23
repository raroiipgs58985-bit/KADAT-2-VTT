import type {
  BleedingActivity,
  CalledLocation,
  CombatActionState,
  CombatSession,
  DamageInput,
  DiceRoll,
  DiceSource,
  FireMode,
  MeleeHitRecord,
  ProtectionRuntimeState,
  RangedAttackResult,
  Suppressed,
  ResolutionContext,
  WeaponTraitReference,
  WoundRuntimeState,
  DamageResolutionResult,
} from '@kadat/contracts';
import {
  adjustDamageDice,
  dropWeapon as coreDropWeapon,
  pickUpWeapon as corePickUpWeapon,
  putInHand,
  readyWeapon as coreReadyWeapon,
  QUICK_DRAW_TALENT,
  RAPID_RELOAD_TALENT,
  clearMalfunction,
  reloadWeapon as coreReloadWeapon,
  HEAVY_FROM_HANDS_TALENT,
  braceWeapon as coreBraceWeapon,
  armourAfterProperties,
  beginActionRound,
  beginActionTurn,
  createActionState,
  createCombatSession,
  createWoundRuntime,
  damageBonus,
  damageInputFromHit,
  emptyActionContext,
  enduranceBonusAfterProperties,
  finishActionTurn,
  hasTrait,
  parryOptions,
  impliedTraits,
  initializeMeleeState,
  resolveCombatAction,
  resolveWoundCheck,
  resolveDamageRoll,
  resolveMeleeAttack,
  resolvePostDamage,
  resolveProtectionDamage,
  resolveRangedAttack,
  resolveWoundAwareAction,
  resolveWoundRoundEnd,
  resolveWoundTurnStart,
  resolveSuppression,
  resolveSuppressionTurnStart,
  suppressionEventFromRanged,
  suppressionTrigger,
  rollDie,
  strengthRequirement,
} from '@kadat/rules-engine';
import {
  actorIds,
  actorName,
  fpOf,
  posOf,
  append,
  combatant,
  maxWounds,
  move,
  planRoute,
  placementProblemFor,
  sceneGeometry,
  tokenConflicts,
  weaponOf,
  type ActorId,
  type Battle,
  type Side,
  type WeaponId,
} from './model';
import {
  actorRuntime,
  bonusOf,
  engineProvenance,
  engineSource,
  engineWeapons,
  release,
  fireModes,
  weaponKind,
  weaponProblem,
  type WeaponKind,
} from './combatants';
import { weaponById, weaponTraits } from './arsenal';
import { canonicalTalents } from './talents';
import { characterProblems, type CharacterDocument } from './character';
import { rulings } from './rulings';
import {
  cellKey,
  cellsOf,
  footprintForSize,
  placementProblem,
  validateFootprint,
  type Footprint,
} from './grid';
import { mapProblems, segmentLine, type MapDocument } from './map';
import {
  buildGeometry,
  footprintGeometryProblem,
  initialDoorStates,
  sightLineBlocker,
} from './geometry';
import { storeSnapshot } from './snapshots';

const source = engineSource;
const provenance = engineProvenance;
const ref = (actorId: string) => ({ actorId });
/** A question to the GM asked in the middle of an action; the answer resumes it (step 4). */
export interface GmQuestion {
  /** Stable key: the answer is stored under it in the command. */
  key: string;
  text: string;
  /** Fixed choices; absent — a whole number between min and max. */
  options?: { label: string; value: number }[];
  min?: number;
  max?: number;
}
export interface EngineState {
  wounds: WoundRuntimeState;
  protection: ProtectionRuntimeState;
  /** Suppression conditions and processed source events («Бой» A10–A15). */
  suppression: { suppressed: Suppressed[]; processedEventIds: string[] };
  /** ОБ lost by armour zones (e.g. «Цепное»), key `${actor}:${zone}`. */
  armorLoss: Record<string, number>;
  committed: string[];
  pending?: { command: AttackCommand; prefix: DiceRoll[]; reason: string; question?: GmQuestion };
  pendingTurn?: { prefix: DiceRoll[]; reason: string; kind?: 'start' };
  /** Committed movement actions; used only to detect a repeated free move in one turn. */
  moves: { turn: number; actor: ActorId; mode: MoveMode }[];
  /** A runner failed the ЛВ test on difficult terrain: the GM picks where they fall (ruling 42). */
  pendingFall?: { actor: ActorId; commandId: string; zone: string };
}
export interface AttackCommand {
  id: string;
  actor: ActorId;
  target: ActorId;
  weapon: WeaponId;
  /** Ranged fire mode and declared shots; single shot by default. */
  mode?: FireMode;
  shots?: number;
  targetActivity: BleedingActivity;
  modifier?: number;
  /** Reaction of the target: none, Dodge (ЛВ, «Уклонение») or Parry (НР, «Парирование»). */
  defense: 'DECLINE' | 'DODGE' | 'PARRY';
  /**
   * «Избирательная атака» (2 ОД, «Бой» A52): a single shot or blow at the chosen location with
   * its modifier (Глаза −50, Голова −20, Руки −20, Торс −10, Ноги −15, Сочленения −40).
   */
  calledLocation?: CalledLocation;
  /** GM answers to questions asked during this attack, by question key. */
  answers?: Record<string, number>;
}
export class ContextRequired extends Error {
  override readonly name = 'ContextRequired';
}
/** The action needs a GM answer; dice already rolled are kept and the action resumes. */
export class QuestionRequired extends ContextRequired {
  constructor(readonly question: GmQuestion) {
    super(question.text);
  }
}
function ask(command: AttackCommand, question: GmQuestion): number {
  const answer = command.answers?.[question.key];
  if (answer === undefined) throw new QuestionRequired(question);
  if (!Number.isInteger(answer)) throw new Error('Ответ ведущего должен быть целым числом');
  return answer;
}
const engines = new WeakMap<Battle, EngineState>();
/** What the next die of an attack is rolled for; read by the dice tape for the GM view. */
type RollPhase = 'turn' | 'attack' | 'suppression' | 'damage' | 'consequence';
let rollPhase: RollPhase = 'attack';
const setPhase = (p: RollPhase) => {
  rollPhase = p;
};
/** GM view: why a die was rolled, from the step of the attack and the die size. */
export function rollPurpose(phase: RollPhase, sides: number): string {
  if (phase === 'turn') return 'начало хода';
  if (phase === 'attack')
    return sides === 100 ? 'тест попадания' : sides === 2 ? 'сторона попадания' : 'атака';
  if (phase === 'suppression') return 'тест подавления (СВ)';
  if (phase === 'damage') return 'урон';
  return sides === 100
    ? 'тест последствия ранения'
    : sides === 2
      ? 'сторона (последствие ранения)'
      : 'бросок последствия ранения';
}
/** A short Russian line for intents the wound core cannot finish on its own. */
const intentText = (intents: readonly unknown[]) =>
  `Ранение ждёт решения: ${intents
    .map((i) => {
      const x = i as { type?: string; reason?: string };
      return [x.type, x.reason].filter(Boolean).join(' — ');
    })
    .join('; ')}`;

function participants(b: Battle, rolls?: DiceSource): CombatSession {
  const entries = actorIds(b).map((id) => ({
    actor: ref(id),
    agilityBonus: bonusOf(combatant(b, id).character, 'ЛВ'),
    reactions: { capacity: 1, remaining: 1 },
  }));
  if (rolls) return createCombatSession('local-combat', release, entries, rolls).result;
  // Before the fight: no initiative is rolled yet, the order is the roster order.
  return {
    id: 'local-combat',
    canonicalReleaseId: release,
    roundNumber: 1,
    phase: 'ready',
    cursor: 0,
    activeActor: null,
    turn: null,
    turnsStarted: 0,
    conditions: [],
    // Equal sentinel entries only satisfy the session schema; the real roll happens at start.
    initiativeOrder: entries.map((e) => ({
      ...e,
      agilityBonus: 0,
      roll: { sides: 10, value: 1 },
      initiative: 1,
    })),
  };
}
export function getEngine(b: Battle): EngineState {
  const existing = engines.get(b);
  if (existing) return existing;
  const ids = actorIds(b);
  const actors = Object.fromEntries(ids.map((id) => [id, actorRuntime(b, id)]));
  const w = engineWeapons(b);
  let combat = createActionState(participants(b), actors, w.ranged, w.containers);
  combat = initializeMeleeState(combat, w.meleeActors, w.melee);
  // In hand at the start: the first usable weapon of each participant (ruling 81 — others
  // are put away and taken for 1 ОД).
  for (const id of ids) {
    const first = Object.keys(w.ranged)
      .concat(Object.keys(w.melee).filter((m) => w.melee[m]!.template.profile.family !== 'natural'))
      .filter((wid) => wid.startsWith(`${id}:`))
      .sort((a, b) => Number(a.split(':')[1]) - Number(b.split(':')[1]))[0];
    combat = putInHand(combat, id, first ?? null);
  }
  const state: EngineState = {
    wounds: createWoundRuntime(
      combat,
      Object.fromEntries(
        ids.map((id) => [
          id,
          { maxWounds: maxWounds(b, id), damageTaken: maxWounds(b, id) - b.hp[id]! },
        ]),
      ),
    ),
    protection: { sources: {}, covers: {}, fields: [], resolvedHitIds: [] },
    armorLoss: {},
    suppression: { suppressed: [], processedEventIds: [] },
    committed: [],
    moves: [],
  };
  engines.set(b, state);
  return state;
}
/** Drops the cached engine (roster changed before the fight). */
export const resetEngine = (b: Battle) => engines.delete(b);
function context(combat: CombatActionState, id: string, target?: string): ResolutionContext {
  return {
    ...emptyActionContext(ref(id)),
    ...(target ? { targetActor: ref(target) } : {}),
    roundNumber: combat.session.roundNumber,
    turnNumber: combat.session.turnsStarted,
    tags: ['physical', 'vision'],
  };
}
function sync(b: Battle, state: EngineState) {
  for (const id of actorIds(b)) b.hp[id] = maxWounds(b, id) - state.wounds.actors[id]!.damageTaken;
  for (const w of Object.values(state.wounds.combat.weapons)) {
    const c = w.loadedContainerId ? state.wounds.combat.containers[w.loadedContainerId] : undefined;
    b.ammo[w.id] = c ? c.currentRounds : 0;
  }
  const active = state.wounds.combat.session.activeActor?.actorId;
  if (active) b.active = active;
  engines.set(b, state);
}
function begin(state: EngineState, rng: DiceSource, logs: unknown[]) {
  if (state.wounds.combat.session.phase === 'turn-active') return;
  const started = beginActionTurn(state.wounds.combat);
  logs.push(...started.logs);
  state.wounds = { ...state.wounds, combat: started.state };
  const id = started.state.session.activeActor!.actorId;
  // No movement occurs during this hook: REST is explicit, later physical actions
  // have their own supplied activity and checks. This does not move tokens.
  const hooked = resolveWoundTurnStart(
    state.wounds,
    ref(id),
    context(started.state, id),
    { provenance, activity: 'REST' },
    rng,
  );
  logs.push(...hooked.logs);
  if (hooked.status !== 'RESOLVED')
    throw new ContextRequired(JSON.stringify(hooked.pendingIntents));
  state.wounds = hooked.state;
  // Suppressed at the start of the own turn: 1 ОД and −20 НС, a Will test from the 2nd turn.
  const sup = resolveSuppressionTurnStart(
    {
      combat: state.wounds.combat,
      equipment: [],
      suppressed: state.suppression.suppressed,
      processedEventIds: state.suppression.processedEventIds,
    },
    ref(id),
    context(state.wounds.combat, id),
    rng,
    state.wounds,
  );
  logs.push(...sup.logs);
  if (sup.status !== 'RESOLVED') throw new ContextRequired(intentText(sup.pending ?? []));
  state.wounds = { ...state.wounds, combat: sup.state.combat };
  state.suppression = {
    suppressed: [...sup.state.suppressed],
    processedEventIds: [...sup.state.processedEventIds],
  };
}

type Zone = 'head' | 'torso' | 'arms' | 'legs';
const zoneOf = (location: string): Zone | null =>
  location === 'Head'
    ? 'head'
    : location === 'Torso'
      ? 'torso'
      : location.includes('Arm')
        ? 'arms'
        : location.includes('Leg')
          ? 'legs'
          : null;
const zoneName: Record<Zone, string> = {
  head: 'голова',
  torso: 'торс',
  arms: 'руки',
  legs: 'ноги',
};
/**
 * ОБ of the hit location from the character (profile or armour items) minus the loss in this
 * fight. Eyes and joints without an undersuit — the GM gives the ОБ (ruling 75).
 */
function zoneArmour(b: Battle, state: EngineState, command: AttackCommand, location: string) {
  const c = combatant(b, command.target).character;
  const zone = zoneOf(location);
  if (!zone) {
    const under = Object.values(c.undersuit).filter((v): v is number => v !== null);
    const hint = under.length ? ` Поддоспешник по зонам: ${under.join('/')}.` : '';
    const ob = ask(command, {
      key: `armour:${location}`,
      text: `${c.name}: попадание в «${location === 'Eyes' ? 'Глаза' : 'Сочленения'}». Сколько ОБ здесь? (решение 75)${hint}`,
      min: 0,
      max: 99,
    });
    return { key: `${command.target}:${location}`, ob, base: ob, loss: 0, zone: null };
  }
  const key = `${command.target}:${zone}`;
  const base = c.armour[zone];
  const loss = state.armorLoss[key] ?? 0;
  return { key, ob: Math.max(0, base - loss), base, loss, zone };
}
function protectionFor(state: EngineState, input: DamageInput, ob: number) {
  const id = `armor:${input.target.actorId}:${input.location}`;
  return {
    ...state.protection,
    sources: {
      [id]: {
        id,
        owner: input.target,
        active: true,
        definition: {
          id,
          source,
          provenance: { source, reason: 'Zone ОБ of the character after weapon properties' },
          kind: 'worn-armor' as const,
          ob,
          zones: [input.location],
          tags: [],
          penetrationMode: 'WEAPON_BB' as const,
          compatibleWithTemplateIds: [],
        },
      },
    },
  };
}
function postDamage(
  state: EngineState,
  damage: DamageResolutionResult,
  command: AttackCommand,
  rng: DiceSource,
  logs: unknown[],
) {
  const result = resolvePostDamage(
    {
      state: state.wounds,
      damage,
      context: context(state.wounds.combat, command.target, command.actor),
      facts: {
        provenance,
        activity: command.targetActivity,
        ...(zoneOf(damage.input.location)
          ? {}
          : {
              consequenceZone: (['HEAD', 'TORSO', 'ARM', 'LEG'] as const)[
                ask(command, {
                  key: `consequence-zone:${damage.input.location}`,
                  text: `Попадание в «${damage.input.location === 'Eyes' ? 'Глаза' : 'Сочленения'}»: по какой таблице ранений считать последствия? (правило не утверждено)`,
                  options: [
                    { label: 'Голова', value: 0 },
                    { label: 'Торс', value: 1 },
                    { label: 'Рука', value: 2 },
                    { label: 'Нога', value: 3 },
                  ],
                })
              ]!,
            }),
      },
    },
    rng,
  );
  logs.push(...result.logs);
  if (result.result.status !== 'RESOLVED')
    throw new ContextRequired(intentText(result.result.pendingIntents));
  state.wounds = result.result.status === 'RESOLVED' ? result.state : state.wounds;
  return result.result;
}
const sum = (rolls: readonly DiceRoll[]) => rolls.reduce((s, r) => s + r.value, 0);

/** Properties the polygon does not apply automatically yet: shown to the GM after the hit. */
const MANUAL_PROPERTIES = new Set([
  'Деструктор',
  'Оглушающее',
  'Ослепляющее',
  'Шоковое',
  'Опутывающее',
  'Контузия',
  'Калечащее',
  'Токсичное',
  'Огненное',
  'Галлюциногенное',
  'Проникающее',
  'Рад',
  'Мгновенная смерть',
  'Плавящее',
  'Взрыв',
  'Спрей',
  'Коррозийное',
  'Гравитонное',
  'Частичное опутывание',
]);

/**
 * Context of the target's reaction with its skill (ruling 49): the skill bonus is added;
 * without the skill the GM chooses the penalty (asked once per attack).
 */
function reactionContext(
  b: Battle,
  state: EngineState,
  command: AttackCommand,
  skillName: 'Уклонение' | 'Парирование',
  extra: { id: string; value: number; reason: string }[] = [],
): ResolutionContext {
  const target = combatant(b, command.target).character;
  const skill = target.skills.find((s) => s.name.toLowerCase() === skillName.toLowerCase());
  const value =
    skill?.bonus ??
    ask(command, {
      key: `untrained:${skillName}`,
      text: `${target.name}: нет навыка «${skillName}». Какой штраф к тесту? (решение 49: выбирает ведущий, например −20 или −30)`,
      min: -60,
      max: 0,
    });
  const gm = { kind: 'gm', id: `${skillName}: ${skill ? 'навык' : 'штраф ведущего'}` };
  const mods = [{ id: `${command.id}:skill:${skillName}`, value, reason: gm.id }, ...extra].filter(
    (m) => m.value !== 0,
  );
  return {
    ...context(state.wounds.combat, command.target, command.actor),
    modifiers: mods.map((m) => ({
      id: m.id,
      value: m.value,
      source: gm,
      provenance: { source: gm, reason: m.reason },
    })),
  };
}

/**
 * Parry with the target's melee weapon in hand: «Парирование» skill (ruling 49) and the
 * properties of both weapons (Гибкое cannot be parried, Громоздкое, Сбалансированное …).
 */
function parryRequest(
  b: Battle,
  state: EngineState,
  command: AttackCommand,
  attackingTraits: readonly WeaponTraitReference[],
) {
  const melee = state.wounds.combat.melee!;
  const weaponId = melee.actors[command.target]?.weaponId;
  const weapon = weaponId ? melee.weapons[weaponId] : undefined;
  if (!weapon || !weapon.held || weapon.template.profile.family === 'natural')
    throw new Error('Парировать нечем: у цели нет оружия ближнего боя в руке');
  const options = parryOptions({
    parrying: weapon.template.traits ?? [],
    attacking: attackingTraits,
    strengthBonus: bonusOf(combatant(b, command.target).character, 'СЛ'),
  });
  if (!options.allowed) throw new Error(options.reason ?? 'Парирование невозможно');
  return {
    id: `${command.id}:parry`,
    type: 'parry' as const,
    weaponId: weapon.id,
    pool: 'normal' as const,
    context: reactionContext(
      b,
      state,
      command,
      'Парирование',
      options.modifiers.map((m, i) => ({
        id: `${command.id}:parry-property:${i}`,
        value: m.value,
        reason: `${m.property} (${m.source})`,
      })),
    ),
  };
}

const SUPPRESSION_CLASS: Record<string, 'PISTOL' | 'BASIC' | 'HEAVY'> = {
  П: 'PISTOL',
  ОС: 'BASIC',
  ТО: 'HEAVY',
};
/**
 * Suppression after a shot («Бой» A12–A15): a single shot with 3+ degrees suppresses its target,
 * a burst everyone within 10 m of the target. The GM says for each affected participant whether
 * cover is within СКР (cover rules are not on the map yet). Problems the core cannot settle
 * (an already suppressed target and the like) are shown to the GM and change nothing.
 */
function applySuppression(
  b: Battle,
  state: EngineState,
  command: AttackCommand,
  weaponClass: string,
  result: RangedAttackResult,
  rng: DiceSource,
  logs: unknown[],
) {
  const cls = SUPPRESSION_CLASS[weaponClass];
  if (!cls) return null;
  const event = suppressionEventFromRanged({
    attackId: command.id,
    sourceActor: ref(command.actor),
    primaryTarget: ref(command.target),
    weapon: source,
    weaponClass: cls,
    result,
    provenance,
  });
  const trigger = suppressionTrigger(event);
  if (!trigger.triggered) return null;
  const at = posOf(b, command.target);
  const candidates = actorIds(b)
    .filter((id) => id !== command.actor && state.wounds.actors[id]?.life.status === 'ALIVE')
    .map((id) => {
      const p = posOf(b, id);
      return { id, distance: Math.hypot(p.x - at.x, p.y - at.y) };
    })
    .filter((c) =>
      trigger.radius === null ? c.id === command.target : c.distance <= trigger.radius,
    )
    .map((c) => ({
      actor: ref(c.id),
      distanceFromPrimaryTarget: c.distance,
      nearestCoverWithinSpeed: ask(command, {
        key: `cover:${c.id}`,
        text: `Подавление: у ${actorName(b, c.id)} есть укрытие в пределах СКР? (провал теста СВ — укрыться или лечь)`,
        options: [
          { label: 'Есть', value: 1 },
          { label: 'Нет', value: 0 },
        ],
      })
        ? ('YES' as const)
        : ('NO' as const),
      context: context(state.wounds.combat, c.id, command.actor),
      provenance,
    }));
  if (!candidates.length) return null;
  setPhase('suppression');
  const r = resolveSuppression(
    {
      combat: state.wounds.combat,
      equipment: [],
      suppressed: state.suppression.suppressed,
      processedEventIds: state.suppression.processedEventIds,
    },
    event,
    candidates,
    rng,
    state.wounds,
  );
  logs.push(...r.logs);
  const summary = r.targets
    .filter((t) => t.status !== 'NOT_AFFECTED')
    .map((t) => ({ actor: t.actor.actorId, status: t.status, modifier: t.modifier }));
  if (r.status === 'RESOLVED') {
    state.wounds = { ...state.wounds, combat: r.state.combat };
    state.suppression = {
      suppressed: [...r.state.suppressed],
      processedEventIds: [...r.state.processedEventIds],
    };
  }
  return { status: r.status, targets: summary };
}

/** Damage of one hit: dice, weapon properties, zone armour, endurance and wounds. */
function resolveHit(
  b: Battle,
  state: EngineState,
  command: AttackCommand,
  hit: DamageInput,
  info: {
    kind: WeaponKind;
    degrees: number;
    traits: readonly WeaponTraitReference[];
    weaponClass: string;
    distance: number;
    optimalRange: number;
  },
  rng: DiceSource,
  logs: unknown[],
) {
  const attacker = combatant(b, command.actor).character;
  const target = combatant(b, command.target).character;
  const traits = info.traits;
  const sl = bonusOf(attacker, 'СЛ');
  const armour = zoneArmour(b, state, command, hit.location);
  setPhase('damage');
  const roll = resolveDamageRoll(hit.profile.expression, rng, hit.context).result;
  const dice = adjustDamageDice(traits, roll.rolls, rng);
  const bonus = damageBonus(traits, {
    kind: info.kind,
    degrees: info.degrees,
    strengthBonus: sl,
    distance: info.distance,
    optimalRange: info.optimalRange,
    targetWounds: target.wounds,
    weaponClass: info.weaponClass,
  });
  const extra = Array.from({ length: bonus.extraD10 }, () => rollDie(10, rng));
  const minus = Array.from({ length: bonus.minusD10 }, () => rollDie(10, rng));
  const notes = [...bonus.notes];
  let flat = bonus.flat;
  if (info.kind === 'melee') {
    // Ruling 74: melee damage adds бСЛ with the Super-characteristic.
    flat += sl;
    notes.push(`бСЛ: +${sl}`);
    if (hasTrait(traits, 'Цепное')) {
      // «Цепное»: +½ бСЛ, rounded up (ruling 77).
      const half = Math.ceil(sl / 2);
      flat += half;
      notes.push(`Цепное: +${half} (½ бСЛ вверх)`);
    }
  }
  let total = sum(dice.rolls) + hit.profile.expression.modifier + sum(extra) - sum(minus) + flat;
  const strength = strengthRequirement(traits, sl);
  if (strength.halveDamage) {
    total = Math.ceil(total / 2);
    notes.push('Сила: бСЛ ниже нужного — урон /2');
  }
  total = Math.max(0, total);
  const penetration = hit.penetration.value * bonus.penetrationMultiplier + bonus.penetrationAdd;
  // «Цепное»: the armour element loses ОБ equal to ББ at once (rulings 5, 16).
  if (hasTrait(traits, 'Цепное') && armour.zone) {
    state.armorLoss[armour.key] = (state.armorLoss[armour.key] ?? 0) + penetration;
    armour.ob = Math.max(0, armour.base - state.armorLoss[armour.key]!);
    notes.push(`Цепное: броня (${zoneName[armour.zone]}) −${penetration} ОБ`);
  }
  // Лэнс / Примитивное change the armour before ББ; the core subtracts ББ.
  const ob = armourAfterProperties(traits, {
    armour: armour.ob,
    penetration: 0,
    weaponClass: info.weaponClass,
  });
  const vn = target.characteristics.ВН;
  const rending = enduranceBonusAfterProperties(
    traits,
    Math.floor(vn.value / 10) + vn.super,
    vn.super,
  );
  const endurance = {
    baseValue: vn.value,
    baseSuper: Math.max(0, vn.super - (Math.floor(vn.value / 10) + vn.super - rending)),
  };
  const input: DamageInput = {
    ...hit,
    penetration: { ...hit.penetration, value: penetration },
    transformations: [
      ...hit.transformations,
      ...(total !== roll.rawDamage
        ? [
            {
              id: `${hit.hitId}:properties`,
              type: 'add' as const,
              value: total - roll.rawDamage,
              provenance: { source, reason: notes.join('; ') || 'weapon properties' },
            },
          ]
        : []),
    ],
  };
  const damage = resolveProtectionDamage(
    {
      input,
      state: protectionFor(state, input, ob),
      endurance,
      preRolled: roll,
    },
    {
      roll: () => {
        throw new Error('Unexpected damage reroll');
      },
    },
  );
  const manual = traits.filter((t) => MANUAL_PROPERTIES.has(t.name));
  logs.push(
    {
      type: 'hit-damage',
      location: hit.location,
      dice: roll.rolls,
      adjustedDice: dice.rolls,
      tearing: dice.tearing ?? null,
      extraD10: extra,
      minusD10: minus,
      flat,
      total,
      penetration,
      armour: { ...armour, afterProperties: ob },
      notes,
      manualProperties: manual,
    },
    ...damage.logs,
  );
  if (damage.result.status !== 'RESOLVED')
    throw new ContextRequired(JSON.stringify(damage.result.status));
  state.protection = damage.state;
  setPhase('consequence');
  const wound = postDamage(state, damage.result, command, rng, logs);
  return {
    location: hit.location,
    total,
    penetration,
    armour: ob,
    finalDamage: damage.result.finalDamage ?? 0,
    notes,
    manual: manual.map((t) => (t.value === undefined ? t.name : `${t.name} (${t.value})`)),
    wound,
  };
}

function resolve(
  state: EngineState,
  b: Battle,
  command: AttackCommand,
  rng: DiceSource,
  logs: unknown[],
) {
  combatant(b, command.actor);
  combatant(b, command.target);
  if (command.actor === command.target) throw new Error('Неверные участники атаки');
  const selected = weaponOf(b, command.weapon);
  if (!selected || selected.owner !== command.actor)
    throw new Error('Оружие не принадлежит атакующему');
  const problem = weaponProblem(selected.arsenal);
  if (problem) throw new Error(`${selected.name}: ${problem}`);
  const arsenalWeapon = selected.arsenal!;
  if (state.wounds.combat.session.phase === 'ready')
    throw new Error('Бой ещё не начат: нажмите «Начать бой»');
  setPhase('turn');
  begin(state, rng, logs);
  setPhase('attack');
  if (state.wounds.combat.session.activeActor?.actorId !== command.actor)
    throw new Error('Сейчас ход другого персонажа');
  if (state.wounds.actors[command.actor]!.life.status !== 'ALIVE')
    throw new ContextRequired('Действия в агонии и после смерти не разрешаются.');
  const p = posOf(b, command.actor)!,
    q = posOf(b, command.target)!,
    distance = Math.hypot(p.x - q.x, p.y - q.y);
  let ctx = context(state.wounds.combat, command.actor, command.target);
  if (command.modifier !== undefined) {
    if (!Number.isInteger(command.modifier)) throw new Error('Модификатор должен быть целым');
    ctx = {
      ...ctx,
      modifiers: [
        {
          id: `${command.id}:explicit-test-modifier`,
          value: command.modifier,
          source: { kind: 'gm', id: 'local modifier input' },
          provenance: {
            source: { kind: 'gm', id: 'local modifier input' },
            reason: 'Modifier set by the GM',
          },
        },
      ],
    };
  }
  const kind = weaponKind(arsenalWeapon);
  const traits = impliedTraits(weaponTraits(arsenalWeapon).traits);
  const info = {
    kind,
    traits,
    weaponClass: arsenalWeapon.weaponClass,
    distance,
    optimalRange: arsenalWeapon.range.meters!,
  };
  const hits: DamageInput[] = [];
  let attack: unknown, degrees: number;
  let reaction: unknown = null;
  let suppression: unknown = null;
  if (kind === 'ranged') {
    const mode = command.mode ?? 'single';
    // Ruling 78: a mode fires exactly the weapon's rate (short burst 3 — three shots).
    const rate = fireModes(arsenalWeapon).find((m) => m.mode === mode);
    if (!rate) throw new Error(`${selected.name}: нет режима «${mode}»`);
    const shots = command.calledLocation ? 1 : rate.maxShots;
    const resolved = resolveWoundAwareAction(state.wounds, 'НС', ctx, (combat, context) =>
      resolveRangedAttack(
        combat,
        {
          id: command.id,
          type: command.calledLocation ? 'called-attack' : 'ranged-attack',
          ...(command.calledLocation ? { calledLocation: command.calledLocation } : {}),
          actor: ref(command.actor),
          target: ref(command.target),
          weaponId: command.weapon,
          mode: command.calledLocation ? 'single' : mode,
          shotsRequested: shots,
          distance,
          dodgeable: true,
          ...(command.defense === 'DODGE'
            ? {
                dodge: {
                  id: `${command.id}:dodge`,
                  context: reactionContext(b, state, command, 'Уклонение'),
                },
              }
            : {}),
          context,
        },
        rng,
      ),
    );
    state.wounds = resolved.state;
    logs.push(resolved.projectionLog, ...resolved.resolution.logs);
    const result = resolved.resolution.result;
    attack = result;
    degrees = result.check.totalDegrees;
    hits.push(...result.hits.map((h) => damageInputFromHit(h)));
    if (result.dodge) reaction = result.dodge;
    suppression = applySuppression(b, state, command, arsenalWeapon.weaponClass, result, rng, logs);
  } else {
    const meleeAvoidance =
      command.defense === 'DODGE'
        ? {
            id: `${command.id}:dodge`,
            type: 'dodge' as const,
            pool: 'normal' as const,
            context: reactionContext(b, state, command, 'Уклонение'),
          }
        : command.defense === 'PARRY'
          ? parryRequest(b, state, command, traits)
          : null;
    const resolved = resolveWoundAwareAction(state.wounds, 'НР', ctx, (combat, context) =>
      resolveMeleeAttack(
        combat,
        {
          id: command.id,
          type: 'melee-attack',
          actor: ref(command.actor),
          origin: 'NORMAL',
          base: command.calledLocation ? 'called' : 'simple',
          ...(command.calledLocation ? { calledLocation: command.calledLocation } : {}),
          technique: 'normal',
          weaponId: command.weapon,
          targets: [
            {
              actor: ref(command.target),
              distance,
              ...(meleeAvoidance ? { avoidance: meleeAvoidance } : {}),
            },
          ],
          context,
        },
        rng,
      ),
    );
    state.wounds = resolved.state;
    logs.push(resolved.projectionLog, ...resolved.resolution.logs);
    const target = resolved.resolution.result.targets[0]!;
    attack = target.check;
    degrees = target.check.totalDegrees;
    if (target.hit) hits.push(damageInputFromHit(target.hit as MeleeHitRecord));
    if (target.avoidance) reaction = target.avoidance;
  }
  const damage = hits.map((hit) =>
    resolveHit(b, state, command, hit, { ...info, degrees }, rng, logs),
  );
  return {
    status: 'RESOLVED',
    attack,
    hits: damage,
    reaction: reaction ?? 'declined',
    ...(suppression ? { suppression } : {}),
  };
}

/**
 * Line of sight and attacks through barriers are not approved yet (author questions 15–16,
 * stages 5–6). An attack whose straight line from centre to centre crosses or touches a wall,
 * a closed door or a vision-blocking obstacle stops before any dice; nothing is guessed.
 */
export function attackLineProblem(b: Battle, attacker: ActorId, target: ActorId): string | null {
  const blocker = sightLineBlocker(posOf(b, attacker), posOf(b, target), sceneGeometry(b));
  return blocker
    ? `Ждёт решения автора: линия атаки проходит через ${blocker.label}. Правила линии видимости и атаки сквозь преграды ещё не утверждены (этапы 5–6).`
    : null;
}
/** Local command envelope is atomic; individual accepted resolvers remain unchanged.
 * A pending command retains its full RNG prefix and stable ID for exact continuation. */
export function attack(b: Battle, command: AttackCommand, source: DiceSource, resume = false) {
  const current = getEngine(b);
  if (
    resume &&
    (!current.pending ||
      !(
        [
          'id',
          'actor',
          'target',
          'weapon',
          'mode',
          'shots',
          'calledLocation',
          'targetActivity',
          'modifier',
          'defense',
        ] as const
      ).every((key) => current.pending!.command[key] === command[key]))
  )
    throw new Error('Pending command differs');
  if (current.pendingTurn) throw new Error('Сначала продолжите pending начала хода');
  if (current.committed.includes(command.id)) throw new Error('Команда уже исполнена');
  if (current.pending && !resume) throw new Error('Сначала продолжите сохранённую pending-команду');
  if (!resume) {
    const line = attackLineProblem(b, command.actor, command.target);
    if (line) {
      append(b, 'rejected', {
        command,
        rolls: [],
        reason: line,
        committed: false,
        authorDecisionRequired: true,
      });
      throw new RuleDecisionRequired(line);
    }
  }
  const prefix = resume ? (current.pending?.prefix ?? []) : [],
    used: DiceRoll[] = [];
  let cursor = 0;
  const purposes: string[] = [];
  let attackTests = 0;
  setPhase('attack');
  const rng: DiceSource = {
    roll(sides) {
      const prior = prefix[cursor++];
      if (prior && prior.sides !== sides) throw new Error('Pending dice prefix mismatch');
      const value = prior?.value ?? source.roll(sides);
      used.push({ sides, value });
      // In the attack step the first d100 is the attack test, a later one the target's reaction.
      purposes.push(
        rollPhase === 'attack' && sides === 100 && attackTests++ > 0
          ? 'тест реакции цели (уклонение/парирование)'
          : rollPurpose(rollPhase, sides),
      );
      return value;
    },
  };
  const next = structuredClone(current);
  delete next.pending;
  const logs: unknown[] = [];
  try {
    const result = resolve(next, b, command, rng, logs);
    next.committed.push(command.id);
    sync(b, next);
    append(b, 'attack', {
      command,
      rolls: used,
      rollPurposes: purposes,
      weaponName: weaponOf(b, command.weapon)?.name ?? command.weapon,
      maxHp: maxWounds(b, command.target),
      result,
      coreLogs: logs,
      committed: true,
      hp: b.hp,
      ammo: b.ammo,
    });
    return { status: 'RESOLVED' as const, result };
  } catch (error) {
    if (
      !(error instanceof ContextRequired) &&
      !(error instanceof Error && error.message.startsWith('Expected injected'))
    ) {
      append(b, 'rejected', {
        command,
        rolls: used,
        reason: explainEngineError(error),
        committed: false,
      });
      throw error;
    }
    const reason = String(error instanceof Error ? error.message : error);
    current.pending = {
      command: structuredClone(command),
      prefix: used,
      reason,
      ...(error instanceof QuestionRequired ? { question: error.question } : {}),
    };
    engines.set(b, current);
    append(b, 'CONTEXT_REQUIRED', {
      command,
      rolls: used,
      rollPurposes: purposes,
      reason,
      coreLogs: logs,
      committed: false,
    });
    return { status: 'CONTEXT_REQUIRED' as const, reason };
  }
}
/** Continues the saved attack; `answers` carry the GM's answers to the question asked. */
export function resumeAttack(b: Battle, source: DiceSource, answers: Record<string, number> = {}) {
  const p = getEngine(b).pending;
  if (!p) throw new Error('Нет pending-команды');
  return attack(b, { ...p.command, answers: { ...p.command.answers, ...answers } }, source, true);
}
export function nextTurn(b: Battle, source: DiceSource) {
  const current = getEngine(b);
  if (current.pendingTurn?.kind === 'start') return startCombat(b, source);
  if (current.pending) throw new Error('Pending-команда не завершена');
  const prefix = current.pendingTurn?.prefix ?? [],
    used: DiceRoll[] = [];
  let cursor = 0;
  const tape: DiceSource = {
    roll(sides) {
      const prior = prefix[cursor++];
      if (prior && prior.sides !== sides) throw new Error('Turn prefix mismatch');
      const value = prior?.value ?? source.roll(sides);
      used.push({ sides, value });
      return value;
    },
  };
  const state = structuredClone(current),
    logs: unknown[] = [];
  delete state.pendingTurn;
  try {
    begin(state, tape, logs);
    const finished = finishActionTurn(state.wounds.combat);
    state.wounds = { ...state.wounds, combat: finished.state };
    logs.push(...finished.logs);
    if (state.wounds.combat.session.phase === 'round-ended') {
      const ended = resolveWoundRoundEnd(state.wounds);
      state.wounds = ended.state;
      logs.push(ended.log);
      const started = beginActionRound(state.wounds.combat);
      state.wounds = { ...state.wounds, combat: started.state };
      logs.push(...started.logs);
    }
    begin(state, tape, logs);
    sync(b, state);
    append(b, 'next-turn', { coreLogs: logs, rolls: used, active: b.active });
    return { status: 'RESOLVED' as const };
  } catch (error) {
    if (
      !(error instanceof ContextRequired) &&
      !(error instanceof Error && error.message.startsWith('Expected injected'))
    )
      throw error;
    const reason = String(error instanceof Error ? error.message : error);
    current.pendingTurn = { prefix: used, reason };
    engines.set(b, current);
    append(b, 'TURN_CONTEXT_REQUIRED', { rolls: used, reason, coreLogs: logs, committed: false });
    return { status: 'CONTEXT_REQUIRED' as const, reason };
  }
}
/**
 * Adds a character from the library to the battle before the fight, on the first free cells
 * near `at` (or anywhere on the map). The same character may be added several times (NPC
 * squads); each copy gets its own id.
 */
export function addCombatant(
  b: Battle,
  character: CharacterDocument,
  side: Side,
  at?: { x: number; y: number },
): ActorId {
  if (combatStarted(b)) throw new Error('Участников добавляют до начала боя');
  const problems = characterProblems(character);
  if (problems.length) throw new Error(`Персонаж не готов: ${problems.join('; ')}`);
  let id = character.id;
  for (let n = 2; b.roster[id]; n++) id = `${character.id}-${n}`;
  // Same name already in the fight (a copy or another file of the same character): number it.
  const names = new Set(Object.values(b.roster).map((c) => c.character.name));
  let name = character.name;
  for (let n = 2; names.has(name); n++) name = `${character.name} ${n}`;
  const footprint = footprintForSize(character.size);
  const spot = freeSpot(b, footprint, at);
  if (!spot) throw new Error('На карте нет свободного места для токена');
  b.roster[id] = { id, character: { ...structuredClone(character), name }, side };
  b.positions[id] = spot;
  b.footprints[id] = footprint;
  b.hp[id] = character.wounds;
  character.weapons.forEach((w, i) => {
    b.ammo[`${id}:${i}`] = (w.ref ? weaponById(w.ref)?.magazine : null) ?? null;
  });
  engines.delete(b);
  append(b, 'roster-add', { actor: id, name, side, at: spot, character });
  return id;
}
/** First free placement for a footprint, nearest to `near` (the map centre by default). */
function freeSpot(b: Battle, f: Footprint, near?: { x: number; y: number }) {
  const target = near ?? { x: b.map.cols / 2, y: b.map.rows / 2 };
  let best: { x: number; y: number } | null = null,
    bestD = Infinity;
  for (let row = 0; row + f.height <= b.map.rows; row++)
    for (let col = 0; col + f.width <= b.map.cols; col++) {
      const c = { x: col + f.width / 2, y: row + f.height / 2 };
      const d = Math.hypot(c.x - target.x, c.y - target.y);
      if (d >= bestD) continue;
      const others = new Set<string>();
      for (const id of actorIds(b))
        for (const cell of cellsOf(posOf(b, id), fpOf(b, id))) others.add(cellKey(cell));
      if (placementProblem(c, f, others, b.map) ?? footprintGeometryProblem(c, f, sceneGeometry(b)))
        continue;
      best = c;
      bestD = d;
    }
  return best;
}
export function removeCombatant(b: Battle, id: ActorId) {
  if (combatStarted(b)) throw new Error('Участников убирают до начала боя');
  combatant(b, id);
  delete b.roster[id];
  delete b.positions[id];
  delete b.footprints[id];
  delete b.hp[id];
  for (const k of Object.keys(b.ammo)) if (k.startsWith(`${id}:`)) delete b.ammo[k];
  if (b.active === id) b.active = actorIds(b)[0] ?? '';
  engines.delete(b);
  append(b, 'roster-remove', { actor: id });
}
/**
 * Switches the participant's СКР option (ruling 3: chosen by the player, switched by the GM or
 * the player at any time, e.g. from 5 to 4). The engine uses the new СКР from now on.
 */
export function setMovementOption(b: Battle, id: ActorId, option: number) {
  const c = combatant(b, id);
  const options = c.character.movement.options;
  if (!Number.isInteger(option) || option < 0 || option >= options.length)
    throw new Error('Нет такого варианта СКР');
  const before = options[c.character.movement.current]!;
  b.roster[id] = {
    ...c,
    character: { ...c.character, movement: { ...c.character.movement, current: option } },
  };
  const state = engines.get(b);
  if (state) {
    const runtime = state.wounds.combat.actors[id]!;
    const combat = {
      ...state.wounds.combat,
      actors: {
        ...state.wounds.combat.actors,
        [id]: { ...runtime, movement: options[option]!.skr },
      },
    };
    engines.set(b, { ...state, wounds: { ...state.wounds, combat } });
  }
  append(b, 'skr', { actor: id, option, from: before, to: options[option] });
}
export function setSide(b: Battle, id: ActorId, side: Side) {
  const c = combatant(b, id);
  b.roster[id] = { ...c, side };
  append(b, 'roster-side', { actor: id, side });
}
export function cancelUnstarted(b: Battle) {
  const state = getEngine(b);
  if (!state.pending || state.pending.prefix.length)
    throw new Error(
      'Броски уже сохранены: отмена для переброса запрещена. Продолжите операцию или сбросьте весь тест.',
    );
  delete state.pending;
  append(b, 'cancel-unstarted', { reason: 'No dice or runtime mutations were committed' });
}

// ---------------------------------------------------------------------------
// Tactical scene commands (client v0.3).
// Movement is resolved by the accepted Core `resolveCombatAction`: it validates the turn,
// OD, Reaction and effects, spends resources and returns the permitted distance. The client
// only measures the straight-line distance between continuous map coordinates (metres).

export type MoveMode = 'free-move' | 'half-move' | 'full-move' | 'run' | 'sprint';
export const moveModes: readonly { mode: MoveMode; label: string; cost: string }[] = [
  { mode: 'free-move', label: 'Свободное движение', cost: 'СД' },
  { mode: 'half-move', label: 'Полудвижение (шагом)', cost: '1 ОД' },
  { mode: 'full-move', label: 'Полное движение (быстрым шагом)', cost: '2 ОД' },
  { mode: 'run', label: 'Бег (без оглядки)', cost: '2 ОД + Р' },
  { mode: 'sprint', label: 'Спринт', cost: '2 ОД + Р' },
];
export interface MoveCommand {
  id: string;
  actor: ActorId;
  mode: MoveMode;
  to: { x: number; y: number };
  /** Clicked route points in order, the last one equal to `to` (author ruling 8). */
  route?: { x: number; y: number }[];
  /** Scene revision the move was previewed on; a stale preview is refused, never re-routed. */
  sceneRevision?: number;
}
export interface MoveOption {
  mode: MoveMode;
  label: string;
  cost: string;
  available: boolean;
  /** Distance returned by the accepted Core for this action; null when unavailable. */
  maxDistance: number | null;
  reason?: string;
  blockedBy?: 'author' | 'engine' | 'state';
}
/** An action stops because an author ruling is missing; nothing is committed. */
export class RuleDecisionRequired extends Error {
  override readonly name = 'RuleDecisionRequired';
}
const noDice: DiceSource = {
  roll() {
    throw new Error('Movement actions never consume dice');
  },
};
const coreMessages: [RegExp, string][] = [
  [/Insufficient OD/, 'Недостаточно ОД в этом ходу'],
  [/Unavailable Reaction/, 'Реакция уже потрачена'],
  [/Action requires active own turn/, 'Сейчас не ход этого персонажа'],
  [/Action prohibited by effect/, 'Действие запрещено активным эффектом'],
  [/Reaction prohibited by effect/, 'Реакция запрещена активным эффектом'],
  [/Empty or repeated action ID/, 'Команда с таким ID уже исполнена'],
  [/Second attack requires/, 'В этом ходу атака уже была: разрешена одна атака за ход'],
  [/Free Action already used/, 'Свободное действие (СД) в этом ходу уже использовано'],
  [/unavailable while crawling/, 'Ползком Бег и Спринт недоступны'],
  [
    /Unbraced heavy weapon cannot fire bursts/,
    'Тяжёлое оружие без опоры стреляет только одиночными (−30). Сначала «Установить на опору» (1 ОД, «Бой» A55)',
  ],
  [/Weapon is already braced/, 'Оружие уже установлено на опору'],
  [/not in an appropriate jammed state/, 'Оружие не заклинило'],
  [
    /Invalid actor\/target\/selected weapon|Melee weapon is not owned\/held\/readied|Invalid actor\/selected weapon/,
    'Оружие не в руках: сначала «Взять в руки» (1 ОД, решение 81)',
  ],
  [/Weapon is not in hand/, 'Это оружие не в руках'],
  [
    /Weapon must be picked up/,
    'Оружие на полу или на ремне: его поднимают («Поднять», решение 82)',
  ],
  [/Weapon is not dropped or hanging/, 'Оружие не на полу и не на ремне'],
  [/Parry requires an eligible weapon/, 'Этим оружием нельзя парировать'],
  [/Incoming action is not dodgeable/, 'От этой атаки нельзя уклониться'],
  [/Dodge prohibited by effect/, 'Уклонение запрещено состоянием цели'],
  [/Parry prohibited by effect/, 'Парирование запрещено состоянием цели'],
  [/Insufficient ammunition/, 'Не хватает боезапаса в магазине'],
  [/Jammed weapon cannot fire/, 'Оружие заклинило: сначала исправить осечку'],
  [/Target outside effective melee reach/, 'Цель дальше досягаемости оружия ближнего боя'],
];
const coreErrorPattern =
  /^(Insufficient|Unavailable|Action |Reaction |Empty or repeated|Free Action|Run and Sprint|Second attack|Unbraced|Weapon is|Jammed|Target outside)/;
/** Russian explanation for Core validation errors; the original message is kept. */
export function explainEngineError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const known = coreMessages.find(([pattern]) => pattern.test(message));
  return known ? `${known[1]} (Core: ${message})` : message;
}
function authorBoundary(state: EngineState, actorId: ActorId, mode: MoveMode): string | null {
  if ((mode === 'run' || mode === 'sprint') && rulings.runSprintDistances !== 'mechanics')
    return 'Ждёт подтверждения автора: Бег — СКР×6, Спринт — СКР×12 (так считает Core). Требуется явное подтверждение перед включением.';
  const turn = state.wounds.combat.session.turnsStarted;
  if (
    mode === 'free-move' &&
    rulings.freeMovesPerTurn === null &&
    state.moves.some((m) => m.turn === turn && m.actor === actorId && m.mode === 'free-move')
  )
    return 'Ждёт решения автора: допускается ли второе Свободное движение за ход («2 ОД + СД»).';
  return null;
}
function movementGate(state: EngineState, actorId: ActorId) {
  if (state.pending || state.pendingTurn)
    throw new Error('Сначала завершите сохранённую pending-операцию');
  if (state.pendingFall) throw new Error('Сначала укажите на карте, где упал персонаж');
  const session = state.wounds.combat.session;
  if (session.phase === 'ready') throw new Error('Бой ещё не начат: нажмите «Начать бой»');
  if (session.phase !== 'turn-active' || session.activeActor?.actorId !== actorId)
    throw new Error('Сейчас ход другого персонажа');
  if (state.wounds.actors[actorId]!.life.status !== 'ALIVE')
    throw new ContextRequired('Действия в Agony/Death не разрешаются этим прототипом.');
}
function resolveMove(state: EngineState, id: string, actorId: ActorId, mode: MoveMode) {
  const combat = state.wounds.combat;
  const resolved = resolveCombatAction(
    combat,
    { id, type: mode, actor: ref(actorId), context: context(combat, actorId) },
    noDice,
  );
  const result = resolved.result;
  if (!('distance' in result)) throw new Error('Core returned no movement result');
  return { ...resolved, result };
}
/** Every movement mode with the Core-derived distance or the exact reason it is unavailable. */
export function movementOptions(b: Battle, actorId: ActorId): MoveOption[] {
  const state = getEngine(b);
  return moveModes.map((m) => {
    try {
      movementGate(state, actorId);
      const blocked = authorBoundary(state, actorId, m.mode);
      if (blocked)
        return { ...m, available: false, maxDistance: null, reason: blocked, blockedBy: 'author' };
      const preview = resolveMove(state, `preview:${m.mode}`, actorId, m.mode);
      return { ...m, available: true, maxDistance: preview.result.distance };
    } catch (error) {
      return {
        ...m,
        available: false,
        maxDistance: null,
        reason: explainEngineError(error),
        blockedBy:
          error instanceof Error && coreErrorPattern.test(error.message) ? 'engine' : 'state',
      };
    }
  });
}
/** Atomic movement action: either the Core resolution and the token move both commit, or nothing. */
const RUNNING_MODES: readonly MoveMode[] = ['run', 'sprint'];
/**
 * Atomic movement action along a straight line or a clicked route: either the Core resolution
 * and the token move both commit, or nothing. Difficult terrain costs double (ruling 11); when
 * running, each difficult stretch needs an ЛВ test with its modifier («Общая механика» A41,
 * rulings 11 and 43). A failed test ends the move: OD are spent, and the GM places the fallen
 * character (ruling 42) with `placeFallen`.
 */
export function moveActor(b: Battle, command: MoveCommand, source: DiceSource = noDice) {
  const state = getEngine(b);
  const used: DiceRoll[] = [];
  const tape: DiceSource = {
    roll(sides) {
      const value = source.roll(sides);
      used.push({ sides, value });
      return value;
    },
  };
  try {
    combatant(b, command.actor);
    const mode = moveModes.find((m) => m.mode === command.mode);
    if (!mode) throw new Error('Неизвестный режим движения');
    if (state.committed.includes(command.id)) throw new Error('Команда уже исполнена');
    const { x, y } = command.to;
    const points = command.route?.length ? command.route : [command.to];
    const last = points.at(-1)!;
    if (last.x !== x || last.y !== y)
      throw new Error('Последняя точка маршрута не совпадает с точкой назначения');
    movementGate(state, command.actor);
    if (command.sceneRevision !== undefined && command.sceneRevision !== b.sceneRevision)
      throw new Error('Сцена изменилась после предпросмотра: выберите точку назначения заново');
    const authorBlock = authorBoundary(state, command.actor, command.mode);
    if (authorBlock) throw new RuleDecisionRequired(authorBlock);
    const from = posOf(b, command.actor);
    if (points.length === 1 && x === from.x && y === from.y)
      throw new Error('Точка назначения совпадает с текущей позицией');
    const plan = planRoute(b, command.actor, points);
    if (plan.problem?.kind === 'position')
      throw new Error(`Точка назначения недопустима: ${plan.problem.reason}`);
    const resolved = resolveMove(state, command.id, command.actor, command.mode);
    const maxDistance = resolved.result.distance;
    // Too far is a plain refusal: no rule question arises for a point out of reach.
    if (plan.cost > maxDistance + 1e-9)
      throw new Error(
        `${points.length > 1 ? 'Маршрут' : 'Дистанция'} ${plan.cost.toFixed(2)} м` +
          (plan.difficult > 0
            ? ` (трудная местность ${plan.difficult.toFixed(2)} м считается вдвое)`
            : '') +
          ` больше допустимой ${maxDistance} м («${mode.label}»)`,
      );
    if (plan.problem) throw new Error(plan.problem.reason);
    const terrainTests: { zone: string; label: string; modifier: number; check: unknown }[] = [];
    let fell: (typeof plan.zones)[number] | undefined;
    if (RUNNING_MODES.includes(command.mode))
      for (const zone of plan.zones) {
        const combat = state.wounds.combat;
        const checked = resolveWoundCheck(
          state.wounds,
          'ЛВ',
          context(combat, command.actor),
          tape,
          {
            id: `terrain:${zone.id}`,
            value: zone.modifier,
            provenance: {
              source: { kind: 'canonical-sheet', id: 'Механика к100 / Общая механика A41–A55' },
              reason: `Трудный ландшафт «${zone.label}» при беге: тест ЛВ ${zone.modifier >= 0 ? '+' : ''}${zone.modifier}`,
            },
          },
        );
        terrainTests.push({
          zone: zone.id,
          label: zone.label,
          modifier: zone.modifier,
          check: checked.result,
        });
        if (checked.result.outcome !== 'success') {
          fell = zone;
          break;
        }
      }
    const next = structuredClone(state);
    next.wounds = { ...next.wounds, combat: resolved.state };
    next.committed.push(command.id);
    next.moves.push({
      turn: state.wounds.combat.session.turnsStarted,
      actor: command.actor,
      mode: command.mode,
    });
    if (fell) next.pendingFall = { actor: command.actor, commandId: command.id, zone: fell.id };
    else b.positions[command.actor] = { x, y };
    sync(b, next);
    append(b, 'move', {
      command,
      from,
      to: fell ? null : { x, y },
      route: points,
      cells: fell ? [] : cellsOf({ x, y }, fpOf(b, command.actor)),
      distance: plan.meters,
      difficult: plan.difficult,
      cost: plan.cost,
      maxDistance,
      terrainTests,
      rolls: used,
      fell: fell ? { zone: fell.id, label: fell.label } : null,
      odBefore: resolved.execution.odBefore,
      odAfter: resolved.execution.odAfter,
      fatigueAdded: resolved.result.fatigueAdded,
      coreLogs: resolved.logs,
      committed: true,
    });
    return fell
      ? { status: 'FELL' as const, distance: plan.meters, maxDistance, zone: fell.label }
      : { status: 'RESOLVED' as const, distance: plan.meters, maxDistance };
  } catch (error) {
    append(b, 'move-rejected', {
      command,
      reason: explainEngineError(error),
      authorDecisionRequired: error instanceof RuleDecisionRequired,
      committed: false,
    });
    throw error;
  }
}
/**
 * The GM places a character who fell on difficult terrain (author ruling 42): any valid free
 * position; the character ends up lying (prone).
 */
export function placeFallen(b: Battle, actor: ActorId, at: { x: number; y: number }) {
  const state = getEngine(b);
  if (state.pendingFall?.actor !== actor) throw new Error('Этот персонаж не падал');
  const problem = placementProblemFor(b, actor, at);
  if (problem) throw new Error(problem);
  const next = structuredClone(state);
  const runtime = next.wounds.combat.actors[actor]!;
  next.wounds = {
    ...next.wounds,
    combat: {
      ...next.wounds.combat,
      actors: { ...next.wounds.combat.actors, [actor]: { ...runtime, posture: 'prone' } },
    },
  };
  const fall = next.pendingFall!;
  delete next.pendingFall;
  const before = posOf(b, actor);
  b.positions[actor] = { x: at.x, y: at.y };
  sync(b, next);
  append(b, 'fall-placed', {
    actor,
    commandId: fall.commandId,
    zone: fall.zone,
    before,
    after: posOf(b, actor),
    posture: 'prone',
  });
}
/** Starts the first turn of the manually ordered combat through the accepted turn hooks. */
export function startCombat(b: Battle, source: DiceSource) {
  const current = getEngine(b);
  if (current.pending) throw new Error('Pending-команда не завершена');
  const resuming = current.pendingTurn?.kind === 'start';
  if (current.pendingTurn && !resuming) throw new Error('Сначала продолжите pending начала хода');
  if (!resuming && (current.wounds.combat.session.phase !== 'ready' || current.committed.length))
    throw new Error('Бой уже начат');
  const prefix = current.pendingTurn?.prefix ?? [],
    used: DiceRoll[] = [];
  let cursor = 0;
  const tape: DiceSource = {
    roll(sides) {
      const prior = prefix[cursor++];
      if (prior && prior.sides !== sides) throw new Error('Turn prefix mismatch');
      const value = prior?.value ?? source.roll(sides);
      used.push({ sides, value });
      return value;
    },
  };
  const state = structuredClone(current),
    logs: unknown[] = [];
  delete state.pendingTurn;
  try {
    // Initiative: 1к10 + бЛВ, equal results re-rolled (ruling 20).
    if (state.wounds.combat.session.phase === 'ready') {
      const session = participants(b, tape);
      state.wounds = { ...state.wounds, combat: { ...state.wounds.combat, session } };
      logs.push({ type: 'initiative', order: session.initiativeOrder });
    }
    begin(state, tape, logs);
    sync(b, state);
    append(b, 'combat-start', { coreLogs: logs, rolls: used, active: b.active });
    return { status: 'RESOLVED' as const };
  } catch (error) {
    if (
      !(error instanceof ContextRequired) &&
      !(error instanceof Error && error.message.startsWith('Expected injected'))
    )
      throw error;
    const reason = String(error instanceof Error ? error.message : error);
    current.pendingTurn = { prefix: used, reason, kind: 'start' };
    engines.set(b, current);
    append(b, 'TURN_CONTEXT_REQUIRED', {
      kind: 'start',
      rolls: used,
      reason,
      coreLogs: logs,
      committed: false,
    });
    return { status: 'CONTEXT_REQUIRED' as const, reason };
  }
}
export function combatStarted(b: Battle) {
  const state = getEngine(b);
  return (
    state.wounds.combat.session.phase !== 'ready' ||
    state.committed.length > 0 ||
    !!state.pending ||
    !!state.pendingTurn
  );
}
/** Free GM placement is a setup tool only; during combat tokens move through movement actions. */
export function placeActor(b: Battle, id: ActorId, x: number, y: number) {
  if (combatStarted(b))
    throw new Error(
      'Свободная расстановка доступна только до начала боя. В бою используйте действия движения.',
    );
  move(b, id, x, y);
}
export function turnInfo(b: Battle) {
  const state = getEngine(b);
  const session = state.wounds.combat.session;
  return {
    phase: session.phase,
    round: session.roundNumber,
    started: combatStarted(b),
    active: (session.activeActor?.actorId ?? b.active) as ActorId,
    turnActive: session.phase === 'turn-active',
    od: session.turn?.od ?? null,
    attacked: session.turn?.flags.some((f) => f.startsWith('attack:')) ?? false,
    order: session.initiativeOrder.map((e) => e.actor.actorId as ActorId),
    reactions: Object.fromEntries(
      session.initiativeOrder.map((e) => [e.actor.actorId, e.reactions.remaining]),
    ) as Record<ActorId, number>,
    initiative: Object.fromEntries(
      session.initiativeOrder.map((e) => [e.actor.actorId, e.initiative]),
    ) as Record<ActorId, number>,
    pending: state.pending
      ? {
          reason: state.pending.reason,
          savedDice: state.pending.prefix.length,
          question: state.pending.question ?? null,
        }
      : null,
    pendingTurn: state.pendingTurn
      ? { reason: state.pendingTurn.reason, kind: state.pendingTurn.kind ?? 'next' }
      : null,
  };
}
export function actorStatus(b: Battle, id: ActorId) {
  const state = getEngine(b);
  const wounds = state.wounds.actors[id]!;
  const runtime = state.wounds.combat.actors[id]!;
  return {
    wounds: b.hp[id] ?? 0,
    maxWounds: maxWounds(b, id),
    blood: wounds.blood,
    life: wounds.life.status,
    injuries: wounds.injuries.map((i) => ({
      id: i.id,
      title: i.title,
      location: i.location,
      severity: i.severity,
      finalDamage: i.finalDamage,
    })),
    bleeding: wounds.bleeding
      .filter((x) => x.active)
      .map((x) => ({ id: x.id, severity: x.severity, location: x.location })),
    conditions: [
      ...wounds.conditions.map((c) => c.type),
      ...state.wounds.combat.session.conditions
        .filter((c) => c.actor.actorId === id)
        .map((c) => c.type),
    ],
    fatigue: runtime.fatigue,
    posture: runtime.posture,
    movement: runtime.movement,
    armorLoss: Object.fromEntries(
      Object.entries(state.armorLoss).filter(([key]) => key.startsWith(`${id}:`)),
    ),
  };
}
export type WeaponSupport = { level: 'supported' | 'partial' | 'blocked'; note: string };
/** Whether the combat engine can use a participant's weapon, and why not. */
export function weaponSupport(b: Battle, id: WeaponId): WeaponSupport {
  const w = weaponOf(b, id);
  const problem = w ? weaponProblem(w.arsenal) : 'Нет такого оружия';
  if (problem) return { level: 'blocked', note: problem };
  const unread = weaponTraits(w!.arsenal!).unread;
  const manual = weaponTraits(w!.arsenal!).traits.filter((t) => MANUAL_PROPERTIES.has(t.name));
  const notes = [
    ...(unread.length ? [`Не прочитано: ${unread.join(', ')}`] : []),
    ...(manual.length ? [`Применяет ведущий: ${manual.map((t) => t.name).join(', ')}`] : []),
  ];
  return notes.length
    ? { level: 'partial', note: notes.join('. ') }
    : { level: 'supported', note: 'Свойства оружия учитываются автоматически.' };
}

export type TurnActionType = 'quick-aim' | 'careful-aim' | 'wait' | 'reload' | 'clear-malfunction';
export interface TurnActionCommand {
  id: string;
  actor: ActorId;
  type: TurnActionType;
  /** Weapon for reload and clearing a jam. */
  weapon?: WeaponId;
}
const turnActionName: Record<TurnActionType, string> = {
  'quick-aim': 'Быстрое прицеливание',
  'careful-aim': 'Тщательное прицеливание',
  wait: 'Выжидание',
  reload: 'Перезарядка',
  'clear-malfunction': 'Исправление осечки',
};
/**
 * Actions of the turn through the accepted Core: aiming (1 / 2 ОД, +10 / +20 to the next
 * shot), waiting (1 ОД), reloading (ОД of the weapon, may go on next turn) and clearing a jam
 * (2 ОД, НС test). Spare magazines are not counted yet: a reload takes a full one.
 */
export function turnAction(b: Battle, command: TurnActionCommand, source: DiceSource = noDice) {
  const state = getEngine(b);
  const used: DiceRoll[] = [];
  const tape: DiceSource = {
    roll(sides) {
      const value = source.roll(sides);
      used.push({ sides, value });
      return value;
    },
  };
  try {
    combatant(b, command.actor);
    if (state.committed.includes(command.id)) throw new Error('Команда уже исполнена');
    movementGate(state, command.actor);
    const combat = state.wounds.combat;
    const base = {
      id: command.id,
      actor: ref(command.actor),
      context: context(combat, command.actor),
    };
    let next: CombatActionState;
    let detail: Record<string, unknown> = {};
    if (command.type === 'reload' || command.type === 'clear-malfunction') {
      const weapon = command.weapon ? combat.weapons[command.weapon] : undefined;
      if (!weapon || weapon.owner.actorId !== command.actor)
        throw new Error('Выберите стрелковое оружие этого персонажа');
      if (command.type === 'clear-malfunction') {
        const r = clearMalfunction(
          combat,
          { ...base, type: 'clear-malfunction', weaponId: weapon.id },
          tape,
        );
        next = r.state;
        detail = { cleared: r.result.outcome === 'success', check: r.result };
      } else {
        const loaded = weapon.loadedContainerId
          ? combat.containers[weapon.loadedContainerId]
          : undefined;
        if (!loaded) throw new Error('У оружия нет магазина');
        // A fresh full magazine of the same kind (spares are not tracked yet).
        const spareId = weapon.reloadProgress?.containerId ?? `${weapon.id}:mag:${command.id}`;
        const spare = combat.containers[spareId] ?? {
          ...loaded,
          id: spareId,
          currentRounds: loaded.capacity,
        };
        const withSpare = { ...combat, containers: { ...combat.containers, [spareId]: spare } };
        const r = coreReloadWeapon(withSpare, {
          ...base,
          type: 'reload',
          weaponId: weapon.id,
          containerId: spareId,
        });
        next = r.state;
        detail = { ...r.result };
      }
      detail.weaponName = weaponOf(b, command.weapon!)?.name ?? command.weapon;
    } else {
      next = resolveCombatAction(combat, { ...base, type: command.type }, noDice).state;
    }
    const after = structuredClone(state);
    after.wounds = { ...after.wounds, combat: next };
    after.committed.push(command.id);
    sync(b, after);
    append(b, 'turn-action', {
      command,
      name: turnActionName[command.type],
      rolls: used,
      ...detail,
      committed: true,
    });
    return { status: 'RESOLVED' as const };
  } catch (error) {
    append(b, 'turn-action-rejected', {
      command,
      name: turnActionName[command.type],
      reason: explainEngineError(error),
      committed: false,
    });
    throw error;
  }
}

/** Whether the weapon is in the owner's hands now (ruling 81). */
export function weaponInHand(b: Battle, weaponId: WeaponId): boolean {
  const combat = getEngine(b).wounds.combat;
  const ranged = combat.weapons[weaponId];
  if (ranged) return ranged.readied;
  return !!combat.melee?.weapons[weaponId]?.held;
}
export const weaponDropped = (b: Battle, weaponId: WeaponId) => {
  const c = getEngine(b).wounds.combat;
  return !!(c.weapons[weaponId]?.dropped ?? c.melee?.weapons[weaponId]?.dropped);
};
export const weaponHanging = (b: Battle, weaponId: WeaponId) => {
  const c = getEngine(b).wounds.combat;
  return !!(c.weapons[weaponId]?.hanging ?? c.melee?.weapons[weaponId]?.hanging);
};
/** Picking up or taking from a sling: СД, or 1 ОД once it is spent (ruling 82). */
export const pickUpCost = (b: Battle) =>
  getEngine(b).wounds.combat.session.turn?.flags.some((f) => f.startsWith('free-action:'))
    ? '1 ОД'
    : 'СД';
const slingOf = (b: Battle, weaponId: WeaponId) => {
  const [owner, index] = weaponId.split(':');
  return !!b.roster[owner!]?.character.weapons[Number(index)]?.sling;
};
/** Pick a weapon up from the floor or take it from the sling (ruling 82). */
export function pickUpWeapon(b: Battle, command: { id: string; actor: ActorId; weapon: WeaponId }) {
  const state = getEngine(b);
  try {
    combatant(b, command.actor);
    if (state.committed.includes(command.id)) throw new Error('Команда уже исполнена');
    movementGate(state, command.actor);
    const hanging = weaponHanging(b, command.weapon);
    const r = corePickUpWeapon(state.wounds.combat, {
      id: command.id,
      type: 'pick-up-weapon',
      actor: ref(command.actor),
      weaponId: command.weapon,
      context: context(state.wounds.combat, command.actor),
    });
    const next = structuredClone(state);
    next.wounds = { ...next.wounds, combat: r.state };
    next.committed.push(command.id);
    sync(b, next);
    append(b, 'pick-up-weapon', {
      command,
      weaponName: weaponOf(b, command.weapon)?.name ?? command.weapon,
      from: hanging ? 'sling' : 'floor',
      cost: r.result.free ? 'СД' : '1 ОД',
      committed: true,
    });
    return { status: 'RESOLVED' as const };
  } catch (error) {
    append(b, 'pick-up-weapon-rejected', {
      command,
      reason: explainEngineError(error),
      committed: false,
    });
    throw error;
  }
}
const hasTalentNamed = (b: Battle, actorId: ActorId, talent: string) =>
  canonicalTalents(b.roster[actorId]?.character.talents ?? []).includes(talent);
/** Cost of taking a weapon in hand: 1 ОД, or СД with «Быстрое выхватывание» (ruling 81). */
export const readyCost = (b: Battle, actorId: ActorId) =>
  hasTalentNamed(b, actorId, QUICK_DRAW_TALENT) ? 'СД' : '1 ОД';
/** Reload cost with «Быстрая перезарядка» (−1 ОД, 1 ОД → СД). */
export function reloadCost(b: Battle, actorId: ActorId, weaponId: WeaponId): string {
  const base = getEngine(b).wounds.combat.weapons[weaponId]?.template.profile.reload.odCost ?? 1;
  const n = hasTalentNamed(b, actorId, RAPID_RELOAD_TALENT) ? base - 1 : base;
  return n <= 0 ? 'СД' : `${n} ОД`;
}
/**
 * Take a weapon in hand (ruling 81). Before the fight it is free (setting up); in the fight it
 * costs 1 ОД, or the Free Action with «Быстрое выхватывание».
 */
export function takeWeapon(b: Battle, command: { id: string; actor: ActorId; weapon: WeaponId }) {
  const state = getEngine(b);
  try {
    combatant(b, command.actor);
    if (state.committed.includes(command.id)) throw new Error('Команда уже исполнена');
    let combat: CombatActionState;
    let cost = 'до боя';
    if (!combatStarted(b)) combat = putInHand(state.wounds.combat, command.actor, command.weapon);
    else {
      movementGate(state, command.actor);
      const r = coreReadyWeapon(state.wounds.combat, {
        id: command.id,
        type: 'ready-weapon',
        actor: ref(command.actor),
        weaponId: command.weapon,
        context: context(state.wounds.combat, command.actor),
      });
      combat = r.state;
      cost = r.result.free ? 'СД' : '1 ОД';
    }
    const next = structuredClone(state);
    next.wounds = { ...next.wounds, combat };
    // Setting up before the fight does not start it (combatStarted looks at committed ids).
    if (cost !== 'до боя') next.committed.push(command.id);
    sync(b, next);
    append(b, 'take-weapon', {
      command,
      weaponName: weaponOf(b, command.weapon)?.name ?? command.weapon,
      cost,
      committed: true,
    });
    return { status: 'RESOLVED' as const };
  } catch (error) {
    append(b, 'take-weapon-rejected', {
      command,
      reason: explainEngineError(error),
      committed: false,
    });
    throw error;
  }
}
/** Drop the weapon in hand on the floor — the turn's Free Action (ruling 81). */
export function dropWeapon(b: Battle, command: { id: string; actor: ActorId; weapon: WeaponId }) {
  const state = getEngine(b);
  try {
    combatant(b, command.actor);
    if (state.committed.includes(command.id)) throw new Error('Команда уже исполнена');
    movementGate(state, command.actor);
    const sling = slingOf(b, command.weapon);
    const r = coreDropWeapon(state.wounds.combat, {
      id: command.id,
      type: 'drop-weapon',
      actor: ref(command.actor),
      weaponId: command.weapon,
      ...(sling ? { sling: true } : {}),
      context: context(state.wounds.combat, command.actor),
    });
    const next = structuredClone(state);
    next.wounds = { ...next.wounds, combat: r.state };
    next.committed.push(command.id);
    sync(b, next);
    append(b, 'drop-weapon', {
      command,
      sling,
      weaponName: weaponOf(b, command.weapon)?.name ?? command.weapon,
      committed: true,
    });
    return { status: 'RESOLVED' as const };
  } catch (error) {
    append(b, 'drop-weapon-rejected', {
      command,
      reason: explainEngineError(error),
      committed: false,
    });
    throw error;
  }
}
/** Magazine, jam and reload progress of a ranged weapon now. */
export function weaponState(b: Battle, weaponId: WeaponId) {
  const combat = getEngine(b).wounds.combat;
  const w = combat.weapons[weaponId];
  const c = w?.loadedContainerId ? combat.containers[w.loadedContainerId] : undefined;
  return {
    rounds: c?.currentRounds ?? 0,
    jammed: !!w?.jammed,
    reloading: w?.reloadProgress
      ? `${w.reloadProgress.odSpent} из ${w.template.profile.reload.odCost} ОД`
      : null,
  };
}
/** Talent «Бугрящиеся бицепсы»: heavy weapons fire from the hands without penalties. */
export const heavyFromHands = (b: Battle, actorId: ActorId) =>
  canonicalTalents(b.roster[actorId]?.character.talents ?? []).includes(HEAVY_FROM_HANDS_TALENT);
/** Whether a participant's ranged weapon stands on a support now («Бой» A55). */
export function weaponBraced(b: Battle, weaponId: WeaponId): boolean {
  return !!getEngine(b).wounds.combat.weapons[weaponId]?.braced;
}
/**
 * «Установить на опору» (1 ОД, «Бой» A55): a heavy weapon on a support may fire bursts and
 * loses the −30 for firing unbraced. Any movement of the owner takes it off (ruling 41).
 */
export function braceWeapon(b: Battle, command: { id: string; actor: ActorId; weapon: WeaponId }) {
  const state = getEngine(b);
  try {
    combatant(b, command.actor);
    if (state.committed.includes(command.id)) throw new Error('Команда уже исполнена');
    movementGate(state, command.actor);
    const resolved = coreBraceWeapon(state.wounds.combat, {
      id: command.id,
      type: 'brace-weapon',
      actor: ref(command.actor),
      weaponId: command.weapon,
      context: context(state.wounds.combat, command.actor),
    });
    const next = structuredClone(state);
    next.wounds = { ...next.wounds, combat: resolved.state };
    next.committed.push(command.id);
    sync(b, next);
    append(b, 'brace', {
      command,
      weaponName: weaponOf(b, command.weapon)?.name ?? command.weapon,
      odBefore: resolved.execution.odBefore,
      odAfter: resolved.execution.odAfter,
      committed: true,
    });
    return { status: 'RESOLVED' as const };
  } catch (error) {
    append(b, 'brace-rejected', { command, reason: explainEngineError(error), committed: false });
    throw error;
  }
}

/** «Встать» (1 ОД) through the accepted Core; available only when the actor is not standing. */
export function standUp(b: Battle, command: { id: string; actor: ActorId }) {
  const state = getEngine(b);
  try {
    combatant(b, command.actor);
    if (state.committed.includes(command.id)) throw new Error('Команда уже исполнена');
    movementGate(state, command.actor);
    const runtime = state.wounds.combat.actors[command.actor]!;
    if (runtime.posture === 'standing') throw new Error('Персонаж уже стоит');
    const combat = state.wounds.combat;
    const resolved = resolveCombatAction(
      combat,
      {
        id: command.id,
        type: 'stand',
        actor: ref(command.actor),
        context: context(combat, command.actor),
      },
      noDice,
    );
    const next = structuredClone(state);
    next.wounds = { ...next.wounds, combat: resolved.state };
    next.committed.push(command.id);
    sync(b, next);
    append(b, 'posture', {
      command,
      from: runtime.posture,
      to: resolved.state.actors[command.actor]!.posture,
      odBefore: resolved.execution.odBefore,
      odAfter: resolved.execution.odAfter,
      coreLogs: resolved.logs,
      committed: true,
    });
    return { status: 'RESOLVED' as const };
  } catch (error) {
    append(b, 'posture-rejected', { command, reason: explainEngineError(error), committed: false });
    throw error;
  }
}

/**
 * Changes a token's occupied area before combat. The top-left cell stays where it is; the
 * new footprint must fit on the map without overlapping other tokens.
 */
export function setFootprint(b: Battle, id: ActorId, footprint: Footprint) {
  if (combatStarted(b)) throw new Error('Площадь токена меняется только до начала боя.');
  combatant(b, id);
  validateFootprint(footprint);
  const old = fpOf(b, id);
  const center = posOf(b, id);
  const anchor = { col: center.x - old.width / 2, row: center.y - old.height / 2 };
  const next = { x: anchor.col + footprint.width / 2, y: anchor.row + footprint.height / 2 };
  const problem = placementProblemFor(b, id, next, footprint);
  if (problem) throw new Error(problem);
  b.footprints[id] = { width: footprint.width, height: footprint.height };
  b.positions[id] = next;
  append(b, 'footprint', {
    actor: id,
    footprint: fpOf(b, id),
    center: next,
    cells: cellsOf(next, footprint),
  });
}

/** A map draft was refused; the scene is unchanged. Lists every map and token problem. */
export class MapApplyRejected extends Error {
  override readonly name = 'MapApplyRejected';
  constructor(
    readonly mapProblems: string[],
    readonly tokenProblems: { actor: ActorId; problem: string }[],
    nameOf: (id: ActorId) => string = (id) => id,
  ) {
    super(
      [...mapProblems, ...tokenProblems.map((t) => `${nameOf(t.actor)}: ${t.problem}`)].join(' '),
    );
  }
}
/**
 * Applies a map draft as one command, before combat only. The map and any token
 * re-placements from the draft are validated together; nothing is applied on failure, and
 * no token is moved or clipped implicitly.
 */
export type BackgroundSummary = { mime: string; widthPx: number; heightPx: number };
export function applyMap(
  b: Battle,
  draft: { map: MapDocument; positions: Record<ActorId, { x: number; y: number }> },
  /** Replay only: the snapshot had a background whose bytes the replay does not carry. */
  options: { omittedBackground?: BackgroundSummary | null } = {},
) {
  if (combatStarted(b))
    throw new Error('Карту можно менять только на этапе расстановки, до начала боя.');
  const map = structuredClone(draft.map);
  const positions = structuredClone(draft.positions);
  const problems = mapProblems(map);
  const conflicts = problems.some((p) => /Ширина|Высота/.test(p))
    ? []
    : tokenConflicts(map, positions, b.footprints);
  if (problems.length || conflicts.length)
    throw new MapApplyRejected(problems, conflicts, (id) => actorName(b, id));
  const repositioned = actorIds(b)
    .filter((id) => positions[id]!.x !== posOf(b, id).x || positions[id]!.y !== posOf(b, id).y)
    .map((id) => ({
      actor: id,
      from: posOf(b, id),
      to: positions[id]!,
      cells: cellsOf(positions[id]!, fpOf(b, id)),
    }));
  b.map = map;
  b.mapRevision += 1;
  b.doors = initialDoorStates(map);
  b.locks = {};
  b.sceneRevision += 1;
  for (const r of repositioned) b.positions[r.actor] = r.to;
  append(b, 'map-applied', {
    // Geometry snapshot ID for replays (layers stored once); background bytes are visual
    // and left out.
    snapshot: storeSnapshot(b.snapshots, map),
    backgroundOmitted: map.background !== null || !!options.omittedBackground,
    positions,
    id: map.id,
    name: map.name,
    cols: map.cols,
    rows: map.rows,
    floorCells: Object.keys(map.floor).length,
    decorations: map.decorations.length,
    background: map.background
      ? {
          mime: map.background.mime,
          widthPx: map.background.widthPx,
          heightPx: map.background.heightPx,
        }
      : (options.omittedBackground ?? null),
    revision: b.mapRevision,
    repositioned,
  });
  return { status: 'RESOLVED' as const, revision: b.mapRevision };
}

/**
 * Opens or closes a door during setup only (changing doors in combat waits for the author,
 * TZ question 3). Closing is refused while a token's footprint spans the doorway.
 */
export const doorLocked = (b: Battle, doorId: string) =>
  b.locks[doorId] ?? b.map.doors.find((d) => d.id === doorId)?.locked ?? false;
/**
 * Open or close a door. `by` — a character in combat spends the turn's Free Action, from any
 * distance (author rulings 10 and 44); a locked door does not open this way. Without `by` the
 * GM changes the door at any moment at no cost (ruling 10).
 */
export function setDoorOpen(b: Battle, doorId: string, open: boolean, by?: ActorId) {
  const door = b.map.doors.find((d) => d.id === doorId);
  if (!door) throw new Error('Такой двери нет на карте');
  const current = b.doors[doorId] ?? door.open;
  if (current === open) throw new Error(open ? 'Дверь уже открыта' : 'Дверь уже закрыта');
  let freeAction: ReturnType<typeof resolveCombatAction> | null = null;
  if (by) {
    if (!combatStarted(b)) throw new Error('До начала боя двери переключает ведущий');
    const state = getEngine(b);
    movementGate(state, by);
    if (open && doorLocked(b, doorId))
      throw new Error('Дверь заперта: её отпирает ведущий или взлом');
    const combat = state.wounds.combat;
    freeAction = resolveCombatAction(
      combat,
      {
        id: `door:${doorId}:${b.log.length + 1}`,
        type: 'free-action',
        actor: ref(by),
        context: context(combat, by),
      },
      noDice,
    );
  }
  if (!open) {
    const g = buildGeometry(b.map, { ...b.doors, [doorId]: false });
    for (const id of actorIds(b)) {
      const problem = footprintGeometryProblem(posOf(b, id), fpOf(b, id), g);
      if (problem)
        throw new Error(`Нельзя закрыть дверь: ${actorName(b, id)} стоит в проёме (${problem})`);
    }
  }
  if (freeAction) {
    const next = structuredClone(getEngine(b));
    next.wounds = { ...next.wounds, combat: freeAction.state };
    sync(b, next);
  }
  b.doors = { ...b.doors, [doorId]: open };
  b.sceneRevision += 1;
  const line = segmentLine(door.from, door.to);
  append(b, 'door', {
    doorId,
    open,
    by: by ?? null,
    freeAction: Boolean(freeAction),
    inCombat: combatStarted(b),
    from: door.from,
    to: door.to,
    edges: line ? line.to - line.from : 0,
  });
  return { status: 'RESOLVED' as const };
}
/** The GM locks or unlocks a door at any moment (ruling 17: the GM sets the lock). */
export function setDoorLocked(b: Battle, doorId: string, locked: boolean) {
  const door = b.map.doors.find((d) => d.id === doorId);
  if (!door) throw new Error('Такой двери нет на карте');
  if (doorLocked(b, doorId) === locked)
    throw new Error(locked ? 'Дверь уже заперта' : 'Дверь уже не заперта');
  if (locked && (b.doors[doorId] ?? door.open))
    throw new Error('Открытую дверь нельзя запереть: сначала закройте её');
  b.locks = { ...b.locks, [doorId]: locked };
  append(b, 'door-lock', { doorId, locked });
  return { status: 'RESOLVED' as const };
}
