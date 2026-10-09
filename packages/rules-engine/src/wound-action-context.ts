import type {
  CharacteristicId,
  CombatActionState,
  EffectInstance,
  EffectDefinition,
  ResolutionContext,
  WoundRuntimeState,
} from '@kadat/contracts';
import { projectWoundCheck } from './wound-checks.js';
import { woundProvenance, woundEffect } from './wound-state.js';

/** Private, disposable source views: original definitions are restored in returned runtime. */
function projectWeaponSources(
  combat: CombatActionState,
  actorId: string,
  characteristic: CharacteristicId,
  halve: boolean,
) {
  const generatedDefinitions = new Set<EffectDefinition>();
  const transform = <T extends { readonly effects: readonly EffectDefinition[] }>(data: T): T => {
    for (const definition of data.effects) generatedDefinitions.add(definition);
    return halve
      ? {
          ...data,
          effects: data.effects.filter(
            (d) =>
              !(
                d.target.kind === 'characteristic' &&
                d.target.characteristic === characteristic &&
                d.target.field === 'value'
              ),
          ),
        }
      : data;
  };
  const viewWeapon = <
    T extends {
      readonly owner: { readonly actorId: string };
      readonly template: { readonly effects: readonly EffectDefinition[] };
      readonly pattern?: { readonly effects: readonly EffectDefinition[] };
      readonly modifications: readonly { readonly effects: readonly EffectDefinition[] }[];
    },
  >(
    weapon: T,
  ): T =>
    weapon.owner.actorId !== actorId
      ? weapon
      : {
          ...weapon,
          template: transform(weapon.template),
          ...(weapon.pattern ? { pattern: transform(weapon.pattern) } : {}),
          modifications: weapon.modifications.map(transform),
        };
  const loaded = new Set(
    Object.values(combat.weapons)
      .filter((w) => w.owner.actorId === actorId)
      .map((w) => w.loadedContainerId),
  );
  const weapons = Object.fromEntries(
    Object.entries(combat.weapons).map(([id, w]) => [id, viewWeapon(w)]),
  );
  const containers = Object.fromEntries(
    Object.entries(combat.containers).map(([id, c]) => [
      id,
      loaded.has(id)
        ? {
            ...c,
            ammo: {
              ...transform(c.ammo),
              ...(c.ammo.contribution ? { contribution: transform(c.ammo.contribution) } : {}),
            },
          }
        : c,
    ]),
  );
  const melee = combat.melee
    ? {
        ...combat.melee,
        weapons: Object.fromEntries(
          Object.entries(combat.melee.weapons).map(([id, w]) => [id, viewWeapon(w)]),
        ),
      }
    : undefined;
  const restoreWeapon = <
    T extends {
      readonly template: unknown;
      readonly pattern?: unknown;
      readonly modifications: unknown;
    },
  >(
    resolved: T,
    original: T | undefined,
  ): T =>
    original
      ? {
          ...resolved,
          template: original.template,
          ...(original.pattern ? { pattern: original.pattern } : {}),
          modifications: original.modifications,
        }
      : resolved;
  return {
    view: { ...combat, weapons, containers, ...(melee ? { melee } : {}) },
    generatedDefinitions,
    restore(resolved: CombatActionState): CombatActionState {
      return {
        ...resolved,
        weapons: Object.fromEntries(
          Object.entries(resolved.weapons).map(([id, w]) => [
            id,
            restoreWeapon(w, combat.weapons[id]),
          ]),
        ),
        containers: Object.fromEntries(
          Object.entries(resolved.containers).map(([id, c]) => [
            id,
            combat.containers[id] ? { ...c, ammo: combat.containers[id]!.ammo } : c,
          ]),
        ),
        ...(resolved.melee
          ? {
              melee: {
                ...resolved.melee,
                weapons: Object.fromEntries(
                  Object.entries(resolved.melee.weapons).map(([id, w]) => [
                    id,
                    restoreWeapon(w, combat.melee?.weapons[id]),
                  ]),
                ),
              },
            }
          : {}),
      };
    },
  };
}

