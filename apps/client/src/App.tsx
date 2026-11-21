import { useEffect, useMemo, useState } from 'react';
import { fixedDice, randomDice, seededDice } from './game/dice';
import {
  actorStatus,
  applyMap,
  attack,
  cancelUnstarted,
  moveActor,
  movementOptions,
  nextTurn,
  placeActor,
  resumeAttack,
  selectManualOrder,
  setFootprint,
  standUp,
  startCombat,
  turnInfo,
  type MoveMode,
} from './game/engine';
import type { JournalTone } from './game/journal';
import { createBattle, ids, weapons, type ActorId } from './game/model';
import type { FloorColorId } from './game/map';
import {
  commit,
  draftDiffers,
  draftProblems,
  eraseOutside,
  newEmpty,
  paint,
  placeToken,
  redo,
  rename,
  resize,
  startEditing,
  undo,
  type EditorDraft,
  type EditorHistory,
} from './game/map-editor';
import {
  demoBattle,
  exportReplay,
  importReplay,
  replayExportProblem,
  resolvedDemoBattle,
} from './game/replay';
import { EditorPanel, toolList } from './ui/EditorPanel';
import { ActorCard } from './ui/ActorCard';
import {
  AttackPanel,
  CombatLog,
  DicePanel,
  MovePanel,
  PendingBanner,
  TurnBar,
  type AttackForm,
  type DiceSettings,
} from './ui/Panels';
import { commandFeedback } from './ui/feedback';
import { combatStore, useCombat } from './ui/store';
import { TacticalMap, type EditorTool, type MoveIntent, type SceneMode } from './ui/TacticalMap';

const commandId = (kind: string) => `${kind}-${crypto.randomUUID().slice(0, 8)}`;
const defaultAttack = (attacker: ActorId): AttackForm => ({
  target: ids.find((id) => id !== attacker)!,
  weapon: weapons.find((w) => w.owner === attacker)!.id,
  modifier: 0,
  activity: 'REST',
  decline: true,
});

