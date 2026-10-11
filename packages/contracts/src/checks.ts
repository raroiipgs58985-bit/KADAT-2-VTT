import type { ResolutionContext, ResolutionTrace } from './resolution.js';

export interface CheckRequest {
  readonly baseValue: number;
  readonly finalSuper: number;
  readonly context: ResolutionContext;
}

export interface CheckResult {
  readonly rawRoll: number;
  readonly baseValue: number;
  readonly finalSuper: number;
  readonly modifiers: readonly ResolutionTrace[];
  readonly rawModifierSum: number;
  readonly finalModifier: number;
  readonly target: number;
  readonly criticalBand: 'success' | 'failure' | 'none';
  readonly outcome: 'success' | 'failure';
  readonly baseDegrees: number;
  readonly superDegrees: number;
  readonly totalDegrees: number;
  readonly failureDegrees?: number;
}
