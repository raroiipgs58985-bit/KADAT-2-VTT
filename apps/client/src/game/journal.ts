import type { DiceRoll, MeleeGrip } from '@kadat/contracts';
import type { ActorId, LogEntry } from './model';
import {
  moveModes,
  stanceLabel,
  gripLabel,
  type MoveCommand,
  type AttackCommand,
  type MeleeStanceName,
} from './engine';

type ThrowTarget = {
  actor: string;
  avoided: boolean;
  finalDamage?: number;
  effects?: { property: string; passed: boolean; state?: string; rounds?: number }[];
  manual?: string[];
};

export type JournalTone = 'info' | 'success' | 'warning' | 'author' | 'error';
export interface JournalLine {
  id: number;
  type: string;
  title: string;
  summary: string;
  tone: JournalTone;
  dice: string;
  /** GM view: every die with what it was rolled for («к100=15 — тест попадания»). */
  diceDetailed: string;
}

const locations: Record<string, string> = {
  Eyes: 'Глаза',
  Head: 'Голова',
  Torso: 'Торс',
  'Right Arm': 'Правая рука',
  'Left Arm': 'Левая рука',
  'Right Leg': 'Правая нога',
  'Left Leg': 'Левая нога',
  'Armor Joints': 'Сочленения брони',
};
export const locationName = (location: string) => locations[location] ?? location;
let nameOf: (id: string) => string = (id) => id;
const name = (id: unknown) => (typeof id === 'string' ? nameOf(id) : '—');
const metres = (n: number) => `${Number(n.toFixed(2))} м`;
// к2 picks the side of an arm or leg hit (ruling 24): 1 — left, 2 — right.
const diceDetailed = (rolls: unknown, purposes: unknown) =>
  Array.isArray(rolls)
    ? (rolls as DiceRoll[])
        .map((r, i) => {
          const why = Array.isArray(purposes) ? purposes[i] : undefined;
          return `к${r.sides}=${r.value}${typeof why === 'string' ? ` — ${why}` : ''}`;
        })
        .join('; ')
    : '';
const dice = (rolls: unknown) =>
  Array.isArray(rolls)
    ? (rolls as DiceRoll[])
        .map((r) =>
          r.sides === 2
            ? `к2=${r.value} (${r.value === 1 ? 'левая' : 'правая'} сторона)`
            : `к${r.sides}=${r.value}`,
        )
        .join(', ')
    : '';

interface AttackDetail {
  command: AttackCommand;
  rolls: DiceRoll[];
  weaponName?: string;
  maxHp?: number;
  result: {
    attack?: { mode?: string; shotsFired?: number; ammoSpent?: number; hitsGenerated?: number };
    hits?: {
      location: string;
      finalDamage: number;
      manual?: string[];
      effects?: { property: string; passed: boolean; state?: string; rounds?: number }[];
    }[];
    suppression?: { status: string; targets: { actor: string; status: string }[] };
    reaction?:
      | 'declined'
      | {
          check: { outcome: string; totalDegrees: number };
          cancelledHits: number;
          counterattack?: unknown;
        };
  };
  hp: Record<ActorId, number>;
}

