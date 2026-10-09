import type {
  CombatActionState,
  DamageInput,
  DiceSource,
  HitRecord,
  MeleeHitRecord,
  MeleeEffectIntent,
  ProtectionRuntimeState,
  ResolutionContext,
} from '@kadat/contracts';
import { scopedContext } from './action-context.js';
import { resolveProtectionDamage } from './damage-resolution.js';

export function damageInputFromHit(hit: HitRecord | MeleeHitRecord): DamageInput {
  const melee = 'damageTransforms' in hit;
  return {
    hitId: hit.id,
    attackId: hit.attackId,
    attacker: hit.attacker,
    target: hit.target,
    location: hit.location,
    weapon: {
      instanceId: melee ? hit.weaponId : hit.weaponInstanceId,
      source: melee ? hit.profile : hit.weaponTemplate,
    },
    profile: hit.unresolvedDamage,
    penetration: melee ? hit.penetration : hit.unresolvedPenetration,
    transformations: melee
      ? hit.damageTransforms.map((t, i) => ({ ...t, id: `${hit.id}:transform:${i}` }))
      : [],
    tags: hit.context.tags,
    context: hit.context,
    provenance: hit.provenance,
  };
}
/** Only body-damage intents enter C-1; Stun duration/item-use have different boundaries. */
export function damageInputFromPrimitiveIntent(
  intent: MeleeEffectIntent,
  metadata: Pick<DamageInput, 'hitId' | 'attackId' | 'penetration'>,
  context: ResolutionContext,
): DamageInput {
  if (intent.type !== 'PrimitiveDamageIntent' || !intent.damage || !intent.location)
    throw new Error('A complete primitive body-damage intent is required');
  return {
    ...metadata,
    attacker: intent.actor,
    target: intent.target,
    location: intent.location,
    profile: intent.damage,
    transformations: (intent.damageTransforms ?? []).map((t, i) => ({
      ...t,
      id: `${metadata.hitId}:transform:${i}`,
    })),
    tags: context.tags,
    context,
    provenance: intent.provenance,
  };
}
/** Read current target VN/effects without rewriting combat state or accepted attack results. */
export function resolveCombatHitDamage(
  combat: CombatActionState,
  protection: ProtectionRuntimeState,
  hit: HitRecord | MeleeHitRecord,
  source: DiceSource,
  supplied?: ResolutionContext,
) {
  const input = damageInputFromHit(hit),
    target = combat.actors[hit.target.actorId];
  if (!target) throw new Error('Unknown damage target');
  const context = scopedContext(combat, hit.target, {
    ...(supplied ?? hit.context),
    actor: hit.target,
    targetActor: hit.attacker,
  });
  return resolveProtectionDamage(
    {
      input,
      state: protection,
      ...(target.characteristics.ВН ? { endurance: target.characteristics.ВН } : {}),
      context: { ...context, actor: hit.attacker, targetActor: hit.target },
      combatSessionId: combat.session.id,
    },
    source,
  );
}
