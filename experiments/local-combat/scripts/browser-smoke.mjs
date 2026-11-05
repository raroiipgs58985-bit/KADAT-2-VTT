/* global fetch, WebSocket, console, setTimeout */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { writeFile } from 'node:fs/promises';
import { rulings } from '../src/rulings.ts';
const pages = await (await fetch('http://127.0.0.1:9222/json')).json();
const socket = new WebSocket(pages[0].webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
const pending = new Map();
let id = 0;
socket.addEventListener('message', (e) => {
  const r = JSON.parse(e.data),
    p = pending.get(r.id);
  if (p) {
    pending.delete(r.id);
    r.error ? p.reject(r.error) : p.resolve(r.result);
  }
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const key = ++id;
    pending.set(key, { resolve, reject });
    socket.send(JSON.stringify({ id: key, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
const health = () =>
  evaluate("[...document.querySelectorAll('.health')].map(x=>x.textContent.trim())");
try {
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:5173' });
  let loaded = false;
  for (let i = 0; i < 60; i++) {
    loaded = await evaluate("!!document.querySelector('#attack')");
    if (loaded) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(loaded, 'UI loads');
  assert.equal(
    await evaluate('document.documentElement.scrollWidth<=innerWidth'),
    true,
    'mobile has no horizontal overflow',
  );
  assert.equal(await evaluate("document.querySelectorAll('.token').length"), 2);
  assert.match((await health())[0], /26 \/ 32/);
  assert.match((await health())[1], /33 \/ 33/);
  await evaluate("document.querySelector('#map').scrollIntoView({block:'center'})");
  const point = await evaluate(
    "(()=>{const m=document.querySelector('#map'),p=m.createSVGPoint();p.x=15;p.y=10;const screen=p.matrixTransform(m.getScreenCTM());return{x:screen.x,y:screen.y,scale:m.getScreenCTM().a}})()",
  );
  await send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: point.x, y: point.y }],
  });
  await send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: point.x + point.scale * 1.375, y: point.y }],
  });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const x = await evaluate("Number(document.querySelector('[data-move=pak] [name=x]').value)");
  assert(Math.abs(x - 16.375) < 0.06, 'touch drag retains fractional metric coordinate');
  await evaluate(
    "document.querySelector('#reset').click();document.querySelector('#attack').click()",
  );
  assert.match((await health())[1], /31 \/ 33/);
  assert.match(
    await evaluate("document.querySelector('#weapon-description').textContent"),
    /249 \/ 250/,
  );
  const shot = await evaluate(
    "JSON.parse(document.querySelector('#log').textContent).find(e=>e.type==='attack').detail",
  );
  assert.equal(shot.result.damage.finalDamage, 2);
  assert.equal(shot.result.damage.input.location, 'Torso');
  assert.deepEqual(shot.rolls, [
    { sides: 100, value: 45 },
    { sides: 10, value: 2 },
    { sides: 100, value: 20 },
  ]);
  await evaluate("document.querySelector('#scenario').click()");
  assert.match((await health())[0], /26 \/ 32/);
  assert.match((await health())[1], /31 \/ 33/);
  assert.match(await evaluate("document.querySelector('#result').textContent"), /завершён/);
  assert.equal(
    await evaluate(
      "JSON.parse(document.querySelector('#log').textContent).filter(e=>e.type==='attack').length",
    ),
    2,
  );
  console.log('Two-sided hit/miss scenario: PASS; both real Core attacks committed.');
  await evaluate("document.querySelector('#sword-scenario').click()");
  const final = await health();
  assert.match(final[1], /31 \/ 33/);
  if (rulings.chainTiming === null) {
    assert.match(final[0], /26 \/ 32/);
    assert.match(
      await evaluate("document.querySelector('#result').textContent"),
      /CONTEXT_REQUIRED/,
    );
    console.log('Two-sided damaging scenario: BLOCKED by author chain timing; Pak d100 is saved.');
  } else {
    assert.match(final[0], /16 \/ 32/);
    console.log('Two-sided damaging scenario: PASS.');
  }
  await evaluate('scrollTo(0,0)');
  const shotImage = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile('/workspace/scratch/kadat-v02-mobile.png', Buffer.from(shotImage.data, 'base64'));
  await evaluate("document.querySelector('#reset').click()");
  assert.match((await health())[0], /26 \/ 32/);
  assert.match((await health())[1], /33 \/ 33/);
  console.log(
    'PASS: 390px mobile viewport, touch drag, real shot, exact damage/ammo/log, scenario boundary, reset.',
  );
} finally {
  socket.close();
}
