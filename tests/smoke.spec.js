// Runs a short workout end to end and saves phone screenshots of each screen
// to docs/screenshots (uploaded by CI so every PR can be reviewed visually).
const { test, expect } = require('@playwright/test');

const shots = 'docs/screenshots';

async function tap(page, key, dir, times) {
  const sel = `.stepper[data-key="${key}"] .step[data-d="${dir}"]`;
  for (let i = 0; i < times; i++) {
    await page.dispatchEvent(sel, 'pointerdown');
    await page.dispatchEvent(sel, 'pointerup');
  }
}

test('timer runs a full workout without errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await expect(page.locator('#count')).toHaveText('2:25'); // 5s + 5×20s + 4×10s
  await page.screenshot({ path: `${shots}/1-ready.png` });

  // Settings: defaults, every sound plays, changes persist.
  await page.click('#settingsBtn');
  await expect(page.locator('.stepper[data-key="work"] output')).toHaveText('20');
  await expect(page.locator('.stepper[data-key="rest"] output')).toHaveText('10');
  await expect(page.locator('.stepper[data-key="rounds"] output')).toHaveText('5');
  await expect(page.locator('.stepper[data-key="prep"] output')).toHaveText('5');
  await page.screenshot({ path: `${shots}/6-settings.png` });
  for (const id of await page.$$eval('#sndStart option', (os) => os.map((o) => o.value))) {
    await page.selectOption('#sndStart', id);
  }
  await page.selectOption('#sndStart', 'whistle');
  await tap(page, 'work', -1, 3);   // 5s
  await tap(page, 'rest', -1, 1);   // 5s
  await tap(page, 'rounds', -1, 3); // 2
  await tap(page, 'prep', -1, 2);   // 3s
  await page.click('#settingsDone');

  await page.click('#helpBtn');
  await page.screenshot({ path: `${shots}/7-install-help.png` });
  await page.click('#helpDone');

  await page.reload();
  await expect(page.locator('#round')).toHaveText('2 × 5s work / 5s rest');

  await page.click('#mainBtn');
  await expect(page.locator('body')).toHaveAttribute('data-phase', 'prep');
  await page.screenshot({ path: `${shots}/2-get-ready.png` });

  await expect(page.locator('body')).toHaveAttribute('data-phase', 'work', { timeout: 5000 });
  await expect(page.locator('#round')).toHaveText('Round 1 of 2');
  await page.screenshot({ path: `${shots}/3-work.png` });

  await expect(page.locator('body')).toHaveAttribute('data-phase', 'rest', { timeout: 7000 });
  await page.screenshot({ path: `${shots}/4-rest.png` });

  // Pause holds the clock.
  await page.click('#mainBtn');
  const held = await page.textContent('#count');
  await page.waitForTimeout(1500);
  await expect(page.locator('#count')).toHaveText(held);
  await page.click('#mainBtn');

  await expect(page.locator('body')).toHaveAttribute('data-phase', 'done', { timeout: 15000 });
  await expect(page.locator('#mainBtn')).toHaveText('Go again');
  await page.screenshot({ path: `${shots}/5-done.png` });

  expect(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()))).toBe(true);
  expect(errors).toEqual([]);
});
