import type { CheckRequest, CheckResult, DiceSource, LoggedResult } from '@kadat/contracts';
import { resolveEffects, resolveModifiers } from './context.js';
import { rollDie } from './dice.js';
import { resolutionLog } from './log.js';
import { integer } from './validation.js';

export function resolveCheck(request: CheckRequest, source: DiceSource): LoggedResult<CheckResult> {
  integer(request.baseValue, 'check base value', 0);
  integer(request.finalSuper, 'check Super-characteristic', 0);
  const effectTraces = resolveEffects(request.context);
  const checkEffects = request.context.effects.flatMap((effect, index) => {
    if (
      effect.definition.target.kind !== 'check' ||
      effect.targetActor.actorId !== request.context.actor.actorId
    )
      return [];
    if (effect.definition.operation !== 'add') throw new Error('Check effect must be additive');
    const contribution = effectTraces[index];
    return contribution ? [contribution] : [];
  });
  const modifiers = [...resolveModifiers(request.context), ...checkEffects];
  const rawModifierSum = modifiers.reduce(
    (total, modifier) => total + (modifier.included ? modifier.value : 0),
    0,
  );
  integer(rawModifierSum, 'raw check modifier sum');
  // Author ruling: cap once, after applicability and source overrides; never cap the target.
  const finalModifier = Math.max(-60, Math.min(60, rawModifierSum));
  const target = request.baseValue + finalModifier;
  integer(target, 'check target');
  const roll = rollDie(100, source);
  const criticalBand = roll.value <= 5 ? 'success' : roll.value >= 96 ? 'failure' : 'none';
  const success =
    criticalBand === 'success' || (criticalBand !== 'failure' && roll.value <= target);
  const rescued = criticalBand === 'success' && roll.value > target;
  const baseDegrees = rescued ? 1 : success ? 1 + Math.floor((target - roll.value) / 10) : 0;
  const superDegrees = success && !rescued ? Math.floor(request.finalSuper / 2) : 0;
  const result: CheckResult = {
    rawRoll: roll.value,
    baseValue: request.baseValue,
    finalSuper: request.finalSuper,
    modifiers,
    rawModifierSum,
    finalModifier,
    target,
    criticalBand,
    outcome: success ? 'success' : 'failure',
    baseDegrees,
    superDegrees,
    totalDegrees: baseDegrees + superDegrees,
    ...(!success ? { failureDegrees: 1 + Math.floor((roll.value - target) / 10) } : {}),
  };
  return {
    result,
    log: resolutionLog('check', request.context, {
      dice: [roll],
      baseValues: { baseValue: request.baseValue, finalSuper: request.finalSuper },
      modifiers,
      checkModifiers: { rawModifierSum, finalModifier },
      target,
      degrees: {
        base: baseDegrees,
        super: superDegrees,
        total: result.totalDegrees,
        ...(result.failureDegrees !== undefined ? { failure: result.failureDegrees } : {}),
      },
    }),
  };
}
