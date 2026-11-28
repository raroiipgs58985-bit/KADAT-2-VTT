export { createSequenceDice, rollDice, rollDie } from './dice.js';
export { resolveCharacteristic, halveCharacteristic } from './characteristics.js';
export { resolveEffects, resolveModifiers } from './context.js';
export { checkTarget, resolveCheck } from './checks.js';
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
export { resolveCombatAction, clearMalfunction, effectiveMovement } from './actions.js';
export {
  activateOverwatch,
  orderOverwatchInterrupts,
  resolveOverwatchInterrupts,
} from './overwatch.js';
export type { OverwatchActivationRequest } from './overwatch.js';
export { prepareRangedAttack, resolveRangedAttack, HEAVY_FROM_HANDS_TALENT } from './ranged.js';
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
  DISARM_TALENT,
  resolveBreakthrough,
} from './melee-actions.js';
export type {
  ChangeMeleeRequest,
  MeleeOpposedActionRequest,
  BreakthroughRequest,
} from './melee-actions.js';
export {
  prepareMeleeAttack,
  resolveMeleeAttack,
  resolveKnockdown,
  resolvePalisadeInterrupts,
} from './melee-attack.js';
export { resolveParry, resolveMeleeDodge, COUNTERATTACK_TALENT } from './melee-reactions.js';
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
export { planDeath, resolveWoundRoundEnd, resolveStabilization } from './wound-life.js';
export { resolvePostDamage, consequenceZoneFor } from './wound-resolution.js';
export { resolveWoundAwareAction } from './wound-action-context.js';

export { resolveWoundTurnStart } from './wound-turn.js';

export {
  equipmentEffectId,
  characteristicCapPayload,
  collectEquipmentEffects,
} from './equipment-effects.js';
export {
  equipmentCapabilities,
  equipmentConditionAllowed,
  resolveEquipmentSize,
  resolveEquipmentCheck,
  validateEquipmentAction,
  resolveEquipmentCombatAction,
  resolveEquipmentRangedAttack,
  finishEquipmentTurn,
} from './equipment-integration.js';
export {
  suppressionEventFromRanged,
  suppressionTrigger,
  suppressionTargetAffected,
} from './suppression-triggers.js';
export {
  createSuppressionEquipmentState,
  resolveSuppression,
  STEEL_NERVE_TALENT,
  FEARLESS_TALENT,
} from './suppression.js';
export {
  resolveSuppressionTurnStart,
  beginSuppressionEquipmentTurn,
} from './suppression-lifecycle.js';
export { opposedMeleeCheck } from './melee-opposed.js';
export { FREE_ACTION_TYPES, usesFreeAction } from './action-resources.js';
export {
  braceWeapon,
  clearBraces,
  dropWeapon,
  pickUpWeapon,
  putInHand,
  readyWeapon,
  reloadWeapon,
  QUICK_DRAW_TALENT,
  AMBIDEXTROUS_TALENT,
  transferWeapon,
  twoHandedWeapon,
  RAPID_RELOAD_TALENT,
  type DropWeaponRequest,
  type PickUpWeaponRequest,
  type ReadyWeaponRequest,
  resolveOverpenetration,
  type BraceWeaponRequest,
  type ReloadRequest,
  type ReloadResult,
} from './weapon-actions.js';
export {
  MELEE_CONDITIONS,
  RANGED_CONDITIONS,
  conditionModifiers,
  type CombatCondition,
} from './combat-conditions.js';
export {
  skillCheckValue,
  type SkillCheckValue as SkillTestValue,
  type SkillLevel,
} from './skills.js';
export * from './weapon-properties.js';
export * from './talent-effects.js';
