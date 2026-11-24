import { characterProblems, type CharacterDocument } from '../game/character';

/**
 * Quick-access list of ready characters in this browser. The file (`*.kadat-character.json`)
 * is the lasting copy (ruling 51); the list is a convenience and may be empty in a private
 * window or after the browser data is cleared.
 */
const KEY = 'kadat.characters.v1';

export function loadLibrary(): CharacterDocument[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return (
      list
        // Characters saved before faction tags (ruling 135) get an empty list.
        .map((c: unknown) =>
          typeof c === 'object' && c !== null && !('factions' in c) ? { ...c, factions: [] } : c,
        )
        .filter(
          (c): c is CharacterDocument =>
            typeof c === 'object' &&
            c !== null &&
            characterProblems(c as CharacterDocument).length === 0,
        )
    );
  } catch {
    return [];
  }
}

export function saveLibrary(list: readonly CharacterDocument[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}
