import './style.css';
import { activeGroup, loadSettings, normalizeHandle, saveSettings, type Settings } from '../../src/settings';

const root = document.querySelector<HTMLElement>('#app')!;
let settings: Settings | null = null;
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
  header.append(element('h1', 'X Timeline Filter'), element('span', 'アカウント許可リスト', 'subtitle'));
  root.append(header);

  const toggleBox = element('div', '', 'toolbar');
  const toggleLabel = element('label', '', 'toggle-line');
  const toggle = element('input') as HTMLInputElement;
  toggle.type = 'checkbox';
  toggle.checked = settings.enabled;
  toggle.addEventListener('change', () => { void update((s) => { s.enabled = toggle.checked; }); });
  toggleLabel.append(toggle, element('span', settings.enabled ? 'フィルター ON' : 'フィルター OFF'));
  toggleBox.append(toggleLabel, element('span', `${group.accounts.length} アカウント`, 'count'));
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
  select.addEventListener('change', () => { void update((s) => { s.activeGroupId = select.value; }); });
  const removeGroup = button('削除', 'subtle');
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
  const create = element('button', '作成', 'primary');
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
  accountSection.append(element('h2', '表示するアカウント'));
  const accountForm = element('form', '', 'account-form');
  const input = element('textarea') as HTMLTextAreaElement;
  input.placeholder = '@username（改行・カンマ区切りで複数追加）';
  input.rows = 2;
  input.setAttribute('aria-label', '追加するアカウント');
  const add = element('button', 'アカウントを追加', 'primary');
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
  for (const handle of group.accounts) {
    const item = element('div', '', 'account');
    item.append(element('span', `@${handle}`));
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
  root.append(accountSection);

  const importSection = element('section', '', 'section');
  importSection.append(element('h2', 'Xリストから取り込む'));
  const importButton = button('読み込んだメンバーを取り込む', 'subtle wide');
  importButton.addEventListener('click', () => { void importVisibleMembers(importButton); });
  importSection.append(importButton, element(
    'p', 'Xでリストの「メンバー」を開いてから実行。表示後にスクロールした分も蓄積します。未読み込みのメンバーは対象外です。',
    'hint',
  ));
  root.append(importSection);

  const message = element('p', info, error ? 'message error' : 'message');
  message.id = 'message';
  message.setAttribute('role', 'status');
  root.append(message);
}

async function importVisibleMembers(control: HTMLButtonElement): Promise<void> {
  control.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !/^https:\/\/(x\.com|twitter\.com)\//.test(tab.url)) {
      throw new Error('Xのリスト画面で実行してください。');
    }
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'XTF_LIST_MEMBERS' }) as {
      ok: boolean; accounts?: string[]; error?: string;
    };
    if (!result?.ok) throw new Error(result?.error || 'メンバーを読み取れませんでした。');
    const handles = [...new Set((result.accounts ?? []).map(normalizeHandle).filter((a): a is string => a !== null))];
    if (!handles.length) return notify('読み込まれたメンバーが見つかりません。リストの画面をスクロールして再度試してください。', true);
    const before = activeGroup(settings!).accounts.length;
    const saved = await update((s) => {
      const accounts = activeGroup(s).accounts;
      activeGroup(s).accounts = [...new Set([...accounts, ...handles])].slice(0, 10000);
    });
    if (!saved) return;
    notify(`読み込み済み${handles.length}件を確認、${activeGroup(settings!).accounts.length - before}件追加。未表示のメンバーは含まれません。`);
  } catch (cause) {
    notify(cause instanceof Error ? cause.message : 'リストの読み込みに失敗しました。', true);
  } finally {
    control.disabled = false;
  }
}

void loadSettings().then((loaded) => {
  settings = loaded;
  render();
}).catch(() => {
  root.textContent = '設定を読み込めませんでした。';
});
