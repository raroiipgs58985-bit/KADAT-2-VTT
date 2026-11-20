import type { DiceRoll } from '@kadat/contracts';
import {
  attack,
  cancelUnstarted,
  getEngine,
  moveActor,
  nextTurn,
  selectManualOrder,
  startCombat,
  type AttackCommand,
  type MoveCommand,
} from './engine';
import { fixedDice } from './dice';
import { createBattle, move, type ActorId, type Battle } from './model';
import { rulings } from './rulings';
type Step =
  | { type: 'attack'; command: AttackCommand; rolls: DiceRoll[] }
  | { type: 'next-turn'; rolls: DiceRoll[] }
  | { type: 'placement'; actor: ActorId; x: number; y: number }
  | { type: 'manual-turn'; actor: ActorId }
  | { type: 'cancel-unstarted' }
  | { type: 'start-combat'; rolls: DiceRoll[] }
  | { type: 'move'; command: MoveCommand };
const FORMAT = 'kadat-client-combat-v0.3';
export interface Replay {
  format: typeof FORMAT;
  baseline: string;
  rulings: typeof rulings;
  steps: Step[];
  log: Battle['log'];
}
export function exportReplay(b: Battle): Replay {
  const steps: Step[] = [];
  for (const entry of b.log) {
    const detail = entry.detail as {
      command?: AttackCommand;
      rolls?: DiceRoll[];
      actor: ActorId;
      after?: { x: number; y: number };
      kind?: 'start';
    };
    if ((entry.type === 'attack' || entry.type === 'CONTEXT_REQUIRED') && detail.command)
      steps.push({ type: 'attack', command: detail.command, rolls: detail.rolls ?? [] });
    if (
      entry.type === 'combat-start' ||
      (entry.type === 'TURN_CONTEXT_REQUIRED' && detail.kind === 'start')
    )
      steps.push({ type: 'start-combat', rolls: detail.rolls ?? [] });
    else if (entry.type === 'next-turn' || entry.type === 'TURN_CONTEXT_REQUIRED')
      steps.push({ type: 'next-turn', rolls: detail.rolls ?? [] });
    if (entry.type === 'move')
      steps.push({ type: 'move', command: (entry.detail as { command: MoveCommand }).command });
    if (entry.type === 'placement')
      steps.push({
        type: 'placement',
        actor: detail.actor,
        x: detail.after!.x,
        y: detail.after!.y,
      });
    if (entry.type === 'manual-turn') steps.push({ type: 'manual-turn', actor: detail.actor });
    if (entry.type === 'cancel-unstarted') steps.push({ type: 'cancel-unstarted' });
  }
  return structuredClone({
    format: FORMAT,
    baseline: 'e98837b92abc74ac501b52c5f2ea2e79b86f96b3',
    rulings,
    steps,
    log: b.log,
  });
}
export function importReplay(value: unknown): Battle {
  const r = value as Replay;
  if (
    !r ||
    r.format !== FORMAT ||
    r.baseline !== 'e98837b92abc74ac501b52c5f2ea2e79b86f96b3' ||
    !Array.isArray(r.steps) ||
    r.steps.length > 1000
  )
    throw new Error('Неподдерживаемый формат replay');
  for (const key of Object.keys(rulings) as (keyof typeof rulings)[])
    if (r.rulings?.[key] !== rulings[key])
      throw new Error('Решения автора в replay отличаются от текущих; автоматической миграции нет');
  const b = createBattle();
  const dice = (rolls: DiceRoll[]) => {
    if (!Array.isArray(rolls) || rolls.length > 1000)
      throw new Error('Неверная последовательность');
    return fixedDice(rolls.map((d) => `${d.sides}:${d.value}`).join(','));
  };
  for (const step of r.steps) {
    if (step.type === 'placement') move(b, step.actor, step.x, step.y);
    else if (step.type === 'manual-turn') selectManualOrder(b, step.actor);
    else if (step.type === 'cancel-unstarted') cancelUnstarted(b);
    else if (step.type === 'move') moveActor(b, step.command);
    else if (step.type === 'start-combat')
      startCombat(b, dice(step.rolls.slice(getEngine(b).pendingTurn?.prefix.length ?? 0)));
    else if (step.type === 'attack') {
      const pending = getEngine(b).pending;
      if (pending) {
        if (pending.command.id !== step.command.id) throw new Error('Pending command ID differs');
        if (
          JSON.stringify(step.rolls.slice(0, pending.prefix.length)) !==
          JSON.stringify(pending.prefix)
        )
          throw new Error('Saved dice prefix differs');
        attack(b, step.command, dice(step.rolls.slice(pending.prefix.length)), true);
      } else attack(b, step.command, dice(step.rolls));
    } else if (step.type === 'next-turn')
      nextTurn(b, dice(step.rolls.slice(getEngine(b).pendingTurn?.prefix.length ?? 0)));
    else throw new Error('Неизвестная команда replay');
  }
  return b;
}
/** A fully specified local scenario; no claim of canonical battlefield placement. */
export function demoBattle(pakHits = true): Battle {
  const b = createBattle();
  // Explicit setup before either combat action, not free movement during a turn.
  move(b, 'pak', 5.75, 10);
  attack(
    b,
    {
      id: 'demo-kelus',
      actor: 'kelus-drakar',
      target: 'pak',
      weapon: 'hotshot',
      targetActivity: 'REST',
      defense: 'DECLINE',
    },
    fixedDice('100:65,10:2,100:20'),
  );
  nextTurn(b, fixedDice(''));
  const reroll = rulings.chainTiming === 'before' ? 4 : 5;
  attack(
    b,
    {
      id: 'demo-pak',
      actor: 'pak',
      target: 'kelus-drakar',
      weapon: 'pak-chain',
      targetActivity: 'REST',
      defense: 'DECLINE',
    },
    fixedDice(pakHits ? `100:25,10:3,10:${reroll},100:20` : '100:90'),
  );
  return b;
}
export function resolvedDemoBattle(): Battle {
  return demoBattle(false);
}
