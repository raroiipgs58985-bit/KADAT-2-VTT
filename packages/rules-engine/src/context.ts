import type {
  EffectCondition,
  EffectInstance,
  ResolutionContext,
  ResolutionModifier,
  ResolutionTrace,
  RoundDuration,
} from '@kadat/contracts';
import { integer, uniqueIds } from './validation.js';

export function validateDuration(duration: RoundDuration): void {
  integer(duration.appliedRound, 'applied round', 1);
  integer(duration.durationRounds, 'duration rounds', 1);
  integer(duration.expiresAfterRound, 'expiry round', 1);
  if (duration.expiresAfterRound !== duration.appliedRound + duration.durationRounds - 1) {
    throw new Error('Inconsistent round duration');
  }
}

function validateContext(context: ResolutionContext): void {
  uniqueIds(
    context.effects.map((effect) => effect.id),
    'effect IDs',
  );
  uniqueIds(
    context.modifiers.map((modifier) => modifier.id),
    'modifier IDs',
  );
  uniqueIds(
    context.overrides.map((override) => `${override.subject}:${override.id}`),
    'override subjects',
  );
  if (context.roundNumber !== undefined) integer(context.roundNumber, 'context round', 1);
  for (const override of context.overrides) {
    const candidates = override.subject === 'effect' ? context.effects : context.modifiers;
    if (!candidates.some((candidate) => candidate.id === override.id)) {
      throw new Error(`Unknown override subject: ${override.subject}:${override.id}`);
    }
    if (!override.reason.trim()) throw new Error('Override requires a reason');
    if (override.operation === 'MODIFY') integer(override.value, 'override value');
  }
}

function matches(condition: EffectCondition | undefined, context: ResolutionContext): boolean {
  return !condition || condition.requiresTags.every((tag) => context.tags.includes(tag));
}

function trace(
  subject: 'effect' | 'modifier',
  candidate: EffectInstance | ResolutionModifier,
  value: number,
  included: boolean,
  reason: ResolutionTrace['reason'],
  context: ResolutionContext,
): ResolutionTrace {
  integer(value, 'resolution value');
  const override = context.overrides.find(
    (entry) => entry.subject === subject && entry.id === candidate.id,
  );
  return {
    subject,
    id: candidate.id,
    source: candidate.source,
    provenance: candidate.provenance,
    originalValue: value,
    value: override?.operation === 'MODIFY' ? override.value : value,
    included:
      override?.operation === 'INCLUDE'
        ? true
        : override?.operation === 'EXCLUDE'
          ? false
          : included,
    reason: override ? 'override' : reason,
    ...(override ? { override } : {}),
  };
}

/** Evaluates context only; resolver-specific stacking is intentionally separate. */
export function resolveEffects(context: ResolutionContext): readonly ResolutionTrace[] {
  validateContext(context);
  return context.effects.map((effect) => {
    let applicable = matches(effect.definition.condition, context);
    let reason: ResolutionTrace['reason'] = applicable ? 'applicable' : 'context';
    if (effect.duration) {
      validateDuration(effect.duration);
      if (context.roundNumber === undefined)
        throw new Error('Round-duration effect requires a context round');
      if (
        context.roundNumber < effect.duration.appliedRound ||
        context.roundNumber > effect.duration.expiresAfterRound
      ) {
        applicable = false;
        reason = 'duration';
      }
    }
    return trace('effect', effect, effect.definition.value, applicable, reason, context);
  });
}

export function resolveModifiers(context: ResolutionContext): readonly ResolutionTrace[] {
  validateContext(context);
  return context.modifiers.map((modifier) => {
    const applicable = matches(modifier.condition, context);
    return trace(
      'modifier',
      modifier,
      modifier.value,
      applicable,
      applicable ? 'applicable' : 'context',
      context,
    );
  });
}
