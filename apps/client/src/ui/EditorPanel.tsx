import { useEffect, useState } from 'react';
import {
  floorPalette,
  MAP_LIMITS,
  RASTER_LIMITS,
  TERRAIN_TYPES,
  type Decoration,
  type Door,
  type FloorColorId,
  type MapBackground,
  type MapDocument,
  type Obstacle,
  type TerrainZone,
} from '../game/map';
import { MAP_FILE_EXTENSION } from '../game/map-file';
import type { EditorHistory } from '../game/map-editor';
import { actor, type ActorId } from '../game/model';
import type { Point } from '../game/grid';
import type { EditorTool, SelectedObject } from './TacticalMap';

export const toolList: { id: EditorTool; label: string; key: string }[] = [
  { id: 'select', label: 'Выбор', key: 'V' },
  { id: 'hand', label: 'Рука', key: 'H' },
  { id: 'background', label: 'Фон', key: 'G' },
  { id: 'calibrate', label: 'Калибровка', key: 'K' },
  { id: 'brush', label: 'Кисть', key: 'B' },
  { id: 'rect', label: 'Прямоугольник', key: 'R' },
  { id: 'eraser', label: 'Ластик', key: 'E' },
  { id: 'decoration', label: 'Декорация', key: 'D' },
  { id: 'wall', label: 'Стена', key: 'W' },
  { id: 'door', label: 'Дверь', key: 'N' },
  { id: 'obstacle', label: 'Препятствие', key: 'P' },
  { id: 'zone', label: 'Трудный ландшафт', key: 'T' },
];

type DoorPatch = Partial<
  Pick<Door, 'open' | 'blocksMovement' | 'blocksVision' | 'locked' | 'lockModifier' | 'lockOd'>
>;
type ZonePatch = Partial<Pick<TerrainZone, 'label' | 'modifier'>>;
type ObstaclePatch = Partial<Pick<Obstacle, 'label' | 'blocksMovement' | 'blocksVision' | 'notes'>>;

/** Text input committing one undo step on blur or Enter. */
function TextField(props: {
  label: string;
  value: string;
  max: number;
  multiline?: boolean;
  onCommit: (value: string) => void;
}) {
  const [text, setText] = useState(props.value);
  useEffect(() => setText(props.value), [props.value]);
  const commit = () => {
    if (text !== props.value) props.onCommit(text);
  };
  return (
    <label>
      {props.label}
      {props.multiline ? (
        <textarea
          value={text}
          maxLength={props.max}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
        />
      ) : (
        <input
          value={text}
          maxLength={props.max}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
        />
      )}
    </label>
  );
}

