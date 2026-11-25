import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { cellKey, cellsOf, distance, snapCenter, type Cell, type Point } from '../game/grid';
import type { Vertex } from '../game/map';
import { floorColor, type FloorColorId, type MapDocument } from '../game/map';
import { rectangleCells } from '../game/map-editor';
import {
  actorIds,
  actorName,
  destinationsWithin,
  fpOf,
  planRoute,
  placementProblemFor,
  type ActorId,
  type Battle,
} from '../game/model';

const MARGIN = 1.6;
const INSET = 0.08;
const MIN_ZOOM = 1;
const MAX_ZOOM = 12;

export type SceneMode = 'editor' | 'placement' | 'combat';
export type EditorTool =
  | 'select'
  | 'hand'
  | 'background'
  | 'brush'
  | 'rect'
  | 'eraser'
  | 'decoration'
  | 'calibrate'
  | 'wall'
  | 'door'
  | 'obstacle'
  | 'zone';
export type MapObjectKind = 'decoration' | 'wall' | 'door' | 'obstacle' | 'zone';
export interface SelectedObject {
  kind: MapObjectKind;
  id: string;
}
export interface MoveIntent {
  actor: ActorId;
  modeLabel: string;
  maxDistance: number;
  /** Scene revision the highlight and hint were computed on. */
  sceneRevision: number;
  /** Route mode: clicks add points instead of moving at once (author ruling 8). */
  route: Point[] | null;
}
interface Props {
  battle: Battle;
  /** Bumps on every published state change; derived highlights are keyed by it. */
  version: number;
  mode: SceneMode;
  /** The map and positions to draw: the editor draft in editor mode, otherwise the scene. */
  map: MapDocument;
  positions: Record<ActorId, Point>;
  conflicts: ReadonlySet<ActorId>;
  selected: ActorId | null;
  activeActor: ActorId;
  turnActive: boolean;
  moveIntent: MoveIntent | null;
  attackLine: { from: ActorId; to: ActorId } | null;
  wounds: Record<ActorId, { current: number; max: number }>;
  tool: EditorTool;
  floorColour: FloorColorId;
  onSelect: (id: ActorId) => void;
  onMove: (id: ActorId, x: number, y: number, previewRevision?: number) => void;
  /** Route mode: a clicked point is appended to the route. */
  onRoutePoint: (p: Point) => void;
  /** A runner fell: the GM clicks where they lie (author ruling 42). */
  fallActor: ActorId | null;
  onPlaceFall: (id: ActorId, p: Point) => void;
  /** «След» zones still burning (ruling 149). */
  trails?: {
    id: string;
    shape:
      | { kind: 'circle'; x: number; y: number; r: number }
      | { kind: 'sector'; x: number; y: number; heading: number; range: number };
  }[];
  /** Smoke clouds still hanging (rulings 146, 154). */
  smokes?: { id: string; x: number; y: number; r: number }[];
  /** Weapons knocked out of the hand lying on the map (ruling 108). */
  loose?: { id: string; name: string; x: number; y: number }[];
  /** A knocked-out weapon waits for its place: within `max` m of `from`. */
  placingLoose?: { from: Point; max: number } | null;
  onPlaceLoose?: (p: Point) => void;
  onPlace: (id: ActorId, x: number, y: number) => void;
  onDraftPlace: (id: ActorId, x: number, y: number) => void;
  onPaint: (cells: Cell[], colour: FloorColorId | null) => void;
  /** Object URL of the background raster (created and revoked by the owner). */
  backgroundUrl: string | null;
  selectedObject: SelectedObject | null;
  onSelectObject: (object: SelectedObject | null) => void;
  onAddRect: (kind: 'decoration' | 'obstacle' | 'zone', start: Cell, end: Cell) => void;
  onAddWall: (points: Vertex[]) => void;
  onAddDoor: (from: Vertex, to: Vertex) => void;
  onToggleDoor: (id: string) => void;
  onMoveWallEnd: (wallId: string, end: 'start' | 'end', to: Vertex) => void;
  /** Current door states: the session's in placement/combat, the map's initial ones in the editor. */
  doorStates: Readonly<Record<string, boolean>>;
  onMoveBackground: (dx: number, dy: number) => void;
  calibrationPoints: readonly Point[];
  onCalibrationPoint: (p: Point) => void;
}
type Drag =
  | {
      kind: 'token';
      id: ActorId;
      pointer: number;
      offset: Point;
      at: Point;
      /** Scene revision when the gesture started; the move is checked against it. */
      revision: number;
    }
  | { kind: 'pan'; pointer: number; start: Point; center: Point }
  | { kind: 'brush'; pointer: number; erase: boolean; cells: Map<string, Cell> }
  | {
      kind: 'rect';
      pointer: number;
      start: Cell;
      end: Cell;
      purpose: 'floor' | 'decoration' | 'obstacle' | 'zone';
    }
  | { kind: 'door'; pointer: number; start: Vertex; end: Vertex }
  | { kind: 'wall-draw'; pointer: number; start: Vertex; end: Vertex; tap: Vertex }
  | { kind: 'wall-end'; pointer: number; wallId: string; end: 'start' | 'end'; at: Vertex }
  | { kind: 'background'; pointer: number; start: Point; offset: Point };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const fmt = (n: number) => `${Number(n.toFixed(2))}`;
const tokenColor = (b: Battle, id: ActorId) =>
  b.roster[id]?.side === 'b' ? 'var(--token-b)' : 'var(--token-a)';
const initials = (b: Battle, id: ActorId) =>
  actorName(b, id)
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2);
const rectOf = (c: Point, w: number, h: number) => ({
  x: c.x - w / 2,
  y: c.y - h / 2,
  width: w,
  height: h,
});
const labelStep = (n: number) => (n <= 40 ? 5 : n <= 100 ? 10 : 25);

