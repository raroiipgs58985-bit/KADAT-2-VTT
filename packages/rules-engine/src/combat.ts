import type {
  CombatParticipant,
  CombatSession,
  DiceSource,
  InitiativeEntry,
  LoggedResult,
} from '@kadat/contracts';
import { expireConditions } from './conditions.js';
import { rollDie } from './dice.js';
import { sessionLog } from './log.js';
import { integer, uniqueIds } from './validation.js';

function validateParticipants(participants: readonly CombatParticipant[]): void {
  if (participants.length === 0) throw new Error('Combat requires participants');
  uniqueIds(
    participants.map((participant) => participant.actor.actorId),
    'participant IDs',
  );
  for (const participant of participants) {
    integer(participant.agilityBonus, 'agility bonus', 0);
    integer(participant.reactions.capacity, 'reaction capacity', 0);
    integer(participant.reactions.remaining, 'remaining reactions', 0);
    if (participant.reactions.remaining > participant.reactions.capacity)
      throw new Error('Reaction pool exceeds capacity');
  }
}

export function validateSession(session: CombatSession): void {
  validateParticipants(session.initiativeOrder);
  integer(session.roundNumber, 'round number', 1);
  integer(session.turnsStarted, 'turn count', 0);
  integer(session.cursor, 'initiative cursor', 0);
  if (session.cursor >= session.initiativeOrder.length)
    throw new Error('Initiative cursor is out of bounds');
  for (const [index, entry] of session.initiativeOrder.entries()) {
    integer(entry.roll.value, 'initiative roll', 1);
    if (
      entry.roll.sides !== 10 ||
      entry.roll.value > 10 ||
      entry.initiative !== entry.roll.value + entry.agilityBonus
    ) {
      throw new Error('Invalid initiative entry');
    }
    const previous = session.initiativeOrder[index - 1];
    if (previous && previous.initiative < entry.initiative)
      throw new Error('Unsorted initiative queue');
  }
  if (session.phase === 'turn-active') {
    const current = session.initiativeOrder[session.cursor];
    if (
      !session.turn ||
      !session.activeActor ||
      session.activeActor.actorId !== current?.actor.actorId ||
      session.turn.actor.actorId !== session.activeActor.actorId ||
      session.turn.turnNumber !== session.turnsStarted
    ) {
      throw new Error('Inconsistent active turn');
    }
  } else if (session.turn !== null || session.activeActor !== null) {
    throw new Error('Inactive session contains an active turn');
  }
  if (session.phase === 'ready' && session.cursor !== 0)
    throw new Error('Ready round must start at the first actor');
  if (session.phase === 'between-turns' && session.cursor === 0)
    throw new Error('No previous turn');
  if (session.phase === 'round-ended' && session.cursor !== session.initiativeOrder.length - 1) {
    throw new Error('Round ended before the last actor');
  }
}

function initiative(
  participants: readonly CombatParticipant[],
  source: DiceSource,
): readonly InitiativeEntry[] {
  validateParticipants(participants);
  const rolled: InitiativeEntry[] = participants
    .map((participant) => {
      const count = participant.initiativeRolls ?? 1;
      if (!Number.isInteger(count) || count < 1) throw new Error('Invalid initiative rolls');
      const rolls = Array.from({ length: count }, () => rollDie(10, source));
      const best = rolls.reduce((a, r) => (r.value > a.value ? r : a));
      const roll = best;
      const discarded = rolls.filter((r) => r !== best);
      return {
        actor: { ...participant.actor },
        agilityBonus: participant.agilityBonus,
        reactions: { ...participant.reactions },
        ...(count > 1 ? { initiativeRolls: count, discardedRolls: discarded } : {}),
        roll,
        initiative: roll.value + participant.agilityBonus,
      };
    })
    .sort((a, b) => b.initiative - a.initiative);
  return breakTies(rolled, source);
}

/**
 * Equal initiative: the tied participants reroll 1к10 among themselves, higher goes first;
 * rerolls repeat for those still tied (author ruling 23). Without ties no die is consumed.
 */
function breakTies(entries: InitiativeEntry[], source: DiceSource): InitiativeEntry[] {
  const out: InitiativeEntry[] = [];
  for (let i = 0; i < entries.length;) {
    let j = i + 1;
    while (j < entries.length && entries[j]!.initiative === entries[i]!.initiative) j++;
    out.push(...(j - i > 1 ? orderTied(entries.slice(i, j), source) : [entries[i]!]));
    i = j;
  }
  return out;
}
function orderTied(group: InitiativeEntry[], source: DiceSource): InitiativeEntry[] {
  const rolled = group.map((entry) => {
    const roll = rollDie(10, source);
    return { entry: { ...entry, tieRolls: [...(entry.tieRolls ?? []), roll] }, value: roll.value };
  });
  rolled.sort((a, b) => b.value - a.value);
  const out: InitiativeEntry[] = [];
  for (let i = 0; i < rolled.length;) {
    let j = i + 1;
    while (j < rolled.length && rolled[j]!.value === rolled[i]!.value) j++;
    const same = rolled.slice(i, j).map((r) => r.entry);
    out.push(...(same.length > 1 ? orderTied(same, source) : same));
    i = j;
  }
  return out;
}

