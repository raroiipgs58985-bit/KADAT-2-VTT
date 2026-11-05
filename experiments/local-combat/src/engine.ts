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
} from '../../../packages/rules-engine/src/index';
import { actor, append, ids, weapons, type ActorId, type Battle, type WeaponId } from './model';
import { rulings } from './rulings';

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
  pendingTurn?: { prefix: DiceRoll[]; reason: string };
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
  readonly name = 'ContextRequired';
}
const engines = new WeakMap<Battle, EngineState>();

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
        movement: 4,
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
      command.weapon === 'kelus-chain'
        ? 'Нужен полный персональный расчёт меча Келуса с питанием и бонусами; профиль не подменяется.'
        : 'Автоматическое попадание Спрей: Torso. Требуется согласование Огненное (Арсенал D51: игнор брони) и Горение (Механика A17:B17: половина ОБ сочленений); эффекты не пропускаются.',
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
    throw new ContextRequired(
      'Не утверждён порядок потери ОБ относительно текущего урона от Цепного. Попадание и его d100 сохранены.',
    );
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
