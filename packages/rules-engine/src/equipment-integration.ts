import type {
  ActionRequest,
  CombatActionState,
  DiceSource,
  EquipmentCollection,
  EquipmentInstance,
  RangedAttackRequest,
  ResolutionContext,
  WoundRuntimeState,
} from '@kadat/contracts';
import { collectEquipmentEffects } from './equipment-effects.js';
import { scopedContext } from './action-context.js';
import { resolveCombatAction } from './actions.js';
import { resolveRangedAttack } from './ranged.js';
import { finishActionTurn } from './action-state.js';
import { removeWoundCondition } from './wound-conditions.js';
import { resolutionLog } from './log.js';
import { resolveWoundCheck } from './wound-checks.js';
import { resolveCharacteristic } from './characteristics.js';
import { resolveCheck } from './checks.js';
import { integer } from './validation.js';

export function equipmentCapabilities(collection: EquipmentCollection) {
  if (collection.status !== 'RESOLVED') throw new Error('Equipment capabilities are pending');
  return collection.capabilities.map((t) => t.contribution!);
}
export function validateEquipmentAction(collection: EquipmentCollection, action: string) {
  for (const p of equipmentCapabilities(collection))
    if (p.kind === 'ACTION_RESTRICTION' && p.action === action)
      throw new Error('Action restricted by equipment');
}
export function resolveEquipmentCombatAction(
  state: CombatActionState,
  equipment: readonly EquipmentInstance[],
  request: ActionRequest,
  source: DiceSource,
) {
  const collection = collectEquipmentEffects(
    equipment,
    scopedContext(state, request.actor, request.context, [], [`action:${request.type}`]),
  );
  if (collection.status === 'PENDING')
    return { status: 'PENDING' as const, state, collection, resolution: null };
  validateEquipmentAction(collection, request.type);
  const changes = equipmentCapabilities(collection).filter(
    (p) => p.kind === 'MOVEMENT_MODIFIER' && (!p.action || p.action === request.type),
  );
  const speed = changes.reduce(
    (n, p) => n + (p.kind === 'MOVEMENT_MODIFIER' && p.field === 'speed' ? p.value : 0),
    state.actors[request.actor.actorId]!.movement,
  );
  if (!Number.isFinite(speed) || speed <= 0) throw new Error('Invalid equipment-adjusted movement');
  const odModifier = changes.reduce(
    (n, p) => n + (p.kind === 'MOVEMENT_MODIFIER' && p.field === 'od' ? p.value : 0),
    0,
  );
  integer(odModifier, 'movement OD modifier');
  const runtime = state.actors[request.actor.actorId]!;
  const context = {
    ...collection.context,
    modifiers: [
      ...collection.context.modifiers,
      ...collection.capabilities.flatMap((t) =>
        t.contribution?.kind === 'MOVEMENT_MODIFIER' &&
        t.contribution.field === 'od' &&
        (!t.contribution.action || t.contribution.action === request.type)
          ? [
              {
                id: `equipment:movement-od:${t.effect.sourceItemId}:${t.effect.id}`,
                value: t.contribution.value,
                source: t.effect.provenance.source,
                provenance: t.effect.provenance,
              },
            ]
          : [],
      ),
    ],
  };
  const view = {
    ...state,
    actors: { ...state.actors, [request.actor.actorId]: { ...runtime, movement: speed } },
  };
  const resolution = resolveCombatAction(view, { ...request, context }, source);
  const actor = resolution.state.actors[request.actor.actorId]!;
  const next = {
    ...resolution.state,
    actors: {
      ...resolution.state.actors,
      [request.actor.actorId]: { ...actor, movement: runtime.movement },
    },
  };
  const mutations = resolution.execution.mutations.map((m) =>
    m.path === `actors.${request.actor.actorId}`
      ? { ...m, before: runtime, after: next.actors[request.actor.actorId] }
      : m,
  );
  const execution = { ...resolution.execution, mutations };
  return {
    status: 'RESOLVED' as const,
    state: next,
    collection,
    resolution: {
      ...resolution,
      execution,
      state: next,
      logs: [
        collection.log,
        ...resolution.logs.map((l) =>
          l.action?.id === request.id ? { ...l, action: execution, mutations } : l,
        ),
      ],
    },
  };
}
export function resolveEquipmentRangedAttack(
  state: CombatActionState,
  equipment: readonly EquipmentInstance[],
  request: RangedAttackRequest,
  source: DiceSource,
  handling: { readonly weaponClass: 'HEAVY' | 'OTHER'; readonly hands: 1 | 2 } = {
    weaponClass: 'OTHER',
    hands: 2,
  },
) {
  const collection = collectEquipmentEffects(
    equipment,
    scopedContext(state, request.actor, request.context, [], ['ranged', `action:${request.type}`]),
  );
  if (collection.status === 'PENDING')
    return { status: 'PENDING' as const, state, collection, resolution: null };
  validateEquipmentAction(collection, request.type);
  if (
    handling.weaponClass === 'HEAVY' &&
    handling.hands === 1 &&
    !equipmentCapabilities(collection).some(
      (p) =>
        (p.kind === 'RECOIL_OR_STABILIZATION_EFFECT' && p.capability === 'HEAVY_ONE_HANDED') ||
        (p.kind === 'ACTION_PERMISSION' && p.action === 'heavy-one-handed'),
    )
  )
    throw new Error('Heavy one-handed handling requires explicit permission');
  const resolution = resolveRangedAttack(
    state,
    { ...request, context: collection.context },
    source,
  );
  return {
    status: 'RESOLVED' as const,
    state: resolution.state,
    collection,
    resolution: { ...resolution, logs: [collection.log, ...resolution.logs] },
  };
}
/** End-of-turn trigger, not immunity. Protected C-2 blood-loss conditions retain their removal rule. */
export function finishEquipmentTurn(
  state: CombatActionState,
  equipment: readonly EquipmentInstance[],
  context: ResolutionContext,
  wounds?: WoundRuntimeState,
) {
  if (
    state.session.phase !== 'turn-active' ||
    state.session.activeActor?.actorId !== context.actor.actorId
  )
    throw new Error('Equipment trigger requires wearer own turn');
  if (wounds && wounds.combat !== state) throw new Error('Wound/combat snapshot mismatch');
  const collection = collectEquipmentEffects(
    equipment,
    scopedContext(state, context.actor, context, [], ['equipment:end-own-turn']),
  );
  if (collection.status === 'PENDING')
    return {
      status: 'PENDING' as const,
      state,
      wounds,
      collection,
      logs: [collection.log],
      protectedConditionIds: [] as string[],
    };
  const ended = finishActionTurn(state); // Validate the accepted transition before constructing mutations.
  const triggers = equipmentCapabilities(collection).filter(
    (p) => p.kind === 'CONDITION_REMOVAL_TRIGGER',
  );
  if (!triggers.length)
    return {
      status: 'RESOLVED' as const,
      state: ended.state,
      wounds: wounds ? { ...wounds, combat: ended.state } : undefined,
      collection,
      logs: [collection.log, ...ended.logs],
      protectedConditionIds: [] as string[],
    };
  const removed = ended.state.session.conditions.filter(
    (c) => c.actor.actorId === context.actor.actorId && c.type === 'Stunned',
  );
  let combat: CombatActionState = {
    ...ended.state,
    session: {
      ...ended.state.session,
      conditions: ended.state.session.conditions.filter((c) => !removed.includes(c)),
    },
  };
  let nextWounds: WoundRuntimeState | undefined = wounds ? { ...wounds, combat } : undefined;
  const protectedConditionIds: string[] = [];
  if (nextWounds)
    for (const c of wounds!.actors[context.actor.actorId]?.conditions ?? [])
      if (c.type === 'Stunned') {
        if (c.removal === 'blood-replacement') {
          protectedConditionIds.push(c.id);
          continue;
        }
        nextWounds = removeWoundCondition(nextWounds!, context.actor, c.id, 'source-resolved');
        combat = nextWounds!.combat;
      }
  const log = resolutionLog('equipment-end-turn', collection.context, {
    equipment: collection.log.equipment!,
    mutations: [
      {
        type: 'bio-monitor-Stunned-removal',
        actor: context.actor,
        path: 'session.conditions',
        before: ended.state.session.conditions,
        after: combat.session.conditions,
      },
      ...(wounds && nextWounds
        ? [
            {
              type: 'bio-monitor-wound-condition-removal',
              actor: context.actor,
              path: `wounds.actors.${context.actor.actorId}.conditions`,
              before: wounds.actors[context.actor.actorId]?.conditions,
              after: nextWounds.actors[context.actor.actorId]?.conditions,
            },
          ]
        : []),
    ],
  });
  return {
    status: 'RESOLVED' as const,
    state: combat,
    wounds: nextWounds,
    collection,
    logs: [collection.log, log, ...ended.logs],
    protectedConditionIds,
  };
}

