// Browser smoke test for the tactical scene. Requires a running dev server
// (`pnpm dev:client`) and a Playwright installation that `import('playwright')` can resolve;
// Playwright is intentionally not a project dependency yet.
// Usage: node apps/client/scripts/browser-smoke.mjs [url] [screenshotDir]
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

// ESM ignores NODE_PATH; fall back to CommonJS resolution so a global install also works.
const { chromium } = await import('playwright').catch(() =>
  createRequire(import.meta.url)('playwright'),
);

const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const out = process.argv[3] ?? '.';
mkdirSync(out, { recursive: true });
const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
// Technical checks run with «Подробно» on; the simple view is checked at the end.
await page.addInitScript(() => {
  if (!sessionStorage.getItem('smoke-simple')) localStorage.setItem('kadat.details', '1');
});
await page.goto(url);
await page.waitForSelector('svg.map');

/** Screen position of a map point given in metres. */
const screen = (x, y) =>
  page.evaluate(
    ([mx, my]) => {
      const svg = document.querySelector('svg.map');
      const p = svg.createSVGPoint();
      p.x = mx;
      p.y = my;
      const s = p.matrixTransform(svg.getScreenCTM());
      return { x: s.x, y: s.y };
    },
    [x, y],
  );
const tokenPosition = (id) =>
  page.evaluate((actor) => {
    const t = document.querySelector(`[data-actor="${actor}"]`).getAttribute('transform');
    const [, x, y] = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(t);
    return { x: Number(x), y: Number(y) };
  }, id);
