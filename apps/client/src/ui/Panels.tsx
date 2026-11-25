import { useState } from 'react';
import type { BleedingActivity } from '@kadat/contracts';
import type { CalledLocation, FireMode } from '@kadat/contracts';
import {
  weaponSupport,
  attackLineProblem,
  weaponState,
  weaponSpares,
  stabilizeTargets,
  partialOf,
  medicaBonus,
  fireChargeDestination,
  chargeUnavailable,
  weaponInHand,
  weaponDropped,
  weaponHanging,
  pickUpCost,
  readyCost,
  reloadCost,
  entanglement,
  corrodedZones,
  impalements,
  firstClassKind,
  grappleOf,
  grappleActionName,
  type GrappleActionType,
  otherWeaponInHand,
  oneHandedWeapon,
  disarmOptions,
  attackWeapon,
  isFists,
  chargeDestination,
  meleeAttackKinds,
  type TurnActionType,
  type Zone,
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
import { fireModes, isThrown, throwRange, weaponKind, weaponProblem } from '../game/combatants';

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
  /** «Стремительная» / «Молниеносная атака» (ruling 130). */
  meleeBase?: 'swift' | 'lightning' | 'cautious' | 'reckless' | '';
  /** Melee technique: grapple, stun, knockdown (core «Бой»). */
  technique?: 'grapple' | 'stun' | 'knockdown' | '';
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
  /** «Натиск» to the cell next to the target (2 ОД). */
  onCharge?: (at: { x: number; y: number }) => void;
  /** «Неистовый натиск»: the extra reckless attack for the reaction (ruling 157). */
  onFurious?: (() => void) | undefined;
  /** Thrown weapon: pick the cell on the map (ruling 154). */
  onThrowPick?: () => void;
  throwPicking?: boolean;
}) {
  const { form, attacker } = props;
  const own = [
    ...battleWeapons(props.battle, attacker),
    attackWeapon(props.battle, `${attacker}:hands`)!,
  ];
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
      {weapon && support.level !== 'blocked' && !isFists(weapon.id) && !props.inHand(weapon.id) && (
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
      {weapon?.arsenal && weaponKind(weapon.arsenal) === 'melee' && (
        <label>
          Тип атаки
          <select
            value={form.meleeBase ?? ''}
            onChange={(e) =>
              set({ meleeBase: e.target.value as NonNullable<AttackForm['meleeBase']> })
            }
          >
            <option value="">Стандартная (1 ОД, +10)</option>
            <option value="cautious">Осторожная (1 ОД, −10; +10 к уклонению и парированию)</option>
            <option value="reckless">Безоглядная (1 ОД, +30; нельзя уклоняться)</option>
            {meleeAttackKinds(props.battle, attacker).map((k) => (
              <option key={k} value={k}>
                {k === 'swift'
                  ? 'Стремительная (1 ОД, +1 попадание за 2 ст.)'
                  : 'Молниеносная (1 ОД, −10, +1 попадание за ст., до бНР)'}
              </option>
            ))}
          </select>
        </label>
      )}
      {weapon?.arsenal && weaponKind(weapon.arsenal) === 'melee' && (
        <label>
          Приём
          <select
            value={form.technique ?? ''}
            onChange={(e) =>
              set({ technique: e.target.value as NonNullable<AttackForm['technique']> })
            }
          >
            <option value="">Удар</option>
            <option value="grapple">Захват (парирование −30)</option>
            <option value="stun">Оглушение (−20, без урона)</option>
            <option value="knockdown">Сбить с ног (встречная Атлетика)</option>
          </select>
        </label>
      )}
      {props.onCharge &&
        weapon?.arsenal &&
        weaponKind(weapon.arsenal) === 'melee' &&
        form.target &&
        distance(form.target) > 1.5 &&
        (() => {
          const at = chargeDestination(props.battle, attacker, form.target);
          const why = at ? null : chargeUnavailable(props.battle, attacker, form.target);
          return (
            <>
              <button
                type="button"
                disabled={!props.canAct || !at}
                onClick={() => at && props.onCharge!(at)}
              >
                Натиск: подбежать и ударить (2 ОД, +20)
                {at ? '' : ' — недоступен'}
              </button>
              {why && <p className="muted small">{why}</p>}
            </>
          );
        })()}
      {props.onCharge &&
        weapon?.arsenal &&
        weaponKind(weapon.arsenal) === 'ranged' &&
        form.target &&
        (() => {
          const at = fireChargeDestination(props.battle, attacker, form.target, weapon.id);
          return at ? (
            <button type="button" disabled={!props.canAct} onClick={() => props.onCharge!(at)}>
              Огненный натиск: бег и длинная очередь НС+0 (2 ОД)
            </button>
          ) : null;
        })()}
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
      {props.onFurious && (
        <button type="button" onClick={props.onFurious} disabled={!props.canAct}>
          Доп. безоглядная атака — Неистовый натиск (реакция)
        </button>
      )}
      {weapon && isThrown(weapon.arsenal) && props.onThrowPick && (
        <div className="weapon-note">
          <p className="small">
            Бросок: до {throwRange(props.battle, weapon.id) ?? 0} м, осталось{' '}
            {weaponState(props.battle, weapon.id).rounds} шт. Тест НС; промах — разлёт по схеме.
          </p>
          <button
            type="button"
            onClick={props.onThrowPick}
            disabled={
              !props.canAct ||
              props.attackedThisTurn ||
              weaponState(props.battle, weapon.id).rounds < 1 ||
              !props.inHand(weapon.id)
            }
          >
            {props.throwPicking ? 'Выберите клетку на карте…' : 'Бросить в клетку'}
          </button>
        </div>
      )}
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

/** «Стабилизировать» (ruling 160): the GM confirms the kit and, without «Медика», the penalty. */
function Stabilize(props: {
  name: string;
  medica: number | null;
  disabled: boolean;
  onGo: (medKit: boolean, modifier?: number) => void;
}) {
  const [kit, setKit] = useState(false);
  const [mod, setMod] = useState(0);
  return (
    <div className="weapon-note badge-partial">
      <p>
        {props.name} в агонии рядом. Стабилизировать — весь ход (2 ОД), тест Медики −30
        {props.medica === null ? ' (навыка «Медика» нет — штраф задаёт ведущий)' : ''}.
      </p>
      <div className="row">
        <label className="check small">
          <input type="checkbox" checked={kit} onChange={(e) => setKit(e.target.checked)} />
          есть медицинский набор
        </label>
        <label className="small">
          {props.medica === null ? 'штраф ведущего' : 'модификатор ведущего'}{' '}
          <input
            type="number"
            step={10}
            value={mod}
            style={{ width: '5em' }}
            onChange={(e) => setMod(Math.round(Number(e.target.value) || 0))}
          />
        </label>
        <button
          type="button"
          disabled={props.disabled || !kit}
          onClick={() => props.onGo(kit, props.medica === null || mod ? mod : undefined)}
        >
          Стабилизировать
        </button>
      </div>
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
  onAction: (
    type: TurnActionType,
    weapon?: WeaponId,
    characteristic?: 'СЛ' | 'ЛВ',
    zone?: Zone,
  ) => void;
  onTake: (weapon: WeaponId) => void;
  onDrop: (weapon: WeaponId) => void;
  onPickUp: (weapon: WeaponId) => void;
  onExtract?: (weapon: WeaponId) => void;
  /** «Первоклассный стрелок»: an aim as the Free Action, once a fight. */
  onFreeAim?: (type: 'quick-aim' | 'careful-aim') => void;
  onGrapple?: (type: GrappleActionType) => void;
  /** «Стабилизировать» an ally in agony next to the actor (ruling 160). */
  onStabilize?: (target: ActorId, medKit: boolean, modifier?: number) => void;
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
  const corroded = corrodedZones(props.battle, props.actor);
  const stuck = impalements(props.battle, props.actor);
  const firstClass = firstClassKind(props.battle, props.actor);
  const grapple = grappleOf(props.battle, props.actor);
  const zoneLabel = { head: 'голова', torso: 'торс', arms: 'руки', legs: 'ноги' } as const;
  return (
    <div className="stack">
      {grapple && props.onGrapple && (
        <div className="weapon-note badge-partial">
          <p>
            {grapple.role === 'controller' ? 'Вы держите' : 'Вас держит'}{' '}
            {actorName(props.battle, grapple.opponent)} (захват). Другие действия недоступны.
          </p>
          <div className="action-grid">
            {(grapple.role === 'controller'
              ? ([
                  'grapple-continue',
                  'grapple-damage',
                  'grapple-throw',
                  'grapple-push',
                  'grapple-stand',
                  'grapple-release',
                ] as const)
              : (['grapple-escape', 'grapple-slip', 'grapple-reverse'] as const)
            ).map((t) => (
              <button
                key={t}
                type="button"
                disabled={!props.canAct}
                onClick={() => props.onGrapple!(t)}
              >
                {grappleActionName[t]}
              </button>
            ))}
          </div>
        </div>
      )}
      {(() => {
        const held = partialOf(props.battle, props.actor);
        if (!held) return null;
        const what = {
          arm: 'рука опутана — только одноручное оружие, без боя двумя оружиями',
          torso: 'торс опутан — СКР / 2, уклоняться нельзя',
          head: 'голова опутана — удушение по решению ведущего',
        }[held.zone];
        return (
          <div className="weapon-note badge-blocked">
            <p>Частичное опутывание: {what}.</p>
            <button
              type="button"
              disabled={!props.canAct || od < 1}
              onClick={() => props.onAction('free-partial')}
            >
              Освободиться (1 ОД, тест СЛ)
            </button>
          </div>
        );
      })()}
      {props.onStabilize &&
        stabilizeTargets(props.battle, props.actor).map((t) => (
          <Stabilize
            key={t}
            name={actorName(props.battle, t)}
            medica={medicaBonus(props.battle, props.actor)}
            disabled={!props.canAct || od < 2}
            onGo={(medKit, modifier) => props.onStabilize!(t, medKit, modifier)}
          />
        ))}
      {firstClass && props.onFreeAim && (
        <div className="row">
          {(['quick-aim', 'careful-aim'] as const).map((t) => (
            <button
              key={t}
              type="button"
              disabled={!props.canAct}
              onClick={() => props.onFreeAim!(t)}
            >
              {t === 'quick-aim' ? 'Быстрое' : 'Тщательное'} прицеливание за СД (Первоклассный
              стрелок, раз за бой)
            </button>
          ))}
        </div>
      )}
      {stuck.map((x) => (
        <button
          key={x.weapon}
          type="button"
          disabled={!props.canAct || od < 1 || !props.onExtract}
          onClick={() => props.onExtract?.(x.weapon)}
        >
          Извлечь {x.name} из раны ({actorName(props.battle, x.target)}, {x.location}) — 1 ОД
        </button>
      ))}
      {corroded.map((z) => (
        <div key={z} className="weapon-note badge-blocked">
          <p>Броня ({zoneLabel[z]}) разъедается «Коррозийным» каждый ход.</p>
          <div className="row">
            <button
              type="button"
              disabled={!props.canAct || od < 2}
              onClick={() => props.onAction('clean-armour', undefined, undefined, z)}
            >
              Очистить (2 ОД)
            </button>
            <button
              type="button"
              disabled={!props.canAct || od < 1}
              onClick={() => props.onAction('drop-armour', undefined, undefined, z)}
            >
              Сбросить броню (1 ОД)
            </button>
          </div>
        </div>
      ))}
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
        if (isThrown(w.arsenal))
          return (
            <div key={w.id} className="weapon-actions">
              <strong>{w.name}</strong>
              <span className="muted small"> · осталось {st.rounds} шт.</span>
            </div>
          );
        return (
          <div key={w.id} className="weapon-actions">
            <div>
              <strong>{w.name}</strong>
              <span className="muted small">
                {' '}
                · магазин {st.rounds} / {w.capacity}
                {(() => {
                  const sp = weaponSpares(props.battle, w.id);
                  return sp
                    ? ` · запасных ${sp.filter((x) => x > 0).length}${sp.some((x) => x > 0 && x < (w.capacity ?? 0)) ? ` (${sp.join(', ')})` : ''}`
                    : '';
                })()}
                {st.jammed ? ' · заклинило' : ''}
                {st.reloading ? ` · перезарядка ${st.reloading}` : ''}
              </span>
            </div>
            <div className="row">
              <button
                type="button"
                disabled={
                  !props.canAct ||
                  od < 1 ||
                  st.rounds === w.capacity ||
                  (!st.reloading && (weaponSpares(props.battle, w.id) ?? [1]).every((x) => x <= 0))
                }
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
        Прицеливание даёт бонус следующему выстрелу этого хода. Запасные магазины считаются, если их
        число задано в редакторе; иначе перезарядка ставит полный.
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
