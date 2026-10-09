import type {
  ActorReference,
  CombatActionState,
  DiceSource,
  OpposedResult,
  ResolutionContext,
} from '@kadat/contracts';
import { resolveCheck } from './checks.js';
import { meleeCharacteristic } from './melee-context.js';
import { requireMelee } from './melee-state.js';

export function opposedMeleeCheck(
  state: CombatActionState,
  actor: ActorReference,
  opponent: ActorReference,
  kind: 'НР' | 'СЛ' | 'athletics',
  actorContext: ResolutionContext,
  opponentContext: ResolutionContext,
  source: DiceSource,
  grapple = false,
) {
  const melee = requireMelee(state);
  const actorData = melee.actors[actor.actorId];
  const opponentData = melee.actors[opponent.actorId];
  if (!actorData || !opponentData || actor.actorId === opponent.actorId)
    throw new Error('Invalid opposed participants');
  const first =
    kind === 'athletics'
      ? actorData.skills.athletics
      : meleeCharacteristic(state, actor, kind, actorContext).result;
  const second =
    kind === 'athletics'
      ? opponentData.skills.athletics
      : meleeCharacteristic(state, opponent, kind, opponentContext).result;
  const attacker = resolveCheck(
    {
      baseValue: 'finalValue' in first ? first.finalValue : first.baseValue,
      finalSuper: 'finalSuper' in first ? first.finalSuper : 0,
      context: actorContext,
    },
    source,
  );
  const defender = resolveCheck(
    {
      baseValue: 'finalValue' in second ? second.finalValue : second.baseValue,
      finalSuper: second.finalSuper,
      context: opponentContext,
    },
    source,
  );
  const difference = grapple ? actorData.sizeCategory - opponentData.sizeCategory : 0;
  const sizeDegrees = {
    attacker: attacker.result.outcome === 'success' ? Math.max(0, difference) : 0,
    defender: defender.result.outcome === 'success' ? Math.max(0, -difference) : 0,
  };
  const a = attacker.result.totalDegrees + sizeDegrees.attacker;
  const b = defender.result.totalDegrees + sizeDegrees.defender;
  const result: OpposedResult = {
    actor,
    opponent,
    attackerCheck: attacker.result,
    defenderCheck: defender.result,
    sizeDegrees,
    winner: a > b ? actor : b > a ? opponent : null,
  };
  return { result, logs: [attacker.log, defender.log] };
}