/** Complete caller-selected effects must be collected before this one-resolution projection. */
export function resolveWoundAwareAction<T extends { readonly state: CombatActionState }>(
  state: WoundRuntimeState,
  characteristic: CharacteristicId,
  context: ResolutionContext,
  resolve: (combat: CombatActionState, context: ResolutionContext) => T,
) {
  const projected = projectWoundCheck(state, characteristic, context),
    actorId = context.actor.actorId;
  const sources = projectWeaponSources(
    state.combat,
    actorId,
    characteristic,
    projected.projection.halvingSources.length > 0,
  );
  const projectionLog = { ...projected.log, woundCheck: projected.projection };
  if (!projected.projection.halvingSources.length) {
    const resolution = resolve(state.combat, {
      ...projected.projection.context,
      effects: projected.projection.context.effects.filter(
        (e) => !sources.generatedDefinitions.has(e.definition),
      ),
    });
    return {
      resolution,
      state: { ...state, combat: resolution.state },
      projection: projected.projection,
      projectionLog,
    };
  }
  const replaced = (e: EffectInstance) =>
    e.targetActor.actorId === actorId &&
    e.definition.target.kind === 'characteristic' &&
    e.definition.target.characteristic === characteristic &&
    e.definition.target.field === 'value';
  const id = `wound-check-projection:${actorId}:${characteristic}`;
  const p = woundEffect(
    id,
    context.actor,
    'check-only-characteristic-projection',
    projected.projection.checkValue,
    woundProvenance(
      'Check-only Blood/Fatigue halving; transient resolved value, not authoritative storage',
    ),
  );
  const effect: EffectInstance = {
    ...p,
    definition: {
      ...p.definition,
      target: { kind: 'characteristic', characteristic, field: 'value' },
      operation: 'set',
      stackingGroup: 'check-only-projection',
    },
  };
  const runtime = state.combat.actors[actorId]!;
  const ephemeral: CombatActionState = {
    ...sources.view,
    actors: {
      ...state.combat.actors,
      [actorId]: { ...runtime, effects: runtime.effects.filter((e) => !replaced(e)) },
    },
    session: {
      ...state.combat.session,
      conditions: state.combat.session.conditions.map((c) => ({
        ...c,
        effects: c.effects.filter((e) => !replaced(e)),
      })),
    },
  };
  const supplied = projected.projection.context;
  const retained = supplied.effects.filter(
      (e) => !replaced(e) && !sources.generatedDefinitions.has(e.definition),
    ),
    replacedIds = new Set(supplied.effects.filter(replaced).map((e) => e.id));
  const checkContext = {
    ...supplied,
    effects: [...retained, effect],
    overrides: supplied.overrides.filter((o) => o.subject !== 'effect' || !replacedIds.has(o.id)),
  };
  const resolution = resolve(ephemeral, checkContext),
    resolvedActor = resolution.state.actors[actorId]!;
  const restoredActor = {
    ...resolvedActor,
    effects: [
      ...resolvedActor.effects.filter((e) => e.id !== id),
      ...runtime.effects.filter(replaced),
    ],
  };
  const conditions = resolution.state.session.conditions.map((c) => {
    const original = state.combat.session.conditions.find((old) => old.id === c.id);
    return original
      ? {
          ...c,
          effects: [...c.effects.filter((e) => e.id !== id), ...original.effects.filter(replaced)],
        }
      : c;
  });
  const combat = sources.restore({
    ...resolution.state,
    actors: { ...resolution.state.actors, [actorId]: restoredActor },
    session: { ...resolution.state.session, conditions },
  });
  return {
    resolution: { ...resolution, state: combat },
    state: { ...state, combat },
    projection: projected.projection,
    projectionLog,
  };
}
