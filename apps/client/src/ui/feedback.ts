import { describeEntry, type JournalTone } from '../game/journal';
import type { LogEntry } from '../game/model';
import { describeEngineError } from '../game/errors';

export interface Feedback {
  text: string;
  tone: JournalTone;
}

/**
 * Message for the command that just ran. Only a journal entry appended by this command is used;
 * an error thrown before anything was logged must never be shown as an older entry's text.
 */
export function commandFeedback(
  logLengthBefore: number,
  log: LogEntry[],
  error?: unknown,
  names?: (id: string) => string,
): Feedback {
  const entry = log.length > logLengthBefore ? log.at(-1) : undefined;
  if (entry) {
    const line = describeEntry(entry, names);
    if (error === undefined) return { text: `${line.title}. ${line.summary}`, tone: line.tone };
    return {
      text: `${line.title}: ${line.summary}`,
      tone: line.tone === 'author' ? 'author' : line.tone === 'warning' ? 'warning' : 'error',
    };
  }
  if (error === undefined) return { text: 'Команда выполнена.', tone: 'info' };
  return { text: describeEngineError(error).text, tone: 'error' };
}
