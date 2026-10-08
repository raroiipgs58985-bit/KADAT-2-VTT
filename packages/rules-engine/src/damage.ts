import type {
  DamageRoll,
  DiceExpression,
  DiceSource,
  LoggedResult,
  ResolutionContext,
} from '@kadat/contracts';
import { rollDice } from './dice.js';
import { resolutionLog } from './log.js';

export function resolveDamageRoll(
  expression: DiceExpression,
  source: DiceSource,
  context: ResolutionContext,
): LoggedResult<DamageRoll> {
  if (expression.sides !== 5 && expression.sides !== 10) {
    throw new Error('Canonical v0.1 weapon damage accepts only d5/d10');
  }
  const dice = rollDice(expression, source);
  const critical = dice.rolls.some((roll) => roll.value === expression.sides);
  const result: DamageRoll = {
    ...dice,
    modifier: expression.modifier,
    rawDamage: dice.total,
    critical,
    criticalTriggerCountForConsequence: critical ? 1 : 0,
  };
  return {
    result,
    log: resolutionLog('damage-roll', context, {
      dice: dice.rolls,
      baseValues: { modifier: expression.modifier, diceTotal: dice.diceTotal },
      damage: result,
    }),
  };
}
