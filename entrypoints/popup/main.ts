import './style.css';
import { activeGroup, loadSettings, normalizeHandle, saveSettings, type Settings } from '../../src/settings';
import { LIST_CAPTURE_KEY, parseListCapture, type ListCaptureSnapshot } from '../../src/list-capture';

const root = document.querySelector<HTMLElement>('#app')!;
let settings: Settings | null = null;
let lastCapture: ListCaptureSnapshot | null = null;
let visibleAccountLimit = 100;
let info = '';
let error = false;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K, text = '', className = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function notify(text: string, isError = false): void {
  info = text;
  error = isError;
  const line = root.querySelector<HTMLElement>('#message');
  if (line) {
    line.textContent = text;
    line.classList.toggle('error', isError);
  }
}

async function update(change: (next: Settings) => void): Promise<boolean> {
  if (!settings) return false;
  const next = structuredClone(settings);
  change(next);
  try {
    await saveSettings(next);
    settings = next;
    render();
    return true;
  } catch {
    notify('設定の保存に失敗しました。', true);
    return false;
  }
}

function button(text: string, className = ''): HTMLButtonElement {
  const node = element('button', text, className);
  node.type = 'button';
  return node;
}

function render(): void {
  if (!settings) return;
  const group = activeGroup(settings);
  root.replaceChildren();

  const header = element('header');
  header.append(element('h1', 'X Timeline Filter'), element('p', 'ホームに表示するアカウントを管理', 'subtitle'));
  root.append(header);

  const toggleBox = element('div', '', 'toolbar');
  const toggleLabel = element('label', '', 'toggle-line');
  const toggleCopy = element('span', '', 'toggle-copy');
  toggleCopy.append(
    element('span', 'タイムラインのフィルター', 'toggle-title'),
    element('span', settings.enabled ? '許可したアカウントのみ表示' : '現在はすべてのアカウントを表示', 'toggle-description'),
  );
  const toggle = element('input') as HTMLInputElement;
  toggle.type = 'checkbox';
  toggle.className = 'toggle-switch';
  toggle.setAttribute('aria-label', 'フィルター ON/OFF');
  toggle.checked = settings.enabled;
  toggle.addEventListener('change', () => { void update((s) => { s.enabled = toggle.checked; }); });
  toggleLabel.append(toggleCopy, toggle);
  toggleBox.append(toggleLabel);
  root.append(toggleBox);

  const groups = element('section', '', 'section');
  groups.append(element('h2', '表示グループ'));
  const selectRow = element('div', '', 'line');
  const select = element('select');
  select.setAttribute('aria-label', '表示グループ');
  for (const entry of settings.groups) {
    const option = element('option', entry.name);
    option.value = entry.id;
    option.selected = entry.id === settings.activeGroupId;
    select.append(option);
  }
  select.addEventListener('change', () => { visibleAccountLimit = 100; void update((s) => { s.activeGroupId = select.value; }); });
  const removeGroup = button('削除', 'quiet dangerous');
  removeGroup.disabled = settings.groups.length === 1;
  removeGroup.title = '現在のグループを削除';
  removeGroup.addEventListener('click', () => {
    if (!confirm(`「${group.name}」を削除しますか？`)) return;
    void update((s) => {
      s.groups = s.groups.filter((g) => g.id !== s.activeGroupId);
      s.activeGroupId = s.groups[0]!.id;
    });
  });
  selectRow.append(select, removeGroup);
  groups.append(selectRow);

  const createForm = element('form', '', 'line');
  const groupName = element('input') as HTMLInputElement;
  groupName.placeholder = '新しいグループ名';
  groupName.maxLength = 40;
  groupName.required = true;
  groupName.setAttribute('aria-label', '新しいグループ名');
  const create = element('button', '作成', 'secondary');
  create.type = 'submit';
  createForm.append(groupName, create);
  createForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = groupName.value.trim();
    if (!name) return;
    if (settings!.groups.length >= 100) return notify('グループは100件までです。', true);
    void update((s) => {
      const id = crypto.randomUUID();
      s.groups.push({ id, name, accounts: [] });
      s.activeGroupId = id;
    });
  });
  groups.append(createForm);
  root.append(groups);

  const accountSection = element('section', '', 'section');
  const accountHeading = element('div', '', 'section-heading');
  accountHeading.append(element('h2', '表示するアカウント'), element('span', `${group.accounts.length}件`, 'count-badge'));
  accountSection.append(accountHeading);
  const accountForm = element('form', '', 'account-form');
  const input = element('textarea') as HTMLTextAreaElement;
  input.placeholder = '@username（改行・カンマ区切りで複数追加）';
  input.rows = 2;
  input.setAttribute('aria-label', '追加するアカウント');
  const add = element('button', 'アカウントを追加', 'primary wide');
  add.type = 'submit';
  accountForm.append(input, add);
  accountForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const tokens = input.value.split(/[\s,;]+/).filter(Boolean);
    const handles = tokens.map(normalizeHandle);
    if (!tokens.length || handles.some((handle) => handle === null)) {
      return notify('ユーザー名を確認してください（最大15文字、英数字と _）。', true);
    }
    if (group.accounts.length + handles.length > 10000) return notify('1グループは最大10000件です。', true);
    const before = group.accounts.length;
    void update((s) => {
      const accounts = activeGroup(s).accounts;
      activeGroup(s).accounts = [...new Set([...accounts, ...handles as string[]])];
    }).then((saved) => { if (saved) notify(`${activeGroup(settings!).accounts.length - before}件追加しました。`); });
  });
  accountSection.append(accountForm);

  const members = element('div', '', 'accounts');
  if (!group.accounts.length) members.append(element('p', '登録アカウントはありません。', 'empty'));
  for (const handle of group.accounts.slice(0, visibleAccountLimit)) {
    const item = element('div', '', 'account');
    item.append(element('span', `@${handle}`, 'account-name'));
    const remove = button('削除', 'remove');
    remove.setAttribute('aria-label', `@${handle} を削除`);
    remove.addEventListener('click', () => {
      void update((s) => {
        activeGroup(s).accounts = activeGroup(s).accounts.filter((name) => name !== handle);
      });
    });
    item.append(remove);
    members.append(item);
  }
  accountSection.append(members);
  if (group.accounts.length > visibleAccountLimit) {
    const more = button(`さらに表示（${Math.min(visibleAccountLimit, group.accounts.length)}/${group.accounts.length}件）`, 'quiet wide');
    more.addEventListener('click', () => {
      const scrollTop = members.scrollTop;
      visibleAccountLimit += 100;
      render();
      const list = root.querySelector<HTMLElement>('.accounts');
      if (list) list.scrollTop = scrollTop;
    });
    accountSection.append(more);
  }
  const importSection = element('section', '', 'section');
  importSection.append(element('h2', 'Xリストから取り込む'));
  const captureRow = element('div', '', 'capture-row');
  captureRow.append(
    element('span', lastCapture ? `リスト ID ${lastCapture.listId}` : 'リスト未取得', 'capture-source'),
    element('span', lastCapture ? `${lastCapture.accounts.length}件取得済み` : '0件', 'capture-count'),
  );
  const importButton = button('取得済みメンバーを追加', 'secondary wide');
  importButton.addEventListener('click', () => { void importVisibleMembers(importButton); });
  importSection.append(
    captureRow,
    importButton,
    element('p', 'Xのリストでメンバーを開き、スクロールした分を取り込めます。', 'hint'),
  );
  root.append(importSection, accountSection);

  const message = element('p', info, error ? 'message error' : 'message');
  message.id = 'message';
  message.setAttribute('role', 'status');
  root.append(message);
}

