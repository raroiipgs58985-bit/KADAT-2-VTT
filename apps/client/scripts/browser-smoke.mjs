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

// Replay v0.3 cannot be exported for another map size: the reason is shown.
await page.getByRole('tab', { name: 'Расстановка' }).click();
await page.getByRole('button', { name: 'Скачать replay' }).click();
check((await toast()).includes('только сцену 20 × 20'), 'replay export explains the size limit');

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
  await page.getByPlaceholder('например, Ящики').fill('Ящики');
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
