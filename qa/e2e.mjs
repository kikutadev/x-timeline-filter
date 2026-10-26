import { chromium } from 'playwright';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const extensionPath = join(projectRoot, '.output', 'chrome-mv3');
const extensionPaths = extensionPath;
const profile = await mkdtemp(join(tmpdir(), 'x-timeline-filter-e2e-'));
const flag = 'data-x-timeline-filter-hidden';
const post = (id, handle) => `<div id="${id}" data-testid="cellInnerDiv"><article data-testid="tweet">
  <div data-testid="User-Name"><a href="/${handle}">@${handle}</a></div>
  <a href="/${handle}/status/123">time</a>
</article></div>`;
const home = `<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body><main id="timeline">
  ${post('alice','Alice')} ${post('bob','Bob')} ${post('charlie','Charlie')}
</main></body></html>`;
const memberView = `<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body>
<div role="dialog"><h2>Members</h2><div data-testid="UserCell"><a href="/Bob">Bob</a></div>
<div data-testid="UserCell"><a href="/Charlie">Charlie</a></div></div>
</body></html>`;

const options = {
    executablePath: process.env.CHROME_BIN || undefined,
    channel: process.env.CHROME_BIN ? undefined : 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPaths}`, `--load-extension=${extensionPaths}`],
    viewport: { width: 1050, height: 860 },
};
let context;
try {
  context = await chromium.launchPersistentContext(profile, options);
  let intercepted = 0;
  await context.route('https://x.com/**', (route) => {
    intercepted++;
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: path === '/home' ? home : memberView });
  });
  // This extension intentionally has no background worker. Read the actual
  // installed ID from Chrome rather than requiring a service worker to exist.
  const manager = await context.newPage();
  await manager.goto('chrome://extensions');
  const item = manager.locator('extensions-item').filter({ hasText: 'X Timeline Filter' });
  await item.waitFor({ state: 'attached' });
  const extensionId = await item.getAttribute('id');
  assert.match(extensionId ?? '', /^[a-p]{32}$/);
  await manager.close();
  const extensionUrl = `chrome-extension://${extensionId}`;
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.getElementById('x-timeline-filter-style'));
  assert.equal(await page.locator(`#bob[${flag}]`).count(), 0, 'filter initially disabled');

  const popup = await context.newPage();
  await popup.goto(`${extensionUrl}/popup.html`);
  await popup.getByRole('textbox', { name: '追加するアカウント' }).fill('@Alice');
  await popup.getByRole('button', { name: 'アカウントを追加' }).click();
  await popup.locator('input[type=checkbox]').check();
  await page.locator(`#bob[${flag}]`).waitFor({state:'attached'});
  assert.equal(await page.locator(`#alice[${flag}]`).count(), 0);
  assert.equal(await page.locator(`#charlie[${flag}]`).count(), 1);

  // Dynamic insert and cell reuse without a page reload.
  await page.evaluate(() => {
    document.getElementById('timeline').insertAdjacentHTML('beforeend',
      '<div id="dynamic" data-testid="cellInnerDiv"><article data-testid="tweet"><div data-testid="User-Name"><a href="/Bob">Bob</a></div></article></div>');
  });
  await page.locator(`#dynamic[${flag}]`).waitFor({state:'attached'});
  await page.evaluate(() => {
    const a = document.querySelector('#dynamic [data-testid=User-Name] a');
    a.href = '/Alice'; a.textContent = 'Alice';
  });
  await page.waitForFunction((flag) => !document.querySelector('#dynamic').hasAttribute(flag), flag);

  // New group: show Bob and hide Alice without reloading X.
  await popup.getByRole('textbox', { name: '新しいグループ名' }).fill('仕事');
  await popup.getByRole('button', { name: '作成' }).click();
  await popup.getByRole('textbox', { name: '追加するアカウント' }).fill('Bob');
  await popup.getByRole('button', { name: 'アカウントを追加' }).click();
  await page.locator(`#alice[${flag}]`).waitFor({state:'attached'});
  await page.waitForFunction((flag) => !document.querySelector('#bob').hasAttribute(flag), flag);
  await popup.getByRole('combobox', {name:'表示グループ'}).selectOption('default');
  await page.waitForFunction((flag) => !document.querySelector('#alice').hasAttribute(flag), flag);

  if (process.env.XTF_SCREENSHOT === '1') {
    await mkdir(join(projectRoot, '.dev'), {recursive:true});
    await popup.screenshot({path:join(projectRoot, '.dev', 'popup-preview.png')});
  }
  assert.equal(await popup.evaluate(() => document.body.scrollWidth <= window.innerWidth), true, 'popup has no horizontal overflow');

  // SPA navigation must restore posts outside /home.
  await page.evaluate(() => history.pushState({}, '', '/search?q=demo'));
  await page.waitForFunction((flag) => !document.querySelector('#bob').hasAttribute(flag), flag);
  await page.evaluate(() => history.pushState({}, '', '/home'));
  await page.locator(`#bob[${flag}]`).waitFor({state:'attached'});

  // Content script member collector only reads the rendered member dialog.
  await page.goto('https://x.com/i/lists/123/members', {waitUntil:'domcontentloaded'});
  const response = await popup.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id,{type:'XTF_LIST_MEMBERS'});
        if (response?.ok) return response;
      } catch { /* other tabs have no content script */ }
    }
    throw new Error('Member page not found');
  });
  assert.deepEqual(response, {ok:true,accounts:['bob','charlie']});

  // Neither popup changes nor filtering generate requests to X.
  assert.equal(intercepted, 2, 'only two deliberate navigations are expected');
  await context.close();
  context = await chromium.launchPersistentContext(profile, options);
  await context.route('https://x.com/**', route => route.fulfill({
    status: 200, contentType: 'text/html; charset=utf-8', body: home,
  }));
  const reopened = context.pages()[0] ?? await context.newPage();
  await reopened.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
  await reopened.locator(`#bob[${flag}]`).waitFor({state:'attached'});
  assert.equal(await reopened.locator(`#alice[${flag}]`).count(), 0);
  console.log('X Timeline Filter: extension E2E + persistence PASS');
} finally {
  await context?.close();
  await rm(profile, {recursive:true, force:true, maxRetries:5, retryDelay:150});
}