async function importVisibleMembers(control: HTMLButtonElement): Promise<void> {
  control.disabled = true;
  try {
    // chrome.tabs does not exist in Xtend's WebKit extension runtime. Both
    // Chrome and Xtend share the extension's storage namespace instead.
    const stored = await chrome.storage.local.get(LIST_CAPTURE_KEY);
    const capture = parseListCapture(stored[LIST_CAPTURE_KEY]);
    lastCapture = capture;
    if (!capture?.accounts.length) {
      notify('取得済みメンバーがありません。Xでリストの「メンバー」を開いてください。', true);
      return;
    }
    const before = activeGroup(settings!).accounts.length;
    const saved = await update((s) => {
      const accounts = activeGroup(s).accounts;
      activeGroup(s).accounts = [...new Set([...accounts, ...capture.accounts])].slice(0, 10000);
    });
    if (!saved) return;
    notify(`リスト ID ${capture.listId} の取得済み${capture.accounts.length}件から${activeGroup(settings!).accounts.length - before}件追加しました。`);
  } catch {
    notify('読み込みに失敗しました。Xでメンバー画面を開き直して再試行してください。', true);
  } finally {
    control.disabled = false;
  }
}

void Promise.all([loadSettings(), chrome.storage.local.get(LIST_CAPTURE_KEY)]).then(([loaded, stored]) => {
  settings = loaded;
  lastCapture = parseListCapture(stored[LIST_CAPTURE_KEY]);
  render();
}).catch(() => {
  root.textContent = '設定を読み込めませんでした。';
});
