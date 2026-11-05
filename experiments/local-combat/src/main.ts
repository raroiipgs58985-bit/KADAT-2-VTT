/* global document, URL, Blob, alert */
import { actor, createBattle, ids, move, pakArmorProperties, weapons } from './model';
import type { ActorId, WeaponId } from './model';
import {
  attack,
  cancelUnstarted,
  getEngine,
  nextTurn,
  resumeAttack,
  selectManualOrder,
} from './engine';
import { fixedDice, seededDice } from './dice';
import { demoBattle, resolvedDemoBattle, exportReplay, importReplay } from './replay';
import type { BleedingActivity } from '@kadat/contracts';
import './style.css';
const root = document.querySelector<HTMLElement>('#app')!;
let battle = createBattle();
let serial = 0,
  message = '',
  diceText = '100:45,10:2,100:20',
  diceMode = 'fixed',
  seed = 12345,
  modifier = 0,
  activity: BleedingActivity = 'REST',
  decline = true;
const escape = (v: unknown) =>
  String(v).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
function render() {
  const runtime = getEngine(battle);
  root.innerHTML = `<header><span class="eyebrow">KADAT 2 / ЛОКАЛЬНЫЙ ЭКСПЕРИМЕНТ v0.2</span><h1>Келус Дракар <span>против</span> Пака</h1><p>Два персонажа. Одна локальная сессия. Без сервера боя и базы данных.</p></header>
  <div class="toolbar"><label>Начальная ручная очередь<select id="active">${ids.map((id) => `<option value="${id}" ${id === battle.active ? 'selected' : ''}>${actor(id).name}</option>`).join('')}</select></label><button id="next-turn">Передать ход</button><button id="scenario">Сценарий: попадание / промах</button><button id="sword-scenario">Сценарий: два попадания</button><button id="reset">Сбросить бой</button><button id="export">Скачать replay и журнал</button><label class="file-label">Открыть replay<input id="import" type="file" accept="application/json"></label></div>
  <p class="muted">Обычный одиночный выстрел / простой удар одной рукой. ОС не тратятся, вера не активирована. Раунд ${runtime.wounds.combat.session.roundNumber}. ОД: ${runtime.wounds.combat.session.turn?.od ?? 2}. Реакции применяются только по явному выбору; в текущем сценарии цель от них отказывается.</p>
  <div class="layout"><section><h2>Тактическое поле <small>20 × 20 м</small></h2><p class="muted">Перетаскивание — свободная расстановка без списания ОД. Сетка не ограничивает координаты.</p>
  <svg id="map" viewBox="0 0 20 20" aria-label="Тактическая карта"><defs><pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" stroke="#354354" stroke-width=".025" fill="none"/></pattern></defs><rect width="20" height="20" fill="url(#grid)"/>${ids.map((id, i) => `<g class="token" data-actor="${id}" transform="translate(${battle.positions[id].x} ${battle.positions[id].y})"><circle r=".65" fill="${i ? '#efbc71' : '#5ed9bd'}"/><text text-anchor="middle" dominant-baseline="middle" font-size=".6" fill="#09121b">${i ? 'П' : 'К'}</text></g>`).join('')}</svg>
  ${ids.map((id) => `<form data-move="${id}"><strong>${actor(id).name}</strong><label>X, м<input name="x" type="number" min="0" max="20" step="any" value="${battle.positions[id].x}" required></label><label>Y, м<input name="y" type="number" min="0" max="20" step="any" value="${battle.positions[id].y}" required></label><button>Переместить</button></form>`).join('')}</section>
  <section class="action"><h2>Боевое действие</h2><label>Цель<select id="target">${ids
    .filter((id) => id !== battle.active)
    .map((id) => `<option value="${id}">${actor(id).name}</option>`)
    .join('')}</select></label><label>Оружие<select id="weapon">${weapons
    .filter((w) => w.owner === battle.active)
    .map((w) => `<option value="${w.id}">${w.name}</option>`)
    .join(
      '',
    )}</select></label><p id="weapon-description" class="raw"></p><div id="combat-controls"></div><button id="attack">Совершить атаку</button><button id="resume">Продолжить pending</button><button id="cancel">Отменить неначатую команду</button><div id="result" role="status">${escape(message)}</div></section></div>
  <section><h2>Профили и состояние</h2><div class="profiles">${ids
    .map(
      (id) =>
        `<article><h3>${actor(id).name}</h3><div class="health">${battle.hp[id]} / ${actor(id).max} <small>раны</small></div><p class="muted">Кровь ${runtime.wounds.actors[id]!.blood.currentBlood}/${runtime.wounds.actors[id]!.blood.maxBlood} · ${runtime.wounds.actors[id]!.life.status} · Injury: ${runtime.wounds.actors[id]!.injuries.length}</p><dl>${Object.entries(
          actor(id).characteristics,
        )
          .map(([key, c]) => `<div><dt>${key}</dt><dd>${escape(c.raw)}</dd></div>`)
          .join('')}</dl><details><summary>Навыки, таланты, броня и снаряжение</summary>${actor(id)
          .profile.map(
            (p) =>
              `<p><strong>${escape(p.label)}</strong><br>${escape(p.formattedValue)}${p.note ? `<br><span class="muted">${escape(p.note)}</span>` : ''}${id === 'pak' && p.label === 'ОБ' ? `<br><span class="muted">Свойства Пустотной брони (Арсенал, строка 33): ${escape(pakArmorProperties)}. Керамит даёт +3 ОБ против энергоурона.</span>` : ''}</p>`,
          )
          .join('')}</details></article>`,
    )
    .join(
      '',
    )}</div></section><section><h2>Combat Log</h2><pre id="log">${escape(JSON.stringify(battle.log, null, 2))}</pre></section>`;
  document.querySelector<HTMLSelectElement>('#active')!.onchange = (e) => {
    perform(() => {
      selectManualOrder(battle, (e.target as HTMLSelectElement).value as ActorId);
      return 'Начальная очередь задана вручную';
    });
  };
  const showWeapon = () => {
    const w = weapons.find(
      (w) => w.id === document.querySelector<HTMLSelectElement>('#weapon')!.value,
    )!;
    document.querySelector<HTMLElement>('#weapon-description')!.textContent =
      `${w.raw}\nБоезапас: ${battle.ammo[w.id] ?? 'не расходуется как боеприпасы'}${w.capacity === null ? '' : ` / ${w.capacity}`}`;
  };
  document.querySelector<HTMLSelectElement>('#weapon')!.onchange = showWeapon;
  showWeapon();
  document.querySelector<HTMLElement>('#combat-controls')!.innerHTML =
    `<label>Кубики<select id="dice-mode"><option value="fixed" ${diceMode === 'fixed' ? 'selected' : ''}>Фиксированная последовательность</option><option value="seed" ${diceMode === 'seed' ? 'selected' : ''}>Воспроизводимый seed для команды</option></select></label><label>Кубики: стороны:результат<textarea id="dice">${escape(diceText)}</textarea></label><label>Seed<input id="seed" type="number" min="1" max="4294967295" value="${seed}"></label><label>Явный модификатор GM<input id="modifier" type="number" step="1" value="${modifier}"></label><label>Действие цели при кровотечении<select id="activity">${(['REST', 'PHYSICAL_ACTION', 'HOLDING_WOUND'] as BleedingActivity[]).map((a) => `<option value="${a}" ${a === activity ? 'selected' : ''}>${a}</option>`).join('')}</select></label><label class="check"><input id="decline" type="checkbox" ${decline ? 'checked' : ''}>Цель явно отказывается от реакции</label><p class="muted">При продолжении pending вводите только ещё не сделанные кубики. Уже сделанные броски сохраняются.</p>`;
  const inputs = () => {
    diceText = document.querySelector<HTMLTextAreaElement>('#dice')!.value;
    diceMode = document.querySelector<HTMLSelectElement>('#dice-mode')!.value;
    seed = Number(document.querySelector<HTMLInputElement>('#seed')!.value);
    modifier = Number(document.querySelector<HTMLInputElement>('#modifier')!.value);
    activity = document.querySelector<HTMLSelectElement>('#activity')!.value as BleedingActivity;
    decline = document.querySelector<HTMLInputElement>('#decline')!.checked;
  };
  const rng = () => (diceMode === 'fixed' ? fixedDice(diceText) : seededDice(seed));
  document.querySelector<HTMLButtonElement>('#attack')!.disabled =
    !!runtime.pending || !!runtime.pendingTurn;
  document.querySelector<HTMLButtonElement>('#resume')!.disabled = !runtime.pending;
  document.querySelector<HTMLButtonElement>('#cancel')!.disabled =
    !runtime.pending || runtime.pending.prefix.length > 0;
  document.querySelector<HTMLElement>('#attack')!.onclick = () => {
    inputs();
    perform(() => {
      if (!decline) throw new Error('Автоматизация реакции не включена; нужен явный отказ цели');
      return attack(
        battle,
        {
          id: `local-${++serial}`,
          actor: battle.active,
          target: document.querySelector<HTMLSelectElement>('#target')!.value as ActorId,
          weapon: document.querySelector<HTMLSelectElement>('#weapon')!.value as WeaponId,
          targetActivity: activity,
          modifier,
          defense: 'DECLINE',
        },
        rng(),
      );
    });
  };
  document.querySelector<HTMLElement>('#resume')!.onclick = () => {
    inputs();
    perform(() => resumeAttack(battle, rng()));
  };
  document.querySelector<HTMLElement>('#cancel')!.onclick = () =>
    perform(() => {
      cancelUnstarted(battle);
      return 'Неначатая команда отменена без бросков';
    });
  document.querySelector<HTMLElement>('#next-turn')!.onclick = () => {
    inputs();
    perform(() => nextTurn(battle, rng()));
  };
  document.querySelector<HTMLElement>('#scenario')!.onclick = () =>
    perform(() => {
      battle = resolvedDemoBattle();
      serial = 0;
      return `Сценарий попадание / промах завершён: Келус ${battle.hp['kelus-drakar']}/32, Пак ${battle.hp.pak}/33, блок ${battle.ammo.hotshot}/250. Оба действия разрешены Core.`;
    });
  document.querySelector<HTMLElement>('#sword-scenario')!.onclick = () =>
    perform(() => {
      battle = demoBattle();
      serial = 0;
      const pending = getEngine(battle).pending;
      return pending
        ? `Сценарий дошёл до CONTEXT_REQUIRED: ${pending.reason}`
        : `Сценарий завершён: Келус ${battle.hp['kelus-drakar']}/32, Пак ${battle.hp.pak}/33, блок ${battle.ammo.hotshot}/250`;
    });
  document.querySelector<HTMLElement>('#reset')!.onclick = () => {
    battle = createBattle();
    message = 'Исходные профили и runtime восстановлены';
    serial = 0;
    render();
  };
  document.querySelector<HTMLElement>('#export')!.onclick = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(exportReplay(battle), null, 2)], {
        type: 'application/json',
      }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'kadat-combat.json';
    link.click();
    URL.revokeObjectURL(url);
  };
  document.querySelector<HTMLInputElement>('#import')!.onchange = async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      if (file.size > 10000000) throw new Error('Replay больше 10 MB');
      const next = importReplay(JSON.parse(await file.text()));
      battle = next;
      serial = battle.log.length;
      message = 'Replay воспроизведён из сохранённых кубиков';
      render();
    } catch (error) {
      message = `Replay не загружен: ${String(error)}`;
      render();
    }
  };
  for (const form of document.querySelectorAll<HTMLFormElement>('[data-move]'))
    form.onsubmit = (event) => {
      event.preventDefault();
      try {
        move(
          battle,
          form.dataset.move as ActorId,
          Number(form.querySelector<HTMLInputElement>('[name=x]')!.value),
          Number(form.querySelector<HTMLInputElement>('[name=y]')!.value),
        );
        render();
      } catch (e) {
        alert(String(e));
      }
    };
  const map = document.querySelector<SVGSVGElement>('#map')!;
  const point = (x: number, y: number) => {
    const p = map.createSVGPoint();
    p.x = x;
    p.y = y;
    return p.matrixTransform(map.getScreenCTM()!.inverse());
  };
  let drag: { id: ActorId; pointer: number; dx: number; dy: number; token: SVGGElement } | null =
    null;
  map.onpointerdown = (e) => {
    const token = (e.target as Element).closest<SVGGElement>('[data-actor]');
    if (!token) return;
    const id = token.dataset.actor as ActorId,
      p = point(e.clientX, e.clientY);
    drag = {
      id,
      pointer: e.pointerId,
      dx: p.x - battle.positions[id].x,
      dy: p.y - battle.positions[id].y,
      token,
    };
    map.setPointerCapture(e.pointerId);
  };
  map.onpointermove = (e) => {
    if (!drag || drag.pointer !== e.pointerId) return;
    const p = point(e.clientX, e.clientY);
    drag.token.setAttribute(
      'transform',
      `translate(${Math.max(0, Math.min(20, p.x - drag.dx))} ${Math.max(0, Math.min(20, p.y - drag.dy))})`,
    );
  };
  map.onpointerup = (e) => {
    if (!drag || drag.pointer !== e.pointerId) return;
    const p = point(e.clientX, e.clientY);
    move(
      battle,
      drag.id,
      Math.max(0, Math.min(20, p.x - drag.dx)),
      Math.max(0, Math.min(20, p.y - drag.dy)),
    );
    drag = null;
    render();
  };
  map.onpointercancel = () => {
    drag = null;
    render();
  };
}
function perform(action: () => unknown) {
  try {
    const result = action() as
      | string
      | { status?: string; reason?: string; result?: { damage?: { finalDamage: number | null } } }
      | undefined;
    message =
      typeof result === 'string'
        ? result
        : result?.reason
          ? `${result.status}: ${result.reason}`
          : JSON.stringify(
              {
                status: result?.status,
                finalDamage: result?.result?.damage?.finalDamage ?? null,
                wounds: battle.hp,
                ammo: battle.ammo.hotshot,
              },
              null,
              2,
            );
  } catch (error) {
    message = String(error);
  }
  render();
}
render();
