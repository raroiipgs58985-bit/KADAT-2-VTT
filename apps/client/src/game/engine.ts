import type {
  BleedingActivity,
  CalledLocation,
  Characteristics,
  CombatActionState,
  CombatActorRuntime,
  CombatSession,
  DamageInput,
  DiceRoll,
  DiceSource,
  MeleeActorState,
  MeleeHitRecord,
  MeleeWeaponInstance,
  ProtectionRuntimeState,
  ResolutionContext,
  WeaponInstance,
  WoundRuntimeState,
  DamageResolutionResult,
} from '@kadat/contracts';
import {
  beginActionRound,
  beginActionTurn,
  createActionState,
  createWoundRuntime,
  damageInputFromHit,
  emptyActionContext,
  finishActionTurn,
  initializeMeleeState,
  resolveBleedingPulse,
  resolveCombatAction,
  resolveDamageRoll,
  resolveMeleeAttack,
  resolvePostDamage,
  resolveProtectionDamage,
  resolveRangedAttack,
  resolveWoundAwareAction,
  resolveWoundRoundEnd,
  resolveWoundTurnStart,
  rollDie,
  suppressionEventFromRanged,
  suppressionTrigger,
} from '@kadat/rules-engine';
import {
  actor,
  append,
  ids,
  move,
  movementProfiles,
  movementProblem,
  placementProblemFor,
  tokenConflicts,
  weapons,
  type ActorId,
  type Battle,
  type WeaponId,
} from './model';
import { rulings } from './rulings';
import { cellsOf, validateFootprint, type Footprint } from './grid';
import { mapProblems, segmentLine, type MapDocument } from './map';
import { buildGeometry, footprintGeometryProblem, initialDoorStates } from './geometry';

const source = {
  kind: 'canonical-profile',
  id: 'Профили персонажей / Персонажи Вольного торговца B80(note), L54 + direct author rulings',
};
const provenance = {
  source,
  reason: 'Local profile adapter; author decisions recorded in rulings.ts and README',
};
const release = 'local-profile-snapshot-v0.2';
const ref = (actorId: string) => ({ actorId });
export interface EngineState {
  wounds: WoundRuntimeState;
  protection: ProtectionRuntimeState;
  armorLoss: Record<string, number>;
  committed: string[];
  pending?: { command: AttackCommand; prefix: DiceRoll[]; reason: string };
  pendingTurn?: { prefix: DiceRoll[]; reason: string; kind?: 'start' };
  /** Committed movement actions; used only to detect a repeated free move in one turn. */
  moves: { turn: number; actor: ActorId; mode: MoveMode }[];
}
export interface AttackCommand {
  id: string;
  actor: ActorId;
  target: ActorId;
  weapon: WeaponId;
  targetActivity: BleedingActivity;
  modifier?: number;
  defense: 'DECLINE';
}
export class ContextRequired extends Error {
  override readonly name = 'ContextRequired';
}
const engines = new WeakMap<Battle, EngineState>();
const KELUS_CHAIN_BOUNDARY =
  'Нужен полный персональный расчёт меча Келуса с питанием и бонусами; профиль не подменяется.';
const FIRE_BOUNDARY =
  'Автоматическое попадание Спрей: Torso. Требуется согласование Огненное (Арсенал D51: игнор брони) и Горение (Механика A17:B17: половина ОБ сочленений); эффекты не пропускаются.';
const CHAIN_TIMING_BOUNDARY =
  'Не утверждён порядок потери ОБ относительно текущего урона от Цепного. Попадание и его d100 сохранены.';

