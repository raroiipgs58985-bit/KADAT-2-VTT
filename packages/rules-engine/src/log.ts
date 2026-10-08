import type { CombatLogEntry, CombatSession, ResolutionContext } from '@kadat/contracts';

export function resolutionLog(
  resolver: string,
  context: ResolutionContext,
  data: Partial<CombatLogEntry> = {},
): CombatLogEntry {
  return {
    resolver,
    actors: context.targetActor ? [context.actor, context.targetActor] : [context.actor],
    ...(context.canonicalReleaseId !== undefined
      ? { canonicalReleaseId: context.canonicalReleaseId }
      : {}),
    ...(context.roundNumber !== undefined ? { roundNumber: context.roundNumber } : {}),
    ...(context.turnNumber !== undefined ? { turnNumber: context.turnNumber } : {}),
    dice: [],
    baseValues: {},
    modifiers: [],
    overrides: [...context.overrides],
    mutations: [],
    ...data,
  };
}

export function sessionLog(
  resolver: string,
  session: CombatSession,
  data: Partial<CombatLogEntry> = {},
): CombatLogEntry {
  return {
    resolver,
    actors: session.initiativeOrder.map((entry) => entry.actor),
    canonicalReleaseId: session.canonicalReleaseId,
    roundNumber: session.roundNumber,
    ...(session.turn ? { turnNumber: session.turn.turnNumber } : {}),
    dice: [],
    baseValues: {},
    modifiers: [],
    overrides: [],
    mutations: [],
    ...data,
  };
}
