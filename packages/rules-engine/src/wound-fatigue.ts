import type {
  ActorReference,
  DiceSource,
  FatigueGainResult,
  Provenance,
  ResolutionContext,
  WoundRuntimeState,
} from '@kadat/contracts';
import { rollDie } from './dice.js';
import { resolveCharacteristic } from './characteristics.js';
import { planWoundCondition } from './wound-conditions.js';
import { woundIntent } from './wound-state.js';
import { integer } from './validation.js';
export function resolveFatigueGain(
  fatigueBefore: number,
  bVN: number,
  source: DiceSource,
  provenance: Provenance,
): FatigueGainResult {
  integer(fatigueBefore, 'fatigue before', 0);
  integer(bVN, 'fatigue bVN', 0);
  const roll = rollDie(10, source),
    rawFatigueGain = roll.value - bVN,
    appliedFatigueGain = Math.max(0, rawFatigueGain),
    fatigueAfter = fatigueBefore + appliedFatigueGain;
  integer(fatigueAfter, 'fatigue after', 0);
  return { roll, bVN, rawFatigueGain, appliedFatigueGain, fatigueBefore, fatigueAfter, provenance };
}
export function planFatigueGain(
  state: WoundRuntimeState,
  actor: ActorReference,
  bVN: number,
  source: DiceSource,
  context: ResolutionContext,
  id: string,
  provenance: Provenance,
) {
  const runtime = state.combat.actors[actor.actorId]!,
    gain = resolveFatigueGain(runtime.fatigue, bVN, source, provenance);
  const sv = runtime.characteristics.СВ;
  if (!sv) throw new Error('Current SV required for Fatigue threshold');
  const bSV = resolveCharacteristic('СВ', sv, context).result.finalBonus;
  let next: WoundRuntimeState = {
    ...state,
    combat: {
      ...state.combat,
      actors: {
        ...state.combat.actors,
        [actor.actorId]: { ...runtime, fatigue: gain.fatigueAfter },
      },
    },
  };
  const blocked = false;
  if (gain.appliedFatigueGain > 0 && gain.fatigueAfter > bVN + bSV) {
    const roll = rollDie(10, source),
      amount = roll.value - bSV;
    // Author ruling 33: 1к10 − бСВ ≤ 0 minutes — no unconsciousness.
    if (amount > 0) {
      next = planWoundCondition(next, actor, `${id}:unconscious`, 'Unconscious', provenance, {
        unit: 'minute',
        amount,
      }).state;
      const intent = woundIntent(
        `${id}:recovery`,
        'FatigueRecoveryIntent',
        actor,
        provenance,
        'After unconscious duration, recover bVN Fatigue per hour; campaign-time progression is deferred',
        { details: { bVN, perHours: 1 } },
      );
      next = {
        ...next,
        actors: {
          ...next.actors,
          [actor.actorId]: {
            ...next.actors[actor.actorId]!,
            intents: [...next.actors[actor.actorId]!.intents, intent],
          },
        },
      };
    }
  }
  return { state: next, gain, blocked };
}
