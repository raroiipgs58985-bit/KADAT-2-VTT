import type {
  CharacteristicId,
  CharacteristicResolution,
  CharacteristicState,
  EffectStage,
  LoggedResult,
  ResolutionContext,
} from '@kadat/contracts';
import { resolveEffects } from './context.js';
import { resolutionLog } from './log.js';
import { compareIds, integer } from './validation.js';

const stages: readonly EffectStage[] = ['permanent', 'implant', 'equipment', 'temporary'];

export function halveCharacteristic(value: number): number {
  integer(value, 'characteristic value', 0);
  return Math.ceil(value / 2);
}

export function resolveCharacteristic(
  characteristic: CharacteristicId,
  state: CharacteristicState,
  context: ResolutionContext,
): LoggedResult<CharacteristicResolution> {
  integer(state.baseValue, 'base characteristic', 0);
  integer(state.baseSuper, 'base Super-characteristic', 0);
  const allTraces = resolveEffects(context);
  const candidates = context.effects.flatMap((effect, index) => {
    const target = effect.definition.target;
    const contribution = allTraces[index];
    if (
      target.kind !== 'characteristic' ||
      target.characteristic !== characteristic ||
      effect.targetActor.actorId !== context.actor.actorId ||
      !contribution
    )
      return [];
    if (effect.definition.operation !== 'add' && effect.definition.operation !== 'set') {
      throw new Error('Unsupported characteristic operation');
    }
    return [{ effect, target, trace: { ...contribution } }];
  });

  // Same kind competes globally, before stage application. This is NOT generic Effect stacking.
  const groups = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    if (!candidate.trace.included) continue;
    if (!candidate.effect.definition.stackingGroup.trim())
      throw new Error('Characteristic effect requires a kind');
    const key = `${candidate.target.field}:${candidate.effect.definition.stackingGroup}`;
    const group = groups.get(key) ?? [];
    if (
      group.some(
        (entry) => entry.effect.definition.operation !== candidate.effect.definition.operation,
      )
    ) {
      throw new Error('Same-kind characteristic effects have conflicting operations');
    }
    groups.set(key, [...group, candidate]);
  }
  for (const group of groups.values()) {
    const winner = [...group].sort(
      (a, b) => b.trace.value - a.trace.value || compareIds(a.effect.id, b.effect.id),
    )[0];
    for (const candidate of group) {
      if (candidate !== winner)
        candidate.trace = { ...candidate.trace, included: false, reason: 'stacking' };
    }
  }

  let finalValue = state.baseValue;
  let finalSuper = state.baseSuper;
  for (const stage of stages) {
    for (const candidate of candidates
      .filter((entry) => entry.effect.definition.stage === stage)
      .sort((a, b) => compareIds(a.effect.id, b.effect.id))) {
      if (!candidate.trace.included) continue;
      const prior = candidate.target.field === 'value' ? finalValue : finalSuper;
      const next =
        candidate.effect.definition.operation === 'set'
          ? candidate.trace.value
          : prior + candidate.trace.value;
      integer(next, 'resolved characteristic', 0);
      if (candidate.target.field === 'value') finalValue = next;
      else finalSuper = next;
    }
  }
  const normalBonus = Math.floor(finalValue / 10);
  const result: CharacteristicResolution = {
    characteristic,
    baseValue: state.baseValue,
    baseSuper: state.baseSuper,
    finalValue,
    finalSuper,
    normalBonus,
    finalBonus: normalBonus + finalSuper,
    superSuccessDegrees: Math.ceil(finalSuper / 2),
  };
  return {
    result,
    log: resolutionLog('characteristic', context, {
      baseValues: {
        baseValue: state.baseValue,
        baseSuper: state.baseSuper,
        finalValue,
        finalSuper,
      },
      modifiers: candidates.map((candidate) => candidate.trace),
    }),
  };
}
