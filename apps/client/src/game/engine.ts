import type {
  BleedingActivity,
  CalledLocation,
  ConditionInstance,
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
  concussion,
  instantDeath,
  destroyerDice,
  opposedMeleeCheck,
  resolveHitLocations,
  talentDamage,
  talentAttackModifiers,
  criticalBonus,
  unfamiliarWeaponPenalty,
  type WeaponFamily,
  corrosiveDice,
  transferWeapon,
  resolveMeleeOpposedAction,
  twoHandedWeapon,
  radDice,
  meltingLoss,
  toxicProperty,
  gravitonDice,
  fireProperty,
  cripplingWounds,
  remainingRounds,
  afterHitTests,
  applyStunned,
  resolveCheck,
  planDeath,
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
  battleWeapons,
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
import type { ArsenalWeapon } from '../../../../packages/canonical-data/src/arsenal';
import { radProtectedArmour, sealedArmour, weaponById, weaponTraits } from './arsenal';
import { canonicalTalents } from './talents';
import {
  hasExoticProficiency,
  hasProficiency,
  isExotic,
  PROFICIENCY_PENALTY,
  weaponKindName,
} from './proficiency';
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
  /** A knocked-out weapon waits to be placed on the map (ruling 108). */
  pendingLoose?: {
    weapon: WeaponId;
    from: { x: number; y: number };
    maxDistance: number;
    /** Who chooses: the GM (random direction) or the attacker (3+ degrees). */
    chooser: 'gm' | 'attacker';
    commandId: string;
    /** 5+ degrees and a free hand: the attacker may take the weapon (ruling 114). */
    taker?: ActorId;
  };
  /** «Калечащее (Х)»: wounds lost when the actor spends the 2nd ОД in a turn (ruling 89). */
  crippling?: Record<ActorId, number>;
  /** ОД at the start of the current turn and whether «Калечащее» was applied in it. */
  turnOd?: { turn: number; start: number; applied: boolean };
  /** «Горение» (ruling 87): turns left and the ½ ОБ of the joints given by the GM. */
  burning?: Record<ActorId, { rounds: number; halfOb: number }>;
  /** «Токсичное» (rulings 95, 98): ВН drain (Хк10) or, with СверхВН, 1к10 wounds a turn. */
  toxic?: Record<ActorId, { dice: number; superWounds: boolean; rounds: number | null }>;
  /** «Рад»: accumulated rad damage and whether ВН is halved till the end of the fight. */
  rad?: Record<ActorId, { total: number; halved: boolean }>;
  /**
   * «Коррозийное» on the armour of a zone (rulings 115–117): Хк10 a turn until cleaned or the
   * armour is dropped; `hit` and `command` replay the separate wound when the ОБ is 0.
   */
  corrosion?: Record<
    string,
    { actor: ActorId; zone: Zone; dice: number; hit: DamageInput; command: AttackCommand }
  >;
  /** Zone ОБ before losses, recorded when corrosion starts (turn-start steps have no battle). */
  zoneArmour?: Record<string, number>;
  /** Once-a-round talent rerolls: `${actor}:${talent}` → round used. */
  rerolls?: Record<string, number>;
  /** «Проникающее» (rulings 118–120): weapons stuck in a wound, by weapon ID. */
  impaled?: Record<WeaponId, { target: ActorId; location: string; skr: boolean; skrLoss?: number }>;
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
  /**
   * Reaction of the target: none, Dodge (ЛВ, «Уклонение») or Parry (НР, «Парирование»).
   * Absent — the target decides after being hit (asked with the attack roll already made).
   */
  defense?: 'DECLINE' | 'DODGE' | 'PARRY';
  /**
   * «Избирательная атака» (2 ОД, «Бой» A52): a single shot or blow at the chosen location with
   * its modifier (Глаза −50, Голова −20, Руки −20, Торс −10, Ноги −15, Сочленения −40).
   */
  calledLocation?: CalledLocation;
  /** GM answers to questions asked during this attack, by question key. */
  answers?: Record<string, number>;
  /**
   * Counterattack after a parry: the core opportunity ID. A free melee blow out of turn at the
   * attacker; it cannot be dodged or parried.
   */
  counter?: string;
  /**
   * Two weapons (ruling 105): the weapon in the other hand strikes or shoots as a second attack
   * of the same action. Without «Парное оружие» each attack has −30 («Амбидекстрия»: −20).
   */
  second?: WeaponId;
  /** Internal: this attack is the follow-up of the two-weapon attack with this primary ID. */
  dualPrimary?: string;
  /** Internal: the other weapon of the two-weapon attack. */
  dualWith?: WeaponId;
  /**
   * «Натиск» (2 ОД, НР +20; «Бой», core base «charge»): the attacker moves in a straight line to
   * this cell next to the target (at most 3 × СКР) and strikes (ruling 132).
   */
  charge?: { x: number; y: number };
  /** «Стремительная» / «Молниеносная атака» in melee (talents, ruling 130). */
  meleeBase?: 'swift' | 'lightning';
  /** Internal: «Двойной выстрел» — the first shot hit, the second gets +20 (ruling 127). */
  doubleShot?: boolean;
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
/** Prefix of question keys: the second weapon's attack asks its own questions (ruling 105). */
let askScope = '';
function ask(command: AttackCommand, asked: GmQuestion): number {
  const question = askScope ? { ...asked, key: askScope + asked.key } : asked;
  const answer = command.answers?.[question.key];
  if (answer === undefined) throw new QuestionRequired(question);
  if (!Number.isInteger(answer)) throw new Error('Ответ ведущего должен быть целым числом');
  return answer;
}
const engines = new WeakMap<Battle, EngineState>();
/** What the next die of an attack is rolled for; read by the dice tape for the GM view. */
type RollPhase = 'turn' | 'attack' | 'suppression' | 'damage' | 'consequence' | 'property';
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
  if (phase === 'property') return 'тест против свойства оружия';
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
  const entries = actorIds(b).map((id) => {
    const c = combatant(b, id).character;
    const talents = canonicalTalents(c.talents);
    return {
      actor: ref(id),
      // «Боевое чутьё»: бВС instead of бЛВ for initiative.
      agilityBonus: bonusOf(c, talents.includes('Боевое чутьё') ? 'ВС' : 'ЛВ'),
      // «Шаг в сторону»: one more avoidance a round (not twice against one attack, ruling 128).
      reactions: talents.includes('Шаг в сторону')
        ? { capacity: 2, remaining: 2 }
        : { capacity: 1, remaining: 1 },
      // «Молниеносные рефлексы»: two initiative rolls, the higher counts.
      ...(talents.includes('Молниеносные рефлексы') ? { initiativeRolls: 2 } : {}),
    };
  });
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
  // Ruling 83: wounds never show below 0 (at 0 the character is in Agony).
  for (const id of actorIds(b))
    b.hp[id] = Math.max(0, maxWounds(b, id) - state.wounds.actors[id]!.damageTaken);
  for (const w of Object.values(state.wounds.combat.weapons)) {
    const c = w.loadedContainerId ? state.wounds.combat.containers[w.loadedContainerId] : undefined;
    b.ammo[w.id] = c ? c.currentRounds : 0;
  }
  const active = state.wounds.combat.session.activeActor?.actorId;
  if (active) b.active = active;
  const crippled = applyCrippling(state);
  if (crippled) {
    b.hp[crippled.actor] = Math.max(
      0,
      maxWounds(b, crippled.actor) - state.wounds.actors[crippled.actor]!.damageTaken,
    );
    append(b, 'crippling', crippled);
  }
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
  burnAtTurnStart(state, id, rng, logs);
  corrodeAtTurnStart(state, id, rng, logs);
  toxinAtTurnStart(state, id, rng, logs);
  state.turnOd = {
    turn: state.wounds.combat.session.turnsStarted,
    start: state.wounds.combat.session.turn?.od ?? 0,
    applied: false,
  };
}

