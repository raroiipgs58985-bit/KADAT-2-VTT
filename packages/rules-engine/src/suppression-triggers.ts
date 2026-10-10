import type {
  SuppressionAttackSource,
  SuppressionCandidate,
  SuppressionEvent,
} from '@kadat/contracts';
import { integer } from './validation.js';

export function suppressionEventFromRanged(input: SuppressionAttackSource): SuppressionEvent {
  const { result, weaponClass: _weaponClass, ...source } = input;
  void _weaponClass;
  integer(result.shotsFired, 'resolved shots', 0);
  if (result.ammoSpent !== result.shotsFired)
    throw new Error('Inconsistent accepted firing quantity');
  return result.mode === 'single'
    ? {
        ...source,
        kind: 'SINGLE',
        successful: result.check.outcome === 'success' && !result.malfunction,
        successDegrees: result.check.totalDegrees,
      }
    : {
        ...source,
        kind: 'BURST',
        shotsForSuppression: result.shotsFired,
        quantitySource: 'RESOLVED_SHOTS',
        weaponClass: input.weaponClass,
      };
}
export function suppressionTrigger(event: SuppressionEvent): {
  triggered: boolean;
  radius: number | null;
  penaltyBasis: number;
  modifier: number;
  roundingPending: boolean;
} {
  if (
    !event.attackId?.trim() ||
    !event.sourceActor?.actorId ||
    !event.primaryTarget?.actorId ||
    !event.weapon?.id ||
    !event.provenance?.source?.id
  )
    throw new Error('Malformed suppression source event');
  if (event.kind === 'SINGLE') {
    integer(event.successDegrees, 'source success degrees', 0);
    if (typeof event.successful !== 'boolean')
      throw new Error('Malformed single suppression trigger');
    return {
      triggered: event.successful && event.successDegrees >= 3,
      radius: null,
      penaltyBasis: event.successDegrees,
      modifier: -5 * event.successDegrees,
      roundingPending: false,
    };
  }
  if (event.kind === 'BURST') {
    integer(event.shotsForSuppression, 'source firing quantity', 0);
    if (event.quantitySource !== 'RESOLVED_SHOTS')
      throw new Error('Suppression must derive from resolved shots, not hits');
    if (!['PISTOL', 'BASIC', 'HEAVY'].includes(event.weaponClass))
      throw new Error('Unsupported suppression weapon class mapping');
    const basis =
      event.shotsForSuppression *
      (event.weaponClass === 'PISTOL' ? 0.5 : event.weaponClass === 'HEAVY' ? 2 : 1);
    return {
      triggered: event.shotsForSuppression > 0,
      radius: 10,
      penaltyBasis: basis,
      modifier: -basis,
      roundingPending: !Number.isInteger(basis),
    };
  }
  if (event.kind !== 'AREA' || !event.radii.length)
    throw new Error('Area suppression requires explicit radius data');
  for (const r of event.radii) {
    if (
      !['EXPLOSION', 'MV', 'LV'].includes(r.property) ||
      !Number.isFinite(r.meters) ||
      r.meters < 0 ||
      !r.provenance.source.id
    )
      throw new Error('Invalid area radius/property');
  }
  const maximum = Math.max(...event.radii.map((r) => r.meters));
  integer(5 * maximum, 'area suppression modifier');
  return {
    triggered: true,
    radius: maximum + 10,
    penaltyBasis: maximum,
    modifier: -5 * maximum,
    roundingPending: false,
  };
}
export function suppressionTargetAffected(
  event: SuppressionEvent,
  candidate: SuppressionCandidate,
): boolean {
  if (
    !Number.isFinite(candidate.distanceFromPrimaryTarget) ||
    candidate.distanceFromPrimaryTarget < 0
  )
    throw new Error('Invalid suppression target distance');
  if (!['YES', 'NO', 'UNKNOWN'].includes(candidate.nearestCoverWithinSpeed))
    throw new Error('Invalid cover availability context');
  const trigger = suppressionTrigger(event);
  return (
    trigger.triggered &&
    (trigger.radius === null
      ? candidate.actor.actorId === event.primaryTarget.actorId
      : candidate.distanceFromPrimaryTarget <= trigger.radius)
  );
}
