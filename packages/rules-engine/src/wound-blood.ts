import type {
  ActorReference,
  BloodState,
  BloodThresholds,
  Provenance,
  WoundRuntimeState,
} from '@kadat/contracts';
import { planWoundCondition, addWoundEffects } from './wound-conditions.js';
import { woundEffect, woundIntent, woundProvenance } from './wound-state.js';
import { integer } from './validation.js';
export function bloodThresholds(blood: BloodState): BloodThresholds {
  integer(blood.bloodLost, 'blood lost', 0);
  integer(blood.maxBlood, 'max blood', 1);
  const lost = BigInt(blood.bloodLost),
    reserve = BigInt(blood.maxBlood);
  return {
    quarter: lost * 4n >= reserve,
    half: lost * 2n >= reserve,
    threeQuarters: lost * 4n >= reserve * 3n,
  };
}
export function planBloodLoss(
  state: WoundRuntimeState,
  actor: ActorReference,
  loss: number,
  bVN: number,
  provenance: Provenance,
) {
  integer(loss, 'blood loss', 0);
  integer(bVN, 'blood reserve bonus', 0);
  let next = state;
  const before = state.actors[actor.actorId]!.blood;
  const maxBlood = 4 + bVN,
    bloodLost = before.bloodLost + loss;
  integer(maxBlood, 'max blood', 1);
  integer(bloodLost, 'blood lost after', 0);
  const after: BloodState = {
      maxBlood,
      reserveBonus: bVN,
      bloodLost,
      currentBlood: Math.max(0, maxBlood - bloodLost),
    },
    old = bloodThresholds(before),
    current = bloodThresholds(after);
  const crossed = (['quarter', 'half', 'threeQuarters'] as const).filter(
    (k) => current[k] && !old[k],
  );
  next = {
    ...next,
    actors: { ...next.actors, [actor.actorId]: { ...next.actors[actor.actorId]!, blood: after } },
  };
  if (!current.quarter) {
    const runtime = next.combat.actors[actor.actorId]!;
    next = {
      ...next,
      combat: {
        ...next.combat,
        actors: {
          ...next.combat.actors,
          [actor.actorId]: {
            ...runtime,
            effects: runtime.effects.filter((e) => e.id !== `blood:${actor.actorId}:quarter`),
          },
        },
      },
    };
  }
  const thresholdProvenance = {
    ...woundProvenance('Blood thresholds'),
    reason: `Canonical Blood rule; loss source ${provenance.source.id}; ${provenance.record ?? ''}`,
  };
  if (
    current.quarter &&
    !next.combat.actors[actor.actorId]!.effects.some(
      (e) => e.id === `blood:${actor.actorId}:quarter`,
    )
  )
    next = addWoundEffects(next, actor, [
      woundEffect(
        `blood:${actor.actorId}:quarter`,
        actor,
        'wounds:blood-halving',
        1,
        thresholdProvenance,
      ),
    ]);
  if (
    current.half &&
    !next.actors[actor.actorId]!.conditions.some((c) => c.id === `blood:${actor.actorId}:half`)
  )
    next = planWoundCondition(
      next,
      actor,
      `blood:${actor.actorId}:half`,
      'Stunned',
      thresholdProvenance,
      undefined,
      'blood-replacement',
    ).state;
  if (
    current.threeQuarters &&
    !next.actors[actor.actorId]!.conditions.some(
      (c) => c.id === `blood:${actor.actorId}:three-quarters`,
    )
  ) {
    next = planWoundCondition(
      next,
      actor,
      `blood:${actor.actorId}:three-quarters`,
      'Unconscious',
      thresholdProvenance,
    ).state;
    const intent = woundIntent(
      `blood:${actor.actorId}:death-countdown`,
      'TimedDeathIntent',
      actor,
      thresholdProvenance,
      'Canonical death after bVN minutes; no rounds conversion',
      { duration: { unit: 'minute', amount: bVN } },
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
  return { state: next, before, after, crossed };
}