export function TacticalMap(props: Props) {
  const { battle, version, mode, map, positions, selected, activeActor, turnActive } = props;
  const { moveIntent, attackLine } = props;
  const svg = useRef<SVGSVGElement>(null);
  const inMap = (p: Point) => p.x >= 0 && p.y >= 0 && p.x < map.cols && p.y < map.rows;
  const cellAt = (p: Point): Cell => ({ col: Math.floor(p.x), row: Math.floor(p.y) });

  // World bounds: the map plus any token left outside it in a draft, with a margin.
  const world = useMemo(() => {
    let minX = 0,
      minY = 0,
      maxX = map.cols,
      maxY = map.rows;
    for (const id of actorIds(battle)) {
      const f = fpOf(battle, id);
      const p = positions[id];
      if (!p) continue;
      minX = Math.min(minX, p.x - f.width / 2);
      minY = Math.min(minY, p.y - f.height / 2);
      maxX = Math.max(maxX, p.x + f.width / 2);
      maxY = Math.max(maxY, p.y + f.height / 2);
    }
    return {
      x: minX - MARGIN,
      y: minY - MARGIN,
      w: maxX - minX + MARGIN * 2,
      h: maxY - minY + MARGIN * 2,
    };
  }, [map.cols, map.rows, positions, battle.footprints]);

  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<Point>({
    x: world.x + world.w / 2,
    y: world.y + world.h / 2,
  });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<Point | null>(null);

  // A new map size resets the camera to show the whole map.
  useEffect(() => {
    setZoom(1);
    setCenter({ x: world.x + world.w / 2, y: world.y + world.h / 2 });
    // Intentionally keyed on the size only: re-centre when the map dimensions change.
  }, [map.cols, map.rows]);

  const vw = world.w / zoom,
    vh = world.h / zoom;
  const clampCenter = (c: Point, z: number): Point => {
    const hw = world.w / z / 2,
      hh = world.h / z / 2;
    return {
      x: clamp(c.x, world.x + hw, world.x + world.w - hw),
      y: clamp(c.y, world.y + hh, world.y + world.h - hh),
    };
  };
  const toMap = (clientX: number, clientY: number): Point => {
    const el = svg.current!;
    const p = el.createSVGPoint();
    p.x = clientX;
    p.y = clientY;
    const m = p.matrixTransform(el.getScreenCTM()!.inverse());
    return { x: m.x, y: m.y };
  };
  const zoomTo = (next: number, focus?: Point) => {
    const z = clamp(next, MIN_ZOOM, MAX_ZOOM);
    setZoom(z);
    setCenter((c) => {
      const f = focus ?? c;
      const k = zoom / z;
      return clampCenter({ x: f.x + (c.x - f.x) * k, y: f.y + (c.y - f.y) * k }, z);
    });
  };

  // Non-passive wheel listener so that zooming the map does not scroll the page.
  const zoomRef = useRef(zoomTo);
  zoomRef.current = zoomTo;
  useEffect(() => {
    const el = svg.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = el.createSVGPoint();
      p.x = e.clientX;
      p.y = e.clientY;
      const m = p.matrixTransform(el.getScreenCTM()!.inverse());
      zoomRef.current(zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2), { x: m.x, y: m.y });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom]);

  // Escape cancels an unfinished gesture (paint stroke, rectangle, token drag, pan).
  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrag(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drag]);

  // Cell-aligned destinations within the Core distance for the moving token's area.
  const destinations = useMemo(
    () =>
      // In route mode the straight-line reach from the start would mislead: no highlight.
      moveIntent && !moveIntent.route
        ? destinationsWithin(battle, moveIntent.actor, moveIntent.maxDistance)
        : [],
    // `battle` is mutated in place; `version` makes the highlight follow every change.
    [battle, version, moveIntent?.actor, moveIntent?.maxDistance, moveIntent?.route === null],
  );
  const destinationKeys = useMemo(
    () => new Set(destinations.map((d) => `${d.x}:${d.y}`)),
    [destinations],
  );
  const reachCells = useMemo(() => {
    if (!moveIntent) return [];
    const f = fpOf(battle, moveIntent.actor);
    const cells = new Map<string, Cell>();
    for (const d of destinations) for (const c of cellsOf(d, f)) cells.set(cellKey(c), c);
    return [...cells.values()];
  }, [battle, destinations, moveIntent]);

  const canDrag = (id: ActorId) =>
    mode === 'editor' ||
    mode === 'placement' ||
    (turnActive && id === activeActor && moveIntent?.actor === id);
  const snapFor = (id: ActorId, p: Point) => snapCenter(p, fpOf(battle, id), map);
  const vertexAt = (p: Point): Vertex => ({
    x: clamp(Math.round(p.x), 0, map.cols),
    y: clamp(Math.round(p.y), 0, map.rows),
  });
  // Wall drawing: drag a segment (a finger on the phone) or tap vertices; each next segment goes
  // on from the last point, snapped to a horizontal or vertical line. «Готово», a tap on the last
  // point or Enter finishes; Escape or «Отмена» cancels the chain.
  const [wallPoints, setWallPoints] = useState<Vertex[]>([]);
  const straight = (from: Vertex, v: Vertex): Vertex =>
    Math.abs(v.x - from.x) >= Math.abs(v.y - from.y)
      ? { x: v.x, y: from.y }
      : { x: from.x, y: v.y };
  const finishWall = () => {
    if (wallPoints.length >= 2) props.onAddWall(wallPoints);
    setWallPoints([]);
  };
  const finishRef = useRef(finishWall);
  finishRef.current = finishWall;
  useEffect(() => {
    if (props.tool !== 'wall' || mode !== 'editor') {
      setWallPoints([]);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (e.key === 'Escape') setWallPoints([]);
      if (e.key === 'Enter') finishRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.tool, mode]);

  const onTokenDown = (e: ReactPointerEvent, id: ActorId) => {
    e.stopPropagation();
    props.onSelect(id);
    if (!canDrag(id)) return;
    const p = toMap(e.clientX, e.clientY);
    const pos = positions[id];
    if (!pos) return;
    svg.current!.setPointerCapture(e.pointerId);
    setDrag({
      kind: 'token',
      id,
      pointer: e.pointerId,
      offset: { x: p.x - pos.x, y: p.y - pos.y },
      at: pos,
      revision: battle.sceneRevision,
    });
  };
  const onBackgroundDown = (e: ReactPointerEvent) => {
    const p = toMap(e.clientX, e.clientY);
    // The GM toggles a door by a click in setup and at any moment in combat (ruling 10).
    if (
      mode === 'placement' ||
      (mode === 'combat' && !moveIntent && !props.fallActor && !props.placingLoose)
    ) {
      const door = (e.target as Element).closest('[data-door]');
      if (door) {
        props.onToggleDoor(door.getAttribute('data-door')!);
        return;
      }
    }
    if (mode === 'editor' && props.tool === 'select') {
      const handle = (e.target as Element).closest('[data-wall-end]');
      if (handle) {
        svg.current!.setPointerCapture(e.pointerId);
        setDrag({
          kind: 'wall-end',
          pointer: e.pointerId,
          wallId: handle.getAttribute('data-wall-id')!,
          end: handle.getAttribute('data-wall-end') as 'start' | 'end',
          at: vertexAt(p),
        });
        return;
      }
      const hit = (e.target as Element).closest('[data-object-kind]');
      props.onSelectObject(
        hit
          ? {
              kind: hit.getAttribute('data-object-kind') as MapObjectKind,
              id: hit.getAttribute('data-object-id')!,
            }
          : null,
      );
      return;
    }
    if (mode === 'editor' && props.tool === 'wall') {
      const v = vertexAt(p);
      const last = wallPoints.at(-1);
      svg.current!.setPointerCapture(e.pointerId);
      const start = last ?? v;
      setDrag({ kind: 'wall-draw', pointer: e.pointerId, start, end: start, tap: v });
      return;
    }
    if (mode === 'editor' && props.tool === 'door') {
      svg.current!.setPointerCapture(e.pointerId);
      const v = vertexAt(p);
      setDrag({ kind: 'door', pointer: e.pointerId, start: v, end: v });
      return;
    }
    if (mode === 'editor' && props.tool === 'calibrate') {
      props.onCalibrationPoint(p);
      return;
    }
    if (mode === 'editor' && props.tool === 'background') {
      if (!map.background || map.background.locked) return;
      svg.current!.setPointerCapture(e.pointerId);
      setDrag({ kind: 'background', pointer: e.pointerId, start: p, offset: { x: 0, y: 0 } });
      return;
    }
    if (mode === 'editor' && props.tool !== 'hand') {
      if (!inMap(p)) return;
      svg.current!.setPointerCapture(e.pointerId);
      const cell = cellAt(p);
      if (['rect', 'decoration', 'obstacle', 'zone'].includes(props.tool))
        setDrag({
          kind: 'rect',
          pointer: e.pointerId,
          start: cell,
          end: cell,
          purpose:
            props.tool === 'rect' ? 'floor' : (props.tool as 'decoration' | 'obstacle' | 'zone'),
        });
      else
        setDrag({
          kind: 'brush',
          pointer: e.pointerId,
          erase: props.tool === 'eraser',
          cells: new Map([[cellKey(cell), cell]]),
        });
      return;
    }
    if (moveIntent || props.fallActor || props.placingLoose) return; // A click chooses a point.
    if (zoom === MIN_ZOOM) return;
    svg.current!.setPointerCapture(e.pointerId);
    setDrag({ kind: 'pan', pointer: e.pointerId, start: { x: e.clientX, y: e.clientY }, center });
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const p = toMap(e.clientX, e.clientY);
    setHover(p);
    if (!drag || drag.pointer !== e.pointerId) return;
    if (drag.kind === 'token') {
      setDrag({
        ...drag,
        at: snapFor(drag.id, { x: p.x - drag.offset.x, y: p.y - drag.offset.y }),
      });
    } else if (drag.kind === 'brush') {
      if (!inMap(p)) return;
      const cell = cellAt(p);
      if (!drag.cells.has(cellKey(cell)))
        setDrag({ ...drag, cells: new Map(drag.cells).set(cellKey(cell), cell) });
    } else if (drag.kind === 'background') {
      setDrag({ ...drag, offset: { x: p.x - drag.start.x, y: p.y - drag.start.y } });
    } else if (drag.kind === 'wall-end') {
      setDrag({ ...drag, at: vertexAt(p) });
    } else if (drag.kind === 'wall-draw') {
      setDrag({ ...drag, end: straight(drag.start, vertexAt(p)) });
    } else if (drag.kind === 'door') {
      // Snap along the dominant axis so the opening stays straight.
      const v = vertexAt(p);
      const end =
        Math.abs(v.x - drag.start.x) >= Math.abs(v.y - drag.start.y)
          ? { x: v.x, y: drag.start.y }
          : { x: drag.start.x, y: v.y };
      setDrag({ ...drag, end });
    } else if (drag.kind === 'rect') {
      const cell = cellAt(p);
      setDrag({
        ...drag,
        end: { col: clamp(cell.col, 0, map.cols - 1), row: clamp(cell.row, 0, map.rows - 1) },
      });
    } else {
      const rect = svg.current!.getBoundingClientRect();
      const perPixel = Math.max(vw / rect.width, vh / rect.height);
      setCenter(
        clampCenter(
          {
            x: drag.center.x - (e.clientX - drag.start.x) * perPixel,
            y: drag.center.y - (e.clientY - drag.start.y) * perPixel,
          },
          zoom,
        ),
      );
    }
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    if (drag && drag.pointer === e.pointerId) {
      if (drag.kind === 'token') {
        const pos = positions[drag.id];
        if (pos && (drag.at.x !== pos.x || drag.at.y !== pos.y)) {
          if (mode === 'editor') props.onDraftPlace(drag.id, drag.at.x, drag.at.y);
          else if (mode === 'placement') props.onPlace(drag.id, drag.at.x, drag.at.y);
          else props.onMove(drag.id, drag.at.x, drag.at.y, drag.revision);
        }
      } else if (drag.kind === 'brush') {
        props.onPaint([...drag.cells.values()], drag.erase ? null : props.floorColour);
      } else if (drag.kind === 'rect') {
        if (drag.purpose === 'floor')
          props.onPaint(rectangleCells(drag.start, drag.end), props.floorColour);
        else props.onAddRect(drag.purpose, drag.start, drag.end);
      } else if (drag.kind === 'door') {
        if (drag.start.x !== drag.end.x || drag.start.y !== drag.end.y)
          props.onAddDoor(drag.start, drag.end);
      } else if (drag.kind === 'wall-draw') {
        const last = wallPoints.at(-1);
        const dragged = drag.end.x !== drag.start.x || drag.end.y !== drag.start.y;
        if (dragged) setWallPoints(last ? [...wallPoints, drag.end] : [drag.start, drag.end]);
        else if (!last) setWallPoints([drag.tap]);
        else if (last.x === drag.tap.x && last.y === drag.tap.y) finishWall();
        else {
          const v = straight(last, drag.tap);
          if (v.x !== last.x || v.y !== last.y) setWallPoints([...wallPoints, v]);
        }
      } else if (drag.kind === 'wall-end') {
        const wall = map.walls.find((w) => w.id === drag.wallId);
        const current = wall && (drag.end === 'start' ? wall.points[0] : wall.points.at(-1));
        if (current && (current.x !== drag.at.x || current.y !== drag.at.y))
          props.onMoveWallEnd(drag.wallId, drag.end, drag.at);
      } else if (drag.kind === 'background') {
        const { x, y } = drag.offset;
        if (x !== 0 || y !== 0) props.onMoveBackground(x, y);
      }
      setDrag(null);
      return;
    }
    if (props.fallActor) {
      const p = toMap(e.clientX, e.clientY);
      if (inMap(p)) props.onPlaceFall(props.fallActor, snapFor(props.fallActor, p));
      return;
    }
    if (props.placingLoose) {
      const p = toMap(e.clientX, e.clientY);
      // The weapon lies in the centre of the clicked cell.
      if (inMap(p)) props.onPlaceLoose?.({ x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5 });
      return;
    }
    if (moveIntent && (e.target as Element).closest('[data-actor]') === null) {
      const p = toMap(e.clientX, e.clientY);
      if (!inMap(p)) return;
      const target = snapFor(moveIntent.actor, p);
      if (moveIntent.route) props.onRoutePoint(target);
      else props.onMove(moveIntent.actor, target.x, target.y, moveIntent.sceneRevision);
    }
  };

  // Ghost: the snapped area a dragged token or the move-mode cursor would occupy.
  const ghostActor = drag?.kind === 'token' ? drag.id : moveIntent?.actor;
  const ghost =
    drag?.kind === 'token'
      ? drag.at
      : moveIntent && hover && !drag && inMap(hover)
        ? snapFor(moveIntent.actor, hover)
        : null;
  const routeSoFar = moveIntent?.route ?? null;
  const ghostFrom = ghostActor ? (routeSoFar?.at(-1) ?? positions[ghostActor]) : null;
  const ghostPlan =
    ghost && ghostActor && moveIntent && mode === 'combat'
      ? planRoute(battle, ghostActor, [...(routeSoFar ?? []), ghost])
      : null;
  const ghostDistance = ghostPlan
    ? ghostPlan.cost
    : ghost && ghostFrom
      ? distance(ghost, ghostFrom)
      : 0;
  // The same movement check as execution, worded by outcome for the GM.
  const ghostProblem = (() => {
    if (!ghost || !ghostActor || mode === 'editor') return null;
    if (mode === 'placement') return placementProblemFor(battle, ghostActor, ghost);
    if (!moveIntent || !ghostPlan) return null;
    if (!routeSoFar && destinationKeys.has(`${ghost.x}:${ghost.y}`)) return null;
    if (ghostFrom && ghost.x === ghostFrom.x && ghost.y === ghostFrom.y) return 'текущая позиция';
    const problem = ghostPlan.problem;
    if (problem?.kind === 'position') return `некуда поставить: ${problem.reason}`;
    // Same order as execution: out of reach first, then path barriers.
    if (ghostPlan.cost > moveIntent.maxDistance + 1e-9) return 'не хватает дистанции';
    if (problem) return `нет пути: ${problem.blocker.label}`;
    return null;
  })();
  const showGhost =
    ghost && ghostActor && ghostFrom && (ghost.x !== ghostFrom.x || ghost.y !== ghostFrom.y);

  // Paint preview of the gesture in progress.
  const preview: { cells: Cell[]; erase: boolean } | null =
    drag?.kind === 'brush'
      ? { cells: [...drag.cells.values()], erase: drag.erase }
      : drag?.kind === 'rect' && drag.purpose === 'floor'
        ? { cells: rectangleCells(drag.start, drag.end), erase: false }
        : null;
  const decorationPreview =
    drag?.kind === 'rect' && drag.purpose !== 'floor'
      ? {
          purpose: drag.purpose,
          col: Math.min(drag.start.col, drag.end.col),
          row: Math.min(drag.start.row, drag.end.row),
          width: Math.abs(drag.start.col - drag.end.col) + 1,
          height: Math.abs(drag.start.row - drag.end.row) + 1,
        }
      : null;
  const isSelected = (kind: MapObjectKind, id: string) =>
    props.selectedObject?.kind === kind && props.selectedObject.id === id;
  const bg = map.background;
  const bgOffset = drag?.kind === 'background' ? drag.offset : { x: 0, y: 0 };

  const lines = [];
  for (let i = 0; i <= map.cols; i++) {
    const cls = i % 5 === 0 ? 'grid-major' : 'grid-minor';
    lines.push(<line key={`v${i}`} className={cls} x1={i} y1={0} x2={i} y2={map.rows} />);
  }
  for (let i = 0; i <= map.rows; i++) {
    const cls = i % 5 === 0 ? 'grid-major' : 'grid-minor';
    lines.push(<line key={`h${i}`} className={cls} x1={0} y1={i} x2={map.cols} y2={i} />);
  }
  const labels = [];
  for (let i = 0; i <= map.cols; i += labelStep(map.cols))
    labels.push(
      <text key={`lx${i}`} className="axis-label" x={i} y={-0.55} textAnchor="middle">
        {i}
      </text>,
    );
  for (let i = 0; i <= map.rows; i += labelStep(map.rows))
    labels.push(
      <text key={`ly${i}`} className="axis-label" x={-0.55} y={i + 0.18} textAnchor="end">
        {i}
      </text>,
    );
  const attackA = attackLine ? positions[attackLine.from] : undefined;
  const attackB = attackLine ? positions[attackLine.to] : undefined;
  const attack = attackA && attackB ? { a: attackA, b: attackB } : null;
  const hoverCell = hover && inMap(hover) ? cellAt(hover) : null;
  const hint =
    mode === 'editor'
      ? props.tool === 'hand'
        ? 'Рука: перетаскивайте карту; токены — в пределах черновика'
        : props.tool === 'select'
          ? 'Выбор: щёлкните стену, дверь, препятствие, зону или декорацию'
          : props.tool === 'wall'
            ? `Стена: проведите пальцем или мышью отрезок (или касайтесь вершин); следующий отрезок продолжается от последней точки. «Готово» — завершить (${wallPoints.length} т.)`
            : props.tool === 'door'
              ? 'Дверь: протяните по прямому участку стены от вершины до вершины'
              : props.tool === 'obstacle'
                ? 'Препятствие: протяните прямоугольник; флаги и подпись — в панели'
                : props.tool === 'zone'
                  ? 'Зона трудного ландшафта: протяните прямоугольник'
                  : props.tool === 'background'
                    ? bg
                      ? bg.locked
                        ? 'Фон заблокирован: снимите блокировку в панели'
                        : 'Фон: перетащите подложку; токены и сетка не двигаются'
                      : 'Фон: сначала загрузите изображение в панели'
                    : props.tool === 'decoration'
                      ? 'Декорация: протяните прямоугольник; подпись и цвет — в панели'
                      : props.tool === 'calibrate'
                        ? `Калибровка: щёлкните две точки известного отрезка (${props.calibrationPoints.length}/2)`
                        : props.tool === 'rect'
                          ? 'Прямоугольник: зажмите и протяните; Escape — отмена'
                          : props.tool === 'eraser'
                            ? 'Ластик: проведите по клеткам; Escape — отмена'
                            : 'Кисть: проведите по клеткам; Escape — отмена'
      : mode === 'placement'
        ? 'Расстановка: перетаскивайте токены по клеткам; щелчок по двери открывает или закрывает её'
        : props.fallActor
          ? 'Персонаж упал: щёлкните клетку, где он лежит'
          : props.placingLoose
            ? `Оружие выбито: щёлкните клетку, куда оно упало (до ${props.placingLoose.max} м)`
            : moveIntent?.route
              ? `«${moveIntent.modeLabel}», маршрут: щёлкайте точки по порядку, затем «Идти»`
              : moveIntent
                ? `«${moveIntent.modeLabel}»: щёлкните подсвеченную клетку или перетащите токен`
                : 'Щёлкните токен, чтобы выбрать персонажа';

  return (
    <div className="map-shell">
      <div className="map-toolbar" role="toolbar" aria-label="Масштаб карты">
        <button type="button" onClick={() => zoomTo(zoom * 1.25)} aria-label="Приблизить">
          +
        </button>
        <span className="zoom-readout">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => zoomTo(zoom / 1.25)} aria-label="Отдалить">
          −
        </button>
        <button
          type="button"
          onClick={() => {
            setZoom(1);
            setCenter({ x: world.x + world.w / 2, y: world.y + world.h / 2 });
          }}
        >
          Вся карта
        </button>
        <span className="map-hint" title={hint}>
          {hint}
        </span>
        {mode === 'editor' && props.tool === 'wall' && (
          <span className="wall-actions">
            <button
              type="button"
              className="primary"
              disabled={wallPoints.length < 2}
              onClick={finishWall}
            >
              Готово
            </button>
            <button
              type="button"
              disabled={!wallPoints.length}
              onClick={() => setWallPoints(wallPoints.slice(0, -1))}
            >
              Убрать точку
            </button>
            <button type="button" disabled={!wallPoints.length} onClick={() => setWallPoints([])}>
              Отмена
            </button>
          </span>
        )}
        <span className="coords detail">
          {map.cols} × {map.rows}
          {` · клетка ${hoverCell ? `${hoverCell.col}, ${hoverCell.row}` : '—'}`}
        </span>
      </div>
      <svg
        ref={svg}
        className={`map mode-${mode} ${moveIntent || (mode === 'editor' && props.tool !== 'hand') ? 'is-targeting' : ''} ${drag?.kind === 'pan' ? 'is-panning' : ''}`}
        style={{ aspectRatio: `${world.w} / ${world.h}` }}
        viewBox={`${center.x - vw / 2} ${center.y - vh / 2} ${vw} ${vh}`}
        role="application"
        aria-label={`Тактическая карта ${map.cols} × ${map.rows} метров, клетка 1 × 1 м`}
        data-cols={map.cols}
        data-rows={map.rows}
        onPointerDown={onBackgroundDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onPointerCancel={() => setDrag(null)}
      >
        <defs>
          <clipPath id="map-area">
            <rect x={0} y={0} width={map.cols} height={map.rows} />
          </clipPath>
        </defs>
        <rect className="map-floor" x={0} y={0} width={map.cols} height={map.rows} />
        {bg && props.backgroundUrl && (
          <image
            className="map-background"
            data-testid="background"
            href={props.backgroundUrl}
            x={bg.x + bgOffset.x}
            y={bg.y + bgOffset.y}
            width={bg.widthPx * bg.metersPerPixel}
            height={bg.heightPx * bg.metersPerPixel}
            opacity={bg.opacity}
            clipPath="url(#map-area)"
            preserveAspectRatio="none"
          />
        )}
        <g data-testid="floor" data-cells={Object.keys(map.floor).length}>
          {Object.entries(map.floor).map(([key, colour]) => {
            const [col, row] = key.split(':').map(Number);
            return (
              <rect
                key={key}
                x={col}
                y={row}
                width={1}
                height={1}
                style={{ fill: floorColor(colour) }}
              />
            );
          })}
        </g>
        {preview && (
          <g
            className={`paint-preview ${preview.erase ? 'erase' : ''}`}
            data-testid="paint-preview"
          >
            {preview.cells.map((c) => (
              <rect
                key={cellKey(c)}
                x={c.col}
                y={c.row}
                width={1}
                height={1}
                style={preview.erase ? undefined : { fill: floorColor(props.floorColour) }}
              />
            ))}
          </g>
        )}
        <g data-testid="decorations" data-count={map.decorations.length}>
          {map.decorations.map((d) => (
            <g
              key={d.id}
              className={`decoration ${isSelected('decoration', d.id) ? 'selected' : ''}`}
              data-decoration={d.id}
              data-object-kind="decoration"
              data-object-id={d.id}
            >
              <rect
                x={d.col + 0.04}
                y={d.row + 0.04}
                width={d.width - 0.08}
                height={d.height - 0.08}
                rx={0.12}
                style={{ fill: floorColor(d.color) }}
              />
              {d.label && (
                <text
                  x={d.col + d.width / 2}
                  y={d.row + d.height / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {d.label}
                </text>
              )}
            </g>
          ))}
          {decorationPreview && (
            <rect
              className={`decoration-preview purpose-${decorationPreview.purpose}`}
              data-testid="decoration-preview"
              x={decorationPreview.col}
              y={decorationPreview.row}
              width={decorationPreview.width}
              height={decorationPreview.height}
              style={{ fill: floorColor(props.floorColour) }}
            />
          )}
        </g>
        <g data-testid="reach" data-cells={reachCells.length}>
          {reachCells.map((c) => (
            <rect
              key={cellKey(c)}
              className="reach-cell"
              x={c.col}
              y={c.row}
              width={1}
              height={1}
            />
          ))}
        </g>
        {lines}
        <g className="environment" data-testid="environment">
          {map.zones.map((z) => (
            <g
              key={z.id}
              className={`zone ${isSelected('zone', z.id) ? 'selected' : ''}`}
              data-zone={z.id}
              data-object-kind="zone"
              data-object-id={z.id}
            >
              <rect x={z.col} y={z.row} width={z.width} height={z.height} />
              <text x={z.col + 0.15} y={z.row + 0.45}>
                {z.label || 'трудный ландшафт'}
              </text>
            </g>
          ))}
          {map.obstacles.map((o) => (
            <g
              key={o.id}
              className={`obstacle ${o.blocksMovement ? 'solid' : 'passable'} ${o.blocksVision ? 'opaque' : 'transparent'} ${isSelected('obstacle', o.id) ? 'selected' : ''}`}
              data-obstacle={o.id}
              data-object-kind="obstacle"
              data-object-id={o.id}
            >
              <rect
                x={o.col + 0.03}
                y={o.row + 0.03}
                width={o.width - 0.06}
                height={o.height - 0.06}
              />
              {o.label && (
                <text
                  x={o.col + o.width / 2}
                  y={o.row + o.height / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {o.label}
                </text>
              )}
            </g>
          ))}
          {map.walls.map((w) => (
            <g
              key={w.id}
              className={`wall ${isSelected('wall', w.id) ? 'selected' : ''}`}
              data-wall={w.id}
              data-object-kind="wall"
              data-object-id={w.id}
            >
              <polyline className="hit" points={w.points.map((p) => `${p.x},${p.y}`).join(' ')} />
              <polyline className="line" points={w.points.map((p) => `${p.x},${p.y}`).join(' ')} />
            </g>
          ))}
          {mode === 'editor' &&
            props.tool === 'select' &&
            props.selectedObject?.kind === 'wall' &&
            (() => {
              const wall = map.walls.find((w) => w.id === props.selectedObject!.id);
              if (!wall) return null;
              const moving = drag?.kind === 'wall-end' && drag.wallId === wall.id ? drag : null;
              const points = wall.points.map((p, i) =>
                moving &&
                ((moving.end === 'start' && i === 0) ||
                  (moving.end === 'end' && i === wall.points.length - 1))
                  ? moving.at
                  : p,
              );
              return (
                <g className="wall-ends" data-testid="wall-ends">
                  {moving && (
                    <polyline
                      className="wall-end-preview"
                      points={points.map((p) => `${p.x},${p.y}`).join(' ')}
                    />
                  )}
                  {(['start', 'end'] as const).map((end) => {
                    const p = end === 'start' ? points[0]! : points.at(-1)!;
                    return (
                      <circle
                        key={end}
                        className="wall-end"
                        data-wall-end={end}
                        data-wall-id={wall.id}
                        cx={p.x}
                        cy={p.y}
                        r={0.28}
                      >
                        <title>Перетащите, чтобы перенести конец стены</title>
                      </circle>
                    );
                  })}
                </g>
              );
            })()}
          {map.doors.map((d) => {
            const open = props.doorStates[d.id] ?? d.open;
            return (
              <g
                key={d.id}
                className={`door ${open ? 'open' : 'closed'} ${isSelected('door', d.id) ? 'selected' : ''} ${mode !== 'editor' ? 'toggle' : ''}`}
                data-door={d.id}
                data-open={open}
                data-object-kind="door"
                data-object-id={d.id}
              >
                <line className="hit" x1={d.from.x} y1={d.from.y} x2={d.to.x} y2={d.to.y} />
                <line className="gap" x1={d.from.x} y1={d.from.y} x2={d.to.x} y2={d.to.y} />
                <line className="leaf" x1={d.from.x} y1={d.from.y} x2={d.to.x} y2={d.to.y} />
                <title>
                  {open ? 'Дверь открыта' : 'Дверь закрыта'}
                  {mode === 'placement' ? ' — щёлкните, чтобы переключить' : ''}
                </title>
              </g>
            );
          })}
          {mode === 'editor' &&
            props.tool === 'wall' &&
            (wallPoints.length > 0 || drag?.kind === 'wall-draw') && (
              <g className="wall-draft" data-testid="wall-draft">
                <polyline
                  points={(drag?.kind === 'wall-draw'
                    ? [...(wallPoints.length ? wallPoints : [drag.start]), drag.end]
                    : [
                        ...wallPoints,
                        ...(hover && wallPoints.length
                          ? [straight(wallPoints.at(-1)!, vertexAt(hover))]
                          : []),
                      ]
                  )
                    .map((p) => `${p.x},${p.y}`)
                    .join(' ')}
                />
                {wallPoints.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={0.12} />
                ))}
              </g>
            )}
          {drag?.kind === 'door' && (
            <line
              className="door-draft"
              x1={drag.start.x}
              y1={drag.start.y}
              x2={drag.end.x}
              y2={drag.end.y}
            />
          )}
        </g>
        <rect className="map-border" x={0} y={0} width={map.cols} height={map.rows} />
        {labels}
        <g className="scale-bar" transform={`translate(0 ${map.rows + 0.7})`}>
          <rect x={0} y={0} width={Math.min(5, map.cols)} height={0.16} />
          <rect className="scale-half" x={0} y={0} width={1} height={0.16} />
          <text x={0} y={0.75}>
            0
          </text>
          <text x={Math.min(5, map.cols)} y={0.75} textAnchor="middle">
            {Math.min(5, map.cols)} м
          </text>
          <text x={0} y={1.45}>
            клетка = 1 × 1 м
          </text>
        </g>

        {actorIds(battle).map((id) => {
          const f = fpOf(battle, id);
          const p = positions[id];
          if (!p) return null;
          return (
            <rect
              key={`occ-${id}`}
              className={`occupied ${props.conflicts.has(id) ? 'conflict' : ''}`}
              data-occupied={id}
              data-cells={f.width * f.height}
              {...rectOf(p, f.width, f.height)}
            />
          );
        })}

        {mode === 'editor' && props.calibrationPoints.length > 0 && (
          <g className="calibration" data-testid="calibration">
            {props.calibrationPoints.length === 2 && (
              <>
                <line
                  x1={props.calibrationPoints[0]!.x}
                  y1={props.calibrationPoints[0]!.y}
                  x2={props.calibrationPoints[1]!.x}
                  y2={props.calibrationPoints[1]!.y}
                />
                <text
                  x={(props.calibrationPoints[0]!.x + props.calibrationPoints[1]!.x) / 2}
                  y={(props.calibrationPoints[0]!.y + props.calibrationPoints[1]!.y) / 2 - 0.3}
                  textAnchor="middle"
                >
                  {fmt(distance(props.calibrationPoints[0]!, props.calibrationPoints[1]!))} м по
                  текущему масштабу
                </text>
              </>
            )}
            {props.calibrationPoints.map((pt, i) => (
              <circle key={i} cx={pt.x} cy={pt.y} r={0.18} />
            ))}
          </g>
        )}
        {attack && (
          <g className="attack-line">
            <line x1={attack.a.x} y1={attack.a.y} x2={attack.b.x} y2={attack.b.y} />
            <text
              x={(attack.a.x + attack.b.x) / 2}
              y={(attack.a.y + attack.b.y) / 2 - 0.35}
              textAnchor="middle"
            >
              {fmt(distance(attack.a, attack.b))} м
            </text>
          </g>
        )}

        {moveIntent && positions[moveIntent.actor] && routeSoFar && routeSoFar.length > 0 && (
          <g className="route" data-testid="route">
            <polyline
              points={[positions[moveIntent.actor]!, ...routeSoFar]
                .map((p) => `${p.x},${p.y}`)
                .join(' ')}
            />
            {routeSoFar.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={0.18} />
            ))}
          </g>
        )}
        {(props.smokes ?? []).map((s) => (
          <circle
            key={s.id}
            className="smoke-zone"
            cx={s.x}
            cy={s.y}
            r={s.r}
            fill="rgba(170, 170, 170, 0.45)"
            stroke="rgba(120, 120, 120, 0.8)"
            strokeWidth={0.05}
            strokeDasharray="0.2 0.1"
            pointerEvents="none"
          />
        ))}
        {(props.trails ?? []).map((t) =>
          t.shape.kind === 'circle' ? (
            <circle
              key={t.id}
              className="trail-zone"
              cx={t.shape.x}
              cy={t.shape.y}
              r={t.shape.r}
              fill="rgba(255, 120, 0, 0.18)"
              stroke="rgba(255, 120, 0, 0.6)"
              strokeWidth={0.05}
              pointerEvents="none"
            />
          ) : (
            <path
              key={t.id}
              className="trail-zone"
              d={(() => {
                const s = t.shape;
                const a1 = s.heading - Math.PI / 8,
                  a2 = s.heading + Math.PI / 8;
                return `M ${s.x} ${s.y} L ${s.x + s.range * Math.cos(a1)} ${s.y + s.range * Math.sin(a1)} A ${s.range} ${s.range} 0 0 1 ${s.x + s.range * Math.cos(a2)} ${s.y + s.range * Math.sin(a2)} Z`;
              })()}
              fill="rgba(255, 120, 0, 0.18)"
              stroke="rgba(255, 120, 0, 0.6)"
              strokeWidth={0.05}
              pointerEvents="none"
            />
          ),
        )}
        {props.placingLoose && (
          <circle
            className="loose-range"
            cx={props.placingLoose.from.x}
            cy={props.placingLoose.from.y}
            r={props.placingLoose.max}
            fill="none"
            stroke="currentColor"
            strokeDasharray="0.3 0.2"
            strokeWidth={0.06}
            pointerEvents="none"
          />
        )}
        {(props.loose ?? []).map((w) => (
          <g key={w.id} className="loose-weapon" data-testid="loose-weapon" pointerEvents="none">
            <title>{w.name}</title>
            <rect x={w.x - 0.3} y={w.y - 0.12} width={0.6} height={0.24} rx={0.06} />
            <text x={w.x} y={w.y - 0.25} textAnchor="middle" fontSize={0.3}>
              {w.name}
            </text>
          </g>
        ))}
        {props.fallActor && positions[props.fallActor] && (
          <text
            className="fall-hint"
            x={positions[props.fallActor]!.x}
            y={positions[props.fallActor]!.y - 0.8}
            textAnchor="middle"
          >
            Щёлкните, где упал
          </text>
        )}
        {showGhost && ghost && ghostActor && ghostFrom && (
          <g className={`ghost ${ghostProblem ? 'invalid' : 'valid'}`} data-testid="ghost">
            <line x1={ghostFrom.x} y1={ghostFrom.y} x2={ghost.x} y2={ghost.y} />
            <rect
              {...rectOf(
                ghost,
                fpOf(battle, ghostActor).width - INSET * 2,
                fpOf(battle, ghostActor).height - INSET * 2,
              )}
              rx={0.3}
            />
            <text
              x={ghost.x}
              y={ghost.y - fpOf(battle, ghostActor).height / 2 - 0.25}
              textAnchor="middle"
            >
              {ghostPlan && ghostPlan.difficult > 0 ? 'стоит ' : ''}
              {fmt(ghostDistance)}
              {moveIntent ? ` / ${fmt(moveIntent.maxDistance)}` : ''} м
              {ghostProblem ? ` — ${ghostProblem}` : ''}
            </text>
          </g>
        )}

        {actorIds(battle).map((id) => {
          const f = fpOf(battle, id);
          const pos =
            drag?.kind === 'token' && drag.id === id && mode !== 'combat' ? drag.at : positions[id];
          const w = props.wounds[id];
          if (!pos || !w) return null;
          const ratio = w.max ? clamp(w.current / w.max, 0, 1) : 0;
          const bodyW = f.width - INSET * 2,
            bodyH = f.height - INSET * 2;
          const radius = Math.min(bodyW, bodyH) / 2;
          const barW = bodyW * 0.8;
          const isActive = mode === 'combat' && turnActive && activeActor === id;
          return (
            <g
              key={id}
              data-actor={id}
              className={`token ${selected === id ? 'selected' : ''} ${isActive ? 'active' : ''} ${canDrag(id) ? 'draggable' : ''} ${props.conflicts.has(id) ? 'conflict' : ''}`}
              transform={`translate(${pos.x} ${pos.y})`}
              onPointerDown={(e) => onTokenDown(e, id)}
              role="button"
              aria-label={`${actorName(battle, id)}: раны ${w.current} из ${w.max}, клеток ${f.width * f.height}`}
            >
              {isActive && (
                <rect
                  className="turn-ring"
                  {...rectOf({ x: 0, y: 0 }, f.width + 0.2, f.height + 0.2)}
                  rx={radius + 0.1}
                />
              )}
              <rect
                className="token-body"
                {...rectOf({ x: 0, y: 0 }, bodyW, bodyH)}
                rx={radius}
                style={{ fill: tokenColor(battle, id) }}
              />
              <text className="token-initials" textAnchor="middle" dominantBaseline="central">
                {initials(battle, id)}
              </text>
              <rect
                className="wound-track"
                x={-barW / 2}
                y={bodyH / 2 - 0.16}
                width={barW}
                height={0.08}
              />
              <rect
                className="wound-fill"
                x={-barW / 2}
                y={bodyH / 2 - 0.16}
                width={barW * ratio}
                height={0.08}
              />
              <text className="token-name" y={f.height / 2 + 0.42} textAnchor="middle">
                {actorName(battle, id)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