/** Properties of the selected wall, door, obstacle or zone. */
function ObjectProperties(props: {
  object: SelectedObject;
  map: MapDocument;
  onUpdateDoor: (id: string, patch: DoorPatch) => void;
  onUpdateObstacle: (id: string, patch: ObstaclePatch) => void;
  onUpdateZone: (id: string, patch: ZonePatch) => void;
  onDelete: (object: SelectedObject) => void;
}) {
  const { object, map } = props;
  if (object.kind === 'wall') {
    const wall = map.walls.find((w) => w.id === object.id);
    if (!wall) return null;
    const doors = map.doors.filter((d) => d.wallId === wall.id);
    const length = wall.points
      .slice(1)
      .reduce(
        (n, p, i) => n + Math.abs(p.x - wall.points[i]!.x) + Math.abs(p.y - wall.points[i]!.y),
        0,
      );
    return (
      <div className="stack" data-testid="object-props">
        <p className="muted small">
          Стена: {wall.points.length - 1} отр., {length} м. Блокирует движение и видимость. Концы
          стены можно перетащить за круглые маркеры; двери на ней должны остаться на прямом участке.
          {doors.length ? ` Двери на ней: ${doors.length}.` : ''}
        </p>
        <button type="button" onClick={() => props.onDelete(object)}>
          {doors.length ? `Удалить стену и её двери (${doors.length})` : 'Удалить стену'}
        </button>
      </div>
    );
  }
  if (object.kind === 'door') {
    const door = map.doors.find((d) => d.id === object.id);
    if (!door) return null;
    return (
      <div className="stack" data-testid="object-props">
        <p className="muted small">
          Дверь ({door.from.x}; {door.from.y}) — ({door.to.x}; {door.to.y}) на стене {door.wallId}.
          Открытая дверь не блокирует ничего; закрытая — по флагам ниже.
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={door.open}
            onChange={(e) => props.onUpdateDoor(door.id, { open: e.target.checked })}
          />
          Открыта в начале сцены
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={door.blocksMovement}
            onChange={(e) => props.onUpdateDoor(door.id, { blocksMovement: e.target.checked })}
          />
          Закрытая блокирует движение
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={door.blocksVision}
            onChange={(e) => props.onUpdateDoor(door.id, { blocksVision: e.target.checked })}
          />
          Закрытая блокирует видимость
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={door.locked}
            onChange={(e) => props.onUpdateDoor(door.id, { locked: e.target.checked })}
          />
          Заперта (персонаж не откроет её Свободным действием)
        </label>
        {door.locked && (
          <div className="row">
            <NumberField
              label="Модификатор взлома"
              value={door.lockModifier}
              step={10}
              min={-60}
              max={60}
              onCommit={(v) => props.onUpdateDoor(door.id, { lockModifier: v })}
            />
            <NumberField
              label="ОД на попытку"
              value={door.lockOd}
              min={0}
              max={10}
              onCommit={(v) => props.onUpdateDoor(door.id, { lockOd: v })}
            />
          </div>
        )}
        <button type="button" onClick={() => props.onDelete(object)}>
          Удалить дверь
        </button>
      </div>
    );
  }
  if (object.kind === 'obstacle') {
    const o = map.obstacles.find((x) => x.id === object.id);
    if (!o) return null;
    return (
      <div className="stack" data-testid="object-props">
        <TextField
          label="Подпись препятствия"
          value={o.label}
          max={MAP_LIMITS.maxLabelLength}
          onCommit={(label) => props.onUpdateObstacle(o.id, { label })}
        />
        <label className="check">
          <input
            type="checkbox"
            checked={o.blocksMovement}
            onChange={(e) => props.onUpdateObstacle(o.id, { blocksMovement: e.target.checked })}
          />
          Блокирует движение
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={o.blocksVision}
            onChange={(e) => props.onUpdateObstacle(o.id, { blocksVision: e.target.checked })}
          />
          Блокирует видимость
        </label>
        <TextField
          label="Заметки (высота, толщина, прочность — без расчёта)"
          value={o.notes}
          max={MAP_LIMITS.maxNotesLength}
          multiline
          onCommit={(notes) => props.onUpdateObstacle(o.id, { notes })}
        />
        <button type="button" onClick={() => props.onDelete(object)}>
          Удалить препятствие
        </button>
      </div>
    );
  }
  if (object.kind === 'zone') {
    const z = map.zones.find((x) => x.id === object.id);
    if (!z) return null;
    return (
      <div className="stack" data-testid="object-props">
        <label>
          Вид местности («Общая механика»)
          <select
            aria-label="Вид местности"
            value={TERRAIN_TYPES.some((t) => t.label === z.label) ? z.label : ''}
            onChange={(e) => {
              const t = TERRAIN_TYPES.find((x) => x.label === e.target.value);
              if (t) props.onUpdateZone(z.id, { label: t.label, modifier: t.modifier });
            }}
          >
            <option value="">— своя —</option>
            {TERRAIN_TYPES.map((t) => (
              <option key={t.label} value={t.label}>
                {t.label} ({t.modifier >= 0 ? '+' : ''}
                {t.modifier})
              </option>
            ))}
          </select>
        </label>
        <TextField
          label="Подпись зоны"
          value={z.label}
          max={MAP_LIMITS.maxLabelLength}
          onCommit={(label) => props.onUpdateZone(z.id, { label })}
        />
        <NumberField
          label="Модификатор теста ЛВ при беге"
          value={z.modifier}
          step={10}
          min={-60}
          max={60}
          onCommit={(modifier) => props.onUpdateZone(z.id, { modifier })}
        />
        <p className="muted small">
          Метр по зоне стоит 2 м движения. При Беге, Натиске и Спринте — тест ЛВ с этим
          модификатором; провал — падение, место укажет ведущий.
        </p>
        <button type="button" onClick={() => props.onDelete(object)}>
          Удалить зону
        </button>
      </div>
    );
  }
  return null;
}

