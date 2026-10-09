export { createSequenceDice, rollDice, rollDie } from './dice.js';
export { resolveCharacteristic, halveCharacteristic } from './characteristics.js';
export { resolveEffects, resolveModifiers } from './context.js';
export { resolveCheck } from './checks.js';
export { resolveDamageRoll } from './damage.js';
export {
  createCombatSession,
  startTurn,
  endTurn,
  startNextRound,
  rebuildInitiative,
} from './combat.js';
export { applyStunned, remainingRounds, expireConditions, isRestricted } from './conditions.js';
export {
  createActionState,
  beginActionTurn,
  finishActionTurn,
  beginActionRound,
  emptyActionContext,
} from './action-state.js';
export { resolveCombatAction, clearMalfunction } from './actions.js';
export {
  activateOverwatch,
  orderOverwatchInterrupts,
  resolveOverwatchInterrupts,
} from './overwatch.js';
export type { OverwatchActivationRequest } from './overwatch.js';
export { resolveRangedAttack } from './ranged.js';
export type { OverwatchEvent } from './ranged.js';
export { resolveDodge } from './dodge.js';
export { resolveRange } from './range.js';
export { effectiveRangedProfile } from './weapons.js';
export { firstHitLocation, reverseAttackRoll, resolveHitLocations } from './hit-locations.js';
export { initializeMeleeState } from './melee-state.js';
export { composeMeleeProfile, meleeBases, meleeTechniques } from './melee-profile.js';
export {
  changeMeleeStanceGrip,
  resolveMeleeOpposedAction,
  resolveBreakthrough,
} from './melee-actions.js';
export type {
  ChangeMeleeRequest,
  MeleeOpposedActionRequest,
  BreakthroughRequest,
} from './melee-actions.js';
export { resolveMeleeAttack, resolveKnockdown, resolvePalisadeInterrupts } from './melee-attack.js';
export { resolveParry, resolveMeleeDodge } from './melee-reactions.js';
export { resolveGrappleAction } from './grapple.js';
export { prepareDamageExpression, rollAndTransformDamage } from './damage-transformations.js';
export { resolveFieldProtection, coversLocation } from './field-protection.js';
export { collectProtectionSources } from './protection-sources.js';
export { resolveProtectionBundle, resolvePenetration } from './protection-bundle.js';
export { resolveProtectionDamage, resolveFinalDamage } from './damage-resolution.js';
export {
  damageInputFromHit,
  damageInputFromPrimitiveIntent,
  resolveCombatHitDamage,
} from './damage-handoff.js';
export {
  consequenceCatalog,
  lookupConsequence,
  validateConsequenceCatalog,
} from './consequence-catalog.js';
export { classifyWounds, createWoundRuntime, validateWoundRuntime } from './wound-state.js';
export { projectWoundCheck, resolveWoundCheck } from './wound-checks.js';
export { planWoundCondition, removeWoundCondition } from './wound-conditions.js';
export { resolveFatigueGain } from './wound-fatigue.js';
export { bloodThresholds } from './wound-blood.js';
export { resolveBleedingPulse } from './wound-bleeding.js';
export { resolveWoundRoundEnd, resolveStabilization } from './wound-life.js';
export { resolvePostDamage, consequenceZoneFor } from './wound-resolution.js';
export { resolveWoundAwareAction } from './wound-action-context.js';

export { resolveWoundTurnStart } from './wound-turn.js';
