import type {
  CombatParticipant,
  CombatSession,
  EffectDefinition,
  EffectInstance,
  ResolutionContext,
  ResolutionModifier,
} from '@kadat/contracts';
import { createCombatSession, createSequenceDice, endTurn, startTurn } from '../src/index.js';

export const actor = { actorId: 'Kelus' };
export const source = { kind: 'specification', id: 'Infantry Combat Core v0.1' };
export const provenance = {
  source,
  record: 'kernel acceptance',
  reason: 'Author-approved specification',
};

export function context(changes: Partial<ResolutionContext> = {}): ResolutionContext {
  return { actor, tags: [], effects: [], modifiers: [], overrides: [], ...changes };
}

export function modifier(id: string, value: number): ResolutionModifier {
  return { id, value, source: { kind: 'test-source', id }, provenance };
}

export function effect(
  id: string,
  value: number,
  changes: Partial<EffectDefinition> = {},
): EffectInstance {
  return {
    id,
    source: { kind: 'test-source', id },
    targetActor: actor,
    provenance,
    definition: {
      id,
      target: { kind: 'characteristic', characteristic: 'СЛ', field: 'value' },
      operation: 'add',
      value,
      stage: 'temporary',
      stackingGroup: id,
      stackingRule: 'largest',
      tags: [],
      provenance,
      ...changes,
    },
  };
}

export function participants(): readonly CombatParticipant[] {
  return ['Kelus', 'Servitor', 'Apricot', 'Alyosha'].map((actorId) => ({
    actor: { actorId },
    agilityBonus: 0,
    reactions: { capacity: 1, remaining: 1 },
  }));
}

export function session(): CombatSession {
  return createCombatSession(
    'test-combat',
    'approved-test-release',
    participants(),
    createSequenceDice([10, 6, 3, 1].map((value) => ({ sides: 10, value }))),
  ).result;
}

export function finishRound(initial: CombatSession): CombatSession {
  let current = initial;
  while (current.phase !== 'round-ended') {
    current = endTurn(startTurn(current).result).result;
  }
  return current;
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
