import type {
  ActorReference,
  CombatActionState,
  EffectInstance,
  ResolutionContext,
  ResolutionModifier,
  ResolutionOverride,
} from '@kadat/contracts';
import { remainingRounds } from './conditions.js';
import { resolveEffects } from './context.js';

export const ruleSource = Object.freeze({
  kind: 'specification',
  id: 'KADAT Infantry Core v0.1 B1 resolved',
});
export const ruleProvenance = Object.freeze({
  source: ruleSource,
  reason: 'Explicit user/author B-1 ruling',
});

export function ruleModifier(id: string, value: number): ResolutionModifier {
  return { id, value, source: ruleSource, provenance: { ...ruleProvenance, record: id } };
}

export function scopedContext(
  state: CombatActionState,
  actor: ActorReference,
  supplied: ResolutionContext,
  extraEffects: readonly EffectInstance[] = [],
  tags: readonly string[] = [],
): ResolutionContext {
  if (supplied.actor.actorId !== actor.actorId) throw new Error('Context actor mismatch');
  const runtime = state.actors[actor.actorId];
  if (!runtime) throw new Error('Unknown actor');
  const conditionEffects = state.session.conditions
    .filter((condition) => remainingRounds(condition, state.session.roundNumber) > 0)
    .flatMap((condition) => condition.effects);
  const effects = new Map<string, EffectInstance>();
  for (const effect of [
    ...runtime.effects,
    ...conditionEffects,
    ...supplied.effects,
    ...extraEffects,
  ]) {
    const prior = effects.get(effect.id);
    if (prior && prior !== effect) throw new Error(`Conflicting effect ID: ${effect.id}`);
    effects.set(effect.id, effect);
  }
  return {
    ...supplied,
    actor,
    canonicalReleaseId: state.session.canonicalReleaseId,
    roundNumber: state.session.roundNumber,
    turnNumber: state.session.turn?.turnNumber ?? state.session.turnsStarted,
    tags: [...new Set([...supplied.tags, ...tags])],
    effects: [...effects.values()],
  };
}

/** Explicit data-selected numeric hooks feed the existing modifier/override machinery. */
export function materializeCombatModifiers(context: ResolutionContext): ResolutionContext {
  const traces = resolveEffects(context);
  const modifiers = [...context.modifiers];
  const overrides = [...context.overrides];
  const replacements = new Set<string>();
  const addOverride = (override: ResolutionOverride) => {
    if (!overrides.some((prior) => prior.subject === override.subject && prior.id === override.id))
      overrides.push(override);
  };
  context.effects.forEach((effect, index) => {
    const target = effect.definition.target;
    if (
      target.kind !== 'combat-modifier' ||
      !['ranged:range', 'ranged:mode', 'ranged:attack', 'attacks-against-Stunned'].includes(
        target.key,
      )
    )
      return;
    if (
      effect.targetActor.actorId !== context.actor.actorId &&
      effect.targetActor.actorId !== context.targetActor?.actorId
    )
      return;
    if (effect.definition.operation !== 'add' && effect.definition.operation !== 'set')
      throw new Error('Unsupported ranged modifier operation');
    const contribution = traces[index];
    if (!contribution) throw new Error('Missing effect trace');
    const id = `effect:${effect.id}`;
    modifiers.push({
      id,
      value: effect.definition.value,
      source: effect.source,
      provenance: effect.provenance,
      ...(effect.definition.condition ? { condition: effect.definition.condition } : {}),
    });
    if (contribution.override) {
      addOverride({ ...contribution.override, subject: 'modifier', id });
    } else if (!contribution.included) {
      addOverride({
        subject: 'modifier',
        id,
        operation: 'EXCLUDE',
        origin: 'canonical',
        reason: `Effect ${effect.id}: ${contribution.reason}`,
      });
    }
    if (effect.definition.operation === 'set' && contribution.included) {
      if (!['ranged:range', 'ranged:mode'].includes(target.key))
        throw new Error('Replacement requires a generic range/mode source');
      if (replacements.has(target.key)) throw new Error('Ambiguous ranged replacement effects');
      replacements.add(target.key);
      addOverride({
        subject: 'modifier',
        id: target.key,
        operation: 'EXCLUDE',
        origin: 'canonical',
        reason: `Replaced by effect ${effect.id}`,
      });
    }
  });
  return { ...context, modifiers, overrides };
}
