import type { DiceRoll } from '@kadat/contracts';
import type { ActorId, LogEntry } from './model';
import { moveModes, type MoveCommand, type AttackCommand } from './engine';

export type JournalTone = 'info' | 'success' | 'warning' | 'author' | 'error';
export interface JournalLine {
  id: number;
  type: string;
  title: string;
  summary: string;
  tone: JournalTone;
  dice: string;
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
    hits?: { location: string; finalDamage: number; manual?: string[] }[];
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
  const base = { id: entry.id, type: entry.type, dice: dice(d?.rolls) };
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
    case 'next-turn':
      return {
        ...base,
        title: 'Ход передан',
        summary: `Теперь ходит ${name(d.active)}.`,
        tone: 'info',
      };
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
    case 'posture':
      return {
        ...base,
        title: `${name((d.command as { actor: string }).actor)}: Встать`,
        summary: `Поза: ${d.from} → ${d.to} · ОД ${d.odBefore} → ${d.odAfter}`,
        tone: 'success',
      };
    case 'posture-rejected':
      return { ...base, title: 'Встать не удалось', summary: String(d.reason), tone: 'warning' };
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
      const fire =
        r?.mode && r.shotsFired
          ? `${modeName[r.mode] ?? r.mode}: выстрелов ${r.shotsFired}, зарядов ${r.ammoSpent}, попаданий ${r.hitsGenerated}. `
          : '';
      const manual = [...new Set(hits.flatMap((h) => h.manual ?? []))];
      const summary = hits.length
        ? `${fire}${hits
            .map((h) => `${locationName(h.location)} — урон ${h.finalDamage}`)
            .join('; ')}. ${name(a.command.target)}: ${a.hp[a.command.target]}${
            a.maxHp ? `/${a.maxHp}` : ''
          } ран.${manual.length ? ` Ведущему применить: ${manual.join(', ')}.` : ''}`
        : `${fire}Промах — урон не бросается.`;
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
    case 'brace':
      return {
        ...base,
        title: `${name((d.command as { actor: string }).actor)}: оружие на опоре`,
        summary: `${String(d.weaponName)} установлено на опору (1 ОД, «Бой» A55): доступны очереди, без штрафа −30. Любое движение снимает опору.`,
        tone: 'success',
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
