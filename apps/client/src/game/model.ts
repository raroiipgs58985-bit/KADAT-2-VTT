import data from './data/fixture.json';
import {
  SINGLE_CELL,
  allCenters,
  cellKey,
  cellsOf,
  distance,
  placementProblem,
  type Footprint,
  type Point,
} from './grid';
import armorCatalog from './data/canonical-armor.json';
export const pakArmorProperties = armorCatalog.sheets[0]!.data.find((d) => d.startRow === 32)!
  .rowData[0]!.values[2]!.formattedValue;
export type ActorId = 'kelus-drakar' | 'pak';
export const ids: ActorId[] = ['kelus-drakar', 'pak'];
export type WeaponId = 'hotshot' | 'kelus-chain' | 'pak-chain' | 'bracer' | 'flamer';
export const weapons: {
  id: WeaponId;
  owner: ActorId;
  name: string;
  raw: string;
  capacity: number | null;
}[] = [
  {
    id: 'hotshot',
    owner: 'kelus-drakar',
    name: 'Хот-шот лазган',
    raw: data.actors[0]!.profile.find((p) => p.label === 'Снаряжение:')!.note!.split('\n')[0]!,
    capacity: 250,
  },
  {
    id: 'kelus-chain',
    owner: 'kelus-drakar',
    name: 'Цепной меч Келуса',
    raw: data.actors[0]!.profile.find((p) => p.label === 'Снаряжение:')!.note!.split('\n')[1]!,
    capacity: 50,
  },
  ...(['pak-chain', 'bracer', 'flamer'] as WeaponId[]).map((id, i) => ({
    id,
    owner: 'pak' as const,
    name: ['Цепной меч Пака', 'Пирофорный наруч', 'Освящённый огнемёт'][i]!,
    raw: data.actors[1]!.profile.find((p) => p.label === 'Снаряжение:')!.formattedValue!.split(
      '\n',
    )[i]!,
    capacity: [null, 10, 9][i]!,
  })),
];
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}
export const fixture = deepFreeze(structuredClone(data));
export const actor = (id: ActorId) => fixture.actors.find((a) => a.id === id)!;
export interface LogEntry {
  id: number;
  type: string;
  detail: unknown;
}
export interface Battle {
  active: ActorId;
  /** Centre of each token's footprint, metres; always aligned to the 1 m grid. */
  positions: Record<ActorId, { x: number; y: number }>;
  /** Cells each token occupies (GM-set token area, not the canonical «Размер»). */
  footprints: Record<ActorId, Footprint>;
  hp: Record<ActorId, number>;
  ammo: Record<WeaponId, number | null>;
  log: LogEntry[];
}
export function append(b: Battle, type: string, detail: unknown) {
  b.log.push({ id: b.log.length + 1, type, detail: structuredClone(detail) });
}
export function createBattle(): Battle {
  return {
    active: 'kelus-drakar',
    // Test placement on cell centres; the 10 m separation of the experiment is preserved.
    positions: { 'kelus-drakar': { x: 5.5, y: 10.5 }, pak: { x: 15.5, y: 10.5 } },
    footprints: { 'kelus-drakar': SINGLE_CELL, pak: SINGLE_CELL },
    hp: { 'kelus-drakar': 26, pak: 33 },
    ammo: Object.fromEntries(weapons.map((w) => [w.id, w.capacity])) as Battle['ammo'],
    log: [
      {
        id: 1,
        type: 'loaded',
        detail: {
          source: fixture.sources,
          authorRulings: fixture.authorRulings,
          map: 'test placement, not canonical coordinates',
        },
      },
    ],
  };
}
/** Cells taken by every token except `except` (walls and obstacles will join this set). */
export function occupiedCells(b: Battle, except?: ActorId): Set<string> {
  const taken = new Set<string>();
  for (const id of ids)
    if (id !== except)
      for (const c of cellsOf(b.positions[id], b.footprints[id])) taken.add(cellKey(c));
  return taken;
}
export function placementProblemFor(
  b: Battle,
  id: ActorId,
  center: Point,
  footprint: Footprint = b.footprints[id],
): string | null {
  return placementProblem(center, footprint, occupiedCells(b, id));
}
/** Grid-aligned centres the token can stand on within `maxDistance` metres of its centre. */
export function destinationsWithin(b: Battle, id: ActorId, maxDistance: number): Point[] {
  const from = b.positions[id];
  const blocked = occupiedCells(b, id);
  const f = b.footprints[id];
  return allCenters(f).filter(
    (c) =>
      distance(from, c) > 0 &&
      distance(from, c) <= maxDistance + 1e-9 &&
      placementProblem(c, f, blocked) === null,
  );
}
/** Low-level placement: validates grid alignment, map bounds and overlap, then logs. */
export function move(b: Battle, id: ActorId, x: number, y: number) {
  if (!ids.includes(id)) throw new Error('Неизвестный персонаж');
  const problem = placementProblemFor(b, id, { x, y });
  if (problem) throw new Error(problem);
  const before = b.positions[id];
  b.positions[id] = { x, y };
  append(b, 'placement', {
    actor: id,
    before,
    after: b.positions[id],
    cells: cellsOf(b.positions[id], b.footprints[id]),
    meters: Math.hypot(x - before.x, y - before.y),
    od: 'manual placement; not a movement action',
  });
}
export function selectActor(b: Battle, id: ActorId) {
  if (!ids.includes(id)) throw new Error('Неизвестный Actor');
  b.active = id;
  append(b, 'manual-turn', { actor: id });
}
/**
 * СКР (base movement, metres) per personal profile cell `Движение`. The accepted Core
 * derives every movement distance from this value (Механика / Бой: СД = 1/2 СКР ≤ 5 м,
 * Полудвижение = СКР, Полное движение = СКР×2). Values are read, not computed here.
 */
export const movementProfiles: Record<
  ActorId,
  { skr: number; source: string; profileText: string; openQuestion?: string }
> = {
  'kelus-drakar': {
    skr: 4,
    source: 'Профили / Персонажи Вольного торговца, «Движение» (примечание), строка «Базовый»',
    profileText: '2/4/8/12/24 — Базовый; 3/5/10/15/30 — Броня; 2/4/8/12/24 — Гравишют',
    openQuestion:
      'Профиль указывает отдельную строку «Броня» (СКР 5) для запитанной брони. Какая строка действует в бою — решает автор; до решения используется «Базовый».',
  },
  pak: {
    skr: 4,
    source: 'Профили / Персонажи Вольного торговца, «Движение»',
    profileText: '4/8/12/24',
  },
};
