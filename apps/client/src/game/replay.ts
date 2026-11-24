import type { DiceRoll } from '@kadat/contracts';
import {
  applyMap,
  attack,
  cancelUnstarted,
  getEngine,
  moveActor,
  placeFallen,
  disarm,
  placeLoose,
  takeDisarmed,
  nextTurn,
  placeActor,
  setDoorOpen,
  setDoorLocked,
  setFootprint,
  standUp,
  braceWeapon,
  turnAction,
  takeWeapon,
  dropWeapon,
  pickUpWeapon,
  type TurnActionCommand,
  addCombatant,
  removeCombatant,
  setSide,
  setMovementOption,
  startCombat,
  type AttackCommand,
  type BackgroundSummary,
  type MoveCommand,
} from './engine';
import { fixedDice } from './dice';
import { append, createBattle, type ActorId, type Battle, type Side } from './model';
import type { CharacterDocument } from './character';
import { rulings } from './rulings';
import type { Footprint, Point } from './grid';
import type { MapDocument } from './map';
import { loadSnapshot, type SnapshotStore } from './snapshots';
type Step =
  | { type: 'attack'; command: AttackCommand; rolls: DiceRoll[] }
  | { type: 'next-turn'; rolls: DiceRoll[] }
  | { type: 'placement'; actor: ActorId; x: number; y: number }
  | { type: 'roster-add'; character: CharacterDocument; side: Side; at: Point }
  | { type: 'roster-remove'; actor: ActorId }
  | { type: 'skr'; actor: ActorId; option: number }
  | { type: 'roster-side'; actor: ActorId; side: Side }
  | { type: 'cancel-unstarted' }
  | { type: 'start-combat'; rolls: DiceRoll[] }
  | { type: 'move'; command: MoveCommand; rolls?: DiceRoll[] }
  | { type: 'fall'; actor: ActorId; x: number; y: number }
  | { type: 'stand'; command: { id: string; actor: ActorId } }
  | { type: 'brace'; command: { id: string; actor: ActorId; weapon: string } }
  | { type: 'turn-action'; command: TurnActionCommand; rolls: DiceRoll[] }
  | {
      type: 'take-weapon' | 'drop-weapon' | 'pick-up-weapon';
      command: { id: string; actor: ActorId; weapon: string; keep?: string };
    }
  | { type: 'footprint'; actor: ActorId; footprint: Footprint }
  | {
      type: 'disarm';
      command: { id: string; actor: ActorId; target: ActorId; weapon: string };
      rolls: DiceRoll[];
    }
  | { type: 'loose'; x: number; y: number }
  | { type: 'take-disarmed' }
  // v0.4: geometry-sensitive commands.
  // v0.5: the map geometry is a reference into the replay's shared snapshot store.
  | {
      type: 'map';
      snapshot: string;
      positions: Record<ActorId, Point>;
      omittedBackground: BackgroundSummary | null;
    }
  // v0.4: the full snapshot inline in every map step (still readable).
  | {
      type: 'map';
      map: MapDocument;
      snapshot?: undefined;
      positions: Record<ActorId, Point>;
      omittedBackground?: BackgroundSummary | null;
    }
  | { type: 'door'; doorId: string; open: boolean; by?: ActorId | null }
  | { type: 'door-lock'; doorId: string; locked: boolean }
  // A refused command: it changed nothing, but the journal keeps it.
  | { type: 'journal'; entry: { type: JournalOnly; detail: unknown } };

/** Journal entries of refused commands: no game effect, replayed into the journal only. */
const JOURNAL_ONLY = [
  'move-rejected',
  'posture-rejected',
  'rejected',
  // Rejected weapon and turn actions change nothing; they stay in the journal only.
  'take-weapon-rejected',
  'drop-weapon-rejected',
  'pick-up-weapon-rejected',
  'turn-action-rejected',
  'brace-rejected',
  'disarm-rejected',
] as const;
type JournalOnly = (typeof JOURNAL_ONLY)[number];
const isJournalOnly = (type: string): type is JournalOnly =>
  (JOURNAL_ONLY as readonly string[]).includes(type);