const drag = async (from, to) => {
  const a = await screen(from.x, from.y);
  const b = await screen(to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
};
const toast = () => page.textContent('.toast');
/** Waits for an asynchronous toast (file reads) that contains `text`. */
const toastWith = (text) =>
  page
    .waitForFunction((t) => document.querySelector('.toast')?.textContent.includes(t), text, {
      timeout: 5000,
    })
    .then(
      () => true,
      () => false,
    );
const od = () => page.locator('.od .pip.on').count();

const occupiedCells = (id) =>
  page.locator(`[data-occupied="${id}"]`).getAttribute('data-cells').then(Number);

const mapSize = () =>
  page.evaluate(() => {
    const svg = document.querySelector('svg.map');
    return `${svg.dataset.cols}x${svg.dataset.rows}`;
  });
const floorCells = () =>
  page.locator('[data-testid="floor"]').getAttribute('data-cells').then(Number);

// 0. Stage 1 map editor (TZ checklist). Standard scene first.
check((await mapSize()) === '20x20', 'standard map is 20 × 20');
const k0 = await tokenPosition('kelus-drakar');
const p0 = await tokenPosition('pak');
check(
  k0.x === 5.5 && k0.y === 10.5 && p0.x === 15.5 && p0.y === 10.5,
  'Kelus (5.5; 10.5) and Pak (15.5; 10.5) on the standard scene',
);
await page.getByRole('button', { name: 'Приблизить' }).click();
await page.getByRole('button', { name: 'Приблизить' }).click();
const kz = await tokenPosition('kelus-drakar');
check(kz.x === 5.5 && kz.y === 10.5, 'zoom does not change world coordinates');
await page.getByRole('button', { name: 'Вся карта' }).click();

await page.getByRole('tab', { name: /Редактор карты/ }).click();
await page.getByLabel('Ширина карты').fill('24');
await page.getByLabel('Высота карты').fill('12');
await page.getByRole('button', { name: 'Новая пустая карта' }).click();
check((await mapSize()) === '24x12', 'draft shows a 24 × 12 grid');
await page.getByRole('button', { name: /Прямоугольник/ }).click();
await drag({ x: 1.5, y: 1.5 }, { x: 4.5, y: 2.5 });
check((await floorCells()) === 8, 'rectangle fill paints 8 cells as one step');
// Escape cancels an unfinished gesture.
{
  const a = await screen(10.5, 5.5);
  const c = await screen(12.5, 7.5);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(c.x, c.y, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
}
check((await floorCells()) === 8, 'Escape cancels the unfinished rectangle');
await page.getByRole('button', { name: /Отменить шаг/ }).click();
check((await floorCells()) === 0, 'undo removes the fill');
await page.keyboard.press('Control+y');
check((await floorCells()) === 8, 'Ctrl+Y redoes the fill');
await page.screenshot({ path: `${out}/00-editor-24x12.png` });
await page.getByRole('button', { name: 'Применить карту' }).click();
check((await toast()).includes('Карта применена'), 'apply reports the new map');
check((await page.textContent('.map-name')).includes('24 × 12'), 'scene now uses 24 × 12');

// Shrinking to 8 × 8 with current tokens is refused and keeps the scene.
await page.getByLabel('Ширина карты').fill('8');
await page.getByLabel('Высота карты').fill('8');
await page.getByRole('button', { name: 'Изменить размер' }).click();
const problemsText = await page.textContent('.problems');
check(
  problemsText.includes('Келус Дракар') && problemsText.includes('Пак'),
  'conflicting tokens are listed for 8 × 8',
);
check(
  await page.getByRole('button', { name: 'Применить карту' }).isDisabled(),
  'apply is disabled while conflicts remain',
);
await page.screenshot({ path: `${out}/00b-editor-conflict.png` });
await page.getByRole('button', { name: 'Отменить изменения' }).click();
check((await mapSize()) === '24x12', 'discard returns to the applied 24 × 12 map');

// Editor → placement → editor → apply keeps a token moved only in placement.
await page.getByRole('button', { name: /Кисть/ }).click();
await drag({ x: 20.5, y: 1.5 }, { x: 21.5, y: 1.5 }); // a draft edit, not applied yet
await page.getByRole('tab', { name: 'Расстановка' }).click();
await drag({ x: 15.5, y: 10.5 }, { x: 13.5, y: 8.5 });
await page.getByRole('tab', { name: /Редактор карты/ }).click();
const pakInDraft = await tokenPosition('pak');
check(
  pakInDraft.x === 13.5 && pakInDraft.y === 8.5,
  `editor shows Pak at his placement position (got ${pakInDraft.x}; ${pakInDraft.y})`,
);
await page.getByRole('button', { name: 'Применить карту' }).click();
await page.getByRole('tab', { name: 'Расстановка' }).click();
const pakApplied = await tokenPosition('pak');
check(
  pakApplied.x === 13.5 && pakApplied.y === 8.5,
  `apply keeps the placement move (got ${pakApplied.x}; ${pakApplied.y})`,
);

// Moving the same token in the draft and in placement is a conflict before apply.
await page.getByRole('tab', { name: /Редактор карты/ }).click();
await page.getByRole('button', { name: /Рука/ }).click();
await drag({ x: 13.5, y: 8.5 }, { x: 3.5, y: 3.5 }); // draft move
await page.getByRole('tab', { name: 'Расстановка' }).click();
await drag({ x: 13.5, y: 8.5 }, { x: 11.5, y: 8.5 }); // placement move
await page.getByRole('tab', { name: /Редактор карты/ }).click();
check(
  (await page.locator('[data-stale="pak"]').count()) === 1,
  'double move is shown as a conflict',
);
check(
  (await page.getByRole('tab', { name: /Редактор карты/ }).getAttribute('aria-selected')) ===
    'true' &&
    (await page.getByRole('tab', { name: 'Расстановка' }).getAttribute('aria-selected')) ===
      'false',
  'the editor tab is the selected mode after returning',
);
check(
  await page.getByRole('button', { name: 'Применить карту' }).isDisabled(),
  'apply is blocked until the GM chooses',
);
await page.screenshot({ path: `${out}/00c-editor-stale.png` });
await page.getByRole('button', { name: /Кисть/ }).click();
await drag({ x: 22.5, y: 2.5 }, { x: 22.5, y: 3.5 }); // another draft edit to apply
await page.getByRole('button', { name: 'Из расстановки' }).click();
check(
  (await page.locator('[data-stale="pak"]').count()) === 0,
  'the conflict disappears after the GM choice',
);
await page.getByRole('button', { name: 'Применить карту' }).click();
await page.getByRole('tab', { name: 'Расстановка' }).click();
const pakChosen = await tokenPosition('pak');
check(
  pakChosen.x === 11.5 && pakChosen.y === 8.5,
  `GM choice «из расстановки» is applied (got ${pakChosen.x}; ${pakChosen.y})`,
);

// Replay v0.4 exports a history on another map size (it carries the map snapshot).
await page.getByRole('tab', { name: 'Расстановка' }).click();
{
  const exported = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать replay' }).click();
  const file = await (await exported).path();
  const { readFileSync } = await import('node:fs');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  check(
    data.format === 'kadat-client-combat-v0.5' &&
      data.steps.some((s) => s.type === 'map' && data.snapshots.maps[s.snapshot]?.cols === 24),
    'replay of a 24 × 12 history is exported with its map snapshot',
  );
}

// Stage 2: background raster, calibration, decorations and the portable map file.
{
  const { writeFileSync, readFileSync, rmSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const work = mkdtempSync(join(tmpdir(), 'kadat-stage2-'));
  // A 480 × 240 PNG drawn in the page: a grid every 40 px.
  const pngBase64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 480;
    c.height = 240;
    const g = c.getContext('2d');
    g.fillStyle = '#20303a';
    g.fillRect(0, 0, 480, 240);
    g.strokeStyle = '#9fb3c8';
    for (let x = 0; x <= 480; x += 40) g.strokeRect(x, 0, 0, 240);
    for (let y = 0; y <= 240; y += 40) g.strokeRect(0, y, 480, 0);
    return c.toDataURL('image/png').split(',')[1];
  });
  const imagePath = join(work, 'plan.png');
  writeFileSync(imagePath, Buffer.from(pngBase64, 'base64'));

  await page.getByRole('tab', { name: /Редактор карты/ }).click();
  await page.getByLabel('Ширина карты').fill('24');
  await page.getByLabel('Высота карты').fill('12');
  await page.getByRole('button', { name: 'Новая пустая карта' }).click();
  await page.getByLabel('Файл подложки').setInputFiles(imagePath);
  await page.waitForSelector('[data-testid="background"]');
  const bgWidth = () =>
    page.locator('[data-testid="background"]').getAttribute('width').then(Number);
  check(Math.abs((await bgWidth()) - 24) < 1e-9, 'raster is fitted to the 24 m map width');

  // Calibrate: two points 4 m apart on the current scale are really 8 m apart.
  await page.getByRole('button', { name: /Калибровка/ }).click();
  for (const [x, y] of [
    [2, 2],
    [6, 2],
  ]) {
    const pt = await screen(x, y);
    await page.mouse.click(pt.x, pt.y);
  }
  await page.getByLabel('Известная дистанция, м').fill('8');
  await page.getByRole('button', { name: 'Применить калибровку' }).click();
  check(
    Math.abs((await bgWidth()) - 48) < 0.05,
    `calibration doubles the scale (width ${await bgWidth()} m)`,
  );

  // A labelled decoration and some floor paint.
  await page.getByPlaceholder('например, Ковёр').fill('Ящики');
  await page.getByRole('button', { name: /Декорация/ }).click();
  await drag({ x: 3.5, y: 5.5 }, { x: 5.5, y: 6.5 });
  check(
    (await page.locator('[data-decoration] text').textContent()) === 'Ящики',
    'decoration with its label is drawn',
  );
  await page.getByRole('button', { name: /Прямоугольник/ }).click();
  await drag({ x: 10.5, y: 8.5 }, { x: 12.5, y: 9.5 });
  const floorBefore = await floorCells();
  await page.screenshot({ path: `${out}/00d-background.png` });

  // Save the map file.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить карту в файл' }).click();
  const mapPath = join(work, 'saved.kadat-map.json');
  await (await download).saveAs(mapPath);
  const saved = JSON.parse(readFileSync(mapPath, 'utf8'));
  check(
    saved.documentType === 'kadat-map' && saved.map.background.widthPx === 480,
    'saved file embeds the raster (480 px wide)',
  );

  // The source image is removed and the client restarted.
  rmSync(imagePath);
  await page.reload();
  await page.waitForSelector('svg.map');
  check((await mapSize()) === '20x20', 'after restart the standard scene is open');

  // A broken file does not change the current map.
  const brokenPath = join(work, 'broken.kadat-map.json');
  writeFileSync(brokenPath, '{ "documentType": "kadat-map", ');
  await page.getByRole('tab', { name: /Редактор карты/ }).click();
  await page.getByLabel('Файл карты').setInputFiles(brokenPath);
  check(await toastWith('Файл карты не открыт'), 'a broken map file is refused');
  check((await mapSize()) === '20x20', 'the current map is unchanged after the failed load');
  const gifPath = join(work, 'image.gif');
  writeFileSync(gifPath, Buffer.from('GIF89a\u0001\u0000\u0001\u0000', 'latin1'));
  await page.getByLabel('Файл подложки').setInputFiles(gifPath);
  check(await toastWith('PNG, JPEG и WebP'), 'a non-supported raster is refused');
  check((await page.locator('[data-testid="background"]').count()) === 0, 'no background added');

  // Open the saved file: grid, scale and markup match.
  await page.getByLabel('Файл карты').setInputFiles(mapPath);
  await page.waitForSelector('[data-testid="background"]');
  check((await mapSize()) === '24x12', 'opened map is 24 × 12');
  check(Math.abs((await bgWidth()) - 48) < 0.05, 'background scale survives the round trip');
  check((await floorCells()) === floorBefore, 'floor markup survives the round trip');
  check(
    (await page.locator('[data-decoration] text').textContent()) === 'Ящики',
    'decoration survives the round trip',
  );
  await page.getByRole('button', { name: 'Применить карту' }).click();
  check((await page.textContent('.map-name')).includes('24 × 12'), 'opened map is applied');
  // Replacing the background after marking two calibration points resets the points.
  await page.getByRole('tab', { name: /Редактор карты/ }).click();
  const markers = () => page.locator('[data-testid="calibration"] circle').count();
  await page.getByRole('button', { name: /Калибровка/ }).click();
  for (const [x, y] of [
    [3, 3],
    [9, 3],
  ]) {
    const pt = await screen(x, y);
    await page.mouse.click(pt.x, pt.y);
  }
  check((await markers()) === 2, 'two calibration points are marked');
  const secondPath = join(work, 'second.png');
  const secondBase64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 240;
    c.height = 240;
    const g = c.getContext('2d');
    g.fillStyle = '#3a2a20';
    g.fillRect(0, 0, 240, 240);
    return c.toDataURL('image/png').split(',')[1];
  });
  writeFileSync(secondPath, Buffer.from(secondBase64, 'base64'));
  await page.getByLabel('Файл подложки').setInputFiles(secondPath);
  check(await toastWith('Подложка загружена'), 'the background is replaced');
  check((await markers()) === 0, 'replacing the background resets the calibration points');
  check(
    (await page.textContent('.calibration-box')).includes('0/2'),
    'the panel shows 0/2 points after the replacement',
  );
  check(Math.abs((await bgWidth()) - 24) < 1e-9, 'the new raster is fitted to the map width');
  // Removing the background also resets marked points.
  for (const [x, y] of [
    [3, 3],
    [9, 3],
  ]) {
    const pt = await screen(x, y);
    await page.mouse.click(pt.x, pt.y);
  }
  await page.getByRole('button', { name: 'Убрать подложку' }).click();
  check(
    (await markers()) === 0 && (await page.locator('[data-testid="background"]').count()) === 0,
    'removing the background resets the calibration points',
  );

  // «Новая пустая карта» from a filled map has no background, decorations or floor paint.
  await page.getByLabel('Файл подложки').setInputFiles(secondPath);
  check(await toastWith('Подложка загружена'), 'background restored for the next check');
  check(
    (await page.locator('[data-decoration]').count()) > 0 && (await floorCells()) > 0,
    'the draft is filled before creating an empty map',
  );
  await page.getByLabel('Ширина карты').fill('22');
  await page.getByLabel('Высота карты').fill('12');
  await page.getByRole('button', { name: 'Новая пустая карта' }).click();
  check((await mapSize()) === '22x12', 'empty map uses the requested size');
  check(
    (await page.locator('[data-testid="background"]').count()) === 0,
    'empty map: no background',
  );
  check((await page.locator('[data-decoration]').count()) === 0, 'empty map: no decorations');
  check((await floorCells()) === 0, 'empty map: no floor paint');
  check(
    (await page.locator('.problems').count()) === 0,
    'token positions are still valid on the empty 22 × 12 map',
  );
  await page.getByLabel('Ширина карты').fill('8');
  await page.getByLabel('Высота карты').fill('8');
  await page.getByRole('button', { name: 'Новая пустая карта' }).click();
  const emptyProblems = await page.textContent('.problems');
  check(
    emptyProblems.includes('Келус Дракар') && emptyProblems.includes('Пак'),
    'an empty 8 × 8 map still lists the conflicting tokens',
  );
  await page.getByRole('button', { name: 'Отменить изменения' }).click();
  rmSync(work, { recursive: true, force: true });
}