/** Human-readable journal line; the raw structured entry stays available for inspection. */
export function describeEntry(
  entry: LogEntry,
  names: (id: string) => string = (id) => id,
): JournalLine {
  nameOf = names;
  const d = entry.detail as Record<string, unknown>;
  const base = {
    id: entry.id,
    type: entry.type,
    dice: dice(d?.rolls),
    diceDetailed: diceDetailed(d?.rolls, d?.rollPurposes),
  };
  switch (entry.type) {
    case 'loaded':
      return {
        ...base,
        title: 'Сцена загружена',
        summary: 'Участники из библиотеки персонажей, тестовая расстановка на карте.',
        tone: 'info',
      };
    case 'placement': {
      const cells = (d.cells as { col: number; row: number }[] | undefined) ?? [];
      return {
        ...base,
        title: `Расстановка: ${name(d.actor)}`,
        summary: `Клетки ${cells.map((c) => `${c.col},${c.row}`).join(' + ')} — до начала боя, ОД не тратятся.`,
        tone: 'info',
      };
    }
    case 'map-applied': {
      const moved = (d.repositioned as { actor: string }[]).map((r) => name(r.actor));
      return {
        ...base,
        title: `Карта применена: ${String(d.name)}`,
        summary: `${d.cols} × ${d.rows} клеток, разметка пола: ${d.floorCells} кл., декораций: ${d.decorations ?? 0}${d.background ? ', с подложкой' : ''}, ревизия ${d.revision}.${moved.length ? ` Переставлены: ${moved.join(', ')}.` : ''}`,
        tone: 'success',
      };
    }
    case 'door':
      return {
        ...base,
        title: d.open ? 'Дверь открыта' : 'Дверь закрыта',
        summary: `Проём (${(d.from as { x: number }).x}; ${(d.from as { y: number }).y}) — (${(d.to as { x: number }).x}; ${(d.to as { y: number }).y}), ${
          d.by
            ? `${name(d.by as ActorId)}, Свободное действие.`
            : d.inCombat
              ? 'решение ведущего.'
              : 'подготовка сцены.'
        }`,
        tone: 'info',
      };
    case 'door-lock':
      return {
        ...base,
        title: d.locked ? 'Дверь заперта' : 'Дверь отперта',
        summary: 'Решение ведущего.',
        tone: 'info',
      };
    case 'fall-placed':
      return {
        ...base,
        title: `${name(d.actor as ActorId)} упал`,
        summary: 'Ведущий указал место падения; персонаж лежит.',
        tone: 'warning',
      };
    case 'footprint': {
      const f = d.footprint as { width: number; height: number };
      return {
        ...base,
        title: `Площадь токена: ${name(d.actor)}`,
        summary: `${f.width * f.height} кл. (${f.width} × ${f.height}), задано ведущим до начала боя.`,
        tone: 'info',
      };
    }
    case 'manual-turn':
      return {
        ...base,
        title: 'Начальная очередь',
        summary: `Первым ходит ${name(d.actor)} (задано вручную, инициатива не бросалась).`,
        tone: 'info',
      };
    case 'next-turn': {
      const burn = ((d.coreLogs as { type?: string }[] | undefined) ?? []).find(
        (l) => l.type === 'burning',
      ) as
        | {
            actor: string;
            dice: number[];
            halfOb: number;
            wounds: number;
            fatigue: number;
            turnLost: boolean;
            roundsLeft: number;
          }
        | undefined;
      const fire = burn
        ? ` ${name(burn.actor)} горит: 2к10 (${burn.dice.join('+')}) − ½ ОБ ${burn.halfOb} − бВН → −${burn.wounds} ран, +${burn.fatigue} усталости.${burn.turnLost ? ' Паника: ход потерян.' : ''}${burn.roundsLeft ? ` Гореть ещё ${burn.roundsLeft} р.` : ' Огонь погас.'}`
        : '';
      const trails = ((d.coreLogs as { type?: string }[] | undefined) ?? []).filter(
        (l) => l.type === 'trail',
      ) as { actor: string; finalDamage: number }[];
      const trailText = trails.length
        ? ` След: ${trails.map((t) => `${name(t.actor)} — ${t.finalDamage} ран`).join('; ')}.`
        : '';
      const tox = ((d.coreLogs as { type?: string }[] | undefined) ?? []).find(
        (l) => l.type === 'toxin',
      ) as
        | {
            actor: string;
            wounds?: number;
            vnLoss?: number;
            vn?: number;
            roundsLeft: number | null;
          }
        | undefined;
      const poison = tox
        ? ` ${name(tox.actor)} отравлен: ${tox.wounds !== undefined ? `−${tox.wounds} ран` : `ВН −${String(tox.vnLoss)} (теперь ${String(tox.vn)})`}.`
        : '';
      return {
        ...base,
        title: 'Ход передан',
        summary: `Теперь ходит ${name(d.active)}.${fire}${poison}${trailText}`,
        tone: burn || tox ? 'warning' : 'info',
      };
    }
    case 'move': {
      const c = d.command as MoveCommand;
      const label = moveModes.find((m) => m.mode === c.mode)?.label ?? c.mode;
      return {
        ...base,
        title: `${name(c.actor)}: ${label}${(c.route?.length ?? 0) > 1 ? ' по маршруту' : ''}`,
        summary:
          `${metres(d.distance as number)}` +
          ((d.difficult as number) > 0
            ? ` (трудная местность ${metres(d.difficult as number)}, стоит ${metres(d.cost as number)})`
            : '') +
          ` из ${metres(d.maxDistance as number)} · ОД ${d.odBefore} → ${d.odAfter}` +
          (
            (d.terrainTests as
              | { label: string; check: { outcome: string; rawRoll: number; target: number } }[]
              | undefined) ?? []
          )
            .map(
              (t) =>
                ` · тест ЛВ «${t.label}»: ${t.check.rawRoll} против ${t.check.target} — ${t.check.outcome === 'success' ? 'успех' : 'провал'}`,
            )
            .join('') +
          (d.fell ? ` · упал: ведущий укажет место на карте` : ''),
        tone: d.fell ? 'warning' : 'success',
      };
    }
    case 'posture': {
      const to = (d.command as { to?: string }).to;
      const act = to === 'prone' ? 'Лечь' : to === 'kneeling' ? 'Присесть на колено' : 'Встать';
      const pose = (p: unknown) =>
        p === 'prone'
          ? 'лёжа'
          : p === 'kneeling'
            ? 'на колене'
            : p === 'standing'
              ? 'стоя'
              : String(p);
      return {
        ...base,
        title: `${name((d.command as { actor: string }).actor)}: ${act}`,
        summary: `Поза: ${pose(d.from)} → ${pose(d.to)} · ОД ${d.odBefore} → ${d.odAfter}${to ? ' · СД' : ''}`,
        tone: 'success',
      };
    }
    case 'posture-rejected': {
      const to = (d.command as { to?: string }).to;
      const act = to === 'prone' ? 'Лечь' : to === 'kneeling' ? 'Присесть' : 'Встать';
      return { ...base, title: `${act} не удалось`, summary: String(d.reason), tone: 'warning' };
    }
    case 'move-rejected':
      return {
        ...base,
        title: d.authorDecisionRequired ? 'Движение ждёт решения автора' : 'Движение отклонено',
        summary: String(d.reason),
        tone: d.authorDecisionRequired ? 'author' : 'warning',
      };
    case 'attack': {
      const a = d as unknown as AttackDetail;
      const weapon = a.weaponName ?? a.command.weapon;
      const hits = a.result.hits ?? [];
      const r = a.result.attack;
      const modeName: Record<string, string> = {
        single: 'Одиночный',
        'short-burst': 'Короткая очередь',
        'full-auto': 'Длинная очередь',
      };
      const storm = (
        a.result as {
          hurricane?: { path: { actor: string; won: boolean }[]; target: string };
        }
      ).hurricane;
      const stormText = storm
        ? `Ураганный натиск: ${storm.path
            .map((x) => `${name(x.actor)} — ${x.won ? 'сбит с ног' : 'устоял, натиск остановлен'}`)
            .join(
              '; ',
            )}. ${storm.target !== a.command.target ? `Удар по ${name(storm.target)}. ` : ''}`
        : '';
      const smokeCloud = (a.result as { smoke?: { radius: number; rounds: number } }).smoke;
      const fire =
        (smokeCloud ? `Дым радиусом ${smokeCloud.radius} м на ${smokeCloud.rounds} р. ` : '') +
        ((a.result as { fireCharge?: boolean }).fireCharge
          ? 'Огненный натиск: бег, затем длинная очередь НС+0. '
          : '') +
        stormText +
        (r?.mode && r.shotsFired
          ? `${modeName[r.mode] ?? r.mode}: выстрелов ${r.shotsFired}, зарядов ${r.ammoSpent}, попаданий ${r.hitsGenerated}. `
          : '');
      const manual = [...new Set(hits.flatMap((h) => h.manual ?? []))];
      const effectText = hits
        .flatMap((h) => h.effects ?? [])
        .map((e) =>
          e.passed
            ? `${e.property}: устоял`
            : `${e.property}: ${e.state}${e.rounds ? ` на ${e.rounds} р.` : ' до освобождения'}`,
        )
        .join('; ');
      const reaction =
        a.result.reaction && a.result.reaction !== 'declined' ? a.result.reaction : null;
      const reactionName =
        a.command.defense === 'PARRY'
          ? 'Парирование'
          : a.command.defense === 'DODGE'
            ? 'Уклонение'
            : '';
      const react = reaction
        ? `${reactionName} цели: ${
            reaction.check.outcome === 'success'
              ? `успех (${reaction.check.totalDegrees} ст.), отменено попаданий ${reaction.cancelledHits}${reaction.counterattack ? ', есть право на контратаку' : ''}`
              : 'провал'
          }. `
        : '';
      const sup = a.result.suppression;
      const supText = sup
        ? ` Подавление: ${sup.targets
            .map(
              (t) =>
                `${name(t.actor)} — ${
                  t.status === 'SUPPRESSED'
                    ? 'подавлен'
                    : t.status === 'PASSED'
                      ? 'устоял'
                      : t.status === 'IMMUNE'
                        ? 'невосприимчив'
                        : 'решает ведущий'
                }`,
            )
            .join(', ')}.`
        : '';
      const summary0 = hits.length
        ? `${fire}${react}${hits
            .map((h) => `${locationName(h.location)} — урон ${h.finalDamage}`)
            .join(
              '; ',
            )}. ${name(storm?.target ?? a.command.target)}: ${a.hp[storm?.target ?? a.command.target]}${
            a.maxHp ? `/${a.maxHp}` : ''
          } ран.${effectText ? ` ${effectText}.` : ''}${manual.length ? ` Ведущему применить: ${manual.join(', ')}.` : ''}`
        : reaction && reaction.cancelledHits > 0
          ? `${fire}${react}Урона нет.`
          : `${fire}Промах — урон не бросается.`;
      const second = (
        a.result as { second?: { hits?: { location: string; finalDamage: number }[] } }
      ).second;
      const secondText = second
        ? ` Второе оружие: ${
            second.hits?.length
              ? second.hits
                  .map((h) => `${locationName(h.location)} — урон ${h.finalDamage}`)
                  .join('; ')
              : 'промах'
          }.`
        : '';
      const counterText = (a.command as { counter?: string }).counter ? 'Контратака. ' : '';
      const extra = a.result as {
        grappled?: boolean;
        stunned?: { rounds: number };
        knockdownDamage?: { finalDamage: number };
      };
      const sprayed = (
        a.result as {
          spray?: {
            dice: number[];
            targets: { actor: string; avoided: boolean; finalDamage?: number }[];
          };
        }
      ).spray;
      if (sprayed)
        return {
          ...base,
          title: `${name(a.command.actor)}: спрей (${weapon})`,
          summary: sprayed.targets.length
            ? `Урон ${sprayed.dice.join('+')}. ${sprayed.targets
                .map((t) =>
                  t.avoided
                    ? `${name(t.actor)} — увернулся`
                    : `${name(t.actor)} — ${t.finalDamage} ран`,
                )
                .join('; ')}.`
            : 'В конусе никого.',
          tone: 'success',
        };
      const thrown = (
        a.result as {
          thrown?: {
            hit: boolean;
            landed: { x: number; y: number } | null;
            blasts?: {
              scatter: { dir: number; distance: number } | null;
              dice: number[];
              targets: ThrowTarget[];
            }[];
            struck?: ThrowTarget;
            extinguished?: { burning: string[]; trails: number };
            smoke?: { radius: number; rounds: number };
          };
        }
      ).thrown;
      if (thrown) {
        const at = thrown.landed
          ? ` Упало в (${thrown.landed.x.toFixed(1)}; ${thrown.landed.y.toFixed(1)}).`
          : '';
        const who = (t: ThrowTarget) => {
          if (t.avoided) return `${name(t.actor)} — ушёл из зоны`;
          const fx = [
            ...(t.effects ?? []).map((e) =>
              e.passed
                ? `${e.property}: устоял`
                : `${e.property}: ${e.state ?? 'да'}${e.rounds ? ` (${e.rounds} р.)` : ''}`,
            ),
            ...(t.manual ?? []).map((m) => `${m} — ведущему`),
          ];
          return `${name(t.actor)} — ${t.finalDamage ?? 0} ран${fx.length ? ` (${fx.join(', ')})` : ''}`;
        };
        const boom = (thrown.blasts ?? [])
          .map(
            (x) =>
              `${x.scatter ? ` Разлёт: направление ${x.scatter.dir}, ${x.scatter.distance} м.` : ''}${x.dice.length ? ` Урон ${x.dice.join('+')}` : ' Без урона'}: ${
                x.targets.length ? x.targets.map(who).join('; ') : 'никого не задело'
              }.`,
          )
          .join('');
        const struck = thrown.struck ? ` ${who(thrown.struck)}.` : '';
        const ex = thrown.extinguished;
        const exText = ex
          ? ` Тушит пламя: ${ex.burning.length ? `погашены ${ex.burning.map(name).join(', ')}` : 'горящих нет'}${ex.trails ? `, погашено зон огня: ${ex.trails}` : ''}.`
          : '';
        const smoke = thrown.smoke
          ? ` Дым радиусом ${thrown.smoke.radius} м на ${thrown.smoke.rounds} р.`
          : '';
        return {
          ...base,
          title: `${name(a.command.actor)}: бросок (${weapon})`,
          summary: `${thrown.hit ? 'Точно в цель.' : 'Мимо — отклонение.'}${at}${boom}${struck}${exText}${smoke}`,
          tone: thrown.hit ? 'success' : 'warning',
        };
      }
      const blasts = (
        a.result as {
          blasts?: {
            scatter: { dir: number; distance: number } | null;
            dice: number[];
            targets: { actor: string; avoided: boolean; finalDamage?: number }[];
          }[];
        }
      ).blasts;
      if (blasts)
        return {
          ...base,
          title: `${name(a.command.actor)}: взрыв (${weapon})`,
          summary: blasts.length
            ? blasts
                .map(
                  (x) =>
                    `${x.scatter ? `Промах — отклонение: направление ${x.scatter.dir}, ${x.scatter.distance} м. ` : ''}Урон ${x.dice.join('+')}: ${
                      x.targets.length
                        ? x.targets
                            .map((t) =>
                              t.avoided
                                ? `${name(t.actor)} — ушёл из зоны`
                                : `${name(t.actor)} — ${t.finalDamage} ран`,
                            )
                            .join('; ')
                        : 'никого не задело'
                    }.`,
                )
                .join(' ')
            : 'Промах.',
          tone: 'success',
        };
      const tech = (a.command as { technique?: string }).technique;
      if (tech === 'grapple' || tech === 'stun' || tech === 'knockdown')
        return {
          ...base,
          title: `${name(a.command.actor)} → ${name(a.command.target)}: ${tech === 'grapple' ? 'захват' : tech === 'stun' ? 'оглушение' : 'сбить с ног'}`,
          summary:
            tech === 'grapple'
              ? extra.grappled
                ? 'Цель в захвате.'
                : 'Захват не удался.'
              : tech === 'stun'
                ? extra.stunned
                  ? `Цель оглушена на ${extra.stunned.rounds} р. (решение 140).`
                  : 'Оглушить не удалось.'
                : `${extra.knockdownDamage ? `Цель сбита с ног и получает ${extra.knockdownDamage.finalDamage} ран.` : 'Встречный тест Атлетики.'}`,
          tone: 'info',
        };
      const heat = (
        a.result as { overheat?: { dropped: boolean; finalDamage?: number; location?: string } }
      ).overheat;
      if (heat)
        return {
          ...base,
          title: `${name(a.command.actor)}: перегрев (${weapon})`,
          summary: heat.dropped
            ? 'Выстрела нет. Оружие брошено (СД), остывает раунд.'
            : `Выстрела нет. Урон в руку (${locationName(heat.location ?? '')}): ${String(heat.finalDamage)} ран. Оружие остывает раунд.`,
          tone: 'warning',
        };
      const summary = `${counterText}${summary0}${secondText}${supText}`;
      return {
        ...base,
        title: `${name(a.command.actor)} → ${name(a.command.target)} (${weapon})`,
        summary,
        tone: hits.length ? 'success' : 'info',
      };
    }
    case 'CONTEXT_REQUIRED':
    case 'TURN_CONTEXT_REQUIRED':
      return {
        ...base,
        title: 'Остановлено: нужен контекст или решение',
        summary: `${String(d.reason)} Состояние не изменено; уже брошенные кубики сохранены.`,
        tone: 'author',
      };
    case 'rejected':
      return {
        ...base,
        title: d.authorDecisionRequired ? 'Атака ждёт решения автора' : 'Команда отклонена',
        summary: String(d.reason),
        tone: d.authorDecisionRequired ? 'author' : 'error',
      };
    case 'roster-add':
      return {
        ...base,
        title: `Участник: ${String(d.name)}`,
        summary: d.side === 'b' ? 'Сторона Б.' : 'Сторона А.',
        tone: 'info',
      };
    case 'skr': {
      const to = d.to as { label: string; skr: number } | undefined;
      return {
        ...base,
        title: `СКР: ${name(d.actor)}`,
        summary: to ? `Вариант «${to.label}» — ${to.skr} м (решение 3).` : '',
        tone: 'info',
      };
    }
    case 'turn-action': {
      const c = d.command as { actor: string; type: string };
      const extra =
        c.type === 'reload'
          ? d.loaded
            ? `${String(d.weaponName)} перезаряжено (${String(d.odSpent)} ОД).`
            : `${String(d.weaponName)}: перезарядка идёт — ${String(d.progress)} из ${String(d.odRequired)} ОД, продолжится в следующем ходу.`
          : c.type === 'clear-malfunction'
            ? d.cleared
              ? `${String(d.weaponName)}: осечка исправлена.`
              : `${String(d.weaponName)}: исправить не удалось, оружие всё ещё заклинило.`
            : c.type === 'quick-aim'
              ? '+10 к следующему выстрелу.'
              : c.type === 'careful-aim'
                ? '+20 к следующему выстрелу.'
                : c.type === 'clean-armour' || c.type === 'drop-armour'
                  ? `Броня (${String(d.zone)}): ${c.type === 'clean-armour' ? 'очищена' : 'сброшена, эта зона без защиты'} — коррозия остановлена (${String(d.cost)} ОД).`
                  : c.type === 'break-free'
                    ? `Тест ${String(d.characteristic)}${d.modifier ? ` ${String(d.modifier)}` : ''}: ${d.freed ? 'вырвался, путы сброшены.' : 'не вырвался, всё ещё опутан.'} Потрачен весь ход (2 ОД).`
                    : c.type === 'free-partial'
                      ? `Тест СЛ: ${d.freed ? 'освободился от опутывания.' : 'не освободился.'} 1 ОД.`
                      : c.type === 'stabilize'
                        ? `${name(String(d.target))}: Медика −30 — ${d.stabilized ? `агония остановлена (стабилизирован на ${String(d.hours)} ч).` : 'не удалось, агония продолжается.'} Потрачен весь ход (2 ОД).`
                        : '';
      return {
        ...base,
        title: `${name(c.actor)}: ${String(d.name)}`,
        summary: extra,
        tone: 'success',
      };
    }
    case 'crippling':
      return {
        ...base,
        title: `${name(d.actor)}: калечащее ранение`,
        summary: `Потрачен 2-й ОД за ход — −${String(d.wounds)} ран («Калечащее», решение 89).${d.agony ? ' Раны на нуле — агония.' : ''}`,
        tone: 'warning',
      };
    case 'disarm': {
      const c = d.command as { actor: string; target: string };
      return {
        ...base,
        title: `${name(c.actor)} пытается разоружить ${name(c.target)}`,
        summary: d.won
          ? `Встречный тест НР выигран (${String(d.degrees)} ст.): ${String(d.weaponName)} выбито и отлетает на ${String(d.distance)} м${Number(d.degrees) >= 3 ? ', направление выбирает атакующий' : ' в случайную сторону'}.${Number(d.degrees) >= 5 ? ' 5+ ст.: атакующий со свободной рукой может забрать его себе.' : ''} Потрачен 1 ОД.`
          : `Встречный тест НР не выигран — оружие осталось в руках. Потрачен 1 ОД.`,
        tone: d.won ? 'success' : 'info',
      };
    }
    case 'disarm-rejected':
      return {
        ...base,
        title: 'Разоружить не удалось',
        summary: String(d.reason),
        tone: 'warning',
      };
    case 'grapple': {
      const c = d.command as { actor: string };
      const op = d.opposed as { winner: { actorId: string } | null } | null;
      const dmg = d.damage as { finalDamage: number } | null;
      return {
        ...base,
        title: `${name(c.actor)}: захват — ${String(d.name)}`,
        summary: [
          op
            ? op.winner?.actorId === c.actor
              ? 'Встречный тест выигран.'
              : 'Встречный тест не выигран.'
            : '',
          dmg ? `Урон: ${dmg.finalDamage} ран.` : '',
          Number(d.distance) > 0
            ? `Толчок до ${String(d.distance)} м — укажите клетку на карте.`
            : '',
          d.released ? 'Захват окончен.' : '',
        ]
          .filter(Boolean)
          .join(' '),
        tone: 'info',
      };
    }
    case 'grapple-rejected':
      return {
        ...base,
        title: `${String(d.name)} не выполнено`,
        summary: String(d.reason),
        tone: 'warning',
      };
    case 'push-placed':
      return {
        ...base,
        title: 'Толчок в захвате',
        summary: 'Оба участника сдвинуты.',
        tone: 'info',
      };
    case 'extract': {
      const c = d.command as { actor: string };
      return {
        ...base,
        title: `${name(c.actor)} извлекает ${String(d.weaponName)} из раны ${name(d.target)}`,
        summary: `к5 (${String(d.die)}) + бСЛ ${String(d.sl)} − ½ бВН ${String(d.half)} → −${String(d.wounds)} ран (решение 119). ${d.inHand ? 'Оружие в руке извлёкшего.' : 'Свободной руки нет — оружие на полу.'} Потрачен 1 ОД.`,
        tone: 'warning',
      };
    }
    case 'extract-rejected':
      return { ...base, title: 'Извлечь не удалось', summary: String(d.reason), tone: 'warning' };
    case 'weapon-taken':
      return {
        ...base,
        title: `${name(d.actor)} забирает ${String(d.weaponName)}`,
        summary:
          'Выбитое оружие теперь в его руке до конца боя; его можно выбить обратно (решение 114).',
        tone: 'success',
      };
    case 'weapon-landed':
      return {
        ...base,
        title: `${String(d.weaponName)} упало на карту`,
        summary: 'Поднять можно, только подойдя к нему (решение 108).',
        tone: 'info',
      };
    case 'take-weapon':
      return {
        ...base,
        title: `${name((d.command as { actor: string }).actor)} берёт ${String(d.weaponName)}`,
        summary: (d.command as { keep?: string }).keep
          ? `Взято во вторую руку (${String(d.cost)}): теперь два оружия (решение 105).`
          : `Оружие в руках (${String(d.cost)}). Остальное убрано.`,
        tone: 'success',
      };
    case 'drop-weapon':
      return {
        ...base,
        title: `${name((d.command as { actor: string }).actor)} бросает ${String(d.weaponName)}`,
        summary: d.sling ? 'Отпущено и повисло на ремне (СД).' : 'Оружие брошено на пол (СД).',
        tone: 'info',
      };
    case 'pick-up-weapon':
      return {
        ...base,
        title: `${name((d.command as { actor: string }).actor)} ${d.from === 'sling' ? 'берёт с ремня' : 'поднимает'} ${String(d.weaponName)}`,
        summary: `Оружие в руках (${String(d.cost)}, решение 82).`,
        tone: 'success',
      };
    case 'pick-up-weapon-rejected':
    case 'take-weapon-rejected':
    case 'drop-weapon-rejected':
      return { ...base, title: 'Не удалось', summary: String(d.reason), tone: 'warning' };
    case 'turn-action-rejected':
      return {
        ...base,
        title: `${String(d.name)} не выполнено`,
        summary: String(d.reason),
        tone: 'warning',
      };
    case 'brace':
      return {
        ...base,
        title: `${name((d.command as { actor: string }).actor)}: оружие на опоре`,
        summary: `${String(d.weaponName)} установлено на опору (1 ОД, «Бой» A55): доступны очереди, без штрафа −30. Любое движение снимает опору.`,
        tone: 'success',
      };
    case 'overwatch': {
      const c = d.command as { actor: string; triggers: string[]; heading: number };
      return {
        ...base,
        title: `${name(c.actor)}: дозор`,
        summary: `${String(d.weaponName)} · сектор 90° · на: ${c.triggers.map((t) => (t === 'move' ? 'движение врага' : 'атаку врага')).join(', ')} · 1 ОД, ход завершён`,
        tone: 'success',
      };
    }
    case 'overwatch-rejected':
      return { ...base, title: 'Дозор не заявлен', summary: String(d.reason), tone: 'warning' };
    case 'watch-trigger':
      return {
        ...base,
        title:
          d.kind === 'palisade'
            ? `Частокол: ${name(String(d.watcher))} может ударить`
            : `Дозор: ${name(String(d.watcher))} может стрелять`,
        summary:
          d.kind === 'palisade'
            ? 'Частокол: враг бежит натиском — удар длинным оружием до его удара.'
            : d.kind === 'attack'
              ? 'Враг в секторе начинает атаку — дозорный стреляет первым (реакция).'
              : 'Враг вошёл в сектор — остановлен в точке входа, дозорный стреляет (реакция).',
        tone: 'warning',
      };
    case 'watch-skip':
      return {
        ...base,
        title: `${name(String(d.watcher))} не стреляет из дозора`,
        summary: 'Действие врага продолжается.',
        tone: 'success',
      };
    case 'watch-continue':
      return {
        ...base,
        title: `${name(String(d.actor))}: ${d.stopped ? 'остановился после дозора' : 'продолжает движение'}`,
        summary: d.stopped
          ? 'Движение закончено в точке входа.'
          : 'Движение продолжено после выстрела из дозора.',
        tone: 'success',
      };
    case 'stance': {
      const c = d.command as { actor: string; stance?: string; grip?: string };
      const to = d.to as { stance: MeleeStanceName; grip: MeleeGrip };
      return {
        ...base,
        title: `${name(c.actor)}: ${c.stance ? 'стойка' : 'хват'} (СД)`,
        summary: `Стойка: ${stanceLabel[to.stance]} · хват: ${gripLabel[to.grip]}`,
        tone: 'success',
      };
    }
    case 'stance-rejected':
      return {
        ...base,
        title: 'Сменить стойку или хват не удалось',
        summary: String(d.reason),
        tone: 'warning',
      };
    case 'brace-rejected':
      return {
        ...base,
        title: 'Установить на опору не удалось',
        summary: String(d.reason),
        tone: 'warning',
      };
    case 'roster-side':
      return {
        ...base,
        title: `Сторона: ${name(d.actor)}`,
        summary: d.side === 'b' ? 'Сторона Б.' : 'Сторона А.',
        tone: 'info',
      };
    case 'roster-remove':
      return { ...base, title: `Убран: ${name(d.actor)}`, summary: '', tone: 'info' };
    case 'combat-start':
      return {
        ...base,
        title: 'Бой начат',
        summary: `Инициатива 1к10 + бЛВ. Первым ходит ${name(d.active)}.`,
        tone: 'info',
      };
    case 'cancel-unstarted':
      return {
        ...base,
        title: 'Неначатая команда отменена',
        summary: 'Кубики не бросались, состояние не менялось.',
        tone: 'info',
      };
    default:
      return { ...base, title: entry.type, summary: '', tone: 'info' };
  }
}
