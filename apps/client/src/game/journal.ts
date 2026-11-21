import type { DiceRoll } from '@kadat/contracts';
import { actor, type ActorId, type LogEntry, weapons } from './model';
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
const name = (id: unknown) => (typeof id === 'string' ? (actor(id as ActorId)?.name ?? id) : '—');
const metres = (n: number) => `${Number(n.toFixed(2))} м`;
const dice = (rolls: unknown) =>
  Array.isArray(rolls) ? (rolls as DiceRoll[]).map((r) => `к${r.sides}=${r.value}`).join(', ') : '';

interface AttackDetail {
  command: AttackCommand;
  rolls: DiceRoll[];
  result: {
    damage: { finalDamage: number | null } | null;
    hit?: { location: string };
  };
  hp: Record<ActorId, number>;
}

/** Human-readable journal line; the raw structured entry stays available for inspection. */
export function describeEntry(entry: LogEntry): JournalLine {
  const d = entry.detail as Record<string, unknown>;
  const base = { id: entry.id, type: entry.type, dice: dice(d?.rolls) };
  switch (entry.type) {
    case 'loaded':
      return {
        ...base,
        title: 'Сцена загружена',
        summary: 'Профили из канонических таблиц, тестовая расстановка на карте 20 × 20 м.',
        tone: 'info',
      };
    case 'placement': {
      const after = d.after as { x: number; y: number };
      return {
        ...base,
        title: `Расстановка: ${name(d.actor)}`,
        summary: `Перенесён в (${metres(after.x)}; ${metres(after.y)}) до начала боя, ОД не тратятся.`,
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
    case 'combat-start':
      return {
        ...base,
        title: 'Бой начат',
        summary: `Раунд 1. Ход: ${name(d.active)}.`,
        tone: 'success',
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
        title: `${name(c.actor)}: ${label}`,
        summary: `${metres(d.distance as number)} из ${metres(d.maxDistance as number)} · ОД ${d.odBefore} → ${d.odAfter}`,
        tone: 'success',
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
      const weapon = weapons.find((w) => w.id === a.command.weapon)?.name ?? a.command.weapon;
      const damage = a.result.damage;
      const summary = damage
        ? `Попадание: ${locationName(a.result.hit?.location ?? '?')}, итоговый урон ${damage.finalDamage ?? 0}. ${name(a.command.target)}: ${a.hp[a.command.target]}/${actor(a.command.target).max}.`
        : 'Промах — урон не бросается.';
      return {
        ...base,
        title: `${name(a.command.actor)} → ${name(a.command.target)} (${weapon})`,
        summary,
        tone: damage ? 'success' : 'info',
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
        title: 'Команда отклонена',
        summary: String(d.reason),
        tone: 'error',
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