/** Final state recorded at export; an import must arrive at exactly the same state. */
function outcomeOf(b: Battle) {
  return structuredClone({
    positions: b.positions,
    footprints: b.footprints,
    hp: b.hp,
    ammo: b.ammo,
    doors: b.doors,
    mapRevision: b.mapRevision,
    sceneRevision: b.sceneRevision,
    active: b.active,
    logLength: b.log.length,
  });
}

/**
 * v0.4 stores every applied map as a geometry snapshot (background bytes left out: they take
 * no part in any calculation) plus door changes, so a replay never depends on current map
 * files. v0.3 replays (standard 20 × 20 scene, no map commands) still import.
 */
export const REPLAY_FORMAT = 'kadat-client-combat-v0.6';
/** Step 4: earlier replays recorded the fixed Келус/Пак adapter and cannot be repeated. */
/** One size limit for replays, used both when saving and when opening (UTF-8 bytes). */
export const REPLAY_MAX_BYTES = 16 * 1024 * 1024;
const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;
/** Geometry rules version. 2: clicked routes, corner touch allowed, difficult terrain costs double. */
export const GEOMETRY_VERSION = 2;
const BASELINE = 'e98837b92abc74ac501b52c5f2ea2e79b86f96b3';

export interface Replay {
  format: typeof REPLAY_FORMAT;
  /** v0.5: every applied map's geometry, each layer stored once. */
  snapshots?: SnapshotStore;
  geometryVersion?: number;
  /** Present when applied maps had a background raster, which a replay does not carry. */
  visualLayersOmitted?: true;
  /** v0.4: state after the last step, checked on import. */
  outcome?: ReturnType<typeof outcomeOf>;
  baseline: string;
  /** v0.6: participants at the start (characters as they were). */
  participants?: InitialParticipant[];
  rulings: typeof rulings;
  steps: Step[];
  log: Battle['log'];
}

