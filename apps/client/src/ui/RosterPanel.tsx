import { useRef, useState } from 'react';
import type { CharacterDocument } from '../game/character';
import {
  characterFromProfile,
  parseCharacterFile,
  PROFILE_CHARACTERS,
} from '../game/character-file';
import { actorIds, combatant, type ActorId, type Battle, type Side } from '../game/model';
import { loadLibrary } from './character-library';

const sideName: Record<Side, string> = { a: 'Сторона А', b: 'Сторона Б' };

/**
 * Participants before the fight (step 4): characters from the browser library, a character
 * file, or the profiles of «Профили персонажей». The same character may be added several
 * times (a squad of NPCs).
 */
export function RosterPanel(props: {
  battle: Battle;
  onAdd: (character: CharacterDocument, side: Side) => void;
  onRemove: (id: ActorId) => void;
  onSide: (id: ActorId, side: Side) => void;
}) {
  const [library, setLibrary] = useState<CharacterDocument[]>(() => loadLibrary());
  const [choice, setChoice] = useState('');
  const [side, setSideChoice] = useState<Side>('b');
  const [fileError, setFileError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const ids = actorIds(props.battle);
  const add = () => {
    if (choice.startsWith('lib:')) {
      const c = library.find((x) => x.id === choice.slice(4));
      if (c) props.onAdd(c, side);
    } else if (choice.startsWith('profile:'))
      props.onAdd(characterFromProfile(choice.slice(8)), side);
  };
  return (
    <section className="panel roster" aria-label="Участники боя">
      <h2>Участники</h2>
      <ul className="roster-list">
        {ids.map((id) => {
          const c = combatant(props.battle, id);
          return (
            <li key={id}>
              <span className={`avatar small ${c.side === 'b' ? 'side-b' : 'side-a'}`}>
                {c.character.name[0]}
              </span>
              <span className="roster-name">{c.character.name}</span>
              <select
                aria-label={`Сторона: ${c.character.name}`}
                value={c.side}
                onChange={(e) => props.onSide(id, e.target.value as Side)}
              >
                <option value="a">{sideName.a}</option>
                <option value="b">{sideName.b}</option>
              </select>
              <button
                type="button"
                className="btn-ghost"
                aria-label={`Убрать ${c.character.name}`}
                onClick={() => props.onRemove(id)}
              >
                ✕
              </button>
            </li>
          );
        })}
        {!ids.length && <li className="muted small">Пока никого. Добавьте участников ниже.</li>}
      </ul>
      <div className="stack">
        <label>
          Добавить
          <select
            value={choice}
            aria-label="Персонаж для добавления"
            onFocus={() => setLibrary(loadLibrary())}
            onChange={(e) => setChoice(e.target.value)}
          >
            <option value="">— выберите персонажа —</option>
            {library.length > 0 && (
              <optgroup label="Библиотека (редактор персонажей)">
                {library.map((c) => (
                  <option key={c.id} value={`lib:${c.id}`}>
                    {c.name}
                    {c.kind === 'npc' ? ' (НПС)' : ''}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Профили персонажей">
              {PROFILE_CHARACTERS.map((p) => (
                <option key={p.id} value={`profile:${p.id}`}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <div className="row">
          <select
            aria-label="Сторона нового участника"
            value={side}
            onChange={(e) => setSideChoice(e.target.value as Side)}
          >
            <option value="a">{sideName.a}</option>
            <option value="b">{sideName.b}</option>
          </select>
          <button type="button" className="primary" disabled={!choice} onClick={add}>
            Добавить на карту
          </button>
        </div>
        <button type="button" className="btn-ghost" onClick={() => file.current?.click()}>
          Из файла персонажа…
        </button>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              props.onAdd(parseCharacterFile(await f.text()), side);
              setFileError(null);
            } catch (error) {
              setFileError(error instanceof Error ? error.message : String(error));
            }
          }}
        />
        {fileError && <p className="weapon-note badge-blocked">{fileError}</p>}
        <p className="muted small">
          Новый участник встаёт на ближайшее свободное место у центра карты; потом его можно
          перетащить. Один и тот же персонаж добавляется сколько угодно раз (отряд НПС).
        </p>
      </div>
    </section>
  );
}