/** A number input that commits one undo step on blur or Enter, not on every keystroke. */
function NumberField(props: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(props.value));
  useEffect(() => setText(String(props.value)), [props.value]);
  const commit = () => {
    const n = Number(text);
    if (text.trim() !== '' && Number.isFinite(n) && n !== props.value) props.onCommit(n);
    else setText(String(props.value));
  };
  return (
    <label>
      {props.label}
      <input
        type="number"
        step={props.step ?? 'any'}
        min={props.min}
        max={props.max}
        value={text}
        disabled={props.disabled}
        aria-label={props.label}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
    </label>
  );
}

export function EditorPanel(props: {
  history: EditorHistory;
  /** Name of the map applied to the scene; a new map does not silently reuse it. */
  appliedName: string;
  problems: {
    map: string[];
    tokens: { actor: ActorId; problem: string }[];
    stale: { actor: ActorId; draft: Point; scene: Point }[];
  };
  dirty: boolean;
  tool: EditorTool;
  colour: FloorColorId;
  onTool: (tool: EditorTool) => void;
  onColour: (colour: FloorColorId) => void;
  onRename: (name: string) => void;
  onResize: (cols: number, rows: number) => void;
  onNewEmpty: (name: string, cols: number, rows: number) => void;
  onEraseOutside: () => void;
  onKeepDraft: (id: ActorId) => void;
  onTakeScene: (id: ActorId) => void;
  onUndo: () => void;
  onRedo: () => void;
  onApply: () => void;
  onDiscard: () => void;
  background: MapBackground | null;
  onLoadBackground: (file: File) => void;
  onUpdateBackground: (
    patch: Partial<Pick<MapBackground, 'x' | 'y' | 'metersPerPixel' | 'opacity' | 'locked'>>,
  ) => void;
  onRemoveBackground: () => void;
  calibrationPoints: number;
  onCalibrate: (meters: number) => void;
  onResetCalibration: () => void;
  selectedDecoration: Decoration | null;
  newDecorationLabel: string;
  onNewDecorationLabel: (label: string) => void;
  onUpdateDecoration: (patch: Partial<Pick<Decoration, 'label' | 'color'>>) => void;
  onRemoveDecoration: () => void;
  onSaveFile: () => void;
  onOpenFile: (file: File) => void;
  selectedObject: SelectedObject | null;
  map: MapDocument;
  newObstacle: { label: string; blocksMovement: boolean; blocksVision: boolean };
  onNewObstacle: (value: { label: string; blocksMovement: boolean; blocksVision: boolean }) => void;
  onUpdateDoor: (id: string, patch: DoorPatch) => void;
  onUpdateObstacle: (id: string, patch: ObstaclePatch) => void;
  onUpdateZone: (id: string, patch: ZonePatch) => void;
  onDeleteObject: (object: SelectedObject) => void;
}) {
  const [calibrationMeters, setCalibrationMeters] = useState('');
  const [decorationText, setDecorationText] = useState('');
  useEffect(
    () => setDecorationText(props.selectedDecoration?.label ?? ''),
    [props.selectedDecoration?.id, props.selectedDecoration?.label],
  );
  const map = props.history.present.map;
  const [name, setName] = useState(map.name);
  const [cols, setCols] = useState(String(map.cols));
  const [rows, setRows] = useState(String(map.rows));
  // Keep the fields in step with undo/redo and applied drafts.
  useEffect(() => {
    setName(map.name);
    setCols(String(map.cols));
    setRows(String(map.rows));
  }, [map.name, map.cols, map.rows]);

  const commitName = () => {
    if (name !== map.name) props.onRename(name);
  };
  const blocking =
    props.problems.map.length + props.problems.tokens.length + props.problems.stale.length;
  const cell = (p: Point) => `${p.x - 0.5}, ${p.y - 0.5}`;
  const floorOutside = props.problems.map.some(
    (p) => p.startsWith('Разметка пола выходит') || p.startsWith('Декорации выходят'),
  );
  const bg = props.background;

  return (
    <section className="panel editor" aria-label="Редактор карты">
      <span className="eyebrow">Редактор карты · черновик</span>
      <label>
        Название
        <input
          value={name}
          maxLength={MAP_LIMITS.maxNameLength + 20}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitName();
          }}
        />
      </label>
      <div className="size-row">
        <label>
          Ширина, кл.
          <input
            type="number"
            min={MAP_LIMITS.minCells}
            max={MAP_LIMITS.maxCells}
            step={1}
            value={cols}
            onChange={(e) => setCols(e.target.value)}
            aria-label="Ширина карты"
          />
        </label>
        <label>
          Высота, кл.
          <input
            type="number"
            min={MAP_LIMITS.minCells}
            max={MAP_LIMITS.maxCells}
            step={1}
            value={rows}
            onChange={(e) => setRows(e.target.value)}
            aria-label="Высота карты"
          />
        </label>
      </div>
      <div className="row">
        <button type="button" onClick={() => props.onResize(Number(cols), Number(rows))}>
          Изменить размер
        </button>
        <button
          type="button"
          onClick={() =>
            props.onNewEmpty(
              name.trim() === props.appliedName ? `Новая карта ${cols} × ${rows}` : name,
              Number(cols),
              Number(rows),
            )
          }
        >
          Новая пустая карта
        </button>
      </div>
      <p className="muted small">
        Клетка 1 × 1 м, от {MAP_LIMITS.minCells} до {MAP_LIMITS.maxCells} клеток по каждой оси.
        Размер меняется без обрезания разметки и без переноса токенов.
      </p>

      <h3>Инструменты</h3>
      <div className="tools" role="toolbar" aria-label="Инструменты редактора">
        {toolList.map((t) => (
          <button
            key={t.id}
            type="button"
            className={props.tool === t.id ? 'chosen' : ''}
            aria-pressed={props.tool === t.id}
            onClick={() => props.onTool(t.id)}
            title={`Клавиша ${t.key}`}
          >
            {t.label} <kbd>{t.key}</kbd>
          </button>
        ))}
      </div>
      <p className="muted small">Пол, декорации и подложка — только визуальные слои.</p>
      <div className="palette" role="radiogroup" aria-label="Цвет разметки">
        {floorPalette.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={props.colour === c.id}
            className={`swatch ${props.colour === c.id ? 'chosen' : ''}`}
            style={{ background: c.color }}
            onClick={() => props.onColour(c.id)}
            title={c.label}
          >
            <span className="sr-only">{c.label}</span>
          </button>
        ))}
      </div>
      <div className="row">
        <button type="button" onClick={props.onUndo} disabled={!props.history.past.length}>
          Отменить шаг <kbd>Ctrl+Z</kbd>
        </button>
        <button type="button" onClick={props.onRedo} disabled={!props.history.future.length}>
          Повторить <kbd>Ctrl+Y</kbd>
        </button>
      </div>

      <h3>Окружение</h3>
      {props.selectedObject && props.selectedObject.kind !== 'decoration' ? (
        <ObjectProperties
          object={props.selectedObject}
          map={props.map}
          onUpdateDoor={props.onUpdateDoor}
          onUpdateObstacle={props.onUpdateObstacle}
          onUpdateZone={props.onUpdateZone}
          onDelete={props.onDeleteObject}
        />
      ) : (
        <div className="stack">
          <p className="muted small">
            Стены: {props.map.walls.length} · двери: {props.map.doors.length} · препятствия:{' '}
            {props.map.obstacles.length} · зоны: {props.map.zones.length}. Выберите объект
            инструментом «Выбор», чтобы изменить или удалить его.
          </p>
          <label>
            Подпись нового препятствия
            <input
              value={props.newObstacle.label}
              maxLength={MAP_LIMITS.maxLabelLength}
              placeholder="например, Ящики"
              aria-label="Подпись нового препятствия"
              onChange={(e) => props.onNewObstacle({ ...props.newObstacle, label: e.target.value })}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={props.newObstacle.blocksMovement}
              onChange={(e) =>
                props.onNewObstacle({ ...props.newObstacle, blocksMovement: e.target.checked })
              }
            />
            Новое препятствие блокирует движение
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={props.newObstacle.blocksVision}
              aria-label="Новое препятствие блокирует видимость"
              onChange={(e) =>
                props.onNewObstacle({ ...props.newObstacle, blocksVision: e.target.checked })
              }
            />
            Новое препятствие блокирует видимость
          </label>
        </div>
      )}

      <h3>Декорация</h3>
      {props.selectedDecoration ? (
        <div className="stack" data-testid="decoration-props">
          <label>
            Подпись выбранной декорации
            <input
              value={decorationText}
              maxLength={MAP_LIMITS.maxLabelLength}
              onChange={(e) => setDecorationText(e.target.value)}
              onBlur={() => {
                if (decorationText !== props.selectedDecoration!.label)
                  props.onUpdateDecoration({ label: decorationText });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') props.onUpdateDecoration({ label: decorationText });
              }}
            />
          </label>
          <div className="row">
            <button type="button" onClick={() => props.onUpdateDecoration({ color: props.colour })}>
              Применить выбранный цвет
            </button>
            <button type="button" onClick={props.onRemoveDecoration}>
              Удалить декорацию
            </button>
          </div>
        </div>
      ) : (
        <label>
          Подпись новой декорации
          <input
            value={props.newDecorationLabel}
            maxLength={MAP_LIMITS.maxLabelLength}
            placeholder="например, Ковёр"
            onChange={(e) => props.onNewDecorationLabel(e.target.value)}
          />
        </label>
      )}

      <h3>Подложка</h3>
      <label className="file-button">
        {bg ? 'Заменить изображение…' : 'Загрузить изображение…'}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="Файл подложки"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) props.onLoadBackground(file);
          }}
        />
      </label>
      <p className="muted small">
        PNG, JPEG или WebP: до {RASTER_LIMITS.maxBytes / 1024 / 1024} МиБ, до{' '}
        {RASTER_LIMITS.maxSide} пикс. по стороне, до {RASTER_LIMITS.maxPixels.toLocaleString('ru')}{' '}
        пикс. всего. Формат проверяется по содержимому.
      </p>
      {bg && (
        <div className="stack" data-testid="background-props">
          <p className="muted small">
            {bg.mime}, {bg.widthPx} × {bg.heightPx} пикс. · на карте{' '}
            {Number((bg.widthPx * bg.metersPerPixel).toFixed(2))} ×{' '}
            {Number((bg.heightPx * bg.metersPerPixel).toFixed(2))} м
          </p>
          <div className="size-row">
            <NumberField
              label="Фон X, м"
              value={bg.x}
              step={0.1}
              disabled={bg.locked}
              onCommit={(x) => props.onUpdateBackground({ x })}
            />
            <NumberField
              label="Фон Y, м"
              value={bg.y}
              step={0.1}
              disabled={bg.locked}
              onCommit={(y) => props.onUpdateBackground({ y })}
            />
          </div>
          <NumberField
            label="Масштаб, м на пиксель"
            value={bg.metersPerPixel}
            step={0.001}
            min={0}
            disabled={bg.locked}
            onCommit={(metersPerPixel) => props.onUpdateBackground({ metersPerPixel })}
          />
          <NumberField
            label="Непрозрачность (0–1)"
            value={bg.opacity}
            step={0.1}
            min={0}
            max={1}
            onCommit={(opacity) => props.onUpdateBackground({ opacity })}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={bg.locked}
              onChange={(e) => props.onUpdateBackground({ locked: e.target.checked })}
            />
            Заблокировать подложку
          </label>
          <div className="calibration-box">
            <strong>Калибровка по двум точкам</strong>
            <p className="muted small">
              Инструмент «Калибровка» (K): щёлкните концы отрезка известной длины на изображении.
              Отмечено точек: {props.calibrationPoints}/2.
            </p>
            <div className="row">
              <label>
                Известная дистанция, м
                <input
                  type="number"
                  step="any"
                  min={0}
                  value={calibrationMeters}
                  aria-label="Известная дистанция, м"
                  onChange={(e) => setCalibrationMeters(e.target.value)}
                />
              </label>
            </div>
            <div className="row">
              <button
                type="button"
                disabled={props.calibrationPoints < 2 || bg.locked}
                onClick={() => props.onCalibrate(Number(calibrationMeters))}
              >
                Применить калибровку
              </button>
              <button
                type="button"
                disabled={props.calibrationPoints === 0}
                onClick={props.onResetCalibration}
              >
                Сбросить точки
              </button>
            </div>
          </div>
          <button type="button" onClick={props.onRemoveBackground}>
            Убрать подложку
          </button>
        </div>
      )}

      <h3>Файл карты</h3>
      <div className="row">
        <button type="button" onClick={props.onSaveFile}>
          Сохранить карту в файл
        </button>
        <label className="file-button">
          Открыть файл карты…
          <input
            type="file"
            accept={`${MAP_FILE_EXTENSION},application/json,.json`}
            aria-label="Файл карты"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) props.onOpenFile(file);
            }}
          />
        </label>
      </div>
      <p className="muted small">
        Сохраняется черновик, как он виден в редакторе, вместе с изображением подложки (
        {MAP_FILE_EXTENSION}). Открытый файл становится черновиком; при ошибке текущая карта не
        меняется.
      </p>

      {blocking > 0 && (
        <div className="problems" role="alert">
          <strong>Нельзя применить ({blocking}):</strong>
          <ul>
            {props.problems.map.map((p) => (
              <li key={p}>{p}</li>
            ))}
            {props.problems.tokens.map((t) => (
              <li key={t.actor}>
                {actor(t.actor).name}: {t.problem}. Перетащите токен на свободные клетки внутри
                карты.
              </li>
            ))}
          </ul>
          {props.problems.stale.map((s) => (
            <div key={s.actor} className="stale" data-stale={s.actor}>
              <p>
                {actor(s.actor).name} перемещён и в черновике (около клетки {cell(s.draft)}), и в
                расстановке (около клетки {cell(s.scene)}). Какую позицию оставить?
              </p>
              <div className="row">
                <button type="button" onClick={() => props.onKeepDraft(s.actor)}>
                  Из черновика
                </button>
                <button type="button" onClick={() => props.onTakeScene(s.actor)}>
                  Из расстановки
                </button>
              </div>
            </div>
          ))}
          {floorOutside && (
            <button type="button" onClick={props.onEraseOutside}>
              Стереть разметку и декорации за границами
            </button>
          )}
        </div>
      )}

      <div className="row">
        <button
          type="button"
          className="primary"
          onClick={props.onApply}
          disabled={!props.dirty || blocking > 0}
        >
          Применить карту
        </button>
        <button type="button" onClick={props.onDiscard} disabled={!props.dirty}>
          Отменить изменения
        </button>
      </div>
      <p className="muted small">
        {props.dirty
          ? 'Черновик не применён: бой и расстановка пока используют прежнюю карту.'
          : 'Черновик совпадает с применённой картой.'}
      </p>
    </section>
  );
}