export function App() {
  const { battle, version } = useCombat();
  const info = useMemo(() => turnInfo(battle), [battle, version]);
  const [selected, setSelected] = useState<ActorId>(info.active);
  const [tab, setTab] = useState<'move' | 'attack'>('move');
  const [moveMode, setMoveMode] = useState<MoveMode | null>(null);
  const [form, setForm] = useState<AttackForm>(() => defaultAttack(info.active));
  const [dice, setDice] = useState<DiceSettings>({
    mode: 'random',
    fixed: '100:45,10:2,100:20',
    seed: 12345,
  });
  const [toast, setToast] = useState<{ text: string; tone: JournalTone } | null>(null);
  const [setupMode, setSetupMode] = useState<'editor' | 'placement'>('placement');
  const [history, setHistory] = useState<EditorHistory | null>(null);
  const [tool, setTool] = useState<EditorTool>('brush');
  const [colour, setColour] = useState<FloorColorId>('grey');
  const mode: SceneMode = info.started ? 'combat' : setupMode;
  const editing = mode === 'editor' && history !== null;
  const draft: EditorDraft | null = editing ? history.present : null;
  const problems = useMemo(
    () => (draft ? draftProblems(draft, battle) : { map: [], tokens: [] }),
    [draft, battle, version],
  );
  const dirty = draft ? draftDiffers(draft, battle) : false;
  const edit = (change: (d: EditorDraft) => EditorDraft) =>
    setHistory((h) => (h ? commit(h, change(h.present)) : h));
  const enterEditor = () => {
    setSetupMode('editor');
    setHistory((h) => h ?? startEditing(battle));
    setMoveMode(null);
  };

  // Combat start closes the editor: the map cannot change during combat.
  useEffect(() => {
    if (info.started) setHistory(null);
  }, [info.started]);

  // Editor shortcuts; never captured while typing in a field.
  useEffect(() => {
    if (mode !== 'editor') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (key === 'z' || key === 'я')) {
        e.preventDefault();
        setHistory((h) => (h ? (e.shiftKey ? redo(h) : undo(h)) : h));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (key === 'y' || key === 'н')) {
        e.preventDefault();
        setHistory((h) => (h ? redo(h) : h));
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const found = toolList.find(
        (x) => x.key.toLowerCase() === e.code.replace('Key', '').toLowerCase(),
      );
      if (found) setTool(found.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  // Combat start and every new turn select the active participant and reset per-turn choices.
  useEffect(() => {
    setSelected(info.active);
    setForm(defaultAttack(info.active));
    setMoveMode(null);
  }, [info.active, info.round, info.started]);

  const options = useMemo(() => movementOptions(battle, selected), [battle, version, selected]);
  const wounds = useMemo(
    () =>
      Object.fromEntries(
        ids.map((id) => {
          const s = actorStatus(battle, id);
          return [id, { current: s.wounds, max: s.maxWounds }];
        }),
      ) as Record<ActorId, { current: number; max: number }>,
    [battle, version],
  );
  const busy = !!info.pending || !!info.pendingTurn;
  const canAct = info.turnActive && !busy && selected === info.active;
  const chosen = options.find((o) => o.mode === moveMode && o.available);
  const moveIntent: MoveIntent | null =
    canAct && tab === 'move' && chosen && chosen.maxDistance !== null
      ? { actor: selected, modeLabel: chosen.label, maxDistance: chosen.maxDistance }
      : null;

  const source = () =>
    dice.mode === 'fixed'
      ? fixedDice(dice.fixed)
      : dice.mode === 'seed'
        ? seededDice(dice.seed)
        : randomDice();
  const run = (command: Parameters<typeof combatStore.run>[0]) => {
    const before = combatStore.getSnapshot().battle.log.length;
    try {
      combatStore.run(command);
      setToast(commandFeedback(before, combatStore.getSnapshot().battle.log));
    } catch (error) {
      setToast(commandFeedback(before, combatStore.getSnapshot().battle.log, error));
    }
  };
  const onMove = (id: ActorId, x: number, y: number) => {
    if (!moveMode) {
      setToast({ text: 'Сначала выберите режим движения.', tone: 'warning' });
      return;
    }
    run((b) => moveActor(b, { id: commandId('move'), actor: id, mode: moveMode, to: { x, y } }));
    setMoveMode(null);
  };
  const replaceBattle = (next: ReturnType<typeof createBattle>, text: string) => {
    combatStore.replace(next);
    setHistory(null);
    setSetupMode('placement');
    setToast({ text, tone: 'info' });
  };
  const applyDraft = () => {
    if (!draft) return;
    const before = battle.mapRevision;
    run((b) => applyMap(b, draft));
    if (combatStore.getSnapshot().battle.mapRevision !== before)
      setHistory(startEditing(combatStore.getSnapshot().battle));
  };

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <span className="eyebrow">KADAT 2 · тактическая сцена · локальная сессия</span>
          <h1>Келус Дракар против Пака</h1>
        </div>
        <nav className="header-actions" aria-label="Сессия">
          <details className="menu">
            <summary>Сценарии</summary>
            <div className="menu-body">
              <button
                type="button"
                onClick={() =>
                  replaceBattle(
                    resolvedDemoBattle(),
                    'Сценарий «попадание / промах» разрешён движком.',
                  )
                }
              >
                Попадание / промах
              </button>
              <button
                type="button"
                onClick={() =>
                  replaceBattle(
                    demoBattle(),
                    'Сценарий «два попадания» остановлен на решении автора по «Цепному».',
                  )
                }
              >
                Два попадания (ждёт автора)
              </button>
            </div>
          </details>
          <button
            type="button"
            onClick={() =>
              replaceBattle(createBattle(), 'Создана новая сессия из исходных профилей.')
            }
          >
            Новый бой
          </button>
          <button
            type="button"
            title={replayExportProblem(battle) ?? 'Скачать боевой replay (формат v0.3)'}
            onClick={() => {
              const problem = replayExportProblem(battle);
              if (problem) {
                setToast({ text: problem, tone: 'warning' });
                return;
              }
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(exportReplay(battle), null, 2)], {
                  type: 'application/json',
                }),
              );
              const link = document.createElement('a');
              link.href = url;
              link.download = 'kadat-combat-replay.json';
              link.click();
              URL.revokeObjectURL(url);
            }}
          >
            Скачать replay
          </button>
          <label className="file-button">
            Открыть replay
            <input
              type="file"
              accept="application/json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  if (file.size > 10_000_000) throw new Error('Replay больше 10 МБ');
                  replaceBattle(
                    importReplay(JSON.parse(await file.text())),
                    'Replay воспроизведён из сохранённых бросков.',
                  );
                } catch (error) {
                  setToast({ text: `Replay не загружен: ${String(error)}`, tone: 'error' });
                }
              }}
            />
          </label>
        </nav>
      </header>

      {toast && (
        <div className={`toast tone-${toast.tone}`} role="status">
          <span>{toast.text}</span>
          <button type="button" aria-label="Закрыть" onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      )}

      <main className="layout">
        <aside className="column left">
          <TurnBar
            battle={battle}
            info={info}
            startBlocked={
              mode === 'editor' ? 'Перейдите в режим «Расстановка», чтобы начать бой.' : null
            }
            onStart={() => run((b) => startCombat(b, source()))}
            onNextTurn={() => run((b) => nextTurn(b, source()))}
            onOrder={(id) => run((b) => selectManualOrder(b, id))}
          />
          <PendingBanner
            info={info}
            onResume={() =>
              run((b) => (info.pending ? resumeAttack(b, source()) : nextTurn(b, source())))
            }
            onCancel={() => run((b) => cancelUnstarted(b))}
          />
          <div className="panel">
            <div className="actor-tabs" role="tablist" aria-label="Персонажи">
              {ids.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={selected === id}
                  className={selected === id ? 'chosen' : ''}
                  onClick={() => setSelected(id)}
                >
                  {id === 'pak' ? 'Пак' : 'Келус'}
                </button>
              ))}
            </div>
            <ActorCard
              battle={battle}
              id={selected}
              setup={mode === 'placement'}
              onFootprint={(f) => run((b) => setFootprint(b, selected, f))}
            />
          </div>
        </aside>

        <section className="column center">
          <div className="mode-switch" role="tablist" aria-label="Режим сцены">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'editor'}
              className={mode === 'editor' ? 'chosen' : ''}
              disabled={info.started}
              title={info.started ? 'Во время боя карту менять нельзя' : undefined}
              onClick={enterEditor}
            >
              Редактор карты{dirty ? ' •' : ''}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'placement'}
              className={mode === 'placement' ? 'chosen' : ''}
              disabled={info.started}
              onClick={() => setSetupMode('placement')}
            >
              Расстановка
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'combat'}
              className={mode === 'combat' ? 'chosen' : ''}
              disabled={!info.started}
              title={info.started ? undefined : 'Бой начинается кнопкой «Начать бой» в расстановке'}
            >
              Бой
            </button>
            <span className="muted small map-name">
              {battle.map.name} · {battle.map.cols} × {battle.map.rows} · ревизия{' '}
              {battle.mapRevision}
            </span>
          </div>
          <TacticalMap
            battle={battle}
            version={version}
            mode={mode}
            map={draft ? draft.map : battle.map}
            positions={draft ? (draft.positions as typeof battle.positions) : battle.positions}
            conflicts={new Set(problems.tokens.map((t) => t.actor))}
            selected={selected}
            activeActor={info.active}
            turnActive={info.turnActive && !busy}
            moveIntent={mode === 'combat' ? moveIntent : null}
            attackLine={
              mode === 'combat' && canAct && tab === 'attack'
                ? { from: info.active, to: form.target }
                : null
            }
            wounds={wounds}
            tool={tool}
            floorColour={colour}
            onSelect={setSelected}
            onMove={onMove}
            onPlace={(id, x, y) => run((b) => placeActor(b, id, x, y))}
            onDraftPlace={(id, x, y) => edit((d) => placeToken(d, id, { x, y }))}
            onPaint={(cells, c) => edit((d) => paint(d, cells, c))}
          />
        </section>

        <aside className="column right">
          {editing && history ? (
            <EditorPanel
              history={history}
              appliedName={battle.map.name}
              problems={problems}
              dirty={dirty}
              tool={tool}
              colour={colour}
              onTool={setTool}
              onColour={setColour}
              onRename={(name) => edit((d) => rename(d, name))}
              onResize={(cols, rows) => edit((d) => resize(d, cols, rows))}
              onNewEmpty={(name, cols, rows) =>
                edit((d) => newEmpty(d, commandId('map'), name, cols, rows))
              }
              onEraseOutside={() => edit(eraseOutside)}
              onUndo={() => setHistory((h) => (h ? undo(h) : h))}
              onRedo={() => setHistory((h) => (h ? redo(h) : h))}
              onApply={applyDraft}
              onDiscard={() => setHistory(startEditing(battle))}
            />
          ) : (
            <section className="panel actions">
              <div className="tabs" role="tablist" aria-label="Действия">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'move'}
                  className={tab === 'move' ? 'chosen' : ''}
                  onClick={() => setTab('move')}
                >
                  Движение
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'attack'}
                  className={tab === 'attack' ? 'chosen' : ''}
                  onClick={() => {
                    setTab('attack');
                    setMoveMode(null);
                  }}
                >
                  Атака
                </button>
              </div>
              {!info.started && (
                <p className="muted small">
                  Бой не начат: расставьте токены и нажмите «Начать бой».
                </p>
              )}
              {info.started && selected !== info.active && (
                <p className="muted small">
                  Выбран персонаж не в свой ход — действия доступны только активному участнику.
                </p>
              )}
              {tab === 'move' ? (
                <MovePanel
                  options={options}
                  selectedMode={moveMode}
                  onSelectMode={setMoveMode}
                  onMoveTo={(x, y) => onMove(selected, x, y)}
                  position={battle.positions[selected]}
                  canAct={canAct}
                  posture={actorStatus(battle, selected).posture}
                  footprint={battle.footprints[selected]}
                  mapSize={battle.map}
                  onStand={() =>
                    run((b) => standUp(b, { id: commandId('stand'), actor: selected }))
                  }
                />
              ) : (
                <AttackPanel
                  attacker={info.active}
                  form={form}
                  onChange={setForm}
                  canAct={canAct}
                  attackedThisTurn={info.attacked}
                  battle={battle}
                  onAttack={() =>
                    run((b) =>
                      attack(
                        b,
                        {
                          id: commandId('attack'),
                          actor: info.active,
                          target: form.target,
                          weapon: form.weapon,
                          targetActivity: form.activity,
                          modifier: form.modifier,
                          defense: 'DECLINE',
                        },
                        source(),
                      ),
                    )
                  }
                />
              )}
            </section>
          )}
          {!editing && <DicePanel dice={dice} onChange={setDice} />}
          <CombatLog battle={battle} />
        </aside>
      </main>
    </div>
  );
}
