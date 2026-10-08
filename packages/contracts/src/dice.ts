export interface DiceSource {
  roll(sides: number): number;
}

export interface DiceExpression {
  readonly count: number;
  readonly sides: number;
  readonly modifier: number;
}

export interface DiceRoll {
  readonly sides: number;
  readonly value: number;
}

export interface DiceResult {
  readonly expression: DiceExpression;
  readonly rolls: readonly DiceRoll[];
  readonly diceTotal: number;
  readonly total: number;
}

export interface DamageRoll extends DiceResult {
  readonly modifier: number;
  readonly rawDamage: number;
  readonly critical: boolean;
  readonly criticalTriggerCountForConsequence: 0 | 1;
}
