import { applyMap } from './engine';
import { emptyMap, type MapDocument } from './map';
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
