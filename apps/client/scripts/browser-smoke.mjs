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

// 1. Setup placement before combat.
await page.screenshot({ path: `${out}/01-setup.png` });
await drag({ x: 15, y: 10 }, { x: 13, y: 8 });
const pak = await tokenPosition('pak');
check(
  Math.abs(pak.x - 13) < 0.05 && Math.abs(pak.y - 8) < 0.05,
  'setup drag places Pak at (13; 8)',
);

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
  (await page.locator('.move-modes li').nth(3).textContent()).includes('Ждёт решения автора'),
  'Run is blocked pending the author',
);

// 4. Choose Полудвижение and click a destination inside the reach circle.
await page.locator('.mode').nth(1).click();
check((await page.locator('[data-testid="reach"]').count()) === 1, 'reach circle drawn');
const hover = await screen(7.5, 10);
await page.mouse.move(hover.x, hover.y);
await page.screenshot({ path: `${out}/02-move-preview.png` });
await page.mouse.click(hover.x, hover.y);
const kelus = await tokenPosition('kelus-drakar');
check(Math.abs(kelus.x - 7.5) < 0.05, 'click moves Kelus 2.5 m');
check((await od()) === 1, 'half move spends 1 OD');

// 5. Out-of-range destination is rejected without spending OD.
await page.locator('.mode').nth(1).click();
const far = await screen(14, 10);
await page.mouse.click(far.x, far.y);
check((await toast()).includes('больше допустимой'), 'too-far move rejected with reason');
check((await od()) === 1, 'rejected move spends nothing');
check(Math.abs((await tokenPosition('kelus-drakar')).x - 7.5) < 0.05, 'token stays in place');

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
