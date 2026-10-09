import type {
  EffectInstance,
  ResolutionContext,
  ResolutionModifier,
  Provenance,
} from '@kadat/contracts';

export const protectionSource = Object.freeze({
  kind: 'specification',
  id: 'KADAT Infantry Core v0.1 C-1 Protection/Damage',
});
export function protectionProvenance(record: string): Provenance {
  return {
    source: protectionSource,
    record,
    reason: 'User/author-approved C-1 implementation contract',
  };
}
/** Project only resolvable override subjects into this stage, keeping future-stage decisions intact in the request/log. */
export function protectionContext(
  context: ResolutionContext,
  effects: readonly EffectInstance[] = [],
  modifiers: readonly ResolutionModifier[] = [],
): ResolutionContext {
  const mergedEffects = [...context.effects, ...effects],
    mergedModifiers = [...context.modifiers, ...modifiers];
  return {
    ...context,
    effects: mergedEffects,
    modifiers: mergedModifiers,
    overrides: context.overrides.filter((o) =>
      (o.subject === 'effect' ? mergedEffects : mergedModifiers).some((v) => v.id === o.id),
    ),
  };
}
