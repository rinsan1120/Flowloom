import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');

const base = process.env.FLOWLOOM_URL ?? 'http://127.0.0.1:4173/Flowloom/';
async function ready() {
  for (let n = 0; n < 40; n++) {
    try { const response = await fetch(base); if (response.ok) return; } catch { /* waiting for preview */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Vite preview did not become ready: ' + base);
}
async function downloadJson(page) {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /JSONを保存/ }).click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /\.flowloom\.json$/);
  return JSON.parse(await readFile(await download.path(), 'utf8'));
}
await ready();
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  page.on('pageerror', error => errors.push(error.message));
  const response = await page.goto(base, { waitUntil: 'networkidle' });
  assert.equal(response?.status(), 200, 'GitHub Pages subpath preview must load');
  await page.getByRole('button', { name: /サンプル.*小さな図書室/ }).click();
  await page.locator('.react-flow__node').first().waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 4);
  assert.equal(await page.locator('.react-flow__edge').count(), 7, 'screen transitions should render');
  assert.equal(await page.locator('.react-flow__edge-text').count(), 0, 'edge action text must not clutter canvas');
  const saved = await downloadJson(page);
  assert.equal(saved.screens.length, 4);
  assert.equal(saved.transitions.length, 7);
  assert.equal(saved.flows.length, 2);

  const node = page.locator('.react-flow__node[data-id="home"]');
  // The first pointer interaction can race React Flow's initial
  // measurement/fit on a slow runner, so retry the drag until the
  // layout actually moves instead of failing on a missed grab.
  let moved = null;
  for (let attempt = 0; attempt < 3 && !moved; attempt++) {
    const bounds = await node.boundingBox();
    assert(bounds, 'home node must be visible');
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 110, y + 65, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const candidate = await downloadJson(page);
    if (Math.abs(candidate.layout.screens.home.x - saved.layout.screens.home.x) > 1) moved = candidate;
  }
  assert(moved, 'drag should persist node position');

  await page.getByRole('button', { name: '業務フロー' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 3);
  await page.locator('select[aria-label="表示する業務フロー"]').selectOption('return');
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 2);
  await page.locator('input[type="file"]').setInputFiles({
    name: 'saved.flowloom.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(moved))
  });
  await page.getByRole('button', { name: '配置を維持して適用' }).click();
  await page.getByText('読み込む内容を確認').waitFor({ state: 'hidden' });
  const afterReload = await downloadJson(page);
  assert.deepEqual(afterReload.layout.screens.home, moved.layout.screens.home);
  assert.deepEqual(errors, [], 'browser should not have unhandled page errors');
  console.log('Browser smoke PASS: render, edges, drag, flows, JSON save/restore, subpath');
} finally {
  await browser.close();
}
