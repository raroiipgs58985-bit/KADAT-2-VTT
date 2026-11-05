/* global document, URL, Blob, alert */
import { actor, append, createBattle, fixture, ids, move, selectActor, weapons } from './model';
import type { ActorId } from './model';
import './style.css';
const root = document.querySelector<HTMLElement>('#app')!;
let battle = createBattle();
const escape = (v: unknown) =>
  String(v).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
function render() {
  root.innerHTML = `<header><span class="eyebrow">KADAT 2 / ЛОКАЛЬНЫЙ ЭКСПЕРИМЕНТ v0.2</span><h1>Келус Дракар <span>против</span> Пака</h1><p>Два персонажа. Одна локальная сессия. Без сервера боя и базы данных.</p></header>
  <div class="toolbar"><label>Ручная очередь<select id="active">${ids.map((id) => `<option value="${id}" ${id === battle.active ? 'selected' : ''}>${actor(id).name}</option>`).join('')}</select></label><button id="reset">Сбросить бой</button><button id="export">Скачать журнал</button></div>
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
    )}</select></label><p id="weapon-description" class="raw"></p><div id="combat-controls"></div><button id="attack">Проверить атаку</button><div id="result" role="status"></div></section></div>
  <section><h2>Профили и состояние</h2><div class="profiles">${ids
    .map(
      (id) =>
        `<article><h3>${actor(id).name}</h3><div class="health">${battle.hp[id]} / ${actor(id).max} <small>раны</small></div><dl>${Object.entries(
          actor(id).characteristics,
        )
          .map(([key, c]) => `<div><dt>${key}</dt><dd>${escape(c.raw)}</dd></div>`)
          .join('')}</dl><details><summary>Навыки, таланты, броня и снаряжение</summary>${actor(id)
          .profile.map(
            (p) =>
              `<p><strong>${escape(p.label)}</strong><br>${escape(p.formattedValue)}${p.note ? `<br><span class="muted">${escape(p.note)}</span>` : ''}</p>`,
          )
          .join('')}</details></article>`,
    )
    .join(
      '',
    )}</div></section><section><h2>Combat Log</h2><pre id="log">${escape(JSON.stringify(battle.log, null, 2))}</pre></section>`;
  document.querySelector<HTMLSelectElement>('#active')!.onchange = (e) => {
    selectActor(battle, (e.target as HTMLSelectElement).value as ActorId);
    render();
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
  document.querySelector<HTMLElement>('#attack')!.onclick = () => {
    append(battle, 'CONTEXT_REQUIRED', {
      reason: 'Combat adapter not connected in recovery checkpoint.',
    });
    document.querySelector<HTMLElement>('#log')!.textContent = JSON.stringify(battle.log, null, 2);
  };
  document.querySelector<HTMLElement>('#reset')!.onclick = () => {
    battle = createBattle();
    render();
  };
  document.querySelector<HTMLElement>('#export')!.onclick = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ fixture: fixture.version, log: battle.log }, null, 2)], {
        type: 'application/json',
      }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'kadat-combat.json';
    link.click();
    URL.revokeObjectURL(url);
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
render();
