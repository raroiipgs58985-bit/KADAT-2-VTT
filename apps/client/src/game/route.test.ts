// Step 2: clicked routes, difficult terrain and falls (author rulings 7, 8, 9, 11, 42, 43).
import { describe, expect, it } from 'vitest';
import { emptyMap, type MapDocument } from './map';
import { createBattle, planRoute, type Battle } from './model';
import {
  applyMap,
  getEngine,
  movementOptions,
  moveActor,
  placeFallen,
  startCombat,
  turnInfo,
} from './engine';
import { exportReplay, importReplay } from './replay';
import { fixedDice } from './dice';
import { stage3StandMap } from './scenarios';

function scene(map: MapDocument, kelus: { x: number; y: number }, pak = { x: 17.5, y: 17.5 }) {
  const b = createBattle();
  applyMap(b, { map, positions: { 'kelus-drakar': kelus, pak } });
  startCombat(b, fixedDice(''));
  if (turnInfo(b).active !== 'kelus-drakar') throw new Error('Kelus must act first');
  return b;
}
const crates: MapDocument = {
  ...emptyMap('c', 'Ящики', 20, 20),
  obstacles: [
    {
      id: 'crates',
      col: 8,
      row: 8,
      width: 1,
      height: 5,
      label: 'Ящики',
      blocksMovement: true,
      blocksVision: false,
      notes: '',
    },
  ],
};
let n = 0;
const route = (b: Battle, mode: 'half-move' | 'full-move' | 'run', points: [number, number][]) => {
  const pts = points.map(([x, y]) => ({ x, y }));
  return moveActor(
    b,
    {
      id: `r${++n}`,
      actor: 'kelus-drakar',
      mode,
      to: pts.at(-1)!,
      route: pts,
    },
    fixedDice(''),
  );
};

describe('Clicked route — ruling 8', () => {
  it('goes around crates the straight line cannot cross; length is the sum of legs', () => {
    const b = scene(crates, { x: 6.5, y: 10.5 });
    expect(planRoute(b, 'kelus-drakar', [{ x: 9.5, y: 12.5 }]).problem?.kind).toBe('blocked');
    const r = route(b, 'full-move', [
      [7.5, 13.5],
      [9.5, 13.5],
      [9.5, 12.5],
    ]);
    expect(r.status).toBe('RESOLVED');
    expect(r.distance).toBeCloseTo(Math.sqrt(10) + 2 + 1, 6);
    expect(b.positions['kelus-drakar']).toEqual({ x: 9.5, y: 12.5 });
    expect(turnInfo(b).od).toBe(0);
  });

  it('a route longer than the budget is refused without spending OD', () => {
    const b = scene(crates, { x: 6.5, y: 10.5 });
    expect(() =>
      route(b, 'half-move', [
        [7.5, 13.5],
        [9.5, 13.5],
        [9.5, 12.5],
      ]),
    ).toThrow(/Маршрут 6.16 м больше допустимой 4 м/);
    expect(turnInfo(b).od).toBe(2);
  });

  it('cannot pass through another token, but can walk around it (ruling 9)', () => {
    const b = scene(emptyMap('e', 'Поле', 20, 20), { x: 5.5, y: 10.5 }, { x: 7.5, y: 10.5 });
    expect(() => route(b, 'full-move', [[9.5, 10.5]])).toThrow(/сквозь клетку другого персонажа/);
    expect(
      route(b, 'full-move', [
        [6.5, 11.5],
        [8.5, 11.5],
        [9.5, 10.5],
      ]).status,
    ).toBe('RESOLVED');
  });
});

describe('Running across difficult terrain — rulings 11, 42, 43', () => {
  const withRubble: MapDocument = {
    ...stage3StandMap(),
    zones: [
      ...stage3StandMap().zones,
      { id: 'rubble', col: 5, row: 12, width: 1, height: 2, label: 'Обломки', modifier: -20 },
    ],
  };
  const run = (b: Battle, dice: string) =>
    moveActor(
      b,
      { id: `run${++n}`, actor: 'kelus-drakar', mode: 'run', to: { x: 3.5, y: 18.5 } },
      fixedDice(dice),
    );

  it('one ЛВ test per stretch, in route order, with each terrain modifier', () => {
    const b = scene(withRubble, { x: 6.5, y: 10.5 });
    expect(run(b, '100:20,100:20').status).toBe('RESOLVED');
    const tests = (b.log.at(-1)!.detail as { terrainTests: { zone: string; modifier: number }[] })
      .terrainTests;
    expect(tests.map((t) => [t.zone, t.modifier])).toEqual([
      ['rubble', -20],
      ['mud', 0],
    ]);
    expect(b.positions['kelus-drakar']).toEqual({ x: 3.5, y: 18.5 });
  });

  it('a failed test ends the move: OD spent, the GM places the fallen character, who is prone', () => {
    const b = scene(withRubble, { x: 6.5, y: 10.5 });
    const r = run(b, '100:90');
    expect(r).toMatchObject({ status: 'FELL', zone: 'Обломки' });
    expect(b.positions['kelus-drakar']).toEqual({ x: 6.5, y: 10.5 });
    expect(turnInfo(b).od).toBe(0);
    expect(() => route(b, 'half-move', [[6.5, 9.5]])).toThrow(/где упал персонаж/);
    placeFallen(b, 'kelus-drakar', { x: 5.5, y: 12.5 });
    expect(b.positions['kelus-drakar']).toEqual({ x: 5.5, y: 12.5 });
    expect(getEngine(b).wounds.combat.actors['kelus-drakar']!.posture).toBe('prone');
    expect(getEngine(b).pendingFall).toBeUndefined();
    // Prone now: crawling at СКР / 2 (ruling 15) once OD are back next turn.
    expect(movementOptions(b, 'kelus-drakar').find((o) => o.mode === 'run')?.available).toBe(false);
  });

  it('walking (not running) across terrain needs no test, only double cost', () => {
    const b = scene(withRubble, { x: 6.5, y: 13.5 });
    const r = moveActor(b, {
      id: 'walk',
      actor: 'kelus-drakar',
      mode: 'full-move',
      to: { x: 3.5, y: 13.5 },
    });
    expect(r.status).toBe('RESOLVED');
    expect(b.log.at(-1)).toMatchObject({ detail: { terrainTests: [], difficult: 1, cost: 4 } });
  });

  it('replay reproduces the tests, the fall and the placement', () => {
    const b = scene(withRubble, { x: 6.5, y: 10.5 });
    run(b, '100:20,100:95');
    placeFallen(b, 'kelus-drakar', { x: 3.5, y: 16.5 });
    const replayed = importReplay(JSON.parse(JSON.stringify(exportReplay(b))));
    expect(replayed.positions).toEqual(b.positions);
    expect(getEngine(replayed).wounds.combat.actors['kelus-drakar']!.posture).toBe('prone');
  });
});
