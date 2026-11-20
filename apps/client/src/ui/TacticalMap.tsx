import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { actor, ids, type ActorId, type Battle } from '../game/model';

export const MAP_METERS = 20;
const MARGIN = 1.6;
const TOKEN_RADIUS = 0.5;
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;

export interface MoveIntent {
  actor: ActorId;
  modeLabel: string;
  maxDistance: number;
}
interface Props {
  battle: Battle;
  selected: ActorId | null;
  activeActor: ActorId;
  turnActive: boolean;
  setupMode: boolean;
  moveIntent: MoveIntent | null;
  attackLine: { from: ActorId; to: ActorId } | null;
  wounds: Record<ActorId, { current: number; max: number }>;
  onSelect: (id: ActorId) => void;
  onMove: (id: ActorId, x: number, y: number) => void;
  onPlace: (id: ActorId, x: number, y: number) => void;
}
type Point = { x: number; y: number };
type Drag =
  | { kind: 'token'; id: ActorId; pointer: number; offset: Point; at: Point }
  | { kind: 'pan'; pointer: number; start: Point; center: Point };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clampMap = (p: Point): Point => ({
  x: clamp(p.x, 0, MAP_METERS),
  y: clamp(p.y, 0, MAP_METERS),
});
const round = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => `${Number(n.toFixed(2))}`;
const tokenColor = (id: ActorId) => (id === 'pak' ? 'var(--token-b)' : 'var(--token-a)');
const initials = (id: ActorId) =>
  actor(id)
    .name.split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2);