// Stage 3: walls, doors and obstacles; straight path checks; replay on the saved snapshot.
{
  const { readFileSync, rmSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const work = mkdtempSync(join(tmpdir(), 'kadat-stage3-'));
  const click = async (x, y) => {
    const pt = await screen(x, y);
    await page.mouse.click(pt.x, pt.y);
  };
  const count = (selector) => page.locator(selector).count();
  await page.reload();
  await page.waitForSelector('svg.map');
  await page.getByRole('tab', { name: /Редактор карты/ }).click();

  // A room: walls around x 8..14, y 6..14 drawn by successive clicks, finished on the start.
  await page.getByRole('button', { name: /Стена/ }).click();
  for (const [x, y] of [
    [8, 6],
    [14, 6],
    [14, 14],
    [8, 14],
    [8, 6],
    [8, 6],
  ])
    await click(x, y);
  check((await count('[data-wall]')) === 1, 'a closed wall chain is created');
  // A diagonal segment is not accepted while drawing.
  await click(2, 2);
  await click(4, 4);
  check((await count('[data-testid="wall-draft"] circle')) === 1, 'a diagonal vertex is ignored');
  await page.keyboard.press('Escape');
  check((await count('[data-testid="wall-draft"]')) === 0, 'Escape cancels the wall chain');

  // A one-edge door on the west wall and a crate obstacle inside.
  await page.getByRole('button', { name: /Дверь/ }).click();
  await drag({ x: 8, y: 10 }, { x: 8, y: 11 });
  check((await count('[data-door]')) === 1, 'a door is placed on the wall');
  await drag({ x: 2, y: 2 }, { x: 4, y: 2 });
  check(await toastWith('на одном прямом участке'), 'a door off any wall is refused');
  await page.getByLabel('Подпись нового препятствия').fill('Ящики');
  await page.getByRole('button', { name: /Препятствие/ }).click();
  await drag({ x: 11.5, y: 8.5 }, { x: 11.5, y: 11.5 });
  check((await count('[data-obstacle]')) === 1, 'an obstacle is drawn');
  await page.getByRole('button', { name: 'Применить карту' }).click();
  check(await toastWith('Карта применена'), 'the room is applied');
  await page.screenshot({ path: `${out}/00e-room.png` });

  // Save, restart and reopen the map file.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить карту в файл' }).click();
  const mapPath = join(work, 'room.kadat-map.json');
  await (await download).saveAs(mapPath);
  const saved = JSON.parse(readFileSync(mapPath, 'utf8'));
  check(
    saved.schemaVersion === 2 && saved.map.walls.length === 1 && saved.map.doors.length === 1,
    'the saved file (schema 2) holds the wall and the door',
  );
  await page.reload();
  await page.waitForSelector('svg.map');
  await page.getByRole('tab', { name: /Редактор карты/ }).click();
  await page.getByLabel('Файл карты').setInputFiles(mapPath);
  check(await toastWith('открыт как черновик'), 'the room file opens');
  await page.getByRole('button', { name: 'Применить карту' }).click();
  check(
    (await count('[data-wall]')) === 1 &&
      (await count('[data-door]')) === 1 &&
      (await count('[data-obstacle]')) === 1,
    'walls, door and obstacle survive the round trip',
  );

  // Setup: Kelus west of the door; the door toggles by a click and the change is logged.
  await page.getByRole('tab', { name: 'Расстановка' }).click();
  await drag({ x: 5.5, y: 10.5 }, { x: 6.5, y: 10.5 });
  const doorState = () => page.locator('[data-door]').getAttribute('data-open');
  await click(8, 10.5);
  check((await doorState()) === 'true', 'a click opens the door in setup');
  check(await toastWith('Дверь открыта'), 'the door change is logged');
  await click(8, 10.5);
  check((await doorState()) === 'false', 'a second click closes it again');

  // Combat: through the closed door is refused without spending OD; nothing inside the room
  // is highlighted; a free move elsewhere is accepted.
  await page.getByRole('button', { name: 'Начать бой' }).click();
  await page.locator('.mode').nth(2).click(); // full move, 8 m
  const insideRoom = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="reach"] rect')].some(
      (r) => Number(r.getAttribute('x')) >= 8,
    ),
  );
  check(!insideRoom, 'no reachable cell is highlighted inside the closed room');
  await page.locator('.mode').nth(2).click(); // deselect
  await page.locator('.mode').nth(1).click(); // half move
  await click(9.5, 10.5);
  check(
    await toastWith('закрытая дверь'),
    'a move through the closed door is refused with the reason',
  );
  check((await od()) === 2, 'the refused move spends no OD');
  const kelusStill = await tokenPosition('kelus-drakar');
  check(kelusStill.x === 6.5, 'Kelus stays west of the door');
  await page.locator('.mode').nth(1).click();
  await click(3.5, 10.5);
  check((await od()) === 1, 'an allowed move spends 1 OD');

  // Replay v0.4 reproduces the accepted command on the saved snapshot.
  const replayDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать replay' }).click();
  const replayPath = join(work, 'combat.json');
  await (await replayDownload).saveAs(replayPath);
  const replay = JSON.parse(readFileSync(replayPath, 'utf8'));
  check(replay.format === 'kadat-client-combat-v0.5', 'replay is exported as v0.5');
  await page.reload();
  await page.waitForSelector('svg.map');
  await page
    .locator('label.file-button', { hasText: 'Открыть replay' })
    .locator('input')
    .setInputFiles(replayPath);
  check(await toastWith('Replay воспроизведён'), 'the replay is imported');
  const replayedKelus = await tokenPosition('kelus-drakar');
  check(
    (await count('[data-wall]')) === 1 &&
      (await doorState()) === 'false' &&
      replayedKelus.x === 3.5 &&
      (await od()) === 1,
    'the replay restores the room, the closed door, Kelus at 3.5 and 1 OD',
  );
  rmSync(work, { recursive: true, force: true });
}

