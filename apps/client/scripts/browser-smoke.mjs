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
