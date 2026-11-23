import { useEffect, useState } from 'react';
import {
  ARMOUR_ZONES,
  armourZoneName,
  CHARACTERISTICS,
  characterProblems,
  emptyCharacter,
  type CharacterDocument,
} from '../game/character';
import {
  characterFromProfile,
  parseCharacterFile,
  PROFILE_CHARACTERS,
  serializeCharacter,
} from '../game/character-file';
import { footprintForSize } from '../game/grid';
import { loadLibrary, saveLibrary } from './character-library';
import {
  armourById,
  armourFromItems,
  armourSummary,
  arsenal,
  searchArsenal,
  weaponById,
  weaponSummary,
} from '../game/arsenal';
import { saveTextFile } from './download';
import {
  skillCharacteristic,
  skillNames,
  talentEntries,
  talentSummary,
} from '../game/profiles-lists';
import {
  characterFromGenerator,
  readGeneratorOutbox,
  removeFromGeneratorOutbox,
  type GeneratorCharacter,
} from '../game/generator-import';

type Notify = (text: string, tone: 'success' | 'warning' | 'error' | 'info') => void;
const newId = () => `char-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** Character editor and library (author rulings 47–51). */
export function CharacterEditor(props: { onClose: () => void; notify: Notify }) {
  const [library, setLibrary] = useState<CharacterDocument[]>(() => loadLibrary());
  const [doc, setDoc] = useState<CharacterDocument>(() => library[0] ?? emptyCharacter(newId()));
  const problems = characterProblems(doc);
  // Characters sent by the generator («В KADAT VTT»); re-read when the tab comes back.
  const [outbox, setOutbox] = useState<GeneratorCharacter[]>(() => readGeneratorOutbox());
  useEffect(() => {
    const refresh = () => setOutbox(readGeneratorOutbox());
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  const takeFromGenerator = (g: GeneratorCharacter) => {
    setDoc(characterFromGenerator(g, newId()));
    removeFromGeneratorOutbox(g.name);
    setOutbox(readGeneratorOutbox());
    props.notify(
      `«${g.name}» взят из генератора. Проверьте оружие и броню (ОБ — «Взять ОБ из брони») и сохраните в библиотеку.`,
      'info',
    );
  };
  const set = (patch: Partial<CharacterDocument>) => setDoc((d) => ({ ...d, ...patch }));
  const footprint = (() => {
    try {
      const f = footprintForSize(doc.size);
      return `${f.width} × ${f.height}`;
    } catch {
      return 'не задана для Размера больше 2';
    }
  })();

  const storeInLibrary = () => {
    if (problems.length) {
      props.notify(`Не сохранено: ${problems.join('; ')}`, 'error');
      return;
    }
    const next = [doc, ...library.filter((c) => c.id !== doc.id)];
    setLibrary(next);
    const stored = saveLibrary(next);
    props.notify(
      stored
        ? `«${doc.name}» сохранён в библиотеке этого браузера. Для надёжности сохраните и в файл.`
        : 'Браузер не дал сохранить библиотеку. Сохраните персонажа в файл.',
      stored ? 'success' : 'warning',
    );
  };
  const saveFile = () => {
    let text: string;
    try {
      text = serializeCharacter(doc);
    } catch (e) {
      props.notify(e instanceof Error ? e.message : String(e), 'error');
      return;
    }
    saveTextFile(`${doc.name.replace(/[\\/:*?"<>|]+/g, '_')}.kadat-character.json`, text);
    props.notify(`Файл персонажа «${doc.name}» сохранён.`, 'success');
  };
  const openFile = async (file: File) => {
    try {
      const opened = parseCharacterFile(await file.text());
      setDoc(opened);
      props.notify(
        `Открыт «${opened.name}». Сохраните в библиотеку, чтобы он был под рукой.`,
        'info',
      );
    } catch (e) {
      props.notify(`Файл не открыт: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  };
  const remove = () => {
    const next = library.filter((c) => c.id !== doc.id);
    setLibrary(next);
    saveLibrary(next);
    setDoc(next[0] ?? emptyCharacter(newId()));
    props.notify(`«${doc.name}» убран из библиотеки браузера (файлы не тронуты).`, 'info');
  };

  return (
    <div className="character-editor" data-testid="character-editor">
      <aside className="panel char-list">
        <div className="char-list-head">
          <h2>Персонажи</h2>
          <button type="button" className="btn-ghost" onClick={props.onClose}>
            К сцене
          </button>
        </div>
        <div className="stack">
          <button type="button" className="primary" onClick={() => setDoc(emptyCharacter(newId()))}>
            Новый персонаж
          </button>
          <label className="file-button btn-ghost">
            Открыть файл персонажа…
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void openFile(f);
              }}
            />
          </label>
          <a className="btn-ghost button-link" href="./generator/index.html">
            Создать в генераторе…
          </a>
          {outbox.length > 0 && (
            <div className="generator-outbox" aria-label="Из генератора">
              <h3>Из генератора</h3>
              {outbox.map((g) => (
                <button
                  key={`${g.name}-${g.exportedAt}`}
                  type="button"
                  onClick={() => takeFromGenerator(g)}
                >
                  <strong>{g.name}</strong>
                  <span className="muted small">
                    {g.race.name} · {g.specialty.name}
                  </span>
                </button>
              ))}
            </div>
          )}
          <details>
            <summary className="muted small">Из профиля таблицы</summary>
            <div className="stack" style={{ marginTop: 8 }}>
              {PROFILE_CHARACTERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setDoc({ ...characterFromProfile(p.id), id: newId() })}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </details>
        </div>
        <h3>Библиотека браузера</h3>
        {library.length === 0 ? (
          <p className="muted small">Пусто. Сохраните персонажа — он появится здесь.</p>
        ) : (
          <ul className="char-items">
            {library.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={c.id === doc.id ? 'chosen' : ''}
                  onClick={() => setDoc(c)}
                >
                  <strong>{c.name}</strong>
                  <span className="muted small">
                    {c.kind === 'npc' ? 'НПС' : 'персонаж'} · раны {c.wounds}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="panel char-form">
        <div className="row">
          <label>
            Имя
            <input value={doc.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label style={{ flex: '0 1 160px' }}>
            Вид
            <select
              value={doc.kind}
              onChange={(e) => set({ kind: e.target.value as CharacterDocument['kind'] })}
            >
              <option value="character">Персонаж</option>
              <option value="npc">НПС</option>
            </select>
          </label>
        </div>
        <label>
          Описание
          <input value={doc.description} onChange={(e) => set({ description: e.target.value })} />
        </label>

        <h3>Характеристики</h3>
        <div className="char-stats">
          {CHARACTERISTICS.map((k) => (
            <div key={k} className="char-stat">
              <span className="char-stat-name">{k}</span>
              <input
                aria-label={`${k}: значение`}
                type="number"
                value={doc.characteristics[k].value}
                onChange={(e) =>
                  set({
                    characteristics: {
                      ...doc.characteristics,
                      [k]: { ...doc.characteristics[k], value: Number(e.target.value) },
                    },
                  })
                }
              />
              <input
                aria-label={`${k}: Сверх`}
                title="Сверххарактеристика"
                type="number"
                className="char-super"
                value={doc.characteristics[k].super}
                onChange={(e) =>
                  set({
                    characteristics: {
                      ...doc.characteristics,
                      [k]: { ...doc.characteristics[k], super: Number(e.target.value) },
                    },
                  })
                }
              />
            </div>
          ))}
        </div>
        <p className="muted small">Второе поле — Сверххарактеристика.</p>

        <div className="row">
          <label>
            Раны (максимум)
            <input
              type="number"
              value={doc.wounds}
              onChange={(e) => set({ wounds: Number(e.target.value) })}
            />
          </label>
          <label>
            Размер
            <input
              type="number"
              value={doc.size}
              onChange={(e) => set({ size: Number(e.target.value) })}
            />
            <span className="small">Токен: {footprint}</span>
          </label>
        </div>

        <h3>Движение (СКР)</h3>
        <p className="muted small">
          Варианты из профиля; выбранный действует в бою, его можно переключать во время игры.
        </p>
        {doc.movement.options.map((o, i) => (
          <div key={i} className="row char-row">
            <label className="check" style={{ flex: '0 0 auto' }}>
              <input
                type="radio"
                name="skr"
                checked={doc.movement.current === i}
                onChange={() => set({ movement: { ...doc.movement, current: i } })}
              />
              действует
            </label>
            <label>
              Название
              <input
                value={o.label}
                onChange={(e) =>
                  set({
                    movement: {
                      ...doc.movement,
                      options: doc.movement.options.map((x, j) =>
                        j === i ? { ...x, label: e.target.value } : x,
                      ),
                    },
                  })
                }
              />
            </label>
            <label style={{ flex: '0 1 110px' }}>
              СКР, м
              <input
                type="number"
                step={0.5}
                value={o.skr}
                onChange={(e) =>
                  set({
                    movement: {
                      ...doc.movement,
                      options: doc.movement.options.map((x, j) =>
                        j === i ? { ...x, skr: Number(e.target.value) } : x,
                      ),
                    },
                  })
                }
              />
            </label>
            <button
              type="button"
              className="btn-ghost"
              disabled={doc.movement.options.length < 2}
              onClick={() =>
                set({
                  movement: {
                    options: doc.movement.options.filter((_, j) => j !== i),
                    current: Math.max(
                      0,
                      doc.movement.current > i
                        ? doc.movement.current - 1
                        : doc.movement.current === i
                          ? 0
                          : doc.movement.current,
                    ),
                  },
                })
              }
            >
              Убрать
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn-ghost"
          onClick={() =>
            set({
              movement: {
                ...doc.movement,
                options: [...doc.movement.options, { label: 'Вариант', skr: currentOr(doc) }],
              },
            })
          }
        >
          + Вариант СКР
        </button>

        <h3>Броня (ОБ по зонам)</h3>
        <div className="row">
          {ARMOUR_ZONES.map((z) => (
            <label key={z} style={{ flex: '1 1 90px' }}>
              {armourZoneName[z]}
              <input
                type="number"
                value={doc.armour[z]}
                onChange={(e) => set({ armour: { ...doc.armour, [z]: Number(e.target.value) } })}
              />
            </label>
          ))}
        </div>

        <h3>Поддоспешник (ОБ при попадании в сочленения)</h3>
        <div className="row">
          {ARMOUR_ZONES.map((z) => (
            <label key={z} style={{ flex: '1 1 90px' }}>
              {armourZoneName[z]}
              <input
                type="number"
                placeholder="нет"
                value={doc.undersuit[z] ?? ''}
                onChange={(e) =>
                  set({
                    undersuit: {
                      ...doc.undersuit,
                      [z]: e.target.value === '' ? null : Number(e.target.value),
                    },
                  })
                }
              />
            </label>
          ))}
        </div>

        <h3>Навыки</h3>
        <p className="muted small">
          Бонус +0 — тест по характеристике; +10, +15 — бонус добавляется. Навыка нет — штраф
          выбирает ведущий в бою.
        </p>
        <datalist id="profile-skills">
          {skillNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        {doc.skills.map((s, i) => (
          <div key={i} className="row char-row">
            <label>
              Навык
              {skillCharacteristic(s.name) && (
                <span className="muted small"> ({skillCharacteristic(s.name)})</span>
              )}
              <input
                list="profile-skills"
                placeholder="начните вводить: Уклонение, Атлетика…"
                value={s.name}
                onChange={(e) =>
                  set({
                    skills: doc.skills.map((x, j) =>
                      j === i ? { ...x, name: e.target.value } : x,
                    ),
                  })
                }
              />
            </label>
            <label style={{ flex: '0 1 100px' }}>
              Бонус
              <input
                type="number"
                step={5}
                value={s.bonus}
                onChange={(e) =>
                  set({
                    skills: doc.skills.map((x, j) =>
                      j === i ? { ...x, bonus: Number(e.target.value) } : x,
                    ),
                  })
                }
              />
            </label>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => set({ skills: doc.skills.filter((_, j) => j !== i) })}
            >
              Убрать
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn-ghost"
          onClick={() => set({ skills: [...doc.skills, { name: '', bonus: 0 }] })}
        >
          + Навык
        </button>

        <h3>Таланты</h3>
        <label>
          По одному на строке
          <textarea
            rows={5}
            value={doc.talents.join('\n')}
            onChange={(e) =>
              set({
                talents: e.target.value
                  .split('\n')
                  .map((t) => t.trimStart())
                  .filter((t, i, all) => t.trim() || i === all.length - 1),
              })
            }
            onBlur={() => set({ talents: doc.talents.map((t) => t.trim()).filter(Boolean) })}
          />
        </label>
        <ArsenalSearch
          label="Найти талант в «Профилях персонажей»"
          placeholder="например: спринт, мастер, парное"
          search={(q) => searchArsenal(talentEntries, q)}
          describe={talentSummary}
          onPick={(t) =>
            set({
              talents: [...doc.talents.map((x) => x.trim()).filter(Boolean), t.name].filter(
                (x, i, all) => all.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i,
              ),
            })
          }
        />

        <h3>Оружие (Арсенал)</h3>
        <ItemList
          items={doc.weapons}
          describe={(ref) => {
            const w = ref ? weaponById(ref) : undefined;
            return w ? weaponSummary(w) : 'нет в Арсенале — только название';
          }}
          onRemove={(i) => set({ weapons: doc.weapons.filter((_, j) => j !== i) })}
        />
        <ArsenalSearch
          label="Найти оружие в Арсенале"
          placeholder="например: лазган, болтер, цепной меч"
          search={(q) => searchArsenal(arsenal.weapons, q)}
          describe={weaponSummary}
          onPick={(w) => set({ weapons: [...doc.weapons, { name: w.name, ref: w.id }] })}
        />

        <h3>Броня (Арсенал)</h3>
        <ItemList
          items={doc.armourItems}
          describe={(ref) => {
            const a = ref ? armourById(ref) : undefined;
            return a ? armourSummary(a) : 'нет в Арсенале — только название';
          }}
          onRemove={(i) => set({ armourItems: doc.armourItems.filter((_, j) => j !== i) })}
        />
        <ArsenalSearch
          label="Найти броню в Арсенале"
          placeholder="например: флак, панцирь, шлем"
          search={(q) => searchArsenal(arsenal.armour, q)}
          describe={armourSummary}
          onPick={(a) => set({ armourItems: [...doc.armourItems, { name: a.name, ref: a.id }] })}
        />
        {(() => {
          const fill = armourFromItems(doc.armourItems);
          return (
            <div className="row">
              <button
                type="button"
                className="btn-ghost"
                disabled={!fill.armour}
                title={fill.reason ?? 'ОБ по зонам из выбранной брони'}
                onClick={() =>
                  fill.armour &&
                  set({
                    armour: fill.armour,
                    undersuit: fill.undersuit ?? {
                      head: null,
                      torso: null,
                      arms: null,
                      legs: null,
                    },
                  })
                }
              >
                Взять ОБ из брони
              </button>
              {fill.reason && <span className="muted small">{fill.reason}</span>}
            </div>
          );
        })()}

        <h3>Особенности и импланты</h3>
        <textarea rows={3} value={doc.traits} onChange={(e) => set({ traits: e.target.value })} />
        <h3>Заметки</h3>
        <textarea rows={3} value={doc.notes} onChange={(e) => set({ notes: e.target.value })} />

        {problems.length > 0 && (
          <ul className="problems" data-testid="character-problems">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <div className="row char-actions">
          <button type="button" className="primary" onClick={storeInLibrary}>
            Сохранить в библиотеку
          </button>
          <button type="button" onClick={saveFile}>
            Сохранить в файл
          </button>
          {library.some((c) => c.id === doc.id) && (
            <button type="button" className="btn-ghost" onClick={remove}>
              Убрать из библиотеки
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
const currentOr = (d: CharacterDocument) => d.movement.options[d.movement.current]?.skr ?? 3;

/** Items chosen from the Arsenal, with their profile line. */
function ItemList(props: {
  items: readonly { name: string; ref: string | null }[];
  describe: (ref: string | null) => string;
  onRemove: (index: number) => void;
}) {
  if (!props.items.length) return <p className="muted small">Пока ничего не выбрано.</p>;
  return (
    <ul className="arsenal-items">
      {props.items.map((it, i) => (
        <li key={`${it.ref ?? it.name}-${i}`}>
          <div>
            <strong>{it.name}</strong>
            <span className="muted small">{props.describe(it.ref)}</span>
          </div>
          <button type="button" className="btn-ghost" onClick={() => props.onRemove(i)}>
            Убрать
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Search box over the Arsenal: type words of the name, click a result to add it. */
function ArsenalSearch<
  T extends { id: string; name: string; sheet: string; group: string | null },
>(props: {
  label: string;
  placeholder?: string;
  search: (query: string) => T[];
  describe: (item: T) => string;
  onPick: (item: T) => void;
}) {
  const [query, setQuery] = useState('');
  const results = props.search(query);
  return (
    <div className="arsenal-search">
      <label>
        {props.label}
        <input
          value={query}
          placeholder={props.placeholder ?? 'например: лазган, флак, цепной'}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {query.trim() && (
        <ul className="arsenal-results" role="listbox">
          {results.length === 0 && <li className="muted small">Ничего не найдено.</li>}
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => {
                  props.onPick(r);
                  setQuery('');
                }}
              >
                <strong>{r.name}</strong>
                <span className="muted small">
                  {r.sheet.trim()} · {props.describe(r)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
