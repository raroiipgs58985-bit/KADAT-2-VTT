import { useState } from 'react';
import type { BleedingActivity } from '@kadat/contracts';
import {
  weaponSupport,
  type MoveMode,
  type MoveOption,
  type turnInfo as TurnInfoFn,
} from '../game/engine';
import { describeEntry, type JournalTone } from '../game/journal';
import { actor, ids, weapons, type ActorId, type Battle, type WeaponId } from '../game/model';

type TurnInfo = ReturnType<typeof TurnInfoFn>;

export type DiceMode = 'random' | 'fixed' | 'seed';
export interface DiceSettings {
  mode: DiceMode;
  fixed: string;
  seed: number;
}

export function TurnBar(props: {
  battle: Battle;
  info: TurnInfo;
  onStart: () => void;
  onNextTurn: () => void;
  onOrder: (id: ActorId) => void;
  startBlocked?: string | null;
}) {
  const { info } = props;
  const odMax = 2;
  return (
    <section className="panel turn-bar" aria-label="Ход и раунд">
      <div className="turn-head">
        <div>
          <span className="eyebrow">{info.started ? `Раунд ${info.round}` : 'Подготовка'}</span>
          <h2>{info.started ? `Ход: ${actor(info.active).name}` : 'Расстановка и очередь'}</h2>
        </div>
        {info.turnActive && info.od !== null && (
          <div className="od" aria-label={`Очки действий: ${info.od} из ${odMax}`}>
            {Array.from({ length: Math.max(odMax, info.od) }, (_, i) => (
              <span key={i} className={i < info.od! ? 'pip on' : 'pip'} />
            ))}
            <span className="od-label">ОД</span>
          </div>
        )}
      </div>
      <ol className="initiative">
        {info.order.map((id) => (
          <li key={id} className={info.started && id === info.active ? 'current' : ''}>
            <span>{actor(id).name}</span>
            <span className="muted small">
              Реакция: {info.reactions[id] ? 'доступна' : 'потрачена'}
            </span>
          </li>
        ))}
      </ol>
      {!info.started ? (
        <div className="stack">
          <label>
            Первым ходит (ручная очередь, инициатива не бросается)
            <select value={info.active} onChange={(e) => props.onOrder(e.target.value as ActorId)}>
              {ids.map((id) => (
                <option key={id} value={id}>
                  {actor(id).name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="primary"
            onClick={props.onStart}
            disabled={!!props.startBlocked}
          >
            Начать бой
          </button>
          {props.startBlocked && <p className="muted small">{props.startBlocked}</p>}
        </div>
      ) : (
        <button
          type="button"
          onClick={props.onNextTurn}
          disabled={!!info.pending || (!info.turnActive && !info.pendingTurn)}
        >
          {info.pendingTurn ? 'Продолжить начало хода' : 'Передать ход'}
        </button>
      )}
    </section>
  );
}

export function PendingBanner(props: {
  info: TurnInfo;
  onResume: () => void;
  onCancel: () => void;
}) {
  const { pending, pendingTurn } = props.info;
  if (!pending && !pendingTurn) return null;
  return (
    <section className="panel pending" role="alert">
      <span className="eyebrow">Операция остановлена — состояние не изменено</span>
      <p>{pending?.reason ?? pendingTurn?.reason}</p>
      {pending && (
        <p className="muted small">
          Сохранено кубиков: {pending.savedDice}. При продолжении бросаются только недостающие.
        </p>
      )}
      <div className="row">
        <button type="button" onClick={props.onResume}>
          Продолжить с кубиками
        </button>
        {pending && (
          <button type="button" onClick={props.onCancel} disabled={pending.savedDice > 0}>
            Отменить неначатую
          </button>
        )}
      </div>
    </section>
  );
}

export function MovePanel(props: {
  options: MoveOption[];
  selectedMode: MoveMode | null;
  onSelectMode: (mode: MoveMode | null) => void;
  onMoveTo: (x: number, y: number) => void;
  position: { x: number; y: number };
  canAct: boolean;
  posture: 'standing' | 'kneeling' | 'prone';
  onStand: () => void;
  footprint: { width: number; height: number };
  mapSize: { cols: number; rows: number };
}) {
  const [x, setX] = useState('');
  const [y, setY] = useState('');
  const chosen = props.options.find((o) => o.mode === props.selectedMode && o.available);
  return (
    <div className="stack">
      <p className="muted small">
        Дистанцию и расход ОД определяет движок KADAT (лист «Бой»). Карта лишь измеряет прямое
        расстояние в метрах.
      </p>
      <ul className="move-modes">
        {props.options.map((o) => (
          <li key={o.mode}>
            <button
              type="button"
              className={`mode ${props.selectedMode === o.mode ? 'chosen' : ''}`}
              disabled={!o.available}
              aria-pressed={props.selectedMode === o.mode}
              onClick={() => props.onSelectMode(props.selectedMode === o.mode ? null : o.mode)}
            >
              <span className="mode-name">{o.label}</span>
              <span className="mode-cost">{o.cost}</span>
              <span className="mode-range">
                {o.maxDistance !== null ? `${o.maxDistance} м` : '—'}
              </span>
            </button>
            {!o.available && o.reason && (
              <p className={`reason ${o.blockedBy === 'author' ? 'note-author' : 'muted small'}`}>
                {o.reason}
              </p>
            )}
          </li>
        ))}
      </ul>
      {props.posture !== 'standing' && (
        <button type="button" onClick={props.onStand} disabled={!props.canAct}>
          Встать (1 ОД) — персонаж {props.posture === 'prone' ? 'лежит' : 'на колене'}
        </button>
      )}
      {chosen && (
        <form
          className="coords-form"
          onSubmit={(e) => {
            e.preventDefault();
            // The typed cell is the top-left cell of the token's area.
            props.onMoveTo(
              Number(x) + props.footprint.width / 2,
              Number(y) + props.footprint.height / 2,
            );
          }}
        >
          <span className="muted small">
            Или клетка назначения — левая верхняя клетка токена (сейчас{' '}
            {props.position.x - props.footprint.width / 2},{' '}
            {props.position.y - props.footprint.height / 2}):
          </span>
          <label>
            Столбец
            <input
              type="number"
              step={1}
              min={0}
              max={props.mapSize.cols - props.footprint.width}
              required
              value={x}
              onChange={(e) => setX(e.target.value)}
            />
          </label>
          <label>
            Строка
            <input
              type="number"
              step={1}
              min={0}
              max={props.mapSize.rows - props.footprint.height}
              required
              value={y}
              onChange={(e) => setY(e.target.value)}
            />
          </label>
          <button type="submit" disabled={!props.canAct}>
            Переместить
          </button>
        </form>
      )}
    </div>
  );
}

export interface AttackForm {
  target: ActorId;
  weapon: WeaponId;
  modifier: number;
  activity: BleedingActivity;
  decline: boolean;
}

export function AttackPanel(props: {
  attacker: ActorId;
  form: AttackForm;
  onChange: (form: AttackForm) => void;
  onAttack: () => void;
  canAct: boolean;
  attackedThisTurn: boolean;
  battle: Battle;
}) {
  const { form, attacker } = props;
  const own = weapons.filter((w) => w.owner === attacker);
  const weapon = own.find((w) => w.id === form.weapon) ?? own[0]!;
  const support = weaponSupport(weapon.id);
  const p = props.battle.positions;
  const distance = (id: ActorId) =>
    Number(Math.hypot(p[attacker].x - p[id].x, p[attacker].y - p[id].y).toFixed(2));
  const set = (patch: Partial<AttackForm>) => props.onChange({ ...form, ...patch });
  return (
    <div className="stack">
      <label>
        Цель
        <select value={form.target} onChange={(e) => set({ target: e.target.value as ActorId })}>
          {ids
            .filter((id) => id !== attacker)
            .map((id) => (
              <option key={id} value={id}>
                {actor(id).name} — {distance(id)} м
              </option>
            ))}
        </select>
      </label>
      <label>
        Оружие
        <select value={weapon.id} onChange={(e) => set({ weapon: e.target.value as WeaponId })}>
          {own.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </label>
      <p className={`weapon-note badge-${support.level}`}>{support.note}</p>
      <p className="raw small">{weapon.raw}</p>
      <div className="row">
        <label>
          Модификатор ведущего
          <input
            type="number"
            step={1}
            value={form.modifier}
            onChange={(e) => set({ modifier: Number(e.target.value) })}
          />
        </label>
        <label>
          Активность цели при кровотечении
          <select
            value={form.activity}
            onChange={(e) => set({ activity: e.target.value as BleedingActivity })}
          >
            <option value="REST">покой</option>
            <option value="PHYSICAL_ACTION">физическое действие</option>
            <option value="HOLDING_WOUND">зажимает рану</option>
          </select>
        </label>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={form.decline}
          onChange={(e) => set({ decline: e.target.checked })}
        />
        Цель явно отказывается от реакции (уклонение/парирование ещё не автоматизированы)
      </label>
      {props.attackedThisTurn && (
        <p className="muted small">В этом ходу атака уже была: движок разрешает одну атаку.</p>
      )}
      <button
        type="button"
        className="primary"
        onClick={props.onAttack}
        disabled={!props.canAct || support.level === 'blocked' || !form.decline}
      >
        Атаковать
      </button>
    </div>
  );
}

export function DicePanel(props: { dice: DiceSettings; onChange: (d: DiceSettings) => void }) {
  const { dice } = props;
  return (
    <details className="panel dice">
      <summary>
        Кубики:{' '}
        {dice.mode === 'random'
          ? 'случайные'
          : dice.mode === 'fixed'
            ? 'заданная последовательность'
            : `seed ${dice.seed}`}
      </summary>
      <label>
        Источник бросков
        <select
          value={dice.mode}
          onChange={(e) => props.onChange({ ...dice, mode: e.target.value as DiceMode })}
        >
          <option value="random">Случайные (криптографический генератор браузера)</option>
          <option value="fixed">Заданная последовательность (ввод ведущего)</option>
          <option value="seed">Воспроизводимый seed на команду</option>
        </select>
      </label>
      {dice.mode === 'fixed' && (
        <label>
          Броски «грани:результат» по порядку
          <textarea
            value={dice.fixed}
            onChange={(e) => props.onChange({ ...dice, fixed: e.target.value })}
          />
        </label>
      )}
      {dice.mode === 'seed' && (
        <label>
          Seed
          <input
            type="number"
            min={1}
            value={dice.seed}
            onChange={(e) => props.onChange({ ...dice, seed: Number(e.target.value) })}
          />
        </label>
      )}
      <p className="muted small">
        Все фактические броски записываются в журнал и replay; повторный бой воспроизводится точно.
      </p>
    </details>
  );
}

const toneLabel: Record<JournalTone, string> = {
  info: 'событие',
  success: 'выполнено',
  warning: 'отклонено',
  author: 'нужно решение',
  error: 'ошибка',
};

export function CombatLog({ battle }: { battle: Battle }) {
  const lines = [...battle.log].reverse();
  return (
    <section className="panel log" aria-label="Журнал боя">
      <h2>Журнал</h2>
      <ol>
        {lines.map((entry) => {
          const line = describeEntry(entry);
          return (
            <li key={entry.id} className={`log-line tone-${line.tone}`}>
              <div className="log-head">
                <span className="log-id">#{line.id}</span>
                <strong>{line.title}</strong>
                <span className="log-tone">{toneLabel[line.tone]}</span>
              </div>
              {line.summary && <p>{line.summary}</p>}
              {line.dice && <p className="dice-line">Броски: {line.dice}</p>}
              <details>
                <summary>Данные движка</summary>
                <pre>{JSON.stringify(entry.detail, null, 2)}</pre>
              </details>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
