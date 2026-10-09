import type {
  CharacteristicId,
  DiceSource,
  ResolutionContext,
  ResolutionModifier,
  WoundRuntimeState,
  Provenance,
} from '@kadat/contracts';
import { resolveCharacteristic, halveCharacteristic } from './characteristics.js';
import { resolveEffects } from './context.js';
import { resolveCheck } from './checks.js';
import { woundContext, woundProvenance, woundSource } from './wound-state.js';

/** Check-only projection: never alters base characteristics or C-1 bVN absorption. */
export function projectWoundCheck(
  state: WoundRuntimeState,
  characteristic: CharacteristicId,
  supplied: ResolutionContext,
) {
  const context = woundContext(state, supplied.actor, supplied),
    runtime = state.combat.actors[context.actor.actorId]!,
    base = runtime.characteristics[characteristic];
  if (!base) throw new Error(`Missing characteristic ${characteristic}`);
  const resolved = resolveCharacteristic(characteristic, base, context),
    traces = resolveEffects(context);
  const halvingSources: Provenance[] = context.effects.flatMap((e, i) =>
    e.targetActor.actorId === context.actor.actorId &&
    e.definition.target.kind === 'combat-modifier' &&
    e.definition.target.key === 'wounds:blood-halving' &&
    traces[i]?.included
      ? [e.provenance]
      : [],
  );
  if (resolved.result.finalBonus <= runtime.fatigue)
    halvingSources.push(woundProvenance('Fatigue check-only halving'));
  // Blood/Fatigue are the same characteristic-halving kind; the accepted same-kind rule never sums them.
  const checkValue = halvingSources.length
    ? halveCharacteristic(resolved.result.finalValue)
    : resolved.result.finalValue;
  const modifiers: ResolutionModifier[] = context.effects.flatMap((e, i) => {
    const target = e.definition.target;
    if (
      target.kind !== 'combat-modifier' ||
      !traces[i]?.included ||
      e.targetActor.actorId !== context.actor.actorId
    )
      return [];
    const key = target.key;
    const matches =
      key === `checks:${characteristic}` ||
      (key === 'checks:vision' && context.tags.includes('vision')) ||
      (key === 'checks:vision-vigilance' && context.tags.includes('vision-vigilance')) ||
      (key === 'checks:physical' && context.tags.includes('physical')) ||
      (key === 'checks:mobility' && context.tags.includes('mobility')) ||
      (key === 'checks:affected-limb' && context.tags.includes(`injury:${e.provenance.record}`)) ||
      (key === `checks:speech:${characteristic}` && context.tags.includes('speech')) ||
      (key === `checks:injured-eye:${characteristic}` && context.tags.includes('injured-eye'));
    return matches
      ? [
          {
            id: `wound-effect:${e.id}`,
            value: traces[i]!.value,
            source: e.source,
            provenance: e.provenance,
          },
        ]
      : [];
  });
  const checkContext = { ...context, modifiers: [...context.modifiers, ...modifiers] };
  return {
    projection: {
      characteristic,
      authoritative: base,
      resolvedValue: resolved.result.finalValue,
      checkValue,
      halvingSources,
      context: checkContext,
    },
    finalSuper: resolved.result.finalSuper,
    log: resolved.log,
  };
}
export function resolveWoundCheck(
  state: WoundRuntimeState,
  characteristic: CharacteristicId,
  context: ResolutionContext,
  source: DiceSource,
  modifier?: { readonly id: string; readonly value: number; readonly provenance: Provenance },
) {
  if (modifier && context.overrides.some((o) => o.subject === 'modifier' && o.id === modifier.id))
    throw new Error('Cannot override an explicit canonical wound check modifier');
  const projected = projectWoundCheck(state, characteristic, context);
  const scoped = {
    ...projected.projection.context,
    modifiers: [
      ...projected.projection.context.modifiers,
      ...(modifier ? [{ ...modifier, source: modifier.provenance.source }] : []),
    ],
  };
  const checked = resolveCheck(
    {
      baseValue: projected.projection.checkValue,
      finalSuper: projected.finalSuper,
      context: scoped,
    },
    source,
  );
  return {
    ...checked,
    log: { ...checked.log, woundCheck: projected.projection },
    projection: projected.projection,
    characteristicLog: projected.log,
  };
}
export function canonicalWoundModifier(id: string, value: number) {
  return { id, value, source: woundSource, provenance: woundProvenance(id) };
}