export interface InitialParticipant {
  id: ActorId;
  character: CharacterDocument;
  side: Side;
  at: Point;
}
export function exportReplay(b: Battle): Replay {
  const steps: Step[] = [];
  let backgroundOmitted = false;
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
    if (entry.type === 'footprint') {
      const f = entry.detail as { actor: ActorId; footprint: Footprint };
      steps.push({ type: 'footprint', actor: f.actor, footprint: f.footprint });
    }
    if (entry.type === 'posture')
      steps.push({
        type: 'stand',
        command: (entry.detail as { command: { id: string; actor: ActorId } }).command,
      });
    if (entry.type === 'move') {
      const m = entry.detail as { command: MoveCommand; rolls?: DiceRoll[] };
      steps.push({ type: 'move', command: m.command, rolls: m.rolls ?? [] });
    }
    if (entry.type === 'fall-placed') {
      const f = entry.detail as { actor: ActorId; after: Point };
      steps.push({ type: 'fall', actor: f.actor, x: f.after.x, y: f.after.y });
    }
    if (entry.type === 'placement')
      steps.push({
        type: 'placement',
        actor: detail.actor,
        x: detail.after!.x,
        y: detail.after!.y,
      });
    if (entry.type === 'roster-add') {
      const r = entry.detail as { character: CharacterDocument; side: Side; at: Point };
      steps.push({ type: 'roster-add', character: r.character, side: r.side, at: r.at });
    }
    if (
      entry.type === 'take-weapon' ||
      entry.type === 'drop-weapon' ||
      entry.type === 'pick-up-weapon'
    ) {
      const r = entry.detail as { command: { id: string; actor: ActorId; weapon: string } };
      steps.push({ type: entry.type, command: r.command });
    }
    if (entry.type === 'turn-action') {
      const r = entry.detail as { command: TurnActionCommand; rolls?: DiceRoll[] };
      steps.push({ type: 'turn-action', command: r.command, rolls: r.rolls ?? [] });
    }
    if (entry.type === 'disarm') {
      const r = entry.detail as {
        command: { id: string; actor: ActorId; target: ActorId; weapon: string };
        rolls?: DiceRoll[];
      };
      steps.push({ type: 'disarm', command: r.command, rolls: r.rolls ?? [] });
    }
    if (entry.type === 'weapon-taken') steps.push({ type: 'take-disarmed' });
    if (entry.type === 'weapon-landed') {
      const r = entry.detail as { at: Point };
      steps.push({ type: 'loose', x: r.at.x, y: r.at.y });
    }
    if (entry.type === 'brace') {
      const r = entry.detail as { command: { id: string; actor: ActorId; weapon: string } };
      steps.push({ type: 'brace', command: r.command });
    }
    if (entry.type === 'skr') {
      const r = entry.detail as { actor: ActorId; option: number };
      steps.push({ type: 'skr', actor: r.actor, option: r.option });
    }
    if (entry.type === 'roster-remove') steps.push({ type: 'roster-remove', actor: detail.actor });
    if (entry.type === 'roster-side') {
      const r = entry.detail as { actor: ActorId; side: Side };
      steps.push({ type: 'roster-side', actor: r.actor, side: r.side });
    }
    if (entry.type === 'cancel-unstarted') steps.push({ type: 'cancel-unstarted' });
    if (entry.type === 'map-applied') {
      const m = entry.detail as {
        snapshot: string;
        positions: Record<ActorId, Point>;
        backgroundOmitted: boolean;
        background: BackgroundSummary | null;
      };
      steps.push({
        type: 'map',
        snapshot: m.snapshot,
        positions: m.positions,
        omittedBackground: m.backgroundOmitted ? m.background : null,
      });
      backgroundOmitted ||= m.backgroundOmitted;
    }
    if (isJournalOnly(entry.type))
      steps.push({ type: 'journal', entry: { type: entry.type, detail } });
    if (entry.type === 'door') {
      const d = entry.detail as { doorId: string; open: boolean; by?: ActorId | null };
      steps.push({ type: 'door', doorId: d.doorId, open: d.open, by: d.by ?? null });
    }
    if (entry.type === 'door-lock') {
      const d = entry.detail as { doorId: string; locked: boolean };
      steps.push({ type: 'door-lock', doorId: d.doorId, locked: d.locked });
    }
  }
  return structuredClone({
    format: REPLAY_FORMAT,
    geometryVersion: GEOMETRY_VERSION,
    ...(backgroundOmitted ? { visualLayersOmitted: true as const } : {}),
    outcome: outcomeOf(b),
    snapshots: b.snapshots,
    baseline: BASELINE,
    participants: (b.log[0]?.detail as { participants?: InitialParticipant[] }).participants ?? [],
    rulings,
    steps,
    log: b.log,
  });
}
export function importReplay(value: unknown): Battle {
  const r = value as Replay;
  if (
    !r ||
    r.format !== REPLAY_FORMAT ||
    !Array.isArray(r.participants) ||
    r.baseline !== BASELINE ||
    !Array.isArray(r.steps) ||
    r.steps.length > 1000
  )
    throw new Error('Неподдерживаемый формат replay');
  if (r.geometryVersion !== GEOMETRY_VERSION)
    throw new Error(
      `Версия правил геометрии в replay (${String(r.geometryVersion)}) не поддерживается; история не заменяется`,
    );
  for (const key of Object.keys(rulings) as (keyof typeof rulings)[])
    if (r.rulings?.[key] !== rulings[key])
      throw new Error('Решения автора в replay отличаются от текущих; автоматической миграции нет');
  const b = createBattle(r.participants);
  const dice = (rolls: DiceRoll[]) => {
    if (!Array.isArray(rolls) || rolls.length > 1000)
      throw new Error('Неверная последовательность');
    return fixedDice(rolls.map((d) => `${d.sides}:${d.value}`).join(','));
  };
  for (const step of r.steps) {
    if (step.type === 'placement') placeActor(b, step.actor, step.x, step.y);
    else if (step.type === 'roster-add') addCombatant(b, step.character, step.side, step.at);
    else if (step.type === 'roster-remove') removeCombatant(b, step.actor);
    else if (step.type === 'skr') setMovementOption(b, step.actor, step.option);
    else if (step.type === 'roster-side') setSide(b, step.actor, step.side);
    else if (step.type === 'cancel-unstarted') cancelUnstarted(b);
    else if (step.type === 'move') moveActor(b, step.command, dice(step.rolls ?? []));
    else if (step.type === 'fall') placeFallen(b, step.actor, { x: step.x, y: step.y });
    else if (step.type === 'stand') standUp(b, step.command);
    else if (step.type === 'brace') braceWeapon(b, step.command);
    else if (step.type === 'take-weapon') takeWeapon(b, step.command);
    else if (step.type === 'drop-weapon') dropWeapon(b, step.command);
    else if (step.type === 'pick-up-weapon') pickUpWeapon(b, step.command);
    else if (step.type === 'turn-action') turnAction(b, step.command, dice(step.rolls));
    else if (step.type === 'footprint') setFootprint(b, step.actor, step.footprint);
    else if (step.type === 'disarm') disarm(b, step.command, dice(step.rolls));
    else if (step.type === 'loose') placeLoose(b, { x: step.x, y: step.y });
    else if (step.type === 'take-disarmed') takeDisarmed(b);
    else if (step.type === 'map') {
      if (r.format === REPLAY_FORMAT && typeof step.snapshot !== 'string')
        throw new Error('Шаг карты replay без ссылки на снимок');
      const map = loadSnapshot(r.snapshots!, step.snapshot!);
      applyMap(
        b,
        { map, positions: step.positions },
        { omittedBackground: step.omittedBackground ?? null },
      );
      const stored = (b.log.at(-1)!.detail as { snapshot: string }).snapshot;
      if (r.format === REPLAY_FORMAT && stored !== step.snapshot)
        throw new Error('Replay не согласован: снимки карты расходятся с порядком применения');
    } else if (step.type === 'journal') {
      const detail = step.entry?.detail as { committed?: unknown } | undefined;
      if (!isJournalOnly(step.entry?.type) || detail?.committed !== false)
        throw new Error('Шаг журнала replay повреждён');
      append(b, step.entry.type, step.entry.detail);
    } else if (step.type === 'door') setDoorOpen(b, step.doorId, step.open, step.by ?? undefined);
    else if (step.type === 'door-lock') setDoorLocked(b, step.doorId, step.locked);
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
  if (r.outcome && JSON.stringify(outcomeOf(b)) !== JSON.stringify(r.outcome))
    throw new Error(
      'Replay не согласован: повтор команд привёл к другому состоянию, чем при экспорте. История не заменена.',
    );
  return b;
}
/** Saves a replay as JSON text, refusing one larger than the shared limit. */
export function serializeReplay(b: Battle): string {
  const text = JSON.stringify(exportReplay(b), null, 2);
  const bytes = utf8Bytes(text);
  if (bytes > REPLAY_MAX_BYTES)
    throw new Error(
      `Replay занимает ${(bytes / 1024 / 1024).toFixed(1)} МиБ — больше предела ${REPLAY_MAX_BYTES / 1024 / 1024} МиБ; сохранение отклонено`,
    );
  return text;
}
/** Opens replay JSON text with the same size limit as saving. */
export function parseReplayText(text: string): Battle {
  if (utf8Bytes(text) > REPLAY_MAX_BYTES)
    throw new Error(`Replay больше предела ${REPLAY_MAX_BYTES / 1024 / 1024} МиБ`);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Файл replay не является JSON — возможно, он повреждён');
  }
  return importReplay(value);
}
