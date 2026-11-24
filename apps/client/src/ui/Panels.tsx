import { useState } from 'react';
import type { BleedingActivity } from '@kadat/contracts';
import type { CalledLocation, FireMode } from '@kadat/contracts';
import {
  weaponSupport,
  attackLineProblem,
  weaponState,
  weaponInHand,
  weaponDropped,
  weaponHanging,
  pickUpCost,
  readyCost,
  reloadCost,
  entanglement,
  otherWeaponInHand,
  oneHandedWeapon,
  disarmOptions,
  type TurnActionType,
  type MoveMode,
  type MoveOption,
  type turnInfo as TurnInfoFn,
} from '../game/engine';
import { describeEntry, type JournalTone } from '../game/journal';
import {
  actorIds,
  actorName,
  battleWeapons,
  posOf,
  type ActorId,
  type Battle,
  type WeaponId,
} from '../game/model';
import { fireModes, weaponKind, weaponProblem } from '../game/combatants';

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
  startBlocked?: string | null;
}) {
  const { info } = props;
  const name = (id: ActorId) => actorName(props.battle, id);
  const odMax = 2;
  return (
    <section className="panel turn-bar" aria-label="Ход и раунд">
      <div className="turn-head">
        <div>
          <span className="eyebrow">{info.started ? `Раунд ${info.round}` : 'Подготовка'}</span>
          <h2>{info.started ? `Ход: ${name(info.active)}` : 'Расстановка участников'}</h2>
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
            <span>
              {name(id)}
              {info.started && <span className="muted small"> · иниц. {info.initiative[id]}</span>}
            </span>
            <span className="muted small">
              Реакция: {info.reactions[id] ? 'доступна' : 'потрачена'}
            </span>
          </li>
        ))}
      </ol>
      {!info.started ? (
        <div className="stack">
          <p className="muted small">
            При начале боя бросается инициатива: 1к10 + бЛВ, равные перебрасываются.
          </p>
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
  onAnswer: (key: string, value: number) => void;
  onCancel: () => void;
}) {
  const { pending, pendingTurn } = props.info;
  const [value, setValue] = useState('');
  if (!pending && !pendingTurn) return null;
  const q = pending?.question;
  if (q)
    return (
      <section className="panel pending question" role="alertdialog" aria-label="Вопрос ведущему">
        <span className="eyebrow">Вопрос ведущему</span>
        <p>{q.text}</p>
        {q.options ? (
          <div className="row">
            {q.options.map((o) => (
              <button key={o.value} type="button" onClick={() => props.onAnswer(q.key, o.value)}>
                {o.label}
              </button>
            ))}
          </div>
        ) : (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (value.trim() !== '' && Number.isInteger(Number(value)))
                props.onAnswer(q.key, Number(value));
            }}
          >
            <input
              type="number"
              step={1}
              min={q.min}
              max={q.max}
              value={value}
              aria-label="Ответ"
              onChange={(e) => setValue(e.target.value)}
            />
            <button type="submit" className="primary">
              Ответить
            </button>
          </form>
        )}
        <p className="muted small">
          Уже брошенные кубики сохранены: после ответа действие продолжится с ними.
        </p>
      </section>
    );
  return (
    <section className="panel pending" role="alert">
      <span className="eyebrow">Действие остановлено</span>
      <p>{pending?.reason ?? pendingTurn?.reason}</p>
      {pending && (
        <p className="muted small detail">
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
  /** Route by clicked points (author ruling 8). */
  route: { x: number; y: number }[] | null;
  routePlan: { meters: number; difficult: number; cost: number; reason: string | null } | null;
  onRouteMode: (on: boolean) => void;
  onRouteUndo: () => void;
  onRouteGo: () => void;
}) {
  const [x, setX] = useState('');
  const [y, setY] = useState('');
  const chosen = props.options.find((o) => o.mode === props.selectedMode && o.available);
  // One shared refusal (e.g. a stopped action) is shown once instead of under every mode.
  const reasons = new Set(props.options.map((o) => (o.available ? null : (o.reason ?? null))));
  const common = reasons.size === 1 ? [...reasons][0] : null;
  return (
    <div className="stack">
      {common && <p className="muted small">{common}</p>}
      <p className="muted small detail">
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
            {!o.available && o.reason && !common && (
              <p className={`reason ${o.blockedBy === 'author' ? 'note-author' : 'muted small'}`}>
                {o.reason}
              </p>
            )}
          </li>
        ))}
      </ul>
      {chosen && (
        <div className="route-box" data-testid="route-box">
          <label className="check">
            <input
              type="checkbox"
              checked={props.route !== null}
              onChange={(e) => props.onRouteMode(e.target.checked)}
            />
            Маршрут по точкам: щёлкайте по карте, затем «Идти»
          </label>
          {props.route !== null && (
            <>
              <p className="small" data-testid="route-summary">
                {props.route.length === 0
                  ? 'Точек нет: щёлкните первую точку на карте.'
                  : `Точек: ${props.route.length} · путь ${props.routePlan!.meters.toFixed(2)} м` +
                    (props.routePlan!.difficult > 0
                      ? ` · трудная местность ${props.routePlan!.difficult.toFixed(2)} м (вдвое)`
                      : '') +
                    ` · стоит ${props.routePlan!.cost.toFixed(2)} из ${chosen.maxDistance} м`}
              </p>
              {props.routePlan?.reason && (
                <p className="reason note-warning small">{props.routePlan.reason}</p>
              )}
              <div className="row">
                <button
                  type="button"
                  className="primary"
                  disabled={
                    !props.canAct || !props.route.length || props.routePlan?.reason !== null
                  }
                  onClick={props.onRouteGo}
                >
                  Идти
                </button>
                <button type="button" disabled={!props.route.length} onClick={props.onRouteUndo}>
                  Убрать точку
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {props.posture !== 'standing' && (
        <button type="button" onClick={props.onStand} disabled={!props.canAct}>
          Встать (1 ОД) — персонаж {props.posture === 'prone' ? 'лежит' : 'на колене'}
        </button>
      )}
      {chosen && (
        <form
          className="coords-form detail"
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
  mode: FireMode;
  shots: number;
  /** «Избирательная атака» (2 ОД): chosen location, or none for an ordinary attack. */
  called: CalledLocation | '';
  modifier: number;
  activity: BleedingActivity;
  /** Reaction of the target chosen by its player or the GM. */
  defense: 'DECLINE' | 'DODGE' | 'PARRY';
  /** Attack with both weapons in hand (ruling 105). */
  dual?: boolean;
}

export function AttackPanel(props: {
  attacker: ActorId;
  form: AttackForm;
  onChange: (form: AttackForm) => void;
  onAttack: () => void;
  canAct: boolean;
  attackedThisTurn: boolean;
  battle: Battle;
  /** The selected weapon stands on a support («Бой» A55). */
  braced: (weaponId: string) => boolean;
  /** Weapon in hand (ruling 81) and the cost of taking another. */
  inHand: (weaponId: string) => boolean;
  readyCost: string;
  onTake: (weaponId: string, keep?: string) => void;
  /** Talent «Бугрящиеся бицепсы»: heavy weapons from the hands without penalties. */
  fromHands: boolean;
  onBrace: (weaponId: string) => void;
  /** «Разоружение» of the target's weapon in hand (1 ОД). */
  onDisarm?: (weaponId: string) => void;
}) {
  const { form, attacker } = props;
  const own = battleWeapons(props.battle, attacker);
  const weapon = own.find((w) => w.id === form.weapon) ?? own[0];
  const support = weapon
    ? weaponSupport(props.battle, weapon.id)
    : { level: 'blocked' as const, note: 'У персонажа нет оружия' };
  const modes =
    weapon?.arsenal && !weaponProblem(weapon.arsenal) && weaponKind(weapon.arsenal) === 'ranged'
      ? fireModes(weapon.arsenal)
      : [];
  // «Бой» A55: a heavy weapon without a support fires single shots only (−30).
  const heavy = weapon?.arsenal?.weaponClass === 'ТО';
  const onSupport = !!weapon && (props.fromHands || props.braced(weapon.id));
  const usable = heavy && !onSupport ? modes.filter((m) => m.mode === 'single') : modes;
  const mode = usable.find((m) => m.mode === form.mode) ?? usable[0];
  const from = posOf(props.battle, attacker);
  const distance = (id: ActorId) => {
    const to = posOf(props.battle, id);
    return Number(Math.hypot(from.x - to.x, from.y - to.y).toFixed(2));
  };
  const set = (patch: Partial<AttackForm>) => props.onChange({ ...form, ...patch });
  const other = weapon ? otherWeaponInHand(props.battle, attacker, weapon.id) : null;
  const handHeld = own.find((w) => w.id !== weapon?.id && props.inHand(w.id));
  const canSecond =
    !!weapon &&
    !!handHeld &&
    oneHandedWeapon(props.battle, weapon.id) &&
    oneHandedWeapon(props.battle, handHeld.id);
  const lineProblem = form.target ? attackLineProblem(props.battle, attacker, form.target) : null;
  const modeName: Record<FireMode, string> = {
    single: 'Одиночный',
    'short-burst': 'Короткая очередь',
    'full-auto': 'Длинная очередь',
  };
  return (
    <div className="stack">
      <label>
        Цель
        <select value={form.target} onChange={(e) => set({ target: e.target.value })}>
          {actorIds(props.battle)
            .filter((id) => id !== attacker)
            .map((id) => (
              <option key={id} value={id}>
                {actorName(props.battle, id)} — {distance(id)} м
              </option>
            ))}
        </select>
      </label>
      <label>
        Оружие
        <select
          value={weapon?.id ?? ''}
          onChange={(e) => set({ weapon: e.target.value, mode: 'single', shots: 1 })}
        >
          {own.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </label>
      {modes.length > 0 && mode && (
        <div className="row">
          <label>
            Режим
            <select
              value={mode.mode}
              onChange={(e) => {
                const m = modes.find((x) => x.mode === e.target.value)!;
                set({ mode: m.mode, shots: m.maxShots });
              }}
            >
              {modes.map((m) => (
                <option key={m.mode} value={m.mode} disabled={!usable.includes(m)}>
                  {modeName[m.mode]} ({m.maxShots}){usable.includes(m) ? '' : ' — нужна опора'}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">Выстрелов: {mode.maxShots} (темп оружия, решение 78)</p>
        </div>
      )}
      {weapon && support.level !== 'blocked' && !props.inHand(weapon.id) && (
        <div className="stack">
          <p className="weapon-note badge-partial">Это оружие не в руках.</p>
          <button
            type="button"
            disabled={!props.canAct && props.readyCost !== 'до боя'}
            onClick={() => props.onTake(weapon.id)}
          >
            Взять в руки ({props.readyCost})
          </button>
          {canSecond && (
            <button
              type="button"
              disabled={!props.canAct && props.readyCost !== 'до боя'}
              onClick={() => props.onTake(weapon.id, handHeld!.id)}
            >
              Взять во вторую руку, оставив {handHeld!.name} ({props.readyCost})
            </button>
          )}
        </div>
      )}
      {props.onDisarm &&
        disarmOptions(props.battle, attacker, form.target).map((w) => (
          <button
            key={w.id}
            type="button"
            disabled={!props.canAct}
            onClick={() => props.onDisarm!(w.id)}
          >
            Разоружить: выбить {w.name} (1 ОД, встречный НР)
          </button>
        ))}
      {weapon && other && props.inHand(weapon.id) && (
        <label className="row">
          <input
            type="checkbox"
            checked={!!form.dual}
            onChange={(e) => set({ dual: e.target.checked })}
          />
          Атаковать обоими: вторая атака — {own.find((w) => w.id === other)?.name}. Без «Парного
          оружия» каждая −30, с «Амбидекстрией» −20 (решение 105).
        </label>
      )}
      {heavy && weapon && (
        <div className="stack">
          <p className="muted small">
            {props.fromHands
              ? 'Талант «Бугрящиеся бицепсы»: стреляет из тяжёлого оружия с рук без штрафов.'
              : onSupport
                ? 'Оружие на опоре: доступны очереди. Любое движение снимает опору (решение 41).'
                : 'Тяжёлое оружие без опоры: только одиночный выстрел, −30 («Бой» A55).'}
          </p>
          {!onSupport && (
            <button type="button" onClick={() => props.onBrace(weapon.id)} disabled={!props.canAct}>
              Установить на опору (1 ОД)
            </button>
          )}
        </div>
      )}
      {support.level !== 'supported' && (
        <p className={`weapon-note badge-${support.level}`}>{support.note}</p>
      )}
      <div className="row detail">
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
      <label>
        Атака
        <select
          aria-label="Вид атаки"
          value={form.called}
          onChange={(e) => set({ called: e.target.value as AttackForm['called'] })}
        >
          <option value="">Обычная (1 ОД)</option>
          <optgroup label="Избирательная атака (2 ОД, одиночный)">
            <option value="Head">Голова −20</option>
            <option value="Torso">Торс −10</option>
            <option value="Right Arm">Правая рука −20</option>
            <option value="Left Arm">Левая рука −20</option>
            <option value="Right Leg">Правая нога −15</option>
            <option value="Left Leg">Левая нога −15</option>
            <option value="Eyes">Глаза −50</option>
            <option value="Armor Joints">Сочленения −40</option>
          </optgroup>
        </select>
      </label>
      <p className="muted small">
        Реакцию выбирает цель, когда по ней попали: уклонение или парирование спросят у неё.
      </p>
      {props.attackedThisTurn && (
        <p className="muted small">В этом ходу атака уже была: движок разрешает одну атаку.</p>
      )}
      {lineProblem && <p className="weapon-note badge-blocked">{lineProblem}</p>}
      <button
        type="button"
        className="primary"
        onClick={props.onAttack}
        disabled={
          !props.canAct ||
          props.attackedThisTurn ||
          support.level === 'blocked' ||
          !form.target ||
          (!!weapon && !props.inHand(weapon.id)) ||
          lineProblem !== null
        }
      >
        Атаковать
      </button>
    </div>
  );
}

/**
 * Actions of the turn besides moving and attacking: aiming, waiting, reloading and clearing a
 * jam (Core costs: «Бой» A53–A59).
 */
export function ActionsPanel(props: {
  battle: Battle;
  actor: ActorId;
  canAct: boolean;
  od: number | null;
  onAction: (type: TurnActionType, weapon?: WeaponId, characteristic?: 'СЛ' | 'ЛВ') => void;
  onTake: (weapon: WeaponId) => void;
  onDrop: (weapon: WeaponId) => void;
  onPickUp: (weapon: WeaponId) => void;
}) {
  const all = battleWeapons(props.battle, props.actor).filter(
    (w) => w.arsenal && !weaponProblem(w.arsenal),
  );
  const ranged = battleWeapons(props.battle, props.actor).filter(
    (w) => w.arsenal && !weaponProblem(w.arsenal) && weaponKind(w.arsenal) === 'ranged',
  );
  const od = props.od ?? 0;
  const state = (id: WeaponId) => weaponState(props.battle, id);
  const held = entanglement(props.battle, props.actor);
  return (
    <div className="stack">
      {held && (
        <div className="weapon-note badge-blocked">
          <p>
            Опутан: другие действия недоступны. Вырваться — весь ход (2 ОД), тест СЛ или ЛВ
            {held.modifier ? ` ${held.modifier}` : ''} (решение 86).
          </p>
          <div className="row">
            {(['СЛ', 'ЛВ'] as const).map((k) => (
              <button
                key={k}
                type="button"
                disabled={!props.canAct || od < 2}
                onClick={() => props.onAction('break-free', undefined, k)}
              >
                Вырваться ({k})
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="action-grid">
        <button
          type="button"
          disabled={!props.canAct || od < 1}
          onClick={() => props.onAction('quick-aim')}
        >
          Быстрое прицеливание <span className="muted small">1 ОД · +10</span>
        </button>
        <button
          type="button"
          disabled={!props.canAct || od < 2}
          onClick={() => props.onAction('careful-aim')}
        >
          Тщательное прицеливание <span className="muted small">2 ОД · +20</span>
        </button>
        <button
          type="button"
          disabled={!props.canAct || od < 1}
          onClick={() => props.onAction('wait')}
        >
          Выжидание <span className="muted small">1 ОД</span>
        </button>
      </div>
      {all.length > 0 && <h3>В руках</h3>}
      {all.map((w) => {
        const held = weaponInHand(props.battle, w.id);
        return (
          <div key={`hand-${w.id}`} className="weapon-actions">
            <div>
              <strong>{w.name}</strong>
              <span className="muted small">
                {' '}
                ·{' '}
                {held
                  ? 'в руках'
                  : weaponDropped(props.battle, w.id)
                    ? 'на полу'
                    : weaponHanging(props.battle, w.id)
                      ? 'висит на ремне'
                      : 'убрано'}
              </span>
            </div>
            <div className="row">
              {held ? (
                <button type="button" disabled={!props.canAct} onClick={() => props.onDrop(w.id)}>
                  {w.sling ? 'Отпустить на ремень' : 'Бросить на пол'}{' '}
                  <span className="muted small">СД</span>
                </button>
              ) : weaponDropped(props.battle, w.id) || weaponHanging(props.battle, w.id) ? (
                <button type="button" disabled={!props.canAct} onClick={() => props.onPickUp(w.id)}>
                  {weaponHanging(props.battle, w.id) ? 'Взять с ремня' : 'Поднять'}{' '}
                  <span className="muted small">{pickUpCost(props.battle)}</span>
                </button>
              ) : (
                <button type="button" disabled={!props.canAct} onClick={() => props.onTake(w.id)}>
                  Взять в руки{' '}
                  <span className="muted small">{readyCost(props.battle, props.actor)}</span>
                </button>
              )}
            </div>
          </div>
        );
      })}
      {ranged.length > 0 && <h3>Перезарядка</h3>}
      {ranged.map((w) => {
        const st = state(w.id);
        return (
          <div key={w.id} className="weapon-actions">
            <div>
              <strong>{w.name}</strong>
              <span className="muted small">
                {' '}
                · магазин {st.rounds} / {w.capacity}
                {st.jammed ? ' · заклинило' : ''}
                {st.reloading ? ` · перезарядка ${st.reloading}` : ''}
              </span>
            </div>
            <div className="row">
              <button
                type="button"
                disabled={!props.canAct || od < 1 || st.rounds === w.capacity}
                onClick={() => props.onAction('reload', w.id)}
              >
                Перезарядить{' '}
                <span className="muted small">{reloadCost(props.battle, props.actor, w.id)}</span>
              </button>
              {st.jammed && (
                <button
                  type="button"
                  disabled={!props.canAct || od < 2}
                  onClick={() => props.onAction('clear-malfunction', w.id)}
                >
                  Исправить осечку <span className="muted small">2 ОД · тест НС</span>
                </button>
              )}
            </div>
          </div>
        );
      })}
      <p className="muted small">
        Прицеливание даёт бонус следующему выстрелу этого хода. Запасные магазины пока не считаются:
        перезарядка ставит полный.
      </p>
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
          const line = describeEntry(entry, (id) => actorName(battle, id));
          return (
            <li key={entry.id} className={`log-line tone-${line.tone}`}>
              <div className="log-head">
                <span className="log-id">#{line.id}</span>
                <strong>{line.title}</strong>
                <span className="log-tone">{toneLabel[line.tone]}</span>
              </div>
              {line.summary && <p>{line.summary}</p>}
              {line.dice && (
                <p className="dice-line detail">Броски: {line.diceDetailed || line.dice}</p>
              )}
              <details className="detail">
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

/** Doors of the scene: a character opens or closes one for the Free Action from any distance
 * (rulings 10, 44); the GM changes doors and locks at any moment, at no cost. */
export function DoorsPanel(props: {
  doors: { id: string; label: string; open: boolean; locked: boolean }[];
  combat: boolean;
  activeName: string;
  canAct: boolean;
  onCharacter: (id: string, open: boolean) => void;
  onGm: (id: string, open: boolean) => void;
  onLock: (id: string, locked: boolean) => void;
}) {
  if (!props.doors.length) return null;
  return (
    <details className="panel doors" data-testid="doors-panel">
      <summary>Двери: {props.doors.length}</summary>
      <ul className="door-list">
        {props.doors.map((d) => (
          <li key={d.id} data-door-row={d.id}>
            <div>
              <strong>{d.label}</strong>{' '}
              <span className="muted small">
                {d.open ? 'открыта' : 'закрыта'}
                {d.locked ? ', заперта' : ''}
              </span>
            </div>
            <div className="row">
              {props.combat && (
                <button
                  type="button"
                  disabled={!props.canAct || (!d.open && d.locked)}
                  title="Свободное действие персонажа, с любого места"
                  onClick={() => props.onCharacter(d.id, !d.open)}
                >
                  {props.activeName}: {d.open ? 'закрыть' : 'открыть'} (СД)
                </button>
              )}
              <button type="button" onClick={() => props.onGm(d.id, !d.open)}>
                Ведущий: {d.open ? 'закрыть' : 'открыть'}
              </button>
              <button
                type="button"
                disabled={d.open && !d.locked}
                onClick={() => props.onLock(d.id, !d.locked)}
              >
                {d.locked ? 'Отпереть' : 'Запереть'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}
