import type {
  ActionRequest,
  ActionResolution,
  CombatActionState,
  DiceSource,
  DodgeResult,
} from '@kadat/contracts';
import { scopedContext } from './action-context.js';
import { definition, validateResources, spendResources, actionLog } from './action-resources.js';
import { resolveEffects } from './context.js';
import { resolveCharacteristic } from './characteristics.js';
import { resolveCheck } from './checks.js';
import { integer } from './validation.js';

export function prepareDodge(state: CombatActionState, request: ActionRequest, dodgeable: boolean) {
  if (request.type !== 'dodge' || !dodgeable) throw new Error('Incoming action is not dodgeable');
  const context = scopedContext(state, request.actor, request.context, [], ['action:dodge']);
  const action = definition('dodge', 0, 1);
  validateResources(state, request, action, context, 'reaction');
  const traces = resolveEffects(context);
  if (
    context.effects.some(
      (effect, index) =>
        effect.targetActor.actorId === request.actor.actorId &&
        effect.definition.target.kind === 'permission' &&
        effect.definition.target.permission === 'dodge' &&
        effect.definition.operation === 'restrict' &&
        traces[index]?.included &&
        traces[index].value > 0,
    )
  )
    throw new Error('Dodge prohibited by effect');
  const actor = state.actors[request.actor.actorId];
  if (!actor) throw new Error('Unknown Dodge actor');
  const characteristic = resolveCharacteristic('ЛВ', actor.characteristics.ЛВ, context);
  return { context, action, characteristic };
}

export function resolveDodge(
  state: CombatActionState,
  request: ActionRequest,
  generatedHits: number,
  dodgeable: boolean,
  source: DiceSource,
): ActionResolution<DodgeResult> {
  integer(generatedHits, 'generated hits for Dodge', 1);
  const prepared = prepareDodge(state, request, dodgeable);
  const check = resolveCheck(
    {
      baseValue: prepared.characteristic.result.finalValue,
      finalSuper: prepared.characteristic.result.finalSuper,
      context: prepared.context,
    },
    source,
  );
  const dodgeDegrees = check.result.outcome === 'success' ? check.result.totalDegrees : 0;
  const cancelledHits = Math.min(generatedHits, dodgeDegrees);
  const spent = spendResources(state, request, prepared.action, prepared.context, 'reaction');
  const result: DodgeResult = {
    check: check.result,
    generatedHits,
    dodgeDegrees,
    cancelledHits,
    survivingHits: generatedHits - cancelledHits,
  };
  return {
    state: spent.state,
    execution: spent.execution,
    result,
    logs: [prepared.characteristic.log, check.log, actionLog(state, spent.execution)],
  };
}
