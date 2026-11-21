import { useEffect, useState } from 'react';
import { floorPalette, MAP_LIMITS, type FloorColorId } from '../game/map';
import type { EditorHistory } from '../game/map-editor';
import { actor, type ActorId } from '../game/model';
import type { Point } from '../game/grid';
import type { EditorTool } from './TacticalMap';

export const toolList: { id: EditorTool; label: string; key: string }[] = [
  { id: 'brush', label: 'Кисть', key: 'B' },
  { id: 'rect', label: 'Прямоугольник', key: 'R' },
  { id: 'eraser', label: 'Ластик', key: 'E' },
  { id: 'hand', label: 'Рука', key: 'H' },
];

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
}) {
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
  const floorOutside = props.problems.map.some((p) => p.startsWith('Разметка пола выходит'));

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

      <h3>Разметка пола (только визуальная)</h3>
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
              Стереть разметку за границами
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
