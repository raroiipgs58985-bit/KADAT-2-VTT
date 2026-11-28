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
  // «Общая механика» C5 (author ruling 22): more successes win; equal successes — the higher
  // bonus of the tested characteristic; a Super loser against a non-Super winner — degrees count
  // as equal and the higher threshold wins with 1 degree; both failed — nobody wins.
  const bonus = (who: ActorReference, ctx: ResolutionContext, value: typeof first) =>
    kind === 'athletics' || !('finalBonus' in value)
      ? meleeCharacteristic(state, who, 'СЛ', ctx).result.finalBonus
      : value.finalBonus;
  const bothSucceeded =
    attacker.result.outcome === 'success' && defender.result.outcome === 'success';
  let winner: ActorReference | null = a > b ? actor : b > a ? opponent : null;
  let decidedBy: OpposedResult['decidedBy'] = winner ? 'degrees' : 'none';
  let winnerDegrees: number | null = winner === actor ? a : winner === opponent ? b : null;
  if (bothSucceeded && winner) {
    const loserCheck = winner === actor ? defender.result : attacker.result;
    const winnerCheck = winner === actor ? attacker.result : defender.result;
    if (loserCheck.finalSuper > 0 && winnerCheck.finalSuper === 0) {
      const ta = attacker.result.target,
        tb = defender.result.target;
      winner = ta > tb ? actor : tb > ta ? opponent : null;
      decidedBy = winner ? 'super-threshold' : 'none';
      winnerDegrees = winner ? 1 : null;
    }
  } else if (bothSucceeded && !winner) {
    const ba = bonus(actor, actorContext, first),
      bb = bonus(opponent, opponentContext, second);
    winner = ba > bb ? actor : bb > ba ? opponent : null;
    decidedBy = winner ? 'characteristic-bonus' : 'none';
    winnerDegrees = winner ? a : null;
  }
  const result: OpposedResult = {
    actor,
    opponent,
    attackerCheck: attacker.result,
    defenderCheck: defender.result,
    sizeDegrees,
    winner,
    decidedBy,
    winnerDegrees,
  };
  return { result, logs: [attacker.log, defender.log] };
}
