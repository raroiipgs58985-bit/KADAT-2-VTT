import { applyMap } from './engine';
import { emptyMap, type Door, type FloorColorId, type MapDocument, type Vertex } from './map';
import { createBattle, type Battle } from './model';

/**
 * Ready-made test stands for checking a stage without drawing anything. They only prepare
 * the scene (map, tokens) through the regular commands; no rule is changed.
 */
export function stage3StandMap(): MapDocument {
  return {
    ...emptyMap('stand-stage-3', 'Стенд этапа 3: комната с дверью', 20, 20),
    floor: Object.fromEntries(
      Array.from({ length: 7 }, (_, dy) =>
        Array.from({ length: 5 }, (_, dx) => [`${9 + dx}:${7 + dy}`, 'grey' as const]),
      ).flat(),
    ),
    walls: [
      {
        id: 'room',
        points: [
          { x: 8, y: 6 },
          { x: 14, y: 6 },
          { x: 14, y: 14 },
          { x: 8, y: 14 },
          { x: 8, y: 6 },
        ],
      },
    ],
    doors: [
      {
        id: 'west-door',
        wallId: 'room',
        from: { x: 8, y: 10 },
        to: { x: 8, y: 11 },
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
        id: 'crates',
        col: 11,
        row: 8,
        width: 1,
        height: 3,
        label: 'Ящики',
        blocksMovement: true,
        blocksVision: false,
        notes: 'Низкие: мешают пройти, но не закрывают обзор',
      },
    ],
    zones: [{ id: 'mud', col: 2, row: 15, width: 4, height: 3, label: 'Грязь', modifier: 0 }],
  };
}

/** Kelus west of the closed door, Pak in the east; setup phase, nothing rolled yet. */
export function stage3Stand(): Battle {
  const b = createBattle();
  applyMap(b, {
    map: stage3StandMap(),
    positions: { 'kelus-drakar': { x: 6.5, y: 10.5 }, pak: { x: 16.5, y: 10.5 } },
  });
  return b;
}

const paint = (
  floor: Record<string, FloorColorId>,
  colour: FloorColorId,
  col: number,
  row: number,
  width: number,
  height: number,
) => {
  for (let dy = 0; dy < height; dy++)
    for (let dx = 0; dx < width; dx++) floor[`${col + dx}:${row + dy}`] = colour;
};
const door = (
  id: string,
  wallId: string,
  from: Vertex,
  to: Vertex,
  open: boolean,
  window?: { coverOb: number },
): Door => ({
  id,
  wallId,
  from,
  to,
  open,
  blocksMovement: true,
  blocksVision: !window,
  locked: false,
  lockModifier: 0,
  lockOd: 0,
  ...(window ? { coverOb: window.coverOb, coverHeight: 'medium' as const } : {}),
});

/**
 * Demo location for hands-on testing: rooms, a corridor, doors, a window, cover and floor
 * finishes. Cover ОБ values (crates and sandbags 6, walls 8, window 5) are demo values the
 * GM may change in the editor — the same ones the client tests use, not a canonical table.
 */
