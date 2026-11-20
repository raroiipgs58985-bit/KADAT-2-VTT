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
  startCombat,
  turnInfo,
  type MoveMode,
} from './game/engine';
import { describeEntry, type JournalTone } from './game/journal';
import { createBattle, ids, weapons, type ActorId } from './game/model';
import { demoBattle, exportReplay, importReplay, resolvedDemoBattle } from './game/replay';
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
import { combatStore, useCombat } from './ui/store';
import { TacticalMap, type MoveIntent } from './ui/TacticalMap';

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
    try {
      combatStore.run(command);
      const last = combatStore.getSnapshot().battle.log.at(-1);
      if (last) {
        const line = describeEntry(last);
        setToast({ text: `${line.title}. ${line.summary}`, tone: line.tone });
      }
    } catch (error) {
      const last = combatStore.getSnapshot().battle.log.at(-1);
      const line = last && describeEntry(last);
      setToast({
        text:
          line && (line.tone === 'warning' || line.tone === 'author' || line.tone === 'error')
            ? `${line.title}: ${line.summary}`
            : String(error instanceof Error ? error.message : error),
        tone: line?.tone === 'author' ? 'author' : 'error',
      });
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
    setToast({ text, tone: 'info' });
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
            onClick={() => {
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
            <ActorCard battle={battle} id={selected} />
          </div>
        </aside>

        <section className="column center">
          <TacticalMap
            battle={battle}
            selected={selected}
            activeActor={info.active}
            turnActive={info.turnActive && !busy}
            setupMode={!info.started}
            moveIntent={moveIntent}
            attackLine={canAct && tab === 'attack' ? { from: info.active, to: form.target } : null}
            wounds={wounds}
            onSelect={setSelected}
            onMove={onMove}
            onPlace={(id, x, y) => run((b) => placeActor(b, id, x, y))}
          />
        </section>

        <aside className="column right">
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
              <p className="muted small">Бой не начат: расставьте токены и нажмите «Начать бой».</p>
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
          <DicePanel dice={dice} onChange={setDice} />
          <CombatLog battle={battle} />
        </aside>
      </main>
    </div>
  );
}
