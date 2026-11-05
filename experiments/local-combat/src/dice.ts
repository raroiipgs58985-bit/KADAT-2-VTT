import type { DiceRoll, DiceSource } from '@kadat/contracts';
import { createSequenceDice } from '../../../packages/rules-engine/src/index';
export function fixedDice(text: string): DiceSource {
  const rolls: DiceRoll[] = text.trim()
    ? text
        .trim()
        .split(/[\s,;]+/)
        .map((token) => {
          const m = /^(100|10|5|2):(\d+)$/.exec(token);
          if (!m || Number(m[2]) < 1 || Number(m[2]) > Number(m[1]))
            throw new Error(`Неверный куб: ${token}. Формат 100:35,10:2`);
          return { sides: Number(m[1]), value: Number(m[2]) };
        })
    : [];
  return createSequenceDice(rolls);
}
/** Explicit deterministic RNG adapter, not a game rule; uniform rejection sampling. */
export function seededDice(seed: number): DiceSource {
  if (!Number.isInteger(seed) || seed < 1 || seed > 0xffffffff)
    throw new Error('Seed: целое 1…4294967295');
  let state = seed >>> 0;
  return {
    roll(sides) {
      if (!Number.isInteger(sides) || sides < 2 || sides > 0xffffffff)
        throw new RangeError('Invalid die sides');
      const limit = Math.floor(0xffffffff / sides) * sides;
      let value: number;
      do {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        value = (state >>> 0) - 1;
      } while (value >= limit);
      return (value % sides) + 1;
    },
  };
}