/** Explicit size contribution for caller-supplied Grapple/reach context; no canonical size rewrite. */
export function resolveEquipmentSize(baseSize: number, collection: EquipmentCollection): number {
  integer(baseSize, 'base size', 0);
  const size = equipmentCapabilities(collection).reduce(
    (n, p) => n + (p.kind === 'SIZE_MODIFIER' ? p.value : 0),
    baseSize,
  );
  integer(size, 'equipment-adjusted size', 0);
  return size;
}
/** Pure check hook: capabilities remain separate and check arithmetic stays in the accepted engine. */
export function resolveEquipmentCheck(
  state: CombatActionState,
  equipment: readonly EquipmentInstance[],
  characteristic: import('@kadat/contracts').CharacteristicId,
  context: ResolutionContext,
  source: DiceSource,
  scope: string,
  wounds?: WoundRuntimeState,
) {
  const collection = collectEquipmentEffects(
    equipment,
    scopedContext(
      state,
      context.actor,
      context,
      [],
      [`check:${scope}`, ...(scope === 'ranged' ? ['ranged'] : [])],
    ),
  );
  if (collection.status === 'PENDING')
    return { status: 'PENDING' as const, collection, check: null, logs: [collection.log] };
  if (
    equipmentCapabilities(collection).some((p) => p.kind === 'CHECK_IMMUNITY' && p.scope === scope)
  )
    return { status: 'IMMUNE' as const, collection, check: null, logs: [collection.log] };
  if (wounds) {
    if (wounds.combat !== state) throw new Error('Wound/combat snapshot mismatch');
    const checked = resolveWoundCheck(wounds, characteristic, collection.context, source);
    return {
      status: 'RESOLVED' as const,
      collection,
      check: checked.result,
      logs: [collection.log, checked.characteristicLog, checked.log],
    };
  }
  const base = state.actors[context.actor.actorId]?.characteristics[characteristic];
  if (!base) throw new Error('Missing check characteristic');
  const resolved = resolveCharacteristic(characteristic, base, collection.context);
  const checked = resolveCheck(
    {
      baseValue: resolved.result.finalValue,
      finalSuper: resolved.result.finalSuper,
      context: collection.context,
    },
    source,
  );
  return {
    status: 'RESOLVED' as const,
    collection,
    check: checked.result,
    logs: [collection.log, resolved.log, checked.log],
  };
}

export function equipmentConditionAllowed(
  collection: EquipmentCollection,
  condition: string,
): boolean {
  return !equipmentCapabilities(collection).some(
    (p) => p.kind === 'CONDITION_IMMUNITY' && p.condition === condition,
  );
}
