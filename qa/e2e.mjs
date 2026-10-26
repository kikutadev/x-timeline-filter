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
const listDetail = '<!doctype html><html lang="ja"><body><h2>To view keyboard shortcuts, press question mark</h2><h2>Weather</h2><main role="main"><h1>List</h1></main></body></html>';
const memberView = `<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body>
<div role="dialog"><h2>Members</h2><div data-testid="UserCell"><a href="/Bob">Bob</a></div>
<div data-testid="UserCell"><a href="/Charlie">Charlie</a></div></div>
</body></html>`;

// Match the live mobile X layout observed in iPhone Simulator: no dialog or
// primaryColumn, only a main landmark headed "List members" with UserCell buttons.
const mobileMemberView = `<!doctype html><html lang="ja"><body>
<div data-testid="sidebarColumn"><div data-testid="UserCell"><a href="/outside">outside</a></div></div>
<main role="main"><h2>List members</h2><section role="region">
<div data-testid="cellInnerDiv"><button data-testid="UserCell"><a href="/Foxtrot">Foxtrot</a></button></div>
<div data-testid="cellInnerDiv"><button data-testid="UserCell"><a href="/Golf">Golf</a></button></div>
</section></main></body></html>`;

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
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: path === '/home' ? home : path === '/i/lists/123' ? listDetail : path === '/i/lists/789/members' ? mobileMemberView : memberView });
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
  page.on('pageerror', error => console.error('X PAGE ERROR:', error.message));
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') console.error('X CONSOLE:', message.text()); });
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
  // Narrow Xtend settings sheets must not hide the frequently used X-list import action.
  await popup.setViewportSize({ width: 320, height: 640 });
  const importAction = popup.getByRole('button', { name: 'リストをグループに取り込む' });
  const importBounds = await importAction.boundingBox();
  assert(importBounds && importBounds.y >= 0 && importBounds.y + importBounds.height < 640,
    'list import must be visible without scrolling on a narrow mobile sheet');
  assert.equal(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
    'narrow popup must not overflow horizontally');
  if (process.env.XTF_SCREENSHOT === '1') {
    await popup.screenshot({path:join(projectRoot, '.dev', 'popup-mobile-preview.png')});
  }
  await popup.setViewportSize({ width: 1050, height: 860 });

  // System theme is read through the browser's system color-scheme media query.
  await popup.emulateMedia({colorScheme:'dark'});
  assert.equal(await popup.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches), true);
  assert.equal(await popup.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), 'rgb(9, 9, 11)');
  assert.equal(await popup.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()), '#93c5fd');
  if (process.env.XTF_SCREENSHOT === '1') {
    await popup.screenshot({path:join(projectRoot,'.dev','popup-dark-preview.png')});
  }
  await popup.emulateMedia({colorScheme:'light'});
  assert.equal(await popup.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), 'rgb(255, 255, 255)');
  assert.equal(await popup.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()), '#2563eb');

  // SPA navigation must restore posts outside /home.
  await page.evaluate(() => history.pushState({}, '', '/search?q=demo'));
  await page.waitForFunction((flag) => !document.querySelector('#bob').hasAttribute(flag), flag);
  await page.evaluate(() => history.pushState({}, '', '/home'));
  await page.locator(`#bob[${flag}]`).waitFor({state:'attached'});

  // A real headless extension session: capture via storage, not chrome.tabs messaging.
  await page.goto('https://x.com/i/lists/123', {waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => !!document.querySelector('main h1'));
  await page.evaluate(html => {
    history.pushState({}, '', '/i/lists/123/members');
    document.body.innerHTML = html;
  }, memberView);
  const readCapture = async () => popup.evaluate(async () =>
    (await chrome.storage.local.get('timelineFilterLastListCapture')).timelineFilterLastListCapture);
  async function waitForCapture(predicate) {
    for (let i = 0; i < 60; i++) {
      const snapshot = await readCapture();
      if (predicate(snapshot)) return snapshot;
      await page.waitForTimeout(150);
    }
    throw new Error('member capture did not reach the expected snapshot: ' + JSON.stringify({snapshot: await readCapture(), page: await page.evaluate(() => ({ path: location.pathname, userCells: document.querySelectorAll('[data-testid=UserCell]').length, dialogs: document.querySelectorAll('[role=dialog]').length, style: !!document.getElementById('x-timeline-filter-style') }))}));
  }
  await waitForCapture(value => value?.listId === '123' && value.listName === 'Weather' && value.accounts?.length === 2);
  assert.deepEqual((await readCapture()).accounts, ['bob','charlie'], 'must not capture background or sidebar');
  // Simulate X virtualizing the list: earlier rendered rows disappear.
  await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    dialog.innerHTML = '<h2>List members</h2><div data-testid="UserCell"><a href="/Delta">Delta</a></div>';
  });
  await waitForCapture(value => value?.listId === '123' && value.accounts?.length === 3);
  assert.deepEqual((await readCapture()).accounts, ['bob','charlie','delta']);
  await popup.getByRole('button', {name:'リストをグループに取り込む'}).click();
  await popup.getByRole('status').getByText(/Weather.*作成.*3件追加/).waitFor();
  assert.deepEqual(await popup.evaluate(async () => {
    const settings = (await chrome.storage.local.get('timelineFilterSettings')).timelineFilterSettings;
    return { active:settings.activeGroupId, original:settings.groups.find(group => group.id === 'default').accounts,
      imported:settings.groups.find(group => group.id === 'x-list-123') };
  }), {active:'x-list-123',original:['alice'],imported:{id:'x-list-123',name:'Weather',accounts:['bob','charlie','delta']}});
  await popup.getByRole('button', {name:'リストをグループに取り込む'}).click();
  await popup.getByRole('status').getByText(/Weather.*更新.*0件追加/).waitFor();
  assert.equal(await popup.getByRole('combobox', {name:'表示グループ'}).locator('option').count(),3);
  assert.equal(await popup.getByRole('combobox', {name:'表示グループ'}).inputValue(),'x-list-123');
  // Moving to another list must reset the captured members rather than mixing lists.
  await page.evaluate(() => {
    history.pushState({}, '', '/i/lists/456/members');
    document.querySelector('[role="dialog"]').innerHTML =
      '<h2>List members</h2><div data-testid="UserCell"><a href="/Echo">Echo</a></div>';
  });
  await waitForCapture(value => value?.listId === '456' && value.accounts?.length === 1);
  assert.deepEqual((await readCapture()).accounts, ['echo']);

  // Full-page mobile list member view (no dialog / primary column).
  await page.goto('https://x.com/i/lists/789/members', {waitUntil:'domcontentloaded'});
  await waitForCapture(value => value?.listId === '789' && value.accounts?.length === 2);
  assert.deepEqual((await readCapture()).accounts, ['foxtrot', 'golf']);

  // Neither popup changes nor filtering generate requests to X.
  assert.equal(intercepted, 3, 'only three deliberate navigations are expected');
  await context.close();
  context = await chromium.launchPersistentContext(profile, options);
  await context.route('https://x.com/**', route => route.fulfill({
    status: 200, contentType: 'text/html; charset=utf-8', body: home,
  }));
  const reopened = context.pages()[0] ?? await context.newPage();
  await reopened.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
  await reopened.locator(`#bob`).waitFor({state:'attached'});
  await reopened.locator(`#alice[${flag}]`).waitFor({state:'attached'});
  assert.equal(await reopened.locator(`#charlie[${flag}]`).count(), 0);
  console.log('X Timeline Filter: extension E2E + persistence PASS');
} finally {
  await context?.close();
  await rm(profile, {recursive:true, force:true, maxRetries:5, retryDelay:150});
}
