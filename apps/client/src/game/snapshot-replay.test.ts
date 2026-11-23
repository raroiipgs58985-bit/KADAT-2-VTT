import { describe, expect, it } from 'vitest';
import type { FloorColorId, MapDocument } from './map';
import { append, createBattle, type Battle } from './model';
import { applyMap, moveActor, startCombat } from './engine';
import {
  exportReplay,
  importReplay,
  parseReplayText,
  REPLAY_MAX_BYTES,
  serializeReplay,
} from './replay';
import { loadSnapshot } from './snapshots';
import { bigMap } from './big-map.test';
import { fixedDice } from './dice';

/** A fully painted 200 × 200 map (40 000 floor cells) on top of the TZ load map. */
function paintedBigMap(): MapDocument {
  const floor: Record<string, FloorColorId> = {};
  for (let r = 0; r < 200; r++)
    for (let c = 0; c < 200; c++) floor[`${c}:${r}`] = (c + r) % 2 ? 'grey' : 'sand';
  return { ...bigMap(), floor };
}
/** Five separate applies, each with a different edit of the painted map. */
function fiveApplies(): Battle {
  const b = createBattle();
  let map = paintedBigMap();
  const edits: ((m: MapDocument) => MapDocument)[] = [
    (m) => m,
    (m) => ({ ...m, obstacles: m.obstacles.slice(1) }),
    (m) => ({ ...m, walls: m.walls.slice(1) }),
    (m) => ({
      ...m,
      zones: [{ id: 'z', col: 40, row: 100, width: 5, height: 5, label: 'Грязь', modifier: 0 }],
    }),
    (m) => ({ ...m, name: 'Большая карта, правка 5' }),
  ];
  for (const edit of edits) {
    map = edit(map);
    applyMap(b, { map, positions: b.positions });
  }
  return b;
}
const bytes = (text: string) => new TextEncoder().encode(text).length;

describe('Replay snapshots are stored once', () => {
  it('five applies of a painted 200 × 200 map keep one floor layer and reference snapshots', () => {
    const b = fiveApplies();
    const replay = exportReplay(b);
    const maps = Object.values(replay.snapshots!.maps);
    expect(maps).toHaveLength(5);
    expect(new Set(maps.map((m) => m.layers.floor)).size).toBe(1); // the 40 000 cells, once
    const mapSteps = replay.steps.filter((s) => s.type === 'map');
    expect(mapSteps.map((s) => (s as { snapshot: string }).snapshot)).toEqual([
      'M1',
      'M2',
      'M3',
      'M4',
      'M5',
    ]);
    // The journal references snapshots instead of repeating them.
    const applied = replay.log.filter((e) => e.type === 'map-applied');
    expect(
      applied.every((e) => typeof (e.detail as { snapshot: unknown }).snapshot === 'string'),
    ).toBe(true);
    const size = bytes(serializeReplay(b));
    expect(size).toBeLessThan(2 * 1024 * 1024); // was ~6.4 MB with a snapshot per step and entry
  });

  it('re-applying an unchanged map reuses its snapshot', () => {
    const b = createBattle();
    const map = bigMap();
    applyMap(b, { map, positions: b.positions });
    applyMap(b, { map, positions: b.positions });
    expect(Object.keys(b.snapshots.maps)).toEqual(['M1']);
  });

  it('a stored snapshot rebuilds exactly the applied geometry', () => {
    const b = fiveApplies();
    const rebuilt = loadSnapshot(b.snapshots, 'M5');
    expect(rebuilt.walls).toEqual(b.map.walls);
    expect(rebuilt.zones).toEqual(b.map.zones);
    expect(Object.keys(rebuilt.floor)).toHaveLength(40_000);
  });

  it('export → open → export through text keeps steps, snapshots, journal and outcome', () => {
    const b = fiveApplies();
    startCombat(b, fixedDice('10:9,10:2'));
    moveActor(b, {
      id: 'm',
      actor: 'kelus-drakar',
      mode: 'half-move',
      to: { x: 8.5, y: 10.5 },
      sceneRevision: b.sceneRevision,
    });
    const text = serializeReplay(b);
    const replayed = parseReplayText(text);
    const again = JSON.parse(serializeReplay(replayed));
    const first = JSON.parse(text);
    expect(again.steps).toEqual(first.steps);
    expect(again.snapshots).toEqual(first.snapshots);
    expect(again.log).toEqual(first.log);
    expect(again.outcome).toEqual(first.outcome);
  });

  it('a v0.4 replay (fixed Келус/Пак adapter) is refused since step 4', () => {
    const b = fiveApplies();
    const v05 = JSON.parse(JSON.stringify(exportReplay(b)));
    const v04 = {
      ...v05,
      format: 'kadat-client-combat-v0.4',
      snapshots: undefined,
      steps: v05.steps.map((s: { type: string; snapshot?: string }) =>
        s.type === 'map'
          ? { ...s, snapshot: undefined, map: loadSnapshot(v05.snapshots, s.snapshot!) }
          : s,
      ),
    };
    expect(() => importReplay(JSON.parse(JSON.stringify(v04)))).toThrow(
      /Неподдерживаемый формат replay/,
    );
  });

  it('a missing snapshot reference is refused', () => {
    const replay = JSON.parse(JSON.stringify(exportReplay(fiveApplies())));
    delete replay.snapshots.maps.M3;
    expect(() => importReplay(replay)).toThrow(/Снимок карты M3 не найден/);
  });
});

describe('One size limit for saving and opening', () => {
  it('saving refuses a replay over the limit', () => {
    const b = createBattle();
    append(b, 'move-rejected', { committed: false, reason: 'x'.repeat(REPLAY_MAX_BYTES) });
    expect(() => serializeReplay(b)).toThrow(/больше предела 16 МиБ; сохранение отклонено/);
  });

  it('opening refuses text over the same limit, counted in UTF-8 bytes', () => {
    expect(() => parseReplayText(' '.repeat(REPLAY_MAX_BYTES + 1))).toThrow(
      /больше предела 16 МиБ/,
    );
    // Cyrillic takes two bytes per letter: under the limit in characters, over it in bytes.
    const cyrillic = 'я'.repeat(REPLAY_MAX_BYTES / 2 + 1);
    expect(cyrillic.length).toBeLessThan(REPLAY_MAX_BYTES);
    expect(() => parseReplayText(cyrillic)).toThrow(/больше предела/);
  });

  it('opening reports broken JSON clearly', () => {
    expect(() => parseReplayText('{"format":')).toThrow(/не является JSON/);
  });
});
