import { describe, expect, it } from 'vitest';
import { emptyMap, type MapDocument } from './map';
import { fitBackground } from './map-editor';
import { createBattle, type Battle } from './model';
import {
  applyMap,
  attack,
  moveActor,
  nextTurn,
  placeActor,
  setDoorOpen,
  setFootprint,
  startCombat,
} from './engine';
import { exportReplay, importReplay } from './replay';
import { fixedDice } from './dice';

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function map(): MapDocument {
  const base = emptyMap('consistency', 'Склад', 24, 16);
  return {
    ...base,
    background: fitBackground(base, { mime: 'image/png', data: PNG_1X1, widthPx: 1, heightPx: 1 }),
    floor: { '1:1': 'sand' },
    walls: [
      {
        id: 'w',
        points: [
          { x: 10, y: 0 },
          { x: 10, y: 16 },
        ],
      },
    ],
    doors: [
      {
        id: 'd',
        wallId: 'w',
        from: { x: 10, y: 7 },
        to: { x: 10, y: 8 },
        open: false,
        blocksMovement: true,
        blocksVision: true,
        locked: false,
        lockModifier: 0,
        lockOd: 0,
      },
    ],
    obstacles: [
      {
        id: 'o',
        col: 4,
        row: 3,
        width: 2,
        height: 1,
        label: 'Ящики',
        blocksMovement: true,
        blocksVision: false,
        notes: '',
      },
    ],
  };
}
/** A history with every kind of step: maps, doors, footprint, refused and accepted moves,
 * an attack, a turn change. */
function history(): Battle {
  const b = createBattle();
  applyMap(b, {
    map: map(),
    positions: { 'kelus-drakar': { x: 8.5, y: 7.5 }, pak: { x: 13.5, y: 7.5 } },
  });
  setDoorOpen(b, 'd', true);
  setFootprint(b, 'pak', { width: 2, height: 2 });
  placeActor(b, 'pak', 15, 8);
  startCombat(b, fixedDice('10:9,10:2'));
  expect(() =>
    moveActor(b, { id: 'bad', actor: 'kelus-drakar', mode: 'half-move', to: { x: 4.5, y: 3.5 } }),
  ).toThrow();
  moveActor(b, {
    id: 'ok',
    actor: 'kelus-drakar',
    mode: 'half-move',
    to: { x: 10.5, y: 7.5 },
    sceneRevision: b.sceneRevision,
  });
  attack(
    b,
    {
      id: 'shot',
      actor: 'kelus-drakar',
      target: 'pak',
      weapon: 'kelus-drakar:0',
      targetActivity: 'REST',
      defense: 'DECLINE',
    },
    fixedDice('100:45,10:2,100:20'),
  );
  nextTurn(b, fixedDice(''));
  return b;
}
const roundTrip = <T>(v: T): T => JSON.parse(JSON.stringify(v));
/** Loosely typed view of exported steps for tampering tests. */
type LooseStep = {
  type: string;
  rolls?: { sides: number; value: number }[];
  command?: { sceneRevision?: number };
  entry?: unknown;
};
const looseSteps = (replay: { steps: unknown[] }) => replay.steps as LooseStep[];

describe('Replay export and import are consistent', () => {
  it('export → import → export gives the same steps, marks, outcome and journal', () => {
    const original = history();
    const first = exportReplay(original);
    const replayed = importReplay(roundTrip(first));
    const second = exportReplay(replayed);
    expect(second.steps).toEqual(first.steps);
    expect(second.visualLayersOmitted).toBe(true);
    expect(first.visualLayersOmitted).toBe(true);
    expect(second.outcome).toEqual(first.outcome);
    expect(roundTrip(replayed.log)).toEqual(roundTrip(original.log));
  });

  it('the journal keeps refused commands with the same entry numbers', () => {
    const original = history();
    const replayed = importReplay(roundTrip(exportReplay(original)));
    const refused = replayed.log.find((e) => e.type === 'move-rejected');
    expect(refused?.id).toBe(original.log.find((e) => e.type === 'move-rejected')?.id);
    expect(refused?.detail).toMatchObject({ committed: false });
  });

  it('the background summary survives although the bytes are not carried', () => {
    const replayed = importReplay(roundTrip(exportReplay(history())));
    expect(replayed.map.background).toBeNull();
    const applied = replayed.log.find((e) => e.type === 'map-applied')!.detail;
    expect(applied).toMatchObject({
      backgroundOmitted: true,
      background: { mime: 'image/png', widthPx: 1, heightPx: 1 },
    });
  });

  it('a tampered step that changes the result is refused', () => {
    const replay = roundTrip(exportReplay(history()));
    const shot = looseSteps(replay).find((s) => s.type === 'attack')!;
    shot.rolls![0]!.value = 99; // the hit becomes a miss
    expect(() => importReplay(replay)).toThrow(/не согласован/);
  });

  it('a tampered outcome is refused', () => {
    const replay = roundTrip(exportReplay(history()));
    replay.outcome!.hp.pak = 1;
    expect(() => importReplay(replay)).toThrow(/не согласован/);
  });

  it('a journal step pretending to be a game command is refused', () => {
    const replay = roundTrip(exportReplay(history()));
    looseSteps(replay).push({
      type: 'journal',
      entry: { type: 'move', detail: { committed: true } },
    });
    expect(() => importReplay(replay)).toThrow(/Шаг журнала replay повреждён/);
  });

  it('a stale preview revision recorded in a move cannot be replayed on another scene', () => {
    const replay = roundTrip(exportReplay(history()));
    const move = looseSteps(replay).find((s) => s.type === 'move')!;
    move.command!.sceneRevision = 0;
    expect(() => importReplay(replay)).toThrow(/Сцена изменилась/);
  });
});
