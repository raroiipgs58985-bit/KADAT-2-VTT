import data from '../public/fixture.json';
import armorCatalog from '../public/canonical-armor.json';
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
  positions: Record<ActorId, { x: number; y: number }>;
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
    positions: { 'kelus-drakar': { x: 5, y: 10 }, pak: { x: 15, y: 10 } },
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
export function move(b: Battle, id: ActorId, x: number, y: number) {
  if (
    !ids.includes(id) ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    Math.min(x, y) < 0 ||
    Math.max(x, y) > 20
  )
    throw new Error('Координаты должны быть в пределах карты 20 × 20 м.');
  const before = b.positions[id];
  b.positions[id] = { x, y };
  append(b, 'placement', {
    actor: id,
    before,
    after: b.positions[id],
    meters: Math.hypot(x - before.x, y - before.y),
    od: 'manual placement; not a movement action',
  });
}
export function selectActor(b: Battle, id: ActorId) {
  if (!ids.includes(id)) throw new Error('Неизвестный Actor');
  b.active = id;
  append(b, 'manual-turn', { actor: id });
}