export function demoOutpostMap(): MapDocument {
  const floor: Record<string, FloorColorId> = {};
  paint(floor, 'blue', 1, 1, 9, 7); // казарма
  paint(floor, 'green', 10, 1, 8, 7); // пост
  paint(floor, 'sand', 18, 1, 11, 7); // склад
  paint(floor, 'grey', 1, 8, 28, 3); // коридор
  paint(floor, 'rust', 1, 11, 11, 8); // мастерская
  const cover = (
    id: string,
    label: string,
    col: number,
    row: number,
    width: number,
    height: number,
    coverHeight: 'low' | 'medium' | 'high',
    blocksVision = false,
  ) => ({
    id,
    col,
    row,
    width,
    height,
    label,
    blocksMovement: true,
    blocksVision,
    notes: 'Демо: ОБ укрытия задан для проверки, ведущий может изменить',
    coverOb: 6,
    coverHeight,
  });
  return {
    ...emptyMap('demo-outpost', 'Демо: аванпост — казарма, пост, склад, двор', 30, 20),
    floor,
    walls: [
      {
        id: 'outer',
        ob: 8,
        points: [
          { x: 1, y: 1 },
          { x: 29, y: 1 },
          { x: 29, y: 19 },
          { x: 1, y: 19 },
          { x: 1, y: 1 },
        ],
      },
      {
        id: 'corridor-north',
        ob: 8,
        points: [
          { x: 1, y: 8 },
          { x: 29, y: 8 },
        ],
      },
      {
        id: 'corridor-south',
        ob: 8,
        points: [
          { x: 1, y: 11 },
          { x: 29, y: 11 },
        ],
      },
      {
        id: 'barracks-post',
        ob: 8,
        points: [
          { x: 10, y: 1 },
          { x: 10, y: 8 },
        ],
      },
      {
        id: 'post-store',
        ob: 8,
        points: [
          { x: 18, y: 1 },
          { x: 18, y: 8 },
        ],
      },
      {
        id: 'workshop-yard',
        ob: 8,
        points: [
          { x: 12, y: 11 },
          { x: 12, y: 19 },
        ],
      },
    ],
    doors: [
      door('barracks-door', 'corridor-north', { x: 4, y: 8 }, { x: 6, y: 8 }, true),
      door('post-door', 'corridor-north', { x: 12, y: 8 }, { x: 13, y: 8 }, false),
      door('post-window', 'corridor-north', { x: 14, y: 8 }, { x: 17, y: 8 }, false, {
        coverOb: 5,
      }),
      door('store-gate', 'corridor-north', { x: 22, y: 8 }, { x: 24, y: 8 }, true),
      door('barracks-post-door', 'barracks-post', { x: 10, y: 4 }, { x: 10, y: 5 }, false),
      door('workshop-door', 'corridor-south', { x: 6, y: 11 }, { x: 7, y: 11 }, true),
      door('yard-gate', 'corridor-south', { x: 20, y: 11 }, { x: 23, y: 11 }, true),
      door('workshop-yard-door', 'workshop-yard', { x: 12, y: 15 }, { x: 12, y: 16 }, false),
      door('west-entrance', 'outer', { x: 1, y: 9 }, { x: 1, y: 10 }, false),
    ],
    obstacles: [
      cover('bunks', 'Койки', 2, 2, 3, 1, 'low'),
      cover('post-desk', 'Стол связи', 13, 3, 2, 1, 'low'),
      cover('store-crates', 'Ящики', 20, 3, 2, 2, 'medium'),
      {
        id: 'store-rack',
        col: 26,
        row: 2,
        width: 1,
        height: 4,
        label: 'Стеллаж',
        blocksMovement: true,
        blocksVision: true,
        notes: 'Высокий: закрывает обзор',
      },
      cover('lathe', 'Станок', 3, 13, 2, 2, 'medium'),
      cover('sandbags', 'Мешки с песком', 16, 14, 3, 1, 'medium'),
      cover('barricade', 'Баррикада', 24, 16, 1, 2, 'medium'),
      cover('tank', 'Цистерна', 26, 12, 2, 2, 'high', true),
    ],
    zones: [
      { id: 'rubble', col: 7, row: 16, width: 3, height: 2, label: 'Обломки', modifier: -20 },
      {
        id: 'puddles',
        col: 19,
        row: 17,
        width: 3,
        height: 2,
        label: 'Лужи крови или жидкостей',
        modifier: 0,
      },
      { id: 'smoke', col: 25, row: 8, width: 2, height: 3, label: 'Дым или туман', modifier: 0 },
    ],
  };
}

/** Kelus in the barracks, Pak in the yard behind the sandbags; setup phase, nothing rolled. */
export function demoOutpost(): Battle {
  const b = createBattle();
  applyMap(b, {
    map: demoOutpostMap(),
    positions: { 'kelus-drakar': { x: 5.5, y: 4.5 }, pak: { x: 17.5, y: 15.5 } },
  });
  return b;
}