export type Zone = 'head' | 'torso' | 'arms' | 'legs';
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
  critical = 0,
) {
  const result = resolvePostDamage(
    {
      state: state.wounds,
      damage,
      context: context(state.wounds.combat, command.target, command.actor),
      facts: {
        provenance,
        activity: command.targetActivity,
        ...(critical ? { criticalBonus: critical } : {}),
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
  zeroWoundsAgony(state, command.target, logs);
  return result.result;
}
/** Ruling 83: wounds down to 0 — Agony as for the consequence «СМЕРТЬ» (2 × бВН rounds). */
function zeroWoundsAgony(state: EngineState, id: ActorId, logs: unknown[]) {
  const w = state.wounds.actors[id];
  if (!w || w.life.status !== 'ALIVE' || w.damageTaken < w.maxWounds) return;
  const vn = state.wounds.combat.actors[id]!.characteristics.ВН!;
  const bVN = Math.floor(vn.baseValue / 10) + vn.baseSuper;
  const planned = planDeath(
    state.wounds,
    ref(id),
    bVN,
    {
      source: { kind: 'author-ruling', id: 'Решение 83: раны 0 — агония' },
      reason: 'Wounds reached 0: Agony as for the consequence «СМЕРТЬ»',
    },
    null,
  );
  state.wounds = planned.state;
  logs.push({ type: 'zero-wounds-agony', actor: id, bVN });
}
/** Wounds without a consequence roll (fire, ruling 92): damage taken grows, Agony at 0. */
function plainWounds(state: EngineState, id: ActorId, wounds: number, logs: unknown[]) {
  const w = state.wounds.actors[id];
  if (!w || w.life.status !== 'ALIVE' || wounds <= 0) return;
  state.wounds = {
    ...state.wounds,
    actors: { ...state.wounds.actors, [id]: { ...w, damageTaken: w.damageTaken + wounds } },
  };
  zeroWoundsAgony(state, id, logs);
}
const bonusVN = (state: EngineState, id: ActorId) => {
  const vn = state.wounds.combat.actors[id]!.characteristics.ВН!;
  return Math.floor(vn.baseValue / 10) + vn.baseSuper;
};
/**
 * «Горение» at the start of the burning actor's turn (rulings 87, 90–92): 2к10 Э into the joints
 * minus ½ ОБ and бВН, without consequences; +1к5 Fatigue; СВ < 40 — a СВ test, a failure loses
 * the turn.
 */
function burnAtTurnStart(state: EngineState, id: ActorId, rng: DiceSource, logs: unknown[]) {
  const burn = state.burning?.[id];
  if (!burn || state.wounds.actors[id]?.life.status !== 'ALIVE') return;
  const dice = [rollDie(10, rng), rollDie(10, rng)];
  const wounds = Math.max(0, sum(dice) - burn.halfOb - bonusVN(state, id));
  plainWounds(state, id, wounds, logs);
  const fatigue = rollDie(5, rng);
  const combat = state.wounds.combat;
  const actor = combat.actors[id]!;
  let session = combat.session;
  const wp = actor.characteristics.СВ!;
  let panic: unknown = null;
  if (wp.baseValue < 40) {
    const check = resolveCheck(
      { baseValue: wp.baseValue, finalSuper: wp.baseSuper, context: context(combat, id) },
      rng,
    ).result;
    panic = check;
    if (check.outcome !== 'success' && session.turn)
      session = { ...session, turn: { ...session.turn, od: 0 } };
  }
  state.wounds = {
    ...state.wounds,
    combat: {
      ...combat,
      session,
      actors: { ...combat.actors, [id]: { ...actor, fatigue: actor.fatigue + fatigue.value } },
    },
  };
  const rounds = burn.rounds - 1;
  const rest = { ...state.burning };
  if (rounds > 0) rest[id] = { ...burn, rounds };
  else delete rest[id];
  state.burning = rest;
  logs.push({
    type: 'burning',
    actor: id,
    dice: dice.map((d) => d.value),
    halfOb: burn.halfOb,
    wounds,
    fatigue: fatigue.value,
    panic,
    turnLost: session.turn?.od === 0,
    roundsLeft: Math.max(0, rounds),
  });
}

/** «Токсичное» at the start of the poisoned actor's turn (rulings 95, 98). */
function toxinAtTurnStart(state: EngineState, id: ActorId, rng: DiceSource, logs: unknown[]) {
  const toxin = state.toxic?.[id];
  if (!toxin || state.wounds.actors[id]?.life.status !== 'ALIVE') return;
  let entry: Record<string, unknown>;
  if (toxin.superWounds) {
    const die = rollDie(10, rng).value;
    plainWounds(state, id, die, logs);
    entry = { wounds: die };
  } else {
    const dice = Array.from({ length: toxin.dice }, () => rollDie(10, rng).value);
    const loss = dice.reduce((a, v) => a + v, 0);
    const combat = state.wounds.combat;
    const actor = combat.actors[id]!;
    const vn = actor.characteristics.ВН!;
    const value = Math.max(0, vn.baseValue - loss);
    state.wounds = {
      ...state.wounds,
      combat: {
        ...combat,
        actors: {
          ...combat.actors,
          [id]: {
            ...actor,
            characteristics: { ...actor.characteristics, ВН: { ...vn, baseValue: value } },
          },
        },
      },
    };
    entry = { dice, vnLoss: vn.baseValue - value, vn: value };
  }
  const rest = { ...state.toxic };
  const rounds = toxin.rounds === null ? null : toxin.rounds - 1;
  if (rounds === null || rounds > 0) rest[id] = { ...toxin, rounds };
  else delete rest[id];
  state.toxic = rest;
  logs.push({ type: 'toxin', actor: id, ...entry, roundsLeft: rounds });
}

/**
 * «Калечащее (Х)» (ruling 89): the actor loses Х wounds as soon as it spends the 2nd ОД of its
 * turn; once per turn. Returns the journal record or null.
 */
function applyCrippling(state: EngineState) {
  const session = state.wounds.combat.session;
  const turn = session.turn;
  const od = state.turnOd;
  if (!turn || !od || od.turn !== session.turnsStarted || od.applied) return null;
  const id = turn.actor.actorId;
  const x = state.crippling?.[id];
  if (!x || od.start - turn.od < 2) return null;
  const w = state.wounds.actors[id];
  if (!w || w.life.status !== 'ALIVE') return null;
  state.turnOd = { ...od, applied: true };
  state.wounds = {
    ...state.wounds,
    actors: { ...state.wounds.actors, [id]: { ...w, damageTaken: w.damageTaken + x } },
  };
  const logs: unknown[] = [];
  zeroWoundsAgony(state, id, logs);
  return { actor: id, wounds: x, agony: logs.length > 0 };
}
const sum = (rolls: readonly DiceRoll[]) => rolls.reduce((s, r) => s + r.value, 0);

/** Properties the polygon does not apply automatically yet: shown to the GM after the hit. */
const MANUAL_PROPERTIES = new Set(['Галлюциногенное', 'Взрыв', 'Спрей', 'Частичное опутывание']);

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
  extra: { id: string; value: number; reason: string }[] = [],
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
    context: reactionContext(b, state, command, 'Парирование', [
      ...options.modifiers.map((m, i) => ({
        id: `${command.id}:parry-property:${i}`,
        value: m.value,
        reason: `${m.property} (${m.source})`,
      })),
      ...extra,
    ]),
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

const AFTER_HIT_NAME = { stunned: 'оглушён', blinded: 'ослеплён', immobilised: 'опутан' } as const;
/**
 * Tests the target makes after a hit (properties «Оглушающее», «Ослепляющее», «Шоковое»,
 * «Опутывающее»): ВН or ЛВ with −10 × rating. A failure gives the state for as many rounds as
 * degrees of failure; «Опутывающее» holds until the target breaks free (СЛ or ЛВ − 10 × Х).
 */
function applyAfterHit(
  b: Battle,
  state: EngineState,
  command: AttackCommand,
  traits: readonly WeaponTraitReference[],
  finalDamage: number,
  rng: DiceSource,
  logs: unknown[],
) {
  const out: { property: string; passed: boolean; state?: string; rounds?: number }[] = [];
  const life = state.wounds.actors[command.target]?.life.status;
  if (life !== 'ALIVE') return out;
  for (const test of afterHitTests(traits, finalDamage)) {
    const c = combatant(b, command.target).character.characteristics[test.characteristic];
    const gm = { kind: 'weapon-property', id: `Свойства оружия: ${test.property}` };
    const ctx = {
      ...context(state.wounds.combat, command.target, command.actor),
      modifiers: test.modifier
        ? [
            {
              id: `${command.id}:${test.property}`,
              value: test.modifier,
              source: gm,
              provenance: { source: gm, reason: `${test.property}: −10 × рейтинг` },
            },
          ]
        : [],
    };
    const check = resolveCheck(
      { baseValue: c.value, finalSuper: c.super, context: ctx },
      rng,
    ).result;
    logs.push({ type: 'after-hit-test', property: test.property, check });
    if (check.outcome === 'success') {
      out.push({ property: test.property, passed: true });
      continue;
    }
    // «Железная челюсть»: a ВН+0 test saves from being stunned (ruling 126).
    if (
      test.onFailure === 'stunned' &&
      canonicalTalents(combatant(b, command.target).character.talents).includes('Железная челюсть')
    ) {
      const vn = combatant(b, command.target).character.characteristics.ВН;
      const jaw = resolveCheck(
        {
          baseValue: vn.value,
          finalSuper: vn.super,
          context: context(state.wounds.combat, command.target, command.actor),
        },
        rng,
      ).result;
      logs.push({ type: 'iron-jaw', check: jaw });
      if (jaw.outcome === 'success') {
        out.push({ property: test.property, passed: true, state: 'Железная челюсть' });
        continue;
      }
    }
    const rounds = Math.max(1, check.failureDegrees ?? 1);
    const combat = state.wounds.combat;
    const session = combat.session;
    const id = `${command.id}:${test.property}:${command.target}`;
    const actor = ref(command.target);
    const prov = { source: gm, reason: `Провал теста против «${test.property}»` };
    let next: typeof session;
    if (test.onFailure === 'stunned') {
      next = applyStunned(session, {
        id,
        actor,
        source: gm,
        provenance: prov,
        durationRounds: rounds,
      }).result;
    } else {
      const type = test.onFailure === 'blinded' ? 'Blinded' : 'Helpless';
      // Blinded lasts the degrees of failure; entangled holds until the target breaks free.
      const duration = test.onFailure === 'blinded' ? rounds : 99;
      const effects =
        type === 'Helpless'
          ? (['action'] as const).map((permission) => ({
              id: `${id}:${permission}`,
              source: gm,
              targetActor: actor,
              provenance: prov,
              definition: {
                id: `Entangled:${permission}`,
                target: { kind: 'permission' as const, permission },
                operation: 'restrict' as const,
                value: 1,
                stage: 'temporary' as const,
                stackingGroup: `Entangled:${permission}`,
                stackingRule: 'independent' as const,
                tags: ['Entangled'],
                provenance: prov,
              },
            }))
          : [];
      next = {
        ...session,
        conditions: [
          ...session.conditions,
          {
            id,
            type,
            actor,
            sources: [gm],
            provenance: [prov],
            stackingRule: 'REJECT' as const,
            unit: 'round' as const,
            appliedRound: session.roundNumber,
            durationRounds: duration,
            expiresAfterRound: session.roundNumber + duration - 1,
            effects,
            ...(type === 'Helpless' ? { breakFree: -10 * Math.abs(test.modifier / 10) } : {}),
          } as ConditionInstance,
        ],
      };
    }
    state.wounds = { ...state.wounds, combat: { ...combat, session: next } };
    out.push({
      property: test.property,
      passed: false,
      state: AFTER_HIT_NAME[test.onFailure],
      ...(test.onFailure === 'immobilised' ? {} : { rounds }),
    });
  }
  return out;
}

/**
 * A separate wound of Nк10 (rulings 88, 97): without armour, minus бВН, with its own consequence
 * for the location.
 */
function separateWound(
  state: EngineState,
  command: AttackCommand,
  hit: DamageInput,
  location: DamageInput['location'],
  kind: string,
  count: number,
  rng: DiceSource,
  logs: unknown[],
) {
  setPhase('damage');
  const vn = state.wounds.combat.actors[command.target]!.characteristics.ВН!;
  const expression = { count, sides: 10, modifier: 0 };
  const input: DamageInput = {
    ...hit,
    hitId: `${hit.hitId}:${kind}`,
    location,
    profile: { ...hit.profile, expression },
    penetration: { ...hit.penetration, value: 0 },
    transformations: [],
  };
  const roll = resolveDamageRoll(expression, rng, hit.context).result;
  const damage = resolveProtectionDamage(
    {
      input,
      state: protectionFor(state, input, 0),
      endurance: { baseValue: vn.baseValue, baseSuper: vn.baseSuper },
      preRolled: roll,
    },
    {
      roll: () => {
        throw new Error('Unexpected damage reroll');
      },
    },
  );
  logs.push({ type: kind, dice: roll.rolls }, ...damage.logs);
  if (damage.result.status !== 'RESOLVED')
    throw new ContextRequired(JSON.stringify(damage.result.status));
  state.protection = damage.state;
  setPhase('consequence');
  postDamage(state, damage.result, command, rng, logs);
  setPhase('property');
  return { dice: roll.rolls.map((r) => r.value), finalDamage: damage.result.finalDamage ?? 0 };
}

/**
 * One corrosion step (ruling 115–117): the zone armour loses Хк10 ОБ; when it is already 0 the
 * Хк10 go into the body as a separate wound.
 */
function corrode(state: EngineState, key: string, rng: DiceSource, logs: unknown[]) {
  const c = state.corrosion![key]!;
  const armourKey = `${c.actor}:${c.zone}`;
  const base = state.zoneArmour?.[armourKey] ?? 0;
  const ob = Math.max(0, base - (state.armorLoss[armourKey] ?? 0));
  if (ob > 0) {
    const dice = Array.from({ length: c.dice }, () => rollDie(10, rng).value);
    const loss = Math.min(
      ob,
      dice.reduce((a, v) => a + v, 0),
    );
    state.armorLoss[armourKey] = (state.armorLoss[armourKey] ?? 0) + loss;
    logs.push({ type: 'corrosion', actor: c.actor, zone: c.zone, dice, armourLoss: loss });
    return { armourLoss: loss, dice };
  }
  const wound = separateWound(
    state,
    c.command,
    { ...c.hit, hitId: `${c.hit.hitId}:corrosion:${state.wounds.combat.session.turnsStarted}` },
    c.hit.location,
    'corrosion',
    c.dice,
    rng,
    logs,
  );
  logs.push({ type: 'corrosion', actor: c.actor, zone: c.zone, wound });
  return { wound };
}
function corrodeAtTurnStart(state: EngineState, id: ActorId, rng: DiceSource, logs: unknown[]) {
  for (const key of Object.keys(state.corrosion ?? {}))
    if (state.corrosion![key]!.actor === id && state.wounds.actors[id]?.life.status !== 'DEAD')
      corrode(state, key, rng, logs);
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
    family: WeaponFamily;
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
  // «Знаток Цепного оружия»: one more к10 for the damage, the lowest die is dropped (ruling 126).
  let rolled = roll.rolls;
  if (
    hasTrait(traits, 'Цепное') &&
    hit.profile.expression.sides === 10 &&
    canonicalTalents(attacker.talents).includes('Знаток Цепного оружия')
  ) {
    const all = [...roll.rolls, rollDie(10, rng)];
    const low = all.reduce((m, r, i) => (r.value < all[m]!.value ? i : m), 0);
    rolled = all.filter((_, i) => i !== low);
  }
  const dice = adjustDamageDice(traits, rolled, rng);
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
  // «Мастер Мельта-оружия»: when «Мельта» works, ББ + 2 × ½ degrees of НС, up (ruling 126).
  const meltaMaster =
    hasTrait(traits, 'Мельта') &&
    bonus.penetrationMultiplier > 1 &&
    canonicalTalents(attacker.talents).includes('Мастер Мельта-оружия')
      ? 2 * Math.ceil(Math.max(0, info.degrees) / 2)
      : 0;
  if (meltaMaster) notes.push(`Мастер Мельта-оружия: ББ +${meltaMaster}`);
  // Talents (ruling 121): «Сокрушительный удар/выстрел», «Мастер Болт/Лаз/Плазменного оружия».
  const talentBonus = talentDamage({
    talents: canonicalTalents(attacker.talents),
    kind: info.kind === 'melee' ? 'melee' : 'ranged',
    family: info.family,
    nrBonus: bonusOf(attacker, 'НР'),
    nsBonus: bonusOf(attacker, 'НС'),
    degrees: info.degrees,
  });
  for (const t of talentBonus.damage) {
    flat += t.value;
    notes.push(`${t.talent}: +${t.value}`);
  }
  let total = sum(dice.rolls) + hit.profile.expression.modifier + sum(extra) - sum(minus) + flat;
  const strength = strengthRequirement(traits, sl);
  if (strength.halveDamage) {
    total = Math.ceil(total / 2);
    notes.push('Сила: бСЛ ниже нужного — урон /2');
  }
  total = Math.max(0, total);
  const penetration =
    hit.penetration.value * bonus.penetrationMultiplier +
    bonus.penetrationAdd +
    talentBonus.penetration.reduce((a, t) => a + t.value, 0) +
    meltaMaster;
  for (const t of talentBonus.penetration) notes.push(`${t.talent}: ББ +${t.value}`);
  // «Цепное»: the armour element loses ОБ equal to ББ at once (rulings 5, 16).
  if (hasTrait(traits, 'Цепное') && armour.zone) {
    state.armorLoss[armour.key] = (state.armorLoss[armour.key] ?? 0) + penetration;
    armour.ob = Math.max(0, armour.base - state.armorLoss[armour.key]!);
    notes.push(`Цепное: броня (${zoneName[armour.zone]}) −${penetration} ОБ`);
  }
  // «Плавящее» (ruling 94): as «Цепное»; what the armour lacks is added to the damage.
  const melt = meltingLoss(traits, penetration, total);
  if (melt !== null) {
    const before = armour.ob;
    if (armour.zone)
      state.armorLoss[armour.key] = (state.armorLoss[armour.key] ?? 0) + Math.min(melt, before);
    armour.ob = Math.max(0, before - melt);
    const rest = Math.max(0, melt - before);
    total += rest;
    notes.push(
      `Плавящее: броня −${Math.min(melt, before)} ОБ${rest ? `, остаток +${rest} к урону` : ''}`,
    );
  }
  // «Ловец стрел»: + бНР of the target to the ОБ against primitive ranged attacks (ruling 126).
  if (
    info.kind === 'ranged' &&
    hasTrait(traits, 'Примитивное') &&
    canonicalTalents(target.talents).includes('Ловец стрел')
  ) {
    const nr = bonusOf(target, 'НР');
    armour.ob += nr;
    notes.push(`Ловец стрел: ОБ +${nr}`);
  }
  // Лэнс / Примитивное change the armour before ББ; the core subtracts ББ.
  const ob = armourAfterProperties(traits, {
    armour: armour.ob,
    penetration: 0,
    weaponClass: info.weaponClass,
  });
  // Runtime ВН: «Токсичное» lowers it during the fight (ruling 95).
  const runtimeVN = state.wounds.combat.actors[command.target]!.characteristics.ВН!;
  const vn = { value: runtimeVN.baseValue, super: runtimeVN.baseSuper };
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
  // «Калечащий удар / выстрел»: +2 to the critical consequence die (ruling 123).
  const wound = postDamage(
    state,
    damage.result,
    command,
    rng,
    logs,
    criticalBonus(canonicalTalents(attacker.talents), info.kind === 'melee' ? 'melee' : 'ranged'),
  );
  setPhase('property');
  // «Деструктор (Х)» (rulings 71, 88): damage above ОБ after ББ — Хк10 as a separate wound,
  // without armour, minus бВН, with its own consequence.
  const destroyerX = destroyerDice(traits, total, Math.max(0, ob - penetration));
  let destroyer: { dice: number[]; finalDamage: number } | null = null;
  if (destroyerX > 0 && state.wounds.actors[command.target]?.life.status !== 'DEAD') {
    destroyer = separateWound(
      state,
      command,
      hit,
      hit.location,
      'destroyer',
      destroyerX,
      rng,
      logs,
    );
  }
  const effects = applyAfterHit(
    b,
    state,
    command,
    traits,
    damage.result.finalDamage ?? 0,
    rng,
    logs,
  );
  if (destroyer)
    effects.push({
      property: 'Деструктор',
      passed: false,
      state: `отдельное ранение ${destroyer.dice.join('+')} → ${destroyer.finalDamage} ран`,
    });
  // «Калечащее (Х)»: unabsorbed damage — light bleeding and Х wounds at the 2nd ОД (ruling 89).
  const crippleX = cripplingWounds(traits);
  if (
    crippleX &&
    (damage.result.finalDamage ?? 0) > 0 &&
    state.wounds.actors[command.target]?.life.status === 'ALIVE'
  ) {
    state.crippling = {
      ...state.crippling,
      [command.target]: Math.max(state.crippling?.[command.target] ?? 0, crippleX),
    };
    const injury = wound.injuriesCreated[0];
    const w = state.wounds.actors[command.target]!;
    if (injury && !w.bleeding.some((x) => x.id === `${injury.id}:crippling`)) {
      const session = state.wounds.combat.session;
      state.wounds = {
        ...state.wounds,
        actors: {
          ...state.wounds.actors,
          [command.target]: {
            ...w,
            bleeding: [
              ...w.bleeding,
              {
                id: `${injury.id}:crippling`,
                injuryId: injury.id,
                consequence: injury.consequence,
                severity: 'LIGHT',
                location: injury.location,
                active: true,
                appliedRound: session.roundNumber,
                appliedTurn: session.turnsStarted,
                provenance: {
                  source: { kind: 'weapon-property', id: 'Свойства оружия: Калечащее' },
                  reason: 'Непоглощённый урон: лёгкое кровотечение',
                },
              },
            ],
          },
        },
      };
    }
    effects.push({
      property: 'Калечащее',
      passed: false,
      state: `лёгкое кровотечение, −${crippleX} ран при 2-м ОД за ход`,
    });
  }
  // «Огненное (Х/Y)» (rulings 87, 90, 92): ЛВ+0, a failure — Х without armour minus бВН and
  // without consequences; the target burns for Y rounds.
  const fire = fireProperty(traits);
  if (fire && state.wounds.actors[command.target]?.life.status === 'ALIVE') {
    const dex = target.characteristics.ЛВ;
    const check = resolveCheck(
      {
        baseValue: dex.value,
        finalSuper: dex.super,
        context: context(state.wounds.combat, command.target, command.actor),
      },
      rng,
    ).result;
    let burnt = 0;
    if (check.outcome !== 'success') {
      setPhase('damage');
      const rolls = Array.from({ length: fire.damage.count }, () =>
        rollDie(fire.damage.sides, rng),
      );
      burnt = Math.max(0, sum(rolls) + fire.damage.modifier - bonusVN(state, command.target));
      plainWounds(state, command.target, burnt, logs);
      setPhase('property');
    }
    logs.push({ type: 'fire-test', check, wounds: burnt });
    const halfOb = ask(command, {
      key: `burning-ob:${command.target}`,
      text: `${target.name} горит («Огненное»). Сколько это ½ ОБ сочленений? «Горение» каждый ход бьёт 2к10 Э в сочленения с ½ ОБ (решения 75, 87).`,
      min: 0,
      max: 99,
    });
    state.burning = {
      ...state.burning,
      [command.target]: {
        rounds: Math.max(state.burning?.[command.target]?.rounds ?? 0, fire.rounds),
        halfOb,
      },
    };
    effects.push({
      property: 'Огненное',
      passed: check.outcome === 'success',
      state:
        check.outcome === 'success'
          ? `увернулся от огня (ЛВ), но горит`
          : `огонь: −${burnt} ран, горит`,
      rounds: fire.rounds,
    });
  }
  // «Токсичное» (rulings 95, 98): sealed or void armour stops the toxin; otherwise any hit.
  const toxic = toxicProperty(traits);
  if (
    toxic &&
    state.wounds.actors[command.target]?.life.status === 'ALIVE' &&
    !sealedArmour(target.armourItems)
  ) {
    let superWounds = false;
    let passed = false;
    if (vn.super > 0) {
      const gm = { kind: 'weapon-property', id: 'Свойства оружия: Токсичное' };
      const check = resolveCheck(
        {
          baseValue: vn.value,
          finalSuper: vn.super,
          context: {
            ...context(state.wounds.combat, command.target, command.actor),
            modifiers: toxic.superModifier
              ? [
                  {
                    id: `${command.id}:toxic:${hit.hitId}`,
                    value: toxic.superModifier,
                    source: gm,
                    provenance: { source: gm, reason: 'СверхВН: тест ВН −5 × Х' },
                  },
                ]
              : [],
          },
        },
        rng,
      ).result;
      logs.push({ type: 'toxic-test', check });
      passed = check.outcome === 'success';
      superWounds = !passed;
    }
    if (!passed) {
      const old = state.toxic?.[command.target];
      state.toxic = {
        ...state.toxic,
        [command.target]: {
          dice: Math.max(old?.dice ?? 0, toxic.dice),
          superWounds: superWounds || (old?.superWounds ?? false),
          rounds:
            old?.rounds === null || toxic.rounds === null
              ? null
              : Math.max(old?.rounds ?? 0, toxic.rounds),
        },
      };
    }
    effects.push({
      property: 'Токсичное',
      passed,
      state: passed
        ? 'СверхВН: токсин не подействовал'
        : superWounds
          ? 'отравлен: 1к10 ран каждый ход'
          : `отравлен: ВН −${toxic.dice}к10 каждый ход`,
      ...(toxic.rounds ? { rounds: toxic.rounds } : {}),
    });
  }
  // «Рад» (rulings 101–103): pierced armour — rad damage; unpierced — it ignores armour unless
  // the armour is rad-protected, void or servo, and halves ВН till the end of the fight.
  const radCount = radDice(traits, info.weaponClass);
  if (radCount && state.wounds.actors[command.target]?.life.status === 'ALIVE') {
    const pierced = total > Math.max(0, ob - penetration);
    if (pierced || !radProtectedArmour(target.armourItems)) {
      setPhase('damage');
      const dice = Array.from({ length: radCount }, () => rollDie(10, rng).value);
      setPhase('property');
      const old = state.rad?.[command.target] ?? { total: 0, halved: false };
      let halved = old.halved;
      if (!pierced && !halved) {
        halved = true;
        const combat = state.wounds.combat;
        const actor = combat.actors[command.target]!;
        const v = actor.characteristics.ВН!;
        state.wounds = {
          ...state.wounds,
          combat: {
            ...combat,
            actors: {
              ...combat.actors,
              [command.target]: {
                ...actor,
                characteristics: {
                  ...actor.characteristics,
                  ВН: {
                    ...v,
                    baseValue: Math.floor(v.baseValue / 2),
                    baseSuper: Math.floor(v.baseSuper / 2),
                  },
                },
              },
            },
          },
        };
      }
      const raw = dice.reduce((a, v) => a + v, 0);
      const wounds = Math.max(0, raw - bonusVN(state, command.target));
      plainWounds(state, command.target, wounds, logs);
      state.rad = { ...state.rad, [command.target]: { total: old.total + raw, halved } };
      logs.push({ type: 'rad', pierced, dice, wounds, halved });
      effects.push({
        property: 'Рад',
        passed: false,
        state: `рад-урон ${radCount}к10 (${dice.join('+')}) → −${wounds} ран${!pierced ? ', ВН /2 до конца боя' : ''}; накоплено ${old.total + raw}`,
      });
    } else effects.push({ property: 'Рад', passed: true, state: 'броня защищает от радиации' });
  }
  // «Коррозийное (Х)» (rulings 115–117): the zone armour corrodes now and every turn.
  const corrosive = corrosiveDice(traits);
  if (corrosive !== null && state.wounds.actors[command.target]?.life.status === 'ALIVE') {
    if (!armour.zone)
      effects.push({
        property: 'Коррозийное',
        passed: false,
        state: 'попадание не в зону брони — ведущему вручную',
      });
    else {
      const x =
        corrosive ??
        ask(command, {
          key: `corrosive:${command.weapon}`,
          text: `«Коррозийное» без Х в Арсенале (${weaponOf(b, command.weapon)?.name ?? command.weapon}): сколько к10 урона броне?`,
          min: 1,
          max: 10,
        });
      const key = `${command.target}:${armour.zone}`;
      state.zoneArmour = { ...state.zoneArmour, [key]: armour.base };
      state.corrosion = {
        ...state.corrosion,
        [key]: {
          actor: command.target,
          zone: armour.zone,
          dice: Math.max(state.corrosion?.[key]?.dice ?? 0, x),
          hit,
          command: { ...command, answers: {} },
        },
      };
      const step = corrode(state, key, rng, logs);
      effects.push({
        property: 'Коррозийное',
        passed: false,
        state: step.wound
          ? `броня (${zoneName[armour.zone]}) разъедена: ${step.wound.finalDamage} ран`
          : `броня (${zoneName[armour.zone]}) −${step.armourLoss} ОБ, разъедает каждый ход`,
      });
    }
  }
  // «Проникающее» (rulings 118–120): the GM says whether the weapon stayed in the wound.
  if (
    hasTrait(traits, 'Проникающее') &&
    (damage.result.finalDamage ?? 0) > 0 &&
    state.wounds.actors[command.target]?.life.status === 'ALIVE' &&
    !state.impaled?.[command.weapon]
  ) {
    const stuck =
      ask(command, {
        key: `impale:${hit.hitId}`,
        text: `«Проникающее»: оружие осталось в ране ${target.name}? (решение 118)`,
        options: [
          { label: 'Осталось в ране', value: 1 },
          { label: 'Нет', value: 0 },
        ],
      }) === 1;
    if (stuck) {
      const loc = hit.location;
      const skr = loc === 'Torso' || loc.includes('Leg');
      const combat = state.wounds.combat;
      const blade = combat.melee?.weapons[command.weapon];
      const runtime = combat.actors[command.target]!;
      // СКР never drops to 0 (the core needs a positive value): at most down to 0.5.
      const skrLoss = skr ? Math.max(0, Math.min(1, runtime.movement - 0.5)) : 0;
      state.impaled = {
        ...state.impaled,
        [command.weapon]: { target: command.target, location: loc, skr, skrLoss },
      };
      state.wounds = {
        ...state.wounds,
        combat: {
          ...combat,
          ...(blade && combat.melee
            ? {
                melee: {
                  ...combat.melee,
                  weapons: {
                    ...combat.melee.weapons,
                    [command.weapon]: { ...blade, held: false, readied: false, dropped: true },
                  },
                },
              }
            : {}),
          actors: skr
            ? {
                ...combat.actors,
                [command.target]: { ...runtime, movement: runtime.movement - skrLoss },
              }
            : combat.actors,
        },
      };
      effects.push({
        property: 'Проникающее',
        passed: false,
        state: `оружие в ране (${locationLabel(loc)}): ${skr ? '−1 СКР' : loc.includes('Arm') ? '−10 к атакам' : 'ведущему'}`,
      });
    }
  }
  // «Гравитонное» (rulings 96, 97): СЛ −30, a failure — falls, к10 per odd degree into a leg.
  if (
    hasTrait(traits, 'Гравитонное') &&
    state.wounds.actors[command.target]?.life.status === 'ALIVE'
  ) {
    const sl = target.characteristics.СЛ;
    const gm = { kind: 'weapon-property', id: 'Свойства оружия: Гравитонное' };
    const check = resolveCheck(
      {
        baseValue: sl.value,
        finalSuper: sl.super,
        context: {
          ...context(state.wounds.combat, command.target, command.actor),
          modifiers: [
            {
              id: `${command.id}:graviton:${hit.hitId}`,
              value: -30,
              source: gm,
              provenance: { source: gm, reason: 'Гравитонное: СЛ −30' },
            },
          ],
        },
      },
      rng,
    ).result;
    logs.push({ type: 'graviton-test', check });
    if (check.outcome === 'success') effects.push({ property: 'Гравитонное', passed: true });
    else {
      const combat = state.wounds.combat;
      const runtime = combat.actors[command.target]!;
      state.wounds = {
        ...state.wounds,
        combat: {
          ...combat,
          actors: { ...combat.actors, [command.target]: { ...runtime, posture: 'prone' } },
        },
      };
      const count = gravitonDice(traits, check.failureDegrees ?? 1);
      const leg = ask(command, {
        key: `graviton-leg:${hit.hitId}`,
        text: `«Гравитонное»: ${target.name} падает, урон ${count}к10 в ногу. В какую?`,
        options: [
          { label: 'Левая', value: 0 },
          { label: 'Правая', value: 1 },
        ],
      });
      const w = separateWound(
        state,
        command,
        hit,
        leg === 0 ? 'Left Leg' : 'Right Leg',
        'graviton',
        count,
        rng,
        logs,
      );
      effects.push({
        property: 'Гравитонное',
        passed: false,
        state: `упал, ${count}к10 (${w.dice.join('+')}) в ногу → ${w.finalDamage} ран`,
      });
    }
  }
  // «Мгновенная смерть»: damage after absorption ≥ 2 × бВН kills on the spot.
  if (
    instantDeath(traits, damage.result.finalDamage ?? 0, damage.result.bVN ?? 0) &&
    state.wounds.actors[command.target]?.life.status !== 'DEAD'
  ) {
    state.wounds = planDeath(
      state.wounds,
      ref(command.target),
      damage.result.bVN ?? 0,
      {
        source: { kind: 'weapon-property', id: 'Свойства оружия: Мгновенная смерть' },
        reason: 'Урон после поглощения ≥ 2 × бВН',
      },
      'TORSO',
    ).state;
    effects.push({ property: 'Мгновенная смерть', passed: false, state: 'убит на месте' });
  }
  // «Контузия (Х)»: −10 × Х to НС, НР and СВ tests for ½Х rounds rounded up (ruling 73).
  const conc = concussion(traits);
  if (conc && state.wounds.actors[command.target]?.life.status === 'ALIVE') {
    const session = state.wounds.combat.session;
    const src = { kind: 'weapon-property', id: 'Свойства оружия: Контузия' };
    const prov = { source: src, reason: `Контузия: ${conc.modifier} на ${conc.rounds} р.` };
    const id = `${command.id}:Контузия:${command.target}:${hit.hitId}`;
    const effect = (tag: string) => ({
      id: `${id}:${tag}`,
      source: src,
      targetActor: ref(command.target),
      provenance: prov,
      definition: {
        id: `Concussion:${tag}`,
        target: { kind: 'check' as const },
        operation: 'add' as const,
        value: conc.modifier,
        stage: 'temporary' as const,
        condition: { requiresTags: [tag] },
        stackingGroup: `Concussion:${tag}`,
        stackingRule: 'largest' as const,
        tags: ['Concussion'],
        provenance: prov,
      },
    });
    state.wounds = {
      ...state.wounds,
      combat: {
        ...state.wounds.combat,
        session: {
          ...session,
          conditions: [
            ...session.conditions,
            {
              id,
              type: 'Concussed',
              actor: ref(command.target),
              sources: [src],
              provenance: [prov],
              stackingRule: 'REJECT',
              unit: 'round',
              appliedRound: session.roundNumber,
              durationRounds: conc.rounds,
              expiresAfterRound: session.roundNumber + conc.rounds - 1,
              effects: [effect('ranged'), effect('melee'), effect('check:suppression')],
            },
          ],
        },
      },
    };
    effects.push({
      property: 'Контузия',
      passed: false,
      state: `контужен (${conc.modifier})`,
      rounds: conc.rounds,
    });
  }
  return {
    effects,
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

/**
 * «Мастер Стаб-оружия» (ruling 126): stub weapons get «Проверенное (½ бНС)», rounded up; a
 * higher rating of the weapon stays.
 */
function withTalentTraits(
  traits: WeaponTraitReference[],
  w: ArsenalWeapon,
  c: CharacterDocument,
): WeaponTraitReference[] {
  if (w.sheet !== 'Стаб и РПУ' || !canonicalTalents(c.talents).includes('Мастер Стаб-оружия'))
    return traits;
  const value = Math.ceil(bonusOf(c, 'НС') / 2);
  const own = traits.find((t) => t.name === 'Проверенное');
  if (own && (own.value ?? 0) >= value) return traits;
  return [...traits.filter((t) => t.name !== 'Проверенное'), { name: 'Проверенное', value }];
}
/** «Двойной выстрел»: two ranged weapons, the first attack succeeded (ruling 127). */
function doubleShot(b: Battle, command: AttackCommand, first: { attack: unknown }) {
  const ranged = (id: WeaponId) => {
    const w = weaponOf(b, id)?.arsenal;
    return !!w && weaponKind(w) === 'ranged';
  };
  return (
    canonicalTalents(combatant(b, command.actor).character.talents).includes('Двойной выстрел') &&
    ranged(command.weapon) &&
    !!command.second &&
    ranged(command.second) &&
    (first.attack as { check?: { outcome?: string } } | null)?.check?.outcome === 'success'
  );
}
/**
 * Why the charge to `at` is impossible: the cell must be free and next to the target (≤ 1.5 m),
 * the straight path free of walls and closed doors, at most 3 × СКР (ruling 132).
 */
export function chargeProblem(
  b: Battle,
  actor: ActorId,
  target: ActorId,
  at: { x: number; y: number },
): string | null {
  const from = posOf(b, actor);
  const to = posOf(b, target);
  if (Math.hypot(at.x - to.x, at.y - to.y) > 1.5 + 1e-9)
    return 'Натиск заканчивается рядом с целью';
  const skr = getEngine(b).wounds.combat.actors[actor]?.movement ?? 0;
  const d = Math.hypot(at.x - from.x, at.y - from.y);
  if (d > skr * 3 + 1e-9) return `Натиск — не дальше 3 × СКР (${skr * 3} м)`;
  const place = placementProblemFor(b, actor, at);
  if (place) return place;
  const wall = sightLineBlocker(from, at, sceneGeometry(b));
  if (wall) return `Путь натиска перекрыт: ${wall.label}`;
  return null;
}
/** The nearest free cell next to the target for a charge, or null. */
export function chargeDestination(b: Battle, actor: ActorId, target: ActorId) {
  const from = posOf(b, actor);
  const to = posOf(b, target);
  const cells: { x: number; y: number }[] = [];
  for (const dx of [-1, 0, 1])
    for (const dy of [-1, 0, 1]) if (dx || dy) cells.push({ x: to.x + dx, y: to.y + dy });
  cells.sort(
    (a, c) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(c.x - from.x, c.y - from.y),
  );
  return cells.find((c) => !chargeProblem(b, actor, target, c)) ?? null;
}
/** Called-attack penalties («Бой» A52), to cap the talents that reduce them. */
const CALLED_PENALTY: Record<CalledLocation, number> = {
  Eyes: -50,
  Head: -20,
  'Right Arm': -20,
  'Left Arm': -20,
  Torso: -10,
  'Right Leg': -15,
  'Left Leg': -15,
  'Armor Joints': -40,
};
/** Weapon family for the «Знаток / Мастер …-оружия» talents (Arsenal sheet, «Мельта»). */
function weaponFamily(w: ArsenalWeapon, traits: readonly WeaponTraitReference[]): WeaponFamily {
  if (hasTrait(traits, 'Мельта')) return 'melta';
  return w.sheet === 'Болт'
    ? 'bolt'
    : w.sheet === 'Лаз'
      ? 'las'
      : w.sheet === 'Плазма'
        ? 'plasma'
        : 'other';
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
  if (command.counter) {
    const opportunity = state.wounds.combat.melee?.counterattacks.find(
      (x) => x.id === command.counter,
    );
    if (
      !opportunity ||
      opportunity.spent ||
      opportunity.actor.actorId !== command.actor ||
      !counterIsFresh(state, opportunity.triggeringResolutionId)
    )
      throw new Error('Права на контратаку нет (контратака — сразу после парирования)');
    if (opportunity.target.actorId !== command.target)
      throw new Error('Контратака — только по тому, кто атаковал');
  } else if (state.wounds.combat.session.activeActor?.actorId !== command.actor)
    throw new Error('Сейчас ход другого персонажа');
  if (state.wounds.actors[command.actor]!.life.status !== 'ALIVE')
    throw new ContextRequired('Действия в агонии и после смерти не разрешаются.');
  const from = posOf(b, command.actor)!;
  const p = command.charge ?? from,
    q = posOf(b, command.target)!,
    distance = Math.hypot(p.x - q.x, p.y - q.y);
  const chargeDistance = command.charge
    ? Math.hypot(command.charge.x - from.x, command.charge.y - from.y)
    : 0;
  if (command.charge) {
    const problem = chargeProblem(b, command.actor, command.target, command.charge);
    if (problem) throw new Error(problem);
  }
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
  const traits = withTalentTraits(
    impliedTraits(weaponTraits(arsenalWeapon).traits),
    arsenalWeapon,
    combatant(b, command.actor).character,
  );
  if (command.counter && kind !== 'melee')
    throw new Error('Контратака — только оружием ближнего боя');
  // «Раны и лечение»: a blinded character fails НС automatically, НР without «Бой вслепую».
  const conditionsOf = (id: string) =>
    state.wounds.combat.session.conditions.filter(
      (c) =>
        c.actor.actorId === id && remainingRounds(c, state.wounds.combat.session.roundNumber) > 0,
    );
  if (conditionsOf(command.actor).some((c) => c.type === 'Blinded')) {
    const blindFighter = canonicalTalents(combatant(b, command.actor).character.talents).includes(
      'Бой вслепую',
    );
    if (kind === 'ranged' || !blindFighter)
      throw new Error(
        `${actorName(b, command.actor)} ослеплён: тесты ${kind === 'ranged' ? 'НС' : 'НР'} проваливаются автоматически («Раны и лечение», Слепота)`,
      );
  }
  // «Проникающее»: a weapon stuck in the attacker's arm — −10 to actions with it (ruling 118).
  if (
    Object.values(state.impaled ?? {}).some(
      (x) => x.target === command.actor && x.location.includes('Arm'),
    )
  ) {
    const src = { kind: 'weapon-property', id: 'Свойства оружия: Проникающее' };
    ctx = {
      ...ctx,
      modifiers: [
        ...ctx.modifiers,
        {
          id: `${command.id}:impaled-arm`,
          value: -10,
          source: src,
          provenance: { source: src, reason: 'Оружие в ране руки' },
        },
      ],
    };
  }
  // «Раны и лечение»: attacks on a stunned target get +20.
  if (conditionsOf(command.target).some((c) => c.type === 'Stunned')) {
    const src = { kind: 'canonical', id: 'Раны и лечение: Оглушён — атаки по цели +20' };
    ctx = {
      ...ctx,
      modifiers: [
        ...ctx.modifiers,
        {
          id: `${command.id}:target-stunned`,
          value: 20,
          source: src,
          provenance: { source: src, reason: 'Цель оглушена' },
        },
      ],
    };
  }
  // Ruling 84: without «Владение оружием» of this kind −30 (the GM decides unclear kinds).
  const weaponKindLabel = weaponKindName(arsenalWeapon);
  const attackerTalents = combatant(b, command.actor).character.talents;
  const attackerTalentsCanon = canonicalTalents(attackerTalents);
  // Talents on the attack test (ruling 122): called-attack penalty reductions, «Знаток
  // Болт-оружия».
  for (const t of talentAttackModifiers({
    talents: attackerTalentsCanon,
    kind,
    family: weaponFamily(arsenalWeapon, traits),
    calledPenalty: command.calledLocation ? CALLED_PENALTY[command.calledLocation] : 0,
  })) {
    const src = { kind: 'talent', id: `Таланты: ${t.talent}` };
    ctx = {
      ...ctx,
      modifiers: [
        ...ctx.modifiers,
        {
          id: `${command.id}:talent:${t.talent}`,
          value: t.value,
          source: src,
          provenance: { source: src, reason: t.talent },
        },
      ],
    };
  }
  const proficient = isExotic(arsenalWeapon)
    ? hasExoticProficiency(attackerTalents, arsenalWeapon)
    : weaponKindLabel
      ? hasProficiency(attackerTalents, weaponKindLabel)
      : ask(command, {
          key: `proficiency:${command.weapon}`,
          text: `${actorName(b, command.actor)}: владеет ли видом оружия «${selected.name}»? (решение 84: без владения −30)`,
          options: [
            { label: 'Владеет', value: 1 },
            { label: 'Не владеет (−30)', value: 0 },
          ],
        }) === 1;
  if (!proficient) {
    const gm = { kind: 'author-ruling', id: 'Решение 84: нет «Владения оружием»' };
    ctx = {
      ...ctx,
      modifiers: [
        ...ctx.modifiers,
        {
          id: `${command.id}:no-proficiency`,
          // «Универсальный солдат»: −10 lower.
          value: unfamiliarWeaponPenalty(attackerTalentsCanon, PROFICIENCY_PENALTY),
          source: gm,
          provenance: {
            source: gm,
            reason: `Нет «Владения оружием (${weaponKindLabel ?? selected.name})»`,
          },
        },
      ],
    };
  }
  // Two weapons (rulings 105, 106): both attacks carry the two-weapon flag; a basic ranged
  // weapon is then fired with one hand (−20, «Бой»).
  const dual = Boolean(command.second || command.dualPrimary);
  if (dual) {
    const owned = canonicalTalents(combatant(b, command.actor).character.talents);
    const core = kind === 'ranged' ? 'Парное оружие (Стрелковое)' : 'Парное оружие (Рукопашное)';
    const runtime = state.wounds.combat.actors[command.actor]!;
    if (!(runtime.talents ?? []).includes(core) && owned.includes('Парное оружие')) {
      const covers =
        ask(command, {
          key: `dual-talent:${kind}`,
          text: `${actorName(b, command.actor)}: «Парное оружие» без уточнения. Оно для ${kind === 'ranged' ? 'стрельбы (НС)' : 'ближнего боя (НР)'}? (решение 106)`,
          options: [
            { label: 'Да', value: 1 },
            { label: 'Нет', value: 0 },
          ],
        }) === 1;
      if (covers)
        state.wounds = {
          ...state.wounds,
          combat: {
            ...state.wounds.combat,
            actors: {
              ...state.wounds.combat.actors,
              [command.actor]: { ...runtime, talents: [...(runtime.talents ?? []), core] },
            },
          },
        };
    }
  }
  // «Офицерское оружие»: no penalties for a pistol together with a melee weapon.
  const pair = command.second ?? command.dualWith;
  const pairArsenal = pair ? weaponOf(b, pair)?.arsenal : null;
  const officer =
    dual &&
    !!pairArsenal &&
    canonicalTalents(combatant(b, command.actor).character.talents).includes('Офицерское оружие') &&
    ((arsenalWeapon.weaponClass === 'П' && weaponKind(pairArsenal) === 'melee') ||
      (pairArsenal.weaponClass === 'П' && kind === 'melee'));
  const officerRestore = state.wounds.combat.actors[command.actor]!.talents;
  if (officer) {
    const runtime = state.wounds.combat.actors[command.actor]!;
    state.wounds = {
      ...state.wounds,
      combat: {
        ...state.wounds.combat,
        actors: {
          ...state.wounds.combat.actors,
          [command.actor]: {
            ...runtime,
            talents: [
              ...(runtime.talents ?? []),
              'Парное оружие (Стрелковое)',
              'Парное оружие (Рукопашное)',
            ],
          },
        },
      },
    };
  }
  const dualRequest: { dualWield?: { primaryId?: string }; oneHanded?: boolean } = dual
    ? {
        dualWield: command.dualPrimary ? { primaryId: command.dualPrimary } : {},
        ...(kind === 'ranged' && arsenalWeapon.weaponClass === 'ОС' ? { oneHanded: true } : {}),
      }
    : {};
  if (command.charge && kind !== 'melee') throw new Error('Натиск — только с оружием ближнего боя');
  // «Яростный натиск»: the charge gives +30 instead of +20 (ruling 132).
  if (command.charge && attackerTalentsCanon.includes('Яростный натиск')) {
    const src = { kind: 'talent', id: 'Таланты: Яростный натиск' };
    ctx = {
      ...ctx,
      modifiers: [
        ...ctx.modifiers,
        {
          id: `${command.id}:talent:Яростный натиск`,
          value: 10,
          source: src,
          provenance: { source: src, reason: 'Натиск +30 вместо +20' },
        },
      ],
    };
  }
  // «Безумный натиск»: against a smaller target an opposed СЛ test (free action); a win gives
  // the target −30 to parry and dodge this attack (ruling 132).
  let frenzyPenalty = 0;
  if (
    command.charge &&
    attackerTalentsCanon.includes('Безумный натиск') &&
    combatant(b, command.target).character.size < combatant(b, command.actor).character.size
  ) {
    const opposed = opposedMeleeCheck(
      state.wounds.combat,
      ref(command.actor),
      ref(command.target),
      'СЛ',
      context(state.wounds.combat, command.actor, command.target),
      context(state.wounds.combat, command.target, command.actor),
      rng,
    );
    logs.push(...opposed.logs);
    if (opposed.result.winner?.actorId === command.actor) frenzyPenalty = -30;
  }
  if (command.doubleShot) {
    const src = { kind: 'talent', id: 'Таланты: Двойной выстрел' };
    ctx = {
      ...ctx,
      modifiers: [
        ...ctx.modifiers,
        {
          id: `${command.id}:talent:Двойной выстрел`,
          value: 20,
          source: src,
          provenance: { source: src, reason: 'Первый выстрел попал' },
        },
      ],
    };
  }
  const family = weaponFamily(arsenalWeapon, traits);
  // «Шквал лазогня»: las bursts get +1 degree if the shooter has not moved this turn.
  const squall =
    kind === 'ranged' &&
    family === 'las' &&
    attackerTalentsCanon.includes('Шквал лазогня') &&
    !state.moves.some(
      (m) => m.actor === command.actor && m.turn === state.wounds.combat.session.turnsStarted,
    )
      ? 1
      : 0;
  // «Знаток Лаз-оружия»: the target's dodge −5 × degrees of the hit, at most −30.
  const lasExpert =
    kind === 'ranged' && family === 'las' && attackerTalentsCanon.includes('Знаток Лаз-оружия');
  let lasPenalty = 0;
  const info = {
    kind,
    traits,
    weaponClass: arsenalWeapon.weaponClass,
    distance,
    // The template's range (talent «Знаток Мельта-оружия» lengthens it, ruling 124).
    optimalRange:
      state.wounds.combat.weapons[command.weapon]?.template.profile.optimalRange ??
      arsenalWeapon.range.meters!,
    family: weaponFamily(arsenalWeapon, traits),
  };
  const hits: DamageInput[] = [];
  let attack: unknown, degrees: number;
  let reaction: unknown = null;
  let suppression: unknown = null;
  // The target decides its reaction once it is hit: a trial run reads only the attack roll
  // (kept for the real run) to see whether anything hits; then the target is asked.
  let peeked: number | null = null;
  const peekSource: DiceSource = {
    roll(sides) {
      if (peeked === null) {
        peeked = rng.roll(sides);
        return peeked;
      }
      return 1;
    },
  };
  let peekUsed = false;
  const realSource: DiceSource = {
    roll(sides) {
      if (peeked !== null && !peekUsed) {
        peekUsed = true;
        return peeked;
      }
      return rng.roll(sides);
    },
  };
  const askDefense = (
    hit: boolean,
    canParry: boolean,
    key = 'reaction',
  ): 'DECLINE' | 'DODGE' | 'PARRY' => {
    if (command.counter) return 'DECLINE';
    if (command.defense) return command.defense;
    const entry = state.wounds.combat.session.initiativeOrder.find(
      (e) => e.actor.actorId === command.target,
    );
    if (!hit || !entry?.reactions.remaining) return 'DECLINE';
    if (state.wounds.actors[command.target]?.life.status !== 'ALIVE') return 'DECLINE';
    const answer = ask(command, {
      key,
      text: `${actorName(b, command.target)}: по вам попали (${actorName(b, command.actor)}). Ваша реакция?`,
      options: [
        { label: 'Без реакции', value: 0 },
        { label: 'Уклонение', value: 1 },
        ...(canParry ? [{ label: 'Парирование', value: 2 }] : []),
      ],
    });
    return answer === 2 ? 'PARRY' : answer === 1 ? 'DODGE' : 'DECLINE';
  };
  const targetParries = () => {
    const melee = state.wounds.combat.melee;
    const wid = melee?.actors[command.target]?.weaponId;
    const w = wid ? melee?.weapons[wid] : undefined;
    return !!w && w.held && w.template.profile.family !== 'natural';
  };
  if (kind === 'ranged') {
    const mode = command.mode ?? 'single';
    // Ruling 78: a mode fires exactly the weapon's rate (short burst 3 — three shots).
    const rate = fireModes(arsenalWeapon).find((m) => m.mode === mode);
    if (!rate) throw new Error(`${selected.name}: нет режима «${mode}»`);
    const shots = command.calledLocation ? 1 : rate.maxShots;
    const runRanged = (defense: 'DECLINE' | 'DODGE' | 'PARRY', src: DiceSource) =>
      resolveWoundAwareAction(state.wounds, 'НС', ctx, (combat, context) =>
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
            ...dualRequest,
            ...(squall ? { bonusDegrees: squall } : {}),
            distance,
            dodgeable: true,
            ...(defense === 'DODGE'
              ? {
                  dodge: {
                    id: `${command.id}:dodge`,
                    context: reactionContext(
                      b,
                      state,
                      command,
                      'Уклонение',
                      lasPenalty
                        ? [
                            {
                              id: `${command.id}:las-expert`,
                              value: lasPenalty,
                              reason: 'Знаток Лаз-оружия',
                            },
                          ]
                        : [],
                    ),
                  },
                }
              : {}),
            context,
          },
          src,
        ),
      );
    const trialRun =
      command.defense && !(lasExpert && command.defense === 'DODGE')
        ? null
        : runRanged('DECLINE', peekSource).resolution.result;
    const trial = command.defense ? null : (trialRun?.hitsGenerated ?? 0) > 0;
    if (lasExpert && trialRun?.check.outcome === 'success')
      lasPenalty = -Math.min(30, 5 * trialRun.check.totalDegrees);
    const defense = askDefense(trial ?? false, false);
    const resolved = runRanged(defense, trialRun ? realSource : rng);
    state.wounds = resolved.state;
    logs.push(resolved.projectionLog, ...resolved.resolution.logs);
    const result = resolved.resolution.result;
    attack = result;
    degrees = result.check.totalDegrees;
    hits.push(...result.hits.map((h) => damageInputFromHit(h)));
    if (result.dodge) reaction = result.dodge;
    suppression = applySuppression(b, state, command, arsenalWeapon.weaponClass, result, rng, logs);
  } else {
    const runMelee = (defense: 'DECLINE' | 'DODGE' | 'PARRY', src: DiceSource) => {
      const meleeAvoidance =
        defense === 'DODGE'
          ? {
              id: `${command.id}:dodge`,
              type: 'dodge' as const,
              pool: 'normal' as const,
              context: reactionContext(
                b,
                state,
                command,
                'Уклонение',
                frenzyPenalty
                  ? [
                      {
                        id: `${command.id}:frenzy`,
                        value: frenzyPenalty,
                        reason: 'Безумный натиск',
                      },
                    ]
                  : [],
              ),
            }
          : defense === 'PARRY'
            ? parryRequest(
                b,
                state,
                command,
                traits,
                frenzyPenalty
                  ? [
                      {
                        id: `${command.id}:frenzy`,
                        value: frenzyPenalty,
                        reason: 'Безумный натиск',
                      },
                    ]
                  : [],
              )
            : null;
      return resolveWoundAwareAction(state.wounds, 'НР', ctx, (combat, context) =>
        resolveMeleeAttack(
          combat,
          {
            id: command.id,
            type: 'melee-attack',
            actor: ref(command.actor),
            ...(command.counter
              ? { origin: 'COUNTERATTACK' as const, opportunityId: command.counter }
              : { origin: 'NORMAL' as const }),
            base: command.calledLocation
              ? 'called'
              : command.counter
                ? 'free'
                : command.charge
                  ? 'charge'
                  : (command.meleeBase ?? 'simple'),
            ...(command.charge ? { movementDistance: chargeDistance } : {}),
            ...(command.calledLocation ? { calledLocation: command.calledLocation } : {}),
            technique: 'normal',
            weaponId: command.weapon,
            ...(dualRequest.dualWield ? { dualWield: dualRequest.dualWield } : {}),
            targets: [
              {
                actor: ref(command.target),
                distance,
                ...(meleeAvoidance ? { avoidance: meleeAvoidance } : {}),
              },
            ],
            context,
          },
          src,
        ),
      );
    };
    const trial =
      command.defense || command.counter
        ? null
        : !!runMelee('DECLINE', peekSource).resolution.result.targets[0]?.hit;
    const defense = askDefense(trial ?? false, targetParries());
    let resolved = runMelee(defense, command.defense ? rng : realSource);
    // Rerolls of a failed melee attack (ruling 128): «Мастер клинков» once a round,
    // «Мастер Цепного оружия» with a «Цепное» weapon when the roll is 70+.
    const first = resolved.resolution.result.targets[0]!;
    const rerollBy =
      first.check.outcome === 'success' || command.counter
        ? null
        : hasTrait(traits, 'Цепное') &&
            first.check.rawRoll >= 70 &&
            attackerTalentsCanon.includes('Мастер Цепного оружия')
          ? 'Мастер Цепного оружия'
          : attackerTalentsCanon.includes('Мастер клинков') &&
              state.rerolls?.[`${command.actor}:Мастер клинков`] !==
                state.wounds.combat.session.roundNumber
            ? 'Мастер клинков'
            : null;
    if (rerollBy) {
      if (rerollBy === 'Мастер клинков')
        state.rerolls = {
          ...state.rerolls,
          [`${command.actor}:Мастер клинков`]: state.wounds.combat.session.roundNumber,
        };
      logs.push({ type: 'talent-reroll', talent: rerollBy, failed: first.check });
      // A new attack roll; the target decides its reaction again if the reroll hits.
      let again: number | null = null;
      const peek2: DiceSource = {
        roll(sides) {
          if (again === null) {
            again = rng.roll(sides);
            return again;
          }
          return 1;
        },
      };
      const hit2 = !!runMelee('DECLINE', peek2).resolution.result.targets[0]?.hit;
      const defense2 = askDefense(hit2, targetParries(), 'reaction:reroll');
      let reused = false;
      resolved = runMelee(defense2, {
        roll(sides) {
          if (!reused) {
            reused = true;
            return again!;
          }
          return rng.roll(sides);
        },
      });
    }
    state.wounds = resolved.state;
    logs.push(resolved.projectionLog, ...resolved.resolution.logs);
    const target = resolved.resolution.result.targets[0]!;
    attack = target.check;
    degrees = target.check.totalDegrees;
    if (target.hit) {
      const first = damageInputFromHit(target.hit as MeleeHitRecord);
      const count = target.hitCount ?? 1;
      // Several hits (swift / lightning attack): locations as for a burst (ruling 130).
      const locations = count > 1 ? resolveHitLocations(target.hit.rawAttackRoll, count, rng) : [];
      hits.push(first);
      for (let k = 1; k < count; k++)
        hits.push({ ...first, hitId: `${first.hitId}:${k + 1}`, location: locations[k]!.location });
    }
    if (target.avoidance) reaction = target.avoidance;
  }
  if (officer) {
    const runtime = state.wounds.combat.actors[command.actor]!;
    state.wounds = {
      ...state.wounds,
      combat: {
        ...state.wounds.combat,
        actors: {
          ...state.wounds.combat.actors,
          [command.actor]: { ...runtime, talents: officerRestore ?? [] },
        },
      },
    };
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
          'counter',
          'second',
          'meleeBase',
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
    if (command.second) {
      if (command.second === command.weapon) throw new Error('Выберите второе оружие');
      if (!weaponInHandState(next, command.weapon) || !weaponInHandState(next, command.second))
        throw new Error('Оба оружия должны быть в руках (решение 105)');
    }
    const first = resolve(next, b, command, rng, logs);
    // «Натиск»: the token ends next to the target; the move counts for this turn.
    if (command.charge) {
      b.positions[command.actor] = { x: command.charge.x, y: command.charge.y };
      next.moves.push({
        turn: next.wounds.combat.session.turnsStarted,
        actor: command.actor,
        mode: 'full-move',
      });
    }
    let result: typeof first & { second?: ReturnType<typeof resolve> } = first;
    if (command.second) {
      // The same target; questions of the second attack have their own keys.
      askScope = 'second:';
      try {
        result = {
          ...first,
          second: resolve(
            next,
            b,
            {
              ...command,
              id: `${command.id}:2`,
              weapon: command.second,
              dualPrimary: command.id,
              dualWith: command.weapon,
              ...(doubleShot(b, command, first) ? { doubleShot: true } : {}),
            },
            rng,
            logs,
          ),
        };
      } finally {
        askScope = '';
      }
    }
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
/** A counterattack follows the parried attack at once: only before any other command. */
const counterIsFresh = (state: EngineState, trigger: string) => {
  const last = state.committed.at(-1);
  return last !== undefined && (trigger === last || trigger.startsWith(`${last}:`));
};
/**
 * Unspent counterattacks after a parry (core «Бой»: 3 degrees, talent «Контратака»: 1) with the
 * defender's melee weapon.
 */
export function counterattacks(b: Battle) {
  const state = getEngine(b);
  const melee = state.wounds.combat.melee;
  if (!melee) return [];
  return melee.counterattacks
    .filter((x) => !x.spent && counterIsFresh(state, x.triggeringResolutionId))
    .map((x) => ({
      id: x.id,
      actor: x.actor.actorId,
      target: x.target.actorId,
      weapon: ((w) => (w && !w.endsWith(':hands') ? w : null))(
        melee.actors[x.actor.actorId]?.weaponId,
      ),
    }));
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
  if (state.pendingLoose) throw new Error('Сначала укажите на карте, куда упало выбитое оружие');
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
      ...(state.burning?.[id] ? ['Burning'] : []),
      ...(state.crippling?.[id] ? ['Crippled'] : []),
      ...(state.toxic?.[id] ? ['Poisoned'] : []),
      ...(state.rad?.[id] ? ['Irradiated'] : []),
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

export type TurnActionType =
  | 'quick-aim'
  | 'careful-aim'
  | 'wait'
  | 'reload'
  | 'clear-malfunction'
  | 'break-free'
  | 'clean-armour'
  | 'drop-armour';
export interface TurnActionCommand {
  id: string;
  actor: ActorId;
  type: TurnActionType;
  /** Weapon for reload and clearing a jam. */
  weapon?: WeaponId;
  /** «Вырваться»: the characteristic of the test (СЛ or ЛВ, «Опутывающее»). */
  characteristic?: 'СЛ' | 'ЛВ';
  /** «Очистить / сбросить броню»: the corroded zone. */
  zone?: Zone;
}
const turnActionName: Record<TurnActionType, string> = {
  'quick-aim': 'Быстрое прицеливание',
  'careful-aim': 'Тщательное прицеливание',
  wait: 'Выжидание',
  reload: 'Перезарядка',
  'clear-malfunction': 'Исправление осечки',
  'break-free': 'Вырваться из пут',
  'clean-armour': 'Очистить броню',
  'drop-armour': 'Сбросить броню',
};
/** Corroded armour zones of the actor (rulings 115–117). */
export function corrodedZones(b: Battle, actorId: ActorId): Zone[] {
  return Object.values(getEngine(b).corrosion ?? {})
    .filter((c) => c.actor === actorId)
    .map((c) => c.zone);
}
/** The entanglement («Опутывающее») holding the actor, if any. */
export function entanglement(b: Battle, actorId: ActorId) {
  const c = getEngine(b).wounds.combat.session.conditions.find(
    (x) => x.actor.actorId === actorId && x.type === 'Helpless' && 'breakFree' in x,
  );
  return c ? { id: c.id, modifier: (c as unknown as { breakFree: number }).breakFree } : null;
}
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
    } else if (command.type === 'clean-armour' || command.type === 'drop-armour') {
      // Ruling 116: cleaning — 2 ОД, dropping the armour element — 1 ОД; corrosion stops.
      const zone = command.zone;
      const key = `${command.actor}:${zone}`;
      if (!zone || !state.corrosion?.[key]) throw new Error('Эта броня не разъедается');
      const cost = command.type === 'clean-armour' ? 2 : 1;
      const turn = combat.session.turn!;
      if (turn.od < cost) throw new Error(`Нужно ${cost} ОД (решение 116)`);
      next = { ...combat, session: { ...combat.session, turn: { ...turn, od: turn.od - cost } } };
      detail = { zone: zoneName[zone], cost };
    } else if (command.type === 'break-free') {
      // Ruling 86: 2 ОД (the whole turn), СЛ or ЛВ test with −10 × Х; success frees the actor.
      const held = entanglement(b, command.actor);
      if (!held) throw new Error('Персонаж не опутан');
      const turn = combat.session.turn!;
      if (turn.od < 2) throw new Error('Нужно 2 ОД — весь ход (решение 86)');
      const ch = combatant(b, command.actor).character.characteristics;
      const key = command.characteristic ?? (ch.ЛВ.value > ch.СЛ.value ? 'ЛВ' : 'СЛ');
      const gm = { kind: 'weapon-property', id: 'Свойства оружия: Опутывающее' };
      const check = resolveCheck(
        {
          baseValue: ch[key].value,
          finalSuper: ch[key].super,
          context: {
            ...base.context,
            modifiers: held.modifier
              ? [
                  {
                    id: `${command.id}:break-free`,
                    value: held.modifier,
                    source: gm,
                    provenance: { source: gm, reason: 'Вырваться: −10 × Х' },
                  },
                ]
              : [],
          },
        },
        tape,
      ).result;
      const freed = check.outcome === 'success';
      next = {
        ...combat,
        session: {
          ...combat.session,
          turn: { ...turn, od: 0 },
          conditions: freed
            ? combat.session.conditions.filter((c) => c.id !== held.id)
            : combat.session.conditions,
        },
      };
      detail = { freed, check, characteristic: key, modifier: held.modifier };
    } else {
      next = resolveCombatAction(combat, { ...base, type: command.type }, noDice).state;
    }
    const after = structuredClone(state);
    after.wounds = { ...after.wounds, combat: next };
    after.committed.push(command.id);
    if ((command.type === 'clean-armour' || command.type === 'drop-armour') && command.zone) {
      const key = `${command.actor}:${command.zone}`;
      const rest = { ...after.corrosion };
      delete rest[key];
      after.corrosion = rest;
      // The dropped element no longer protects: the zone ОБ is 0 till the end of the fight.
      if (command.type === 'drop-armour')
        after.armorLoss[key] = combatant(b, command.actor).character.armour[command.zone];
    }
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

const weaponInHandState = (state: EngineState, weaponId: WeaponId) => {
  const combat = state.wounds.combat;
  return combat.weapons[weaponId]?.readied ?? combat.melee?.weapons[weaponId]?.held ?? false;
};
/** The other usable weapon in the owner's hands besides `weaponId` (two weapons, ruling 105). */
export function otherWeaponInHand(b: Battle, actorId: ActorId, weaponId: WeaponId) {
  const state = getEngine(b);
  return (
    battleWeapons(b, actorId).find(
      (w) =>
        w.id !== weaponId &&
        w.arsenal &&
        !weaponProblem(w.arsenal) &&
        weaponInHandState(state, w.id),
    )?.id ?? null
  );
}
/** Whether the weapon can be one of two weapons in hand (not two-handed, ruling 105). */
export function oneHandedWeapon(b: Battle, weaponId: WeaponId) {
  const combat = getEngine(b).wounds.combat;
  return (
    Boolean(combat.weapons[weaponId] ?? combat.melee?.weapons[weaponId]) &&
    !twoHandedWeapon(combat, weaponId)
  );
}
/**
 * «Разоружение» (rulings 107, 108): talent, 1 ОД, opposed НР+0 against НР+0. A win knocks the
 * weapon out of the hand: it flies 1к10 m — the GM places it (random direction) or, with 3+
 * degrees, the attacker chooses the direction. With 5+ degrees and a free hand the attacker may
 * take it — not supported yet, the journal tells the GM.
 */
export function disarm(
  b: Battle,
  command: { id: string; actor: ActorId; target: ActorId; weapon: WeaponId },
  source: DiceSource = noDice,
) {
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
    combatant(b, command.target);
    if (state.committed.includes(command.id)) throw new Error('Команда уже исполнена');
    movementGate(state, command.actor);
    const reach = meleeReach(b, command.actor);
    const p = posOf(b, command.actor),
      q = posOf(b, command.target);
    if (Math.hypot(p.x - q.x, p.y - q.y) > reach + 1e-9)
      throw new Error(`Цель вне досягаемости ближнего боя (${reach} м)`);
    const combat = state.wounds.combat;
    const r = resolveMeleeOpposedAction(
      combat,
      {
        id: command.id,
        type: 'disarm',
        actor: ref(command.actor),
        target: ref(command.target),
        weaponId: command.weapon,
        context: context(combat, command.actor, command.target),
        opponentContext: context(combat, command.target, command.actor),
      },
      tape,
    );
    const next = structuredClone(state);
    next.wounds = { ...next.wounds, combat: r.state };
    next.committed.push(command.id);
    const degrees = r.result.opposed.winnerDegrees ?? 0;
    let distance = 0;
    if (r.result.disarmed) {
      distance = rollDie(10, tape).value;
      next.pendingLoose = {
        weapon: command.weapon,
        from: q,
        maxDistance: distance,
        chooser: degrees >= 3 ? 'attacker' : 'gm',
        commandId: command.id,
        ...(degrees >= 5 && freeHand(b, next, command.actor, command.weapon) !== null
          ? { taker: command.actor }
          : {}),
      };
    }
    sync(b, next);
    append(b, 'disarm', {
      command,
      rolls: used,
      won: Boolean(r.result.disarmed),
      degrees,
      distance,
      weaponName: weaponOf(b, command.weapon)?.name ?? command.weapon,
      opposed: r.result.opposed,
      committed: true,
    });
    return { status: 'RESOLVED' as const, disarmed: Boolean(r.result.disarmed), distance, degrees };
  } catch (error) {
    append(b, 'disarm-rejected', { command, reason: explainEngineError(error), committed: false });
    throw error;
  }
}
/** Reach of the actor's melee weapon in hand (bare hands — 1 m). */
function meleeReach(b: Battle, actorId: ActorId) {
  const melee = getEngine(b).wounds.combat.melee;
  const weaponId = melee?.actors[actorId]?.weaponId;
  const w = weaponId ? melee?.weapons[weaponId] : undefined;
  return w?.held ? w.template.profile.reach : 1;
}
/** The knocked-out weapon lands at `at`, within its 1к10 m of the target (ruling 108). */
export function placeLoose(b: Battle, at: { x: number; y: number }) {
  const state = getEngine(b);
  const loose = state.pendingLoose;
  if (!loose) throw new Error('Выбитого оружия, ждущего места, нет');
  const d = Math.hypot(at.x - loose.from.x, at.y - loose.from.y);
  if (d > loose.maxDistance + 0.75)
    throw new Error(`Оружие отлетает не дальше ${loose.maxDistance} м`);
  const next = structuredClone(state);
  delete next.pendingLoose;
  b.loose = { ...b.loose, [loose.weapon]: { x: at.x, y: at.y } };
  sync(b, next);
  append(b, 'weapon-landed', {
    weapon: loose.weapon,
    weaponName: weaponOf(b, loose.weapon)?.name ?? loose.weapon,
    at,
    commandId: loose.commandId,
  });
}
export const pendingLoose = (b: Battle) => getEngine(b).pendingLoose ?? null;
/**
 * A free hand for the weapon: '' — both hands free; a weapon ID — the one-handed weapon that
 * stays in the other hand; null — no free hand.
 */
function freeHand(b: Battle, state: EngineState, actor: ActorId, weapon: WeaponId) {
  const held = battleWeapons(b, actor).filter((w) => weaponInHandState(state, w.id));
  if (held.length === 0) return '';
  const combat = state.wounds.combat;
  if (
    held.length === 1 &&
    !twoHandedWeapon(combat, held[0]!.id) &&
    !twoHandedWeapon(combat, weapon)
  )
    return held[0]!.id;
  return null;
}
/** «Разоружение» with 5+ degrees: the attacker takes the knocked-out weapon (ruling 114). */
export function takeDisarmed(b: Battle) {
  const state = getEngine(b);
  const loose = state.pendingLoose;
  if (!loose?.taker)
    throw new Error('Забрать выбитое оружие нельзя (нужно 5+ ст. и свободная рука)');
  const keep = freeHand(b, state, loose.taker, loose.weapon);
  if (keep === null) throw new Error('Нет свободной руки');
  const next = structuredClone(state);
  delete next.pendingLoose;
  next.wounds = {
    ...next.wounds,
    combat: transferWeapon(next.wounds.combat, loose.weapon, loose.taker, keep || undefined),
  };
  b.taken = { ...b.taken, [loose.weapon]: loose.taker };
  sync(b, next);
  append(b, 'weapon-taken', {
    weapon: loose.weapon,
    weaponName: weaponOf(b, loose.weapon)?.name ?? loose.weapon,
    actor: loose.taker,
    commandId: loose.commandId,
  });
}
/** «Разоружение» is available: the talent and weapons in the target's hands (ruling 107). */
export function disarmOptions(b: Battle, actor: ActorId, target: ActorId) {
  if (!target || !canonicalTalents(combatant(b, actor).character.talents).includes('Разоружение'))
    return [];
  const state = getEngine(b);
  return battleWeapons(b, target)
    .filter((w) => weaponInHandState(state, w.id))
    .map((w) => ({ id: w.id, name: w.name }));
}
/** Melee attack kinds the actor's talents allow (ruling 130). */
export function meleeAttackKinds(b: Battle, actor: ActorId) {
  const t = canonicalTalents(combatant(b, actor).character.talents);
  return [
    ...(t.includes('Стремительная атака') ? (['swift'] as const) : []),
    ...(t.includes('Молниеносная атака') ? (['lightning'] as const) : []),
  ];
}
/** Loose weapons for the map. */
export const looseWeapons = (b: Battle) =>
  Object.entries(b.loose ?? {}).map(([id, at]) => ({
    id,
    name: weaponOf(b, id)?.name ?? id,
    ...at,
  }));
/** A loose weapon can be picked up from the token's own or a neighbouring cell. */
export const LOOSE_REACH = 1.5;
const locationLabel = (loc: string) =>
  loc === 'Torso'
    ? 'торс'
    : loc.includes('Arm')
      ? 'рука'
      : loc.includes('Leg')
        ? 'нога'
        : loc === 'Head'
          ? 'голова'
          : loc;
/** Weapons stuck in wounds that the actor can reach (own wound or a neighbour's, ≤ 1.5 m). */
export function impalements(b: Battle, actor: ActorId) {
  const p = posOf(b, actor);
  return Object.entries(getEngine(b).impaled ?? {})
    .filter(([, x]) => {
      const q = posOf(b, x.target);
      return Math.hypot(p.x - q.x, p.y - q.y) <= LOOSE_REACH;
    })
    .map(([weapon, x]) => ({
      weapon,
      target: x.target,
      name: weaponOf(b, weapon)?.name ?? weapon,
      location: locationLabel(x.location),
    }));
}
/**
 * «Проникающее»: pull the weapon out of the wound (rulings 119, 120) — 1 ОД, anyone next to the
 * wounded; к5 + бСЛ of the one pulling minus ½ бВН (down) of the wounded, without armour and
 * without consequences. The weapon ends in the puller's hand (free hand), otherwise on the floor.
 */
export function extractWeapon(
  b: Battle,
  command: { id: string; actor: ActorId; weapon: WeaponId },
  source: DiceSource = noDice,
) {
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
    const stuck = state.impaled?.[command.weapon];
    if (!stuck) throw new Error('Это оружие не в ране');
    if (!impalements(b, command.actor).some((x) => x.weapon === command.weapon))
      throw new Error('Раненый слишком далеко — подойдите вплотную');
    const turn = state.wounds.combat.session.turn!;
    if (turn.od < 1) throw new Error('Нужен 1 ОД (решение 119)');
    const next = structuredClone(state);
    const die = rollDie(5, tape).value;
    const sl = bonusOf(combatant(b, command.actor).character, 'СЛ');
    const half = Math.floor(bonusVN(next, stuck.target) / 2);
    const wounds = Math.max(0, die + sl - half);
    const logs: unknown[] = [];
    plainWounds(next, stuck.target, wounds, logs);
    const rest = { ...next.impaled };
    delete rest[command.weapon];
    next.impaled = rest;
    let combat = next.wounds.combat;
    combat = { ...combat, session: { ...combat.session, turn: { ...turn, od: turn.od - 1 } } };
    if (stuck.skr) {
      const runtime = combat.actors[stuck.target]!;
      combat = {
        ...combat,
        actors: {
          ...combat.actors,
          [stuck.target]: { ...runtime, movement: runtime.movement + (stuck.skrLoss ?? 1) },
        },
      };
    }
    const keep = freeHand(b, next, command.actor, command.weapon);
    const owner = weaponOf(b, command.weapon)!.owner;
    if (keep !== null) {
      combat = transferWeapon(combat, command.weapon, command.actor, keep || undefined);
      if (owner !== command.actor) b.taken = { ...b.taken, [command.weapon]: command.actor };
    } else b.loose = { ...b.loose, [command.weapon]: { ...posOf(b, stuck.target) } };
    next.wounds = { ...next.wounds, combat };
    next.committed.push(command.id);
    sync(b, next);
    append(b, 'extract', {
      command,
      rolls: used,
      target: stuck.target,
      weaponName: weaponOf(b, command.weapon)?.name ?? command.weapon,
      wounds,
      die,
      sl,
      half,
      inHand: keep !== null,
      committed: true,
    });
    return { status: 'RESOLVED' as const, wounds };
  } catch (error) {
    append(b, 'extract-rejected', { command, reason: explainEngineError(error), committed: false });
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
    if (state.impaled?.[command.weapon])
      throw new Error('Оружие застряло в ране — его нужно извлечь (решение 119)');
    // Ruling 108: a knocked-out weapon is picked up only next to where it lies.
    const lying = b.loose?.[command.weapon];
    if (lying) {
      const p = posOf(b, command.actor);
      if (Math.hypot(p.x - lying.x, p.y - lying.y) > LOOSE_REACH)
        throw new Error('Оружие лежит дальше — сначала подойдите к нему (решение 108)');
    }
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
    if (lying) {
      const rest = { ...b.loose };
      delete rest[command.weapon];
      b.loose = rest;
    }
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
export function takeWeapon(
  b: Battle,
  command: { id: string; actor: ActorId; weapon: WeaponId; keep?: WeaponId },
) {
  const state = getEngine(b);
  try {
    combatant(b, command.actor);
    if (state.committed.includes(command.id)) throw new Error('Команда уже исполнена');
    const chosen = weaponOf(b, command.weapon);
    const unusable = chosen ? weaponProblem(chosen.arsenal) : 'Нет такого оружия';
    if (unusable)
      throw new Error(`${chosen?.name ?? 'Оружие'}: в бою пока не используется — ${unusable}`);
    let combat: CombatActionState;
    let cost = 'до боя';
    if (command.keep && !weaponInHandState(state, command.keep))
      throw new Error('Первое оружие уже не в руках');
    if (
      command.keep &&
      (twoHandedWeapon(state.wounds.combat, command.keep) ||
        twoHandedWeapon(state.wounds.combat, command.weapon))
    )
      throw new Error('Двуручное оружие нельзя держать вторым (решение 105)');
    if (!combatStarted(b))
      combat = putInHand(state.wounds.combat, command.actor, command.weapon, command.keep);
    else {
      movementGate(state, command.actor);
      const r = coreReadyWeapon(state.wounds.combat, {
        id: command.id,
        type: 'ready-weapon',
        actor: ref(command.actor),
        weaponId: command.weapon,
        ...(command.keep ? { keep: command.keep } : {}),
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
