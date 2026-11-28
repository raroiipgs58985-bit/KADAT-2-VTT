/**
 * Skill value in a combat test (author ruling 49): with the skill at +0 the test uses the
 * characteristic unchanged; a skill bonus (+10, +15, …) is added to it; without the skill the
 * GM chooses a penalty (−20, −30, …). Nothing is assumed when the GM has not chosen.
 */
export interface SkillLevel {
  readonly name: string;
  readonly bonus: number;
}
export interface SkillCheckValue {
  readonly value: number;
  readonly modifier: number;
  readonly trained: boolean;
}
export function skillCheckValue(
  characteristic: number,
  skill: SkillLevel | null,
  gmUntrainedPenalty?: number,
): SkillCheckValue {
  if (!Number.isInteger(characteristic) || characteristic < 0)
    throw new Error('Invalid characteristic value');
  if (skill) {
    if (!Number.isInteger(skill.bonus) || skill.bonus < 0)
      throw new Error('Skill bonus must be a non-negative integer');
    return { value: characteristic + skill.bonus, modifier: skill.bonus, trained: true };
  }
  if (gmUntrainedPenalty === undefined)
    throw new Error('Untrained skill: the GM must choose a penalty');
  if (!Number.isInteger(gmUntrainedPenalty) || gmUntrainedPenalty > 0)
    throw new Error('Untrained penalty must be zero or negative');
  return {
    value: Math.max(0, characteristic + gmUntrainedPenalty),
    modifier: gmUntrainedPenalty,
    trained: false,
  };
}