// Stage 3 load check: 200 × 200 m map with a 2048 px raster, 500 wall edges and 50
// obstacles; several edits including a wall end; zoom and highlight timings.
{
  const { writeFileSync, rmSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const work = mkdtempSync(join(tmpdir(), 'kadat-big-'));
  const click = async (x, y) => {
    const pt = await screen(x, y);
    await page.mouse.click(pt.x, pt.y);
  };
  const count = (selector) => page.locator(selector).count();
  const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1];
  await page.reload();
  await page.waitForSelector('svg.map');
  const raster = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 2048;
    c.height = 2048;
    const g = c.getContext('2d');
    g.fillStyle = '#1d2a33';
    g.fillRect(0, 0, 2048, 2048);
    g.strokeStyle = '#61788c';
    for (let i = 0; i <= 2048; i += 64) {
      g.strokeRect(i, 0, 0, 2048);
      g.strokeRect(0, i, 2048, 0);
    }
    return c.toDataURL('image/png').split(',')[1];
  });
  const walls = [];
  for (let i = 0; i < 25; i++) {
    const y = 40 + i * 6;
    const x = 10 + (i % 5) * 36;
    walls.push({
      id: `w${i}`,
      points: [
        { x, y },
        { x: x + 20, y },
      ],
    });
  }
  const obstacles = [];
  for (let i = 0; i < 50; i++)
    obstacles.push({
      id: `o${i}`,
      col: 30 + (i % 10) * 15,
      row: 2 + Math.floor(i / 10) * 7,
      width: 2,
      height: 2,
      label: `Ящики ${i + 1}`,
      blocksMovement: true,
      blocksVision: i % 2 === 0,
      notes: '',
    });
  const bigPath = join(work, 'big.kadat-map.json');
  writeFileSync(
    bigPath,
    JSON.stringify({
      documentType: 'kadat-map',
      schemaVersion: 2,
      map: {
        schemaVersion: 2,
        id: 'big',
        name: 'Большая карта',
        cols: 200,
        rows: 200,
        cellMeters: 1,
        background: {
          mime: 'image/png',
          data: raster,
          widthPx: 2048,
          heightPx: 2048,
          x: 0,
          y: 0,
          metersPerPixel: 200 / 2048,
          opacity: 0.8,
          locked: true,
        },
        floor: {},
        decorations: [],
        walls,
        doors: [],
        obstacles,
        zones: [],
      },
    }),
  );
  await page.getByRole('tab', { name: /Редактор карты/ }).click();
  await page.getByLabel('Файл карты').setInputFiles(bigPath);
  check(await toastWith('открыт как черновик'), 'the 200 × 200 map file opens');
  check(
    (await mapSize()) === '200x200' && (await count('[data-wall]')) === 25,
    'big map: 200 × 200 with 25 walls (500 edges)',
  );
  check((await count('[data-obstacle]')) === 50, 'big map: 50 obstacles');

  // Edits near the tokens, zoomed in: a wall, a door, an obstacle, then the wall end.
  // Zoom with the wheel around (10, 10) so that this area stays under the cursor.
  for (let i = 0; i < 12; i++) {
    const focus = await screen(10, 10);
    await page.mouse.move(focus.x, focus.y);
    await page.mouse.wheel(0, -120);
  }
  await page.getByRole('button', { name: /Стена/ }).click();
  // The zoomed view covers roughly x 9…31, y 9…31: edits go there, clear of the
  // generated walls (y ≥ 40), obstacles (x ≥ 30) and the tokens.
  for (const [x, y] of [
    [16, 12],
    [16, 24],
    [16, 24],
  ])
    await click(x, y);
  await page.getByRole('button', { name: /Дверь/ }).click();
  await drag({ x: 16, y: 17 }, { x: 16, y: 18 });
  await page.getByLabel('Подпись нового препятствия').fill('Баррикада');
  await page.getByRole('button', { name: /Препятствие/ }).click();
  await drag({ x: 19.5, y: 20.5 }, { x: 20.5, y: 20.5 });
  check(
    (await count('[data-wall]')) === 26 &&
      (await count('[data-door]')) === 1 &&
      (await count('[data-obstacle]')) === 51,
    'several edits on the big map: wall, door, obstacle',
  );

  // Wall end editing: cutting past the door is refused, lengthening works.
  await page.getByRole('button', { name: /Выбор/ }).click();
  await click(16, 14.5);
  check((await count('[data-wall-end]')) === 2, 'the selected wall shows its two end handles');
  await drag({ x: 16, y: 24 }, { x: 16, y: 16 });
  check(
    await toastWith('Конец стены не перенесён'),
    'shortening the wall past its door is refused',
  );
  check((await toast()).includes('не лежит на одном прямом участке'), 'the refusal names the door');
  await drag({ x: 16, y: 24 }, { x: 16, y: 27 });
  check(await toastWith('Конец стены перенесён в (16; 27)'), 'lengthening the wall end works');
  await page.getByRole('button', { name: /Отменить шаг/ }).click();
  await page.getByRole('button', { name: /Повторить/ }).click();

  await page.getByRole('button', { name: 'Применить карту' }).click();
  check(await toastWith('Карта применена'), 'the edited big map is applied');
  await page.screenshot({ path: `${out}/00f-big-map.png` });

  // Zoom timing (render of a 200 × 200 grid with raster and 500 edges).
  const zoomMs = [];
  for (let i = 0; i < 10; i++)
    zoomMs.push(
      await page.evaluate(
        async (zoomIn) => {
          const svg = document.querySelector('svg.map');
          const before = svg.getAttribute('viewBox');
          const button = document.querySelector(
            zoomIn ? '[aria-label="Приблизить"]' : '[aria-label="Отдалить"]',
          );
          const start = performance.now();
          button.click();
          while (svg.getAttribute('viewBox') === before)
            await new Promise((r) => requestAnimationFrame(r));
          await new Promise((r) => requestAnimationFrame(r));
          return performance.now() - start;
        },
        i % 2 === 0,
      ),
    );

  // Highlight timing in combat: select a movement mode until the reach layer is drawn.
  await page.getByRole('tab', { name: 'Расстановка' }).click();
  await page.getByRole('button', { name: 'Начать бой' }).click();
  const highlightMs = [];
  for (let i = 0; i < 10; i++)
    highlightMs.push(
      await page.evaluate(async () => {
        const button = document.querySelectorAll('.mode')[2];
        const reach = () => Number(document.querySelector('[data-testid="reach"]').dataset.cells);
        const start = performance.now();
        button.click();
        while (reach() === 0) await new Promise((r) => requestAnimationFrame(r));
        await new Promise((r) => requestAnimationFrame(r));
        const ms = performance.now() - start;
        button.click();
        while (reach() !== 0) await new Promise((r) => requestAnimationFrame(r));
        return ms;
      }),
    );
  console.log(
    `INFO big map in browser: zoom p95 ${p95(zoomMs).toFixed(0)} ms, highlight p95 ${p95(highlightMs).toFixed(0)} ms (TZ target ≤ 100 ms on the author's machine)`,
  );
  check(
    p95(highlightMs) < 1000,
    `big map highlight responds (p95 ${p95(highlightMs).toFixed(0)} ms)`,
  );
  rmSync(work, { recursive: true, force: true });
}

