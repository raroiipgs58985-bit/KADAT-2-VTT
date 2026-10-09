import type {
  ActorReference,
  CombatActionState,
  EffectInstance,
  MeleeWeaponInstance,
  ResolutionContext,
  ResolutionModifier,
} from '@kadat/contracts';
import { scopedContext, materializeCombatModifiers } from './action-context.js';
import { resolveCharacteristic } from './characteristics.js';
import { meleeProvenance, meleeSource } from './melee-profile.js';
import { requireMelee } from './melee-state.js';

export function meleeModifier(id: string, value: number): ResolutionModifier {
  return { id, value, source: meleeSource, provenance: meleeProvenance(id) };
}

export function meleeWeaponEffects(weapon: MeleeWeaponInstance): readonly EffectInstance[] {
  const sources = [
    { source: weapon.template.profile.source, effects: weapon.template.effects },
    ...(weapon.pattern ? [weapon.pattern] : []),
    ...weapon.modifications,
  ];
  return sources.flatMap((entry, index) =>
    entry.effects.map((definition) => ({
      id: `melee-weapon:${weapon.id}:${index}:${definition.id}`,
      definition,
      source: entry.source,
      targetActor: weapon.owner,
      provenance: definition.provenance,
    })),
  );
}

export function meleeContext(
  state: CombatActionState,
  actor: ActorReference,
  supplied: ResolutionContext,
  modifiers: readonly ResolutionModifier[] = [],
  effects: readonly EffectInstance[] = [],
  tags: readonly string[] = [],
): ResolutionContext {
  const collected = scopedContext(
    state,
    actor,
    { ...supplied, modifiers: [...supplied.modifiers, ...modifiers] },
    effects,
    ['melee', ...tags],
  );
  const careful =
    state.actors[actor.actorId]?.aim?.type === 'careful' && tags.includes('action:melee-attack');
  const permitted = (candidateTags: readonly string[]) =>
    candidateTags.some((tag) =>
      [
        'careful-aim:target-speed',
        'careful-aim:height',
        'careful-aim:running',
        'careful-aim:charge',
      ].includes(tag),
    );
  const overrides = [...collected.overrides];
  if (careful) {
    for (const modifier of collected.modifiers)
      if (
        modifier.value < 0 &&
        permitted(modifier.tags ?? []) &&
        !overrides.some(
          (override) => override.subject === 'modifier' && override.id === modifier.id,
        )
      )
        overrides.push({
          subject: 'modifier',
          id: modifier.id,
          operation: 'EXCLUDE',
          origin: 'canonical',
          reason: 'Careful Aim: explicitly permitted penalty source',
        });
    for (const effect of collected.effects)
      if (
        effect.definition.target.kind === 'check' &&
        effect.definition.value < 0 &&
        permitted(effect.definition.tags) &&
        !overrides.some((override) => override.subject === 'effect' && override.id === effect.id)
      )
        overrides.push({
          subject: 'effect',
          id: effect.id,
          operation: 'EXCLUDE',
          origin: 'canonical',
          reason: 'Careful Aim: explicitly permitted penalty source',
        });
  }
  const context = { ...collected, overrides };
  const keys = tags.includes('action:melee-attack')
    ? ['melee:base', 'melee:technique', 'melee:grip', 'melee:attack', 'attacks-against-Stunned']
    : tags.includes('melee:avoidance')
      ? ['melee:avoidance', ...(tags.includes('action:parry') ? ['melee:grip'] : [])]
      : [];
  return materializeCombatModifiers(
    context,
    keys,
    ['melee:base', 'melee:technique', 'melee:grip'],
    true,
  );
}

export function meleeCharacteristic(
  state: CombatActionState,
  actor: ActorReference,
  name: 'НР' | 'СЛ',
  context: ResolutionContext,
) {
  const value = state.actors[actor.actorId]?.characteristics[name];
  if (!value) throw new Error(`Missing melee characteristic ${name}`);
  return resolveCharacteristic(name, value, context);
}

export function requireHeldWeapon(
  state: CombatActionState,
  actor: ActorReference,
  weaponId: string,
): MeleeWeaponInstance {
  const weapon = requireMelee(state).weapons[weaponId];
  if (
    !weapon ||
    weapon.owner.actorId !== actor.actorId ||
    !weapon.held ||
    !weapon.readied ||
    weapon.dropped
  )
    throw new Error('Melee weapon is not owned/held/readied');
  if (weapon.template.profile.family === 'natural')
    throw new Error('Natural weapon conflict is deferred');
  return weapon;
}
