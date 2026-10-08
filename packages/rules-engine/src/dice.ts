import type { DiceExpression, DiceResult, DiceRoll, DiceSource } from '@kadat/contracts';
import { integer } from './validation.js';

/** A local, explicit test source. No global state and no implicit RNG fallback. */
export function createSequenceDice(sequence: readonly DiceRoll[]): DiceSource {
  const rolls = sequence.map((roll) => ({ ...roll }));
  let cursor = 0;
  return {
    roll(sides) {
      const next = rolls[cursor];
      if (!next || next.sides !== sides) {
        throw new Error(`Expected injected d${sides} at position ${cursor}`);
      }
      integer(next.value, 'die result', 1);
      if (next.value > sides) throw new RangeError('Die result exceeds sides');
      cursor += 1;
      return next.value;
    },
  };
}

export function rollDie(sides: number, source: DiceSource): DiceRoll {
  integer(sides, 'die sides', 2);
  const value = source.roll(sides);
  integer(value, 'die result', 1);
  if (value > sides) throw new RangeError('Die result exceeds sides');
  return { sides, value };
}

export function rollDice(expression: DiceExpression, source: DiceSource): DiceResult {
  integer(expression.count, 'dice count', 1);
  integer(expression.sides, 'die sides', 2);
  integer(expression.modifier, 'dice modifier');
  const rolls = Array.from({ length: expression.count }, () => rollDie(expression.sides, source));
  const diceTotal = rolls.reduce((total, roll) => total + roll.value, 0);
  integer(diceTotal + expression.modifier, 'dice total');
  return {
    expression: { ...expression },
    rolls,
    diceTotal,
    total: diceTotal + expression.modifier,
  };
}