function makeWeapon(id: WeaponId, owner: ActorId): WeaponInstance {
  return {
    id,
    owner: ref(owner),
    readied: true,
    modifications: [],
    jammed: false,
    loadedContainerId: `${id}:block`,
    template: {
      id: `${id}:profile`,
      canonical: { releaseId: release, templateId: id, templateVersion: 'personal-v0.2' },
      provenance,
      properties: [],
      effects: [],
      profile: {
        weaponClass: 'ОС',
        optimalRange: 100,
        classification: 'energy-beam',
        modes: [{ mode: 'single', maxShots: 1 }],
        damage: { source, expression: { count: 1, sides: 10, modifier: 4 } },
        penetration: { source, value: 6 },
        compatibleAmmoTypes: ['hotshot-block-shot'],
        compatibleContainerTypes: ['power-block'],
        capacityReference: source,
        reload: { source, odCost: 2 },
        malfunction: 'generic-jam',
      },
    },
  };
}
function makeBlade(id: string, owner: ActorId, modifier: number, bb: number): MeleeWeaponInstance {
  return {
    id,
    owner: ref(owner),
    held: owner === 'pak',
    readied: owner === 'pak',
    dropped: false,
    modifications: [],
    template: {
      id: `${id}:profile`,
      canonical: { releaseId: release, templateId: id, templateVersion: 'personal-v0.2' },
      provenance,
      effects: [],
      profile: {
        source,
        family: 'sword',
        handedness: 'one-handed',
        validGrips: ['one-handed'],
        reach: 1,
        damage: { source, expression: { count: 1, sides: 10, modifier } },
        penetration: { source, value: bb },
        parryEligible: true,
        properties: [],
      },
    },
  };
}
export function getEngine(b: Battle): EngineState {
  const existing = engines.get(b);
  if (existing) return existing;
  // Equal sentinel entries only satisfy the accepted session schema. No initiative RNG
  // is run, no initiative rule is selected. Order is explicitly supplied by the user.
  const order = [b.active, ...ids.filter((id) => id !== b.active)];
  const session: CombatSession = {
    id: 'local-combat',
    canonicalReleaseId: release,
    roundNumber: 1,
    phase: 'ready',
    cursor: 0,
    activeActor: null,
    turn: null,
    turnsStarted: 0,
    conditions: [],
    initiativeOrder: order.map((id) => ({
      actor: ref(id),
      agilityBonus: 0,
      roll: { sides: 10, value: 1 },
      initiative: 1,
      reactions: { capacity: 1, remaining: 1 },
    })),
  };
  const actors = Object.fromEntries(
    ids.map((id) => [
      id,
      {
        actor: ref(id),
        characteristics: Object.fromEntries(
          Object.entries(actor(id).characteristics).map(([key, c]) => [
            key,
            { baseValue: c.value, baseSuper: c.super },
          ]),
        ) as Characteristics,
        movement: movementProfiles[id].skr,
        fatigue: 0,
        posture: 'standing',
        effects: [],
      } as CombatActorRuntime,
    ]),
  );
  const gun = makeWeapon('hotshot', 'kelus-drakar');
  let combat = createActionState(
    session,
    actors,
    { hotshot: gun },
    {
      'hotshot:block': {
        id: 'hotshot:block',
        type: 'power-block',
        compatibleWeaponTemplateIds: ['hotshot:profile'],
        capacity: 250,
        currentRounds: 250,
        ammo: { source, type: 'hotshot-block-shot', effects: [] },
        state: 'ready',
        provenance,
      },
    },
  );
  const meleeActors = Object.fromEntries(
    ids.map((id) => [
      id,
      {
        weaponId: id === 'pak' ? 'pak-chain' : 'kelus-chain',
        stance: 'standard',
        grip: 'one-handed',
        sizeCategory: 0,
        // These skills are never used by the supported simple strike. No untrained
        // acrobatics value is fabricated for the public contract's mandatory field.
        skills: {
          athletics: {
            baseValue: actor(id).characteristics.СЛ.value,
            finalSuper: actor(id).characteristics.СЛ.super,
            provenance,
          },
          acrobatics: {
            baseValue: 0,
            finalSuper: 0,
            provenance: {
              source,
              reason: 'Unavailable skill sentinel: Acrobatics actions disabled in experiment',
            },
          },
        },
        meleeOnlyReactionRemaining: 0,
        palisadeSpent: false,
      } as MeleeActorState,
    ]),
  );
  combat = initializeMeleeState(combat, meleeActors, {
    'pak-chain': makeBlade('pak-chain', 'pak', 10, 4),
    'kelus-chain': makeBlade('kelus-chain', 'kelus-drakar', 5, 2),
  });
  const state: EngineState = {
    wounds: createWoundRuntime(
      combat,
      Object.fromEntries(
        ids.map((id) => [
          id,
          { maxWounds: actor(id).max, damageTaken: actor(id).max - actor(id).wounds },
        ]),
      ),
    ),
    protection: { sources: {}, covers: {}, fields: [], resolvedHitIds: [] },
    armorLoss: {},
    committed: [],
    moves: [],
  };
  engines.set(b, state);
  return state;
}
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
  for (const id of ids) b.hp[id] = actor(id).max - state.wounds.actors[id]!.damageTaken;
  b.ammo.hotshot = state.wounds.combat.containers['hotshot:block']!.currentRounds;
  const active = state.wounds.combat.session.activeActor?.actorId;
  if (active) b.active = active as ActorId;
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
}
function armorKey(id: string, location: CalledLocation) {
  return `${id}:${location.includes('Arm') ? 'Arms' : location.includes('Leg') ? 'Legs' : location}`;
}
function armor(
  state: EngineState,
  target: ActorId,
  location: CalledLocation,
  energy: boolean,
  headRedirect: boolean,
) {
  if (location === 'Eyes' || location === 'Armor Joints')
    throw new ContextRequired('Нужны явные сведения о защите специальной зоны и её округлении.');
  const values = actor(target)
    .profile.find((p) => p.label === 'ОБ')!
    .formattedValue!.split('/')
    .map(Number);
  const armorLocation = headRedirect ? 'Torso' : location;
  const index =
    armorLocation === 'Head'
      ? 0
      : armorLocation === 'Torso'
        ? 1
        : armorLocation.includes('Arm')
          ? 2
          : 3;
  const key = armorKey(target, armorLocation);
  const value = Math.max(0, values[index]! - (state.armorLoss[key] ?? 0)) + (energy ? 3 : 0);
  return {
    key,
    ob: value,
    baseOB: values[index]!,
    runtimeLoss: state.armorLoss[key] ?? 0,
    ceramiteBonus: energy ? 3 : 0,
    propertySource: target === 'pak' ? 'Арсенал / Броня!C33,B115' : 'Профили / B70 note',
  };
}
function protectionFor(state: EngineState, input: DamageInput, ob: number) {
  const id = `armor:${input.target.actorId}:${input.location}`;
  const armorSource = {
    kind: 'canonical-profile',
    id:
      input.target.actorId === 'pak'
        ? 'Профили / L44 + Арсенал / Броня!C33,B115'
        : 'Профили / B70 note',
  };
  return {
    ...state.protection,
    sources: {
      [id]: {
        id,
        owner: input.target,
        active: true,
        definition: {
          id,
          source: armorSource,
          provenance: {
            source: armorSource,
            reason: 'Personal zone OB plus confirmed armor properties and separate runtime loss',
          },
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
      facts: { provenance, activity: command.targetActivity },
    },
    rng,
  );
  logs.push(...result.logs);
  if (result.result.status !== 'RESOLVED')
    throw new ContextRequired(JSON.stringify(result.result.pendingIntents));
  state.wounds = result.state;
  return result.result;
}
function tearingBleed(
  state: EngineState,
  command: AttackCommand,
  damage: DamageResolutionResult,
  reroll: number,
  rng: DiceSource,
  logs: unknown[],
) {
  if (!damage.finalDamage) return;
  const target = state.wounds.actors[command.target]!;
  const injury = target.injuries.find((i) => i.sourceHitId === damage.input.hitId);
  if (!injury)
    throw new ContextRequired('Нет Injury для гарантированного кровотечения Разрывного.');
  if (injury.bleedingSourceIds.length)
    throw new ContextRequired(
      'Требуется отношение кровотечения Разрывного к кровотечению той же Injury из таблицы последствий; источники не объединяются и не складываются автоматически.',
    );
  const id = `${injury.id}:tearing`;
  const bleeding = {
    id,
    injuryId: injury.id,
    consequence: injury.consequence,
    severity:
      reroll <= 4 ? ('LIGHT' as const) : reroll <= 8 ? ('MEDIUM' as const) : ('HEAVY' as const),
    location: injury.location,
    active: true,
    appliedRound: state.wounds.combat.session.roundNumber,
    appliedTurn: state.wounds.combat.session.turnsStarted,
    provenance: {
      source: { kind: 'canonical', id: 'Арсенал / Свойства оружия!D68' },
      reason: 'Ранение Разрывным: сила кровотечения по переброшенному кубику',
    },
  };
  // Attach to the real C-2 Injury, never a fabricated consequence catalog row.
  state.wounds = {
    ...state.wounds,
    actors: {
      ...state.wounds.actors,
      [command.target]: {
        ...target,
        injuries: target.injuries.map((i) =>
          i.id === injury.id ? { ...i, bleedingSourceIds: [...i.bleedingSourceIds, id] } : i,
        ),
        bleeding: [...target.bleeding, bleeding],
      },
    },
  };
  // The C-2-created sources already pulsed. Pulse only the new property source,
  // preserving all other sources without executing their immediate loss twice.
  const original = state.wounds.actors[command.target]!;
  const scoped = {
    ...state.wounds,
    actors: { ...state.wounds.actors, [command.target]: { ...original, bleeding: [bleeding] } },
  };
  const pulse = resolveBleedingPulse(
    {
      id: `${id}:initial`,
      actor: ref(command.target),
      state: scoped,
      context: context(state.wounds.combat, command.target),
      facts: { provenance, activity: command.targetActivity },
    },
    rng,
  );
  if (pulse.result.status !== 'RESOLVED')
    throw new ContextRequired(JSON.stringify(pulse.result.pendingIntents));
  state.wounds = {
    ...pulse.state,
    actors: {
      ...pulse.state.actors,
      [command.target]: { ...pulse.state.actors[command.target]!, bleeding: original.bleeding },
    },
  };
  logs.push(...pulse.logs);
}

function resolve(
  state: EngineState,
  b: Battle,
  command: AttackCommand,
  rng: DiceSource,
  logs: unknown[],
) {
  if (
    !ids.includes(command.actor) ||
    !ids.includes(command.target) ||
    command.actor === command.target
  )
    throw new Error('Неверные участники атаки');
  if (command.defense !== 'DECLINE')
    throw new ContextRequired(
      'Нужно явное решение цели об отказе от реакции; автоматического отказа нет.',
    );
  const selected = weapons.find((w) => w.id === command.weapon && w.owner === command.actor);
  if (!selected) throw new Error('Оружие не принадлежит атакующему');
  if (command.weapon !== 'hotshot' && command.weapon !== 'pak-chain')
    throw new ContextRequired(
      command.weapon === 'kelus-chain' ? KELUS_CHAIN_BOUNDARY : FIRE_BOUNDARY,
    );
  begin(state, rng, logs);
  if (state.wounds.combat.session.activeActor?.actorId !== command.actor)
    throw new Error(
      'Передайте ход штатной кнопкой. Очередь задана вручную, свободных дополнительных атак нет.',
    );
  if (state.wounds.actors[command.actor]!.life.status !== 'ALIVE')
    throw new ContextRequired('Действия в Agony/Death не разрешаются этим прототипом.');
  const p = b.positions[command.actor],
    q = b.positions[command.target],
    distance = Math.hypot(p.x - q.x, p.y - q.y);
  let ctx = context(state.wounds.combat, command.actor, command.target);
  if (command.modifier !== undefined) {
    if (!Number.isInteger(command.modifier)) throw new Error('GM modifier must be an integer');
    ctx = {
      ...ctx,
      modifiers: [
        {
          id: `${command.id}:explicit-test-modifier`,
          value: command.modifier,
          source: { kind: 'gm', id: 'local modifier input' },
          provenance: {
            source: { kind: 'gm', id: 'local modifier input' },
            reason: 'Explicit numeric modifier supplied in prototype control',
          },
        },
      ],
    };
  }
  let hit: DamageInput, degrees: number;
  if (command.weapon === 'hotshot') {
    const resolved = resolveWoundAwareAction(state.wounds, 'НС', ctx, (combat, context) =>
      resolveRangedAttack(
        combat,
        {
          id: command.id,
          type: 'ranged-attack',
          actor: ref(command.actor),
          target: ref(command.target),
          weaponId: 'hotshot',
          mode: 'single',
          shotsRequested: 1,
          distance,
          dodgeable: true,
          context,
        },
        rng,
      ),
    );
    state.wounds = resolved.state;
    logs.push(resolved.projectionLog, ...resolved.resolution.logs);
    const result = resolved.resolution.result;
    const suppression = suppressionTrigger(
      suppressionEventFromRanged({
        attackId: command.id,
        sourceActor: ref(command.actor),
        primaryTarget: ref(command.target),
        weapon: source,
        provenance,
        weaponClass: 'BASIC',
        result,
      }),
    );
    if (suppression.triggered)
      throw new ContextRequired(
        'Сработал канонический триггер подавления (3+ степени): требуется подключение контекста подавления и персональных талантов. Результат проверки сохранён, подавление не пропускается.',
      );
    if (!result.hits.length)
      return {
        status: 'RESOLVED',
        attack: result,
        damage: null,
        reaction: 'explicitly declined in local scenario',
      };
    hit = damageInputFromHit(result.hits[0]!);
    degrees = result.check.totalDegrees;
  } else {
    const resolved = resolveWoundAwareAction(state.wounds, 'НР', ctx, (combat, context) =>
      resolveMeleeAttack(
        combat,
        {
          id: command.id,
          type: 'melee-attack',
          actor: ref(command.actor),
          origin: 'NORMAL',
          base: 'simple',
          technique: 'normal',
          weaponId: 'pak-chain',
          targets: [{ actor: ref(command.target), distance }],
          context,
        },
        rng,
      ),
    );
    state.wounds = resolved.state;
    logs.push(resolved.projectionLog, ...resolved.resolution.logs);
    const target = resolved.resolution.result.targets[0]!;
    if (!target.hit)
      return {
        status: 'RESOLVED',
        attack: target.check,
        damage: null,
        reaction: 'explicitly declined in local scenario',
      };
    hit = damageInputFromHit(target.hit as MeleeHitRecord);
    degrees = target.check.totalDegrees;
  }
  if (command.weapon === 'pak-chain' && rulings.chainTiming === null)
    throw new ContextRequired(CHAIN_TIMING_BOUNDARY);
  if (hit.location === 'Eyes')
    throw new ContextRequired(
      'Попадание Eyes сохранено: нужны сведения о шлеме и округлении ОБ линз; автоматического выбора нет.',
    );
  let redirected = false;
  if (hit.location === 'Head') {
    const value = rollDie(10, rng).value;
    redirected = value >= 7;
    logs.push({
      type: 'gorget',
      roll: { sides: 10, value },
      threshold: 7,
      useTorsoArmor: redirected,
      bodyLocationRemains: hit.location,
      source:
        command.target === 'pak'
          ? 'Арсенал / Броня!C33 (Горжет 7), правило: Профили B70 note'
          : 'Персонажи Вольного торговца!B70 note',
    });
  }
  const roll = resolveDamageRoll(hit.profile.expression, rng, hit.context).result;
  let effectiveDie = roll.rolls[0]!.value,
    reroll = 0;
  if (command.weapon === 'pak-chain') {
    reroll = rollDie(10, rng).value;
    effectiveDie = reroll;
    logs.push({
      type: 'tearing-reroll',
      discarded: roll.rolls[0],
      replacement: { sides: 10, value: reroll },
      source: 'Арсенал / Свойства оружия!D68',
    });
    if (roll.critical && reroll !== 10)
      throw new ContextRequired(
        'Нужно решение: критический максимум на отброшенном кубике Разрывного. Оба броска сохранены.',
      );
  } else effectiveDie = Math.max(rulings.provenMinimum, effectiveDie);
  // Reuse the accepted Core to build/validate DamageRoll and its critical marker.
  // This source returns the already derived die; it consumes no new random roll.
  const effectiveRoll = resolveDamageRoll(
    hit.profile.expression,
    { roll: () => effectiveDie },
    hit.context,
  ).result;
  const bb = command.weapon === 'pak-chain' && degrees >= 3 ? 8 : hit.penetration.value;
  const laserBonus = command.weapon === 'hotshot' ? Math.floor(degrees / 2) : 0;
  hit = {
    ...hit,
    penetration: { ...hit.penetration, value: bb },
    transformations: [
      ...hit.transformations,
      ...(laserBonus
        ? [
            {
              id: `${hit.hitId}:master`,
              type: 'add' as const,
              value: laserBonus,
              provenance: {
                source: { kind: 'canonical', id: 'Профили / Таланты (обновлены)!K62' },
                reason: 'Мастер Лаз-оружия; floor(степени/2) author ruling',
              },
            },
          ]
        : []),
    ],
  };
  const armorBefore = armor(
    state,
    command.target,
    hit.location,
    command.weapon === 'hotshot',
    redirected,
  );
  if (command.weapon === 'pak-chain' && rulings.chainTiming === 'before')
    state.armorLoss[armorBefore.key] = (state.armorLoss[armorBefore.key] ?? 0) + bb;
  const current = armor(
    state,
    command.target,
    hit.location,
    command.weapon === 'hotshot',
    redirected,
  );
  const damage = resolveProtectionDamage(
    {
      input: hit,
      state: protectionFor(state, hit, current.ob),
      endurance: state.wounds.combat.actors[command.target]!.characteristics.ВН!,
      preRolled: effectiveRoll,
    },
    {
      roll: () => {
        throw new Error('Unexpected damage reroll');
      },
    },
  );
  logs.push(
    {
      type: 'personal-weapon-calculation',
      rawDamageDice: roll.rolls,
      effectiveDamageDice: effectiveRoll.rolls,
      provenMinimum: command.weapon === 'hotshot' ? 5 : null,
      laserMaster: { degrees, bonus: laserBonus, rounding: 'floor' },
      penetration: bb,
      armorBefore: armorBefore.ob,
      armorForCurrentHit: current.ob,
      armorCalculation: current,
      source: provenance,
    },
    ...damage.logs,
  );
  if (damage.result.status !== 'RESOLVED')
    throw new ContextRequired(JSON.stringify(damage.result.status));
  state.protection = damage.state;
  const wound = postDamage(state, damage.result, command, rng, logs);
  if (
    command.target === 'pak' &&
    wound.injuriesCreated.some((i) => i.features.some((f) => /amput|limb-loss/.test(f.type)))
  )
    throw new ContextRequired(
      'Требуется композиция автоматических жгутов Медслоя (5) Пака с ампутацией и кровотечением; автоматическое игнорирование запрещено.',
    );
  if (
    command.target === 'kelus-drakar' &&
    (wound.conditionsCreatedOrUpdated.some((c) => c.type === 'Stunned') ||
      (wound.injuriesCreated.some((i) => i.features.length) &&
        (hit.location.includes('Arm') || hit.location.includes('Leg'))))
  )
    throw new ContextRequired(
      'Нужна персональная интеграция Стальной челюсти / Адамантиевого скелета для этого последствия Келуса; эффекты не игнорируются.',
    );
  if (command.weapon === 'pak-chain') {
    tearingBleed(state, command, damage.result, reroll, rng, logs);
    if (rulings.chainTiming === 'after')
      state.armorLoss[armorBefore.key] = (state.armorLoss[armorBefore.key] ?? 0) + bb;
    logs.push({
      type: 'chain-armor-loss',
      key: armorBefore.key,
      bb,
      timing: rulings.chainTiming,
      totalLoss: state.armorLoss[armorBefore.key],
    });
  }
  return {
    status: 'RESOLVED',
    hit,
    damage: damage.result,
    wound,
    reaction: 'explicitly declined in local scenario',
  };
}

/** Local command envelope is atomic; individual accepted resolvers remain unchanged.
 * A pending command retains its full RNG prefix and stable ID for exact continuation. */
export function attack(b: Battle, command: AttackCommand, source: DiceSource, resume = false) {
  const current = getEngine(b);
  if (
    resume &&
    (!current.pending ||
      !(
        ['id', 'actor', 'target', 'weapon', 'targetActivity', 'modifier', 'defense'] as const
      ).every((key) => current.pending!.command[key] === command[key]))
  )
    throw new Error('Pending command differs');
  if (current.pendingTurn) throw new Error('Сначала продолжите pending начала хода');
  if (current.committed.includes(command.id)) throw new Error('Команда уже исполнена');
  if (current.pending && !resume) throw new Error('Сначала продолжите сохранённую pending-команду');
  const prefix = resume ? (current.pending?.prefix ?? []) : [],
    used: DiceRoll[] = [];
  let cursor = 0;
  const rng: DiceSource = {
    roll(sides) {
      const prior = prefix[cursor++];
      if (prior && prior.sides !== sides) throw new Error('Pending dice prefix mismatch');
      const value = prior?.value ?? source.roll(sides);
      used.push({ sides, value });
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
      append(b, 'rejected', { command, rolls: used, reason: String(error), committed: false });
      throw error;
    }
    const reason = String(error instanceof Error ? error.message : error);
    current.pending = { command: structuredClone(command), prefix: used, reason };
    engines.set(b, current);
    append(b, 'CONTEXT_REQUIRED', {
      command,
      rolls: used,
      reason,
      coreLogs: logs,
      committed: false,
    });
    return { status: 'CONTEXT_REQUIRED' as const, reason };
  }
}
export function resumeAttack(b: Battle, source: DiceSource) {
  const p = getEngine(b).pending;
  if (!p) throw new Error('Нет pending-команды');
  return attack(b, p.command, source, true);
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
export function selectManualOrder(b: Battle, selected: ActorId) {
  const state = getEngine(b);
  if (
    state.wounds.combat.session.phase !== 'ready' ||
    state.committed.length ||
    state.pending ||
    state.pendingTurn
  )
    throw new Error('Начальная ручная очередь уже задана. Используйте «Передать ход».');
  b.active = selected;
  engines.delete(b);
  append(b, 'manual-turn', { actor: selected });
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
];
const coreErrorPattern = /^(Insufficient|Unavailable|Action |Reaction |Empty or repeated)/;
/** Russian explanation for Core validation errors; the original message is kept. */
export function explainEngineError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const known = coreMessages.find(([pattern]) => pattern.test(message));
  return known ? `${known[1]} (Core: ${message})` : message;
}
/**
 * Wound consequences that the accepted movement resolver does not read. Core stores them as
 * runtime Effects (`combat-modifier: movement`, limb `uses-limb:*` restriction, Prone posture)
 * but `resolveCombatAction` derives distance from the raw СКР. Moving at full distance would
 * silently drop canonical consequences, so movement stops until the author decides.
 */
export function woundMovementBoundary(b: Battle, actorId: ActorId): string | null {
  const runtime = getEngine(b).wounds.combat.actors[actorId]!;
  const penalties = runtime.effects.filter(
    (e) => e.definition.target.kind === 'combat-modifier' && e.definition.target.key === 'movement',
  );
  if (penalties.length)
    return `Ранение даёт штраф к СКР (${penalties.map((e) => e.definition.value).join(', ')}), но принятый Core не применяет его к дистанции движения. Нужно решение: подключить штраф в движок.`;
  const leg = runtime.effects.some(
    (e) =>
      e.definition.target.kind === 'permission' &&
      e.definition.operation === 'restrict' &&
      (e.definition.condition?.requiresTags ?? []).some((t) => /^uses-limb:.*Leg$/.test(t)),
  );
  if (leg)
    return 'Нога бесполезна после ранения: правило передвижения в этом состоянии не определено. Нужно решение автора.';
  if (runtime.posture === 'prone')
    return 'Персонаж лежит: передвижение лёжа в правилах не описано. Доступно действие «Встать» (1 ОД).';
  return null;
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
      const blocked = woundMovementBoundary(b, actorId) ?? authorBoundary(state, actorId, m.mode);
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
export function moveActor(b: Battle, command: MoveCommand) {
  const state = getEngine(b);
  try {
    if (!ids.includes(command.actor)) throw new Error('Неизвестный персонаж');
    const mode = moveModes.find((m) => m.mode === command.mode);
    if (!mode) throw new Error('Неизвестный режим движения');
    if (state.committed.includes(command.id)) throw new Error('Команда уже исполнена');
    const { x, y } = command.to;
    movementGate(state, command.actor);
    if (command.sceneRevision !== undefined && command.sceneRevision !== b.sceneRevision)
      throw new Error('Сцена изменилась после предпросмотра: выберите точку назначения заново');
    const authorBlock =
      woundMovementBoundary(b, command.actor) ?? authorBoundary(state, command.actor, command.mode);
    if (authorBlock) throw new RuleDecisionRequired(authorBlock);
    const geometry = movementProblem(b, command.actor, { x, y });
    if (geometry?.kind === 'position')
      throw new Error(`Точка назначения недопустима: ${geometry.reason}`);
    if (geometry?.kind === 'blocked') throw new Error(geometry.reason);
    if (geometry) throw new RuleDecisionRequired(geometry.reason);
    const from = b.positions[command.actor];
    const distance = Math.hypot(x - from.x, y - from.y);
    if (distance === 0) throw new Error('Точка назначения совпадает с текущей позицией');
    const resolved = resolveMove(state, command.id, command.actor, command.mode);
    const maxDistance = resolved.result.distance;
    if (distance > maxDistance + 1e-9)
      throw new Error(
        `Дистанция ${distance.toFixed(2)} м больше допустимой ${maxDistance} м («${mode.label}»)`,
      );
    const next = structuredClone(state);
    next.wounds = { ...next.wounds, combat: resolved.state };
    next.committed.push(command.id);
    next.moves.push({
      turn: state.wounds.combat.session.turnsStarted,
      actor: command.actor,
      mode: command.mode,
    });
    b.positions[command.actor] = { x, y };
    sync(b, next);
    append(b, 'move', {
      command,
      from,
      to: { x, y },
      cells: cellsOf({ x, y }, b.footprints[command.actor]),
      distance,
      maxDistance,
      odBefore: resolved.execution.odBefore,
      odAfter: resolved.execution.odAfter,
      fatigueAdded: resolved.result.fatigueAdded,
      coreLogs: resolved.logs,
      committed: true,
    });
    return { status: 'RESOLVED' as const, distance, maxDistance };
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
    pending: state.pending
      ? { reason: state.pending.reason, savedDice: state.pending.prefix.length }
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
    wounds: b.hp[id],
    maxWounds: actor(id).max,
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
/** Honest status of every personal weapon in this adapter; mirrors the boundaries in `resolve`. */
export function weaponSupport(id: WeaponId): WeaponSupport {
  switch (id) {
    case 'hotshot':
      return {
        level: 'supported',
        note: 'Одиночный выстрел разрешается Core полностью. Результат с 3+ степенями останавливается на подавлении: его контекст ещё не подключён.',
      };
    case 'pak-chain':
      return {
        level: 'partial',
        note: `Простой удар: промах разрешается полностью. Попадание останавливается — ${CHAIN_TIMING_BOUNDARY}`,
      };
    case 'kelus-chain':
      return { level: 'blocked', note: KELUS_CHAIN_BOUNDARY };
    default:
      return { level: 'blocked', note: FIRE_BOUNDARY };
  }
}

/** «Встать» (1 ОД) through the accepted Core; available only when the actor is not standing. */
export function standUp(b: Battle, command: { id: string; actor: ActorId }) {
  const state = getEngine(b);
  try {
    if (!ids.includes(command.actor)) throw new Error('Неизвестный персонаж');
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
  if (!ids.includes(id)) throw new Error('Неизвестный персонаж');
  validateFootprint(footprint);
  const old = b.footprints[id];
  const center = b.positions[id];
  const anchor = { col: center.x - old.width / 2, row: center.y - old.height / 2 };
  const next = { x: anchor.col + footprint.width / 2, y: anchor.row + footprint.height / 2 };
  const problem = placementProblemFor(b, id, next, footprint);
  if (problem) throw new Error(problem);
  b.footprints[id] = { width: footprint.width, height: footprint.height };
  b.positions[id] = next;
  append(b, 'footprint', {
    actor: id,
    footprint: b.footprints[id],
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
  ) {
    super(
      [...mapProblems, ...tokenProblems.map((t) => `${actor(t.actor).name}: ${t.problem}`)].join(
        ' ',
      ),
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
  if (problems.length || conflicts.length) throw new MapApplyRejected(problems, conflicts);
  const repositioned = ids
    .filter((id) => positions[id].x !== b.positions[id].x || positions[id].y !== b.positions[id].y)
    .map((id) => ({
      actor: id,
      from: b.positions[id],
      to: positions[id],
      cells: cellsOf(positions[id], b.footprints[id]),
    }));
  b.map = map;
  b.mapRevision += 1;
  b.doors = initialDoorStates(map);
  b.sceneRevision += 1;
  for (const r of repositioned) b.positions[r.actor] = r.to;
  append(b, 'map-applied', {
    // Geometry snapshot for replays; background bytes are visual and left out.
    snapshot: { ...map, background: null },
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
export function setDoorOpen(b: Battle, doorId: string, open: boolean) {
  if (combatStarted(b))
    throw new Error('Двери переключаются только на этапе расстановки, до начала боя.');
  const door = b.map.doors.find((d) => d.id === doorId);
  if (!door) throw new Error('Такой двери нет на карте');
  const current = b.doors[doorId] ?? door.open;
  if (current === open) throw new Error(open ? 'Дверь уже открыта' : 'Дверь уже закрыта');
  if (!open) {
    const g = buildGeometry(b.map, { ...b.doors, [doorId]: false });
    for (const id of ids) {
      const problem = footprintGeometryProblem(b.positions[id], b.footprints[id], g);
      if (problem)
        throw new Error(`Нельзя закрыть дверь: ${actor(id).name} стоит в проёме (${problem})`);
    }
  }
  b.doors = { ...b.doors, [doorId]: open };
  b.sceneRevision += 1;
  const line = segmentLine(door.from, door.to);
  append(b, 'door', {
    doorId,
    open,
    from: door.from,
    to: door.to,
    edges: line ? line.to - line.from : 0,
  });
  return { status: 'RESOLVED' as const };
}
