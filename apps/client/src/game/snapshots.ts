import { MAP_SCHEMA_VERSION, type MapDocument } from './map';

/**
 * Content-addressed store of applied map geometry. Each layer (floor, decorations, walls,
 * doors, obstacles, zones) is kept once and shared by every snapshot that contains it, so
 * several applies of the same large map do not repeat its unchanged layers. IDs are given in
 * order of first appearance; replaying the same applies in the same order yields the same IDs.
 * Background bytes are never stored (visual only).
 */
const LAYERS = ['floor', 'decorations', 'walls', 'doors', 'obstacles', 'zones'] as const;
type LayerName = (typeof LAYERS)[number];

export interface MapSnapshotRef {
  readonly id: string;
  readonly name: string;
  readonly cols: number;
  readonly rows: number;
  readonly layers: Readonly<Record<LayerName, string>>;
}
export interface SnapshotStore {
  layers: Record<string, unknown>;
  maps: Record<string, MapSnapshotRef>;
}
export const emptySnapshotStore = (): SnapshotStore => ({ layers: {}, maps: {} });

/** Stable content: floor cells sorted, so paint order does not create a new layer. */
function canonicalLayer(name: LayerName, value: unknown): unknown {
  if (name !== 'floor') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, string>).sort(([a], [b]) => {
      const [ac, ar] = a.split(':').map(Number);
      const [bc, br] = b.split(':').map(Number);
      return ar! - br! || ac! - bc!;
    }),
  );
}

/** Adds the map's geometry to the store (if new) and returns its snapshot ID. */
export function storeSnapshot(store: SnapshotStore, map: MapDocument): string {
  const known = new Map(Object.entries(store.layers).map(([id, v]) => [JSON.stringify(v), id]));
  const layers = {} as Record<LayerName, string>;
  for (const name of LAYERS) {
    const value = canonicalLayer(name, map[name]);
    const key = JSON.stringify(value);
    let id = known.get(key);
    if (!id) {
      id = `L${Object.keys(store.layers).length + 1}`;
      store.layers[id] = structuredClone(value);
      known.set(key, id);
    }
    layers[name] = id;
  }
  const ref = { id: map.id, name: map.name, cols: map.cols, rows: map.rows, layers };
  const refKey = JSON.stringify(ref);
  const existing = Object.entries(store.maps).find(([, r]) => JSON.stringify(r) === refKey);
  if (existing) return existing[0];
  const id = `M${Object.keys(store.maps).length + 1}`;
  store.maps[id] = ref;
  return id;
}

/** Rebuilds a map document (without background) from a stored snapshot. */
export function loadSnapshot(store: SnapshotStore, id: string): MapDocument {
  const ref = store?.maps?.[id];
  if (!ref) throw new Error(`Снимок карты ${id} не найден в replay`);
  const layer = (name: LayerName) => {
    const value = store.layers?.[ref.layers?.[name]];
    if (value === undefined) throw new Error(`Слой «${name}» снимка ${id} не найден в replay`);
    return structuredClone(value);
  };
  return {
    schemaVersion: MAP_SCHEMA_VERSION,
    id: ref.id,
    name: ref.name,
    cols: ref.cols,
    rows: ref.rows,
    cellMeters: 1,
    background: null,
    floor: layer('floor') as MapDocument['floor'],
    decorations: layer('decorations') as MapDocument['decorations'],
    walls: layer('walls') as MapDocument['walls'],
    doors: layer('doors') as MapDocument['doors'],
    obstacles: layer('obstacles') as MapDocument['obstacles'],
    zones: layer('zones') as MapDocument['zones'],
  };
}
