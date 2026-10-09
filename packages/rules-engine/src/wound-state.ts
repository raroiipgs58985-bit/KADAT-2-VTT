import type {
  CombatActionState,
  ResolutionContext,
  WoundActorState,
  WoundRuntimeState,
  DiceRoll,
  DiceSource,
  WoundIntent,
  ActorReference,
  Provenance,
  EffectInstance,
  WoundFacts,
} from '@kadat/contracts';
import { scopedContext } from './action-context.js';
import { resolveCharacteristic } from './characteristics.js';
import { validateActionState } from './action-state.js';
import { integer, uniqueIds } from './validation.js';
export const woundSource = Object.freeze({
  kind: 'specification',
  id: 'KADAT C-2 Consequences/Wounds + direct Fatigue gain ruling',
});
export function woundProvenance(record: string): Provenance {
  return { source: woundSource, record, reason: 'User/author-approved C-2 rule' };
}
export function woundEffect(
  id: string,
  actor: ActorReference,
  key: string,
  value: number,
  provenance: Provenance,
): EffectInstance {
  return {
    id,
    source: provenance.source,
    targetActor: actor,
    provenance,
    definition: {
      id,
      target: { kind: 'combat-modifier', key },
      operation: 'add',
      value,
      stage: 'temporary',
      stackingGroup: key,
      stackingRule: 'independent',
      tags: ['wound'],
      provenance,
    },
  };
}
export function woundIntent(
  id: string,
  type: WoundIntent['type'],
  actor: ActorReference,
  provenance: Provenance,
  reason: string,
  extra: Partial<WoundIntent> = {},
): WoundIntent {
  return { id, type, actor, source: provenance.source, provenance, reason, ...extra };
}
export function woundContext(
  state: WoundRuntimeState,
  actor: ActorReference,
  supplied: ResolutionContext,
): ResolutionContext {
  const context = scopedContext(state.combat, actor, supplied);
  for (const override of context.overrides) {
    const subject = (override.subject === 'effect' ? context.effects : context.modifiers).find(
      (e) => e.id === override.id,
    );
    if (subject?.source.id === woundSource.id)
      throw new Error('GM override cannot replace an explicit C-2 canonical rule');
  }
  return context;
}
export function currentWoundBonuses(
  state: WoundRuntimeState,
  actor: ActorReference,
  context: ResolutionContext,
) {
  const runtime = state.combat.actors[actor.actorId];
  if (!runtime?.characteristics.ВН) throw new Error('Current VN required');
  const vn = resolveCharacteristic('ВН', runtime.characteristics.ВН, context).result;
  return { vn, bVN: vn.finalBonus };
}
export function classifyWounds(
  maxWounds: number,
  damageTaken: number,
): 'Within Wounds' | 'Critical Wounded' {
  integer(maxWounds, 'max Wounds', 1);
  integer(damageTaken, 'damageTaken', 0);
  return damageTaken > maxWounds ? 'Critical Wounded' : 'Within Wounds';
}
export function validateWoundActor(actor: WoundActorState): void {
  classifyWounds(actor.maxWounds, actor.damageTaken);
  integer(actor.blood.reserveBonus, 'blood reserve bonus', 0);
  integer(actor.blood.maxBlood, 'max Blood', 1);
  integer(actor.blood.bloodLost, 'blood lost', 0);
  integer(actor.blood.currentBlood, 'current Blood', 0);
  if (
    actor.blood.maxBlood !== 4 + actor.blood.reserveBonus ||
    actor.blood.currentBlood !== Math.max(0, actor.blood.maxBlood - actor.blood.bloodLost)
  )
    throw new Error('Corrupt blood reserve/current Blood');
  uniqueIds(
    actor.injuries.map((i) => i.id),
    'Injury IDs',
  );
  uniqueIds(
    actor.bleeding.map((b) => b.id),
    'bleeding IDs',
  );
  uniqueIds(
    actor.conditions.map((c) => c.id),
    'wound condition IDs',
  );
  uniqueIds(
    actor.intents.map((i) => i.id),
    'wound intent IDs',
  );
  if (!['ALIVE', 'AGONY', 'STABILIZED', 'DEAD'].includes(actor.life.status))
    throw new Error('Invalid wound life state');
  const agony =
    actor.life.status === 'AGONY'
      ? actor.life
      : actor.life.status === 'STABILIZED'
        ? actor.life.priorAgony
        : null;
  if (agony) {
    integer(agony.startedRound, 'Agony start', 1);
    integer(agony.durationRounds, 'Agony rounds', 1);
    if (agony.expiresAfterRound !== agony.startedRound + agony.durationRounds - 1)
      throw new Error('Corrupt Agony expiry');
  }
  if (actor.life.status === 'STABILIZED') integer(actor.life.durationHours, 'stabilized hours', 1);
  for (const injury of actor.injuries) {
    if (injury.actor.actorId !== actor.actor.actorId) throw new Error('Injury actor mismatch');
    integer(injury.finalDamage, 'Injury finalDamage', 0);
    integer(injury.severity, 'Injury severity', 1);
  }
  for (const b of actor.bleeding) {
    if (!['LIGHT', 'MEDIUM', 'HEAVY'].includes(b.severity))
      throw new Error('Invalid bleeding severity');
    if (!actor.injuries.some((i) => i.id === b.injuryId))
      throw new Error('Bleeding has no source Injury');
  }
}
export function validateWoundRuntime(state: WoundRuntimeState): void {
  validateActionState(state.combat);
  uniqueIds(state.processedHitIds, 'processed wound hit IDs');
  uniqueIds(state.processedPulseIds, 'processed bleeding pulse IDs');
  for (const [id, actor] of Object.entries(state.actors)) {
    if (actor.actor.actorId !== id || !state.combat.actors[id])
      throw new Error('Mismatched wound actor');
    validateWoundActor(actor);
  }
}
export function createWoundRuntime(
  combat: CombatActionState,
  initial: Readonly<Record<string, { readonly maxWounds: number; readonly damageTaken: number }>>,
): WoundRuntimeState {
  const base: WoundRuntimeState = {
    combat,
    actors: {},
    processedHitIds: [],
    processedPulseIds: [],
  };
  const actors: Record<string, WoundActorState> = {};
  for (const [id, data] of Object.entries(initial)) {
    const actor = { actorId: id },
      ctx = scopedContext(combat, actor, {
        actor,
        tags: [],
        effects: [],
        modifiers: [],
        overrides: [],
      });
    const { bVN } = currentWoundBonuses(base, actor, ctx);
    const blood = { maxBlood: 4 + bVN, reserveBonus: bVN, bloodLost: 0, currentBlood: 4 + bVN };
    actors[id] = {
      actor,
      ...data,
      blood,
      injuries: [],
      bleeding: [],
      conditions: [],
      intents: [],
      life: { status: 'ALIVE' },
    };
  }
  const state = { ...base, actors };
  validateWoundRuntime(state);
  return state;
}
/** Replay prefix lets pending decisions resume without rerolling already consumed dice. */
export function woundDice(source: DiceSource, prefix: readonly DiceRoll[] = []) {
  let cursor = 0;
  const rolls: DiceRoll[] = [];
  return {
    rolls,
    source: {
      roll(sides: number) {
        const prior = prefix[cursor];
        if (prior && prior.sides !== sides) throw new Error('Wound replay die mismatch');
        const value = prior ? prior.value : source.roll(sides);
        rolls.push({ sides, value });
        cursor++;
        return value;
      },
    },
    assertComplete() {
      if (cursor < prefix.length) throw new Error('Unused wound replay dice');
    },
  };
}

export function validateWoundFacts(facts: WoundFacts | undefined): void {
  if (facts && (!facts.provenance?.source?.id?.trim() || !facts.provenance.reason?.trim()))
    throw new Error('Context facts need provenance');
}