export function createCombatSession(
  id: string,
  canonicalReleaseId: string,
  participants: readonly CombatParticipant[],
  source: DiceSource,
): LoggedResult<CombatSession> {
  if (!id.trim() || !canonicalReleaseId.trim())
    throw new Error('Combat identity and canonical release are required');
  const result: CombatSession = {
    id,
    canonicalReleaseId,
    roundNumber: 1,
    phase: 'ready',
    initiativeOrder: initiative(participants, source),
    cursor: 0,
    activeActor: null,
    turn: null,
    turnsStarted: 0,
    conditions: [],
  };
  return {
    result,
    log: sessionLog('initiative', result, {
      dice: result.initiativeOrder.map((entry) => entry.roll),
      baseValues: Object.fromEntries(
        result.initiativeOrder.map((entry) => [entry.actor.actorId, entry.agilityBonus]),
      ),
      mutations: [{ type: 'combat-create', path: 'session', before: null, after: result }],
    }),
  };
}

export function startTurn(session: CombatSession): LoggedResult<CombatSession> {
  validateSession(session);
  if (session.phase !== 'ready' && session.phase !== 'between-turns')
    throw new Error('Cannot start a turn in this phase');
  const entry = session.initiativeOrder[session.cursor];
  if (!entry) throw new Error('Missing initiative entry');
  const result: CombatSession = {
    ...session,
    phase: 'turn-active',
    activeActor: entry.actor,
    turnsStarted: session.turnsStarted + 1,
    turn: {
      actor: entry.actor,
      turnNumber: session.turnsStarted + 1,
      od: 2,
      reactions: { ...entry.reactions },
      flags: [],
    },
  };
  return {
    result,
    log: sessionLog('turn-start', result, {
      mutations: [
        { type: 'turn-start', actor: entry.actor, path: 'turn', before: null, after: result.turn },
      ],
    }),
  };
}

export function endTurn(session: CombatSession): LoggedResult<CombatSession> {
  validateSession(session);
  if (session.phase !== 'turn-active') throw new Error('No active turn to end');
  const last = session.cursor === session.initiativeOrder.length - 1;
  const expiration = last
    ? expireConditions(session.conditions, session.roundNumber)
    : { remaining: session.conditions, removed: [] };
  const result: CombatSession = {
    ...session,
    phase: last ? 'round-ended' : 'between-turns',
    cursor: last ? session.cursor : session.cursor + 1,
    turn: null,
    activeActor: null,
    conditions: expiration.remaining,
  };
  return {
    result,
    log: sessionLog(last ? 'round-end' : 'turn-end', session, {
      mutations: [
        { type: 'turn-end', path: 'turn', before: session.turn, after: null },
        {
          type: last ? 'round-end' : 'initiative-advance',
          path: 'phase',
          before: session.phase,
          after: result.phase,
        },
        ...expiration.removed.map((condition) => ({
          type: 'condition-remove',
          actor: condition.actor,
          path: `conditions.${condition.id}`,
          before: condition,
          after: null,
        })),
      ],
    }),
  };
}

export function startNextRound(session: CombatSession): LoggedResult<CombatSession> {
  validateSession(session);
  if (session.phase !== 'round-ended') throw new Error('Current round has not ended');
  const result: CombatSession = {
    ...session,
    roundNumber: session.roundNumber + 1,
    phase: 'ready',
    cursor: 0,
  };
  return {
    result,
    log: sessionLog('round-start', result, {
      mutations: [
        {
          type: 'round-start',
          path: 'roundNumber',
          before: session.roundNumber,
          after: result.roundNumber,
        },
      ],
    }),
  };
}

/** Queue rebuilding is a boundary operation, never a silent reset of a live turn. */
export function rebuildInitiative(
  session: CombatSession,
  participants: readonly CombatParticipant[],
  source: DiceSource,
): LoggedResult<CombatSession> {
  validateSession(session);
  if (session.phase !== 'ready' && session.phase !== 'round-ended')
    throw new Error('Initiative rebuild requires a round boundary');
  const ids = new Set(participants.map((participant) => participant.actor.actorId));
  if (session.initiativeOrder.some((entry) => !ids.has(entry.actor.actorId)))
    throw new Error('Rebuild cannot silently remove participants');
  const order = initiative(participants, source);
  const result: CombatSession = {
    ...session,
    initiativeOrder: order,
    cursor: session.phase === 'round-ended' ? order.length - 1 : 0,
  };
  return {
    result,
    log: sessionLog('initiative-rebuild', result, {
      dice: order.map((entry) => entry.roll),
      baseValues: Object.fromEntries(
        order.map((entry) => [entry.actor.actorId, entry.agilityBonus]),
      ),
      mutations: [
        {
          type: 'initiative-rebuild',
          path: 'initiativeOrder',
          before: session.initiativeOrder,
          after: order,
        },
      ],
    }),
  };
}
