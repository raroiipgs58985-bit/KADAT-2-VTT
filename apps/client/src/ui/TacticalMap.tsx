import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { cellKey, cellsOf, distance, snapCenter, type Cell, type Point } from '../game/grid';
import { floorColor, type FloorColorId, type MapDocument } from '../game/map';
import { rectangleCells } from '../game/map-editor';
import {
  actor,
  destinationsWithin,
  ids,
  placementProblemFor,
  type ActorId,
  type Battle,
} from '../game/model';

const MARGIN = 1.6;
const INSET = 0.08;
const MIN_ZOOM = 1;
const MAX_ZOOM = 12;

export type SceneMode = 'editor' | 'placement' | 'combat';
export type EditorTool = 'brush' | 'rect' | 'eraser' | 'hand';
export interface MoveIntent {
  actor: ActorId;
  modeLabel: string;
  maxDistance: number;
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
  onMove: (id: ActorId, x: number, y: number) => void;
  onPlace: (id: ActorId, x: number, y: number) => void;
  onDraftPlace: (id: ActorId, x: number, y: number) => void;
  onPaint: (cells: Cell[], colour: FloorColorId | null) => void;
}
type Drag =
  | { kind: 'token'; id: ActorId; pointer: number; offset: Point; at: Point }
  | { kind: 'pan'; pointer: number; start: Point; center: Point }
  | { kind: 'brush'; pointer: number; erase: boolean; cells: Map<string, Cell> }
  | { kind: 'rect'; pointer: number; start: Cell; end: Cell };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const fmt = (n: number) => `${Number(n.toFixed(2))}`;
