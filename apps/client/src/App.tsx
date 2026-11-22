import { useEffect, useMemo, useState } from 'react';
import { fixedDice, randomDice, seededDice } from './game/dice';
import {
  actorStatus,
  attack,
  cancelUnstarted,
  moveActor,
  movementOptions,
  nextTurn,
  placeActor,
  resumeAttack,
  selectManualOrder,
  setDoorOpen,
  setFootprint,
  standUp,
  startCombat,
  turnInfo,
  type MoveMode,
} from './game/engine';
import type { JournalTone } from './game/journal';
import { createBattle, ids, weapons, type ActorId } from './game/model';
import type { FloorColorId } from './game/map';
import type { Point } from './game/grid';
import {
  MAP_FILE_EXTENSION,
  MAP_FILE_MAX_BYTES,
  parseMapFile,
  serializeMapFile,
} from './game/map-file';
import { readRasterFile, useBackgroundUrl, verifyEmbeddedRaster } from './ui/raster-io';
import {
  addDecoration,
  addDoor,
  addObstacle,
  addWall,
  addZone,
  hostWall,
  moveWallEnd,
  removeDoor,
  removeObstacle,
  removeWall,
  removeZone,
  tryChange,
  updateDoor,
  updateObstacle,
  updateZone,
  applyDraft,
  calibrateBackground,
  commit,
  fitBackground,
  loadDocument,
  removeDecoration,
  setBackground,
  updateBackground,
  updateDecoration,
  draftDiffers,
  draftProblems,
  eraseOutside,
  keepDraftPosition,
  newEmpty,
  paint,
  placeToken,
  redo,
  rename,
  resize,
  resolveDraftPositions,
  startEditing,
  takeScenePosition,
  undo,
  type EditorDraft,
  type EditorHistory,
} from './game/map-editor';
import {
  demoBattle,
  parseReplayText,
  REPLAY_MAX_BYTES,
  resolvedDemoBattle,
  serializeReplay,
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
import { stage3Stand } from './game/scenarios';
import {
  TacticalMap,
  type EditorTool,
  type MoveIntent,
  type SceneMode,
  type SelectedObject,
} from './ui/TacticalMap';

const commandId = (kind: string) => `${kind}-${crypto.randomUUID().slice(0, 8)}`;
const defaultAttack = (attacker: ActorId): AttackForm => ({
  target: ids.find((id) => id !== attacker)!,
  weapon: weapons.find((w) => w.owner === attacker)!.id,
  modifier: 0,
  activity: 'REST',
  decline: true,
});

/** Simple view: the first sentence only; the full text stays in the journal. */
function shortText(text: string): string {
  const cut = text.search(/[.!?](\s|$)/);
  return cut > 0 && cut < text.length - 1
    ? `${text.slice(0, cut + 1)} Подробнее — в журнале.`
    : text;
}

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
  const [selectedObject, setSelectedObject] = useState<SelectedObject | null>(null);
  const selectedDecorationId = selectedObject?.kind === 'decoration' ? selectedObject.id : null;
  const setSelectedDecorationId = (id: string | null) =>
    setSelectedObject(id ? { kind: 'decoration', id } : null);
  const [newObstacle, setNewObstacle] = useState({
    label: '',
    blocksMovement: true,
    blocksVision: true,
  });
  const [newDecorationLabel, setNewDecorationLabel] = useState('');
  const [calibrationPoints, setCalibrationPoints] = useState<Point[]>([]);
  const mode: SceneMode = info.started ? 'combat' : setupMode;
  const editing = mode === 'editor' && history !== null;
  const draft: EditorDraft | null = editing ? history.present : null;
  const problems = useMemo(
    () => (draft ? draftProblems(draft, battle) : { map: [], tokens: [], stale: [] }),
    [draft, battle, version],
  );
  const dirty = draft ? draftDiffers(draft, battle) : false;
  const shownMap = draft ? draft.map : battle.map;
  const backgroundUrl = useBackgroundUrl(shownMap.background);
  const selectedDecoration =
    draft?.map.decorations.find((x) => x.id === selectedDecorationId) ?? null;
  /** Environment edit that is refused with reasons when it would break the map. */
  const editMap = (
    change: Parameters<typeof tryChange>[1],
    done?: string,
    refused = 'Не добавлено',
  ) => {
    if (!history) return;
    const result = tryChange(history.present, change);
    if (!result.draft) {
      setToast({ text: `${refused}: ${result.problems.join(' ')}`, tone: 'warning' });
      return;
    }
    setHistory(commit(history, result.draft));
    if (done) setToast({ text: done, tone: 'success' });
  };
  const rectOf = (a: { col: number; row: number }, c: { col: number; row: number }) => ({
    col: Math.min(a.col, c.col),
    row: Math.min(a.row, c.row),
    width: Math.abs(a.col - c.col) + 1,
    height: Math.abs(a.row - c.row) + 1,
  });
  const [details, setDetails] = useState(() => {
    try {
      return localStorage.getItem('kadat.details') === '1';
    } catch {
      return false;
    }
  });
  const toggleDetails = () =>
    setDetails((d) => {
      try {
        localStorage.setItem('kadat.details', d ? '0' : '1');
      } catch {
        // Storage unavailable: the choice lasts for this page only.
      }
      return !d;
    });
  const fail = (error: unknown) =>
    setToast({ text: error instanceof Error ? error.message : String(error), tone: 'error' });
  const loadBackground = async (file: File) => {
    try {
      const raster = await readRasterFile(file);
      edit((d) => setBackground(d, fitBackground(d.map, raster)));
      // Points marked on the previous image no longer describe the new one.
      setCalibrationPoints([]);
      setToast({
        text: `Подложка загружена: ${raster.mime}, ${raster.widthPx} × ${raster.heightPx} пикс. Ширина подогнана под карту; уточните масштаб калибровкой.`,
        tone: 'success',
      });
    } catch (error) {
      fail(error);
    }
  };
  const calibrate = (meters: number) => {
    const bg = draft?.map.background;
    if (!bg || calibrationPoints.length < 2) return;
    try {
      const next = calibrateBackground(bg, calibrationPoints[0]!, calibrationPoints[1]!, meters);
      edit((d) => setBackground(d, next));
      setCalibrationPoints([]);
      setToast({
        text: `Калибровка применена: ${Number(next.metersPerPixel.toPrecision(6))} м на пиксель.`,
        tone: 'success',
      });
    } catch (error) {
      fail(error);
    }
  };
  const saveMapFile = () => {
    if (!draft) return;
    try {
      const text = serializeMapFile(draft.map);
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${draft.map.name.trim().replace(/[\\/:*?"<>|]+/g, '_') || 'map'}${MAP_FILE_EXTENSION}`;
      link.click();
      URL.revokeObjectURL(url);
      setToast({ text: `Карта сохранена в файл ${link.download}.`, tone: 'success' });
    } catch (error) {
      fail(error);
    }
  };
  const openMapFile = async (file: File) => {
    try {
      if (file.size > MAP_FILE_MAX_BYTES)
        throw new Error(`Файл карты больше ${MAP_FILE_MAX_BYTES / 1024 / 1024} МиБ`);
      const map = parseMapFile(await file.text());
      if (map.background) await verifyEmbeddedRaster(map.background);
      edit((d) => loadDocument(d, map));
      setSelectedDecorationId(null);
      setCalibrationPoints([]);
      setToast({
        text: `Файл карты «${map.name}» открыт как черновик (${map.cols} × ${map.rows}). Проверьте расстановку и нажмите «Применить карту».`,
        tone: 'success',
      });
    } catch (error) {
      setToast({
        text: `Файл карты не открыт: ${error instanceof Error ? error.message : String(error)}. Текущая карта не изменена.`,
        tone: 'error',
      });
    }
  };
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
  // The scene revision this render previews; a move sends it so a stale preview is refused.
  const previewRevision = battle.sceneRevision;
  const moveIntent: MoveIntent | null =
    canAct && tab === 'move' && chosen && chosen.maxDistance !== null
      ? {
          actor: selected,
          modeLabel: chosen.label,
          maxDistance: chosen.maxDistance,
          sceneRevision: previewRevision,
        }
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
  const onMove = (id: ActorId, x: number, y: number, revision: number = previewRevision) => {
    if (!moveMode) {
      setToast({ text: 'Сначала выберите режим движения.', tone: 'warning' });
      return;
    }
    run((b) =>
      moveActor(b, {
        id: commandId('move'),
        actor: id,
        mode: moveMode,
        to: { x, y },
        sceneRevision: revision,
      }),
    );
    setMoveMode(null);
  };
  const replaceBattle = (next: ReturnType<typeof createBattle>, text: string) => {
    combatStore.replace(next);
    setHistory(null);
    setSetupMode('placement');
    setToast({ text, tone: 'info' });
  };
  const applyEditorDraft = () => {
    if (!draft) return;
    const before = battle.mapRevision;
    run((b) => applyDraft(b, draft));
    if (combatStore.getSnapshot().battle.mapRevision !== before)
      setHistory(startEditing(combatStore.getSnapshot().battle));
  };

  return (
    <div className={details ? 'app show-details' : 'app'}>
      <header className="app-header">
        <div>
          <span className="eyebrow detail">KADAT 2 · тактическая сцена · локальная сессия</span>
          <h1>Келус Дракар против Пака</h1>
        </div>
        <nav className="header-actions" aria-label="Сессия">
          <button
            type="button"
            aria-pressed={details}
            className={details ? 'chosen' : ''}
            title="Показать технические подробности: характеристики, данные движка, кубики"
            onClick={() => toggleDetails()}
          >
            Подробно
          </button>
          <details className="menu">
            <summary>Сценарии</summary>
            <div
              className="menu-body"
              onClick={(e) => {
                // Close the menu once a scenario is picked.
                if ((e.target as HTMLElement).closest('button'))
                  e.currentTarget.closest('details')?.removeAttribute('open');
              }}
            >
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
              <button
                type="button"
                onClick={() =>
                  replaceBattle(
                    stage3Stand(),
                    'Стенд этапа 3 загружен: комната с закрытой дверью, ящики, грязь. Проверяйте по файлу ПРОВЕРКА-ЭТАПА.md.',
                  )
                }
              >
                Стенд этапа 3: комната с дверью
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
            title="Скачать боевой replay (формат v0.4, со снимками карты)"
            onClick={() => {
              let text: string;
              try {
                text = serializeReplay(battle);
              } catch (error) {
                fail(error);
                return;
              }
              const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
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
                  if (file.size > REPLAY_MAX_BYTES)
                    throw new Error(`Replay больше предела ${REPLAY_MAX_BYTES / 1024 / 1024} МиБ`);
                  replaceBattle(
                    parseReplayText(await file.text()),
                    'Replay воспроизведён из сохранённых бросков.',
                  );
                } catch (error) {
                  setToast({
                    text: `Replay не загружен: ${error instanceof Error ? error.message : String(error)}. Текущий бой не изменён.`,
                    tone: 'error',
                  });
                }
              }}
            />
          </label>
        </nav>
      </header>

      {toast && (
        <div className={`toast tone-${toast.tone}`} role="status">
          <span>{details ? toast.text : shortText(toast.text)}</span>
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
            <span className="muted small map-name detail">
              {battle.map.name} · {battle.map.cols} × {battle.map.rows} · ревизия{' '}
              {battle.mapRevision}
            </span>
          </div>
          <TacticalMap
            battle={battle}
            version={version}
            mode={mode}
            map={shownMap}
            positions={draft ? resolveDraftPositions(draft, battle).positions : battle.positions}
            conflicts={
              new Set([
                ...problems.tokens.map((t) => t.actor),
                ...problems.stale.map((t) => t.actor),
              ])
            }
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
            onDraftPlace={(id, x, y) =>
              edit((d) => placeToken(d, id, { x, y }, battle.positions[id]))
            }
            onPaint={(cells, c) => edit((d) => paint(d, cells, c))}
            backgroundUrl={backgroundUrl}
            selectedObject={editing ? selectedObject : null}
            onSelectObject={setSelectedObject}
            onAddRect={(kind, a, c) => {
              if (kind === 'decoration')
                edit((d) =>
                  addDecoration(d, {
                    id: commandId('dec'),
                    ...rectOf(a, c),
                    color: colour,
                    label: newDecorationLabel.trim(),
                  }),
                );
              else if (kind === 'obstacle')
                editMap((m) =>
                  addObstacle(m, {
                    id: commandId('obs'),
                    ...rectOf(a, c),
                    label: newObstacle.label.trim(),
                    blocksMovement: newObstacle.blocksMovement,
                    blocksVision: newObstacle.blocksVision,
                    notes: '',
                  }),
                );
              else
                editMap((m) =>
                  addZone(m, { id: commandId('zone'), ...rectOf(a, c), label: 'Трудный ландшафт' }),
                );
            }}
            onAddWall={(points) =>
              editMap(
                (m) => addWall(m, { id: commandId('wall'), points }),
                `Стена добавлена: ${points.length - 1} отр.`,
              )
            }
            onAddDoor={(from, to) => {
              const host = draft && hostWall(draft.map, from, to);
              if (!host) {
                setToast({
                  text: 'Дверь не добавлена: проём должен лежать на одном прямом участке существующей стены.',
                  tone: 'warning',
                });
                return;
              }
              editMap(
                (m) =>
                  addDoor(m, {
                    id: commandId('door'),
                    wallId: host.id,
                    from,
                    to,
                    open: false,
                    blocksMovement: true,
                    blocksVision: true,
                  }),
                'Дверь добавлена (закрыта; флаги — в панели).',
              );
            }}
            onToggleDoor={(id) =>
              run((b) =>
                setDoorOpen(b, id, !(b.doors[id] ?? b.map.doors.find((d) => d.id === id)!.open)),
              )
            }
            doorStates={draft ? {} : battle.doors}
            onMoveWallEnd={(id, end, to) =>
              editMap(
                (m) => moveWallEnd(m, id, end, to),
                `Конец стены перенесён в (${to.x}; ${to.y}).`,
                'Конец стены не перенесён',
              )
            }
            onMoveBackground={(dx, dy) =>
              edit((d) =>
                d.map.background
                  ? updateBackground(d, { x: d.map.background.x + dx, y: d.map.background.y + dy })
                  : d,
              )
            }
            calibrationPoints={calibrationPoints}
            onCalibrationPoint={(pt) =>
              setCalibrationPoints((pts) => (pts.length >= 2 ? [pt] : [...pts, pt]))
            }
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
              onNewEmpty={(name, cols, rows) => {
                edit((d) => newEmpty(d, commandId('map'), name, cols, rows));
                setCalibrationPoints([]);
                setSelectedDecorationId(null);
              }}
              onEraseOutside={() => edit(eraseOutside)}
              onKeepDraft={(id) => edit((d) => keepDraftPosition(d, id, battle.positions[id]))}
              onTakeScene={(id) => edit((d) => takeScenePosition(d, id, battle.positions[id]))}
              background={history.present.map.background}
              onLoadBackground={loadBackground}
              onUpdateBackground={(patch) => edit((d) => updateBackground(d, patch))}
              onRemoveBackground={() => {
                edit((d) => setBackground(d, null));
                setCalibrationPoints([]);
              }}
              calibrationPoints={calibrationPoints.length}
              onCalibrate={calibrate}
              onResetCalibration={() => setCalibrationPoints([])}
              selectedDecoration={selectedDecoration}
              selectedObject={selectedObject}
              map={history.present.map}
              newObstacle={newObstacle}
              onNewObstacle={setNewObstacle}
              onUpdateDoor={(id, patch) => editMap((m) => updateDoor(m, id, patch))}
              onUpdateObstacle={(id, patch) => editMap((m) => updateObstacle(m, id, patch))}
              onUpdateZone={(id, label) => editMap((m) => updateZone(m, id, label))}
              onDeleteObject={(o) => {
                if (o.kind === 'wall') editMap((m) => removeWall(m, o.id));
                else if (o.kind === 'door') editMap((m) => removeDoor(m, o.id));
                else if (o.kind === 'obstacle') editMap((m) => removeObstacle(m, o.id));
                else if (o.kind === 'zone') editMap((m) => removeZone(m, o.id));
                setSelectedObject(null);
              }}
              newDecorationLabel={newDecorationLabel}
              onNewDecorationLabel={setNewDecorationLabel}
              onUpdateDecoration={(patch) =>
                selectedDecorationId &&
                edit((d) => updateDecoration(d, selectedDecorationId, patch))
              }
              onRemoveDecoration={() => {
                if (!selectedDecorationId) return;
                edit((d) => removeDecoration(d, selectedDecorationId));
                setSelectedDecorationId(null);
              }}
              onSaveFile={saveMapFile}
              onOpenFile={openMapFile}
              onUndo={() => setHistory((h) => (h ? undo(h) : h))}
              onRedo={() => setHistory((h) => (h ? redo(h) : h))}
              onApply={applyEditorDraft}
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
          {!editing && details && <DicePanel dice={dice} onChange={setDice} />}
          <CombatLog battle={battle} />
        </aside>
      </main>
    </div>
  );
}
