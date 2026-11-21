import type { DiceRoll } from '@kadat/contracts';
import {
  applyMap,
  attack,
  cancelUnstarted,
  getEngine,
  moveActor,
  nextTurn,
  placeActor,
  setDoorOpen,
  setFootprint,
  standUp,
  selectManualOrder,
  startCombat,
  type AttackCommand,
  type BackgroundSummary,
  type MoveCommand,
} from './engine';
import { fixedDice } from './dice';
import { append, createBattle, move, type ActorId, type Battle } from './model';
import { rulings } from './rulings';
import type { Footprint, Point } from './grid';
import type { MapDocument } from './map';
import { loadSnapshot, type SnapshotStore } from './snapshots';
type Step =
  | { type: 'attack'; command: AttackCommand; rolls: DiceRoll[] }
  | { type: 'next-turn'; rolls: DiceRoll[] }
  | { type: 'placement'; actor: ActorId; x: number; y: number }
  | { type: 'manual-turn'; actor: ActorId }
  | { type: 'cancel-unstarted' }
  | { type: 'start-combat'; rolls: DiceRoll[] }
  | { type: 'move'; command: MoveCommand }
  | { type: 'stand'; command: { id: string; actor: ActorId } }
  | { type: 'footprint'; actor: ActorId; footprint: Footprint }
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
  | { type: 'door'; doorId: string; open: boolean }
  // A refused command: it changed nothing, but the journal keeps it.
  | { type: 'journal'; entry: { type: JournalOnly; detail: unknown } };

/** Journal entries of refused commands: no game effect, replayed into the journal only. */
const JOURNAL_ONLY = ['move-rejected', 'posture-rejected', 'rejected'] as const;
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
export const REPLAY_FORMAT = 'kadat-client-combat-v0.5';
const INLINE_SNAPSHOT_FORMAT = 'kadat-client-combat-v0.4';
const LEGACY_FORMAT = 'kadat-client-combat-v0.3';
/** One size limit for replays, used both when saving and when opening (UTF-8 bytes). */
export const REPLAY_MAX_BYTES = 16 * 1024 * 1024;
const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;
/** Geometry rules version: straight swept path, exact touching rules. */
export const GEOMETRY_VERSION = 1;
const BASELINE = 'e98837b92abc74ac501b52c5f2ea2e79b86f96b3';

export interface Replay {
  format: typeof REPLAY_FORMAT | typeof INLINE_SNAPSHOT_FORMAT | typeof LEGACY_FORMAT;
  /** v0.5: every applied map's geometry, each layer stored once. */
  snapshots?: SnapshotStore;
  geometryVersion?: number;
  /** Present when applied maps had a background raster, which a replay does not carry. */
  visualLayersOmitted?: true;
  /** v0.4: state after the last step, checked on import. */
  outcome?: ReturnType<typeof outcomeOf>;
  baseline: string;
  rulings: typeof rulings;
  steps: Step[];
  log: Battle['log'];
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
      const d = entry.detail as { doorId: string; open: boolean };
      steps.push({ type: 'door', doorId: d.doorId, open: d.open });
    }
  }
  return structuredClone({
    format: REPLAY_FORMAT,
    geometryVersion: GEOMETRY_VERSION,
    ...(backgroundOmitted ? { visualLayersOmitted: true as const } : {}),
    outcome: outcomeOf(b),
    snapshots: b.snapshots,
    baseline: BASELINE,
    rulings,
    steps,
    log: b.log,
  });
}
export function importReplay(value: unknown): Battle {
  const r = value as Replay;
  if (
    !r ||
    (r.format !== REPLAY_FORMAT &&
      r.format !== INLINE_SNAPSHOT_FORMAT &&
      r.format !== LEGACY_FORMAT) ||
    r.baseline !== BASELINE ||
    !Array.isArray(r.steps) ||
    r.steps.length > 1000
  )
    throw new Error('Неподдерживаемый формат replay');
  if (r.format !== LEGACY_FORMAT && r.geometryVersion !== GEOMETRY_VERSION)
    throw new Error(
      `Версия правил геометрии в replay (${String(r.geometryVersion)}) не поддерживается; история не заменяется`,
    );
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
    if (r.format === LEGACY_FORMAT && (step.type === 'map' || step.type === 'door'))
      throw new Error('Replay v0.3 не может содержать команды карты');
    if (step.type === 'placement') placeActor(b, step.actor, step.x, step.y);
    else if (step.type === 'manual-turn') selectManualOrder(b, step.actor);
    else if (step.type === 'cancel-unstarted') cancelUnstarted(b);
    else if (step.type === 'move') moveActor(b, step.command);
    else if (step.type === 'stand') standUp(b, step.command);
    else if (step.type === 'footprint') setFootprint(b, step.actor, step.footprint);
    else if (step.type === 'map') {
      if (r.format === REPLAY_FORMAT && typeof step.snapshot !== 'string')
        throw new Error('Шаг карты replay без ссылки на снимок');
      const map =
        r.format === REPLAY_FORMAT
          ? loadSnapshot(r.snapshots!, step.snapshot!)
          : 'map' in step
            ? step.map
            : loadSnapshot(r.snapshots!, step.snapshot);
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
    } else if (step.type === 'door') setDoorOpen(b, step.doorId, step.open);
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
/** A fully specified local scenario; no claim of canonical battlefield placement. */
export function demoBattle(pakHits = true): Battle {
  const b = createBattle();
  // Explicit setup before either combat action, not free movement during a turn.
  move(b, 'pak', 6.5, 10.5);
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
