import type { CheckResult } from './checks.js';
import type { DiceRoll } from './dice.js';
import type { ActorReference, Provenance } from './identity.js';

/** One-resolution ordering choice; never a characteristic/check modifier. */
export interface OverwatchOrderingOverride {
  readonly id: string;
  readonly participatingActorIds: readonly string[];
  readonly winnerActorId: string;
  readonly reason: string;
  readonly provenance: Provenance;
}

export interface OverwatchOrderingDecision {
  readonly participants: readonly {
    readonly actorId: string;
    readonly lv: number;
    readonly opposed: CheckResult;
  }[];
  readonly completeTie: true;
  readonly orderingResolution: 'RANDOM_TIEBREAK' | 'GM_OVERRIDE';
  readonly winnerActorId: string;
  readonly orderedActorIds: readonly string[];
  readonly provenance: Provenance;
  readonly random?: { readonly rolls: readonly DiceRoll[]; readonly provenance: Provenance };
  readonly override?: OverwatchOrderingOverride;
}

export interface OverwatchSkippedAttack {
  readonly actionId: string;
  readonly actor: ActorReference;
  readonly reason: string;
}