const tokenColor = (id: ActorId) => (id === 'pak' ? 'var(--token-b)' : 'var(--token-a)');
const initials = (id: ActorId) =>
  actor(id)
    .name.split(' ')
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
    for (const id of ids) {
      const f = battle.footprints[id];
      const p = positions[id];
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
    () => (moveIntent ? destinationsWithin(battle, moveIntent.actor, moveIntent.maxDistance) : []),
    // `battle` is mutated in place; `version` makes the highlight follow every change.
    [battle, version, moveIntent?.actor, moveIntent?.maxDistance],
  );
  const destinationKeys = useMemo(
    () => new Set(destinations.map((d) => `${d.x}:${d.y}`)),
    [destinations],
  );
  const reachCells = useMemo(() => {
    if (!moveIntent) return [];
    const f = battle.footprints[moveIntent.actor];
    const cells = new Map<string, Cell>();
    for (const d of destinations) for (const c of cellsOf(d, f)) cells.set(cellKey(c), c);
    return [...cells.values()];
  }, [battle, destinations, moveIntent]);

  const canDrag = (id: ActorId) =>
    mode === 'editor' ||
    mode === 'placement' ||
    (turnActive && id === activeActor && moveIntent?.actor === id);
  const snapFor = (id: ActorId, p: Point) => snapCenter(p, battle.footprints[id], map);

  const onTokenDown = (e: ReactPointerEvent, id: ActorId) => {
    e.stopPropagation();
    props.onSelect(id);
    if (!canDrag(id)) return;
    const p = toMap(e.clientX, e.clientY);
    const pos = positions[id];
    svg.current!.setPointerCapture(e.pointerId);
    setDrag({
      kind: 'token',
      id,
      pointer: e.pointerId,
      offset: { x: p.x - pos.x, y: p.y - pos.y },
      at: pos,
    });
  };
  const onBackgroundDown = (e: ReactPointerEvent) => {
    const p = toMap(e.clientX, e.clientY);
    if (mode === 'editor' && props.tool !== 'hand') {
      if (!inMap(p)) return;
      svg.current!.setPointerCapture(e.pointerId);
      const cell = cellAt(p);
      if (props.tool === 'rect')
        setDrag({ kind: 'rect', pointer: e.pointerId, start: cell, end: cell });
      else
        setDrag({
          kind: 'brush',
          pointer: e.pointerId,
          erase: props.tool === 'eraser',
          cells: new Map([[cellKey(cell), cell]]),
        });
      return;
    }
    if (moveIntent) return; // A click chooses the destination (handled on pointer up).
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
        if (drag.at.x !== pos.x || drag.at.y !== pos.y) {
          if (mode === 'editor') props.onDraftPlace(drag.id, drag.at.x, drag.at.y);
          else if (mode === 'placement') props.onPlace(drag.id, drag.at.x, drag.at.y);
          else props.onMove(drag.id, drag.at.x, drag.at.y);
        }
      } else if (drag.kind === 'brush') {
        props.onPaint([...drag.cells.values()], drag.erase ? null : props.floorColour);
      } else if (drag.kind === 'rect') {
        props.onPaint(rectangleCells(drag.start, drag.end), props.floorColour);
      }
      setDrag(null);
      return;
    }
    if (moveIntent && (e.target as Element).closest('[data-actor]') === null) {
      const p = toMap(e.clientX, e.clientY);
      if (!inMap(p)) return;
      const target = snapFor(moveIntent.actor, p);
      props.onMove(moveIntent.actor, target.x, target.y);
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
  const ghostFrom = ghostActor ? positions[ghostActor] : null;
  const ghostDistance = ghost && ghostFrom ? distance(ghost, ghostFrom) : 0;
  const ghostProblem =
    ghost && ghostActor && mode !== 'editor'
      ? mode === 'placement'
        ? placementProblemFor(battle, ghostActor, ghost)
        : moveIntent && !destinationKeys.has(`${ghost.x}:${ghost.y}`)
          ? (placementProblemFor(battle, ghostActor, ghost) ??
            (ghostDistance === 0 ? 'текущая позиция' : 'дальше допустимого'))
          : null
      : null;
  const showGhost =
    ghost && ghostActor && ghostFrom && (ghost.x !== ghostFrom.x || ghost.y !== ghostFrom.y);

  // Paint preview of the gesture in progress.
  const preview: { cells: Cell[]; erase: boolean } | null =
    drag?.kind === 'brush'
      ? { cells: [...drag.cells.values()], erase: drag.erase }
      : drag?.kind === 'rect'
        ? { cells: rectangleCells(drag.start, drag.end), erase: false }
        : null;

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
  const attack = attackLine ? { a: positions[attackLine.from], b: positions[attackLine.to] } : null;
  const hoverCell = hover && inMap(hover) ? cellAt(hover) : null;
  const hint =
    mode === 'editor'
      ? props.tool === 'hand'
        ? 'Рука: перетаскивайте карту; токены — в пределах черновика'
        : props.tool === 'rect'
          ? 'Прямоугольник: зажмите и протяните; Escape — отмена'
          : props.tool === 'eraser'
            ? 'Ластик: проведите по клеткам; Escape — отмена'
            : 'Кисть: проведите по клеткам; Escape — отмена'
      : mode === 'placement'
        ? 'Расстановка: перетаскивайте токены по клеткам (до начала боя)'
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
        <span className="coords">
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
        <rect className="map-floor" x={0} y={0} width={map.cols} height={map.rows} />
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

        {ids.map((id) => {
          const f = battle.footprints[id];
          return (
            <rect
              key={`occ-${id}`}
              className={`occupied ${props.conflicts.has(id) ? 'conflict' : ''}`}
              data-occupied={id}
              data-cells={f.width * f.height}
              {...rectOf(positions[id], f.width, f.height)}
            />
          );
        })}

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

        {showGhost && ghost && ghostActor && ghostFrom && (
          <g className={`ghost ${ghostProblem ? 'invalid' : 'valid'}`} data-testid="ghost">
            <line x1={ghostFrom.x} y1={ghostFrom.y} x2={ghost.x} y2={ghost.y} />
            <rect
              {...rectOf(
                ghost,
                battle.footprints[ghostActor].width - INSET * 2,
                battle.footprints[ghostActor].height - INSET * 2,
              )}
              rx={0.3}
            />
            <text
              x={ghost.x}
              y={ghost.y - battle.footprints[ghostActor].height / 2 - 0.25}
              textAnchor="middle"
            >
              {fmt(ghostDistance)}
              {moveIntent ? ` / ${fmt(moveIntent.maxDistance)}` : ''} м
              {ghostProblem ? ` — ${ghostProblem}` : ''}
            </text>
          </g>
        )}

        {ids.map((id) => {
          const f = battle.footprints[id];
          const pos =
            drag?.kind === 'token' && drag.id === id && mode !== 'combat' ? drag.at : positions[id];
          const w = props.wounds[id];
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
              aria-label={`${actor(id).name}: раны ${w.current} из ${w.max}, клеток ${f.width * f.height}`}
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
                style={{ fill: tokenColor(id) }}
              />
              <text className="token-initials" textAnchor="middle" dominantBaseline="central">
                {initials(id)}
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
                {actor(id).name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