// Replay through the interface after five separate applies of a painted 200 × 200 map;
// drag gestures carry the scene revision captured when they start.
{
  const { writeFileSync, readFileSync, rmSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const work = mkdtempSync(join(tmpdir(), 'kadat-five-'));
  const click = async (x, y) => {
    const pt = await screen(x, y);
    await page.mouse.click(pt.x, pt.y);
  };
  const count = (selector) => page.locator(selector).count();
  const apply = async (n) => {
    await page.getByRole('button', { name: 'Применить карту' }).click();
    check(await toastWith(`ревизия ${n}`), `apply #${n} through the interface`);
  };
  await page.reload();
  await page.waitForSelector('svg.map');
  // A 200 × 200 map with 10 000 painted floor cells (rows 0–49).
  const floor = {};
  for (let r = 0; r < 50; r++)
    for (let c = 0; c < 200; c++) floor[`${c}:${r}`] = (c + r) % 2 ? 'grey' : 'sand';
  const mapPath = join(work, 'painted.kadat-map.json');
  writeFileSync(
    mapPath,
    JSON.stringify({
      documentType: 'kadat-map',
      schemaVersion: 2,
      map: {
        schemaVersion: 2,
        id: 'painted',
        name: 'Размеченная карта',
        cols: 200,
        rows: 200,
        cellMeters: 1,
        background: null,
        floor,
        decorations: [],
        walls: [],
        doors: [],
        obstacles: [],
        zones: [],
      },
    }),
  );
  await page.getByRole('tab', { name: /Редактор карты/ }).click();
  await page.getByLabel('Файл карты').setInputFiles(mapPath);
  check(await toastWith('открыт как черновик'), 'the painted 200 × 200 map opens');
  await apply(1);
  await page.getByRole('button', { name: /Стена/ }).click();
  for (const [x, y] of [
    [30, 60],
    [30, 80],
    [30, 80],
  ])
    await click(x, y);
  await apply(2);
  await page.getByRole('button', { name: /Дверь/ }).click();
  await drag({ x: 30, y: 70 }, { x: 30, y: 71 });
  await apply(3);
  await page.getByLabel('Подпись нового препятствия').fill('Баррикада');
  await page.getByRole('button', { name: /Препятствие/ }).click();
  await drag({ x: 40.5, y: 65.5 }, { x: 41.5, y: 65.5 });
  await apply(4);
  await page.getByRole('button', { name: /Прямоугольник/ }).click();
  await drag({ x: 60.5, y: 60.5 }, { x: 62.5, y: 61.5 });
  await apply(5);
  check((await floorCells()) === 10006, 'five applies: 10 006 painted cells on the scene');

  // Combat: one accepted move, then the replay is downloaded through the button.
  await page.getByRole('tab', { name: 'Расстановка' }).click();
  await page.getByRole('button', { name: 'Начать бой' }).click();
  await page.locator('.mode').nth(1).click();
  await click(7.5, 10.5);
  check((await od()) === 1, 'an accepted move before saving the replay');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать replay' }).click();
  const replayPath = join(work, 'five.json');
  await (await download).saveAs(replayPath);
  const text = readFileSync(replayPath, 'utf8');
  const replay = JSON.parse(text);
  const floorLayers = new Set(Object.values(replay.snapshots.maps).map((m) => m.layers.floor));
  check(
    replay.format === 'kadat-client-combat-v0.5' &&
      replay.steps.filter((s) => s.type === 'map').length === 5 &&
      Object.keys(replay.snapshots.maps).length === 5,
    'the downloaded replay references five snapshots',
  );
  check(
    floorLayers.size === 2,
    `floor stored once per distinct version (${floorLayers.size} layers, not 10)`,
  );
  check(
    (text.match(/"0:0"/g) ?? []).length === 2,
    'the painted cell 0:0 appears only in the two stored floor layers',
  );
  console.log(`INFO replay after five applies: ${(Buffer.byteLength(text) / 1024).toFixed(0)} KiB`);

  // A drag whose scene revision changes before release is refused; a normal drag works.
  await page.locator('.mode').nth(1).click();
  {
    const from = await screen(7.5, 10.5);
    const to = await screen(9.5, 10.5);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await page.evaluate(() => window.__kadatTest.bumpSceneRevision());
    await page.mouse.up();
  }
  check(await toastWith('Сцена изменилась'), 'a drag is refused when the scene changed during it');
  check((await od()) === 1, 'the refused drag spends no OD');
  check((await tokenPosition('kelus-drakar')).x === 7.5, 'Kelus stays after the refused drag');
  await page.locator('.mode').nth(1).click();
  await drag({ x: 7.5, y: 10.5 }, { x: 9.5, y: 10.5 });
  check(
    (await od()) === 0 && (await tokenPosition('kelus-drakar')).x === 9.5,
    'a drag without a scene change is accepted',
  );

  // Restart and open the downloaded replay through the interface.
  await page.reload();
  await page.waitForSelector('svg.map');
  await page
    .locator('label.file-button', { hasText: 'Открыть replay' })
    .locator('input')
    .setInputFiles(replayPath);
  check(await toastWith('Replay воспроизведён'), 'the replay opens through the interface');
  check(
    (await mapSize()) === '200x200' &&
      (await floorCells()) === 10006 &&
      (await count('[data-wall]')) === 1 &&
      (await count('[data-door]')) === 1 &&
      (await count('[data-obstacle]')) === 1,
    'the replay restores the painted map with its wall, door and obstacle',
  );
  check(
    (await tokenPosition('kelus-drakar')).x === 7.5 && (await od()) === 1,
    'the replay restores the saved move (Kelus at 7.5, 1 OD)',
  );
  // A broken replay leaves the current battle as it is.
  const brokenPath = join(work, 'broken.json');
  writeFileSync(brokenPath, text.replace('"M3"', '"M9"'));
  await page
    .locator('label.file-button', { hasText: 'Открыть replay' })
    .locator('input')
    .setInputFiles(brokenPath);
  check(await toastWith('Текущий бой не изменён'), 'a broken replay is refused');
  check((await tokenPosition('kelus-drakar')).x === 7.5, 'the current battle is kept');
  rmSync(work, { recursive: true, force: true });
}

// Back to the standard scene for the control combat.
await page.getByRole('button', { name: 'Новый бой' }).click();
check((await mapSize()) === '20x20', 'new battle restores the standard 20 × 20 scene');

// 1. Setup placement before combat: drops snap to cell centres.
await page.screenshot({ path: `${out}/01-setup.png` });
check((await occupiedCells('kelus-drakar')) === 1, 'size-1 token occupies one cell');
await drag({ x: 15.5, y: 10.5 }, { x: 13.3, y: 8.8 });
const pak = await tokenPosition('pak');
check(
  pak.x === 13.5 && pak.y === 8.5,
  `setup drag snaps Pak to cell 13,8 (got ${pak.x}; ${pak.y})`,
);

// 1b. A token cannot be dropped onto another token.
await drag({ x: 5.5, y: 10.5 }, { x: 13.5, y: 8.5 });
check((await toast()).includes('заняты'), 'overlapping drop rejected');
const kelus0 = await tokenPosition('kelus-drakar');
check(kelus0.x === 5.5 && kelus0.y === 10.5, 'Kelus stays in his cell');

// 1c. Pak takes a 2-cell area (GM setting, setup only).
await page.getByRole('tab', { name: 'Пак' }).click();
await page.getByLabel('Площадь токена').selectOption('2x1');
check((await occupiedCells('pak')) === 2, 'size-2 token occupies two cells');
await page.getByRole('tab', { name: 'Келус' }).click();

// 2. Start combat.
await page.getByRole('button', { name: 'Начать бой' }).click();
check((await od()) === 2, 'combat start gives Kelus 2 OD');
check(
  (await page.textContent('.turn-bar h2')).includes('Келус'),
  'turn bar shows Kelus as the active participant',
);

// 3. Movement options from the engine.
const modes = await page.locator('.move-modes li').allTextContents();
check(modes[1].includes('4 м') && modes[2].includes('8 м'), 'Core distances 4 m / 8 m shown');
check(
  (await page.locator('.move-modes li').nth(3).textContent()).includes('Ждёт подтверждения автора'),
  'Run is blocked pending the author',
);

// 4. Choose Полудвижение and click a highlighted cell (the click point snaps to its centre).
await page.locator('.mode').nth(1).click();
const reach = Number(await page.locator('[data-testid="reach"]').getAttribute('data-cells'));
check(reach > 0, `reachable cells highlighted (${reach})`);
const hover = await screen(7.7, 10.2);
await page.mouse.move(hover.x, hover.y);
await page.screenshot({ path: `${out}/02-move-preview.png` });
await page.mouse.click(hover.x, hover.y);
const kelus = await tokenPosition('kelus-drakar');
check(
  kelus.x === 7.5 && kelus.y === 10.5,
  `click snaps and moves Kelus 2 m to cell 7,10 (got ${kelus.x}; ${kelus.y})`,
);
check((await od()) === 1, 'half move spends 1 OD');

// 5. Out-of-range destination is rejected without spending OD.
await page.locator('.mode').nth(1).click();
const far = await screen(14, 10);
await page.mouse.click(far.x, far.y);
check((await toast()).includes('больше допустимой'), 'too-far move rejected with reason');
check((await od()) === 1, 'rejected move spends nothing');
check((await tokenPosition('kelus-drakar')).x === 7.5, 'token stays in place');

// 6. Attack with fixed dice through the Core.
await page.locator('.dice summary').click();
await page.locator('.dice select').selectOption('fixed');
await page.locator('.dice textarea').fill('100:45,10:2,100:20');
await page.getByRole('tab', { name: 'Атака' }).click();
await page.screenshot({ path: `${out}/03-attack.png` });
await page.getByRole('button', { name: 'Атаковать' }).click();
check((await toast()).includes('Попадание'), 'shot resolves as a hit');
await page.getByRole('tab', { name: 'Пак' }).click();
check((await page.textContent('.vitals')).includes('31 / 33'), 'Pak wounds 31 / 33 in his card');
check((await od()) === 0, 'move + shot spent both OD');
await page.screenshot({ path: `${out}/04-after-attack.png`, fullPage: true });

// 7. Pass the turn; Pak becomes active.
await page.getByRole('button', { name: 'Передать ход' }).click();
check((await page.textContent('.turn-bar h2')).includes('Пак'), 'turn passes to Pak');
const journal = await page.locator('.log-line').count();
check(journal >= 7, `journal lists ${journal} entries`);

// 7a. Ready-made stage 3 stand (ПРОВЕРКА-ЭТАПА.md): loads from the menu, door toggles,
// closed door and mud both refuse without spending OD.
{
  const click = async (x, y) => {
    const pt = await screen(x, y);
    await page.mouse.click(pt.x, pt.y);
  };
  await page.locator('.dice select').selectOption('random');
  await page.locator('.menu summary', { hasText: 'Сценарии' }).click();
  await page.getByRole('button', { name: 'Стенд этапа 3: комната с дверью' }).click();
  check(await toastWith('Стенд этапа 3 загружен'), 'stage 3 stand loads from the menu');
  check(
    !(await page.locator('details.menu').evaluate((d) => d.open)),
    'the scenario menu closes after a pick',
  );
  check(
    (await page.locator('[data-door]').count()) === 1 &&
      (await page.locator('[data-door]').getAttribute('data-open')) === 'false',
    'stand has one closed door',
  );
  check(
    (await tokenPosition('kelus-drakar')).x === 6.5 && (await tokenPosition('pak')).x === 16.5,
    'stand places Kelus west of the door and Pak east of the room',
  );
  await click(8, 10.5);
  check(
    (await page.locator('[data-door]').getAttribute('data-open')) === 'true',
    'stand door opens by a click',
  );
  await click(8, 10.5);
  await page.getByRole('button', { name: 'Начать бой' }).click();
  if ((await page.textContent('.turn-bar h2')).includes('Пак'))
    await page.getByRole('button', { name: 'Передать ход' }).click();
  await page.getByRole('tab', { name: 'Келус' }).click();
  await page.getByRole('tab', { name: 'Движение' }).click();
  await page.locator('.mode').nth(1).click(); // half move
  await click(9.5, 10.5);
  check(await toastWith('закрытая дверь'), 'stand: closed door refuses the move');
  check((await od()) === 2, 'stand: refused move spends no OD');
  await page.locator('.mode').nth(1).click(); // deselect
  await page.locator('.mode').nth(2).click(); // full move
  await click(4.5, 15.5);
  check(await toastWith('Ждёт решения автора'), 'stand: mud waits for the author');
  check((await od()) === 2, 'stand: mud refusal spends no OD');
  check((await tokenPosition('kelus-drakar')).x === 6.5, 'stand: Kelus stays in place');
  await page.screenshot({ path: `${out}/04b-stage3-stand.png` });
  await page.getByRole('tab', { name: 'Атака' }).click();
  check(
    (await page.textContent('.actions')).includes('линия атаки проходит через'),
    'stand: attack through the room walls is flagged for the author',
  );
  check(
    await page.getByRole('button', { name: 'Атаковать' }).isDisabled(),
    'stand: attack button is disabled while the line is blocked',
  );
}

// 7b. Simple view: technical panels hidden, the essentials stay.
await page.getByRole('button', { name: 'Подробно' }).click();
check((await page.locator('.dice').count()) === 0, 'simple view hides the dice panel');
check(!(await page.locator('.stats').first().isVisible()), 'simple view hides characteristics');
check(await page.locator('.vitals').first().isVisible(), 'simple view keeps wounds and blood');
await page.screenshot({ path: `${out}/04c-simple-view.png` });
await page.getByRole('button', { name: 'Подробно' }).click();

// 8. Phone layout renders without horizontal overflow.
await page.setViewportSize({ width: 390, height: 844 });
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth > window.innerWidth + 1,
);
check(!overflow, 'no horizontal overflow at 390 px');
await page.screenshot({ path: `${out}/05-phone.png` });

check(errors.length === 0, `no browser errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED');
process.exitCode = failures.length ? 1 : 0;