export function TacticalMap(props: Props) {
  const { battle, selected, activeActor, turnActive, setupMode, moveIntent, attackLine } = props;
  const svg = useRef<SVGSVGElement>(null);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<Point>({ x: MAP_METERS / 2, y: MAP_METERS / 2 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<Point | null>(null);

  const size = (MAP_METERS + MARGIN * 2) / zoom;
  const view = { x: center.x - size / 2, y: center.y - size / 2, size };

  const toMap = (clientX: number, clientY: number): Point => {
    const el = svg.current!;
    const p = el.createSVGPoint();
    p.x = clientX;
    p.y = clientY;
    const m = p.matrixTransform(el.getScreenCTM()!.inverse());
    return { x: m.x, y: m.y };
  };
  const clampCenter = (c: Point, z: number): Point => {
    const half = (MAP_METERS + MARGIN * 2) / z / 2;
    const lo = half - MARGIN,
      hi = MAP_METERS + MARGIN - half;
    return lo > hi
      ? { x: MAP_METERS / 2, y: MAP_METERS / 2 }
      : { x: clamp(c.x, lo, hi), y: clamp(c.y, lo, hi) };
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
      const focus = (() => {
        const p = el.createSVGPoint();
        p.x = e.clientX;
        p.y = e.clientY;
        const m = p.matrixTransform(el.getScreenCTM()!.inverse());
        return { x: m.x, y: m.y };
      })();
      zoomRef.current(zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2), focus);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom]);

  const canDrag = (id: ActorId) =>
    setupMode || (turnActive && id === activeActor && moveIntent?.actor === id);

  const onTokenDown = (e: ReactPointerEvent, id: ActorId) => {
    e.stopPropagation();
    props.onSelect(id);
    if (!canDrag(id)) return;
    const p = toMap(e.clientX, e.clientY);
    const pos = battle.positions[id];
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
      setDrag({ ...drag, at: clampMap({ x: p.x - drag.offset.x, y: p.y - drag.offset.y }) });
    } else {
      const rect = svg.current!.getBoundingClientRect();
      const perPixel = view.size / Math.min(rect.width, rect.height);
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
        const pos = battle.positions[drag.id];
        const target = { x: round(drag.at.x), y: round(drag.at.y) };
        if (Math.hypot(target.x - pos.x, target.y - pos.y) > 0.01) {
          if (setupMode) props.onPlace(drag.id, target.x, target.y);
          else props.onMove(drag.id, target.x, target.y);
        }
      }
      setDrag(null);
      return;
    }
    if (moveIntent && (e.target as Element).closest('[data-actor]') === null) {
      const p = toMap(e.clientX, e.clientY);
      if (p.x < 0 || p.y < 0 || p.x > MAP_METERS || p.y > MAP_METERS) return;
      props.onMove(moveIntent.actor, round(p.x), round(p.y));
    }
  };

  // Movement preview: either the dragged token or the hovered point in move mode.
  const mover = moveIntent ? battle.positions[moveIntent.actor] : null;
  const ghost =
    drag?.kind === 'token' && !setupMode
      ? drag.at
      : moveIntent && hover && !drag
        ? clampMap(hover)
        : null;
  const ghostDistance = mover && ghost ? Math.hypot(ghost.x - mover.x, ghost.y - mover.y) : 0;
  const ghostValid = moveIntent ? ghostDistance <= moveIntent.maxDistance + 1e-9 : true;

  const lines = [];
  for (let i = 0; i <= MAP_METERS; i++) {
    const major = i % 5 === 0;
    const cls = major ? 'grid-major' : 'grid-minor';
    lines.push(<line key={`v${i}`} className={cls} x1={i} y1={0} x2={i} y2={MAP_METERS} />);
    lines.push(<line key={`h${i}`} className={cls} x1={0} y1={i} x2={MAP_METERS} y2={i} />);
  }
  const labels = [0, 5, 10, 15, 20].flatMap((i) => [
    <text key={`lx${i}`} className="axis-label" x={i} y={-0.55} textAnchor="middle">
      {i}
    </text>,
    <text key={`ly${i}`} className="axis-label" x={-0.55} y={i + 0.18} textAnchor="end">
      {i}
    </text>,
  ]);

  const attack = attackLine
    ? { a: battle.positions[attackLine.from], b: battle.positions[attackLine.to] }
    : null;

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
            setCenter({ x: MAP_METERS / 2, y: MAP_METERS / 2 });
          }}
        >
          Вся карта
        </button>
        <span className="map-hint">
          {setupMode
            ? 'Расстановка: перетаскивайте токены (до начала боя)'
            : moveIntent
              ? `«${moveIntent.modeLabel}»: щёлкните точку или перетащите токен`
              : 'Щёлкните токен, чтобы выбрать персонажа'}
        </span>
        {hover &&
          hover.x >= 0 &&
          hover.y >= 0 &&
          hover.x <= MAP_METERS &&
          hover.y <= MAP_METERS && (
            <span className="coords">
              x {fmt(hover.x)} · y {fmt(hover.y)} м
            </span>
          )}
      </div>
      <svg
        ref={svg}
        className={`map ${moveIntent ? 'is-targeting' : ''} ${drag?.kind === 'pan' ? 'is-panning' : ''}`}
        viewBox={`${view.x} ${view.y} ${view.size} ${view.size}`}
        role="application"
        aria-label="Тактическая карта 20 × 20 метров"
        onPointerDown={onBackgroundDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onPointerCancel={() => setDrag(null)}
      >
        <rect className="map-floor" x={0} y={0} width={MAP_METERS} height={MAP_METERS} />
        {lines}
        <rect className="map-border" x={0} y={0} width={MAP_METERS} height={MAP_METERS} />
        {labels}
        <g className="scale-bar" transform={`translate(0 ${MAP_METERS + 0.7})`}>
          <rect x={0} y={0} width={5} height={0.16} />
          <rect className="scale-half" x={0} y={0} width={1} height={0.16} />
          <text x={0} y={0.75}>
            0
          </text>
          <text x={1} y={0.75} textAnchor="middle">
            1
          </text>
          <text x={5} y={0.75} textAnchor="middle">
            5 м
          </text>
          <text x={MAP_METERS} y={0.75} textAnchor="end">
            клетка = 1 × 1 м
          </text>
        </g>

        {attack && (
          <g className="attack-line">
            <line x1={attack.a.x} y1={attack.a.y} x2={attack.b.x} y2={attack.b.y} />
            <text
              x={(attack.a.x + attack.b.x) / 2}
              y={(attack.a.y + attack.b.y) / 2 - 0.35}
              textAnchor="middle"
            >
              {fmt(Math.hypot(attack.a.x - attack.b.x, attack.a.y - attack.b.y))} м
            </text>
          </g>
        )}

        {moveIntent && mover && (
          <circle
            className="reach"
            cx={mover.x}
            cy={mover.y}
            r={moveIntent.maxDistance}
            data-testid="reach"
          />
        )}
        {moveIntent && mover && ghost && (
          <g className={`ghost ${ghostValid ? 'valid' : 'invalid'}`}>
            <line x1={mover.x} y1={mover.y} x2={ghost.x} y2={ghost.y} />
            <circle cx={ghost.x} cy={ghost.y} r={TOKEN_RADIUS} />
            <text x={ghost.x} y={ghost.y - TOKEN_RADIUS - 0.3} textAnchor="middle">
              {fmt(ghostDistance)} / {fmt(moveIntent.maxDistance)} м
            </text>
          </g>
        )}

        {ids.map((id) => {
          const pos =
            drag?.kind === 'token' && drag.id === id && setupMode ? drag.at : battle.positions[id];
          const w = props.wounds[id];
          const ratio = w.max ? clamp(w.current / w.max, 0, 1) : 0;
          const circumference = 2 * Math.PI * (TOKEN_RADIUS + 0.12);
          return (
            <g
              key={id}
              data-actor={id}
              className={`token ${selected === id ? 'selected' : ''} ${turnActive && activeActor === id ? 'active' : ''} ${canDrag(id) ? 'draggable' : ''}`}
              transform={`translate(${pos.x} ${pos.y})`}
              onPointerDown={(e) => onTokenDown(e, id)}
              role="button"
              aria-label={`${actor(id).name}: раны ${w.current} из ${w.max}`}
            >
              {turnActive && activeActor === id && (
                <circle className="turn-ring" r={TOKEN_RADIUS + 0.38} />
              )}
              <circle className="wound-track" r={TOKEN_RADIUS + 0.12} />
              <circle
                className="wound-arc"
                r={TOKEN_RADIUS + 0.12}
                strokeDasharray={`${circumference * ratio} ${circumference}`}
                transform="rotate(-90)"
              />
              <circle className="token-body" r={TOKEN_RADIUS} style={{ fill: tokenColor(id) }} />
              <text className="token-initials" textAnchor="middle" dominantBaseline="central">
                {initials(id)}
              </text>
              <text className="token-name" y={TOKEN_RADIUS + 0.62} textAnchor="middle">
                {actor(id).name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
