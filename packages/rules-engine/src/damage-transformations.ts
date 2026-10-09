import type {
  DamageInput,
  DamageRoll,
  DamageTransformation,
  DiceExpression,
  DiceSource,
  ResolutionContext,
} from '@kadat/contracts';
import { resolveDamageRoll } from './damage.js';
import { integer, uniqueIds } from './validation.js';

export function prepareDamageExpression(input: DamageInput) {
  const original = input.profile.expression;
  integer(original.count, 'damage dice count', 1);
  integer(original.modifier, 'damage modifier');
  if (![5, 10].includes(original.sides)) throw new Error('Canonical v0.1 damage accepts d5/d10');
  uniqueIds(
    input.transformations.map((t) => t.id),
    'damage transformation IDs',
  );
  let count = original.count;
  let numericTransformationSeen = false;
  const traces: { transformation: DamageTransformation; before: number; after: number }[] = [];
  for (const t of input.transformations) {
    if (!['remove-die', 'add', 'multiply'].includes(t.type) || !t.provenance.source.id.trim())
      throw new Error('Invalid damage transformation');
    if (t.type === 'remove-die') {
      if (numericTransformationSeen)
        throw new Error('Dice selection must precede numeric damage transformations');
      integer(t.value, 'removed dice', 1);
      const next = count - t.value;
      integer(next, 'remaining damage dice', 1);
      traces.push({ transformation: t, before: count, after: next });
      count = next;
    } else if (t.type === 'add') {
      numericTransformationSeen = true;
      integer(t.value, 'flat damage transformation');
    } else if (!Number.isFinite(t.value) || t.value < 0 || t.rounding !== 'ceil')
      throw new Error('Damage multiplier requires explicit nonnegative value and ceil rounding');
    else numericTransformationSeen = true;
  }
  return { expression: { ...original, count }, traces };
}
function validatePreRolled(roll: DamageRoll, expression: DiceExpression) {
  if (
    roll.expression.count !== expression.count ||
    roll.expression.sides !== expression.sides ||
    roll.expression.modifier !== expression.modifier ||
    roll.rolls.length !== expression.count
  )
    throw new Error('Pre-rolled expression mismatch');
  const total = roll.rolls.reduce((sum, die) => {
    integer(die.value, 'pre-rolled die', 1);
    if (die.sides !== expression.sides || die.value > die.sides)
      throw new Error('Invalid pre-rolled die');
    return sum + die.value;
  }, 0);
  const critical = roll.rolls.some((d) => d.value === d.sides);
  if (
    roll.diceTotal !== total ||
    roll.modifier !== expression.modifier ||
    roll.total !== total + expression.modifier ||
    roll.rawDamage !== roll.total ||
    roll.critical !== critical ||
    roll.criticalTriggerCountForConsequence !== (critical ? 1 : 0)
  )
    throw new Error('Inconsistent pre-rolled damage/critical provenance');
}
export function rollAndTransformDamage(
  input: DamageInput,
  source: DiceSource,
  context: ResolutionContext,
  preRolled?: DamageRoll,
) {
  const prepared = prepareDamageExpression(input);
  if (preRolled) validatePreRolled(preRolled, prepared.expression);
  const rolled = preRolled
    ? { result: preRolled }
    : resolveDamageRoll(prepared.expression, source, context);
  let value = rolled.result.rawDamage;
  const traces = [...prepared.traces];
  for (const transformation of input.transformations.filter((t) => t.type !== 'remove-die')) {
    const next =
      transformation.type === 'add'
        ? value + transformation.value
        : Math.ceil(value * transformation.value);
    integer(next, 'transformed damage');
    traces.push({ transformation, before: value, after: next });
    value = next;
  }
  return {
    roll: rolled.result,
    rawDamage: value,
    traces,
    criticalConsequence: {
      unresolved: true as const,
      diceCount: (rolled.result.critical ? 1 : 0) as 0 | 1,
      maximumDiceIndices: rolled.result.rolls.flatMap((d, i) => (d.value === d.sides ? [i] : [])),
      provenance: [...input.provenance, ...input.transformations.map((t) => t.provenance)],
    },
  };
}
